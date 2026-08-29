import { type DepartRecord, type SeatAllocation, type TicketRecord } from './db';
import { localInsert, localUpdate, getAll } from './offlineStore';
import { getReferentiel } from './referentiels';
import { supabase } from '@/services/supabase';

export type { DepartRecord, SeatAllocation };

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

export async function nextDepartureNumber(stationId: string, counterId?: string, departureDate?: string): Promise<number> {
  const all = await getAll<DepartRecord>('departs');
  let stationDeparts = all.filter(d => d.station_id === stationId && d.departure_date === departureDate);
  if (counterId) {
    stationDeparts = stationDeparts.filter(d => d.counter_id === counterId);
  }
  if (stationDeparts.length === 0) return 1;
  return Math.max(...stationDeparts.map(d => d.departure_number ?? 0)) + 1;
}

export async function nextRouteNumber(stationId: string, routeId: string, counterId?: string, departureDate?: string): Promise<number> {
  const all = await getAll<DepartRecord>('departs');
  let routeDeparts = all.filter(d => d.station_id === stationId && d.route_id === routeId && d.departure_date === departureDate);
  if (counterId) {
    routeDeparts = routeDeparts.filter(d => d.counter_id === counterId);
  }
  if (routeDeparts.length === 0) return 1;
  return Math.max(...routeDeparts.map(d => d.route_number ?? 0)) + 1;
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
    result = result.filter(d => d.counter_id === counterId);
  }
  return result;
}

export async function getDepartById(id: string): Promise<DepartRecord | undefined> {
  const all = await getAll<DepartRecord>('departs');
  return all.find(d => d.id === id);
}

export function seatsAllocatedForStation(d: DepartRecord, stationId: string): number {
  return getSeatNumbersForStation(d, stationId).length;
}

export function seatsVendusForStation(tickets: import('./db').TicketRecord[], d: DepartRecord, stationId: string): number {
  const allowedSeats = new Set(getSeatNumbersForStation(d, stationId));
  if (allowedSeats.size === 0) return d.seats_sold;
  return tickets.filter(t => t.depart_id === d.id && t.status !== 'cancelled' && allowedSeats.has(t.seat_number)).length;
}

export function seatsLibres(d: DepartRecord): number {
  return d.seats_total - d.seats_sold;
}

export function seatsLibresForStation(tickets: import('./db').TicketRecord[], d: DepartRecord, stationId: string): number {
  const allocated = seatsAllocatedForStation(d, stationId);
  const sold = seatsVendusForStation(tickets, d, stationId);
  return allocated - sold;
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
    const bagagesForDepart = bagages.filter(b => b.depart_id === depart.id && b.description !== '__deleted__');
    const mtTicket = ticketsForDepart.reduce((s, t) => s + t.price, 0);
    const mtBagage = bagagesForDepart.reduce((s, b) => s + b.price, 0);
    return {
      mt_ticket: mtTicket,
      mt_bagage: mtBagage,
      tot_depense: totDepense,
      solde: mtTicket + mtBagage - totDepense,
      caisse: mtTicket + mtBagage - totDepense,
      tickets_count: ticketsForDepart.length,
      bagages_count: bagagesForDepart.length,
      scoped: false,
    };
  }

  const stationSeats = getSeatNumbersForStation(depart, stationId);
  const stationSeatSet = new Set(stationSeats);
  const stationTickets = stationSeats.length > 0
    ? tickets.filter(t =>
        t.depart_id === depart.id &&
        t.status !== 'cancelled' &&
        stationSeatSet.has(t.seat_number),
      )
    : [];
  const stationTicketIds = new Set(stationTickets.map(t => t.id));

  const primaryStationId = depart.station_id;
  const stationBagages = bagages.filter(b => {
    if (b.depart_id !== depart.id) return false;
    if (b.description === '__deleted__') return false;
    if (b.ticket_id && stationTicketIds.has(b.ticket_id)) return true;
    if (b.ticket_id) return false;
    return stationId === primaryStationId;
  });

  const stationDepenses = depenses.filter(d =>
    d.depart_id === depart.id &&
    d.description !== '__deleted__' &&
    d.station_id === stationId,
  );

  const mtTicket = stationTickets.reduce((s, t) => s + t.price, 0);
  const mtBagage = stationBagages.reduce((s, b) => s + b.price, 0);
  const totDepense = stationDepenses.reduce((s, d) => s + d.amount, 0);

  return {
    mt_ticket: mtTicket,
    mt_bagage: mtBagage,
    tot_depense: totDepense,
    solde: mtTicket + mtBagage - totDepense,
    caisse: mtTicket + mtBagage - totDepense,
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
    cloture_at: new Date().toISOString(),
    cloture_by: userName,
  });

  if (existing?.is_ramassage && !existing.ramassage_notified) {
    // Ensure the schedule in Supabase has is_ramassage = true so the destination station
    // can identify this departure as a ramassage in their list
    try {
      await supabase
        .from('schedules')
        .update({ is_ramassage: true, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    } catch { /* best-effort sync */ }

    let arrivalStationId = existing.arrival_station_id;
    let destName: string | undefined;
    let originName: string | undefined;

    // Resolve destination station from route if missing
    if (!arrivalStationId && existing.route_id) {
      try {
        const { data: route } = await supabase
          .from('routes')
          .select('destination_station_id, destination_city_id')
          .eq('id', existing.route_id)
          .maybeSingle();
        if (route?.destination_station_id) {
          arrivalStationId = route.destination_station_id;
        } else if (route?.destination_city_id) {
          const { data: station } = await supabase
            .from('stations')
            .select('id, name')
            .eq('city_id', route.destination_city_id)
            .eq('is_active', true)
            .order('name')
            .limit(1)
            .maybeSingle();
          if (station) {
            arrivalStationId = station.id;
            destName = station.name;
          }
        }
      } catch { /* offline resolution failed */ }
    }

    if (!arrivalStationId) {
      // No destination station found; cannot send notification
      return updated;
    }

    let createdById: string | null = null;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      createdById = user?.id ?? null;
    } catch { /* no active session — insert with null created_by */ }

    try {
      try {
        const { data: sts } = await supabase
          .from('stations')
          .select('id,name')
          .in('id', [existing.station_id, arrivalStationId]);
        originName = sts?.find(s => s.id === existing.station_id)?.name;
        if (!destName) destName = sts?.find(s => s.id === arrivalStationId)?.name;
      } catch { /* offline: names optional */ }

      const { error: insertError } = await supabase.from('ramassage_notifications').insert({
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
        origin_station_name: originName ?? existing.station_name ?? null,
        destination_station_id: arrivalStationId,
        destination_station_name: destName ?? null,
        status: 'pending',
        created_by: createdById,
      });

      if (insertError) {
        console.error('[ramassage] insert failed:', insertError.message, insertError.details, {
          departId: existing.id, route: existing.route_name, arrival: arrivalStationId,
        });
      } else {
        await localUpdate<DepartRecord>('departs', departId, { ramassage_notified: true, arrival_station_id: arrivalStationId });
      }
    } catch (err) {
      console.error('[ramassage] notification error:', err);
    }
  }

  return updated;
}

