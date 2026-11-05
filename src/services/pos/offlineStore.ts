import { db, type BagageRecord, type DepenseRecord, type DepartRecord, type TicketRecord } from './db';
import { supabase } from '@/services/supabase';
import { useAuthStore } from '@/store/authStore';
import { enqueueInsert, enqueueUpdate, enqueueDelete, isOnline, getPendingCount, normalizeExpenseType } from './syncEngine';
import { trustedNow, trustedNowIso } from '@/services/offline/deviceClock';
import { uuidV4 } from '@/utils/uuid';

function uuid(): string {
  return uuidV4();
}

function nowIso(): string {
  return trustedNowIso();
}

type StoreName = 'departs' | 'tickets' | 'bagages' | 'depenses';

// Fields that are LOCAL ONLY — updates containing ONLY these should not be sent to remote
const LOCAL_ONLY_UPDATE_FIELDS = new Set([
  'mt_ticket', 'mt_bagage', 'tot_depense', 'solde', 'caisse',
  'cloture_at', 'cloture_by', 'departure_number',
  'bus_plate', 'bus_name', 'driver_name', 'convoyeur_id', 'convoyeur_name',
  'apprenti_id', 'apprenti_name', 'departure_date', 'departure_time',
  'is_ac', 'seats_from', 'seat_allocations', 'station_name',
  'counter_id', 'other_station_id', 'other_station_name',
  'synced', 'updated_at', 'id',
  'printed', 'printed_at', 'reopened_at',
]);

function hasRemoteMappableFields(entity: StoreName, patch: Record<string, unknown>): boolean {
  const keys = Object.keys(patch).filter(k => !LOCAL_ONLY_UPDATE_FIELDS.has(k));
  if (keys.length === 0) return false;

  if (entity === 'departs') {
    const remoteMappable = ['route_id', 'bus_id', 'driver_id', 'station_id', 'arrival_station_id', 'is_ramassage', 'departure_datetime', 'status', 'seats_total', 'seats_sold', 'route_name', 'route_number', 'confirmed', 'cancelled', 'cloture'];
    return keys.some(k => remoteMappable.includes(k));
  }
  if (entity === 'tickets') {
    const remoteMappable = ['depart_id', 'seat_number', 'seat_numbers', 'destination', 'destination_id', 'passenger_name', 'passenger_phone', 'price', 'status'];
    return keys.some(k => remoteMappable.includes(k));
  }
  if (entity === 'bagages') {
    const remoteMappable = ['payment_status', 'paid_at', 'paid_by', 'destination', 'price', 'description', 'owner_name', 'owner_phone'];
    return keys.some(k => remoteMappable.includes(k));
  }
  if (entity === 'depenses') {
    // A modified expense is sent to the server (it used to stay on the device only)
    const remoteMappable = ['amount', 'label', 'type', 'description', 'expense_date'];
    return keys.some(k => remoteMappable.includes(k));
  }
  return false;
}

// ── Public API: offline-first — always write locally, then sync/queue ──

export async function localInsert<
  T extends { id: string; created_at: string; updated_at: string; synced?: boolean },
>(
  store: StoreName,
  record: Omit<T, 'id' | 'created_at' | 'updated_at' | 'synced'> & Partial<T>,
): Promise<T> {
  const id = record.id ?? uuid();
  const ts = nowIso();
  // Not synced until the server confirmed it (sent now, or later from the queue)
  const full = {
    ...record,
    id,
    created_at: record.created_at ?? ts,
    updated_at: ts,
    synced: false,
  } as unknown as T;

  // Saved on the device together with its queued operation, then sent at once when online
  // (marked synced once the server has it, or later from the queue)
  await enqueueInsert(store, full as unknown as Record<string, unknown>, undefined, {
    table: db[store], write: () => (db[store] as any).put(full),
  });

  return full;
}

export async function localUpdate<
  T extends { id: string; updated_at: string; synced?: boolean },
>(
  store: StoreName,
  id: string,
  patch: Partial<T>,
): Promise<T | null> {
  const existing = await (db[store] as any).get(id);
  if (!existing) return null;

  const updated = {
    ...existing,
    ...patch,
    id,
    updated_at: nowIso(),
    synced: false,
  } as unknown as T;

  const patchRecord = patch as unknown as Record<string, unknown>;
  if (hasRemoteMappableFields(store, patchRecord)) {
    // Saved on the device together with its queued operation (see localInsert)
    await enqueueUpdate(store, id, patchRecord, {
      table: db[store], write: () => (db[store] as any).put(updated),
    });
  } else {
    // No remote-mappable fields — mark as synced since there's nothing to send
    await (db[store] as any).put({ ...updated, synced: true });
  }

  return updated;
}

