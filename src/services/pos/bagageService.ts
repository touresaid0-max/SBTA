import { type BagageRecord } from './db';
import { localInsert, getAll, localUpdate } from './offlineStore';
import { getDepartById, updateDepart } from './departService';
import { getTicketsForDepart, type TicketRecord } from './ticketService';

export type { BagageRecord };

export async function getBagagesForDepart(departId: string): Promise<BagageRecord[]> {
  const all = await getAll<BagageRecord>('bagages');
  return all.filter(b => b.depart_id === departId);
}

export async function generateBagageNumber(): Promise<string> {
  const now = new Date();
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
  price: number;
  destination: string;
  description: string;
  ownerName: string;
  ownerPhone: string;
  printBagage: boolean;
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

  const bagage = await localInsert<BagageRecord>('bagages', {
    depart_id: params.departId,
    bagage_number: bagageNumber,
    ticket_id: linkedTicket?.id,
    ticket_number: linkedTicket?.ticket_number ?? params.ticketNumber,
    with_ticket: params.withTicket,
    with_ticket_report: params.withTicketReport,
    price: params.price,
    destination: params.destination,
    description: params.description,
    car_plate: depart.bus_plate ?? '',
    owner_name: params.ownerName,
    owner_phone: params.ownerPhone,
    print_bagage: params.printBagage,
  });

  const allBagages = await getBagagesForDepart(params.departId);
  const newMtBagage = allBagages.reduce((sum, b) => sum + b.price, 0);
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
    const remaining = (await getBagagesForDepart(bagage.depart_id)).filter(b => b.id !== bagageId);
    const newMtBagage = remaining.reduce((sum, b) => sum + b.price, 0);
    await updateDepart(bagage.depart_id, {
      mt_bagage: newMtBagage,
      solde: depart.mt_ticket + newMtBagage - depart.tot_depense,
      caisse: depart.mt_ticket + newMtBagage - depart.tot_depense,
    });
  }
}
