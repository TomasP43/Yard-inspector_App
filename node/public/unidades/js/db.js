'use strict';

/**
 * IndexedDB del modulo de unidades.
 *
 * Base propia ('yard-unidades') y no la de patrullas: son dos modulos con
 * ciclos de vida distintos, y compartir base obligaria a coordinar el numero
 * de version entre los dos cada vez que uno cambia sus stores.
 *
 * Guarda tres cosas: los catalogos, los viajes descargados para trabajar sin
 * senal, y la cola de inspecciones pendientes de sincronizar.
 */
const DBU = (() => {
  const NOMBRE = 'yard-unidades';
  const VERSION = 1;
  let _db = null;

  function abrir() {
    if (_db) return Promise.resolve(_db);
    return new Promise((res, rej) => {
      const req = indexedDB.open(NOMBRE, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        if (!db.objectStoreNames.contains('viajes')) db.createObjectStore('viajes', { keyPath: 'uuid' });
        if (!db.objectStoreNames.contains('cola')) {
          const s = db.createObjectStore('cola', { keyPath: 'uuid' });
          s.createIndex('estado', 'estado');
        }
      };
      req.onsuccess = () => { _db = req.result; res(_db); };
      req.onerror = () => rej(req.error);
    });
  }

  function tx(store, modo, fn) {
    return abrir().then((db) => new Promise((res, rej) => {
      const t = db.transaction(store, modo);
      let out;
      try { out = fn(t.objectStore(store)); } catch (e) { rej(e); return; }
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    }));
  }

  return {
    guardarMeta: (k, v) => tx('meta', 'readwrite', (s) => s.put(v, k)),
    leerMeta: (k) => tx('meta', 'readonly', (s) => s.get(k)),

    // Los viajes se guardan enteros: el inspector los descarga con senal y
    // despues trabaja en el piso, donde puede no haber.
    guardarViaje: (v) => tx('viajes', 'readwrite', (s) => s.put(v)),
    leerViaje: (uuid) => tx('viajes', 'readonly', (s) => s.get(uuid)),
    leerViajes: () => tx('viajes', 'readonly', (s) => s.getAll()),

    encolar: (i) => tx('cola', 'readwrite', (s) => s.put(i)),
    leerCola: () => tx('cola', 'readonly', (s) => s.getAll()),
    borrarDeCola: (uuid) => tx('cola', 'readwrite', (s) => s.delete(uuid)),
    contarCola: () => tx('cola', 'readonly', (s) => s.count()),

    async actualizarItem(uuid, cambios) {
      const db = await abrir();
      return new Promise((res, rej) => {
        const t = db.transaction('cola', 'readwrite');
        const s = t.objectStore('cola');
        const g = s.get(uuid);
        g.onsuccess = () => { if (g.result) s.put({ ...g.result, ...cambios }); };
        t.oncomplete = () => res(true);
        t.onerror = () => rej(t.error);
      });
    }
  };
})();
