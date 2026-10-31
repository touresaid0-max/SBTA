import { lazy, Suspense, type ComponentType } from 'react';

const RELOAD_KEY = 'sbta_chunk_reload';

function readFlag(): boolean {
  try { return sessionStorage.getItem(RELOAD_KEY) === '1'; } catch { return true; }
}

function writeFlag(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(RELOAD_KEY, '1');
    else sessionStorage.removeItem(RELOAD_KEY);
  } catch { /* storage unavailable: no automatic reload */ }
}

// After a redeploy, page files get new names: a tab opened before it may ask for a file that
// no longer exists. Reload once to fetch the new version instead of showing a blank page.
function loadWithReload(factory: () => Promise<{ default: ComponentType<any> }>) {
  return factory()
    .then(module => { writeFlag(false); return module; })
    .catch(error => {
      if (!readFlag()) {
        writeFlag(true);
        window.location.reload();
        return new Promise<never>(() => {});
      }
      throw error;
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
  const Page = lazy(() => loadWithReload(factory));
  return function LazyPage(props: Record<string, unknown>) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Page {...props} />
      </Suspense>
    );
  };
}
