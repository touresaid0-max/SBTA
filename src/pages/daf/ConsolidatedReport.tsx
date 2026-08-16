import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../services/supabase';
import { Download, TrendingUp, TrendingDown, FileText, ChevronDown, ChevronRight } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, Cell, AreaChart, Area, PieChart, Pie,
} from 'recharts';
import { format, startOfWeek, startOfMonth, startOfQuarter, startOfYear, subMonths } from 'date-fns';
import { fr } from 'date-fns/locale';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { buildCompanyGroups, resolveCompanyIds } from '../../utils/companyGroups';
import type { CompanyWithHierarchy } from '../../utils/companyGroups';

const fmtN = (n: number) => new Intl.NumberFormat('fr-CI', { maximumFractionDigits: 0 }).format(n);
const fmt = (n: number) => fmtN(n) + ' FCFA';
const fmtM = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(0) + 'k';
  return String(Math.round(n));
};
const safe = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

type PeriodId = 'hebdo' | 'mensuelle' | 'trimestrielle' | 'semestrielle' | 'annuelle' | 'custom';

const PERIODS: { label: string; id: PeriodId }[] = [
  { label: 'Hebdomadaire', id: 'hebdo' },
  { label: 'Mensuelle', id: 'mensuelle' },
  { label: 'Trimestrielle', id: 'trimestrielle' },
  { label: 'Semestrielle', id: 'semestrielle' },
  { label: 'Annuelle', id: 'annuelle' },
  { label: 'Personnalisee', id: 'custom' },
];

