import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../services/supabase';
import {
  Download, Bus, TrendingUp, TrendingDown, AlertTriangle, Award,
  ArrowUpRight, ArrowDownRight, FileText, MapPin, Users,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, Cell,
} from 'recharts';
import { format, startOfWeek, startOfMonth, startOfQuarter, startOfYear } from 'date-fns';
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

interface BusRow {
  bus_id: string;
  registration_number: string;
  model: string;
  company_id: string;
  company_name: string;
  main_station: string;
  trip_count: number;
  total_passengers: number;
  avg_fill_rate: number;
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

function perf(margin: number, revenue: number) {
  if (revenue === 0) return { label: 'Inactif',       color: '#6B7280', bg: '#F3F4F6' };
  const p = revenue > 0 ? (margin / revenue) * 100 : -100;
  if (p >= 30)  return { label: 'Tres rentable', color: '#16A34A', bg: '#DCFCE7' };
  if (p >= 15)  return { label: 'Rentable',       color: '#2563EB', bg: '#DBEAFE' };
  if (p >= 0)   return { label: 'Moyen',          color: '#D97706', bg: '#FEF3C7' };
  if (p >= -20) return { label: 'Deficitaire',    color: '#DC2626', bg: '#FEE2E2' };
  return         { label: 'Critique',        color: '#7F1D1D', bg: '#FEE2E2' };
}

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

function parseBusRow(r: Record<string, unknown>): BusRow {
  const revenue = safe(r.revenue);
  const cc_carburant = safe(r.cc_carburant);
  const cc_ration = safe(r.cc_ration);
  const cc_peage = safe(r.cc_peage);
  const fuel_enlev = safe(r.fuel_enlev);
  const expense_reparation = safe(r.expense_reparation);
  const expense_autres = safe(r.expense_autres);
  const expense_charge_stock = safe(r.expense_charge_stock);
  const expense_garage_pieces = safe(r.expense_garage_pieces);
  const vehicle_exp = safe(r.vehicle_exp);
  const fuel_carburant_comptable = safe(r.fuel_carburant_comptable);
  const total_expense = cc_carburant + cc_ration + cc_peage + fuel_enlev
    + expense_reparation + expense_autres + expense_charge_stock + expense_garage_pieces + vehicle_exp + fuel_carburant_comptable;
  return {
    bus_id: String(r.bus_id ?? ''),
    registration_number: String(r.registration_number ?? ''),
    model: String(r.model ?? ''),
    company_id: String(r.company_id ?? ''),
    company_name: String(r.company_name ?? ''),
    main_station: String(r.main_station ?? ''),
    trip_count: safe(r.trip_count),
    total_passengers: safe(r.total_passengers),
    avg_fill_rate: safe(r.avg_fill_rate),
    revenue, cc_carburant, cc_ration, cc_peage, fuel_enlev,
    expense_reparation, expense_autres, expense_charge_stock, expense_garage_pieces, vehicle_exp, fuel_carburant_comptable,
    total_expense, margin: revenue - total_expense,
    breakdown_received: safe(r.breakdown_received),
    breakdown_transferred: safe(r.breakdown_transferred),
  };
}

export default function DAFBusPerformance() {
  const [periodId,   setPeriodId]   = useState<PeriodId>('mensuelle');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo,   setCustomTo]   = useState('');
  const [filterCoId, setFilterCoId] = useState<string>('all');
  const [filterBus,  setFilterBus]  = useState('');
  const [companies,  setCompanies]  = useState<CompanyWithHierarchy[]>([]);
  const [busRows,    setBusRows]    = useState<BusRow[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [sortKey,    setSortKey]    = useState<keyof BusRow>('margin');
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
          setBusRows([]);
          setLoading(false);
          return;
        }