export async function localDelete(store: StoreName, id: string): Promise<void> {
  // Deleted on the device together with the queueing of the deletion
  await enqueueDelete(store, id, { table: db[store], write: () => (db[store] as any).delete(id) });
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  return await (db[store] as any).toArray();
}

export async function getById<T extends { id: string }>(
  store: StoreName,
  id: string,
): Promise<T | undefined> {
  return await (db[store] as any).get(id);
}

export async function pendingCount(): Promise<number> {
  return getPendingCount();
}

// ── Sync from server: pull schedule & ticket changes made externally (e.g. admin change requests) ──

function computeArrivalDatetime(departureIso: string): string {
  const dep = new Date(departureIso);
  if (isNaN(dep.getTime())) return new Date(Date.now() + 8 * 3600_000).toISOString();
  dep.setHours(dep.getHours() + 8);
  return dep.toISOString();
}

function mapRemoteScheduleToLocal(s: Record<string, unknown>): Record<string, unknown> {
  const bus = s.buses as { seats_sold_from?: number } | null | undefined;
  const seatsSoldFrom = Math.max(1, Number(bus?.seats_sold_from ?? 1));
  const depIso = s.departure_datetime as string;
  const depDate = depIso ? depIso.slice(0, 10) : trustedNowIso().slice(0, 10);
  const depTime = depIso ? depIso.slice(11, 16) : '00:00';
  return {
    id: s.id,
    route_id: s.route_id ?? null,
    route_name: s.route_name ?? null,
    bus_id: s.bus_id ?? null,
    driver_id: s.driver_id ?? null,
    departure_datetime: depIso,
    departure_date: depDate,
    departure_time: depTime,
    status: s.status ?? 'planifie',
    seats_total: s.seats_total ?? ((s.seats_available ?? 0) + (s.seats_reserved ?? 0)) ?? 0,
    seats_from: seatsSoldFrom,
    seats_sold: s.seats_reserved ?? 0,
    station_id: s.departure_station_id ?? null,
    station_name: s.station_name ?? null,
    counter_id: s.counter_id ?? null,
    company_id: s.company_id ?? null,
    is_ac: false,
    is_ramassage: s.is_ramassage ?? false,
    ramassage_notified: false,
    reopened_at: s.admin_reactivated_at ?? null,
    confirmed: s.status === 'en_cours',
    cancelled: s.status === 'annule',
    cloture: s.status === 'termine',
    is_panne: s.status === 'panne',
    is_convoi: s.status === 'convoi',
    is_retard: s.status === 'retard',
    departure_number: s.departure_number ?? null,
    route_number: (s as any).route_number ?? s.route_number ?? null,
    mt_ticket: 0,
    mt_bagage: 0,
    tot_depense: 0,
    solde: 0,
    caisse: 0,
    breakdown_transfer: 0,
  };
}

function mapRemoteReservationToLocalTicket(r: Record<string, unknown>): Record<string, unknown> {
  const seatNumbers = Array.isArray(r.seat_numbers) ? r.seat_numbers as string[] : [];
  const firstSeat = seatNumbers.length > 0 ? parseInt(seatNumbers[0], 10) : 0;
  const status = r.status as string;
  return {
    id: r.id,
    depart_id: r.schedule_id,
    ticket_number: r.booking_reference ?? r.id,
    seat_number: firstSeat,
    seat_numbers: seatNumbers,
    destination: r.destination_city_name ?? '',
    destination_id: null,
    passenger_name: r.passenger_name ?? '',
    passenger_phone: r.passenger_phone ?? '',
    price: Number(r.total_price ?? 0),
    original_price: Number(r.total_price ?? 0),
    is_reduced: false,
    is_reported: false,
    is_ac: false,
    print_ticket: true,
    payment_method: 'cash',
    status: status === 'annulee' ? 'cancelled' : 'sold',
    loyalty_card_number: r.loyalty_card_number ?? null,
    loyalty_name: null,
  };
}

// Supabase's maximum number of rows per request
const RESERVATION_PAGE_SIZE = 1000;

