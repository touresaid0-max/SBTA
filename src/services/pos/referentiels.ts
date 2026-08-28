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
    const { data, error } = await supabase.from('buses').select('id, registration_number, capacity, company_id, status, brand, model, seats_sold_from').in('status', ['disponible', 'en_service']).order('registration_number');
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

export async function getReferentiel<T = unknown>(type: RefType): Promise<T[]> {
  try {
    return (await refreshReferentiel(type)) as T[];
  } catch {
    const cached = await db.referentiels.get(type);
    if (cached) return cached.data as T[];
    return [];
  }
}

export async function refreshAllReferentiels(): Promise<void> {
  const types: RefType[] = ['lignes', 'vehicules', 'chauffeurs', 'tarifs', 'gares', 'route_city_stops'];
  await Promise.allSettled(types.map(t => refreshReferentiel(t)));
}

export function isReferentielStale(updated_at: string): boolean {
  return Date.now() - new Date(updated_at).getTime() > 1000 * 60 * 30;
}
