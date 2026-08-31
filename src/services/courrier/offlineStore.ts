import { db, type ParcelRecord, type TrackingEventRecord } from './db';
import { supabase } from '@/services/supabase';
import { enqueueInsert, enqueueUpdate, enqueueDelete, isOnline, getPendingCount } from './syncEngine';
import type { Parcel } from '@/types/parcel.types';

function uuid(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function nowIso(): string {
  return new Date().toISOString();
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
  const online = isOnline();
  const full: ParcelRecord = {
    ...record,
    id,
    created_at: record.created_at ?? ts,
    updated_at: ts,
    synced: online,
  } as ParcelRecord;

  await db.parcels.put(full);

  try {
    const result = await enqueueInsert('parcels', full as unknown as Record<string, unknown>);
    if (!result.queued) {
      await db.parcels.put({ ...full, synced: true });
    }
  } catch {
    // Network error — record stays locally with synced=false
  }

  return full;
}

export async function localUpdateParcel(
  id: string,
  patch: Partial<ParcelRecord>,
): Promise<ParcelRecord | null> {
  const existing = await db.parcels.get(id);
  if (!existing) return null;

  const online = isOnline();
  const updated: ParcelRecord = {
    ...existing,
    ...patch,
    id,
    updated_at: nowIso(),
    synced: online,
  };

  await db.parcels.put(updated);

  const patchRecord = patch as unknown as Record<string, unknown>;
  if (hasRemoteMappableFields('parcels', patchRecord)) {
    try {
      const result = await enqueueUpdate('parcels', id, patchRecord);
      if (!result.queued) {
        await db.parcels.put({ ...updated, synced: true });
      }
    } catch {
      // Network error — local update is preserved, will sync later
    }
  } else {
    await db.parcels.put({ ...updated, synced: true });
  }

  return updated;
}

export async function localDeleteParcel(id: string): Promise<void> {
  await db.tracking_events.where('parcel_id').equals(id).delete();
  await db.parcels.delete(id);
  try {
    await enqueueDelete('parcels', id);
  } catch {
    // Network error — deletion will be synced later
  }
}

export async function localInsertTrackingEvent(
  record: Omit<TrackingEventRecord, 'id' | 'created_at' | 'synced'> & Partial<TrackingEventRecord>,
): Promise<TrackingEventRecord> {
  const id = record.id ?? uuid();
  const ts = nowIso();
  const online = isOnline();
  const full: TrackingEventRecord = {
    ...record,
    id,
    created_at: ts,
    synced: online,
  } as TrackingEventRecord;

  await db.tracking_events.put(full);

  try {
    const result = await enqueueInsert('tracking_events', full as unknown as Record<string, unknown>);
    if (!result.queued) {
      await db.tracking_events.put({ ...full, synced: true });
    }
  } catch {
    // Network error — stays locally with synced=false
  }

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

export async function syncParcelsFromServer(stationId?: string): Promise<void> {
  if (!isOnline()) return;
  try {
    let query = supabase
      .from('parcels')
      .select(`
        *,
        origin_station:stations!origin_station_id(id, name),
        dest_station:stations!destination_station_id(id, name),
        companies(name)
      `);

    if (stationId) {
      query = query.or(`origin_station_id.eq.${stationId},destination_station_id.eq.${stationId}`);
    }

    const { data: remoteParcels, error } = await query.order('registered_at', { ascending: false });
    if (error) throw error;

    if (remoteParcels && remoteParcels.length > 0) {
      for (const p of remoteParcels as unknown as Record<string, unknown>[]) {
        const localRecord = mapRemoteParcelToLocal(p);
        const existing = await db.parcels.get(p.id as string);
        if (existing) {
          // Server wins on shared fields, preserve local-only fields
          await db.parcels.put({
            ...existing,
            ...localRecord,
            synced: true,
          });
        } else {
          await db.parcels.put({ ...localRecord, synced: true });
        }
      }
    }

    // Pull tracking events for the parcels we have locally
    const localParcelIds = (await db.parcels.toArray()).map(p => p.id);
    if (localParcelIds.length > 0) {
      const { data: remoteEvents, error: evtError } = await supabase
        .from('parcel_tracking_events')
        .select('*, stations(name)')
        .in('parcel_id', localParcelIds)
        .order('event_at', { ascending: true });

      if (!evtError && remoteEvents) {
        for (const evt of remoteEvents as unknown as Record<string, unknown>[]) {
          const evtRecord = mapRemoteEventToLocal(evt);
          const existing = await db.tracking_events.get(evt.id as string);
          if (existing) {
            await db.tracking_events.put({ ...existing, ...evtRecord, synced: true });
          } else {
            await db.tracking_events.put({ ...evtRecord, synced: true });
          }
        }
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
