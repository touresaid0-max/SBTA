import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import { Bus, TrendingUp, TrendingDown, Award, Users, MapPin, Download, ChevronDown } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';
import { format, subDays, subMonths, startOfWeek, startOfMonth, startOfQuarter, startOfYear } from 'date-fns';
import { fr } from 'date-fns/locale';
import * as XLSX from 'xlsx';

const fmt = (n: number) => new Intl.NumberFormat('fr-CI', { maximumFractionDigits: 0 }).format(n);
const fmtCFA = (n: number) => fmt(n) + ' FCFA';
const fmtPct = (n: number) => n.toFixed(1) + '%';

interface BusRow {
  bus_id: string;
  registration_number: string;
  model: string;
  company_name: string;
  trip_count: number;
  total_passengers: number;
  avg_fill_rate: number;
  total_km: number;
  revenue: number;
  cc_carburant: number;
  cc_ration: number;
  cc_peage: number;
  fuel_enlev: number;
  expense_reparation: number;
  expense_autres: number;
  expense_charge_stock: number;
  expense_garage_pieces: number;
  vehicle_exp: number;
  fuel_carburant_comptable: number;
  total_expense: number;
  margin: number;
  breakdown_received: number;
  breakdown_transferred: number;
}

type PeriodKey = 'week' | 'month' | 'quarter' | 'year' | 'custom';

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'week', label: 'Hebdomadaire' },
  { key: 'month', label: 'Mensuelle' },
  { key: 'quarter', label: 'Trimestrielle' },
  { key: 'year', label: 'Annuelle' },
  { key: 'custom', label: 'Personnalisée' },
];

