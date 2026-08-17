'use strict';

const crypto = require('crypto');
const express = require('express');
const { requiereUsuario } = require('../helpers/auth');
const { registrarViaje } = require('../services/ingesta');

const router = express.Router();

/**
 * Autenticacion para el sistema de solicitudes.
 *
 * Es servidor a servidor: no hay sesion de ttfa ni cookie, asi que va con un
 * token compartido. Dos decisiones que importan:
 *
 *  - Si INGESTA_TOKEN no esta configurado, el endpoint responde 503 y NO
 *    queda abierto. Un endpoint que escribe viajes no puede quedar sin
 *    proteccion por un olvido en el .env.
 *  - La comparacion es de tiempo constante: comparar con === filtra el
 *    prefijo correcto por diferencia de tiempo.
 */
function requiereToken(req, res, next) {
  const esperado = process.env.INGESTA_TOKEN;
  if (!esperado) {
    console.error('[ingesta] INGESTA_TOKEN sin configurar: endpoint deshabilitado');
    return res.status(503).json({ error: 'ingesta_no_configurada' });
  }

  const cabecera = req.get('authorization') || '';
  const recibido = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : '';

  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  // timingSafeEqual exige mismo largo, y esa comparacion previa ya filtra
  // por longitud: se compara contra un hash para no perder esa propiedad.
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  if (!crypto.timingSafeEqual(ha, hb)) {
    return res.status(401).json({ error: 'token_invalido' });
  }
  next();
}

/**
 * Alta de un viaje con sus unidades desde el sistema de solicitudes.
 *
 * Contrato de entrada:
 *
 *   POST /api/unidades/ingesta
 *   Authorization: Bearer <INGESTA_TOKEN>
 *   {
 *     "playa": "ZAR",                     // codigo de playa (SOR, IND, ZAR)
 *     "flujo": "TASA - TCL",              // nombre del flujo, o su id
 *     "referencia_externa": "SOL-000123", // id de la solicitud en su sistema
 *     "fecha": "2026-08-16",
 *     "equipo_codigo": 3595,
 *     "unidades": [
 *       {
 *         "vin": "8AJBA3CD4T8003610",
 *         "modelo": "Hilux",
 *         "katashiki": "GUN126L-DGTHXG",
 *         "secuencia": 1,
 *         "orden_bajada": 3,
 *         "destino": "TCL",
 *         "so": "..."
 *       }
 *     ]
 *   }
 *
 * Reenviar la misma `referencia_externa` actualiza el viaje en vez de
 * duplicarlo, asi que reintentar es seguro.
 *
 * Devuelve 200 con `avisos`: modelos o destinos que no estan en el catalogo,
 * VIN repetidos, unidades conservadas porque ya tenian inspecciones. No son
 * errores, pero alguien las tiene que ver.
 */
router.post('/ingesta', requiereToken, async (req, res, next) => {
  try {
    const r = await registrarViaje(req.body || {}, {
      adaptador: 'api',
      payloadCrudo: JSON.stringify(req.body || {})
    });
    res.status(r.creado ? 201 : 200).json({
      viaje_id: r.viaje.id,
      uuid: r.viaje.uuid,
      creado: r.creado,
      unidades: { agregadas: r.agregadas, actualizadas: r.actualizadas, quitadas: r.quitadas },
      avisos: r.avisos,
      importacion_id: r.importacion_id
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, detalle: err.detalle });
    next(err);
  }
});

/**
 * Alta manual desde el panel, para playas que todavia no estan integradas o
 * para corregir a mano. Mismo motor, distinta puerta: aca si hay sesion.
 */
router.post('/viajes', requiereUsuario, async (req, res, next) => {
  try {
    const r = await registrarViaje(req.body || {}, {
      adaptador: 'manual',
      usuarioId: req.usuario.id,
      payloadCrudo: JSON.stringify(req.body || {})
    });
    res.status(r.creado ? 201 : 200).json({
      viaje_id: r.viaje.id,
      uuid: r.viaje.uuid,
      creado: r.creado,
      unidades: { agregadas: r.agregadas, actualizadas: r.actualizadas, quitadas: r.quitadas },
      avisos: r.avisos
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, detalle: err.detalle });
    next(err);
  }
});

module.exports = router;
