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
}

function matchesTicketSuffix(ticketNumber: string, suffix: string): boolean {
  return ticketNumber.trim().toLowerCase().endsWith(suffix);
}

export async function searchTicketsBySuffix(
  suffix: string,
  stationId: string,
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
      matchesTicketSuffix(ticket.ticket_number, normalizedSuffix),
    )
    .map(ticket => ({ ticket, depart: localDepartMap.get(ticket.depart_id) }))
    .filter(result => result.depart?.station_id === stationId)
    .map(result => ({
      ...result,
      departureNumber: result.depart?.departure_number,
      busPlate: result.depart?.bus_plate,
    }));

  if (!isOnline()) return localResults;

  try {
    const { data: schedules, error: scheduleError } = await supabase
      .from('schedules')
      .select('id, departure_station_id, station_id, station_name, route_number, departure_number, route_name, departure_datetime, bus_id')
      .or(`departure_station_id.eq.${stationId},station_id.eq.${stationId}`);
    if (scheduleError) throw scheduleError;

    const scheduleRows = schedules ?? [];
    if (scheduleRows.length === 0) return localResults;

    const scheduleIds = scheduleRows.map(schedule => schedule.id as string);
    const busIds = scheduleRows
      .map(schedule => schedule.bus_id as string | null)
      .filter((busId): busId is string => Boolean(busId));
    const [{ data: reservations, error: reservationError }, { data: buses }] = await Promise.all([
      supabase
        .from('reservations')
        .select('id, schedule_id, seat_numbers, total_price, passenger_name, passenger_phone, status, booking_reference, destination_city_name, destination_city_id, loyalty_card_number')
        .in('schedule_id', scheduleIds)
        .not('status', 'eq', 'annulee'),
      busIds.length > 0
        ? supabase.from('buses').select('id, registration_number').in('id', busIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (reservationError) throw reservationError;

    const busPlateMap = new Map((buses ?? []).map(bus => [bus.id as string, bus.registration_number as string]));
    const remoteResults: TicketSearchResult[] = [];
    for (const reservation of reservations ?? []) {
      const ticketNumber = String(reservation.booking_reference ?? reservation.id ?? '');
      if (!matchesTicketSuffix(ticketNumber, normalizedSuffix)) continue;

      const schedule = scheduleRows.find(row => row.id === reservation.schedule_id);
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
        destination_id: reservation.destination_city_id as string | undefined,
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
        loyalty_card_number: reservation.loyalty_card_number as string | undefined,
        created_at: '',
        updated_at: '',
      };
      remoteResults.push({
        ticket,
        depart: localDepartMap.get(schedule.id as string),
        departureNumber: Number(schedule.departure_number ?? schedule.route_number ?? 0),
        busPlate: busPlateMap.get(schedule.bus_id as string),
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

export async function sellTickets(seats: number[], commonParams: Omit<SellTicketParams, 'seatNumber'>): Promise<TicketRecord[]> {
  const soldTickets: TicketRecord[] = [];
  for (const seat of seats) {
    const ticket = await sellTicket({ ...commonParams, seatNumber: seat });
    soldTickets.push(ticket);
  }
  // Single depart update after all inserts
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
