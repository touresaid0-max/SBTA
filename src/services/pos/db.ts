import Dexie, { type Table } from 'dexie';

export type SyncOp = 'insert' | 'update' | 'delete';
export type SyncStatus = 'pending' | 'syncing' | 'done' | 'error';

export interface SeatAllocation {
  station_id: string;
  station_name: string;
  seat_from: number;
  seat_to: number;
}

export interface DepartRecord {
  id: string;
  departure_number: number;
  route_id: string;
  route_name?: string;
  route_number: number;
  bus_id: string;
  bus_plate?: string;
  bus_name?: string;
  driver_id: string;
  driver_name?: string;
  convoyeur_id?: string;
  convoyeur_name?: string;
  apprenti_id?: string;
  apprenti_name?: string;
  departure_datetime: string;
  departure_date: string;
  departure_time: string;
  is_ac: boolean;
  status: string;
  seats_total: number;
  seats_from: number;
  seats_sold: number;
  seat_allocations?: SeatAllocation[];
  station_id: string;
  station_name?: string;
  counter_id?: string;
  other_station_id?: string;
  other_station_name?: string;
  cloture: boolean;
  cloture_at?: string;
  cloture_by?: string;
  mt_ticket: number;
  mt_bagage: number;
  tot_depense: number;
  solde: number;
  caisse: number;
  confirmed: boolean;
  cancelled: boolean;
  created_at: string;
  updated_at: string;
  synced?: boolean;
}

export interface TicketRecord {
  id: string;
  depart_id: string;
  ticket_number: string;
  seat_number: number;
  seat_numbers: string[];
  destination: string;
  destination_id?: string;
  passenger_name: string;
  passenger_phone: string;
  price: number;
  original_price: number;
  is_reduced: boolean;
  is_reported: boolean;
  is_ac: boolean;
  print_ticket: boolean;
  payment_method: string;
  status: string;
  loyalty_card_number?: string;
  loyalty_name?: string;
  created_at: string;
  updated_at: string;
  synced?: boolean;
}

export interface BagageRecord {
  id: string;
  depart_id: string;
  bagage_number: string;
  ticket_id?: string;
  ticket_number?: string;
  with_ticket: boolean;
  with_ticket_report: boolean;
  price: number;
  destination: string;
  description: string;
  car_plate: string;
  owner_name: string;
  owner_phone: string;
  print_bagage: boolean;
  created_at: string;
  updated_at: string;
  synced?: boolean;
}

export interface DepenseRecord {
  id: string;
  depart_id: string;
  type: string;
  label: string;
  amount: number;
  description: string;
  station_id: string;
  expense_date: string;
  created_at: string;
  updated_at: string;
  synced?: boolean;
}

export interface ReferentielRecord {
  key: string;
  type: 'lignes' | 'vehicules' | 'chauffeurs' | 'tarifs' | 'gares' | 'route_city_stops';
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
  assigned_route_ids?: string[];
  login_at: string;
  offline: boolean;
  password_hash?: string;
}

export type PrintBackend = 'webserial' | 'webusb' | 'qztray' | 'browser';

export interface PrintSettings {
  id: string;
  backend: PrintBackend;
  printer_name?: string;
  width_mm: 58 | 80;
  header_lines: string[];
  footer_lines: string[];
  auto_cut: boolean;
  qz_host: string;
  qz_port: number;
}

class POSDatabase extends Dexie {
  departs!: Table<DepartRecord, string>;
  tickets!: Table<TicketRecord, string>;
  bagages!: Table<BagageRecord, string>;
  depenses!: Table<DepenseRecord, string>;
  referentiels!: Table<ReferentielRecord, string>;
  sync_queue!: Table<SyncQueueItem, number>;
  session!: Table<SessionRecord, string>;
  print_settings!: Table<PrintSettings, string>;

  constructor() {
    super('pos_guichet_db');
    this.version(1).stores({
      departs: 'id, route_id, bus_id, driver_id, station_id, departure_datetime, status, synced',
      tickets: 'id, depart_id, status, created_at, synced',
      bagages: 'id, depart_id, ticket_id, created_at, synced',
      depenses: 'id, station_id, depart_id, type, created_at, synced',
      referentiels: 'key, type, updated_at',
      sync_queue: '++id, entity, status, created_at, tries',
      session: 'id, user_id, station_id',
      print_settings: 'id',
    });
    this.version(2).stores({
      departs: 'id, route_id, bus_id, driver_id, station_id, counter_id, departure_datetime, status, synced',
      tickets: 'id, depart_id, status, created_at, synced',
      bagages: 'id, depart_id, ticket_id, created_at, synced',
      depenses: 'id, station_id, depart_id, type, created_at, synced',
      referentiels: 'key, type, updated_at',
      sync_queue: '++id, entity, status, created_at, tries',
      session: 'id, user_id, station_id',
      print_settings: 'id',
    });
  }
}

export const db = new POSDatabase();
