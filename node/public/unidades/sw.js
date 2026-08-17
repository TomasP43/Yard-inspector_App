/* eslint-env serviceworker */
'use strict';

// Scope /yard/unidades/. Cache propio del modulo: se despliega y se invalida
// aparte del de patrullas.
// v2: mismo fix del helper de IndexedDB que en patrullas.
// v3: pantalla de carga manual de viajes.
const VERSION = 'v3';
const CACHE = `yard-unidades-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/unidades.css',
  './js/db.js',
  './js/sync.js',
  './js/app.js',
  '../css/app.css',
  '../js/similitud.js',
  '../js/camera.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith('yard-unidades-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Nunca tocar nada que no sea GET: los POST de la cola tienen que llegar al
  // servidor o fallar de verdad. Si el SW los resolviera desde cache, la app
  // creeria que sincronizo algo que nunca se guardo.
  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes('/api/')) { e.respondWith(fetch(req)); return; }

  if (url.pathname.includes('/uploads/')) {
    e.respondWith(caches.open(CACHE).then((c) =>
      c.match(req).then((hit) => hit || fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }))));
    return;
  }

  e.respondWith(caches.open(CACHE).then((c) =>
    c.match(req).then((hit) => {
      const red = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || red;
    })));
});

self.addEventListener('sync', (e) => {
  if (e.tag === 'yard-unidades-sync') {
    e.waitUntil(self.clients.matchAll({ includeUncontrolled: true })
      .then((cs) => cs.forEach((c) => c.postMessage({ tipo: 'sincronizar' }))));
  }
});
