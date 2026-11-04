// Personal data kept on the device (audit M7).
//
// The guichet keeps passengers' names and phones (tickets), baggage owners' (baggage) and the
// senders' and recipients' of parcels in the browser, to work without network. They stayed there
// for good, on devices shared by several guichetiers, and logging out did not remove them.
//
// Rules, applied once a day on start-up and at each logout:
// - names and phones of the tickets and baggage of past departures are erased after
//   PERSONAL_DATA_DAYS (amounts, seats and numbers stay, for the till and the reports);
// - departures older than PURGE_DAYS are removed from the device with their tickets, baggage,
//   expenses and transfers (the server keeps everything; the Départs screen pulls an older period
//   again when it is asked for);
// - finished parcels (delivered, returned, lost) are removed PERSONAL_DATA_DAYS after their last
//   change; parcels still in progress stay, whatever their age, since they are needed to receive
//   and deliver without network;
// - at logout, the same is done with no delay for past days (today's sales stay for the next
//   guichetier of the shift, and every parcel in progress stays).
//
// Never touched: a record not yet confirmed by the server, or with an operation in a sending
// queue (waiting, failed or set aside): erasing it would lose a sale or a parcel.

import { db as posDb } from '@/services/pos/db';
import { db as courrierDb } from '@/services/courrier/db';
import { trustedNow } from './deviceClock';

export const PERSONAL_DATA_DAYS = 7;
export const PURGE_DAYS = 30;

const FINISHED_PARCEL_STATUSES = new Set(['livre', 'retourne', 'perdu']);
const LAST_RUN_KEY = 'sbta_data_retention_day';

export interface RetentionResult {
  ticketsAnonymised: number;
  bagagesAnonymised: number;
  departsRemoved: number;
  recordsRemoved: number;
  parcelsRemoved: number;
}

interface RetentionOptions {
  /** Days after which names and phones of past departures are erased (0: every past day). */
  personalDataDays: number;
  /** Days after which a finished parcel is removed (0: at once). */
  finishedParcelDays: number;
}

function shiftDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayOf(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 10) : '';
}

function hasPersonalData(...values: unknown[]): boolean {
  return values.some(v => typeof v === 'string' && v.trim() !== '');
}

async function applyToGuichet(today: string, options: RetentionOptions, result: RetentionResult): Promise<void> {
  const personalBefore = shiftDays(today, -options.personalDataDays);
  const purgeBefore = shiftDays(today, -PURGE_DAYS);

  // Queue and records read and changed together: a sale recorded meanwhile comes with its operation
  await posDb.transaction(
    'rw',
    [posDb.departs, posDb.tickets, posDb.bagages, posDb.depenses, posDb.transfer_logs, posDb.pending_transfers, posDb.sync_queue],
    async () => {
      const queued = new Set(
        (await posDb.sync_queue.toArray()).map(i => `${i.entity}:${String(i.payload?.id ?? '')}`),
      );
      const busy = (store: string, r: { id: string; synced?: boolean }) =>
        r.synced === false || queued.has(`${store}:${r.id}`);

      const departs = await posDb.departs.toArray();
      const departDay = new Map(departs.map(d => [d.id, d.departure_date || dayOf(d.departure_datetime)]));
      const recordDay = (r: { depart_id?: string; created_at?: string }) =>
        (r.depart_id && departDay.get(r.depart_id)) || dayOf(r.created_at);

      const tickets = await posDb.tickets.toArray();
      const bagages = await posDb.bagages.toArray();
      const depenses = await posDb.depenses.toArray();

      // 1. Names and phones of past departures
      for (const t of tickets) {
        const day = recordDay(t);
        if (!day || day >= personalBefore || busy('tickets', t)) continue;
        if (!hasPersonalData(t.passenger_name, t.passenger_phone, t.loyalty_card_number, t.loyalty_name)) continue;
        await posDb.tickets.update(t.id, { passenger_name: '', passenger_phone: '', loyalty_card_number: undefined, loyalty_name: undefined });
        result.ticketsAnonymised++;
      }
      for (const b of bagages) {
        const day = recordDay(b);
        if (!day || day >= personalBefore || busy('bagages', b)) continue;
        if (!hasPersonalData(b.owner_name, b.owner_phone)) continue;
        await posDb.bagages.update(b.id, { owner_name: '', owner_phone: '' });
        result.bagagesAnonymised++;
      }
      // Transfers already applied or cancelled keep a copy of the moved tickets: not needed any more
      for (const p of await posDb.pending_transfers.toArray()) {
        if (p.status === 'pending' || dayOf(p.created_at) >= personalBefore || (p.ticket_data ?? []).length === 0) continue;
        await posDb.pending_transfers.update(p.id, { ticket_data: [] });
      }

      // 2. Old departures removed with everything attached, unless something is still to be sent
      for (const d of departs) {
        const day = departDay.get(d.id) ?? '';
        if (!day || day >= purgeBefore || busy('departs', d)) continue;
        const ownTickets = tickets.filter(t => t.depart_id === d.id);
        const ownBagages = bagages.filter(b => b.depart_id === d.id);
        const ownDepenses = depenses.filter(x => x.depart_id === d.id);
        if (ownTickets.some(t => busy('tickets', t)) || ownBagages.some(b => busy('bagages', b)) || ownDepenses.some(x => busy('depenses', x))) continue;
        await posDb.tickets.bulkDelete(ownTickets.map(t => t.id));
        await posDb.bagages.bulkDelete(ownBagages.map(b => b.id));
        await posDb.depenses.bulkDelete(ownDepenses.map(x => x.id));
        await posDb.departs.delete(d.id);
        result.departsRemoved++;
        result.recordsRemoved += ownTickets.length + ownBagages.length + ownDepenses.length;
      }
      for (const log of await posDb.transfer_logs.toArray()) {
        if (dayOf(log.transferred_at) < purgeBefore) {
          await posDb.transfer_logs.delete(log.id);
          result.recordsRemoved++;
        }
      }
      for (const p of await posDb.pending_transfers.toArray()) {
        if (p.status !== 'pending' && dayOf(p.created_at) < purgeBefore) {
          await posDb.pending_transfers.delete(p.id);
          result.recordsRemoved++;
        }
      }
    },
  );
}

