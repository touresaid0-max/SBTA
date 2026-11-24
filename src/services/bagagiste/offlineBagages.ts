import Dexie, { type Table } from 'dexie';
import { supabase } from '@/services/supabase';

/**
 * Bagagiste without network (24/11/2026). What the sale screen needs is kept on the device (the
 * stations, the departures of the day, the lines, the buses, the day's sales) and each baggage is
 * saved here first, then sent to the server when the device has Internet. A departure not known
 * yet (written on the passenger's ticket) is created here as a provisional departure: the server
 * links its baggage to the guichet's departure of the same station, day and number.
 */

interface RefRow { key: string; data: unknown; updated_at: string }

export interface QueuedBaggage {
  id: string;
  /** The row sent to baggage_tickets, as it is */
  row: Record<string, unknown>;
  created_at: string;
  status: 'pending' | 'failed';
  error?: string;
}

export interface ProvisionalDeparture {
  key: string;
  station_id: string;
  date: string;
  number: number;
  route_name: string;
  destination: string;
  bus_registration: string;
  created_at: string;
}

class BagagisteDB extends Dexie {
  refs!: Table<RefRow, string>;
  queue!: Table<QueuedBaggage, string>;
  provisional!: Table<ProvisionalDeparture, string>;
  constructor() {
    super('sbta_bagagiste');
    this.version(1).stores({
      refs: 'key',
      queue: 'id, status, created_at',
      provisional: 'key, [station_id+date]',
    });
  }
}

export const bagDb = new BagagisteDB();

export async function saveRef(key: string, data: unknown): Promise<void> {
  try { await bagDb.refs.put({ key, data, updated_at: new Date().toISOString() }); } catch { /* kept in memory only */ }
}

export async function getRef<T>(key: string): Promise<T | null> {
  try { return ((await bagDb.refs.get(key))?.data as T) ?? null; } catch { return null; }
}

/** A failure of the network (no answer), not a refusal of the server */
export function isNetworkFailure(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  const msg = String((err as { message?: string })?.message ?? err ?? '');
  return /failed to fetch|networkerror|load failed|network request failed|timeout|aborted/i.test(msg);
}

export async function enqueueBaggage(row: Record<string, unknown>): Promise<void> {
  await bagDb.queue.put({ id: String(row.id), row, created_at: new Date().toISOString(), status: 'pending' });
}

export async function queuedBaggages(): Promise<QueuedBaggage[]> {
  try { return (await bagDb.queue.toArray()).sort((a, b) => a.created_at.localeCompare(b.created_at)); } catch { return []; }
}

let flushing = false;

/**
 * Sends the baggage kept on the device, oldest first. A baggage the server already has (sent before
 * the answer was lost) counts as sent. Stops at the first network failure; a refusal is kept with
 * its message and the others still go.
 */
export async function flushBaggages(): Promise<{ sent: number; failed: number; left: number }> {
  if (flushing || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    const left = (await queuedBaggages()).length;
    return { sent: 0, failed: 0, left };
  }
  flushing = true;
  let sent = 0;
  let failed = 0;
  try {
    for (const item of await queuedBaggages()) {
      const { error } = await supabase.from('baggage_tickets').insert(item.row);
      if (!error || error.code === '23505') {
        await bagDb.queue.delete(item.id);
        sent++;
        continue;
      }
      if (isNetworkFailure(error)) break;
      failed++;
      await bagDb.queue.update(item.id, { status: 'failed', error: error.message });
    }
  } catch {
    /* sent again at the next try */
  } finally {
    flushing = false;
  }
  return { sent, failed, left: (await queuedBaggages()).length };
}

export async function saveProvisional(dep: ProvisionalDeparture): Promise<void> {
  try { await bagDb.provisional.put(dep); } catch { /* shown for this page only */ }
}

export async function provisionalFor(stationId: string, date: string): Promise<ProvisionalDeparture[]> {
  try { return await bagDb.provisional.where('[station_id+date]').equals([stationId, date]).toArray(); } catch { return []; }
}
