import { supabase } from '@/services/supabase';
import type {
  DepartRecord,
  TicketRecord,
  BagageRecord,
  DepenseRecord,
} from './db';

type StoreName = 'departs' | 'tickets' | 'bagages' | 'depenses';

const TABLE_MAP: Record<StoreName, string> = {
  departs: 'schedules',
  tickets: 'reservations',
  bagages: 'baggage_tickets',
  depenses: 'bus_expenses',
};

function uuid(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function getCurrentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id ?? null;
}

// ── Reverse mapping: Supabase row → POS local record ──

function mapScheduleToDepart(r: any): DepartRecord {
  const depIso = r.departure_datetime ?? new Date().toISOString();
  const depDate = depIso.slice(0, 10);
  const depTime = depIso.slice(11, 16);

  let bus_plate = r.bus_registration ?? '';
  let bus_name = r.bus_brand && r.bus_model ? `${r.bus_brand} ${r.bus_model}` : (r.bus_name ?? '');
  let driver_name = r.driver_name ?? '';

  const status = r.status ?? 'planifie';
  return {
    id: r.id,
    departure_number: r.departure_number ?? 0,
    route_id: r.route_id ?? '',
    route_name: r.route_name ?? '',
    route_number: r.departure_number ?? 0,
    bus_id: r.bus_id ?? '',
    bus_plate,
    bus_name,
    driver_id: r.driver_id ?? '',
    driver_name,
    convoyeur_id: undefined,
    convoyeur_name: undefined,
    apprenti_id: undefined,
    apprenti_name: undefined,
    departure_datetime: depIso,
    departure_date: depDate,
    departure_time: depTime,
    is_ac: r.is_ac ?? false,
    is_ramassage: r.is_ramassage ?? false,
    ramassage_notified: r.ramassage_notified ?? false,
    company_id: r.company_id,
    status,
    seats_total: r.seats_available ?? 0,
    seats_from: 1,
    seats_sold: r.seats_reserved ?? 0,
    seat_allocations: r.seat_allocations ?? undefined,
    station_id: r.departure_station_id ?? '',
    station_name: r.station_name ?? undefined,
    arrival_station_id: r.arrival_station_id ?? undefined,
    counter_id: r.counter_id ?? undefined,
    source: r.source ?? 'guichet',
    other_station_id: r.other_station_id ?? undefined,
    other_station_name: r.other_station_name ?? undefined,
    cloture: status === 'termine',
    cloture_at: r.cloture_at ?? undefined,
    cloture_by: r.cloture_by ?? undefined,
    mt_ticket: r.mt_ticket ?? 0,
    mt_bagage: r.mt_bagage ?? 0,
    tot_depense: r.tot_depense ?? 0,
    solde: r.solde ?? 0,
    caisse: r.caisse ?? 0,
    confirmed: status === 'en_cours',
    cancelled: status === 'annule',
    created_at: r.created_at ?? nowIso(),
    updated_at: r.updated_at ?? nowIso(),
    synced: true,
  };
}

function mapReservationToTicket(r: any): TicketRecord {
  const seats = Array.isArray(r.seat_numbers) ? r.seat_numbers : [];
  return {
    id: r.id,
    depart_id: r.schedule_id ?? '',
    ticket_number: r.booking_reference ?? '',
    seat_number: seats.length > 0 ? Number(seats[0]) : 0,
    seat_numbers: seats.map((s: any) => String(s)),
    destination: r.destination_city_name ?? '',
    destination_id: r.destination_id ?? undefined,
    passenger_name: r.passenger_name ?? '',
    passenger_phone: r.passenger_phone ?? '',
    price: Number(r.total_price ?? 0),
    original_price: Number(r.total_price ?? 0),
    is_reduced: false,
    is_reported: false,
    is_ac: false,
    print_ticket: true,
    payment_method: 'cash',
    status: r.status === 'annulee' ? 'cancelled' : 'sold',
    loyalty_card_number: r.loyalty_card_number ?? undefined,
    loyalty_name: r.loyalty_name ?? undefined,
    created_at: r.created_at ?? nowIso(),
    updated_at: r.updated_at ?? nowIso(),
    synced: true,
  };
}

