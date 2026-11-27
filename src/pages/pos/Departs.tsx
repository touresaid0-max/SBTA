import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import POSLayout from '@/components/pos/POSLayout';
import { usePOSSession } from '@/services/pos/POSSessionContext';
import {
  getAllDeparts, updateDepart, cloturerDepart, type DepartRecord,
  type VehiculeRef, type ChauffeurRef,
  seatsLibres,
  seatsCommercialisables,
  lastSeatNumber,
  getSeatRangeForStation,
  ticketsOfStation,
  seatsAllocatedForStation, seatsVendusForStation, seatsLibresForStation,
  getVehicules, getChauffeurs, getGares,
  findNextDepartForRoute, transferTicketsToDepart,
  renumberDepartsAfterCancellation,
  computeStationScopedTotals,
  isFormerStationDepart,
  scopeStationFor,
  stationSeatsNow, seatRangesLabel,
} from '@/services/pos/departService';
import { getByDeparts, groupByDepart, syncDepartsAndTicketsFromServer, lastServerSyncAt, type ServerSyncResult } from '@/services/pos/offlineStore';
import { supabase } from '@/services/supabase';
import { isOnline } from '@/services/pos/syncEngine';
import { getDepensesForDepart } from '@/services/pos/depenseService';
import { getBagagesForDepart } from '@/services/pos/bagageService';
import type { TicketRecord, BagageRecord, DepenseRecord } from '@/services/pos/db';
import { printBordereauDepartThermal } from '@/services/pos/printService';
import { printRecettesBordereau } from '@/services/pos/printService';
import type { BordereauDepartData, BordereauDestinationGroup, BordereauRecettesData } from '@/types/counter.types';
import { executeFullTransfer, getPendingTransfersForStation } from '@/services/pos/transferService';
import type { DepartSummary } from '@/services/pos/posReportService';
import {
  departToSummary, exportToExcel, exportToPDF, printDeparturesList,
} from '@/services/pos/posReportService';
import { formatCurrency } from '@/utils/formatCurrency';
import EditDepartModal, { type ServerSeatTicket, type ReseatResult } from '@/components/pos/EditDepartModal';
import { db } from '@/services/pos/db';
import { fetchPendingReprintsForSchedules } from '@/services/ticketReprint.service';
import DepartExpensesModal from '@/components/pos/DepartExpensesModal';
import ChangeRequestButton from '@/components/shared/ChangeRequestButton';
import Pagination from '@/components/pos/Pagination';
import { usePagination } from '@/hooks/usePagination';
import {
  Plus, Pencil, Printer, Ticket, XCircle, Lock,
  ChevronUp, ChevronDown, Loader2, X, AlertCircle,
  FileText, FileSpreadsheet, Copy, Clock, ScrollText, ListChecks, Receipt, CalendarRange, RefreshCw,
} from 'lucide-react';
import { trustedNow, trustedNowIso } from '@/services/offline/deviceClock';
import { isDepartSaleOver } from '@/services/pos/closureRule';
import { getTicketPhoneLine, cachedTicketPhoneLine } from '@/services/ticketPhones.service';

/** Name of a line without the extra spaces (start, end, doubled), as the line filter compares it. */
function lineKey(name: string | null | undefined): string {
  return (name ?? '').trim().replace(/\s+/g, ' ');
}

type SortKey = 'departure_datetime' | 'departure_number' | 'route_number' | 'route_name' | 'bus_plate' | 'bus_name' | 'driver_name' | 'seats_total' | 'seats_libres' | 'seats_sold' | 'cloture' | 'mt_ticket' | 'mt_bagage' | 'tot_depense' | 'solde' | 'caisse';
type SortDir = 'asc' | 'desc';

interface DepartRow extends DepartRecord {
  seats_libres: number;
  seats_sold_station: number;
  seats_allocated: number;
  solde_calc: number;
}

function toRow(d: DepartRecord, tickets: TicketRecord[], stationId?: string): DepartRow {
  if (stationId && d.seat_allocations && d.seat_allocations.length > 0) {
    const allocated = seatsAllocatedForStation(d, stationId);
    const sold = seatsVendusForStation(tickets, d, stationId);
    return {
      ...d,
      seats_allocated: allocated,
      seats_sold_station: sold,
      seats_libres: seatsLibresForStation(tickets, d, stationId),
      solde_calc: d.mt_ticket - d.tot_depense,
    };
  }
  return {
    ...d,
    seats_allocated: seatsCommercialisables(d),
    seats_sold_station: d.seats_sold,
    seats_libres: seatsLibres(d),
    solde_calc: d.mt_ticket - d.tot_depense,
  };
}

function getSortValue(row: DepartRow, key: SortKey): string | number | boolean {
  switch (key) {
    case 'departure_datetime': return row.departure_datetime;
    case 'departure_number': return row.departure_number;
    case 'route_number': return row.route_number;
    case 'route_name': return row.route_name ?? '';
    case 'bus_plate': return row.bus_plate ?? '';
    case 'bus_name': return row.bus_name ?? '';
    case 'driver_name': return row.driver_name ?? '';
    case 'seats_total': return row.seats_total;
    case 'seats_libres': return row.seats_libres;
    case 'seats_sold': return row.seats_sold_station;
    case 'cloture': return row.cloture;
    case 'mt_ticket': return row.mt_ticket;
    case 'mt_bagage': return row.mt_bagage;
    case 'tot_depense': return row.tot_depense;
    case 'solde': return row.solde_calc;
    case 'caisse': return row.caisse;
  }
}

