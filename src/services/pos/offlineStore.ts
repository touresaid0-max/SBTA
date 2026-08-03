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
  depenses: 'bus_expenses',
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
    departure_datetime: depIso,
    arrival_datetime: computeArrivalDatetime(depIso),
    status,
    seats_available: p.seats_total ?? 0,
    seats_reserved: p.seats_sold ?? 0,
    route_name: p.route_name ?? null,
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
    payment_status: p.status === 'cancelled' ? 'refunded' : 'paid',
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
    result.payment_status = p.status === 'cancelled' ? 'refunded' : 'paid';
  }
  if (p.passenger_name !== undefined) result.passenger_name = p.passenger_name;
  if (p.passenger_phone !== undefined) result.passenger_phone = p.passenger_phone;
  if (p.price !== undefined) result.total_price = p.price;

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

function mapDepenseInsert(payload: Record<string, unknown>): Record<string, unknown> {
  const p = payload;
  return {
    id: p.id,
    bus_id: p.bus_id ?? null,
    expense_type: (p.type as string) ?? (p.label as string) ?? 'autre',
    amount: p.amount ?? 0,
    description: (p.description as string) ?? (p.label as string) ?? '',
    expense_date: (p.expense_date as string) ?? new Date().toISOString().slice(0, 10),
    status: 'en_attente',
    created_at: p.created_at ?? nowIso(),
  };
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
    remotePayload = mapDepenseInsert(full as unknown as Record<string, unknown>);
    const userId = await getCurrentUserId();
    if (userId) remotePayload.created_by = userId;
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

// Ensure auth store is initialized (side-effect import to avoid tree-shaking)
void useAuthStore;
