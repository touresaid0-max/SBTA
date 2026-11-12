import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../../services/supabase';
import { Download, TrendingUp, TrendingDown, ChevronDown, ChevronRight, Search, X } from 'lucide-react';
import {
  format, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  startOfYear, endOfYear,
} from 'date-fns';
import * as XLSX from 'xlsx';
import RouteDeparturesDetail from '../../components/gestionnaire/RouteDeparturesDetail';
import { usePagination } from '@/hooks/usePagination';
import Pagination from '@/components/pos/Pagination';

const fmt = (n: number) => new Intl.NumberFormat('fr-CI', { maximumFractionDigits: 0 }).format(n);
const fmtCFA = (n: number) => fmt(n) + ' FCFA';

interface KPIs {
  total_revenue: number;
  cc_carburant_complement: number;
  cc_ration: number;
  cc_peage: number;
  cc_autres: number;
  fuel_enlevements_amount: number;
  expense_reparation: number;
  expense_autres: number;
  expense_charge_stock?: number;
  expense_garage_pieces?: number;
  vehicle_expenses_amount: number;
  fuel_carburant_comptable: number;
  trip_count: number;
  active_bus_count: number;
  driver_count: number;
}

interface BusRow {
  bus_id: string; registration_number: string; model: string; trip_count: number; revenue: number;
  cc_carburant: number; cc_ration: number; cc_peage: number; cc_autres: number;
  fuel_enlev: number; expense_reparation: number; expense_autres: number; expense_charge_stock: number; expense_garage_pieces: number; vehicle_exp: number;
  fuel_carburant_comptable: number;
  total_expense: number; margin: number;
}

interface RouteRow {
  route_id: string; route_name: string; trip_count: number; revenue: number;
  cc_carburant: number; cc_ration: number; cc_peage: number; cc_autres: number;
  total_expense: number; margin: number;
}
interface DriverRow {
  driver_id: string; first_name: string; last_name: string; employee_id: string;
  bus_registration: string; trip_count: number; revenue: number;
  cc_carburant: number; cc_ration: number; cc_peage: number; cc_autres: number;
  expense_total: number; avg_rating: number;
}

// Detail tables: 10 rows per page by default
const TABLE_PAGE_SIZES = [10, 20, 50] as const;
const TABLE_PAGINATION = { sizes: TABLE_PAGE_SIZES, defaultSize: 10 };
// Search ignores case and accents (« bouake » finds « Bouaké »)
const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

type PeriodType = 'jour' | 'semaine' | 'mois' | 'annee' | 'custom';

const PRESET_PERIODS: { label: string; value: PeriodType }[] = [
  { label: 'Journalier',   value: 'jour' },
  { label: 'Hebdomadaire', value: 'semaine' },
  { label: 'Mensuel',      value: 'mois' },
  { label: 'Annuel',       value: 'annee' },
];

// Calcule la plage de dates (yyyy-MM-dd) pour un type de période.
function rangeFor(type: Exclude<PeriodType, 'custom'>): { from: string; to: string } {
  const now = new Date();
  const f = (d: Date) => format(d, 'yyyy-MM-dd');
  switch (type) {
    case 'jour':    return { from: f(now), to: f(now) };
    case 'semaine': return { from: f(startOfWeek(now, { weekStartsOn: 1 })), to: f(endOfWeek(now, { weekStartsOn: 1 })) };
    case 'mois':    return { from: f(startOfMonth(now)), to: f(endOfMonth(now)) };
    case 'annee':   return { from: f(startOfYear(now)), to: f(endOfYear(now)) };
  }
}