// phoneLine: the numbers printed on the tickets (chef de gare / guichetier); without it, the
// bordereau de départ printed the company's two fixed numbers
async function printBordereauForDepart(depart: DepartRow, stationId?: string, stationName?: string, phoneLine?: string): Promise<void> {
  const [tickets, bagages, depenses] = await Promise.all([
    getByDeparts<TicketRecord>('tickets', [depart.id]),
    getBagagesForDepart(depart.id),
    getDepensesForDepart(depart.id),
  ]);

  const hasAllocations = !!(depart.seat_allocations && depart.seat_allocations.length > 0);
  const seatRange = hasAllocations && stationId ? getSeatRangeForStation(depart, stationId) : null;

  let activeTickets = tickets.filter(
    t => t.depart_id === depart.id && t.status !== 'cancelled'
  );
  if (hasAllocations && stationId) {
    // The tickets this station sold (seat of its range when the seller is unknown)
    activeTickets = ticketsOfStation(activeTickets, depart, stationId);
  }

  const stationTicketIds = new Set(activeTickets.map(t => t.id));
  const scopedBagages = hasAllocations && stationId
    ? bagages.filter(b => {
        if (b.description === '__deleted__') return false;
        if (b.payment_status === 'en_attente') return false;
        if (b.ticket_id && stationTicketIds.has(b.ticket_id)) return true;
        if (b.ticket_id) return false;
        return stationId === depart.station_id;
      })
    : bagages.filter(b => b.description !== '__deleted__' && b.payment_status !== 'en_attente');

  const scopedDepenses = hasAllocations && stationId
    ? depenses.filter(d => d.description !== '__deleted__' && d.station_id === stationId)
    : depenses.filter(d => d.description !== '__deleted__');

  // Group tickets by destination
  const groupsMap = new Map<string, TicketRecord[]>();
  for (const t of activeTickets) {
    const dest = t.destination || '—';
    if (!groupsMap.has(dest)) groupsMap.set(dest, []);
    groupsMap.get(dest)!.push(t);
  }

  const destinationGroups: BordereauDestinationGroup[] = Array.from(groupsMap.entries()).map(
    ([destination, destTickets]) => ({
      destination,
      seats_sold: destTickets.length,
      unit_price: destTickets[0]?.price ?? 0,
      amount: destTickets.reduce((sum, t) => sum + t.price, 0),
      seat_numbers: destTickets.map(t => String(t.seat_number)).sort((a, b) => +a - +b),
    })
  );

  const totalTicketAmount = activeTickets.reduce((sum, t) => sum + t.price, 0);
  const totalBaggage = scopedBagages.reduce((sum, b) => sum + b.price, 0);

  // Categorize expenses
  const validDepenses = scopedDepenses;
  const totalRations = validDepenses
    .filter(d => d.type.toLowerCase().includes('ratio') || d.type.toLowerCase().includes('frais de route') || d.type.toLowerCase().includes('frais route'))
    .reduce((s, d) => s + d.amount, 0);
  const totalCarburant = validDepenses
    .filter(d => d.type.toLowerCase().includes('carburant'))
    .reduce((s, d) => s + d.amount, 0);
  const totalPeages = validDepenses
    .filter(d => d.type.toLowerCase().includes('péage') || d.type.toLowerCase().includes('peage'))
    .reduce((s, d) => s + d.amount, 0);
  const totalAutres = validDepenses
    .filter(d => {
      const t = d.type.toLowerCase();
      return !t.includes('ratio') && !t.includes('frais de route') && !t.includes('frais route')
        && !t.includes('carburant') && !t.includes('péage') && !t.includes('peage');
    })
    .reduce((s, d) => s + d.amount, 0);
  const totalCharges = totalRations + totalCarburant + totalPeages + totalAutres;
  const soldeTicket = totalTicketAmount - totalCharges;

  const now = trustedNow();
  const pad = (n: number) => String(n).padStart(2, '0');
  const printDate = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
  const printTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  let depDate = depart.departure_date;
  let depTime = depart.departure_time;
  try {
    const d = new Date(depart.departure_datetime);
    if (!isNaN(d.getTime())) {
      depDate = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
      depTime = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
  } catch { /* keep defaults */ }

  // Shared departure: the seats the station holds now (after the transfers between stations)
  const totalSeats = hasAllocations && stationId ? seatsAllocatedForStation(depart, stationId) : seatRange ? seatRange.to - seatRange.from + 1 : seatsCommercialisables(depart);
  const data: BordereauDepartData = {
    // « GUICHET : » the station of the counter printing it. A departure pulled from the server has no
    // station name (schedules has no such column): the line was printed empty.
    station_name: depart.station_name || stationName || '',
    departure_number: depart.route_number ?? depart.departure_number,
    route_name: depart.route_name ?? '',
    departure_date: depDate,
    departure_time: depTime,
    registration_number: depart.bus_plate ?? '',
    driver_name: depart.driver_name ?? '',
    total_seats: totalSeats,
    seats_sold: activeTickets.length,
    seats_remaining: totalSeats - activeTickets.length,
    destination: destinationGroups[0]?.destination ?? '',
    unit_price: destinationGroups[0]?.unit_price ?? 0,
    total_ticket_amount: totalTicketAmount,
    total_charges: totalCharges,
    total_rations: totalRations,
    total_carburant: totalCarburant,
    total_peages: totalPeages,
    total_autres: totalAutres,
    convoy_amount: 0,
    is_convoy: false,
    solde_ticket: soldeTicket,
    total_baggage: totalBaggage,
    sold_seat_numbers: activeTickets.map(t => String(t.seat_number)).sort((a, b) => +a - +b),
    destination_groups: destinationGroups,
    print_date: printDate,
    print_time: printTime,
  };

  await printBordereauDepartThermal({ data, phoneLine: phoneLine || undefined });
}

type Period = 'today' | 'yesterday' | 'last7' | 'week' | 'month' | 'last_month' | 'all' | 'custom';

const PERIOD_LABELS: Record<Period, string> = {
  today: "Aujourd'hui",
  yesterday: 'Hier',
  last7: '7 derniers jours',
  week: 'Cette semaine',
  month: 'Ce mois',
  last_month: 'Mois dernier',
  all: 'Toutes les dates',
  custom: 'Plage personnalisée',
};

// The device keeps the departures of the last days: an older period is pulled from the server
const LOCAL_HISTORY_DAYS = 7;

/** YYYY-MM-DD of a date in UTC, the time zone of the departures (Côte d'Ivoire). */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shiftDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDay(d);
}

/** First and last day (inclusive) of a period; undefined means no limit on that side. */
function periodRange(period: Period, customFrom: string, customTo: string): { from?: string; to?: string } {
  const today = isoDay(trustedNow());
  const now = new Date(`${today}T00:00:00Z`);
  switch (period) {
    case 'today': return { from: today, to: today };
    case 'yesterday': { const y = shiftDays(today, -1); return { from: y, to: y }; }
    case 'last7': return { from: shiftDays(today, -6), to: today };
    case 'week': {
      // Week starting on Monday
      const offset = (now.getUTCDay() + 6) % 7;
      return { from: shiftDays(today, -offset), to: today };
    }
    case 'month': return { from: `${today.slice(0, 8)}01`, to: today };
    case 'last_month': {
      const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const lastOfPrev = new Date(firstOfMonth.getTime() - 86_400_000);
      return { from: `${isoDay(lastOfPrev).slice(0, 8)}01`, to: isoDay(lastOfPrev) };
    }
    case 'custom': {
      const from = customFrom || undefined;
      const to = customTo || undefined;
      // Dates entered in the wrong order are swapped rather than giving an empty list
      if (from && to && from > to) return { from: to, to: from };
      return { from, to };
    }
    default: return {};
  }
}

function formatDay(day: string): string {
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
}

function periodDescription(period: Period, range: { from?: string; to?: string }): string {
  if (period !== 'custom') return PERIOD_LABELS[period].toLowerCase();
  if (range.from && range.to) return range.from === range.to ? `du ${formatDay(range.from)}` : `du ${formatDay(range.from)} au ${formatDay(range.to)}`;
  if (range.from) return `depuis le ${formatDay(range.from)}`;
  if (range.to) return `jusqu'au ${formatDay(range.to)}`;
  return 'toutes dates';
}

