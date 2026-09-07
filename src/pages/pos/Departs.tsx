import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import POSLayout from '@/components/pos/POSLayout';
import { usePOSSession } from '@/services/pos/POSSessionContext';
import {
  getAllDeparts, updateDepart, type DepartRecord,
  type VehiculeRef, type ChauffeurRef,
  seatsLibres,
  getSeatRangeForStation,
  seatsAllocatedForStation, seatsVendusForStation, seatsLibresForStation,
  getVehicules, getChauffeurs, getGares,
  findNextDepartForRoute, transferTicketsToDepart,
  renumberDepartsAfterCancellation,
  computeStationScopedTotals,
} from '@/services/pos/departService';
import { getAll as getAllTickets, getAll as getAllRecords, syncDepartsAndTicketsFromServer } from '@/services/pos/offlineStore';
import { supabase } from '@/services/supabase';
import { getDepensesForDepart } from '@/services/pos/depenseService';
import { getBagagesForDepart } from '@/services/pos/bagageService';
import type { TicketRecord, BagageRecord, DepenseRecord } from '@/services/pos/db';
import { printBorderauDepart, printBorderauRecettes } from '@/utils/printBordereau';
import type { BordereauDepartData, BordereauDestinationGroup, BordereauRecettesData } from '@/types/counter.types';
import { executeFullTransfer, getPendingTransfersForStation } from '@/services/pos/transferService';
import type { DepartSummary } from '@/services/pos/posReportService';
import {
  departToSummary, exportToExcel, exportToPDF, printDeparturesList,
} from '@/services/pos/posReportService';
import { formatCurrency } from '@/utils/formatCurrency';
import EditDepartModal from '@/components/pos/EditDepartModal';
import ChangeRequestButton from '@/components/shared/ChangeRequestButton';
import {
  Plus, Pencil, Printer, Ticket, CheckCircle, XCircle, Lock,
  ChevronUp, ChevronDown, Eye, Loader2, X, AlertCircle,
  FileText, FileSpreadsheet, Copy, Clock, ScrollText, ListChecks,
} from 'lucide-react';

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
      solde_calc: d.mt_ticket + d.mt_bagage - d.tot_depense,
    };
  }
  return {
    ...d,
    seats_allocated: d.seats_total,
    seats_sold_station: d.seats_sold,
    seats_libres: seatsLibres(d),
    solde_calc: d.mt_ticket + d.mt_bagage - d.tot_depense,
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

async function printBordereauForDepart(depart: DepartRow, stationId?: string): Promise<void> {
  const [tickets, bagages, depenses] = await Promise.all([
    getAllTickets<TicketRecord>('tickets'),
    getBagagesForDepart(depart.id),
    getDepensesForDepart(depart.id),
  ]);

  const hasAllocations = !!(depart.seat_allocations && depart.seat_allocations.length > 0);
  const seatRange = hasAllocations && stationId ? getSeatRangeForStation(depart, stationId) : null;

  let activeTickets = tickets.filter(
    t => t.depart_id === depart.id && t.status !== 'cancelled'
  );
  if (seatRange) {
    activeTickets = activeTickets.filter(
      t => t.seat_number >= seatRange.from && t.seat_number <= seatRange.to,
    );
  }

  const stationTicketIds = new Set(activeTickets.map(t => t.id));
  const scopedBagages = hasAllocations && stationId
    ? bagages.filter(b => {
        if (b.description === '__deleted__') return false;
        if (b.ticket_id && stationTicketIds.has(b.ticket_id)) return true;
        if (b.ticket_id) return false;
        return stationId === depart.station_id;
      })
    : bagages.filter(b => b.description !== '__deleted__');

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
    .filter(d => d.type.toLowerCase().includes('ration') || d.type.toLowerCase().includes('frais de route') || d.type.toLowerCase().includes('frais route'))
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
      return !t.includes('ration') && !t.includes('frais de route') && !t.includes('frais route')
        && !t.includes('carburant') && !t.includes('péage') && !t.includes('peage');
    })
    .reduce((s, d) => s + d.amount, 0);
  const totalCharges = totalRations + totalCarburant + totalPeages + totalAutres;
  const soldeTicket = totalTicketAmount - totalCharges;

  const now = new Date();
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

  const totalSeats = seatRange ? seatRange.to - seatRange.from + 1 : depart.seats_total;
  const data: BordereauDepartData = {
    station_name: depart.station_name ?? '',
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

  printBorderauDepart(data);
}

