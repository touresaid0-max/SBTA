import { db, type SessionRecord } from './db';
import { supabase } from '@/services/supabase';
import { useAuthStore } from '@/store/authStore';
import { isOnline } from './syncEngine';
import { clearPersonalDataOnLogout } from '@/services/offline/dataRetention';
import { saveOfflineLogin, checkOfflineLogin, forgetOfflineLogin, OFFLINE_LOGIN_MAX_AGE_DAYS } from './offlineCredentials';

export interface POSLoginResult {
  success: boolean;
  error?: string;
  session?: SessionRecord;
  offline?: boolean;
}

/**
 * Earlier versions kept an unsalted SHA-256 of the password in the session table, and still
 * accepted it to sign in offline (audit M8): such a hash is checked against a dictionary in no
 * time. It is no longer read, and erased wherever it is still stored.
 */
async function eraseLegacyPasswordHashes(): Promise<void> {
  try {
    const legacy = (await db.session.toArray()).filter(s => s.password_hash);
    for (const s of legacy) {
      const { password_hash: _ph, ...rest } = s;
      void _ph;
      await db.session.put(rest as SessionRecord);
    }
  } catch { /* tried again at the next read of the session */ }
}

// The server did not answer (no network, timeout, server down) — as opposed to a refused password
function isNetworkError(err: any): boolean {
  if (!err) return false;
  if (err.name === 'AuthRetryableFetchError' || err instanceof TypeError) return true;
  if (Number(err.status ?? 0) >= 500) return true;
  return /failed to fetch|network|load failed|timeout|délai/i.test(String(err.message ?? ''));
}

function isRejectedPassword(err: any): boolean {
  return err?.name === 'AuthApiError' && /invalid login credentials/i.test(String(err.message ?? ''));
}

// A half-dead connection can leave the sign-in hanging: give up after this delay
const ONLINE_LOGIN_TIMEOUT_MS = 15_000;

function withLoginTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ONLINE_LOGIN_TIMEOUT_MS)),
  ]);
}

export async function login(email: string, password: string): Promise<POSLoginResult> {
  const online = isOnline();

  if (online) {
    try {
      await withLoginTimeout(useAuthStore.getState().login(email, password));
      const user = useAuthStore.getState().user;

      if (!user) {
        return { success: false, error: 'Profil introuvable. Contactez votre administrateur.' };
      }

      // TPE-POS authorization check for bagagistes
      if (user.role === 'bagagiste') {
        const { data: profile } = await supabase
          .from('users')
          .select('tpe_pos_enabled, tpe_mode')
          .eq('id', user.id)
          .maybeSingle();
        if (!profile?.tpe_pos_enabled) {
          return { success: false, error: 'Accès TPE-POS non autorisé. Contactez votre administrateur.' };
        }
        (user as any).tpe_pos_enabled = true;
        (user as any).tpe_mode = profile.tpe_mode ?? 'sans_guichet';
      }

      // Bagagistes: the authoritative station assignment lives in
      // station_baggage_handlers (managed in Administration → Gestion des
      // comptes utilisateurs). The users.station_id column is stale for some
      // accounts and must NOT be trusted for this role. Counters are a
      // guichetier concept and don't apply to bagagistes either.
      let resolvedStationId = user.station_id ?? '';
      let resolvedStationName = user.station_name ?? 'Gare';

      if (user.role === 'bagagiste') {
        try {
          const { data: sbh } = await supabase
            .from('station_baggage_handlers')
            .select('station_id, stations!inner(id, name)')
            .eq('handler_id', user.id)
            .limit(1)
            .maybeSingle();
          if (sbh) {
            const st = sbh.stations as { id: string; name: string } | null;
            if (st?.id) {
              resolvedStationId = st.id;
              resolvedStationName = st.name;
            }
          }
        } catch {
          // non-critical — fall back to user.station_id
        }
      }

      const session: SessionRecord = {
        id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        user_id: user.id,
        email: user.email,
        full_name: user.full_name ?? `${user.first_name} ${user.last_name}`,
        role: user.role,
        station_id: resolvedStationId,
        station_name: resolvedStationName,
        login_at: new Date().toISOString(),
        offline: false,
        tpe_pos_enabled: (user as any).tpe_pos_enabled as boolean | undefined,
        tpe_mode: (user as any).tpe_mode as 'sans_guichet' | 'avec_guichet' | undefined,
      };

      await db.session.clear();
      await db.session.put(session);

      // Counter / route resolution only applies to guichetiers (and similar
      // counter-based roles). Bagagistes get their station from the junction
      // table above and have no counter.
      if (user.role !== 'bagagiste') {
        try {
          const { data: counter } = await supabase
            .from('counters')
            .select('id, counter_number, station_id, courrier_enabled, stations!inner(name)')
            .eq('assigned_user_id', user.id)
            .eq('is_active', true)
            .maybeSingle();

          if (counter) {
            session.counter_id = counter.id;
            session.counter_number = counter.counter_number as string;
            session.courrier_enabled = counter.courrier_enabled === true;

            if (!session.station_id && counter.station_id) {
              session.station_id = counter.station_id;
              const stationName = (counter.stations as { name?: string } | null)?.name;
              if (stationName) session.station_name = stationName;

              await supabase
                .from('users')
                .update({ station_id: counter.station_id })
                .eq('id', user.id)
                .then(() => {});
            }

            try {
              const { data: routes } = await supabase
                .from('counter_routes')
                .select('route_id')
                .eq('counter_id', counter.id);
              if (routes && routes.length > 0) {
                session.assigned_route_ids = routes.map(r => r.route_id as string);
              }
            } catch {
              // non-critical
            }

            await db.session.put(session);
          }
        } catch {
          // non-critical
        }
      }

      if (!session.station_id) {
        await db.session.delete(session.id);
        return { success: false, error: 'Aucune gare assignée à ce compte.' };
      }

      // Allow this account to sign in again on this device without network
      try { await saveOfflineLogin(email, password, session); } catch { /* offline login unavailable */ }

      return { success: true, session };
    } catch (err: any) {
      // No answer from the server: check the credentials saved on this device instead
      if (isNetworkError(err)) return offlineLogin(email, password);
      // Password refused (changed or wrong): it must no longer open the offline session either
      if (isRejectedPassword(err)) forgetOfflineLogin(email);
      return { success: false, error: err?.message ?? 'Erreur de connexion' };
    }
  }

  return offlineLogin(email, password);
}