// Past-day departures are closed by the database every night (cron job sbta-cloture-minuit).
// As a fallback, each device asks for it once per day and station, not on every sync.
const AUTO_TERMINATE_KEY = 'sbta_auto_terminate_day';

function autoTerminateDoneToday(stationId: string | undefined, todayStr: string): boolean {
  try {
    return localStorage.getItem(`${AUTO_TERMINATE_KEY}:${stationId ?? 'all'}`) === todayStr;
  } catch {
    return false;
  }
}

function markAutoTerminateDone(stationId: string | undefined, todayStr: string): void {
  try {
    localStorage.setItem(`${AUTO_TERMINATE_KEY}:${stationId ?? 'all'}`, todayStr);
  } catch { /* storage unavailable: the call is simply repeated next sync */ }
}

// Departures of the last days are pulled again once per day and station, so that the tickets,
// baggage and expenses recorded on other counters after a departure's day reach this device too.
// The other syncs of the day only pull today's and future departures, to stay light.
const HISTORY_DAYS = 7;
// Departures re-opened by the admin within these days are pulled whatever their date
const REOPENED_DAYS = 60;

const SCHEDULE_COLUMNS = 'id, route_id, route_name, bus_id, driver_id, departure_datetime, status, seats_total, seats_available, seats_reserved, departure_station_id, counter_id, is_ramassage, departure_number, route_number, fill_rate, admin_reactivated_at, buses:bus_id(seats_sold_from)';
const HISTORY_SYNC_KEY = 'sbta_history_sync_day';

function historySyncDoneToday(stationId: string | undefined, todayStr: string): boolean {
  try {
    return localStorage.getItem(`${HISTORY_SYNC_KEY}:${stationId ?? 'all'}`) === todayStr;
  } catch {
    return false;
  }
}

function markHistorySyncDone(stationId: string | undefined, todayStr: string): void {
  try {
    localStorage.setItem(`${HISTORY_SYNC_KEY}:${stationId ?? 'all'}`, todayStr);
  } catch { /* storage unavailable: the history is simply pulled again next sync */ }
}

type RemoteSchedule = { id: string; bus_id: string | null; driver_id: string | null } & Record<string, unknown>;

// A long list of ids in one `in` filter makes the request URL too long
const SCHEDULE_ID_CHUNK = 100;

/**
 * Reads every row of `table` attached to the given departures, page by page.
 * Returns null if any request fails, so that callers never work from a partial list.
 */
async function fetchRowsForSchedules(
  table: string,
  columns: string,
  scheduleIds: string[],
): Promise<Record<string, unknown>[] | null> {
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < scheduleIds.length; i += SCHEDULE_ID_CHUNK) {
    const chunk = scheduleIds.slice(i, i + SCHEDULE_ID_CHUNK);
    for (let from = 0; ; from += RESERVATION_PAGE_SIZE) {
      const { data, error } = await supabase
        .from(table)
        .select(columns)
        .in('schedule_id', chunk)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + RESERVATION_PAGE_SIZE - 1);
      if (error) {
        console.warn(`[sync] Failed to read ${table}:`, error.message);
        return null;
      }
      rows.push(...((data ?? []) as unknown as Record<string, unknown>[]));
      if (!data || data.length < RESERVATION_PAGE_SIZE) break;
    }
  }
  return rows;
}

/** Ids of the records of a store that still have a local change waiting to be sent. */
async function getPendingIds(entity: StoreName): Promise<Set<string>> {
  const items = await db.sync_queue.where('entity').equals(entity).toArray();
  return new Set(
    items
      .filter(i => i.status !== 'done' && i.status !== 'abandoned')
      .map(i => String((i.payload as Record<string, unknown> | undefined)?.id ?? '')),
  );
}

/**
 * A departure deleted on the server: removed from the device, with its tickets, baggage and
 * expenses already sent (one still waiting to be sent is kept, so that nothing unsent is lost).
 */
async function removeDeletedDepart(departId: string): Promise<void> {
  const [pendingTickets, pendingBagages, pendingDepenses] = await Promise.all([
    getPendingIds('tickets'), getPendingIds('bagages'), getPendingIds('depenses'),
  ]);
  await db.transaction('rw', [db.departs, db.tickets, db.bagages, db.depenses], async () => {
    await db.tickets.where('depart_id').equals(departId).filter(t => !pendingTickets.has(t.id)).delete();
    await db.bagages.where('depart_id').equals(departId).filter(b => !pendingBagages.has(b.id)).delete();
    await db.depenses.where('depart_id').equals(departId).filter(d => !pendingDepenses.has(d.id)).delete();
    await db.departs.delete(departId);
  });
}

