import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp, TrendingDown, DollarSign, Bus, Calendar, Fuel,
  Activity, Route as RouteIcon, Receipt, ShoppingCart, Package,
  Wrench, Layers, Award, FileText, BarChart3, PieChart as PieIcon,
  Download, Loader2, ArrowUp, ArrowDown,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import { format, startOfWeek, startOfMonth, startOfQuarter, startOfYear, subMonths, endOfWeek, endOfMonth, endOfQuarter, endOfYear } from 'date-fns';
import { fr } from 'date-fns/locale';
import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

import {
  fetchBordereaux, fetchDepenses, fetchSocietes, fetchSegments,
  type Bordereau, type AbgDepense, type AbgSociete, type AbgSegment,
} from '@/services/abg.service';
import { formatCFA } from '@/utils/formatCurrency';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type PeriodId = 'jour' | 'hebdo' | 'mensuel' | 'trimestriel' | 'annuel' | 'custom';
type TabId = 'synthese' | 'societes' | 'segments' | 'charges';

interface SocRow {
  code: string;
  name: string;
  recettes: number;
  gasoil: number;
  rations: number;
  peages: number;
  autres_pr: number;
  depense_pr: number;
  resultat_guichet: number;
  carburant_cuve: number;
  reparations: number;
  articles_stock: number;
  charge_stock: number;
  charge_achat: number;
  charge_carburant_agent: number;
  resultat_brut: number;
  depenses_ao: number;
  depenses_hao: number;
  resultat_net: number;
  voyages: number;
  bus_actifs: number;
}

interface SegRow extends SocRow {
  segment_code: string;
  segment_label: string;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

const fmtN = (n: number) => new Intl.NumberFormat('fr-CI', { maximumFractionDigits: 0 }).format(n);
const fmt = (n: number) => fmtN(n) + ' F';
const fmtM = (n: number) =>
  Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(0) + 'k' : String(Math.round(n));

const safe = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

function getDateRange(id: PeriodId, customFrom?: string, customTo?: string): { from: string; to: string } {
  const now = new Date();
  switch (id) {
    case 'jour':
      return { from: format(now, 'yyyy-MM-dd'), to: format(now, 'yyyy-MM-dd') };
    case 'hebdo':
      return { from: format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'), to: format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd') };
    case 'mensuel':
      return { from: format(startOfMonth(now), 'yyyy-MM-dd'), to: format(endOfMonth(now), 'yyyy-MM-dd') };
    case 'trimestriel':
      return { from: format(startOfQuarter(now), 'yyyy-MM-dd'), to: format(endOfQuarter(now), 'yyyy-MM-dd') };
    case 'annuel':
      return { from: format(startOfYear(now), 'yyyy-MM-dd'), to: format(endOfYear(now), 'yyyy-MM-dd') };
    case 'custom':
      return { from: customFrom ?? format(now, 'yyyy-MM-dd'), to: customTo ?? format(now, 'yyyy-MM-dd') };
  }
}

const PERIOD_LABELS: Record<PeriodId, string> = {
  jour: 'Journalier', hebdo: 'Hebdomadaire', mensuel: 'Mensuel',
  trimestriel: 'Trimestriel', annuel: 'Annuel', custom: 'Personnalisé',
};

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