async function offlineLogin(email: string, password: string): Promise<POSLoginResult> {
  const check = await checkOfflineLogin(email, password);
  if (check.status === 'ok') {
    const restored: SessionRecord = {
      ...check.session,
      id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      login_at: new Date().toISOString(),
      offline: true,
    };
    await db.session.clear();
    await db.session.put(restored);
    return { success: true, session: restored, offline: true };
  }
  if (check.status === 'wrong_password') {
    return { success: false, error: 'Mot de passe incorrect (vérification hors ligne).' };
  }
  if (check.status === 'expired') {
    return { success: false, error: `Connexion hors ligne expirée : reconnectez-vous une fois en ligne (validité ${OFFLINE_LOGIN_MAX_AGE_DAYS} jours).` };
  }

  // A login saved by an earlier version (unsalted hash) is no longer accepted: one online login
  // saves it again in the protected format
  return { success: false, error: 'Pas de connexion au serveur, et ce compte ne s\'est pas encore connecté en ligne sur ce poste avec cette version. Connectez-vous une fois avec Internet.' };
}

export async function getCurrentSession(): Promise<SessionRecord | undefined> {
  await eraseLegacyPasswordHashes();
  const sessions = await db.session.toArray();
  return sessions[0];
}

export async function logoutPOS(): Promise<void> {
  try {
    if (isOnline()) {
      await useAuthStore.getState().logout();
    }
  } catch {
    // non-critical
  }
  // Shared device: the customers' names and phones of past days do not stay for the next account
  // (today's sales, parcels in progress and anything still to be sent are kept)
  try { await clearPersonalDataOnLogout(); } catch { /* the daily rule will catch up */ }
  await db.session.clear();
}

/**
 * Ensure the Supabase auth session is valid before sending queued operations.
 * After a long offline period, the Supabase access token may have expired.
 * This re-authenticates using the cached credentials (email + password hash
 * is not enough — we need the real password). Since we never store the plaintext
 * password, we instead check if the current Supabase session is still valid,
 * and if not, we simply skip the flush — the operations remain in the queue
 * and will be retried on the next poll cycle or when the user re-logs in.
 *
 * However, the most common cause of the 401 is that the auth session was
 * lost during the offline period. The authStore's initialize() is called
 * on app startup and restores the session from localStorage. But if the
 * session expired, we need to detect it and inform the user.
 */
export async function ensureAuthSession(): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      // Check if token is still valid (not expired)
      const expiresAt = session.expires_at;
      if (expiresAt && expiresAt * 1000 > Date.now()) {
        return true;
      }
    }

    // Session is missing or expired — try to refresh
    const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !refreshData.session) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
