import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  startOfDay, endOfDay, startOfWeek, endOfWeek,
  startOfMonth, endOfMonth, startOfYear, endOfYear,
} from 'date-fns';
import { BarChart3, Luggage, RefreshCw, Printer, Loader2, TrendingUp } from 'lucide-react';
import ExportButton from '../../components/shared/ExportButton';

type Period = 'jour' | 'semaine' | 'mois' | 'annee';

interface SaleRow {
  id: string;
  baggage_number: string;
  destination: string;
  price: number;
  seat_number: string | null;
  has_ticket: boolean;
  bus_registration: string | null;
  owner_name: string;
  owner_phone: string;
  created_at: string;
}

const PERIODS: { key: Period; label: string }[] = [
  { key: 'jour', label: 'Journalier' },
  { key: 'semaine', label: 'Hebdomadaire' },
  { key: 'mois', label: 'Mensuel' },
  { key: 'annee', label: 'Annuel' },
];

function getRange(period: Period): { start: Date; end: Date } {
  const now = new Date();
  switch (period) {
    case 'jour': return { start: startOfDay(now), end: endOfDay(now) };
    case 'semaine': return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
    case 'mois': return { start: startOfMonth(now), end: endOfMonth(now) };
    case 'annee': return { start: startOfYear(now), end: endOfYear(now) };
  }
}

function rangeLabel(period: Period): string {
  const { start, end } = getRange(period);
  if (period === 'jour') return format(start, 'EEEE d MMMM yyyy', { locale: fr });
  if (period === 'annee') return format(start, 'yyyy', { locale: fr });
  if (period === 'mois') return format(start, 'MMMM yyyy', { locale: fr });
  return `${format(start, 'd MMM', { locale: fr })} — ${format(end, 'd MMM yyyy', { locale: fr })}`;
}