/** Registration numbers of the buses and names of the drivers, for the given ids. */
async function fetchBusAndDriverNames(
  busIds: string[],
  driverIds: string[],
): Promise<{ plates: Map<string, string>; drivers: Map<string, string> }> {
  const plates = new Map<string, string>();
  const drivers = new Map<string, string>();
  try {
    if (busIds.length > 0) {
      const { data } = await supabase.from('buses').select('id, registration_number').in('id', busIds);
      for (const b of data ?? []) if (b.registration_number) plates.set(b.id, b.registration_number);
    }
    if (driverIds.length > 0) {
      const { data } = await supabase.from('users').select('id, full_name').in('id', driverIds);
      for (const u of data ?? []) if (u.full_name) drivers.set(u.id, u.full_name);
    }
  } catch { /* names are only displayed: the departures stay usable without them */ }
  return { plates, drivers };
}

function mapRemoteBaggageToLocal(b: Record<string, unknown>): Record<string, unknown> {
  return {
    id: b.id,
    depart_id: b.schedule_id,
    bagage_number: b.baggage_number ?? '',
    ticket_id: b.reservation_id ?? undefined,
    linked_seat_number: b.seat_number ?? undefined,
    with_ticket: Boolean(b.has_ticket),
    with_ticket_report: false,
    price: Number(b.price ?? 0),
    destination: b.destination ?? '',
    description: b.description ?? '',
    car_plate: b.bus_registration ?? '',
    owner_name: b.owner_name ?? '',
    owner_phone: b.owner_phone ?? '',
    print_bagage: false,
    declared_value: Number(b.declared_value ?? 0),
    station_id: b.station_id ?? undefined,
    counter_id: b.counter_id ?? undefined,
    payment_status: b.payment_status === 'en_attente' ? 'en_attente' : 'paye',
    paid_at: b.paid_at ?? undefined,
    paid_by: b.paid_by ?? undefined,
    sold_by: b.sold_by ?? undefined,
  };
}

const CHARGE_TYPE_LABELS: Record<string, { type: string; label: string }> = {
  ration: { type: 'ratio', label: 'Ratio' },
  carburant_complement: { type: 'carburant', label: 'Carburant' },
  peage: { type: 'péages', label: 'Péages' },
  autres: { type: 'autres', label: 'Autres' },
};

function mapRemoteChargeToLocal(c: Record<string, unknown>): Record<string, unknown> {
  const kind = CHARGE_TYPE_LABELS[String(c.charge_type)] ?? CHARGE_TYPE_LABELS.autres;
  return {
    id: c.id,
    depart_id: c.schedule_id,
    type: kind.type,
    label: kind.label,
    amount: Number(c.amount ?? 0),
    description: c.description ?? '',
    station_id: c.station_id ?? '',
    bus_id: c.bus_id ?? undefined,
    counter_id: c.counter_id ?? undefined,
    expense_date: c.charge_date ?? '',
  };
}

/**
 * @param sinceDate Optional YYYY-MM-DD: also pull the departures from that day on, when the
 *   guichetier looks at a period older than what the device keeps (filter by period / range).
 */
