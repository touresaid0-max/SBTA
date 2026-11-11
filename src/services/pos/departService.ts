import { type DepartRecord, type SeatAllocation, type SeatTransfer, type TicketRecord } from './db';
import { localInsert, localUpdate, getAll, getById, getByDeparts } from './offlineStore';
import { enqueueInsert, isOnline } from './syncEngine';
import { getReferentiel } from './referentiels';
import { supabase } from '@/services/supabase';
import { trustedNow, trustedNowIso } from '@/services/offline/deviceClock';
import { uuidV4 } from '@/utils/uuid';

export type { DepartRecord, SeatAllocation, SeatTransfer };

export interface LigneRef { id: string; name: string; origin_station_id: string; destination_station_id: string; destination_city_id?: string; base_price: number; is_active: boolean }
export interface VehiculeRef { id: string; plate_number: string; capacity: number; company_id: string; status: string; brand?: string; model?: string; seats_sold_from?: number }
export interface ChauffeurRef { id: string; full_name: string; email: string; role: string; employee_id?: string; phone?: string }
export interface GareRef { id: string; name: string; city: string; city_id: string; agency_code: string; is_active: boolean }

export async function getLignes(): Promise<LigneRef[]> {
  return getReferentiel<LigneRef>('lignes');
}

export async function getAssignedRouteIds(counterId: string): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('counter_routes')
      .select('route_id')
      .eq('counter_id', counterId);
    if (error) throw error;
    return (data ?? []).map(r => r.route_id as string);
  } catch {
    return [];
  }
}
export async function getVehicules(): Promise<VehiculeRef[]> {
  return getReferentiel<VehiculeRef>('vehicules');
}
export async function getChauffeurs(): Promise<ChauffeurRef[]> {
  return getReferentiel<ChauffeurRef>('chauffeurs');
}
export async function getGares(): Promise<GareRef[]> {
  return getReferentiel<GareRef>('gares');
}

// ── Departure and line numbers (audit m6) ──
// Each counter numbers its own departures of the day (n° de départ) and, per line, its line
// departures (n° de ligne). They were computed from the departures kept on THIS device only: a
// second device on the same counter, or a new device, gave a number already used. The database
// refuses a departure number used twice by a counter on the same day (departure_sequence): the
// whole departure, and the tickets sold on it, were then refused.
// Online, the numbers already used on the server are now taken into account. Offline, the device
// keeps its own count, and the database gives the next free number if it was taken meanwhile
// (migration 20261104150000_departure_numbers_server_safe.sql); the device gets it at the next sync.

function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Highest numbers already used on the server for this counter (or station) and day; null offline. */
async function serverMaxNumbers(
  stationId: string,
  counterId: string | undefined,
  departureDate: string | undefined,
  routeId?: string,
): Promise<{ departure: number; route: number } | null> {
  if (!isOnline() || !departureDate) return null;
  try {
    let query = supabase
      .from('schedules')
      .select('departure_number, route_number, route_id')
      .eq('departure_station_id', stationId)
      .gte('departure_datetime', `${departureDate}T00:00:00`)
      .lt('departure_datetime', `${nextDay(departureDate)}T00:00:00`);
    if (counterId) query = query.eq('counter_id', counterId);
    const { data, error } = await query;
    if (error || !data) return null;
    const rows = data as Array<{ departure_number: number | null; route_number: number | null; route_id: string | null }>;
    return {
      departure: Math.max(0, ...rows.map(r => r.departure_number ?? 0)),
      route: Math.max(0, ...rows.filter(r => !routeId || r.route_id === routeId).map(r => r.route_number ?? 0)),
    };
  } catch {
    return null; // the device's own count is used
  }
}

export async function nextDepartureNumber(stationId: string, counterId?: string, departureDate?: string): Promise<number> {
  const all = await getAll<DepartRecord>('departs');
  let stationDeparts = all.filter(d => d.station_id === stationId && d.departure_date === departureDate);
  if (counterId) {
    stationDeparts = stationDeparts.filter(d => d.counter_id === counterId);
  }
  const localMax = Math.max(0, ...stationDeparts.map(d => d.departure_number ?? 0));
  const server = await serverMaxNumbers(stationId, counterId, departureDate);
  return Math.max(localMax, server?.departure ?? 0) + 1;
}

