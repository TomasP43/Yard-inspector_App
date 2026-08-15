'use strict';

const { Op } = require('sequelize');
const {
  sequelize,
  Inspeccion,
  InspeccionFoto,
  DesvioCatalogo,
  Equipo,
  Usuario,
  Responsable,
  TipoDesvio,
  Demora,
  Controlador,
  EstadoControl
} = require('../database/models');
const fotoService = require('../services/fotoService');
const desvioService = require('../services/desvioService');

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const INCLUDES = [
  { model: Usuario, as: 'auditor', attributes: ['id', 'email', 'nombre'] },
  { model: Responsable, as: 'responsable', attributes: ['id', 'nombre'] },
  { model: Equipo, as: 'equipo', attributes: ['id', 'codigo'] },
  { model: TipoDesvio, as: 'tipo', attributes: ['id', 'nombre'] },
  { model: Demora, as: 'demora', attributes: ['id', 'nombre'] },
  { model: Controlador, as: 'controlador', attributes: ['id', 'nombre'] },
  { model: EstadoControl, as: 'estadoControl', attributes: ['id', 'nombre'] },
  { model: DesvioCatalogo, as: 'desvios', attributes: ['id', 'nombre'], through: { attributes: [] } },
  { model: InspeccionFoto, as: 'fotos', attributes: ['id', 'orden', 'ruta', 'orientacion'] }
];

function error(status, code) {
  const e = new Error(code);
  e.status = status;
  e.code = code;
  return e;
}

/**
 * Alta de inspeccion.
 *
 * Es **idempotente por uuid**: la PWA reintenta la cola cuando recupera senal y
 * un mismo envio puede llegar mas de una vez (respuesta perdida, timeout, red
 * que se corta justo despues del INSERT). Reintentar devuelve 200 con el
 * registro que ya existe, nunca un error: si devolviera 409 el cliente no
 * sabria si puede sacarlo de la cola.
 */
async function crear(req, res, next) {
  const rutasGuardadas = [];
  try {
    const b = req.body || {};

    if (!RE_UUID.test(b.uuid || '')) throw error(400, 'uuid_invalido');

    const yaExiste = await Inspeccion.findOne({
      where: { uuid: b.uuid },
      include: INCLUDES
    });
    if (yaExiste) {
      return res.status(200).json({ inspeccion: yaExiste, duplicada: true });
    }

    const esNG = b.resultado === 'NG';
    if (b.resultado !== 'OK' && !esNG) throw error(400, 'resultado_invalido');
    if (!b.responsable_id) throw error(400, 'responsable_requerido');

    const registradoEn = b.registrado_en ? new Date(b.registrado_en) : new Date();
    if (Number.isNaN(registradoEn.getTime())) throw error(400, 'registrado_en_invalido');

    // El equipo llega como codigo (el numero que ve el inspector), no como id.
    let equipoId = null;
    if (b.equipo_codigo !== undefined && b.equipo_codigo !== null && b.equipo_codigo !== '') {
      const codigo = Number(b.equipo_codigo);
      if (!Number.isInteger(codigo) || codigo <= 0) throw error(400, 'equipo_invalido');
      const [equipo] = await Equipo.findOrCreate({
        where: { codigo },
        defaults: { codigo }
      });
      equipoId = equipo.id;
    }

    let desvioIds = [];
    // Desvios que el inspector escribio porque no estaban en la lista. Vienen
    // como texto y no como id porque pueden haberse cargado sin conexion, sin
    // forma de consultar el catalogo. Se resuelven recien al sincronizar.
    const nuevos = (Array.isArray(b.desvios_nuevos) ? b.desvios_nuevos : [])
      .map((s) => String(s || '').replace(/\s+/g, ' ').trim())
      .filter((s) => s.length >= 3)
      .slice(0, 5);

    if (esNG) {
      if (!b.tipo_desvio_id) throw error(400, 'tipo_desvio_requerido');
      desvioIds = [...new Set((b.desvio_ids || []).map(Number).filter(Boolean))];
      if (desvioIds.length === 0 && nuevos.length === 0) throw error(400, 'desvio_requerido');

      const encontrados = await DesvioCatalogo.findAll({ where: { id: desvioIds } });
      if (encontrados.length !== desvioIds.length) throw error(400, 'desvio_inexistente');

      // "Otro" no tenia donde explicar que era: en el historico se perdieron
      // 71 casos. Ahora el detalle es obligatorio para esos desvios.
      const exigeDetalle = encontrados.some((d) => d.requiere_detalle);
      if (exigeDetalle && !(b.detalle || '').trim()) throw error(400, 'detalle_requerido');
    }

    // Las fotos se escriben ANTES de abrir la transaccion porque el filesystem
    // no participa del rollback. Si la transaccion falla, se borran a mano.
    const fotos = [];
    const entradas = Array.isArray(b.fotos) ? b.fotos.slice(0, 3) : [];
    for (let i = 0; i < entradas.length; i++) {
      const item = entradas[i];
      const guardada = await fotoService.guardar(item.data || item, {
        uuid: b.uuid,
        orden: i + 1
      });
      if (guardada) {
        rutasGuardadas.push(guardada.ruta);
        fotos.push({
          orden: i + 1,
          ruta: guardada.ruta,
          orientacion: item.orientacion || 'libre',
          bytes: guardada.bytes
        });
      }
    }

    let rutaChecklist = null;
    if (b.foto_checklist) {
      const guardada = await fotoService.guardar(b.foto_checklist, {
        uuid: b.uuid,
        orden: 0
      });
      if (guardada) {
        rutasGuardadas.push(guardada.ruta);
        rutaChecklist = guardada.ruta;
      }
    }

    const creada = await sequelize.transaction(async (t) => {
      const insp = await Inspeccion.create(
        {
          uuid: b.uuid,
          registrado_en: registradoEn,
          auditor_id: req.usuario.id,
          responsable_id: b.responsable_id,
          equipo_id: equipoId,
          resultado: b.resultado,
          // El CHECK de la tabla exige tipo NULL cuando es OK.
          tipo_desvio_id: esNG ? b.tipo_desvio_id : null,
          demora_id: esNG ? b.demora_id || null : null,
          detalle: esNG ? (b.detalle || '').trim() || null : null,
          controlador_id: b.controlador_id || null,
          estado_control_id: b.estado_control_id || null,
          foto_checklist: rutaChecklist
        },
        { transaction: t }
      );

      // Los desvios escritos a mano se resuelven acá, dentro de la misma
      // transaccion: si la inspeccion falla no queda un desvio nuevo suelto
      // en el catalogo sin ninguna inspeccion que lo use.
      const ids = [...desvioIds];
      for (const texto of nuevos) {
        const id = await desvioService.resolverOCrear(texto, req.usuario.id, t);
        if (id && !ids.includes(id)) ids.push(id);
      }

      if (ids.length) {
        await insp.setDesvios(ids, { transaction: t });
      }
      if (fotos.length) {
        await InspeccionFoto.bulkCreate(
          fotos.map((f) => ({ ...f, inspeccion_id: insp.id })),
          { transaction: t }
        );
      }
      return insp;
    });

    const completa = await Inspeccion.findByPk(creada.id, { include: INCLUDES });
    return res.status(201).json({ inspeccion: completa, duplicada: false });
  } catch (err) {
    // Carrera: dos reintentos del mismo uuid entrando a la vez. El unique lo
    // corta y devolvemos el que gano, igual que en el chequeo de arriba.
    if (err.name === 'SequelizeUniqueConstraintError') {
      await fotoService.borrar(rutasGuardadas);
      const existente = await Inspeccion.findOne({
        where: { uuid: req.body.uuid },
        include: INCLUDES
      });
      if (existente) return res.status(200).json({ inspeccion: existente, duplicada: true });
    }
    await fotoService.borrar(rutasGuardadas);
    if (err.status) return res.status(err.status).json({ error: err.code || err.message });
    return next(err);
  }
}

