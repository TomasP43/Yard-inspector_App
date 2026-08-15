/* eslint-env serviceworker */
'use strict';

// Subir esta version invalida el cache viejo en el proximo deploy.
const VERSION = 'v1';
const CACHE = `yard-${VERSION}`;

// El app shell tiene que alcanzar para abrir la app sin conexion. Rutas
// relativas a proposito: en produccion la app cuelga de /yard/ y en dev de /.
const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/db.js',
  './js/similitud.js',
  './js/camera.js',
  './js/sync.js',
  './js/app.js',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
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
