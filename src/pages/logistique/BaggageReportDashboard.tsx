import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../services/supabase';
import { formatCurrency } from '../../utils/formatCurrency';
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, subMonths } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Calendar, Filter, Download, Printer, Building2, TrendingUp,
  TrendingDown, Scale, Package, FileText, Table
} from 'lucide-react';
import toast from 'react-hot-toast';

type PeriodType = 'jour' | 'mois' | 'semestre' | 'annee' | 'custom';

interface ReportRow {
  id: string;
  station_id: string;
  station_name: string;
  report_date: string;
  baggage_revenue: number;
  baggage_count: number;
  total_expenses: number;
  balance: number;
  validated: boolean;
  validated_at: string | null;
  expenses: ExpenseDetail[];
}

interface ExpenseDetail {
  id: string;
  category: string;
  detail: string | null;
  amount: number;
}

interface BaggageDetail {
  id: string;
  baggage_number: string;
  destination: string;
  price: number;
  owner_name: string;
  has_ticket: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  ration: 'Ration',
  cie: 'CIE',
  sodeci_eau: 'SODECI / Eau',
  wifi_internet: 'Wi-Fi / Internet',
  carburant: 'Carburant',
  autre: 'Autre dépense',
};

export default function BaggageReportDashboard() {
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodType>('jour');
  const [customStart, setCustomStart] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [customEnd, setCustomEnd] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [stationFilter, setStationFilter] = useState<string>('all');
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [baggageDetails, setBaggageDetails] = useState<Record<string, BaggageDetail[]>>({});
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [stations, setStations] = useState<{ id: string; name: string }[]>([]);

  const dateRange = useMemo(() => {
    const now = new Date();
    switch (period) {
      case 'jour': return { start: startOfDay(now), end: endOfDay(now) };
      case 'mois': return { start: startOfMonth(now), end: endOfMonth(now) };
      case 'semestre': return { start: subMonths(now, 6), end: now };
      case 'annee': return { start: startOfYear(now), end: endOfYear(now) };
      case 'custom': return { start: startOfDay(new Date(customStart)), end: endOfDay(new Date(customEnd)) };
    }
  }, [period, customStart, customEnd]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Load stations
      const { data: stationsData } = await supabase
        .from('stations')
        .select('id, name')
        .order('name');
      setStations(stationsData ?? []);

      // Load validated reports in date range
      let query = supabase
        .from('station_daily_reports')
        .select(`
          id, station_id, report_date, baggage_revenue, baggage_count,
          total_expenses, balance, validated, validated_at
        `)
        .eq('validated', true)
        .gte('report_date', format(dateRange.start, 'yyyy-MM-dd'))
        .lte('report_date', format(dateRange.end, 'yyyy-MM-dd'))
        .order('report_date', { ascending: false });

      if (stationFilter !== 'all') {
        query = query.eq('station_id', stationFilter);
      }

      const { data: reportData, error } = await query;
      if (error) throw error;

      // Load station names for each report
      const stationIds = [...new Set((reportData ?? []).map(r => r.station_id))];
      const { data: stData } = await supabase
        .from('stations')
        .select('id, name')
        .in('id', stationIds);
      const stationMap: Record<string, string> = {};
      (stData ?? []).forEach(s => { stationMap[s.id] = s.name; });

      // Load expenses for each report
      const reportIds = (reportData ?? []).map(r => r.id);
      const { data: expData } = await supabase
        .from('station_daily_expenses')
        .select('id, report_id, category, detail, amount')
        .in('report_id', reportIds);

      const expByReport: Record<string, ExpenseDetail[]> = {};
      (expData ?? []).forEach(e => {
        if (!expByReport[e.report_id]) expByReport[e.report_id] = [];
        expByReport[e.report_id].push(e);
      });

      const rows: ReportRow[] = (reportData ?? []).map(r => ({
        ...r,
        station_name: stationMap[r.station_id] || 'Gare inconnue',
        expenses: expByReport[r.id] ?? [],
      }));
      setReports(rows);
      setBaggageDetails({});
    } catch (err: any) {
      toast.error(err?.message ?? 'Erreur lors du chargement');
    } finally {
      setLoading(false);
    }
  }, [dateRange, stationFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  const loadBaggageDetails = async (report: ReportRow) => {
    const dayStart = new Date(`${report.report_date}T00:00:00`);
    const dayEnd = new Date(`${report.report_date}T23:59:59`);
    const { data } = await supabase
      .from('baggage_tickets')
      .select('id, baggage_number, destination, price, owner_name, has_ticket')
      .eq('station_id', report.station_id)
      .gte('created_at', dayStart.toISOString())
      .lte('created_at', dayEnd.toISOString())
      .order('created_at', { ascending: false });
    setBaggageDetails(prev => ({ ...prev, [report.id]: data ?? [] }));
  };

  const toggleExpand = (reportId: string) => {
    if (expandedRow === reportId) {
      setExpandedRow(null);
    } else {
      setExpandedRow(reportId);
      const rpt = reports.find(r => r.id === reportId);
      if (rpt && !baggageDetails[reportId]) loadBaggageDetails(rpt);
    }
  };

  // Totals
  const totals = useMemo(() => {
    const revenue = reports.reduce((s, r) => s + (r.baggage_revenue || 0), 0);
    const expenses = reports.reduce((s, r) => s + (r.total_expenses || 0), 0);
    const count = reports.reduce((s, r) => s + (r.baggage_count || 0), 0);
    return { revenue, expenses, balance: revenue - expenses, count };
  }, [reports]);

  // Expense breakdown by category across all reports
  const categoryBreakdown = useMemo(() => {
    const map: Record<string, { amount: number; details: { detail: string; amount: number; station: string }[] }> = {};
    reports.forEach(r => {
      r.expenses.forEach(e => {
        if (!map[e.category]) map[e.category] = { amount: 0, details: [] };
        map[e.category].amount += e.amount || 0;
        if (e.category === 'autre' && e.detail) {
          map[e.category].details.push({ detail: e.detail, amount: e.amount, station: r.station_name });
        }
      });
    });
    return map;
  }, [reports]);

  const handleExportExcel = async () => {
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();

      // Synthèse sheet
      const synthData = [
        ['Rapport Bagage SBTA', ''],
        ['Période', `${format(dateRange.start, 'dd/MM/yyyy')} — ${format(dateRange.end, 'dd/MM/yyyy')}`],
        [''],
        ['Gare', 'Date', 'Recettes bagages', 'Nombre bagages', 'Total dépenses', 'Solde', 'Statut'],
        ...reports.map(r => [
          r.station_name,
          format(new Date(r.report_date), 'dd/MM/yyyy'),
          r.baggage_revenue,
          r.baggage_count,
          r.total_expenses,
          r.balance,
          r.validated ? 'Validé' : 'En attente',
        ]),
        [''],
        ['TOTAL', '', totals.revenue, totals.count, totals.expenses, totals.balance, ''],
      ];
      const wsSynth = XLSX.utils.aoa_to_sheet(synthData);
      XLSX.utils.book_append_sheet(wb, wsSynth, 'Synthèse');

      // Dépenses par catégorie sheet
      const catData: any[][] = [['Catégorie', 'Montant total']];
      Object.entries(categoryBreakdown).forEach(([cat, info]) => {
        catData.push([CATEGORY_LABELS[cat] || cat, info.amount]);
      });
      catData.push(['']);
      catData.push(['Détail « Autres dépenses »']);
      catData.push(['Gare', 'Détail', 'Montant']);
      Object.entries(categoryBreakdown).forEach(([cat, info]) => {
        if (cat === 'autre') {
          info.details.forEach(d => catData.push([d.station, d.detail, d.amount]));
        }
      });
      const wsCat = XLSX.utils.aoa_to_sheet(catData);
      XLSX.utils.book_append_sheet(wb, wsCat, 'Dépenses par catégorie');

      // Détail sheet
      const detailData: any[][] = [['Gare', 'Date', 'N° Bagage', 'Destination', 'Propriétaire', 'Type', 'Prix']];
      for (const r of reports) {
        const bags = baggageDetails[r.id] || [];
        if (bags.length === 0) continue;
        bags.forEach(b => {
          detailData.push([
            r.station_name,
            format(new Date(r.report_date), 'dd/MM/yyyy'),
            b.baggage_number, b.destination, b.owner_name,
            b.has_ticket ? 'Avec ticket' : 'Sans siège',
            b.price,
          ]);
        });
      }
      const wsDetail = XLSX.utils.aoa_to_sheet(detailData);
      XLSX.utils.book_append_sheet(wb, wsDetail, 'Détail recettes');

      XLSX.writeFile(wb, `rapport_bagage_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`);
      toast.success('Excel téléchargé');
    } catch {
      toast.error('Erreur lors de l\'export Excel');
    }
  };

  const handleExportPDF = async () => {
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      let y = 15;

      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('SBTA — Rapport Bagage', 105, y, { align: 'center' });
      y += 6;
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Période: ${format(dateRange.start, 'dd/MM/yyyy')} — ${format(dateRange.end, 'dd/MM/yyyy')}`, 105, y, { align: 'center' });
      y += 10;

      // Summary
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Synthèse', 14, y);
      y += 6;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(`Total recettes: ${formatCurrency(totals.revenue)}`, 14, y);
      doc.text(`Total dépenses: ${formatCurrency(totals.expenses)}`, 80, y);
      doc.text(`Solde: ${formatCurrency(totals.balance)}`, 146, y);
      y += 5;
      doc.text(`Nombre de bagages: ${totals.count}`, 14, y);
      doc.text(`Nombre de rapports: ${reports.length}`, 80, y);
      y += 10;

      // Table header
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text('Gare', 14, y);
      doc.text('Date', 70, y);
      doc.text('Recettes', 95, y, { align: 'right' });
      doc.text('Dépenses', 125, y, { align: 'right' });
      doc.text('Solde', 155, y, { align: 'right' });
      doc.text('Statut', 185, y);
      y += 2;
      doc.setDrawColor(200);
      doc.line(14, y, 196, y);
      y += 4;

      doc.setFont('helvetica', 'normal');
      reports.forEach(r => {
        if (y > 280) { doc.addPage(); y = 15; }
        doc.text(r.station_name.substring(0, 25), 14, y);
        doc.text(format(new Date(r.report_date), 'dd/MM/yy'), 70, y);
        doc.text(formatCurrency(r.baggage_revenue), 95, y, { align: 'right' });
        doc.text(formatCurrency(r.total_expenses), 125, y, { align: 'right' });
        doc.text(formatCurrency(r.balance), 155, y, { align: 'right' });
        doc.text(r.validated ? 'Validé' : 'Attente', 185, y);
        y += 5;
      });

      // Totals row
      y += 2;
      doc.setDrawColor(100);
      doc.line(14, y, 196, y);
      y += 5;
      doc.setFont('helvetica', 'bold');
      doc.text('TOTAL', 14, y);
      doc.text(formatCurrency(totals.revenue), 95, y, { align: 'right' });
      doc.text(formatCurrency(totals.expenses), 125, y, { align: 'right' });
      doc.text(formatCurrency(totals.balance), 155, y, { align: 'right' });

      // Category breakdown on new page
      if (y > 250) { doc.addPage(); y = 15; } else { y += 15; }
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Dépenses par catégorie', 14, y);
      y += 8;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      Object.entries(categoryBreakdown).forEach(([cat, info]) => {
        if (y > 280) { doc.addPage(); y = 15; }
        doc.text(`${CATEGORY_LABELS[cat] || cat}: ${formatCurrency(info.amount)}`, 14, y);
        y += 5;
        if (cat === 'autre' && info.details.length > 0) {
          info.details.forEach(d => {
            if (y > 280) { doc.addPage(); y = 15; }
            doc.text(`  • ${d.station} — ${d.detail}: ${formatCurrency(d.amount)}`, 14, y);
            y += 4;
          });
        }
      });

      doc.save(`rapport_bagage_${format(new Date(), 'yyyyMMdd_HHmm')}.pdf`);
      toast.success('PDF téléchargé');
    } catch {
      toast.error('Erreur lors de l\'export PDF');
    }
  };

  const handlePrint = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`
      <!DOCTYPE html><html><head><meta charset="utf-8">
      <title>Rapport Bagage — ${format(dateRange.start, 'dd/MM/yyyy')} — ${format(dateRange.end, 'dd/MM/yyyy')}</title>
      <style>
        * { font-family: Arial, sans-serif; font-size: 12px; color: #000; }
        body { margin: 20px; }
        h1 { font-size: 18px; text-align: center; }
        h2 { font-size: 14px; border-bottom: 2px solid #000; padding-bottom: 4px; margin-top: 20px; }
        table { width: 100%; border-collapse: collapse; margin: 8px 0; }
        th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
        th { background: #f5f5f5; font-weight: bold; }
        .right { text-align: right; }
        .total-row td { font-weight: bold; background: #f0f0f0; }
        .summary { display: flex; justify-content: space-between; margin: 15px 0; }
        .summary div { flex: 1; text-align: center; border: 1px solid #ccc; padding: 10px; margin: 0 5px; }
        .summary .label { font-size: 11px; color: #666; }
        .summary .value { font-size: 16px; font-weight: bold; margin-top: 4px; }
        @media print { body { margin: 10px; } }
      </style></head><body>
        <h1>SBTA — Rapport Bagage Consolidé</h1>
        <p style="text-align:center;">Période: ${format(dateRange.start, 'dd/MM/yyyy')} — ${format(dateRange.end, 'dd/MM/yyyy')}</p>

        <div class="summary">
          <div><div class="label">Total recettes</div><div class="value">${formatCurrency(totals.revenue)}</div></div>
          <div><div class="label">Total dépenses</div><div class="value">${formatCurrency(totals.expenses)}</div></div>
          <div><div class="label">Solde</div><div class="value">${formatCurrency(totals.balance)}</div></div>
        </div>

        <h2>Détail par gare</h2>
        <table>
          <thead><tr><th>Gare</th><th>Date</th><th class="right">Recettes</th><th>Bagages</th><th class="right">Dépenses</th><th class="right">Solde</th><th>Statut</th></tr></thead>
          <tbody>
            ${reports.length === 0 ? '<tr><td colspan="7" style="text-align:center;">Aucun rapport pour cette période</td></tr>' : reports.map(r => `
              <tr>
                <td>${r.station_name}</td>
                <td>${format(new Date(r.report_date), 'dd/MM/yyyy')}</td>
                <td class="right">${formatCurrency(r.baggage_revenue)}</td>
                <td>${r.baggage_count}</td>
                <td class="right">${formatCurrency(r.total_expenses)}</td>
                <td class="right">${formatCurrency(r.balance)}</td>
                <td>${r.validated ? 'Validé' : 'Attente'}</td>
              </tr>
            `).join('')}
          </tbody>
          ${reports.length > 0 ? `<tfoot><tr class="total-row"><td colspan="2">TOTAL</td><td class="right">${formatCurrency(totals.revenue)}</td><td>${totals.count}</td><td class="right">${formatCurrency(totals.expenses)}</td><td class="right">${formatCurrency(totals.balance)}</td><td></td></tr></tfoot>` : ''}
        </table>

        <h2>Dépenses par catégorie</h2>
        <table>
          <thead><tr><th>Catégorie</th><th class="right">Montant total</th></tr></thead>
          <tbody>
            ${Object.entries(categoryBreakdown).map(([cat, info]) => `
              <tr><td>${CATEGORY_LABELS[cat] || cat}</td><td class="right">${formatCurrency(info.amount)}</td></tr>
            `).join('')}
            ${Object.keys(categoryBreakdown).length === 0 ? '<tr><td colspan="2" style="text-align:center;">Aucune dépense</td></tr>' : ''}
          </tbody>
        </table>

        ${categoryBreakdown.autre?.details.length ? `
        <h2>Détail des autres dépenses</h2>
        <table>
          <thead><tr><th>Gare</th><th>Détail</th><th class="right">Montant</th></tr></thead>
          <tbody>
            ${categoryBreakdown.autre.details.map(d => `<tr><td>${d.station}</td><td>${d.detail}</td><td class="right">${formatCurrency(d.amount)}</td></tr>`).join('')}
          </tbody>
        </table>
        ` : ''}

        <p style="text-align:center; margin-top:30px; font-size:10px; color:#999;">
          SBTA — Rapport généré le ${format(new Date(), 'dd/MM/yyyy à HH:mm', { locale: fr })}
        </p>
      </body></html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 500);
  };

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Rapport Bagage
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Tableau de bord consolidé — données des journées validées par les Chefs de Gare
        </p>
      </div>

      {/* Filters */}
      <div className="rounded-xl p-4 flex flex-wrap items-center gap-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2">
          <Filter className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
          <span className="text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>Filtres:</span>
        </div>

        {/* Period selector */}
        <div className="flex items-center gap-2">
          {([
            { val: 'jour', label: 'Jour' },
            { val: 'mois', label: 'Mois' },
            { val: 'semestre', label: 'Semestre' },
            { val: 'annee', label: 'Année' },
            { val: 'custom', label: 'Personnalisé' },
          ] as { val: PeriodType; label: string }[]).map(opt => (
            <button
              key={opt.val}
              onClick={() => setPeriod(opt.val)}
              className="px-3 py-1.5 rounded-lg text-sm font-bold transition-colors"
              style={{
                backgroundColor: period === opt.val ? 'var(--primary)' : 'var(--surface-2, #f5f5f5)',
                color: period === opt.val ? 'white' : 'var(--text-secondary)',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {period === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customStart}
              onChange={e => setCustomStart(e.target.value)}
              className="px-3 py-1.5 rounded-lg border-2 text-sm outline-none"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
            />
            <span style={{ color: 'var(--text-muted)' }}>→</span>
            <input
              type="date"
              value={customEnd}
              onChange={e => setCustomEnd(e.target.value)}
              className="px-3 py-1.5 rounded-lg border-2 text-sm outline-none"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
            />
          </div>
        )}

        {/* Station filter */}
        <select
          value={stationFilter}
          onChange={e => setStationFilter(e.target.value)}
          className="px-3 py-1.5 rounded-lg border-2 text-sm outline-none"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
        >
          <option value="all">Toutes les gares</option>
          {stations.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>

        {/* Export buttons */}
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={handleExportPDF} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold text-white transition-colors" style={{ backgroundColor: 'var(--primary)' }}>
            <Download className="w-4 h-4" /> PDF
          </button>
          <button onClick={handleExportExcel} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold text-white transition-colors" style={{ backgroundColor: 'var(--success, #16a34a)' }}>
            <Table className="w-4 h-4" /> Excel
          </button>
          <button onClick={handlePrint} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors" style={{ backgroundColor: 'var(--surface-2, #f5f5f5)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            <Printer className="w-4 h-4" /> Imprimer
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="rounded-xl p-4 flex items-center gap-3" style={{ backgroundColor: 'var(--success-light, #dcfce7)', border: '1px solid var(--success, #16a34a)' }}>
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--success, #16a34a)' }}>
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Total recettes</p>
            <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(totals.revenue)}</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{totals.count} bagages</p>
          </div>
        </div>
        <div className="rounded-xl p-4 flex items-center gap-3" style={{ backgroundColor: 'var(--danger-light, #fef2f2)', border: '1px solid var(--danger, #ef4444)' }}>
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--danger, #ef4444)' }}>
            <TrendingDown className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Total dépenses</p>
            <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(totals.expenses)}</p>
          </div>
        </div>
        <div className="rounded-xl p-4 flex items-center gap-3" style={{ backgroundColor: 'var(--primary-light, #e0e7ff)', border: '1px solid var(--primary)' }}>
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--primary)' }}>
            <Scale className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Solde total</p>
            <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(totals.balance)}</p>
          </div>
        </div>
        <div className="rounded-xl p-4 flex items-center gap-3" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--text-muted)' }}>
            <FileText className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Rapports validés</p>
            <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{reports.length}</p>
          </div>
        </div>
      </div>

      {/* Reports table */}
      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)' }}>
                <th className="px-4 py-3 text-left text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Gare</th>
                <th className="px-4 py-3 text-left text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Date</th>
                <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Recettes</th>
                <th className="px-4 py-3 text-center text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Bagages</th>
                <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Dépenses</th>
                <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Solde</th>
                <th className="px-4 py-3 text-center text-xs font-bold" style={{ color: 'var(--text-muted)' }}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center" style={{ color: 'var(--text-muted)' }}>
                  <div className="animate-spin rounded-full h-8 w-8 mx-auto" style={{ borderTop: '3px solid var(--primary)' }} />
                </td></tr>
              ) : reports.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                  Aucun rapport validé pour cette période
                </td></tr>
              ) : (
                reports.map(r => (
                  <>
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => toggleExpand(r.id)}>
                      <td className="px-4 py-3 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                        <Building2 className="w-4 h-4 inline mr-2" style={{ color: 'var(--text-muted)' }} />
                        {r.station_name}
                      </td>
                      <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {format(new Date(r.report_date), 'dd/MM/yyyy', { locale: fr })}
                      </td>
                      <td className="px-4 py-3 text-sm font-bold text-right" style={{ color: 'var(--success, #16a34a)' }}>{formatCurrency(r.baggage_revenue)}</td>
                      <td className="px-4 py-3 text-sm text-center" style={{ color: 'var(--text-secondary)' }}>{r.baggage_count}</td>
                      <td className="px-4 py-3 text-sm font-bold text-right" style={{ color: 'var(--danger, #ef4444)' }}>{formatCurrency(r.total_expenses)}</td>
                      <td className="px-4 py-3 text-sm font-bold text-right" style={{ color: r.balance >= 0 ? 'var(--success, #16a34a)' : 'var(--danger, #ef4444)' }}>{formatCurrency(r.balance)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold" style={{ backgroundColor: 'var(--success-light, #dcfce7)', color: 'var(--success, #16a34a)' }}>
                          Validé
                        </span>
                      </td>
                    </tr>
                    {expandedRow === r.id && (
                      <tr key={r.id + '-detail'} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td colSpan={7} className="px-4 py-4" style={{ backgroundColor: 'var(--surface-2, #f9fafb)' }}>
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            {/* Recettes detail */}
                            <div>
                              <h4 className="text-xs font-bold mb-2 flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
                                <Package className="w-4 h-4" /> Recettes bagages ({baggageDetails[r.id]?.length ?? 0})
                              </h4>
                              <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                                <thead>
                                  <tr><th className="text-left text-xs px-2 py-1" style={{ color: 'var(--text-muted)' }}>N°</th><th className="text-left text-xs px-2 py-1" style={{ color: 'var(--text-muted)' }}>Dest.</th><th className="text-right text-xs px-2 py-1" style={{ color: 'var(--text-muted)' }}>Prix</th></tr>
                                </thead>
                                <tbody>
                                  {(baggageDetails[r.id] || []).map(b => (
                                    <tr key={b.id}><td className="text-xs px-2 py-1 font-mono" style={{ color: 'var(--text-primary)' }}>{b.baggage_number}</td><td className="text-xs px-2 py-1" style={{ color: 'var(--text-secondary)' }}>{b.destination}</td><td className="text-xs px-2 py-1 text-right font-bold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(b.price)}</td></tr>
                                  ))}
                                  {(baggageDetails[r.id] || []).length === 0 && <tr><td colSpan={3} className="text-xs px-2 py-2 text-center" style={{ color: 'var(--text-muted)' }}>Chargement...</td></tr>}
                                </tbody>
                              </table>
                            </div>
                            {/* Dépenses detail */}
                            <div>
                              <h4 className="text-xs font-bold mb-2 flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
                                <TrendingDown className="w-4 h-4" /> Dépenses ({r.expenses.length})
                              </h4>
                              <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                                <thead>
                                  <tr><th className="text-left text-xs px-2 py-1" style={{ color: 'var(--text-muted)' }}>Catégorie</th><th className="text-left text-xs px-2 py-1" style={{ color: 'var(--text-muted)' }}>Détail</th><th className="text-right text-xs px-2 py-1" style={{ color: 'var(--text-muted)' }}>Montant</th></tr>
                                </thead>
                                <tbody>
                                  {r.expenses.map(e => (
                                    <tr key={e.id}><td className="text-xs px-2 py-1 font-bold" style={{ color: 'var(--text-primary)' }}>{CATEGORY_LABELS[e.category] || e.category}</td><td className="text-xs px-2 py-1" style={{ color: 'var(--text-secondary)' }}>{e.detail || '—'}</td><td className="text-xs px-2 py-1 text-right font-bold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(e.amount)}</td></tr>
                                  ))}
                                  {r.expenses.length === 0 && <tr><td colSpan={3} className="text-xs px-2 py-2 text-center" style={{ color: 'var(--text-muted)' }}>Aucune dépense</td></tr>}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))
              )}
            </tbody>
            {reports.length > 0 && (
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border)' }}>
                  <td colSpan={2} className="px-4 py-3 text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>TOTAUX</td>
                  <td className="px-4 py-3 text-sm font-bold text-right" style={{ color: 'var(--success, #16a34a)' }}>{formatCurrency(totals.revenue)}</td>
                  <td className="px-4 py-3 text-sm font-bold text-center" style={{ color: 'var(--text-secondary)' }}>{totals.count}</td>
                  <td className="px-4 py-3 text-sm font-bold text-right" style={{ color: 'var(--danger, #ef4444)' }}>{formatCurrency(totals.expenses)}</td>
                  <td className="px-4 py-3 text-sm font-bold text-right" style={{ color: totals.balance >= 0 ? 'var(--success, #16a34a)' : 'var(--danger, #ef4444)' }}>{formatCurrency(totals.balance)}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Category breakdown */}
      {Object.keys(categoryBreakdown).length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border)' }}>
            <TrendingDown className="w-5 h-5" style={{ color: 'var(--danger, #ef4444)' }} />
            <h2 className="font-bold" style={{ color: 'var(--text-primary)' }}>Dépenses par catégorie</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)' }}>
                  <th className="px-4 py-2 text-left text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Catégorie</th>
                  <th className="px-4 py-2 text-right text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Montant total</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(categoryBreakdown).map(([cat, info]) => (
                  <tr key={cat} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="px-4 py-2 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{CATEGORY_LABELS[cat] || cat}</td>
                    <td className="px-4 py-2 text-sm font-bold text-right" style={{ color: 'var(--text-primary)' }}>{formatCurrency(info.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border)' }}>
                  <td className="px-4 py-3 text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>Total</td>
                  <td className="px-4 py-3 text-sm font-bold text-right" style={{ color: 'var(--danger, #ef4444)' }}>{formatCurrency(totals.expenses)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
