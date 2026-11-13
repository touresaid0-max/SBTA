import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../../services/supabase';
import { Download, FileText, Bus, Route as RouteIcon, MapPin, Building2, ListOrdered, RotateCcw, RefreshCw, AlertTriangle } from 'lucide-react';
import { format, startOfWeek, startOfMonth, startOfYear } from 'date-fns';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import toast from 'react-hot-toast';
import { usePagination } from '@/hooks/usePagination';
import Pagination from '@/components/pos/Pagination';

// ─── Formats ────────────────────────────────────────────────────────────────
// Ordinary spaces (not the narrow spaces of Intl): the PDF fonts do not have them
const fmtN = (n: number) => {
  const r = Math.round(n);
  return (r < 0 ? '-' : '') + Math.abs(r).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
};
const fmtF = (n: number) => fmtN(n) + ' F';
const pct = (n: number | null) => (n == null ? '—' : n.toFixed(1) + ' %');
const num = (v: unknown) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };

// ─── Period ─────────────────────────────────────────────────────────────────
type PeriodId = 'jour' | 'semaine' | 'mois' | 'annee' | 'custom';
const PERIODS: { id: PeriodId; label: string }[] = [
  { id: 'jour', label: 'Journalier' },
  { id: 'semaine', label: 'Hebdomadaire' },
  { id: 'mois', label: 'Mensuel' },
  { id: 'annee', label: 'Annuel' },
  { id: 'custom', label: 'Personnalisé' },
];
function getRange(id: PeriodId, cf: string, ct: string) {
  const today = new Date();
  const t = format(today, 'yyyy-MM-dd');
  if (id === 'custom') return { from: cf || t, to: ct || cf || t };
  if (id === 'jour') return { from: t, to: t };
  if (id === 'semaine') return { from: format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'), to: t };
  if (id === 'mois') return { from: format(startOfMonth(today), 'yyyy-MM-dd'), to: t };
  return { from: format(startOfYear(today), 'yyyy-MM-dd'), to: t };
}
const frDate = (iso: string) => iso.split('-').reverse().join('/');

// ─── Data ───────────────────────────────────────────────────────────────────
/** One departure, consolidated by the database (get_daf_voyage_report). */
interface Depart {
  id: string;
  datetime: string;
  number: number | null;
  status: string;
  routeId: string | null;
  route: string;
  stationId: string | null;
  station: string;
  arrival: string;
  counterId: string | null;
  counter: string;
  bus: string;
  companyId: string | null;
  company: string;
  capacity: number;
  seats: number;
  tickets: number;
  baggageCount: number;
  baggage: number;
  ramassage: number;
  expenses: number;
  caisse: number;
  solde: number;
  /** A trip made: not cancelled, with tickets sold (or a convoy) */
  voyage: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  planifie: 'Planifié', en_cours: 'En cours', termine: 'Terminé', annule: 'Annulé', convoi: 'Convoi', retard: 'Retard',
};

function toDepart(r: Record<string, unknown>): Depart {
  const tickets = num(r.tickets_amount);
  const baggage = num(r.baggage_amount);
  const ramassage = num(r.ramassage_amount);
  const expenses = num(r.exp_ration) + num(r.exp_carburant) + num(r.exp_peage) + num(r.exp_autres);
  const seats = num(r.seats_sold);
  const status = String(r.status ?? '');
  const caisse = tickets + baggage + ramassage;
  return {
    id: String(r.schedule_id),
    datetime: String(r.departure_datetime ?? ''),
    number: r.departure_number == null ? null : num(r.departure_number),
    status,
    routeId: (r.route_id as string) ?? null,
    route: String(r.route_name ?? '') || 'Ligne inconnue',
    stationId: (r.station_id as string) ?? null,
    station: String(r.station_name ?? '') || 'Gare inconnue',
    arrival: String(r.arrival_station_name ?? ''),
    counterId: (r.counter_id as string) ?? null,
    counter: String(r.counter_number ?? '') || '—',
    bus: String(r.bus_registration ?? '') || '—',
    companyId: (r.company_id as string) ?? null,
    company: String(r.company_name ?? '') || 'Société inconnue',
    capacity: num(r.capacity),
    seats,
    tickets,
    baggageCount: num(r.baggage_count),
    baggage,
    ramassage,
    expenses,
    caisse,
    solde: caisse - expenses,
    voyage: status !== 'annule' && (seats > 0 || tickets > 0 || status === 'convoi'),
  };
}

/** Totals of a set of departures: the same figures for the whole period, a line, a station… */
interface Totals {
  departs: number;
  voyages: number;
  annules: number;
  /** Seats sold on every departure */
  sold: number;
  /** Seats sold and places of the trips made only: the fill rate */
  seats: number;
  capacity: number;
  tickets: number;
  baggage: number;
  ramassage: number;
  expenses: number;
  caisse: number;
  solde: number;
}
const emptyTotals = (): Totals => ({ departs: 0, voyages: 0, annules: 0, sold: 0, seats: 0, capacity: 0, tickets: 0, baggage: 0, ramassage: 0, expenses: 0, caisse: 0, solde: 0 });
function addTo(t: Totals, d: Depart) {
  t.departs += 1;
  if (d.status === 'annule') t.annules += 1;
  if (d.voyage) {
    t.voyages += 1;
    // Fill rate: seats sold over the seats of the trips made (an empty or cancelled departure
    // would lower it without being a trip)
    if (d.capacity > 0) { t.seats += d.seats; t.capacity += d.capacity; }
  }
  t.sold += d.seats;
  t.tickets += d.tickets;
  t.baggage += d.baggage;
  t.ramassage += d.ramassage;
  t.expenses += d.expenses;
  t.caisse += d.caisse;
  t.solde += d.solde;
}
const fillRate = (t: Totals) => (t.capacity > 0 ? (t.seats / t.capacity) * 100 : null);
const perTrip = (t: Totals) => (t.voyages > 0 ? t.caisse / t.voyages : 0);
const margin = (t: Totals) => (t.caisse > 0 ? (t.solde / t.caisse) * 100 : null);

interface Group extends Totals { key: string; label: string; }
function groupBy(rows: Depart[], key: (d: Depart) => string, label: (d: Depart) => string): Group[] {
  const map = new Map<string, Group>();
  for (const d of rows) {
    const k = key(d);
    let g = map.get(k);
    if (!g) { g = { key: k, label: label(d), ...emptyTotals() }; map.set(k, g); }
    addTo(g, d);
  }
  return [...map.values()].sort((a, b) => b.caisse - a.caisse || a.label.localeCompare(b.label));
}

// The server answers 1 000 rows at most per request: read page by page
async function fetchDeparts(from: string, to: string): Promise<Depart[]> {
  const all: Depart[] = [];
  for (;;) {
    const { data, error } = await supabase
      .rpc('get_daf_voyage_report', { p_from: from, p_to: to })
      .range(all.length, all.length + 999);
    if (error) throw error;
    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length === 0) return all;
    all.push(...rows.map(toDepart));
  }
}

