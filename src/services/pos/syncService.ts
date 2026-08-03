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
    const res = await fetch(`${supabase.supabaseUrl}/rest/v1/limits?select=id&limit=1`, {
      method: 'GET',
      headers: { apikey: supabase.supabaseKey },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok || res.status === 200 || res.status === 401 || res.status === 406;
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

async function applyRemote(item: SyncQueueItem): Promise<void> {
  const table = TABLE_MAP[item.entity] ?? item.entity;
  const payload = item.payload;
  const id = (payload.id as string) ?? '';

  if (item.op === 'delete') {
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) throw error;
    return;
  }

  if (item.op === 'insert') {
    const remotePayload = stripLocalFields(payload);
    const { error } = await supabase.from(table).upsert(remotePayload);
    if (error) throw error;
    return;
  }

  if (item.op === 'update') {
    const remotePayload = stripLocalFields(payload);
    const { data: existing } = await supabase
      .from(table)
      .select('updated_at')
      .eq('id', id)
      .maybeSingle();

    if (existing?.updated_at) {
      const remoteTs = new Date(existing.updated_at as string).getTime();
      const localTs = new Date(payload.updated_at as string).getTime();
      if (localTs < remoteTs) return;
    }

    const { error } = await supabase.from(table).upsert(remotePayload);
    if (error) throw error;
    return;
  }
}

function stripLocalFields(payload: Record<string, unknown>): Record<string, unknown> {
  const { synced, ...rest } = payload;
  void synced;
  return rest;
}