export default function FinancialReport() {
  const [preset, setPreset] = useState<PeriodType>('mois');
  const [dateFrom, setDateFrom] = useState(rangeFor('mois').from);
  const [dateTo, setDateTo] = useState(rangeFor('mois').to);
  const [activeTab, setActiveTab] = useState<'synthese' | 'bus' | 'lignes' | 'chauffeurs'>('synthese');
  // Line whose voyages are shown in detail (gares, then departures)
  const [openRouteId, setOpenRouteId] = useState<string | null>(null);
  // The lines table scrolls sideways: the detail is kept to the visible width so nothing is cut off
  const linesBoxRef = useRef<HTMLDivElement>(null);
  const [linesBoxWidth, setLinesBoxWidth] = useState(0);
  useEffect(() => {
    const el = linesBoxRef.current;
    if (!el || !openRouteId) return;
    const update = () => setLinesBoxWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [openRouteId, activeTab]);
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [buses, setBuses] = useState<BusRow[]>([]);
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  // Search in the Bus / Lignes / Chauffeurs tables (cleared when the tab changes)
  const [tableSearch, setTableSearch] = useState('');
  const [loading, setLoading] = useState(false);

  const applyPreset = (type: Exclude<PeriodType, 'custom'>) => {
    const r = rangeFor(type);
    setPreset(type);
    setDateFrom(r.from);
    setDateTo(r.to);
  };

  const load = useCallback(async () => {
    setLoading(true);
    const [kpiRes, busRes, routeRes, drvRes] = await Promise.all([
      supabase.rpc('get_gestionnaire_dashboard_kpis', { p_date_from: dateFrom, p_date_to: dateTo }),
      supabase.rpc('get_gestionnaire_revenue_by_bus', { p_date_from: dateFrom, p_date_to: dateTo }),
      supabase.rpc('get_gestionnaire_revenue_by_route', { p_date_from: dateFrom, p_date_to: dateTo }),
      supabase.rpc('get_gestionnaire_driver_report', { p_date_from: dateFrom, p_date_to: dateTo }),
    ]);
    if (kpiRes.data) setKpis(kpiRes.data as KPIs);
    if (busRes.data) setBuses(busRes.data as BusRow[]);
    if (routeRes.data) setRoutes(routeRes.data as RouteRow[]);
    if (drvRes.data) setDrivers(drvRes.data as DriverRow[]);
    setLoading(false);
  }, [dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  // Charges guichetier
  const guichetierCharges = kpis
    ? kpis.cc_carburant_complement + kpis.cc_ration + kpis.cc_peage + (kpis.cc_autres ?? 0)
    : 0;
  // Résultat guichetier = Recettes - (Carb. compl. + Rations + Péages guichet)
  const guichetierResult = kpis ? kpis.total_revenue - guichetierCharges : 0;
  // Résultat brut = Résultat guichetier - Carburant cuve - Réparations (comptable) - Charges achat - Charge carburant comptable - Autres
  const brutResult = guichetierResult - (kpis
    ? kpis.fuel_enlevements_amount + kpis.expense_reparation + kpis.vehicle_expenses_amount + (kpis.fuel_carburant_comptable ?? 0) + kpis.expense_autres + (kpis.expense_charge_stock ?? 0) + (kpis.expense_garage_pieces ?? 0)
    : 0);
  const totalExpenses = kpis
    ? guichetierCharges + kpis.fuel_enlevements_amount + kpis.expense_reparation + kpis.vehicle_expenses_amount + (kpis.fuel_carburant_comptable ?? 0) + kpis.expense_autres + (kpis.expense_charge_stock ?? 0) + (kpis.expense_garage_pieces ?? 0)
    : 0;
  const marginPct = kpis && kpis.total_revenue > 0 ? (brutResult / kpis.total_revenue * 100) : 0;

  const q = norm(tableSearch.trim());
  const busesShown = useMemo(() => (q ? buses.filter(b => norm(`${b.registration_number} ${b.model}`).includes(q)) : buses), [buses, q]);
  const routesShown = useMemo(() => (q ? routes.filter(r => norm(r.route_name).includes(q)) : routes), [routes, q]);
  const driversShown = useMemo(() => (q ? drivers.filter(d => norm(`${d.first_name} ${d.last_name} ${d.employee_id} ${d.bus_registration}`).includes(q)) : drivers), [drivers, q]);
  const resetKey = `${q}|${dateFrom}|${dateTo}`;
  const pBuses = usePagination(busesShown, 'gestionnaire-rapport-bus-page-size', resetKey, TABLE_PAGINATION);
  const pRoutes = usePagination(routesShown, 'gestionnaire-rapport-lignes-page-size', resetKey, TABLE_PAGINATION);
  const pDrivers = usePagination(driversShown, 'gestionnaire-rapport-chauffeurs-page-size', resetKey, TABLE_PAGINATION);

  const searchBar = (placeholder: string, shown: number, total: number) => (
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <label className="relative w-full sm:w-80">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
        <input value={tableSearch} onChange={e => setTableSearch(e.target.value)} placeholder={placeholder} aria-label={placeholder}
          className="w-full rounded-lg border py-2 pl-9 pr-9 text-sm"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
        {tableSearch && (
          <button type="button" onClick={() => setTableSearch('')} aria-label="Effacer la recherche" title="Effacer la recherche"
            className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md" style={{ color: 'var(--text-muted)' }}>
            <X className="h-4 w-4" />
          </button>
        )}
      </label>
      {q && <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{shown} résultat{shown > 1 ? 's' : ''} sur {total}</span>}
    </div>
  );
  const pager = (p: ReturnType<typeof usePagination<unknown>>, itemLabel: string) => p.total > 0 && (
    <div className="mt-1">
      <Pagination page={p.page} pageCount={p.pageCount} pageSize={p.pageSize} total={p.total} sizeOptions={p.sizes}
        onPageChange={p.setPage} onPageSizeChange={p.setPageSize} itemLabel={itemLabel} />
    </div>
  );
  const emptyRow = (cols: number, hasData: boolean) => (
    <tr><td colSpan={cols} className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>
      {hasData ? `Aucun résultat pour « ${tableSearch.trim()} »` : 'Aucune donnée'}
    </td></tr>
  );

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
      'Recettes totales': kpis?.total_revenue ?? 0,
      'Carburant compl. (guichet)': kpis?.cc_carburant_complement ?? 0,
      'Rations (guichet)': kpis?.cc_ration ?? 0,
      'Péages (guichet)': kpis?.cc_peage ?? 0,
      'Autr. dép. (GCH)': kpis?.cc_autres ?? 0,
      'Total charges guichetier': guichetierCharges,
      'Résultat guichetier': guichetierResult,
      'Carburant cuve': kpis?.fuel_enlevements_amount ?? 0,
      'Réparations (Autres dép. Comptable)': kpis?.expense_reparation ?? 0,
      'Charges achat': kpis?.vehicle_expenses_amount ?? 0,
      'Charge carburant (Comptable)': kpis?.fuel_carburant_comptable ?? 0,
      'Articles stock (Comptable)': kpis?.expense_autres ?? 0,
      'Charge stock': kpis?.expense_charge_stock ?? 0,
      'Sorties pieces garage': kpis?.expense_garage_pieces ?? 0,
      'Total charges': totalExpenses,
      'Résultat brut': brutResult,
      'Marge %': marginPct.toFixed(2),
    }]), 'Synthèse');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(buses.map(b => ({
      Immatriculation: b.registration_number, Modèle: b.model, Voyages: b.trip_count,
      Recettes: b.revenue, 'Carburant compl.': b.cc_carburant, Rations: b.cc_ration,
      'Péages guichet': b.cc_peage, 'Autr. dép. (GCH)': b.cc_autres ?? 0,
      'Carburant cuve': b.fuel_enlev,
      'Autres dépenses (comptable)': b.expense_reparation,
      'Articles stock (comptable)': b.expense_autres ?? 0,
      'Charge stock': b.expense_charge_stock ?? 0,
      'Sorties pieces garage': b.expense_garage_pieces ?? 0,
      'Charge carburant (agent)': b.fuel_carburant_comptable ?? 0,
      'Total charges': b.total_expense, Marge: b.margin,
    }))), 'Par bus');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(routes.map(r => ({
      Ligne: r.route_name, Voyages: r.trip_count, Recettes: r.revenue,
      'Carburant compl.': r.cc_carburant, Rations: r.cc_ration,
      'Péages guichet': r.cc_peage, 'Autr. dép. (GCH)': r.cc_autres ?? 0,
      'Total charges': r.total_expense ?? 0, Marge: r.margin,
    }))), 'Par ligne');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(drivers.map(d => ({
      Prénom: d.first_name, Nom: d.last_name, Matricule: d.employee_id,
      Bus: d.bus_registration, Voyages: d.trip_count, Recettes: d.revenue,
      'Carburant compl.': d.cc_carburant, Rations: d.cc_ration,
      'Péages guichet': d.cc_peage, 'Autr. dép. (GCH)': d.cc_autres ?? 0,
      'Total charges': d.expense_total,
      Marge: Number(d.revenue) - Number(d.expense_total),
    }))), 'Chauffeurs');
    XLSX.writeFile(wb, `rapport_financier_${dateFrom}_${dateTo}.xlsx`);
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Rapport financier</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Vue consolidée recettes, charges et résultats</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
            {PRESET_PERIODS.map(p => (
              <button key={p.value} onClick={() => applyPreset(p.value as Exclude<PeriodType, 'custom'>)}
                className="px-3 py-1.5 text-sm font-medium"
                style={{ backgroundColor: preset === p.value ? 'var(--primary)' : 'var(--surface)', color: preset === p.value ? '#fff' : 'var(--text-secondary)' }}>
                {p.label}
              </button>
            ))}
            <button onClick={() => setPreset('custom')}
              className="px-3 py-1.5 text-sm font-medium"
              style={{ backgroundColor: preset === 'custom' ? 'var(--primary)' : 'var(--surface)', color: preset === 'custom' ? '#fff' : 'var(--text-secondary)' }}>
              Personnalisé
            </button>
          </div>
          {preset === 'custom' && (
            <>
              <input type="date" value={dateFrom} max={dateTo} onChange={e => setDateFrom(e.target.value)}
                className="px-3 py-2 border rounded-lg text-sm"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
              <span style={{ color: 'var(--text-muted)' }}>→</span>
              <input type="date" value={dateTo} min={dateFrom} onChange={e => setDateTo(e.target.value)}
                className="px-3 py-2 border rounded-lg text-sm"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
            </>
          )}
          <button onClick={exportExcel} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
            style={{ backgroundColor: '#16A34A', color: '#fff' }}>
            <Download className="w-4 h-4" /> Excel complet
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 rounded-full animate-spin" style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
        </div>
      ) : (
        <>
          {/* KPI summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total recettes',               val: fmtCFA(kpis?.total_revenue ?? 0),        color: '#10B981', Icon: TrendingUp },
              { label: 'Total charges',                val: fmtCFA(totalExpenses),                    color: '#EF4444', Icon: TrendingDown },
              { label: 'Résultat guichetier',          val: fmtCFA(guichetierResult),                 color: guichetierResult >= 0 ? '#3B82F6' : '#EF4444', Icon: guichetierResult >= 0 ? TrendingUp : TrendingDown },
              { label: `Résultat brut (${marginPct.toFixed(1)}%)`, val: fmtCFA(brutResult), color: brutResult >= 0 ? '#10B981' : '#EF4444', Icon: brutResult >= 0 ? TrendingUp : TrendingDown },
            ].map(k => (
              <div key={k.label} className="rounded-xl border p-4" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{k.label}</p>
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: k.color + '20', color: k.color }}>
                    <k.Icon className="w-3.5 h-3.5" />
                  </div>
                </div>
                <p className="font-bold text-sm truncate" style={{ color: k.color }}>{k.val}</p>
              </div>
            ))}
          </div>

          {/* Charges guichetier */}
          <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
              Charges guichetier <span className="font-normal text-xs ml-1" style={{ color: 'var(--text-muted)' }}>(bordereaux départ — saisies au guichet)</span>
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              {[
                { label: 'Carburant compl.', val: kpis?.cc_carburant_complement ?? 0, color: '#3B82F6' },
                { label: 'Rations',          val: kpis?.cc_ration ?? 0,               color: '#F59E0B' },
                { label: 'Péages guichet',   val: kpis?.cc_peage ?? 0,                color: '#10B981' },
                { label: 'Autr. dép. (GCH)', val: kpis?.cc_autres ?? 0,               color: '#6366F1' },
                { label: 'Sous-total guichet', val: guichetierCharges, color: '#EF4444' },
                { label: 'Résultat guichetier', val: guichetierResult, color: guichetierResult >= 0 ? '#3B82F6' : '#EF4444' },
              ].map(e => (
                <div key={e.label} className="rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}>
                  <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>{e.label}</p>
                  <p className="font-bold text-sm" style={{ color: e.color }}>{fmtCFA(e.val)}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Autres charges */}
          <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
              Autres charges <span className="font-normal text-xs ml-1" style={{ color: 'var(--text-muted)' }}>(cuve, réparations, achat, articles stock)</span>
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                { label: 'Carburant cuve',             val: kpis?.fuel_enlevements_amount ?? 0,       color: '#F97316' },
                { label: 'Réparations (comptable)',     val: kpis?.expense_reparation ?? 0,            color: '#EF4444' },
                { label: 'Charges achat',               val: kpis?.vehicle_expenses_amount ?? 0,       color: '#06B6D4' },
                { label: 'Charge carburant (agent)',val: kpis?.fuel_carburant_comptable ?? 0,      color: '#F59E0B' },
                { label: 'Articles stock',              val: kpis?.expense_autres ?? 0,                color: '#8B5CF6' },
                { label: 'Charge stock',                val: kpis?.expense_charge_stock ?? 0,          color: '#7C3AED' },
                { label: 'Sorties pieces garage',       val: kpis?.expense_garage_pieces ?? 0,         color: '#B45309' },
              ].map(e => (
                <div key={e.label} className="rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}>
                  <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>{e.label}</p>
                  <p className="font-bold text-sm" style={{ color: e.color }}>{fmtCFA(e.val)}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {totalExpenses > 0 ? ((e.val / totalExpenses) * 100).toFixed(1) + '%' : '—'}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Detail tabs */}
          <div>
            <div className="flex gap-1 border-b mb-4" style={{ borderColor: 'var(--border)' }}>
              {(['synthese', 'bus', 'lignes', 'chauffeurs'] as const).map(t => {
                const labels = { synthese: 'Synthèse P&L', bus: 'Détail par bus', lignes: 'Détail par ligne', chauffeurs: 'Détail chauffeurs' };
                return (
                  <button key={t} onClick={() => { setActiveTab(t); setTableSearch(''); }}
                    className="px-4 py-2.5 text-sm font-medium border-b-2 -mb-px"
                    style={{ borderBottomColor: activeTab === t ? 'var(--primary)' : 'transparent', color: activeTab === t ? 'var(--primary)' : 'var(--text-secondary)' }}>
                    {labels[t]}
                  </button>
                );
              })}
            </div>

            {activeTab === 'synthese' && (
              <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                      {['Poste', 'Montant', '% charges', '% recettes'].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: 'Recettes totales',             val: kpis?.total_revenue ?? 0,          bold: true, colorKey: 'rev' },
                      { label: '  Carburant compl. (guichet)', val: kpis?.cc_carburant_complement ?? 0, bold: false, colorKey: 'exp' },
                      { label: '  Rations (guichet)',          val: kpis?.cc_ration ?? 0,               bold: false, colorKey: 'exp' },
                      { label: '  Péages (guichet)',           val: kpis?.cc_peage ?? 0,                bold: false, colorKey: 'exp' },
                      { label: '  Autr. dép. (GCH)',            val: kpis?.cc_autres ?? 0,                bold: false, colorKey: 'exp' },
                      { label: 'Résultat guichetier',          val: guichetierResult,                   bold: true, colorKey: 'res', res: guichetierResult },
                      { label: '  Carburant cuve',             val: kpis?.fuel_enlevements_amount ?? 0, bold: false, colorKey: 'exp' },
                      { label: '  Réparations (Autres dép. Comptable)', val: kpis?.expense_reparation ?? 0,            bold: false, colorKey: 'exp' },
                      { label: '  Charges achat',                        val: kpis?.vehicle_expenses_amount ?? 0,       bold: false, colorKey: 'exp' },
                      { label: '  Charge carburant (Comptable)',          val: kpis?.fuel_carburant_comptable ?? 0,      bold: false, colorKey: 'exp' },
                      { label: '  Articles stock (comptable)',            val: kpis?.expense_autres ?? 0,                bold: false, colorKey: 'exp' },
                      { label: '  Charge stock',                           val: kpis?.expense_charge_stock ?? 0,          bold: false, colorKey: 'exp' },
                      { label: '  Sorties pieces garage',                  val: kpis?.expense_garage_pieces ?? 0,         bold: false, colorKey: 'exp' },
                      { label: 'Résultat brut',                val: brutResult,                         bold: true, colorKey: 'brut', res: brutResult },
                      { label: 'Total charges',                val: totalExpenses,                      bold: true, colorKey: 'tot' },
                    ].map((row, i) => {
                      const color = row.colorKey === 'rev' ? '#10B981'
                        : row.colorKey === 'exp' ? 'var(--text-secondary)'
                        : row.colorKey === 'tot' ? '#EF4444'
                        : (row.res ?? 0) >= 0 ? '#3B82F6' : '#EF4444';
                      return (
                        <tr key={i} className="border-t" style={{ borderColor: 'var(--border)', fontWeight: row.bold ? 700 : 400 }}>
                          <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-primary)', paddingLeft: row.label.startsWith('  ') ? 32 : undefined }}>{row.label.trim()}</td>
                          <td className="px-4 py-2.5 text-xs font-semibold" style={{ color }}>{fmtCFA(row.val)}</td>
                          <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                            {row.colorKey === 'exp' && totalExpenses > 0 ? ((Math.abs(row.val) / totalExpenses) * 100).toFixed(1) + '%' : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                            {kpis && kpis.total_revenue > 0 ? ((Math.abs(row.val) / kpis.total_revenue) * 100).toFixed(1) + '%' : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'bus' && (
              <>
              {searchBar('Rechercher un bus ou un modèle…', busesShown.length, buses.length)}
              <div className="rounded-2xl border overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                      {['Bus', 'Voyages', 'Recettes', 'Carb. compl.', 'Rations', 'Péages', 'Autr. dép. (GCH)', 'Carb. cuve', 'Autres dép. (comptable)', 'Articles stock', 'Charge stock', 'Sorties pieces garage', 'Carb. agent', 'Total charges', 'Résultat', 'Marge %'].map(h => (
                        <th key={h} className="text-left px-3 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pBuses.pageItems.map(b => {
                      const mp = b.revenue > 0 ? (b.margin / b.revenue * 100) : 0;
                      return (
                        <tr key={b.bus_id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                          <td className="px-3 py-2.5 text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{b.registration_number}</td>
                          <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{b.trip_count}</td>
                          <td className="px-3 py-2.5 text-xs font-semibold" style={{ color: '#10B981' }}>{fmt(b.revenue)}</td>
                          <td className="px-3 py-2.5 text-xs" style={{ color: '#3B82F6' }}>{fmt(b.cc_carburant)}</td>
                          <td className="px-3 py-2.5 text-xs" style={{ color: '#F59E0B' }}>{fmt(b.cc_ration)}</td>
                          <td className="px-3 py-2.5 text-xs" style={{ color: '#10B981' }}>{fmt(b.cc_peage)}</td>
                          <td className="px-3 py-2.5 text-xs" style={{ color: '#6366F1' }}>{fmt(b.cc_autres ?? 0)}</td>
                          <td className="px-3 py-2.5 text-xs" style={{ color: '#F97316' }}>{fmt(b.fuel_enlev)}</td>
                          <td className="px-3 py-2.5 text-xs" style={{ color: '#EF4444' }}>{fmt(b.expense_reparation)}</td>
                          <td className="px-3 py-2.5 text-xs" style={{ color: '#8B5CF6' }}>{fmt(b.expense_autres ?? 0)}</td>
                          <td className="px-3 py-2.5 text-xs" style={{ color: '#7C3AED' }}>{fmt(b.expense_charge_stock ?? 0)}</td>
                          <td className="px-3 py-2.5 text-xs" style={{ color: '#B45309' }}>{fmt(b.expense_garage_pieces ?? 0)}</td>
                          <td className="px-3 py-2.5 text-xs" style={{ color: '#F59E0B' }}>{fmt(b.fuel_carburant_comptable ?? 0)}</td>
                          <td className="px-3 py-2.5 text-xs font-semibold" style={{ color: '#EF4444' }}>{fmt(b.total_expense)}</td>
                          <td className="px-3 py-2.5 text-xs font-bold" style={{ color: b.margin >= 0 ? '#10B981' : '#EF4444' }}>{fmt(b.margin)}</td>
                          <td className="px-3 py-2.5">
                            <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full"
                              style={{ backgroundColor: mp >= 15 ? '#DCFCE7' : mp >= 0 ? '#FEF9C3' : '#FEE2E2', color: mp >= 15 ? '#16A34A' : mp >= 0 ? '#CA8A04' : '#EF4444' }}>
                              {mp.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {busesShown.length === 0 && emptyRow(16, buses.length > 0)}
                  </tbody>
                </table>
              </div>
              {pager(pBuses, 'bus')}
              </>
            )}

            {activeTab === 'lignes' && (
              <>
              {searchBar('Rechercher une ligne…', routesShown.length, routes.length)}
              <div ref={linesBoxRef} className="rounded-2xl border overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                      {['Ligne', 'Voyages', 'Recettes', 'Carb. compl.', 'Rations', 'Péages', 'Autr. dép. (GCH)', 'Total charges', 'Marge', 'Marge %'].map(h => (
                        <th key={h} className="text-left px-3 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pRoutes.pageItems.map((r, i) => {
                      const mp = r.revenue > 0 ? (r.margin / r.revenue * 100) : 0;
                      const open = openRouteId != null && openRouteId === r.route_id;
                      return (
                        <React.Fragment key={r.route_id || i}>
                        <tr className="border-t" style={{ borderColor: 'var(--border)', backgroundColor: open ? 'var(--bg-subtle)' : undefined }}>
                          <td className="px-3 py-2.5 text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{r.route_name}</td>
                          <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                            {r.route_id && Number(r.trip_count) > 0 ? (
                              <button type="button" onClick={() => setOpenRouteId(open ? null : r.route_id)}
                                aria-expanded={open} title={open ? 'Masquer le détail' : 'Voir les gares et les départs'}
                                className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-bold"
                                style={{ borderColor: open ? '#10B981' : 'var(--border)', color: open ? '#047857' : 'var(--text-primary)', backgroundColor: open ? 'rgba(16,185,129,0.12)' : 'var(--surface)' }}>
                                {r.trip_count}
                                {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                              </button>
                            ) : r.trip_count}
                          </td>
                          <td className="px-3 py-2.5 text-xs font-semibold" style={{ color: '#10B981' }}>{fmtCFA(r.revenue)}</td>
                          <td className="px-3 py-2.5 text-xs" style={{ color: '#3B82F6' }}>{fmtCFA(r.cc_carburant ?? 0)}</td>
                          <td className="px-3 py-2.5 text-xs" style={{ color: '#F59E0B' }}>{fmtCFA(r.cc_ration ?? 0)}</td>
                          <td className="px-3 py-2.5 text-xs" style={{ color: '#10B981' }}>{fmtCFA(r.cc_peage ?? 0)}</td>
                          <td className="px-3 py-2.5 text-xs" style={{ color: '#6366F1' }}>{fmtCFA(r.cc_autres ?? 0)}</td>
                          <td className="px-3 py-2.5 text-xs font-semibold" style={{ color: '#EF4444' }}>{fmtCFA(r.total_expense ?? 0)}</td>
                          <td className="px-3 py-2.5 text-xs font-bold" style={{ color: r.margin >= 0 ? '#10B981' : '#EF4444' }}>{fmtCFA(r.margin)}</td>
                          <td className="px-3 py-2.5">
                            <span className="text-xs font-semibold" style={{ color: mp >= 0 ? '#10B981' : '#EF4444' }}>{mp.toFixed(1)}%</span>
                          </td>
                        </tr>
                        {open && (
                          <tr className="border-t" style={{ borderColor: 'var(--border)' }}>
                            <td colSpan={10} className="p-0">
                              <div style={{ position: 'sticky', left: 0, width: linesBoxWidth || undefined }}>
                              <RouteDeparturesDetail routeId={r.route_id} routeName={r.route_name} dateFrom={dateFrom} dateTo={dateTo}
                                expectedTrips={Number(r.trip_count)} expectedRevenue={Number(r.revenue)} expectedExpenses={Number(r.total_expense ?? 0)}
                                onClose={() => setOpenRouteId(null)} />
                              </div>
                            </td>
                          </tr>
                        )}
                        </React.Fragment>
                      );
                    })}
                    {routesShown.length === 0 && emptyRow(10, routes.length > 0)}
                  </tbody>
                </table>
              </div>
              {pager(pRoutes, 'lignes')}
              </>
            )}

            {activeTab === 'chauffeurs' && (
              <>
              {searchBar('Chauffeur, matricule ou bus…', driversShown.length, drivers.length)}
              <div className="rounded-2xl border overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                      {['Chauffeur', 'Bus', 'Voyages', 'Recettes', 'Carb. compl.', 'Rations', 'Péages', 'Autr. dép. (GCH)', 'Total charges', 'Marge'].map(h => (
                        <th key={h} className="text-left px-3 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pDrivers.pageItems.map(d => {
                      const marg = Number(d.revenue) - Number(d.expense_total);
                      return (
                        <tr key={d.driver_id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                          <td className="px-3 py-2.5 text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{d.first_name} {d.last_name}</td>
                          <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{d.bus_registration || '—'}</td>
                          <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{d.trip_count}</td>
                          <td className="px-3 py-2.5 text-xs font-semibold" style={{ color: '#10B981' }}>{fmtCFA(d.revenue)}</td>
                          <td className="px-3 py-2.5 text-xs" style={{ color: '#3B82F6' }}>{fmtCFA(d.cc_carburant ?? 0)}</td>
                          <td className="px-3 py-2.5 text-xs" style={{ color: '#F59E0B' }}>{fmtCFA(d.cc_ration ?? 0)}</td>
                          <td className="px-3 py-2.5 text-xs" style={{ color: '#10B981' }}>{fmtCFA(d.cc_peage ?? 0)}</td>
                          <td className="px-3 py-2.5 text-xs" style={{ color: '#6366F1' }}>{fmtCFA(d.cc_autres ?? 0)}</td>
                          <td className="px-3 py-2.5 text-xs font-semibold" style={{ color: '#EF4444' }}>{fmtCFA(d.expense_total)}</td>
                          <td className="px-3 py-2.5 text-xs font-bold" style={{ color: marg >= 0 ? '#10B981' : '#EF4444' }}>{fmtCFA(marg)}</td>
                        </tr>
                      );
                    })}
                    {driversShown.length === 0 && emptyRow(10, drivers.length > 0)}
                  </tbody>
                </table>
              </div>
              {pager(pDrivers, 'chauffeurs')}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
