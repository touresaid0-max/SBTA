import { format } from 'date-fns';
import { PrintService } from '../services/pos/printService';
import type { BagageRecord, DepartRecord } from '../services/pos/db';

export interface BaggageTicketData {
  baggage_number: string;
  destination: string;
  price: number;
  seat_number: string | null;
  departure_number: number | null;
  bus_registration: string | null;
  description: string | null;
  owner_name: string;
  owner_phone: string;
  station_name: string;
  mode_label?: string | null;
  phoneLine?: string;
}

export async function printBaggageTicket(data: BaggageTicketData) {
  const bagage: BagageRecord = {
    id: '',
    depart_id: '',
    bagage_number: data.baggage_number,
    with_ticket: data.mode_label?.toLowerCase().includes('ticket') ?? false,
    with_ticket_report: data.mode_label?.toLowerCase().includes('reporte') ?? false,
    ticket_number: data.seat_number ?? undefined,
    linked_seat_number: data.seat_number ?? undefined,
    price: data.price,
    destination: data.destination,
    description: data.description ?? '',
    car_plate: data.bus_registration ?? '',
    owner_name: data.owner_name,
    owner_phone: data.owner_phone,
    print_bagage: true,
  };

  const now = new Date();
  const depart: DepartRecord = {
    id: '',
    departure_number: data.departure_number ?? 0,
    route_id: '',
    route_name: data.destination,
    route_number: data.departure_number ?? 0,
    bus_id: '',
    bus_plate: data.bus_registration ?? '',
    driver_id: '',
    departure_datetime: now.toISOString(),
    departure_date: format(now, 'yyyy-MM-dd'),
    departure_time: format(now, 'HH:mm'),
    is_ac: false,
    station_id: '',
    station_name: data.station_name,
    status: 'planifie',
    seats_total: 0,
    seats_from: 0,
    seats_sold: 0,
  };

  await PrintService.printBagage({
    bagage,
    depart,
    stationName: data.station_name,
    phoneLine: data.phoneLine,
  });
}

export function generateBaggageNumber(): string {
  const now = new Date();
  const d = format(now, 'yyyyMMdd');
  const t = format(now, 'HHmmss');
  return `${d}_${t}`;
}
