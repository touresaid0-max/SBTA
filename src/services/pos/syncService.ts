import { db, type SyncQueueItem } from './db';
import { supabase } from '@/services/supabase';

const TABLE_MAP: Record<string, string> = {
  departs: 'schedules',
  tickets: 'reservations',
  bagages: 'baggage_tickets',
  depenses: 'bus_expenses',
};

const MAX_TRIES = 5;

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
  const msg = (err?.message ?? '').toLowerCase();
  if (msg.includes('duplicate') || msg.includes('unique constraint') || msg.includes('23505'))
    return 'duplicate';
  if (msg.includes('row-level security') || msg.includes('rls') || msg.includes('42501'))
    return 'rls';
  if (msg.includes('column') && (msg.includes('does not exist') || msg.includes('missing')))
    return 'missing_column';
  if (msg.includes('constraint') || msg.includes('foreign key') || msg.includes('23503') || msg.includes('23502'))
    return 'constraint';
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout') || msg.includes('abort'))
    return 'network';
  return 'unknown';
}

export async function getErrorItems(): Promise<SyncErrorDetail[]> {
  const items = await db.sync_queue.where('status').equals('error').toArray();
  return items
    .filter((i) => i.tries >= MAX_TRIES)
    .map((i) => ({
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

export async function syncNow(): Promise<{ synced: number; failed: number }> {
  if (syncing) return { synced: 0, failed: 0 };

  const online = await checkOnlineStatus();
  if (!online) {
    emit('idle');
    return { synced: 0, failed: 0 };
  }

  syncing = true;
  emit('start');

  let synced = 0;
  let failed = 0;

  try {
    const items = await db.sync_queue
      .where('status')
      .anyOf(['pending', 'error'])
      .sortBy('created_at');

    for (const item of items) {
      if (item.tries >= MAX_TRIES) {
        failed++;
        continue;
      }

      try {
        await db.sync_queue.update(item.id!, { status: 'syncing' });
        await applyRemote(item);
        await db.sync_queue.delete(item.id!);
        synced++;
        emit('item-ok', { remaining: items.length - synced - failed });
      } catch (err: any) {
        const newTries = item.tries + 1;
        await db.sync_queue.update(item.id!, {
          status: newTries >= MAX_TRIES ? 'error' : 'pending',
          tries: newTries,
          last_error: err?.message ?? 'Unknown error',
        });
        failed++;
        emit('item-error', {
          error: err?.message,
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
// Each mapper ONLY returns columns that exist in the target table.
// schedules: id, route_id, bus_id, driver_id, departure_station_id, arrival_station_id, departure_datetime, arrival_datetime, status, seats_available, seats_reserved, price, created_by, created_at, updated_at, route_name, fill_rate, notes, is_ramassage, is_anticipated
// reservations: id, schedule_id, customer_id, passenger_name, passenger_phone, seat_numbers, total_seats, total_price, status, payment_status, booking_reference, qr_code, booked_by, created_at, updated_at, baggage_fee, destination_city_name
// baggage_tickets: id, baggage_number, schedule_id, reservation_id, destination, price, seat_number, departure_number, bus_registration, description, owner_name, owner_phone, has_ticket, counter_id, station_id, sold_by, created_at
// bus_expenses: id, bus_id, expense_type, amount, description, expense_date, receipt_url, status, validated_by, created_by, created_at

async function getCurrentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id ?? null;
}

function mapDepart(payload: Record<string, unknown>): Record<string, unknown> {
  const p = payload;
  const status = p.cancelled ? 'cancelled' : p.cloture ? 'completed' : p.confirmed ? 'confirmed' : (p.status ?? 'scheduled');

  const result: Record<string, unknown> = { id: p.id };

  if (p.route_id !== undefined) result.route_id = p.route_id ?? null;
  if (p.bus_id !== undefined) result.bus_id = p.bus_id ?? null;
  if (p.driver_id !== undefined) result.driver_id = p.driver_id ?? null;
  if (p.station_id !== undefined) result.departure_station_id = p.station_id;
  if (p.departure_datetime !== undefined) {
    result.departure_datetime = p.departure_datetime;
    result.arrival_datetime = p.departure_datetime;
  }
  result.status = status;
  if (p.seats_total !== undefined) result.seats_available = p.seats_total;
  if (p.seats_sold !== undefined) result.seats_reserved = p.seats_sold;
  if (p.route_name !== undefined) result.route_name = p.route_name;
  if (p.created_at !== undefined) result.created_at = p.created_at;
  if (p.updated_at !== undefined) result.updated_at = p.updated_at;

  result.is_ramassage = false;
  result.is_anticipated = false;

  return result;
}

function mapTicket(payload: Record<string, unknown>): Record<string, unknown> {
  const p = payload;

  const seats = Array.isArray(p.seat_numbers) && (p.seat_numbers as unknown[]).length > 0
    ? p.seat_numbers
    : p.seat_number != null ? [String(p.seat_number)] : [];

  const result: Record<string, unknown> = {
    id: p.id,
    schedule_id: p.depart_id,
    passenger_name: p.passenger_name ?? 'Passager',
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

  if (p.destination || p.destination_id) {
    result.destination_city_name = (p.destination as string) ?? null;
  }

  return result;
}

function mapBagage(payload: Record<string, unknown>): Record<string, unknown> {
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

function mapDepense(payload: Record<string, unknown>): Record<string, unknown> {
  const p = payload;

  return {
    id: p.id,
    bus_id: p.bus_id ?? null,
    expense_type: p.type ?? p.label ?? 'autre',
    amount: p.amount ?? 0,
    description: p.description ?? p.label ?? '',
    expense_date: p.expense_date ?? new Date().toISOString().slice(0, 10),
    status: 'en_attente',
    created_at: p.created_at ?? new Date().toISOString(),
  };
}

const FIELD_MAPPERS: Record<string, (p: Record<string, unknown>) => Record<string, unknown>> = {
  departs: mapDepart,
  tickets: mapTicket,
  bagages: mapBagage,
  depenses: mapDepense,
};

async function applyRemote(item: SyncQueueItem): Promise<void> {
  const table = TABLE_MAP[item.entity] ?? item.entity;
  const mapper = FIELD_MAPPERS[item.entity];
  const id = (item.payload.id as string) ?? '';

  if (item.op === 'delete') {
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) throw error;
    return;
  }

  let remotePayload = mapper
    ? mapper(item.payload)
    : stripLocalFields(item.payload);

  const userId = await getCurrentUserId();

  if (item.entity === 'departs' && userId) {
    remotePayload.created_by = remotePayload.created_by ?? userId;
  }
  if (item.entity === 'tickets' && userId) {
    remotePayload.booked_by = remotePayload.booked_by ?? userId;
  }
  if (item.entity === 'bagages' && userId) {
    remotePayload.sold_by = remotePayload.sold_by ?? userId;
  }
  if (item.entity === 'depenses' && userId) {
    remotePayload.created_by = remotePayload.created_by ?? userId;
  }

  if (item.op === 'update') {
    const { data: existing } = await supabase
      .from(table)
      .select('updated_at')
      .eq('id', id)
      .maybeSingle();

    if (existing?.updated_at && item.payload.updated_at) {
      const remoteTs = new Date(existing.updated_at as string).getTime();
      const localTs = new Date(item.payload.updated_at as string).getTime();
      if (localTs < remoteTs) return;
    }
  }

  const { error } = await supabase.from(table).upsert(remotePayload);
  if (error) throw error;
}

function stripLocalFields(payload: Record<string, unknown>): Record<string, unknown> {
  const { synced, ...rest } = payload;
  void synced;
  return rest;
}
