'use strict';

const crypto = require('crypto');
const { Op } = require('sequelize');
const {
  sequelize,
  Usuario, Playa, Destino, Flujo, Etapa, Modelo,
  Parte, TipoDano, DetalleDano, Traduccion,
  Viaje, Unidad, InspeccionUnidad, InspeccionDano
} = require('../database/models');
const fotoService = require('../services/fotoService');
const catalogoService = require('../services/catalogoService');

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function error(status, code, detalle) {
  const e = new Error(code);
  e.status = status;
  e.detalle = detalle;
  return e;
}

// ------------------------------------------------------------------ catalogos

/**
 * Todo lo que el inspector necesita para trabajar sin conexion, en una sola
 * respuesta: si fueran varios endpoints podria quedar con la mitad cacheada y
 * un formulario a medio construir justo cuando se corta la senal.
 *
 * `?idioma=pt` superpone las traducciones sobre el nombre canonico. Lo que no
 * este traducido cae al castellano en vez de aparecer vacio.
 */
async function catalogos(req, res, next) {
  try {
    const idioma = String(req.query.idioma || 'es').slice(0, 2).toLowerCase();
    const activo = { activo: true };

    const [partes, tipos, detalles, flujos, playas, destinos, modelos] = await Promise.all([
      Parte.findAll({
        where: activo,
        // Lo mas usado primero: cuatro partes concentran el 55% de los danos y
        // el procedimiento da 2 minutos por vehiculo.
        order: [['usos_historicos', 'DESC'], ['orden', 'ASC']]
      }),
      TipoDano.findAll({ where: activo, order: [['usos_historicos', 'DESC'], ['nombre', 'ASC']] }),
      DetalleDano.findAll({ where: activo, order: [['usos_historicos', 'DESC'], ['nombre', 'ASC']] }),
      Flujo.findAll({
        where: activo,
        include: [
          { model: Etapa, as: 'etapas', where: { activo: true }, required: false },
          { model: Playa, as: 'playaOrigen', attributes: ['id', 'codigo', 'nombre'] },
          { model: Destino, as: 'destino', attributes: ['id', 'nombre'] }
        ],
        order: [['orden', 'ASC'], [{ model: Etapa, as: 'etapas' }, 'orden', 'ASC']]
      }),
      Playa.findAll({ where: activo, order: [['nombre', 'ASC']] }),
      Destino.findAll({ where: activo, order: [['nombre', 'ASC']] }),
      Modelo.findAll({ where: activo, order: [['nombre', 'ASC']] })
    ]);

    let payload = {
      idioma,
      partes: partes.map((p) => ({
        id: p.id, nombre: p.nombre, grupo: p.grupo,
        cantidad_cuadrantes: p.cantidad_cuadrantes, usos: p.usos_historicos
      })),
      tipos_dano: tipos.map((t) => ({ id: t.id, nombre: t.nombre, usos: t.usos_historicos })),
      detalles_dano: detalles.map((d) => ({ id: d.id, nombre: d.nombre, usos: d.usos_historicos })),
      flujos, playas, destinos, modelos
    };

    if (idioma !== 'es') payload = await traducir(payload, idioma);

    const etag = crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex');
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.set('ETag', etag);
    res.json(payload);
  } catch (err) {
    next(err);
  }
}

/** Superpone las traducciones del idioma pedido sobre los nombres canonicos. */
async function traducir(payload, idioma) {
  const filas = await Traduccion.findAll({ where: { idioma, campo: 'nombre' } });
  if (!filas.length) return payload;

  const mapa = new Map(filas.map((t) => [`${t.tabla}:${t.fila_id}`, t.texto]));
  const aplicar = (tabla, lista) =>
    (lista || []).map((x) => {
      const t = mapa.get(`${tabla}:${x.id}`);
      // El plano se arma con toJSON porque las instancias de Sequelize no se
      // dejan extender con spread sin perder los datos.
      const plano = typeof x.toJSON === 'function' ? x.toJSON() : { ...x };
      return t ? { ...plano, nombre: t } : plano;
    });

  return {
    ...payload,
    partes: aplicar('parte', payload.partes),
    tipos_dano: aplicar('tipo_dano', payload.tipos_dano),
    detalles_dano: aplicar('detalle_dano', payload.detalles_dano),
    destinos: aplicar('destino', payload.destinos),
    flujos: (payload.flujos || []).map((f) => {
      const plano = f.toJSON ? f.toJSON() : f;
      return { ...plano, etapas: aplicar('etapa', plano.etapas) };
    })
  };
}

// --------------------------------------------------------------------- viajes

/**
 * Viajes que le tienen que aparecer al inspector.
 *
 * El viaje lo crea la oficina; el inspector solo lo recibe. Por eso el filtro
 * natural es playa + fecha + abiertos, y no algo que el inspector elija.
 */
