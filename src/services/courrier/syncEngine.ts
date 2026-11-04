import { db, type SyncQueueItem } from './db';
import { supabase } from '@/services/supabase';
import { sendCourierCreatedSms, sendCourierArrivedSms } from '@/services/emisSms.service';

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

type StoreName = 'parcels' | 'tracking_events';

const TABLE_MAP: Record<StoreName, string> = {
  parcels: 'parcels',
  tracking_events: 'parcel_tracking_events',
};

// SMS to the recipient for an action done without network: kept in the same queue, so that it
// leaves after the parcel it is about has reached the server.
const SMS_ENTITY = 'sms';

export type QueuedSms =
  | { kind: 'created'; parcel_id: string; parcel_code: string; recipient_name: string; recipient_phone: string; recipient_city: string; tracking_url?: string }
  | { kind: 'arrived'; parcel_id: string; recipient_phone: string };

export async function enqueueSms(sms: QueuedSms): Promise<void> {
  if (!sms.recipient_phone) return;
  await db.sync_queue.add({
    entity: SMS_ENTITY,
    op: 'insert',
    payload: { id: `${sms.kind}:${sms.parcel_id}`, ...sms },
    created_at: nowIso(),
    tries: 0,
    status: 'pending',
  });
}

async function executeSms(payload: Record<string, unknown>): Promise<void> {
  const sms = payload as unknown as QueuedSms;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('SMS en attente d\'une session en ligne');

  // The parcel must be on the server first. Waiting for every queued insert of the parcel held
  // the SMS back behind a later re-save (ticket printed offline) — for good if that one kept
  // failing: the server is asked whether the parcel is there.
  const { data: onServer, error: parcelError } = await supabase
    .from('parcels').select('id').eq('id', sms.parcel_id).maybeSingle();
  if (parcelError) throw parcelError;
  if (!onServer) {
    const parcelWaiting = await db.sync_queue
      .where('entity').equals('parcels')
      .filter(i => i.op === 'insert' && i.status !== 'done' && String(i.payload?.id ?? '') === sms.parcel_id)
      .count();
    throw new Error(parcelWaiting > 0
      ? 'SMS en attente de l\'envoi du courrier'
      : 'SMS en attente : le courrier n\'est pas encore sur le serveur');
  }

  // A network failure throws (kept for later). A refusal by the SMS service is recorded in the
  // parcel's SMS history by the server and can be sent again from the parcel's page.
  if (sms.kind === 'created') {
    await sendCourierCreatedSms({
      id: sms.parcel_id,
      parcel_code: sms.parcel_code,
      recipient_name: sms.recipient_name,
      recipient_phone: sms.recipient_phone,
      recipient_city: sms.recipient_city,
      tracking_url: sms.tracking_url,
    });
  } else {
    await sendCourierArrivedSms({ id: sms.parcel_id, recipient_phone: sms.recipient_phone });
  }
}

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

// ── Field mapping (local → remote) ──

function mapParcelInsert(payload: Record<string, unknown>): Record<string, unknown> {
  const p = payload;
  return {
    id: p.id,
    parcel_code: p.parcel_code ?? null,
    reference: p.reference ?? null,
    daily_sequence: p.daily_sequence ?? null,
    tracking_url: p.tracking_url ?? null,
    sender_name: p.sender_name ?? '',
    sender_phone: p.sender_phone ?? '',
    sender_address: p.sender_address ?? null,
    recipient_name: p.recipient_name ?? '',
    recipient_phone: p.recipient_phone ?? '',
    recipient_city: p.recipient_city ?? '',
    recipient_address: p.recipient_address ?? null,
    origin_station_id: p.origin_station_id ?? null,
    destination_station_id: p.destination_station_id ?? null,
    schedule_id: p.schedule_id ?? null,
    driver_id: p.driver_id ?? null,
    bus_id: p.bus_id ?? null,
    declared_value: p.declared_value ?? 0,
    delivery_fee: p.delivery_fee ?? 0,
    sms_tracking_fee: p.sms_tracking_fee ?? 0,
    priority: p.priority ?? 'standard',
    planned_date: p.planned_date ?? null,
    nature: p.nature ?? 'autre',
    content_description: p.content_description ?? '',
    notes: p.notes ?? null,
    status: p.status ?? 'enregistre',
    registered_at: p.registered_at ?? nowIso(),
    registered_by: p.registered_by ?? null,
    company_id: p.company_id ?? null,
    ticket_printed: p.ticket_printed ?? false,
    created_at: p.created_at ?? nowIso(),
    updated_at: p.updated_at ?? nowIso(),
  };
}

