import { db, type SyncQueueItem } from './db';
import { supabase } from '@/services/supabase';

const TABLE_MAP: Record<string, string> = {
  departs: 'schedules',
  tickets: 'reservations',
  bagages: 'baggage_tickets',
  depenses: 'bus_expenses',
};

const MAX_TRIES = 10;

export interface SyncErrorDetail {
  queueId: number;
  entity: string;
  op: string;
  tries: number;
  error: string;
  errorType: ErrorType;
  payloadId: string;
}

export type ErrorType =
  | 'duplicate'
  | 'rls'
  | 'missing_column'
  | 'constraint'
  | 'network'
  | 'unknown';

type SyncEvent =
  | 'start'
  | 'item-ok'
  | 'item-error'
  | 'done'
  | 'idle'
  | 'errors-updated';

type SyncListener = (
  event: SyncEvent,
  detail?: { count?: number; remaining?: number; error?: string; errors?: SyncErrorDetail[] },
) => void;

const listeners = new Set<SyncListener>();
let syncing = false;
let lastSyncAt = 0;
let hasResetErrors = false;

export function onSyncEvent(listener: SyncListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(
  event: SyncEvent,
  detail?: { count?: number; remaining?: number; error?: string; errors?: SyncErrorDetail[] },
) {
  listeners.forEach((l) => l(event, detail));
}

export function isSyncing(): boolean {
  return syncing;
}

export function getLastSyncAt(): number {
  return lastSyncAt;
}

export async function checkOnlineStatus(): Promise<boolean> {
  if (!navigator.onLine) return false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${supabase.supabaseUrl}/rest/v1/`, {
      method: 'GET',
      headers: { apikey: supabase.supabaseKey },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.status < 500;
  } catch {
    return false;
  }
}

function classifyError(err: any): ErrorType {
  const msg = (typeof err === 'string' ? err : err?.message ?? '').toLowerCase();
  if (msg.includes('duplicate') || msg.includes('unique constraint') || msg.includes('23505'))
    return 'duplicate';
  if (msg.includes('row-level security') || msg.includes('row level security') || msg.includes('rls') || msg.includes('42501'))
    return 'rls';
  if (msg.includes('column') && (msg.includes('does not exist') || msg.includes('not found') || msg.includes('schema cache')))
    return 'missing_column';
  if (msg.includes('constraint') || msg.includes('foreign key') || msg.includes('23503') || msg.includes('23502') || msg.includes('violates not-null'))
    return 'constraint';
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout') || msg.includes('abort'))
    return 'network';
  return 'unknown';
}

export async function getErrorItems(): Promise<SyncErrorDetail[]> {
  const items = await db.sync_queue.where('status').equals('error').toArray();
  return items.map((i) => ({
    queueId: i.id!,
    entity: i.entity,
    op: i.op,
    tries: i.tries,
    error: i.last_error ?? 'Erreur inconnue',
    errorType: classifyError(i.last_error),
    payloadId: (i.payload.id as string) ?? '?',
  }));
}

export async function retryAllErrors(): Promise<void> {
  const items = await db.sync_queue.where('status').equals('error').toArray();
  for (const item of items) {
    await db.sync_queue.update(item.id!, {
      status: 'pending',
      tries: 0,
      last_error: undefined,
    });
  }
  emit('errors-updated');
}

export async function forceSyncItem(queueId: number): Promise<void> {
  await db.sync_queue.update(queueId, {
    status: 'pending',
    tries: 0,
    last_error: undefined,
  });
  emit('errors-updated');
}

export async function discardErrorItem(queueId: number): Promise<void> {
  await db.sync_queue.delete(queueId);
  emit('errors-updated');
}

async function resetAllErrorsOnce(): Promise<void> {
  if (hasResetErrors) return;
  hasResetErrors = true;
  const items = await db.sync_queue.where('status').equals('error').toArray();
  for (const item of items) {
    await db.sync_queue.update(item.id!, {
      status: 'pending',
      tries: 0,
      last_error: undefined,
    });
  }
}

export async function syncNow(): Promise<{ synced: number; failed: number }> {
  if (syncing) return { synced: 0, failed: 0 };

  const online = await checkOnlineStatus();
  if (!online) {
    emit('idle');
    return { synced: 0, failed: 0 };
  }

  syncing = true;
  emit('start');

  await resetAllErrorsOnce();

  let synced = 0;
  let failed = 0;

  try {
    const items = await db.sync_queue
      .where('status')
      .anyOf(['pending', 'syncing'])
      .sortBy('created_at');

    for (const item of items) {
      if (item.tries >= MAX_TRIES) {
        await db.sync_queue.update(item.id!, { status: 'error' });
        failed++;
        continue;
      }

      try {
        await db.sync_queue.update(item.id!, { status: 'syncing' });

        const shouldSkip = await applyRemote(item);
        if (shouldSkip === 'skip') {
          await db.sync_queue.delete(item.id!);
          synced++;
          emit('item-ok', { remaining: items.length - synced - failed });
          continue;
        }

        await db.sync_queue.delete(item.id!);
        synced++;
        emit('item-ok', { remaining: items.length - synced - failed });
      } catch (err: any) {
        const errMsg = err?.message ?? 'Unknown error';
        const errType = classifyError(errMsg);

        if (errType === 'duplicate') {
          await db.sync_queue.delete(item.id!);
          synced++;
          emit('item-ok', { remaining: items.length - synced - failed });
          continue;
        }

        const newTries = item.tries + 1;
        await db.sync_queue.update(item.id!, {
          status: newTries >= MAX_TRIES ? 'error' : 'pending',
          tries: newTries,
          last_error: errMsg,
        });
        failed++;
        emit('item-error', {
          error: errMsg,
          remaining: items.length - synced - failed,
        });
      }
    }

    lastSyncAt = Date.now();
    emit('done', { count: synced, remaining: failed });

    const errors = await getErrorItems();
    if (errors.length > 0) emit('errors-updated', { errors });
  } finally {
    syncing = false;
    if (failed === 0) emit('idle');
  }

  return { synced, failed };
}

// ── Field mapping: local POS record → remote Supabase row ──
// REMOTE SCHEMAS (only these columns exist):
// schedules: id, route_id, bus_id, driver_id, departure_station_id, arrival_station_id, departure_datetime, arrival_datetime, status, seats_available, seats_reserved, price, created_by, created_at, updated_at, route_name, fill_rate, notes, is_ramassage, is_anticipated
// reservations: id, schedule_id, customer_id, passenger_name, passenger_phone, seat_numbers, total_seats, total_price, status, payment_status, booking_reference, qr_code, booked_by, created_at, updated_at, baggage_fee, destination_city_name
// baggage_tickets: id, baggage_number, schedule_id, reservation_id, destination, price, seat_number, departure_number, bus_registration, description, owner_name, owner_phone, has_ticket, counter_id, station_id, sold_by, created_at
// bus_expenses: id, bus_id, expense_type, amount, description, expense_date, receipt_url, status, validated_by, created_by, created_at

// Fields that are LOCAL ONLY and have no remote equivalent — updates containing ONLY these should be skipped
const LOCAL_ONLY_FIELDS = new Set([
  'mt_ticket', 'mt_bagage', 'tot_depense', 'solde', 'caisse',
  'cloture_at', 'cloture_by', 'departure_number', 'route_number',
  'bus_plate', 'bus_name', 'driver_name', 'convoyeur_id', 'convoyeur_name',
  'apprenti_id', 'apprenti_name', 'departure_date', 'departure_time',
  'is_ac', 'seats_from', 'seat_allocations', 'station_name',
  'counter_id', 'other_station_id', 'other_station_name',
  'synced', 'updated_at', 'id',
  'ticket_number', 'original_price', 'is_reduced', 'is_reported',
  'print_ticket', 'payment_method', 'loyalty_card_number', 'loyalty_name',
  'with_ticket', 'with_ticket_report', 'print_bagage', 'car_plate',
  'bagage_number', 'ticket_id', 'label',
]);

function hasRemoteMappableFields(entity: string, payload: Record<string, unknown>): boolean {
  const keys = Object.keys(payload).filter(k => k !== 'id' && k !== 'updated_at' && k !== 'synced');
  if (keys.length === 0) return false;

  if (entity === 'departs') {
    const remoteMappable = ['route_id', 'bus_id', 'driver_id', 'station_id', 'departure_datetime', 'status', 'seats_total', 'seats_sold', 'route_name', 'confirmed', 'cancelled', 'cloture'];
    return keys.some(k => remoteMappable.includes(k));
  }
  if (entity === 'tickets') {
    const remoteMappable = ['depart_id', 'seat_number', 'seat_numbers', 'destination', 'destination_id', 'passenger_name', 'passenger_phone', 'price', 'status'];
    return keys.some(k => remoteMappable.includes(k));
  }
  if (entity === 'bagages') {
    const remoteMappable = ['depart_id', 'destination', 'price', 'description', 'owner_name', 'owner_phone', 'with_ticket'];
    return keys.some(k => remoteMappable.includes(k));
  }
  if (entity === 'depenses') {
    const remoteMappable = ['type', 'amount', 'description', 'expense_date', 'bus_id'];
    return keys.some(k => remoteMappable.includes(k));
  }
  return true;
}

async function getCurrentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id ?? null;
}

function mapDepartInsert(payload: Record<string, unknown>): Record<string, unknown> {
  const p = payload;
  const status = p.cancelled ? 'cancelled' : p.cloture ? 'completed' : p.confirmed ? 'confirmed' : (p.status as string ?? 'scheduled');

  return {
    id: p.id,
    route_id: p.route_id ?? null,
    bus_id: p.bus_id ?? null,
    driver_id: p.driver_id ?? null,
    departure_station_id: p.station_id ?? null,
    departure_datetime: p.departure_datetime,
    arrival_datetime: p.departure_datetime,
    status,
    seats_available: p.seats_total ?? 0,
    seats_reserved: p.seats_sold ?? 0,
    route_name: p.route_name ?? null,
    created_at: p.created_at ?? new Date().toISOString(),
    updated_at: p.updated_at ?? new Date().toISOString(),
    is_ramassage: false,
    is_anticipated: false,
  };
}

function mapDepartUpdate(payload: Record<string, unknown>): Record<string, unknown> | null {
  const p = payload;
  const result: Record<string, unknown> = {};

  if (p.seats_sold !== undefined) result.seats_reserved = p.seats_sold;
  if (p.seats_total !== undefined) result.seats_available = p.seats_total;
  if (p.status !== undefined) result.status = p.status;
  if (p.confirmed === true) result.status = 'confirmed';
  if (p.cancelled === true) result.status = 'cancelled';
  if (p.cloture === true) result.status = 'completed';
  if (p.route_name !== undefined) result.route_name = p.route_name;
  if (p.bus_id !== undefined) result.bus_id = p.bus_id;
  if (p.driver_id !== undefined) result.driver_id = p.driver_id;
  if (p.station_id !== undefined) result.departure_station_id = p.station_id;
  if (p.departure_datetime !== undefined) {
    result.departure_datetime = p.departure_datetime;
    result.arrival_datetime = p.departure_datetime;
  }

  result.updated_at = new Date().toISOString();

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
    status: p.status === 'cancelled' ? 'cancelled' : 'confirmed',
    payment_status: p.status === 'cancelled' ? 'refunded' : 'paid',
    booking_reference: p.ticket_number ?? null,
    created_at: p.created_at ?? new Date().toISOString(),
    updated_at: p.updated_at ?? new Date().toISOString(),
  };

  if (p.destination) result.destination_city_name = p.destination;

  return result;
}

function mapTicketUpdate(payload: Record<string, unknown>): Record<string, unknown> | null {
  const p = payload;
  const result: Record<string, unknown> = {};

  if (p.status !== undefined) {
    result.status = p.status === 'cancelled' ? 'cancelled' : 'confirmed';
    result.payment_status = p.status === 'cancelled' ? 'refunded' : 'paid';
  }
  if (p.passenger_name !== undefined) result.passenger_name = p.passenger_name;
  if (p.passenger_phone !== undefined) result.passenger_phone = p.passenger_phone;
  if (p.price !== undefined) result.total_price = p.price;

  result.updated_at = new Date().toISOString();

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
    created_at: p.created_at ?? new Date().toISOString(),
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
    created_at: p.created_at ?? new Date().toISOString(),
  };
}

async function applyRemote(item: SyncQueueItem): Promise<void | 'skip'> {
  const table = TABLE_MAP[item.entity] ?? item.entity;
  const id = (item.payload.id as string) ?? '';
  const userId = await getCurrentUserId();

  if (item.op === 'delete') {
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error && !error.message.includes('0 rows')) throw error;
    return;
  }

  // For updates, check if there are any remotely-mappable fields
  if (item.op === 'update') {
    if (!hasRemoteMappableFields(item.entity, item.payload)) {
      return 'skip';
    }

    let updatePayload: Record<string, unknown> | null = null;

    if (item.entity === 'departs') {
      updatePayload = mapDepartUpdate(item.payload);
    } else if (item.entity === 'tickets') {
      updatePayload = mapTicketUpdate(item.payload);
    } else {
      // bagages and depenses updates are rare, skip if only local fields
      return 'skip';
    }

    if (!updatePayload) return 'skip';

    const { error } = await supabase
      .from(table)
      .update(updatePayload)
      .eq('id', id);

    if (error) {
      if (error.message.includes('0 rows')) return 'skip';
      throw error;
    }
    return;
  }

  // INSERT operation
  let remotePayload: Record<string, unknown>;

  if (item.entity === 'departs') {
    remotePayload = mapDepartInsert(item.payload);
    if (userId) remotePayload.created_by = userId;
  } else if (item.entity === 'tickets') {
    remotePayload = mapTicketInsert(item.payload);
    if (userId) remotePayload.booked_by = userId;
  } else if (item.entity === 'bagages') {
    remotePayload = mapBagageInsert(item.payload);
    if (userId) remotePayload.sold_by = userId;
  } else if (item.entity === 'depenses') {
    remotePayload = mapDepenseInsert(item.payload);
    if (userId) remotePayload.created_by = userId;
  } else {
    return 'skip';
  }

  const { error } = await supabase.from(table).upsert(remotePayload);
  if (error) throw error;
}

function stripLocalFields(payload: Record<string, unknown>): Record<string, unknown> {
  const { synced, ...rest } = payload;
  void synced;
  return rest;
}
