import { db } from './db';
import { supabase } from '@/services/supabase';
import { useAuthStore } from '@/store/authStore';

function uuid(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

type StoreName = 'departs' | 'tickets' | 'bagages' | 'depenses';

const TABLE_MAP: Record<StoreName, string> = {
  departs: 'schedules',
  tickets: 'reservations',
  bagages: 'baggage_tickets',
  depenses: 'counter_charges',
};

async function getCurrentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id ?? null;
}

// ── Field mapping: local POS record → remote Supabase row ──

function computeArrivalDatetime(departureIso: string): string {
  const dep = new Date(departureIso);
  if (isNaN(dep.getTime())) return new Date(Date.now() + 8 * 3600_000).toISOString();
  dep.setHours(dep.getHours() + 8);
  return dep.toISOString();
}

function mapDepartInsert(payload: Record<string, unknown>): Record<string, unknown> {
  const p = payload;
  const status = p.cancelled ? 'annule' : p.cloture ? 'termine' : (p.status as string === 'confirmed' ? 'en_cours' : 'planifie');
  const depIso = p.departure_datetime as string;

  return {
    id: p.id,
    route_id: p.route_id ?? null,
    bus_id: p.bus_id ?? null,
    driver_id: p.driver_id ?? null,
    departure_station_id: p.station_id ?? null,
    arrival_station_id: p.arrival_station_id ?? null,
    departure_datetime: depIso,
    arrival_datetime: computeArrivalDatetime(depIso),
    status,
    seats_available: p.seats_total ?? 0,
    seats_reserved: p.seats_sold ?? 0,
    route_name: p.route_name ?? null,
    source: 'guichet',
    counter_id: p.counter_id ?? null,
    departure_number: p.departure_number ?? null,
    created_at: p.created_at ?? nowIso(),
    updated_at: p.updated_at ?? nowIso(),
    is_ramassage: false,
    is_anticipated: false,
  };
}

function mapDepartUpdate(payload: Record<string, unknown>): Record<string, unknown> | null {
  const p = payload;
  const result: Record<string, unknown> = {};

  if (p.seats_sold !== undefined) result.seats_reserved = p.seats_sold;
  if (p.seats_total !== undefined) result.seats_available = p.seats_total;
  if (p.cancelled === true) result.status = 'annule';
  if (p.cloture === true) result.status = 'termine';
  if (p.confirmed === true) result.status = 'en_cours';
  if (p.status !== undefined && !result.status) result.status = p.status;
  if (p.route_name !== undefined) result.route_name = p.route_name;
  if (p.bus_id !== undefined) result.bus_id = p.bus_id;
  if (p.driver_id !== undefined) result.driver_id = p.driver_id;
  if (p.station_id !== undefined) result.departure_station_id = p.station_id;
  if (p.departure_datetime !== undefined) {
    result.departure_datetime = p.departure_datetime;
    result.arrival_datetime = computeArrivalDatetime(p.departure_datetime as string);
  }

  result.updated_at = nowIso();

  if (Object.keys(result).length <= 1) return null;
  return result;
}

function mapTicketInsert(payload: Record<string, unknown>): Record<string, unknown> {
  const p = payload;
  const seats = Array.isArray(p.seat_numbers) && (p.seat_numbers as unknown[]).length > 0
    ? p.seat_numbers
    : p.seat_number != null ? [String(p.seat_number)] : [];

  const result: Record<string, unknown> = {
    id: p.id,
    schedule_id: p.depart_id,
    passenger_name: (p.passenger_name as string) || 'Passager',
    passenger_phone: p.passenger_phone ?? null,
    seat_numbers: seats,
    total_seats: (seats as unknown[]).length || 1,
    total_price: p.price ?? 0,
    status: p.status === 'cancelled' ? 'annulee' : 'confirmee',
    payment_status: p.status === 'cancelled' ? 'remboursee' : 'payee',
    booking_reference: p.ticket_number ?? null,
    created_at: p.created_at ?? nowIso(),
    updated_at: p.updated_at ?? nowIso(),
  };

  if (p.destination) result.destination_city_name = p.destination;

  return result;
}