/** Patrulla del dia: solo los NG, igual que la vista de AppSheet. */
async function delDia(req, res, next) {
  try {
    const desde = new Date();
    desde.setHours(0, 0, 0, 0);
    const hasta = new Date(desde);
    hasta.setDate(hasta.getDate() + 1);

    const filas = await Inspeccion.findAll({
      where: {
        resultado: 'NG',
        registrado_en: { [Op.gte]: desde, [Op.lt]: hasta }
      },
      include: INCLUDES,
      order: [['registrado_en', 'DESC']]
    });
    res.json({ inspecciones: filas });
  } catch (err) {
    next(err);
  }
}

/**
 * Historial completo, con filtros opcionales.
 * `equipo` es el caso principal: todo el historico de un camion.
 */
async function historial(req, res, next) {
  try {
    const limite = Math.min(Number(req.query.limite) || 100, 500);
    const offset = Number(req.query.offset) || 0;

    const where = {};
    if (req.query.resultado === 'OK' || req.query.resultado === 'NG') {
      where.resultado = req.query.resultado;
    }
    if (req.query.desde || req.query.hasta) {
      where.registrado_en = {};
      if (req.query.desde) where.registrado_en[Op.gte] = new Date(req.query.desde);
      if (req.query.hasta) where.registrado_en[Op.lte] = new Date(req.query.hasta);
    }

    const include = INCLUDES.map((i) => ({ ...i }));
    if (req.query.equipo) {
      const codigo = Number(req.query.equipo);
      if (!Number.isInteger(codigo)) return res.status(400).json({ error: 'equipo_invalido' });
      const idx = include.findIndex((i) => i.as === 'equipo');
      include[idx] = { ...include[idx], where: { codigo }, required: true };
    }

    const { rows, count } = await Inspeccion.findAndCountAll({
      where,
      include,
      order: [['registrado_en', 'DESC']],
      limit: limite,
      offset,
      distinct: true
    });

    res.json({ inspecciones: rows, total: count, limite, offset });
  } catch (err) {
    next(err);
  }
}

/** Resumen por camion: cuantas patrullas, cuantos NG, ultimo desvio. */
async function resumenEquipo(req, res, next) {
  try {
    const codigo = Number(req.params.codigo);
    if (!Number.isInteger(codigo)) return res.status(400).json({ error: 'equipo_invalido' });

    const equipo = await Equipo.findOne({ where: { codigo } });
    if (!equipo) return res.status(404).json({ error: 'equipo_inexistente' });

    const [total, ng, ultima] = await Promise.all([
      Inspeccion.count({ where: { equipo_id: equipo.id } }),
      Inspeccion.count({ where: { equipo_id: equipo.id, resultado: 'NG' } }),
      Inspeccion.findOne({
        where: { equipo_id: equipo.id },
        include: INCLUDES,
        order: [['registrado_en', 'DESC']]
      })
    ]);

    res.json({ equipo: { id: equipo.id, codigo: equipo.codigo }, total, ng, ok: total - ng, ultima });
  } catch (err) {
    next(err);
  }
}

module.exports = { crear, delDia, historial, resumenEquipo };