function getRange(id: PeriodId, cf: string, ct: string) {
  const today = new Date();
  const todayStr = format(today, 'yyyy-MM-dd');
  if (id === 'custom') return { from: cf || todayStr, to: ct || todayStr };
  if (id === 'hebdo') return { from: format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'), to: todayStr };
  if (id === 'mensuelle') return { from: format(startOfMonth(today), 'yyyy-MM-dd'), to: todayStr };
  if (id === 'trimestrielle') return { from: format(startOfQuarter(today), 'yyyy-MM-dd'), to: todayStr };
  if (id === 'semestrielle') return { from: format(subMonths(startOfMonth(today), 5), 'yyyy-MM-dd'), to: todayStr };
  return { from: format(startOfYear(today), 'yyyy-MM-dd'), to: todayStr };
}

interface CompanyKpi {
  company_id: string;
  company_name: string;
  company_code: string;
  parent_id: string | null;
  is_group: boolean;
  revenue: number;
  breakdown_received: number;
  cc_carburant: number;
  cc_ration: number;
  cc_peage: number;
  cc_autres: number;
  fuel_enlev: number;
  expense_reparation: number;
  expense_autres: number;
  vehicle_exp: number;
  fuel_carburant_comptable: number;
  variable_charges: number;
  trip_count: number;
  bus_count: number;
}

interface FixedCharge {
  company_id: string;
  salaries: number;
  primes: number;
  cnps: number;
  social: number;
  insurance: number;
}

interface FinancialSummary {
  company_id: string;
  produits_financiers: number;
  charges_financieres: number;
  impots: number;
}

interface BusRow {
  bus_id: string;
  registration_number: string;
  company_name: string;
  trip_count: number;
  revenue: number;
  cc_carburant: number;
  cc_ration: number;
  cc_peage: number;
  cc_autres: number;
  fuel_enlev: number;
  expense_reparation: number;
  expense_charge_stock: number;
  expense_garage_pieces: number;
  expense_autres: number;
  vehicle_exp: number;
  fuel_carburant_comptable: number;
  variable_charges: number;
  ebe: number;
}

interface FixedBreakdown { category: string; color: string; amount: number; }
interface DaySeries { day: string; revenue: number; expenses: number; }

/** Full P&L computed per company */
interface CompanyResult {
  company_id: string;
  company_name: string;
  company_code: string;
  parent_id: string | null;
  is_group: boolean;
  recettes: number;
  variable_charges: number;
  ebe: number;
  fixed_charges: number;
  resultat_exploitation: number;
  produits_financiers: number;
  charges_financieres: number;
  resultat_courant: number;
  impots: number;
  resultat_net: number;
}

const GROUP_NAME = 'G-OUME';

export default function DAFConsolidatedReport() {
  const [periodId, setPeriodId] = useState<PeriodId>('mensuelle');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [filterCoId, setFilterCoId] = useState<string>('all');
  const [companies, setCompanies] = useState<CompanyWithHierarchy[]>([]);
  const [kpis, setKpis] = useState<CompanyKpi[]>([]);
  const [fixedCharges, setFixedCharges] = useState<FixedCharge[]>([]);
  const [finSummary, setFinSummary] = useState<FinancialSummary[]>([]);
  const [busRows, setBusRows] = useState<BusRow[]>([]);
  const [fixedBreakdown, setFixedBreakdown] = useState<FixedBreakdown[]>([]);
  const [series, setSeries] = useState<DaySeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupOpen, setGroupOpen] = useState(true);
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
        else if (companyData) companyList = companyData as CompanyWithHierarchy[];
        setCompanies(companyList);

        const ids = filterCoId === 'all'
          ? companyList.map(c => c.id)
          : resolveCompanyIds(filterCoId, companyList);

        if (ids.length === 0) {
          setKpis([]); setFixedCharges([]); setFinSummary([]); setBusRows([]); setFixedBreakdown([]); setSeries([]);
          setLoading(false);
          return;
        }

        const [kpiRes, fcRes, finRes, busRes, fbRes, serRes] = await Promise.allSettled([
          supabase.rpc('get_daf_kpis_by_company', { p_company_ids: ids, p_date_from: dateFrom, p_date_to: dateTo }),
          supabase.rpc('get_daf_fixed_charges_by_company', { p_company_ids: ids, p_date_from: dateFrom, p_date_to: dateTo }),
          supabase.rpc('get_daf_financial_summary_by_company', { p_company_ids: ids, p_date_from: dateFrom, p_date_to: dateTo }),
          supabase.rpc('get_daf_revenue_by_bus', { p_company_ids: ids, p_date_from: dateFrom, p_date_to: dateTo }),
          supabase.rpc('get_daf_fixed_expenses_breakdown', { p_date_from: dateFrom, p_date_to: dateTo }),
          supabase.rpc('get_daf_daily_series', { p_company_ids: ids, p_date_from: dateFrom, p_date_to: dateTo }),
        ]);
        if (cancelled) return;

        const rows = (r: PromiseSettledResult<{ data: unknown; error: unknown }>): Record<string, unknown>[] =>
          r.status === 'fulfilled' && !r.value.error ? (r.value.data as Record<string, unknown>[]) ?? [] : [];

        [kpiRes, fcRes, finRes, busRes, fbRes, serRes].forEach((r, i) => {
          if (r.status === 'fulfilled' && r.value.error) console.error(`RPC ${i} error:`, r.value.error);
        });

        setKpis(rows(kpiRes).map(r => {
          const cc_carburant = safe(r.cc_carburant), cc_ration = safe(r.cc_ration), cc_peage = safe(r.cc_peage);
          const cc_autres = safe(r.cc_autres);
          const fuel_enlev = safe(r.fuel_enlev), expense_reparation = safe(r.expense_reparation);
          const expense_autres = safe(r.expense_autres), vehicle_exp = safe(r.vehicle_exp);
          const fuel_carburant_comptable = safe(r.fuel_carburant_comptable);
          const variable_charges = cc_carburant + cc_ration + cc_peage + cc_autres + fuel_enlev
            + expense_reparation + expense_autres + vehicle_exp + fuel_carburant_comptable;
          return {
            company_id: String(r.company_id ?? ''),
            company_name: String(r.company_name ?? ''),
            company_code: String(r.company_code ?? ''),
            parent_id: r.parent_id as string | null,
            is_group: Boolean(r.is_group),
            revenue: safe(r.revenue),
            breakdown_received: safe(r.breakdown_received),
            cc_carburant, cc_ration, cc_peage, cc_autres, fuel_enlev,
            expense_reparation, expense_autres, vehicle_exp, fuel_carburant_comptable,
            variable_charges,
            trip_count: safe(r.trip_count),
            bus_count: safe(r.bus_count),
          } as CompanyKpi;
        }));

        setFixedCharges(rows(fcRes).map(r => ({
          company_id: String(r.company_id ?? ''),
          salaries: safe(r.salaries), primes: safe(r.primes),
          cnps: safe(r.cnps), social: safe(r.social), insurance: safe(r.insurance),
        })));

        setFinSummary(rows(finRes).map(r => ({
          company_id: String(r.company_id ?? ''),
          produits_financiers: safe(r.produits_financiers),
          charges_financieres: safe(r.charges_financieres),
          impots: safe(r.impots),
        })));

        setBusRows(rows(busRes).map(r => {
          const cc_carburant = safe(r.cc_carburant), cc_ration = safe(r.cc_ration), cc_peage = safe(r.cc_peage);
          const cc_autres = safe(r.cc_autres);
          const fuel_enlev = safe(r.fuel_enlev), expense_reparation = safe(r.expense_reparation);
          const expense_charge_stock = safe(r.expense_charge_stock), expense_garage_pieces = safe(r.expense_garage_pieces), expense_autres = safe(r.expense_autres);
          const vehicle_exp = safe(r.vehicle_exp), fuel_carburant_comptable = safe(r.fuel_carburant_comptable);
          const variable_charges = cc_carburant + cc_ration + cc_peage + cc_autres + fuel_enlev
            + expense_reparation + expense_charge_stock + expense_garage_pieces + expense_autres + vehicle_exp + fuel_carburant_comptable;
          const revenue = safe(r.revenue);
          return {
            bus_id: String(r.bus_id ?? ''),
            registration_number: String(r.registration_number ?? ''),
            company_name: String(r.company_name ?? ''),
            trip_count: safe(r.trip_count), revenue,
            cc_carburant, cc_ration, cc_peage, cc_autres, fuel_enlev,
            expense_reparation, expense_charge_stock, expense_garage_pieces, expense_autres, vehicle_exp, fuel_carburant_comptable,
            variable_charges, ebe: revenue - variable_charges,
          } as BusRow;
        }));

        setFixedBreakdown(rows(fbRes).map(r => ({
          category: String(r.category ?? ''),
          color: String(r.color ?? '#94A3B8'),
          amount: safe(r.amount),
        })));

        setSeries(rows(serRes).map(r => ({
          day: String(r.day ?? ''),
          revenue: safe(r.revenue),
          expenses: safe(r.expenses),
        })));
      } catch (err) {
        console.error('DAF ConsolidatedReport load error:', err);
        if (!cancelled) { setKpis([]); setFixedCharges([]); setFinSummary([]); setBusRows([]); setFixedBreakdown([]); setSeries([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [filterCoId, dateFrom, dateTo]);

  const { groups, standalone } = buildCompanyGroups(companies);

  const fcMap = new Map(fixedCharges.map(f => [f.company_id, f]));
  const finMap = new Map(finSummary.map(f => [f.company_id, f]));

  // Build per-company P&L (subsidiaries / standalone only — exclude group placeholder rows)
  const results: CompanyResult[] = kpis
    .filter(k => !k.is_group)
    .map(k => {
      const recettes = k.revenue;
      const ebe = recettes - k.variable_charges;
      const fc = fcMap.get(k.company_id);
      const fixed_charges = fc ? fc.salaries + fc.primes + fc.cnps + fc.social + fc.insurance : 0;
      const resultat_exploitation = ebe - fixed_charges;
      const fin = finMap.get(k.company_id);
      const produits_financiers = fin?.produits_financiers ?? 0;
      const charges_financieres = fin?.charges_financieres ?? 0;
      const resultat_courant = resultat_exploitation + produits_financiers - charges_financieres;
      const impots = fin?.impots ?? 0;
      return {
        company_id: k.company_id,
        company_name: k.company_name,
        company_code: k.company_code,
        parent_id: k.parent_id,
        is_group: k.is_group,
        recettes,
        variable_charges: k.variable_charges,
        ebe,
        fixed_charges,
        resultat_exploitation,
        produits_financiers,
        charges_financieres,
        resultat_courant,
        impots,
        resultat_net: resultat_courant - impots,
      };
    });

  const sumResults = (list: CompanyResult[]) => list.reduce((a, r) => ({
    recettes: a.recettes + r.recettes,
    variable_charges: a.variable_charges + r.variable_charges,
    ebe: a.ebe + r.ebe,
    fixed_charges: a.fixed_charges + r.fixed_charges,
    resultat_exploitation: a.resultat_exploitation + r.resultat_exploitation,
    produits_financiers: a.produits_financiers + r.produits_financiers,
    charges_financieres: a.charges_financieres + r.charges_financieres,
    resultat_courant: a.resultat_courant + r.resultat_courant,
    impots: a.impots + r.impots,
    resultat_net: a.resultat_net + r.resultat_net,
  }), {
    recettes: 0, variable_charges: 0, ebe: 0, fixed_charges: 0, resultat_exploitation: 0,
    produits_financiers: 0, charges_financieres: 0, resultat_courant: 0, impots: 0, resultat_net: 0,
  });

  const totals = sumResults(results);
  const marge = totals.recettes > 0 ? (totals.ebe / totals.recettes) * 100 : 0;

  const rankedSocieties = [...results].sort((a, b) => b.resultat_net - a.resultat_net);
  const rankedBuses = [...busRows]
    .filter(b => b.revenue > 0 || b.variable_charges > 0)
    .sort((a, b) => b.ebe - a.ebe);

  const ebeColor = (margin: number) => margin >= 25 ? '#10B981' : margin >= 10 ? '#F59E0B' : '#EF4444';

  // Variable charges breakdown (consolidated)
  const varBreakdown = [
    { name: 'Carburant', value: kpis.reduce((s, k) => s + k.cc_carburant + k.fuel_enlev + k.fuel_carburant_comptable, 0), color: '#3B82F6' },
    { name: 'Peages', value: kpis.reduce((s, k) => s + k.cc_peage, 0), color: '#14B8A6' },
    { name: 'Rations', value: kpis.reduce((s, k) => s + k.cc_ration, 0), color: '#6366F1' },
    { name: 'Maintenance', value: kpis.reduce((s, k) => s + k.expense_reparation, 0), color: '#EF4444' },
    { name: 'Autres', value: kpis.reduce((s, k) => s + k.cc_autres + k.expense_autres + k.vehicle_exp, 0), color: '#8B5CF6' },
  ].filter(d => d.value > 0);

  const fixedPie = fixedBreakdown.filter(f => f.amount > 0);

  const ebeSeries = series
    .filter((_, i, arr) => arr.length <= 90 || i % Math.ceil(arr.length / 90) === 0)
    .map(d => ({
      date: format(new Date(d.day + 'T00:00:00'), 'dd/MM', { locale: fr }),
      EBE: d.revenue - d.expenses,
    }));

  const societyBar = rankedSocieties.slice(0, 10).map(r => ({
    name: r.company_code || r.company_name.slice(0, 8),
    Resultat: r.resultat_net,
  }));

  const busBar = rankedBuses.slice(0, 12).map(b => ({
    name: b.registration_number,
    EBE: b.ebe,
  }));

  // Group consolidation (G-OUME = all subsidiaries with a parent)
  const groupSubsidiaryIds = new Set(
    groups.flatMap(g => g.subsidiaries.map(s => s.id))
  );
  const groupResults = results.filter(r => groupSubsidiaryIds.has(r.company_id));
  const groupTotals = sumResults(groupResults);

  const dashboardIndicators = [
    { label: 'Exploitation', val: totals.resultat_exploitation, hint: 'EBE - charges fixes' },
    { label: 'Gestion', val: totals.ebe, hint: 'Excedent brut' },
    { label: 'Finance', val: totals.resultat_courant, hint: 'Resultat courant' },
    { label: 'Fiscalite', val: -totals.impots, hint: 'Impots & taxes' },
    { label: 'Resultat final', val: totals.resultat_net, hint: 'Resultat net' },
  ];

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const pl = rankedSocieties.map(r => ({
      Societe: r.company_name,
      Recettes: r.recettes,
      'Charges variables': r.variable_charges,
      EBE: r.ebe,
      'Charges fixes': r.fixed_charges,
      "Resultat exploitation": r.resultat_exploitation,
      'Produits financiers': r.produits_financiers,
      'Charges financieres': r.charges_financieres,
      'Resultat courant': r.resultat_courant,
      Impots: r.impots,
      'Resultat net': r.resultat_net,
    }));
    pl.push({
      Societe: 'TOTAL CONSOLIDE',
      Recettes: totals.recettes, 'Charges variables': totals.variable_charges, EBE: totals.ebe,
      'Charges fixes': totals.fixed_charges, 'Resultat exploitation': totals.resultat_exploitation,
      'Produits financiers': totals.produits_financiers, 'Charges financieres': totals.charges_financieres,
      'Resultat courant': totals.resultat_courant, Impots: totals.impots, 'Resultat net': totals.resultat_net,
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pl), 'Resultat par societe');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      rankedBuses.map((b, i) => ({
        Rang: i + 1, Immatriculation: b.registration_number, Societe: b.company_name,
        Voyages: b.trip_count, Recettes: b.revenue, Carburant: b.cc_carburant + b.fuel_enlev + b.fuel_carburant_comptable,
        Peages: b.cc_peage, Rations: b.cc_ration, Reparations: b.expense_reparation,
        'Charge stock': b.expense_charge_stock, 'Sorties pieces garage': b.expense_garage_pieces, Autres: b.expense_autres + b.vehicle_exp,
        'Total CV': b.variable_charges, 'EBE bus': b.ebe,
        'Marge %': b.revenue > 0 ? ((b.ebe / b.revenue) * 100).toFixed(1) + '%' : '--',
      }))
    ), 'Performance bus');

    XLSX.writeFile(wb, `daf_rapport_exploitation_${dateFrom}_${dateTo}.xlsx`);
  };

  const exportPdf = async () => {
    if (!reportRef.current) return;
    const canvas = await html2canvas(reportRef.current, { scale: 1.5, useCORS: true, backgroundColor: '#ffffff' });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const w = pdf.internal.pageSize.getWidth();
    const h = (canvas.height * w) / canvas.width;
    const pageH = pdf.internal.pageSize.getHeight();
    let y = 0;
    while (y < h) {
      if (y > 0) pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, -y, w, h);
      y += pageH;
    }
    pdf.save(`daf_rapport_exploitation_${dateFrom}_${dateTo}.pdf`);
  };

  const kpiCards = [
    { label: 'EBE consolide', val: totals.ebe, color: totals.ebe >= 0 ? '#10B981' : '#EF4444', icon: TrendingUp },
    { label: "Resultat d'exploitation", val: totals.resultat_exploitation, color: totals.resultat_exploitation >= 0 ? '#10B981' : '#EF4444' },
    { label: 'Resultat courant', val: totals.resultat_courant, color: totals.resultat_courant >= 0 ? '#10B981' : '#EF4444' },
    { label: 'Resultat net', val: totals.resultat_net, color: totals.resultat_net >= 0 ? '#10B981' : '#EF4444' },
    { label: 'Marge EBE', val: marge, color: marge >= 0 ? '#10B981' : '#EF4444', isPct: true },
    { label: 'Recettes transport', val: totals.recettes, color: '#3B82F6' },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Rapport d'Exploitation Consolide</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            Comptabilite analytique — Bus / Societe / Groupe — {dateFrom} {'\u2192'} {dateTo}
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
        <div className="flex rounded-xl border overflow-hidden flex-wrap" style={{ borderColor: 'var(--border)' }}>
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
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {kpiCards.map(k => (
              <div key={k.label} className="rounded-xl border p-4" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
                <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>{k.label}</p>
                <p className="text-lg font-bold" style={{ color: k.color }}>
                  {(k as { isPct?: boolean }).isPct ? `${(k.val as number).toFixed(1)}%` : fmt(k.val)}
                </p>
              </div>
            ))}
          </div>

          {/* DAF dashboard indicators (cascade) */}
          <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
            <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Indicateurs DAF — chaine de resultat</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {dashboardIndicators.map(d => (
                <div key={d.label} className="rounded-xl p-3 border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)' }}>
                  <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>{d.label}</p>
                  <p className="text-base font-bold" style={{ color: d.val >= 0 ? '#10B981' : '#EF4444' }}>{fmtM(d.val)}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{d.hint}</p>
                </div>
              ))}
            </div>
          </div>

          {/* EBE evolution + variable charges */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Evolution de l'EBE</h3>
              {ebeSeries.length === 0 ? (
                <div className="flex items-center justify-center h-52 text-sm" style={{ color: 'var(--text-muted)' }}>Aucune donnee sur cette periode</div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={ebeSeries} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="ebeGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0B7439" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#0B7439" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} />
                    <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} tickFormatter={v => fmtM(v as number)} width={48} />
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Area type="monotone" dataKey="EBE" stroke="#0B7439" strokeWidth={2} fill="url(#ebeGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Repartition des charges variables</h3>
              {varBreakdown.length === 0 ? (
                <div className="flex items-center justify-center h-52 text-sm" style={{ color: 'var(--text-muted)' }}>Aucune donnee</div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={varBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={(e: { name: string }) => e.name}>
                      {varBreakdown.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => fmt(v)} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Performance Bus table */}
          <div className="rounded-2xl border overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Performance Bus (niveau vehicule)</h3>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{rankedBuses.length} bus {'\u00B7'} classe par EBE</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                  {['Immat', 'Societe', 'Voyages', 'Recettes', 'Carburant', 'Peages', 'Rations', 'Reparations', 'Ch. stock', 'SP garage', 'Autres CV', 'Total CV', 'EBE Bus', 'Marge %'].map(h => (
                    <th key={h} className="text-left px-3 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rankedBuses.map(b => {
                  const mp = b.revenue > 0 ? (b.ebe / b.revenue) * 100 : 0;
                  const col = ebeColor(mp);
                  return (
                    <tr key={b.bus_id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                      <td className="px-3 py-2.5 text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{b.registration_number}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{b.company_name}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{b.trip_count}</td>
                      <td className="px-3 py-2.5 text-xs font-semibold" style={{ color: '#10B981' }}>{fmtN(b.revenue)}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#3B82F6' }}>{fmtN(b.cc_carburant + b.fuel_enlev + b.fuel_carburant_comptable)}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#14B8A6' }}>{fmtN(b.cc_peage)}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#6366F1' }}>{fmtN(b.cc_ration)}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#EF4444' }}>{fmtN(b.expense_reparation)}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#7C3AED' }}>{fmtN(b.expense_charge_stock)}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#B45309' }}>{fmtN(b.expense_garage_pieces)}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#8B5CF6' }}>{fmtN(b.expense_autres + b.vehicle_exp)}</td>
                      <td className="px-3 py-2.5 text-xs font-semibold" style={{ color: '#EF4444' }}>{fmtN(b.variable_charges)}</td>
                      <td className="px-3 py-2.5 text-xs font-bold" style={{ color: col }}>{fmtN(b.ebe)}</td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: col + '22', color: col }}>{mp.toFixed(1)}%</span>
                      </td>
                    </tr>
                  );
                })}
                {rankedBuses.length === 0 && (
                  <tr><td colSpan={14} className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>Aucune donnee sur cette periode</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Résultat par Société table */}
          <div className="rounded-2xl border overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Resultat par Societe (compte de resultat)</h3>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{rankedSocieties.length} societe(s)</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                  {['Societe', 'Recettes', 'Ch. variables', 'EBE', 'Ch. fixes', 'Res. exploit.', 'Prod. fin.', 'Ch. fin.', 'Res. courant', 'Impots', 'Res. net'].map(h => (
                    <th key={h} className="text-left px-3 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rankedSocieties.map(r => (
                  <tr key={r.company_id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-3 py-2.5 text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{r.company_name}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: '#10B981' }}>{fmtN(r.recettes)}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: '#EF4444' }}>{fmtN(r.variable_charges)}</td>
                    <td className="px-3 py-2.5 text-xs font-semibold" style={{ color: r.ebe >= 0 ? '#10B981' : '#EF4444' }}>{fmtN(r.ebe)}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: '#F97316' }}>{fmtN(r.fixed_charges)}</td>
                    <td className="px-3 py-2.5 text-xs font-semibold" style={{ color: r.resultat_exploitation >= 0 ? '#10B981' : '#EF4444' }}>{fmtN(r.resultat_exploitation)}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: '#3B82F6' }}>{fmtN(r.produits_financiers)}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: '#EF4444' }}>{fmtN(r.charges_financieres)}</td>
                    <td className="px-3 py-2.5 text-xs font-semibold" style={{ color: r.resultat_courant >= 0 ? '#10B981' : '#EF4444' }}>{fmtN(r.resultat_courant)}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: '#CA8A04' }}>{fmtN(r.impots)}</td>
                    <td className="px-3 py-2.5 text-xs font-bold" style={{ color: r.resultat_net >= 0 ? '#10B981' : '#EF4444' }}>{fmtN(r.resultat_net)}</td>
                  </tr>
                ))}
                {rankedSocieties.length > 0 && (
                  <tr className="border-t-2" style={{ borderColor: 'var(--border)', fontWeight: 700, backgroundColor: 'var(--bg-subtle)' }}>
                    <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-primary)' }}>TOTAL CONSOLIDE</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: '#10B981' }}>{fmtN(totals.recettes)}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: '#EF4444' }}>{fmtN(totals.variable_charges)}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: totals.ebe >= 0 ? '#10B981' : '#EF4444' }}>{fmtN(totals.ebe)}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: '#F97316' }}>{fmtN(totals.fixed_charges)}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: totals.resultat_exploitation >= 0 ? '#10B981' : '#EF4444' }}>{fmtN(totals.resultat_exploitation)}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: '#3B82F6' }}>{fmtN(totals.produits_financiers)}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: '#EF4444' }}>{fmtN(totals.charges_financieres)}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: totals.resultat_courant >= 0 ? '#10B981' : '#EF4444' }}>{fmtN(totals.resultat_courant)}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: '#CA8A04' }}>{fmtN(totals.impots)}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: totals.resultat_net >= 0 ? '#10B981' : '#EF4444' }}>{fmtN(totals.resultat_net)}</td>
                  </tr>
                )}
                {rankedSocieties.length === 0 && (
                  <tr><td colSpan={11} className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>Aucune donnee sur cette periode</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Groupe G-OUME consolidation */}
          {groupResults.length > 0 && (
            <div className="rounded-2xl border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
              <button onClick={() => setGroupOpen(o => !o)}
                className="w-full px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {groupOpen ? <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} /> : <ChevronRight className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />}
                  <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Groupe {GROUP_NAME} — consolidation ({groupResults.length} societes)</h3>
                </div>
                <span className="text-sm font-bold" style={{ color: groupTotals.resultat_net >= 0 ? '#10B981' : '#EF4444' }}>
                  Resultat net: {fmt(groupTotals.resultat_net)}
                </span>
              </button>
              {groupOpen && (
                <div className="px-5 pb-5">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    {[
                      { label: 'Recettes', val: groupTotals.recettes, color: '#3B82F6' },
                      { label: 'EBE', val: groupTotals.ebe, color: groupTotals.ebe >= 0 ? '#10B981' : '#EF4444' },
                      { label: 'Res. exploitation', val: groupTotals.resultat_exploitation, color: groupTotals.resultat_exploitation >= 0 ? '#10B981' : '#EF4444' },
                      { label: 'Res. courant', val: groupTotals.resultat_courant, color: groupTotals.resultat_courant >= 0 ? '#10B981' : '#EF4444' },
                      { label: 'Res. net', val: groupTotals.resultat_net, color: groupTotals.resultat_net >= 0 ? '#10B981' : '#EF4444' },
                    ].map(c => (
                      <div key={c.label} className="rounded-xl p-3 border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)' }}>
                        <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>{c.label}</p>
                        <p className="text-sm font-bold" style={{ color: c.color }}>{fmt(c.val)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Charges fixes + classements */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Repartition des charges fixes</h3>
              {fixedPie.length === 0 ? (
                <div className="flex items-center justify-center h-52 text-sm" style={{ color: 'var(--text-muted)' }}>Aucune charge fixe enregistree</div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={fixedPie} dataKey="amount" nameKey="category" cx="50%" cy="50%" outerRadius={90} label={(e: { category: string }) => e.category}>
                      {fixedPie.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => fmt(v)} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Classement societes par resultat net</h3>
              {societyBar.length === 0 ? (
                <div className="flex items-center justify-center h-52 text-sm" style={{ color: 'var(--text-muted)' }}>Aucune donnee</div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={societyBar} margin={{ top: 0, right: 10, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                    <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} tickFormatter={v => fmtM(v as number)} width={48} />
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Bar dataKey="Resultat" radius={[3, 3, 0, 0]}>
                      {societyBar.map((d, i) => <Cell key={i} fill={d.Resultat >= 0 ? '#0B7439' : '#EF4444'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Bus ranking chart */}
          {busBar.length > 1 && (
            <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Classement bus par EBE</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={busBar} margin={{ top: 0, right: 10, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} tickFormatter={v => fmtM(v as number)} width={48} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Bar dataKey="EBE" radius={[3, 3, 0, 0]}>
                    {busBar.map((d, i) => <Cell key={i} fill={d.EBE >= 0 ? '#3B82F6' : '#EF4444'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
