import { db, type SyncQueueItem } from './db';
import { supabase } from '@/services/supabase';

// ── Online/offline state (single source of truth) ──

let _online = true;
const listeners = new Set<(online: boolean) => void>();

export function isOnline(): boolean {
  return _online;
}

export function setOnline(online: boolean): void {
  if (_online === online) return;
  _online = online;
  for (const fn of listeners) fn(online);
}

export function onOnlineChange(fn: (online: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ── Sync queue helpers ──

type StoreName = 'departs' | 'tickets' | 'bagages' | 'depenses';

const TABLE_MAP: Record<StoreName, string> = {
  departs: 'schedules',
  tickets: 'reservations',
  bagages: 'baggage_tickets',
  depenses: 'counter_charges',
};

function nowIso(): string {
  return new Date().toISOString();
}

function uuid(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function getCurrentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

// ── Field mapping (same logic as offlineStore, kept in sync) ──

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
    route_id: p.route_id || null,
    bus_id: p.bus_id ?? null,
    driver_id: p.driver_id ?? null,
    departure_station_id: p.station_id ?? null,
    arrival_station_id: p.arrival_station_id ?? null,
    departure_datetime: depIso,
    arrival_datetime: computeArrivalDatetime(depIso),
    status,
    seats_total: p.seats_total ?? 0,
    seats_available: p.seats_total ?? 0,
    seats_reserved: p.seats_sold ?? 0,
    route_name: p.route_name ?? null,
    source: 'guichet',
    counter_id: p.counter_id ?? null,
    departure_number: p.departure_number ?? null,
    route_number: p.route_number ?? null,
    created_at: p.created_at ?? nowIso(),
    updated_at: p.updated_at ?? nowIso(),
    is_ramassage: p.is_ramassage ?? false,
    is_anticipated: false,
  };
}

function mapDepartUpdate(payload: Record<string, unknown>): Record<string, unknown> | null {
  const p = payload;
  const result: Record<string, unknown> = {};
  if (p.seats_sold !== undefined) result.seats_reserved = p.seats_sold;
  if (p.seats_total !== undefined) {
    result.seats_total = p.seats_total;
    result.seats_available = p.seats_total;
  }
  if (p.cancelled === true) result.status = 'annule';
  if (p.cloture === true) result.status = 'termine';
  if (p.confirmed === true) result.status = 'en_cours';
  if (p.status !== undefined && !result.status) result.status = p.status;
  if (p.route_name !== undefined) result.route_name = p.route_name;
  if (p.route_number !== undefined) result.route_number = p.route_number;
  if (p.bus_id !== undefined) result.bus_id = p.bus_id;
  if (p.driver_id !== undefined) result.driver_id = p.driver_id;
  if (p.station_id !== undefined) result.departure_station_id = p.station_id;
  if (p.arrival_station_id !== undefined) result.arrival_station_id = p.arrival_station_id;
  if (p.is_ramassage !== undefined) result.is_ramassage = p.is_ramassage;
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
    declared_value: p.declared_value ?? 0,
    payment_status: p.payment_status ?? 'paye',
    created_at: p.created_at ?? nowIso(),
  };
}

function mapBagageUpdate(payload: Record<string, unknown>): Record<string, unknown> | null {
  const p = payload;
  const result: Record<string, unknown> = {};
  if (p.payment_status !== undefined) result.payment_status = p.payment_status;
  if (p.paid_at !== undefined) result.paid_at = p.paid_at;
  if (p.paid_by !== undefined) result.paid_by = p.paid_by;
  if (p.destination !== undefined) result.destination = p.destination;
  if (p.price !== undefined) result.price = p.price;
  if (p.description !== undefined) result.description = p.description;
  if (p.owner_name !== undefined) result.owner_name = p.owner_name;
  if (p.owner_phone !== undefined) result.owner_phone = p.owner_phone;
  result.updated_at = nowIso();
  if (Object.keys(result).length <= 1) return null;
  return result;
}