export default function BagagisteBaggageReport() {
  const { user } = useAuthStore();
  const [period, setPeriod] = useState<Period>('jour');
  const [rows, setRows] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const { start, end } = getRange(period);
      const { data, error } = await supabase
        .from('baggage_tickets')
        .select('id, baggage_number, destination, price, seat_number, has_ticket, bus_registration, owner_name, owner_phone, created_at, payment_status')
        .eq('sold_by', user.id)
        .eq('payment_status', 'paye')
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString())
        .order('created_at', { ascending: false });
      if (error) throw error;
      setRows((data as SaleRow[]) || []);
    } catch (err: any) {
      toast.error(err.message || 'Erreur de chargement du rapport');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id, period]);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => rows.reduce(
    (acc, r) => {
      acc.count += 1;
      acc.amount += r.price || 0;
      if (r.has_ticket) acc.withTicket += 1; else acc.withoutTicket += 1;
      return acc;
    },
    { count: 0, amount: 0, withTicket: 0, withoutTicket: 0 },
  ), [rows]);

  const byDestination = useMemo(() => {
    const map: Record<string, { destination: string; count: number; amount: number }> = {};
    rows.forEach(r => {
      const key = r.destination || '—';
      if (!map[key]) map[key] = { destination: key, count: 0, amount: 0 };
      map[key].count += 1;
      map[key].amount += r.price || 0;
    });
    return Object.values(map).sort((a, b) => b.amount - a.amount);
  }, [rows]);

  const exportRows = () => rows.map(r => ({
    'N° Bagage': r.baggage_number,
    Date: format(new Date(r.created_at), 'dd/MM/yyyy HH:mm'),
    Destination: r.destination,
    Type: r.has_ticket ? 'Avec ticket' : 'Sans siège',
    Siège: r.seat_number || '—',
    Car: r.bus_registration || '—',
    Propriétaire: r.owner_name,
    Contact: r.owner_phone,
    'Prix (FCFA)': r.price,
  }));

  const fileBase = `rapport_bagages_${period}_${format(new Date(), 'yyyyMMdd')}`;

  const exportExcel = async () => {
    if (rows.length === 0) { toast.error('Aucune donnée à exporter'); return; }
    const { utils, writeFile } = await import('xlsx');
    const detail = utils.json_to_sheet(exportRows());
    const summary = utils.json_to_sheet([
      { Indicateur: 'Bagages vendus', Valeur: totals.count },
      { Indicateur: 'Avec ticket', Valeur: totals.withTicket },
      { Indicateur: 'Sans siège', Valeur: totals.withoutTicket },
      { Indicateur: 'Recettes (FCFA)', Valeur: totals.amount },
      {},
      ...byDestination.map(d => ({ Indicateur: `Destination — ${d.destination}`, Valeur: `${d.count} bagage(s) · ${d.amount} FCFA` })),
    ]);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, summary, 'Synthèse');
    utils.book_append_sheet(wb, detail, 'Détail');
    writeFile(wb, `${fileBase}.xlsx`);
  };

  function buildHtml(): string {
    const esc = (s: unknown) => String(s ?? '—').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const printedAt = new Date().toLocaleString('fr-FR');
    const periodName = PERIODS.find(p => p.key === period)?.label ?? '';
    const body = rows.map(r => `<tr>
      <td>${esc(r.baggage_number)}</td>
      <td>${esc(format(new Date(r.created_at), 'dd/MM HH:mm'))}</td>
      <td>${esc(r.destination)}</td>
      <td>${esc(r.has_ticket ? 'Avec ticket' : 'Sans siège')}</td>
      <td>${esc(r.seat_number)}</td>
      <td>${esc(r.owner_name)}</td>
      <td class="r">${esc((r.price || 0).toLocaleString('fr-FR'))}</td>
    </tr>`).join('');
    return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8" /><title>Rapport bagages</title>
<style>
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  body{font-family:'Segoe UI',Roboto,Arial,sans-serif;color:#1A2E22;font-size:11px;margin:0;}
  .page{padding:16px 20px;}
  .head{display:flex;justify-content:space-between;border-bottom:3px solid #0B7439;padding-bottom:12px;}
  .brand{font-size:20px;font-weight:800;color:#0B7439;}.brand small{display:block;font-size:10px;color:#6B7280;font-weight:500;}
  .title{font-size:16px;font-weight:700;margin:0;text-align:right;}.meta{font-size:10px;color:#6B7280;text-align:right;margin-top:4px;}
  .kpis{display:flex;gap:20px;margin-top:14px;}
  .kpi{flex:1;border:1px solid #E2EAE5;border-radius:8px;padding:10px;text-align:center;}
  .kpi b{display:block;font-size:18px;color:#0B7439;}.kpi span{font-size:9px;color:#6B7280;text-transform:uppercase;}
  table{width:100%;border-collapse:collapse;margin-top:14px;}
  th{background:#0B7439;color:#fff;font-size:10px;font-weight:700;text-transform:uppercase;padding:7px 8px;text-align:left;}
  td{padding:6px 8px;border-bottom:1px solid #E2EAE5;}.r{text-align:right;}
  tr.ft td{background:#1A2E22;color:#fff;font-weight:800;font-size:12px;}
  @page{size:A4;margin:10mm;}
</style></head>
<body><div class="page">
  <div class="head"><div class="brand">SBTA<small>Bagagiste — Rapport de ventes</small></div>
  <div><h1 class="title">Rapport ${esc(periodName)}</h1><div class="meta">${esc(rangeLabel(period))}<br/>Édité le ${esc(printedAt)}</div></div></div>
  <div class="kpis">
    <div class="kpi"><b>${totals.count}</b><span>Bagages</span></div>
    <div class="kpi"><b>${totals.withTicket}</b><span>Avec ticket</span></div>
    <div class="kpi"><b>${totals.withoutTicket}</b><span>Sans siège</span></div>
    <div class="kpi"><b>${esc(totals.amount.toLocaleString('fr-FR'))}</b><span>Recettes FCFA</span></div>
  </div>
  <table><thead><tr>
    <th>N° Bagage</th><th>Date</th><th>Destination</th><th>Type</th><th>Siège</th><th>Propriétaire</th><th class="r">Prix</th>
  </tr></thead><tbody>${body}
    <tr class="ft"><td colspan="6" class="r">${rows.length} bagage(s)</td><td class="r">${esc(totals.amount.toLocaleString('fr-FR'))}</td></tr>
  </tbody></table>
  <p style="margin-top:10px;font-size:9px;color:#9CA3AF;text-align:center;">Document généré automatiquement — SBTA · Profil Bagagiste</p>
</div></body></html>`;
  }

  function handlePrint() {
    const w = window.open('', '_blank', 'width=1000,height=800');
    if (!w) { toast.error('Veuillez autoriser les fenêtres pop-up.'); return; }
    w.document.open(); w.document.write(buildHtml()); w.document.close(); w.focus();
    setTimeout(() => { try { w.print(); } catch { /* noop */ } }, 400);
  }

  async function exportPdf() {
    if (rows.length === 0) { toast.error('Aucune donnée à exporter'); return; }
    const { default: jsPDF } = await import('jspdf');
    const { default: html2canvas } = await import('html2canvas');
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;background:#fff;';
    holder.innerHTML = buildHtml();
    document.body.appendChild(holder);
    try {
      const target = (holder.querySelector('.page') as HTMLElement) ?? holder;
      const canvas = await html2canvas(target, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const imgW = 210, pageH = 297;
      const imgH = (canvas.height * imgW) / canvas.width;
      let position = 0;
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, position, imgW, imgH);
      let remaining = imgH - pageH;
      while (remaining > 0) { position -= pageH; pdf.addPage(); pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, position, imgW, imgH); remaining -= pageH; }
      pdf.save(`${fileBase}.pdf`);
    } catch (err) { console.error(err); toast.error('Erreur lors de la génération du PDF'); }
    finally { document.body.removeChild(holder); }
  }

  const summaryCards = [
    { label: 'Bagages vendus', value: String(totals.count) },
    { label: 'Avec ticket', value: String(totals.withTicket) },
    { label: 'Sans siège', value: String(totals.withoutTicket) },
    { label: 'Recettes (FCFA)', value: totals.amount.toLocaleString('fr-FR') },
  ];

  return (
    <div className="p-6 lg:p-8 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <BarChart3 className="w-7 h-7" style={{ color: 'var(--primary)' }} /> Rapport bagages
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {rangeLabel(period)} — Mes ventes de tickets bagages
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', backgroundColor: 'var(--surface)' }}
          >
            <RefreshCw className="w-4 h-4" /> Rafraîchir
          </button>
          <button
            onClick={handlePrint}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            <Printer className="w-4 h-4" /> Imprimer
          </button>
          <ExportButton onExportPDF={exportPdf} onExportExcel={exportExcel} />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 rounded-xl p-1 w-fit" style={{ backgroundColor: 'var(--neutral-50)' }}>
        {PERIODS.map(p => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className="px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
            style={period === p.key
              ? { backgroundColor: 'var(--surface)', color: 'var(--primary)', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }
              : { color: 'var(--text-secondary)' }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryCards.map(c => (
          <div key={c.label} className="rounded-2xl border p-4 shadow-sm" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
            <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
            <p className="text-2xl font-bold mt-1 truncate" style={{ color: 'var(--text-primary)' }}>{c.value}</p>
          </div>
        ))}
      </div>

      {byDestination.length > 0 && (
        <div className="rounded-2xl border shadow-sm overflow-hidden" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <TrendingUp className="w-5 h-5" style={{ color: 'var(--primary)' }} />
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Répartition par destination</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-5">
            {byDestination.map(d => (
              <div key={d.destination} className="rounded-xl p-3" style={{ backgroundColor: 'var(--neutral-50)' }}>
                <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{d.destination}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {d.count} bagage(s) · <span style={{ color: 'var(--primary)' }}>{d.amount.toLocaleString('fr-FR')} F</span>
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border shadow-sm overflow-hidden" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--primary)' }} />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16" style={{ color: 'var(--text-secondary)' }}>
            <Luggage className="w-10 h-10 mb-2" style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm">Aucune vente de bagage sur cette période.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide border-b" style={{ color: 'var(--text-muted)', borderColor: 'var(--border)' }}>
                  <th className="px-4 py-3 font-semibold">N° Bagage</th>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Destination</th>
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 font-semibold">Siège</th>
                  <th className="px-4 py-3 font-semibold">Propriétaire</th>
                  <th className="px-4 py-3 font-semibold text-right">Prix</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td className="px-4 py-3 font-medium whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{r.baggage_number}</td>
                    <td className="px-4 py-3 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{format(new Date(r.created_at), 'dd/MM HH:mm')}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{r.destination}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{r.has_ticket ? 'Avec ticket' : 'Sans siège'}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{r.seat_number || '—'}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{r.owner_name}</td>
                    <td className="px-4 py-3 text-right font-semibold whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{(r.price || 0).toLocaleString('fr-FR')} F</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="text-sm font-bold text-white" style={{ backgroundColor: 'var(--primary)' }}>
                  <td className="px-4 py-3" colSpan={6}>{rows.length} bagage(s)</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{totals.amount.toLocaleString('fr-FR')} F</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
