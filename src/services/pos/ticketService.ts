import { type TicketRecord, type DepartRecord } from './db';
import { localInsert, getAll, getById, localUpdate } from './offlineStore';
import { getDepartById, updateDepart } from './departService';
import { getReferentiel } from './referentiels';
import { supabase } from '@/services/supabase';
import { isOnline } from './syncEngine';

export type { TicketRecord };

export interface TarifRef {
  id: string;
  route_id: string;
  station_id: string;
  price: number;
  stop_order: number;
}

export interface StationRef {
  id: string;
  name: string;
  city: string;
  agency_code: string;
  is_active: boolean;
}

export async function getTarifs(): Promise<TarifRef[]> {
  return getReferentiel<TarifRef>('tarifs');
}

export async function getStations(): Promise<StationRef[]> {
  return getReferentiel<StationRef>('gares');
}

export interface RouteCityStopRef {
  id: string;
  route_id: string;
  city_id: string;
  city_name: string;
  price: number;
  position: number;
}

export async function getRouteCityStops(): Promise<RouteCityStopRef[]> {
  return getReferentiel<RouteCityStopRef>('route_city_stops');
}

export async function getTicketsForDepart(departId: string): Promise<TicketRecord[]> {
  const all = await getAll<TicketRecord>('tickets');
  return all.filter(t => t.depart_id === departId && t.status !== 'cancelled');
}

export interface TicketSearchResult {
  ticket: TicketRecord;
  depart?: DepartRecord;
  departureNumber?: number;
  busPlate?: string;
  routeId?: string;
  routeName?: string;
}

function matchesTicketSuffix(ticketNumber: string, suffix: string): boolean {
  return ticketNumber.trim().toLowerCase().endsWith(suffix);
}

export async function searchTicketsBySuffix(
  suffix: string,
  stationId: string,
  departureId?: string,
): Promise<TicketSearchResult[]> {
  const normalizedSuffix = suffix.trim().toLowerCase();
  if (normalizedSuffix.length !== 4 || !stationId) return [];

  const [localTickets, localDeparts] = await Promise.all([
    getAll<TicketRecord>('tickets'),
    getAll<DepartRecord>('departs'),
  ]);
  const localDepartMap = new Map(localDeparts.map(depart => [depart.id, depart]));
  const localResults = localTickets
    .filter(ticket =>
      ticket.status !== 'cancelled' &&
      matchesTicketSuffix(ticket.ticket_number, normalizedSuffix) &&
      (!departureId || ticket.depart_id === departureId),
    )
    .map(ticket => ({ ticket, depart: localDepartMap.get(ticket.depart_id) }))
    .filter(result => result.depart?.station_id === stationId)
    .map(result => ({
      ...result,
      departureNumber: result.depart?.departure_number,
      busPlate: result.depart?.bus_plate,
      routeId: result.depart?.route_id,
      routeName: result.depart?.route_name,
    }));

  if (!isOnline()) return localResults;

  try {
    const likeSuffix = normalizedSuffix.replace(/[\\%_]/g, char => `\\${char}`);
    let reservationQuery = supabase
      .from('reservations')
      .select('id, schedule_id, seat_numbers, total_price, passenger_name, passenger_phone, status, booking_reference, destination_city_name, schedules!inner(id, departure_station_id, route_id, route_number, departure_number, bus_id)')
      .eq('schedules.departure_station_id', stationId)
      .ilike('booking_reference', `%${likeSuffix}`)
      .not('status', 'eq', 'annulee')
      .limit(20);
    if (departureId) {
      reservationQuery = reservationQuery.eq('schedule_id', departureId);
    }
    const { data: reservations, error: reservationError } = await reservationQuery;
    if (reservationError) throw reservationError;

    type ScheduleRow = { id: string; departure_station_id: string; route_id: string | null; route_number: number | null; departure_number: number | null; bus_id: string | null };
    const scheduleRows = (reservations ?? [])
      .map(reservation => reservation.schedules as unknown as ScheduleRow | null)
      .filter((schedule): schedule is ScheduleRow => Boolean(schedule));
    const busIds = [...new Set(scheduleRows.map(schedule => schedule.bus_id).filter((busId): busId is string => Boolean(busId)))];
    const { data: buses } = busIds.length > 0
      ? await supabase.from('buses').select('id, registration_number').in('id', busIds)
      : { data: [] as { id: string; registration_number: string }[] };

    const busPlateMap = new Map((buses ?? []).map(bus => [bus.id as string, bus.registration_number as string]));
    const remoteResults: TicketSearchResult[] = [];
    for (const reservation of reservations ?? []) {
      const ticketNumber = String(reservation.booking_reference ?? reservation.id ?? '');
      if (!matchesTicketSuffix(ticketNumber, normalizedSuffix)) continue;

      const schedule = reservation.schedules as unknown as ScheduleRow | null;
      if (!schedule) continue;
      const seatNumbers = Array.isArray(reservation.seat_numbers) ? reservation.seat_numbers as string[] : [];
      const seatNumber = Number.parseInt(seatNumbers[0] ?? '0', 10);
      const ticket: TicketRecord = {
        id: reservation.id as string,
        depart_id: reservation.schedule_id as string,
        ticket_number: ticketNumber,
        seat_number: Number.isFinite(seatNumber) ? seatNumber : 0,
        seat_numbers: seatNumbers,
        destination: String(reservation.destination_city_name ?? ''),
        destination_id: undefined,
        passenger_name: String(reservation.passenger_name ?? ''),
        passenger_phone: String(reservation.passenger_phone ?? ''),
        price: Number(reservation.total_price ?? 0),
        original_price: Number(reservation.total_price ?? 0),
        is_reduced: false,
        is_reported: false,
        is_ac: false,
        print_ticket: true,
        payment_method: 'cash',
        status: 'sold',
        created_at: '',
        updated_at: '',
      };
      remoteResults.push({
        ticket,
        depart: localDepartMap.get(schedule.id),
        departureNumber: Number(schedule.departure_number ?? schedule.route_number ?? 0) || undefined,
        busPlate: schedule.bus_id ? busPlateMap.get(schedule.bus_id) : undefined,
        routeId: schedule.route_id ?? undefined,
      });
    }

    const merged = new Map<string, TicketSearchResult>();
    for (const result of [...localResults, ...remoteResults]) {
      merged.set(result.ticket.id, result);
    }
    return Array.from(merged.values()).slice(0, 20);
  } catch {
    return localResults;
  }
}