const EXPENSE_TYPE_MAP: Record<string, string> = {
  'carburant compl.': 'carburant_complement',
  'carburant': 'carburant_complement',
  'péage': 'peage',
  'péages': 'peage',
  'peage': 'peage',
  'peages': 'peage',
  'paeges': 'peage',
  'frais de route': 'ration',
  'frais route': 'ration',
  'ration': 'ration',
  'rations': 'ration',
  'ratios': 'ration',
  'ratio': 'ration',
  'autre': 'autres',
  'autres': 'autres',
};

function normalizeExpenseType(raw: string | undefined): string {
  if (!raw) return 'autres';
  const key = raw.trim().toLowerCase();
  return EXPENSE_TYPE_MAP[key] ?? 'autres';
}

const UNIQUE_CHARGE_TYPES = new Set(['ration', 'carburant_complement', 'peage']);

async function mapDepenseInsert(payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
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
        .update({ amount: row.amount, description: row.description, charge_date: row.charge_date, updated_at: nowIso() })
        .eq('id', existing.id);
      return null;
    }
  }
  return row;
}

// ── Queue operations ──

/**
 * Enqueue an insert operation. If online, execute immediately.
 * If offline, store in the sync queue for later flush.
 */
export async function enqueueInsert(
  store: StoreName,
  record: Record<string, unknown>,
): Promise<{ queued: boolean; error?: string }> {
  if (isOnline()) {
    try {
      await executeInsert(store, record);
      return { queued: false };
    } catch (err: any) {
      // Network failed mid-operation — queue it for retry
      await db.sync_queue.add({
        entity: store,
        op: 'insert',
        payload: record,
        created_at: nowIso(),
        tries: 0,
        status: 'pending',
        last_error: err?.message,
      });
      return { queued: true, error: err?.message };
    }
  }
  // Offline: queue
  await db.sync_queue.add({
    entity: store,
    op: 'insert',
    payload: record,
    created_at: nowIso(),
    tries: 0,
    status: 'pending',
  });
  return { queued: true };
}

/**
 * Enqueue an update operation. If online, execute immediately.
 * If offline, store in the sync queue.
 */
export async function enqueueUpdate(
  store: StoreName,
  id: string,
  patch: Record<string, unknown>,
): Promise<{ queued: boolean; error?: string }> {
  if (isOnline()) {
    try {
      await executeUpdate(store, id, patch);
      return { queued: false };
    } catch (err: any) {
      await db.sync_queue.add({
        entity: store,
        op: 'update',
        payload: { id, ...patch },
        created_at: nowIso(),
        tries: 0,
        status: 'pending',
        last_error: err?.message,
      });
      return { queued: true, error: err?.message };
    }
  }
  await db.sync_queue.add({
    entity: store,
    op: 'update',
    payload: { id, ...patch },
    created_at: nowIso(),
    tries: 0,
    status: 'pending',
  });
  return { queued: true };
}

/**
 * Enqueue a delete operation.
 */
export async function enqueueDelete(
  store: StoreName,
  id: string,
): Promise<{ queued: boolean; error?: string }> {
  if (isOnline()) {
    try {
      const table = TABLE_MAP[store];
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error && !error.message.includes('0 rows')) throw error;
      return { queued: false };
    } catch (err: any) {
      await db.sync_queue.add({
        entity: store,
        op: 'delete',
        payload: { id },
        created_at: nowIso(),
        tries: 0,
        status: 'pending',
        last_error: err?.message,
      });
      return { queued: true, error: err?.message };
    }
  }
  await db.sync_queue.add({
    entity: store,
    op: 'delete',
    payload: { id },
    created_at: nowIso(),
    tries: 0,
    status: 'pending',
  });
  return { queued: true };
}

// ── Execute individual operations against Supabase ──

