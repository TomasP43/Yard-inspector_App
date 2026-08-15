'use strict';

const { DesvioCatalogo } = require('../database/models');

/**
 * Alta y deduplicacion de desvios cargados por el inspector.
 *
 * El problema que evita: en AppSheet habia 78 grafias para 71 conceptos
 * ('Oxido en batea' / 'Óxido en batea', 'Sunchos' / 'Zunchos'). Si dejamos
 * que cualquiera escriba texto libre sin control, en un ano el catalogo es
 * inservible para sacar metricas.
 */

/**
 * Minusculas, sin acentos, sin puntuacion, espacios colapsados.
 * El rango de diacriticos se escribe con escapes unicode y no con los
 * caracteres en si: son combinantes invisibles, y cualquier viaje entre
 * editores o encodings los rompe sin que se note.
 */
function normalizar(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Distancia de edicion, con una sola fila en memoria. */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let fila = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let anterior = fila[0];
    fila[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = fila[j];
      fila[j] = Math.min(
        fila[j] + 1,
        fila[j - 1] + 1,
        anterior + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      anterior = tmp;
    }
  }
  return fila[b.length];
}

/**
 * Similitud 0..1 combinando dos senales, porque cada una falla sola:
 *
 *  - Edicion: cazaria 'Oxido'/'Óxido' pero le da poca nota a
 *    'Suciedad en batea' vs 'Suciedad avanzada en batea', que son casi lo mismo.
 *  - Palabras en comun: cazaria ese caso pero no distingue un typo suelto.
 *
 * Se pondera mas la de palabras: en este dominio los desvios se parecen por
 * compartir terminos ('batea', 'matafuego', 'lona'), no por tener letras
 * parecidas.
 */
function similitud(a, b) {
  const x = normalizar(a);
  const y = normalizar(b);
  if (!x || !y) return 0;
  if (x === y) return 1;

  const dist = levenshtein(x, y);
  const porEdicion = 1 - dist / Math.max(x.length, y.length);

  const tx = new Set(x.split(' '));
  const ty = new Set(y.split(' '));
  let comunes = 0;
  tx.forEach((t) => { if (ty.has(t)) comunes++; });
  const porPalabras = comunes / new Set([...tx, ...ty]).size;

  return 0.4 * porEdicion + 0.6 * porPalabras;
}

const UMBRAL_SUGERENCIA = 0.5;

/**
 * Candidatos parecidos, del mas al menos.
 * Es informativo: decide el inspector, no el algoritmo.
 */
async function similares(nombre, limite = 5) {
  const activos = await DesvioCatalogo.findAll({
    where: { activo: true },
    attributes: ['id', 'nombre', 'tipo_desvio_id', 'usos_historicos']
  });

  return activos
    .map((d) => ({
      id: d.id,
      nombre: d.nombre,
      tipo_desvio_id: d.tipo_desvio_id,
      usos_historicos: d.usos_historicos,
      puntaje: similitud(nombre, d.nombre)
    }))
    .filter((d) => d.puntaje >= UMBRAL_SUGERENCIA)
    .sort((a, b) => b.puntaje - a.puntaje)
    .slice(0, limite);
}

/**
 * Devuelve el id del desvio para un texto libre, creandolo si hace falta.
 *
 * Solo reutiliza en coincidencia EXACTA ya normalizada. Un parecido alto no
 * alcanza para fusionar sin preguntar: 'Matafuego vencido' y 'Matafuego
 * descargado' comparten casi todo y son cosas distintas. Ante la duda se crea
 * y se marca revisar=1, porque un duplicado visible se arregla despues y un
 * desvio absorbido dentro de otro no se recupera nunca.
 *
 * Se usa tambien al sincronizar la cola offline, donde no hay nadie a quien
 * preguntarle.
 */
async function resolverOCrear(nombre, usuarioId, transaction) {
  const limpio = String(nombre || '').replace(/\s+/g, ' ').trim();
  if (!limpio) return null;
  if (limpio.length > 160) {
    const e = new Error('desvio_demasiado_largo');
    e.status = 400;
    throw e;
  }

  // La colacion utf8mb4_0900_ai_ci ignora acentos y mayusculas, asi que esto
  // ya encuentra 'Oxido en batea' buscando 'Óxido en batea'.
  const existente = await DesvioCatalogo.findOne({
    where: { nombre: limpio },
    transaction
  });
  if (existente) return existente.id;

  try {
    const creado = await DesvioCatalogo.create(
      {
        nombre: limpio,
        tipo_desvio_id: null,
        activo: true,
        usos_historicos: 0,
        creado_por_usuario_id: usuarioId || null,
        revisar: 1
      },
      { transaction }
    );
    return creado.id;
  } catch (err) {
    // Dos inspectores sincronizando el mismo desvio nuevo a la vez: gana uno
    // y el otro se cuelga del que quedo.
    if (err.name === 'SequelizeUniqueConstraintError') {
      const otro = await DesvioCatalogo.findOne({ where: { nombre: limpio }, transaction });
      if (otro) return otro.id;
    }
    throw err;
  }
}

module.exports = { normalizar, similitud, similares, resolverOCrear, UMBRAL_SUGERENCIA };