function periodDates(key: PeriodKey): { from: string; to: string } {
  const today = new Date();
  const to = format(today, 'yyyy-MM-dd');
  switch (key) {
    case 'week': return { from: format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'), to };
    case 'month': return { from: format(startOfMonth(today), 'yyyy-MM-dd'), to };
    case 'quarter': return { from: format(startOfQuarter(today), 'yyyy-MM-dd'), to };
    case 'year': return { from: format(startOfYear(today), 'yyyy-MM-dd'), to };
    default: return { from: format(subDays(today, 30), 'yyyy-MM-dd'), to };
  }
}

function parseRow(raw: Record<string, unknown>): BusRow {
  return {
    bus_id: String(raw.bus_id ?? ''),
    registration_number: String(raw.registration_number ?? ''),
    model: String(raw.model ?? ''),
    company_name: String(raw.company_name ?? ''),
    trip_count: Number(raw.trip_count ?? 0),
    total_passengers: Number(raw.total_passengers ?? 0),
    avg_fill_rate: Number(raw.avg_fill_rate ?? 0),
    total_km: Number(raw.total_km ?? 0),
    revenue: Number(raw.revenue ?? 0),
    cc_carburant: Number(raw.cc_carburant ?? 0),
    cc_ration: Number(raw.cc_ration ?? 0),
    cc_peage: Number(raw.cc_peage ?? 0),
    fuel_enlev: Number(raw.fuel_enlev ?? 0),
    expense_reparation: Number(raw.expense_reparation ?? 0),
    expense_autres: Number(raw.expense_autres ?? 0),
    expense_charge_stock: Number(raw.expense_charge_stock ?? 0),
    expense_garage_pieces: Number(raw.expense_garage_pieces ?? 0),
    vehicle_exp: Number(raw.vehicle_exp ?? 0),
    fuel_carburant_comptable: Number(raw.fuel_carburant_comptable ?? 0),
    total_expense: Number(raw.total_expense ?? 0),
    margin: Number(raw.margin ?? 0),
    breakdown_received: Number(raw.breakdown_received ?? 0),
    breakdown_transferred: Number(raw.breakdown_transferred ?? 0),
  };
}

function getPerformanceBadge(margin: number, revenue: number) {
  if (revenue === 0) return { label: 'Inactif', color: '#6B7280', bg: '#F3F4F6' };
  const pct = (margin / revenue) * 100;
  if (pct >= 30) return { label: 'Tres rentable', color: '#16A34A', bg: '#DCFCE7' };
  if (pct >= 15) return { label: 'Rentable', color: '#2563EB', bg: '#DBEAFE' };
  if (pct >= 0) return { label: 'Moyen', color: '#D97706', bg: '#FEF3C7' };
  if (pct >= -20) return { label: 'Deficitaire', color: '#DC2626', bg: '#FEE2E2' };
  return { label: 'Critique', color: '#7F1D1D', bg: '#FEE2E2' };
}

type SortField = keyof BusRow;

export default function BusPerformance() {
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [dateFrom, setDateFrom] = useState(() => periodDates('month').from);
  const [dateTo, setDateTo] = useState(() => periodDates('month').to);
  const [buses, setBuses] = useState<BusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortField>('margin');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    if (period === 'custom') return;
    const { from, to } = periodDates(period);
    setDateFrom(from);
    setDateTo(to);
  }, [period]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { data, error } = await supabase.rpc('get_gestionnaire_revenue_by_bus', {
          p_date_from: dateFrom,
          p_date_to: dateTo,
        });
        if (cancelled) return;
        if (error) {
          console.error('RPC error:', error);
          setBuses([]);
          return;
        }
        setBuses(data ? (data as Record<string, unknown>[]).map(parseRow) : []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [dateFrom, dateTo]);

  const sorted = [...buses].sort((a, b) => {
    const av = Number(a[sortKey] ?? 0);
    const bv = Number(b[sortKey] ?? 0);
    return sortDir === 'desc' ? bv - av : av - bv;
  });

  const ranked = sorted.map((b, i) => ({ ...b, rank: i + 1 }));

  const toggleSort = (key: SortField) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const totalRevenue = buses.reduce((s, b) => s + b.revenue, 0);
  const totalExpense = buses.reduce((s, b) => s + b.total_expense, 0);
  const totalMargin = buses.reduce((s, b) => s + b.margin, 0);
  const totalPassengers = buses.reduce((s, b) => s + b.total_passengers, 0);
  const totalKm = buses.reduce((s, b) => s + b.total_km, 0);
  const avgFillRate = buses.length > 0 ? buses.reduce((s, b) => s + b.avg_fill_rate, 0) / buses.length : 0;

  const topRevenue = [...buses].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  const topMargin = [...buses].sort((a, b) => b.margin - a.margin).slice(0, 5);
  const deficitBuses = [...buses].filter(b => b.margin < 0).sort((a, b) => a.margin - b.margin).slice(0, 5);

  const exportExcel = () => {
    const rows = ranked.map(b => ({
      '#': b.rank,
      'Immatriculation': b.registration_number,
      'Societe': b.company_name,
      'Modele': b.model,
      'Voyages': b.trip_count,
      'Passagers': b.total_passengers,
      'Taux remplissage (%)': Number(b.avg_fill_rate.toFixed(1)),
      'Kilometrage': Number(b.total_km.toFixed(0)),
      'Recettes': b.revenue,
      'Total charges': b.total_expense,
      'Resultat net': b.margin,
      'Marge (%)': b.revenue > 0 ? Number(((b.margin / b.revenue) * 100).toFixed(1)) : 0,
      'Performance': getPerformanceBadge(b.margin, b.revenue).label,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Performance Bus');
    XLSX.writeFile(wb, `performance_bus_${dateFrom}_${dateTo}.xlsx`);
  };

  const SortTh = ({ label, field, className = '' }: { label: string; field: SortField; className?: string }) => (
    <th
      className={`text-left px-3 py-3 text-xs font-semibold cursor-pointer select-none hover:opacity-80 whitespace-nowrap ${className}`}
      style={{ color: 'var(--text-secondary)' }}
      onClick={() => toggleSort(field)}
    >
      {label}{sortKey === field ? (sortDir === 'desc' ? ' \u2193' : ' \u2191') : ''}
    </th>
  );

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Performance des bus
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Rentabilite, charges et marges par vehicule
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <select
              value={period}
              onChange={e => setPeriod(e.target.value as PeriodKey)}
              className="appearance-none pl-3 pr-8 py-2 border rounded-lg text-sm font-medium"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
            >
              {PERIODS.map(p => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
          </div>
          {period === 'custom' && (
            <>
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="px-3 py-2 border rounded-lg text-sm"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
              />
              <span style={{ color: 'var(--text-muted)' }}>&rarr;</span>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="px-3 py-2 border rounded-lg text-sm"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
              />
            </>
          )}
          <button
            onClick={exportExcel}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-90"
            style={{ backgroundColor: '#16A34A', color: '#fff' }}
          >
            <Download className="w-4 h-4" /> Excel
          </button>
        </div>
      </div>

      {/* KPI Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: 'Bus analyses', val: String(buses.length), icon: Bus, color: '#3B82F6', bg: '#EFF6FF' },
          { label: 'Passagers', val: fmt(totalPassengers), icon: Users, color: '#8B5CF6', bg: '#F5F3FF' },
          { label: 'Taux remplissage', val: fmtPct(avgFillRate), icon: TrendingUp, color: '#F59E0B', bg: '#FFFBEB' },
          { label: 'Recettes', val: fmtCFA(totalRevenue), icon: TrendingUp, color: '#10B981', bg: '#ECFDF5' },
          { label: 'Charges', val: fmtCFA(totalExpense), icon: TrendingDown, color: '#EF4444', bg: '#FEF2F2' },
          { label: 'Kilometrage', val: fmt(totalKm) + ' km', icon: MapPin, color: '#0EA5E9', bg: '#F0F9FF' },
        ].map(k => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="rounded-xl border p-4" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: k.bg }}>
                  <Icon className="w-4 h-4" style={{ color: k.color }} />
                </div>
              </div>
              <p className="text-xs mb-0.5" style={{ color: 'var(--text-secondary)' }}>{k.label}</p>
              <p className="text-lg font-bold" style={{ color: k.color }}>{loading ? '...' : k.val}</p>
            </div>
          );
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            Top 5 — Recettes
          </h3>
          {topRevenue.length === 0 ? (
            <div className="flex items-center justify-center h-44 text-sm" style={{ color: 'var(--text-muted)' }}>
              Aucune donnee
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={topRevenue} layout="vertical" margin={{ top: 0, right: 20, bottom: 0, left: 80 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} tickFormatter={v => (v / 1000) + 'k'} />
                <YAxis type="category" dataKey="registration_number" tick={{ fontSize: 10, fill: 'var(--text-primary)' }} width={75} />
                <Tooltip formatter={(v: number) => fmtCFA(v)} />
                <Bar dataKey="revenue" name="Recettes" radius={[0, 4, 4, 0]}>
                  {topRevenue.map((_, i) => <Cell key={i} fill={`hsl(${152 + i * 8}, 60%, ${42 + i * 4}%)`} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            Bus deficitaires
          </h3>
          {deficitBuses.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-44 gap-2">
              <Award className="w-8 h-8" style={{ color: '#10B981' }} />
              <p className="text-sm font-medium" style={{ color: '#10B981' }}>Tous les bus sont rentables</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={deficitBuses} layout="vertical" margin={{ top: 0, right: 20, bottom: 0, left: 80 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} tickFormatter={v => (v / 1000) + 'k'} />
                <YAxis type="category" dataKey="registration_number" tick={{ fontSize: 10, fill: 'var(--text-primary)' }} width={75} />
                <Tooltip formatter={(v: number) => fmtCFA(v)} />
                <Bar dataKey="margin" name="Marge" fill="#EF4444" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Ranking */}
      {topMargin.length > 0 && (
        <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            Classement des bus les plus performants
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {topMargin.map((b, i) => {
              const badge = getPerformanceBadge(b.margin, b.revenue);
              const marginPct = b.revenue > 0 ? (b.margin / b.revenue) * 100 : 0;
              return (
                <div
                  key={b.bus_id}
                  className="rounded-xl border p-4 flex flex-col gap-2 transition-all hover:shadow-md"
                  style={{ borderColor: 'var(--border)', backgroundColor: i === 0 ? '#ECFDF5' : 'var(--surface)' }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: i === 0 ? '#10B981' : i < 3 ? '#3B82F6' : '#6B7280', color: '#fff' }}>
                      #{i + 1}
                    </span>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: badge.bg, color: badge.color }}>
                      {badge.label}
                    </span>
                  </div>
                  <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{b.registration_number}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{b.company_name}</p>
                  <div className="flex items-baseline justify-between mt-auto">
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Marge</span>
                    <span className="text-sm font-bold" style={{ color: b.margin >= 0 ? '#10B981' : '#EF4444' }}>
                      {fmtPct(marginPct)}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Resultat</span>
                    <span className="text-xs font-semibold" style={{ color: b.margin >= 0 ? '#10B981' : '#EF4444' }}>
                      {fmtCFA(b.margin)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Detail table */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 rounded-full animate-spin" style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
        </div>
      ) : (
        <div className="rounded-2xl border overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                <th className="text-center px-2 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>#</th>
                <th className="text-left px-3 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>Bus</th>
                <th className="text-left px-3 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>Societe</th>
                <SortTh label="Voyages" field="trip_count" />
                <SortTh label="Passagers" field="total_passengers" />
                <SortTh label="Taux rempl." field="avg_fill_rate" />
                <SortTh label="Km" field="total_km" />
                <SortTh label="Recettes" field="revenue" />
                <SortTh label="Charges" field="total_expense" />
                <SortTh label="Resultat net" field="margin" />
                <th className="text-left px-3 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>Marge %</th>
                <th className="text-left px-3 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>Statut</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map(b => {
                const badge = getPerformanceBadge(b.margin, b.revenue);
                const marginPct = b.revenue > 0 ? (b.margin / b.revenue) * 100 : 0;
                return (
                  <tr key={b.bus_id} className="border-t transition-colors hover:bg-black/[0.02]" style={{ borderColor: 'var(--border)' }}>
                    <td className="text-center px-2 py-3">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold"
                        style={{
                          backgroundColor: b.rank <= 3 ? '#10B981' : 'var(--bg-subtle)',
                          color: b.rank <= 3 ? '#fff' : 'var(--text-secondary)',
                        }}>
                        {b.rank}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                          style={{ backgroundColor: badge.bg, color: badge.color }}>
                          <Bus className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <p className="font-medium text-xs" style={{ color: 'var(--text-primary)' }}>{b.registration_number}</p>
                          <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{b.model}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{b.company_name}</td>
                    <td className="px-3 py-3 text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{b.trip_count}</td>
                    <td className="px-3 py-3 text-xs" style={{ color: '#8B5CF6' }}>{fmt(b.total_passengers)}</td>
                    <td className="px-3 py-3 text-xs font-medium" style={{ color: b.avg_fill_rate >= 70 ? '#10B981' : b.avg_fill_rate >= 40 ? '#F59E0B' : '#EF4444' }}>
                      {fmtPct(b.avg_fill_rate)}
                    </td>
                    <td className="px-3 py-3 text-xs" style={{ color: '#0EA5E9' }}>{fmt(b.total_km)} km</td>
                    <td className="px-3 py-3 text-xs font-semibold" style={{ color: '#10B981' }}>{fmtCFA(b.revenue)}</td>
                    <td className="px-3 py-3 text-xs font-semibold" style={{ color: '#EF4444' }}>{fmtCFA(b.total_expense)}</td>
                    <td className="px-3 py-3 text-xs font-bold" style={{ color: b.margin >= 0 ? '#10B981' : '#EF4444' }}>
                      {fmtCFA(b.margin)}
                    </td>
                    <td className="px-3 py-3 text-xs font-bold" style={{ color: marginPct >= 0 ? '#10B981' : '#EF4444' }}>
                      {fmtPct(marginPct)}
                    </td>
                    <td className="px-3 py-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap"
                        style={{ backgroundColor: badge.bg, color: badge.color }}>
                        {badge.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {ranked.length === 0 && (
                <tr>
                  <td colSpan={12} className="text-center py-12 text-sm" style={{ color: 'var(--text-muted)' }}>
                    Aucune donnee sur cette periode
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