async function executeInsert(store: StoreName, record: Record<string, unknown>): Promise<void> {
  const table = TABLE_MAP[store];
  let payload: Record<string, unknown>;

  if (store === 'departs') {
    payload = mapDepartInsert(record);
    const userId = await getCurrentUserId();
    if (userId) payload.created_by = userId;
  } else if (store === 'tickets') {
    payload = mapTicketInsert(record);
    const userId = await getCurrentUserId();
    if (userId) payload.booked_by = userId;
  } else if (store === 'bagages') {
    payload = mapBagageInsert(record);
    const userId = await getCurrentUserId();
    if (userId) payload.sold_by = userId;
  } else if (store === 'depenses') {
    const depensePayload = await mapDepenseInsert(record);
    if (!depensePayload) return; // already merged server-side
    payload = depensePayload;
    const userId = await getCurrentUserId();
    if (userId) payload.created_by = userId;
  } else {
    return;
  }

  // upsert ensures idempotency — if the UUID already exists (retry), it's a no-op
  const { error } = await supabase.from(table).upsert(payload);
  if (error) {
    // Baggage number collision: another guichet generated the same number.
    // Regenerate a unique number and retry.
    if (store === 'bagages' && error.message.includes('baggage_number')) {
      const newNumber = await generateUniqueBagageNumber();
      payload.baggage_number = newNumber;
      const { error: retryError } = await supabase.from(table).upsert(payload);
      if (retryError) throw retryError;
      // Update local record with the new number
      const localId = record.id as string;
      const existing = await (db.bagages as any).get(localId);
      if (existing) {
        await (db.bagages as any).put({ ...existing, bagage_number: newNumber, synced: true });
      }
      return;
    }
    throw error;
  }
}

async function generateUniqueBagageNumber(): Promise<string> {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  const datePart = `${dd}${mm}${yyyy}`;
  // Query server for the max existing number with today's prefix to avoid collision
  try {
    const { data, error: qErr } = await supabase
      .from('baggage_tickets')
      .select('baggage_number')
      .like('baggage_number', `${datePart}%`)
      .order('baggage_number', { ascending: false })
      .limit(1);
    if (!qErr && data && data.length > 0) {
      const lastNum = data[0].baggage_number as string;
      const match = lastNum.match(/(\d+)-1\/(\d+)$/);
      if (match) {
        const nextSeq = parseInt(match[1], 10) + 1;
        const seqStr = String(nextSeq).padStart(5, '0');
        return `${datePart}${seqStr}-1/${nextSeq}`;
      }
    }
  } catch {
    // fall through to timestamp-based unique
  }
  // Fallback: use timestamp to guarantee uniqueness
  const ts = Date.now().toString().slice(-6);
  return `${datePart}${ts}-1/1`;
}

async function executeUpdate(store: StoreName, id: string, patch: Record<string, unknown>): Promise<void> {
  const table = TABLE_MAP[store];
  let remotePayload: Record<string, unknown> | null = null;

  if (store === 'departs') {
    remotePayload = mapDepartUpdate({ id, ...patch });
  } else if (store === 'tickets') {
    remotePayload = mapTicketUpdate({ id, ...patch });
  } else if (store === 'bagages') {
    remotePayload = mapBagageUpdate({ id, ...patch });
  }

  if (!remotePayload) return;
  const { error } = await supabase.from(table).update(remotePayload).eq('id', id);
  if (error && !error.message.includes('0 rows')) throw error;
}

async function executeDelete(store: StoreName, id: string): Promise<void> {
  const table = TABLE_MAP[store];
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error && !error.message.includes('0 rows')) throw error;
}

// ── Conflict detection ──

export interface SyncConflict {
  entity: string;
  id: string;
  reason: string;
  local_payload: Record<string, unknown>;
  server_payload?: Record<string, unknown>;
  created_at: string;
}

