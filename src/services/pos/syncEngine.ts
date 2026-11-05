import type { Table } from 'dexie';
import { db, type SyncQueueItem } from './db';
import { MIN_ABANDON_REASON, NOT_SENT_STATUSES, RefusedByServer, byQueueOrder, isPermanentError, isWaitingToSend, nextRetryAt, retryDelayMs } from '@/services/offline/queueRules';
import { supabase } from '@/services/supabase';
import { trustedNowIso } from '@/services/offline/deviceClock';
import { storedPhoneOrEmpty } from '@/utils/phoneCI';
import { uuidV4 } from '@/utils/uuid';

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

// convoi_trajets / convois / ramassages / ramassage_collectes: the convoy and ramassage screens
// write their rows as they are (no local table). An insert carries { id, rows }: all the rows go
// in one request, all or nothing.
export type StoreName =
  | 'departs' | 'tickets' | 'bagages' | 'depenses'
  | 'convoi_trajets' | 'convois' | 'ramassages' | 'ramassage_collectes';

const TABLE_MAP: Record<StoreName, string> = {
  departs: 'schedules',
  tickets: 'reservations',
  bagages: 'baggage_tickets',
  depenses: 'counter_charges',
  convoi_trajets: 'schedules',
  convois: 'convoys',
  ramassages: 'ramassage_notifications',
  ramassage_collectes: 'ramassage_collections',
};

const RAW_ROW_STORES = new Set<StoreName>(['convoi_trajets', 'convois', 'ramassages', 'ramassage_collectes']);

/**
 * Rows the guichet may not read back once written: a ramassage ligne is announced to the
 * DESTINATION station, and only that station may read it (access rules). An upsert (insert or
 * update) needs to read the row: the server refused it (« row-level security policy »), so the
 * notification of a ramassage ligne never reached the destination station. These rows are
 * inserted, one by one; a row already received (resend after a cut) counts as sent.
 */
const INSERT_ONLY_STORES = new Set<StoreName>(['ramassages']);

function isAlreadyReceived(error: { code?: string; message?: string } | null): boolean {
  return !!error && error.code === '23505' && /_pkey/.test(error.message ?? '');
}

// Column naming the guichetier who made the row, filled with the account the row is sent with
const RAW_AUTHOR_COLUMN: Partial<Record<StoreName, string>> = {
  convois: 'created_by',
  ramassages: 'created_by',
  ramassage_collectes: 'collected_by',
};

function nowIso(): string {
  return new Date().toISOString();
}

function uuid(): string {
  return uuidV4();
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
    // seats_reserved / seats_available: counted by the server from the reservations (see below)
    route_name: p.route_name ?? null,
    source: 'guichet',
    counter_id: p.counter_id ?? null,
    departure_number: p.departure_number ?? null,
    route_number: p.route_number ?? null,
    created_at: p.created_at ?? trustedNowIso(),
    updated_at: p.updated_at ?? trustedNowIso(),
    is_ramassage: p.is_ramassage ?? false,
    is_anticipated: false,
  };
}

