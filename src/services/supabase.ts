import { createClient } from '@supabase/supabase-js';

// Without a limit, a request on a half-dead connection (common at the stations) never ends:
// a sale or a screen of the guichet kept loading forever. The guichet pages (/guichet…) have a
// limit; the other screens keep none (long reports). The limit follows the page address: set
// from a component, it came too late for the first requests of each screen.
const GUICHET_RESPONSE_TIMEOUT_MS = 15_000;

let responseTimeoutOverride: number | null | undefined;

/** Forces the limit (tests); undefined goes back to the limit of the page. */
export function setResponseTimeout(ms: number | null | undefined): void {
  responseTimeoutOverride = ms;
}

function responseTimeoutMs(): number | null {
  if (responseTimeoutOverride !== undefined) return responseTimeoutOverride;
  const path = typeof window !== 'undefined' ? window.location?.pathname ?? '' : '';
  return path.startsWith('/guichet') ? GUICHET_RESPONSE_TIMEOUT_MS : null;
}

/**
 * Gives up when the server has not started answering within the limit. Only the wait for the
 * answer is limited, not its download: a long list on a slow connection still arrives.
 */
const fetchWithTimeout: typeof fetch = (input, init) => {
  const limit = responseTimeoutMs();
  if (!limit || init?.signal) return fetch(input, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Le serveur ne répond pas', 'TimeoutError')), limit);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
};

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
    global: {
      fetch: fetchWithTimeout,
    },
  }
);
