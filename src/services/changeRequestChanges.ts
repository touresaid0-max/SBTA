import { localChangeToServer, type StoreName } from '@/services/pos/syncEngine';

// Execution of an authorized change request: only the fields the admin changed are sent, with
// the server's column names. The admin's screen used to send the whole copy kept in the request:
// for the guichet's operations it holds the device's field names (price, depart_id…), so the
// server applied almost nothing of the change, and rewrote the unchanged fields with old values.

/** Requests whose copy comes from the guichet device (its own field names), by table. */
const DEVICE_COPY: Record<string, StoreName> = {
  tickets: 'tickets',
  bagage_tickets: 'bagages',
  bagages: 'bagages',
  counter_charges: 'depenses',
  depenses: 'depenses',
  schedules: 'departs',
};

const NEVER_CHANGED = new Set(['id', 'created_at', 'updated_at']);

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export interface ServerChanges {
  /** Columns and values sent to the server */
  changes: Record<string, unknown>;
  /** Fields changed by the admin that cannot be applied this way (e.g. a driver's name) */
  ignored: string[];
}

export function serverChangesOf(
  operationTable: string,
  snapshot: Record<string, unknown>,
  edited: Record<string, unknown>,
): ServerChanges {
  let changed = Object.keys(edited).filter(k => !NEVER_CHANGED.has(k) && !same(edited[k], snapshot[k]));
  const store = DEVICE_COPY[operationTable];
  if (!store) {
    // The copy already has the server's column names
    return { changes: Object.fromEntries(changed.map(k => [k, edited[k]])), ignored: [] };
  }

  const changes: Record<string, unknown> = {};
  const ignored: string[] = [];

  // A departure's date and time are one column on the server
  if (store === 'departs' && (changed.includes('departure_date') || changed.includes('departure_time'))) {
    const date = String(edited.departure_date ?? '').trim();
    const time = String(edited.departure_time ?? '').trim() || '00:00';
    const at = new Date(`${date}T${time.length === 5 ? `${time}:00` : time}`);
    if (date && !Number.isNaN(at.getTime())) {
      Object.assign(changes, localChangeToServer('departs', { departure_datetime: at.toISOString() }));
    } else {
      ignored.push('departure_date', 'departure_time');
    }
    changed = changed.filter(k => k !== 'departure_date' && k !== 'departure_time');
  }

  for (const key of changed) {
    const mapped = localChangeToServer(store, { [key]: edited[key] });
    if (mapped) Object.assign(changes, mapped);
    else ignored.push(key);
  }
  return { changes, ignored };
}
