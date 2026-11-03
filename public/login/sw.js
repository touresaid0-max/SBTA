// v2: the old version deleted every other cache of the site on activation, including the main
// app's offline copy (the guichet then failed to start, blank page). Only its own old versions now.
const CACHE_PREFIX = 'sbta-login-static-';
const CACHE_NAME = 'sbta-login-static-v2';
const STATIC_RESOURCES = [
  '/login',
  '/logosbta.png',
  '/pwa/icon-192.png',
  '/pwa/icon-512.png',
  '/pwa/icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_RESOURCES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/login')));
    return;
  }

  if (['script', 'style', 'image', 'font'].includes(request.destination)) {
    event.respondWith(
      caches.match(request, { cacheName: CACHE_NAME }).then((cached) => cached || fetch(request).then((response) => {
        // Only real files: an error page kept here would be served instead of the file forever
        const type = response.headers.get('content-type') || '';
        if (response.ok && !(request.destination !== 'document' && type.includes('text/html'))) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      }))
    );
  }
});
