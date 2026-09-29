import { useEffect, useState, useMemo } from 'react';
import { TrendingUp, Ticket as TicketIcon, Calendar, Download, Filter } from 'lucide-react';
import toast from 'react-hot-toast';
import { formatCurrency } from '@/utils/formatCurrency';
import {
  fetchKiosks, fetchKioskTicketsFiltered,
  type DigitalKiosk, type KioskTicket,
} from '@/services/kiosk.service';
import { supabase } from '@/services/supabase';
import { useRealtimeSync } from '@/pages/agent-reservation/shared';

interface Station { id: string; name: string; }

type PeriodKey = 'today' | 'week' | 'month' | 'year' | 'custom';

export default function KioskReports() {
  const [kiosks, setKiosks] = useState<DigitalKiosk[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [tickets, setTickets] = useState<KioskTicket[]>([]);
  const [loading, setLoading] = useState(true);

  const [period, setPeriod] = useState<PeriodKey>('today');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [kioskFilter, setKioskFilter] = useState('');
  const [stationFilter, setStationFilter] = useState('');
  const [channelFilter, setChannelFilter] = useState<'all' | 'borne' | 'borne_virtuelle'>('all');

  const load = () => {
    Promise.all([
      fetchKiosks(),
      supabase.from('stations').select('id, name').eq('is_active', true).order('name'),
    ]).then(([k, s]) => {
      setKiosks(k);
      setStations((s.data ?? []) as Station[]);
    }).catch(() => toast.error('Erreur de chargement')).finally(() => setLoading(false));
  };

  useEffect(load, []);
  useRealtimeSync(['kiosk_tickets', 'digital_kiosks'], load);

  // Compute date range from period
  const { from, to } = useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    if (period === 'today') return { from: todayStr, to: todayStr };
    if (period === 'week') {
      const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);
      return { from: weekAgo.toISOString().slice(0, 10), to: todayStr };
    }
    if (period === 'month') {
      const monthAgo = new Date(now); monthAgo.setMonth(now.getMonth() - 1);
      return { from: monthAgo.toISOString().slice(0, 10), to: todayStr };
    }
    if (period === 'year') {
      const yearAgo = new Date(now); yearAgo.setFullYear(now.getFullYear() - 1);
      return { from: yearAgo.toISOString().slice(0, 10), to: todayStr };
    }
    return { from: dateFrom, to: dateTo };
  }, [period, dateFrom, dateTo]);

  // Load tickets when filters change
  useEffect(() => {
    if (!from || !to) return;
    fetchKioskTicketsFiltered({
      kioskId: kioskFilter || undefined,
      stationId: stationFilter || undefined,
      dateFrom: from,
      dateTo: to,
      channel: channelFilter,
    }).then(setTickets).catch(() => toast.error('Erreur lors du chargement des tickets'));
  }, [from, to, kioskFilter, stationFilter, channelFilter]);

  const stats = useMemo(() => {
    const paid = tickets.filter((t) => t.payment_status === 'paid');
    const totalRevenue = paid.reduce((s, t) => s + t.total_amount, 0);
    const byMethod: Record<string, number> = {};
    paid.forEach((t) => { byMethod[t.payment_method] = (byMethod[t.payment_method] ?? 0) + t.total_amount; });
    const byChannel: Record<string, { count: number; revenue: number }> = {};
    paid.forEach((t) => {
      const ch = t.channel;
      if (!byChannel[ch]) byChannel[ch] = { count: 0, revenue: 0 };
      byChannel[ch].count++;
      byChannel[ch].revenue += t.total_amount;
    });
    const byStation: Record<string, { count: number; revenue: number; name: string }> = {};
    paid.forEach((t) => {
      const k = kiosks.find((k) => k.id === t.kiosk_id);
      const stationName = k?.station_name ?? 'N/A';
      if (!byStation[stationName]) byStation[stationName] = { count: 0, revenue: 0, name: stationName };
      byStation[stationName].count++;
      byStation[stationName].revenue += t.total_amount;
    });
    return { totalRevenue, paidCount: paid.length, totalCount: tickets.length, byMethod, byChannel, byStation };
  }, [tickets, kiosks]);

  function exportCSV() {
    const headers = ['Référence', 'Borne', 'Canal', 'Sièges', 'Montant', 'Moyen paiement', 'Statut', 'Date'];
    const rows = tickets.map((t) => [
      t.ticket_ref,
      t.kiosk_name ?? '',
      t.channel,
      t.seat_numbers.join('; '),
      t.total_amount,
      t.payment_method,
      t.payment_status,
      new Date(t.created_at).toLocaleString('fr-FR'),
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `recettes_bornes_${from}_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success('Export téléchargé');
  }

  function exportPDF() {
    window.print();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-10 h-10 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const inputCls = 'border border-[#E2EAE5] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/30 bg-white';
  const selectCls = inputCls;

  return (
    <div className="space-y-6 p-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1A2E22]">Recettes des bornes</h1>
          <p className="text-sm text-[#6B7280] mt-1">Suivi des encaissements et transactions par borne</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCSV} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium border border-[#E2EAE5] text-[#1A2E22] hover:bg-[#F8FAF8]">
            <Download className="w-4 h-4" /> Excel
          </button>
          <button onClick={exportPDF} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-white" style={{ backgroundColor: '#0B7439' }}>
            <Download className="w-4 h-4" /> PDF
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#1A2E22]">
          <Filter className="w-4 h-4" /> Filtres
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <select value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)} className={selectCls}>
            <option value="today">Aujourd'hui</option>
            <option value="week">7 derniers jours</option>
            <option value="month">30 derniers jours</option>
            <option value="year">Année</option>
            <option value="custom">Période personnalisée</option>
          </select>
          {period === 'custom' && (
            <>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputCls} />
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputCls} />
            </>
          )}
          <select value={stationFilter} onChange={(e) => setStationFilter(e.target.value)} className={selectCls}>
            <option value="">Toutes les gares</option>
            {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={kioskFilter} onChange={(e) => setKioskFilter(e.target.value)} className={selectCls}>
            <option value="">Toutes les bornes</option>
            {kiosks.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
          <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value as 'all' | 'borne' | 'borne_virtuelle')} className={selectCls}>
            <option value="all">Tous les canaux</option>
            <option value="borne">Borne physique</option>
            <option value="borne_virtuelle">Borne virtuelle</option>
          </select>
        </div>
      </div>

      {/* KPI Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI icon={TrendingUp} label="Recette totale" value={formatCurrency(stats.totalRevenue)} color="#0B7439" />
        <KPI icon={TicketIcon} label="Tickets payés" value={String(stats.paidCount)} color="#0B7439" />
        <KPI icon={TicketIcon} label="Total tickets" value={String(stats.totalCount)} color="#0B86B8" />
        <KPI icon={Calendar} label="Période" value={`${from} → ${to}`} color="#B45309" small />
      </div>

      {/* Breakdown by channel */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-[#E2EAE5] p-6">
          <h3 className="font-semibold text-[#1A2E22] mb-4">Répartition par canal</h3>
          <div className="space-y-3">
            {Object.entries(stats.byChannel).map(([ch, data]) => (
              <div key={ch} className="flex items-center justify-between">
                <span className="text-sm text-[#6B7280]">
                  {ch === 'borne' ? 'Borne physique' : 'Borne virtuelle'}
                  <span className="text-xs text-gray-400 ml-2">({data.count} tickets)</span>
                </span>
                <span className="font-bold text-[#1A2E22]">{formatCurrency(data.revenue)}</span>
              </div>
            ))}
            {Object.keys(stats.byChannel).length === 0 && <p className="text-sm text-gray-400">Aucune donnée</p>}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-[#E2EAE5] p-6">
          <h3 className="font-semibold text-[#1A2E22] mb-4">Répartition par moyen de paiement</h3>
          <div className="space-y-3">
            {Object.entries(stats.byMethod).map(([method, amount]) => (
              <div key={method} className="flex items-center justify-between">
                <span className="text-sm text-[#6B7280] uppercase">{method}</span>
                <span className="font-bold text-[#1A2E22]">{formatCurrency(amount)}</span>
              </div>
            ))}
            {Object.keys(stats.byMethod).length === 0 && <p className="text-sm text-gray-400">Aucune donnée</p>}
          </div>
        </div>
      </div>

      {/* Breakdown by station */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] p-6">
        <h3 className="font-semibold text-[#1A2E22] mb-4">Ventilation par gare</h3>
        <div className="space-y-3">
          {Object.entries(stats.byStation).map(([_, data]) => (
            <div key={data.name} className="flex items-center justify-between border-b border-[#F0F4F1] pb-2">
              <span className="text-sm font-medium text-[#1A2E22]">{data.name}</span>
              <div className="flex items-center gap-6">
                <span className="text-sm text-[#6B7280]">{data.count} tickets</span>
                <span className="font-bold text-[#0B7439]">{formatCurrency(data.revenue)}</span>
              </div>
            </div>
          ))}
          {Object.keys(stats.byStation).length === 0 && <p className="text-sm text-gray-400">Aucune donnée</p>}
        </div>
      </div>

      {/* Transaction detail */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E2EAE5]">
          <h3 className="font-semibold text-[#1A2E22]">Détail des transactions ({tickets.length})</h3>
        </div>
        {tickets.length === 0 ? (
          <div className="p-12 text-center text-[#6B7280]">
            <TicketIcon className="w-10 h-10 mx-auto mb-2 text-gray-300" />
            <p>Aucune transaction sur cette période.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#F8FAF8] border-b border-[#E2EAE5]">
                <tr className="text-left text-[#6B7280]">
                  <th className="py-3 px-4 font-medium">Référence</th>
                  <th className="py-3 px-4 font-medium">Borne</th>
                  <th className="py-3 px-4 font-medium">Canal</th>
                  <th className="py-3 px-4 font-medium">Sièges</th>
                  <th className="py-3 px-4 font-medium">Montant</th>
                  <th className="py-3 px-4 font-medium">Paiement</th>
                  <th className="py-3 px-4 font-medium">Statut</th>
                  <th className="py-3 px-4 font-medium">Date/heure</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F4F1]">
                {tickets.map((t) => (
                  <tr key={t.id} className="hover:bg-[#F8FAF8]">
                    <td className="py-2.5 px-4 font-mono font-semibold text-[#1A2E22]">{t.ticket_ref}</td>
                    <td className="py-2.5 px-4 text-[#6B7280]">{t.kiosk_name ?? '—'}</td>
                    <td className="py-2.5 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${t.channel === 'borne' ? 'bg-[#E7F6EC] text-[#0B7439]' : 'bg-[#E6F8FF] text-[#0B86B8]'}`}>
                        {t.channel === 'borne' ? 'Physique' : 'Virtuelle'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-[#6B7280]">{t.seat_numbers.join(', ') || '—'}</td>
                    <td className="py-2.5 px-4 font-bold text-[#1A2E22]">{formatCurrency(t.total_amount)}</td>
                    <td className="py-2.5 px-4 text-[#6B7280] uppercase">{t.payment_method}</td>
                    <td className="py-2.5 px-4">
                      {t.payment_status === 'paid' && <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-[#E7F6EC] text-[#0B7439]">Payé</span>}
                      {t.payment_status === 'pending' && <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-[#FEF3C7] text-[#B45309]">En attente</span>}
                      {t.payment_status === 'failed' && <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-[#FEE2E2] text-[#DC2626]">Échoué</span>}
                    </td>
                    <td className="py-2.5 px-4 text-[#6B7280] text-xs">{new Date(t.created_at).toLocaleString('fr-FR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function KPI({ icon: Icon, label, value, color, small }: { icon: typeof TrendingUp; label: string; value: string; color: string; small?: boolean }) {
  return (
    <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${color}15` }}>
          <Icon className="w-5 h-5" style={{ color }} />
        </div>
        <span className="text-sm text-[#6B7280]">{label}</span>
      </div>
      <p className={`font-bold ${small ? 'text-sm' : 'text-2xl'}`} style={{ color }}>{value}</p>
    </div>
  );
}
