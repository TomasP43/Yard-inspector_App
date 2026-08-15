'use strict';

const express = require('express');
const { requiereUsuario } = require('../helpers/auth');
const desvioService = require('../services/desvioService');
const { DesvioCatalogo, sequelize } = require('../database/models');

const router = express.Router();
router.use(requiereUsuario);

/**
 * Candidatos parecidos a un texto. Lo consulta la app antes de dejar crear un
 * desvio nuevo, para poder mostrar "esto ya existe con otro nombre".
 *
 * Sin conexion la app hace la misma comprobacion contra el catalogo cacheado
 * en IndexedDB; esta ruta es la version autoritativa.
 */
router.get('/similares', async (req, res, next) => {
  try {
    const nombre = (req.query.nombre || '').trim();
    if (nombre.length < 3) return res.json({ similares: [] });
    res.json({ similares: await desvioService.similares(nombre) });
  } catch (err) {
    next(err);
  }
});

/**
 * Alta de un desvio que el inspector no encontro en la lista.
 *
 * Con `confirmar` en false devuelve 409 y los parecidos en vez de crear: es el
 * paso donde la app le pregunta "quisiste decir alguno de estos?". Con
 * `confirmar` en true crea igual, marcado para revision.
 */
router.post('/', async (req, res, next) => {
  try {
    const nombre = String(req.body.nombre || '').replace(/\s+/g, ' ').trim();
    if (nombre.length < 3) return res.status(400).json({ error: 'nombre_muy_corto' });
    if (nombre.length > 160) return res.status(400).json({ error: 'nombre_muy_largo' });

    // Coincidencia exacta (la colacion ya ignora acentos y mayusculas): se
    // reutiliza sin preguntar nada, no hay ambiguedad posible.
    const exacto = await DesvioCatalogo.findOne({ where: { nombre } });
    if (exacto) {
      return res.status(200).json({ desvio: exacto, yaExistia: true });
    }

    if (!req.body.confirmar) {
      const similares = await desvioService.similares(nombre);
      if (similares.length) {
        return res.status(409).json({ error: 'hay_similares', similares });
      }
    }

    const id = await sequelize.transaction((t) =>
      desvioService.resolverOCrear(nombre, req.usuario.id, t)
    );
    const desvio = await DesvioCatalogo.findByPk(id);
    res.status(201).json({ desvio, yaExistia: false });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
