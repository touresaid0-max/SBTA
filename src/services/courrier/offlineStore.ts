import { db, type ParcelRecord, type TrackingEventRecord } from './db';
import { supabase } from '@/services/supabase';
import { enqueueInsert, enqueueUpdate, enqueueDelete, enqueueSms, isOnline, getPendingCount } from './syncEngine';
import type { Parcel } from '@/types/parcel.types';
import { trustedNowIso } from '@/services/offline/deviceClock';
import { uuidV4 } from '@/utils/uuid';

function uuid(): string {
  return uuidV4();
}

function nowIso(): string {
  return trustedNowIso();
}

type StoreName = 'parcels' | 'tracking_events';

// Fields that are LOCAL ONLY — updates containing ONLY these should not be sent to remote
const LOCAL_ONLY_FIELDS = new Set([
  'synced', 'updated_at', 'id', 'created_at',
  'origin_station_name', 'destination_station_name',
  'registered_by_name', 'company_name', 'driver_name',
  'bus_registration', 'total_amount',
]);

function hasRemoteMappableFields(entity: StoreName, patch: Record<string, unknown>): boolean {
  const keys = Object.keys(patch).filter(k => !LOCAL_ONLY_FIELDS.has(k));
  return keys.length > 0;
}

// ── Public API: offline-first — always write locally, then sync/queue ──

export async function localInsertParcel(
  record: Omit<ParcelRecord, 'id' | 'created_at' | 'updated_at' | 'synced'> & Partial<ParcelRecord>,
): Promise<ParcelRecord> {
  const id = record.id ?? uuid();
  const ts = nowIso();
  // Not synced until the server has it: kept for later, the screens add it to the server's list
  const full: ParcelRecord = {
    ...record,
    id,
    created_at: record.created_at ?? ts,
    updated_at: ts,
    synced: false,
  } as ParcelRecord;

  // Saved on the device together with its queued operation, then sent at once when online
  const result = await enqueueInsert('parcels', full as unknown as Record<string, unknown>, {
    tables: [db.parcels], write: () => db.parcels.put(full),
  });
  if (!result.queued) await db.parcels.update(id, { synced: true });

  return { ...full, synced: !result.queued };
}

export async function localUpdateParcel(
  id: string,
  patch: Partial<ParcelRecord>,
): Promise<ParcelRecord | null> {
  const existing = await db.parcels.get(id);
  if (!existing) return null;

  const updated: ParcelRecord = {
    ...existing,
    ...patch,
    id,
    updated_at: nowIso(),
    synced: false,
  };

  const patchRecord = patch as unknown as Record<string, unknown>;
  if (hasRemoteMappableFields('parcels', patchRecord)) {
    // Saved on the device together with its queued operation (see localInsertParcel)
    const result = await enqueueUpdate('parcels', id, patchRecord, {
      tables: [db.parcels], write: () => db.parcels.put(updated),
    });
    if (!result.queued) await db.parcels.update(id, { synced: true });
  } else {
    await db.parcels.put({ ...updated, synced: true });
  }

  return updated;
}

// Date and author columns set by each status, as the server functions do (parcel.service)
const STATUS_STAMPS: Record<string, { at: string; by: string }> = {
  mis_en_paquet: { at: 'packaged_at', by: 'packaged_by' },
  expedie: { at: 'shipped_at', by: 'shipped_by' },
  arrive: { at: 'arrived_at', by: 'arrived_by' },
  livre: { at: 'delivered_at', by: 'delivered_by' },
};

/**
 * Status change made on the device: saved at once, sent now when the server answers, otherwise
 * kept in the queue and sent when the network is back. The recipient's "arrived" SMS goes with it.
 * A parcel not kept on this device is first read from the server (only possible online).
 */
export async function localAdvanceParcel(
  id: string,
  newStatus: string,
  userId: string | null,
  additionalData: Record<string, unknown> = {},
): Promise<ParcelRecord | null> {
  const now = nowIso();
  const patch: Record<string, unknown> = { status: newStatus, ...additionalData };
  const stamps = STATUS_STAMPS[newStatus];
  if (stamps) {
    patch[stamps.at] = now;
    if (userId) patch[stamps.by] = userId;
  }

  if (!(await db.parcels.get(id)) && isOnline()) await pullParcel(id);
  const updated = await localUpdateParcel(id, patch as Partial<ParcelRecord>);
  if (updated && newStatus === 'arrive' && updated.recipient_phone) {
    await enqueueSms({ kind: 'arrived', parcel_id: id, recipient_phone: updated.recipient_phone });
  }
  return updated;
}