export async function getDepartsForOtherStations(currentStationId: string, counterId?: string): Promise<DepartRecord[]> {
  const all = await getAll<DepartRecord>('departs');
  let result = all.filter(d => {
    if (d.cancelled) return false;
    if (d.station_id === currentStationId) return false;
    if (d.seat_allocations && d.seat_allocations.some(a => a.station_id === currentStationId)) return true;
    if (d.other_station_id === currentStationId) return true;
    return false;
  });
  if (counterId) {
    result = result.filter(d => d.counter_id === counterId);
  }
  return result;
}

function allocSeats(a: SeatAllocation): number[] {
  if (a.seats && a.seats.length > 0) return [...a.seats].sort((x, y) => x - y);
  const arr: number[] = [];
  for (let s = a.seat_from; s <= a.seat_to; s++) arr.push(s);
  return arr;
}

export function getSeatNumbersForStation(
  depart: DepartRecord,
  stationId: string,
): number[] {
  if (!depart.seat_allocations || depart.seat_allocations.length === 0) {
    if (depart.station_id === stationId) {
      const arr: number[] = [];
      for (let s = depart.seats_from; s <= depart.seats_total; s++) arr.push(s);
      return arr;
    }
    return [];
  }
  const alloc = depart.seat_allocations.find(a => a.station_id === stationId);
  if (!alloc) return [];
  return allocSeats(alloc);
}

export function getSeatRangeForStation(
  depart: DepartRecord,
  stationId: string,
): { from: number; to: number } | null {
  const seats = getSeatNumbersForStation(depart, stationId);
  if (seats.length === 0) return null;
  return { from: seats[0], to: seats[seats.length - 1] };
}

export function isSeatAllowedForStation(
  depart: DepartRecord,
  stationId: string,
  seatNumber: number,
): boolean {
  return getSeatNumbersForStation(depart, stationId).includes(seatNumber);
}

export function getStationNameForSeat(
  depart: DepartRecord,
  seatNumber: number,
): string | null {
  if (!depart.seat_allocations || depart.seat_allocations.length === 0) return null;
  for (const a of depart.seat_allocations) {
    if (allocSeats(a).includes(seatNumber)) return a.station_name;
  }
  return null;
}

