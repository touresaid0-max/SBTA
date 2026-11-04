import { db, type SessionRecord } from './db';
import { supabase } from '@/services/supabase';
import { useAuthStore } from '@/store/authStore';
import { isOnline } from './syncEngine';
import { clearPersonalDataOnLogout } from '@/services/offline/dataRetention';
import { createCredentialStore, OFFLINE_LOGIN_MAX_AGE_DAYS } from '@/services/offline/credentialStore';
import { uuidV4 } from '@/utils/uuid';

export interface CourrierLoginResult {
  success: boolean;
  error?: string;
  session?: SessionRecord;
  offline?: boolean;
}

// Offline login of the courrier (audit M8): salted PBKDF2, one entry per account, valid 30 days.
// It used to keep an unsalted SHA-256 of the password in the session table.
type StoredSession = Omit<SessionRecord, 'id' | 'login_at' | 'offline' | 'password_hash'>;
const credentials = createCredentialStore<StoredSession>('sbta_courrier_offline_logins');

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

/** Erases the unsalted hashes kept by earlier versions in the session table. */
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

export async function login(email: string, password: string): Promise<CourrierLoginResult> {
  const online = isOnline();

  if (online) {
    try {
      await useAuthStore.getState().login(email, password);
      const user = useAuthStore.getState().user;

      if (!user) {
        return { success: false, error: 'Profil introuvable. Contactez votre administrateur.' };
      }

      // Resolve station_id from station_agents junction
      let stationId = user.station_id ?? '';
      let stationName = 'Gare';

      if (!stationId) {
        try {
          const { data: agentRow } = await supabase
            .from('station_agents')
            .select('station_id, station:stations!inner(id, name)')
            .eq('agent_id', user.id)
            .eq('is_primary', true)
            .maybeSingle();

          if (agentRow) {
            const station = agentRow.station as { id?: string; name?: string } | null;
            if (station?.id) {
              stationId = station.id;
              stationName = station.name ?? stationName;
            }
          }
        } catch {
          // non-critical
        }
      } else {
        try {
          const { data: station } = await supabase
            .from('stations')
            .select('name')
            .eq('id', stationId)
            .maybeSingle();
          if (station?.name) stationName = station.name;
        } catch {
          // non-critical
        }
      }

      const session: SessionRecord = {
        id: uuidV4(),
        user_id: user.id,
        email: user.email,
        full_name: user.full_name ?? `${user.first_name} ${user.last_name}`,
        role: user.role,
        station_id: stationId,
        station_name: stationName,
        login_at: new Date().toISOString(),
        offline: false,
      };

      await db.session.clear();
      await db.session.put(session);

      if (!session.station_id) {
        await db.session.delete(session.id);
        return { success: false, error: 'Aucune gare assignée à ce compte.' };
      }

      // Allow this account to sign in again on this device without network
      try {
        const { id: _id, login_at: _at, offline: _off, ...stored } = session;
        void _id; void _at; void _off;
        await credentials.save(email, password, stored);
      } catch { /* offline login unavailable */ }

      return { success: true, session };
    } catch (err: any) {
      // No answer from the server: check the login saved on this device instead
      if (isNetworkError(err)) return offlineLogin(email, password);
      // Password refused (changed or wrong): it must no longer open the offline session either
      if (isRejectedPassword(err)) credentials.forget(email);
      return { success: false, error: err?.message ?? 'Erreur de connexion' };
    }
  }

  return offlineLogin(email, password);
}

async function offlineLogin(email: string, password: string): Promise<CourrierLoginResult> {
  const check = await credentials.check(email, password);
  if (check.status === 'ok') {
    const restored: SessionRecord = {
      ...check.session,
      id: uuidV4(),
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
  return { success: false, error: 'Aucune session hors ligne trouvée pour cet identifiant. Connectez-vous au moins une fois en ligne.' };
}

export async function getCurrentSession(): Promise<SessionRecord | undefined> {
  await eraseLegacyPasswordHashes();
  const sessions = await db.session.toArray();
  return sessions[0];
}

export async function logoutCourrier(): Promise<void> {
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

export async function ensureAuthSession(): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      const expiresAt = session.expires_at;
      if (expiresAt && expiresAt * 1000 > Date.now()) {
        return true;
      }
    }

    const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !refreshData.session) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
