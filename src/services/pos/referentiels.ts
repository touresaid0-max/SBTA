import { db, type ReferentielRecord } from './db';
import { supabase } from '@/services/supabase';

type RefType = 'lignes' | 'vehicules' | 'chauffeurs' | 'tarifs' | 'gares' | 'route_city_stops';

const QUERIES: Record<RefType, () => Promise<unknown[]>> = {
  lignes: async () => {
    const { data, error } = await supabase.from('routes').select('id, name, origin_station_id, destination_station_id, destination_city_id, base_price, is_active').eq('is_active', true).order('name');
    if (error) throw error;
    return (data ?? []).map((r: any) => ({ id: r.id, name: r.name, origin_station_id: r.origin_station_id, destination_station_id: r.destination_station_id, destination_city_id: r.destination_city_id, base_price: Number(r.base_price ?? 0), is_active: r.is_active }));
  },
  vehicules: async () => {
    const { data, error } = await supabase.from('buses').select('id, registration_number, capacity, company_id, status, brand, model, seats_sold_from').in('status', ['disponible', 'en_service']).is('archived_at', null).order('registration_number');
    if (error) throw error;
    return (data ?? []).map((b: any) => ({ id: b.id, plate_number: b.registration_number, capacity: b.capacity, company_id: b.company_id, status: b.status, brand: b.brand, model: b.model, seats_sold_from: b.seats_sold_from ?? 1 }));
  },
  chauffeurs: async () => {
    const { data, error } = await supabase.from('users').select('id, full_name, email, role, employee_id, phone').eq('role', 'chauffeur').eq('status', 'active').order('full_name');
    if (error) throw error;
    return data ?? [];
  },
  tarifs: async () => {
    const { data, error } = await supabase.from('route_stops').select('id, route_id, station_id, price, position').order('route_id');
    if (error) throw error;
    return (data ?? []).map((t: any) => ({ id: t.id, route_id: t.route_id, station_id: t.station_id, price: Number(t.price ?? 0), stop_order: t.position }));
  },
  gares: async () => {
    const { data, error } = await supabase.from('stations').select('id, name, city_id, agency_code, is_active, cities(name)').eq('is_active', true).order('name');
    if (error) throw error;
    return (data ?? []).map((s: any) => ({ id: s.id, name: s.name, city_id: s.city_id, city: s.cities?.name ?? '', agency_code: s.agency_code, is_active: s.is_active }));
  },
  route_city_stops: async () => {
    const { data, error } = await supabase.from('route_city_stops').select('id, route_id, city_id, price, position, cities(name)').order('route_id, position');
    if (error) throw error;
    return (data ?? []).map((s: any) => ({ id: s.id, route_id: s.route_id, city_id: s.city_id, city_name: s.cities?.name ?? '', price: Number(s.price ?? 0), position: s.position }));
  },
};

export async function refreshReferentiel(type: RefType): Promise<unknown[]> {
  // Without a valid login the database answers drivers with an empty list and no error (users
  // are hidden by RLS) while lines and buses still come back: never read in that state.
  // getSession() renews an expired token when the refresh token is still valid.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Session expirée');

  const data = await QUERIES[type]();

  // An empty answer never replaces a list already known on this device
  if (data.length === 0) {
    const cached = await db.referentiels.get(type);
    if (cached && Array.isArray(cached.data) && cached.data.length > 0) return cached.data;
  }

  const record: ReferentielRecord = {
    key: type,
    type,
    data,
    updated_at: new Date().toISOString(),
  };
  await db.referentiels.put(record);
  return data;
}

// The screens (new departure, sale) read 4 to 6 lists on every opening: waiting for the server each
// time left them loading on a slow connection. A list known on the device is now shown after at
// most this delay, while the server copy keeps loading in the background for the next opening.
const SERVER_WAIT_WITH_COPY_MS = 3_000;

// One server read at a time per list, shared by the screens that ask for it meanwhile
const refreshing = new Map<RefType, Promise<unknown[]>>();

function refreshOnce(type: RefType): Promise<unknown[]> {
  let running = refreshing.get(type);
  if (!running) {
    running = refreshReferentiel(type).finally(() => refreshing.delete(type));
    refreshing.set(type, running);
  }
  return running;
}

export async function getReferentiel<T = unknown>(type: RefType): Promise<T[]> {
  const cached = await db.referentiels.get(type).catch(() => undefined);
  const copy = cached && Array.isArray(cached.data) && cached.data.length > 0 ? cached.data as T[] : null;

  const fromServer = refreshOnce(type) as Promise<T[]>;
  // No copy on the device (first use, or emptied by an earlier version): the server is needed
  if (!copy) return fromServer.catch(() => (cached?.data as T[] | undefined) ?? []);

  fromServer.catch(() => { /* the copy stays in use; the next sync tries again */ });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const copyAfterDelay = new Promise<T[]>(resolve => { timer = setTimeout(() => resolve(copy), SERVER_WAIT_WITH_COPY_MS); });
  try {
    return await Promise.race([fromServer.catch(() => copy), copyAfterDelay]);
  } finally {
    clearTimeout(timer);
  }
}

export async function refreshAllReferentiels(): Promise<void> {
  const types: RefType[] = ['lignes', 'vehicules', 'chauffeurs', 'tarifs', 'gares', 'route_city_stops'];
  await Promise.allSettled(types.map(t => refreshReferentiel(t)));
}

export function isReferentielStale(updated_at: string): boolean {
  return Date.now() - new Date(updated_at).getTime() > 1000 * 60 * 30;
}
