import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../services/supabase';
import { Download, ArrowUp, ArrowDown, TrendingUp, Route, Calendar, BarChart2 } from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { format, subDays, startOfWeek } from 'date-fns';
import { fr } from 'date-fns/locale';
import * as XLSX from 'xlsx';

const fmt  = (n: number) => new Intl.NumberFormat('fr-CI', { maximumFractionDigits: 0 }).format(n);
const fmtC = (n: number) => fmt(n) + ' FCFA';

interface RouteRow {
  route_id: string; route_name: string; trip_count: number; revenue: number;
  cc_carburant: number; cc_ration: number; cc_peage: number; cc_autres: number;
  fuel_enlev: number; expense_reparation: number; total_expense: number; margin: number;
}
interface DaySeries {
  day: string; revenue: number; expenses: number; trip_count: number;
  cc_carburant: number; cc_ration: number; cc_peage: number; cc_autres: number;
}

const PRESETS = [
  { label: '7j',   days: 7 },
  { label: '30j',  days: 30 },
  { label: '90j',  days: 90 },
  { label: '180j', days: 180 },
];

const TABS = [
  { key: 'route',   label: 'Par ligne',     icon: Route },
  { key: 'daily',   label: 'Journalier',    icon: Calendar },
  { key: 'weekly',  label: 'Hebdomadaire',  icon: BarChart2 },
  { key: 'monthly', label: 'Mensuel',       icon: TrendingUp },
] as const;
type TabKey = typeof TABS[number]['key'];

