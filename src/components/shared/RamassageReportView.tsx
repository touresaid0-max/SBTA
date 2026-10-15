import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { supabase } from '@/services/supabase';
import { Download, Printer, Bus, RefreshCw, Filter, FileText } from 'lucide-react';
import { format, subDays, startOfWeek, startOfYear } from 'date-fns';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';

const fmtN = (n: number) => new Intl.NumberFormat('fr-CI', { maximumFractionDigits: 0 }).format(n);
const fmtFCFA = (n: number) => fmtN(n) + ' FCFA';

interface RamassageRow {
  id: string;
  created_at: string;
  collected_at: string | null;
  departure_datetime: string | null;
  departure_number: number | null;
  route_name: string | null;
  bus_registration: string | null;
  driver_name: string | null;
  origin_station_name: string | null;
  destination_station_name: string | null;
  collected_places: number | null;
  collected_amount: number | null;
  collected_by_name: string | null;
  counter_number: string | null;
  is_direct: boolean | null;
  status: string;
}

const PERIODS = [
  { label: 'Journalier', id: 'today' },
  { label: 'Hebdomadaire', id: 'week' },
  { label: 'Annuel', id: 'year' },
  { label: 'Personnalisé', id: 'custom' },
];

function getRange(id: string, cf: string, ct: string) {
  const today = new Date();
  if (id === 'custom') return { from: cf || format(today, 'yyyy-MM-dd'), to: ct || format(today, 'yyyy-MM-dd') };
  if (id === 'today') return { from: format(today, 'yyyy-MM-dd'), to: format(today, 'yyyy-MM-dd') };
  if (id === 'week') return { from: format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'), to: format(today, 'yyyy-MM-dd') };
  if (id === 'year') return { from: format(startOfYear(today), 'yyyy-MM-dd'), to: format(today, 'yyyy-MM-dd') };
  return { from: format(subDays(today, 30), 'yyyy-MM-dd'), to: format(today, 'yyyy-MM-dd') };
}

interface Props {
  stationId: string | null;
  stationName?: string | null;
  title?: string;
  layout?: (children: ReactNode) => ReactNode;
}

export default function RamassageReportView({ stationId, stationName, title = 'Rapport des ventes de ramassage', layout }: Props) {
  const [periodId, setPeriodId] = useState('today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [filterRoute, setFilterRoute] = useState('all');
  const [filterPlate, setFilterPlate] = useState('');
  const [rows, setRows] = useState<RamassageRow[]>([]);
  const [routes, setRoutes] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);

  const { from: dateFrom, to: dateTo } = getRange(periodId, customFrom, customTo);

  useEffect(() => {
    supabase.from('routes').select('id, name').order('name').then(({ data }) => {
      if (data) setRoutes(data as { id: string; name: string }[]);
    });
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!stationId) return;
    if (!silent) setLoading(true); else setRefreshing(true);
    let q = supabase
      .from('ramassage_notifications')
      .select('*')
      .eq('status', 'done')
      .eq('destination_station_id', stationId)
      .gte('collected_at', `${dateFrom}T00:00:00`)
      .lte('collected_at', `${dateTo}T23:59:59`)
      .order('collected_at', { ascending: false });

    if (filterRoute !== 'all') q = q.eq('route_id', filterRoute);

    const { data } = await q;
    let result = (data as RamassageRow[]) ?? [];

    if (filterPlate.trim()) {
      const p = filterPlate.trim().toLowerCase();
      result = result.filter(r => (r.bus_registration ?? '').toLowerCase().includes(p));
    }

    setRows(result);
    setLoading(false);
    setRefreshing(false);
  }, [stationId, dateFrom, dateTo, filterRoute, filterPlate]);

  useEffect(() => { load(); }, [load]);

  const totals = rows.reduce((acc, r) => ({
    places: acc.places + (r.collected_places ?? 0),
    amount: acc.amount + Number(r.collected_amount ?? 0),
  }), { places: 0, amount: 0 });

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const sheetRows = rows.map(r => ({
      'Date': format(new Date(r.collected_at ?? r.created_at), 'dd/MM/yyyy'),
      'Heure': r.departure_datetime ? format(new Date(r.departure_datetime), 'HH:mm') : '—',
      'Type': r.is_direct ? 'Direct' : 'Ligne',
      'N° Départ': r.departure_number ?? '—',
      'Ligne': r.route_name ?? '—',
      'Immatriculation': r.bus_registration ?? '—',
      'Chauffeur': r.driver_name ?? '—',
      'Gare': r.origin_station_name ?? r.destination_station_name ?? '—',
      'Guichet': r.counter_number ?? '—',
      'Ville de destination': r.is_direct ? (r.route_name ?? '—') : (r.destination_station_name ?? '—'),
      'Sièges vendus': r.collected_places ?? 0,
      'Montant collecté': Number(r.collected_amount ?? 0),
      'Validé par': r.collected_by_name ?? '—',
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetRows), 'Ventes ramassage');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
      'Période': `${dateFrom} → ${dateTo}`,
      'Gare': stationName ?? '—',
      'Ligne': filterRoute === 'all' ? 'Toutes' : routes.find(r => r.id === filterRoute)?.name ?? filterRoute,
      'Immatriculation': filterPlate || 'Toutes',
      'Nombre de ramassages': rows.length,
      'Sièges vendus': totals.places,
      'Montant total': totals.amount,
      'Exporté le': format(new Date(), 'dd/MM/yyyy HH:mm'),
    }]), 'Résumé');
    XLSX.writeFile(wb, `rapport_ramassage_${dateFrom}_${dateTo}.xlsx`);
  };

  const exportPDF = async () => {
    if (!tableRef.current) return;
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(tableRef.current, { scale: 1.5, useCORS: true });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const ratio = canvas.width / canvas.height;
    const imgH = Math.min(pageH - 25, (pageW - 20) / ratio);
    pdf.setFontSize(13);
    pdf.text(`${title} — ${stationName ?? ''}`, 10, 12);
    pdf.setFontSize(10);
    pdf.text(`Période: ${dateFrom} → ${dateTo}`, 10, 18);
    pdf.addImage(imgData, 'PNG', 10, 24, pageW - 20, imgH);
    pdf.save(`rapport_ramassage_${dateFrom}_${dateTo}.pdf`);
  };

  const printTable = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>${title}</title>
    <style>body{font-family:Arial;font-size:11px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:4px 6px}th{background:#f0f0f0}h1{font-size:16px}h2{font-size:13px}.summary{margin:10px 0}.summary span{margin-right:20px}</style>
    </head><body><h1>${title}</h1><h2>Gare: ${stationName ?? '—'} · Période: ${dateFrom} → ${dateTo}</h2>
    <div class="summary"><b>Ramassages:</b> ${rows.length} <b>Sièges:</b> ${totals.places} <b>Montant:</b> ${fmtFCFA(totals.amount)}</div>`);
    if (tableRef.current) win.document.write(tableRef.current.innerHTML);
    win.document.write('</body></html>');
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  };

  const content = (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <FileText className="w-6 h-6" style={{ color: '#0EA5E9' }} />
            {title}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {stationName ? `Gare: ${stationName} · ` : ''}{dateFrom} → {dateTo} · {rows.length} ramassage{rows.length > 1 ? 's' : ''} validé{rows.length > 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => load(true)} disabled={refreshing}
            className="p-2 rounded-xl border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} style={{ color: 'var(--text-secondary)' }} />
          </button>
          <button onClick={printTable}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}>
            <Printer className="w-4 h-4" /> Imprimer
          </button>
          <button onClick={exportPDF}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium"
            style={{ backgroundColor: '#EF4444', color: '#fff' }}>
            <Download className="w-4 h-4" /> PDF
          </button>
          <button onClick={exportExcel}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium"
            style={{ backgroundColor: '#16A34A', color: '#fff' }}>
            <Download className="w-4 h-4" /> Excel
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-2xl border p-4 flex flex-wrap gap-3 items-center"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <Filter className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
        <div className="flex rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          {PERIODS.map(p => (
            <button key={p.id} onClick={() => setPeriodId(p.id)}
              className="px-3 py-1.5 text-sm font-medium transition-colors"
              style={{ backgroundColor: periodId === p.id ? '#0EA5E9' : 'var(--surface)', color: periodId === p.id ? '#fff' : 'var(--text-secondary)' }}>
              {p.label}
            </button>
          ))}
        </div>
        {periodId === 'custom' && (
          <>
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              className="px-3 py-1.5 border rounded-lg text-sm"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
            <span style={{ color: 'var(--text-muted)' }}>→</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              className="px-3 py-1.5 border rounded-lg text-sm"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
          </>
        )}
        <select value={filterRoute} onChange={e => setFilterRoute(e.target.value)}
          className="px-3 py-1.5 border rounded-xl text-sm"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}>
          <option value="all">Toutes les lignes</option>
          {routes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <input type="text" value={filterPlate} onChange={e => setFilterPlate(e.target.value)} placeholder="Immatriculation"
          className="px-3 py-1.5 border rounded-xl text-sm w-36"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border p-4" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Nombre de ramassages</p>
          <p className="text-lg font-bold" style={{ color: '#0EA5E9' }}>{rows.length}</p>
        </div>
        <div className="rounded-xl border p-4" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Sièges vendus</p>
          <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{fmtN(totals.places)}</p>
        </div>
        <div className="rounded-xl border p-4" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Montant total collecté</p>
          <p className="text-lg font-bold" style={{ color: '#15803D' }}>{fmtFCFA(totals.amount)}</p>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 rounded-full animate-spin" style={{ borderColor: '#0EA5E9', borderTopColor: 'transparent' }} />
        </div>
      ) : (
        <div ref={tableRef} className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead style={{ backgroundColor: 'var(--surface-raised)' }}>
                <tr>
                  {['Date', 'Heure', 'Type', 'N° Départ', 'Immatriculation', 'Chauffeur', 'Gare', 'Guichet', 'Ville de destination', 'Sièges', 'Montant', 'Validé par'].map(h => (
                    <th key={h} className="px-3 py-3 text-left text-xs font-medium whitespace-nowrap"
                      style={{ color: 'var(--text-secondary)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody style={{ backgroundColor: 'var(--surface)' }}>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-4 py-8 text-center" style={{ color: 'var(--text-muted)' }}>
                      Aucun ramassage validé sur cette période.
                    </td>
                  </tr>
                ) : rows.map(r => (
                  <tr key={r.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-3 py-2.5 text-sm whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                      {format(new Date(r.collected_at ?? r.created_at), 'dd/MM/yyyy')}
                    </td>
                    <td className="px-3 py-2.5 text-sm" style={{ color: 'var(--text-primary)' }}>
                      {r.departure_datetime ? format(new Date(r.departure_datetime), 'HH:mm') : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-sm" style={{ color: 'var(--text-primary)' }}>
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold"
                        style={{ backgroundColor: r.is_direct ? 'var(--primary-light, #E0F2FE)' : 'var(--surface-raised)', color: r.is_direct ? '#0EA5E9' : 'var(--text-secondary)' }}>
                        {r.is_direct ? 'Direct' : 'Ligne'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                      {r.departure_number ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{r.bus_registration ?? '—'}</td>
                    <td className="px-3 py-2.5 text-sm" style={{ color: 'var(--text-primary)' }}>{r.driver_name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-sm" style={{ color: 'var(--text-secondary)' }}>{r.origin_station_name ?? r.destination_station_name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-sm" style={{ color: 'var(--text-secondary)' }}>{r.counter_number ?? '—'}</td>
                    <td className="px-3 py-2.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {r.is_direct ? (r.route_name ?? '—') : (r.destination_station_name ?? '—')}
                    </td>
                    <td className="px-3 py-2.5 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{r.collected_places ?? 0}</td>
                    <td className="px-3 py-2.5 text-sm font-bold" style={{ color: '#15803D' }}>{fmtFCFA(Number(r.collected_amount ?? 0))}</td>
                    <td className="px-3 py-2.5 text-sm" style={{ color: 'var(--text-secondary)' }}>{r.collected_by_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
              {rows.length > 0 && (
                <tfoot style={{ backgroundColor: 'var(--surface-raised)' }}>
                  <tr className="border-t-2" style={{ borderColor: 'var(--border)' }}>
                    <td colSpan={9} className="px-3 py-3 text-sm font-bold text-right" style={{ color: 'var(--text-secondary)' }}>Total</td>
                    <td className="px-3 py-3 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{fmtN(totals.places)}</td>
                    <td className="px-3 py-3 text-sm font-bold" style={{ color: '#15803D' }}>{fmtFCFA(totals.amount)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );

  if (layout) return layout(content);
  return content;
}
