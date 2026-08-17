'use strict';

const { DesvioCatalogo } = require('../database/models');
const catalogo = require('./catalogoService');

/**
 * Desvios de patrullas.
 *
 * La logica de normalizacion, similitud y alta con revision vive en
 * catalogoService: es la misma que necesitan los tipos y detalles de dano del
 * modulo de unidades. Aca solo queda atarla a este catalogo.
 *
 * El espejo en el cliente esta en public/js/similitud.js, que hace la misma
 * cuenta para poder sugerir sin conexion. Si cambia la formula de un lado,
 * cambiala del otro.
 */

const similares = (nombre, limite) => catalogo.similares(DesvioCatalogo, nombre, limite);

// tipo_desvio_id en null: el tipo lo elige el inspector por inspeccion, y un
// desvio nuevo todavia no tiene un dominante historico del cual sacarlo.
const resolverOCrear = (nombre, usuarioId, transaction) =>
  catalogo.resolverOCrear(DesvioCatalogo, nombre, usuarioId, transaction, { tipo_desvio_id: null });

module.exports = {
  normalizar: catalogo.normalizar,
  similitud: catalogo.similitud,
  similares,
  resolverOCrear,
  UMBRAL_SUGERENCIA: catalogo.UMBRAL
};
