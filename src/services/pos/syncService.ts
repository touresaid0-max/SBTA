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

function mapDepart(payload: Record<string, unknown>): Record<string, unknown> {
  const {
    id, route_id, bus_id, driver_id, station_id, departure_datetime,
    status, seats_total, seats_sold, route_name, route_number,
    departure_number, is_ac, confirmed, cancelled, cloture,
    created_at, updated_at,
  } = payload as Record<string, unknown>;

  const result: Record<string, unknown> = {
    id,
    route_id: route_id ?? null,
    bus_id: bus_id ?? null,
    driver_id: driver_id ?? null,
    departure_station_id: station_id ?? null,
    departure_datetime,
    arrival_datetime: departure_datetime,
    status: cancelled ? 'cancelled' : cloture ? 'completed' : confirmed ? 'confirmed' : (status ?? 'scheduled'),
    seats_available: (seats_total as number) ?? 0,
    seats_reserved: (seats_sold as number) ?? 0,
    route_name: route_name ?? null,
    created_at: created_at ?? new Date().toISOString(),
    updated_at: updated_at ?? new Date().toISOString(),
    is_ramassage: false,
    is_anticipated: false,
  };

  if (is_ac !== undefined) result.is_ac = is_ac;
  if (route_number !== undefined) result.route_number = route_number;
  if (departure_number !== undefined) result.departure_number = departure_number;

  return result;
}

function mapTicket(payload: Record<string, unknown>): Record<string, unknown> {
  const {
    id, depart_id, seat_number, seat_numbers, destination, destination_id,
    passenger_name, passenger_phone, price, original_price,
    is_reduced, is_reported, is_ac, payment_method, status,
    loyalty_card_number, loyalty_name, ticket_number,
    created_at, updated_at,
  } = payload as Record<string, unknown>;

  const seats = Array.isArray(seat_numbers) && seat_numbers.length > 0
    ? seat_numbers
    : seat_number != null ? [String(seat_number)] : [];

  const result: Record<string, unknown> = {
    id,
    schedule_id: depart_id,
    passenger_name: passenger_name ?? 'Passager',
    passenger_phone: passenger_phone ?? null,
    seat_numbers: seats,
    total_seats: seats.length || 1,
    total_price: price ?? 0,
    status: status === 'cancelled' ? 'cancelled' : 'confirmed',
    payment_status: status === 'cancelled' ? 'refunded' : 'paid',
    booking_reference: ticket_number ?? null,
    created_at: created_at ?? new Date().toISOString(),
    updated_at: updated_at ?? new Date().toISOString(),
  };

  if (destination_id) result.destination_city_name = destination;
  else if (destination) result.destination_city_name = destination;

  if (loyalty_card_number) result.loyalty_card_number = loyalty_card_number;
  if (loyalty_name) result.loyalty_name = loyalty_name;
  if (is_ac !== undefined) result.is_ac = is_ac;
  if (is_reduced !== undefined) result.is_reduced = is_reduced;
  if (is_reported !== undefined) result.is_reported = is_reported;
  if (payment_method) result.payment_method = payment_method;
  if (original_price !== undefined) result.original_price = original_price;

  return result;
}

function mapBagage(payload: Record<string, unknown>): Record<string, unknown> {
  const {
    id, depart_id, bagage_number, ticket_id, ticket_number,
    price, destination, description, car_plate,
    owner_name, owner_phone, with_ticket, with_ticket_report,
    created_at, updated_at,
  } = payload as Record<string, unknown>;

  return {
    id,
    baggage_number: bagage_number ?? `BAG-${Date.now()}`,
    schedule_id: depart_id ?? null,
    reservation_id: ticket_id ?? null,
    destination: destination ?? '',
    price: price ?? 0,
    seat_number: ticket_number ?? null,
    bus_registration: car_plate ?? null,
    description: description ?? null,
    owner_name: owner_name ?? '',
    owner_phone: owner_phone ?? '',
    has_ticket: with_ticket ?? false,
    created_at: created_at ?? new Date().toISOString(),
  };
}

function mapDepense(payload: Record<string, unknown>): Record<string, unknown> {
  const {
    id, depart_id, type, label, amount, description,
    station_id, expense_date, created_at, updated_at,
  } = payload as Record<string, unknown>;

  return {
    id,
    bus_id: null,
    expense_type: type ?? label ?? 'autre',
    amount: amount ?? 0,
    description: description ?? label ?? '',
    expense_date: expense_date ?? new Date().toISOString().slice(0, 10),
    status: 'en_attente',
    created_at: created_at ?? new Date().toISOString(),
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

  const remotePayload = mapper
    ? mapper(item.payload)
    : stripLocalFields(item.payload);

  if (item.op === 'update') {
    const { data: existing } = await supabase
      .from(table)
      .select('updated_at')
      .eq('id', id)
      .maybeSingle();

    if (existing?.updated_at) {
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
