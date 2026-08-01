import Dexie, { type Table } from 'dexie';

export type SyncOp = 'insert' | 'update' | 'delete';
export type SyncStatus = 'pending' | 'syncing' | 'done' | 'error';

export interface DepartRecord {
  id: string;
  route_id: string;
  route_name?: string;
  bus_id: string;
  bus_plate?: string;
  driver_id: string;
  driver_name?: string;
  departure_datetime: string;
  status: string;
  seats_total: number;
  seats_sold: number;
  station_id: string;
  created_at: string;
  updated_at: string;
  synced?: boolean;
}

export interface TicketRecord {
  id: string;
  depart_id: string;
  seat_numbers: string[];
  passenger_name: string;
  passenger_phone: string;
  price: number;
  payment_method: string;
  status: string;
  created_at: string;
  updated_at: string;
  synced?: boolean;
}

export interface BagageRecord {
  id: string;
  depart_id: string;
  ticket_id?: string;
  description: string;
  weight: number;
  price: number;
  owner_name: string;
  owner_phone: string;
  created_at: string;
  updated_at: string;
  synced?: boolean;
}

export interface DepenseRecord {
  id: string;
  type: string;
  amount: number;
  description: string;
  station_id: string;
  created_at: string;
  updated_at: string;
  synced?: boolean;
}

export interface ReferentielRecord {
  key: string;
  type: 'lignes' | 'vehicules' | 'chauffeurs' | 'tarifs' | 'gares';
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
  counter_id?: string;
  counter_number?: string;
  login_at: string;
  offline: boolean;
  password_hash?: string;
}

class POSDatabase extends Dexie {
  departs!: Table<DepartRecord, string>;
  tickets!: Table<TicketRecord, string>;
  bagages!: Table<BagageRecord, string>;
  depenses!: Table<DepenseRecord, string>;
  referentiels!: Table<ReferentielRecord, string>;
  sync_queue!: Table<SyncQueueItem, number>;
  session!: Table<SessionRecord, string>;

  constructor() {
    super('pos_guichet_db');
    this.version(1).stores({
      departs: 'id, route_id, bus_id, driver_id, station_id, departure_datetime, status, synced',
      tickets: 'id, depart_id, status, created_at, synced',
      bagages: 'id, depart_id, ticket_id, created_at, synced',
      depenses: 'id, station_id, type, created_at, synced',
      referentiels: 'key, type, updated_at',
      sync_queue: '++id, entity, status, created_at, tries',
      session: 'id, user_id, station_id',
    });
  }
}

export const db = new POSDatabase();
