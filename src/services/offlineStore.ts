const DB_NAME = 'guichet_offline_v1';
const DB_VERSION = 2;

export type OfflineTicketStatus = 'pending' | 'syncing' | 'synced' | 'error';

export interface OfflineTicket {
  localId: string;
  createdAt: string;
  status: OfflineTicketStatus;
  errorMessage?: string;
  syncedAt?: string;
  onlineId?: string;

  scheduleId: string;
  scheduleSnapshot: {
    route_name: string;
    departure_datetime: string;
    arrival_datetime: string;
    price: number;
    seats_available: number;
    seats_reserved: number;
    bus_registration: string;
  };
  passengerName: string;
  passengerPhone: string;
  seatNumbers: string[];
  totalSeats: number;
  totalPrice: number;
  paymentMethod: string;
  paymentReference?: string;
  bookingReference: string;
  bookedBy: string;
  changeAmount?: number;
  destinationCityName?: string;
}

export interface CachedSchedule {
  id: string;
  cachedAt: string;
  route_name: string;
  departure_datetime: string;
  arrival_datetime: string;
  price: number;
  seats_available: number;
  seats_reserved: number;
  estimated_duration_minutes: number | null;
  notes: string | null;
  bus_id: string;
  buses: {
    registration_number: string;
    total_seats: number;
    class: string;
    model: string | null;
    brand: string | null;
    seat_config_id: string | null;
  };
  route: {
    id: string;
    name: string;
    origin_city_id: string;
    destination_city_id: string;
    distance_km: number | null;
    base_price: number | null;
  };
  origin_city_name: string;
  destination_city_name: string;
  transit_stops?: { station_id: string; station_name: string; price: number; position: number; arrival_offset_minutes: number; departure_offset_minutes: number }[];
}

class OfflineStore {
  private db: IDBDatabase | null = null;

  async open(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('offline_tickets')) {
          const store = db.createObjectStore('offline_tickets', { keyPath: 'localId' });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('cached_schedules')) {
          const sched = db.createObjectStore('cached_schedules', { keyPath: 'id' });
          sched.createIndex('departure_datetime', 'departure_datetime', { unique: false });
        }
        if (!db.objectStoreNames.contains('cached_cities')) {
          db.createObjectStore('cached_cities', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        this.db = req.result;
        resolve(this.db);
      };
      req.onerror = () => reject(req.error);
    });
  }

  private async tx<T>(
    stores: string | string[],
    mode: IDBTransactionMode,
    fn: (tx: IDBTransaction) => Promise<T>
  ): Promise<T> {
    const db = await this.open();
    const storeNames = Array.isArray(stores) ? stores : [stores];
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeNames, mode);
      fn(tx).then(resolve).catch(reject);
      tx.onerror = () => reject(tx.error);
    });
  }

  private req<T>(r: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  async saveTicket(ticket: OfflineTicket): Promise<void> {
    await this.tx('offline_tickets', 'readwrite', async (tx) => {
      const store = tx.objectStore('offline_tickets');
      await this.req(store.put(ticket));
    });
  }

  async getTicket(localId: string): Promise<OfflineTicket | undefined> {
    return this.tx('offline_tickets', 'readonly', async (tx) => {
      const store = tx.objectStore('offline_tickets');
      return this.req<OfflineTicket>(store.get(localId));
    });
  }

  async getAllTickets(): Promise<OfflineTicket[]> {
    return this.tx('offline_tickets', 'readonly', async (tx) => {
      const store = tx.objectStore('offline_tickets');
      return this.req<OfflineTicket[]>(store.getAll());
    });
  }

  async getPendingTickets(): Promise<OfflineTicket[]> {
    return this.tx('offline_tickets', 'readonly', async (tx) => {
      const store = tx.objectStore('offline_tickets');
      const idx = store.index('status');
      const [pending, error] = await Promise.all([
        this.req<OfflineTicket[]>(idx.getAll('pending')),
        this.req<OfflineTicket[]>(idx.getAll('error')),
      ]);
      return [...pending, ...error];
    });
  }

  async updateTicketStatus(
    localId: string,
    status: OfflineTicketStatus,
    extra?: Partial<OfflineTicket>
  ): Promise<void> {
    await this.tx('offline_tickets', 'readwrite', async (tx) => {
      const store = tx.objectStore('offline_tickets');
      const ticket = await this.req<OfflineTicket>(store.get(localId));
      if (!ticket) return;
      await this.req(store.put({ ...ticket, status, ...extra }));
    });
  }

  async deleteTicket(localId: string): Promise<void> {
    await this.tx('offline_tickets', 'readwrite', async (tx) => {
      const store = tx.objectStore('offline_tickets');
      await this.req(store.delete(localId));
    });
  }

  async cacheSchedules(schedules: CachedSchedule[]): Promise<void> {
    await this.tx('cached_schedules', 'readwrite', async (tx) => {
      const store = tx.objectStore('cached_schedules');
      await this.req(store.clear());
      for (const s of schedules) {
        await this.req(store.put({ ...s, cachedAt: new Date().toISOString() }));
      }
    });
  }

  async getCachedSchedules(): Promise<CachedSchedule[]> {
    return this.tx('cached_schedules', 'readonly', async (tx) => {
      const store = tx.objectStore('cached_schedules');
      return this.req<CachedSchedule[]>(store.getAll());
    });
  }

  async cacheCities(cities: { id: string; name: string }[]): Promise<void> {
    await this.tx('cached_cities', 'readwrite', async (tx) => {
      const store = tx.objectStore('cached_cities');
      await this.req(store.clear());
      for (const c of cities) {
        await this.req(store.put(c));
      }
    });
  }

  async getCachedCities(): Promise<{ id: string; name: string }[]> {
    return this.tx('cached_cities', 'readonly', async (tx) => {
      const store = tx.objectStore('cached_cities');
      return this.req<{ id: string; name: string }[]>(store.getAll());
    });
  }

  async decrementCachedScheduleSeats(scheduleId: string, count: number): Promise<void> {
    await this.tx('cached_schedules', 'readwrite', async (tx) => {
      const store = tx.objectStore('cached_schedules');
      const sched = await this.req<CachedSchedule>(store.get(scheduleId));
      if (!sched) return;
      await this.req(store.put({
        ...sched,
        seats_available: Math.max(0, sched.seats_available - count),
        seats_reserved: (sched.seats_reserved || 0) + count,
      }));
    });
  }
}

export const offlineStore = new OfflineStore();
