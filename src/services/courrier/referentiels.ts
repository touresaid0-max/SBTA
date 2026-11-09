import { db } from './db';
import { supabase } from '@/services/supabase';
import { isOnline } from './syncEngine';
import { stationAgencyCode, topUpParcelCodePool } from './parcelCodeGenerator';

function nowIso(): string {
  return new Date().toISOString();
}

// An empty answer (access rules, server hiccup) never replaces a list already kept on the device:
// the screens would lose it exactly when they need it without network.
export async function refreshAllReferentiels(stationId?: string): Promise<void> {
  if (!isOnline()) return;

  try {
    // Stations — include city relation for offline parcel creation
    const { data: stations } = await supabase
      .from('stations')
      .select('id, name, agency_code, is_active, cities(name)')
      .eq('is_active', true)
      .order('name');
    if (stations && stations.length > 0) {
      await db.referentiels.put({
        key: 'stations_all',
        type: 'stations',
        data: stations,
        updated_at: nowIso(),
      });
    }

    // Phone and QR setting of each station, printed on receipts and slips. Read apart: if one of
    // these columns were missing, the station list above must still be kept.
    try {
      const { data: extras, error: extrasError } = await supabase
        .from('stations')
        .select('id, phone, courier_qr_enabled')
        .eq('is_active', true);
      if (!extrasError && extras) {
        await db.referentiels.put({ key: 'station_extras', type: 'stations', data: extras, updated_at: nowIso() });
      }
    } catch { /* receipts then print without the station phone */ }

    // Companies
    const { data: companies } = await supabase
      .from('companies')
      .select('id, name')
      .order('name');
    if (companies && companies.length > 0) {
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
    if (drivers && drivers.length > 0) {
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
      .select('id, registration_number, company_id, brand')
      .is('archived_at', null)
      .order('registration_number');
    if (buses && buses.length > 0) {
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

      // Parcel codes reserved in advance (6 digits: agency code of the station + number, 530001…): a parcel
      // created without network gets the next one, final on its receipt. Topped up here, while
      // online; a failure keeps the codes already on the device.
      try {
        await topUpParcelCodePool(stationId, await stationAgencyCode(stationId), async count => {
          const { data, error } = await supabase.rpc('reserve_parcel_codes', { p_station_id: stationId, p_count: count });
          if (error) throw error;
          return (data ?? []) as string[];
        });
      } catch { /* topped up at the next refresh */ }
    }
  } catch (err) {
    console.warn('[courrier-sync] Failed to refresh referentiels:', err);
  }
}

export async function getReferentiel<T>(key: string): Promise<T[] | null> {
  const record = await db.referentiels.get(key);
  return (record?.data as T[]) ?? null;
}
