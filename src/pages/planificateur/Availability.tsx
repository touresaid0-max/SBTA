import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../services/supabase';
import { createRefreshScheduler } from '../../utils/realtimeRefresh';
import toast from 'react-hot-toast';
import {
  Bus, Users, RefreshCw, Clock, Search,
  CheckCircle, XCircle, Wrench,
  ChevronDown, ChevronUp, MapPin, ArrowRight
} from 'lucide-react';
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  MAX_DAILY_HOURS,
  MAX_WEEKLY_HOURS,
  formatHours,
  getHoursProgressColor,
} from '../../utils/driverHoursCalc';

interface BusAvailability {
  id: string;
  registration_number: string;
  model: string | null;
  brand: string | null;
  status: string;
  total_seats: number;
  company_name: string | null;
  todayTrips: TripInfo[];
  nextTrip: TripInfo | null;
  isOnTrip: boolean;
}

interface TripInfo {
  id: string;
  route_name: string;
  departure_datetime: string;
  arrival_datetime: string;
  status: string;
  seats_reserved: number;
  seats_available: number;
  driver_name: string | null;
  departure_station: string | null;
}

interface DriverAvailability {
  id: string;
  full_name: string;
  company_name: string | null;
  status: string;
  todayHours: number;
  weekHours: number;
  todayRemaining: number;
  weekRemaining: number;
  todayTrips: TripInfo[];
  nextTrip: TripInfo | null;
  isOnTrip: boolean;
}

const BUS_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  disponible:       { label: 'Disponible',      color: '#16A34A', bg: '#F0FDF4', icon: <CheckCircle className="w-4 h-4" /> },
  en_service:       { label: 'En service',      color: '#2563EB', bg: '#EFF6FF', icon: <Bus className="w-4 h-4" /> },
  maintenance:      { label: 'Maintenance',     color: '#D97706', bg: '#FFFBEB', icon: <Wrench className="w-4 h-4" /> },
  panne_route:      { label: 'Panne route',     color: '#DC2626', bg: '#FEF2F2', icon: <XCircle className="w-4 h-4" /> },
  reception_garage: { label: 'Au garage',       color: '#D97706', bg: '#FFFBEB', icon: <Wrench className="w-4 h-4" /> },
  diagnostic:       { label: 'Diagnostic',      color: '#D97706', bg: '#FFFBEB', icon: <Wrench className="w-4 h-4" /> },
  attente_ot:       { label: 'Attente OT',      color: '#D97706', bg: '#FFFBEB', icon: <Clock className="w-4 h-4" /> },
  controle_qualite: { label: 'Controle qualite', color: '#D97706', bg: '#FFFBEB', icon: <Wrench className="w-4 h-4" /> },
  hors_service:     { label: 'Hors service',    color: '#DC2626', bg: '#FEF2F2', icon: <XCircle className="w-4 h-4" /> },
};

type Tab = 'buses' | 'drivers';
type BusFilter = 'all' | 'disponible' | 'en_service' | 'maintenance' | 'panne';
type DriverFilter = 'all' | 'available' | 'alert' | 'rest';