export default function POSDeparts() {
  const navigate = useNavigate();
  const { session } = usePOSSession();
  const [departs, setDeparts] = useState<DepartRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('departure_datetime');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [showExportsMenu, setShowExportsMenu] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showCancelConfirm, setShowCancelConfirm] = useState<DepartRow | null>(null);
  const [allTickets, setAllTickets] = useState<TicketRecord[]>([]);
  const [cancelError, setCancelError] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  const [editVehicules, setEditVehicules] = useState<VehiculeRef[]>([]);
  const [editChauffeurs, setEditChauffeurs] = useState<ChauffeurRef[]>([]);
  const [editSoldTickets, setEditSoldTickets] = useState<TicketRecord[]>([]);
  const [editNextDepart, setEditNextDepart] = useState<DepartRecord | null>(null);
  const [pendingTransfers, setPendingTransfers] = useState(0);

  const loadDeparts = useCallback(async () => {
    await syncDepartsAndTicketsFromServer(session?.station_id);
    const [all, tickets, allBagages, allDepenses] = await Promise.all([
      getAllDeparts(session?.station_id, session?.counter_id),
      getAllRecords<TicketRecord>('tickets'),
      getAllRecords<BagageRecord>('bagages'),
      getAllRecords<DepenseRecord>('depenses'),
    ]);
    const hydrated = all.map(d => {
      const totals = computeStationScopedTotals(d, tickets, allBagages, allDepenses, session?.station_id);
      return {
        ...d,
        mt_ticket: totals.mt_ticket,
        mt_bagage: totals.mt_bagage,
        tot_depense: totals.tot_depense,
        solde: totals.solde,
        caisse: totals.caisse,
      };
    });
    setAllTickets(tickets);
    setDeparts(hydrated.map(d => toRow(d, tickets, session?.station_id)));
    setLoading(false);

    // Check for pending transfers needing a next depart
    if (session?.station_id) {
      const pending = await getPendingTransfersForStation(session.station_id);
      setPendingTransfers(pending.length);
    }
  }, [session?.station_id, session?.counter_id]);

  useEffect(() => {
    loadDeparts();
  }, [loadDeparts]);

  const todayStr = new Date().toISOString().split('T')[0];

  const visibleDeparts = useMemo(() => {
    let list = showAll ? departs : departs.filter(d => d.departure_date === todayStr);
    list = list.filter(d => !d.cancelled);
    list = [...list].sort((a, b) => {
      let cmp = 0;
      const av = getSortValue(a, sortKey); const bv = getSortValue(b, sortKey);
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else if (typeof av === 'boolean' && typeof bv === 'boolean') cmp = av === bv ? 0 : av ? 1 : -1;
      else cmp = String(av ?? '').localeCompare(String(bv ?? ''));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [departs, showAll, sortKey, sortDir, todayStr]);

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
  const allSelected = visibleDeparts.length > 0 && selectedIds.size === visibleDeparts.length;
  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(visibleDeparts.map(d => d.id)));
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
          getAllTickets<TicketRecord>('tickets'),
          getBagagesForDepart(d.id),
          getDepensesForDepart(d.id),
        ]);
        const hasAllocations = !!(d.seat_allocations && d.seat_allocations.length > 0);
        const seatRange = hasAllocations && session?.station_id ? getSeatRangeForStation(d, session.station_id) : null;
        let active = dTickets.filter(t => t.depart_id === d.id && t.status !== 'cancelled');
        if (seatRange) {
          active = active.filter(t => t.seat_number >= seatRange.from && t.seat_number <= seatRange.to);
        }
        const stationTicketIds = new Set(active.map(t => t.id));
        const scopedBagages = hasAllocations && session?.station_id
          ? dBagages.filter(b => {
              if (b.description === '__deleted__') return false;
              if (b.ticket_id && stationTicketIds.has(b.ticket_id)) return true;
              if (b.ticket_id) return false;
              return session.station_id === d.station_id;
            })
          : dBagages.filter(b => b.description !== '__deleted__');
        const totalTicket = active.reduce((s, t) => s + t.price, 0);
        const totalBaggage = scopedBagages.reduce((s, b) => s + b.price, 0);
        const valid = hasAllocations && session?.station_id
          ? dDepenses.filter(x => x.description !== '__deleted__' && x.station_id === session.station_id)
          : dDepenses.filter(x => x.description !== '__deleted__');
        const totalCarburant = valid.filter(x => x.type.toLowerCase().includes('carburant')).reduce((s, x) => s + x.amount, 0);
        const totalRations = valid.filter(x => x.type.toLowerCase().includes('ration') || x.type.toLowerCase().includes('frais de route') || x.type.toLowerCase().includes('frais route')).reduce((s, x) => s + x.amount, 0);
        const totalPeages = valid.filter(x => x.type.toLowerCase().includes('péage') || x.type.toLowerCase().includes('peage')).reduce((s, x) => s + x.amount, 0);
        const totalAutres = valid.filter(x => {
          const t = x.type.toLowerCase();
          return !t.includes('ration') && !t.includes('frais de route') && !t.includes('frais route') && !t.includes('carburant') && !t.includes('péage') && !t.includes('peage');
        }).reduce((s, x) => s + x.amount, 0);
        const totalCharges = totalCarburant + totalRations + totalPeages + totalAutres;
        const pad = (n: number) => String(n).padStart(2, '0');
        let depDate = d.departure_date;
        try {
          const dt = new Date(d.departure_datetime);
          if (!isNaN(dt.getTime())) depDate = `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()}`;
        } catch { /* keep default */ }
        return {
          station_name: d.station_name ?? session?.station_name ?? '',
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
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const data: BordereauRecettesData = {
        station_name: session?.station_name ?? '',
        station_code: stationCode,
        route_name: targets.length > 0 ? `${targets.length} départ(s)` : '',
        date_from: rows[0]?.departure_date ?? '',
        date_to: rows[rows.length - 1]?.departure_date ?? '',
        print_date: `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`,
        print_time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
        rows,
        totals,
      };
      printBorderauRecettes(data);
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
      if (action === 'confirmer') {
        await updateDepart(depart.id, { confirmed: true, status: 'confirmed' });
      }
      if (action === 'annuler') {
        setCancelError('');
        setShowCancelConfirm(depart);
        setActionLoading(false);
        return;
      }
      if (action === 'fermer') {
        await updateDepart(depart.id, { cloture: true });
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
        setShowEditModal(true);
        return;
      }
      if (action === 'imprimer') {
        const summaries = visibleDeparts.map(d => departToSummary(d, allTickets, session?.station_id));
        printDeparturesList(summaries, session?.station_name);
        return;
      }
      if (action === 'bordereau') {
        await printBordereauForDepart(depart, session?.station_id);
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
                    onClick={() => { setShowExportsMenu(false); printDeparturesList(visibleDeparts.map(d => departToSummary(d, allTickets, session?.station_id)), session?.station_name); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-left transition-colors"
                    style={{ color: 'var(--text-primary)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--surface-raised)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <Copy className="w-4 h-4" /> Imprimer liste
                  </button>
                  <button
                    onClick={() => { setShowExportsMenu(false); exportToPDF(visibleDeparts.map(d => departToSummary(d, allTickets, session?.station_id)), `recap-departs-${todayStr}.pdf`, 'Récapitulatif des départs'); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-left transition-colors"
                    style={{ color: 'var(--text-primary)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--surface-raised)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <FileText className="w-4 h-4" /> Export PDF
                  </button>
                  <button
                    onClick={() => { setShowExportsMenu(false); exportToExcel(visibleDeparts.map(d => departToSummary(d, allTickets, session?.station_id)), `recap-departs-${todayStr}.xlsx`); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-left transition-colors"
                    style={{ color: 'var(--text-primary)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--surface-raised)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <FileSpreadsheet className="w-4 h-4" /> Export Excel
                  </button>
                  <div className="my-1" style={{ borderTop: '1px solid var(--border)' }} />
                  <button
                    onClick={() => { setShowExportsMenu(false); printGroupedBordereau(); }}
                    disabled={selectedIds.size === 0 || actionLoading}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm font-bold text-left transition-colors disabled:opacity-50"
                    style={{ color: 'var(--primary)' }}
                    onMouseEnter={(e) => { if (selectedIds.size > 0) e.currentTarget.style.backgroundColor = 'var(--surface-raised)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ListChecks className="w-4 h-4" />} Bordereau détaillé des recettes{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
                  </button>
                </div>
              </>
            )}
          </div>
          {selectedRow && (
            <>
              <button onClick={() => handleAction('modifier', selectedRow)} disabled={selectedRow.cloture} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold border-2 disabled:opacity-50 disabled:cursor-not-allowed" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                <Pencil className="w-4 h-4" /> Modifier
              </button>
              <button onClick={() => handleAction('imprimer', selectedRow)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold border-2" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                <Printer className="w-4 h-4" /> Imprimer sélection
              </button>
              <button onClick={() => handleAction('bordereau', selectedRow)} disabled={actionLoading} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-60" style={{ backgroundColor: 'var(--primary)' }}>
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScrollText className="w-4 h-4" />} Bordereau départ
              </button>
              <button onClick={() => handleAction('vente', selectedRow)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white" style={{ backgroundColor: 'var(--info)' }}>
                <Ticket className="w-4 h-4" /> Vente tickets
              </button>
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
              {!selectedRow.confirmed && !selectedRow.cancelled && (
                <button
                  disabled
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white cursor-not-allowed opacity-60"
                  style={{ backgroundColor: 'var(--text-muted)' }}
                >
                  <CheckCircle className="w-4 h-4" /> Confirmer
                </button>
              )}
              {!selectedRow.cancelled && !selectedRow.cloture && (() => {
                const soldCount = allTickets.filter(t => t.depart_id === selectedRow.id && t.status !== 'cancelled').length;
                return soldCount === 0 ? (
                  <button onClick={() => handleAction('annuler', selectedRow)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white" style={{ backgroundColor: 'var(--danger)' }}>
                    <XCircle className="w-4 h-4" /> Annuler
                  </button>
                ) : null;
              })()}
              {!selectedRow.cloture && !selectedRow.cancelled && (
                <button onClick={() => handleAction('fermer', selectedRow)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white" style={{ backgroundColor: 'var(--text-secondary)' }}>
                  <Lock className="w-4 h-4" /> Clôturer
                </button>
              )}
            </>
          )}
        </div>
        <button
          onClick={() => setShowAll(v => !v)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold border-2"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
        >
          <Eye className="w-4 h-4" /> {showAll ? "Aujourd'hui" : 'Voir tout'}
        </button>
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
                {visibleDeparts.map(d => {
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
                          {d.station_id !== session?.station_id && d.seat_allocations?.some(a => a.station_id === session?.station_id) && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full font-bold" style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
                              Gare secondaire
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
                          if (d.seat_allocations && session?.station_id) {
                            const range = getSeatRangeForStation(d, session.station_id);
                            if (range) return `${range.from}–${range.to}`;
                          }
                          return `${d.seats_from}–${d.seats_total}`;
                        })()}
                      </td>
                      <td className={td + ' text-right'} style={{ color: 'var(--info)', fontWeight: 600 }}>{d.seats_sold_station}</td>
                      <td className={td + ' text-right'} style={{ color: 'var(--success)', fontWeight: 700 }}>{d.seats_libres}</td>
                      <td className={td}>
                        {d.cancelled ? <span style={{ color: 'var(--danger)' }}>Annulé</span>
                          : d.cloture ? <span style={{ color: 'var(--danger)' }}>Clôturé</span>
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

          <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
            {visibleDeparts.length} départ(s) {showAll ? '(toutes dates)' : "(aujourd'hui)"} · Cliquez sur une ligne pour la sélectionner et voir les actions
          </p>
        </>
      )}

      {/* Edit modal */}
      {showEditModal && selectedRow && (
        <EditDepartModal
          depart={selectedRow}
          vehicules={editVehicules}
          chauffeurs={editChauffeurs}
          soldTickets={editSoldTickets}
          nextDepart={editNextDepart}
          onSave={async (newBusId, newBusPlate, newDriverId, newDriverName, newCapacity) => {
            await updateDepart(selectedRow.id, {
              bus_id: newBusId,
              bus_plate: newBusPlate,
              driver_id: newDriverId,
              driver_name: newDriverName,
              seats_total: newCapacity,
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
              solde: sourceMtTicket + selectedRow.mt_bagage - selectedRow.tot_depense,
              caisse: sourceMtTicket + selectedRow.mt_bagage - selectedRow.tot_depense,
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
