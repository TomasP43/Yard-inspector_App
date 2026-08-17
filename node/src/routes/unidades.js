'use strict';

const express = require('express');
const { requiereUsuario } = require('../helpers/auth');
const ctrl = require('../controllers/unidades');

const router = express.Router();
router.use(requiereUsuario);

// Todo lo que el inspector necesita para trabajar sin conexion, junto.
// ?idioma=es|pt|en
router.get('/catalogos', ctrl.catalogos);

// Viajes que le aparecen al inspector. El viaje lo crea la oficina.
// ?playa=ZAR&fecha=2026-08-16&estado=abierto
router.get('/viajes', ctrl.listarViajes);

// Un viaje con sus unidades y el estado de cada una por etapa
router.get('/viajes/:id', ctrl.verViaje);

// Alta de inspeccion (idempotente por uuid: la cola offline reintenta)
router.post('/inspecciones', ctrl.crearInspeccion);

module.exports = router;