export default function Availability() {
  const [tab, setTab] = useState<Tab>('buses');
  const [loading, setLoading] = useState(true);
  const [buses, setBuses] = useState<BusAvailability[]>([]);
  const [drivers, setDrivers] = useState<DriverAvailability[]>([]);
  const [busFilter, setBusFilter] = useState<BusFilter>('all');
  const [driverFilter, setDriverFilter] = useState<DriverFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [expandedBus, setExpandedBus] = useState<string | null>(null);
  const [expandedDriver, setExpandedDriver] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadBuses(), loadDrivers()]);
    } catch (err: any) {
      toast.error('Erreur de chargement des disponibilites');
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const refresh = createRefreshScheduler(() => loadData());
    const channel = supabase
      .channel('planificateur-availability')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules' }, refresh.schedule)
      .subscribe();
    return () => {
      refresh.cancel();
      channel.unsubscribe();
    };
  }, [selectedDate]);

  const loadBuses = async () => {
    const targetDate = new Date(selectedDate + 'T00:00:00');
    const dayStart = startOfDay(targetDate);
    const dayEnd = endOfDay(targetDate);
    const now = new Date();

    const { data: busesData, error: busError } = await supabase
      .from('buses')
      .select('id, registration_number, model, brand, status, total_seats, capacity, company:company_id(name)')
      .eq('is_active', true)
      .order('registration_number');

    if (busError) throw busError;

    const result: BusAvailability[] = await Promise.all(
      (busesData || []).map(async (bus: any) => {
        const { data: todaySchedules } = await supabase
          .from('schedules')
          .select(`
            id, route_name, departure_datetime, arrival_datetime, status,
            seats_reserved, seats_available,
            driver:driver_id(full_name),
            departure_station:departure_station_id(name)
          `)
          .eq('bus_id', bus.id)
          .gte('departure_datetime', dayStart.toISOString())
          .lte('departure_datetime', dayEnd.toISOString())
          .order('departure_datetime', { ascending: true });

        const trips: TripInfo[] = (todaySchedules || []).map((s: any) => ({
          id: s.id,
          route_name: s.route_name || '',
          departure_datetime: s.departure_datetime,
          arrival_datetime: s.arrival_datetime,
          status: s.status,
          seats_reserved: s.seats_reserved || 0,
          seats_available: s.seats_available || 0,
          driver_name: s.driver?.full_name || null,
          departure_station: s.departure_station?.name || null,
        }));

        const uniqueTrips = trips.filter((t, i, arr) =>
          arr.findIndex(x => x.departure_datetime === t.departure_datetime) === i
        );

        const isOnTrip = uniqueTrips.some(
          t => new Date(t.departure_datetime) <= now && new Date(t.arrival_datetime) >= now && t.status === 'en_cours'
        );

        const { data: nextSchedule } = await supabase
          .from('schedules')
          .select(`
            id, route_name, departure_datetime, arrival_datetime, status,
            seats_reserved, seats_available,
            driver:driver_id(full_name),
            departure_station:departure_station_id(name)
          `)
          .eq('bus_id', bus.id)
          .gt('departure_datetime', now.toISOString())
          .order('departure_datetime', { ascending: true })
          .limit(1)
          .maybeSingle();

        const nextTrip: TripInfo | null = nextSchedule ? {
          id: nextSchedule.id,
          route_name: nextSchedule.route_name || '',
          departure_datetime: nextSchedule.departure_datetime,
          arrival_datetime: nextSchedule.arrival_datetime,
          status: nextSchedule.status,
          seats_reserved: (nextSchedule as any).seats_reserved || 0,
          seats_available: (nextSchedule as any).seats_available || 0,
          driver_name: (nextSchedule as any).driver?.full_name || null,
          departure_station: (nextSchedule as any).departure_station?.name || null,
        } : null;

        return {
          id: bus.id,
          registration_number: bus.registration_number,
          model: bus.model,
          brand: bus.brand,
          status: bus.status,
          total_seats: bus.capacity || bus.total_seats || 0,
          company_name: bus.company?.name || null,
          todayTrips: uniqueTrips,
          nextTrip,
          isOnTrip,
        };
      })
    );

    setBuses(result);
  };

  const loadDrivers = async () => {
    const targetDate = new Date(selectedDate + 'T00:00:00');
    const dayStart = startOfDay(targetDate);
    const dayEnd = endOfDay(targetDate);
    const wkStart = startOfWeek(targetDate, { weekStartsOn: 1 });
    const wkEnd = endOfWeek(targetDate, { weekStartsOn: 1 });
    const now = new Date();

    const { data: driversData, error: driverError } = await supabase
      .from('users')
      .select('id, full_name, status, company:company_id(name)')
      .eq('role', 'chauffeur')
      .eq('is_active', true)
      .order('full_name');

    if (driverError) throw driverError;

    const result: DriverAvailability[] = await Promise.all(
      (driversData || []).map(async (driver: any) => {
        const [{ data: daySchedules }, { data: weekSchedules }] = await Promise.all([
          supabase
            .from('schedules')
            .select(`
              id, route_name, departure_datetime, arrival_datetime, status,
              seats_reserved, seats_available,
              buses:bus_id(registration_number),
              departure_station:departure_station_id(name)
            `)
            .or(`driver_id.eq.${driver.id},copilot_id.eq.${driver.id}`)
            .gte('departure_datetime', dayStart.toISOString())
            .lte('departure_datetime', dayEnd.toISOString())
            .order('departure_datetime', { ascending: true }),
          supabase
            .from('schedules')
            .select('departure_datetime, arrival_datetime')
            .or(`driver_id.eq.${driver.id},copilot_id.eq.${driver.id}`)
            .gte('departure_datetime', wkStart.toISOString())
            .lte('departure_datetime', wkEnd.toISOString()),
        ]);

        const calcHours = (schedules: any[]) =>
          schedules.reduce((sum, s) => {
            const diff = (new Date(s.arrival_datetime).getTime() - new Date(s.departure_datetime).getTime()) / 3600000;
            return sum + Math.max(0, diff);
          }, 0);

        const todayHours = calcHours(daySchedules || []);
        const weekHours = calcHours(weekSchedules || []);

        const trips: TripInfo[] = (daySchedules || []).map((s: any) => ({
          id: s.id,
          route_name: s.route_name || '',
          departure_datetime: s.departure_datetime,
          arrival_datetime: s.arrival_datetime,
          status: s.status,
          seats_reserved: s.seats_reserved || 0,
          seats_available: s.seats_available || 0,
          driver_name: (s.buses as any)?.registration_number || null,
          departure_station: s.departure_station?.name || null,
        }));

        const uniqueTrips = trips.filter((t, i, arr) =>
          arr.findIndex(x => x.departure_datetime === t.departure_datetime) === i
        );

        const isOnTrip = uniqueTrips.some(
          t => new Date(t.departure_datetime) <= now && new Date(t.arrival_datetime) >= now && t.status === 'en_cours'
        );

        const { data: nextSch } = await supabase
          .from('schedules')
          .select(`
            id, route_name, departure_datetime, arrival_datetime, status,
            seats_reserved, seats_available,
            buses:bus_id(registration_number),
            departure_station:departure_station_id(name)
          `)
          .or(`driver_id.eq.${driver.id},copilot_id.eq.${driver.id}`)
          .gt('departure_datetime', now.toISOString())
          .order('departure_datetime', { ascending: true })
          .limit(1)
          .maybeSingle();

        const nextTrip: TripInfo | null = nextSch ? {
          id: nextSch.id,
          route_name: nextSch.route_name || '',
          departure_datetime: nextSch.departure_datetime,
          arrival_datetime: nextSch.arrival_datetime,
          status: nextSch.status,
          seats_reserved: (nextSch as any).seats_reserved || 0,
          seats_available: (nextSch as any).seats_available || 0,
          driver_name: (nextSch as any).buses?.registration_number || null,
          departure_station: (nextSch as any).departure_station?.name || null,
        } : null;

        return {
          id: driver.id,
          full_name: driver.full_name,
          company_name: driver.company?.name || null,
          status: driver.status,
          todayHours,
          weekHours,
          todayRemaining: Math.max(0, MAX_DAILY_HOURS - todayHours),
          weekRemaining: Math.max(0, MAX_WEEKLY_HOURS - weekHours),
          todayTrips: uniqueTrips,
          nextTrip,
          isOnTrip,
        };
      })
    );

    setDrivers(result);
  };

  const filteredBuses = buses.filter(b => {
    if (busFilter === 'disponible' && b.status !== 'disponible') return false;
    if (busFilter === 'en_service' && !b.isOnTrip && b.status !== 'en_service') return false;
    if (busFilter === 'maintenance' && !['maintenance', 'reception_garage', 'diagnostic', 'attente_ot', 'controle_qualite'].includes(b.status)) return false;
    if (busFilter === 'panne' && !['panne_route', 'hors_service'].includes(b.status)) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return b.registration_number.toLowerCase().includes(q) ||
        (b.brand || '').toLowerCase().includes(q) ||
        (b.model || '').toLowerCase().includes(q) ||
        (b.company_name || '').toLowerCase().includes(q);
    }
    return true;
  });

  const filteredDrivers = drivers.filter(d => {
    if (driverFilter === 'available' && (d.todayRemaining <= 0 || d.status === 'repos_obligatoire')) return false;
    if (driverFilter === 'alert' && !(d.todayRemaining > 0 && d.todayRemaining < MAX_DAILY_HOURS * 0.2)) return false;
    if (driverFilter === 'rest' && d.todayRemaining > 0 && d.status !== 'repos_obligatoire') return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return d.full_name.toLowerCase().includes(q) ||
        (d.company_name || '').toLowerCase().includes(q);
    }
    return true;
  });

  const busStats = {
    total: buses.length,
    disponible: buses.filter(b => b.status === 'disponible' && !b.isOnTrip).length,
    enService: buses.filter(b => b.isOnTrip || b.status === 'en_service').length,
    maintenance: buses.filter(b => ['maintenance', 'reception_garage', 'diagnostic', 'attente_ot', 'controle_qualite'].includes(b.status)).length,
    panne: buses.filter(b => ['panne_route', 'hors_service'].includes(b.status)).length,
  };

  const driverStats = {
    total: drivers.length,
    available: drivers.filter(d => d.todayRemaining > MAX_DAILY_HOURS * 0.2 && d.status !== 'repos_obligatoire').length,
    alert: drivers.filter(d => d.todayRemaining > 0 && d.todayRemaining <= MAX_DAILY_HOURS * 0.2 && d.status !== 'repos_obligatoire').length,
    rest: drivers.filter(d => d.todayRemaining <= 0 || d.status === 'repos_obligatoire').length,
    onTrip: drivers.filter(d => d.isOnTrip).length,
  };

  const getDriverStatusInfo = (d: DriverAvailability) => {
    if (d.status === 'repos_obligatoire' || d.todayRemaining <= 0 || d.weekRemaining <= 0) {
      return { label: 'Repos', color: '#DC2626', bg: '#FEF2F2' };
    }
    if (d.isOnTrip) {
      return { label: 'En route', color: '#2563EB', bg: '#EFF6FF' };
    }
    if (d.todayRemaining < MAX_DAILY_HOURS * 0.2 || d.weekRemaining < MAX_WEEKLY_HOURS * 0.2) {
      return { label: 'Alerte', color: '#D97706', bg: '#FFFBEB' };
    }
    return { label: 'Disponible', color: '#16A34A', bg: '#F0FDF4' };
  };

  const renderTripBadge = (trip: TripInfo) => {
    const statusMap: Record<string, { label: string; color: string; bg: string }> = {
      planifie:  { label: 'Planifie', color: '#2563EB', bg: '#EFF6FF' },
      en_cours:  { label: 'En cours', color: '#D97706', bg: '#FFFBEB' },
      termine:   { label: 'Termine', color: '#16A34A', bg: '#F0FDF4' },
      annule:    { label: 'Annule', color: '#DC2626', bg: '#FEF2F2' },
    };
    const cfg = statusMap[trip.status] || { label: trip.status, color: '#6B7280', bg: '#F9FAFB' };
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ color: cfg.color, backgroundColor: cfg.bg }}>
        {cfg.label}
      </span>
    );
  };

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Disponibilites
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Etat en temps reel des bus et chauffeurs
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="px-3 py-2 rounded-lg border text-sm font-medium"
            style={{ borderColor: 'var(--border)' }}
          />
          <button
            onClick={loadData}
            disabled={loading}
            className="p-2.5 rounded-lg border transition-colors hover:bg-gray-50"
            style={{ borderColor: 'var(--border)' }}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl mb-6" style={{ backgroundColor: 'var(--neutral-100, #F3F4F6)' }}>
        {[
          { id: 'buses' as Tab, label: 'Bus', icon: <Bus className="w-4 h-4" />, count: buses.length },
          { id: 'drivers' as Tab, label: 'Chauffeurs', icon: <Users className="w-4 h-4" />, count: drivers.length },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setSearchQuery(''); }}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all"
            style={{
              backgroundColor: tab === t.id ? 'white' : 'transparent',
              color: tab === t.id ? 'var(--primary)' : 'var(--text-secondary)',
              boxShadow: tab === t.id ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            {t.icon} {t.label}
            <span className="ml-1 px-2 py-0.5 rounded-full text-xs"
              style={{ backgroundColor: tab === t.id ? 'var(--primary-light, #E8F5E9)' : 'var(--neutral-200, #E5E7EB)', color: tab === t.id ? 'var(--primary)' : 'var(--text-secondary)' }}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-16">
          <div className="w-12 h-12 border-4 rounded-full animate-spin mx-auto mb-4"
               style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Chargement des disponibilites...</p>
        </div>
      ) : (
        <>
          {/* Bus Tab */}
          {tab === 'buses' && (
            <div className="space-y-6">
              {/* Stats */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  { label: 'Total', value: busStats.total, color: '#374151', bg: '#F9FAFB', filter: 'all' as BusFilter },
                  { label: 'Disponibles', value: busStats.disponible, color: '#16A34A', bg: '#F0FDF4', filter: 'disponible' as BusFilter },
                  { label: 'En service', value: busStats.enService, color: '#2563EB', bg: '#EFF6FF', filter: 'en_service' as BusFilter },
                  { label: 'Maintenance', value: busStats.maintenance, color: '#D97706', bg: '#FFFBEB', filter: 'maintenance' as BusFilter },
                  { label: 'Panne/HS', value: busStats.panne, color: '#DC2626', bg: '#FEF2F2', filter: 'panne' as BusFilter },
                ].map(s => (
                  <button
                    key={s.label}
                    onClick={() => setBusFilter(s.filter)}
                    className="rounded-xl p-4 text-left border-2 transition-all"
                    style={{
                      backgroundColor: s.bg,
                      borderColor: busFilter === s.filter ? s.color : 'transparent',
                    }}
                  >
                    <p className="text-xs font-medium mb-1" style={{ color: s.color }}>{s.label}</p>
                    <p className="text-2xl font-black" style={{ color: s.color }}>{s.value}</p>
                  </button>
                ))}
              </div>

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Rechercher un bus (immatriculation, marque, modele, societe)..."
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg border text-sm"
                  style={{ borderColor: 'var(--border)' }}
                />
              </div>

              {/* Bus Cards */}
              <div className="space-y-3">
                {filteredBuses.length === 0 ? (
                  <div className="text-center py-12 rounded-xl border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface, white)' }}>
                    <Bus className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--neutral-300)' }} />
                    <p className="font-medium" style={{ color: 'var(--text-secondary)' }}>Aucun bus ne correspond aux criteres</p>
                  </div>
                ) : (
                  filteredBuses.map(bus => {
                    const cfg = BUS_STATUS_CONFIG[bus.status] || { label: bus.status, color: '#6B7280', bg: '#F9FAFB', icon: <Bus className="w-4 h-4" /> };
                    const isExpanded = expandedBus === bus.id;

                    return (
                      <div
                        key={bus.id}
                        className="rounded-xl border overflow-hidden transition-shadow hover:shadow-md"
                        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface, white)' }}
                      >
                        <button
                          onClick={() => setExpandedBus(isExpanded ? null : bus.id)}
                          className="w-full p-4 flex items-center gap-4 text-left"
                        >
                          <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                               style={{ backgroundColor: cfg.bg, color: cfg.color }}>
                            {cfg.icon}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                                {bus.registration_number}
                              </span>
                              {bus.company_name && (
                                <span className="text-xs px-2 py-0.5 rounded-full"
                                  style={{ backgroundColor: 'var(--neutral-100, #F3F4F6)', color: 'var(--text-secondary)' }}>
                                  {bus.company_name}
                                </span>
                              )}
                            </div>
                            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                              {[bus.brand, bus.model].filter(Boolean).join(' ')} — {bus.total_seats} places
                            </p>
                          </div>

                          <div className="flex items-center gap-3 flex-shrink-0">
                            {bus.isOnTrip && (
                              <span className="px-2.5 py-1 rounded-full text-xs font-semibold" style={{ color: '#2563EB', backgroundColor: '#EFF6FF' }}>
                                En route
                              </span>
                            )}
                            <span className="px-2.5 py-1 rounded-full text-xs font-semibold"
                              style={{ color: cfg.color, backgroundColor: cfg.bg }}>
                              {cfg.label}
                            </span>
                            {bus.todayTrips.length > 0 && (
                              <span className="text-xs font-semibold px-2 py-1 rounded-full"
                                style={{ backgroundColor: 'var(--primary-light, #E8F5E9)', color: 'var(--primary)' }}>
                                {bus.todayTrips.length} voyage{bus.todayTrips.length > 1 ? 's' : ''}
                              </span>
                            )}
                            {isExpanded ? <ChevronUp className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} /> :
                              <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />}
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="px-4 pb-4 border-t" style={{ borderColor: 'var(--border)' }}>
                            {bus.todayTrips.length > 0 ? (
                              <div className="mt-3 space-y-2">
                                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>
                                  Voyages du {format(new Date(selectedDate + 'T00:00:00'), 'dd MMMM yyyy', { locale: fr })}
                                </p>
                                {bus.todayTrips.map(trip => (
                                  <div key={trip.id} className="p-3 rounded-lg" style={{ backgroundColor: 'var(--neutral-50, #F9FAFB)' }}>
                                    <div className="flex items-center justify-between mb-1.5">
                                      <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                                        {trip.route_name}
                                      </span>
                                      {renderTripBadge(trip)}
                                    </div>
                                    <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
                                      <span className="flex items-center gap-1">
                                        <Clock className="w-3 h-3" />
                                        {format(new Date(trip.departure_datetime), 'HH:mm')}
                                        <ArrowRight className="w-3 h-3" />
                                        {format(new Date(trip.arrival_datetime), 'HH:mm')}
                                      </span>
                                      {trip.departure_station && (
                                        <span className="flex items-center gap-1">
                                          <MapPin className="w-3 h-3" /> {trip.departure_station}
                                        </span>
                                      )}
                                      {trip.driver_name && (
                                        <span className="flex items-center gap-1">
                                          <Users className="w-3 h-3" /> {trip.driver_name}
                                        </span>
                                      )}
                                      <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                                        {trip.seats_reserved}/{trip.seats_reserved + trip.seats_available} places
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm py-4 text-center" style={{ color: 'var(--text-secondary)' }}>
                                Aucun voyage programme ce jour
                              </p>
                            )}
                            {bus.nextTrip && (
                              <div className="mt-3 p-3 rounded-lg border" style={{ borderColor: 'var(--primary)', borderStyle: 'dashed', backgroundColor: 'var(--primary-light, #E8F5E9)' }}>
                                <p className="text-xs font-semibold mb-1" style={{ color: 'var(--primary)' }}>Prochain voyage</p>
                                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                  {bus.nextTrip.route_name} — {format(new Date(bus.nextTrip.departure_datetime), 'dd/MM a HH:mm', { locale: fr })}
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Drivers Tab */}
          {tab === 'drivers' && (
            <div className="space-y-6">
              {/* Stats */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  { label: 'Total', value: driverStats.total, color: '#374151', bg: '#F9FAFB', filter: 'all' as DriverFilter },
                  { label: 'Disponibles', value: driverStats.available, color: '#16A34A', bg: '#F0FDF4', filter: 'available' as DriverFilter },
                  { label: 'Alerte heures', value: driverStats.alert, color: '#D97706', bg: '#FFFBEB', filter: 'alert' as DriverFilter },
                  { label: 'Repos oblig.', value: driverStats.rest, color: '#DC2626', bg: '#FEF2F2', filter: 'rest' as DriverFilter },
                  { label: 'En route', value: driverStats.onTrip, color: '#2563EB', bg: '#EFF6FF', filter: 'all' as DriverFilter },
                ].map(s => (
                  <button
                    key={s.label}
                    onClick={() => setDriverFilter(s.filter)}
                    className="rounded-xl p-4 text-left border-2 transition-all"
                    style={{
                      backgroundColor: s.bg,
                      borderColor: driverFilter === s.filter ? s.color : 'transparent',
                    }}
                  >
                    <p className="text-xs font-medium mb-1" style={{ color: s.color }}>{s.label}</p>
                    <p className="text-2xl font-black" style={{ color: s.color }}>{s.value}</p>
                  </button>
                ))}
              </div>

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Rechercher un chauffeur (nom, societe)..."
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg border text-sm"
                  style={{ borderColor: 'var(--border)' }}
                />
              </div>

              {/* Driver Cards */}
              <div className="space-y-3">
                {filteredDrivers.length === 0 ? (
                  <div className="text-center py-12 rounded-xl border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface, white)' }}>
                    <Users className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--neutral-300)' }} />
                    <p className="font-medium" style={{ color: 'var(--text-secondary)' }}>Aucun chauffeur ne correspond aux criteres</p>
                  </div>
                ) : (
                  filteredDrivers.map(driver => {
                    const statusInfo = getDriverStatusInfo(driver);
                    const isExpanded = expandedDriver === driver.id;
                    const dailyPct = Math.min(100, (driver.todayHours / MAX_DAILY_HOURS) * 100);
                    const weekPct = Math.min(100, (driver.weekHours / MAX_WEEKLY_HOURS) * 100);

                    return (
                      <div
                        key={driver.id}
                        className="rounded-xl border overflow-hidden transition-shadow hover:shadow-md"
                        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface, white)' }}
                      >
                        <button
                          onClick={() => setExpandedDriver(isExpanded ? null : driver.id)}
                          className="w-full p-4 text-left"
                        >
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                                 style={{ backgroundColor: statusInfo.bg, color: statusInfo.color }}>
                              <Users className="w-5 h-5" />
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                                  {driver.full_name}
                                </span>
                                {driver.company_name && (
                                  <span className="text-xs px-2 py-0.5 rounded-full"
                                    style={{ backgroundColor: 'var(--neutral-100, #F3F4F6)', color: 'var(--text-secondary)' }}>
                                    {driver.company_name}
                                  </span>
                                )}
                              </div>

                              {/* Hours bars */}
                              <div className="flex items-center gap-6 mt-2">
                                <div className="flex items-center gap-2 flex-1">
                                  <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)', minWidth: '40px' }}>Jour</span>
                                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--neutral-200, #E5E7EB)', maxWidth: '120px' }}>
                                    <div className="h-full rounded-full transition-all"
                                      style={{ width: `${dailyPct}%`, backgroundColor: getHoursProgressColor(driver.todayHours, MAX_DAILY_HOURS) }} />
                                  </div>
                                  <span className="text-xs font-semibold whitespace-nowrap" style={{ minWidth: '55px' }}>
                                    {formatHours(driver.todayHours)}/{MAX_DAILY_HOURS}h
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 flex-1">
                                  <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)', minWidth: '56px' }}>Semaine</span>
                                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--neutral-200, #E5E7EB)', maxWidth: '120px' }}>
                                    <div className="h-full rounded-full transition-all"
                                      style={{ width: `${weekPct}%`, backgroundColor: getHoursProgressColor(driver.weekHours, MAX_WEEKLY_HOURS) }} />
                                  </div>
                                  <span className="text-xs font-semibold whitespace-nowrap" style={{ minWidth: '55px' }}>
                                    {formatHours(driver.weekHours)}/{MAX_WEEKLY_HOURS}h
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 flex-shrink-0">
                              {driver.isOnTrip && (
                                <span className="px-2.5 py-1 rounded-full text-xs font-semibold" style={{ color: '#2563EB', backgroundColor: '#EFF6FF' }}>
                                  En route
                                </span>
                              )}
                              <span className="px-2.5 py-1 rounded-full text-xs font-semibold"
                                style={{ color: statusInfo.color, backgroundColor: statusInfo.bg }}>
                                {statusInfo.label}
                              </span>
                              {driver.todayTrips.length > 0 && (
                                <span className="text-xs font-semibold px-2 py-1 rounded-full"
                                  style={{ backgroundColor: 'var(--primary-light, #E8F5E9)', color: 'var(--primary)' }}>
                                  {driver.todayTrips.length} voyage{driver.todayTrips.length > 1 ? 's' : ''}
                                </span>
                              )}
                              {isExpanded ? <ChevronUp className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} /> :
                                <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />}
                            </div>
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="px-4 pb-4 border-t" style={{ borderColor: 'var(--border)' }}>
                            {/* Hours detail */}
                            <div className="grid grid-cols-2 gap-3 mt-3">
                              <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--neutral-50, #F9FAFB)' }}>
                                <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Heures restantes aujourd'hui</p>
                                <p className="text-xl font-black" style={{ color: driver.todayRemaining < 2 ? '#DC2626' : '#16A34A' }}>
                                  {formatHours(driver.todayRemaining)}
                                </p>
                              </div>
                              <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--neutral-50, #F9FAFB)' }}>
                                <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Heures restantes semaine</p>
                                <p className="text-xl font-black" style={{ color: driver.weekRemaining < 10 ? '#DC2626' : '#16A34A' }}>
                                  {formatHours(driver.weekRemaining)}
                                </p>
                              </div>
                            </div>

                            {driver.todayTrips.length > 0 ? (
                              <div className="mt-3 space-y-2">
                                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>
                                  Voyages du {format(new Date(selectedDate + 'T00:00:00'), 'dd MMMM yyyy', { locale: fr })}
                                </p>
                                {driver.todayTrips.map(trip => (
                                  <div key={trip.id} className="p-3 rounded-lg" style={{ backgroundColor: 'var(--neutral-50, #F9FAFB)' }}>
                                    <div className="flex items-center justify-between mb-1.5">
                                      <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                                        {trip.route_name}
                                      </span>
                                      {renderTripBadge(trip)}
                                    </div>
                                    <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
                                      <span className="flex items-center gap-1">
                                        <Clock className="w-3 h-3" />
                                        {format(new Date(trip.departure_datetime), 'HH:mm')}
                                        <ArrowRight className="w-3 h-3" />
                                        {format(new Date(trip.arrival_datetime), 'HH:mm')}
                                      </span>
                                      {trip.departure_station && (
                                        <span className="flex items-center gap-1">
                                          <MapPin className="w-3 h-3" /> {trip.departure_station}
                                        </span>
                                      )}
                                      {trip.driver_name && (
                                        <span className="flex items-center gap-1">
                                          <Bus className="w-3 h-3" /> {trip.driver_name}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm py-4 text-center mt-3" style={{ color: 'var(--text-secondary)' }}>
                                Aucun voyage programme ce jour
                              </p>
                            )}
                            {driver.nextTrip && (
                              <div className="mt-3 p-3 rounded-lg border" style={{ borderColor: 'var(--primary)', borderStyle: 'dashed', backgroundColor: 'var(--primary-light, #E8F5E9)' }}>
                                <p className="text-xs font-semibold mb-1" style={{ color: 'var(--primary)' }}>Prochain voyage</p>
                                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                  {driver.nextTrip.route_name} — {format(new Date(driver.nextTrip.departure_datetime), 'dd/MM a HH:mm', { locale: fr })}
                                  {driver.nextTrip.driver_name && ` — ${driver.nextTrip.driver_name}`}
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
