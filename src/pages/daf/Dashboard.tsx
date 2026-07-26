import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../services/supabase';
import {
  TrendingUp, TrendingDown, Building2, Bus, Users, Route,
  RefreshCw, Download, BarChart2, Target, DollarSign,
  AlertTriangle, ArrowUpRight, ArrowDownRight, ChevronDown, ChevronUp,
  Activity, Fuel, Wrench, Package, ShoppingCart, FileText, ArrowRight,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend, Cell,
} from 'recharts';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, startOfYear, endOfYear } from 'date-fns';
import { fr } from 'date-fns/locale';
import * as XLSX from 'xlsx';
import { buildCompanyGroups, resolveCompanyIds } from '../../utils/companyGroups';
import type { CompanyWithHierarchy } from '../../utils/companyGroups';

// ── Formatters ───────────────────────────────────────────────
const fmtN = (n: number) => new Intl.NumberFormat('fr-CI', { maximumFractionDigits: 0 }).format(n);
const fmt  = (n: number) => fmtN(n) + ' FCFA';
const fmtM = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(0) + 'k';
  return String(Math.round(n));
};

// ── Types ────────────────────────────────────────────────────
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
  vehicle_expenses_amount: number;
  fuel_carburant_comptable: number;
  trip_count: number;
  active_bus_count: number;
  driver_count: number;
  company_count: number;
}

interface CompanyRow {
  company_id: string;
  company_name: string;
  company_code: string;
  parent_id: string | null;
  is_group: boolean;
  revenue: number;
  cc_carburant: number;
  cc_ration: number;
  cc_peage: number;
  fuel_enlev: number;
  expense_reparation: number;
  expense_autres: number;
  expense_charge_stock: number;
  vehicle_exp: number;
  fuel_carburant_comptable: number;
  total_expense: number;
  margin: number;
  trip_count: number;
  bus_count: number;
  driver_count: number;
}

interface BusRow {
  bus_id: string;
  registration_number: string;
  model: string;
  company_id: string;
  company_name: string;
  trip_count: number;
  revenue: number;
  cc_carburant: number;
  cc_ration: number;
  cc_peage: number;
  fuel_enlev: number;
  expense_reparation: number;
  expense_autres: number;
  expense_charge_stock: number;
  vehicle_exp: number;
  fuel_carburant_comptable: number;
  total_expense: number;
  margin: number;
}

interface DaySeries { day: string; revenue: number; expenses: number; trip_count: number; }

// ── Period presets ────────────────────────────────────────────
const PERIODS = [
  { label: 'Journalier',   id: 'jour' },
  { label: 'Hebdomadaire', id: 'semaine' },
  { label: 'Mensuel',      id: 'mois' },
  { label: 'Annuel',       id: 'annee' },
];

function getDateRange(id: string, customFrom: string, customTo: string) {
  const today = new Date();
  const f = (d: Date) => format(d, 'yyyy-MM-dd');
  switch (id) {
    case 'custom':  return { from: customFrom, to: customTo };
    case 'jour':    return { from: f(today), to: f(today) };
    case 'semaine': return { from: f(startOfWeek(today, { weekStartsOn: 1 })), to: f(endOfWeek(today, { weekStartsOn: 1 })) };
    case 'annee':   return { from: f(startOfYear(today)), to: f(endOfYear(today)) };
    case 'mois':
    default:        return { from: f(startOfMonth(today)), to: f(endOfMonth(today)) };
  }
}

function perf(margin: number, revenue: number) {
  if (revenue === 0) return { label: 'Inactif',        color: '#6B7280', bg: '#F3F4F6' };
  const p = revenue > 0 ? (margin / revenue) * 100 : -100;
  if (p >= 30)  return { label: 'Très rentable',  color: '#16A34A', bg: '#DCFCE7' };
  if (p >= 15)  return { label: 'Rentable',        color: '#2563EB', bg: '#DBEAFE' };
  if (p >= 0)   return { label: 'Moyen',           color: '#D97706', bg: '#FEF3C7' };
  if (p >= -20) return { label: 'Déficitaire',     color: '#DC2626', bg: '#FEE2E2' };
  return         { label: 'Critique',         color: '#7F1D1D', bg: '#FEE2E2' };
}

