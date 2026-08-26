import { db, type SessionRecord } from './db';
import { supabase } from '@/services/supabase';
import { useAuthStore } from '@/store/authStore';
import { isOnline } from './syncEngine';

export interface POSLoginResult {
  success: boolean;
  error?: string;
  session?: SessionRecord;
  offline?: boolean;
}

/**
 * Hash a password using SubtleCrypto SHA-256 (suitable for offline verification).
 * We store this hash on first successful online login so the user can re-authenticate
 * offline without storing the plaintext password.
 */
async function hashPassword(password: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(password));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function login(email: string, password: string): Promise<POSLoginResult> {
  const online = isOnline();

  if (online) {
    try {
      await useAuthStore.getState().login(email, password);
      const user = useAuthStore.getState().user;

      if (!user) {
        return { success: false, error: 'Profil introuvable. Contactez votre administrateur.' };
      }

      const passwordHash = await hashPassword(password);

      const session: SessionRecord = {
        id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        user_id: user.id,
        email: user.email,
        full_name: user.full_name ?? `${user.first_name} ${user.last_name}`,
        role: user.role,
        station_id: user.station_id ?? '',
        station_name: user.station_name ?? 'Gare',
        login_at: new Date().toISOString(),
        offline: false,
        password_hash: passwordHash,
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
        return { success: false, error: 'Aucune gare assignée à ce compte.' };
      }

      return { success: true, session };
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'Erreur de connexion' };
    }
  }

  // ── OFFLINE LOGIN ──
  // Verify against cached session credentials
  const sessions = await db.session.toArray();
  const cached = sessions.find(s => s.email?.toLowerCase() === email.trim().toLowerCase());

  if (!cached || !cached.password_hash) {
    return { success: false, error: 'Aucune session hors ligne trouvée pour cet identifiant. Connectez-vous au moins une fois en ligne.' };
  }

  const inputHash = await hashPassword(password);
  if (inputHash !== cached.password_hash) {
    return { success: false, error: 'Mot de passe incorrect (vérification hors ligne).' };
  }

  // Reactivate the cached session in offline mode
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

export async function logoutPOS(): Promise<void> {
  try {
    if (isOnline()) {
      await useAuthStore.getState().logout();
    }
  } catch {
    // non-critical
  }
  await db.session.clear();
}
