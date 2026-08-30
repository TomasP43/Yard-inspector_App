/* eslint-env serviceworker */
'use strict';

/**
 * Service worker de la app. Scope /yard/, que es toda la app.
 *
 * Subir VERSION invalida el cache viejo en el proximo deploy.
 *
 * v6: la app vuelve a la raiz. Durante un tiempo esto fue un menu con dos
 * modulos colgando de /yard/patrullas/ y /yard/unidades/, cada uno con su
 * service worker y su cache. Los caches de esa etapa se limpian abajo.
 * v7: front nuevo sobre el design system TTFA (iconos.js, zonas.js).
 * v8: los tokens salen a css/tokens.css, compartidos con el tablero.
 * v9: se fueron dos desvios del catalogo (oxido avanzado y oxido y suciedad).
 *     Este es el caso que obliga a subir la version y no alcanzaba con dejar
 *     que el stale-while-revalidate se ponga al dia solo: zonas.js esta en el
 *     SHELL, asi que el inspector seguia viendo las opciones viejas hasta la
 *     SEGUNDA carga. Un catalogo desactualizado en la pantalla de carga no es
 *     un detalle estetico -- se cargan desvios que ya no existen.
 * v10: se fue tambien 'suciedad avanzada en batea'. **Todo cambio en un archivo
 *     del SHELL necesita subir esto**, porque el navegador solo reinstala el
 *     service worker si el archivo cambio -- y si VERSION no se mueve, no
 *     cambio. zonas.js es del SHELL.
 * v11: se fue el datalist del numero de equipo (index.html y app.js).
 * v12: se fue el paso "Tipo de control" del formulario.
 * v13: el tablero de gerencia sale del cache -- ver el fetch de abajo.
 * v14: el cajon lateral queda con un solo item.
 * v15: se fue el boton "No esta en la lista".
 *     similitud.js SE QUEDA aunque el formulario ya no cree desvios: zonas.js
 *     lo usa para normalizar y enganchar el catalogo con el mapa de zonas.
 *     Sacarlo tiraba zonas.js entero y con el la app -- probado a los golpes.
 * v34: entra el modulo de precarga (precarga.js). escaner.js e iconos.js
 *     tambien cambiaron, asi que la version tiene que subir igual: el
 *     navegador solo reinstala el SW si el archivo sw.js cambio.
 * v35: entra el esquema del vehiculo (vehiculo.js). Los ocho dibujos NO van al
 *     SHELL --son 1,1 MB-- sino cache-first, como uploads.
 * v36: entra la hoja de la unidad para imprimir (hoja.js + hoja.css).
 */
const VERSION = 'v36';
const CACHE = `yard-${VERSION}`;

// El app shell tiene que alcanzar para abrir la app sin conexion. Rutas
// relativas a proposito: en produccion cuelga de /yard/ y en dev de /.
//
// Las tipografias de Google no van aca: son de otro origen y el fetch de abajo
// no las toca. Sin senal la app cae en la pila del sistema, que es justo lo que
// se busca — esperar una fuente no puede demorar una carga en la playa.
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './css/tokens.css',
  './css/app.css',
  './css/hoja.css',
  './js/iconos.js',
  './js/similitud.js',
  './js/turnos.js',
  './js/db.js',
  './js/zonas.js',
  './js/camera.js',
  './js/escaner.js',
  './js/sync.js',
  './js/bahias.js',
  './js/vehiculo.js',
  './js/hoja.js',
  './js/precarga.js',
  './js/app.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      // Todo cache 'yard-*' que no sea el actual sobra. Al ser este el unico
      // service worker de la app, la regla no necesita conocer los nombres
      // viejos: se limpia sola tambien la proxima vez.
      .then((ks) => Promise.all(
        ks.filter((k) => k !== CACHE && k.startsWith('yard-')).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Nunca tocar nada que no sea GET: los POST de la cola tienen que llegar al
  // servidor o fallar de verdad. Si el SW los "resolviera" desde cache, la app
  // creeria que sincronizo algo que nunca se guardo.
  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // La API va siempre a la red. Los datos cacheados los maneja la app en
  // IndexedDB, que sabe cuales son suyos y cuales estan pendientes.
  if (url.pathname.includes('/api/')) {
    e.respondWith(fetch(req));
    return;
  }

  // El tablero de gerencia queda FUERA del cache.
  //
  // Es una pantalla de escritorio que necesita red igual -- sin datos no
  // muestra nada -- asi que cachearla no compra offline y si cuesta: sus
  // archivos no estan en el SHELL, entonces subir VERSION no los renueva y
  // cada cambio se veia una carga tarde. Paso tres veces en un mismo dia
  // (el menu lateral, el catalogo de desvios, el layout del impacto) y cada
  // vez costo un rato entender que el codigo estaba bien.
  if (url.pathname.includes('/gerencia/')) return;

  // Los esquemas de vehiculo: cache-first, como uploads, y NO en el SHELL.
  //
  // Son ocho modelos de ~140 KB, o sea 1,1 MB. Meterlos en el shell hace que la
  // instalacion --que a veces pasa por 3G-- pague de una todos los modelos, y el
  // esquema es una ayuda para revisar, no el registro: el dato son los daños de
  // la lista. Se cachea el que se usa, y despues de la primera unidad de cada
  // modelo ya esta. Ver D-013: nada que sea una mejora va en el camino critico.
  if (url.pathname.includes('/img/vehiculos/')) {
    e.respondWith(
      caches.open(CACHE).then((c) =>
        c.match(req).then((hit) =>
          hit || fetch(req).then((r) => {
            if (r.ok) c.put(req, r.clone());
            return r;
          })
        )
      )
    );
    return;
  }

  // Los carteles de bahia, por lo mismo: es una pagina de escritorio que se
  // abre para imprimir y necesita red para traer los tokens. Cachearla no
  // compra nada y la deja una carga tarde en cada cambio.
  if (url.pathname.includes('/carteles/')) return;

  // Fotos ya subidas: cache-first, son inmutables.
  if (url.pathname.includes('/uploads/')) {
    e.respondWith(
      caches.open(CACHE).then((c) =>
        c.match(req).then((hit) =>
          hit || fetch(req).then((r) => {
            if (r.ok) c.put(req, r.clone());
            return r;
          })
        )
      )
    );
    return;
  }

  // App shell: se sirve del cache y se refresca por atras.
  e.respondWith(
    caches.open(CACHE).then((c) =>
      c.match(req).then((hit) => {
        const red = fetch(req)
          .then((r) => {
            if (r.ok) c.put(req, r.clone());
            return r;
          })
          .catch(() => hit);
        return hit || red;
      })
    )
  );
});

// La app avisa cuando hay algo en la cola para que se reintente al volver
// la conexion, incluso si el inspector cerro la pantalla.
self.addEventListener('sync', (e) => {
  if (e.tag === 'yard-sync') {
    e.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true }).then((cs) => {
        cs.forEach((c) => c.postMessage({ tipo: 'sincronizar' }));
      })
    );
  }
});
