'use strict';

/**
 * Espejo en el cliente de src/services/desvioService.js.
 *
 * Esta duplicado a proposito: el inspector agrega desvios en la playa, sin
 * senal, asi que la comprobacion de "esto ya existe con otro nombre" tiene que
 * correr contra el catalogo cacheado en IndexedDB. Preguntarle al servidor no
 * es una opcion en el momento en que hace falta.
 *
 * El servidor tiene la copia autoritativa y vuelve a chequear al sincronizar.
 * Si tocas la formula de un lado, tocala del otro: si divergen, la app sugiere
 * cosas distintas de las que el servidor termina haciendo.
 */
const Similitud = (() => {

  function normalizar(s) {
    return String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')   // diacriticos combinantes
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

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

  /** 0..1. Pesa mas las palabras en comun que las letras: ver desvioService.js */
  function puntaje(a, b) {
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

  const UMBRAL = 0.5;

  /** Candidatos del catalogo parecidos a `nombre`, del mas al menos. */
  function similares(nombre, catalogo, limite) {
    return (catalogo || [])
      .map((d) => ({ ...d, puntaje: puntaje(nombre, d.nombre) }))
      .filter((d) => d.puntaje >= UMBRAL)
      .sort((a, b) => b.puntaje - a.puntaje)
      .slice(0, limite || 4);
  }

  /** Coincidencia exacta ya normalizada: no hay ambiguedad, se reutiliza. */
  function exacto(nombre, catalogo) {
    const n = normalizar(nombre);
    return (catalogo || []).find((d) => normalizar(d.nombre) === n) || null;
  }

  return { normalizar, puntaje, similares, exacto, UMBRAL };
})();
