// Departures of the gestionnaire's financial report (detail of a line, or of all the lines).
// Shared by the per-line detail and the « all departures » Excel export: same columns, same sums.
import { format } from 'date-fns';
import { supabase } from '../../services/supabase';

// Ordinary spaces (same format as the DAF report)
export const fmtN = (n: number) => {
  const r = Math.round(n);
  return (r < 0 ? '-' : '') + Math.abs(r).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
};
export const fmtF = (n: number) => fmtN(n) + ' F';
const num = (v: unknown) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };

export const STATUS_LABELS: Record<string, string> = {
  planifie: 'Planifié', en_cours: 'En cours', termine: 'Terminé', annule: 'Annulé', convoi: 'Convoi', retard: 'Retard',
  ramassage_direct: 'Ramassage direct',
};

export interface Depart {
  key: string;
  scheduleId: string;
  isDeparture: boolean;
  datetime: string;
  number: number | null;
  status: string;
  routeId: string | null;
  route: string;
  stationId: string;
  station: string;
  counter: string;
  bus: string;
  company: string;
  capacity: number;
  seats: number;
  tickets: number;
  baggageCount: number;
  baggage: number;
  ramassage: number;
  recette: number;
  transferred: number;
  expenses: number;
  caisse: number;
  solde: number;
}

export function toDepart(r: Record<string, unknown>, i: number): Depart {
  const tickets = num(r.tickets_amount);
  const baggage = num(r.baggage_amount);
  const ramassage = num(r.ramassage_amount);
  const expenses = num(r.exp_ration) + num(r.exp_carburant) + num(r.exp_peage) + num(r.exp_autres);
  const caisse = tickets + baggage + ramassage;
  return {
    key: `${String(r.schedule_id)}-${i}`,
    scheduleId: String(r.schedule_id),
    isDeparture: r.is_departure !== false,
    datetime: String(r.departure_datetime ?? ''),
    number: r.departure_number == null ? null : num(r.departure_number),
    status: String(r.status ?? ''),
    routeId: r.route_id ? String(r.route_id) : null,
    route: String(r.route_name ?? '') || 'Ligne inconnue',
    stationId: String(r.station_id ?? 'none'),
    station: String(r.station_name ?? '') || 'Gare inconnue',
    counter: String(r.counter_number ?? '') || '—',
    bus: String(r.bus_registration ?? '') || '—',
    company: String(r.company_name ?? '') || '—',
    capacity: num(r.capacity),
    seats: num(r.seats_sold),
    tickets,
    baggageCount: num(r.baggage_count),
    baggage,
    ramassage,
    recette: num(r.recette),
    transferred: num(r.transferred_amount),
    expenses,
    caisse,
    solde: caisse - expenses,
  };
}

export interface Totals {
  voyages: number; seats: number; capacity: number; tickets: number; baggage: number; ramassage: number;
  caisse: number; expenses: number; solde: number; recette: number; transferred: number;
}
export function totalsOf(rows: Depart[]): Totals {
  const t: Totals = { voyages: new Set(rows.map(r => r.scheduleId)).size, seats: 0, capacity: 0, tickets: 0, baggage: 0,
    ramassage: 0, caisse: 0, expenses: 0, solde: 0, recette: 0, transferred: 0 };
  for (const r of rows) {
    t.seats += r.seats; t.capacity += r.capacity; t.tickets += r.tickets; t.baggage += r.baggage; t.ramassage += r.ramassage;
    t.caisse += r.caisse; t.expenses += r.expenses; t.solde += r.solde; t.recette += r.recette; t.transferred += r.transferred;
  }
  return t;
}
// Plain ASCII: browsers drop a download name with accents (« Adjamé ») and save it as « download »
export const fileSafe = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
export const fill = (seats: number, capacity: number) => (capacity > 0 ? ((seats / capacity) * 100).toFixed(1) + ' %' : '—');


/** One departure as a row of the Excel « Départs » sheet. */
export function departSheetRow(d: Depart): Record<string, string | number> {
  const dt = d.datetime ? new Date(d.datetime) : null;
  return {
    'Date': dt ? format(dt, 'dd/MM/yyyy') : '', 'Heure': dt ? format(dt, 'HH:mm') : '', 'N° dép.': d.number ?? '',
    'Ligne': d.route, 'Gare': d.station, 'Guichet': d.counter === '—' ? '' : d.counter, 'Car': d.bus === '—' ? '' : d.bus,
    'Société': d.company, 'Statut': STATUS_LABELS[d.status] ?? d.status, 'Places': d.isDeparture ? d.capacity : '',
    'Vendus': d.seats, 'Rempl. %': d.isDeparture && d.capacity > 0 ? Number(((d.seats / d.capacity) * 100).toFixed(1)) : '',
    'Tickets': d.tickets, 'Nb bagages': d.baggageCount, 'Bagages': d.baggage, 'Ramassage': d.ramassage, 'Caisse': d.caisse,
    'Dépenses': d.expenses, 'Solde': d.solde, 'Recette (rapport)': d.recette, 'Part reversée (panne)': d.transferred,
  };
}

export class DeparturesUnavailableError extends Error {}

/**
 * Departures of one line (routeId) or of all the lines (null) of the gestionnaire's company.
 * The API sends a limited number of rows per request (about 1 000): a long period is read in
 * several requests, each starting after the rows already received, until an empty one.
 */
export async function fetchDepartures(routeId: string | null, from: string, to: string): Promise<Depart[]> {
  const out: Record<string, unknown>[] = [];
  const ASK = 1000;
  for (let guard = 0; guard < 500; guard++) {
    const { data, error } = await supabase
      .rpc('get_gestionnaire_route_departures', { p_route_id: routeId, p_from: from, p_to: to })
      .range(out.length, out.length + ASK - 1);
    if (error) {
      const missing = error.code === 'PGRST202' || /could not find the function/i.test(error.message ?? '');
      throw missing ? new DeparturesUnavailableError(error.message) : new Error(error.message);
    }
    const page = (data ?? []) as Record<string, unknown>[];
    if (page.length === 0) break;
    out.push(...page);
  }
  return out.map(toDepart);
}
