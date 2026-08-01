import { db, type SyncOp, type SyncQueueItem } from './db';

function uuid(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

type StoreName = 'departs' | 'tickets' | 'bagages' | 'depenses';

const storeToEntity: Record<StoreName, string> = {
  departs: 'departs',
  tickets: 'tickets',
  bagages: 'bagages',
  depenses: 'depenses',
};

async function enqueueSync(entity: string, op: SyncOp, payload: Record<string, unknown>): Promise<void> {
  const item: SyncQueueItem = {
    entity,
    op,
    payload,
    created_at: nowIso(),
    tries: 0,
    status: 'pending',
  };
  await db.sync_queue.add(item);
}

export async function localInsert<T extends { id: string; created_at: string; updated_at: string; synced?: boolean }>(
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
    synced: false,
  } as unknown as T;

  await (db[store] as any).put(full);
  await enqueueSync(storeToEntity[store], 'insert', full as unknown as Record<string, unknown>);
  return full;
}

export async function localUpdate<T extends { id: string; updated_at: string; synced?: boolean }>(
  store: StoreName,
  id: string,
  patch: Partial<T>,
): Promise<T | null> {
  const existing = await (db[store] as any).get(id);
  if (!existing) return null;

  const updated = {
    ...existing,
    ...patch,
    id,
    updated_at: nowIso(),
    synced: false,
  } as unknown as T;

  await (db[store] as any).put(updated);
  await enqueueSync(storeToEntity[store], 'update', { id, ...patch } as unknown as Record<string, unknown>);
  return updated;
}

export async function localDelete(store: StoreName, id: string): Promise<void> {
  await (db[store] as any).delete(id);
  await enqueueSync(storeToEntity[store], 'delete', { id });
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  return await (db[store] as any).toArray();
}

export async function getById<T extends { id: string }>(store: StoreName, id: string): Promise<T | undefined> {
  return await (db[store] as any).get(id);
}

export async function pendingCount(): Promise<number> {
  return await db.sync_queue.where('status').anyOf(['pending', 'error']).count();
}
