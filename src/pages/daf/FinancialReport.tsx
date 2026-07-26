import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../services/supabase';
import { Download, TrendingUp, TrendingDown, Award, FileText } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, Cell, LineChart, Line,
} from 'recharts';
import { format, subDays, subMonths, startOfWeek, startOfMonth, startOfQuarter, startOfYear } from 'date-fns';
import { fr } from 'date-fns/locale';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { buildCompanyGroups, resolveCompanyIds } from '../../utils/companyGroups';
import type { CompanyWithHierarchy } from '../../utils/companyGroups';

const fmtN = (n: number) => new Intl.NumberFormat('fr-CI', { maximumFractionDigits: 0 }).format(n);
const fmt  = (n: number) => fmtN(n) + ' FCFA';
const fmtM = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(0) + 'k';
  return String(Math.round(n));
};

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
  cc_autres: number;
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
  breakdown_received: number;
  breakdown_transferred: number;
}

interface DaySeries { day: string; revenue: number; expenses: number; trip_count: number; }

type PeriodId = 'hebdo' | 'mensuelle' | 'trimestrielle' | 'annuelle' | 'custom';

const PERIODS: { label: string; id: PeriodId }[] = [
  { label: 'Hebdomadaire', id: 'hebdo' },
  { label: 'Mensuelle',    id: 'mensuelle' },
  { label: 'Trimestrielle', id: 'trimestrielle' },
  { label: 'Annuelle',     id: 'annuelle' },
  { label: 'Personnalisee', id: 'custom' },
];

