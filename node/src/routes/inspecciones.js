'use strict';

const express = require('express');
const { requiereUsuario } = require('../helpers/auth');
const ctrl = require('../controllers/inspecciones');

const router = express.Router();

router.use(requiereUsuario);

// Alta (idempotente por uuid: la cola offline reintenta)
router.post('/', ctrl.crear);

// Patrulla del dia: solo NG
/**
 * Los NG de hoy.
 *
 * **La PWA ya no lo usa.** Desde el front nuevo, Tablero y Hoy salen de una
 * sola llamada a `GET /` con `?desde=`, que ademas trae los OK. Se mantiene
 * porque es la consulta que va a querer un panel de escritorio y porque
 * `verificar.sh` la ejercita, pero no lo tomes como carga viva: si vas a
 * cambiar el comportamiento del dia, el que manda es el otro.
 */
router.get('/hoy', ctrl.delDia);

// Historial completo. ?equipo=3595 para el historico de un camion,
// ?resultado=NG|OK, ?desde=, ?hasta=, ?limite=, ?offset=
router.get('/', ctrl.historial);

// Resumen de un camion
router.get('/equipo/:codigo', ctrl.resumenEquipo);

module.exports = router;