type Tab = 'lignes' | 'gares' | 'societes' | 'departs';
const TABS: { id: Tab; label: string; icon: typeof Bus }[] = [
  { id: 'lignes', label: 'Par ligne', icon: RouteIcon },
  { id: 'gares', label: 'Par gare', icon: MapPin },
  { id: 'societes', label: 'Par société', icon: Building2 },
  { id: 'departs', label: 'Détail des départs', icon: ListOrdered },
];

const GROUP_HEADERS = ['Départs', 'Voyages', 'Sièges vendus', 'Remplissage', 'Tickets', 'Bagages', 'Ramassage', 'Caisse', 'Dépenses', 'Solde', 'Recette / voyage', 'Marge'];
const groupCells = (g: Totals): string[] => [
  fmtN(g.departs), fmtN(g.voyages), fmtN(g.sold), pct(fillRate(g)), fmtF(g.tickets), fmtF(g.baggage), fmtF(g.ramassage),
  fmtF(g.caisse), fmtF(g.expenses), fmtF(g.solde), fmtF(perTrip(g)), pct(margin(g)),
];
const DEPART_HEADERS = ['Date', 'Heure', 'N° dép.', 'Ligne', 'Gare', 'Guichet', 'Car', 'Société', 'Statut', 'Places', 'Vendus', 'Rempl.', 'Tickets', 'Bagages', 'Ramassage', 'Caisse', 'Dépenses', 'Solde'];
const departCells = (d: Depart): string[] => {
  const dt = d.datetime ? new Date(d.datetime) : null;
  return [
    dt ? format(dt, 'dd/MM/yyyy') : '—', dt ? format(dt, 'HH:mm') : '—', d.number != null ? String(d.number) : '—',
    d.route, d.station, d.counter, d.bus, d.company, STATUS_LABELS[d.status] ?? d.status,
    fmtN(d.capacity), fmtN(d.seats), d.capacity > 0 ? pct((d.seats / d.capacity) * 100) : '—',
    fmtF(d.tickets), fmtF(d.baggage), fmtF(d.ramassage), fmtF(d.caisse), fmtF(d.expenses), fmtF(d.solde),
  ];
};

