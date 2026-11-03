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

// convoi_trajets / convois: the convoy screen writes its rows as they are (no local table). An
// insert carries { id, rows }: the outbound and return legs go in one request, all or nothing.
export type StoreName = 'departs' | 'tickets' | 'bagages' | 'depenses' | 'convoi_trajets' | 'convois';

const TABLE_MAP: Record<StoreName, string> = {
  departs: 'schedules',
  tickets: 'reservations',
  bagages: 'baggage_tickets',
  depenses: 'counter_charges',
  convoi_trajets: 'schedules',
  convois: 'convoys',
};

const RAW_ROW_STORES = new Set<StoreName>(['convoi_trajets', 'convois']);

function nowIso(): string {
  return new Date().toISOString();
}

function uuid(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Account the operation is sent with, read from the session kept on the device. getUser() asked
// the server on every sale: one more round trip, during which the Supabase client holds its
// session lock and every other request of the guichet waits (beyond the response time limit).
async function getCurrentUserId(): Promise<string | null> {
  return (await serverSessionUserId()) ?? null;
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
    seat_number: p.with_ticket && p.linked_seat_number != null && String(p.linked_seat_number) !== '' ? String(p.linked_seat_number) : null,
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
  if (Object.keys(result).length === 0) return null;
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

export function normalizeExpenseType(raw: string | undefined): string {
  if (!raw) return 'autres';
  const key = raw.trim().toLowerCase();
  return EXPENSE_TYPE_MAP[key] ?? 'autres';
}

export const UNIQUE_CHARGE_TYPES = new Set(['ration', 'carburant_complement', 'peage']);

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

// ── Who sends what ──
// Each operation is sent with the account of the guichetier who made it. On a shared device the
// server session may still be the previous guichetier's (logged out offline, or the next one
// logged in offline): sending with it recorded the sale under the other guichetier's name, and
// an expense was refused (it must come from the counter's own guichetier). Such an operation now
// waits until its author logs in online on the device.

/** Guichetier logged in on the device (POS session): author of the operations recorded now. */
async function currentSellerId(): Promise<string | undefined> {
  try {
    return (await db.session.toArray())[0]?.user_id || undefined;
  } catch {
    return undefined;
  }
}

/** Account of the server session the requests are sent with (read on the device, no request). */
async function serverSessionUserId(): Promise<string | undefined> {
  try {
    return (await supabase.auth.getSession()).data.session?.user.id;
  } catch {
    return undefined;
  }
}

/** The server session belongs to another account than the guichetier logged in on the device. */
export async function isServerSessionOfAnotherUser(): Promise<boolean> {
  const [sellerId, serverUserId] = await Promise.all([currentSellerId(), serverSessionUserId()]);
  return Boolean(sellerId && serverUserId && sellerId !== serverUserId);
}

/** Operations recorded before this version have no author: they are sent as before. */
function sentBy(item: Pick<SyncQueueItem, 'user_id'>, serverUserId: string | undefined): boolean {
  return !item.user_id || item.user_id === serverUserId;
}

// ── Queue operations ──

async function addToQueue(
  store: StoreName,
  op: SyncQueueItem['op'],
  payload: Record<string, unknown>,
  userId: string | undefined,
  lastError?: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  await db.sync_queue.add({
    entity: store,
    op,
    payload,
    created_at: nowIso(),
    tries: 0,
    status: 'pending',
    ...(lastError ? { last_error: lastError } : {}),
    ...(userId ? { user_id: userId } : {}),
    ...(meta ? { meta } : {}),
  });
}

/**
 * Sends an operation now when online and the server session is its author's; otherwise (offline,
 * network failure, another guichetier's server session) keeps it in the queue for later.
 */
async function sendOrQueue(
  store: StoreName,
  op: SyncQueueItem['op'],
  payload: Record<string, unknown>,
  send: () => Promise<void>,
  meta?: Record<string, unknown>,
): Promise<{ queued: boolean; error?: string }> {
  const userId = await currentSellerId();
  if (isOnline() && sentBy({ user_id: userId }, await serverSessionUserId())) {
    try {
      await send();
      return { queued: false };
    } catch (err: any) {
      // Network failed mid-operation — queue it for retry
      await addToQueue(store, op, payload, userId, err?.message, meta);
      return { queued: true, error: err?.message };
    }
  }
  await addToQueue(store, op, payload, userId, undefined, meta);
  return { queued: true };
}

/**
 * Insert: sent now if possible, otherwise queued. `meta`: kept with a queued operation only, never
 * sent (e.g. what the convoy list shows until the convoy reaches the server).
 */
export async function enqueueInsert(
  store: StoreName,
  record: Record<string, unknown>,
  meta?: Record<string, unknown>,
): Promise<{ queued: boolean; error?: string }> {
  return sendOrQueue(store, 'insert', record, () => executeInsert(store, record), meta);
}

/** Update: sent now if possible, otherwise queued. */
export async function enqueueUpdate(
  store: StoreName,
  id: string,
  patch: Record<string, unknown>,
): Promise<{ queued: boolean; error?: string }> {
  return sendOrQueue(store, 'update', { id, ...patch }, () => executeUpdate(store, id, patch));
}

/** Delete: sent now if possible, otherwise queued. */
export async function enqueueDelete(
  store: StoreName,
  id: string,
): Promise<{ queued: boolean; error?: string }> {
  return sendOrQueue(store, 'delete', { id }, () => executeDelete(store, id));
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
  } else if (RAW_ROW_STORES.has(store)) {
    // Rows written as they are, all in one request; ids made on the device, so a retry is a no-op
    const rows = (record.rows as Record<string, unknown>[] | undefined) ?? [];
    const userId = store === 'convois' ? await getCurrentUserId() : null;
    const toSend = rows.map(r => (userId ? { ...r, created_by: userId } : r));
    const { error } = await supabase.from(table).upsert(toSend);
    if (error) throw error;
    return;
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
      const match = lastNum.match(new RegExp(`^${datePart}(\\d{5})-1\\/\\d+$`));
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

/**
 * An update or delete that changed no row returns no error: it used to leave the queue as if it
 * had been applied. Find out why before letting it go:
 * - the row is still waiting to be added (its insert failed or is queued): keep the change, it is
 *   sent again after the insert (the queue is sent in order);
 * - the row is on the server but the change was refused (access rules): keep it, as an error;
 * - the row is not on the server and nothing will add it: there is nothing left to change.
 */
async function checkNothingChanged(store: StoreName, table: string, id: string): Promise<void> {
  const insertWaiting = await db.sync_queue
    .where('entity').equals(store)
    .filter(i => i.op === 'insert' && i.status !== 'done' && String(i.payload?.id ?? '') === id)
    .count();
  if (insertWaiting > 0) throw new Error('En attente de l\'envoi de l\'enregistrement concerné');

  const { data, error } = await supabase.from(table).select('id').eq('id', id).maybeSingle();
  if (error) throw error;
  if (data) throw new Error('Modification refusée par le serveur (droits insuffisants)');
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
  } else if (RAW_ROW_STORES.has(store)) {
    remotePayload = Object.keys(patch).length > 0 ? patch : null;
  }

  if (!remotePayload) return;
  const { data, error } = await supabase.from(table).update(remotePayload).eq('id', id).select('id');
  if (error && !error.message.includes('0 rows')) throw error;
  if (!error && (data ?? []).length === 0) await checkNothingChanged(store, table, id);
}

async function executeDelete(store: StoreName, id: string): Promise<void> {
  const table = TABLE_MAP[store];
  const { data, error } = await supabase.from(table).delete().eq('id', id).select('id');
  if (error && !error.message.includes('0 rows')) throw error;
  if (!error && (data ?? []).length === 0) await checkNothingChanged(store, table, id);
}

// ── Flush: process all pending queue items ──
// Tickets sold offline are sent as they are, even if another guichet sold the same seat of the
// departure meanwhile: different guichets may sell the same seat (business rule). The former
// check blocked such a sale forever, so the money collected never reached the server.

export interface FlushResult {
  processed: number;
  succeeded: number;
  failed: number;
  /** Operations of another guichetier, kept until he logs in online on this device */
  waitingOtherUser: number;
}

// An operation is marked 'syncing' while it is being sent. If the page closes or reloads at that
// moment (update of the site, power cut, tab closed), it stays 'syncing': it must then be sent
// again, otherwise the sale never reaches the server. Older than this delay = interrupted send.
const STALE_SENDING_MS = 2 * 60_000;

// A failed operation was sent again every 5 s, forever. It now waits longer after each failure:
// 5 s, 10 s, 20 s… up to 10 minutes. « Réessayer » in the queue window sends it at once.
const FIRST_RETRY_MS = 5_000;
const MAX_RETRY_MS = 10 * 60_000;

/** Wait before sending again an operation that failed `tries` times. */
export function retryDelayMs(tries: number): number {
  return Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** Math.max(0, Math.min(tries, 20) - 1));
}

/** When a failed operation will be sent again (null: at the next sending). */
export function nextRetryAt(item: SyncQueueItem): number | null {
  if (item.status !== 'error' || !item.sending_since) return null;
  const last = Date.parse(item.sending_since);
  return Number.isNaN(last) ? null : last + retryDelayMs(item.tries ?? 1);
}

function isWaitingToSend(item: SyncQueueItem): boolean {
  if (item.status === 'pending') return true;
  if (item.status === 'error') return !(Date.now() < (nextRetryAt(item) ?? 0));
  if (item.status !== 'syncing') return false;
  const since = item.sending_since ? Date.parse(item.sending_since) : NaN;
  return !(Date.now() - since < STALE_SENDING_MS);
}

/**
 * Once its last queued change has reached the server, the device's copy is marked synced. Without
 * it, a record made offline stayed « not synced » for good, and the pulls from the server skip such
 * records: a ticket cancelled on the server afterwards was never updated on the device.
 */
async function markSyncedIfNothingLeft(entity: StoreName, id: string): Promise<void> {
  // Convoys have no copy on the device to mark
  if (!id || RAW_ROW_STORES.has(entity)) return;
  const left = await db.sync_queue
    .where('entity').equals(entity)
    .filter(i => String(i.payload?.id ?? '') === id)
    .count();
  if (left === 0) await (db as any)[entity].update(id, { synced: true });
}

let flushing = false;

export async function flushSyncQueue(): Promise<FlushResult> {
  if (flushing) return { processed: 0, succeeded: 0, failed: 0, waitingOtherUser: 0 };
  if (!isOnline()) return { processed: 0, succeeded: 0, failed: 0, waitingOtherUser: 0 };

  flushing = true;
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let waitingOtherUser = 0;

  try {
    const serverUserId = await serverSessionUserId();
    const waiting = (await db.sync_queue.where('status').anyOf(['pending', 'error', 'syncing']).toArray())
      .filter(isWaitingToSend);
    const pending = waiting.filter(item => sentBy(item, serverUserId));
    waitingOtherUser = waiting.length - pending.length;
    // Sort by created_at to preserve operation order
    pending.sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));

    for (const item of pending) {
      if (!item.id) continue;
      processed++;

      try {
        // Mark as syncing
        await db.sync_queue.update(item.id, { status: 'syncing', tries: (item.tries ?? 0) + 1, sending_since: nowIso() });

        if (item.op === 'insert') {
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
        if (item.op !== 'delete') await markSyncedIfNothingLeft(item.entity as StoreName, String(item.payload.id ?? ''));
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

  return { processed, succeeded, failed, waitingOtherUser };
}

/** Operations not yet confirmed by the server, including those being sent or whose sending was interrupted. */
export async function getPendingCount(): Promise<number> {
  return db.sync_queue.where('status').anyOf(['pending', 'error', 'syncing']).count();
}

/** Operations not yet confirmed by the server, oldest first (queue window). */
export async function getQueueItems(): Promise<SyncQueueItem[]> {
  const items = await db.sync_queue.where('status').anyOf(['pending', 'error', 'syncing']).toArray();
  return items.sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));
}

/** Sends a failed operation again at the next sending, without waiting for its retry delay. */
export async function retryQueueItem(id: number): Promise<void> {
  await db.sync_queue.update(id, { status: 'pending', tries: 0, sending_since: undefined });
}

export async function getLastSyncError(): Promise<string | null> {
  const errors = await db.sync_queue.where('status').equals('error').toArray();
  errors.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  return errors[0]?.last_error ?? null;
}

export async function generateId(): Promise<string> {
  return uuid();
}
