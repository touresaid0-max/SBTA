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

// Without network, any request through the client first reads the login session: once the access
// token has expired (after an hour offline), the client tries to renew it, retrying for up to
// 30 s on a network error while it holds the session lock. Every other request waited in line
// behind it — the connection checks every 15 s, the lists, the ticket printing (which reads the
// print settings): printing a ticket offline took up to 15 minutes at a station.

/**
 * Whether the server answers, without going through the login session (no lock, no renewal).
 * The stations are readable without login.
 */
export async function pingServer(timeoutMs = 10_000): Promise<boolean> {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/rest/v1/stations?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: 'no-store',
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Background renewal of the login session: stopped without network, started again when the server answers. */
export function setSessionRenewal(serverReachable: boolean): void {
  void (serverReachable ? supabase.auth.startAutoRefresh() : supabase.auth.stopAutoRefresh()).catch(() => { /* next check */ });
}