export default function GestionnaireReports() {
  const [tab, setTab]           = useState<TabKey>('route');
  const [preset, setPreset]     = useState(30);
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [dateTo, setDateTo]     = useState(format(new Date(), 'yyyy-MM-dd'));
  const [routes, setRoutes]     = useState<RouteRow[]>([]);
  const [series, setSeries]     = useState<DaySeries[]>([]);
  const [loading, setLoading]   = useState(false);

  const applyPreset = (days: number) => {
    setPreset(days);
    setDateFrom(format(subDays(new Date(), days), 'yyyy-MM-dd'));
    setDateTo(format(new Date(), 'yyyy-MM-dd'));
  };

  const load = useCallback(async () => {
    setLoading(true);
    const [routeRes, seriesRes] = await Promise.all([
      supabase.rpc('get_gestionnaire_revenue_by_route', { p_date_from: dateFrom, p_date_to: dateTo }),
      supabase.rpc('get_gestionnaire_daily_series',     { p_date_from: dateFrom, p_date_to: dateTo }),
    ]);
    if (routeRes.error) console.error('Erreur rapport par ligne:', routeRes.error);
    if (seriesRes.error) console.error('Erreur rapport journalier:', seriesRes.error);
    setRoutes((routeRes.data ?? []) as RouteRow[]);
    setSeries((seriesRes.data ?? []) as DaySeries[]);
    setLoading(false);
  }, [dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  // ── Aggregations ─────────────────────────────────────────────────────────
  const weeklySeries = (() => {
    const map: Record<string, PeriodRow> = {};
    series.forEach(d => {
      const dt = new Date(d.day + 'T00:00:00');
      const wk = format(startOfWeek(dt, { weekStartsOn: 1 }), 'dd/MM/yy', { locale: fr });
      if (!map[wk]) map[wk] = emptyPeriodRow(wk);
      addPeriodRow(map[wk], d);
    });
    return Object.values(map);
  })();

  const monthlySeries = (() => {
    const map: Record<string, PeriodRow> = {};
    series.forEach(d => {
      const mo = format(new Date(d.day + 'T00:00:00'), 'MMM yyyy', { locale: fr });
      if (!map[mo]) map[mo] = emptyPeriodRow(mo);
      addPeriodRow(map[mo], d);
    });
    return Object.values(map);
  })();

  const dailyAgg: PeriodRow[] = series.map(d => ({
    period: format(new Date(d.day + 'T00:00:00'), 'dd/MM/yy', { locale: fr }),
    revenue: Number(d.revenue), expenses: Number(d.expenses), trips: Number(d.trip_count), raw_day: d.day,
    cc_carburant: Number(d.cc_carburant ?? 0), cc_ration: Number(d.cc_ration ?? 0),
    cc_peage: Number(d.cc_peage ?? 0), cc_autres: Number(d.cc_autres ?? 0),
  }));

  // ── Totals ────────────────────────────────────────────────────────────────
  const totRevenue = routes.reduce((s, r) => s + Number(r.revenue), 0);
  const totTrips   = routes.reduce((s, r) => s + Number(r.trip_count), 0);
  const totMargin  = routes.reduce((s, r) => s + Number(r.margin), 0);

  // ── Export ────────────────────────────────────────────────────────────────
  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(routes.map(r => ({
      Ligne: r.route_name, Voyages: r.trip_count, 'Recettes (FCFA)': r.revenue,
      'Carb. compl.': r.cc_carburant, Rations: r.cc_ration, Péages: r.cc_peage,
      'Autr. dép. (GCH)': r.cc_autres ?? 0,
      'Rés. guichetier': r.revenue - r.cc_carburant - r.cc_ration - r.cc_peage - (r.cc_autres ?? 0),
      'Marge brute': r.margin,
    }))), 'Par ligne');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(series.map(d => ({
      Date: d.day, Voyages: d.trip_count, Recettes: d.revenue,
      'Carb. compl.': d.cc_carburant, Rations: d.cc_ration, Péages: d.cc_peage,
      'Autr. dép. (GCH)': d.cc_autres, 'Charges guichet': d.expenses,
      Résultat: Number(d.revenue) - Number(d.expenses),
    }))), 'Journalier');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(weeklySeries.map(w => ({
      Semaine: w.period, Voyages: w.trips, Recettes: w.revenue,
      'Carb. compl.': w.cc_carburant, Rations: w.cc_ration, Péages: w.cc_peage,
      'Autr. dép. (GCH)': w.cc_autres, 'Charges guichet': w.expenses, Résultat: w.revenue - w.expenses,
    }))), 'Hebdo');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(monthlySeries.map(m => ({
      Mois: m.period, Voyages: m.trips, Recettes: m.revenue,
      'Carb. compl.': m.cc_carburant, Rations: m.cc_ration, Péages: m.cc_peage,
      'Autr. dép. (GCH)': m.cc_autres, 'Charges guichet': m.expenses, Résultat: m.revenue - m.expenses,
    }))), 'Mensuel');
    XLSX.writeFile(wb, `rapports_${dateFrom}_${dateTo}.xlsx`);
  };

  return (
    <div className="p-6 space-y-5">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Rapports détaillés</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Analyse financière et opérationnelle par période
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Presets */}
          <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
            {PRESETS.map(p => (
              <button key={p.days} onClick={() => applyPreset(p.days)}
                className="px-3 py-1.5 text-xs font-medium transition-colors"
                style={{
                  backgroundColor: preset === p.days ? 'var(--primary)' : 'var(--surface)',
                  color: preset === p.days ? '#fff' : 'var(--text-secondary)',
                }}>
                {p.label}
              </button>
            ))}
          </div>
          <input type="date" value={dateFrom} onChange={e => { setPreset(0); setDateFrom(e.target.value); }}
            className="px-3 py-1.5 border rounded-lg text-sm"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>→</span>
          <input type="date" value={dateTo} onChange={e => { setPreset(0); setDateTo(e.target.value); }}
            className="px-3 py-1.5 border rounded-lg text-sm"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
          <button onClick={exportExcel}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium"
            style={{ backgroundColor: '#16A34A', color: '#fff' }}>
            <Download className="w-4 h-4" /> Excel
          </button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 border-b" style={{ borderColor: 'var(--border)' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors"
            style={{
              borderBottomColor: tab === t.key ? 'var(--primary)' : 'transparent',
              color: tab === t.key ? 'var(--primary)' : 'var(--text-secondary)',
            }}>
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 rounded-full animate-spin"
            style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
        </div>
      ) : (
        <>
          {tab === 'route'   && <RouteTab routes={routes} totRevenue={totRevenue} totTrips={totTrips} totMargin={totMargin} />}
          {tab === 'daily'   && <PeriodTab data={dailyAgg}    label="Date"    chartType="bar" />}
          {tab === 'weekly'  && <PeriodTab data={weeklySeries} label="Semaine" chartType="bar" />}
          {tab === 'monthly' && <PeriodTab data={monthlySeries} label="Mois"  chartType="line" />}
        </>
      )}
    </div>
  );
}

