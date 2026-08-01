import { db, type SyncQueueItem } from './db';
import { supabase } from '@/services/supabase';

const TABLE_MAP: Record<string, string> = {
  departs: 'schedules',
  tickets: 'reservations',
  bagages: 'baggage_tickets',
  depenses: 'bus_expenses',
};

const MAX_TRIES = 5;

type SyncEvent = 'start' | 'item-ok' | 'item-error' | 'done' | 'idle';
type SyncListener = (event: SyncEvent, detail?: { count?: number; remaining?: number; error?: string }) => void;

const listeners = new Set<SyncListener>();
let syncing = false;
let lastSyncAt = 0;

export function onSyncEvent(listener: SyncListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: SyncEvent, detail?: { count?: number; remaining?: number; error?: string }) {
  listeners.forEach(l => l(event, detail));
}

export function isSyncing(): boolean {
  return syncing;
}

export function getLastSyncAt(): number {
  return lastSyncAt;
}

export async function syncNow(): Promise<{ synced: number; failed: number }> {
  if (syncing) return { synced: 0, failed: 0 };
  if (!navigator.onLine) return { synced: 0, failed: 0 };

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
        await db.sync_queue.update(item.id!, { status: 'error' });
        failed++;
        continue;
      }

      try {
        await db.sync_queue.update(item.id!, { status: 'syncing' });
        await applyRemote(item);
        await db.sync_queue.update(item.id!, { status: 'done' });
        synced++;
        emit('item-ok', { remaining: items.length - synced - failed });
      } catch (err: any) {
        await db.sync_queue.update(item.id!, {
          status: 'error',
          tries: item.tries + 1,
          last_error: err?.message ?? 'Unknown error',
        });
        failed++;
        emit('item-error', { error: err?.message, remaining: items.length - synced - failed });
      }
    }

    if (synced > 0) {
      await db.sync_queue.where('status').equals('done').delete();
    }

    lastSyncAt = Date.now();
    emit('done', { count: synced, remaining: failed });
  } finally {
    syncing = false;
    if (failed === 0) emit('idle');
  }

  return { synced, failed };
}

async function applyRemote(item: SyncQueueItem): Promise<void> {
  const table = TABLE_MAP[item.entity] ?? item.entity;
  const payload = item.payload;
  const id = payload.id as string;

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
    const { data: existing } = await supabase.from(table).select('updated_at').eq('id', id).maybeSingle();

    if (existing?.updated_at) {
      const remoteTs = new Date(existing.updated_at as string).getTime();
      const localTs = new Date(payload.updated_at as string).getTime();
      if (localTs < remoteTs) return;
    }

    const { error } = await supabase.from(table).update(remotePayload).eq('id', id);
    if (error) throw error;
    return;
  }
}

function stripLocalFields(payload: Record<string, unknown>): Record<string, unknown> {
  const { synced, ...rest } = payload;
  void synced;
  return rest;
}
