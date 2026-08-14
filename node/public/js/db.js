'use strict';

/**
 * IndexedDB: catalogos, cola de pendientes y cache de consultas.
 *
 * Las fotos se guardan como Blob, no como base64. Un base64 ocupa ~33% mas y
 * la cuota de IndexedDB en un celular no es infinita: con tres fotos por
 * inspeccion y varias inspecciones encoladas la diferencia se nota.
 */
const DB = (() => {
  const NOMBRE = 'yard';
  const VERSION = 1;
  let _db = null;

  function abrir() {
    if (_db) return Promise.resolve(_db);
    return new Promise((res, rej) => {
      const req = indexedDB.open(NOMBRE, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        if (!db.objectStoreNames.contains('cola')) {
          const s = db.createObjectStore('cola', { keyPath: 'uuid' });
          s.createIndex('estado', 'estado');
        }
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
      };
      req.onsuccess = () => { _db = req.result; res(_db); };
      req.onerror = () => rej(req.error);
    });
  }

  function tx(store, modo, fn) {
    return abrir().then((db) => new Promise((res, rej) => {
      const t = db.transaction(store, modo);
      const s = t.objectStore(store);
      let out;
      try { out = fn(s); } catch (e) { rej(e); return; }
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    }));
  }

  return {
    // --- meta / catalogos ---
    guardarMeta: (k, v) => tx('meta', 'readwrite', (s) => s.put(v, k)),
    leerMeta: (k) => tx('meta', 'readonly', (s) => s.get(k)),

    // --- cache de listados (para ver el historial sin conexion) ---
    guardarCache: (k, v) => tx('cache', 'readwrite', (s) => s.put(v, k)),
    leerCache: (k) => tx('cache', 'readonly', (s) => s.get(k)),

    // --- cola de pendientes ---
    encolar: (item) => tx('cola', 'readwrite', (s) => s.put(item)),
    leerCola: () => tx('cola', 'readonly', (s) => s.getAll()),
    borrarDeCola: (uuid) => tx('cola', 'readwrite', (s) => s.delete(uuid)),
    contarCola: () => tx('cola', 'readonly', (s) => s.count()),

    async actualizarItem(uuid, cambios) {
      const db = await abrir();
      return new Promise((res, rej) => {
        const t = db.transaction('cola', 'readwrite');
        const s = t.objectStore('cola');
        const g = s.get(uuid);
        g.onsuccess = () => {
          if (!g.result) { res(null); return; }
          s.put({ ...g.result, ...cambios });
        };
        t.oncomplete = () => res(true);
        t.onerror = () => rej(t.error);
      });
    }
  };
})();
