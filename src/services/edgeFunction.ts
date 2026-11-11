import { supabase } from './supabase'

export const SESSION_EXPIRED_MESSAGE = 'Votre session a expiré : déconnectez-vous, reconnectez-vous, puis recommencez.'

export interface EdgeFunctionResult {
  ok: boolean
  status: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
}

/**
 * Calls one of the project's edge functions with the signed-in user's token.
 *
 * The page kept a token the server no longer accepted (session closed or renewed elsewhere):
 * the account creation answered « Non authentifié » (401) although the admin was still on the
 * page. On a 401 the session is renewed once and the call sent again; if the server still
 * refuses it, the error says to sign in again instead of « Non authentifié ».
 */
export async function callEdgeFunction(
  name: string,
  options: { method?: string; body?: unknown; query?: string } = {},
): Promise<EdgeFunctionResult> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}${options.query ?? ''}`

  const send = async (token: string): Promise<EdgeFunctionResult> => {
    const res = await fetch(url, {
      method: options.method ?? 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    })
    const data = await res.json().catch(() => ({ error: `Erreur (${res.status})` }))
    return { ok: res.ok, status: res.status, data }
  }

  const { data: { session } } = await supabase.auth.getSession()
  let result = await send(session?.access_token ?? '')

  if (result.status === 401) {
    const { data: refreshed } = await supabase.auth.refreshSession()
    if (refreshed.session) result = await send(refreshed.session.access_token)
    if (result.status === 401) result = { ...result, data: { ...(result.data ?? {}), error: SESSION_EXPIRED_MESSAGE } }
  }
  return result
}

/** The error text of a failed call, whatever its shape */
export function edgeErrorMessage(result: EdgeFunctionResult): string {
  const e = result.data?.error
  if (typeof e === 'string' && e) return e
  if (e?.message) return String(e.message)
  return `Erreur ${result.status}`
}
