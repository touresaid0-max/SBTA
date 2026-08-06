import { type TicketRecord, type DepartRecord } from './db';
import { localInsert, getAll, getById, localUpdate } from './offlineStore';
import { getDepartById, updateDepart } from './departService';
import { getReferentiel } from './referentiels';

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
