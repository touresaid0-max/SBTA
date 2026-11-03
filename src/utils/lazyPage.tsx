import { lazy, Suspense, type ComponentType } from 'react';

// Shared with the start-up safety net in index.html: one automatic recovery per tab session
const RECOVER_KEY = 'sbta_boot_recover';

function alreadyRecovered(): boolean {
  try { return sessionStorage.getItem(RECOVER_KEY) === '1'; } catch { return true; }
}

/** Defined in index.html: drops the stored copy of the app and reloads it from the server. */
function recover(): void {
  const fn = (window as unknown as { __sbtaRecover?: (force?: boolean) => void }).__sbtaRecover;
  if (fn) fn(false);
  else window.location.reload();
}

function UpdateNeeded() {
  return (
    <div className="min-h-[50vh] flex items-center justify-center p-4">
      <div className="max-w-sm w-full rounded-xl p-6 text-center" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        <p className="font-bold text-lg mb-2" style={{ color: 'var(--primary)' }}>Mise à jour de l’application</p>
        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
          Cette page n’a pas pu être chargée. Rechargez pour obtenir la nouvelle version (connexion Internet nécessaire).
        </p>
        <button
          type="button"
          onClick={() => {
            try { sessionStorage.removeItem(RECOVER_KEY); } catch { /* ignore */ }
            const fn = (window as unknown as { __sbtaRecover?: (force?: boolean) => void }).__sbtaRecover;
            if (fn) fn(true); else window.location.reload();
          }}
          className="px-4 py-2 rounded-lg text-sm font-bold text-white"
          style={{ backgroundColor: 'var(--primary)' }}
        >
          Recharger
        </button>
      </div>
    </div>
  );
}

// After a redeploy, page files get new names: a tab opened before it may ask for a file that no
// longer exists. A plain reload went through the service worker and got the same old version
// again, leaving a blank page: the stored copy is dropped first (once), then the page reloaded.
// Without network, or if it fails again, a message is shown instead of a blank page.
function loadWithRecovery(factory: () => Promise<{ default: ComponentType<any> }>) {
  return factory().catch(() => {
    if (navigator.onLine && !alreadyRecovered()) {
      recover();
      return new Promise<never>(() => {});
    }
    return { default: UpdateNeeded };
  });
}

function PageLoader() {
  return (
    <div className="min-h-[50vh] flex items-center justify-center">
      <div className="w-10 h-10 border-4 rounded-full animate-spin"
           style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
    </div>
  );
}

/**
 * Page loaded on demand: its code is downloaded the first time it is opened, so each user
 * only loads the pages they use. The loader stays inside the current layout (menus remain).
 */
export function lazyPage(factory: () => Promise<{ default: ComponentType<any> }>) {
  const Page = lazy(() => loadWithRecovery(factory));
  return function LazyPage(props: Record<string, unknown>) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Page {...props} />
      </Suspense>
    );
  };
}
