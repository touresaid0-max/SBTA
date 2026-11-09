/**
 * New versions of the app: shown to the user, loaded when they choose.
 *
 * The service worker keeps the app's files for offline use: the page opened is the version
 * already on the device, and a new one is downloaded in the background. It then waits: the
 * « Nouvelle version disponible » banner (AppUpdateBanner) tells the user, who loads it when
 * nothing is in progress. Before, it was activated at once and the page reloaded by itself,
 * sometimes in the middle of a sale.
 *
 * - Checked when the app is opened, every 15 min and when the tab comes back to the front; a
 *   version already waiting is shown as soon as the page opens (a plain reload does not load it:
 *   the browser keeps the running version while a tab uses it).
 * - Loaded from another tab: this one still runs the old version, the banner asks to reload it.
 * - All the app's tabs closed, then opened again: the browser loads the new version by itself.
 * Unsent sales and operations are kept on the device (IndexedDB): reloading does not lose them.
 */

export type AppUpdateState = 'none' | 'available' | 'loaded-elsewhere';

// How often an open tab asks the server whether a new version exists
const UPDATE_CHECK_MS = 15 * 60 * 1000;
// The app's own service worker (the login and TPE pages have their own, not handled here)
const APP_SCOPE = '/';

let state: AppUpdateState = 'none';
const listeners = new Set<() => void>();
let applying = false;

function setState(next: AppUpdateState): void {
  if (state === next) return;
  state = next;
  listeners.forEach(l => l());
}

export function getAppUpdateState(): AppUpdateState {
  return state;
}

export function subscribeAppUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Loads the new version (button of the banner): activates it, then reloads the page. */
export async function applyAppUpdate(): Promise<void> {
  if (applying) return;
  applying = true;
  const reload = () => window.location.reload();
  const reg = await navigator.serviceWorker?.getRegistration(APP_SCOPE).catch(() => undefined);
  const waiting = reg?.waiting;
  if (!waiting) { reload(); return; } // already active (loaded from another tab)
  waiting.addEventListener('statechange', () => {
    if (waiting.state === 'activated') reload();
  });
  waiting.postMessage({ type: 'SKIP_WAITING' });
  // Never stuck on « Chargement… »: reloaded anyway (the banner shows again if it still waits)
  window.setTimeout(reload, 10_000);
}

function isAppWorker(worker: ServiceWorker | null): boolean {
  if (!worker) return false;
  try { return new URL(worker.scriptURL).pathname === '/sw.js'; } catch { return false; }
}

export function setupAppUpdates(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  // No controller yet means a first install: nothing older is being shown
  const hadController = !!navigator.serviceWorker.controller;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (applying || !hadController || !isAppWorker(navigator.serviceWorker.controller)) return;
    // Loaded from another tab: this page runs the old version, whose files are gone
    setState('loaded-elsewhere');
  });

  let watched: ServiceWorkerRegistration | null = null;
  const watch = (reg: ServiceWorkerRegistration | undefined) => {
    if (!reg || watched === reg) return;
    watched = reg;
    const offer = () => {
      if (!reg.waiting || !navigator.serviceWorker.controller) return;
      setState('available');
    };
    // Already waiting (found during an earlier visit): shown at once
    offer();
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') offer();
      });
    });
  };

  void navigator.serviceWorker.getRegistration(APP_SCOPE).then(watch).catch(() => undefined);
  // First visit: the registration is made after the page loaded
  void navigator.serviceWorker.ready
    .then(() => navigator.serviceWorker.getRegistration(APP_SCOPE))
    .then(watch)
    .catch(() => undefined);

  // Browsers only look for a new version when a page is opened: a counter tab left open all
  // day would never see one. Check regularly and whenever the tab comes back to the front.
  const checkForUpdate = () => {
    if (!navigator.onLine) return;
    void navigator.serviceWorker.getRegistration(APP_SCOPE).then(reg => reg?.update()).catch(() => undefined);
  };
  window.setInterval(checkForUpdate, UPDATE_CHECK_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate();
  });
}
