import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import { FileText, Monitor, TicketCheck, Banknote, TrendingUp, RefreshCw, Printer, MapPin } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface CounterSummary {
  counter_id: string | null;
  counter_number: number | null;
  departures: number;
  tickets: number;
  revenue: number;
  baggage: number;
  charges: number;
  rations: number;
  carburant: number;
  peages: number;
  autres: number;
  solde: number;
  ramassage: number;
  routes: string[];
}

interface DailyReportData {
  date: string;
  stationName: string;
  totalDepartures: number;
  totalTickets: number;
  totalRevenue: number;
  totalCharges: number;
  totalSolde: number;
  totalRamassage: number;
  counters: CounterSummary[];
}

export default function ChefGareDailyReport() {
  const [reportData, setReportData] = useState<DailyReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState(format(new Date(), 'yyyy-MM-dd'));

  useEffect(() => { load(); }, [dateFilter]);

  // Realtime: auto-refresh when a guichet makes a sale or modifies charges
  useEffect(() => {
    const channel = supabase
      .channel('chef-gare-daily-report-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, () => {
        load();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'counter_charges' }, () => {
        load();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules' }, () => {
        load();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'baggage_tickets' }, () => {
        load();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mobile_bookings' }, () => {
        load();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [dateFilter]);

  const load = async () => {
    setLoading(true);
    try {
      const { data: stationId } = await supabase.rpc('get_my_station_id');
      if (!stationId) { toast.error('Impossible de récupérer votre gare'); return; }

      const [{ data: rows, error }, { data: stationRow }] = await Promise.all([
        supabase
          .from('schedule_receipt_summary')
          .select('*')
          .eq('station_id', stationId)
          .eq('departure_date', dateFilter),
        supabase
          .from('stations')
          .select('name')
          .eq('id', stationId)
          .maybeSingle(),
      ]);

      if (error) throw error;

      const counterMap: Record<string, CounterSummary> = {};
      (rows || []).forEach((r: any) => {
        const key = r.counter_id ?? 'none';
        if (!counterMap[key]) {
          counterMap[key] = {
            counter_id: r.counter_id,
            counter_number: r.counter_number,
            departures: 0, tickets: 0, revenue: 0, baggage: 0,
            charges: 0, rations: 0, carburant: 0, peages: 0, autres: 0, solde: 0,
            ramassage: 0, routes: [],
          };
        }
        const c = counterMap[key];
        c.departures += 1;
        c.tickets += r.seats_sold || 0;
        c.revenue += r.total_ticket_amount || 0;
        c.baggage += r.total_baggage || 0;
        c.charges += r.total_charges || 0;
        c.rations += r.total_rations || 0;
        c.carburant += r.total_carburant || 0;
        c.peages += r.total_peages || 0;
        c.autres += r.total_autres || 0;
        c.solde += r.solde_ticket || 0;
        c.ramassage += r.ramassage_amount || 0;
        const route = `${r.origin_city} → ${r.destination_city}`;
        if (!c.routes.includes(route)) c.routes.push(route);
      });

      const counters = Object.values(counterMap).sort((a, b) => {
        if (a.counter_number == null) return 1;
        if (b.counter_number == null) return -1;
        return a.counter_number - b.counter_number;
      });

      setReportData({
        date: dateFilter,
        stationName: (stationRow as any)?.name || 'Gare',
        totalDepartures: counters.reduce((s, c) => s + c.departures, 0),
        totalTickets: counters.reduce((s, c) => s + c.tickets, 0),
        totalRevenue: counters.reduce((s, c) => s + c.revenue, 0),
        totalCharges: counters.reduce((s, c) => s + c.charges, 0),
        totalSolde: counters.reduce((s, c) => s + c.solde, 0),
        totalRamassage: counters.reduce((s, c) => s + c.ramassage, 0),
        counters,
      });
    } catch (err: any) {
      toast.error('Erreur de chargement du rapport');
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => window.print();

  if (loading) return (
    <div className="p-8 flex items-center justify-center min-h-64">
      <div className="w-8 h-8 border-4 rounded-full animate-spin"
        style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
    </div>
  );

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Rapport journalier
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {reportData?.stationName} — Synthèse par guichet
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
          <button onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
            style={{ backgroundColor: 'var(--primary)' }}>
            <Printer className="w-4 h-4" /> Imprimer
          </button>
        </div>
      </div>

      {!reportData || reportData.counters.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border-2 border-dashed" style={{ borderColor: 'var(--border)' }}>
          <FileText className="w-12 h-12 mx-auto mb-3" style={{ color: '#D1D5DB' }} />
          <p className="font-medium" style={{ color: 'var(--text-secondary)' }}>Aucune donnée pour cette date</p>
        </div>
      ) : (
        <>
          {/* Report header for print */}
          <div className="rounded-2xl border p-6 mb-6 shadow-sm" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="flex items-start justify-between flex-wrap gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                  Rapport journalier
                </p>
                <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                  {reportData.stationName}
                </h2>
                <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                  {format(new Date(dateFilter), 'EEEE d MMMM yyyy', { locale: fr })}
                </p>
              </div>
              <div className="flex gap-6">
                {[
                  { label: 'Départs', value: reportData.totalDepartures, color: 'var(--primary)' },
                  { label: 'Billets', value: reportData.totalTickets, color: '#0369A1' },
                  { label: 'Recettes (FCFA)', value: reportData.totalRevenue.toLocaleString(), color: '#16A34A' },
                  ...(reportData.totalRamassage > 0 ? [{ label: 'Ramassage (FCFA)', value: reportData.totalRamassage.toLocaleString(), color: '#EA580C' }] : []),
                  { label: 'Solde net (FCFA)', value: reportData.totalSolde.toLocaleString(), color: reportData.totalSolde >= 0 ? '#16A34A' : '#DC2626' },
                ].map((k, i) => (
                  <div key={i} className="text-center">
                    <p className="text-2xl font-bold" style={{ color: k.color }}>{k.value}</p>
                    <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{k.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Per-counter breakdown */}
          <div className="space-y-5 mb-8">
            {reportData.counters.map((c) => (
              <div key={c.counter_id ?? 'none'}
                className="rounded-2xl border overflow-hidden shadow-sm"
                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-4 px-6 py-4 border-b"
                  style={{ backgroundColor: 'var(--primary-light)', borderColor: 'var(--border)' }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-lg text-white"
                    style={{ backgroundColor: c.counter_number != null ? 'var(--primary)' : '#9CA3AF' }}>
                    {c.counter_number ?? '?'}
                  </div>
                  <div>
                    <p className="font-bold" style={{ color: 'var(--text-primary)' }}>
                      {c.counter_number != null ? `Guichet ${c.counter_number}` : 'Non assigné'}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {c.routes.slice(0, 3).join(' • ')}{c.routes.length > 3 ? ` +${c.routes.length - 3}` : ''}
                    </p>
                  </div>
                </div>

                <div className="p-6">
                  {/* Counter summary grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4 mb-0">
                    {[
                      { label: 'Départs', value: c.departures, color: 'var(--text-primary)', fmt: (v: number) => v },
                      { label: 'Billets vendus', value: c.tickets, color: '#0369A1', fmt: (v: number) => v },
                      { label: 'Recettes billets', value: c.revenue, color: '#16A34A', fmt: (v: number) => v.toLocaleString() },
                      { label: 'Bagages', value: c.baggage, color: '#7C3AED', fmt: (v: number) => v.toLocaleString() },
                      { label: 'Ramassage', value: c.ramassage, color: '#EA580C', fmt: (v: number) => v.toLocaleString() },
                      { label: 'Charges totales', value: c.charges, color: '#D97706', fmt: (v: number) => v.toLocaleString() },
                      { label: 'Carburant', value: c.carburant, color: '#0891B2', fmt: (v: number) => v.toLocaleString() },
                      { label: 'Solde net', value: c.solde, color: c.solde >= 0 ? '#16A34A' : '#DC2626', fmt: (v: number) => v.toLocaleString() },
                    ].map((col, i) => (
                      <div key={i} className="text-center rounded-xl p-3" style={{ backgroundColor: 'var(--bg-subtle)' }}>
                        <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>{col.label}</p>
                        <p className="text-base font-bold" style={{ color: col.color }}>{col.fmt(col.value)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Grand total row */}
          <div className="rounded-2xl border-2 p-6" style={{ borderColor: 'var(--primary)', backgroundColor: 'var(--primary-light)' }}>
            <p className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--primary)' }}>
              Total de la journée — {reportData.stationName}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
              {[
                { label: 'Total départs', value: reportData.totalDepartures },
                { label: 'Total billets vendus', value: reportData.totalTickets },
                { label: 'Total recettes (FCFA)', value: reportData.totalRevenue.toLocaleString() },
                ...(reportData.totalRamassage > 0 ? [{ label: 'Total ramassage (FCFA)', value: reportData.totalRamassage.toLocaleString() }] : []),
                { label: 'Solde net (FCFA)', value: reportData.totalSolde.toLocaleString() },
              ].map((col, i) => (
                <div key={i}>
                  <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{col.label}</p>
                  <p className="text-2xl font-black" style={{ color: 'var(--primary)' }}>{col.value}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