export interface ReceptionResult {
  success: boolean;
  code: string;
  message: string;
  parcel_id: string | null;
}

/**
 * Reception by QR code without network: same checks as the server function receive_parcel_by_qr,
 * on the parcels kept on the device (those sent to this station are pulled while online).
 */
export async function receiveParcelLocally(
  parcelCode: string,
  stationId: string,
  userId: string | null,
): Promise<ReceptionResult> {
  const parcel = await db.parcels.where('parcel_code').equals(parcelCode).first();
  if (!parcel) {
    return {
      success: false,
      code: 'not_found',
      message: 'Colis introuvable sur ce poste (hors ligne). Réessayez une fois la connexion revenue.',
      parcel_id: null,
    };
  }
  if (parcel.status === 'arrive') {
    return { success: false, code: 'already_arrived', message: 'Ce colis a déjà été réceptionné.', parcel_id: parcel.id };
  }
  if (parcel.status === 'livre') {
    return { success: false, code: 'already_delivered', message: 'Ce colis a déjà été livré au client.', parcel_id: parcel.id };
  }
  if (!['expedie', 'mis_en_paquet', 'enregistre'].includes(parcel.status)) {
    return { success: false, code: 'invalid_status', message: 'Ce colis ne peut pas être réceptionné dans son état actuel.', parcel_id: parcel.id };
  }
  if (parcel.destination_station_id !== stationId) {
    return { success: false, code: 'wrong_station', message: 'Ce colis n\'est pas destiné à votre gare.', parcel_id: parcel.id };
  }
  await localAdvanceParcel(parcel.id, 'arrive', userId);
  return {
    success: true,
    code: 'ok',
    message: 'Colis réceptionné (hors ligne) — envoyé au serveur au retour de la connexion.',
    parcel_id: parcel.id,
  };
}

/** Copies one parcel from the server to the device. */
async function pullParcel(id: string): Promise<void> {
  try {
    const { data } = await supabase
      .from('parcels')
      .select(PARCEL_SELECT)
      .eq('id', id)
      .maybeSingle();
    if (data) await db.parcels.put(mapRemoteParcelToLocal(data as unknown as Record<string, unknown>));
  } catch { /* stays unknown on the device */ }
}

export async function localDeleteParcel(id: string): Promise<void> {
  // Deleted on the device together with the queueing of the deletion
  await enqueueDelete('parcels', id, {
    tables: [db.parcels, db.tracking_events],
    write: async () => {
      await db.tracking_events.where('parcel_id').equals(id).delete();
      await db.parcels.delete(id);
    },
  });
}

export async function localInsertTrackingEvent(
  record: Omit<TrackingEventRecord, 'id' | 'created_at' | 'synced'> & Partial<TrackingEventRecord>,
): Promise<TrackingEventRecord> {
  const id = record.id ?? uuid();
  const ts = nowIso();
  const full: TrackingEventRecord = {
    ...record,
    id,
    created_at: ts,
    synced: false,
  } as TrackingEventRecord;

  // Saved on the device together with its queued operation (see localInsertParcel)
  const result = await enqueueInsert('tracking_events', full as unknown as Record<string, unknown>, {
    tables: [db.tracking_events], write: () => db.tracking_events.put(full),
  });
  if (!result.queued) await db.tracking_events.update(id, { synced: true });
  full.synced = !result.queued;

  return full;
}

export async function getLocalParcel(id: string): Promise<ParcelRecord | undefined> {
  return db.parcels.get(id);
}

export async function getAllLocalParcels(): Promise<ParcelRecord[]> {
  return db.parcels.toArray();
}

export async function getLocalTrackingEvents(parcelId: string): Promise<TrackingEventRecord[]> {
  const events = await db.tracking_events.where('parcel_id').equals(parcelId).toArray();
  return events.sort((a, b) => (a.event_at ?? '').localeCompare(b.event_at ?? ''));
}

export async function pendingCount(): Promise<number> {
  return getPendingCount();
}

// ── Sync from server: pull parcel changes made externally ──

