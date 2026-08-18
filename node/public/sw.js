/* eslint-env serviceworker */
'use strict';

/**
 * Service worker del menu de entrada.
 *
 * Scope /yard/, que abarca a los dos modulos. No es un problema: cuando hay
 * varios service workers, gana el de scope mas especifico, asi que
 * /yard/patrullas/ y /yard/unidades/ los sigue manejando el suyo. Este solo
 * atiende el menu.
 *
 * v4: antes este archivo era el de patrullas, que vivia en la raiz. Al mudarse
 * el modulo, esta version se instala sobre la anterior y limpia sus caches.
 */
const VERSION = 'v5';
const CACHE = `yard-inicio-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './css/inicio.css',
  './js/inicio.js',
  './icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      // Se borra tambien 'yard-vN', el cache de cuando patrullas vivia aca.
      .then((ks) => Promise.all(
        ks.filter((k) => k !== CACHE && (k.startsWith('yard-inicio-') || /^yard-v\d+$/.test(k)))
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // Los contadores del menu van siempre a la red: un numero cacheado que dice
  // "3 viajes abiertos" cuando ya no los hay es peor que un guion.
  if (url.pathname.includes('/api/')) { e.respondWith(fetch(req)); return; }

  // Solo se atiende lo del menu. Lo de los modulos lo maneja su propio SW.
  if (url.pathname.includes('/patrullas/') || url.pathname.includes('/unidades/')) return;

  e.respondWith(caches.open(CACHE).then((c) =>
    c.match(req).then((hit) => {
      const red = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || red;
    })));
});