// ── Par ligne ─────────────────────────────────────────────────────────────────
function RouteTab({ routes, totRevenue, totTrips, totMargin }:
  { routes: RouteRow[]; totRevenue: number; totTrips: number; totMargin: number }) {

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total recettes',  val: fmtC(totRevenue), color: '#10B981' },
          { label: 'Total voyages',   val: String(totTrips), color: '#3B82F6' },
          { label: 'Marge globale',   val: fmtC(totMargin),  color: totMargin >= 0 ? '#10B981' : '#EF4444' },
        ].map(k => (
          <div key={k.label} className="rounded-xl border p-4"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
            <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>{k.label}</p>
            <p className="text-lg font-bold" style={{ color: k.color }}>{k.val}</p>
          </div>
        ))}
      </div>

      {/* Chart */}
      {routes.length > 0 && (
        <div className="rounded-2xl border p-5"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            Recettes et marge par ligne
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={routes.slice(0, 12)} margin={{ top: 5, right: 10, bottom: 50, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="route_name" tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
                angle={-30} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
                tickFormatter={v => (v / 1000) + 'k'} width={45} />
              <Tooltip formatter={(v: number) => fmtC(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="revenue" name="Recettes" fill="var(--primary)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="margin"  name="Marge"    fill="#10B981"         radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Table */}
      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                {['Ligne', 'Voyages', 'Recettes', 'Carb. compl.', 'Rations', 'Péages',
                  'Autr. dép. (GCH)', 'Rés. guichetier', 'Marge brute', 'Marge %'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap"
                    style={{ color: 'var(--text-secondary)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {routes.map((r, i) => {
                const resGui = Number(r.revenue) - Number(r.cc_carburant ?? 0)
                             - Number(r.cc_ration ?? 0) - Number(r.cc_peage ?? 0)
                             - Number(r.cc_autres ?? 0);
                const mPct   = r.revenue > 0 ? (r.margin / r.revenue * 100) : 0;
                return (
                  <tr key={r.route_id || i} className="border-t"
                    style={{ borderColor: 'var(--border)' }}>
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>{r.route_name}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{r.trip_count}</td>
                    <td className="px-4 py-3 font-semibold" style={{ color: '#10B981' }}>{fmtC(r.revenue)}</td>
                    <td className="px-4 py-3" style={{ color: '#3B82F6' }}>{fmt(r.cc_carburant ?? 0)}</td>
                    <td className="px-4 py-3" style={{ color: '#F59E0B' }}>{fmt(r.cc_ration ?? 0)}</td>
                    <td className="px-4 py-3" style={{ color: '#6B7280' }}>{fmt(r.cc_peage ?? 0)}</td>
                    <td className="px-4 py-3" style={{ color: '#6366F1' }}>{fmt(r.cc_autres ?? 0)}</td>
                    <td className="px-4 py-3 font-semibold"
                      style={{ color: resGui >= 0 ? '#3B82F6' : '#EF4444' }}>{fmtC(resGui)}</td>
                    <td className="px-4 py-3 font-semibold"
                      style={{ color: r.margin >= 0 ? '#10B981' : '#EF4444' }}>{fmtC(r.margin)}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                        style={{
                          backgroundColor: mPct >= 20 ? '#DCFCE7' : mPct >= 0 ? '#FEF9C3' : '#FEE2E2',
                          color: mPct >= 20 ? '#16A34A' : mPct >= 0 ? '#CA8A04' : '#EF4444',
                        }}>
                        {mPct.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                );
              })}
              {routes.length === 0 && (
                <tr><td colSpan={10} className="text-center py-8 text-sm"
                  style={{ color: 'var(--text-muted)' }}>Aucune donnée sur la période</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Onglet Journalier / Hebdo / Mensuel ───────────────────────────────────────
interface PeriodRow {
  period: string; revenue: number; expenses: number; trips: number; raw_day?: string;
  cc_carburant: number; cc_ration: number; cc_peage: number; cc_autres: number;
}

function emptyPeriodRow(period: string): PeriodRow {
  return { period, revenue: 0, expenses: 0, trips: 0, cc_carburant: 0, cc_ration: 0, cc_peage: 0, cc_autres: 0 };
}

function addPeriodRow(target: PeriodRow, source: DaySeries): void {
  target.revenue += Number(source.revenue);
  target.expenses += Number(source.expenses);
  target.trips += Number(source.trip_count);
  target.cc_carburant += Number(source.cc_carburant ?? 0);
  target.cc_ration += Number(source.cc_ration ?? 0);
  target.cc_peage += Number(source.cc_peage ?? 0);
  target.cc_autres += Number(source.cc_autres ?? 0);
}

function PeriodTab({
  data, label, chartType,
}: { data: PeriodRow[]; label: string; chartType: 'bar' | 'line' }) {

  const totRevenue  = data.reduce((s, d) => s + d.revenue,  0);
  const totExpenses = data.reduce((s, d) => s + d.expenses, 0);
  const totTrips    = data.reduce((s, d) => s + d.trips,    0);
  const totResult   = totRevenue - totExpenses;

  const chartData = data.map(d => ({
    name:     d.period,
    Recettes: d.revenue,
    Dépenses: d.expenses,
    Résultat: d.revenue - d.expenses,
  }));

  const showDots = data.length <= 3;

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Recettes',          val: fmtC(totRevenue),  color: '#10B981' },
          { label: 'Charges guichet',   val: fmtC(totExpenses), color: '#EF4444' },
          { label: 'Résultat net',      val: fmtC(totResult),   color: totResult >= 0 ? '#3B82F6' : '#EF4444' },
          { label: 'Total voyages',     val: String(totTrips),  color: 'var(--text-primary)' },
        ].map(k => (
          <div key={k.label} className="rounded-xl border p-4"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
            <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>{k.label}</p>
            <p className="text-lg font-bold" style={{ color: k.color }}>{k.val}</p>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="rounded-2xl border p-5"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          Évolution — Recettes / Charges guichet / Résultat
        </h3>
        {data.length === 0 ? (
          <div className="flex items-center justify-center h-44 text-sm"
            style={{ color: 'var(--text-muted)' }}>
            Aucune donnée sur la période sélectionnée
          </div>
        ) : chartType === 'bar' ? (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
                tickFormatter={v => (v / 1000) + 'k'} width={45} />
              <Tooltip formatter={(v: number) => fmtC(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Recettes" fill="#10B981" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Dépenses" fill="#EF4444" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Résultat" fill="#3B82F6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
                tickFormatter={v => (v / 1000) + 'k'} width={45} />
              <Tooltip formatter={(v: number) => fmtC(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="Recettes" stroke="#10B981" strokeWidth={2}
                dot={{ r: showDots ? 5 : 2 }} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="Dépenses" stroke="#EF4444" strokeWidth={2}
                dot={{ r: showDots ? 5 : 2 }} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="Résultat" stroke="#3B82F6" strokeWidth={2}
                strokeDasharray="4 2" dot={{ r: showDots ? 5 : 2 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Table */}
      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                {[label, 'Voyages', 'Recettes', 'Carb. compl.', 'Rations', 'Péages', 'Autr. dép. (GCH)', 'Charges guichet', 'Résultat', 'Marge %', 'Évolution'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap"
                    style={{ color: 'var(--text-secondary)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((d, i) => {
                const res  = d.revenue - d.expenses;
                const marg = d.revenue > 0 ? (res / d.revenue * 100) : 0;
                const prev = data[i - 1];
                const evol = prev && prev.revenue > 0
                  ? ((d.revenue - prev.revenue) / prev.revenue * 100)
                  : null;
                return (
                  <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--text-primary)' }}>
                      {d.raw_day
                        ? format(new Date(d.raw_day + 'T00:00:00'), 'dd/MM/yyyy', { locale: fr })
                        : d.period}
                    </td>
                    <td className="px-4 py-2.5" style={{ color: 'var(--text-secondary)' }}>{d.trips}</td>
                    <td className="px-4 py-2.5 font-semibold" style={{ color: '#10B981' }}>{fmtC(d.revenue)}</td>
                    <td className="px-4 py-2.5" style={{ color: '#3B82F6' }}>{fmt(d.cc_carburant)}</td>
                    <td className="px-4 py-2.5" style={{ color: '#F59E0B' }}>{fmt(d.cc_ration)}</td>
                    <td className="px-4 py-2.5" style={{ color: '#6B7280' }}>{fmt(d.cc_peage)}</td>
                    <td className="px-4 py-2.5" style={{ color: '#6366F1' }}>{fmt(d.cc_autres)}</td>
                    <td className="px-4 py-2.5 font-semibold" style={{ color: '#EF4444' }}>{fmtC(d.expenses)}</td>
                    <td className="px-4 py-2.5 font-semibold"
                      style={{ color: res >= 0 ? '#3B82F6' : '#EF4444' }}>{fmtC(res)}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs font-semibold"
                        style={{ color: marg >= 20 ? '#10B981' : marg >= 0 ? '#CA8A04' : '#EF4444' }}>
                        {marg.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {evol !== null && (
                        <span className="flex items-center gap-0.5 text-xs font-semibold"
                          style={{ color: evol >= 0 ? '#10B981' : '#EF4444' }}>
                          {evol >= 0
                            ? <ArrowUp className="w-3 h-3" />
                            : <ArrowDown className="w-3 h-3" />}
                          {Math.abs(evol).toFixed(1)}%
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {data.length === 0 && (
                <tr><td colSpan={11} className="text-center py-8 text-sm"
                  style={{ color: 'var(--text-muted)' }}>Aucune donnée sur la période</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
