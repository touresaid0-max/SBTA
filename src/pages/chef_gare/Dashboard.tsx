import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../store/authStore';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Link } from 'react-router-dom';
import {
  Building2, Users, Clock, Calendar, Monitor, CheckCircle, AlertCircle,
  MapPin, Phone, Mail, Banknote, TicketCheck, TrendingUp, Plus, ArrowRight
} from 'lucide-react';
import toast from 'react-hot-toast';

interface StationInfo {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  city_name?: string;
  display_screen_enabled?: boolean;
  facilities?: Record<string, boolean>;
}

interface CounterRow {
  counter_id: string | null;
  counter_number: number | null;
  departures: number;
  tickets: number;
  seats_remaining: number;
  revenue: number;
  charges: number;
  solde: number;
  has_user: boolean;
  user_name?: string;
}

interface TodaySchedule {
  id: string;
  route_name: string;
  departure_datetime: string;
  status: string;
  seats_reserved: number;
  bus_registration?: string;
  driver_name?: string;
  arrival_station_name?: string;
  counter_number?: number | null;
}

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  planifie:  { label: 'Planifié',  color: '#2563EB', bg: '#DBEAFE' },
  en_cours:  { label: 'En cours', color: '#D97706', bg: '#FEF3C7' },
  termine:   { label: 'Terminé',  color: '#059669', bg: '#D1FAE5' },
  annule:    { label: 'Annulé',   color: '#DC2626', bg: '#FEE2E2' },
  retard:    { label: 'Retard',   color: '#9A3412', bg: '#FFEDD5' },
};

