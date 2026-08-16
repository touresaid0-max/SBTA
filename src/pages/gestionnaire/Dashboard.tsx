import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../services/supabase';
import {
  TrendingUp, TrendingDown, Bus, Users, Route, DollarSign,
  AlertTriangle, ArrowUpRight, ArrowDownRight, RefreshCw,
  BarChart2, Activity, Target,
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import {
  format, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  startOfYear, endOfYear,
} from 'date-fns';
import { fr } from 'date-fns/locale';

const fmt = (n: number) => new Intl.NumberFormat('fr-CI', { maximumFractionDigits: 0 }).format(n) + ' F CFA';

interface KPIs {
  total_revenue: number;
  cc_carburant_complement: number;
  cc_ration: number;
  cc_peage: number;
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

interface RouteRow {
  route_id: string; route_name: string; trip_count: number; revenue: number;
  cc_carburant: number; cc_ration: number; cc_peage: number; margin: number;
}
interface BusRow {
  bus_id: string; registration_number: string; model: string;
  trip_count: number; revenue: number;
  cc_carburant: number; cc_ration: number; cc_peage: number;
  fuel_enlev: number; expense_reparation: number; expense_autres: number;
  fuel_carburant_comptable: number;
  total_expense: number; margin: number;
}
interface DaySeries { day: string; revenue: number; expenses: number; trip_count: number; }

type PeriodType = 'jour' | 'semaine' | 'mois' | 'annee' | 'custom';

const PERIOD_OPTIONS: { label: string; value: PeriodType }[] = [
  { label: 'Journalier',    value: 'jour' },
  { label: 'Hebdomadaire',  value: 'semaine' },
  { label: 'Mensuel',       value: 'mois' },
  { label: 'Annuel',        value: 'annee' },
  { label: 'Personnalisé',  value: 'custom' },
];

// Calcule la plage de dates (yyyy-MM-dd) pour un type de période donné.
function computeRange(type: PeriodType, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date();
  const f = (d: Date) => format(d, 'yyyy-MM-dd');
  switch (type) {
    case 'jour':
      return { from: f(now), to: f(now) };
    case 'semaine':
      return { from: f(startOfWeek(now, { weekStartsOn: 1 })), to: f(endOfWeek(now, { weekStartsOn: 1 })) };
    case 'mois':
      return { from: f(startOfMonth(now)), to: f(endOfMonth(now)) };
    case 'annee':
      return { from: f(startOfYear(now)), to: f(endOfYear(now)) };
    case 'custom':
      return { from: customFrom, to: customTo };
  }
}

export default function GestionnaireDashboard() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<PeriodType>('mois');
  const [customFrom, setCustomFrom] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [customTo, setCustomTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [buses, setBuses] = useState<BusRow[]>([]);
  const [series, setSeries] = useState<DaySeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const { from: dateFrom, to: dateTo } = computeRange(period, customFrom, customTo);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);

    const [kpiRes, routeRes, busRes, seriesRes] = await Promise.all([
      supabase.rpc('get_gestionnaire_dashboard_kpis', { p_date_from: dateFrom, p_date_to: dateTo }),
      supabase.rpc('get_gestionnaire_revenue_by_route', { p_date_from: dateFrom, p_date_to: dateTo }),
      supabase.rpc('get_gestionnaire_revenue_by_bus', { p_date_from: dateFrom, p_date_to: dateTo }),
      supabase.rpc('get_gestionnaire_daily_series', { p_date_from: dateFrom, p_date_to: dateTo }),
    ]);

    if (kpiRes.data) setKpis(kpiRes.data as KPIs);
    if (routeRes.data) setRoutes((routeRes.data as RouteRow[]).slice(0, 5));
    if (busRes.data) setBuses(busRes.data as BusRow[]);
    if (seriesRes.data) setSeries(seriesRes.data as DaySeries[]);

    setLoading(false);
    setRefreshing(false);
  }, [dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-10 h-10 border-4 rounded-full animate-spin" style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
    </div>
  );

  // Résultat guichetier = Recettes - Rations - Carburant compl. - Péages guichet
  const guichetierCharges = kpis
    ? kpis.cc_carburant_complement + kpis.cc_ration + kpis.cc_peage
    : 0;
  const guichetierResult = kpis ? kpis.total_revenue - guichetierCharges : 0;

  // Résultat brut = Résultat guichetier - Carburant cuve - Réparations - Charges achat - Charge carburant comptable - Autres
  const brutResult = guichetierResult - (kpis
    ? kpis.fuel_enlevements_amount + kpis.expense_reparation + kpis.vehicle_expenses_amount + (kpis.fuel_carburant_comptable ?? 0) + kpis.expense_autres + (kpis.expense_charge_stock ?? 0) + (kpis.expense_garage_pieces ?? 0)
    : 0);
  const margin = kpis && kpis.total_revenue > 0 ? (brutResult / kpis.total_revenue) * 100 : 0;

  const totalExpenses = kpis
    ? guichetierCharges + kpis.fuel_enlevements_amount + kpis.expense_reparation + kpis.vehicle_expenses_amount + (kpis.fuel_carburant_comptable ?? 0) + kpis.expense_autres + (kpis.expense_charge_stock ?? 0) + (kpis.expense_garage_pieces ?? 0)
    : 0;

  const topBuses = [...buses].sort((a, b) => b.margin - a.margin).slice(0, 5);
  const deficitBuses = [...buses].filter(b => b.margin < 0).sort((a, b) => a.margin - b.margin).slice(0, 5);

  const expenseBreakdown = kpis ? [
    { name: 'Carburant compl.', value: kpis.cc_carburant_complement, color: '#3B82F6' },
    { name: 'Rations',          value: kpis.cc_ration,               color: '#F59E0B' },
    { name: 'Péages guichet',   value: kpis.cc_peage,                color: '#10B981' },
    { name: 'Carburant cuve',              value: kpis.fuel_enlevements_amount,       color: '#F97316' },
    { name: 'Réparations (comptable)',     value: kpis.expense_reparation,            color: '#EF4444' },
    { name: 'Charges achat',              value: kpis.vehicle_expenses_amount,       color: '#06B6D4' },
    { name: 'Charge carburant (agent)',value: kpis.fuel_carburant_comptable ?? 0, color: '#F59E0B' },
    { name: 'Articles stock',             value: kpis.expense_autres,                color: '#8B5CF6' },
    { name: 'Charge stock',               value: kpis.expense_charge_stock ?? 0,     color: '#7C3AED' },
    { name: 'Sorties pieces garage',      value: kpis.expense_garage_pieces ?? 0,    color: '#B45309' },
  ].filter(e => e.value > 0) : [];

  const chartData = series.map(d => ({
    date: format(new Date(d.day + 'T00:00:00'), 'dd/MM', { locale: fr }),
    Recettes: Number(d.revenue),
    Dépenses: Number(d.expenses),
  }));

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Tableau de bord</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>Pilotage financier et opérationnel de votre société</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
            {PERIOD_OPTIONS.map(o => (
              <button key={o.value} onClick={() => setPeriod(o.value)}
                className="px-3 py-1.5 text-sm font-medium transition-colors"
                style={{
                  backgroundColor: period === o.value ? 'var(--primary)' : 'var(--surface)',
                  color: period === o.value ? '#fff' : 'var(--text-secondary)',
                }}>
                {o.label}
              </button>
            ))}
          </div>
          {period === 'custom' && (
            <div className="flex items-center gap-2">
              <input type="date" value={customFrom} max={customTo}
                onChange={e => setCustomFrom(e.target.value)}
                className="px-2 py-1.5 text-sm rounded-xl border"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>au</span>
              <input type="date" value={customTo} min={customFrom}
                onChange={e => setCustomTo(e.target.value)}
                className="px-2 py-1.5 text-sm rounded-xl border"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
            </div>
          )}
          <button onClick={() => load(true)} disabled={refreshing}
            className="p-2 rounded-xl border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>
      </div>

      {/* KPI Row 1 — résultats financiers */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total recettes" value={fmt(kpis?.total_revenue ?? 0)} icon={<DollarSign className="w-5 h-5" />} color="#10B981" positive />
        <KpiCard label="Résultat guichetier" value={fmt(guichetierResult)} icon={<BarChart2 className="w-5 h-5" />} color={guichetierResult >= 0 ? '#3B82F6' : '#EF4444'} positive={guichetierResult >= 0} />
        <KpiCard label="Résultat brut" value={fmt(brutResult)} icon={<Target className="w-5 h-5" />} color={brutResult >= 0 ? '#10B981' : '#EF4444'} positive={brutResult >= 0} />
        <KpiCard label="Marge nette" value={`${margin.toFixed(1)}%`} icon={<TrendingUp className="w-5 h-5" />} color={margin >= 0 ? '#10B981' : '#EF4444'} positive={margin >= 0} />
      </div>

      {/* KPI Row 2 — charges guichetier (sources counter_charges) */}
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Charges guichetier (bordereaux départ)</p>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Carburant compl.', val: kpis?.cc_carburant_complement ?? 0, color: '#3B82F6' },
            { label: 'Rations',          val: kpis?.cc_ration ?? 0,               color: '#F59E0B' },
            { label: 'Péages guichet',   val: kpis?.cc_peage ?? 0,                color: '#10B981' },
          ].map(item => (
            <div key={item.label} className="rounded-xl border p-4" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>{item.label}</p>
              <p className="text-base font-bold" style={{ color: item.color }}>{fmt(item.val)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* KPI Row 3 — autres charges */}
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Autres charges</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'Carburant cuve',              val: kpis?.fuel_enlevements_amount ?? 0,       color: '#F97316' },
            { label: 'Réparations (comptable)',      val: kpis?.expense_reparation ?? 0,            color: '#EF4444' },
            { label: 'Charges achat',               val: kpis?.vehicle_expenses_amount ?? 0,       color: '#06B6D4' },
            { label: 'Charge carburant (agent)', val: kpis?.fuel_carburant_comptable ?? 0,      color: '#F59E0B' },
            { label: 'Articles stock',              val: kpis?.expense_autres ?? 0,                color: '#8B5CF6' },
            { label: 'Charge stock',                val: kpis?.expense_charge_stock ?? 0,          color: '#7C3AED' },
            { label: 'Sorties pieces garage',       val: kpis?.expense_garage_pieces ?? 0,         color: '#B45309' },
          ].map(item => (
            <div key={item.label} className="rounded-xl border p-4" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>{item.label}</p>
              <p className="text-sm font-bold" style={{ color: item.color }}>{fmt(item.val)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* KPI Row 4 — opérationnel */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Bus actifs', val: kpis?.active_bus_count ?? 0, icon: <Bus className="w-5 h-5" />, color: '#3B82F6' },
          { label: 'Voyages',    val: kpis?.trip_count ?? 0,       icon: <Route className="w-5 h-5" />, color: '#10B981' },
          { label: 'Chauffeurs', val: kpis?.driver_count ?? 0,     icon: <Users className="w-5 h-5" />, color: '#F59E0B' },
        ].map(item => (
          <div key={item.label} className="rounded-xl border p-4 flex items-center gap-4" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: item.color + '20', color: item.color }}>
              {item.icon}
            </div>
            <div>
              <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{item.val}</p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{item.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <h3 className="font-semibold mb-4 text-sm" style={{ color: 'var(--text-primary)' }}>Évolution Recettes vs Charges guichetier</h3>
          {chartData.length === 0 ? (
            <div className="flex items-center justify-center h-44 text-sm" style={{ color: 'var(--text-muted)' }}>
              Aucune donnée sur la période sélectionnée
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="exp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#EF4444" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={v => new Intl.NumberFormat('fr-CI', { notation: 'compact', maximumFractionDigits: 0 }).format(v as number)} width={50} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="Recettes" stroke="#10B981" fill="url(#rev)" strokeWidth={2} dot={{ r: chartData.length <= 3 ? 4 : false }} />
                <Area type="monotone" dataKey="Dépenses" stroke="#EF4444" fill="url(#exp)" strokeWidth={2} dot={{ r: chartData.length <= 3 ? 4 : false }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <h3 className="font-semibold mb-4 text-sm" style={{ color: 'var(--text-primary)' }}>Répartition des charges</h3>
          <div className="space-y-3">
            {expenseBreakdown.map(e => (
              <div key={e.name}>
                <div className="flex justify-between text-xs mb-1">
                  <span style={{ color: 'var(--text-secondary)' }}>{e.name}</span>
                  <span className="font-semibold" style={{ color: e.color }}>{fmt(e.value)}</span>
                </div>
                <div className="h-1.5 rounded-full" style={{ backgroundColor: 'var(--border)' }}>
                  <div className="h-1.5 rounded-full transition-all"
                    style={{ backgroundColor: e.color, width: `${totalExpenses > 0 ? Math.min((e.value / totalExpenses) * 100, 100) : 0}%` }} />
                </div>
              </div>
            ))}
            {expenseBreakdown.length === 0 && <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>Aucune charge sur la période</p>}
          </div>
        </div>
      </div>

      {/* Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Top lignes rentables</h3>
            <button onClick={() => navigate('/gestionnaire/reports')} className="text-xs font-medium" style={{ color: 'var(--primary)' }}>Voir tout</button>
          </div>
          <div className="space-y-2">
            {routes.map((r, i) => (
              <div key={r.route_id || i} className="flex items-center gap-3 py-2">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                  style={{ backgroundColor: i === 0 ? '#F59E0B' : i === 1 ? '#9CA3AF' : 'var(--primary)' }}>
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{r.route_name}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.trip_count} voyage(s)</p>
                </div>
                <span className="text-sm font-bold flex-shrink-0" style={{ color: '#10B981' }}>{fmt(r.revenue)}</span>
              </div>
            ))}
            {routes.length === 0 && <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>Aucun voyage sur la période</p>}
          </div>
        </div>

        <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Performance bus</h3>
            <button onClick={() => navigate('/gestionnaire/bus-performance')} className="text-xs font-medium" style={{ color: 'var(--primary)' }}>Analyser</button>
          </div>
          <div className="space-y-2">
            {topBuses.slice(0, 4).map(b => (
              <div key={b.bus_id} className="flex items-center gap-3 py-1.5">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: b.margin >= 0 ? '#DCFCE7' : '#FEE2E2' }}>
                  <Bus className="w-3.5 h-3.5" style={{ color: b.margin >= 0 ? '#16A34A' : '#EF4444' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{b.registration_number}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{b.trip_count} voyages · {fmt(b.revenue)}</p>
                </div>
                <span className="text-sm font-bold flex items-center gap-0.5 flex-shrink-0" style={{ color: b.margin >= 0 ? '#10B981' : '#EF4444' }}>
                  {b.margin >= 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                  {fmt(Math.abs(b.margin))}
                </span>
              </div>
            ))}
            {buses.length === 0 && <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>Aucune donnée disponible</p>}
          </div>
          {deficitBuses.length > 0 && (
            <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
              <p className="text-xs font-semibold mb-2 flex items-center gap-1" style={{ color: '#EF4444' }}>
                <AlertTriangle className="w-3.5 h-3.5" /> Bus déficitaires
              </p>
              {deficitBuses.slice(0, 2).map(b => (
                <div key={b.bus_id} className="flex justify-between items-center text-xs py-1">
                  <span style={{ color: 'var(--text-secondary)' }}>{b.registration_number}</span>
                  <span className="font-semibold" style={{ color: '#EF4444' }}>{fmt(b.margin)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Rapport financier', path: '/gestionnaire/financial-report', icon: <BarChart2 className="w-5 h-5" />, color: '#3B82F6' },
          { label: 'Performance bus',   path: '/gestionnaire/bus-performance',  icon: <Activity className="w-5 h-5" />, color: '#10B981' },
          { label: 'Activités bus',     path: '/gestionnaire/bus-activity',     icon: <Bus className="w-5 h-5" />,      color: '#F59E0B' },
          { label: 'Rapport chauffeurs',path: '/gestionnaire/drivers-report',   icon: <Users className="w-5 h-5" />,    color: '#8B5CF6' },
        ].map(a => (
          <button key={a.path} onClick={() => navigate(a.path)}
            className="flex items-center gap-3 p-4 rounded-xl border text-left transition-all hover:shadow-md"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: a.color + '20', color: a.color }}>
              {a.icon}
            </div>
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

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