function mapDepartUpdate(payload: Record<string, unknown>): Record<string, unknown> | null {
  const p = payload;
  const result: Record<string, unknown> = {};
  // The seats sold and left are counted by the server from the reservations (and mobile
  // bookings) of the departure. The device sent its own count, which knows only its own sales:
  // a late or replayed send could put back an outdated number. It no longer sends them.
  if (p.seats_total !== undefined) result.seats_total = p.seats_total;
  if (p.cancelled === true) result.status = 'annule';
  if (p.cloture === true) result.status = 'termine';
  if (p.confirmed === true) result.status = 'en_cours';
  if (p.status !== undefined && !result.status) result.status = p.status;
  if (p.route_id !== undefined) result.route_id = p.route_id;
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
  result.updated_at = trustedNowIso();
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
    created_at: p.created_at ?? trustedNowIso(),
    updated_at: p.updated_at ?? trustedNowIso(),
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
  if (p.destination !== undefined) result.destination_city_name = p.destination;
  if (p.seat_number !== undefined) {
    result.seat_numbers = [String(p.seat_number)];
    result.total_seats = 1;
  }
  result.updated_at = trustedNowIso();
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
    // Côte d'Ivoire rule (audit M10): 225 + 10 digits, or empty for a number saved by an earlier
    // version that is not valid (the database would refuse it)
    owner_phone: storedPhoneOrEmpty(p.owner_phone),
    has_ticket: p.with_ticket ?? false,
    station_id: p.station_id ?? null,
    counter_id: p.counter_id ?? null,
    declared_value: p.declared_value ?? 0,
    payment_status: p.payment_status ?? 'paye',
    created_at: p.created_at ?? trustedNowIso(),
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
  if (p.owner_phone !== undefined) result.owner_phone = storedPhoneOrEmpty(p.owner_phone);
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

/**
 * Expense types of a departure: one expense of each type per departure, never added up (audit M3).
 * The guichetier modifies the recorded expense; a second one of the same type is refused.
 */
export const UNIQUE_CHARGE_TYPES = new Set(['ration', 'carburant_complement', 'peage', 'autres']);

/** Server without the function of the 04/11/2026 migration (not applied yet). */
function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === 'PGRST202' || error.code === '42883');
}

/**
 * Sends the device's expense as it is now (creation or modification): the server keeps one
 * expense per departure and type, whose amount is REPLACED by this one, not added to it. Sending
 * it again (cut, retry, insert then update in the queue) gives the same result.
 */
async function sendDepense(payload: Record<string, unknown>): Promise<void> {
  const id = String(payload.id ?? '');
  const current = ((id ? await db.depenses.get(id) : undefined) as Record<string, unknown> | undefined) ?? payload;
  if (current.description === '__deleted__') return;
  const scheduleId = (current.depart_id as string) || null;
  if (!scheduleId) return; // not attached to a departure: nothing the server can record
  const chargeType = normalizeExpenseType((current.type as string) ?? (current.label as string));
  const description = (current.description as string) || (current.label as string) || '';
  const amount = Number(current.amount ?? 0);
  const chargeDate = (current.expense_date as string) || trustedNowIso().slice(0, 10);

  const { error } = await supabase.rpc('save_counter_charge', {
    p_id: id || null,
    p_schedule_id: scheduleId,
    p_charge_type: chargeType,
    p_amount: amount,
    p_description: description,
    p_charge_date: chargeDate,
    p_counter_id: (current.counter_id as string) || null,
    p_station_id: (current.station_id as string) || null,
    p_bus_id: (current.bus_id as string) || null,
    p_created_at: (current.created_at as string) || null,
  });
  if (!error) return;
  if (!isMissingFunction(error)) throw error;

  // Until the migration is applied: same rule with the table itself (a validated expense cannot
  // be modified this way: the server refuses it, the change stays in the queue with the error)
  const { data: existing, error: findError } = await supabase
    .from('counter_charges')
    .select('id')
    .eq('schedule_id', scheduleId)
    .eq('charge_type', chargeType)
    .order('created_at', { ascending: true })
    .limit(1);
  if (findError) throw findError;
  const target = (existing ?? [])[0] as { id: string } | undefined;
  if (target) {
    const { data, error: updateError } = await supabase
      .from('counter_charges')
      .update({ amount, description, charge_date: chargeDate, updated_at: trustedNowIso() })
      .eq('id', target.id)
      .select('id');
    if (updateError) throw updateError;
    if ((data ?? []).length === 0) throw new RefusedByServer('Modification refusée par le serveur (dépense déjà validée) : appliquez la migration du 04/11/2026');
    return;
  }
  const userId = await getCurrentUserId();
  const { error: insertError } = await supabase.from('counter_charges').upsert({
    id: id || undefined,
    schedule_id: scheduleId,
    counter_id: current.counter_id ?? null,
    station_id: current.station_id ?? null,
    bus_id: current.bus_id ?? null,
    charge_type: chargeType,
    description,
    amount,
    charge_date: chargeDate,
    status: 'en_attente',
    created_at: current.created_at ?? trustedNowIso(),
    ...(userId ? { created_by: userId } : {}),
  });
  if (insertError) throw insertError;
}

