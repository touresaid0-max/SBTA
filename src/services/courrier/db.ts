import Dexie, { type Table } from 'dexie';

export type SyncOp = 'insert' | 'update' | 'delete';
export type SyncStatus = 'pending' | 'syncing' | 'done' | 'error';

export interface ParcelRecord {
  id: string;
  parcel_code: string;
  reference: string;
  daily_sequence: number;
  sender_name: string;
  sender_phone: string;
  sender_address: string | null;
  recipient_name: string;
  recipient_phone: string;
  recipient_city: string;
  recipient_address: string | null;
  origin_station_id: string;
  origin_station_name: string;
  destination_station_id: string;
  destination_station_name: string;
  schedule_id: string | null;
  driver_id: string | null;
  bus_id: string | null;
  declared_value: number;
  delivery_fee: number;
  sms_tracking_fee: number;
  total_amount: number;
  priority: string;
  planned_date: string | null;
  nature: string;
  content_description: string;
  notes: string | null;
  status: string;
  registered_at: string;
  registered_by: string | null;
  packaged_at: string | null;
  shipped_at: string | null;
  arrived_at: string | null;
  delivered_at: string | null;
  tracking_url: string;
  sms_sent_at: string | null;
  company_id: string | null;
  ticket_printed: boolean;
  // Delivery recipient info (for livre status)
  delivery_recipient_name: string | null;
  delivery_recipient_phone: string | null;
  delivery_id_number: string | null;
  delivery_id_type: string | null;
  created_at: string;
  updated_at: string;
  synced?: boolean;
}

export interface TrackingEventRecord {
  id: string;
  parcel_id: string;
  event_type: string;
  description: string | null;
  location: string | null;
  station_id: string | null;
  performed_by: string | null;
  performer_name: string | null;
  event_at: string;
  metadata: Record<string, unknown>;
  created_at: string;
  synced?: boolean;
}

export interface ReferentielRecord {
  key: string;
  type: 'stations' | 'companies' | 'drivers' | 'buses' | 'schedules';
  data: unknown;
  updated_at: string;
}

export interface SyncQueueItem {
  id?: number;
  entity: string;
  op: SyncOp;
  payload: Record<string, unknown>;
  created_at: string;
  tries: number;
  status: SyncStatus;
  last_error?: string;
}

export interface SessionRecord {
  id: string;
  user_id: string;
  email: string;
  full_name: string;
  role: string;
  station_id: string;
  station_name: string;
  login_at: string;
  offline: boolean;
  password_hash?: string;
}

class CourrierDatabase extends Dexie {
  parcels!: Table<ParcelRecord, string>;
  tracking_events!: Table<TrackingEventRecord, string>;
  referentiels!: Table<ReferentielRecord, string>;
  sync_queue!: Table<SyncQueueItem, number>;
  session!: Table<SessionRecord, string>;

  constructor() {
    super('courrier_agent_db');
    this.version(1).stores({
      parcels: 'id, parcel_code, reference, status, origin_station_id, destination_station_id, registered_at, synced',
      tracking_events: 'id, parcel_id, event_at, synced',
      referentiels: 'key, type, updated_at',
      sync_queue: '++id, entity, status, created_at, tries',
      session: 'id, user_id, station_id',
    });
  }
}

export const db = new CourrierDatabase();