function mapParcelUpdate(payload: Record<string, unknown>): Record<string, unknown> | null {
  const p = payload;
  const result: Record<string, unknown> = {};

  const fieldMap: Record<string, string> = {
    sender_name: 'sender_name',
    sender_phone: 'sender_phone',
    recipient_name: 'recipient_name',
    recipient_phone: 'recipient_phone',
    recipient_city: 'recipient_city',
    origin_station_id: 'origin_station_id',
    destination_station_id: 'destination_station_id',
    schedule_id: 'schedule_id',
    driver_id: 'driver_id',
    bus_id: 'bus_id',
    declared_value: 'declared_value',
    delivery_fee: 'delivery_fee',
    sms_tracking_fee: 'sms_tracking_fee',
    priority: 'priority',
    planned_date: 'planned_date',
    nature: 'nature',
    content_description: 'content_description',
    notes: 'notes',
    status: 'status',
    company_id: 'company_id',
    ticket_printed: 'ticket_printed',
    packaged_at: 'packaged_at',
    packaged_by: 'packaged_by',
    shipped_at: 'shipped_at',
    shipped_by: 'shipped_by',
    arrived_at: 'arrived_at',
    arrived_by: 'arrived_by',
    delivered_at: 'delivered_at',
    delivered_by: 'delivered_by',
    delivery_recipient_name: 'delivery_recipient_name',
    delivery_recipient_phone: 'delivery_recipient_phone',
    delivery_id_number: 'delivery_id_number',
    delivery_id_type: 'delivery_id_type',
  };

  for (const [localKey, remoteKey] of Object.entries(fieldMap)) {
    if (p[localKey] !== undefined) result[remoteKey] = p[localKey];
  }

  result.updated_at = nowIso();
  if (Object.keys(result).length <= 1) return null;
  return result;
}

// ── Queue operations ──