async function applyToCourrier(today: string, options: RetentionOptions, result: RetentionResult): Promise<void> {
  const finishedBefore = shiftDays(today, -options.finishedParcelDays);

  await courrierDb.transaction('rw', [courrierDb.parcels, courrierDb.tracking_events, courrierDb.sync_queue], async () => {
    // Parcels named by any queued operation (the parcel itself, its events, its SMS)
    const queued = new Set<string>();
    for (const item of await courrierDb.sync_queue.toArray()) {
      const p = item.payload ?? {};
      if (item.entity === 'parcels') queued.add(String(p.id ?? ''));
      else queued.add(String(p.parcel_id ?? ''));
    }

    for (const parcel of await courrierDb.parcels.toArray()) {
      if (!FINISHED_PARCEL_STATUSES.has(parcel.status)) continue; // still needed without network
      if (parcel.synced === false || queued.has(parcel.id)) continue;
      const lastChange = dayOf(parcel.delivered_at) || dayOf(parcel.updated_at) || dayOf(parcel.registered_at);
      // finishedParcelDays 0 (logout): every finished parcel goes; otherwise only the older ones
      if (options.finishedParcelDays > 0 && (!lastChange || lastChange >= finishedBefore)) continue;
      await courrierDb.tracking_events.where('parcel_id').equals(parcel.id).delete();
      await courrierDb.parcels.delete(parcel.id);
      result.parcelsRemoved++;
    }
  });
}

function emptyResult(): RetentionResult {
  return { ticketsAnonymised: 0, bagagesAnonymised: 0, departsRemoved: 0, recordsRemoved: 0, parcelsRemoved: 0 };
}

async function run(options: RetentionOptions): Promise<RetentionResult> {
  const result = emptyResult();
  const today = trustedNow().toISOString().slice(0, 10);
  // Each base on its own: a failure on one must not stop the other
  try { await applyToGuichet(today, options, result); } catch (err) { console.warn('[conservation] guichet :', err); }
  try { await applyToCourrier(today, options, result); } catch (err) { console.warn('[conservation] courrier :', err); }
  return result;
}

/** Daily rule (7 days for personal data and finished parcels, 30 days for departures). */
export async function applyDataRetention(force = false): Promise<RetentionResult | null> {
  const today = trustedNow().toISOString().slice(0, 10);
  if (!force) {
    try {
      if (localStorage.getItem(LAST_RUN_KEY) === today) return null;
    } catch { /* storage unavailable: run anyway, the rule is idempotent */ }
  }
  const result = await run({ personalDataDays: PERSONAL_DATA_DAYS, finishedParcelDays: PERSONAL_DATA_DAYS });
  try { localStorage.setItem(LAST_RUN_KEY, today); } catch { /* run again next time */ }
  return result;
}

/**
 * At logout (shared device): names and phones of every past day erased at once, finished parcels
 * removed. Today's sales and the parcels in progress stay for the next guichetier.
 */
export async function clearPersonalDataOnLogout(): Promise<RetentionResult> {
  return run({ personalDataDays: 0, finishedParcelDays: 0 });
}
