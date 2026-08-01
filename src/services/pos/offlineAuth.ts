import { db, type SessionRecord } from './db';
import { supabase } from '@/services/supabase';
import { useAuthStore } from '@/store/authStore';

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`pos-guichet-salt::${password}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export interface POSLoginResult {
  success: boolean;
  offline: boolean;
  error?: string;
  session?: SessionRecord;
}

export async function loginOnline(email: string, password: string): Promise<POSLoginResult> {
  try {
    const { useAuthStore: store } = await import('@/store/authStore');
    await store.getState().login(email, password);
    const user = store.getState().user;

    if (!user) {
      return { success: false, offline: false, error: 'Profil introuvable. Contactez votre administrateur.' };
    }

    const hash = await hashPassword(password);
    const session: SessionRecord = {
      id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      user_id: user.id,
      email: user.email,
      full_name: user.full_name ?? `${user.first_name} ${user.last_name}`,
      role: user.role,
      station_id: user.station_id,
      station_name: user.station_name ?? 'Gare',
      login_at: new Date().toISOString(),
      offline: false,
      password_hash: hash,
    };

    await db.session.clear();
    await db.session.put(session);

    try {
      const { data: counter } = await supabase
        .from('counters')
        .select('id, counter_number, station_id, stations!inner(name)')
        .eq('assigned_user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (counter) {
        session.counter_id = counter.id;
        session.counter_number = counter.counter_number as string;

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

    if (!session.station_id) {
      await db.session.delete(session.id);
      return { success: false, offline: false, error: 'Aucune gare assignée à ce compte.' };
    }

    return { success: true, offline: false, session };
  } catch (err: any) {
    return { success: false, offline: false, error: err?.message ?? 'Erreur de connexion' };
  }
}

export async function loginOffline(email: string, password: string): Promise<POSLoginResult> {
  const sessions = await db.session.toArray();
  const cached = sessions.find(s => s.email.toLowerCase() === email.toLowerCase());

  if (!cached) {
    return { success: false, offline: true, error: 'Aucun identifiant en cache pour ce compte. Connexion impossible hors ligne.' };
  }

  if (!cached.password_hash) {
    return { success: false, offline: true, error: 'Identifiants hors ligne non disponibles pour ce compte.' };
  }

  const hash = await hashPassword(password);
  if (hash !== cached.password_hash) {
    return { success: false, offline: true, error: 'Mot de passe incorrect.' };
  }

  const session: SessionRecord = {
    ...cached,
    id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    login_at: new Date().toISOString(),
    offline: true,
  };

  await db.session.clear();
  await db.session.put(session);

  return { success: true, offline: true, session };
}

export async function login(email: string, password: string): Promise<POSLoginResult> {
  if (!navigator.onLine) {
    return loginOffline(email, password);
  }

  try {
    const result = await loginOnline(email, password);
    if (result.success) return result;

    const offlineResult = await loginOffline(email, password);
    if (offlineResult.success) return offlineResult;

    return result;
  } catch {
    return loginOffline(email, password);
  }
}

export async function getCurrentSession(): Promise<SessionRecord | undefined> {
  const sessions = await db.session.toArray();
  return sessions[0];
}

export async function logoutPOS(): Promise<void> {
  const session = await getCurrentSession();
  if (session && !session.offline) {
    try {
      const store = useAuthStore.getState();
      await store.logout();
    } catch {
      // non-critical
    }
  }
  await db.session.clear();
}

export async function hasOfflineCredentials(email: string): Promise<boolean> {
  const sessions = await db.session.toArray();
  return sessions.some(s => s.email.toLowerCase() === email.toLowerCase() && !!s.password_hash);
}