export async function nextRouteNumber(stationId: string, routeId: string, counterId?: string, departureDate?: string): Promise<number> {
  const all = await getAll<DepartRecord>('departs');
  let routeDeparts = all.filter(d => d.station_id === stationId && d.route_id === routeId && d.departure_date === departureDate);
  if (counterId) {
    routeDeparts = routeDeparts.filter(d => d.counter_id === counterId);
  }
  const localMax = Math.max(0, ...routeDeparts.map(d => d.route_number ?? 0));
  const server = await serverMaxNumbers(stationId, counterId, departureDate, routeId);
  return Math.max(localMax, server?.route ?? 0) + 1;
}

export async function createDepart(
  data: Omit<DepartRecord, 'id' | 'created_at' | 'updated_at' | 'synced' | 'departure_number' | 'route_number' | 'seats_sold' | 'cloture' | 'mt_ticket' | 'mt_bagage' | 'tot_depense' | 'solde' | 'caisse' | 'confirmed' | 'cancelled'>,
): Promise<DepartRecord> {
  const departureNumber = await nextDepartureNumber(data.station_id, data.counter_id, data.departure_date);
  const routeNumber = await nextRouteNumber(data.station_id, data.route_id, data.counter_id, data.departure_date);

  return localInsert<DepartRecord>('departs', {
    ...data,
    departure_number: departureNumber,
    route_number: routeNumber,
    seats_sold: 0,
    cloture: false,
    mt_ticket: 0,
    mt_bagage: 0,
    tot_depense: 0,
    solde: 0,
    caisse: 0,
    confirmed: false,
    cancelled: false,
  });
}

export async function updateDepart(
  id: string,
  patch: Partial<DepartRecord>,
): Promise<DepartRecord | null> {
  return localUpdate<DepartRecord>('departs', id, patch);
}

export async function renumberDepartsAfterCancellation(
  cancelledDepart: DepartRecord,
): Promise<void> {
  const all = await getAll<DepartRecord>('departs');
  const siblings = all
    .filter(d =>
      d.id !== cancelledDepart.id &&
      d.route_id === cancelledDepart.route_id &&
      d.station_id === cancelledDepart.station_id &&
      d.departure_date === cancelledDepart.departure_date &&
      !d.cancelled,
    )
    .sort((a, b) => (a.route_number ?? 0) - (b.route_number ?? 0));

  let nextNumber = 1;
  for (const d of siblings) {
    if ((d.route_number ?? 0) !== nextNumber) {
      await localUpdate<DepartRecord>('departs', d.id, { route_number: nextNumber });
      try {
        await supabase
          .from('departure_sequence')
          .update({ departure_order: nextNumber, departure_number: nextNumber })
          .eq('schedule_id', d.id);
      } catch { /* offline: local-only renumber */ }
    }
    nextNumber++;
  }
}

export async function getAllDeparts(stationId?: string, counterId?: string): Promise<DepartRecord[]> {
  const all = await getAll<DepartRecord>('departs');
  let result = all;
  if (stationId) {
    result = result.filter(d =>
      d.station_id === stationId ||
      (d.seat_allocations?.some(a => a.station_id === stationId) ?? false) ||
      d.other_station_id === stationId,
    );
  }
  if (counterId) {
    // A counter sees its own departures, and those of another station shared with its station
    // (« Charger dans une autre gare »): they belong to a counter of the main station
    result = result.filter(d =>
      d.counter_id === counterId ||
      (!!stationId && d.station_id !== stationId && (d.seat_allocations?.some(a => a.station_id === stationId) ?? false)));
  }
  return result;
}

export async function getDepartById(id: string): Promise<DepartRecord | undefined> {
  // By its key: called several times per sale, it read every departure kept on the device
  return id ? getById<DepartRecord>('departs', id) : undefined;
}

export function seatsAllocatedForStation(d: DepartRecord, stationId: string): number {
  const range = getSeatRangeForStation(d, stationId);
  const base = range ? range.to - range.from + 1 : 0;
  return Math.max(0, base) + getReceivedTransferSeatsForStation(d, stationId).length;
}

