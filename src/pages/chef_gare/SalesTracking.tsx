import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';
import { Monitor, TrendingUp, TicketCheck, Banknote, RefreshCw, ChevronDown, ChevronUp, MapPin } from 'lucide-react';
import { format } from 'date-fns';

interface SaleRow {
  schedule_id: string;
  departure_datetime: string;
  arrival_datetime: string;
  status: string;
  counter_id: string | null;
  counter_number: number | null;
  departure_number: number | null;
  route_name: string;
  origin_city: string;
  destination_city: string;
  driver_name: string;
  capacity: number;
  seats_sold: number;
  seats_remaining: number;
  total_ticket_amount: number;
  total_charges: number;
  solde_ticket: number;
}

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  planifie:   { label: 'Planifié',    color: '#0369A1', bg: '#E0F2FE' },
  en_cours:   { label: 'En cours',    color: '#D97706', bg: '#FEF3C7' },
  termine:    { label: 'Terminé',     color: '#16A34A', bg: '#DCFCE7' },
  annule:     { label: 'Annulé',      color: '#DC2626', bg: '#FEE2E2' },
  retard:     { label: 'Retard',      color: '#9A3412', bg: '#FFEDD5' },
};

export default function ChefGareSalesTracking() {
  const { user } = useAuthStore();
  const [rows, setRows] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => { load(); }, [dateFilter]);

  const load = async () => {
    setLoading(true);
    try {
      const { data: stationId } = await supabase.rpc('get_my_station_id');
      if (!stationId) { toast.error('Impossible de récupérer votre gare'); return; }

      const { count: chefCount } = await supabase
        .from('station_managers')
        .select('id', { count: 'exact', head: true })
        .eq('station_id', stationId);
      const restrictManagerId = (chefCount ?? 0) > 1 ? user?.id ?? null : null;

      let summaryQuery = supabase
        .from('schedule_receipt_summary')
        .select('*')
        .eq('station_id', stationId)
        .eq('departure_date', dateFilter)
        .order('departure_datetime', { ascending: true });

      if (restrictManagerId) {
        const { data: ownCounters } = await supabase
          .from('counters')
          .select('id')
          .eq('station_id', stationId)
          .eq('manager_id', restrictManagerId);
        const visibleIds = (ownCounters || []).map((c: any) => c.id);
        if (visibleIds.length === 0) { setRows([]); return; }
        summaryQuery = summaryQuery.in('counter_id', visibleIds);
      }

      const { data, error } = await summaryQuery;

      if (error) throw error;
      setRows(data || []);
    } catch (err: any) {
      toast.error('Erreur de chargement des ventes');
    } finally {
      setLoading(false);
    }
  };

  const totals = rows.reduce((acc, r) => ({
    departures: acc.departures + 1,
    tickets: acc.tickets + (r.seats_sold || 0),
    revenue: acc.revenue + (r.total_ticket_amount || 0),
    charges: acc.charges + (r.total_charges || 0),
    solde: acc.solde + (r.solde_ticket || 0),
  }), { departures: 0, tickets: 0, revenue: 0, charges: 0, solde: 0 });

  const byCounter: Record<string, SaleRow[]> = {};
  rows.forEach(r => {
    const key = r.counter_number != null ? String(r.counter_number) : 'non_assigne';
    if (!byCounter[key]) byCounter[key] = [];
    byCounter[key].push(r);
  });

  const counterKeys = Object.keys(byCounter).sort((a, b) => {
    if (a === 'non_assigne') return 1;
    if (b === 'non_assigne') return -1;
    return Number(a) - Number(b);
  });

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Suivi des ventes par guichet
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Détail des départs, billets vendus et recettes par guichet
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input type="date" value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="px-3 py-2 border rounded-xl text-sm"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
          <button onClick={load}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* KPI summary */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        {[
          { label: 'Départs', value: totals.departures, icon: <Monitor className="w-4 h-4" />, color: 'var(--primary)', fmt: (v: number) => v },
          { label: 'Billets vendus', value: totals.tickets, icon: <TicketCheck className="w-4 h-4" />, color: '#0369A1', fmt: (v: number) => v },
          { label: 'Recettes billets', value: totals.revenue, icon: <Banknote className="w-4 h-4" />, color: '#16A34A', fmt: (v: number) => `${(v / 1000).toFixed(0)}k` },
          { label: 'Charges', value: totals.charges, icon: <TrendingUp className="w-4 h-4" />, color: '#D97706', fmt: (v: number) => `${(v / 1000).toFixed(0)}k` },
          { label: 'Solde net', value: totals.solde, icon: <TrendingUp className="w-4 h-4" />, color: totals.solde >= 0 ? '#16A34A' : '#DC2626', fmt: (v: number) => `${(v / 1000).toFixed(0)}k` },
        ].map((kpi, i) => (
          <div key={i} className="rounded-2xl p-4 border shadow-sm" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2 mb-2">
              <span style={{ color: kpi.color }}>{kpi.icon}</span>
              <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{kpi.label}</span>
            </div>
            <p className="text-2xl font-bold" style={{ color: kpi.color }}>
              {kpi.fmt(kpi.value)}
            </p>
            {kpi.value > 999 && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{kpi.value.toLocaleString()} FCFA</p>}
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-4 rounded-full animate-spin"
            style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border-2 border-dashed" style={{ borderColor: 'var(--border)' }}>
          <Monitor className="w-12 h-12 mx-auto mb-3" style={{ color: '#D1D5DB' }} />
          <p className="font-medium" style={{ color: 'var(--text-secondary)' }}>Aucun départ pour cette date</p>
        </div>
      ) : (
        <div className="space-y-6">
          {counterKeys.map(key => {
            const counterRows = byCounter[key];
            const counterLabel = key === 'non_assigne' ? 'Non assigné' : `Guichet ${key}`;
            const counterTotals = counterRows.reduce((acc, r) => ({
              departures: acc.departures + 1,
              tickets: acc.tickets + (r.seats_sold || 0),
              revenue: acc.revenue + (r.total_ticket_amount || 0),
              charges: acc.charges + (r.total_charges || 0),
              solde: acc.solde + (r.solde_ticket || 0),
            }), { departures: 0, tickets: 0, revenue: 0, charges: 0, solde: 0 });

            return (
              <div key={key} className="rounded-2xl border overflow-hidden shadow-sm"
                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
                {/* Counter header */}
                <div className="flex items-center gap-4 px-6 py-4 border-b"
                  style={{ backgroundColor: 'var(--primary-light)', borderColor: 'var(--border)' }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-lg text-white flex-shrink-0"
                    style={{ backgroundColor: key === 'non_assigne' ? '#9CA3AF' : 'var(--primary)' }}>
                    {key === 'non_assigne' ? '?' : key}
                  </div>
                  <div className="flex-1">
                    <p className="font-bold" style={{ color: 'var(--text-primary)' }}>{counterLabel}</p>
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {counterTotals.departures} départ{counterTotals.departures > 1 ? 's' : ''} • {counterTotals.tickets} billets
                    </p>
                  </div>
                  <div className="flex items-center gap-6 text-sm">
                    <div className="text-right">
                      <p className="font-bold text-green-700">{counterTotals.revenue.toLocaleString()}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Recettes</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold" style={{ color: counterTotals.solde >= 0 ? '#16A34A' : '#DC2626' }}>
                        {counterTotals.solde.toLocaleString()}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Solde</p>
                    </div>
                  </div>
                </div>

                {/* Rows table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                        {['Départ', 'Itinéraire', 'Statut', 'Sièges vendus', 'Sièges restants', 'Recettes', 'Charges', 'Solde', ''].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                            style={{ color: 'var(--text-muted)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {counterRows.map(row => {
                        const statusCfg = STATUS_LABELS[row.status] || { label: row.status, color: '#6B7280', bg: '#F3F4F6' };
                        const isExpanded = expandedId === row.schedule_id;
                        return (
                          <React.Fragment key={row.schedule_id}>
                            <tr className="border-t hover:bg-gray-50 transition-colors"
                              style={{ borderColor: 'var(--border)' }}>
                              <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>
                                {format(new Date(row.departure_datetime), 'HH:mm')}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                                  <MapPin className="w-3 h-3 flex-shrink-0" />
                                  {row.origin_city} → {row.destination_city}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <span className="px-2 py-1 rounded-full text-xs font-semibold"
                                  style={{ color: statusCfg.color, backgroundColor: statusCfg.bg }}>
                                  {statusCfg.label}
                                </span>
                              </td>
                              <td className="px-4 py-3 font-semibold text-center" style={{ color: 'var(--text-primary)' }}>
                                {row.seats_sold} / {row.capacity}
                              </td>
                              <td className="px-4 py-3 text-center"
                                style={{ color: row.seats_remaining === 0 ? '#DC2626' : '#16A34A', fontWeight: 600 }}>
                                {row.seats_remaining}
                              </td>
                              <td className="px-4 py-3 font-semibold" style={{ color: '#16A34A' }}>
                                {(row.total_ticket_amount || 0).toLocaleString()}
                              </td>
                              <td className="px-4 py-3" style={{ color: '#D97706' }}>
                                {(row.total_charges || 0).toLocaleString()}
                              </td>
                              <td className="px-4 py-3 font-bold"
                                style={{ color: (row.solde_ticket || 0) >= 0 ? '#16A34A' : '#DC2626' }}>
                                {(row.solde_ticket || 0).toLocaleString()}
                              </td>
                              <td className="px-4 py-3">
                                <button onClick={() => setExpandedId(isExpanded ? null : row.schedule_id)}
                                  className="p-1 rounded" style={{ color: 'var(--text-muted)' }}>
                                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                </button>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr style={{ borderColor: 'var(--border)' }}>
                                <td colSpan={9} className="px-6 py-4 border-t"
                                  style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border)' }}>
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                                    <div>
                                      <p className="text-xs font-medium mb-0.5" style={{ color: 'var(--text-muted)' }}>Chauffeur</p>
                                      <p style={{ color: 'var(--text-primary)' }}>{row.driver_name || '—'}</p>
                                    </div>
                                    <div>
                                      <p className="text-xs font-medium mb-0.5" style={{ color: 'var(--text-muted)' }}>Bus</p>
                                      <p style={{ color: 'var(--text-primary)' }}>{row.registration_number || '—'}</p>
                                    </div>
                                    <div>
                                      <p className="text-xs font-medium mb-0.5" style={{ color: 'var(--text-muted)' }}>Arrivée prévue</p>
                                      <p style={{ color: 'var(--text-primary)' }}>
                                        {row.arrival_datetime ? format(new Date(row.arrival_datetime), 'HH:mm') : '—'}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-xs font-medium mb-0.5" style={{ color: 'var(--text-muted)' }}>N° Départ</p>
                                      <p style={{ color: 'var(--text-primary)' }}>{row.departure_number ?? '—'}</p>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