export default function ChefGareDashboard() {
  const { user } = useAuthStore();
  const [station, setStation] = useState<StationInfo | null>(null);
  const [counterRows, setCounterRows] = useState<CounterRow[]>([]);
  const [totalSeatsRemaining, setTotalSeatsRemaining] = useState(0);
  const [todaySchedules, setTodaySchedules] = useState<TodaySchedule[]>([]);
  const [loading, setLoading] = useState(true);

  const today = format(new Date(), 'yyyy-MM-dd');

  useEffect(() => {
    if (user?.id) loadAll();
  }, [user]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const { data: sid } = await supabase.rpc('get_my_station_id');
      if (!sid) return;

      const { data: stationData, error: stationError } = await supabase
        .from('stations')
        .select('*, cities:city_id(name)')
        .eq('id', sid)
        .maybeSingle();

      if (stationError) { toast.error('Erreur chargement gare'); return; }
      if (!stationData) return;

      const stationInfo: StationInfo = {
        ...stationData,
        city_name: (stationData as any).cities?.name || '',
      };
      setStation(stationInfo);

      await Promise.all([
        loadCounterStats(stationInfo.id),
        loadTodaySchedules(stationInfo.id),
      ]);
    } finally {
      setLoading(false);
    }
  };

  const loadCounterStats = async (stationId: string) => {
    const { count: chefCount } = await supabase
      .from('station_managers')
      .select('id', { count: 'exact', head: true })
      .eq('station_id', stationId);
    const restrictManagerId = (chefCount ?? 0) > 1 ? user?.id ?? null : null;

    let countersQuery = supabase
      .from('counters')
      .select('id, counter_number, is_active, assigned_user_id, assigned_user:assigned_user_id(full_name)')
      .eq('station_id', stationId)
      .order('counter_number');
    if (restrictManagerId) countersQuery = countersQuery.eq('manager_id', restrictManagerId);

    const { data: countersData } = await countersQuery;

    let summaryQuery = supabase
      .from('schedule_receipt_summary')
      .select('counter_id, counter_number, bus_id, seats_sold, seats_remaining, total_ticket_amount, total_charges, solde_ticket')
      .eq('station_id', stationId)
      .eq('departure_date', today);
    if (restrictManagerId) {
      const visibleIds = (countersData || []).map((c: any) => c.id);
      if (visibleIds.length === 0) {
        setCounterRows([]);
        setTotalSeatsRemaining(0);
        return;
      }
      summaryQuery = summaryQuery.in('counter_id', visibleIds);
    }
    const { data: summaryRows } = await summaryQuery;

    const counterMap: Record<string, CounterRow> = {};

    (countersData || []).forEach((c: any) => {
      counterMap[c.id] = {
        counter_id: c.id,
        counter_number: c.counter_number,
        departures: 0, tickets: 0, seats_remaining: 0, revenue: 0, charges: 0, solde: 0,
        has_user: !!c.assigned_user_id || !!c.assigned_user,
        user_name: (c.assigned_user as any)?.full_name || undefined,
      };
    });

    const seenBusPerCounter: Record<string, Set<string>> = {};
    const globalSeenBuses = new Map<string, number>();

    (summaryRows || []).forEach((r: any) => {
      const key = r.counter_id;
      if (key && counterMap[key]) {
        counterMap[key].departures += 1;
        counterMap[key].tickets += r.seats_sold || 0;
        counterMap[key].revenue += r.total_ticket_amount || 0;
        counterMap[key].charges += r.total_charges || 0;
        counterMap[key].solde += r.solde_ticket || 0;

        if (!seenBusPerCounter[key]) seenBusPerCounter[key] = new Set();
        const busId = r.bus_id;
        if (busId && !seenBusPerCounter[key].has(busId)) {
          seenBusPerCounter[key].add(busId);
          counterMap[key].seats_remaining += r.seats_remaining || 0;
        }
        if (busId && !globalSeenBuses.has(busId)) {
          globalSeenBuses.set(busId, r.seats_remaining || 0);
        }
      }
    });

    setTotalSeatsRemaining(
      Array.from(globalSeenBuses.values()).reduce((sum, v) => sum + v, 0)
    );

    const sorted = Object.values(counterMap).sort((a, b) => {
      if (a.counter_number == null) return 1;
      if (b.counter_number == null) return -1;
      return a.counter_number - b.counter_number;
    });

    setCounterRows(sorted);
  };

  const loadTodaySchedules = async (stationId: string) => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const tomorrow = new Date(todayStart); tomorrow.setDate(tomorrow.getDate() + 1);

    const { data, error } = await supabase
      .from('schedules')
      .select(`
        id, route_name, departure_datetime, status, seats_reserved,
        bus:bus_id(registration_number),
        driver:driver_id(full_name),
        arrival_station:arrival_station_id(name)
      `)
      .eq('departure_station_id', stationId)
      .gte('departure_datetime', todayStart.toISOString())
      .lt('departure_datetime', tomorrow.toISOString())
      .order('departure_datetime', { ascending: true });

    if (error) { toast.error('Erreur chargement planning'); return; }

    const scheduleIds = (data || []).map((s: any) => s.id);
    let depSeqMap: Record<string, number> = {};
    if (scheduleIds.length > 0) {
      const { data: depSeq } = await supabase
        .from('departure_sequence')
        .select('schedule_id, counter_id, counters:counter_id(counter_number)')
        .in('schedule_id', scheduleIds)
        .eq('departure_date', today);
      (depSeq || []).forEach((d: any) => {
        depSeqMap[d.schedule_id] = (d.counters as any)?.counter_number ?? null;
      });
    }

    setTodaySchedules(
      (data || []).map((s: any) => ({
        id: s.id,
        route_name: s.route_name || '',
        departure_datetime: s.departure_datetime,
        status: s.status || 'planifie',
        seats_reserved: s.seats_reserved ?? 0,
        bus_registration: s.bus?.registration_number,
        driver_name: s.driver?.full_name,
        arrival_station_name: s.arrival_station?.name,
        counter_number: depSeqMap[s.id] ?? null,
      }))
    );
  };

  const activeCounters = counterRows.length;
  const totalDepartures = counterRows.reduce((s, r) => s + r.departures, 0);
  const totalTickets = counterRows.reduce((s, r) => s + r.tickets, 0);
  const totalRevenue = counterRows.reduce((s, r) => s + r.revenue, 0);
  const totalSolde = counterRows.reduce((s, r) => s + r.solde, 0);

  if (loading) return (
    <div className="p-8 flex items-center justify-center min-h-64">
      <div className="w-10 h-10 border-4 rounded-full animate-spin"
        style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
    </div>
  );

  if (!station) return (
    <div className="p-8">
      <div className="max-w-lg mx-auto text-center py-20">
        <Building2 className="w-16 h-16 mx-auto mb-4" style={{ color: '#D1D5DB' }} />
        <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
          Aucune gare assignée
        </h2>
        <p style={{ color: 'var(--text-secondary)' }}>
          Contactez l'administrateur pour être rattaché à votre gare.
        </p>
      </div>
    </div>
  );

  return (
    <div className="p-8 space-y-8">
      {/* Page title */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Tableau de bord
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            {format(new Date(), 'EEEE d MMMM yyyy', { locale: fr })}
          </p>
        </div>
        <Link to="/chef-gare/schedules/new"
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm"
          style={{ backgroundColor: 'var(--primary)' }}>
          <Plus className="w-4 h-4" /> Nouveau voyage
        </Link>
      </div>

      {/* Station header card */}
      <div className="rounded-2xl p-6 border shadow-sm"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-start gap-4 flex-wrap">
          <div className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'var(--primary-light)' }}>
            <Building2 className="w-7 h-7" style={{ color: 'var(--primary)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{station.name}</h2>
                <div className="flex items-center gap-2 mt-1" style={{ color: 'var(--text-secondary)' }}>
                  <MapPin className="w-4 h-4" />
                  <span className="text-sm">{station.city_name}{station.address ? ` — ${station.address}` : ''}</span>
                </div>
                <div className="flex gap-4 mt-2 flex-wrap">
                  {station.phone && (
                    <div className="flex items-center gap-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      <Phone className="w-3.5 h-3.5" />{station.phone}
                    </div>
                  )}
                  {station.email && (
                    <div className="flex items-center gap-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      <Mail className="w-3.5 h-3.5" />{station.email}
                    </div>
                  )}
                </div>
              </div>
              {station.display_screen_enabled && (
                <button onClick={() => window.open(`/display/station/${station.id}`, '_blank')}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border"
                  style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}>
                  <Monitor className="w-4 h-4" /> Écran d'affichage
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Départs aujourd'hui", value: totalDepartures, icon: <Calendar className="w-5 h-5" />, color: 'var(--primary)', bg: 'var(--primary-light)' },
          { label: 'Billets vendus', value: totalTickets, icon: <TicketCheck className="w-5 h-5" />, color: '#0369A1', bg: '#E0F2FE' },
          { label: 'Recettes (FCFA)', value: totalRevenue.toLocaleString(), icon: <Banknote className="w-5 h-5" />, color: '#16A34A', bg: '#DCFCE7' },
          { label: 'Solde net (FCFA)', value: totalSolde.toLocaleString(), icon: <TrendingUp className="w-5 h-5" />, color: totalSolde >= 0 ? '#16A34A' : '#DC2626', bg: totalSolde >= 0 ? '#DCFCE7' : '#FEE2E2' },
        ].map((kpi, i) => (
          <div key={i} className="rounded-2xl p-5 border shadow-sm"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: kpi.bg, color: kpi.color }}>
                {kpi.icon}
              </div>
            </div>
            <p className="text-3xl font-bold" style={{ color: kpi.color }}>{kpi.value}</p>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{kpi.label}</p>
          </div>
        ))}
      </div>

      {/* Consolidated counter table */}
      <div className="rounded-2xl border shadow-sm overflow-hidden"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <Monitor className="w-5 h-5" style={{ color: 'var(--primary)' }} />
            <h3 className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>
              Synthèse par guichet
            </h3>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
              Aujourd'hui
            </span>
          </div>
          <Link to="/chef-gare/sales"
            className="flex items-center gap-1.5 text-sm font-medium"
            style={{ color: 'var(--primary)' }}>
            Voir détails <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {counterRows.length === 0 ? (
          <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
            <Monitor className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p>Aucun guichet configuré pour cette gare</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                  {['Guichet', 'Guichetier', 'Départs', 'Billets vendus', 'Sièges restants', 'Montant tickets', 'Charges', 'Solde'].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                      style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {counterRows.map((row, i) => (
                  <tr key={row.counter_id ?? i}
                    className="border-t transition-colors hover:bg-gray-50"
                    style={{ borderColor: 'var(--border)' }}>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm text-white flex-shrink-0"
                          style={{ backgroundColor: 'var(--primary)' }}>
                          {row.counter_number ?? '?'}
                        </div>
                        <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                          Guichet {row.counter_number ?? '—'}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-4" style={{ color: 'var(--text-secondary)' }}>
                      {row.user_name ? (
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-green-500" />
                          <span>{row.user_name}</span>
                        </div>
                      ) : (
                        <span className="italic" style={{ color: 'var(--text-muted)' }}>Non assigné</span>
                      )}
                    </td>
                    <td className="px-5 py-4 font-semibold text-center" style={{ color: 'var(--text-primary)' }}>
                      {row.departures}
                    </td>
                    <td className="px-5 py-4 font-semibold text-center" style={{ color: '#0369A1' }}>
                      {row.tickets}
                    </td>
                    <td className="px-5 py-4 font-semibold text-center"
                      style={{ color: row.seats_remaining === 0 && row.departures > 0 ? '#DC2626' : '#16A34A' }}>
                      {row.seats_remaining}
                    </td>
                    <td className="px-5 py-4 font-semibold" style={{ color: '#16A34A' }}>
                      {row.revenue.toLocaleString()}
                    </td>
                    <td className="px-5 py-4" style={{ color: '#D97706' }}>
                      {row.charges.toLocaleString()}
                    </td>
                    <td className="px-5 py-4 font-bold"
                      style={{ color: row.solde >= 0 ? '#16A34A' : '#DC2626' }}>
                      {row.solde.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2" style={{ borderColor: 'var(--primary)', backgroundColor: 'var(--primary-light)' }}>
                  <td colSpan={2} className="px-5 py-3 font-bold text-sm" style={{ color: 'var(--primary)' }}>
                    TOTAL
                  </td>
                  <td className="px-5 py-3 font-bold text-center" style={{ color: 'var(--primary)' }}>{totalDepartures}</td>
                  <td className="px-5 py-3 font-bold text-center" style={{ color: 'var(--primary)' }}>{totalTickets}</td>
                  <td className="px-5 py-3 font-bold text-center" style={{ color: 'var(--primary)' }}>
                    {totalSeatsRemaining}
                  </td>
                  <td className="px-5 py-3 font-bold" style={{ color: 'var(--primary)' }}>{totalRevenue.toLocaleString()}</td>
                  <td className="px-5 py-3 font-bold" style={{ color: 'var(--primary)' }}>
                    {counterRows.reduce((s, r) => s + r.charges, 0).toLocaleString()}
                  </td>
                  <td className="px-5 py-3 font-bold"
                    style={{ color: totalSolde >= 0 ? '#16A34A' : '#DC2626' }}>
                    {totalSolde.toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Today's schedule list */}
      <div className="rounded-2xl border shadow-sm"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="px-6 py-4 border-b flex items-center justify-between"
          style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5" style={{ color: 'var(--primary)' }} />
            <h3 className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>Planning du jour</h3>
          </div>
          <Link to="/chef-gare/planning"
            className="flex items-center gap-1.5 text-sm font-medium"
            style={{ color: 'var(--primary)' }}>
            Gérer <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        <div className="divide-y" style={{ divideColor: 'var(--border)' }}>
          {todaySchedules.length === 0 ? (
            <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
              <Calendar className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p>Aucun départ prévu aujourd'hui</p>
            </div>
          ) : (
            todaySchedules.slice(0, 8).map((sched) => {
              const cfg = STATUS_LABELS[sched.status] || STATUS_LABELS.planifie;
              return (
                <div key={sched.id} className="px-6 py-4 flex items-center gap-4">
                  <div className="text-center w-16 flex-shrink-0">
                    <p className="text-xl font-black tabular-nums" style={{ color: 'var(--text-primary)' }}>
                      {format(new Date(sched.departure_datetime), 'HH:mm')}
                    </p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                      {sched.arrival_station_name ? `→ ${sched.arrival_station_name}` : sched.route_name || '—'}
                    </p>
                    <div className="flex items-center gap-3 mt-0.5 text-xs flex-wrap"
                      style={{ color: 'var(--text-secondary)' }}>
                      {sched.bus_registration && <span>Bus {sched.bus_registration}</span>}
                      {sched.driver_name && <span>{sched.driver_name}</span>}
                      {sched.counter_number != null && (
                        <span className="flex items-center gap-1">
                          <Monitor className="w-3 h-3" /> Guichet {sched.counter_number}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="px-2.5 py-1 rounded-full text-xs font-semibold flex-shrink-0"
                    style={{ backgroundColor: cfg.bg, color: cfg.color }}>
                    {cfg.label}
                  </div>
                </div>
              );
            })
          )}
          {todaySchedules.length > 8 && (
            <div className="px-6 py-3 text-center">
              <Link to="/chef-gare/planning" className="text-sm font-medium" style={{ color: 'var(--primary)' }}>
                Voir tous les {todaySchedules.length} départs
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