function getRange(id: PeriodId, cf: string, ct: string) {
  const today = new Date();
  const todayStr = format(today, 'yyyy-MM-dd');
  if (id === 'custom') return { from: cf || todayStr, to: ct || todayStr };
  if (id === 'hebdo') return { from: format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'), to: todayStr };
  if (id === 'mensuelle') return { from: format(startOfMonth(today), 'yyyy-MM-dd'), to: todayStr };
  if (id === 'trimestrielle') return { from: format(startOfQuarter(today), 'yyyy-MM-dd'), to: todayStr };
  return { from: format(startOfYear(today), 'yyyy-MM-dd'), to: todayStr };
}

function safe(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function parseRow(r: Record<string, unknown>): CompanyRow {
  const revenue = safe(r.revenue);
  const cc_carburant = safe(r.cc_carburant);
  const cc_ration = safe(r.cc_ration);
  const cc_peage = safe(r.cc_peage);
  const cc_autres = safe(r.cc_autres);
  const fuel_enlev = safe(r.fuel_enlev);
  const expense_reparation = safe(r.expense_reparation);
  const expense_autres = safe(r.expense_autres);
  const expense_charge_stock = safe(r.expense_charge_stock);
  const vehicle_exp = safe(r.vehicle_exp);
  const fuel_carburant_comptable = safe(r.fuel_carburant_comptable);
  const total_expense = cc_carburant + cc_ration + cc_peage + cc_autres + fuel_enlev
    + expense_reparation + expense_autres + expense_charge_stock + vehicle_exp + fuel_carburant_comptable;
  return {
    company_id: String(r.company_id ?? ''),
    company_name: String(r.company_name ?? ''),
    company_code: String(r.company_code ?? ''),
    parent_id: r.parent_id as string | null,
    is_group: Boolean(r.is_group),
    revenue, cc_carburant, cc_ration, cc_peage, cc_autres, fuel_enlev,
    expense_reparation, expense_autres, expense_charge_stock, vehicle_exp, fuel_carburant_comptable,
    total_expense, margin: revenue - total_expense,
    trip_count: safe(r.trip_count),
    bus_count: safe(r.bus_count),
    driver_count: safe(r.driver_count),
    breakdown_received: safe(r.breakdown_received),
    breakdown_transferred: safe(r.breakdown_transferred),
  };
}

export default function DAFFinancialReport() {
  const [periodId,   setPeriodId]   = useState<PeriodId>('mensuelle');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo,   setCustomTo]   = useState('');
  const [filterCoId, setFilterCoId] = useState<string>('all');
  const [companies,  setCompanies]  = useState<CompanyWithHierarchy[]>([]);
  const [compRows,   setCompRows]   = useState<CompanyRow[]>([]);
  const [series,     setSeries]     = useState<DaySeries[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [sortKey,    setSortKey]    = useState<keyof CompanyRow>('margin');
  const [sortDir,    setSortDir]    = useState<'asc' | 'desc'>('desc');
  const reportRef = useRef<HTMLDivElement>(null);

  const { from: dateFrom, to: dateTo } = getRange(periodId, customFrom, customTo);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const { data: companyData, error: companyErr } = await supabase.rpc('get_daf_company_list');
        if (cancelled) return;

        let companyList: CompanyWithHierarchy[] = [];
        if (companyErr) console.error('get_daf_company_list error:', companyErr);
        else if (companyData && companyData.length > 0) companyList = companyData as CompanyWithHierarchy[];

        setCompanies(companyList);

        const ids = filterCoId === 'all'
          ? companyList.map(c => c.id)
          : resolveCompanyIds(filterCoId, companyList);

        if (ids.length === 0) {
          setCompRows([]);
          setSeries([]);
          setLoading(false);
          return;
        }

        const [compRes, serRes] = await Promise.allSettled([
          supabase.rpc('get_daf_kpis_by_company', { p_company_ids: ids, p_date_from: dateFrom, p_date_to: dateTo }),
          supabase.rpc('get_daf_daily_series',    { p_company_ids: ids, p_date_from: dateFrom, p_date_to: dateTo }),
        ]);
        if (cancelled) return;

        const compData = compRes.status === 'fulfilled' && !compRes.value.error
          ? (compRes.value.data as Record<string, unknown>[]) ?? []
          : [];
        const serData = serRes.status === 'fulfilled' && !serRes.value.error
          ? (serRes.value.data as Record<string, unknown>[]) ?? []
          : [];

        if (compRes.status === 'fulfilled' && compRes.value.error)
          console.error('get_daf_kpis_by_company error:', compRes.value.error);
        if (serRes.status === 'fulfilled' && serRes.value.error)
          console.error('get_daf_daily_series error:', serRes.value.error);

        setCompRows(compData.map(parseRow));
        setSeries(
          serData.map(d => ({
            day: String(d.day ?? ''),
            revenue: Number(d.revenue ?? 0),
            expenses: Number(d.expenses ?? 0),
            trip_count: Number(d.trip_count ?? 0),
          }))
        );
      } catch (err) {
        console.error('DAF FinancialReport load error:', err);
        if (!cancelled) { setCompRows([]); setSeries([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [filterCoId, dateFrom, dateTo]);

  const { groups, standalone } = buildCompanyGroups(companies);

  const toggleSort = (key: keyof CompanyRow) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const sorted = [...compRows].sort((a, b) => {
    if (sortKey === 'company_name' || sortKey === 'company_code') {
      const av = String(a[sortKey] ?? ''), bv = String(b[sortKey] ?? '');
      return sortDir === 'desc' ? bv.localeCompare(av) : av.localeCompare(bv);
    }
    const av = Number(a[sortKey] ?? 0), bv = Number(b[sortKey] ?? 0);
    return sortDir === 'desc' ? bv - av : av - bv;
  });

  const marginPct = (c: CompanyRow) =>
    c.revenue > 0 ? (c.margin / c.revenue) * 100 : (c.total_expense > 0 ? -100 : 0);

  const ranked = [...compRows]
    .filter(c => !c.is_group && (c.revenue > 0 || c.total_expense > 0))
    .sort((a, b) => marginPct(b) - marginPct(a));

  const barData = ranked.slice(0, 10).map(c => ({
    name: c.company_code || c.company_name.slice(0, 10),
    Recettes: c.revenue,
    Charges: c.total_expense,
    Benefice: c.margin,
  }));

  const lineData = series
    .filter((_, i, arr) => arr.length <= 90 || i % Math.ceil(arr.length / 90) === 0)
    .map(d => ({
      date: format(new Date(d.day + 'T00:00:00'), 'dd/MM', { locale: fr }),
      Recettes: d.revenue,
      Charges:  d.expenses,
    }));

  const totals = compRows.reduce((acc, r) => ({
    revenue: acc.revenue + r.revenue,
    total_expense: acc.total_expense + r.total_expense,
    margin: acc.margin + r.margin,
    trip_count: acc.trip_count + r.trip_count,
    bus_count: acc.bus_count + r.bus_count,
    breakdown_received: acc.breakdown_received + r.breakdown_received,
    breakdown_transferred: acc.breakdown_transferred + r.breakdown_transferred,
    cc_autres: acc.cc_autres + r.cc_autres,
  }), { revenue: 0, total_expense: 0, margin: 0, trip_count: 0, bus_count: 0, breakdown_received: 0, breakdown_transferred: 0, cc_autres: 0 });

  const kpiCards = [
    { label: 'Total recettes',       val: totals.revenue,        color: '#10B981', icon: TrendingUp },
    { label: 'Total charges',        val: totals.total_expense,   color: '#EF4444', icon: TrendingDown },
    { label: 'Benefice net',         val: totals.margin,          color: totals.margin >= 0 ? '#10B981' : '#EF4444', icon: totals.margin >= 0 ? TrendingUp : TrendingDown },
    { label: 'Marge globale',        val: totals.revenue > 0 ? (totals.margin / totals.revenue) * 100 : 0, color: totals.margin >= 0 ? '#10B981' : '#EF4444', isPct: true },
    { label: 'Total voyages',        val: totals.trip_count,      color: '#3B82F6' },
    { label: 'Bus actifs',           val: totals.bus_count,       color: '#8B5CF6' },
    { label: 'Rep. panne recues',    val: totals.breakdown_received, color: '#0EA5E9' },
  ];

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const sheetData = sorted.map(c => ({
      'Societe': c.company_name,
      'Revenus': c.revenue,
      'Charges': c.total_expense,
      'Benefice': c.margin,
      'Marge %': c.revenue > 0 ? ((c.margin / c.revenue) * 100).toFixed(2) + '%' : '--',
      'Voyages': c.trip_count,
      'Bus actifs': c.bus_count,
      'Rep. panne recues': c.breakdown_received,
      'Rep. panne transferees': c.breakdown_transferred,
      'Carb. BE': c.cc_carburant,
      'Rations': c.cc_ration,
      'Peages': c.cc_peage,
      'Autres charges': c.cc_autres,
      'Carb. cuve': c.fuel_enlev,
      'Carb. agent': c.fuel_carburant_comptable,
      'Reparations': c.expense_reparation,
      'Ch. achat': c.vehicle_exp,
      'Art. stock': c.expense_autres,
      'Charge stock': c.expense_charge_stock,
    }));
    sheetData.push({
      'Societe': 'TOTAL CONSOLIDE',
      'Revenus': totals.revenue,
      'Charges': totals.total_expense,
      'Benefice': totals.margin,
      'Marge %': totals.revenue > 0 ? ((totals.margin / totals.revenue) * 100).toFixed(2) + '%' : '--',
      'Voyages': totals.trip_count,
      'Bus actifs': totals.bus_count,
      'Rep. panne recues': totals.breakdown_received,
      'Rep. panne transferees': totals.breakdown_transferred,
      'Carb. BE': 0, 'Rations': 0, 'Peages': 0, 'Autres charges': 0, 'Carb. cuve': 0,
      'Carb. agent': 0, 'Reparations': 0, 'Ch. achat': 0, 'Art. stock': 0, 'Charge stock': 0,
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetData), 'Rapport financier');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      ranked.map((c, i) => ({
        Rang: i + 1, Societe: c.company_name,
        Revenus: c.revenue, Charges: c.total_expense,
        Benefice: c.margin,
        'Marge %': c.revenue > 0 ? ((c.margin / c.revenue) * 100).toFixed(2) + '%' : '--',
        Voyages: c.trip_count,
      }))
    ), 'Classement');

    XLSX.writeFile(wb, `daf_rapport_financier_${dateFrom}_${dateTo}.xlsx`);
  };

  const exportPdf = async () => {
    if (!reportRef.current) return;
    const canvas = await html2canvas(reportRef.current, { scale: 1.5, useCORS: true, backgroundColor: '#ffffff' });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const w = pdf.internal.pageSize.getWidth();
    const h = (canvas.height * w) / canvas.width;
    let y = 0;
    const pageH = pdf.internal.pageSize.getHeight();
    while (y < h) {
      if (y > 0) pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, -y, w, h);
      y += pageH;
    }
    pdf.save(`daf_rapport_financier_${dateFrom}_${dateTo}.pdf`);
  };

  const SortTh = ({ label, field }: { label: string; field: keyof CompanyRow }) => (
    <th className="text-left px-3 py-3 text-xs font-semibold cursor-pointer select-none hover:opacity-80 whitespace-nowrap"
      style={{ color: 'var(--text-secondary)' }} onClick={() => toggleSort(field)}>
      {label}{sortKey === field ? (sortDir === 'desc' ? ' \u2193' : ' \u2191') : ''}
    </th>
  );

  const maxAbsPct = Math.max(...ranked.map(r => Math.abs(marginPct(r))), 1);

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Rapport financier consolide</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            Analyse financiere par societe — {dateFrom} {'\u2192'} {dateTo}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportPdf}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors hover:opacity-90"
            style={{ backgroundColor: '#DC2626', color: '#fff' }}>
            <FileText className="w-4 h-4" /> Export PDF
          </button>
          <button onClick={exportExcel}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors hover:opacity-90"
            style={{ backgroundColor: '#16A34A', color: '#fff' }}>
            <Download className="w-4 h-4" /> Export Excel
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-2xl border p-4 flex flex-wrap gap-3 items-center"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
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
          <>
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              className="px-3 py-1.5 border rounded-lg text-sm"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
            <span style={{ color: 'var(--text-muted)' }}>{'\u2192'}</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              className="px-3 py-1.5 border rounded-lg text-sm"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
          </>
        )}
        <select value={filterCoId} onChange={e => setFilterCoId(e.target.value)}
          className="px-3 py-1.5 border rounded-xl text-sm ml-auto"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}>
          <option value="all">Toutes les societes</option>
          {groups.map(g => (
            <optgroup key={g.group.id} label={g.group.name}>
              <option value={g.group.id}>{g.group.name} (groupe)</option>
              {g.subsidiaries.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </optgroup>
          ))}
          {standalone.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 rounded-full animate-spin" style={{ borderColor: '#0B7439', borderTopColor: 'transparent' }} />
        </div>
      ) : (
        <div ref={reportRef} className="space-y-5">
          {/* KPI summary */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {kpiCards.map(k => (
              <div key={k.label} className="rounded-xl border p-4" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
                <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>{k.label}</p>
                <p className="text-lg font-bold" style={{ color: k.color }}>
                  {(k as any).isPct ? `${(k.val as number).toFixed(1)}%` : typeof k.val === 'number' && k.val > 999 ? fmt(k.val) : fmtN(k.val as number)}
                </p>
              </div>
            ))}
          </div>

          {/* Classement + Evolution */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Classement rentabilite */}
            <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                Classement des societes par rentabilite
              </h3>
              <div className="space-y-3.5">
                {ranked.map((c, i) => {
                  const mp = marginPct(c);
                  const isPos = c.margin >= 0;
                  const barWidth = Math.min((Math.abs(mp) / maxAbsPct) * 100, 100);
                  return (
                    <div key={c.company_id}>
                      <div className="flex items-center gap-3">
                        <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                          style={{ backgroundColor: isPos ? '#0B7439' : '#EF4444' }}>
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                              {c.company_code || c.company_name}
                            </span>
                            <span className="text-sm font-bold flex-shrink-0 ml-2" style={{ color: isPos ? '#10B981' : '#EF4444' }}>
                              {mp.toFixed(1)}%
                            </span>
                          </div>
                          <div className="h-2 rounded-full" style={{ backgroundColor: 'var(--border)' }}>
                            <div className="h-2 rounded-full transition-all"
                              style={{ backgroundColor: isPos ? '#10B981' : '#EF4444', width: `${barWidth}%` }} />
                          </div>
                          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                            {fmt(c.revenue)} {'\u00B7'} {c.trip_count} voyages {'\u00B7'} {c.bus_count} bus
                          </p>
                        </div>
                        <div className="flex items-center gap-0.5 flex-shrink-0 ml-1">
                          {isPos
                            ? <TrendingUp className="w-4 h-4" style={{ color: '#10B981' }} />
                            : <TrendingDown className="w-4 h-4" style={{ color: '#EF4444' }} />}
                          <span className="text-sm font-semibold" style={{ color: isPos ? '#10B981' : '#EF4444' }}>
                            {fmtM(c.margin)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {ranked.length === 0 && (
                  <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>Aucune donnee sur cette periode</p>
                )}
              </div>
            </div>

            {/* Evolution temporelle */}
            <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                Evolution Recettes / Charges
              </h3>
              {lineData.length === 0 ? (
                <div className="flex items-center justify-center h-52 text-sm" style={{ color: 'var(--text-muted)' }}>
                  Aucune donnee sur cette periode
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={lineData} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} />
                    <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} tickFormatter={v => fmtM(v as number)} width={48} />
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="Recettes" stroke="#10B981" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="Charges"  stroke="#EF4444" strokeWidth={2} dot={false} strokeDasharray="4 2" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Bar chart comparison */}
          {barData.length > 1 && (
            <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                Comparaison Revenus / Charges / Benefice par societe
              </h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={barData} margin={{ top: 0, right: 10, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} tickFormatter={v => fmtM(v as number)} width={48} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Recettes" fill="#10B981" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Charges"  fill="#EF4444" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Benefice" radius={[3, 3, 0, 0]}>
                    {barData.map((d, i) => <Cell key={i} fill={d.Benefice >= 0 ? '#3B82F6' : '#F97316'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Detailed table */}
          <div className="rounded-2xl border overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Detail financier par societe
              </h3>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {dateFrom} {'\u2192'} {dateTo} {'\u00B7'} {sorted.length} societe(s)
              </p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                  <SortTh label="Societe"             field="company_name" />
                  <SortTh label="Revenus"             field="revenue" />
                  <SortTh label="Charges"             field="total_expense" />
                  <SortTh label="Benefice"            field="margin" />
                  <SortTh label="Marge %"             field="margin" />
                  <SortTh label="Voyages"             field="trip_count" />
                  <SortTh label="Bus actifs"          field="bus_count" />
                  <SortTh label="Rep. recues"         field="breakdown_received" />
                  <SortTh label="Rep. transferees"    field="breakdown_transferred" />
                  <SortTh label="Carb. BE"            field="cc_carburant" />
                  <SortTh label="Rations"             field="cc_ration" />
                  <SortTh label="Peages"              field="cc_peage" />
                  <SortTh label="Autres"              field="cc_autres" />
                  <SortTh label="Carb. cuve"          field="fuel_enlev" />
                  <SortTh label="Carb. agent"         field="fuel_carburant_comptable" />
                  <SortTh label="Reparations"         field="expense_reparation" />
                  <SortTh label="Ch. achat"           field="vehicle_exp" />
                  <SortTh label="Art. stock"          field="expense_autres" />
                  <SortTh label="Charge stock"       field="expense_charge_stock" />
                </tr>
              </thead>
              <tbody>
                {sorted.map(c => {
                  const mp = c.revenue > 0 ? (c.margin / c.revenue) * 100 : 0;
                  return (
                    <tr key={c.company_id} className="border-t hover:opacity-90"
                      style={{ borderColor: 'var(--border)', fontWeight: c.is_group ? 700 : 400 }}>
                      <td className="px-3 py-2.5 text-xs">
                        <div className="flex items-center gap-1.5">
                          <span style={{ color: 'var(--text-primary)' }}>{c.company_name}</span>
                          {c.is_group && <span className="text-xs px-1 rounded" style={{ backgroundColor: '#0B743920', color: '#0B7439' }}>G</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-xs font-semibold" style={{ color: '#10B981' }}>{fmtN(c.revenue)}</td>
                      <td className="px-3 py-2.5 text-xs font-semibold" style={{ color: '#EF4444' }}>{fmtN(c.total_expense)}</td>
                      <td className="px-3 py-2.5 text-xs font-bold" style={{ color: c.margin >= 0 ? '#10B981' : '#EF4444' }}>{fmtN(c.margin)}</td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full"
                          style={{
                            backgroundColor: mp >= 15 ? '#DCFCE7' : mp >= 0 ? '#FEF9C3' : '#FEE2E2',
                            color: mp >= 15 ? '#16A34A' : mp >= 0 ? '#CA8A04' : '#EF4444',
                          }}>{mp.toFixed(1)}%</span>
                      </td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{c.trip_count}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#8B5CF6' }}>{c.bus_count}</td>
                      <td className="px-3 py-2.5 text-xs font-medium" style={{ color: '#0EA5E9' }}>{fmtN(c.breakdown_received)}</td>
                      <td className="px-3 py-2.5 text-xs font-medium" style={{ color: '#F97316' }}>{fmtN(c.breakdown_transferred)}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#3B82F6' }}>{fmtN(c.cc_carburant)}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#6366F1' }}>{fmtN(c.cc_ration)}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#14B8A6' }}>{fmtN(c.cc_peage)}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#A855F7' }}>{fmtN(c.cc_autres)}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#F97316' }}>{fmtN(c.fuel_enlev)}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#D97706' }}>{fmtN(c.fuel_carburant_comptable)}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#EF4444' }}>{fmtN(c.expense_reparation)}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#06B6D4' }}>{fmtN(c.vehicle_exp)}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#8B5CF6' }}>{fmtN(c.expense_autres)}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#7C3AED' }}>{fmtN(c.expense_charge_stock)}</td>
                    </tr>
                  );
                })}

                {/* Totals row */}
                {sorted.length > 0 && (
                  <tr className="border-t-2" style={{ borderColor: 'var(--border)', fontWeight: 700, backgroundColor: 'var(--bg-subtle)' }}>
                    <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-primary)' }}>TOTAL CONSOLIDE</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: '#10B981' }}>{fmtN(totals.revenue)}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: '#EF4444' }}>{fmtN(totals.total_expense)}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: totals.margin >= 0 ? '#10B981' : '#EF4444' }}>{fmtN(totals.margin)}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {totals.revenue > 0 ? ((totals.margin / totals.revenue) * 100).toFixed(1) + '%' : '\u2014'}
                    </td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{totals.trip_count}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: '#8B5CF6' }}>{totals.bus_count}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: '#0EA5E9' }}>{fmtN(totals.breakdown_received)}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: '#F97316' }}>{fmtN(totals.breakdown_transferred)}</td>
                    <td colSpan={9} style={{ color: '#A855F7' }}>{fmtN(totals.cc_autres)}</td>
                    <td colSpan={8} />
                  </tr>
                )}

                {sorted.length === 0 && (
                  <tr><td colSpan={18} className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>Aucune donnee sur cette periode</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Podium top 3 */}
          {ranked.length >= 3 && (
            <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <Award className="w-4 h-4" style={{ color: '#F59E0B' }} /> Top 3 societes les plus rentables
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {ranked.slice(0, 3).map((c, i) => {
                  const mp = marginPct(c);
                  const medals = ['#F59E0B', '#9CA3AF', '#CD7F32'];
                  return (
                    <div key={c.company_id} className="rounded-xl border p-4 text-center"
                      style={{ borderColor: medals[i] + '60', backgroundColor: medals[i] + '10' }}>
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-black mx-auto mb-2"
                        style={{ backgroundColor: medals[i], color: '#fff' }}>{i + 1}</div>
                      <p className="font-semibold text-sm mb-1" style={{ color: 'var(--text-primary)' }}>{c.company_name}</p>
                      <p className="text-xl font-black" style={{ color: c.margin >= 0 ? '#10B981' : '#EF4444' }}>{mp.toFixed(1)}%</p>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{fmt(c.margin)} {'\u00B7'} {c.trip_count} voyages</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
