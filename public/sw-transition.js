// Loaded by the app's service worker (vite.config.ts, workbox.importScripts).
//
// Versions are now loaded from the « Nouvelle version disponible » banner: a new service worker
// waits for the user's click. The devices still running a version WITHOUT that banner would never
// see the button and stay on their old version until every tab of the app is closed. So the first
// version with the banner activates by itself, as before (the old page reloads on its own), and
// leaves a marker: the next versions find it and wait for the click.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.has('sbta-update-banner-v1').then((hasBanner) => {
      if (hasBanner) return undefined;
      return caches.open('sbta-update-banner-v1').then(() => self.skipWaiting());
    }).catch(() => undefined)
  );
});