export function seatsVendusForStation(tickets: import('./db').TicketRecord[], d: DepartRecord, stationId: string): number {
  const range = getSeatRangeForStation(d, stationId);
  const received = getReceivedTransferSeatsForStation(d, stationId);
  const inSeatPool = (seatNumber: number) =>
    (range && seatNumber >= range.from && seatNumber <= range.to) || received.includes(seatNumber);
  if (!range && received.length === 0) return d.seats_sold;
  return tickets.filter(t => t.depart_id === d.id && t.status !== 'cancelled' && inSeatPool(t.seat_number)).length;
}

/**
 * Last seat number of a bus of `capacity` seats numbered from `seatsFrom` (bus setting « vendu à
 * partir de »). The number of seats stays the capacity: only the numbering moves (63 seats from
 * n°2 → 2 to 64). It used to be the capacity itself: a bus sold from n°2 lost a seat (2 to 63).
 */
export function lastSeatNumber(seatsFrom: number | undefined, capacity: number): number {
  return Math.max(1, seatsFrom || 1) + Math.max(0, capacity) - 1;
}

/** Number of seats of a departure (its seat numbers from seats_from to seats_total) */
export function seatsCommercialisables(d: DepartRecord): number {
  const sellableFrom = Math.max(1, d.seats_from || 1);
  return Math.max(0, d.seats_total - sellableFrom + 1);
}

export function seatsLibres(d: DepartRecord): number {
  return Math.max(0, seatsCommercialisables(d) - d.seats_sold);
}

export function seatsLibresForStation(tickets: import('./db').TicketRecord[], d: DepartRecord, stationId: string): number {
  const allocated = seatsAllocatedForStation(d, stationId);
  const sold = seatsVendusForStation(tickets, d, stationId);
  return Math.max(0, allocated - sold);
}

export function computeSolde(d: DepartRecord): number {
  return d.mt_ticket + d.mt_bagage - d.tot_depense;
}

export interface StationScopedTotals {
  mt_ticket: number;
  mt_bagage: number;
  tot_depense: number;
  solde: number;
  caisse: number;
  tickets_count: number;
  bagages_count: number;
  scoped: boolean;
}

export function computeStationScopedTotals(
  depart: DepartRecord,
  tickets: import('./db').TicketRecord[],
  bagages: import('./db').BagageRecord[],
  depenses: import('./db').DepenseRecord[],
  stationId: string | undefined,
): StationScopedTotals {
  const hasAllocations = !!(depart.seat_allocations && depart.seat_allocations.length > 0);

  if (!stationId || !hasAllocations) {
    const totDepense = depenses
      .filter(d => d.depart_id === depart.id && d.description !== '__deleted__')
      .reduce((s, d) => s + d.amount, 0);
    const ticketsForDepart = tickets.filter(t => t.depart_id === depart.id && t.status !== 'cancelled');
    const bagagesForDepart = bagages.filter(b => b.depart_id === depart.id && b.description !== '__deleted__' && b.payment_status !== 'en_attente');
    const grossTicket = ticketsForDepart.reduce((s, t) => s + t.price, 0);
    const breakdownTransfer = depart.breakdown_transfer ?? 0;
    const mtTicket = grossTicket - breakdownTransfer;
    const mtBagage = bagagesForDepart.reduce((s, b) => s + b.price, 0);
    return {
      mt_ticket: mtTicket,
      mt_bagage: mtBagage,
      tot_depense: totDepense,
      solde: mtTicket - totDepense,
      caisse: mtTicket - totDepense,
      tickets_count: ticketsForDepart.length,
      bagages_count: bagagesForDepart.length,
      scoped: false,
    };
  }

  const range = getSeatRangeForStation(depart, stationId);
  const stationTickets = range
    ? tickets.filter(t =>
        t.depart_id === depart.id &&
        t.status !== 'cancelled' &&
        t.seat_number >= range.from &&
        t.seat_number <= range.to,
      )
    : [];
  const stationTicketIds = new Set(stationTickets.map(t => t.id));

  const primaryStationId = depart.station_id;
  const stationBagages = bagages.filter(b => {
    if (b.depart_id !== depart.id) return false;
    if (b.description === '__deleted__') return false;
    if (b.payment_status === 'en_attente') return false;
    if (b.ticket_id && stationTicketIds.has(b.ticket_id)) return true;
    if (b.ticket_id) return false;
    return stationId === primaryStationId;
  });

  const stationDepenses = depenses.filter(d =>
    d.depart_id === depart.id &&
    d.description !== '__deleted__' &&
    d.station_id === stationId,
  );

  const grossTicket = stationTickets.reduce((s, t) => s + t.price, 0);
  const breakdownTransfer = depart.breakdown_transfer ?? 0;
  const mtTicket = grossTicket - breakdownTransfer;
  const mtBagage = stationBagages.reduce((s, b) => s + b.price, 0);
  const totDepense = stationDepenses.reduce((s, d) => s + d.amount, 0);

  return {
    mt_ticket: mtTicket,
    mt_bagage: mtBagage,
    tot_depense: totDepense,
    solde: mtTicket - totDepense,
    caisse: mtTicket - totDepense,
    tickets_count: stationTickets.length,
    bagages_count: stationBagages.length,
    scoped: true,
  };
}