export async function syncDepartsAndTicketsFromServer(stationId?: string, sinceDate?: string): Promise<void> {
  if (!isOnline()) return;
  try {
    const todayStr = trustedNowIso().slice(0, 10);

    // Auto-close departures from past days (server UTC midnight rollover)
    // This runs BEFORE syncing so closed status is reflected in the pulled data
    if (!autoTerminateDoneToday(stationId, todayStr)) {
      try {
        const { error } = await supabase.rpc('auto_terminate_past_schedules', {
          p_station_id: stationId ?? null,
        });
        if (!error) markAutoTerminateDone(stationId, todayStr);
      } catch {
        // Non-critical: continue with sync even if auto-terminate fails
      }
    }

    // Auto-close locally cached departs from past days that are still open.
    // The server RPC already closed them in Supabase, but local IndexedDB may
    // still have stale rows with cloture=false. We only pull today+ schedules
    // below, so past-day rows would never get their cloture flag updated.
    try {
      const allLocal = await (db.departs as any).toArray();
      const toClose = allLocal.filter(
        (d: Record<string, unknown>) =>
          (d as any).departure_date < todayStr &&
          !(d as any).cloture &&
          !(d as any).cancelled &&
          !(d as { reopened_at?: string | null }).reopened_at,
      );
      for (const d of toClose) {
        await (db.departs as any).put({
          ...d,
          cloture: true,
          cloture_at: trustedNowIso(),
          status: 'termine',
          updated_at: trustedNowIso(),
          synced: true,
        });
      }
    } catch { /* non-critical */ }

    const withHistory = !historySyncDoneToday(stationId, todayStr);
    const fromDate = trustedNow();
    if (withHistory) fromDate.setUTCDate(fromDate.getUTCDate() - HISTORY_DAYS);
    const defaultFrom = fromDate.toISOString().slice(0, 10);
    const fromStr = sinceDate && sinceDate < defaultFrom ? sinceDate : defaultFrom;

    // Page by page: a long period chosen in the filter can hold more than 1 000 departures,
    // and a truncated list would drop the most recent ones
    const remoteSchedules: RemoteSchedule[] = [];
    for (let from = 0; ; from += RESERVATION_PAGE_SIZE) {
      let scheduleQuery = supabase
        .from('schedules')
        .select(SCHEDULE_COLUMNS)
        .gte('departure_datetime', `${fromStr}T00:00:00`);
      // Only this station's departures: other stations' ones are never shown here (shared
      // buses rely on seat allocations kept on the device, not on pulled rows)
      if (stationId) scheduleQuery = scheduleQuery.eq('departure_station_id', stationId);

      const { data, error: schedError } = await scheduleQuery
        .order('departure_datetime', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + RESERVATION_PAGE_SIZE - 1);
      if (schedError) throw schedError;
      remoteSchedules.push(...((data ?? []) as unknown as RemoteSchedule[]));
      if (!data || data.length < RESERVATION_PAGE_SIZE) break;
    }

    // Departures of earlier days the admin re-opened: pulled too, so that the guichet sees them
    // open again and can correct them (older than the days pulled above otherwise)
    try {
      const reopenedSince = new Date(trustedNow().getTime() - REOPENED_DAYS * 86_400_000).toISOString();
      let reopenedQuery = supabase
        .from('schedules')
        .select(SCHEDULE_COLUMNS)
        .gte('admin_reactivated_at', reopenedSince)
        .lt('departure_datetime', `${fromStr}T00:00:00`);
      if (stationId) reopenedQuery = reopenedQuery.eq('departure_station_id', stationId);
      const { data: reopened } = await reopenedQuery.limit(RESERVATION_PAGE_SIZE);
      const known = new Set(remoteSchedules.map(s => s.id));
      for (const s of (reopened ?? []) as unknown as RemoteSchedule[]) if (!known.has(s.id)) remoteSchedules.push(s);
    } catch { /* server without the column: the usual days only */ }

    // Departures shown re-opened on this device: read again by id. When the admin closes one again,
    // the server clears its re-opening date, so the query above no longer returns it (nor the
    // usual days, for a departure of an earlier day): it stayed « Rouvert (admin) » at the guichet
    // for good. Read by id, it gets its closing back.
    try {
      const known = new Set(remoteSchedules.map(s => s.id));
      const shownReopened = ((await db.departs.toArray()) as DepartRecord[])
        .filter(d => d.reopened_at && !d.cloture && !d.cancelled && !known.has(d.id) && (!stationId || d.station_id === stationId))
        .map(d => d.id);
      for (let i = 0; i < shownReopened.length; i += SCHEDULE_ID_CHUNK) {
        const { data, error } = await supabase
          .from('schedules')
          .select(SCHEDULE_COLUMNS)
          .in('id', shownReopened.slice(i, i + SCHEDULE_ID_CHUNK));
        if (error) break;
        remoteSchedules.push(...((data ?? []) as unknown as RemoteSchedule[]));
      }
    } catch { /* read again at the next sync */ }

    if (remoteSchedules && remoteSchedules.length > 0) {
      const scheduleIds = remoteSchedules.map(s => s.id);

      // The schedules only hold the bus and driver ids: without their registration and name,
      // the Matricule and Chauffeur columns stayed empty for departures planned on the server
      // (chef de gare, another counter) or pulled again on a new device.
      const { plates, drivers } = await fetchBusAndDriverNames(
        Array.from(new Set(remoteSchedules.map(s => s.bus_id).filter(Boolean))) as string[],
        Array.from(new Set(remoteSchedules.map(s => s.driver_id).filter(Boolean))) as string[],
      );

      // Departures with a change made here and not sent yet (a closing, for instance)
      const pendingDeparts = await getPendingIds('departs');

      for (const s of remoteSchedules) {
        const localRecord = mapRemoteScheduleToLocal(s as unknown as Record<string, unknown>);
        const plate = s.bus_id ? plates.get(s.bus_id) : undefined;
        const driverName = s.driver_id ? drivers.get(s.driver_id) : undefined;
        const existing = await (db.departs as any).get(s.id);
        if (existing) {
          // A past-day departure already closed on this device stays closed, even if the
          // server has not closed it yet (its nightly closing may not have run) — unless the
          // admin re-opened it: the guichet then sees it open and can correct it. A closing
          // made here and not sent yet is kept too.
          const reopenedByAdmin = Boolean(localRecord.reopened_at) && localRecord.cloture === false;
          const keepClosed = existing.cloture && (
            pendingDeparts.has(s.id) ||
            (String(localRecord.departure_date) < todayStr && !reopenedByAdmin)
          );
          await (db.departs as any).put({
            ...existing,
            ...localRecord,
            ...(keepClosed ? { cloture: true, status: existing.status, cloture_at: existing.cloture_at } : {}),
            mt_ticket: existing.mt_ticket,
            mt_bagage: existing.mt_bagage,
            tot_depense: existing.tot_depense,
            solde: existing.mt_ticket + existing.mt_bagage - existing.tot_depense,
            caisse: existing.mt_ticket + existing.mt_bagage - existing.tot_depense,
            seat_allocations: existing.seat_allocations,
            seats_from: localRecord.seats_from,
            seats_total: existing.seats_total,
            bus_plate: plate ?? existing.bus_plate,
            bus_name: plate ?? existing.bus_name,
            driver_name: driverName ?? existing.driver_name,
            convoyeur_id: existing.convoyeur_id,
            convoyeur_name: existing.convoyeur_name,
            apprenti_id: existing.apprenti_id,
            apprenti_name: existing.apprenti_name,
            other_station_id: existing.other_station_id,
            other_station_name: existing.other_station_name,
            ramassage_notified: existing.ramassage_notified,
            arrival_station_id: existing.arrival_station_id,
            is_ramassage: existing.is_ramassage ?? localRecord.is_ramassage,
            source: existing.source,
            breakdown_transfer: existing.breakdown_transfer ?? 0,
          });
        } else {
          await (db.departs as any).put({
            ...localRecord,
            bus_plate: plate ?? '',
            bus_name: plate ?? '',
            driver_name: driverName ?? '',
            created_at: trustedNowIso(),
            updated_at: trustedNowIso(),
            synced: true,
          });
        }
      }

      // Departures deleted on the server (a deletion request executed by the admin) stayed on the
      // device for good: the guichet kept showing them. They are removed here too, with their
      // tickets, baggage and expenses kept on the device — only within what was just read in full
      // (this station, from fromStr on), and never one with a change not sent yet.
      if (stationId) {
        const onServer = new Set(scheduleIds);
        const fromMs = Date.parse(`${fromStr}T00:00:00Z`);
        const gone = ((await db.departs.toArray()) as DepartRecord[]).filter(d =>
          d.station_id === stationId &&
          d.synced !== false &&
          !pendingDeparts.has(d.id) &&
          !onServer.has(d.id) &&
          Date.parse(d.departure_datetime) >= fromMs,
        );
        for (const d of gone) await removeDeletedDepart(d.id);
      }

      // Supabase returns at most 1 000 rows per request, and a busy station sells more than that
      // in a day: read the tickets page by page until the last one. If any page fails, nothing
      // below is updated, so a departure's cash total is never computed from a partial list.
      // Only columns that exist on `reservations`: the former list also asked for
      // loyalty_card_number (a column of `users`), so the request always failed and no ticket
      // sold on another counter ever reached this device — MT Ticket, Solde and Caisse stayed at 0.
      const remoteReservations = await fetchRowsForSchedules(
        'reservations',
        'id, schedule_id, seat_numbers, total_price, total_seats, passenger_name, passenger_phone, status, booking_reference, destination_city_name, created_at',
        scheduleIds,
      );

      if (remoteReservations) {
        const pendingTickets = await getPendingIds('tickets');

        // Tickets deleted on the server (deletion request executed by the admin): removed here too.
        // All the tickets of these departures were just read: one missing is no longer on the server.
        const remoteTicketIds = new Set(remoteReservations.map(r => String(r.id)));
        const pulledDeparts = new Set(scheduleIds);
        const goneTickets = ((await db.tickets.toArray()) as TicketRecord[]).filter(t =>
          pulledDeparts.has(t.depart_id) &&
          t.synced !== false &&
          !pendingTickets.has(t.id) &&
          !remoteTicketIds.has(t.id),
        );
        if (goneTickets.length > 0) await db.tickets.bulkDelete(goneTickets.map(t => t.id));

        for (const r of remoteReservations) {
          const id = String(r.id);
          // A local change not yet sent is more recent than the server copy
          if (pendingTickets.has(id)) continue;
          const ticketRecord = mapRemoteReservationToLocalTicket(r);
          const existingTicket = await (db.tickets as any).get(id);
          if (existingTicket) {
            if (existingTicket.synced === false) continue;
            // Only what the server knows: the fields kept on the device only (reduction, payment
            // method, original price, printing…) must not be reset to defaults.
            await (db.tickets as any).put({
              ...existingTicket,
              depart_id: ticketRecord.depart_id,
              seat_number: ticketRecord.seat_number,
              seat_numbers: ticketRecord.seat_numbers,
              passenger_name: ticketRecord.passenger_name,
              passenger_phone: ticketRecord.passenger_phone,
              price: ticketRecord.price,
              status: ticketRecord.status,
              destination: ticketRecord.destination || existingTicket.destination,
              updated_at: trustedNowIso(),
            });
          } else {
            await (db.tickets as any).put({ ...ticketRecord, created_at: r.created_at ?? trustedNowIso(), updated_at: trustedNowIso(), synced: true });
          }
        }

        const breakdownMap = new Map<string, number>();
        for (let i = 0; i < scheduleIds.length; i += SCHEDULE_ID_CHUNK) {
          const { data: breakdownData } = await supabase
            .from('schedule_receipt_summary')
            .select('schedule_id, breakdown_transfer')
            .in('schedule_id', scheduleIds.slice(i, i + SCHEDULE_ID_CHUNK))
            .gt('breakdown_transfer', 0);
          for (const b of breakdownData ?? []) {
            breakdownMap.set(b.schedule_id, Number(b.breakdown_transfer ?? 0));
          }
        }

        for (const sid of scheduleIds) {
          const activeTickets = remoteReservations
            .filter(r => r.schedule_id === sid && r.status !== 'annulee');
          // Seats, not reservations: a grouped reservation holds several seats
          const newSeatsSold = activeTickets.reduce((sum, t) => sum + Math.max(1, Number(t.total_seats ?? 1)), 0);
          const grossMtTicket = activeTickets.reduce((sum, t) => sum + Number(t.total_price ?? 0), 0);
          const breakdownTransfer = breakdownMap.get(sid) ?? 0;
          const newMtTicket = grossMtTicket - breakdownTransfer;
          const existing = await (db.departs as any).get(sid);
          if (existing) {
            await (db.departs as any).put({
              ...existing,
              seats_sold: newSeatsSold,
              mt_ticket: newMtTicket,
              breakdown_transfer: breakdownTransfer,
              solde: newMtTicket + existing.mt_bagage - existing.tot_depense,
              caisse: newMtTicket + existing.mt_bagage - existing.tot_depense,
              updated_at: trustedNowIso(),
            });
          }
        }
      }

      const baggageOk = await syncBaggageFromServer(scheduleIds);
      const chargesOk = await syncChargesFromServer(scheduleIds);

      if (withHistory && remoteReservations && baggageOk && chargesOk) {
        markHistorySyncDone(stationId, todayStr);
      }
    } else if (withHistory) {
      markHistorySyncDone(stationId, todayStr);
    }
  } catch (err) {
    console.warn('[sync] Failed to sync from server:', err);
  }
}

