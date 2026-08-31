import { db, type SessionRecord } from './db';
import { supabase } from '@/services/supabase';
import { useAuthStore } from '@/store/authStore';
import { isOnline } from './syncEngine';

export interface CourrierLoginResult {
  success: boolean;
  error?: string;
  session?: SessionRecord;
  offline?: boolean;
}

async function hashPassword(password: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(password));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
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

      const passwordHash = await hashPassword(password);

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
        id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        user_id: user.id,
        email: user.email,
        full_name: user.full_name ?? `${user.first_name} ${user.last_name}`,
        role: user.role,
        station_id: stationId,
        station_name: stationName,
        login_at: new Date().toISOString(),
        offline: false,
        password_hash: passwordHash,
      };

      await db.session.clear();
      await db.session.put(session);

      if (!session.station_id) {
        await db.session.delete(session.id);
        return { success: false, error: 'Aucune gare assignée à ce compte.' };
      }

      return { success: true, session };
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'Erreur de connexion' };
    }
  }

  // ── OFFLINE LOGIN ──
  const sessions = await db.session.toArray();
  const cached = sessions.find(s => s.email?.toLowerCase() === email.trim().toLowerCase());

  if (!cached || !cached.password_hash) {
    return { success: false, error: 'Aucune session hors ligne trouvée pour cet identifiant. Connectez-vous au moins une fois en ligne.' };
  }

  const inputHash = await hashPassword(password);
  if (inputHash !== cached.password_hash) {
    return { success: false, error: 'Mot de passe incorrect (vérification hors ligne).' };
  }

  const restored: SessionRecord = {
    ...cached,
    login_at: new Date().toISOString(),
    offline: true,
  };
  await db.session.clear();
  await db.session.put(restored);

  return { success: true, session: restored, offline: true };
}

export async function getCurrentSession(): Promise<SessionRecord | undefined> {
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