        const res = await supabase.rpc('get_daf_revenue_by_bus', {
          p_company_ids: ids, p_date_from: dateFrom, p_date_to: dateTo,
        });
        if (cancelled) return;
        if (res.error) console.error('get_daf_revenue_by_bus error:', res.error);
        const rows = res.data ? (res.data as Record<string, unknown>[]) : [];
        setBusRows(rows.map(parseBusRow));
      } catch (err) {
        console.error('DAF BusPerformance load error:', err);
        if (!cancelled) setBusRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [filterCoId, dateFrom, dateTo]);

  const { groups, standalone } = buildCompanyGroups(companies);

  const toggleSort = (key: keyof BusRow) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const filtered = busRows.filter(b =>
    !filterBus || b.registration_number.toLowerCase().includes(filterBus.toLowerCase())
  );

  const sorted = [...filtered].sort((a, b) => {
    if (sortKey === 'registration_number' || sortKey === 'company_name' || sortKey === 'main_station') {
      const av = String(a[sortKey] ?? ''), bv = String(b[sortKey] ?? '');
      return sortDir === 'desc' ? bv.localeCompare(av) : av.localeCompare(bv);
    }
    const av = Number(a[sortKey] ?? 0), bv = Number(b[sortKey] ?? 0);
    return sortDir === 'desc' ? bv - av : av - bv;
  });

  const topMargin   = [...busRows].filter(b => b.revenue > 0).sort((a, b) => b.margin - a.margin).slice(0, 5);
  const defBuses    = [...busRows].filter(b => b.margin < 0).sort((a, b) => a.margin - b.margin).slice(0, 5);
  const costlyBuses = [...busRows].sort((a, b) => b.total_expense - a.total_expense).slice(0, 5);

  const chartTopData = topMargin.map(b => ({
    name: b.registration_number,
    marge: b.margin,
    recettes: b.revenue,
    company: b.company_name,
  }));

  const totalBuses    = busRows.length;
  const profitBuses   = busRows.filter(b => b.margin >= 0).length;
  const deficitCount  = busRows.filter(b => b.margin < 0).length;
  const avgRevPerBus  = totalBuses > 0 ? busRows.reduce((s, b) => s + b.revenue, 0) / totalBuses : 0;
  const totalPassengers = busRows.reduce((s, b) => s + b.total_passengers, 0);
  const avgFill = totalBuses > 0 ? busRows.reduce((s, b) => s + b.avg_fill_rate, 0) / totalBuses : 0;

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sorted.map(b => {
      const mp = b.revenue > 0 ? ((b.margin / b.revenue) * 100).toFixed(2) + '%' : '\u2014';
      return {
        Immatriculation: b.registration_number,
        Societe: b.company_name,
        Gare: b.main_station || '\u2014',
        Voyages: b.trip_count,
        'Places vendues': b.total_passengers,
        'Taux rempl. %': b.avg_fill_rate.toFixed(1) + '%',
        Recettes: b.revenue,
        Charges: b.total_expense,
        Resultat: b.margin,
        'Marge %': mp,
        Reparations: b.expense_reparation,
        Carburant: b.cc_carburant + b.fuel_enlev + b.fuel_carburant_comptable,
        Peages: b.cc_peage,
        'Autres charges': b.cc_ration + b.expense_autres + b.vehicle_exp,
        'Charge stock': b.expense_charge_stock,
        'Sorties pieces garage': b.expense_garage_pieces,
        'Rep. panne recues': b.breakdown_received,
        'Rep. panne transferees': b.breakdown_transferred,
        Statut: perf(b.margin, b.revenue).label,
      };
    })), 'Performance bus');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(topMargin.map((b, i) => ({
      Rang: i + 1, Bus: b.registration_number, Societe: b.company_name,
      Marge: b.margin, 'Marge %': b.revenue > 0 ? ((b.margin / b.revenue) * 100).toFixed(2) + '%' : '\u2014',
    }))), 'Top rentables');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(defBuses.map(b => ({
      Bus: b.registration_number, Societe: b.company_name,
      Deficit: b.margin, 'Marge %': b.revenue > 0 ? ((b.margin / b.revenue) * 100).toFixed(2) + '%' : '\u2014',
    }))), 'Deficitaires');
    XLSX.writeFile(wb, `daf_performance_bus_${dateFrom}_${dateTo}.xlsx`);
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
    pdf.save(`daf_performance_bus_${dateFrom}_${dateTo}.pdf`);
  };

  const SortTh = ({ label, field }: { label: string; field: keyof BusRow }) => (
    <th className="text-left px-3 py-3 text-xs font-semibold cursor-pointer select-none hover:opacity-80 whitespace-nowrap"
      style={{ color: 'var(--text-secondary)' }} onClick={() => toggleSort(field)}>
      {label}{sortKey === field ? (sortDir === 'desc' ? ' \u2193' : ' \u2191') : ''}
    </th>
  );

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1600px] mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Performance bus consolidee</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            Analyse de rentabilite par bus — {dateFrom} {'\u2192'} {dateTo}
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
          className="px-3 py-1.5 border rounded-xl text-sm"
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
        <input placeholder="Filtrer immatriculation..." value={filterBus} onChange={e => setFilterBus(e.target.value)}
          className="px-3 py-1.5 border rounded-xl text-sm ml-auto"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)', minWidth: 180 }} />
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 rounded-full animate-spin" style={{ borderColor: '#0B7439', borderTopColor: 'transparent' }} />
        </div>
      ) : (
        <div ref={reportRef} className="space-y-5">
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: 'Total bus',          val: fmtN(totalBuses),          color: '#3B82F6', icon: Bus },
              { label: 'Bus rentables',      val: fmtN(profitBuses),         color: '#10B981', icon: TrendingUp },
              { label: 'Bus deficitaires',   val: fmtN(deficitCount),        color: '#EF4444', icon: TrendingDown },
              { label: 'Passagers',          val: fmtN(totalPassengers),     color: '#8B5CF6', icon: Users },
              { label: 'Taux rempl. moy.',   val: avgFill.toFixed(1) + '%',  color: '#0EA5E9', icon: MapPin },
              { label: 'Recette moy./bus',   val: fmt(avgRevPerBus),         color: '#F59E0B', icon: Award },
            ].map(k => (
              <div key={k.label} className="rounded-xl border p-4" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-2 mb-1">
                  <k.icon className="w-3.5 h-3.5" style={{ color: k.color }} />
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{k.label}</p>
                </div>
                <p className="text-lg font-bold" style={{ color: k.color }}>{k.val}</p>
              </div>
            ))}
          </div>

          {/* Top / Deficit / Costly panels */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Top rentables */}
            <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                <Award className="w-4 h-4" style={{ color: '#F59E0B' }} /> Top 5 bus rentables
              </h3>
              {topMargin.map((b, i) => {
                const mp = b.revenue > 0 ? (b.margin / b.revenue) * 100 : 0;
                return (
                  <div key={b.bus_id} className="flex items-center gap-3 py-1.5">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                      style={{ backgroundColor: i === 0 ? '#F59E0B' : i === 1 ? '#9CA3AF' : '#0B7439' }}>{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{b.registration_number}</p>
                      <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{b.company_name}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold flex items-center gap-0.5" style={{ color: '#10B981' }}>
                        <ArrowUpRight className="w-3.5 h-3.5" />{fmtM(b.margin)}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{mp.toFixed(1)}%</p>
                    </div>
                  </div>
                );
              })}
              {topMargin.length === 0 && <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>Aucun bus</p>}
            </div>

            {/* Deficitaires */}
            <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5" style={{ color: '#EF4444' }}>
                <AlertTriangle className="w-4 h-4" /> Bus deficitaires
              </h3>
              {defBuses.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-28 gap-2">
                  <TrendingUp className="w-7 h-7" style={{ color: '#10B981' }} />
                  <p className="text-sm font-medium" style={{ color: '#10B981' }}>Tous les bus sont rentables</p>
                </div>
              ) : defBuses.map(b => {
                const mp = b.revenue > 0 ? (b.margin / b.revenue) * 100 : -100;
                return (
                  <div key={b.bus_id} className="flex items-center gap-3 py-1.5">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#FEE2E2' }}>
                      <Bus className="w-3.5 h-3.5" style={{ color: '#EF4444' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{b.registration_number}</p>
                      <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{b.company_name}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold flex items-center gap-0.5" style={{ color: '#EF4444' }}>
                        <ArrowDownRight className="w-3.5 h-3.5" />{fmtM(Math.abs(b.margin))}
                      </p>
                      <p className="text-xs" style={{ color: '#EF4444' }}>{mp.toFixed(1)}%</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Plus couteux */}
            <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
                Bus les plus couteux
              </h3>
              {costlyBuses.map((b, i) => (
                <div key={b.bus_id} className="flex items-center gap-3 py-1.5">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                    style={{ backgroundColor: '#FEE2E240', color: '#EF4444', border: '1px solid #EF4444' }}>{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{b.registration_number}</p>
                    <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{b.company_name}</p>
                  </div>
                  <p className="text-sm font-bold flex-shrink-0" style={{ color: '#EF4444' }}>{fmtM(b.total_expense)}</p>
                </div>
              ))}
              {costlyBuses.length === 0 && <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>Aucun bus</p>}
            </div>
          </div>

          {/* Top bar chart */}
          {chartTopData.length > 1 && (
            <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                Top bus — Recettes vs Resultat
              </h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartTopData} margin={{ top: 0, right: 10, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} tickFormatter={v => fmtM(v as number)} width={45} />
                  <Tooltip formatter={(v: number) => fmt(v)} labelFormatter={(l, p) => `${l} — ${p[0]?.payload?.company ?? ''}`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="recettes" name="Recettes" fill="#10B981" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="marge" name="Resultat" radius={[3, 3, 0, 0]}>
                    {chartTopData.map((d, i) => <Cell key={i} fill={d.marge >= 0 ? '#3B82F6' : '#EF4444'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Full detail table */}
          <div className="rounded-2xl border overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Detail par bus
              </h3>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{sorted.length} bus affiches</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                  <SortTh label="Immatriculation"    field="registration_number" />
                  <SortTh label="Societe"            field="company_name" />
                  <SortTh label="Gare"               field="main_station" />
                  <SortTh label="Voyages"            field="trip_count" />
                  <SortTh label="Places vendues"     field="total_passengers" />
                  <SortTh label="Taux rempl."        field="avg_fill_rate" />
                  <SortTh label="Recettes"           field="revenue" />
                  <SortTh label="Charges"            field="total_expense" />
                  <SortTh label="Resultat"           field="margin" />
                  <SortTh label="Marge %"            field="margin" />
                  <SortTh label="Reparations"        field="expense_reparation" />
                  <SortTh label="Carburant"          field="cc_carburant" />
                  <SortTh label="Peages"             field="cc_peage" />
                  <SortTh label="Autres ch."         field="expense_autres" />
                  <SortTh label="Charge stock"       field="expense_charge_stock" />
                  <SortTh label="SP garage"          field="expense_garage_pieces" />
                  <SortTh label="Rep. panne"         field="breakdown_received" />
                  <th className="text-left px-3 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>Statut</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(b => {
                  const badge = perf(b.margin, b.revenue);
                  const mp = b.revenue > 0 ? (b.margin / b.revenue) * 100 : 0;
                  const totalCarburant = b.cc_carburant + b.fuel_enlev + b.fuel_carburant_comptable;
                  const autresCharges = b.cc_ration + b.expense_autres + b.vehicle_exp;
                  return (
                    <tr key={b.bus_id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                      <td className="px-3 py-2.5 text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                        <div className="flex items-center gap-1.5">
                          <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: badge.bg }}>
                            <Bus className="w-3 h-3" style={{ color: badge.color }} />
                          </div>
                          {b.registration_number}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{b.company_name}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {b.main_station || <span style={{ color: 'var(--text-muted)' }}>{'\u2014'}</span>}
                      </td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{b.trip_count}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#8B5CF6' }}>{fmtN(b.total_passengers)}</td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full"
                          style={{
                            backgroundColor: b.avg_fill_rate >= 70 ? '#DCFCE7' : b.avg_fill_rate >= 40 ? '#FEF9C3' : '#FEE2E2',
                            color: b.avg_fill_rate >= 70 ? '#16A34A' : b.avg_fill_rate >= 40 ? '#CA8A04' : '#EF4444',
                          }}>{b.avg_fill_rate.toFixed(1)}%</span>
                      </td>
                      <td className="px-3 py-2.5 text-xs font-semibold" style={{ color: '#10B981' }}>{fmtN(b.revenue)}</td>
                      <td className="px-3 py-2.5 text-xs font-semibold" style={{ color: '#EF4444' }}>{fmtN(b.total_expense)}</td>
                      <td className="px-3 py-2.5 text-xs font-bold" style={{ color: b.margin >= 0 ? '#10B981' : '#EF4444' }}>{fmtN(b.margin)}</td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full"
                          style={{
                            backgroundColor: mp >= 15 ? '#DCFCE7' : mp >= 0 ? '#FEF9C3' : '#FEE2E2',
                            color: mp >= 15 ? '#16A34A' : mp >= 0 ? '#CA8A04' : '#EF4444',
                          }}>{mp.toFixed(1)}%</span>
                      </td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#EF4444' }}>{fmtN(b.expense_reparation)}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#3B82F6' }}>{fmtN(totalCarburant)}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#14B8A6' }}>{fmtN(b.cc_peage)}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#8B5CF6' }}>{fmtN(autresCharges)}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#7C3AED' }}>{fmtN(b.expense_charge_stock)}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#B45309' }}>{fmtN(b.expense_garage_pieces)}</td>
                      <td className="px-3 py-2.5 text-xs">
                        <span style={{ color: '#0EA5E9' }}>{fmtN(b.breakdown_received)}</span>
                        {' / '}
                        <span style={{ color: '#F97316' }}>{fmtN(b.breakdown_transferred)}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: badge.bg, color: badge.color }}>
                          {badge.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {sorted.length === 0 && (
                  <tr><td colSpan={18} className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>Aucune donnee</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
