import { db } from './db';
import { supabase } from '@/services/supabase';
import { isOnline } from './syncEngine';

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

      // Agency code of each destination for this station (audit M11): a parcel created without
      // network gets the same prefix as online. Kept as answered, even empty (no code configured);
      // a failed request keeps the list already on the device.
      try {
        const { data: destCodes, error: destCodesError } = await supabase
          .from('station_destination_agency_codes')
          .select('destination_station_id, agency_code')
          .eq('origin_station_id', stationId);
        if (!destCodesError && destCodes) {
          await db.referentiels.put({
            key: `destination_agency_codes_${stationId}`,
            type: 'stations',
            data: destCodes,
            updated_at: nowIso(),
          });
        }
      } catch { /* the station's general code is used meanwhile */ }
    }
  } catch (err) {
    console.warn('[courrier-sync] Failed to refresh referentiels:', err);
  }
}

export async function getReferentiel<T>(key: string): Promise<T[] | null> {
  const record = await db.referentiels.get(key);
  return (record?.data as T[]) ?? null;
}