function mapTicketUpdate(payload: Record<string, unknown>): Record<string, unknown> | null {
  const p = payload;
  const result: Record<string, unknown> = {};

  if (p.status !== undefined) {
    result.status = p.status === 'cancelled' ? 'annulee' : 'confirmee';
    result.payment_status = p.status === 'cancelled' ? 'remboursee' : 'payee';
  }
  if (p.passenger_name !== undefined) result.passenger_name = p.passenger_name;
  if (p.passenger_phone !== undefined) result.passenger_phone = p.passenger_phone;
  if (p.price !== undefined) result.total_price = p.price;
  if (p.depart_id !== undefined) result.schedule_id = p.depart_id;
  if (p.seat_number !== undefined) {
    result.seat_numbers = [String(p.seat_number)];
    result.total_seats = 1;
  }

  result.updated_at = nowIso();

  if (Object.keys(result).length <= 1) return null;
  return result;
}

function mapBagageInsert(payload: Record<string, unknown>): Record<string, unknown> {
  const p = payload;
  return {
    id: p.id,
    baggage_number: p.bagage_number ?? `BAG-${Date.now()}`,
    schedule_id: p.depart_id ?? null,
    reservation_id: p.ticket_id ?? null,
    destination: p.destination ?? '',
    price: p.price ?? 0,
    seat_number: null,
    bus_registration: p.car_plate ?? null,
    description: p.description ?? null,
    owner_name: p.owner_name ?? '',
    owner_phone: p.owner_phone ?? '',
    has_ticket: p.with_ticket ?? false,
    station_id: p.station_id ?? null,
    counter_id: p.counter_id ?? null,
    created_at: p.created_at ?? nowIso(),
  };
}

const EXPENSE_TYPE_MAP: Record<string, string> = {
  'carburant compl.': 'carburant_complement',
  'carburant': 'carburant_complement',
  'péage': 'peage',
  'peage': 'peage',
  'frais de route': 'ration',
  'frais route': 'ration',
  'ration': 'ration',
  'autre': 'autres',
  'autres': 'autres',
};

function normalizeExpenseType(raw: string | undefined): string {
  if (!raw) return 'autres';
  const key = raw.trim().toLowerCase();
  return EXPENSE_TYPE_MAP[key] ?? 'autres';
}

const UNIQUE_CHARGE_TYPES = new Set(['ration', 'carburant_complement', 'peage']);

async function mapDepenseInsert(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const p = payload;
  const chargeType = normalizeExpenseType((p.type as string) ?? (p.label as string));
  const scheduleId = (p.depart_id as string) ?? null;

  const row = {
    id: p.id,
    schedule_id: scheduleId,
    counter_id: p.counter_id ?? null,
    station_id: p.station_id ?? null,
    bus_id: p.bus_id ?? null,
    charge_type: chargeType,
    description: (p.description as string) || (p.label as string) || '',
    amount: p.amount ?? 0,
    charge_date: (p.expense_date as string) ?? new Date().toISOString().slice(0, 10),
    status: 'en_attente',
    created_at: p.created_at ?? nowIso(),
  };

  if (UNIQUE_CHARGE_TYPES.has(chargeType) && scheduleId) {
    const { data: existing } = await supabase
      .from('counter_charges')
      .select('id')
      .eq('schedule_id', scheduleId)
      .eq('charge_type', chargeType)
      .maybeSingle();
    if (existing) {
      await supabase
        .from('counter_charges')
        .update({
          amount: row.amount,
          description: row.description,
          charge_date: row.charge_date,
          updated_at: nowIso(),
        })
        .eq('id', existing.id);
      return null;
    }
  }
  return row;
}

// Fields that are LOCAL ONLY — updates containing ONLY these should not be sent to remote
const LOCAL_ONLY_UPDATE_FIELDS = new Set([
  'mt_ticket', 'mt_bagage', 'tot_depense', 'solde', 'caisse',
  'cloture_at', 'cloture_by', 'departure_number', 'route_number',
  'bus_plate', 'bus_name', 'driver_name', 'convoyeur_id', 'convoyeur_name',
  'apprenti_id', 'apprenti_name', 'departure_date', 'departure_time',
  'is_ac', 'seats_from', 'seat_allocations', 'station_name',
  'counter_id', 'other_station_id', 'other_station_name',
  'synced', 'updated_at', 'id',
]);

function hasRemoteMappableFields(entity: StoreName, patch: Record<string, unknown>): boolean {
  const keys = Object.keys(patch).filter(k => !LOCAL_ONLY_UPDATE_FIELDS.has(k));
  if (keys.length === 0) return false;

  if (entity === 'departs') {
    const remoteMappable = ['route_id', 'bus_id', 'driver_id', 'station_id', 'departure_datetime', 'status', 'seats_total', 'seats_sold', 'route_name', 'confirmed', 'cancelled', 'cloture'];
    return keys.some(k => remoteMappable.includes(k));
  }
  if (entity === 'tickets') {
    const remoteMappable = ['depart_id', 'seat_number', 'seat_numbers', 'destination', 'destination_id', 'passenger_name', 'passenger_phone', 'price', 'status'];
    return keys.some(k => remoteMappable.includes(k));
  }
  return false;
}

