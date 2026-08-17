'use strict';

const crypto = require('crypto');
const {
  sequelize, Playa, Flujo, Destino, Modelo, Viaje, Unidad, Importacion
} = require('../../database/models');

/**
 * Entrada de viajes y unidades al modulo de inspeccion.
 *
 * Este modulo NO parsea archivos: el TXT de carga lo procesa el sistema de
 * solicitudes, que lo migra otro equipo. Aca las unidades llegan ya resueltas.
 *
 * La entrada se aisla detras de adaptadores porque el contrato con ese sistema
 * todavia no esta cerrado: cuando lo definan, se escribe un adaptador y no se
 * toca ni el modelo ni la API de inspeccion.
 *
 * Todo lo que entra queda registrado en `importacion` con su payload crudo,
 * para poder reprocesar sin volver a pedir los datos.
 */

/** Busca por nombre. La colacion ignora acentos y mayusculas. */
async function porNombre(Modelo_, nombre, transaction) {
  if (!nombre) return null;
  return Modelo_.findOne({ where: { nombre: String(nombre).trim() }, transaction });
}

/**
 * Registra un viaje con sus unidades.
 *
 * Es **idempotente sobre (playa, referencia_externa)**: el sistema de origen
 * puede reenviar la misma solicitud —porque se corrigio, porque no le llego la
 * respuesta— y no se duplica nada. Las unidades se reconcilian por VIN dentro
 * del viaje: se agregan las nuevas, se actualizan las que cambiaron y se
 * borran las que ya no estan.
 *
 * Lo que NO hace: borrar una unidad que ya tiene inspecciones cargadas. Si el
 * origen la saca de la lista, se avisa y se deja: perder el trabajo de un
 * inspector porque otro sistema cambio de opinion no es aceptable.
 */
async function registrarViaje(datos, { adaptador, usuarioId = null, payloadCrudo = null } = {}) {
  const avisos = [];

  const playa = await Playa.findOne({ where: { codigo: String(datos.playa || '').trim() } });
  if (!playa) {
    const e = new Error('playa_desconocida');
    e.status = 400;
    e.detalle = `no existe la playa con codigo '${datos.playa}'`;
    throw e;
  }

  const flujo = Number.isInteger(datos.flujo)
    ? await Flujo.findByPk(datos.flujo)
    : await porNombre(Flujo, datos.flujo);
  if (!flujo) {
    const e = new Error('flujo_desconocido');
    e.status = 400;
    e.detalle = `no existe el flujo '${datos.flujo}'`;
    throw e;
  }

  const unidades = Array.isArray(datos.unidades) ? datos.unidades : [];
  if (unidades.length === 0) {
    const e = new Error('sin_unidades');
    e.status = 400;
    throw e;
  }

  const importacion = await Importacion.create({
    playa_id: playa.id,
    adaptador,
    archivo: datos.archivo || null,
    payload: payloadCrudo ? String(payloadCrudo).slice(0, 4 * 1024 * 1024) : null,
    estado: 'pendiente',
    usuario_id: usuarioId
  });

  try {
    const resultado = await sequelize.transaction(async (t) => {
      const referencia = datos.referencia_externa ? String(datos.referencia_externa).trim() : null;

      let viaje = referencia
        ? await Viaje.findOne({ where: { playa_id: playa.id, referencia_externa: referencia }, transaction: t })
        : null;

      const campos = {
        playa_id: playa.id,
        flujo_id: flujo.id,
        equipo_codigo: datos.equipo_codigo != null ? Number(datos.equipo_codigo) || null : null,
        fecha: datos.fecha || new Date().toISOString().slice(0, 10),
        referencia_externa: referencia,
        origen_datos: adaptador,
        importacion_id: importacion.id
      };

      let creado = false;
      if (viaje) {
        await viaje.update(campos, { transaction: t });
      } else {
        viaje = await Viaje.create({ ...campos, uuid: crypto.randomUUID() }, { transaction: t });
        creado = true;
      }

      const existentes = await Unidad.findAll({ where: { viaje_id: viaje.id }, transaction: t });
      const porVin = new Map(existentes.map((u) => [u.vin, u]));
      const vistos = new Set();

      let agregadas = 0;
      let actualizadas = 0;

      for (const [i, u] of unidades.entries()) {
        const vin = String(u.vin || '').trim().toUpperCase();
        if (!vin) { avisos.push(`unidad ${i + 1}: sin VIN, se omite`); continue; }
        if (vistos.has(vin)) { avisos.push(`VIN ${vin} repetido en el envio, se omite la repeticion`); continue; }
        vistos.add(vin);

        const modelo = await porNombre(Modelo, u.modelo, t);
        if (u.modelo && !modelo) avisos.push(`VIN ${vin}: modelo '${u.modelo}' no esta en el catalogo`);

        const destino = await porNombre(Destino, u.destino, t);
        if (u.destino && !destino) avisos.push(`VIN ${vin}: destino '${u.destino}' no esta en el catalogo`);

        const campoUnidad = {
          modelo_id: modelo ? modelo.id : null,
          katashiki: u.katashiki || null,
          secuencia: u.secuencia != null ? Number(u.secuencia) || null : null,
          orden_bajada: u.orden_bajada != null ? Number(u.orden_bajada) || null : null,
          destino_id: destino ? destino.id : null,
          so: u.so || null,
          linea_txt: u.linea_txt || null
        };

        const previa = porVin.get(vin);
        if (previa) {
          await previa.update(campoUnidad, { transaction: t });
          actualizadas++;
        } else {
          await Unidad.create({ ...campoUnidad, viaje_id: viaje.id, vin }, { transaction: t });
          agregadas++;
        }
      }

      // Unidades que el origen ya no manda.
      let quitadas = 0;
      for (const [vin, u] of porVin) {
        if (vistos.has(vin)) continue;
        const conInspeccion = await u.countInspecciones({ transaction: t });
        if (conInspeccion > 0) {
          avisos.push(`VIN ${vin} ya no viene en el envio pero tiene ${conInspeccion} inspeccion(es): se conserva`);
          continue;
        }
        await u.destroy({ transaction: t });
        quitadas++;
      }

      return { viaje, creado, agregadas, actualizadas, quitadas };
    });

    await importacion.update({
      estado: 'ok',
      error: avisos.length ? avisos.join('\n') : null
    });

    return { ...resultado, avisos, importacion_id: importacion.id };
  } catch (err) {
    await importacion.update({ estado: 'error', error: err.message + (err.detalle ? ` (${err.detalle})` : '') });
    throw err;
  }
}

module.exports = { registrarViaje };
