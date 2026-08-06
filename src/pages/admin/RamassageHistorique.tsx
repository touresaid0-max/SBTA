import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/services/supabase';
import { Download, Printer, Bus, RefreshCw, Filter } from 'lucide-react';
import { format, subDays } from 'date-fns';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';

const fmtN = (n: number) => new Intl.NumberFormat('fr-CI', { maximumFractionDigits: 0 }).format(n);
const fmtFCFA = (n: number) => fmtN(n) + ' FCFA';

interface RamassageRow {
  id: string;
  created_at: string;
  collected_at: string | null;
  departure_number: number | null;
  route_name: string | null;
  bus_registration: string | null;
  origin_station_name: string | null;
  destination_station_name: string | null;
  collected_places: number | null;
  collected_amount: number | null;
  collected_by_name: string | null;
  status: string;
  company_id: string | null;
}

interface Company { id: string; name: string; }
interface Station { id: string; name: string; }
interface RouteItem { id: string; name: string; }

const PERIODS = [
  { label: "Aujourd'hui", id: 'today', days: 0 },
  { label: '7 jours', id: '7d', days: 7 },
  { label: '30 jours', id: '30d', days: 30 },
  { label: '90 jours', id: '90d', days: 90 },
];

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  pending:   { label: 'En attente',  color: '#B91C1C', bg: '#FEE2E2' },
  consulted: { label: 'Consulté',    color: '#B45309', bg: '#FEF3C7' },
  done:      { label: 'Validé',      color: '#15803D', bg: '#DCFCE7' },
};

function getRange(id: string, cf: string, ct: string) {
  const today = new Date();
  if (id === 'custom') return { from: cf || format(today, 'yyyy-MM-dd'), to: ct || format(today, 'yyyy-MM-dd') };
  if (id === 'today') return { from: format(today, 'yyyy-MM-dd'), to: format(today, 'yyyy-MM-dd') };
  const days = PERIODS.find(p => p.id === id)?.days ?? 30;
  return { from: format(subDays(today, days), 'yyyy-MM-dd'), to: format(today, 'yyyy-MM-dd') };
}