export async function cloturerDepart(
  departId: string,
  userName?: string,
): Promise<DepartRecord | null> {
  const existing = (await getAll<DepartRecord>('departs')).find(d => d.id === departId) ?? null;
  const updated = await localUpdate<DepartRecord>('departs', departId, {
    cloture: true,
    cloture_at: trustedNowIso(),
    cloture_by: userName,
  });

  if (existing?.is_ramassage && !existing.ramassage_notified) {
    // The destination station must learn that this bus will pass by for a ramassage. The
    // notification was written straight to the server: closing the departure without network lost
    // it for good. It now goes through the sending queue, after the departure itself, and the
    // destination is found in the lists kept on the device.
    const [lignes, gares] = await Promise.all([getLignes(), getGares()]);
    let arrivalStationId = existing.arrival_station_id;
    if (!arrivalStationId && existing.route_id) {
      const route = lignes.find(l => l.id === existing.route_id);
      arrivalStationId = route?.destination_station_id
        || gares
          .filter(g => g.is_active !== false && g.city_id === route?.destination_city_id)
          .sort((a, b) => a.name.localeCompare(b.name))[0]?.id;
    }

    if (!arrivalStationId) {
      // No destination station found; cannot send notification
      return updated;
    }

    const notificationId = uuidV4();
    await enqueueInsert('ramassages', {
      id: notificationId,
      rows: [{
        id: notificationId,
        local_depart_id: existing.id,
        schedule_id: existing.id,
        route_id: existing.route_id || null,
        route_name: existing.route_name ?? null,
        departure_number: existing.departure_number ?? null,
        bus_id: existing.bus_id || null,
        bus_registration: existing.bus_plate || existing.bus_name || null,
        driver_name: existing.driver_name ?? null,
        departure_datetime: existing.departure_datetime ?? null,
        seats_total: existing.seats_total ?? null,
        seats_sold: existing.seats_sold ?? null,
        company_id: existing.company_id ?? null,
        origin_station_id: existing.station_id || null,
        origin_station_name: gares.find(g => g.id === existing.station_id)?.name ?? existing.station_name ?? null,
        destination_station_id: arrivalStationId,
        destination_station_name: gares.find(g => g.id === arrivalStationId)?.name ?? null,
        status: 'pending',
        created_at: trustedNowIso(),
      }],
    });

    // is_ramassage lets the destination station identify the departure; both are sent by the queue
    await localUpdate<DepartRecord>('departs', departId, {
      is_ramassage: true,
      ramassage_notified: true,
      arrival_station_id: arrivalStationId,
    });
  }

  return updated;
}

// Departures of other stations loaded in this one. They belong to a counter of the other station:
// keeping only this counter's departures (as before) left the list empty on every other device.
export async function getDepartsForOtherStations(currentStationId: string, _counterId?: string): Promise<DepartRecord[]> {
  const all = await getAll<DepartRecord>('departs');
  return all.filter(d => {
    if (d.cancelled) return false;
    if (d.station_id === currentStationId) return false;
    if (d.seat_allocations && d.seat_allocations.some(a => a.station_id === currentStationId)) return true;
    if (d.other_station_id === currentStationId) return true;
    return false;
  });
}

export function getSeatRangeForStation(
  depart: DepartRecord,
  stationId: string,
): { from: number; to: number } | null {
  const sellableFrom = Math.max(1, depart.seats_from || 1);
  if (!depart.seat_allocations || depart.seat_allocations.length === 0) {
    if (depart.station_id === stationId) {
      return sellableFrom <= depart.seats_total ? { from: sellableFrom, to: depart.seats_total } : null;
    }
    return null;
  }
  const alloc = depart.seat_allocations.find(a => a.station_id === stationId);
  if (!alloc) return null;
  const from = Math.max(sellableFrom, alloc.seat_from);
  return from <= alloc.seat_to ? { from, to: alloc.seat_to } : null;
}