/**
 * Baggage recorded on another device (another counter, the TPE) was never pulled: the MT Bagage
 * column only counted the baggage sold on this device. Returns false if the server could not be read.
 */
async function syncBaggageFromServer(scheduleIds: string[]): Promise<boolean> {
  const rows = await fetchRowsForSchedules('baggage_tickets', '*', scheduleIds);
  if (!rows) return false;
  const pending = await getPendingIds('bagages');
  for (const row of rows) {
    const id = String(row.id);
    if (pending.has(id)) continue;
    const remote = mapRemoteBaggageToLocal(row);
    const existing = await db.bagages.get(id);
    if (existing) {
      if (existing.synced === false) continue;
      // Payment and amount may change on the server (paid at the TPE); the rest stays as on the device
      await db.bagages.put({
        ...existing,
        price: remote.price,
        payment_status: remote.payment_status,
        paid_at: remote.paid_at ?? existing.paid_at,
        paid_by: remote.paid_by ?? existing.paid_by,
        sold_by: existing.sold_by ?? remote.sold_by,
        description: remote.description,
        updated_at: trustedNowIso(),
      } as BagageRecord);
    } else {
      await db.bagages.put({
        ...remote,
        created_at: row.created_at ?? trustedNowIso(),
        updated_at: trustedNowIso(),
        synced: true,
      } as unknown as BagageRecord);
    }
  }
  return true;
}

