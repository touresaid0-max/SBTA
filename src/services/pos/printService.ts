import type { TicketRecord, DepartRecord } from './db';

export interface PrintData {
  ticket: TicketRecord;
  depart: DepartRecord;
  stationName?: string;
}

export const PrintService = {
  print(data: PrintData): void {
    console.log('[PrintService] Print stub called', {
      ticketNumber: data.ticket.ticket_number,
      seat: data.ticket.seat_number,
      destination: data.ticket.destination,
      price: data.ticket.price,
      depart: data.depart.departure_number,
      date: data.depart.departure_date,
    });
  },
};