export function isSeatAllowedForStation(
  depart: DepartRecord,
  stationId: string,
  seatNumber: number,
): boolean {
  const range = getSeatRangeForStation(depart, stationId);
  if (range && seatNumber >= range.from && seatNumber <= range.to) return true;
  return getReceivedTransferSeatsForStation(depart, stationId).includes(seatNumber);
}

export function getStationNameForSeat(
  depart: DepartRecord,
  seatNumber: number,
): string | null {
  if (!depart.seat_allocations || depart.seat_allocations.length === 0) return null;
  const alloc = depart.seat_allocations.find(a => seatNumber >= a.seat_from && seatNumber <= a.seat_to);
  return alloc?.station_name ?? null;
}

export function validateSeatAllocations(
  allocations: SeatAllocation[],
  lastSeat: number,
  firstSeat = 1,
): string | null {
  if (allocations.length === 0) return null;
  for (const a of allocations) {
    if (a.seat_from < firstSeat || a.seat_to > lastSeat) {
      return `Les sièges doivent être entre ${firstSeat} et ${lastSeat}`;
    }
    if (a.seat_from > a.seat_to) {
      return `La plage ${a.seat_from}-${a.seat_to} pour ${a.station_name} est invalide`;
    }
  }
  const sorted = [...allocations].sort((a, b) => a.seat_from - b.seat_from);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].seat_from <= sorted[i - 1].seat_to) {
      return `Chevauchement détecté entre ${sorted[i - 1].station_name} (${sorted[i - 1].seat_from}-${sorted[i - 1].seat_to}) et ${sorted[i].station_name} (${sorted[i].seat_from}-${sorted[i].seat_to})`;
    }
  }
  return null;
}

export async function findNextDepartForRoute(
  routeId: string,
  currentDepartId: string,
  stationId?: string,
  counterId?: string,
): Promise<DepartRecord | null> {
  const all = await getAllDeparts(stationId, counterId);
  const now = trustedNow();
  const candidates = all.filter(d =>
    d.id !== currentDepartId &&
    d.route_id === routeId &&
    !d.cancelled &&
    !d.cloture &&
    new Date(d.departure_datetime) > now
  );
  candidates.sort((a, b) =>
    new Date(a.departure_datetime).getTime() - new Date(b.departure_datetime).getTime()
  );
  return candidates[0] ?? null;
}

export async function transferTicketsToDepart(
  surplusTickets: TicketRecord[],
  targetDepart: DepartRecord,
): Promise<void> {
  const targetSold = await getSoldSeatNumbers(targetDepart.id);
  const occupied = new Set(targetSold);
  let nextSeat = targetDepart.seats_from;
  for (const ticket of surplusTickets) {
    while (occupied.has(nextSeat)) nextSeat++;
    if (nextSeat > targetDepart.seats_total) {
      throw new Error(
        `Le départ cible #${targetDepart.route_number} n'a plus de sièges libres pour recevoir tous les tickets.`
      );
    }
    occupied.add(nextSeat);
    await localUpdate<TicketRecord>('tickets', ticket.id, {
      depart_id: targetDepart.id,
      seat_number: nextSeat,
      seat_numbers: [String(nextSeat)],
    });
  }
  const targetActive = (await getByDeparts<TicketRecord>('tickets', [targetDepart.id])).filter(
    t => t.status !== 'cancelled'
  );
  const newSoldCount = targetActive.length;
  const newMtTicket = targetActive.reduce((sum, t) => sum + t.price, 0);
  await localUpdate<DepartRecord>('departs', targetDepart.id, {
    seats_sold: newSoldCount,
    mt_ticket: newMtTicket,
    solde: newMtTicket + targetDepart.mt_bagage - targetDepart.tot_depense,
    caisse: newMtTicket + targetDepart.mt_bagage - targetDepart.tot_depense,
  });
}

export async function getSoldSeatNumbers(departId: string): Promise<number[]> {
  return (await getByDeparts<TicketRecord>('tickets', [departId]))
    .filter(t => t.status !== 'cancelled')
    .map(t => t.seat_number);
}

