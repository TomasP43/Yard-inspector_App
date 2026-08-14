'use strict';

const express = require('express');
const { requiereUsuario } = require('../helpers/auth');
const ctrl = require('../controllers/inspecciones');

const router = express.Router();

router.use(requiereUsuario);

// Alta (idempotente por uuid: la cola offline reintenta)
router.post('/', ctrl.crear);

// Patrulla del dia: solo NG
router.get('/hoy', ctrl.delDia);

// Historial completo. ?equipo=3595 para el historico de un camion,
// ?resultado=NG|OK, ?desde=, ?hasta=, ?limite=, ?offset=
router.get('/', ctrl.historial);

// Resumen de un camion
router.get('/equipo/:codigo', ctrl.resumenEquipo);

module.exports = router;