// ── Change requests executed by the admin ──
// The change request keeps the guichet device's copy of the operation, with its own field names
// (price, depart_id, ticket_number…). The admin's screen sent that whole copy as the new values:
// the server only applied the fields named like its columns, so most changes were lost, and the
// fields left as they were overwrote the server's copy with the device's old values.

/** Server columns for a change of the device's copy, or null when none of it can be applied. */
export function localChangeToServer(store: StoreName, patch: Record<string, unknown>): Record<string, unknown> | null {
  let result: Record<string, unknown> | null = null;
  if (store === 'departs') result = mapDepartUpdate(patch);
  else if (store === 'tickets') result = mapTicketUpdate(patch);
  else if (store === 'bagages') result = mapBagageUpdate(patch);
  else if (store === 'depenses') {
    result = {};
    if (patch.amount !== undefined) result.amount = patch.amount;
    if (patch.description !== undefined || patch.label !== undefined) result.description = patch.description ?? patch.label;
    if (patch.type !== undefined) result.charge_type = normalizeExpenseType(String(patch.type));
    if (patch.expense_date !== undefined) result.charge_date = patch.expense_date;
  }
  if (!result) return null;
  // Set by the server itself
  const { updated_at: _set, ...columns } = result;
  void _set;
  return Object.keys(columns).length > 0 ? columns : null;
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

/** Change of the device's copy, saved in the same transaction as the operation that sends it. */
export interface LocalWrite {
  table: Table<any, any>;
  write: () => Promise<unknown>;
}

/**
 * Saves the operation in the queue, together with the change of the device's copy when given:
 * both are saved, or neither (a record saved on the device always has its operation).
 */
async function saveInQueue(item: SyncQueueItem, local?: LocalWrite): Promise<number> {
  if (!local) return db.sync_queue.add(item);
  return db.transaction('rw', local.table, db.sync_queue, async () => {
    await local.write();
    return db.sync_queue.add(item);
  });
}

// An operation sent at once (online) was put in the queue only after a failed send. If the page
// closed during the send (up to 15 s: tab closed, reload after an update, power cut), the sale
// stayed on the device, in no queue, and never reached the server. The operation is now in the
// queue before it is sent, marked 'syncing': an interrupted send is sent again by the queue.

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
  local?: LocalWrite,
): Promise<{ queued: boolean; error?: string }> {
  const userId = await currentSellerId();
  const sendNow = isOnline() && sentBy({ user_id: userId }, await serverSessionUserId());
  const queueId = await saveInQueue({
    entity: store,
    op,
    payload,
    created_at: nowIso(),
    tries: sendNow ? 1 : 0,
    status: sendNow ? 'syncing' : 'pending',
    ...(sendNow ? { sending_since: nowIso() } : {}),
    ...(userId ? { user_id: userId } : {}),
    ...(meta ? { meta } : {}),
  }, local);
  if (!sendNow) return { queued: true };

  try {
    await send();
  } catch (err: any) {
    // Network failed mid-operation — sent again by the queue; refused by the server — kept, to deal with
    const refused = isPermanentError(err);
    await db.sync_queue.update(queueId, refused
      ? { ...failureState(err), sending_since: undefined }
      : { status: 'pending', tries: 0, sending_since: undefined, last_error: err?.message })
      .catch(() => { /* stays 'syncing': sent again once the send is considered interrupted */ });
    return { queued: true, error: err?.message };
  }
  try {
    await db.sync_queue.delete(queueId);
    if (op !== 'delete') await markSyncedIfNothingLeft(store, String(payload.id ?? ''));
  } catch {
    // Left in the queue: sent once more later, without effect (same id)
  }
  return { queued: false };
}

