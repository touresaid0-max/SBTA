import { db } from './db';
import { supabase } from '@/services/supabase';
import { isOnline } from './syncEngine';

function nowIso(): string {
  return new Date().toISOString();
}

export async function refreshAllReferentiels(stationId?: string): Promise<void> {
  if (!isOnline()) return;

  try {
    // Stations — include city relation for offline parcel creation
    const { data: stations } = await supabase
      .from('stations')
      .select('id, name, agency_code, is_active, cities(name)')
      .eq('is_active', true)
      .order('name');
    if (stations) {
      await db.referentiels.put({
        key: 'stations_all',
        type: 'stations',
        data: stations,
        updated_at: nowIso(),
      });
    }

    // Companies
    const { data: companies } = await supabase
      .from('companies')
      .select('id, name')
      .order('name');
    if (companies) {
      await db.referentiels.put({
        key: 'companies_all',
        type: 'companies',
        data: companies,
        updated_at: nowIso(),
      });
    }

    // Drivers (chauffeurs)
    const { data: drivers } = await supabase
      .from('users')
      .select('id, full_name, phone')
      .eq('role', 'chauffeur')
      .eq('is_active', true)
      .order('full_name');
    if (drivers) {
      await db.referentiels.put({
        key: 'drivers_all',
        type: 'drivers',
        data: drivers,
        updated_at: nowIso(),
      });
    }

    // Buses
    const { data: buses } = await supabase
      .from('buses')
      .select('id, registration_number, company_id')
      .order('registration_number');
    if (buses) {
      await db.referentiels.put({
        key: 'buses_all',
        type: 'buses',
        data: buses,
        updated_at: nowIso(),
      });
    }

    // Schedules (today onward) for parcel transport assignment
    if (stationId) {
      const todayStr = new Date().toISOString().slice(0, 10);
      const { data: schedules } = await supabase
        .from('schedules')
        .select('id, route_name, departure_datetime, bus_id, driver_id, departure_station_id, arrival_station_id, status')
        .gte('departure_datetime', `${todayStr}T00:00:00`)
        .or(`departure_station_id.eq.${stationId},arrival_station_id.eq.${stationId}`)
        .order('departure_datetime', { ascending: true });
      if (schedules) {
        await db.referentiels.put({
          key: `schedules_${stationId}`,
          type: 'schedules',
          data: schedules,
          updated_at: nowIso(),
        });
      }
    }
  } catch (err) {
    console.warn('[courrier-sync] Failed to refresh referentiels:', err);
  }
}

export async function getReferentiel<T>(key: string): Promise<T[] | null> {
  const record = await db.referentiels.get(key);
  return (record?.data as T[]) ?? null;
}
