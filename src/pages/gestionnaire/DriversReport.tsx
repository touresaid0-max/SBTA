import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../services/supabase';
import { Users, Star, Download, Search, TrendingUp, ArrowUp, ArrowDown } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { format, subDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import * as XLSX from 'xlsx';

const fmt  = (n: number) => new Intl.NumberFormat('fr-CI', { maximumFractionDigits: 0 }).format(n);
const fmtC = (n: number) => fmt(n) + ' FCFA';

interface DriverRow {
  driver_id:        string;
  first_name:       string;
  last_name:        string;
  employee_id:      string;
  bus_registration: string;
  trip_count:       number;
  revenue:          number;
  cc_carburant:     number;
  cc_ration:        number;
  cc_peage:         number;
  cc_autres:        number;
  expense_total:    number;
  avg_rating:       number | null;
}

const PRESETS = [
  { label: '7j',   days: 7  },
  { label: '30j',  days: 30 },
  { label: '90j',  days: 90 },
  { label: '180j', days: 180 },
];

function RatingStars({ rating }: { rating: number | null }) {
  if (rating === null || rating === undefined) {
    return <span className="text-xs" style={{ color: 'var(--text-muted)' }}>N/A</span>;
  }
  const r = Number(rating);
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className="w-3 h-3"
          fill={i <= Math.round(r) ? '#F59E0B' : 'none'}
          style={{ color: '#F59E0B' }} />
      ))}
      <span className="text-xs ml-1 font-semibold" style={{ color: '#F59E0B' }}>{r.toFixed(1)}</span>
    </div>
  );
}

function PerfBadge({ driver }: { driver: DriverRow }) {
  // Badge basé sur recettes + voyages, pas uniquement sur la note
  const margin = Number(driver.revenue) - Number(driver.expense_total);
  const marginPct = driver.revenue > 0 ? (margin / Number(driver.revenue)) * 100 : 0;
  const rating = driver.avg_rating !== null ? Number(driver.avg_rating) : null;

  // Score composite : marge + note (si disponible)
  let label: string;
  let color: string;
  let bg: string;

  if (rating !== null && rating >= 4.5 && marginPct >= 40) {
    label = 'Excellent'; color = '#16A34A'; bg = '#DCFCE7';
  } else if ((rating === null || rating >= 3.5) && marginPct >= 25) {
    label = 'Bon'; color = '#2563EB'; bg = '#DBEAFE';
  } else if (marginPct >= 10) {
    label = 'Correct'; color = '#D97706'; bg = '#FEF3C7';
  } else if (marginPct >= 0) {
    label = 'Moyen'; color = '#EA580C'; bg = '#FFEDD5';
  } else {
    label = 'À améliorer'; color = '#EF4444'; bg = '#FEE2E2';
  }

  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
      style={{ backgroundColor: bg, color }}>
      {label}
    </span>
  );
}

