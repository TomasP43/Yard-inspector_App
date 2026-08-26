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

  /**
   * Cuanto se espera a que IndexedDB conteste antes de dar la base por perdida.
   *
   * `indexedDB.open` puede **no disparar ningun evento, nunca**: ni onsuccess,
   * ni onerror, ni onblocked. Pasa con un `deleteDatabase` pendiente, en iOS en
   * modo privado, y con la cuota agotada. Sin este tope, la primera linea de
   * cargarCatalogos() se queda esperando para siempre y la app **no arranca**:
   * sin catalogos, sin pantallas pintadas, sin ningun mensaje. Pantalla muerta.
   *
   * Tres segundos es de sobra para abrir una base local; si no contesto en ese
   * tiempo no va a contestar.
   */
  const ESPERA_APERTURA = 3000;

  // Si la base no abrio una vez, no va a abrir: modo privado, cuota agotada o
  // un borrado trabado no se arreglan solos. Se recuerda el fallo para no
  // pagar los 3 segundos de espera en cada guardado -- el inspector carga
  // treinta camiones por jornada y tres segundos por camion son un minuto y
  // medio mirando un boton.
  let _fallo = null;

  function abrir() {
    if (_db) return Promise.resolve(_db);
    if (_fallo) return Promise.reject(_fallo);
    return new Promise((res, rej) => {
      let resuelto = false;
      const terminar = (fn, arg) => {
        if (resuelto) return;
        resuelto = true;
        if (fn === rej) _fallo = arg;
        fn(arg);
      };

      const reloj = setTimeout(
        () => terminar(rej, new Error('indexeddb_no_responde')),
        ESPERA_APERTURA
      );

      let req;
      // El propio open() tira en algunos navegadores con el almacenamiento
      // bloqueado, antes de devolver el request.
      try { req = indexedDB.open(NOMBRE, VERSION); }
      catch (e) { clearTimeout(reloj); terminar(rej, e); return; }

      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        if (!db.objectStoreNames.contains('cola')) {
          const s = db.createObjectStore('cola', { keyPath: 'uuid' });
          s.createIndex('estado', 'estado');
        }
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
      };
      req.onsuccess = () => { clearTimeout(reloj); _db = req.result; terminar(res, _db); };
      req.onerror = () => { clearTimeout(reloj); terminar(rej, req.error); };
      // Otra pestana tiene la base abierta con otra version: no va a destrabarse
      // sola, mejor fallar rapido y seguir contra la red.
      req.onblocked = () => { clearTimeout(reloj); terminar(rej, new Error('indexeddb_bloqueada')); };
    });
  }

  /** true si la base contesta. Lo usa la app para avisar que no hay offline. */
  const disponible = () => abrir().then(() => true, () => false);

  function tx(store, modo, fn) {
    return abrir().then((db) => new Promise((res, rej) => {
      const t = db.transaction(store, modo);
      const s = t.objectStore(store);
      let out;
      try { out = fn(s); } catch (e) { rej(e); return; }
      // Si fn devolvio un IDBRequest, el valor es SIEMPRE su .result, incluso
      // cuando es undefined porque la clave no existe.
      //
      // Antes esto era `out.result !== undefined ? out.result : out`, que ante
      // una clave inexistente devolvia el propio IDBRequest. Como es truthy,
      // `if (CAT) pintarCatalogos()` pasaba, `CAT.responsables` era undefined y
      // el .map() tiraba: la app quedaba muerta antes de la primera sync,
      // justamente en el navegador que nunca la habia abierto.
      t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    }));
  }

  return {
    disponible,

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