export async function findParentDepartForBus(busId: string, currentStationId: string): Promise<DepartRecord | null> {
  const todayStr = new Date().toISOString().split('T')[0];
  const all = await getAll<DepartRecord>('departs');
  const candidates = all.filter(d => {
    if (d.cancelled) return false;
    if (d.cloture) return false;
    if (d.bus_id !== busId) return false;
    if (d.station_id === currentStationId) return false;
    if (d.departure_date !== todayStr) return false;
    return d.seat_allocations?.some(a => a.station_id === currentStationId) ?? false;
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  return candidates[0];
}

export function validateSeatAllocations(
  allocations: SeatAllocation[],
  busCapacity: number,
): string | null {
  if (allocations.length === 0) return null;
  const allSeats: number[] = [];
  for (const a of allocations) {
    const seats = allocSeats(a);
    if (seats.length === 0) continue;
    for (const s of seats) {
      if (s < 1 || s > busCapacity) {
        return `Les sièges doivent être entre 1 et ${busCapacity}`;
      }
      allSeats.push(s);
    }
  }
  const seen = new Set<number>();
  for (const s of allSeats) {
    if (seen.has(s)) {
      return `Le siège ${s} est attribué à plusieurs gares en même temps`;
    }
    seen.add(s);
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
  const now = new Date();
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
  const allTargetTickets = await getAll<TicketRecord>('tickets');
  const targetActive = allTargetTickets.filter(
    t => t.depart_id === targetDepart.id && t.status !== 'cancelled'
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

export interface TransferResult {
  success: boolean;
  transferred: number[];
  message: string;
}

export async function transferSeatsToStation(
  departId: string,
  fromStationId: string,
  toStationId: string,
  count: number,
): Promise<TransferResult> {
  const depart = await getDepartById(departId);
  if (!depart) return { success: false, transferred: [], message: 'Départ introuvable' };
  if (!depart.seat_allocations || depart.seat_allocations.length === 0) {
    return { success: false, transferred: [], message: 'Aucune répartition de sièges sur ce départ' };
  }
  const fromAlloc = depart.seat_allocations.find(a => a.station_id === fromStationId);
  const toAlloc = depart.seat_allocations.find(a => a.station_id === toStationId);
  if (!fromAlloc) return { success: false, transferred: [], message: 'Gare source introuvable dans la répartition' };
  if (!toAlloc) return { success: false, transferred: [], message: 'Gare destinataire introuvable dans la répartition' };

  const fromSeats = allocSeats(fromAlloc);
  const toSeats = new Set(allocSeats(toAlloc));

  // A seat is only free in the source if it's not sold AND not already in the target's range
  const allTickets = await getAll<TicketRecord>('tickets');
  const soldSeats = new Set(
    allTickets
      .filter(t => t.depart_id === departId && t.status !== 'cancelled')
      .map(t => t.seat_number),
  );

  const freeSeatsInFrom = fromSeats.filter(s => !soldSeats.has(s) && !toSeats.has(s));

  if (freeSeatsInFrom.length === 0) {
    return { success: false, transferred: [], message: 'Aucun siège libre disponible dans la gare source' };
  }

  const toTransferCount = Math.min(count, freeSeatsInFrom.length);
  const seatsToTransfer = freeSeatsInFrom.slice(0, toTransferCount);
  const transferSet = new Set(seatsToTransfer);

  // Build new allocations with explicit seats arrays — no overlap possible
  const newAllocations = depart.seat_allocations.map(a => {
    if (a.station_id === fromStationId) {
      const remaining = allocSeats(a).filter(s => !transferSet.has(s));
      return { ...a, seats: remaining, seat_from: remaining[0] ?? 0, seat_to: remaining[remaining.length - 1] ?? -1 };
    }
    if (a.station_id === toStationId) {
      const merged = [...allocSeats(a), ...seatsToTransfer].sort((x, y) => x - y);
      return { ...a, seats: merged, seat_from: merged[0], seat_to: merged[merged.length - 1] };
    }
    return a;
  });

  // Safety check: no seat appears in two allocations
  const allAssigned = new Map<number, string>();
  for (const a of newAllocations) {
    for (const s of allocSeats(a)) {
      if (allAssigned.has(s)) {
        return { success: false, transferred: [], message: `Conflit: le siège ${s} serait attribué à deux gares` };
      }
      allAssigned.set(s, a.station_id);
    }
  }

  await localUpdate<DepartRecord>('departs', departId, { seat_allocations: newAllocations });

  return {
    success: true,
    transferred: seatsToTransfer,
    message: `${seatsToTransfer.length} siège(s) transféré(s) de ${fromAlloc.station_name} vers ${toAlloc.station_name}`,
  };
}

export async function getSoldSeatNumbers(departId: string): Promise<number[]> {
  const all = await getAll<TicketRecord>('tickets');
  return all
    .filter(t => t.depart_id === departId && t.status !== 'cancelled')
    .map(t => t.seat_number);
}