function mapBaggageToBagage(r: any): BagageRecord {
  return {
    id: r.id,
    depart_id: r.schedule_id ?? '',
    bagage_number: r.baggage_number ?? '',
    ticket_id: r.reservation_id ?? undefined,
    ticket_number: r.ticket_number ?? undefined,
    with_ticket: r.has_ticket ?? false,
    with_ticket_report: false,
    price: Number(r.price ?? 0),
    destination: r.destination ?? '',
    description: r.description ?? '',
    car_plate: r.bus_registration ?? '',
    owner_name: r.owner_name ?? '',
    owner_phone: r.owner_phone ?? '',
    print_bagage: true,
    created_at: r.created_at ?? nowIso(),
    updated_at: r.updated_at ?? nowIso(),
    synced: true,
  };
}

function mapExpenseToDepense(r: any): DepenseRecord {
  return {
    id: r.id,
    depart_id: r.schedule_id ?? '',
    type: r.expense_type ?? 'autre',
    label: r.description ?? '',
    amount: Number(r.amount ?? 0),
    description: r.description ?? '',
    station_id: r.station_id ?? '',
    expense_date: r.expense_date ?? new Date().toISOString().slice(0, 10),
    created_at: r.created_at ?? nowIso(),
    updated_at: r.updated_at ?? nowIso(),
    synced: true,
  };
}

// ── Forward mapping: POS local record → Supabase row ──

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
    is_ramassage: p.is_ramassage === true,
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
  'carburant': 'carburant',
  'péage': 'peage',
  'peage': 'peage',
  'réparation': 'reparation',
  'reparation': 'reparation',
  'achat stock': 'autres',
  'frais route': 'taxe_route',
  'autre': 'autre',
  'autres': 'autres',
  'assurance': 'assurance',
  'taxes': 'taxes',
  'lavage': 'lavage',
  'vignette': 'vignette',
  'visite technique': 'visite_technique',
  'visite_technique': 'visite_technique',
  'parking': 'parking',
  'amende': 'amende',
  'taxe route': 'taxe_route',
  'taxe_route': 'taxe_route',
};

function normalizeExpenseType(raw: string | undefined): string {
  if (!raw) return 'autre';
  const key = raw.trim().toLowerCase();
  return EXPENSE_TYPE_MAP[key] ?? 'autre';
}

function mapDepenseInsert(payload: Record<string, unknown>): Record<string, unknown> {
  const p = payload;
  return {
    id: p.id,
    bus_id: p.bus_id ?? null,
    expense_type: normalizeExpenseType((p.type as string) ?? (p.label as string)),
    amount: p.amount ?? 0,
    description: (p.description as string) ?? (p.label as string) ?? '',
    expense_date: (p.expense_date as string) ?? new Date().toISOString().slice(0, 10),
    status: 'en_attente',
    created_at: p.created_at ?? nowIso(),
  };
}

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

// ── Public API: all reads and writes go directly to Supabase ──

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

  return full;
}

export async function localUpdate<
  T extends { id: string; updated_at: string; synced?: boolean },
>(
  store: StoreName,
  id: string,
  patch: Partial<T>,
): Promise<T | null> {
  const existing = await getById<T>(store as any, id);
  if (!existing) return null;

  const updated = {
    ...existing,
    ...patch,
    id,
    updated_at: nowIso(),
    synced: true,
  } as unknown as T;

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

  return updated;
}

export async function localDelete(store: StoreName, id: string): Promise<void> {
  const table = TABLE_MAP[store];
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error && !error.message.includes('0 rows')) throw error;
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const table = TABLE_MAP[store];
  const { data, error } = await supabase.from(table).select('*');
  if (error) throw error;
  if (!data) return [];

  const mapper =
    store === 'departs' ? mapScheduleToDepart :
    store === 'tickets' ? mapReservationToTicket :
    store === 'bagages' ? mapBaggageToBagage :
    mapExpenseToDepense;

  return (data as any[]).map(mapper) as T[];
}

export async function getById<T extends { id: string }>(
  store: StoreName,
  id: string,
): Promise<T | undefined> {
  const table = TABLE_MAP[store];
  const { data, error } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return undefined;

  const mapper =
    store === 'departs' ? mapScheduleToDepart :
    store === 'tickets' ? mapReservationToTicket :
    store === 'bagages' ? mapBaggageToBagage :
    mapExpenseToDepense;

  return mapper(data) as T;
}

export async function pendingCount(): Promise<number> {
  return 0;
}
