import { db, type ReferentielRecord } from './db';
import { supabase } from '@/services/supabase';
import { isOnline } from './syncEngine';

type RefType = 'lignes' | 'vehicules' | 'chauffeurs' | 'tarifs' | 'gares' | 'route_city_stops' | 'route_secondary_stations';

/** Last row of the route_secondary_stations list: the server knows the secondary routes */
export const SECONDARY_STATIONS_READY = '__ready__';
/** Only row of the list on a server without the secondary routes (migration not run): no filter */
export const SECONDARY_STATIONS_UNAVAILABLE = '__unavailable__';

const QUERIES: Record<RefType, () => Promise<unknown[]>> = {
  lignes: async () => {
    // base_price: tarif climatisé; base_price_no_ac: tarif sans clim (optional). A server without the
    // column (migration 20261117090000 not run) is read without it.
    const columns = 'id, name, origin_station_id, destination_station_id, destination_city_id, base_price, is_active';
    let { data, error }: { data: any[] | null; error: unknown } = await supabase.from('routes').select(`${columns}, base_price_no_ac`).eq('is_active', true).order('name');
    if (error) ({ data, error } = await supabase.from('routes').select(columns).eq('is_active', true).order('name'));
    if (error) throw error;
    return (data ?? []).map((r: any) => ({ id: r.id, name: r.name, origin_station_id: r.origin_station_id, destination_station_id: r.destination_station_id, destination_city_id: r.destination_city_id, base_price: Number(r.base_price ?? 0), base_price_no_ac: Number(r.base_price_no_ac) > 0 ? Number(r.base_price_no_ac) : null, is_active: r.is_active }));
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
    const columns = 'id, route_id, city_id, price, position, cities(name)';
    let { data, error }: { data: any[] | null; error: unknown } = await supabase.from('route_city_stops').select(`${columns}, price_no_ac`).order('route_id, position');
    if (error) ({ data, error } = await supabase.from('route_city_stops').select(columns).order('route_id, position'));
    if (error) throw error;
    return (data ?? []).map((s: any) => ({ id: s.id, route_id: s.route_id, city_id: s.city_id, city_name: s.cities?.name ?? '', price: Number(s.price ?? 0), price_no_ac: Number(s.price_no_ac) > 0 ? Number(s.price_no_ac) : null, position: s.position }));
  },
  // Stations allowed as « Gare de vente secondaire » for each route (set by the admin through the
  // route's secondary routes). A marker row ends the list, so that it is never empty (an empty
  // answer would not replace the copy kept on the device).
  route_secondary_stations: async () => {
    const { data, error } = await supabase.rpc('get_route_secondary_stations');
    if (error) {
      if (error.code === 'PGRST202' || error.code === '42883') {
        return [{ route_id: SECONDARY_STATIONS_UNAVAILABLE, station_id: '' }];
      }
      throw error;
    }
    return [
      // secondary_route_id: the secondary route through which the station is linked (its name,
      // destinations and fares are used for the sale at that station)
      ...((data ?? []) as { route_id: string; station_id: string; secondary_route_id?: string | null }[])
        .map(r => ({ route_id: r.route_id, station_id: r.station_id, secondary_route_id: r.secondary_route_id ?? null })),
      { route_id: SECONDARY_STATIONS_READY, station_id: '' },
    ];
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
  // An empty list is a copy too: many stations have no fares or stops of their own. A list emptied
  // by an earlier version is replaced by the server's within the 3 s on a normal connection.
  const copy = cached && Array.isArray(cached.data) ? cached.data as T[] : null;

  // Without network, the device's copy at once: asking the server first made every read (fare of
  // a destination, opening of the sale screen…) wait the 3 s below when the line was cut but the
  // station's network still up (requests left without answer)
  if (!isOnline()) return copy ?? [];

  const fromServer = refreshOnce(type) as Promise<T[]>;
  // No copy on the device (first use): the server is needed
  if (!copy) return fromServer.catch(() => []);

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
  const types: RefType[] = ['lignes', 'vehicules', 'chauffeurs', 'tarifs', 'gares', 'route_city_stops', 'route_secondary_stations'];
  await Promise.allSettled(types.map(t => refreshReferentiel(t)));
}

export function isReferentielStale(updated_at: string): boolean {
  return Date.now() - new Date(updated_at).getTime() > 1000 * 60 * 30;
}