// ── Main component ────────────────────────────────────────────
export default function DAFDashboard() {
  const navigate = useNavigate();
  const [periodId,   setPeriodId]   = useState('mois');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo,   setCustomTo]   = useState('');

  const [companies,   setCompanies]   = useState<CompanyWithHierarchy[]>([]);
  const [filterCoId,  setFilterCoId]  = useState<string>('all');
  const [activeTab,   setActiveTab]   = useState<'synthese' | 'societes' | 'bus' | 'charges'>('synthese');
  const [expandedCo,  setExpandedCo]  = useState<string | null>(null);

  const [kpis,       setKpis]       = useState<KPIs | null>(null);
  const [compRows,   setCompRows]   = useState<CompanyRow[]>([]);
  const [busRows,    setBusRows]    = useState<BusRow[]>([]);
  const [series,     setSeries]     = useState<DaySeries[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Load company list once
  useEffect(() => {
    supabase.rpc('get_daf_company_list').then(({ data }) => {
      if (data) setCompanies(data as CompanyWithHierarchy[]);
    });
  }, []);

  const { from: dateFrom, to: dateTo } = getDateRange(periodId, customFrom, customTo);

  const resolvedIds: string[] = (() => {
    if (filterCoId === 'all') return companies.map(c => c.id);
    return resolveCompanyIds(filterCoId, companies);
  })();

  const load = useCallback(async (silent = false) => {
    if (resolvedIds.length === 0) return;
    if (!silent) setLoading(true); else setRefreshing(true);

    const [kpiRes, compRes, busRes, serRes] = await Promise.all([
      supabase.rpc('get_daf_consolidated_kpis', { p_company_ids: resolvedIds, p_date_from: dateFrom, p_date_to: dateTo }),
      supabase.rpc('get_daf_kpis_by_company',   { p_company_ids: resolvedIds, p_date_from: dateFrom, p_date_to: dateTo }),
      supabase.rpc('get_daf_revenue_by_bus',     { p_company_ids: resolvedIds, p_date_from: dateFrom, p_date_to: dateTo }),
      supabase.rpc('get_daf_daily_series',       { p_company_ids: resolvedIds, p_date_from: dateFrom, p_date_to: dateTo }),
    ]);

    if (kpiRes.data) {
      const raw = kpiRes.data as Record<string, unknown>;
      setKpis({
        total_revenue: Number(raw.total_revenue ?? 0),
        cc_carburant_complement: Number(raw.cc_carburant_complement ?? 0),
        cc_ration: Number(raw.cc_ration ?? 0),
        cc_peage: Number(raw.cc_peage ?? 0),
        cc_autres: Number(raw.cc_autres ?? 0),
        fuel_enlevements_amount: Number(raw.fuel_enlevements_amount ?? 0),
        expense_reparation: Number(raw.expense_reparation ?? 0),
        expense_autres: Number(raw.expense_autres ?? 0),
        expense_charge_stock: Number(raw.expense_charge_stock ?? 0),
        vehicle_expenses_amount: Number(raw.vehicle_expenses_amount ?? 0),
        fuel_carburant_comptable: Number(raw.fuel_carburant_comptable ?? 0),
        trip_count: Number(raw.trip_count ?? 0),
        active_bus_count: Number(raw.active_bus_count ?? 0),
        driver_count: Number(raw.driver_count ?? 0),
        company_count: Number(raw.company_count ?? 0),
      });
    }
    if (compRes.data) {
      const rows = (compRes.data as Record<string, unknown>[]).map(r => {
        const row: CompanyRow = {
          company_id: r.company_id as string,
          company_name: r.company_name as string,
          company_code: r.company_code as string,
          parent_id: r.parent_id as string | null,
          is_group: Boolean(r.is_group),
          revenue: Number(r.revenue ?? 0),
          cc_carburant: Number(r.cc_carburant ?? 0),
          cc_ration: Number(r.cc_ration ?? 0),
          cc_peage: Number(r.cc_peage ?? 0),
          fuel_enlev: Number(r.fuel_enlev ?? 0),
          expense_reparation: Number(r.expense_reparation ?? 0),
          expense_autres: Number(r.expense_autres ?? 0),
          expense_charge_stock: Number(r.expense_charge_stock ?? 0),
          vehicle_exp: Number(r.vehicle_exp ?? 0),
          fuel_carburant_comptable: Number(r.fuel_carburant_comptable ?? 0),
          trip_count: Number(r.trip_count ?? 0),
          bus_count: Number(r.bus_count ?? 0),
          driver_count: Number(r.driver_count ?? 0),
          total_expense: 0,
          margin: 0,
        };
        row.total_expense = row.cc_carburant + row.cc_ration + row.cc_peage + row.fuel_enlev
          + row.expense_reparation + row.expense_autres + row.expense_charge_stock + row.vehicle_exp + row.fuel_carburant_comptable;
        row.margin = row.revenue - row.total_expense;
        return row;
      });
      setCompRows(rows);
    }
    if (busRes.data) {
      setBusRows((busRes.data as Record<string, unknown>[]).map(r => {
        const revenue = Number(r.revenue ?? 0);
        const cc_carburant = Number(r.cc_carburant ?? 0);
        const cc_ration = Number(r.cc_ration ?? 0);
        const cc_peage = Number(r.cc_peage ?? 0);
        const fuel_enlev = Number(r.fuel_enlev ?? 0);
        const expense_reparation = Number(r.expense_reparation ?? 0);
        const expense_autres = Number(r.expense_autres ?? 0);
        const expense_charge_stock = Number(r.expense_charge_stock ?? 0);
        const vehicle_exp = Number(r.vehicle_exp ?? 0);
        const fuel_carburant_comptable = Number(r.fuel_carburant_comptable ?? 0);
        const total_expense = cc_carburant + cc_ration + cc_peage + fuel_enlev
          + expense_reparation + expense_autres + expense_charge_stock + vehicle_exp + fuel_carburant_comptable;
        return {
          bus_id: r.bus_id as string,
          registration_number: r.registration_number as string,
          model: r.model as string,
          company_id: r.company_id as string,
          company_name: r.company_name as string,
          trip_count: Number(r.trip_count ?? 0),
          revenue, cc_carburant, cc_ration, cc_peage, fuel_enlev,
          expense_reparation, expense_autres, expense_charge_stock, vehicle_exp, fuel_carburant_comptable,
          total_expense, margin: revenue - total_expense,
        };
      }));
    }
    if (serRes.data) {
      setSeries((serRes.data as Record<string, unknown>[]).map(d => ({
        day: d.day as string,
        revenue: Number(d.revenue ?? 0),
        expenses: Number(d.expenses ?? 0),
        trip_count: Number(d.trip_count ?? 0),
      })));
    }

    setLoading(false);
    setRefreshing(false);
  }, [resolvedIds.join(','), dateFrom, dateTo]); // eslint-disable-line

  useEffect(() => { if (resolvedIds.length > 0) load(); }, [load]); // eslint-disable-line

  // ── Derived metrics ────────────────────────────────────────
  const guichetCharges = kpis ? kpis.cc_carburant_complement + kpis.cc_ration + kpis.cc_peage + kpis.cc_autres : 0;
  const guichetResult  = kpis ? kpis.total_revenue - guichetCharges : 0;
  const totalExpenses  = kpis
    ? guichetCharges + kpis.fuel_enlevements_amount + kpis.expense_reparation
      + kpis.expense_autres + (kpis.expense_charge_stock ?? 0) + kpis.vehicle_expenses_amount + kpis.fuel_carburant_comptable
    : 0;
  const brutResult = guichetResult - (kpis
    ? kpis.fuel_enlevements_amount + kpis.expense_reparation + kpis.expense_autres
      + (kpis.expense_charge_stock ?? 0) + kpis.vehicle_expenses_amount + kpis.fuel_carburant_comptable
    : 0);
  const marginPct = kpis && kpis.total_revenue > 0 ? (brutResult / kpis.total_revenue) * 100 : 0;

  const chartData = series.map(d => ({
    date:     format(new Date(d.day + 'T00:00:00'), 'dd/MM', { locale: fr }),
    Recettes: Number(d.revenue),
    Charges:  Number(d.expenses),
    Résultat: Number(d.revenue) - Number(d.expenses),
  }));

  const expBreakdown = kpis ? [
    { name: 'Carburant compl.', val: kpis.cc_carburant_complement,   color: '#3B82F6' },
    { name: 'Rations',          val: kpis.cc_ration,                  color: '#F59E0B' },
    { name: 'Péages guichet',   val: kpis.cc_peage,                   color: '#10B981' },
    { name: 'Autres charges',   val: kpis.cc_autres,                  color: '#A855F7' },
    { name: 'Carburant cuve',   val: kpis.fuel_enlevements_amount,    color: '#F97316' },
    { name: 'Autres dép.',      val: kpis.expense_reparation,         color: '#EF4444' },
    { name: 'Articles stock',   val: kpis.expense_autres,             color: '#8B5CF6' },
    { name: 'Charge stock',    val: kpis.expense_charge_stock ?? 0,  color: '#7C3AED' },
    { name: 'Charges achat',    val: kpis.vehicle_expenses_amount,    color: '#06B6D4' },
    { name: 'Carb. agent',      val: kpis.fuel_carburant_comptable,   color: '#D97706' },
  ].filter(e => e.val > 0) : [];

  const compBarData = compRows
    .filter(c => !c.is_group && c.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10)
    .map(c => ({ name: c.company_code || c.company_name.slice(0, 12), revenue: c.revenue, charges: c.total_expense, marge: c.margin }));

  const topBuses    = [...busRows].sort((a, b) => b.margin - a.margin).slice(0, 5);
  const defBuses    = [...busRows].filter(b => b.margin < 0).sort((a, b) => a.margin - b.margin).slice(0, 5);

  const { groups, standalone } = buildCompanyGroups(companies);

  // ── Export Excel ───────────────────────────────────────────
  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
      'Recettes totales': kpis?.total_revenue ?? 0,
      'Carburant compl. (guichet)': kpis?.cc_carburant_complement ?? 0,
      'Rations (guichet)': kpis?.cc_ration ?? 0,
      'Péages (guichet)': kpis?.cc_peage ?? 0,
      'Total charges guichetier': guichetCharges,
      'Résultat guichetier': guichetResult,
      'Carburant cuve': kpis?.fuel_enlevements_amount ?? 0,
      'Autres dépenses (comptable)': kpis?.expense_reparation ?? 0,
      'Articles stock (comptable)': kpis?.expense_autres ?? 0,
      'Charge stock': kpis?.expense_charge_stock ?? 0,
      'Charges achat': kpis?.vehicle_expenses_amount ?? 0,
      'Charge carburant (agent)': kpis?.fuel_carburant_comptable ?? 0,
      'Total charges': totalExpenses,
      'Résultat brut': brutResult,
      'Marge %': marginPct.toFixed(2),
      'Voyages': kpis?.trip_count ?? 0,
      'Bus actifs': kpis?.active_bus_count ?? 0,
      'Chauffeurs': kpis?.driver_count ?? 0,
    }]), 'KPI Consolidés');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      compRows.map(c => ({
        Société: c.company_name, Code: c.company_code,
        Recettes: c.revenue, 'Total charges': c.total_expense, Marge: c.margin,
        'Carb. compl.': c.cc_carburant, Rations: c.cc_ration, Péages: c.cc_peage,
        'Carb. cuve': c.fuel_enlev, 'Autres dép.': c.expense_reparation,
        'Articles stock': c.expense_autres, 'Charge stock': c.expense_charge_stock, 'Charges achat': c.vehicle_exp,
        'Carb. agent': c.fuel_carburant_comptable,
        Voyages: c.trip_count, Bus: c.bus_count, Chauffeurs: c.driver_count,
      }))
    ), 'Par société');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      busRows.map(b => ({
        Immatriculation: b.registration_number, Modèle: b.model, Société: b.company_name,
        Voyages: b.trip_count, Recettes: b.revenue, 'Total charges': b.total_expense, Marge: b.margin,
        'Carb. compl.': b.cc_carburant, Rations: b.cc_ration, Péages: b.cc_peage,
        'Carb. cuve': b.fuel_enlev, 'Autres dép.': b.expense_reparation,
        'Articles stock': b.expense_autres, 'Charge stock': b.expense_charge_stock, 'Charges achat': b.vehicle_exp,
        'Carb. agent': b.fuel_carburant_comptable,
      }))
    ), 'Par bus');
    XLSX.writeFile(wb, `daf_consolidé_${dateFrom}_${dateTo}.xlsx`);
  };

  // ── Render ─────────────────────────────────────────────────
  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-10 h-10 border-4 rounded-full animate-spin" style={{ borderColor: '#0B7439', borderTopColor: 'transparent' }} />
    </div>
  );

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1600px] mx-auto">

      {/* ── Header ── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Tableau de bord DAF</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            Vue consolidée — {dateFrom === dateTo ? dateFrom : `${dateFrom} → ${dateTo}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => load(true)} disabled={refreshing}
            className="p-2 rounded-xl border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} style={{ color: 'var(--text-secondary)' }} />
          </button>
          <button onClick={exportExcel}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium"
            style={{ backgroundColor: '#16A34A', color: '#fff' }}>
            <Download className="w-4 h-4" /> Export Excel
          </button>
        </div>
      </div>

      {/* ── Filters bar ── */}
      <div className="rounded-2xl border p-4 flex flex-wrap gap-3 items-center"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        {/* Period */}
        <div className="flex rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          {PERIODS.map(p => (
            <button key={p.id} onClick={() => setPeriodId(p.id)}
              className="px-3 py-1.5 text-sm font-medium transition-colors"
              style={{ backgroundColor: periodId === p.id ? '#0B7439' : 'var(--surface)', color: periodId === p.id ? '#fff' : 'var(--text-secondary)' }}>
              {p.label}
            </button>
          ))}
          <button onClick={() => setPeriodId('custom')}
            className="px-3 py-1.5 text-sm font-medium transition-colors"
            style={{ backgroundColor: periodId === 'custom' ? '#0B7439' : 'var(--surface)', color: periodId === 'custom' ? '#fff' : 'var(--text-secondary)' }}>
            Personnalisé
          </button>
        </div>
        {periodId === 'custom' && (
          <>
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              className="px-3 py-1.5 border rounded-lg text-sm"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
            <span style={{ color: 'var(--text-muted)' }}>→</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              className="px-3 py-1.5 border rounded-lg text-sm"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
          </>
        )}
        {/* Company filter */}
        <select value={filterCoId} onChange={e => setFilterCoId(e.target.value)}
          className="px-3 py-1.5 border rounded-xl text-sm ml-auto"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}>
          <option value="all">Toutes les sociétés</option>
          {groups.map(g => (
            <optgroup key={g.group.id} label={g.group.name}>
              <option value={g.group.id}>{g.group.name} (groupe)</option>
              {g.subsidiaries.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </optgroup>
          ))}
          {standalone.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* ── KPI Row 1 — results ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total recettes"    value={fmt(kpis?.total_revenue ?? 0)}  icon={<DollarSign className="w-5 h-5" />}   color="#10B981" positive />
        <KpiCard label="Total charges"     value={fmt(totalExpenses)}              icon={<TrendingDown className="w-5 h-5" />} color="#EF4444" positive={false} />
        <KpiCard label="Résultat brut"     value={fmt(brutResult)}                 icon={<Target className="w-5 h-5" />}       color={brutResult >= 0 ? '#10B981' : '#EF4444'} positive={brutResult >= 0} />
        <KpiCard label={`Marge nette`}     value={`${marginPct.toFixed(1)}%`}      icon={<BarChart2 className="w-5 h-5" />}    color={marginPct >= 0 ? '#10B981' : '#EF4444'} positive={marginPct >= 0} />
      </div>

      {/* ── KPI Row 2 — opérationnel ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Sociétés actives', val: kpis?.company_count ?? 0, icon: <Building2 className="w-4 h-4" />, color: '#3B82F6' },
          { label: 'Bus actifs',       val: kpis?.active_bus_count ?? 0, icon: <Bus className="w-4 h-4" />,      color: '#10B981' },
          { label: 'Voyages',          val: kpis?.trip_count ?? 0,     icon: <Route className="w-4 h-4" />,      color: '#F59E0B' },
          { label: 'Chauffeurs',       val: kpis?.driver_count ?? 0,   icon: <Users className="w-4 h-4" />,      color: '#06B6D4' },
        ].map(k => (
          <div key={k.label} className="rounded-xl border p-4 flex items-center gap-3"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: k.color + '20', color: k.color }}>
              {k.icon}
            </div>
            <div>
              <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{fmtN(k.val)}</p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{k.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── KPI Row 3 — charges détail ── */}
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Détail des charges</p>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          {[
            { label: 'Carb. compl.',  val: kpis?.cc_carburant_complement ?? 0, color: '#3B82F6', icon: <Fuel className="w-3.5 h-3.5" /> },
            { label: 'Rations',       val: kpis?.cc_ration ?? 0,               color: '#F59E0B', icon: <Activity className="w-3.5 h-3.5" /> },
            { label: 'Péages',        val: kpis?.cc_peage ?? 0,                color: '#10B981', icon: <Route className="w-3.5 h-3.5" /> },
            { label: 'Carb. cuve',    val: kpis?.fuel_enlevements_amount ?? 0, color: '#F97316', icon: <Fuel className="w-3.5 h-3.5" /> },
            { label: 'Autres dép.',   val: kpis?.expense_reparation ?? 0,      color: '#EF4444', icon: <Wrench className="w-3.5 h-3.5" /> },
            { label: 'Articles stock',val: kpis?.expense_autres ?? 0,          color: '#8B5CF6', icon: <Package className="w-3.5 h-3.5" /> },
            { label: 'Charge stock', val: kpis?.expense_charge_stock ?? 0,   color: '#7C3AED', icon: <Package className="w-3.5 h-3.5" /> },
            { label: 'Charges achat', val: kpis?.vehicle_expenses_amount ?? 0, color: '#06B6D4', icon: <ShoppingCart className="w-3.5 h-3.5" /> },
            { label: 'Carb. agent',   val: kpis?.fuel_carburant_comptable ?? 0,color: '#D97706', icon: <Fuel className="w-3.5 h-3.5" /> },
          ].map(k => (
            <div key={k.label} className="rounded-xl border p-3"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-1.5 mb-1">
                <span style={{ color: k.color }}>{k.icon}</span>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{k.label}</p>
              </div>
              <p className="text-sm font-bold" style={{ color: k.color }}>{fmt(k.val)}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {totalExpenses > 0 ? ((k.val / totalExpenses) * 100).toFixed(1) + '%' : '—'}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Charts ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Time series */}
        <div className="lg:col-span-2 rounded-2xl border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Évolution Recettes vs Charges guichetier</h3>
          {chartData.length === 0 ? (
            <div className="flex items-center justify-center h-52 text-sm" style={{ color: 'var(--text-muted)' }}>Aucune donnée sur la période</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="dafRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="dafExp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#EF4444" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={v => fmtM(v as number)} width={48} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="Recettes" stroke="#10B981" fill="url(#dafRev)" strokeWidth={2} />
                <Area type="monotone" dataKey="Charges"  stroke="#EF4444" fill="url(#dafExp)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Expense breakdown */}
        <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Répartition des charges</h3>
          <div className="space-y-2.5">
            {expBreakdown.map(e => (
              <div key={e.name}>
                <div className="flex justify-between text-xs mb-0.5">
                  <span style={{ color: 'var(--text-secondary)' }}>{e.name}</span>
                  <span className="font-semibold" style={{ color: e.color }}>{fmt(e.val)}</span>
                </div>
                <div className="h-1.5 rounded-full" style={{ backgroundColor: 'var(--border)' }}>
                  <div className="h-1.5 rounded-full transition-all"
                    style={{ backgroundColor: e.color, width: `${totalExpenses > 0 ? Math.min((e.val / totalExpenses) * 100, 100) : 0}%` }} />
                </div>
              </div>
            ))}
            {expBreakdown.length === 0 && <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>Aucune charge</p>}
          </div>
        </div>
      </div>

      {/* Comparison chart */}
      {compBarData.length > 1 && (
        <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Recettes vs Charges par société</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={compBarData} margin={{ top: 0, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={v => fmtM(v as number)} width={48} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="revenue"  name="Recettes" fill="#10B981" radius={[3, 3, 0, 0]} />
              <Bar dataKey="charges"  name="Charges"  fill="#EF4444" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Detail tabs ── */}
      <div>
        <div className="flex gap-1 border-b mb-4" style={{ borderColor: 'var(--border)' }}>
          {([
            { id: 'synthese',  label: 'Synthèse P&L' },
            { id: 'societes',  label: 'Par société' },
            { id: 'bus',       label: 'Par bus' },
            { id: 'charges',   label: 'Analyse charges' },
          ] as const).map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className="px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors"
              style={{ borderBottomColor: activeTab === t.id ? '#0B7439' : 'transparent', color: activeTab === t.id ? '#0B7439' : 'var(--text-secondary)' }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Synthèse P&L ── */}
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
                  { label: 'Recettes totales',           val: kpis?.total_revenue ?? 0,           bold: true,  colorKey: 'rev' },
                  { label: '  Carburant compl. (guichet)',val: kpis?.cc_carburant_complement ?? 0, bold: false, colorKey: 'exp' },
                  { label: '  Rations (guichet)',         val: kpis?.cc_ration ?? 0,               bold: false, colorKey: 'exp' },
                  { label: '  Péages (guichet)',          val: kpis?.cc_peage ?? 0,                bold: false, colorKey: 'exp' },
                  { label: 'Résultat guichetier',         val: guichetResult,                      bold: true,  colorKey: 'res', res: guichetResult },
                  { label: '  Carburant cuve',            val: kpis?.fuel_enlevements_amount ?? 0, bold: false, colorKey: 'exp' },
                  { label: '  Autres dép. (comptable)',   val: kpis?.expense_reparation ?? 0,      bold: false, colorKey: 'exp' },
                  { label: '  Articles stock (comptable)',val: kpis?.expense_autres ?? 0,          bold: false, colorKey: 'exp' },
                  { label: '  Charge stock (GP)',         val: kpis?.expense_charge_stock ?? 0,    bold: false, colorKey: 'exp' },
                  { label: '  Charges achat',             val: kpis?.vehicle_expenses_amount ?? 0, bold: false, colorKey: 'exp' },
                  { label: '  Charge carburant (agent)',  val: kpis?.fuel_carburant_comptable ?? 0,bold: false, colorKey: 'exp' },
                  { label: 'Résultat brut',               val: brutResult,                         bold: true,  colorKey: 'brut', res: brutResult },
                  { label: 'Total charges',               val: totalExpenses,                      bold: true,  colorKey: 'tot' },
                ].map((row, i) => {
                  const color = row.colorKey === 'rev' ? '#10B981'
                    : row.colorKey === 'exp' ? 'var(--text-secondary)'
                    : row.colorKey === 'tot' ? '#EF4444'
                    : (row.res ?? 0) >= 0 ? '#3B82F6' : '#EF4444';
                  return (
                    <tr key={i} className="border-t" style={{ borderColor: 'var(--border)', fontWeight: row.bold ? 700 : 400 }}>
                      <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-primary)', paddingLeft: row.label.startsWith('  ') ? 32 : undefined }}>{row.label.trim()}</td>
                      <td className="px-4 py-2.5 text-xs font-semibold" style={{ color }}>{fmt(row.val)}</td>
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

        {/* ── Par société ── */}
        {activeTab === 'societes' && (
          <div className="rounded-2xl border overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                  {['Société', 'Recettes', 'Charges', 'Résultat', 'Marge %', 'Carb. cuve', 'Autres dép.', 'Articles stock', 'Charge stock', 'Charges achat', 'Voyages', 'Bus', 'Chauf.'].map(h => (
                    <th key={h} className="text-left px-3 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {compRows.map(c => {
                  const mp = c.revenue > 0 ? (c.margin / c.revenue) * 100 : 0;
                  const badge = perf(c.margin, c.revenue);
                  const hasChildren = companies.some(x => x.parent_id === c.company_id);
                  return (
                    <React.Fragment key={c.company_id}>
                      <tr className="border-t" style={{ borderColor: 'var(--border)', fontWeight: c.is_group ? 700 : 400 }}>
                        <td className="px-3 py-2.5 text-xs">
                          <div className="flex items-center gap-1.5">
                            {c.is_group && (
                              <button onClick={() => setExpandedCo(expandedCo === c.company_id ? null : c.company_id)}
                                className="w-4 h-4 flex-shrink-0">
                                {expandedCo === c.company_id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                              </button>
                            )}
                            {!c.is_group && <div className="w-4" />}
                            <span style={{ color: c.is_group ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                              {c.company_name}
                            </span>
                            {c.is_group && <span className="text-xs px-1 rounded" style={{ backgroundColor: '#0B743920', color: '#0B7439' }}>Groupe</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-xs font-semibold" style={{ color: '#10B981' }}>{fmtN(c.revenue)}</td>
                        <td className="px-3 py-2.5 text-xs font-semibold" style={{ color: '#EF4444' }}>{fmtN(c.total_expense)}</td>
                        <td className="px-3 py-2.5 text-xs font-bold" style={{ color: c.margin >= 0 ? '#10B981' : '#EF4444' }}>{fmtN(c.margin)}</td>
                        <td className="px-3 py-2.5">
                          <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full"
                            style={{ backgroundColor: badge.bg, color: badge.color }}>{mp.toFixed(1)}%</span>
                        </td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: '#F97316' }}>{fmtN(c.fuel_enlev)}</td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: '#EF4444' }}>{fmtN(c.expense_reparation)}</td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: '#8B5CF6' }}>{fmtN(c.expense_autres)}</td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: '#7C3AED' }}>{fmtN(c.expense_charge_stock)}</td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: '#06B6D4' }}>{fmtN(c.vehicle_exp)}</td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{c.trip_count}</td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{c.bus_count}</td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{c.driver_count}</td>
                      </tr>
                    </React.Fragment>
                  );
                })}
                {compRows.length === 0 && <tr><td colSpan={13} className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>Aucune donnée</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Par bus ── */}
        {activeTab === 'bus' && (
          <div className="space-y-4">
            {/* Top / Deficit summary */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-2xl border p-4" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
                <h4 className="text-sm font-semibold mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                  <TrendingUp className="w-4 h-4" style={{ color: '#10B981' }} /> Top 5 bus rentables
                </h4>
                {topBuses.map(b => (
                  <div key={b.bus_id} className="flex items-center gap-3 py-1.5">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#DCFCE7' }}>
                      <Bus className="w-3.5 h-3.5" style={{ color: '#16A34A' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{b.registration_number}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{b.company_name}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold flex items-center gap-0.5" style={{ color: '#10B981' }}>
                        <ArrowUpRight className="w-3.5 h-3.5" />{fmt(b.margin)}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{b.revenue > 0 ? ((b.margin / b.revenue) * 100).toFixed(1) + '%' : '—'}</p>
                    </div>
                  </div>
                ))}
                {topBuses.length === 0 && <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>Aucun bus</p>}
              </div>
              <div className="rounded-2xl border p-4" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
                <h4 className="text-sm font-semibold mb-3 flex items-center gap-1.5" style={{ color: '#EF4444' }}>
                  <AlertTriangle className="w-4 h-4" /> Bus déficitaires
                </h4>
                {defBuses.length === 0 ? (
                  <p className="text-xs text-center py-4" style={{ color: '#10B981' }}>Tous les bus sont rentables</p>
                ) : defBuses.map(b => (
                  <div key={b.bus_id} className="flex items-center gap-3 py-1.5">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#FEE2E2' }}>
                      <Bus className="w-3.5 h-3.5" style={{ color: '#EF4444' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{b.registration_number}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{b.company_name}</p>
                    </div>
                    <p className="text-sm font-bold flex items-center gap-0.5" style={{ color: '#EF4444' }}>
                      <ArrowDownRight className="w-3.5 h-3.5" />{fmt(Math.abs(b.margin))}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Full bus table */}
            <div className="rounded-2xl border overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                    {['Bus', 'Société', 'Voyages', 'Recettes', 'Carb.compl.', 'Rations', 'Péages', 'Carb.cuve', 'Autres dép.', 'Art.stock', 'Ch.stock', 'Ch.achat', 'Carb.agent', 'Total ch.', 'Marge', 'Statut'].map(h => (
                      <th key={h} className="text-left px-3 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {busRows.map(b => {
                    const badge = perf(b.margin, b.revenue);
                    const mp = b.revenue > 0 ? (b.margin / b.revenue * 100) : 0;
                    return (
                      <tr key={b.bus_id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                        <td className="px-3 py-2.5 text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{b.registration_number}</td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{b.company_name}</td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{b.trip_count}</td>
                        <td className="px-3 py-2.5 text-xs font-semibold" style={{ color: '#10B981' }}>{fmtN(b.revenue)}</td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: '#3B82F6' }}>{fmtN(b.cc_carburant)}</td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: '#F59E0B' }}>{fmtN(b.cc_ration)}</td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: '#10B981' }}>{fmtN(b.cc_peage)}</td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: '#F97316' }}>{fmtN(b.fuel_enlev)}</td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: '#EF4444' }}>{fmtN(b.expense_reparation)}</td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: '#8B5CF6' }}>{fmtN(b.expense_autres)}</td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: '#7C3AED' }}>{fmtN(b.expense_charge_stock)}</td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: '#06B6D4' }}>{fmtN(b.vehicle_exp)}</td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: '#D97706' }}>{fmtN(b.fuel_carburant_comptable)}</td>
                        <td className="px-3 py-2.5 text-xs font-semibold" style={{ color: '#EF4444' }}>{fmtN(b.total_expense)}</td>
                        <td className="px-3 py-2.5 text-xs font-bold" style={{ color: b.margin >= 0 ? '#10B981' : '#EF4444' }}>{fmtN(b.margin)}</td>
                        <td className="px-3 py-2.5">
                          <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full"
                            style={{ backgroundColor: badge.bg, color: badge.color }}>{badge.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                  {busRows.length === 0 && <tr><td colSpan={16} className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>Aucune donnée</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Analyse charges ── */}
        {activeTab === 'charges' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Charges by company bar */}
              {compBarData.length > 0 && (
                <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
                  <h4 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Marge par société</h4>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={compBarData} layout="vertical" margin={{ top: 0, right: 20, bottom: 0, left: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} tickFormatter={v => fmtM(v as number)} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-primary)' }} />
                      <Tooltip formatter={(v: number) => fmt(v)} />
                      <Bar dataKey="marge" name="Marge" radius={[0, 4, 4, 0]}>
                        {compBarData.map((c, i) => <Cell key={i} fill={c.marge >= 0 ? '#10B981' : '#EF4444'} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Expense % breakdown table */}
              <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
                <h4 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Structure des charges (%)</h4>
                <div className="space-y-3">
                  {expBreakdown.map(e => (
                    <div key={e.name} className="flex items-center gap-3">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: e.color }} />
                      <div className="flex-1 text-xs" style={{ color: 'var(--text-secondary)' }}>{e.name}</div>
                      <div className="w-24 h-2 rounded-full" style={{ backgroundColor: 'var(--border)' }}>
                        <div className="h-2 rounded-full" style={{ backgroundColor: e.color, width: `${totalExpenses > 0 ? Math.min((e.val / totalExpenses) * 100, 100) : 0}%` }} />
                      </div>
                      <div className="text-xs font-semibold w-16 text-right" style={{ color: e.color }}>
                        {totalExpenses > 0 ? ((e.val / totalExpenses) * 100).toFixed(1) + '%' : '—'}
                      </div>
                      <div className="text-xs w-24 text-right" style={{ color: 'var(--text-muted)' }}>{fmt(e.val)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Charges detail per company table */}
            <div className="rounded-2xl border overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
                <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Détail des charges par société</h4>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                    {['Société', 'Carb.compl.', 'Rations', 'Péages', 'Carb.cuve', 'Autres dép.', 'Articles stock', 'Charge stock', 'Charges achat', 'Carb.agent', 'Total charges'].map(h => (
                      <th key={h} className="text-left px-3 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {compRows.map(c => (
                    <tr key={c.company_id} className="border-t" style={{ borderColor: 'var(--border)', fontWeight: c.is_group ? 600 : 400 }}>
                      <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-primary)' }}>{c.company_name}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#3B82F6' }}>{fmtN(c.cc_carburant)}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#F59E0B' }}>{fmtN(c.cc_ration)}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#10B981' }}>{fmtN(c.cc_peage)}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#F97316' }}>{fmtN(c.fuel_enlev)}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#EF4444' }}>{fmtN(c.expense_reparation)}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#8B5CF6' }}>{fmtN(c.expense_autres)}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#7C3AED' }}>{fmtN(c.expense_charge_stock)}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#06B6D4' }}>{fmtN(c.vehicle_exp)}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#D97706' }}>{fmtN(c.fuel_carburant_comptable)}</td>
                      <td className="px-3 py-2.5 text-xs font-semibold" style={{ color: '#EF4444' }}>{fmtN(c.total_expense)}</td>
                    </tr>
                  ))}
                  {compRows.length === 0 && <tr><td colSpan={11} className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>Aucune donnée</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Rapports & Analyses ── */}
      <div>
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#0B743915' }}>
            <BarChart2 className="w-5 h-5" style={{ color: '#0B7439' }} />
          </div>
          <div>
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Rapports & Analyses</h2>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Tableaux de bord et rapports detailles pour le pilotage de l'activite</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {([
            { icon: <BarChart2 className="w-5 h-5" />, bg: '#0B7439', title: 'Rapport financier', desc: 'Recettes, charges, marge par societe et par bus sur toute periode', path: '/daf/financial-report' },
            { icon: <Bus className="w-5 h-5" />,       bg: '#3B82F6', title: 'Performance bus',    desc: 'Rentabilite par bus, top/flop, analyse croisee societe-bus',   path: '/daf/bus-performance' },
            { icon: <Wrench className="w-5 h-5" />,    bg: '#DC2626', title: 'Pannes & Repartitions', desc: 'Suivi des pannes, repartition de recettes inter-societes',    path: '/daf/breakdowns' },
            { icon: <Package className="w-5 h-5" />,   bg: '#F59E0B', title: 'Rapport Courrier',   desc: 'Activite courrier par agence : enregistres, expedies, arrives et CA', path: '/daf/parcel-report' },
          ] as const).map(card => (
            <button
              key={card.path}
              onClick={() => navigate(card.path)}
              className="rounded-xl border p-5 text-left group transition-all hover:shadow-md"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
            >
              <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-3.5"
                style={{ backgroundColor: card.bg + '18', color: card.bg }}>
                {card.icon}
              </div>
              <h3 className="text-sm font-bold mb-1" style={{ color: 'var(--text-primary)' }}>{card.title}</h3>
              <p className="text-xs leading-relaxed mb-3" style={{ color: 'var(--text-secondary)' }}>{card.desc}</p>
              <span className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                style={{ backgroundColor: card.bg, color: '#fff' }}>
                Consulter <ArrowRight className="w-3.5 h-3.5" />
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── KpiCard ───────────────────────────────────────────────────
function KpiCard({ label, value, icon, color, positive }: {
  label: string; value: string; icon: React.ReactNode; color: string; positive: boolean;
}) {
  return (
    <div className="rounded-xl border p-4" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</p>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: color + '20', color }}>
          {icon}
        </div>
      </div>
      <p className="text-lg font-bold truncate" style={{ color }}>{value}</p>
      <div className="flex items-center gap-1 mt-1">
        {positive
          ? <TrendingUp className="w-3 h-3" style={{ color: '#10B981' }} />
          : <TrendingDown className="w-3 h-3" style={{ color: '#EF4444' }} />}
        <span className="text-xs" style={{ color: positive ? '#10B981' : '#EF4444' }}>
          {positive ? 'Positif' : 'Négatif'}
        </span>
      </div>
    </div>
  );
}
