import { createClient } from '@supabase/supabase-js';

// Without a limit, a request on a half-dead connection (common at the stations) never ends:
// a sale or a screen of the guichet kept loading forever. The guichet sets a limit while it is
// open (ConnectionProvider); the other screens keep no limit (long reports).
let responseTimeoutMs: number | null = null;

/** Maximum wait for the server to start answering a request, or null for no limit. */
export function setResponseTimeout(ms: number | null): void {
  responseTimeoutMs = ms;
}

/**
 * Gives up when the server has not started answering within the limit. Only the wait for the
 * answer is limited, not its download: a long list on a slow connection still arrives.
 */
const fetchWithTimeout: typeof fetch = (input, init) => {
  const limit = responseTimeoutMs;
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
