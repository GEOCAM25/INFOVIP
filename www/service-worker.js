/* ============================================================
   INFOVIP · Service Worker
   Estrategia: App-shell cacheado (offline-first) + auto-actualización.
   El número de versión se genera en cada build (ver build/stamp).
   Cambiar CACHE_VERSION invalida el caché anterior y dispara update.
   ============================================================ */
const CACHE_VERSION = 'infovip-v1';           // sustituido por CI en cada release
const CACHE_NAME = `infovip-cache-${CACHE_VERSION}`;

// Núcleo que debe existir sí o sí para arrancar sin red.
const CORE_ASSETS = [
  './',
  './index.html',
  './redirect.html',
  './manifest.webmanifest',
  './version.json',
  './css/theme.css',
  './css/components.css',
  './assets/icons/logo.png',
  './assets/sounds/bip.wav',
  './assets/sounds/sirena.wav',
  './assets/sounds/campana.wav',
  './assets/sounds/alerta.wav',
  './assets/sounds/timbre.wav',
  './data/sellos.sample.json',
  './js/app.js',
  './js/core/db.js',
  './js/core/store.js',
  './js/core/router.js',
  './js/core/tabs.js',
  './js/core/ui.js',
  './js/core/update.js',
  './js/core/native.js',
  './js/core/crypto.js',
  './js/core/audioTools.js',
  './js/core/msauth.js',
  './js/core/graph.js',
  './js/core/permissions.js',
  './js/core/bggeo.js',
  './js/core/appupdate.js',
  './js/core/weather.js',
  './js/core/deviceauth.js',
  './js/core/lockscreen.js',
  './js/core/geofence.js',
  './js/core/mappicker.js',
  './vendor/leaflet.js',
  './vendor/leaflet.css',
  './js/modules/sellos.js',
  './js/modules/rendicion.js',
  './js/modules/automatizaciones.js',
  './js/modules/engine.js',
  './js/modules/planos.js',
  './js/modules/se.js',
  './js/modules/subestaciones.js',
  './js/modules/inicio.js',
  './js/modules/config.js',
  './vendor/pdf.min.mjs',
  './vendor/pdf.worker.min.mjs'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // addAll falla si algún recurso 404: cacheamos de forma tolerante.
    await Promise.all(CORE_ASSETS.map(async (url) => {
      try { await cache.add(new Request(url, { cache: 'reload' })); } catch (_) {}
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
    // Avisar a las pestañas de que hay versión nueva activa.
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((c) => c.postMessage({ type: 'SW_ACTIVATED', version: CACHE_VERSION }));
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Estrategia de fetch:
//  - Navegación (HTML): network-first con fallback a caché (para recibir updates).
//  - APIs externas (clima): network-first, sin cachear en el SW (el módulo guarda su copia).
//  - Resto (assets locales): stale-while-revalidate.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // No interceptar peticiones a otros orígenes salvo CDNs de vendor cacheados.
  const sameOrigin = url.origin === self.location.origin;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (_) {
        return (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  if (!sameOrigin) return; // dejar pasar clima/CDN sin tocar

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    const network = fetch(req).then((res) => {
      if (res && res.status === 200) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