// ─── Page ───────────────────────────────────────────────────────────────────
export default function DAFVoyageReport() {
  const [periodId, setPeriodId] = useState<PeriodId>('mois');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [fStation, setFStation] = useState('');
  const [fCounter, setFCounter] = useState('');
  const [fRoute, setFRoute] = useState('');
  const [fCompany, setFCompany] = useState('');
  const [fPlate, setFPlate] = useState('');
  const [tab, setTab] = useState<Tab>('lignes');
  const [departs, setDeparts] = useState<Depart[]>([]);
  const [allRoutes, setAllRoutes] = useState<{ id: string; name: string; origin_station_id?: string | null }[]>([]);
  const [allCounters, setAllCounters] = useState<{ id: string; counter_number: string; station_id: string | null }[]>([]);
  const [allStations, setAllStations] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const { from, to } = getRange(periodId, customFrom, customTo);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDeparts(await fetchDeparts(from, to));
    } catch (e) {
      console.error(e);
      toast.error((e as { message?: string }).message || 'Erreur de chargement du rapport');
      setDeparts([]);
    } finally {
      setLoading(false);
    }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  // Every line and every counter, also those without a departure in the period
  useEffect(() => {
    supabase.from('routes').select('id, name, origin_station_id').order('name').then(({ data, error }) => {
      if (!error && data) { setAllRoutes(data as typeof allRoutes); return; }
      // A database without routes.origin_station_id: the lines without their station
      supabase.from('routes').select('id, name').order('name').then(({ data: plain }) => {
        if (plain) setAllRoutes(plain as typeof allRoutes);
      });
    });
    supabase.from('counters').select('id, counter_number, station_id').order('counter_number').then(({ data }) => {
      if (data) setAllCounters(data as typeof allCounters);
    });
    // Every station too: a station with no departure on the period was missing from the list (a
    // station that had not sent its sales of the day yet seemed not to exist)
    supabase.from('stations').select('id, name').order('name').then(({ data }) => {
      if (data) setAllStations(data as typeof allStations);
    });
  }, []);

  // ── Filter options ──
  // A station chosen: only its counters, and only its lines (those leaving from it, or with a
  // departure from it in the period)
  const options = useMemo(() => {
    const sorted = (m: Map<string, string>) =>
      [...m.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));

    const stations = new Map<string, string>();
    for (const s of allStations) stations.set(s.id, s.name);
    for (const d of departs) if (d.stationId) stations.set(d.stationId, d.station);

    const counters = new Map<string, string>();
    for (const c of allCounters) {
      if (fStation && c.station_id !== fStation) continue;
      const st = c.station_id ? stations.get(c.station_id) : undefined;
      counters.set(c.id, fStation || !st ? c.counter_number : `${c.counter_number} — ${st}`);
    }
    for (const d of departs) {
      if (!d.counterId || counters.has(d.counterId) || (fStation && d.stationId !== fStation)) continue;
      counters.set(d.counterId, fStation ? d.counter : `${d.counter} — ${d.station}`);
    }

    const routes = new Map<string, string>();
    for (const r of allRoutes) if (!fStation || r.origin_station_id === fStation) routes.set(r.id, r.name);
    for (const d of departs) {
      if (!d.routeId || routes.has(d.routeId) || (fStation && d.stationId !== fStation)) continue;
      routes.set(d.routeId, d.route);
    }

    const companies = new Map<string, string>();
    for (const d of departs) if (d.companyId) companies.set(d.companyId, d.company);

    return { stations: sorted(stations), counters: sorted(counters), routes: sorted(routes), companies: sorted(companies) };
  }, [departs, allRoutes, allCounters, allStations, fStation]);

  // Another station chosen: a counter or a line of the previous one is no longer offered
  useEffect(() => {
    if (fCounter && !options.counters.some(o => o.id === fCounter)) setFCounter('');
    if (fRoute && !options.routes.some(o => o.id === fRoute)) setFRoute('');
  }, [options, fCounter, fRoute]);

  const filtered = useMemo(() => {
    const plate = fPlate.trim().toLowerCase().replace(/[\s-]/g, '');
    return departs.filter(d =>
      (!fStation || d.stationId === fStation)
      && (!fCounter || d.counterId === fCounter)
      && (!fRoute || d.routeId === fRoute)
      && (!fCompany || d.companyId === fCompany)
      && (!plate || d.bus.toLowerCase().replace(/[\s-]/g, '').includes(plate)));
  }, [departs, fStation, fCounter, fRoute, fCompany, fPlate]);

  const totals = useMemo(() => { const t = emptyTotals(); filtered.forEach(d => addTo(t, d)); return t; }, [filtered]);

  const byRoute = useMemo(() => {
    const groups = groupBy(filtered, d => d.routeId ?? d.route, d => d.route);
    // All the lines: those without any departure too, as long as no station, counter, company
    // or bus is chosen (they would then mean nothing)
    if (!fStation && !fCounter && !fCompany && !fPlate.trim()) {
      const seen = new Set(groups.map(g => g.key));
      for (const r of allRoutes) {
        if (seen.has(r.id) || (fRoute && r.id !== fRoute)) continue;
        groups.push({ key: r.id, label: r.name, ...emptyTotals() });
      }
    }
    return groups;
  }, [filtered, allRoutes, fStation, fCounter, fCompany, fPlate, fRoute]);
  const byStation = useMemo(() => groupBy(filtered, d => d.stationId ?? d.station, d => d.station), [filtered]);
  const byCompany = useMemo(() => groupBy(filtered, d => d.companyId ?? d.company, d => d.company), [filtered]);

  // ── Pagination (same as the bus list) ──
  const resetKey = `${from}|${to}|${fStation}|${fCounter}|${fRoute}|${fCompany}|${fPlate}`;
  const pRoutes = usePagination(byRoute, 'sbta_daf_voyage_lignes_page_size', resetKey);
  const pStations = usePagination(byStation, 'sbta_daf_voyage_gares_page_size', resetKey);
  const pCompanies = usePagination(byCompany, 'sbta_daf_voyage_societes_page_size', resetKey);
  const pDeparts = usePagination(filtered, 'sbta_daf_voyage_departs_page_size', resetKey);

  const resetFilters = () => { setFStation(''); setFCounter(''); setFRoute(''); setFCompany(''); setFPlate(''); };

  const filterSummary = () => {
    const name = (list: { id: string; label: string }[], id: string) => list.find(o => o.id === id)?.label ?? id;
    const parts: string[] = [];
    if (fStation) parts.push(`Gare : ${name(options.stations, fStation)}`);
    if (fCounter) parts.push(`Guichet : ${name(options.counters, fCounter)}`);
    if (fRoute) parts.push(`Ligne : ${name(options.routes, fRoute)}`);
    if (fCompany) parts.push(`Société : ${name(options.companies, fCompany)}`);
    if (fPlate.trim()) parts.push(`Matricule : ${fPlate.trim()}`);
    return parts.length ? parts.join(' · ') : 'Aucun filtre';
  };
  const periodLabel = from === to ? frDate(from) : `${frDate(from)} au ${frDate(to)}`;

  // ── Excel ──
  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const groupSheet = (groups: Group[], first: string) => XLSX.utils.json_to_sheet(groups.map(g => ({
      [first]: g.label, 'Départs': g.departs, 'Voyages': g.voyages, 'Annulés': g.annules, 'Sièges vendus': g.sold,
      'Remplissage %': fillRate(g) == null ? '' : Number(fillRate(g)!.toFixed(1)),
      'Montant tickets': g.tickets, 'Bagages': g.baggage, 'Ramassage': g.ramassage, 'Caisse': g.caisse,
      'Dépenses': g.expenses, 'Solde': g.solde, 'Recette / voyage': Math.round(perTrip(g)),
      'Marge %': margin(g) == null ? '' : Number(margin(g)!.toFixed(1)),
    })));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { Rubrique: 'Période', Valeur: periodLabel },
      { Rubrique: 'Filtres', Valeur: filterSummary() },
      { Rubrique: 'Départs', Valeur: totals.departs },
      { Rubrique: 'Voyages effectués', Valeur: totals.voyages },
      { Rubrique: 'Départs annulés', Valeur: totals.annules },
      { Rubrique: 'Sièges vendus', Valeur: totals.sold },
      { Rubrique: 'Taux de remplissage moyen %', Valeur: fillRate(totals) == null ? '' : Number(fillRate(totals)!.toFixed(1)) },
      { Rubrique: 'Montant tickets', Valeur: totals.tickets },
      { Rubrique: 'Montant bagages', Valeur: totals.baggage },
      { Rubrique: 'Ramassage', Valeur: totals.ramassage },
      { Rubrique: 'Caisse (tickets + bagages + ramassage)', Valeur: totals.caisse },
      { Rubrique: 'Total dépenses', Valeur: totals.expenses },
      { Rubrique: 'Solde', Valeur: totals.solde },
    ]), 'Synthèse');
    XLSX.utils.book_append_sheet(wb, groupSheet(byRoute, 'Ligne'), 'Par ligne');
    XLSX.utils.book_append_sheet(wb, groupSheet(byStation, 'Gare'), 'Par gare');
    XLSX.utils.book_append_sheet(wb, groupSheet(byCompany, 'Société'), 'Par société');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filtered.map(d => {
      const dt = d.datetime ? new Date(d.datetime) : null;
      return {
        'Date': dt ? format(dt, 'dd/MM/yyyy') : '', 'Heure': dt ? format(dt, 'HH:mm') : '', 'N° départ': d.number ?? '',
        'Ligne': d.route, 'Gare': d.station, 'Arrivée': d.arrival, 'Guichet': d.counter, 'Car': d.bus, 'Société': d.company,
        'Statut': STATUS_LABELS[d.status] ?? d.status, 'Voyage effectué': d.voyage ? 'Oui' : 'Non',
        'Places': d.capacity, 'Sièges vendus': d.seats,
        'Remplissage %': d.capacity > 0 ? Number(((d.seats / d.capacity) * 100).toFixed(1)) : '',
        'Montant tickets': d.tickets, 'Nb bagages': d.baggageCount, 'Bagages': d.baggage, 'Ramassage': d.ramassage,
        'Caisse': d.caisse, 'Dépenses': d.expenses, 'Solde': d.solde,
      };
    })), 'Départs');
    XLSX.writeFile(wb, `rapport_voyages_${from}_${to}.xlsx`);
  };

  // ── PDF: every row (not a picture of the page shown) ──
  const exportPdf = () => {
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const W = pdf.internal.pageSize.getWidth();
    const H = pdf.internal.pageSize.getHeight();
    const M = 10;
    let y = M;
    const newPageIfNeeded = (need: number) => { if (y + need > H - M) { pdf.addPage(); y = M; return true; } return false; };

    const table = (title: string, head: string[], rows: string[][], widths: number[], foot?: string[]) => {
      const scale = (W - 2 * M) / widths.reduce((a, b) => a + b, 0);
      const cols = widths.map(w => w * scale);
      const lineH = 5;
      const drawRow = (cells: string[], bold: boolean, fill?: [number, number, number]) => {
        if (fill) { pdf.setFillColor(...fill); pdf.rect(M, y - 3.6, W - 2 * M, lineH, 'F'); }
        pdf.setFont('helvetica', bold ? 'bold' : 'normal');
        let x = M;
        cells.forEach((c, i) => {
          const maxW = cols[i] - 1.5;
          let t = c;
          while (t.length > 1 && pdf.getTextWidth(t) > maxW) t = t.slice(0, -1);
          const right = i > 0 && /^[-\d\s.,%F—]+$/.test(c);
          pdf.text(t, right ? x + cols[i] - 0.8 : x + 0.8, y, right ? { align: 'right' } : undefined);
          x += cols[i];
        });
        y += lineH;
      };
      newPageIfNeeded(18);
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.text(title, M, y); y += 6;
      pdf.setFontSize(7);
      drawRow(head, true, [230, 240, 233]);
      rows.forEach((r, i) => {
        if (newPageIfNeeded(lineH)) { pdf.setFontSize(7); drawRow(head, true, [230, 240, 233]); }
        drawRow(r, false, i % 2 ? [248, 250, 248] : undefined);
      });
      if (foot) { newPageIfNeeded(lineH); drawRow(foot, true, [220, 235, 225]); }
      y += 4;
    };

    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15);
    pdf.text('Rapports détaillés voyage', M, y); y += 6;
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9);
    pdf.text(`Période : ${periodLabel}    ${filterSummary()}`, M, y); y += 7;

    const kpis: [string, string][] = [
      ['Départs', fmtN(totals.departs)], ['Voyages', fmtN(totals.voyages)], ['Sièges vendus', fmtN(totals.sold)],
      ['Remplissage moyen', pct(fillRate(totals))], ['Tickets', fmtF(totals.tickets)], ['Bagages', fmtF(totals.baggage)],
      ['Ramassage', fmtF(totals.ramassage)], ['Caisse', fmtF(totals.caisse)], ['Dépenses', fmtF(totals.expenses)], ['Solde', fmtF(totals.solde)],
    ];
    const kw = (W - 2 * M) / 5;
    kpis.forEach(([l, v], i) => {
      const x = M + (i % 5) * kw;
      if (i === 5) y += 12;
      pdf.setDrawColor(210); pdf.rect(x + 0.5, y - 4, kw - 1, 10.5);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.text(l, x + 2, y);
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10.5); pdf.text(v, x + 2, y + 5);
    });
    y += 16;

    const gWidths = [44, 14, 14, 17, 17, 22, 20, 20, 24, 22, 22, 22, 15];
    const gFoot = ['TOTAL', ...groupCells(totals)];
    table('Rapport consolidé par ligne', ['Ligne', ...GROUP_HEADERS], byRoute.map(g => [g.label, ...groupCells(g)]), gWidths, gFoot);
    table('Rendement par gare', ['Gare', ...GROUP_HEADERS], byStation.map(g => [g.label, ...groupCells(g)]), gWidths, gFoot);
    table('Rendement par société', ['Société', ...GROUP_HEADERS], byCompany.map(g => [g.label, ...groupCells(g)]), gWidths, gFoot);
    table('Détail des départs', DEPART_HEADERS, filtered.map(departCells),
      [16, 9, 9, 30, 22, 15, 17, 17, 13, 10, 10, 11, 17, 15, 15, 17, 16, 16]);

    const pages = pdf.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      pdf.setPage(i); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7);
      pdf.text(`SBTA — Rapports détaillés voyage — ${periodLabel} — page ${i}/${pages}`, W - M, H - 5, { align: 'right' });
    }
    pdf.save(`rapport_voyages_${from}_${to}.pdf`);
  };

  // ── UI helpers ──
  const sel = 'px-3 py-2 border rounded-xl text-sm w-full';
  const selStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' };
  const card = { backgroundColor: 'var(--surface)', borderColor: 'var(--border)' };
  const th = 'px-3 py-2.5 text-xs font-semibold whitespace-nowrap';

  const GroupTable = ({ first, rows, totalRow, page }: { first: string; rows: Group[]; totalRow: Totals; page: ReturnType<typeof usePagination<Group>> }) => (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead style={{ backgroundColor: 'var(--surface-raised)' }}>
            <tr>
              <th className={`${th} text-left`} style={{ color: 'var(--text-secondary)' }}>{first}</th>
              {GROUP_HEADERS.map(h => <th key={h} className={`${th} text-right`} style={{ color: 'var(--text-secondary)' }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {page.pageItems.map(g => {
              const cells = groupCells(g);
              return (
                <tr key={g.key} className="border-t" style={{ borderColor: 'var(--border)', opacity: g.departs === 0 ? 0.55 : 1 }}>
                  <td className="px-3 py-2 font-medium" style={{ color: 'var(--text-primary)' }}>{g.label}</td>
                  {cells.map((c, i) => (
                    <td key={i} className="px-3 py-2 text-right whitespace-nowrap"
                      style={{ color: i === 9 ? (g.solde >= 0 ? '#15803D' : '#DC2626') : i === 7 ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: i === 7 || i === 9 ? 700 : 400 }}>
                      {c}
                    </td>
                  ))}
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={13} className="px-3 py-8 text-center" style={{ color: 'var(--text-muted)' }}>Aucun départ sur la période.</td></tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot style={{ backgroundColor: 'var(--surface-raised)' }}>
              <tr className="border-t-2 font-bold" style={{ borderColor: 'var(--border)' }}>
                <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>TOTAL ({rows.length})</td>
                {groupCells(totalRow).map((c, i) => (
                  <td key={i} className="px-3 py-2.5 text-right whitespace-nowrap"
                    style={{ color: i === 9 ? (totalRow.solde >= 0 ? '#15803D' : '#DC2626') : 'var(--text-primary)' }}>{c}</td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {rows.length > 0 && (
        <div className="border-t px-4 py-2" style={{ borderColor: 'var(--border)' }}>
          <Pagination page={page.page} pageCount={page.pageCount} pageSize={page.pageSize} total={page.total}
            onPageChange={page.setPage} onPageSizeChange={page.setPageSize} itemLabel={first === 'Ligne' ? 'lignes' : first === 'Gare' ? 'gares' : 'sociétés'} />
        </div>
      )}
    </>
  );

  const kpiCards: { label: string; value: string; color: string; sub?: string }[] = [
    { label: 'Départs', value: fmtN(totals.departs), color: '#3B82F6', sub: totals.annules ? `dont ${fmtN(totals.annules)} annulé(s)` : undefined },
    { label: 'Voyages effectués', value: fmtN(totals.voyages), color: '#0B7439' },
    { label: 'Sièges vendus', value: fmtN(totals.sold), color: '#8B5CF6' },
    { label: 'Taux de remplissage moyen', value: pct(fillRate(totals)), color: '#0EA5E9' },
    { label: 'Montant tickets', value: fmtF(totals.tickets), color: '#1a2a22' },
    { label: 'Montant bagages', value: fmtF(totals.baggage), color: '#1a2a22' },
    { label: 'Ramassage', value: fmtF(totals.ramassage), color: '#1a2a22' },
    { label: 'Caisse', value: fmtF(totals.caisse), color: '#0B7439', sub: 'tickets + bagages + ramassage' },
    { label: 'Total dépenses', value: fmtF(totals.expenses), color: '#EA580C' },
    { label: 'Solde', value: fmtF(totals.solde), color: totals.solde >= 0 ? '#15803D' : '#DC2626', sub: 'caisse − dépenses' },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Rapports détaillés voyage</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            Données consolidées de toutes les gares · {periodLabel}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading} title="Actualiser"
            className="p-2 rounded-xl border" style={card}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} style={{ color: 'var(--text-secondary)' }} />
          </button>
          <button onClick={exportPdf} disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: '#DC2626', color: '#fff' }}>
            <FileText className="w-4 h-4" /> PDF
          </button>
          <button onClick={exportExcel} disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: '#16A34A', color: '#fff' }}>
            <Download className="w-4 h-4" /> Excel
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-2xl border p-4 space-y-3" style={card}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
            {PERIODS.map(p => (
              <button key={p.id} onClick={() => setPeriodId(p.id)}
                className="px-3 py-1.5 text-sm font-medium transition-colors"
                style={{ backgroundColor: periodId === p.id ? '#0B7439' : 'var(--surface)', color: periodId === p.id ? '#fff' : 'var(--text-secondary)' }}>
                {p.label}
              </button>
            ))}
          </div>
          {periodId === 'custom' && (
            <div className="flex items-center gap-2">
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="px-3 py-1.5 border rounded-lg text-sm" style={selStyle} />
              <span style={{ color: 'var(--text-muted)' }}>→</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="px-3 py-1.5 border rounded-lg text-sm" style={selStyle} />
            </div>
          )}
          <button onClick={resetFilters} className="ml-auto flex items-center gap-1.5 text-xs font-medium underline" style={{ color: 'var(--text-secondary)' }}>
            <RotateCcw className="w-3.5 h-3.5" /> Réinitialiser les filtres
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <label className="text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
            <span>Gare</span>
            <select value={fStation} onChange={e => { setFStation(e.target.value); setFCounter(''); }} className={sel} style={selStyle}>
              <option value="">Toutes les gares</option>
              {options.stations.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
          <label className="text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
            <span>Guichet</span>
            <select value={fCounter} onChange={e => setFCounter(e.target.value)} className={sel} style={selStyle}>
              <option value="">Tous les guichets</option>
              {options.counters.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
          <label className="text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
            <span>Ligne</span>
            <select value={fRoute} onChange={e => setFRoute(e.target.value)} className={sel} style={selStyle}>
              <option value="">Toutes les lignes</option>
              {options.routes.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
          <label className="text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
            <span>Société</span>
            <select value={fCompany} onChange={e => setFCompany(e.target.value)} className={sel} style={selStyle}>
              <option value="">Toutes les sociétés</option>
              {options.companies.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
          <label className="text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
            <span>Matricule du car</span>
            <input value={fPlate} onChange={e => setFPlate(e.target.value)} placeholder="ex : 1224LK05" className={sel} style={selStyle} />
          </label>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 rounded-full animate-spin" style={{ borderColor: '#0B7439', borderTopColor: 'transparent' }} />
        </div>
      ) : (
        <>
          {/* Filters that leave nothing: said plainly (a counter kept from another period showed
              every figure at 0, as if no station had sold) */}
          {filtered.length === 0 && filterSummary() !== 'Aucun filtre' && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border px-4 py-3 text-sm" role="status"
              style={{ borderColor: '#FCD34D', backgroundColor: 'rgba(245,158,11,0.08)', color: '#92400E' }}>
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1">
                Aucun départ reçu par le serveur pour {periodLabel === frDate(from) ? `le ${periodLabel}` : `la période ${periodLabel}`} avec ces filtres ({filterSummary()}).
                {departs.length > 0 && ` Sans filtre : ${departs.length} départ${departs.length > 1 ? 's' : ''} sur la période.`}
              </span>
              <button onClick={resetFilters} className="flex items-center gap-1.5 text-xs font-semibold underline">
                <RotateCcw className="w-3.5 h-3.5" /> Réinitialiser les filtres
              </button>
            </div>
          )}
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {kpiCards.map(k => (
              <div key={k.label} className="rounded-xl border p-4" style={card}>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{k.label}</p>
                <p className="text-lg font-bold mt-1" style={{ color: k.color }}>{k.value}</p>
                {k.sub && <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{k.sub}</p>}
              </div>
            ))}
          </div>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Voyage effectué : départ non annulé avec au moins un ticket vendu (ou convoi). Taux de remplissage : sièges vendus
            sur les places des voyages effectués. Recette / voyage : caisse divisée par le nombre de voyages.
          </p>

          {/* Tabs */}
          <div className="rounded-2xl border overflow-hidden" style={card}>
            <div className="flex flex-wrap border-b" style={{ borderColor: 'var(--border)' }}>
              {TABS.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className="flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 -mb-px"
                  style={{ borderColor: tab === t.id ? '#0B7439' : 'transparent', color: tab === t.id ? '#0B7439' : 'var(--text-secondary)' }}>
                  <t.icon className="w-4 h-4" /> {t.label}
                </button>
              ))}
            </div>

            {tab === 'lignes' && <GroupTable first="Ligne" rows={byRoute} totalRow={totals} page={pRoutes} />}
            {tab === 'gares' && <GroupTable first="Gare" rows={byStation} totalRow={totals} page={pStations} />}
            {tab === 'societes' && <GroupTable first="Société" rows={byCompany} totalRow={totals} page={pCompanies} />}
            {tab === 'departs' && (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead style={{ backgroundColor: 'var(--surface-raised)' }}>
                      <tr>
                        {DEPART_HEADERS.map((h, i) => (
                          <th key={h} className={`${th} ${i >= 9 ? 'text-right' : 'text-left'}`} style={{ color: 'var(--text-secondary)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pDeparts.pageItems.map(d => (
                        <tr key={d.id} className="border-t" style={{ borderColor: 'var(--border)', opacity: d.status === 'annule' ? 0.55 : 1 }}>
                          {departCells(d).map((c, i) => (
                            <td key={i} className={`px-3 py-2 whitespace-nowrap ${i >= 9 ? 'text-right' : ''}`}
                              style={{
                                color: i === 17 ? (d.solde >= 0 ? '#15803D' : '#DC2626') : i === 6 || i === 15 ? 'var(--text-primary)' : 'var(--text-secondary)',
                                fontWeight: i === 6 || i === 15 || i === 17 ? 700 : 400,
                              }}>
                              {c}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {filtered.length === 0 && (
                        <tr><td colSpan={18} className="px-3 py-8 text-center" style={{ color: 'var(--text-muted)' }}>Aucun départ sur la période.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {filtered.length > 0 && (
                  <div className="border-t px-4 py-2" style={{ borderColor: 'var(--border)' }}>
                    <Pagination page={pDeparts.page} pageCount={pDeparts.pageCount} pageSize={pDeparts.pageSize} total={pDeparts.total}
                      onPageChange={pDeparts.setPage} onPageSizeChange={pDeparts.setPageSize} itemLabel="départs" />
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