export async function isSeatAvailable(departId: string, seatNumber: number): Promise<boolean> {
  const tickets = await getTicketsForDepart(departId);
  return !tickets.some(t => t.seat_number === seatNumber);
}

export async function getSoldSeats(departId: string): Promise<number[]> {
  const tickets = await getTicketsForDepart(departId);
  return tickets.map(t => t.seat_number).sort((a, b) => a - b);
}

export function generateTicketNumber(_stationAgencyCode?: string): string {
  const year = new Date().getFullYear();
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${year}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  }
  const rand = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `${year}-${Date.now().toString(36).toUpperCase()}-${rand}`;
}

export function calculatePrice(basePrice: number, isAc: boolean, isReduced: boolean): number {
  let price = basePrice;
  if (isAc) price = Math.round(price * 1.1);
  if (isReduced) price = Math.round(price * 0.9);
  return price;
}

export async function getTarifForDestination(
  routeId: string,
  destinationStationId: string,
): Promise<TarifRef | undefined> {
  const tarifs = await getTarifs();
  return tarifs.find(
    t => t.route_id === routeId && t.station_id === destinationStationId,
  );
}

export interface SellTicketParams {
  departId: string;
  seatNumber: number;
  destination: string;
  destinationId: string;
  price: number;
  originalPrice: number;
  isReduced: boolean;
  isReported: boolean;
  isAc: boolean;
  printTicket: boolean;
  passengerName?: string;
  passengerPhone?: string;
  loyaltyCardNumber?: string;
  loyaltyName?: string;
  stationAgencyCode?: string;
}

