import { db } from './db';
import { supabase } from '@/services/supabase';
import { useAuthStore } from '@/store/authStore';
import { enqueueInsert, enqueueUpdate, enqueueDelete, isOnline, getPendingCount } from './syncEngine';

function uuid(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

type StoreName = 'departs' | 'tickets' | 'bagages' | 'depenses';

// Fields that are LOCAL ONLY — updates containing ONLY these should not be sent to remote
const LOCAL_ONLY_UPDATE_FIELDS = new Set([
  'mt_ticket', 'mt_bagage', 'tot_depense', 'solde', 'caisse',
  'cloture_at', 'cloture_by', 'departure_number',
  'bus_plate', 'bus_name', 'driver_name', 'convoyeur_id', 'convoyeur_name',
  'apprenti_id', 'apprenti_name', 'departure_date', 'departure_time',
  'is_ac', 'seats_from', 'seat_allocations', 'station_name',
  'counter_id', 'other_station_id', 'other_station_name',
  'synced', 'updated_at', 'id',
  'printed', 'printed_at',
]);

function hasRemoteMappableFields(entity: StoreName, patch: Record<string, unknown>): boolean {
  const keys = Object.keys(patch).filter(k => !LOCAL_ONLY_UPDATE_FIELDS.has(k));
  if (keys.length === 0) return false;

  if (entity === 'departs') {
    const remoteMappable = ['route_id', 'bus_id', 'driver_id', 'station_id', 'arrival_station_id', 'is_ramassage', 'departure_datetime', 'status', 'seats_total', 'seats_sold', 'route_name', 'route_number', 'confirmed', 'cancelled', 'cloture'];
    return keys.some(k => remoteMappable.includes(k));
  }
  if (entity === 'tickets') {
    const remoteMappable = ['depart_id', 'seat_number', 'seat_numbers', 'destination', 'destination_id', 'passenger_name', 'passenger_phone', 'price', 'status'];
    return keys.some(k => remoteMappable.includes(k));
  }
  return false;
}

// ── Public API: offline-first — always write locally, then sync/queue ──

export async function localInsert<
  T extends { id: string; created_at: string; updated_at: string; synced?: boolean },
>(
  store: StoreName,
  record: Omit<T, 'id' | 'created_at' | 'updated_at' | 'synced'> & Partial<T>,
): Promise<T> {
  const id = record.id ?? uuid();
  const ts = nowIso();
  const online = isOnline();
  const full = {
    ...record,
    id,
    created_at: record.created_at ?? ts,
    updated_at: ts,
    synced: online,
  } as unknown as T;

  // Always write to local IndexedDB first (offline-first)
  await (db[store] as any).put(full);

  // Then attempt remote sync (or queue if offline)
  try {
    const result = await enqueueInsert(store, full as unknown as Record<string, unknown>);
    if (!result.queued) {
      // Successfully synced — mark as synced
      await (db[store] as any).put({ ...full, synced: true });
    }
  } catch (err) {
    // Network error — record stays locally with synced=false
    // It will be synced when connection returns
  }

  return full;
}

export async function localUpdate<
  T extends { id: string; updated_at: string; synced?: boolean },
>(
  store: StoreName,
  id: string,
  patch: Partial<T>,
): Promise<T | null> {
  const existing = await (db[store] as any).get(id);
  if (!existing) return null;

  const online = isOnline();
  const updated = {
    ...existing,
    ...patch,
    id,
    updated_at: nowIso(),
    synced: online,
  } as unknown as T;

  // Always write locally first
  await (db[store] as any).put(updated);

  // Then sync/queue remotely
  const patchRecord = patch as unknown as Record<string, unknown>;
  if (hasRemoteMappableFields(store, patchRecord)) {
    try {
      const result = await enqueueUpdate(store, id, patchRecord);
      if (!result.queued) {
        await (db[store] as any).put({ ...updated, synced: true });
      }
    } catch {
      // Network error — local update is preserved, will sync later
    }
  } else {
    // No remote-mappable fields — mark as synced since there's nothing to send
    await (db[store] as any).put({ ...updated, synced: true });
  }

  return updated;
}

export async function localDelete(store: StoreName, id: string): Promise<void> {
  // Delete locally first
  await (db[store] as any).delete(id);
  // Then sync/queue
  try {
    await enqueueDelete(store, id);
  } catch {
    // Network error — deletion will be synced later
  }
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  return await (db[store] as any).toArray();
}

export async function getById<T extends { id: string }>(
  store: StoreName,
  id: string,
): Promise<T | undefined> {
  return await (db[store] as any).get(id);
}

export async function pendingCount(): Promise<number> {
  return getPendingCount();
}

// ── Sync from server: pull schedule & ticket changes made externally (e.g. admin change requests) ──

function computeArrivalDatetime(departureIso: string): string {
  const dep = new Date(departureIso);
  if (isNaN(dep.getTime())) return new Date(Date.now() + 8 * 3600_000).toISOString();
  dep.setHours(dep.getHours() + 8);
  return dep.toISOString();
}

function mapRemoteScheduleToLocal(s: Record<string, unknown>): Record<string, unknown> {
  const depIso = s.departure_datetime as string;
  const depDate = depIso ? depIso.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const depTime = depIso ? depIso.slice(11, 16) : '00:00';
  return {
    id: s.id,
    route_id: s.route_id ?? null,
    route_name: s.route_name ?? null,
    bus_id: s.bus_id ?? null,
    driver_id: s.driver_id ?? null,
    departure_datetime: depIso,
    departure_date: depDate,
    departure_time: depTime,
    status: s.status ?? 'planifie',
    seats_total: s.seats_total ?? ((s.seats_available ?? 0) + (s.seats_reserved ?? 0)) ?? 0,
    seats_from: 1,
    seats_sold: s.seats_reserved ?? 0,
    station_id: s.departure_station_id ?? s.station_id ?? null,
    station_name: s.station_name ?? null,
    counter_id: s.counter_id ?? null,
    company_id: s.company_id ?? null,
    is_ac: false,
    is_ramassage: s.is_ramassage ?? false,
    ramassage_notified: false,
    confirmed: s.status === 'en_cours',
    cancelled: s.status === 'annule',
    cloture: s.status === 'termine',
    is_panne: s.status === 'panne',
    is_convoi: s.status === 'convoi',
    is_retard: s.status === 'retard',
    departure_number: s.departure_number ?? null,
    route_number: (s as any).route_number ?? s.route_number ?? null,
    mt_ticket: 0,
    mt_bagage: 0,
    tot_depense: 0,
    solde: 0,
    caisse: 0,
    breakdown_transfer: 0,
  };
}

function mapRemoteReservationToLocalTicket(r: Record<string, unknown>): Record<string, unknown> {
  const seatNumbers = Array.isArray(r.seat_numbers) ? r.seat_numbers as string[] : [];
  const firstSeat = seatNumbers.length > 0 ? parseInt(seatNumbers[0], 10) : 0;
  const status = r.status as string;
  return {
    id: r.id,
    depart_id: r.schedule_id,
    ticket_number: r.booking_reference ?? r.id,
    seat_number: firstSeat,
    seat_numbers: seatNumbers,
    destination: r.destination_city_name ?? '',
    destination_id: r.destination_city_id ?? null,
    passenger_name: r.passenger_name ?? '',
    passenger_phone: r.passenger_phone ?? '',
    price: Number(r.total_price ?? 0),
    original_price: Number(r.total_price ?? 0),
    is_reduced: false,
    is_reported: false,
    is_ac: false,
    print_ticket: true,
    payment_method: 'cash',
    status: status === 'annulee' ? 'cancelled' : 'sold',
    loyalty_card_number: r.loyalty_card_number ?? null,
    loyalty_name: null,
  };
}

export async function syncDepartsAndTicketsFromServer(stationId?: string): Promise<void> {
  if (!isOnline()) return;
  try {
    // Auto-close departures from past days (server UTC midnight rollover)
    // This runs BEFORE syncing so closed status is reflected in the pulled data
    try {
      await supabase.rpc('auto_terminate_past_schedules', {
        p_station_id: stationId ?? null,
      });
    } catch {
      // Non-critical: continue with sync even if auto-terminate fails
    }

    const todayStr = new Date().toISOString().slice(0, 10);

    // Auto-close locally cached departs from past days that are still open.
    // The server RPC already closed them in Supabase, but local IndexedDB may
    // still have stale rows with cloture=false. We only pull today+ schedules
    // below, so past-day rows would never get their cloture flag updated.
    try {
      const allLocal = await (db.departs as any).toArray();
      const toClose = allLocal.filter(
        (d: Record<string, unknown>) =>
          (d as any).departure_date < todayStr &&
          !(d as any).cloture &&
          !(d as any).cancelled,
      );
      for (const d of toClose) {
        await (db.departs as any).put({
          ...d,
          cloture: true,
          cloture_at: new Date().toISOString(),
          status: 'termine',
          updated_at: new Date().toISOString(),
          synced: true,
        });
      }
    } catch { /* non-critical */ }

    let scheduleQuery = supabase
      .from('schedules')
      .select('id, route_id, route_name, bus_id, driver_id, departure_datetime, status, seats_total, seats_available, seats_reserved, departure_station_id, counter_id, is_ramassage, departure_number, route_number, fill_rate')
      .gte('departure_datetime', `${todayStr}T00:00:00`)
      .order('departure_datetime', { ascending: true });

    const { data: remoteSchedules, error: schedError } = await scheduleQuery;
    if (schedError) throw schedError;

    if (remoteSchedules && remoteSchedules.length > 0) {
      const scheduleIds = remoteSchedules.map(s => s.id);

      for (const s of remoteSchedules) {
        const localRecord = mapRemoteScheduleToLocal(s as unknown as Record<string, unknown>);
        const existing = await (db.departs as any).get(s.id);
        if (existing) {
          await (db.departs as any).put({
            ...existing,
            ...localRecord,
            mt_ticket: existing.mt_ticket,
            mt_bagage: existing.mt_bagage,
            tot_depense: existing.tot_depense,
            solde: existing.mt_ticket + existing.mt_bagage - existing.tot_depense,
            caisse: existing.mt_ticket + existing.mt_bagage - existing.tot_depense,
            seat_allocations: existing.seat_allocations,
            seats_from: existing.seats_from,
            seats_total: existing.seats_total,
            bus_plate: existing.bus_plate,
            bus_name: existing.bus_name,
            driver_name: existing.driver_name,
            convoyeur_id: existing.convoyeur_id,
            convoyeur_name: existing.convoyeur_name,
            apprenti_id: existing.apprenti_id,
            apprenti_name: existing.apprenti_name,
            other_station_id: existing.other_station_id,
            other_station_name: existing.other_station_name,
            ramassage_notified: existing.ramassage_notified,
            arrival_station_id: existing.arrival_station_id,
            is_ramassage: existing.is_ramassage ?? localRecord.is_ramassage,
            source: existing.source,
            breakdown_transfer: existing.breakdown_transfer ?? 0,
          });
        } else {
          await (db.departs as any).put({ ...localRecord, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), synced: true });
        }
      }

      const { data: remoteReservations, error: resError } = await supabase
        .from('reservations')
        .select('id, schedule_id, seat_numbers, total_price, total_seats, passenger_name, passenger_phone, status, booking_reference, destination_city_name, destination_city_id, loyalty_card_number')
        .in('schedule_id', scheduleIds)
        .order('created_at', { ascending: true });

      if (!resError && remoteReservations) {
        for (const r of remoteReservations) {
          const ticketRecord = mapRemoteReservationToLocalTicket(r as unknown as Record<string, unknown>);
          const existingTicket = await (db.tickets as any).get(r.id);
          if (existingTicket) {
            await (db.tickets as any).put({ ...existingTicket, ...ticketRecord, updated_at: new Date().toISOString() });
          } else {
            await (db.tickets as any).put({ ...ticketRecord, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), synced: true });
          }
        }

        const { data: breakdownData } = await supabase
          .from('schedule_receipt_summary')
          .select('schedule_id, breakdown_transfer')
          .in('schedule_id', scheduleIds)
          .gt('breakdown_transfer', 0);

        const breakdownMap = new Map<string, number>();
        for (const b of breakdownData ?? []) {
          breakdownMap.set(b.schedule_id, Number(b.breakdown_transfer ?? 0));
        }

        for (const sid of scheduleIds) {
          const activeTickets = (remoteReservations as unknown as Record<string, unknown>[])
            .filter(r => r.schedule_id === sid && r.status !== 'annulee');
          const newSeatsSold = activeTickets.length;
          const grossMtTicket = activeTickets.reduce((sum, t) => sum + Number(t.total_price ?? 0), 0);
          const breakdownTransfer = breakdownMap.get(sid) ?? 0;
          const newMtTicket = grossMtTicket - breakdownTransfer;
          const existing = await (db.departs as any).get(sid);
          if (existing) {
            await (db.departs as any).put({
              ...existing,
              seats_sold: newSeatsSold,
              mt_ticket: newMtTicket,
              breakdown_transfer: breakdownTransfer,
              solde: newMtTicket + existing.mt_bagage - existing.tot_depense,
              caisse: newMtTicket + existing.mt_bagage - existing.tot_depense,
              updated_at: new Date().toISOString(),
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn('[sync] Failed to sync from server:', err);
  }
}

// Ensure auth store is initialized (side-effect import to avoid tree-shaking)
void useAuthStore;