async function listarViajes(req, res, next) {
  try {
    const where = { estado: req.query.estado || 'abierto' };

    if (req.query.playa) {
      const playa = await Playa.findOne({ where: { codigo: String(req.query.playa).trim() } });
      if (!playa) return res.status(404).json({ error: 'playa_desconocida' });
      where.playa_id = playa.id;
    }
    if (req.query.fecha) where.fecha = req.query.fecha;
    if (req.query.desde || req.query.hasta) {
      where.fecha = {};
      if (req.query.desde) where.fecha[Op.gte] = req.query.desde;
      if (req.query.hasta) where.fecha[Op.lte] = req.query.hasta;
    }

    const viajes = await Viaje.findAll({
      where,
      include: [
        { model: Playa, as: 'playa', attributes: ['id', 'codigo', 'nombre'] },
        {
          model: Flujo, as: 'flujo', attributes: ['id', 'nombre'],
          include: [{ model: Etapa, as: 'etapas', where: { activo: true }, required: false, attributes: ['id', 'nombre', 'orden'] }]
        }
      ],
      order: [['fecha', 'DESC'], ['id', 'DESC']],
      limit: Math.min(Number(req.query.limite) || 50, 200)
    });

    // Avance por etapa, para que el inspector vea de un vistazo que le falta.
    const conAvance = await Promise.all(viajes.map(async (v) => {
      const total = await Unidad.count({ where: { viaje_id: v.id } });
      const etapas = (v.flujo && v.flujo.etapas) || [];
      const avance = await Promise.all(etapas.map(async (e) => ({
        etapa_id: e.id,
        nombre: e.nombre,
        orden: e.orden,
        hechas: await InspeccionUnidad.count({
          where: { etapa_id: e.id },
          include: [{ model: Unidad, as: 'unidad', where: { viaje_id: v.id }, attributes: [] }]
        })
      })));
      return { ...v.toJSON(), unidades_total: total, avance };
    }));

    res.json({ viajes: conAvance });
  } catch (err) {
    next(err);
  }
}

