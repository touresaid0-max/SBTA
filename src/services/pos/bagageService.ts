import { db, type BagageRecord } from './db';
import { localInsert, getAll, localUpdate } from './offlineStore';
import { getDepartById, updateDepart } from './departService';
import { getTicketsForDepart, type TicketRecord } from './ticketService';
import { trustedNow } from '@/services/offline/deviceClock';

export type { BagageRecord };

export async function getBagagesForDepart(departId: string): Promise<BagageRecord[]> {
  const all = await getAll<BagageRecord>('bagages');
  return all.filter(b => b.depart_id === departId);
}

export async function generateBagageNumber(): Promise<string> {
  const now = trustedNow();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  const datePart = `${dd}${mm}${yyyy}`;
  const all = await getAll<BagageRecord>('bagages');
  const seq = all.length + 1;
  const seqStr = String(seq).padStart(5, '0');
  return `${datePart}${seqStr}-1/${seq}`;
}

export interface RegisterBagageParams {
  departId: string;
  withTicket: boolean;
  withTicketReport: boolean;
  ticketNumber?: string;
  busPlate?: string;
  linkedSeatNumber?: number | string;
  price: number;
  destination: string;
  description: string;
  declaredValue?: number;
  ownerName: string;
  ownerPhone: string;
  printBagage: boolean;
  paymentStatus?: 'paye' | 'en_attente';
}

export async function registerBagage(params: RegisterBagageParams): Promise<BagageRecord> {
  const depart = await getDepartById(params.departId);
  if (!depart) throw new Error('Départ introuvable');

  let linkedTicket: TicketRecord | undefined;
  if (params.withTicket && params.ticketNumber) {
    const tickets = await getTicketsForDepart(params.departId);
    linkedTicket = tickets.find(t => t.ticket_number === params.ticketNumber);
  }

  const bagageNumber = await generateBagageNumber();
  // Seller kept on the device: the Recette bagage screen shows it even before it is sent
  const soldBy = (await db.session.toArray())[0]?.user_id;

  const bagage = await localInsert<BagageRecord>('bagages', {
    depart_id: params.departId,
    bagage_number: bagageNumber,
    ticket_id: linkedTicket?.id,
    ticket_number: linkedTicket?.ticket_number ?? params.ticketNumber,
    linked_seat_number: linkedTicket?.seat_number ?? params.linkedSeatNumber,
    with_ticket: params.withTicket,
    with_ticket_report: params.withTicketReport,
    price: params.price,
    destination: params.destination,
    description: params.description,
    car_plate: params.busPlate ?? depart.bus_plate ?? '',
    owner_name: params.ownerName,
    owner_phone: params.ownerPhone,
    print_bagage: params.printBagage,
    declared_value: params.declaredValue ?? 0,
    station_id: depart.station_id,
    counter_id: depart.counter_id,
    payment_status: params.paymentStatus ?? 'paye',
    ...(soldBy ? { sold_by: soldBy } : {}),
  });

  const allBagages = await getBagagesForDepart(params.departId);
  const paidBagages = allBagages.filter(b => b.description !== '__deleted__' && b.payment_status !== 'en_attente');
  const newMtBagage = paidBagages.reduce((sum, b) => sum + b.price, 0);
  await updateDepart(params.departId, {
    mt_bagage: newMtBagage,
    solde: depart.mt_ticket + newMtBagage - depart.tot_depense,
    caisse: depart.mt_ticket + newMtBagage - depart.tot_depense,
  });

  return bagage;
}

export async function findTicketByNumber(departId: string, ticketNumber: string): Promise<TicketRecord | undefined> {
  const tickets = await getTicketsForDepart(departId);
  return tickets.find(t => t.ticket_number === ticketNumber);
}

export async function deleteBagage(bagageId: string): Promise<void> {
  const all = await getAll<BagageRecord>('bagages');
  const bagage = all.find(b => b.id === bagageId);
  if (!bagage) return;

  await localUpdate<BagageRecord>('bagages', bagageId, { ...bagage, destination: bagage.destination, description: '__deleted__' } as Partial<BagageRecord>);
  const depart = await getDepartById(bagage.depart_id);
  if (depart) {
    const remaining = (await getBagagesForDepart(bagage.depart_id))
      .filter(b => b.id !== bagageId && b.description !== '__deleted__' && b.payment_status !== 'en_attente');
    const newMtBagage = remaining.reduce((sum, b) => sum + b.price, 0);
    await updateDepart(bagage.depart_id, {
      mt_bagage: newMtBagage,
      solde: depart.mt_ticket + newMtBagage - depart.tot_depense,
      caisse: depart.mt_ticket + newMtBagage - depart.tot_depense,
    });
  }
}

/** Paid baggage of a guichetier as the Recette bagage screen shows it. */
export interface BaggageRevenueRow {
  id: string;
  baggage_number: string;
  destination: string;
  price: number;
  created_at: string;
  bus_registration: string | null;
  departure_number: number | null;
  owner_name: string | null;
  has_ticket: boolean;
  /** Recorded on this device and not yet received by the server */
  not_sent?: boolean;
}

/**
 * Paid baggage sold by this guichetier and kept on the device, between two dates. Baggage sold
 * offline was only on the device: the Recette bagage screen, which read the server alone, did
 * not show it. The seller is the one recorded with the baggage, else the author of its operation
 * still to send, else (baggage of earlier versions) the counter's guichetier.
 */
export async function getLocalBaggageRevenue(userId: string, counterId: string | undefined, from: Date, to: Date): Promise<BaggageRevenueRow[]> {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const [bagages, queue, departs] = await Promise.all([
    db.bagages.toArray(),
    db.sync_queue.where('entity').equals('bagages').toArray(),
    db.departs.toArray(),
  ]);
  const author = new Map<string, string | undefined>();
  const waiting = new Set<string>();
  for (const item of queue) {
    if (item.status === 'done' || item.status === 'abandoned') continue;
    const id = String(item.payload?.id ?? '');
    if (item.op === 'insert') { author.set(id, item.user_id); waiting.add(id); }
  }
  const departById = new Map(departs.map(d => [d.id, d]));
  return bagages
    .filter(b => b.description !== '__deleted__' && b.payment_status === 'paye')
    .filter(b => b.created_at >= fromIso && b.created_at <= toIso)
    .filter(b => {
      const seller = b.sold_by ?? author.get(b.id);
      if (seller) return seller === userId;
      return !!counterId && b.counter_id === counterId;
    })
    .map(b => {
      const depart = departById.get(b.depart_id);
      return {
        id: b.id,
        baggage_number: b.bagage_number,
        destination: b.destination,
        price: Number(b.price) || 0,
        created_at: b.created_at,
        bus_registration: b.car_plate || depart?.bus_plate || null,
        departure_number: depart?.departure_number ?? null,
        owner_name: b.owner_name || null,
        has_ticket: b.with_ticket,
        not_sent: waiting.has(b.id) || b.synced === false,
      };
    });
}
