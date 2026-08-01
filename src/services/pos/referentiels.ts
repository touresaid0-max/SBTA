import { db, type ReferentielRecord } from './db';
import { supabase } from '@/services/supabase';

type RefType = 'lignes' | 'vehicules' | 'chauffeurs' | 'tarifs' | 'gares';

const CACHE_TTL_MS = 1000 * 60 * 30;

const QUERIES: Record<RefType, () => Promise<unknown[]>> = {
  lignes: async () => {
    const { data, error } = await supabase.from('routes').select('id, name, origin_station_id, is_active').eq('is_active', true).order('name');
    if (error) throw error;
    return data ?? [];
  },
  vehicules: async () => {
    const { data, error } = await supabase.from('buses').select('id, plate_number, capacity, company_id, status').order('plate_number');
    if (error) throw error;
    return data ?? [];
  },
  chauffeurs: async () => {
    const { data, error } = await supabase.from('users').select('id, full_name, email, role').eq('role', 'chauffeur').eq('status', 'active').order('full_name');
    if (error) throw error;
    return data ?? [];
  },
  tarifs: async () => {
    const { data, error } = await supabase.from('route_stops').select('id, route_id, station_id, price, stop_order').order('route_id');
    if (error) throw error;
    return data ?? [];
  },
  gares: async () => {
    const { data, error } = await supabase.from('stations').select('id, name, city, agency_code, is_active').eq('is_active', true).order('name');
    if (error) throw error;
    return data ?? [];
  },
};

export async function refreshReferentiel(type: RefType): Promise<unknown[]> {
  const data = await QUERIES[type]();
  const record: ReferentielRecord = {
    key: type,
    type,
    data,
    updated_at: new Date().toISOString(),
  };
  await db.referentiels.put(record);
  return data;
}

export async function getReferentiel<T = unknown>(type: RefType, opts?: { force?: boolean }): Promise<T[]> {
  if (navigator.onLine && !opts?.force) {
    try {
      return (await refreshReferentiel(type)) as T[];
    } catch {
      // fall through to cache
    }
  }

  const cached = await db.referentiels.get(type);
  if (cached) return cached.data as T[];
  return [];
}

export async function refreshAllReferentiels(): Promise<void> {
  const types: RefType[] = ['lignes', 'vehicules', 'chauffeurs', 'tarifs', 'gares'];
  await Promise.allSettled(types.map(t => refreshReferentiel(t)));
}

export function isReferentielStale(updated_at: string): boolean {
  return Date.now() - new Date(updated_at).getTime() > CACHE_TTL_MS;
}
