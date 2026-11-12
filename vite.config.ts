import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // A new version waits until the user loads it from the « Nouvelle version » banner
      // (AppUpdateBanner, src/utils/appUpdate.ts): activated on its own, it reloaded the page in
      // the middle of a sale.
      registerType: 'prompt',
      // Images kept for offline use: the logos the app and the printed tickets use
      includeAssets: ['logosbta.png', 'logosbta001.JPG', 'logosbta00-1.JPG', 'logo_sbta02.JPG', 'LOGO_SBTA_-1.png', 'logo-sbta-bordereau-v2.png'],
      manifest: {
        name: 'Guichet Eafribus',
        short_name: 'Guichet',
        description: 'Terminal de vente de tickets Eafribus',
        theme_color: '#0B7439',
        background_color: '#FFFFFF',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/guichet/connexion',
        scope: '/guichet',
        icons: [
          { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Code, styles and app icons only: the screenshots in public/ (3 MB of PNG) slowed down the
        // first offline download, during which the guichet cannot work without network
        globPatterns: ['**/*.{js,css,html,ico,svg,woff2}', 'pwa/*.png'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // The SPA shell: it must be a precached file, otherwise the service worker fails
        // to start (non-precached-url) and the guichet pages cannot open offline.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/auth/, /^\/realtime/, /^\/login/],
        // The new version waits: it activates on the SKIP_WAITING message sent by the banner,
        // then takes over the open tabs
        skipWaiting: false,
        // Except once, on the devices still running a version without the banner (see the file)
        importScripts: ['/sw-transition.js'],
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      },
      injectRegister: 'script',
    }),
  ],
  assetsInclude: ['**/*.JPG'],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
