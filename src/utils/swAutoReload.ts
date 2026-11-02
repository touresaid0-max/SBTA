/**
 * Shows a new version of the app without any action from the user.
 *
 * The service worker keeps the app's files for offline use: the page opened is the version
 * already on the device, and the new one is only downloaded in the background. Without this,
 * a tab stayed on the old version until it was reloaded (sometimes twice), so fixes deployed
 * on the server did not appear at the counters.
 *
 * As soon as a new version takes over, the page is reloaded.
 */

// How often an open tab asks the server whether a new version exists
const UPDATE_CHECK_MS = 15 * 60 * 1000;

export function setupServiceWorkerAutoReload(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  // No controller yet means a first install: nothing older is being shown
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  // Browsers only look for a new version when a page is opened: a counter tab left open all
  // day would never see one. Check regularly and whenever the tab comes back to the front.
  const checkForUpdate = () => {
    if (!navigator.onLine) return;
    void navigator.serviceWorker.getRegistration().then(reg => reg?.update()).catch(() => undefined);
  };
  window.setInterval(checkForUpdate, UPDATE_CHECK_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate();
  });
}