export default function POSDeparts() {
  const navigate = useNavigate();
  const { session } = usePOSSession();
  // Numbers printed on the bordereaux de départ and des recettes: the same line as the tickets
  // (chef de gare / guichetier), kept on the device for printing offline
  const [phoneLine, setPhoneLine] = useState(() => cachedTicketPhoneLine(session?.counter_id));
  useEffect(() => {
    if (!session?.counter_id) return;
    let cancelled = false;
    getTicketPhoneLine(session.counter_id).then(p => { if (!cancelled && p) setPhoneLine(p); }).catch(() => {});
    return () => { cancelled = true; };
  }, [session?.counter_id]);
  const [departs, setDeparts] = useState<DepartRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [periodLoading, setPeriodLoading] = useState(false);
  // Outcome of the last reading of the server: a failed one is said on screen (the figures shown
  // are then those of the last full reading, and the sales of other devices may be missing)
  const [serverSync, setServerSync] = useState<ServerSyncResult | null>(null);
  const [reloading, setReloading] = useState(false);
  // Earliest day already pulled from the server during this visit
  const pulledSinceRef = useRef<string | null>(null);
  const [routeFilter, setRouteFilter] = useState('');
  const [departureFilter, setDepartureFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('departure_datetime');
  // Most recent departures first
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [showExportsMenu, setShowExportsMenu] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showCancelConfirm, setShowCancelConfirm] = useState<DepartRow | null>(null);
  const [allTickets, setAllTickets] = useState<TicketRecord[]>([]);
  const [cancelError, setCancelError] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  const [showExpensesModal, setShowExpensesModal] = useState(false);
  const [editVehicules, setEditVehicules] = useState<VehiculeRef[]>([]);
  const [editChauffeurs, setEditChauffeurs] = useState<ChauffeurRef[]>([]);
  const [editSoldTickets, setEditSoldTickets] = useState<TicketRecord[]>([]);
  const [editNextDepart, setEditNextDepart] = useState<DepartRecord | null>(null);
  // Tickets of the departure being changed, read from the server (all counters and stations)
  const [editServerTickets, setEditServerTickets] = useState<ServerSeatTicket[] | null>(null);
  const [pendingTransfers, setPendingTransfers] = useState(0);

  // Period shown, read when the list is built (only its departures are computed, see below)
  const periodRef = useRef({ period, customFrom, customTo });
  periodRef.current = { period, customFrom, customTo };

  const showLocalDeparts = useCallback(async () => {
    const all = await getAllDeparts(session?.station_id, session?.counter_id);
    // Tickets, baggage and expenses of the departures SHOWN only (the period chosen, and the
    // departures re-opened by the admin, always shown), read by index and grouped once by
    // departure. Every departure kept on the device (several days) filtered the whole tables:
    // the list got slower and slower as sales piled up offline. The others keep their totals.
    const { period: p, customFrom: cf, customTo: ct } = periodRef.current;
    const shown = periodRange(p, cf, ct);
    const ids = all
      .filter(d =>
        (d.reopened_at && !d.cloture) ||
        ((!shown.from || d.departure_date >= shown.from) && (!shown.to || d.departure_date <= shown.to)))
      .map(d => d.id);
    const [tickets, allBagages, allDepenses] = await Promise.all([
      getByDeparts<TicketRecord>('tickets', ids),
      getByDeparts<BagageRecord>('bagages', ids),
      getByDeparts<DepenseRecord>('depenses', ids),
    ]);
    const ticketsBy = groupByDepart(tickets);
    const bagagesBy = groupByDepart(allBagages);
    const depensesBy = groupByDepart(allDepenses);
    const computed = new Set(ids);
    const hydrated = all.map(d => {
      if (!computed.has(d.id)) return d;
      // A departure made at the counter's former station: that station's share
      const totals = computeStationScopedTotals(d, ticketsBy.get(d.id) ?? [], bagagesBy.get(d.id) ?? [], depensesBy.get(d.id) ?? [], scopeStationFor(d, session?.station_id, session?.counter_id));
      return {
        ...d,
        mt_ticket: totals.mt_ticket,
        mt_bagage: totals.mt_bagage,
        tot_depense: totals.tot_depense,
        solde: totals.mt_ticket - totals.tot_depense,
        caisse: totals.mt_ticket - totals.tot_depense,
      };
    });
    setAllTickets(tickets);
    setDeparts(hydrated.map(d => toRow(d, ticketsBy.get(d.id) ?? [], scopeStationFor(d, session?.station_id, session?.counter_id))));
    setLoading(false);

    // Check for pending transfers needing a next depart
    if (session?.station_id) {
      const pending = await getPendingTransfersForStation(session.station_id);
      setPendingTransfers(pending.length);
    }
  }, [session?.station_id, session?.counter_id]);

  // What the device has is shown at once; the server sync runs after and the list is read again.
  // Waiting for the sync first left the list loading for minutes on a slow connection.
  const loadDeparts = useCallback(async () => {
    await showLocalDeparts();
    setServerSync(await syncDepartsAndTicketsFromServer(session?.station_id, undefined, session?.counter_id));
    await showLocalDeparts();
  }, [session?.station_id, session?.counter_id, showLocalDeparts]);

  useEffect(() => {
    loadDeparts();
  }, [loadDeparts]);

  const todayStr = trustedNowIso().split('T')[0];

  const range = useMemo(() => periodRange(period, customFrom, customTo), [period, customFrom, customTo]);
  const periodText = periodDescription(period, range);

  // Another period: its departures are computed (from the device only; the first build at
  // opening is done by loadDeparts)
  const periodShownRef = useRef(false);
  useEffect(() => {
    if (!periodShownRef.current) { periodShownRef.current = true; return; }
    void showLocalDeparts();
  }, [range.from, range.to, showLocalDeparts]);
  // « Recharger depuis le serveur »: the period shown is read again in full, without waiting for the
  // first opening of the next day (the days kept on the device are otherwise read once a day)
  const reloadFromServer = async () => {
    if (reloading) return;
    setReloading(true);
    try {
      const res = await syncDepartsAndTicketsFromServer(session?.station_id, range.from, session?.counter_id);
      setServerSync(res);
      if (res.ok && range.from) pulledSinceRef.current = range.from;
      await showLocalDeparts();
    } finally {
      setReloading(false);
    }
  };
  const lastFullSync = (() => {
    const at = serverSync ? lastServerSyncAt(session?.station_id) : null;
    if (!at) return null;
    const d = new Date(at);
    if (isNaN(d.getTime())) return null;
    const p2 = (n: number) => String(n).padStart(2, '0');
    return `${p2(d.getDate())}/${p2(d.getMonth() + 1)} à ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  })();
  const serverSyncFailed = !!serverSync && !serverSync.ok && serverSync.reason !== 'offline';

  const exportSuffix = range.from && range.to && range.from !== range.to
    ? `${range.from}_${range.to}`
    : range.from ?? range.to ?? 'toutes-dates';

  // A period older than the days kept on the device is pulled from the server once
  useEffect(() => {
    const since = range.from;
    if (!since || since >= shiftDays(todayStr, -LOCAL_HISTORY_DAYS)) return;
    if (pulledSinceRef.current && since >= pulledSinceRef.current) return;
    if (!isOnline()) return;
    let cancelled = false;
    setPeriodLoading(true);
    syncDepartsAndTicketsFromServer(session?.station_id, since, session?.counter_id)
      .then(res => {
        // Pulled again at the next change of period if the reading failed
        if (res.ok) pulledSinceRef.current = since;
        if (!cancelled) return loadDeparts();
      })
      .finally(() => { if (!cancelled) setPeriodLoading(false); });
    return () => { cancelled = true; };
  }, [range.from, todayStr, session?.station_id, session?.counter_id, loadDeparts]);

  const filterBaseDeparts = useMemo(() => {
    const list = departs.filter(d =>
      ((!range.from || d.departure_date >= range.from) &&
       (!range.to || d.departure_date <= range.to)) ||
      // « Aujourd'hui » after midnight: a late departure of yesterday still on sale (27/11/2026)
      (period === 'today' && !d.cloture && d.departure_date < todayStr && !isDepartSaleOver(d)),
    );
    return list.filter(d => !d.cancelled);
  }, [departs, range.from, range.to, period, todayStr]);

  // Line names compared without the extra spaces: « Adjame - Sikensi » and « Adjame - Sikensi␣ »
  // (a departure saved before the line names were cleaned, 26/11/2026) are one line in the filter
  const routeOptions = useMemo(() => {
    return Array.from(new Set(filterBaseDeparts.map(d => lineKey(d.route_name)).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }, [filterBaseDeparts]);

  const departureOptions = useMemo(() => {
    return filterBaseDeparts
      .filter(d => !routeFilter || lineKey(d.route_name) === routeFilter)
      .sort((a, b) => (a.route_number ?? a.departure_number ?? 0) - (b.route_number ?? b.departure_number ?? 0));
  }, [filterBaseDeparts, routeFilter]);

  const reopenedDeparts = useMemo(
    () => departs.filter(d => d.reopened_at && !d.cloture && !d.cancelled),
    [departs],
  );

  // Tickets to reprint (seat or departure changed, or the admin's authorization), per departure:
  // only this station's tickets, the ones its guichet hands to the passenger. A badge in the list
  // leads to the sale screen, where they are reprinted.
  const [reprintCounts, setReprintCounts] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isOnline() || departs.length === 0) { setReprintCounts(new Map()); return; }
      const auths = await fetchPendingReprintsForSchedules(departs.filter(d => !d.cancelled).map(d => d.id));
      const counts = new Map<string, number>();
      for (const a of auths) {
        const d = departs.find(x => x.id === a.schedule_id);
        if (!d) continue;
        const own = allTickets.filter(t => t.depart_id === d.id && t.status !== 'cancelled');
        const scoped = session?.station_id && d.seat_allocations && d.seat_allocations.length > 0
          ? ticketsOfStation(own, d, session.station_id) : own;
        if (scoped.some(t => t.id === a.reservation_id || String(t.seat_number) === a.seat_label)) {
          counts.set(d.id, (counts.get(d.id) ?? 0) + 1);
        }
      }
      if (!cancelled) setReprintCounts(counts);
    })();
    return () => { cancelled = true; };
  }, [departs, allTickets, session?.station_id]);

  const visibleDeparts = useMemo(() => {
    let list = filterBaseDeparts.filter(d =>
      (!routeFilter || lineKey(d.route_name) === routeFilter) &&
      (!departureFilter || d.id === departureFilter),
    );
    list = [...list].sort((a, b) => {
      let cmp = 0;
      const av = getSortValue(a, sortKey); const bv = getSortValue(b, sortKey);
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else if (typeof av === 'boolean' && typeof bv === 'boolean') cmp = av === bv ? 0 : av ? 1 : -1;
      else cmp = String(av ?? '').localeCompare(String(bv ?? ''));
      // Same value (e.g. several departures at 00:00): the last one created comes first
      if (cmp === 0) cmp = String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [filterBaseDeparts, routeFilter, departureFilter, sortKey, sortDir]);

  const pagination = usePagination(
    visibleDeparts,
    'sbta_guichet_departs_page_size',
    `${period}|${range.from}|${range.to}|${routeFilter}|${departureFilter}|${sortKey}|${sortDir}`,
  );
  const pageDeparts = pagination.pageItems;

  const totals = useMemo(() => {
    return visibleDeparts.reduce((acc, d) => ({
      seats_total: acc.seats_total + d.seats_allocated,
      seats_sold: acc.seats_sold + d.seats_sold_station,
      seats_libres: acc.seats_libres + d.seats_libres,
      mt_ticket: acc.mt_ticket + d.mt_ticket,
      mt_bagage: acc.mt_bagage + d.mt_bagage,
      tot_depense: acc.tot_depense + d.tot_depense,
      solde: acc.solde + d.solde_calc,
      caisse: acc.caisse + d.caisse,
    }), { seats_total: 0, seats_sold: 0, seats_libres: 0, mt_ticket: 0, mt_bagage: 0, tot_depense: 0, solde: 0, caisse: 0 });
  }, [visibleDeparts]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const selectedRow = visibleDeparts.find(d => d.id === selectedId) ?? null;

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  // The header box selects the departures of the page shown; selections on other pages are kept
  const allSelected = pageDeparts.length > 0 && pageDeparts.every(d => selectedIds.has(d.id));
  const toggleSelectAll = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      for (const d of pageDeparts) {
        if (allSelected) next.delete(d.id); else next.add(d.id);
      }
      return next;
    });
  };

  const printGroupedBordereau = async () => {
    const targets = visibleDeparts.filter(d => selectedIds.has(d.id));
    if (targets.length === 0) return;
    setActionLoading(true);
    try {
      const [gares] = await Promise.all([getGares()]);
      const stationCode = (gares.find(g => g.id === session?.station_id)?.agency_code) ?? '';
      const rows = await Promise.all(targets.map(async d => {
        const [dTickets, dBagages, dDepenses] = await Promise.all([
          getByDeparts<TicketRecord>('tickets', [d.id]),
          getBagagesForDepart(d.id),
          getDepensesForDepart(d.id),
        ]);
        const hasAllocations = !!(d.seat_allocations && d.seat_allocations.length > 0);
        let active = dTickets.filter(t => t.depart_id === d.id && t.status !== 'cancelled');
        if (hasAllocations && session?.station_id) {
          active = ticketsOfStation(active, d, session.station_id);
        }
        const stationTicketIds = new Set(active.map(t => t.id));
        const scopedBagages = hasAllocations && session?.station_id
          ? dBagages.filter(b => {
              if (b.description === '__deleted__') return false;
              if (b.payment_status === 'en_attente') return false;
              if (b.ticket_id && stationTicketIds.has(b.ticket_id)) return true;
              if (b.ticket_id) return false;
              return session.station_id === d.station_id;
            })
          : dBagages.filter(b => b.description !== '__deleted__' && b.payment_status !== 'en_attente');
        const totalTicket = active.reduce((s, t) => s + t.price, 0);
        const totalBaggage = scopedBagages.reduce((s, b) => s + b.price, 0);
        const valid = hasAllocations && session?.station_id
          ? dDepenses.filter(x => x.description !== '__deleted__' && x.station_id === session.station_id)
          : dDepenses.filter(x => x.description !== '__deleted__');
        const totalCarburant = valid.filter(x => x.type.toLowerCase().includes('carburant')).reduce((s, x) => s + x.amount, 0);
        const totalRations = valid.filter(x => x.type.toLowerCase().includes('ratio') || x.type.toLowerCase().includes('frais de route') || x.type.toLowerCase().includes('frais route')).reduce((s, x) => s + x.amount, 0);
        const totalPeages = valid.filter(x => x.type.toLowerCase().includes('péage') || x.type.toLowerCase().includes('peage')).reduce((s, x) => s + x.amount, 0);
        const totalAutres = valid.filter(x => {
          const t = x.type.toLowerCase();
          return !t.includes('ratio') && !t.includes('frais de route') && !t.includes('frais route') && !t.includes('carburant') && !t.includes('péage') && !t.includes('peage');
        }).reduce((s, x) => s + x.amount, 0);
        const totalCharges = totalCarburant + totalRations + totalPeages + totalAutres;
        const pad = (n: number) => String(n).padStart(2, '0');
        let depDate = d.departure_date;
        try {
          const dt = new Date(d.departure_datetime);
          if (!isNaN(dt.getTime())) depDate = `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()}`;
        } catch { /* keep default */ }
        return {
          station_name: d.station_name || session?.station_name || '',
          route_name: d.route_name ?? '',
          departure_date: depDate,
          registration_number: d.bus_plate ?? '',
          departure_number: d.route_number ?? d.departure_number,
          seats_sold: active.length,
          total_ticket: totalTicket,
          total_rations: totalRations,
          total_carburant: totalCarburant,
          total_peages: totalPeages,
          total_autres: totalAutres,
          total_charges: totalCharges,
          solde_ticket: totalTicket - totalCharges,
          total_baggage: totalBaggage,
        };
      }));
      const totals = rows.reduce((acc, r) => ({
        departures: acc.departures + 1,
        seats_sold: acc.seats_sold + r.seats_sold,
        total_ticket: acc.total_ticket + r.total_ticket,
        total_rations: acc.total_rations + r.total_rations,
        total_carburant: acc.total_carburant + r.total_carburant,
        total_peages: acc.total_peages + r.total_peages,
        total_autres: acc.total_autres + r.total_autres,
        total_charges: acc.total_charges + r.total_charges,
        solde_ticket: acc.solde_ticket + r.solde_ticket,
        total_baggage: acc.total_baggage + r.total_baggage,
      }), { departures: 0, seats_sold: 0, total_ticket: 0, total_rations: 0, total_carburant: 0, total_peages: 0, total_autres: 0, total_charges: 0, solde_ticket: 0, total_baggage: 0 });
      const now = trustedNow();
      const pad = (n: number) => String(n).padStart(2, '0');
      const data: BordereauRecettesData = {
        station_name: session?.station_name ?? '',
        station_code: stationCode,
        // LIGNE: the line(s) of the selected departures
        route_name: [...new Set(rows.map(r => r.route_name.trim()).filter(Boolean))].join(' / '),
        date_from: rows[0]?.departure_date ?? '',
        date_to: rows[rows.length - 1]?.departure_date ?? '',
        print_date: `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`,
        print_time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
        rows,
        totals,
      };
      printRecettesBordereau({ data, phoneLine: phoneLine || cachedTicketPhoneLine(session?.counter_id) || undefined });
    } catch {
      // non-critical
    } finally {
      setActionLoading(false);
    }
  };

  const handleAction = async (action: string, depart: DepartRow) => {
    setActionLoading(true);
    try {
      if (action === 'vente') {
        navigate(`/guichet/depart/${depart.id}/vente`);
        return;
      }
      if (action === 'annuler') {
        setCancelError('');
        setShowCancelConfirm(depart);
        setActionLoading(false);
        return;
      }
      if (action === 'fermer') {
        // Same closing as the Clôture screen: a ramassage ligne is announced to the destination
        // station (it was not when the departure was closed from here)
        await cloturerDepart(depart.id, session?.full_name);
      }
      if (action === 'modifier') {
        const [vehs, chfs] = await Promise.all([getVehicules(), getChauffeurs()]);
        setEditVehicules(vehs);
        setEditChauffeurs(chfs);
        const sold = allTickets.filter(
          t => t.depart_id === depart.id && t.status !== 'cancelled'
        );
        setEditSoldTickets(sold);
        const next = await findNextDepartForRoute(
          depart.route_id, depart.id, session?.station_id, session?.counter_id
        );
        setEditNextDepart(next);
        // Every ticket of the departure, not only this device's ones: a change of bus must see the
        // seats sold by the other counters and the partner station
        let serverTickets: ServerSeatTicket[] | null = null;
        if (isOnline()) {
          try {
            const { data, error } = await supabase
              .from('reservations')
              .select('id, seat_numbers, booking_reference, passenger_name, status')
              .eq('schedule_id', depart.id);
            if (!error) {
              serverTickets = ((data ?? []) as { id: string; seat_numbers: string[] | null; booking_reference: string | null; passenger_name: string | null; status: string | null }[])
                .filter(r => !['annulee', 'annule', 'cancelled', 'remboursee'].includes(String(r.status ?? '')))
                .map(r => ({
                  id: r.id,
                  seats: (r.seat_numbers ?? []).map(x => parseInt(String(x).trim(), 10)).filter(n => Number.isFinite(n)),
                  ticket: r.booking_reference,
                  passenger: r.passenger_name,
                }));
            }
          } catch { /* the device's tickets only */ }
        }
        setEditServerTickets(serverTickets);
        setShowEditModal(true);
        return;
      }
      if (action === 'imprimer') {
        const summaries = visibleDeparts.map(d => departToSummary(d, allTickets, scopeStationFor(d, session?.station_id, session?.counter_id)));
        printDeparturesList(summaries, session?.station_name);
        return;
      }
      if (action === 'bordereau') {
        // A departure of the counter's former station: printed with that station's name
        const former = isFormerStationDepart(depart, session?.station_id, session?.counter_id);
        await printBordereauForDepart(depart, scopeStationFor(depart, session?.station_id, session?.counter_id),
          former ? (depart.station_name || session?.station_name) : session?.station_name,
          phoneLine || cachedTicketPhoneLine(session?.counter_id));
        return;
      }
      await loadDeparts();
    } catch {
      // non-critical
    } finally {
      setActionLoading(false);
    }
  };

  const confirmCancel = async () => {
    if (!showCancelConfirm) return;
    setActionLoading(true);
    try {
      const { count } = await supabase
        .from('reservations')
        .select('id', { count: 'exact', head: true })
        .eq('schedule_id', showCancelConfirm.id)
        .neq('status', 'annulee');
      if (count && count > 0) {
        setCancelError(`Impossible d'annuler : ${count} ticket(s) déjà vendu(s) sur ce départ. Utilisez « Demander modif./supp. ».`);
        setShowCancelConfirm(null);
        setActionLoading(false);
        return;
      }
      await updateDepart(showCancelConfirm.id, { cancelled: true, status: 'cancelled' });
      await renumberDepartsAfterCancellation(showCancelConfirm);
      await loadDeparts();
    } catch {
      // non-critical
    } finally {
      setActionLoading(false);
      setShowCancelConfirm(null);
    }
  };

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ChevronUp className="w-3 h-3 opacity-30" />;
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  const th = 'px-2 py-2 text-xs font-bold whitespace-nowrap cursor-pointer select-none';
  const td = 'px-2 py-2.5 text-sm whitespace-nowrap';
  // Keep colSpan in totals row in sync with visible column count (15 after removing Nom Car)
  const totalsColSpan = 6;

  if (loading) {
    return (
      <POSLayout showBack stationName={session?.station_name} activeRoute="Départs">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--primary)' }} />
        </div>
      </POSLayout>
    );
  }

  return (
    <POSLayout showBack stationName={session?.station_name} activeRoute="Départs">
      {/* Action bar */}
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => navigate('/guichet/depart/nouveau')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            <Plus className="w-4 h-4" /> Nouveau
          </button>
          <div className="relative">
            <button
              onClick={() => setShowExportsMenu(v => !v)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold border-2"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            >
              <FileText className="w-4 h-4" /> États & exports
              <ChevronDown className="w-3 h-3" />
            </button>
            {showExportsMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowExportsMenu(false)} />
                <div className="absolute z-50 mt-1 left-0 min-w-[200px] rounded-lg shadow-xl border-2 py-1" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
                  <button
                    onClick={() => { setShowExportsMenu(false); printDeparturesList(visibleDeparts.map(d => departToSummary(d, allTickets, scopeStationFor(d, session?.station_id, session?.counter_id))), session?.station_name); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-left transition-colors"
                    style={{ color: 'var(--text-primary)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--surface-raised)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <Copy className="w-4 h-4" /> Imprimer liste
                  </button>
                  <button
                    onClick={() => { setShowExportsMenu(false); exportToPDF(visibleDeparts.map(d => departToSummary(d, allTickets, scopeStationFor(d, session?.station_id, session?.counter_id))), `recap-departs-${exportSuffix}.pdf`, `Récapitulatif des départs — ${periodText}`); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-left transition-colors"
                    style={{ color: 'var(--text-primary)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--surface-raised)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <FileText className="w-4 h-4" /> Export PDF
                  </button>
                  <button
                    onClick={() => { setShowExportsMenu(false); exportToExcel(visibleDeparts.map(d => departToSummary(d, allTickets, scopeStationFor(d, session?.station_id, session?.counter_id))), `recap-departs-${exportSuffix}.xlsx`); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-left transition-colors"
                    style={{ color: 'var(--text-primary)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--surface-raised)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <FileSpreadsheet className="w-4 h-4" /> Export Excel
                  </button>
                </div>
              </>
            )}
          </div>
          {/* Bordereau of the ticked departures: a button of its own, next to « États & exports » */}
          <button
            onClick={() => printGroupedBordereau()}
            disabled={selectedIds.size === 0 || actionLoading}
            title={selectedIds.size === 0 ? 'Cochez les départs à inclure dans le bordereau' : undefined}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold border-2 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}
          >
            {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ListChecks className="w-4 h-4" />} Bordereau des recettes{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
          </button>
          {/* Closing several departures at once: the ticked ones of this station, not closed yet */}
          {(() => {
            const closable = visibleDeparts.filter(d => selectedIds.has(d.id) && d.station_id === session?.station_id && !d.cloture && !d.cancelled);
            if (selectedIds.size < 2 || closable.length === 0) return null;
            return (
              <button
                onClick={async () => {
                  if (!window.confirm(`Clôturer ${closable.length} départ${closable.length > 1 ? 's' : ''} : #${closable.map(d => d.route_number).join(', #')} ?\n\nPlus aucune vente ne sera possible sur ${closable.length > 1 ? 'ces départs' : 'ce départ'}.`)) return;
                  setActionLoading(true);
                  try {
                    for (const d of closable) await cloturerDepart(d.id, session?.full_name);
                    setSelectedIds(new Set());
                    await loadDeparts();
                  } finally {
                    setActionLoading(false);
                  }
                }}
                disabled={actionLoading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-60"
                style={{ backgroundColor: 'var(--text-secondary)' }}
                title="Clôturer les départs cochés (plus de vente possible)"
              >
                <Lock className="w-4 h-4" /> Clôturer la sélection ({closable.length})
              </button>
            );
          })()}
          <button
            onClick={() => void reloadFromServer()}
            disabled={reloading || !isOnline()}
            title={!isOnline() ? 'Disponible avec Internet' : 'Relit sur le serveur les ventes, bagages et dépenses de la période affichée, y compris celles des autres postes'}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold border-2 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            {reloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Recharger depuis le serveur
          </button>
          {serverSync?.ok && lastFullSync && (
            <span className="self-center text-xs font-bold" style={{ color: 'var(--success, #047857)' }}>À jour ({lastFullSync})</span>
          )}
          {selectedRow && (
            <>
              {/* A departure of another station shared with this one: only its main station changes,
                  cancels or closes it (it would be changed, cancelled or closed for both stations) */}
              {selectedRow.station_id === session?.station_id && (
              <button onClick={() => handleAction('modifier', selectedRow)} disabled={selectedRow.cloture} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold border-2 disabled:opacity-50 disabled:cursor-not-allowed" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                <Pencil className="w-4 h-4" /> Modifier
              </button>
              )}
              <button onClick={() => handleAction('imprimer', selectedRow)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold border-2" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                <Printer className="w-4 h-4" /> Imprimer sélection
              </button>
              <button onClick={() => handleAction('bordereau', selectedRow)} disabled={actionLoading} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-60" style={{ backgroundColor: 'var(--primary)' }}>
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScrollText className="w-4 h-4" />} Bordereau départ
              </button>
              <button onClick={() => handleAction('vente', selectedRow)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white" style={{ backgroundColor: 'var(--info)' }}>
                <Ticket className="w-4 h-4" /> Vente tickets
              </button>
              {/* Not for a closed departure */}
              {!selectedRow.cloture && (
                <ChangeRequestButton
                  operationType="reservation"
                  operationId={selectedRow.id}
                  operationTable="schedules"
                  operationReference={`Départ #${selectedRow.route_number} — ${selectedRow.route_name ?? ''}`}
                  operationSnapshot={selectedRow as unknown as Record<string, unknown>}
                  stationId={session?.station_id}
                  stationName={session?.station_name}
                  label="Demander modif./supp."
                />
              )}
              {!selectedRow.cancelled && !selectedRow.cloture && (
                <button
                  onClick={() => setShowExpensesModal(true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white"
                  style={{ backgroundColor: 'var(--primary)' }}
                >
                  <Receipt className="w-4 h-4" /> Par dépenses
                </button>
              )}
              {selectedRow.station_id === session?.station_id && !selectedRow.cancelled && !selectedRow.cloture && (() => {
                const soldCount = allTickets.filter(t => t.depart_id === selectedRow.id && t.status !== 'cancelled').length;
                return soldCount === 0 ? (
                  <button onClick={() => handleAction('annuler', selectedRow)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white" style={{ backgroundColor: 'var(--danger)' }}>
                    <XCircle className="w-4 h-4" /> Annuler
                  </button>
                ) : null;
              })()}
              {selectedRow.station_id === session?.station_id && !selectedRow.cloture && !selectedRow.cancelled && (
                <button onClick={() => handleAction('fermer', selectedRow)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white" style={{ backgroundColor: 'var(--text-secondary)' }}>
                  <Lock className="w-4 h-4" /> Clôturer
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* The server could not be read in full: the figures are those of the device only */}
      {serverSyncFailed && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3" style={{ borderColor: '#FCA5A5', backgroundColor: '#FEF2F2' }}>
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: '#B91C1C' }} />
            <div>
              <p className="text-sm font-bold" style={{ color: '#991B1B' }}>
                Les chiffres de cet écran n'ont pas pu être mis à jour depuis le serveur
              </p>
              <p className="mt-0.5 text-xs" style={{ color: '#991B1B' }}>
                {lastFullSync ? `Dernière mise à jour complète : ${lastFullSync}. ` : 'Aucune mise à jour complète sur ce poste. '}
                Les ventes faites sur d'autres postes peuvent manquer : ne vous fiez pas aux montants ni aux bordereaux de cet écran avant la mise à jour.
              </p>
            </div>
          </div>
          <button
            onClick={() => void reloadFromServer()}
            disabled={reloading}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold text-white disabled:opacity-60"
            style={{ backgroundColor: '#B91C1C' }}
          >
            {reloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Réessayer
          </button>
        </div>
      )}

      {/* Departures re-opened by the admin: shown whatever the period, to be corrected then closed */}
      {reopenedDeparts.length > 0 && (
        <div className="mb-4 rounded-xl border p-3" style={{ borderColor: '#FDBA74', backgroundColor: '#FFF7ED' }}>
          <p className="text-sm font-bold" style={{ color: '#9A3412' }}>
            {reopenedDeparts.length} départ{reopenedDeparts.length > 1 ? 's' : ''} rouvert{reopenedDeparts.length > 1 ? 's' : ''} par l'administration
          </p>
          <p className="mt-0.5 text-xs" style={{ color: '#9A3412' }}>
            Vous pouvez corriger ses ventes, bagages et dépenses, puis le clôturer à nouveau. Les modifications sont visibles par l'administration.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {reopenedDeparts.map(d => (
              <button
                key={d.id}
                type="button"
                onClick={() => { setPeriod('custom'); setCustomFrom(d.departure_date); setCustomTo(d.departure_date); setDepartureFilter(''); }}
                className="rounded-lg border px-3 py-1.5 text-xs font-bold"
                style={{ borderColor: '#FDBA74', backgroundColor: 'var(--surface)', color: '#9A3412' }}
              >
                #{d.departure_number ?? d.route_number ?? '—'} · {d.route_name ?? 'Départ'} · {d.departure_date.split('-').reverse().join('/')} {d.departure_time}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
        <div className="min-w-[190px]">
          <label className="mb-1 flex items-center gap-1 text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
            <CalendarRange className="h-3.5 w-3.5" /> Période
          </label>
          <select
            value={period}
            onChange={e => {
              const next = e.target.value as Period;
              // The range starts from the period shown, so it only needs adjusting
              if (next === 'custom' && !customFrom && !customTo) {
                setCustomFrom(range.from ?? todayStr);
                setCustomTo(range.to ?? todayStr);
              }
              setPeriod(next);
              setDepartureFilter('');
            }}
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
          >
            {(Object.keys(PERIOD_LABELS) as Period[]).map(p => <option key={p} value={p}>{PERIOD_LABELS[p]}</option>)}
          </select>
        </div>
        {period === 'custom' && (
          <>
            <div className="min-w-[150px]">
              <label className="mb-1 block text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Du</label>
              <input
                type="date"
                value={customFrom}
                max={customTo || todayStr}
                onChange={e => { setCustomFrom(e.target.value); setDepartureFilter(''); }}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
              />
            </div>
            <div className="min-w-[150px]">
              <label className="mb-1 block text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Au</label>
              <input
                type="date"
                value={customTo}
                min={customFrom || undefined}
                onChange={e => { setCustomTo(e.target.value); setDepartureFilter(''); }}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
              />
            </div>
          </>
        )}
        {periodLoading && (
          <div className="flex items-center gap-1.5 py-2 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement de la période…
          </div>
        )}
        <div className="min-w-[220px] flex-1">
          <label className="mb-1 block text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Filtre par ligne</label>
          <select
            value={routeFilter}
            onChange={e => { setRouteFilter(e.target.value); setDepartureFilter(''); }}
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
          >
            <option value="">Tous</option>
            {routeOptions.map(route => <option key={route} value={route}>{route}</option>)}
          </select>
        </div>
        <div className="min-w-[260px] flex-1">
          <label className="mb-1 block text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Filtre par départ</label>
          <select
            value={departureFilter}
            onChange={e => setDepartureFilter(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
          >
            <option value="">Tous</option>
            {departureOptions.map(depart => (
              <option key={depart.id} value={depart.id}>
                Départ #{depart.route_number ?? depart.departure_number} — {depart.route_name ?? 'Ligne'} — {depart.departure_date} {depart.departure_time}
              </option>
            ))}
          </select>
        </div>
        {(routeFilter || departureFilter || period !== 'today') && (
          <button
            type="button"
            onClick={() => { setRouteFilter(''); setDepartureFilter(''); setPeriod('today'); setCustomFrom(''); setCustomTo(''); }}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-bold"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            <X className="h-4 w-4" /> Réinitialiser
          </button>
        )}
      </div>

      {/* Cancel error banner */}
      {cancelError && (
        <div className="mb-4 rounded-xl px-3 py-2.5 flex items-start gap-2 text-sm font-bold" style={{ backgroundColor: 'var(--danger-light)', color: 'var(--danger)' }}>
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /><span>{cancelError}</span>
        </div>
      )}

      {/* Pending transfer notification */}
      {pendingTransfers > 0 && (
        <div className="mb-4 rounded-xl p-4 flex items-center gap-3" style={{
          backgroundColor: 'var(--warning-light, #FEF3C7)',
          border: '1px solid var(--warning, #D97706)',
        }}>
          <Clock className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--warning, #D97706)' }} />
          <div className="flex-1">
            <p className="text-sm font-bold" style={{ color: 'var(--warning, #D97706)' }}>
              {pendingTransfers} transfert{pendingTransfers > 1 ? 's' : ''} de ticket{pendingTransfers > 1 ? 's' : ''} en attente
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              Créez le prochain départ pour le trajet correspondant afin de transférer automatiquement les tickets en surplus.
            </p>
          </div>
          <button
            onClick={() => navigate('/guichet/depart/nouveau')}
            className="px-3 py-2 rounded-lg text-sm font-bold text-white whitespace-nowrap"
            style={{ backgroundColor: 'var(--warning, #D97706)' }}
          >
            Créer un départ
          </button>
        </div>
      )}

      {departs.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Aucun départ. Cliquez sur « Nouveau » pour en créer un.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
            <table className="w-full" style={{ borderCollapse: 'collapse' }}>
              <thead style={{ backgroundColor: 'var(--surface-raised)' }}>
                <tr style={{ color: 'var(--text-secondary)' }}>
                  <th className={th + ' text-center'} style={{ width: 32 }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 cursor-pointer"
                    />
                  </th>
                  <th className={th} onClick={() => handleSort('route_number')}>N°Départ/Ligne {sortIcon('route_number')}</th>
                  <th className={th} onClick={() => handleSort('departure_datetime')}>Date {sortIcon('departure_datetime')}</th>
                  <th className={th} onClick={() => handleSort('route_name')}>Ligne {sortIcon('route_name')}</th>
                  <th className={th} onClick={() => handleSort('bus_plate')}>Matricule {sortIcon('bus_plate')}</th>
                  <th className={th} onClick={() => handleSort('driver_name')}>Chauffeur {sortIcon('driver_name')}</th>
                  <th className={th + ' text-right'} onClick={() => handleSort('seats_total')}>Sièges attribués {sortIcon('seats_total')}</th>
                  <th className={th + ' text-right'}>Plage sièges</th>
                  <th className={th + ' text-right'} onClick={() => handleSort('seats_sold')}>Siège vendu {sortIcon('seats_sold')}</th>
                  <th className={th + ' text-right'} onClick={() => handleSort('seats_libres')}>Siège libre {sortIcon('seats_libres')}</th>
                  <th className={th} onClick={() => handleSort('cloture')}>Clôture {sortIcon('cloture')}</th>
                  <th className={th + ' text-right'} onClick={() => handleSort('mt_ticket')}>MT Ticket {sortIcon('mt_ticket')}</th>
                  <th className={th + ' text-right'} onClick={() => handleSort('mt_bagage')}>MT Bagage {sortIcon('mt_bagage')}</th>
                  <th className={th + ' text-right'} onClick={() => handleSort('tot_depense')}>Tot Dépense {sortIcon('tot_depense')}</th>
                  <th className={th + ' text-right'} onClick={() => handleSort('solde')}>Solde {sortIcon('solde')}</th>
                  <th className={th + ' text-right'} onClick={() => handleSort('caisse')}>Caisse {sortIcon('caisse')}</th>
                </tr>
              </thead>
              <tbody>
                {pageDeparts.map(d => {
                  const isSelected = d.id === selectedId;
                  return (
                    <tr
                      key={d.id}
                      onClick={() => setSelectedId(isSelected ? null : d.id)}
                      className="cursor-pointer transition-colors"
                      style={{
                        borderTop: '1px solid var(--border)',
                        backgroundColor: selectedIds.has(d.id) ? 'var(--primary-light)' : isSelected ? 'var(--primary-light)' : d.cancelled ? 'var(--danger-light)' : d.is_ramassage ? '#E0F2FE' : d.status === 'panne' ? 'var(--warning-light)' : 'transparent',
                        opacity: d.cancelled ? 0.6 : 1,
                      }}
                    >
                      <td className={td + ' text-center'} onClick={(e) => { e.stopPropagation(); toggleSelect(d.id); }}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(d.id)}
                          onChange={() => toggleSelect(d.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-4 h-4 cursor-pointer"
                        />
                      </td>
                      <td className={td} style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                        <div className="flex items-center gap-1.5">
                          #{d.route_number}
                          {(reprintCounts.get(d.id) ?? 0) > 0 && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); navigate(`/guichet/depart/${d.id}/vente`); }}
                              className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full font-bold whitespace-nowrap"
                              style={{ backgroundColor: 'var(--info)', color: 'white' }}
                              title="Tickets à réimprimer (siège ou départ modifié) : ouvrir la vente pour les réimprimer"
                            >
                              <Printer className="w-3 h-3" /> Réimprimer {reprintCounts.get(d.id)}
                            </button>
                          )}
                          {d.station_id !== session?.station_id && d.seat_allocations?.some(a => a.station_id === session?.station_id) && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full font-bold" style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
                              Gare secondaire
                            </span>
                          )}
                          {isFormerStationDepart(d, session?.station_id, session?.counter_id) && (
                            <span
                              className="text-xs px-1.5 py-0.5 rounded-full font-bold whitespace-nowrap"
                              style={{ backgroundColor: 'var(--warning-light)', color: 'var(--warning, #B45309)' }}
                              title="Départ fait par ce guichet dans son ancienne gare : consultation et impression seulement"
                            >
                              Ancienne gare{d.station_name ? ` : ${d.station_name}` : ''}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className={td} style={{ color: 'var(--text-secondary)' }}>{d.departure_date} {d.departure_time}</td>
                      <td className={td} style={{ color: 'var(--text-secondary)' }}>{d.route_name}</td>
                      <td className={td} style={{ color: 'var(--text-secondary)' }}>{d.bus_plate}</td>
                      <td className={td} style={{ color: 'var(--text-secondary)' }}>{d.driver_name}</td>
                      <td className={td + ' text-right'} style={{ fontWeight: 600 }}>{d.seats_allocated}</td>
                      <td className={td + ' text-right'} style={{ color: 'var(--text-muted)' }}>
                        {(() => {
                          if (d.seat_allocations && d.seat_allocations.length > 0 && session?.station_id) {
                            // The seats held now (after the transfers between stations)
                            const held = stationSeatsNow(d, session.station_id);
                            return held.length > 0 ? seatRangesLabel(held).replace(/ à /g, '–') : '—';
                          }
                          return `${d.seats_from}–${d.seats_total}`;
                        })()}
                      </td>
                      <td className={td + ' text-right'} style={{ color: 'var(--info)', fontWeight: 600 }}>{d.seats_sold_station}</td>
                      <td className={td + ' text-right'} style={{ color: 'var(--success)', fontWeight: 700 }}>{d.seats_libres}</td>
                      <td className={td}>
                        {d.cancelled ? <span style={{ color: 'var(--danger)' }}>Annulé</span>
                          : d.cloture ? <span style={{ color: 'var(--danger)' }}>Clôturé</span>
                          : d.reopened_at ? <span style={{ color: '#EA580C', fontWeight: 600 }} title="Décloturé par l'administration : vous pouvez le modifier puis le clôturer à nouveau">Rouvert (admin)</span>
                          : d.is_ramassage ? <span style={{ color: '#0EA5E9' }}>Ramassage</span>
                          : d.status === 'panne' ? <span style={{ color: 'var(--warning)' }}>Panne</span>
                          : d.status === 'convoi' ? <span style={{ color: 'var(--info)' }}>Convoi</span>
                          : d.status === 'retard' ? <span style={{ color: 'var(--warning)' }}>Retard</span>
                          : d.confirmed ? <span style={{ color: 'var(--success)' }}>Confirmé</span>
                          : <span style={{ color: 'var(--text-muted)' }}>En attente</span>}
                      </td>
                      <td className={td + ' text-right'}>{formatCurrency(d.mt_ticket)}</td>
                      <td className={td + ' text-right'}>{formatCurrency(d.mt_bagage)}</td>
                      <td className={td + ' text-right'}>{formatCurrency(d.tot_depense)}</td>
                      <td className={td + ' text-right'} style={{ fontWeight: 700, color: d.solde_calc >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatCurrency(d.solde_calc)}</td>
                      <td className={td + ' text-right'}>{formatCurrency(d.caisse)}</td>
                    </tr>
                  );
                })}
              </tbody>
              {/* Totals row */}
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border-strong)', backgroundColor: 'var(--surface-raised)' }}>
                  <td className={td} style={{ fontWeight: 800, color: 'var(--text-primary)' }} colSpan={totalsColSpan}>Somme</td>
                  <td className={td + ' text-right'} style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{totals.seats_total}</td>
                  <td className={td}></td>
                  <td className={td + ' text-right'} style={{ fontWeight: 800, color: 'var(--info)' }}>{totals.seats_sold}</td>
                  <td className={td + ' text-right'} style={{ fontWeight: 800, color: 'var(--success)' }}>{totals.seats_libres}</td>
                  <td className={td}></td>
                  <td className={td + ' text-right'} style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{formatCurrency(totals.mt_ticket)}</td>
                  <td className={td + ' text-right'} style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{formatCurrency(totals.mt_bagage)}</td>
                  <td className={td + ' text-right'} style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{formatCurrency(totals.tot_depense)}</td>
                  <td className={td + ' text-right'} style={{ fontWeight: 800, color: totals.solde >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatCurrency(totals.solde)}</td>
                  <td className={td + ' text-right'} style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{formatCurrency(totals.caisse)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <Pagination
            page={pagination.page}
            pageCount={pagination.pageCount}
            pageSize={pagination.pageSize}
            total={pagination.total}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
            itemLabel="départs"
          />

          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            {visibleDeparts.length} départ(s) ({periodText}) · La ligne Somme totalise tous les départs de la période, toutes pages comprises · Cliquez sur une ligne pour la sélectionner et voir les actions
          </p>
        </>
      )}

      {/* Expenses modal */}
      {showExpensesModal && selectedRow && (
        <DepartExpensesModal
          depart={selectedRow}
          stationId={session?.station_id}
          counterId={session?.counter_id}
          onSaved={loadDeparts}
          onClose={() => { setShowExpensesModal(false); loadDeparts(); }}
        />
      )}

      {/* Edit modal */}
      {showEditModal && selectedRow && (
        <EditDepartModal
          depart={selectedRow}
          vehicules={editVehicules}
          chauffeurs={editChauffeurs}
          soldTickets={editSoldTickets}
          nextDepart={editNextDepart}
          serverTickets={editServerTickets}
          online={isOnline()}
          onReseat={async (busId) => {
            const { data, error } = await supabase.rpc('reseat_after_bus_change', { p_schedule_id: selectedRow.id, p_bus_id: busId });
            if (error) {
              const msg = String(error.message ?? '');
              throw new Error(/reseat_after_bus_change|PGRST202/i.test(msg) || error.code === 'PGRST202'
                ? 'Car modifié, mais le serveur n\'est pas encore à jour pour replacer les passagers (SQL à exécuter).'
                : `Car modifié, mais les passagers n'ont pas été replacés : ${msg}`);
            }
            const res = (data ?? {}) as ReseatResult & { seat_allocations?: DepartRecord['seat_allocations'] };
            const result: ReseatResult = { moved: res.moved ?? [], unplaced: res.unplaced ?? [] };
            // The device follows at once (the next sync would bring the same)
            if (Array.isArray(res.seat_allocations) && res.seat_allocations.length > 0) {
              await db.departs.update(selectedRow.id, { seat_allocations: res.seat_allocations });
            }
            for (const m of result.moved) {
              const t = await db.tickets.get(m.reservation_id);
              if (t) await db.tickets.put({ ...t, seat_number: m.to, seat_numbers: [String(m.to)] });
            }
            return result;
          }}
          onSave={async (newBusId, newBusPlate, newDriverId, newDriverName, newCapacity) => {
            // Another bus: its capacity and its numbering (« vendu à partir de »). The capacity
            // is the number of seats; the last seat number follows from the first one.
            const newBus = newBusId !== selectedRow.bus_id ? editVehicules.find(v => v.id === newBusId) : undefined;
            const seatsFrom = Math.max(1, newBus?.seats_sold_from ?? selectedRow.seats_from ?? 1);
            await updateDepart(selectedRow.id, {
              bus_id: newBusId,
              bus_plate: newBusPlate,
              driver_id: newDriverId,
              driver_name: newDriverName,
              ...(newBus ? {
                seats_from: seatsFrom,
                seats_total: lastSeatNumber(seatsFrom, newCapacity),
                seats_capacity: newCapacity,
              } : {}),
            });
          }}
          onTransfer={async (surplusTickets, nextDepart) => {
            await transferTicketsToDepart(surplusTickets, nextDepart);
            const sourceSold = editSoldTickets.length - surplusTickets.length;
            const sourceMtTicket = editSoldTickets
              .filter(t => !surplusTickets.some(s => s.id === t.id))
              .reduce((sum, t) => sum + t.price, 0);
            await updateDepart(selectedRow.id, {
              seats_sold: sourceSold,
              mt_ticket: sourceMtTicket,
              solde: sourceMtTicket - selectedRow.tot_depense,
              caisse: sourceMtTicket - selectedRow.tot_depense,
            });
          }}
          onPendingTransfer={async (surplusTickets, newBusId, newBusPlate, newCapacity) => {
            await executeFullTransfer({
              depart: selectedRow,
              surplusTickets,
              nextDepart: null,
              newBusId,
              newBusPlate,
              newCapacity,
              oldCapacity: selectedRow.seats_total,
              transferReason: 'capacity_reduction',
            });
          }}
          onClose={() => { setShowEditModal(false); loadDeparts(); }}
        />
      )}

      {/* Cancel confirmation */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="rounded-2xl shadow-2xl max-w-sm w-full p-6" style={{ backgroundColor: 'var(--surface)' }}>
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Annuler le départ</h3>
              <button onClick={() => setShowCancelConfirm(null)} className="p-1 rounded-lg" style={{ color: 'var(--text-muted)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
              Confirmer l'annulation du départ #{showCancelConfirm.route_number} ({showCancelConfirm.route_name}) ?
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowCancelConfirm(null)} className="flex-1 py-3 rounded-xl font-bold border-2" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                Non
              </button>
              <button onClick={confirmCancel} disabled={actionLoading} className="flex-1 py-3 rounded-xl font-bold text-white disabled:opacity-60" style={{ backgroundColor: 'var(--danger)' }}>
                {actionLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Oui, annuler'}
              </button>
            </div>
          </div>
        </div>
      )}
    </POSLayout>
  );
}
