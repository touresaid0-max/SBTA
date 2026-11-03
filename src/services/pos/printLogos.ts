// Logos printed on the tickets and bordereaux of the guichet.
//
// The print pages are written into an empty iframe. Offline, Chrome does not always serve that
// iframe's requests from the service worker: the <img src="/logo…"> failed and everything printed
// without network came out without its logo. The logos are now read once by the page itself
// (offline cache or server), kept on the device (localStorage, about 12 KB) and written into the
// print pages as data, so that nothing has to be fetched while printing.

export const PRINT_LOGOS = ['/logosbta001.JPG', '/logosbta00-1.JPG'] as const;

const STORAGE_KEY = 'sbta_print_logos';

function readStored(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

const cache = new Map<string, string>(Object.entries(readStored()));

function store(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(cache)));
  } catch { /* storage full or unavailable: the logos stay in memory for this session */ }
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

let loading: Promise<void> | null = null;

/** Reads the logos and keeps them on the device. Without network, the copy already kept stays. */
export function preloadPrintLogos(): Promise<void> {
  loading ??= (async () => {
    let changed = false;
    for (const src of PRINT_LOGOS) {
      try {
        const res = await fetch(src);
        const blob = res.ok ? await res.blob() : null;
        // A missing file can come back as the application page (text/html): never keep it
        if (!blob || !blob.type.startsWith('image/')) continue;
        const data = await toDataUrl(blob);
        if (cache.get(src) !== data) {
          cache.set(src, data);
          changed = true;
        }
      } catch { /* offline and not in the offline cache */ }
    }
    if (changed) store();
  })().finally(() => { loading = null; });
  return loading;
}

/** Address to give an image of the logo: its data when known, otherwise the file. */
export function printLogoSrc(src: string): string {
  return cache.get(src) ?? src;
}

/** Replaces the logo files of a print page by their data. */
export function withPrintLogos(html: string): string {
  let out = html;
  for (const src of PRINT_LOGOS) {
    const data = cache.get(src);
    if (data) out = out.split(`"${src}"`).join(`"${data}"`);
  }
  return out;
}

// Read as soon as a guichet screen that prints is opened
if (typeof window !== 'undefined') void preloadPrintLogos();