/**
 * Expenses of the departures from the server. One expense per departure and type (audit M3): the
 * server's amount is the one that counts (modified on another device of the counter, or
 * corrected at the office), unless the device has a change of it not sent yet. Former entries
 * of a type added up on the device are replaced by the server's expense. The departures'
 * Tot Dépense, Solde and Caisse are then computed again. Returns false if the server could not
 * be read.
 */
async function syncChargesFromServer(scheduleIds: string[]): Promise<boolean> {
  const rows = await fetchRowsForSchedules('counter_charges', '*', scheduleIds);
  if (!rows) return false;
  const pending = await getPendingIds('depenses');
  const local = (await db.depenses.toArray()).filter(d => d.description !== '__deleted__');
  const localIds = new Set(local.map(d => d.id));
  const touched = new Set<string>();

  // Server expenses by departure and type
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    if (row.status === 'rejete') continue;
    const key = `${row.schedule_id}|${row.charge_type}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  for (const group of groups.values()) {
    if (group.length > 1) {
      // Several « autres » recorded before the rule: added as they are, until one is modified
      for (const row of group) {
        if (localIds.has(String(row.id)) || pending.has(String(row.id))) continue;
        await db.depenses.put({ ...mapRemoteChargeToLocal(row), created_at: row.created_at ?? trustedNowIso(), updated_at: trustedNowIso(), synced: true } as unknown as DepenseRecord);
        touched.add(String(row.schedule_id));
      }
      continue;
    }
    const row = group[0];
    const id = String(row.id);
    const chargeType = String(row.charge_type);
    const same = local.filter(d => d.depart_id === row.schedule_id && normalizeExpenseType(d.type ?? d.label) === chargeType);
    // A change made on the device and not sent yet wins until it is sent
    if (pending.has(id) || same.some(d => pending.has(d.id))) continue;
    const remote = mapRemoteChargeToLocal(row) as unknown as DepenseRecord;

    if (same.length === 1 && same[0].id === id) {
      const mine = same[0];
      if (mine.amount === remote.amount && mine.description === remote.description && mine.expense_date === remote.expense_date) continue;
      await db.depenses.put({ ...mine, amount: remote.amount, description: remote.description, expense_date: remote.expense_date || mine.expense_date, updated_at: trustedNowIso(), synced: true });
    } else {
      await db.transaction('rw', db.depenses, async () => {
        await db.depenses.bulkDelete(same.map(d => d.id));
        await db.depenses.put({ ...remote, created_at: (row.created_at as string) ?? trustedNowIso(), updated_at: trustedNowIso(), synced: true } as DepenseRecord);
      });
    }
    touched.add(String(row.schedule_id));
  }

  // Tot Dépense, Solde and Caisse of the departures whose expenses changed (device only)
  for (const departId of touched) {
    const depart = await db.departs.get(departId);
    if (!depart) continue;
    const total = (await db.depenses.where('depart_id').equals(departId).toArray())
      .filter(d => d.description !== '__deleted__')
      .reduce((sum, d) => sum + Number(d.amount || 0), 0);
    if (total === depart.tot_depense) continue;
    await db.departs.put({ ...depart, tot_depense: total, solde: depart.mt_ticket - total, caisse: depart.mt_ticket - total });
  }
  return true;
}

// Ensure auth store is initialized (side-effect import to avoid tree-shaking)
void useAuthStore;