// ── Public API: same signatures as before, but now writes to Supabase in real-time ──

export async function localInsert<
  T extends { id: string; created_at: string; updated_at: string; synced?: boolean },
>(
  store: StoreName,
  record: Omit<T, 'id' | 'created_at' | 'updated_at' | 'synced'> & Partial<T>,
): Promise<T> {
  const id = record.id ?? uuid();
  const ts = nowIso();
  const full = {
    ...record,
    id,
    created_at: record.created_at ?? ts,
    updated_at: ts,
    synced: true,
  } as unknown as T;

  // Write to Supabase immediately
  const table = TABLE_MAP[store];
  let remotePayload: Record<string, unknown>;

  if (store === 'departs') {
    remotePayload = mapDepartInsert(full as unknown as Record<string, unknown>);
    const userId = await getCurrentUserId();
    if (userId) remotePayload.created_by = userId;
  } else if (store === 'tickets') {
    remotePayload = mapTicketInsert(full as unknown as Record<string, unknown>);
    const userId = await getCurrentUserId();
    if (userId) remotePayload.booked_by = userId;
  } else if (store === 'bagages') {
    remotePayload = mapBagageInsert(full as unknown as Record<string, unknown>);
    const userId = await getCurrentUserId();
    if (userId) remotePayload.sold_by = userId;
  } else if (store === 'depenses') {
    const depensePayload = await mapDepenseInsert(full as unknown as Record<string, unknown>);
    if (depensePayload) {
      remotePayload = depensePayload;
      const userId = await getCurrentUserId();
      if (userId) remotePayload.created_by = userId;
    } else {
      await (db[store] as any).put(full);
      return full;
    }
  } else {
    return full;
  }

  const { error } = await supabase.from(table).upsert(remotePayload);
  if (error) throw error;

  // Also keep in local IndexedDB for POS display
  await (db[store] as any).put(full);
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

  const updated = {
    ...existing,
    ...patch,
    id,
    updated_at: nowIso(),
    synced: true,
  } as unknown as T;

  // Write to Supabase if there are remotely-mappable fields
  const patchRecord = patch as unknown as Record<string, unknown>;
  let remotePayload: Record<string, unknown> | null = null;

  if (store === 'departs') {
    remotePayload = mapDepartUpdate({ id, ...patchRecord });
  } else if (store === 'tickets') {
    remotePayload = mapTicketUpdate({ id, ...patchRecord });
  }

  if (remotePayload && hasRemoteMappableFields(store, patchRecord)) {
    const table = TABLE_MAP[store];
    const { error } = await supabase.from(table).update(remotePayload).eq('id', id);
    if (error && !error.message.includes('0 rows')) throw error;
  }

  await (db[store] as any).put(updated);
  return updated;
}

export async function localDelete(store: StoreName, id: string): Promise<void> {
  const table = TABLE_MAP[store];
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error && !error.message.includes('0 rows')) throw error;
  await (db[store] as any).delete(id);
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
  return 0;
}

// ── Sync from server: pull schedule & ticket changes made externally (e.g. admin change requests) ──

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
    seats_total: s.seats_total ?? s.seats_available ?? 0,
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
    departure_number: s.departure_number ?? null,
    route_number: s.route_number ?? null,
    mt_ticket: 0,
    mt_bagage: 0,
    tot_depense: 0,
    solde: 0,
    caisse: 0,
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
  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    let scheduleQuery = supabase
      .from('schedules')
      .select('id, route_id, route_name, bus_id, driver_id, departure_datetime, status, seats_total, seats_available, seats_reserved, departure_station_id, station_id, station_name, counter_id, company_id, is_ramassage, departure_number, route_number, fill_rate')
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
            source: existing.source,
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

        for (const sid of scheduleIds) {
          const activeTickets = (remoteReservations as unknown as Record<string, unknown>[])
            .filter(r => r.schedule_id === sid && r.status !== 'annulee');
          const newSeatsSold = activeTickets.length;
          const newMtTicket = activeTickets.reduce((sum, t) => sum + Number(t.total_price ?? 0), 0);
          const existing = await (db.departs as any).get(sid);
          if (existing) {
            await (db.departs as any).put({
              ...existing,
              seats_sold: newSeatsSold,
              mt_ticket: newMtTicket,
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