export default function DriversReport() {
  const [preset, setPreset]     = useState(30);
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [dateTo, setDateTo]     = useState(format(new Date(), 'yyyy-MM-dd'));
  const [drivers, setDrivers]   = useState<DriverRow[]>([]);
  const [loading, setLoading]   = useState(false);
  const [search, setSearch]     = useState('');
  const [sortKey, setSortKey]   = useState<keyof DriverRow>('revenue');
  const [sortDir, setSortDir]   = useState<'asc' | 'desc'>('desc');

  const applyPreset = (days: number) => {
    setPreset(days);
    setDateFrom(format(subDays(new Date(), days), 'yyyy-MM-dd'));
    setDateTo(format(new Date(), 'yyyy-MM-dd'));
  };

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc('get_gestionnaire_driver_report', {
      p_date_from: dateFrom, p_date_to: dateTo,
    });
    setDrivers((data ?? []) as DriverRow[]);
    setLoading(false);
  }, [dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const filtered = drivers.filter(d => {
    const q = search.toLowerCase();
    return !q
      || d.first_name?.toLowerCase().includes(q)
      || d.last_name?.toLowerCase().includes(q)
      || d.employee_id?.toLowerCase().includes(q)
      || d.bus_registration?.toLowerCase().includes(q);
  });

  const sorted = [...filtered].sort((a, b) => {
    const av = Number(a[sortKey] ?? 0);
    const bv = Number(b[sortKey] ?? 0);
    return sortDir === 'desc' ? bv - av : av - bv;
  });

  const toggleSort = (key: keyof DriverRow) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  // KPIs
  const totalRevenue  = drivers.reduce((s, d) => s + Number(d.revenue),     0);
  const totalTrips    = drivers.reduce((s, d) => s + Number(d.trip_count),   0);
  const totalExpenses = drivers.reduce((s, d) => s + Number(d.expense_total), 0);
  const totalMargin   = totalRevenue - totalExpenses;
  const ratedDrivers  = drivers.filter(d => d.avg_rating !== null);
  const avgRating     = ratedDrivers.length > 0
    ? ratedDrivers.reduce((s, d) => s + Number(d.avg_rating), 0) / ratedDrivers.length
    : null;

  const topDrivers = [...drivers]
    .sort((a, b) => Number(b.revenue) - Number(a.revenue))
    .slice(0, 8);

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(sorted.map(d => ({
      Prénom:                    d.first_name,
      Nom:                       d.last_name,
      Matricule:                 d.employee_id,
      Bus:                       d.bus_registration || '—',
      Voyages:                   d.trip_count,
      'Recettes (FCFA)':         Number(d.revenue),
      'Carb. compl. (guichet)':  Number(d.cc_carburant ?? 0),
      'Rations (guichet)':       Number(d.cc_ration ?? 0),
      'Péages (guichet)':        Number(d.cc_peage ?? 0),
      'Autr. dép. (GCH)':        Number(d.cc_autres ?? 0),
      'Total charges guichet':   Number(d.expense_total),
      'Marge (FCFA)':            Number(d.revenue) - Number(d.expense_total),
      'Marge %':                 d.revenue > 0
        ? ((Number(d.revenue) - Number(d.expense_total)) / Number(d.revenue) * 100).toFixed(1) + '%'
        : '0%',
      'Note moyenne':            d.avg_rating !== null ? Number(d.avg_rating).toFixed(1) : 'N/A',
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Chauffeurs');
    XLSX.writeFile(wb, `rapport_chauffeurs_${dateFrom}_${dateTo}.xlsx`);
  };

  const SortTh = ({ label, field }: { label: string; field: keyof DriverRow }) => (
    <th className="text-left px-4 py-3 text-xs font-semibold cursor-pointer select-none whitespace-nowrap"
      style={{ color: 'var(--text-secondary)' }}
      onClick={() => toggleSort(field)}>
      <span className="flex items-center gap-1">
        {label}
        {sortKey === field
          ? sortDir === 'desc'
            ? <ArrowDown className="w-3 h-3" />
            : <ArrowUp className="w-3 h-3" />
          : null}
      </span>
    </th>
  );

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Rapport chauffeurs</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Performance et résultats par chauffeur
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
          <input type="date" value={dateFrom}
            onChange={e => { setPreset(0); setDateFrom(e.target.value); }}
            className="px-3 py-1.5 border rounded-lg text-sm"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
          <span style={{ color: 'var(--text-muted)' }}>→</span>
          <input type="date" value={dateTo}
            onChange={e => { setPreset(0); setDateTo(e.target.value); }}
            className="px-3 py-1.5 border rounded-lg text-sm"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
          <button onClick={exportExcel}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium"
            style={{ backgroundColor: '#16A34A', color: '#fff' }}>
            <Download className="w-4 h-4" /> Excel
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Chauffeurs actifs',  val: String(drivers.length),                      color: '#3B82F6', icon: Users },
          { label: 'Total voyages',      val: String(totalTrips),                           color: '#10B981', icon: TrendingUp },
          { label: 'Total recettes',     val: fmtC(totalRevenue),                           color: '#F59E0B', icon: TrendingUp },
          { label: 'Note moyenne',       val: avgRating !== null ? avgRating.toFixed(1) + ' / 5' : 'N/A',
            color: '#F59E0B', icon: Star },
        ].map(k => (
          <div key={k.label} className="rounded-xl border p-4"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
            <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>{k.label}</p>
            <p className="text-xl font-bold" style={{ color: k.color }}>{k.val}</p>
          </div>
        ))}
      </div>

      {/* Summary financière */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total charges guichet', val: fmtC(totalExpenses), color: '#EF4444' },
          { label: 'Marge globale',         val: fmtC(totalMargin),   color: totalMargin >= 0 ? '#10B981' : '#EF4444' },
          { label: 'Marge %',
            val: totalRevenue > 0 ? (totalMargin / totalRevenue * 100).toFixed(1) + '%' : '0%',
            color: totalMargin >= 0 ? '#10B981' : '#EF4444' },
        ].map(k => (
          <div key={k.label} className="rounded-xl border p-4"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
            <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>{k.label}</p>
            <p className="text-lg font-bold" style={{ color: k.color }}>{k.val}</p>
          </div>
        ))}
      </div>

      {/* Chart top chauffeurs */}
      {topDrivers.length > 0 && (
        <div className="rounded-2xl border p-5"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            Top chauffeurs — Recettes & Charges guichet
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={topDrivers.map(d => ({
                name:      (d.first_name ?? '') + ' ' + (d.last_name?.charAt(0) ?? '') + '.',
                Recettes:  Number(d.revenue),
                Charges:   Number(d.expense_total),
                Marge:     Number(d.revenue) - Number(d.expense_total),
              }))}
              margin={{ top: 5, right: 10, bottom: 30, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
                angle={-20} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
                tickFormatter={v => (v / 1000) + 'k'} width={45} />
              <Tooltip formatter={(v: number) => fmtC(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Recettes" fill="var(--primary)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Charges"  fill="#EF4444"         radius={[3, 3, 0, 0]} />
              <Bar dataKey="Marge"    fill="#10B981"         radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
          style={{ color: 'var(--text-muted)' }} />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Rechercher un chauffeur…"
          className="w-full pl-9 pr-3 py-2.5 border rounded-xl text-sm outline-none"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 rounded-full animate-spin"
            style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
        </div>
      ) : (
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                  <th className="text-left px-4 py-3 text-xs font-semibold"
                    style={{ color: 'var(--text-secondary)' }}>Chauffeur</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold"
                    style={{ color: 'var(--text-secondary)' }}>Matricule</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold"
                    style={{ color: 'var(--text-secondary)' }}>Bus affecté</th>
                  <SortTh label="Voyages"       field="trip_count"    />
                  <SortTh label="Recettes"      field="revenue"       />
                  <SortTh label="Carb. compl."  field="cc_carburant"  />
                  <SortTh label="Rations"       field="cc_ration"     />
                  <SortTh label="Péages"        field="cc_peage"      />
                  <SortTh label="Total charges" field="expense_total" />
                  <th className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap"
                    style={{ color: 'var(--text-secondary)' }}>Marge</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold"
                    style={{ color: 'var(--text-secondary)' }}>Marge %</th>
                  <SortTh label="Note" field="avg_rating" />
                  <th className="text-left px-4 py-3 text-xs font-semibold"
                    style={{ color: 'var(--text-secondary)' }}>Performance</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(d => {
                  const margin  = Number(d.revenue) - Number(d.expense_total);
                  const margPct = d.revenue > 0 ? (margin / Number(d.revenue) * 100) : 0;
                  return (
                    <tr key={d.driver_id} className="border-t"
                      style={{ borderColor: 'var(--border)' }}>
                      {/* Chauffeur */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                            style={{ backgroundColor: 'var(--primary)' }}>
                            {d.first_name?.charAt(0)}{d.last_name?.charAt(0)}
                          </div>
                          <span className="font-medium text-xs" style={{ color: 'var(--text-primary)' }}>
                            {d.first_name} {d.last_name}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
                        {d.employee_id || '—'}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {d.bus_registration || '—'}
                      </td>
                      <td className="px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {d.trip_count}
                      </td>
                      <td className="px-4 py-3 text-xs font-semibold" style={{ color: '#10B981' }}>
                        {fmtC(Number(d.revenue))}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: '#3B82F6' }}>
                        {fmt(Number(d.cc_carburant ?? 0))}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: '#F59E0B' }}>
                        {fmt(Number(d.cc_ration ?? 0))}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: '#6B7280' }}>
                        {fmt(Number(d.cc_peage ?? 0))}
                      </td>
                      <td className="px-4 py-3 text-xs font-semibold" style={{ color: '#EF4444' }}>
                        {fmtC(Number(d.expense_total))}
                      </td>
                      <td className="px-4 py-3 text-xs font-bold"
                        style={{ color: margin >= 0 ? '#10B981' : '#EF4444' }}>
                        {fmtC(margin)}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <span className="font-semibold"
                          style={{ color: margPct >= 20 ? '#10B981' : margPct >= 0 ? '#CA8A04' : '#EF4444' }}>
                          {margPct.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <RatingStars rating={d.avg_rating} />
                      </td>
                      <td className="px-4 py-3">
                        <PerfBadge driver={d} />
                      </td>
                    </tr>
                  );
                })}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={13} className="text-center py-10 text-sm"
                      style={{ color: 'var(--text-muted)' }}>
                      {loading ? 'Chargement…' : 'Aucun chauffeur trouvé sur cette période'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
