/**
 * Ramassage report of the guichet without network: the report read the server alone, so a
 * ramassage direct recorded offline (kept in the sending queue only) or a collection validated
 * offline did not appear in it. The report now also uses:
 * - the ramassages already received from the server, kept on the device (report and Collecte
 *   lists);
 * - the ramassages and collections recorded on this device and not yet sent (queue).
 */
import { db } from './db';
import { byQueueOrder } from '@/services/offline/queueRules';

export interface ReportRamassage {
  id: string;
  created_at: string;
  collected_at: string | null;
  status: string;
  destination_station_id?: string | null;
  route_id?: string | null;
  [key: string]: unknown;
}

// Ramassages kept for the report on the device (the period the guichet looks back on)
const KEEP_DAYS = 62;

const reportKey = (stationId: string) => `ramassage_report:${stationId}`;
const collecteKey = (stationId: string) => `ramassage_list:${stationId}`;

async function cached(key: string): Promise<ReportRamassage[]> {
  try {
    return ((await db.referentiels.get(key))?.data as ReportRamassage[] | undefined) ?? [];
  } catch {
    return [];
  }
}

/** Keeps the ramassages received from the server, for the report without network. */
export async function keepReportRows(stationId: string, rows: ReportRamassage[]): Promise<void> {
  const limit = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString();
  const byId = new Map((await cached(reportKey(stationId))).map(r => [r.id, r]));
  for (const row of rows) byId.set(row.id, row);
  const kept = [...byId.values()].filter(r => (r.collected_at ?? r.created_at ?? '') >= limit);
  await db.referentiels.put({ key: reportKey(stationId), type: 'ramassage_report', data: kept, updated_at: new Date().toISOString() }).catch(() => {});
}

/** Ramassages received from the server earlier, kept on the device (report and Collecte lists). */
export async function cachedReportRows(stationId: string): Promise<ReportRamassage[]> {
  const byId = new Map((await cached(reportKey(stationId))).map(r => [r.id, r]));
  for (const row of await cached(collecteKey(stationId))) byId.set(row.id, row);
  return [...byId.values()];
}

/**
 * The given ramassages with what this device recorded and has not sent yet: ramassages direct
 * created offline, collections validated offline. Returns the ids of those not yet sent.
 */
export async function withDeviceChanges(stationId: string, rows: ReportRamassage[]): Promise<{ rows: ReportRamassage[]; notSent: Set<string> }> {
  const items = await db.sync_queue.where('entity').equals('ramassages').toArray().catch(() => []);
  const byId = new Map(rows.map(r => [r.id, r]));
  const notSent = new Set<string>();
  // A collection validated offline is still « pending » on the server, which does not send it
  // back with the report: its row is taken from the copy kept on the device
  let kept: Map<string, ReportRamassage> | null = null;
  for (const item of items.sort(byQueueOrder)) {
    if (item.status === 'done' || item.status === 'abandoned') continue;
    if (item.op === 'insert') {
      for (const r of (item.payload.rows as ReportRamassage[] | undefined) ?? []) {
        if (r.destination_station_id !== stationId) continue;
        if (!byId.has(r.id)) byId.set(r.id, r);
        notSent.add(r.id);
      }
    } else if (item.op === 'update') {
      const id = String(item.payload.id ?? '');
      if (!byId.has(id)) {
        kept ??= new Map((await cachedReportRows(stationId)).map(r => [r.id, r]));
        const copy = kept.get(id);
        if (copy && copy.destination_station_id === stationId) byId.set(id, copy);
      }
      const current = byId.get(id);
      if (current) {
        byId.set(id, { ...current, ...(item.payload as Partial<ReportRamassage>), id });
        notSent.add(id);
      }
    }
  }
  return { rows: [...byId.values()], notSent };
}