export default function RamassageHistorique() {
  const [periodId, setPeriodId] = useState('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [filterRoute, setFilterRoute] = useState('all');
  const [filterPlate, setFilterPlate] = useState('');
  const [filterStation, setFilterStation] = useState('all');
  const [filterCompany, setFilterCompany] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [rows, setRows] = useState<RamassageRow[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);

  const { from: dateFrom, to: dateTo } = getRange(periodId, customFrom, customTo);

  useEffect(() => {
    supabase.from('companies').select('id, name').order('name').then(({ data }) => { if (data) setCompanies(data as Company[]); });
    supabase.from('stations').select('id, name').order('name').then(({ data }) => { if (data) setStations(data as Station[]); });
    supabase.from('routes').select('id, name').order('name').then(({ data }) => { if (data) setRoutes(data as RouteItem[]); });
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    let q = supabase
      .from('ramassage_notifications')
      .select('*')
      .gte('created_at', `${dateFrom}T00:00:00`)
      .lte('created_at', `${dateTo}T23:59:59`)
      .order('created_at', { ascending: false });

    if (filterRoute !== 'all') q = q.eq('route_id', filterRoute);
    if (filterStation !== 'all') q = q.eq('destination_station_id', filterStation);
    if (filterCompany !== 'all') q = q.eq('company_id', filterCompany);
    if (filterStatus !== 'all') q = q.eq('status', filterStatus);

    const { data } = await q;
    let result = (data as RamassageRow[]) ?? [];

    if (filterPlate.trim()) {
      const p = filterPlate.trim().toLowerCase();
      result = result.filter(r => (r.bus_registration ?? '').toLowerCase().includes(p));
    }

    setRows(result);
    setLoading(false);
    setRefreshing(false);
  }, [dateFrom, dateTo, filterRoute, filterPlate, filterStation, filterCompany, filterStatus]);

  useEffect(() => { load(); }, [load]);

  const totals = rows.reduce((acc, r) => ({
    places: acc.places + (r.collected_places ?? 0),
    amount: acc.amount + Number(r.collected_amount ?? 0),
  }), { places: 0, amount: 0 });

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const sheetRows = rows.map(r => ({
      'Date':              format(new Date(r.created_at), 'dd/MM/yyyy HH:mm'),
      'N° Départ':         r.departure_number ?? '—',
      'Ligne':             r.route_name ?? '—',
      'Immatriculation':   r.bus_registration ?? '—',
      'Gare de départ':    r.origin_station_name ?? '—',
      'Gare de destination': r.destination_station_name ?? '—',
      'Places vendues':    r.collected_places ?? 0,
      'Montant collecté':  Number(r.collected_amount ?? 0),
      'Guichet':           r.collected_by_name ?? '—',
      'Statut':            STATUS_LABELS[r.status]?.label ?? r.status,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetRows), 'Historique ramassage');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
      'Période':        `${dateFrom} → ${dateTo}`,
      'Ligne':          filterRoute === 'all' ? 'Toutes' : routes.find(r => r.id === filterRoute)?.name ?? filterRoute,
      'Immatriculation': filterPlate || 'Toutes',
      'Gare':           filterStation === 'all' ? 'Toutes' : stations.find(s => s.id === filterStation)?.name ?? filterStation,
      'Gestionnaire':   filterCompany === 'all' ? 'Tous' : companies.find(c => c.id === filterCompany)?.name ?? filterCompany,
      'Statut':         filterStatus === 'all' ? 'Tous' : STATUS_LABELS[filterStatus]?.label ?? filterStatus,
      'Exporté le':     format(new Date(), 'dd/MM/yyyy HH:mm'),
    }]), 'Paramètres');
    XLSX.writeFile(wb, `historique_ramassage_${dateFrom}_${dateTo}.xlsx`);
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
    const imgH = Math.min(pageH - 20, (pageW - 20) / ratio);
    pdf.setFontSize(13);
    pdf.text(`Historique des ramassages — ${dateFrom} → ${dateTo}`, 10, 12);
    pdf.addImage(imgData, 'PNG', 10, 18, pageW - 20, imgH);
    pdf.save(`historique_ramassage_${dateFrom}_${dateTo}.pdf`);
  };

  const printTable = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Historique Ramassage</title>
    <style>body{font-family:Arial;font-size:11px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:4px 6px}th{background:#f0f0f0}h1{font-size:16px}</style>
    </head><body><h1>Historique des ramassages — ${dateFrom} → ${dateTo}</h1>`);
    if (tableRef.current) win.document.write(tableRef.current.innerHTML);
    win.document.write('</body></html>');
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  };

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Bus className="w-6 h-6" style={{ color: '#0EA5E9' }} />
            Historique des ramassages
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {dateFrom} → {dateTo} · {rows.length} enregistrement{rows.length > 1 ? 's' : ''}
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
          <button onClick={() => setPeriodId('custom')}
            className="px-3 py-1.5 text-sm font-medium transition-colors"
            style={{ backgroundColor: periodId === 'custom' ? '#0EA5E9' : 'var(--surface)', color: periodId === 'custom' ? '#fff' : 'var(--text-secondary)' }}>
            Personnalisé
          </button>
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
        <select value={filterStation} onChange={e => setFilterStation(e.target.value)}
          className="px-3 py-1.5 border rounded-xl text-sm"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}>
          <option value="all">Toutes les gares</option>
          {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={filterCompany} onChange={e => setFilterCompany(e.target.value)}
          className="px-3 py-1.5 border rounded-xl text-sm"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}>
          <option value="all">Tous les gestionnaires</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-1.5 border rounded-xl text-sm"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}>
          <option value="all">Tous les statuts</option>
          {Object.entries(STATUS_LABELS).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
        </select>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-xl border p-4" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Total ramassages</p>
          <p className="text-lg font-bold" style={{ color: '#0EA5E9' }}>{rows.length}</p>
        </div>
        <div className="rounded-xl border p-4" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Ramassages validés</p>
          <p className="text-lg font-bold" style={{ color: '#15803D' }}>{rows.filter(r => r.status === 'done').length}</p>
        </div>
        <div className="rounded-xl border p-4" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Places vendues</p>
          <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{fmtN(totals.places)}</p>
        </div>
        <div className="rounded-xl border p-4" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Montant collecté</p>
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
                  {['Date', 'N° Départ', 'Ligne', 'Immatriculation', 'Gare départ', 'Gare destination', 'Places', 'Montant', 'Guichet', 'Statut'].map(h => (
                    <th key={h} className="px-3 py-3 text-left text-xs font-medium whitespace-nowrap"
                      style={{ color: 'var(--text-secondary)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody style={{ backgroundColor: 'var(--surface)' }}>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center" style={{ color: 'var(--text-muted)' }}>
                      Aucun ramassage sur cette période.
                    </td>
                  </tr>
                ) : rows.map(r => {
                  const st = STATUS_LABELS[r.status] ?? { label: r.status, color: '#6B7280', bg: '#F3F4F6' };
                  return (
                    <tr key={r.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                      <td className="px-3 py-2.5 text-sm whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                        {format(new Date(r.created_at), 'dd/MM/yyyy')}
                      </td>
                      <td className="px-3 py-2.5 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                        {r.departure_number ?? '—'}
                      </td>
                      <td className="px-3 py-2.5 text-sm" style={{ color: 'var(--text-primary)' }}>{r.route_name ?? '—'}</td>
                      <td className="px-3 py-2.5 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{r.bus_registration ?? '—'}</td>
                      <td className="px-3 py-2.5 text-sm" style={{ color: 'var(--text-secondary)' }}>{r.origin_station_name ?? '—'}</td>
                      <td className="px-3 py-2.5 text-sm" style={{ color: 'var(--text-secondary)' }}>{r.destination_station_name ?? '—'}</td>
                      <td className="px-3 py-2.5 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{r.collected_places ?? 0}</td>
                      <td className="px-3 py-2.5 text-sm font-bold" style={{ color: '#15803D' }}>{fmtFCFA(Number(r.collected_amount ?? 0))}</td>
                      <td className="px-3 py-2.5 text-sm" style={{ color: 'var(--text-secondary)' }}>{r.collected_by_name ?? '—'}</td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap font-medium"
                          style={{ backgroundColor: st.bg, color: st.color }}>{st.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