export async function sellTicket(params: SellTicketParams): Promise<TicketRecord> {
  const depart = await getDepartById(params.departId);
  if (!depart) throw new Error('Départ introuvable');

  if (params.seatNumber < depart.seats_from || params.seatNumber > depart.seats_total) {
    throw new Error(`Le siège doit être entre ${depart.seats_from} et ${depart.seats_total}`);
  }

  const available = await isSeatAvailable(params.departId, params.seatNumber);
  if (!available) {
    throw new Error(`Le siège ${params.seatNumber} est déjà vendu`);
  }

  const ticketNumber = generateTicketNumber();

  const ticket = await localInsert<TicketRecord>('tickets', {
    depart_id: params.departId,
    ticket_number: ticketNumber,
    seat_number: params.seatNumber,
    seat_numbers: [String(params.seatNumber)],
    destination: params.destination,
    destination_id: params.destinationId,
    passenger_name: params.passengerName ?? '',
    passenger_phone: params.passengerPhone ?? '',
    price: params.price,
    original_price: params.originalPrice,
    is_reduced: params.isReduced,
    is_reported: params.isReported,
    is_ac: params.isAc,
    print_ticket: params.printTicket,
    payment_method: 'cash',
    status: 'sold',
    loyalty_card_number: params.loyaltyCardNumber,
    loyalty_name: params.loyaltyName,
  });

  // NOTE: caller is responsible for updating depart counters when selling multiple tickets at once.
  // This avoids stale reads when looping over seats. Use sellTickets() for multi-seat.
  return ticket;
}

/** Error of a multi-seat sale stopped part-way: `soldTickets` were recorded before it. */
export class PartialSaleError extends Error {
  constructor(message: string, public soldTickets: TicketRecord[]) {
    super(message);
    this.name = 'PartialSaleError';
  }
}

export async function sellTickets(seats: number[], commonParams: Omit<SellTicketParams, 'seatNumber'>): Promise<TicketRecord[]> {
  // One ticket per seat, each seat once, in ascending seat order
  const orderedSeats = [...new Set(seats)].sort((a, b) => a - b);
  if (orderedSeats.length > 1) {
    // Check every seat before recording anything, so a taken seat does not leave half a sale
    const taken = new Set((await getTicketsForDepart(commonParams.departId)).map(t => t.seat_number));
    const conflict = orderedSeats.find(s => taken.has(s));
    if (conflict !== undefined) throw new Error(`Le siège ${conflict} est déjà vendu`);
  }
  const soldTickets: TicketRecord[] = [];
  let failure: unknown = null;
  for (const seat of orderedSeats) {
    try {
      soldTickets.push(await sellTicket({ ...commonParams, seatNumber: seat }));
    } catch (err) {
      failure = err;
      break;
    }
  }
  if (soldTickets.length === 0) throw failure;
  // Single depart update after all inserts (also after a partial sale, so the till stays right)
  const depart = await getDepartById(commonParams.departId);
  if (depart) {
    const soldCount = (await getTicketsForDepart(commonParams.departId)).filter(t => t.status !== 'cancelled').length;
    const totalAdded = soldTickets.reduce((s, t) => s + t.price, 0);
    const newMtTicket = depart.mt_ticket + totalAdded;
    await updateDepart(commonParams.departId, {
      seats_sold: soldCount,
      mt_ticket: newMtTicket,
      solde: newMtTicket + depart.mt_bagage - depart.tot_depense,
      caisse: newMtTicket + depart.mt_bagage - depart.tot_depense,
    });
  }
  if (failure) {
    const reason = failure instanceof Error ? failure.message : String(failure);
    throw new PartialSaleError(`${soldTickets.length} ticket(s) vendu(s), vente interrompue : ${reason}`, soldTickets);
  }
  return soldTickets;
}

export async function cancelTicket(ticketId: string): Promise<void> {
  const ticket = await getById<TicketRecord>('tickets', ticketId);
  if (!ticket) return;
  if (ticket.status === 'cancelled') return;

  await localUpdate<TicketRecord>('tickets', ticketId, { status: 'cancelled' });

  const depart = await getDepartById(ticket.depart_id);
  if (depart) {
    const remainingTickets = await getTicketsForDepart(ticket.depart_id);
    const newMtTicket = Math.max(0, depart.mt_ticket - ticket.price);
    await updateDepart(ticket.depart_id, {
      seats_sold: remainingTickets.length,
      mt_ticket: newMtTicket,
      solde: newMtTicket + depart.mt_bagage - depart.tot_depense,
      caisse: newMtTicket + depart.mt_bagage - depart.tot_depense,
    });
  }
}

export async function getDepartWithTickets(
  departId: string,
): Promise<{ depart: DepartRecord; tickets: TicketRecord[] } | null> {
  const depart = await getDepartById(departId);
  if (!depart) return null;
  const tickets = await getTicketsForDepart(departId);
  return { depart, tickets };
}