/** Un viaje con sus unidades y, por cada una, que etapas ya tienen inspeccion. */
async function verViaje(req, res, next) {
  try {
    const viaje = await Viaje.findOne({
      where: RE_UUID.test(req.params.id) ? { uuid: req.params.id } : { id: Number(req.params.id) || 0 },
      include: [
        { model: Playa, as: 'playa', attributes: ['id', 'codigo', 'nombre'] },
        {
          model: Flujo, as: 'flujo', attributes: ['id', 'nombre'],
          include: [{ model: Etapa, as: 'etapas', where: { activo: true }, required: false }]
        },
        {
          model: Unidad, as: 'unidades',
          include: [
            { model: Modelo, as: 'modelo', attributes: ['id', 'nombre'] },
            { model: Destino, as: 'destino', attributes: ['id', 'nombre'] },
            {
              model: InspeccionUnidad, as: 'inspecciones',
              attributes: ['id', 'uuid', 'etapa_id', 'resultado', 'registrado_en'],
              include: [{ model: InspeccionDano, as: 'danos', attributes: ['id'] }]
            }
          ]
        }
      ],
      order: [
        [{ model: Flujo, as: 'flujo' }, { model: Etapa, as: 'etapas' }, 'orden', 'ASC'],
        [{ model: Unidad, as: 'unidades' }, 'orden_bajada', 'ASC']
      ]
    });

    if (!viaje) return res.status(404).json({ error: 'viaje_inexistente' });
    res.json({ viaje });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------- inspeccion

/**
 * Alta de inspeccion de una unidad en una etapa.
 *
 * **Idempotente por uuid**, igual que en patrullas: la cola offline reintenta
 * y un mismo envio puede llegar mas de una vez. Reintentar devuelve 200 con lo
 * que ya existe, nunca un 409: con un 409 el cliente no sabria si puede
 * sacarlo de la cola.
 */
async function crearInspeccion(req, res, next) {
  const rutasGuardadas = [];
  try {
    const b = req.body || {};
    if (!RE_UUID.test(b.uuid || '')) throw error(400, 'uuid_invalido');

    const yaExiste = await InspeccionUnidad.findOne({ where: { uuid: b.uuid }, include: [{ model: InspeccionDano, as: 'danos' }] });
    if (yaExiste) return res.status(200).json({ inspeccion: yaExiste, duplicada: true });

    const unidad = await Unidad.findByPk(b.unidad_id);
    if (!unidad) throw error(400, 'unidad_inexistente');

    const etapa = await Etapa.findByPk(b.etapa_id);
    if (!etapa) throw error(400, 'etapa_inexistente');

    const conDanos = b.resultado === 'CON_DANOS';
    if (b.resultado !== 'OK' && !conDanos) throw error(400, 'resultado_invalido');
    if (!conDanos && !etapa.permite_sin_danos) throw error(400, 'etapa_exige_danos');

    const danos = Array.isArray(b.danos) ? b.danos : [];
    if (conDanos && danos.length === 0) throw error(400, 'dano_requerido');
    if (!conDanos && danos.length > 0) throw error(400, 'ok_no_admite_danos');

    // Se valida el cuadrante aca ademas del trigger: el trigger protege la
    // base, pero un 400 con el motivo le sirve mas al inspector que un 500.
    const partesUsadas = new Map();
    for (const [i, d] of danos.entries()) {
      if (!d.parte_id) throw error(400, 'parte_requerida', `dano ${i + 1}`);
      let parte = partesUsadas.get(d.parte_id);
      if (!parte) {
        parte = await Parte.findByPk(d.parte_id);
        if (!parte) throw error(400, 'parte_inexistente', `dano ${i + 1}`);
        partesUsadas.set(d.parte_id, parte);
      }
      const cuadrante = Number(d.cuadrante || 0);
      if (!Number.isInteger(cuadrante) || cuadrante < 0 || cuadrante > parte.cantidad_cuadrantes) {
        throw error(400, 'cuadrante_invalido',
          `dano ${i + 1}: '${parte.nombre}' tiene ${parte.cantidad_cuadrantes} cuadrante(s), se envio ${cuadrante}`);
      }
      if (!d.tipo_dano_id && !d.tipo_nuevo) throw error(400, 'tipo_dano_requerido', `dano ${i + 1}`);
      if (etapa.requiere_foto_por_dano && !d.foto) throw error(400, 'foto_requerida', `dano ${i + 1}`);
    }

    if (etapa.requiere_foto_panoramica && !b.foto_panoramica) throw error(400, 'foto_panoramica_requerida');
    if (etapa.requiere_firma_inspector && !b.firma_inspector) throw error(400, 'firma_requerida');

    // Las imagenes se escriben antes de abrir la transaccion porque el
    // filesystem no participa del rollback; si algo falla, se borran a mano.
    const guardarImagen = async (data, orden, formato) => {
      if (!data) return null;
      const g = await fotoService.guardar(data, { uuid: b.uuid, orden, formato });
      if (g) rutasGuardadas.push(g.ruta);
      return g ? g.ruta : null;
    };

    const rutaPano = await guardarImagen(b.foto_panoramica, 0, 'jpeg');
    const rutaVin = await guardarImagen(b.foto_vin, 1, 'jpeg');
    // La firma va en PNG: se dibuja sobre canvas transparente y en JPEG el
    // trazo quedaria sobre fondo negro.
    const rutaFirma = await guardarImagen(b.firma_inspector, 2, 'png');

    const fotosDanos = [];
    for (let i = 0; i < danos.length; i++) {
      fotosDanos.push(await guardarImagen(danos[i].foto, 10 + i, 'jpeg'));
    }

    const creada = await sequelize.transaction(async (t) => {
      const insp = await InspeccionUnidad.create({
        uuid: b.uuid,
        unidad_id: unidad.id,
        etapa_id: etapa.id,
        inspector_id: req.usuario.id,
        registrado_en: b.registrado_en ? new Date(b.registrado_en) : new Date(),
        resultado: b.resultado,
        foto_panoramica: rutaPano,
        foto_vin: rutaVin,
        firma_inspector: rutaFirma,
        observacion: (b.observacion || '').trim() || null
      }, { transaction: t });

      for (let i = 0; i < danos.length; i++) {
        const d = danos[i];

        // Tipo y detalle pueden venir como texto libre: el inspector los
        // escribio sin senal, cuando no habia forma de consultar el catalogo.
        // Los resuelve el servidor, dentro de la misma transaccion.
        const tipoId = d.tipo_dano_id ||
          await catalogoService.resolverOCrear(TipoDano, d.tipo_nuevo, req.usuario.id, t);
        const detalleId = d.detalle_id ||
          (d.detalle_nuevo
            ? await catalogoService.resolverOCrear(DetalleDano, d.detalle_nuevo, req.usuario.id, t)
            : null);

        await InspeccionDano.create({
          inspeccion_id: insp.id,
          orden: i + 1,
          parte_id: d.parte_id,
          cuadrante: Number(d.cuadrante || 0),
          tipo_dano_id: tipoId,
          detalle_id: detalleId,
          comentario: (d.comentario || '').trim() || null,
          foto: fotosDanos[i]
        }, { transaction: t });
      }

      return insp;
    });

    const completa = await InspeccionUnidad.findByPk(creada.id, {
      include: [{ model: InspeccionDano, as: 'danos' }]
    });
    return res.status(201).json({ inspeccion: completa, duplicada: false });
  } catch (err) {
    await fotoService.borrar(rutasGuardadas);

    // Carrera: dos reintentos del mismo uuid a la vez, o la misma unidad y
    // etapa por dos caminos. Se devuelve el que gano.
    if (err.name === 'SequelizeUniqueConstraintError') {
      const existente = await InspeccionUnidad.findOne({
        where: { uuid: req.body.uuid },
        include: [{ model: InspeccionDano, as: 'danos' }]
      });
      if (existente) return res.status(200).json({ inspeccion: existente, duplicada: true });
      return res.status(409).json({ error: 'unidad_ya_inspeccionada_en_esta_etapa' });
    }
    if (err.status) return res.status(err.status).json({ error: err.message, detalle: err.detalle });
    return next(err);
  }
}

module.exports = { catalogos, listarViajes, verViaje, crearInspeccion };