async function checkTicketConflict(payload: Record<string, unknown>): Promise<SyncConflict | null> {
  const scheduleId = payload.depart_id as string;
  const seatNumbers = Array.isArray(payload.seat_numbers)
    ? payload.seat_numbers as string[]
    : payload.seat_number != null ? [String(payload.seat_number)] : [];

  if (!scheduleId || seatNumbers.length === 0) return null;

  try {
    const { data: existing } = await supabase
      .from('reservations')
      .select('id, seat_numbers, status')
      .eq('schedule_id', scheduleId)
      .neq('id', payload.id as string)
      .neq('status', 'annulee');

    if (existing && existing.length > 0) {
      const serverSeats = new Set<string>();
      for (const r of existing) {
        const seats = Array.isArray(r.seat_numbers) ? r.seat_numbers as string[] : [];
        for (const s of seats) serverSeats.add(s);
      }
      const conflicts = seatNumbers.filter(s => serverSeats.has(s));
      if (conflicts.length > 0) {
        return {
          entity: 'tickets',
          id: payload.id as string,
          reason: `Siège(s) ${conflicts.join(', ')} déjà vendu(s) sur le serveur pour ce départ`,
          local_payload: payload,
          created_at: nowIso(),
        };
      }
    }
  } catch {
    // Can't check — proceed with upsert (idempotency will handle duplicates by ID)
  }
  return null;
}

// ── Flush: process all pending queue items ──

export interface FlushResult {
  processed: number;
  succeeded: number;
  failed: number;
  conflicts: SyncConflict[];
}

let flushing = false;

export async function flushSyncQueue(): Promise<FlushResult> {
  if (flushing) return { processed: 0, succeeded: 0, failed: 0, conflicts: [] };
  if (!isOnline()) return { processed: 0, succeeded: 0, failed: 0, conflicts: [] };

  flushing = true;
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  const conflicts: SyncConflict[] = [];

  try {
    const pending = await db.sync_queue.where('status').anyOf(['pending', 'error']).toArray();
    // Sort by created_at to preserve operation order
    pending.sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));

    for (const item of pending) {
      if (!item.id) continue;
      processed++;

      try {
        // Mark as syncing
        await db.sync_queue.update(item.id, { status: 'syncing', tries: (item.tries ?? 0) + 1 });

        if (item.op === 'insert') {
          // Check for seat conflicts before inserting tickets
          if (item.entity === 'tickets') {
            const conflict = await checkTicketConflict(item.payload);
            if (conflict) {
              conflicts.push(conflict);
              await db.sync_queue.update(item.id, { status: 'error', last_error: conflict.reason });
              failed++;
              continue;
            }
          }
          await executeInsert(item.entity as StoreName, item.payload);
        } else if (item.op === 'update') {
          const id = item.payload.id as string;
          const { id: _removed, ...patch } = item.payload;
          void _removed;
          await executeUpdate(item.entity as StoreName, id, patch);
        } else if (item.op === 'delete') {
          const id = item.payload.id as string;
          await executeDelete(item.entity as StoreName, id);
        }

        await db.sync_queue.delete(item.id);
        succeeded++;
      } catch (err: any) {
        await db.sync_queue.update(item.id, {
          status: 'error',
          last_error: err?.message ?? 'Unknown error',
        });
        failed++;
        // If network drops mid-flush, stop processing
        if (!isOnline()) break;
      }
    }
  } finally {
    flushing = false;
  }

  return { processed, succeeded, failed, conflicts };
}

export async function getPendingCount(): Promise<number> {
  return db.sync_queue.where('status').anyOf(['pending', 'error']).count();
}

export async function getLastSyncError(): Promise<string | null> {
  const errors = await db.sync_queue.where('status').equals('error').toArray();
  errors.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  return errors[0]?.last_error ?? null;
}

export async function getConflicts(): Promise<SyncConflict[]> {
  // Conflicts are stored as error-status queue items with a conflict reason
  const errors = await db.sync_queue.where('status').equals('error').toArray();
  return errors
    .filter(item => item.last_error?.includes('déjà vendu'))
    .map(item => ({
      entity: item.entity,
      id: item.payload.id as string,
      reason: item.last_error ?? '',
      local_payload: item.payload,
      created_at: item.created_at,
    }));
}

export async function generateId(): Promise<string> {
  return uuid();
}