const PARCEL_SELECT = `
  *,
  origin_station:stations!origin_station_id(id, name),
  dest_station:stations!destination_station_id(id, name),
  companies(name)
`;

// Supabase's maximum number of rows per request
const PAGE_SIZE = 1000;
// A long list of ids in one `in` filter makes the request URL too long
const ID_CHUNK = 100;
// Parcels kept up to date on the device: all those still in progress, plus the recent ones
const RECENT_DAYS = 30;

/**
 * Pulls this station's parcels (sent and received) so that the courrier screens work without
 * network: those still in progress whatever their age, and those registered in the last days.
 * Read page by page: a busy station has more than 1 000 parcels.
 */
export async function syncParcelsFromServer(stationId?: string): Promise<void> {
  if (!isOnline()) return;
  try {
    // Date only: no reserved characters inside the filter
    const since = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString().slice(0, 10);
    const remoteParcels: Record<string, unknown>[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      // (recent OR in progress) AND (sent OR received by the station), as one filter
      const recent = `registered_at.gte.${since}`;
      const active = 'status.in.(enregistre,mis_en_paquet,expedie,arrive)';
      const filter = stationId
        ? [recent, active].flatMap(c => [
            `and(${c},origin_station_id.eq.${stationId})`,
            `and(${c},destination_station_id.eq.${stationId})`,
          ]).join(',')
        : `${recent},${active}`;
      const { data, error } = await supabase
        .from('parcels')
        .select(PARCEL_SELECT)
        .or(filter)
        .order('registered_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      remoteParcels.push(...((data ?? []) as unknown as Record<string, unknown>[]));
      if (!data || data.length < PAGE_SIZE) break;
    }

    // Operations not yet sent: the device's copy is more recent than the server's
    const pendingIds = new Set(
      (await db.sync_queue.where('entity').equals('parcels').toArray())
        .filter(i => i.status !== 'done' && i.status !== 'abandoned')
        .map(i => String(i.payload?.id ?? '')),
    );

    for (const p of remoteParcels) {
      const id = p.id as string;
      if (pendingIds.has(id)) continue;
      const localRecord = mapRemoteParcelToLocal(p);
      const existing = await db.parcels.get(id);
      // Server wins on shared fields, preserve local-only fields
      await db.parcels.put(existing ? { ...existing, ...localRecord, synced: true } : { ...localRecord, synced: true });
    }

    // Tracking events of the parcels just pulled, by groups of ids
    const ids = remoteParcels.map(p => p.id as string);
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const { data: remoteEvents, error: evtError } = await supabase
        .from('parcel_tracking_events')
        .select('*, stations(name)')
        .in('parcel_id', ids.slice(i, i + ID_CHUNK))
        .order('event_at', { ascending: true });
      if (evtError || !remoteEvents) continue;
      for (const evt of remoteEvents as unknown as Record<string, unknown>[]) {
        const evtRecord = mapRemoteEventToLocal(evt);
        const existing = await db.tracking_events.get(evt.id as string);
        await db.tracking_events.put(existing ? { ...existing, ...evtRecord, synced: true } : { ...evtRecord, synced: true });
      }
    }
  } catch (err) {
    console.warn('[courrier-sync] Failed to sync from server:', err);
  }
}

