import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../store/authStore';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Link } from 'react-router-dom';
import {
  Building2, Users, Clock, Calendar, Monitor, CheckCircle, AlertCircle,
  MapPin, Phone, Mail, Banknote, TicketCheck, TrendingUp, Plus, ArrowRight,
  AlertTriangle, Fuel, Receipt, ShieldAlert, RefreshCw
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useStationCounterStats } from '../../hooks/useStationCounterStats';
import StationCounterResultsTable from '../../components/shared/StationCounterResultsTable';

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

interface CompletionAlert {
  schedule_id: string;
  route_name: string;
  departure_datetime: string;
  bus_registration: string;
  driver_name: string;
  status: string;
  has_charges: boolean;
  has_tickets: boolean;
  has_fuel: boolean;
  has_expenses: boolean;
  missing: string[];
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
  const [todaySchedules, setTodaySchedules] = useState<TodaySchedule[]>([]);
  const [completionAlerts, setCompletionAlerts] = useState<CompletionAlert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [loading, setLoading] = useState(true);

  const today = format(new Date(), 'yyyy-MM-dd');
  const counterStats = useStationCounterStats(today);

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
        loadTodaySchedules(stationInfo.id),
        loadCompletionAlerts(stationInfo.id),
      ]);
    } finally {
      setLoading(false);
    }
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

  const loadCompletionAlerts = async (stationId: string) => {
    setAlertsLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_schedule_completion_alerts', {
        p_station_id: stationId,
        p_target_date: today
      });
      if (error) throw error;
      setCompletionAlerts(data || []);
    } catch (err: any) {
      console.error('Erreur chargement alertes:', err);
    } finally {
      setAlertsLoading(false);
    }
  };

  const refreshAlerts = () => {
    if (station) loadCompletionAlerts(station.id);
  };

  const { totals: ctTotals } = counterStats;
  const totalDepartures = ctTotals.departures;
  const totalTickets = ctTotals.tickets;
  const totalRevenue = ctTotals.ticket_amount;
  const totalSolde = ctTotals.solde;

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

      {/* Consolidated counter table — real-time */}
      <div className="space-y-2">
        <div className="flex justify-end">
          <Link to="/chef-gare/sales"
            className="flex items-center gap-1.5 text-sm font-medium"
            style={{ color: 'var(--primary)' }}>
            Voir détails <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
        <StationCounterResultsTable stats={counterStats} />
      </div>

      {/* Completion Alerts */}
      {completionAlerts.length > 0 && (
        <div className="rounded-2xl border border-[#FBBF24] bg-[#FFFBEB] shadow-sm mb-6">
          <div className="px-6 py-4 border-b border-[#FDE68A] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-[#D97706]" />
              <h3 className="font-bold text-lg text-[#92400E]">
                Alertes de complétude ({completionAlerts.length})
              </h3>
            </div>
            <button
              onClick={refreshAlerts}
              disabled={alertsLoading}
              className="flex items-center gap-1.5 text-sm font-medium text-[#D97706] hover:text-[#B45309] transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${alertsLoading ? 'animate-spin' : ''}`} />
              Actualiser
            </button>
          </div>

          <div className="divide-y divide-[#FDE68A]">
            {completionAlerts.map((alert) => (
              <div key={alert.schedule_id} className="px-6 py-4">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[#FEF3C7] flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-[#D97706]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-[#1E293B] text-sm">
                        {format(new Date(alert.departure_datetime), 'HH:mm')}
                      </span>
                      <span className="text-sm text-[#374151] font-medium truncate">
                        {alert.route_name}
                      </span>
                      {alert.bus_registration && (
                        <span className="text-xs bg-white border border-[#E2E8F0] rounded px-1.5 py-0.5 text-[#64748B]">
                          {alert.bus_registration}
                        </span>
                      )}
                    </div>
                    {alert.driver_name && (
                      <p className="text-xs text-[#64748B] mt-0.5">{alert.driver_name}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {alert.missing?.map((item) => (
                        <span key={item} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[#FEE2E2] text-[#DC2626] border border-[#FECACA]">
                          {item === 'Charges' && <Receipt className="w-3 h-3" />}
                          {item === 'Billets' && <TicketCheck className="w-3 h-3" />}
                          {item === 'Carburant' && <Fuel className="w-3 h-3" />}
                          {item === 'Dépenses' && <Banknote className="w-3 h-3" />}
                          {item}
                        </span>
                      ))}
                      {/* Show completed items */}
                      {alert.has_charges && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[#D1FAE5] text-[#065F46] border border-[#A7F3D0]">
                          <CheckCircle className="w-3 h-3" /> Charges
                        </span>
                      )}
                      {alert.has_tickets && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[#D1FAE5] text-[#065F46] border border-[#A7F3D0]">
                          <CheckCircle className="w-3 h-3" /> Billets
                        </span>
                      )}
                      {alert.has_fuel && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[#D1FAE5] text-[#065F46] border border-[#A7F3D0]">
                          <CheckCircle className="w-3 h-3" /> Carburant
                        </span>
                      )}
                      {alert.has_expenses && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[#D1FAE5] text-[#065F46] border border-[#A7F3D0]">
                          <CheckCircle className="w-3 h-3" /> Dépenses
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