export default function GestionAgbovilleDashboard() {
  const navigate = useNavigate();
  const reportRef = useRef<HTMLDivElement>(null);

  const [periodId, setPeriodId] = useState<PeriodId>('mensuel');
  const [customFrom, setCustomFrom] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [customTo, setCustomTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [filterSoc, setFilterSoc] = useState('all');
  const [filterSeg, setFilterSeg] = useState('all');
  const [activeTab, setActiveTab] = useState<TabId>('synthese');
  const [allocMode, setAllocMode] = useState<'direct' | 'prorata'>('prorata');

  const [bordereaux, setBordereaux] = useState<Bordereau[]>([]);
  const [depenses, setDepenses] = useState<AbgDepense[]>([]);
  const [societes, setSocietes] = useState<AbgSociete[]>([]);
  const [segments, setSegments] = useState<AbgSegment[]>([]);
  const [loading, setLoading] = useState(true);

  const { from, to } = useMemo(() => getDateRange(periodId, customFrom, customTo), [periodId, customFrom, customTo]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [b, d, s, seg] = await Promise.all([
        fetchBordereaux({ dateFrom: from, dateTo: to }),
        fetchDepenses({ dateFrom: from, dateTo: to }),
        fetchSocietes(),
        fetchSegments(),
      ]);
      setBordereaux(b);
      setDepenses(d);
      setSocietes(s);
      setSegments(seg);
    } catch { /* non-critical */ } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { loadData(); }, [loadData]);

  // Filter bordereaux by segment
  const filteredBord = useMemo(() => {
    return bordereaux.filter(b => {
      if (filterSoc !== 'all' && b.societe_code !== filterSoc) return false;
      if (filterSeg !== 'all' && b.segment_code !== filterSeg) return false;
      return true;
    });
  }, [bordereaux, filterSoc, filterSeg]);

  const filteredDep = useMemo(() => {
    return depenses.filter(d => {
      if (filterSoc !== 'all' && d.societe_code && d.societe_code !== filterSoc) return false;
      return true;
    });
  }, [depenses, filterSoc]);

  // ── Compute per-société rows ──
  const socRows = useMemo<SocRow[]>(() => {
    const socMap = new Map<string, SocRow>();
    const socCodes = new Set<string>();

    // Init from bordereaux
    for (const b of filteredBord) {
      const code = b.societe_code || 'AUTRES';
      socCodes.add(code);
      if (!socMap.has(code)) {
        const soc = societes.find(s => s.code === code);
        socMap.set(code, {
          code, name: soc?.name ?? code,
          recettes: 0, gasoil: 0, rations: 0, peages: 0, autres_pr: 0,
          depense_pr: 0, resultat_guichet: 0,
          carburant_cuve: 0, reparations: 0, articles_stock: 0,
          charge_stock: 0, charge_achat: 0, charge_carburant_agent: 0,
          resultat_brut: 0, depenses_ao: 0, depenses_hao: 0,
          resultat_net: 0, voyages: 0, bus_actifs: 0,
        });
      }
      const row = socMap.get(code)!;
      row.recettes += safe(b.total_mt_ticket);
      row.depense_pr += safe(b.total_depense_pr);
      row.voyages += 1;
    }

    // AO/HAO allocation
    const totalRecettes = Array.from(socMap.values()).reduce((s, r) => s + r.recettes, 0) || 1;
    for (const dep of filteredDep) {
      const code = dep.societe_code || null;
      const amount = safe(dep.montant);
      if (allocMode === 'direct' && code && socMap.has(code)) {
        const row = socMap.get(code)!;
        if (dep.type_depense === 'AO') row.depenses_ao += amount;
        else row.depenses_hao += amount;
      } else {
        // prorata: distribute across all societes by revenue share
        for (const row of socMap.values()) {
          const share = row.recettes / totalRecettes;
          if (dep.type_depense === 'AO') row.depenses_ao += amount * share;
          else row.depenses_hao += amount * share;
        }
      }
    }

    // Compute derived fields
    for (const row of socMap.values()) {
      // P/R split: bordereaux only have total_depense_pr, no per-category breakdown
      // We treat all depense_pr as "autres_pr" for display since bordereaux don't split
      row.autres_pr = 0;
      row.gasoil = 0;
      row.rations = 0;
      row.peages = 0;
      row.autres_pr = row.depense_pr;
      row.resultat_guichet = row.recettes - row.depense_pr;
      row.resultat_brut = row.resultat_guichet; // no intermediate charges from bordereaux
      row.resultat_net = row.resultat_brut - row.depenses_ao - row.depenses_hao;
    }

    return Array.from(socMap.values()).sort((a, b) => b.recettes - a.recettes);
  }, [filteredBord, filteredDep, societes, allocMode]);

  // ── Compute per-segment rows ──
  const segRows = useMemo<SegRow[]>(() => {
    const segMap = new Map<string, SegRow>();
    for (const b of filteredBord) {
      const segCode = b.segment_code || 'AUTRES';
      if (filterSeg !== 'all' && segCode !== filterSeg) continue;
      if (!segMap.has(segCode)) {
        const seg = segments.find(s => s.code === segCode);
        const base: SocRow = {
          code: 'ALL', name: 'Toutes',
          recettes: 0, gasoil: 0, rations: 0, peages: 0, autres_pr: 0,
          depense_pr: 0, resultat_guichet: 0,
          carburant_cuve: 0, reparations: 0, articles_stock: 0,
          charge_stock: 0, charge_achat: 0, charge_carburant_agent: 0,
          resultat_brut: 0, depenses_ao: 0, depenses_hao: 0,
          resultat_net: 0, voyages: 0, bus_actifs: 0,
        };
        segMap.set(segCode, { ...base, segment_code: segCode, segment_label: seg?.label ?? segCode });
      }
      const row = segMap.get(segCode)!;
      row.recettes += safe(b.total_mt_ticket);
      row.depense_pr += safe(b.total_depense_pr);
      row.voyages += 1;
    }

    // Allocate AO/HAO to segments by prorata recettes
    const totalRec = Array.from(segMap.values()).reduce((s, r) => s + r.recettes, 0) || 1;
    for (const dep of filteredDep) {
      const amount = safe(dep.montant);
      for (const row of segMap.values()) {
        const share = row.recettes / totalRec;
        if (dep.type_depense === 'AO') row.depenses_ao += amount * share;
        else row.depenses_hao += amount * share;
      }
    }

    for (const row of segMap.values()) {
      row.autres_pr = row.depense_pr;
      row.resultat_guichet = row.recettes - row.depense_pr;
      row.resultat_brut = row.resultat_guichet;
      row.resultat_net = row.resultat_brut - row.depenses_ao - row.depenses_hao;
    }

    return Array.from(segMap.values()).sort((a, b) => b.recettes - a.recettes);
  }, [filteredBord, filteredDep, segments, filterSeg]);

  // ── Consolidated totals ──
  const totals = useMemo(() => {
    return socRows.reduce((acc, r) => ({
      recettes: acc.recettes + r.recettes,
      depense_pr: acc.depense_pr + r.depense_pr,
      depenses_ao: acc.depenses_ao + r.depenses_ao,
      depenses_hao: acc.depenses_hao + r.depenses_hao,
      resultat_guichet: acc.resultat_guichet + r.resultat_guichet,
      resultat_brut: acc.resultat_brut + r.resultat_brut,
      resultat_net: acc.resultat_net + r.resultat_net,
      voyages: acc.voyages + r.voyages,
      bus_actifs: acc.bus_actifs + r.bus_actifs,
    }), {
      recettes: 0, depense_pr: 0, depenses_ao: 0, depenses_hao: 0,
      resultat_guichet: 0, resultat_brut: 0, resultat_net: 0,
      voyages: 0, bus_actifs: 0,
    });
  }, [socRows]);

  const totalCharges = totals.depense_pr + totals.depenses_ao + totals.depenses_hao;
  const margeNette = totals.recettes > 0 ? (totals.resultat_net / totals.recettes) * 100 : 0;

  // ── Time series ──
  const series = useMemo(() => {
    const dayMap = new Map<string, { revenue: number; charges: number }>();
    for (const b of filteredBord) {
      const day = b.bordereau_date;
      if (!dayMap.has(day)) dayMap.set(day, { revenue: 0, charges: 0 });
      const d = dayMap.get(day)!;
      d.revenue += safe(b.total_mt_ticket);
      d.charges += safe(b.total_depense_pr);
    }
    for (const dep of filteredDep) {
      const day = dep.date_depense;
      if (!dayMap.has(day)) dayMap.set(day, { revenue: 0, charges: 0 });
      dayMap.get(day)!.charges += safe(dep.montant);
    }
    return Array.from(dayMap.entries())
      .map(([day, v]) => ({ day, revenue: v.revenue, charges: v.charges }))
      .sort((a, b) => a.day.localeCompare(b.day));
  }, [filteredBord, filteredDep]);

  // ── Top 3 ──
  const top3 = useMemo(() => {
    return [...socRows].sort((a, b) => b.resultat_net - a.resultat_net).slice(0, 3);
  }, [socRows]);

  // ── P&L cascade rows ──
  const cascadeRows = useMemo(() => {
    const tc = totalCharges || 1;
    const tr = totals.recettes || 1;
    return [
      { label: 'Recettes totales', val: totals.recettes, type: 'header' as const, pctC: '', pctR: '' },
      { label: '  Carburant / Gasoil (guichet — P/R)', val: 0, type: 'neg' as const, pctC: `${(0 / tc * 100).toFixed(1)}%`, pctR: `${(0 / tr * 100).toFixed(1)}%` },
      { label: '  Rations (guichet — P/R)', val: 0, type: 'neg' as const, pctC: `${(0 / tc * 100).toFixed(1)}%`, pctR: `${(0 / tr * 100).toFixed(1)}%` },
      { label: '  Péages (guichet — P/R)', val: 0, type: 'neg' as const, pctC: `${(0 / tc * 100).toFixed(1)}%`, pctR: `${(0 / tr * 100).toFixed(1)}%` },
      { label: '  Autres dépenses (guichet — P/R)', val: totals.depense_pr, type: 'neg' as const, pctC: `${(totals.depense_pr / tc * 100).toFixed(1)}%`, pctR: `${(totals.depense_pr / tr * 100).toFixed(1)}%` },
      { label: '= Résultat guichetier', val: totals.resultat_guichet, type: 'subtotal' as const, pctC: '', pctR: '' },
      { label: '  Carburant cuve', val: 0, type: 'neg' as const, pctC: `${(0 / tc * 100).toFixed(1)}%`, pctR: `${(0 / tr * 100).toFixed(1)}%` },
      { label: '  Autres dép. (comptable)', val: 0, type: 'neg' as const, pctC: `${(0 / tc * 100).toFixed(1)}%`, pctR: `${(0 / tr * 100).toFixed(1)}%` },
      { label: '  Articles stock (comptable)', val: 0, type: 'neg' as const, pctC: `${(0 / tc * 100).toFixed(1)}%`, pctR: `${(0 / tr * 100).toFixed(1)}%` },
      { label: '  Charge stock (GP)', val: 0, type: 'neg' as const, pctC: `${(0 / tc * 100).toFixed(1)}%`, pctR: `${(0 / tr * 100).toFixed(1)}%` },
      { label: '  Charge achat', val: 0, type: 'neg' as const, pctC: `${(0 / tc * 100).toFixed(1)}%`, pctR: `${(0 / tr * 100).toFixed(1)}%` },
      { label: '  Charge carburant (agent)', val: 0, type: 'neg' as const, pctC: `${(0 / tc * 100).toFixed(1)}%`, pctR: `${(0 / tr * 100).toFixed(1)}%` },
      { label: '= Résultat brut', val: totals.resultat_brut, type: 'subtotal' as const, pctC: '', pctR: '' },
      { label: '  Dépenses AO (Agboville ville)', val: totals.depenses_ao, type: 'neg' as const, pctC: `${(totals.depenses_ao / tc * 100).toFixed(1)}%`, pctR: `${(totals.depenses_ao / tr * 100).toFixed(1)}%` },
      { label: '  Dépenses HAO (Agboville ville)', val: totals.depenses_hao, type: 'neg' as const, pctC: `${(totals.depenses_hao / tc * 100).toFixed(1)}%`, pctR: `${(totals.depenses_hao / tr * 100).toFixed(1)}%` },
      { label: '= RÉSULTAT NET', val: totals.resultat_net, type: 'total' as const, pctC: '', pctR: '' },
      { label: 'Total charges (P/R + intermédiaires + AO + HAO)', val: totalCharges, type: 'sum' as const, pctC: '100%', pctR: `${(totalCharges / tr * 100).toFixed(1)}%` },
    ];
  }, [totals, totalCharges]);

  // ── Charge breakdown for charts ──
  const chargeBreakdown = useMemo(() => [
    { name: 'Carburant/Gasoil (P/R)', val: 0, color: '#3B82F6' },
    { name: 'Rations (P/R)', val: 0, color: '#F59E0B' },
    { name: 'Péages (P/R)', val: 0, color: '#10B981' },
    { name: 'Autres dép. (P/R)', val: totals.depense_pr, color: '#6B7280' },
    { name: 'Dépenses AO', val: totals.depenses_ao, color: '#8B5CF6' },
    { name: 'Dépenses HAO', val: totals.depenses_hao, color: '#A855F7' },
  ].filter(e => e.val > 0), [totals]);

  const compBarData = useMemo(() => {
    return socRows.slice(0, 10).map(r => ({
      name: r.code,
      Recettes: r.recettes,
      Charges: r.depense_pr + r.depenses_ao + r.depenses_hao,
      Résultat: r.resultat_net,
    }));
  }, [socRows]);

  // ── Exports ──
  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    // Sheet 1: P&L cascade
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      cascadeRows.map(r => ({ Poste: r.label, Montant: r.val, '% charges': r.pctC, '% recettes': r.pctR })),
    ), 'Synthèse P&L');
    // Sheet 2: Par société
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      socRows.map(r => ({
        Société: r.name, Recettes: r.recettes, 'Charges P/R': r.depense_pr,
        AO: r.depenses_ao, HAO: r.depenses_hao, 'Charges totales': r.depense_pr + r.depenses_ao + r.depenses_hao,
        'Résultat net': r.resultat_net, 'Marge %': r.recettes > 0 ? (r.resultat_net / r.recettes * 100).toFixed(1) : '0',
        Voyages: r.voyages,
      })),
    ), 'Par société');
    // Sheet 3: Par segment
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      segRows.map(r => ({
        Segment: r.segment_label, Recettes: r.recettes, 'Charges P/R': r.depense_pr,
        AO: r.depenses_ao, HAO: r.depenses_hao, 'Résultat net': r.resultat_net,
        Voyages: r.voyages,
      })),
    ), 'Par segment');
    XLSX.writeFile(wb, `agboville_dashboard_${from}_${to}.xlsx`);
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
    pdf.save(`agboville_dashboard_${from}_${to}.pdf`);
  };

  // ── Render helpers ──
  const kpiCard = (label: string, val: number, icon: React.ReactNode, positive?: boolean) => (
    <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{label}</span>
        <span style={{ color: positive === undefined ? 'var(--text-muted)' : positive ? '#10B981' : '#EF4444' }}>{icon}</span>
      </div>
      <p className="text-lg font-bold" style={{ color: positive === undefined ? 'var(--text-primary)' : positive ? '#10B981' : '#EF4444' }}>
        {fmt(val)}
      </p>
    </div>
  );

  const chargeCard = (label: string, val: number, icon: React.ReactNode, color: string) => {
    const pct = totalCharges > 0 ? (val / totalCharges * 100).toFixed(1) : '0';
    return (
      <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2 mb-2">
          <span style={{ color }}>{icon}</span>
          <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{label}</span>
        </div>
        <p className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>{fmt(val)}</p>
        <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
        </div>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{pct}% des charges</p>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: '#0B7439' }} />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Tableau de bord — Ligne Agboville</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {PERIOD_LABELS[periodId]} · du {format(new Date(from), 'dd/MM/yyyy', { locale: fr })} au {format(new Date(to), 'dd/MM/yyyy', { locale: fr })}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportExcel} className="px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            <Download className="w-3.5 h-3.5" /> Excel
          </button>
          <button onClick={exportPdf} className="px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            <Download className="w-3.5 h-3.5" /> PDF
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {(Object.keys(PERIOD_LABELS) as PeriodId[]).map(p => (
          <button key={p} onClick={() => setPeriodId(p)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${periodId === p ? 'text-white' : ''}`}
            style={periodId === p ? { background: '#0B7439' } : { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            {PERIOD_LABELS[p]}
          </button>
        ))}
        {periodId === 'custom' && (
          <>
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              className="px-2 py-1.5 rounded-lg text-xs" style={{ border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>au</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              className="px-2 py-1.5 rounded-lg text-xs" style={{ border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
          </>
        )}
        <select value={filterSoc} onChange={e => setFilterSoc(e.target.value)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)' }}>
          <option value="all">Toutes les sociétés</option>
          {societes.map(s => <option key={s.code} value={s.code}>{s.code} — {s.name}</option>)}
        </select>
        <select value={filterSeg} onChange={e => setFilterSeg(e.target.value)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)' }}>
          <option value="all">Tous les segments</option>
          {segments.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
        </select>
        <select value={allocMode} onChange={e => setAllocMode(e.target.value as 'direct' | 'prorata')}
          className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)' }}
          title="Mode de répartition des dépenses AO/HAO">
          <option value="prorata">AO/HAO: Prorata recettes</option>
          <option value="direct">AO/HAO: Directe</option>
        </select>
      </div>

      <div ref={reportRef}>
        {/* KPI Band */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
          {kpiCard('Total recettes', totals.recettes, <DollarSign className="w-4 h-4" />, true)}
          {kpiCard('Total charges', totalCharges, <Receipt className="w-4 h-4" />, false)}
          {kpiCard('Résultat net', totals.resultat_net, totals.resultat_net >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />, totals.resultat_net >= 0)}
          {kpiCard('Marge nette (%)', margeNette, <Activity className="w-4 h-4" />, margeNette >= 0)}
          {kpiCard('Total voyages', totals.voyages, <Calendar className="w-4 h-4" />)}
          {kpiCard('Bus actif', totals.bus_actifs, <Bus className="w-4 h-4" />)}
          {kpiCard('Rep. passe reçue', 0, <RouteIcon className="w-4 h-4" />)}
        </div>

        {/* Charge detail cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
          {chargeCard('Carburant/Gasoil (P/R)', 0, <Fuel className="w-4 h-4" />, '#3B82F6')}
          {chargeCard('Rations (P/R)', 0, <Activity className="w-4 h-4" />, '#F59E0B')}
          {chargeCard('Péages (P/R)', 0, <RouteIcon className="w-4 h-4" />, '#10B981')}
          {chargeCard('Autres dép. (P/R)', totals.depense_pr, <Receipt className="w-4 h-4" />, '#6B7280')}
          {chargeCard('Dépenses AO', totals.depenses_ao, <ShoppingCart className="w-4 h-4" />, '#8B5CF6')}
          {chargeCard('Dépenses HAO', totals.depenses_hao, <Package className="w-4 h-4" />, '#A855F7')}
        </div>

        {/* Charts row 1 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          {/* Recettes vs Charges evolution */}
          <div className="lg:col-span-2 rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>Évolution Recettes vs Charges</h3>
            {series.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={series}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="chgGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#EF4444" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="day" tickFormatter={d => format(new Date(d), 'dd/MM', { locale: fr })} tick={{ fontSize: 10 }} stroke="var(--text-muted)" />
                  <YAxis tickFormatter={fmtM} tick={{ fontSize: 10 }} stroke="var(--text-muted)" />
                  <Tooltip formatter={(v: number) => fmt(v)} labelFormatter={l => format(new Date(l), 'dd/MM/yyyy', { locale: fr })} />
                  <Area type="monotone" dataKey="revenue" name="Recettes" stroke="#10B981" fill="url(#revGrad)" strokeWidth={2} />
                  <Area type="monotone" dataKey="charges" name="Charges" stroke="#EF4444" fill="url(#chgGrad)" strokeWidth={2} strokeDasharray="5 5" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[240px] flex items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>Aucune donnée sur la période</div>
            )}
          </div>

          {/* Charge breakdown horizontal bars */}
          <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>Répartition des charges</h3>
            <div className="space-y-3">
              {chargeBreakdown.length > 0 ? chargeBreakdown.map(e => {
                const pct = totalCharges > 0 ? (e.val / totalCharges * 100) : 0;
                return (
                  <div key={e.name}>
                    <div className="flex justify-between text-xs mb-1">
                      <span style={{ color: 'var(--text-secondary)' }}>{e.name}</span>
                      <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{fmtM(e.val)}</span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: e.color }} />
                    </div>
                  </div>
                );
              }) : (
                <p className="text-xs text-center py-8" style={{ color: 'var(--text-muted)' }}>Aucune charge</p>
              )}
            </div>
          </div>
        </div>

        {/* Charts row 2 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          {/* Society ranking */}
          <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>Classement des sociétés par rentabilité</h3>
            <div className="space-y-2">
              {socRows.map((r, i) => {
                const margePct = r.recettes > 0 ? (r.resultat_net / r.recettes * 100) : 0;
                return (
                  <div key={r.code} className="flex items-center gap-3">
                    <span className="text-xs font-bold w-5 text-center" style={{ color: 'var(--text-muted)' }}>{i + 1}</span>
                    <span className="text-xs font-medium flex-1" style={{ color: 'var(--text-primary)' }}>{r.code}</span>
                    <span className="text-xs font-bold w-20 text-right" style={{ color: margePct >= 0 ? '#10B981' : '#EF4444' }}>{margePct.toFixed(1)}%</span>
                    <div className="w-24 h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.min(Math.abs(margePct), 100)}%`, background: margePct >= 0 ? '#10B981' : '#EF4444' }} />
                    </div>
                    <span className="text-xs w-24 text-right" style={{ color: 'var(--text-secondary)' }}>{fmtM(r.resultat_net)} F</span>
                  </div>
                );
              })}
              {socRows.length === 0 && <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>Aucune donnée</p>}
            </div>
          </div>

          {/* Comparison bar chart */}
          <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>Comparaison par société</h3>
            {compBarData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={compBarData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="var(--text-muted)" />
                  <YAxis tickFormatter={fmtM} tick={{ fontSize: 10 }} stroke="var(--text-muted)" />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Bar dataKey="Recettes" fill="#10B981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Charges" fill="#EF4444" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Résultat" radius={[4, 4, 0, 0]}>
                    {compBarData.map((d, i) => <Cell key={i} fill={d.Résultat >= 0 ? '#3B82F6' : '#EF4444'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[240px] flex items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>Aucune donnée</div>
            )}
          </div>
        </div>

        {/* Top 3 podium */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          {top3.map((r, i) => (
            <div key={r.code} className="rounded-xl p-4 flex items-center gap-3" style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderColor: i === 0 ? '#F59E0B' : i === 1 ? '#9CA3AF' : i === 2 ? '#D97706' : 'var(--border)',
            }}>
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm" style={{
                background: i === 0 ? '#F59E0B' : i === 1 ? '#9CA3AF' : '#D97706',
              }}>
                {i + 1}
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{r.code} — {r.name}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.voyages} voyages</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold" style={{ color: r.resultat_net >= 0 ? '#10B981' : '#EF4444' }}>{fmt(r.resultat_net)}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {r.recettes > 0 ? (r.resultat_net / r.recettes * 100).toFixed(1) : '0'}% marge
                </p>
              </div>
            </div>
          ))}
          {top3.length === 0 && (
            <div className="md:col-span-3 text-center py-6 text-sm" style={{ color: 'var(--text-muted)' }}>Aucune société sur la période</div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-3 border-b" style={{ borderColor: 'var(--border)' }}>
          {([
            { id: 'synthese' as const, label: 'Synthèse P&L' },
            { id: 'societes' as const, label: 'Par société' },
            { id: 'segments' as const, label: 'Par segment' },
            { id: 'charges' as const, label: 'Analyse charges' },
          ]).map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 text-xs font-bold border-b-2 transition-colors ${activeTab === t.id ? '' : ''}`}
              style={activeTab === t.id
                ? { color: '#0B7439', borderColor: '#0B7439' }
                : { color: 'var(--text-muted)', borderColor: 'transparent' }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'synthese' && (
          <div className="rounded-xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <table className="w-full" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-subtle)' }}>
                  <th className="px-4 py-2.5 text-left text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Poste</th>
                  <th className="px-4 py-2.5 text-right text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Montant</th>
                  <th className="px-4 py-2.5 text-right text-xs font-bold" style={{ color: 'var(--text-muted)' }}>% charges</th>
                  <th className="px-4 py-2.5 text-right text-xs font-bold" style={{ color: 'var(--text-muted)' }}>% recettes</th>
                </tr>
              </thead>
              <tbody>
                {cascadeRows.map((r, i) => {
                  const isBold = r.type === 'header' || r.type === 'subtotal' || r.type === 'total' || r.type === 'sum';
                  const color = r.type === 'header' ? '#10B981'
                    : r.type === 'subtotal' ? (r.val >= 0 ? '#3B82F6' : '#EF4444')
                    : r.type === 'total' ? (r.val >= 0 ? '#10B981' : '#EF4444')
                    : r.type === 'sum' ? '#EF4444'
                    : 'var(--text-primary)';
                  return (
                    <tr key={i} style={{ borderTop: '1px solid var(--border)', background: isBold ? 'var(--bg-subtle)' : 'transparent' }}>
                      <td className="px-4 py-2.5 text-xs" style={{ color, fontWeight: isBold ? 700 : 400, paddingLeft: r.label.startsWith('  ') ? 32 : 16 }}>{r.label.trim()}</td>
                      <td className="px-4 py-2.5 text-xs text-right font-bold" style={{ color }}>{fmt(r.val)}</td>
                      <td className="px-4 py-2.5 text-xs text-right" style={{ color: 'var(--text-muted)' }}>{r.pctC}</td>
                      <td className="px-4 py-2.5 text-xs text-right" style={{ color: 'var(--text-muted)' }}>{r.pctR}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'societes' && (
          <div className="rounded-xl overflow-x-auto" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-subtle)' }}>
                  {['Société', 'Recettes', 'Charges P/R', 'AO', 'HAO', 'Charges tot.', 'Résultat net', 'Marge %', 'Voyages'].map(h => (
                    <th key={h} className="px-3 py-2 text-right font-bold whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {socRows.map(r => {
                  const ct = r.depense_pr + r.depenses_ao + r.depenses_hao;
                  const marge = r.recettes > 0 ? (r.resultat_net / r.recettes * 100) : 0;
                  return (
                    <tr key={r.code} style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="px-3 py-2 text-left font-bold" style={{ color: 'var(--text-primary)' }}>{r.code}</td>
                      <td className="px-3 py-2 text-right" style={{ color: '#10B981' }}>{fmtN(r.recettes)}</td>
                      <td className="px-3 py-2 text-right" style={{ color: '#EF4444' }}>{fmtN(r.depense_pr)}</td>
                      <td className="px-3 py-2 text-right" style={{ color: '#8B5CF6' }}>{fmtN(r.depenses_ao)}</td>
                      <td className="px-3 py-2 text-right" style={{ color: '#A855F7' }}>{fmtN(r.depenses_hao)}</td>
                      <td className="px-3 py-2 text-right font-bold" style={{ color: '#EF4444' }}>{fmtN(ct)}</td>
                      <td className="px-3 py-2 text-right font-bold" style={{ color: r.resultat_net >= 0 ? '#10B981' : '#EF4444' }}>{fmtN(r.resultat_net)}</td>
                      <td className="px-3 py-2 text-right" style={{ color: marge >= 0 ? '#10B981' : '#EF4444' }}>{marge.toFixed(1)}%</td>
                      <td className="px-3 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>{r.voyages}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-subtle)' }}>
                  <td className="px-3 py-2.5 text-left font-bold" style={{ color: 'var(--text-primary)' }}>TOTAL CONSOLIDÉ</td>
                  <td className="px-3 py-2.5 text-right font-bold" style={{ color: '#10B981' }}>{fmtN(totals.recettes)}</td>
                  <td className="px-3 py-2.5 text-right font-bold" style={{ color: '#EF4444' }}>{fmtN(totals.depense_pr)}</td>
                  <td className="px-3 py-2.5 text-right font-bold" style={{ color: '#8B5CF6' }}>{fmtN(totals.depenses_ao)}</td>
                  <td className="px-3 py-2.5 text-right font-bold" style={{ color: '#A855F7' }}>{fmtN(totals.depenses_hao)}</td>
                  <td className="px-3 py-2.5 text-right font-bold" style={{ color: '#EF4444' }}>{fmtN(totalCharges)}</td>
                  <td className="px-3 py-2.5 text-right font-bold" style={{ color: totals.resultat_net >= 0 ? '#10B981' : '#EF4444' }}>{fmtN(totals.resultat_net)}</td>
                  <td className="px-3 py-2.5 text-right font-bold" style={{ color: margeNette >= 0 ? '#10B981' : '#EF4444' }}>{margeNette.toFixed(1)}%</td>
                  <td className="px-3 py-2.5 text-right font-bold" style={{ color: 'var(--text-primary)' }}>{totals.voyages}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {activeTab === 'segments' && (
          <div className="rounded-xl overflow-x-auto" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-subtle)' }}>
                  {['Segment', 'Recettes', 'Charges P/R', 'AO', 'HAO', 'Résultat net', 'Marge %', 'Voyages'].map(h => (
                    <th key={h} className="px-3 py-2 text-right font-bold whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {segRows.map(r => {
                  const marge = r.recettes > 0 ? (r.resultat_net / r.recettes * 100) : 0;
                  return (
                    <tr key={r.segment_code} style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="px-3 py-2 text-left font-bold" style={{ color: 'var(--text-primary)' }}>{r.segment_label}</td>
                      <td className="px-3 py-2 text-right" style={{ color: '#10B981' }}>{fmtN(r.recettes)}</td>
                      <td className="px-3 py-2 text-right" style={{ color: '#EF4444' }}>{fmtN(r.depense_pr)}</td>
                      <td className="px-3 py-2 text-right" style={{ color: '#8B5CF6' }}>{fmtN(r.depenses_ao)}</td>
                      <td className="px-3 py-2 text-right" style={{ color: '#A855F7' }}>{fmtN(r.depenses_hao)}</td>
                      <td className="px-3 py-2 text-right font-bold" style={{ color: r.resultat_net >= 0 ? '#10B981' : '#EF4444' }}>{fmtN(r.resultat_net)}</td>
                      <td className="px-3 py-2 text-right" style={{ color: marge >= 0 ? '#10B981' : '#EF4444' }}>{marge.toFixed(1)}%</td>
                      <td className="px-3 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>{r.voyages}</td>
                    </tr>
                  );
                })}
                {segRows.length === 0 && (
                  <tr><td colSpan={8} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Aucune donnée</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'charges' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>Charges par société (P/R vs AO vs HAO)</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={socRows.map(r => ({
                  name: r.code,
                  'P/R': r.depense_pr,
                  AO: r.depenses_ao,
                  HAO: r.depenses_hao,
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="var(--text-muted)" />
                  <YAxis tickFormatter={fmtM} tick={{ fontSize: 10 }} stroke="var(--text-muted)" />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Bar dataKey="P/R" stackId="a" fill="#6B7280" />
                  <Bar dataKey="AO" stackId="a" fill="#8B5CF6" />
                  <Bar dataKey="HAO" stackId="a" fill="#A855F7" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>Résultat net par société</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={socRows.map(r => ({ name: r.code, Résultat: r.resultat_net }))} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" tickFormatter={fmtM} tick={{ fontSize: 10 }} stroke="var(--text-muted)" />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} stroke="var(--text-muted)" width={60} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Bar dataKey="Résultat" radius={[0, 4, 4, 0]}>
                    {socRows.map((r, i) => <Cell key={i} fill={r.resultat_net >= 0 ? '#10B981' : '#EF4444'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Navigation cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-6">
        {[
          { label: 'Rapport financier', desc: 'Recettes/charges/marge par société et segment', icon: <FileText className="w-5 h-5" />, path: '/gestion-agboville/depenses' },
          { label: 'Performance par bus', desc: 'Rentabilité par matricule/segment', icon: <BarChart3 className="w-5 h-5" />, path: '/gestion-agboville/depenses' },
          { label: 'Analyse des charges', desc: 'P/R vs AO vs HAO', icon: <PieIcon className="w-5 h-5" />, path: '/gestion-agboville/depenses' },
        ].map(c => (
          <button key={c.label} onClick={() => navigate(c.path)}
            className="rounded-xl p-4 text-left flex items-start gap-3 transition-colors hover:shadow-md"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <span style={{ color: '#0B7439' }}>{c.icon}</span>
            <div>
              <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{c.label}</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{c.desc}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