// ── Seat transfer between stations (same depart) ──

export function getTransferredSeatsForStation(
  depart: DepartRecord,
  stationId: string,
): number[] {
  const seats: number[] = [];
  for (const tr of depart.seat_transfers ?? []) {
    if (tr.from_station_id === stationId) {
      if (tr.seats && tr.seats.length > 0) {
        seats.push(...tr.seats);
      } else {
        for (let s = tr.seat_from; s <= tr.seat_to; s++) seats.push(s);
      }
    }
  }
  return seats;
}

export function getReceivedTransfersForStation(
  depart: DepartRecord,
  stationId: string,
): SeatTransfer[] {
  return (depart.seat_transfers ?? []).filter(tr => tr.to_station_id === stationId);
}

export function getReceivedTransferSeatsForStation(
  depart: DepartRecord,
  stationId: string,
): number[] {
  const seats: number[] = [];
  for (const tr of depart.seat_transfers ?? []) {
    if (tr.to_station_id === stationId) {
      if (tr.seats && tr.seats.length > 0) {
        seats.push(...tr.seats);
      } else {
        for (let s = tr.seat_from; s <= tr.seat_to; s++) seats.push(s);
      }
    }
  }
  return seats;
}

export function isSeatTransferredLocked(
  depart: DepartRecord,
  stationId: string,
  seatNumber: number,
): boolean {
  return getTransferredSeatsForStation(depart, stationId).includes(seatNumber);
}

export function getAvailableSeatsForTransfer(
  depart: DepartRecord,
  tickets: TicketRecord[],
  fromStationId: string,
): number[] {
  const range = getSeatRangeForStation(depart, fromStationId);
  if (!range) return [];
  const sold = new Set(
    tickets
      .filter(t => t.depart_id === depart.id && t.status !== 'cancelled')
      .map(t => t.seat_number),
  );
  const locked = new Set(getTransferredSeatsForStation(depart, fromStationId));
  const available: number[] = [];
  for (let s = range.from; s <= range.to; s++) {
    if (!sold.has(s) && !locked.has(s)) available.push(s);
  }
  return available;
}

export async function transferSeatsBetweenStations(params: {
  departId: string;
  fromStationId: string;
  toStationId: string;
  seatCount: number;
  transferredBy?: string;
}): Promise<DepartRecord> {
  const depart = await getDepartById(params.departId);
  if (!depart) throw new Error('Départ introuvable');
  if (!depart.seat_allocations || depart.seat_allocations.length === 0) {
    throw new Error('Aucune répartition de sièges pour ce départ');
  }

  const departTickets = await getByDeparts<TicketRecord>('tickets', [depart.id]);
  const available = getAvailableSeatsForTransfer(depart, departTickets, params.fromStationId);

  if (available.length === 0) {
    throw new Error('Aucun siège libre disponible au transfert dans cette gare');
  }

  const count = Math.min(params.seatCount, available.length);
  const seatsToTransfer = available.slice(0, count);
  const seatFrom = seatsToTransfer[0];
  const seatTo = seatsToTransfer[count - 1];

  const fromAlloc = depart.seat_allocations.find(a => a.station_id === params.fromStationId);
  const toAlloc = depart.seat_allocations.find(a => a.station_id === params.toStationId);
  if (!fromAlloc) throw new Error('Gare source introuvable dans la répartition');
  if (!toAlloc) throw new Error('Gare destinataire introuvable dans la répartition');

  const transfers: SeatTransfer[] = [
    ...(depart.seat_transfers ?? []),
    {
      from_station_id: params.fromStationId,
      to_station_id: params.toStationId,
      seat_from: seatFrom,
      seat_to: seatTo,
      seats: seatsToTransfer,
      transferred_at: trustedNowIso(),
      transferred_by: params.transferredBy,
    },
  ];

  const updated = await localUpdate<DepartRecord>('departs', params.departId, {
    seat_transfers: transfers,
  });

  try {
    await supabase
      .from('schedules')
      .update({
        seat_transfers: transfers,
        updated_at: trustedNowIso(),
      })
      .eq('id', params.departId);
  } catch {
    /* offline: local-only */
  }

  return updated ?? { ...depart, seat_transfers: transfers };
}