/**
 * Insert: sent now if possible, otherwise queued. `meta`: kept with a queued operation only, never
 * sent (e.g. what the convoy list shows until the convoy reaches the server). `local`: the saving
 * of the record on the device, done together with the queueing.
 */
export async function enqueueInsert(
  store: StoreName,
  record: Record<string, unknown>,
  meta?: Record<string, unknown>,
  local?: LocalWrite,
): Promise<{ queued: boolean; error?: string }> {
  return sendOrQueue(store, 'insert', record, () => executeInsert(store, record), meta, local);
}

/** Update: sent now if possible, otherwise queued. */
export async function enqueueUpdate(
  store: StoreName,
  id: string,
  patch: Record<string, unknown>,
  local?: LocalWrite,
): Promise<{ queued: boolean; error?: string }> {
  return sendOrQueue(store, 'update', { id, ...patch }, () => executeUpdate(store, id, patch), undefined, local);
}

/** Delete: sent now if possible, otherwise queued. */
export async function enqueueDelete(
  store: StoreName,
  id: string,
  local?: LocalWrite,
): Promise<{ queued: boolean; error?: string }> {
  return sendOrQueue(store, 'delete', { id }, () => executeDelete(store, id), undefined, local);
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
    await sendDepense(record);
    return;
  } else if (RAW_ROW_STORES.has(store)) {
    // Rows written as they are, all in one request; ids made on the device, so a retry is a no-op
    const rows = (record.rows as Record<string, unknown>[] | undefined) ?? [];
    const authorColumn = RAW_AUTHOR_COLUMN[store];
    const userId = authorColumn ? await getCurrentUserId() : null;
    const toSend = rows.map(r => (authorColumn && userId ? { ...r, [authorColumn]: userId } : r));
    if (INSERT_ONLY_STORES.has(store)) {
      for (const row of toSend) {
        const { error } = await supabase.from(table).insert(row);
        if (error && !isAlreadyReceived(error)) throw error;
      }
      return;
    }
    const { error } = await supabase.from(table).upsert(toSend);
    if (error) throw error;
    return;
  } else {
    return;
  }

  // A creation is inserted, never rewritten: the upsert (insert or update) sent again a ticket
  // already on the server (resend after a cut, records recovered at start) as an update, which
  // the access rules refuse to a guichetier (« row-level security policy (USING expression) »):
  // hundreds of tickets already on the server showed as refused. A row already there (same id)
  // counts as sent, and the server's copy is left as it is.
  const { error } = await supabase.from(table).insert(payload);
  if (error && !isAlreadyReceived(error)) {
    // Baggage number collision: another guichet generated the same number.
    // Regenerate a unique number and retry.
    if (store === 'bagages' && error.message.includes('baggage_number')) {
      const newNumber = await generateUniqueBagageNumber();
      payload.baggage_number = newNumber;
      const { error: retryError } = await supabase.from(table).insert(payload);
      if (retryError && !isAlreadyReceived(retryError)) throw retryError;
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
    .filter(i => i.op === 'insert' && i.status !== 'done' && i.status !== 'abandoned' && String(i.payload?.id ?? '') === id)
    .count();
  if (insertWaiting > 0) throw new Error('En attente de l\'envoi de l\'enregistrement concerné');

  const { data, error } = await supabase.from(table).select('id').eq('id', id).maybeSingle();
  if (error) throw error;
  if (data) throw new RefusedByServer('Modification refusée par le serveur (droits insuffisants)');
}

async function executeUpdate(store: StoreName, id: string, patch: Record<string, unknown>): Promise<void> {
  const table = TABLE_MAP[store];
  let remotePayload: Record<string, unknown> | null = null;

  if (store === 'depenses') {
    // The expense is sent whole as it is now on the device (amount replaced on the server)
    await sendDepense({ id, ...patch });
    return;
  }
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

// Retry delays, interrupted sends and refusals: rules shared with the courrier queue (queueRules)
export { retryDelayMs, nextRetryAt };

/** State after a failed send: refused by the server (no automatic resend) or passing failure. */
function failureState(err: unknown): Pick<SyncQueueItem, 'status' | 'last_error'> {
  return {
    status: isPermanentError(err) ? 'failed' : 'error',
    last_error: (err as { message?: string } | null)?.message ?? 'Unknown error',
  };
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

/**
 * Ramassage notifications refused by the access rules with the former way of sending (upsert):
 * kept in the queue as refused, they never reached the destination station. Sent again with
 * the insert, which the server accepts.
 */
async function retryRefusedRamassages(): Promise<void> {
  try {
    const refused = await db.sync_queue.where('entity').equals('ramassages')
      .filter(i => i.op === 'insert' && i.status === 'failed' && /row-level security/i.test(i.last_error ?? ''))
      .primaryKeys();
    for (const id of refused) {
      await db.sync_queue.update(id, { status: 'pending', tries: 0, last_error: undefined });
    }
  } catch { /* sent again at the next flush */ }
}

/**
 * Tickets, baggage and departures already on the server, refused when sent again with the former
 * upsert (an update, which the access rules refuse: « (USING expression) »). Sent again with the
 * insert, which counts them as sent. Only that refusal: it cannot come back with the insert.
 */
async function retryRefusedReinserts(): Promise<void> {
  try {
    const refused = await db.sync_queue.where('status').equals('failed')
      .filter(i => i.op === 'insert' && ['tickets', 'bagages', 'departs'].includes(i.entity)
        && /row-level security policy \(USING expression\)/i.test(i.last_error ?? ''))
      .primaryKeys();
    for (const id of refused) {
      await db.sync_queue.update(id, { status: 'pending', tries: 0, sending_since: undefined, last_error: undefined });
    }
  } catch { /* sent again at the next flush */ }
}

export async function flushSyncQueue(): Promise<FlushResult> {
  if (flushing) return { processed: 0, succeeded: 0, failed: 0, waitingOtherUser: 0 };
  if (!isOnline()) return { processed: 0, succeeded: 0, failed: 0, waitingOtherUser: 0 };

  flushing = true;
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let waitingOtherUser = 0;

  try {
    await retryRefusedRamassages();
    await retryRefusedReinserts();
    const serverUserId = await serverSessionUserId();
    const waiting = (await db.sync_queue.where('status').anyOf(NOT_SENT_STATUSES).toArray())
      .filter(isWaitingToSend);
    const pending = waiting.filter(item => sentBy(item, serverUserId));
    waitingOtherUser = waiting.length - pending.length;
    // Sort by created_at to preserve operation order
    pending.sort(byQueueOrder);

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
        // Refused by the server: kept, no longer sent by itself (it would be refused again)
        await db.sync_queue.update(item.id, failureState(err));
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

/**
 * Operations not yet on the server: waiting, being sent, failed or refused (abandoned ones are
 * not counted).
 */
export async function getPendingCount(): Promise<number> {
  return db.sync_queue.where('status').anyOf(NOT_SENT_STATUSES).count();
}

/** Operations not yet on the server, then the abandoned ones, oldest first (queue window). */
export async function getQueueItems(): Promise<SyncQueueItem[]> {
  const items = await db.sync_queue.where('status').anyOf([...NOT_SENT_STATUSES, 'abandoned']).toArray();
  return items.sort(byQueueOrder);
}

/** Sends a failed or refused operation again at the next sending, without waiting. */
export async function retryQueueItem(id: number): Promise<void> {
  await db.sync_queue.update(id, { status: 'pending', tries: 0, sending_since: undefined });
}

/** « Tout réessayer »: every refused operation sent again at the next sending (one click, not one per line). */
export async function retryAllRefused(): Promise<number> {
  return db.sync_queue.where('status').equals('failed').modify({ status: 'pending', tries: 0, sending_since: undefined });
}

/**
 * Gives up a failed or refused operation, with the reason written by the guichetier. It stays on
 * the device as a trace (never sent, no longer counted): a sale is money already collected.
 */
export async function abandonQueueItem(id: number, reason: string, by: string): Promise<void> {
  const text = reason.trim();
  if (text.length < MIN_ABANDON_REASON) throw new Error(`Justification trop courte (${MIN_ABANDON_REASON} caractères au moins)`);
  const item = await db.sync_queue.get(id);
  if (!item || (item.status !== 'error' && item.status !== 'failed')) throw new Error('Seule une opération en échec peut être abandonnée');
  await db.sync_queue.update(id, { status: 'abandoned', abandon_reason: text, abandoned_at: nowIso(), abandoned_by: by });
}

/** Message of the banner: refused operations to deal with first, else the latest failure. */
export async function getLastSyncError(): Promise<string | null> {
  const refused = await db.sync_queue.where('status').equals('failed').count();
  if (refused > 0) {
    return `${refused} opération${refused > 1 ? 's' : ''} refusée${refused > 1 ? 's' : ''} par le serveur : à traiter dans la liste`;
  }
  const errors = await db.sync_queue.where('status').equals('error').toArray();
  errors.sort((a, b) => byQueueOrder(b, a));
  return errors[0]?.last_error ?? null;
}

// ── Records left out of the queue ──
// Before the queue-first sending above, a record whose send was cut (page closed during the send)
// stayed on the device « not synced », with no operation: it never reached the server. Once per
// session, online: each such record is looked for on the server; there, it is marked synced;
// missing, its creation is queued again, at the end of the queue.

const RECOVERABLE_STORES: Array<'departs' | 'tickets' | 'bagages' | 'depenses'> = ['departs', 'tickets', 'bagages', 'depenses'];
let recoveryDone = false;

/** Queues again the records not synced that have no operation. Returns how many were queued. */
export async function recoverUnqueuedRecords(): Promise<number> {
  if (recoveryDone || !isOnline()) return 0;
  const tables = RECOVERABLE_STORES.map(s => db[s] as Table<any, string>);
  // Records and queue read together: a record saved meanwhile comes with its operation
  const orphans = await db.transaction('r', [...tables, db.sync_queue], async () => {
    const queued = new Set((await db.sync_queue.toArray()).map(i => `${i.entity}:${String(i.payload?.id ?? '')}`));
    const found: Array<{ store: StoreName; record: Record<string, unknown> }> = [];
    for (const store of RECOVERABLE_STORES) {
      const rows = await (db[store] as Table<any, string>).filter(r => r.synced === false && !queued.has(`${store}:${r.id}`)).toArray();
      for (const record of rows) found.push({ store, record });
    }
    return found;
  });

  let requeued = 0;
  for (const store of RECOVERABLE_STORES) {
    const records = orphans.filter(o => o.store === store).map(o => o.record);
    for (let i = 0; i < records.length; i += 100) {
      const chunk = records.slice(i, i + 100);
      const { data, error } = await supabase.from(TABLE_MAP[store]).select('id').in('id', chunk.map(r => String(r.id)));
      if (error) throw error; // tried again at the next sync
      const onServer = new Set((data ?? []).map((r: { id: string }) => r.id));
      for (const record of chunk) {
        const id = String(record.id);
        if (onServer.has(id)) {
          await (db[store] as Table<any, string>).update(id, { synced: true });
        } else {
          await db.sync_queue.add({
            entity: store, op: 'insert', payload: record,
            created_at: String(record.created_at ?? nowIso()), tries: 0, status: 'pending',
          });
          requeued++;
        }
      }
    }
  }
  recoveryDone = true;
  return requeued;
}

export async function generateId(): Promise<string> {
  return uuid();
}