function mapRemoteParcelToLocal(p: Record<string, unknown>): ParcelRecord {
  const originStation = p.origin_station as { id?: string; name?: string } | null;
  const destStation = p.dest_station as { id?: string; name?: string } | null;
  const company = p.companies as { name?: string } | null;
  return {
    id: p.id as string,
    parcel_code: (p.parcel_code as string) ?? '',
    reference: (p.reference as string) ?? '',
    daily_sequence: (p.daily_sequence as number) ?? 0,
    sender_name: (p.sender_name as string) ?? '',
    sender_phone: (p.sender_phone as string) ?? '',
    sender_address: (p.sender_address as string) ?? null,
    recipient_name: (p.recipient_name as string) ?? '',
    recipient_phone: (p.recipient_phone as string) ?? '',
    recipient_city: (p.recipient_city as string) ?? '',
    recipient_address: (p.recipient_address as string) ?? null,
    origin_station_id: (p.origin_station_id as string) ?? '',
    origin_station_name: originStation?.name ?? '',
    destination_station_id: (p.destination_station_id as string) ?? '',
    destination_station_name: destStation?.name ?? '',
    schedule_id: (p.schedule_id as string) ?? null,
    driver_id: (p.driver_id as string) ?? null,
    bus_id: (p.bus_id as string) ?? null,
    declared_value: (p.declared_value as number) ?? 0,
    delivery_fee: (p.delivery_fee as number) ?? 0,
    sms_tracking_fee: (p.sms_tracking_fee as number) ?? 0,
    total_amount: (p.total_amount as number) ?? 0,
    priority: (p.priority as string) ?? 'standard',
    planned_date: (p.planned_date as string) ?? null,
    nature: (p.nature as string) ?? 'autre',
    content_description: (p.content_description as string) ?? '',
    notes: (p.notes as string) ?? null,
    status: (p.status as string) ?? 'enregistre',
    registered_at: (p.registered_at as string) ?? nowIso(),
    registered_by: (p.registered_by as string) ?? null,
    packaged_at: (p.packaged_at as string) ?? null,
    shipped_at: (p.shipped_at as string) ?? null,
    arrived_at: (p.arrived_at as string) ?? null,
    delivered_at: (p.delivered_at as string) ?? null,
    tracking_url: (p.tracking_url as string) ?? '',
    sms_sent_at: (p.sms_sent_at as string) ?? null,
    company_id: (p.company_id as string) ?? null,
    ticket_printed: (p.ticket_printed as boolean) ?? false,
    delivery_recipient_name: (p.delivery_recipient_name as string) ?? null,
    delivery_recipient_phone: (p.delivery_recipient_phone as string) ?? null,
    delivery_id_number: (p.delivery_id_number as string) ?? null,
    delivery_id_type: (p.delivery_id_type as string) ?? null,
    created_at: (p.created_at as string) ?? nowIso(),
    updated_at: (p.updated_at as string) ?? nowIso(),
    synced: true,
  };
}

function mapRemoteEventToLocal(e: Record<string, unknown>): TrackingEventRecord {
  const station = e.stations as { name?: string } | null;
  return {
    id: e.id as string,
    parcel_id: e.parcel_id as string,
    event_type: (e.event_type as string) ?? '',
    description: (e.description as string) ?? null,
    location: station?.name ?? null,
    station_id: (e.station_id as string) ?? null,
    performed_by: (e.performed_by as string) ?? null,
    performer_name: (e.performer_name as string) ?? null,
    event_at: (e.event_at as string) ?? nowIso(),
    metadata: (e.metadata as Record<string, unknown>) ?? {},
    created_at: nowIso(),
    synced: true,
  };
}

// ── Convert ParcelRecord to Parcel type for UI consumption ──

export function parcelRecordToParcel(r: ParcelRecord): Parcel {
  return {
    id: r.id,
    parcel_code: r.parcel_code,
    reference: r.reference,
    daily_sequence: r.daily_sequence,
    sender_name: r.sender_name,
    sender_phone: r.sender_phone,
    sender_address: r.sender_address,
    recipient_name: r.recipient_name,
    recipient_phone: r.recipient_phone,
    recipient_city: r.recipient_city,
    recipient_address: r.recipient_address,
    origin_station_id: r.origin_station_id,
    origin_station_name: r.origin_station_name,
    destination_station_id: r.destination_station_id,
    destination_station_name: r.destination_station_name,
    schedule_id: r.schedule_id,
    driver_id: r.driver_id,
    driver_name: null,
    bus_registration: null,
    declared_value: r.declared_value,
    delivery_fee: r.delivery_fee,
    sms_tracking_fee: r.sms_tracking_fee,
    total_amount: r.total_amount,
    priority: r.priority as Parcel['priority'],
    planned_date: r.planned_date,
    nature: r.nature as Parcel['nature'],
    content_description: r.content_description,
    parcel_photos: [],
    notes: r.notes,
    status: r.status as Parcel['status'],
    registered_at: r.registered_at,
    registered_by_name: '',
    packaged_at: r.packaged_at,
    shipped_at: r.shipped_at,
    arrived_at: r.arrived_at,
    delivered_at: r.delivered_at,
    tracking_url: r.tracking_url,
    sms_sent_at: r.sms_sent_at,
    company_id: r.company_id,
    company_name: null,
    ticket_printed: r.ticket_printed,
  };
}