export async function enqueueInsert(
  store: StoreName,
  record: Record<string, unknown>,
): Promise<{ queued: boolean; error?: string }> {
  if (isOnline()) {
    try {
      await executeInsert(store, record);
      return { queued: false };
    } catch (err: any) {
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

export async function enqueueDelete(
  store: StoreName,
  id: string,
): Promise<{ queued: boolean; error?: string }> {
  if (isOnline()) {
    try {
      await executeDelete(store, id);
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

  if (store === 'parcels') {
    const payload = mapParcelInsert(record);
    const userId = await getCurrentUserId();
    if (userId && !payload.registered_by) payload.registered_by = userId;
    // upsert ensures idempotency — if the UUID already exists (retry), it's a no-op
    const { error } = await supabase.from(table).upsert(payload);
    if (error) throw error;
  } else if (store === 'tracking_events') {
    // Tracking events are normally created by the DB trigger on parcel status change.
    // We only insert them directly for manual notes. The trigger handles status-change events.
    const p = record;
    const payload: Record<string, unknown> = {
      id: p.id,
      parcel_id: p.parcel_id,
      event_type: p.event_type,
      description: p.description ?? null,
      location: p.location ?? null,
      station_id: p.station_id ?? null,
      performed_by: p.performed_by ?? null,
      performer_name: p.performer_name ?? null,
      event_at: p.event_at ?? nowIso(),
      metadata: p.metadata ?? {},
    };
    const { error } = await supabase.from(table).upsert(payload);
    if (error) throw error;
  }
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

  if (store === 'parcels') {
    const remotePayload = mapParcelUpdate({ id, ...patch });
    if (!remotePayload) return;
    const { data, error } = await supabase.from(table).update(remotePayload).eq('id', id).select('id');
    if (error && !error.message.includes('0 rows')) throw error;
    if (!error && (data ?? []).length === 0) await checkNothingChanged(store, table, id);
  }
}

async function executeDelete(store: StoreName, id: string): Promise<void> {
  const table = TABLE_MAP[store];
  if (store === 'parcels') {
    await supabase.from('parcel_tracking_events').delete().eq('parcel_id', id);
  }
  const { data, error } = await supabase.from(table).delete().eq('id', id).select('id');
  if (error && !error.message.includes('0 rows')) throw error;
  if (!error && (data ?? []).length === 0) await checkNothingChanged(store, table, id);
}

// ── Flush: process all pending queue items ──

export interface FlushResult {
  processed: number;
  succeeded: number;
  failed: number;
  conflicts: FlushConflict[];
}

export interface FlushConflict {
  entity: string;
  id: string;
  reason: string;
  created_at: string;
}

// An operation is marked 'syncing' while it is being sent. If the page closes or reloads at that
// moment (update of the site, power cut, tab closed), it stays 'syncing': it must then be sent
// again, otherwise the sale never reaches the server. Older than this delay = interrupted send.
const STALE_SENDING_MS = 2 * 60_000;

function isWaitingToSend(item: SyncQueueItem): boolean {
  if (item.status === 'pending' || item.status === 'error') return true;
  if (item.status !== 'syncing') return false;
  const since = item.sending_since ? Date.parse(item.sending_since) : NaN;
  return !(Date.now() - since < STALE_SENDING_MS);
}

let flushing = false;

export async function flushSyncQueue(): Promise<FlushResult> {
  if (flushing) return { processed: 0, succeeded: 0, failed: 0, conflicts: [] };
  if (!isOnline()) return { processed: 0, succeeded: 0, failed: 0, conflicts: [] };

  flushing = true;
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  const conflicts: FlushConflict[] = [];

  try {
    const pending = (await db.sync_queue.where('status').anyOf(['pending', 'error', 'syncing']).toArray())
      .filter(isWaitingToSend);
    pending.sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));

    for (const item of pending) {
      if (!item.id) continue;
      processed++;

      try {
        await db.sync_queue.update(item.id, { status: 'syncing', tries: (item.tries ?? 0) + 1, sending_since: nowIso() });

        if (item.entity === SMS_ENTITY) {
          await executeSms(item.payload);
        } else if (item.op === 'insert') {
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
        if (!isOnline()) break;
      }
    }
  } finally {
    flushing = false;
  }

  return { processed, succeeded, failed, conflicts };
}

/** Operations not yet confirmed by the server, including those being sent or whose sending was interrupted. */
export async function getPendingCount(): Promise<number> {
  return db.sync_queue.where('status').anyOf(['pending', 'error', 'syncing']).count();
}

export async function getLastSyncError(): Promise<string | null> {
  const errors = await db.sync_queue.where('status').equals('error').toArray();
  errors.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  return errors[0]?.last_error ?? null;
}

export async function getQueueItems(): Promise<SyncQueueItem[]> {
  return db.sync_queue.where('status').anyOf(['pending', 'error', 'syncing']).toArray();
}

export async function deleteQueueItem(id: number): Promise<void> {
  await db.sync_queue.delete(id);
}

export async function retryQueueItem(id: number): Promise<void> {
  await db.sync_queue.update(id, { status: 'pending', last_error: null });
}

export async function generateId(): Promise<string> {
  return uuid();
}
