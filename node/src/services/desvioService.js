'use strict';

const { DesvioCatalogo } = require('../database/models');

/**
 * Alta y deduplicacion del catalogo de desvios, que el inspector puede
 * extender desde la app.
 *
 * El problema: en AppSheet habia 78 grafias para 71 desvios, con
 * 'Oxido' / 'Óxido' conviviendo como si fueran cosas distintas.
 *
 * La defensa tiene dos capas y hacen cosas distintas a proposito:
 *
 *   1. Duplicado exacto: lo resuelve la base. La tabla usa la colacion
 *      utf8mb4_0900_ai_ci, insensible a acentos y mayusculas, asi que el
 *      UNIQUE sobre `nombre` ya hace chocar 'Oxido' con 'Óxido'.
 *   2. Parecido pero no igual: decide una persona. Se sugieren candidatos y,
 *      si igual se crea, queda con revisar=1.
 *
 * **Nunca se fusiona por parecido.** 'Matafuego vencido' y 'Matafuego
 * descargado' comparten casi todo y son cosas distintas. Un duplicado visible
 * se arregla despues; un concepto absorbido dentro de otro no se recupera.
 *
 * El espejo en el cliente esta en public/js/similitud.js, que hace la misma
 * cuenta para poder sugerir sin conexion. Si cambia la formula de un lado,
 * cambiala del otro.
 */

/** = desvio_catalogo.nombre en migrations/001_initial.sql */
const MAX_NOMBRE = 160;

/**
 * Minusculas, sin acentos, sin puntuacion, espacios colapsados.
 *
 * `\p{Diacritic}` en vez del rango [U+0300-U+036F] escrito a mano: hace lo
 * mismo pero deja el archivo 100% ASCII. Los combinantes son invisibles y
 * cualquier viaje entre editores o encodings los rompe sin que se note.
 */
function normalizar(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
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
 *  - Edicion: caza 'Oxido'/'Óxido' pero le da poca nota a
 *    'Suciedad en batea' vs 'Suciedad avanzada en batea', que son casi lo mismo.
 *  - Palabras en comun: caza ese caso pero no distingue un typo suelto.
 *
 * Se pondera mas la de palabras: en este dominio las cosas se parecen por
 * compartir terminos ('batea', 'matafuego', 'puerta'), no por tener letras
 * parecidas.
 */
function similitud(a, b) {
  const x = normalizar(a);
  const y = normalizar(b);
  if (!x || !y) return 0;
  if (x === y) return 1;

  const porEdicion = 1 - levenshtein(x, y) / Math.max(x.length, y.length);

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
 * Es informativo: decide la persona, no el algoritmo.
 */
async function similares(nombre, limite = 5) {
  const activos = await DesvioCatalogo.findAll({ where: { activo: true } });

  return activos
    .map((d) => ({
      id: d.id,
      nombre: d.nombre,
      usos_historicos: d.usos_historicos,
      puntaje: similitud(nombre, d.nombre)
    }))
    .filter((d) => d.puntaje >= UMBRAL_SUGERENCIA)
    .sort((a, b) => b.puntaje - a.puntaje)
    .slice(0, limite);
}

/**
 * Devuelve el id para un texto libre, creandolo si hace falta.
 *
 * Solo reutiliza en coincidencia exacta ya normalizada. Se usa tambien al
 * sincronizar la cola offline, donde no hay nadie a quien preguntarle.
 */
async function resolverOCrear(nombre, usuarioId, transaction) {
  const limpio = String(nombre || '').replace(/\s+/g, ' ').trim();
  if (!limpio) return null;

  if (limpio.length > MAX_NOMBRE) {
    const e = new Error('nombre_demasiado_largo');
    e.status = 400;
    throw e;
  }

  // La colacion ignora acentos y mayusculas: esto ya encuentra 'Oxido en
  // batea' buscando 'Óxido en batea'.
  const existente = await DesvioCatalogo.findOne({ where: { nombre: limpio }, transaction });
  if (existente) return existente.id;

  try {
    const creado = await DesvioCatalogo.create(
      {
        nombre: limpio,
        // El tipo lo elige el inspector por inspeccion, y un desvio nuevo
        // todavia no tiene un dominante historico del cual sacarlo.
        tipo_desvio_id: null,
        activo: true,
        usos_historicos: 0,
        creado_por_usuario_id: usuarioId || null,
        revisar: true
      },
      { transaction }
    );
    return creado.id;
  } catch (err) {
    // Dos usuarios sincronizando el mismo nombre nuevo a la vez: gana uno y el
    // otro se cuelga del que quedo.
    if (err.name === 'SequelizeUniqueConstraintError') {
      const otro = await DesvioCatalogo.findOne({ where: { nombre: limpio }, transaction });
      if (otro) return otro.id;
    }
    throw err;
  }
}

module.exports = { normalizar, similitud, similares, resolverOCrear, UMBRAL_SUGERENCIA };
