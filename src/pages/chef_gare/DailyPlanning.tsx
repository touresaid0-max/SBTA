import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../store/authStore';
import { format, addMinutes, isAfter, isBefore, isWithinInterval } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Link } from 'react-router-dom';
import {
  Calendar, Clock, Bus, User, Users, MapPin, Monitor,
  ChevronDown, ChevronRight, RefreshCw, CheckCircle2,
  AlertTriangle, PlayCircle, XCircle, TrendingUp,
  Navigation, Armchair, ExternalLink, Plus, Link2, Link2Off, Pencil, Layers,
  Truck, Loader2, X, Banknote, Wrench, Printer, Bell
} from 'lucide-react';
import toast from 'react-hot-toast';
import { printBordereauRamassage } from '../../utils/printBordereau';
import type { BordereauRamassageData } from '../../types/counter.types';
import EditScheduleModal from '../../components/chef_gare/EditScheduleModal';

interface TransitStop {
  station_id: string;
  station_name: string;
  arrival_offset_minutes: number;
  departure_offset_minutes: number;
  position: number;
}

interface ScheduleRow {
  id: string;
  route_name: string;
  departure_datetime: string;
  arrival_datetime: string;
  status: string;
  seats_available: number | null;
  seats_reserved: number;
  fill_rate: number | null;
  notes: string | null;
  transit_stops: TransitStop[];
  bus_registration: string;
  bus_model: string;
  bus_capacity: number;
  driver_name: string;
  driver_phone: string;
  copilot_name: string | null;
  arrival_station_name: string;
  reservations_count: number;
  counter_id: string | null;
  counter_number: number | null;
  departure_order: number | null;
  convoy_amount: number | null;
  is_anticipated: boolean;
}

interface CounterOption {
  id: string;
  counter_number: number;
  is_active: boolean;
  user_name?: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; dot: string; icon: React.ReactNode }> = {
  planifie: {
    label: 'Planifié', color: '#1D4ED8', bg: '#EFF6FF', border: '#BFDBFE', dot: '#3B82F6',
    icon: <Calendar className="w-4 h-4" />
  },
  en_cours: {
    label: 'En cours', color: '#B45309', bg: '#FFFBEB', border: '#FDE68A', dot: '#F59E0B',
    icon: <PlayCircle className="w-4 h-4" />
  },
  termine: {
    label: 'Terminé', color: '#065F46', bg: '#ECFDF5', border: '#A7F3D0', dot: '#10B981',
    icon: <CheckCircle2 className="w-4 h-4" />
  },
  annule: {
    label: 'Annulé', color: '#991B1B', bg: '#FEF2F2', border: '#FECACA', dot: '#EF4444',
    icon: <XCircle className="w-4 h-4" />
  },
  retard: {
    label: 'Retard', color: '#92400E', bg: '#FEF3C7', border: '#FCD34D', dot: '#F59E0B',
    icon: <AlertTriangle className="w-4 h-4" />
  },
  convoi: {
    label: 'Convoi', color: '#7C2D12', bg: '#FFF7ED', border: '#FDBA74', dot: '#F97316',
    icon: <Truck className="w-4 h-4" />
  },
  panne: {
    label: 'Panne', color: '#991B1B', bg: '#FEF2F2', border: '#FCA5A5', dot: '#DC2626',
    icon: <Wrench className="w-4 h-4" />
  },
};

const UPDATABLE_STATUSES = ['planifie', 'en_cours', 'retard'];

export default function DailyPlanning() {
  const { user } = useAuthStore();
  const [station, setStation] = useState<any>(null);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [autoCloseAlerts, setAutoCloseAlerts] = useState<{schedule_id: string; route_name: string; plate_number: string; departure: string; missing_charges: boolean}[]>([]);
  const [showAlerts, setShowAlerts] = useState(false);
  const stationRef = useRef<any>(null);

  // Counter assignment
  const [counters, setCounters] = useState<CounterOption[]>([]);
  const [assignModalSchedule, setAssignModalSchedule] = useState<ScheduleRow | null>(null);
  const [selectedCounterId, setSelectedCounterId] = useState<string>('');
  const [assigning, setAssigning] = useState(false);

  // Convoy
  const [convoySchedule, setConvoySchedule] = useState<ScheduleRow | null>(null);
  const [convoyAmount, setConvoyAmount] = useState<number | ''>('');
  const [convoyObservation, setConvoyObservation] = useState('');
  const [convoySubmitting, setConvoySubmitting] = useState(false);
  const [convoyConfirmStep, setConvoyConfirmStep] = useState(false);

  // Breakdown
  const [breakdownSchedule, setBreakdownSchedule] = useState<ScheduleRow | null>(null);
  const [breakdownReason, setBreakdownReason] = useState('');
  const [breakdownObservation, setBreakdownObservation] = useState('');
  const [breakdownSubmitting, setBreakdownSubmitting] = useState(false);

  // Route assignment
  const [routeAssignOpen, setRouteAssignOpen] = useState(false);
  const [availableRoutes, setAvailableRoutes] = useState<{ id: string; name: string }[]>([]);
  const [counterRouteMap, setCounterRouteMap] = useState<Record<string, Set<string>>>({});
  const [savingRoutes, setSavingRoutes] = useState<string | null>(null);

  // Ramassage
  const [ramassageSchedules, setRamassageSchedules] = useState<any[]>([]);
  const [ramassageModalSched, setRamassageModalSched] = useState<any | null>(null);
  const [ramassageAmount, setRamassageAmount] = useState<number | ''>('');
  const [ramassageObs, setRamassageObs] = useState('');

  // Edit schedule modal
  const [editSchedule, setEditSchedule] = useState<ScheduleRow | null>(null);
  const [ramassageSaving, setRamassageSaving] = useState(false);

  useEffect(() => {
    if (user?.id) init();
    const clock = setInterval(() => setCurrentTime(new Date()), 10000);
    return () => clearInterval(clock);
  }, [user]);

  useEffect(() => {
    if (!station) return;
    const channel = supabase
      .channel(`chef-gare-planning-${station.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules' }, () => {
        loadSchedules(station.id);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, () => {
        loadSchedules(station.id);
      })
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [station?.id]);

  useEffect(() => {
    if (station) {
      loadSchedules(station.id, selectedDate);
      loadRamassageSchedules(station.id, selectedDate);
    }
  }, [selectedDate]);

  const init = async () => {
    setLoading(true);
    const { data: sid } = await supabase.rpc('get_my_station_id');
    const { data, error } = await supabase
      .from('stations')
      .select('*, cities:city_id(name)')
      .eq('id', sid)
      .maybeSingle();

    if (error || !data) {
      toast.error('Gare introuvable');
      setLoading(false);
      return;
    }

    const s = { ...data, city_name: (data as any).cities?.name || '' };
    setStation(s);
    stationRef.current = s;

    // Auto-terminate past en_cours/retard schedules and get alerts
    try {
      const { data: alerts } = await supabase.rpc('auto_terminate_past_schedules', { p_station_id: s.id });
      if (alerts && Array.isArray(alerts) && alerts.length > 0) {
        setAutoCloseAlerts(alerts);
        const missing = alerts.filter((a: any) => a.missing_charges);
        if (missing.length > 0) {
          setShowAlerts(true);
          toast.error(`${missing.length} voyage(s) d'hier terminé(s) sans charges enregistrées`, { duration: 6000 });
        }
      }
    } catch (_) {}

    await Promise.all([loadSchedules(s.id), loadCounters(s.id), loadRamassageSchedules(s.id)]);
    setLoading(false);
  };

  const loadSchedules = async (stationId: string, dateStr?: string) => {
    const targetDate = dateStr || selectedDate;
    const today = new Date(targetDate + 'T00:00:00');
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const { data, error } = await supabase
      .from('schedules')
      .select(`
        id, route_name, departure_datetime, arrival_datetime, is_anticipated,
        status, seats_available, seats_reserved, fill_rate, notes, transit_stops,
        bus:bus_id(registration_number, model, capacity),
        driver:driver_id(full_name, phone),
        copilot:copilot_id(full_name),
        arrival_station:arrival_station_id(name)
      `)
      .eq('departure_station_id', stationId)
      .gte('departure_datetime', today.toISOString())
      .lt('departure_datetime', tomorrow.toISOString())
      .order('departure_datetime', { ascending: true });

    if (error) {
      toast.error('Erreur chargement planning');
      return;
    }

    // Load departure assignments for all these schedules
    const scheduleIds = (data || []).map((s: any) => s.id);
    let assignmentMap: Record<string, { counter_id: string; counter_number: number }> = {};
    if (scheduleIds.length > 0) {
      const { data: depSeq } = await supabase
        .from('departure_sequence')
        .select('schedule_id, counter_id, departure_order, counters:counter_id(counter_number)')
        .in('schedule_id', scheduleIds);
      (depSeq || []).forEach((d: any) => {
        assignmentMap[d.schedule_id] = {
          counter_id: d.counter_id,
          counter_number: (d.counters as any)?.counter_number ?? null,
          departure_order: d.departure_order ?? null,
        };
      });
    }

    // Load convoy data
    let convoyMap: Record<string, number> = {};
    if (scheduleIds.length > 0) {
      const { data: convoys } = await supabase
        .from('convoys')
        .select('schedule_id, amount')
        .in('schedule_id', scheduleIds);
      (convoys || []).forEach((c: any) => {
        convoyMap[c.schedule_id] = Number(c.amount);
      });
    }

    const rows: ScheduleRow[] = (data || []).map((s: any) => ({
      id: s.id,
      route_name: s.route_name || '—',
      departure_datetime: s.departure_datetime,
      arrival_datetime: s.arrival_datetime,
      status: s.status || 'planifie',
      seats_available: s.seats_available,
      seats_reserved: s.seats_reserved ?? 0,
      fill_rate: s.fill_rate,
      notes: s.notes,
      transit_stops: Array.isArray(s.transit_stops) ? s.transit_stops.sort((a: TransitStop, b: TransitStop) => a.position - b.position) : [],
      bus_registration: s.bus?.registration_number || '—',
      bus_model: s.bus?.model || '—',
      bus_capacity: s.bus?.capacity ?? s.bus?.total_seats ?? 0,
      driver_name: s.driver?.full_name || '—',
      driver_phone: s.driver?.phone || '',
      copilot_name: s.copilot?.full_name || null,
      arrival_station_name: s.arrival_station?.name || '—',
      reservations_count: s.seats_reserved ?? 0,
      counter_id: assignmentMap[s.id]?.counter_id ?? null,
      counter_number: assignmentMap[s.id]?.counter_number ?? null,
      departure_order: (assignmentMap[s.id] as any)?.departure_order ?? null,
      convoy_amount: convoyMap[s.id] ?? null,
      is_anticipated: s.is_anticipated ?? false,
    }));

    rows.sort((a, b) => {
      const timeA = new Date(a.departure_datetime).getTime();
      const timeB = new Date(b.departure_datetime).getTime();
      if (timeA !== timeB) return timeA - timeB;
      const destA = (a.arrival_station_name || '').toLowerCase();
      const destB = (b.arrival_station_name || '').toLowerCase();
      if (destA !== destB) return destA.localeCompare(destB, 'fr');
      return 0;
    });

    setSchedules(rows);
  };

  const loadCounters = async (stationId: string) => {
    const { count: chefCount } = await supabase
      .from('station_managers')
      .select('id', { count: 'exact', head: true })
      .eq('station_id', stationId);
    const restrictManagerId = (chefCount ?? 0) > 1 ? user?.id ?? null : null;

    let query = supabase
      .from('counters')
      .select('id, counter_number, is_active, assigned_user:assigned_user_id(full_name)')
      .eq('station_id', stationId)
      .order('counter_number');
    if (restrictManagerId) query = query.eq('manager_id', restrictManagerId);

    const { data } = await query;
    setCounters(
      (data || []).map((c: any) => ({
        id: c.id,
        counter_number: c.counter_number,
        is_active: c.is_active,
        user_name: (c.assigned_user as any)?.full_name || undefined,
      }))
    );
  };

  const loadAvailableRoutes = async (stationId: string) => {
    const { data: stationData } = await supabase
      .from('stations')
      .select('city_id')
      .eq('id', stationId)
      .maybeSingle();
    if (!stationData) return;

    const { data: routes } = await supabase
      .from('routes')
      .select('id, name')
      .eq('origin_city_id', stationData.city_id)
      .eq('is_active', true)
      .order('name');
    setAvailableRoutes(routes || []);
  };

  const loadCounterRoutes = async (stationId: string) => {
    const { count: chefCount } = await supabase
      .from('station_managers')
      .select('id', { count: 'exact', head: true })
      .eq('station_id', stationId);
    const restrictManagerId = (chefCount ?? 0) > 1 ? user?.id ?? null : null;

    let cQuery = supabase
      .from('counters')
      .select('id')
      .eq('station_id', stationId);
    if (restrictManagerId) cQuery = cQuery.eq('manager_id', restrictManagerId);
    const { data: cList } = await cQuery;
    if (!cList || cList.length === 0) return;

    const counterIds = cList.map(c => c.id);
    const { data: cr } = await supabase
      .from('counter_routes')
      .select('counter_id, route_id')
      .in('counter_id', counterIds);

    const map: Record<string, Set<string>> = {};
    counterIds.forEach(id => { map[id] = new Set(); });
    (cr || []).forEach((r: any) => {
      if (!map[r.counter_id]) map[r.counter_id] = new Set();
      map[r.counter_id].add(r.route_id);
    });
    setCounterRouteMap(map);
  };

  const openRouteAssign = async () => {
    if (!station) return;
    setRouteAssignOpen(true);
    await Promise.all([loadAvailableRoutes(station.id), loadCounterRoutes(station.id)]);
  };

  const toggleRouteForCounter = (counterId: string, routeId: string) => {
    setCounterRouteMap(prev => {
      const next = { ...prev };
      const set = new Set(next[counterId] || []);
      if (set.has(routeId)) set.delete(routeId);
      else set.add(routeId);
      next[counterId] = set;
      return next;
    });
  };

  const openRamassageModal = (sched: any) => {
    setRamassageModalSched(sched);
    setRamassageAmount(sched.ramassage_collection?.amount || '');
    setRamassageObs('');
  };

  const handleSaveRamassage = async () => {
    if (!ramassageModalSched || !station || !ramassageAmount || Number(ramassageAmount) <= 0) return;
    setRamassageSaving(true);
    try {
      if (ramassageModalSched.ramassage_collection?.id) {
        const { error } = await supabase
          .from('ramassage_collections')
          .update({
            amount: Number(ramassageAmount),
            observation: ramassageObs.trim() || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', ramassageModalSched.ramassage_collection.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('ramassage_collections')
          .insert({
            schedule_id: ramassageModalSched.id,
            station_id: station.id,
            amount: Number(ramassageAmount),
            observation: ramassageObs.trim() || null,
            collected_by: user?.id,
          });
        if (error) throw error;
      }
      toast.success('Montant ramassage enregistre');
      setRamassageModalSched(null);
      await loadRamassageSchedules(station.id);
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors de l\'enregistrement');
    } finally {
      setRamassageSaving(false);
    }
  };

  const handlePrintRamassage = async (sched: any) => {
    try {
      const { data: summary } = await supabase
        .from('schedule_receipt_summary')
        .select('*')
        .eq('schedule_id', sched.id)
        .maybeSingle();
      if (!summary) { toast.error('Données du départ introuvables'); return; }
      const now = new Date();
      const depDate = new Date(sched.departure_datetime);
      const bordData: BordereauRamassageData = {
        station_name: summary.station_name || sched.departure_station_name,
        departure_number: summary.departure_number || 0,
        route_name: summary.route_name || sched.route_name,
        departure_date: format(depDate, 'dd/MM/yyyy'),
        departure_time: format(depDate, 'HH:mm'),
        registration_number: summary.registration_number || sched.bus_registration,
        driver_name: summary.driver_name || sched.driver_name,
        total_seats: summary.capacity || sched.bus_capacity || 0,
        seats_sold: summary.seats_sold || 0,
        seats_remaining: summary.seats_remaining || 0,
        destination: summary.destination_city || sched.arrival_station_name,
        unit_price: summary.base_price || sched.route_base_price || 0,
        total_ticket_amount: summary.total_ticket_amount || 0,
        total_charges: summary.total_charges || 0,
        solde_ticket: summary.solde_ticket || 0,
        total_baggage: summary.total_baggage || 0,
        ramassage_amount: sched.ramassage_collection?.amount || summary.ramassage_amount || 0,
        sold_seat_numbers: summary.sold_seat_numbers || [],
        print_date: format(now, 'dd/MM/yyyy'),
        print_time: format(now, 'HH:mm'),
      };
      printBordereauRamassage(bordData);
    } catch {
      toast.error('Erreur lors de l\'impression');
    }
  };

  const handleSaveCounterRoutes = async (counterId: string) => {
    setSavingRoutes(counterId);
    try {
      const routeIds = [...(counterRouteMap[counterId] || [])];
      const { error } = await supabase.rpc('chef_gare_assign_routes', {
        p_counter_id: counterId,
        p_route_ids: routeIds,
      });
      if (error) throw error;
      const counter = counters.find(c => c.id === counterId);
      toast.success(`Lignes du Guichet ${counter?.counter_number} mises a jour`);
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors de la sauvegarde');
    } finally {
      setSavingRoutes(null);
    }
  };

  const loadRamassageSchedules = async (stationId: string, dateStr?: string) => {
    const targetDate = dateStr || selectedDate;
    const today = new Date(targetDate + 'T00:00:00');
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const { data } = await supabase
      .from('schedules')
      .select(`
        id, route_name, departure_datetime, arrival_datetime, status,
        seats_available, seats_reserved, is_ramassage,
        bus:bus_id(registration_number, capacity, total_seats),
        driver:driver_id(full_name),
        departure_station:departure_station_id(name),
        arrival_station:arrival_station_id(name),
        route:route_id(name, base_price)
      `)
      .eq('arrival_station_id', stationId)
      .eq('is_ramassage', true)
      .gte('departure_datetime', today.toISOString())
      .lt('departure_datetime', tomorrow.toISOString())
      .order('departure_datetime');

    if (!data) { setRamassageSchedules([]); return; }

    const scheduleIds = data.map((s: any) => s.id);
    let ramMap: Record<string, { amount: number; id: string }> = {};
    if (scheduleIds.length > 0) {
      const { data: rams } = await supabase
        .from('ramassage_collections')
        .select('schedule_id, amount, id')
        .eq('station_id', stationId)
        .in('schedule_id', scheduleIds);
      (rams || []).forEach((r: any) => {
        ramMap[r.schedule_id] = { amount: Number(r.amount), id: r.id };
      });
    }

    const enriched = data.map((s: any) => ({
      ...s,
      bus_registration: s.bus?.registration_number || '--',
      bus_capacity: s.bus?.capacity ?? s.bus?.total_seats ?? 0,
      driver_name: s.driver?.full_name || '--',
      departure_station_name: s.departure_station?.name || '--',
      arrival_station_name: s.arrival_station?.name || '--',
      route_base_price: s.route?.base_price ?? 0,
      ramassage_collection: ramMap[s.id] || null,
    }));

    setRamassageSchedules(enriched);
  };

  const handleRefresh = async () => {
    if (!station) return;
    setRefreshing(true);
    await Promise.all([loadSchedules(station.id), loadRamassageSchedules(station.id)]);
    setRefreshing(false);
    toast.success('Planning actualisé');
  };

  const updateStatus = async (id: string, newStatus: string) => {
    setUpdatingId(id);
    const { error } = await supabase
      .from('schedules')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      toast.error(`Erreur : ${error.message}`);
    } else {
      toast.success(`Statut mis à jour : ${STATUS_CONFIG[newStatus]?.label}`);
      setSchedules(prev => prev.map(s => s.id === id ? { ...s, status: newStatus } : s));
    }
    setUpdatingId(null);
  };

  const openConvoyModal = (sched: ScheduleRow) => {
    setConvoySchedule(sched);
    setConvoyAmount('');
    setConvoyObservation('');
    setConvoyConfirmStep(false);
  };

  const closeConvoyModal = () => {
    setConvoySchedule(null);
    setConvoyConfirmStep(false);
  };

  const handleConvoySubmit = async () => {
    if (!convoySchedule || !convoyAmount || Number(convoyAmount) <= 0) return;
    if (!convoyConfirmStep) { setConvoyConfirmStep(true); return; }

    setConvoySubmitting(true);
    try {
      const { data: existing } = await supabase
        .from('convoys')
        .select('id')
        .eq('schedule_id', convoySchedule.id)
        .maybeSingle();

      if (!existing) {
        const { error: convoyErr } = await supabase.from('convoys').insert({
          schedule_id: convoySchedule.id,
          amount: Number(convoyAmount),
          observation: convoyObservation.trim() || null,
          created_by: user?.id,
        });
        if (convoyErr) throw convoyErr;
      }

      const { error: statusErr } = await supabase.from('schedules').update({
        status: 'convoi',
        seats_available: 0,
        seats_reserved: convoySchedule.bus_capacity,
        fill_rate: 100,
        updated_at: new Date().toISOString(),
      }).eq('id', convoySchedule.id);
      if (statusErr) throw statusErr;

      setSchedules(prev => prev.map(s =>
        s.id === convoySchedule.id
          ? { ...s, status: 'convoi', seats_available: 0, seats_reserved: s.bus_capacity, fill_rate: 100, convoy_amount: Number(convoyAmount) }
          : s
      ));
      toast.success('Convoi enregistre avec succes');
      closeConvoyModal();
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors de l\'enregistrement du convoi');
    } finally {
      setConvoySubmitting(false);
    }
  };

  const openDisplay = () => {
    if (station) window.open(`/display/station/${station.id}`, '_blank');
  };

  const openBreakdownModal = (sched: ScheduleRow) => {
    setBreakdownSchedule(sched);
    setBreakdownReason('');
    setBreakdownObservation('');
  };

  const closeBreakdownModal = () => {
    setBreakdownSchedule(null);
    setBreakdownReason('');
    setBreakdownObservation('');
  };

  const handleBreakdownSubmit = async () => {
    if (!breakdownSchedule || !breakdownReason.trim()) {
      toast.error('Veuillez renseigner le motif de la panne');
      return;
    }
    setBreakdownSubmitting(true);
    try {
      const { data: schedData, error: schedErr } = await supabase
        .from('schedules')
        .select('id, bus_id, driver_id, route_id, departure_station_id, seats_reserved, fill_rate')
        .eq('id', breakdownSchedule.id)
        .maybeSingle();
      if (schedErr) throw schedErr;
      if (!schedData) throw new Error('Voyage introuvable');

      const { data: busData } = await supabase
        .from('buses')
        .select('company_id')
        .eq('id', schedData.bus_id)
        .maybeSingle();

      const { data: resRows } = await supabase
        .from('reservations')
        .select('total_price')
        .eq('schedule_id', breakdownSchedule.id)
        .in('status', ['confirmee','confirme','embarque','termine','utilisee']);
      const revenue = (resRows ?? []).reduce((s, r: any) => s + Number(r.total_price || 0), 0);

      const { data: chargeRows } = await supabase
        .from('counter_charges')
        .select('amount')
        .eq('schedule_id', breakdownSchedule.id)
        .neq('status', 'rejete');
      const chargesAmount = (chargeRows ?? []).reduce((s, c: any) => s + Number(c.amount || 0), 0);
      const netBalance = revenue - chargesAmount;

      const { data: insRow, error: insErr } = await supabase
        .from('schedule_breakdowns')
        .insert({
          schedule_id: breakdownSchedule.id,
          original_bus_id: schedData.bus_id,
          original_driver_id: schedData.driver_id,
          original_company_id: (busData as any)?.company_id ?? null,
          station_id: schedData.departure_station_id,
          route_id: schedData.route_id,
          passengers_count: schedData.seats_reserved ?? 0,
          fill_rate: schedData.fill_rate ?? 0,
          revenue_amount: revenue,
          charges_amount: chargesAmount,
          net_balance: netBalance,
          net_balance_adjusted: netBalance,
          reported_by: user?.id,
          reason: breakdownReason.trim(),
          observations: breakdownObservation.trim() || null,
          status: 'signalee',
        })
        .select('id')
        .maybeSingle();
      if (insErr) throw insErr;

      if (insRow?.id) {
        await supabase.from('schedule_breakdown_audit').insert({
          breakdown_id: insRow.id,
          action: 'signal',
          performed_by: user?.id ?? null,
          original_company_id: (busData as any)?.company_id ?? null,
          original_bus_id: schedData.bus_id,
          revenue_amount: revenue,
          charges_amount: chargesAmount,
          net_balance_before: netBalance,
          net_balance_after: netBalance,
          reason: breakdownReason.trim(),
          observation: breakdownObservation.trim() || null,
        });
      }

      const { error: updErr } = await supabase
        .from('schedules')
        .update({ status: 'panne', updated_at: new Date().toISOString() })
        .eq('id', breakdownSchedule.id);
      if (updErr) throw updErr;

      setSchedules(prev => prev.map(s =>
        s.id === breakdownSchedule.id ? { ...s, status: 'panne' } : s
      ));
      toast.success('Panne signalee. Le gestionnaire a ete notifie.');
      closeBreakdownModal();
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors du signalement');
    } finally {
      setBreakdownSubmitting(false);
    }
  };

  const openAssignModal = (sched: ScheduleRow) => {
    setAssignModalSchedule(sched);
    setSelectedCounterId(sched.counter_id ?? '');
  };

  const closeAssignModal = () => {
    setAssignModalSchedule(null);
    setSelectedCounterId('');
  };

  const handleAssign = async () => {
    if (!assignModalSchedule || !selectedCounterId) return;
    setAssigning(true);
    try {
      const { data, error } = await supabase.rpc('chef_gare_assign_departure', {
        p_schedule_id: assignModalSchedule.id,
        p_counter_id: selectedCounterId,
      });
      if (error) throw error;
      const counter = counters.find(c => c.id === selectedCounterId);
      const assignedOrder = typeof data === 'number' ? data : null;
      toast.success(`Départ assigné au Guichet ${counter?.counter_number}`);
      setSchedules(prev => prev.map(s =>
        s.id === assignModalSchedule.id
          ? { ...s, counter_id: selectedCounterId, counter_number: counter?.counter_number ?? null, departure_order: assignedOrder }
          : s
      ));
      closeAssignModal();
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors de l\'assignation');
    } finally {
      setAssigning(false);
    }
  };

  const handleUnassign = async (sched: ScheduleRow) => {
    try {
      const { error } = await supabase.rpc('chef_gare_unassign_departure', {
        p_schedule_id: sched.id,
      });
      if (error) throw error;
      toast.success('Assignation retirée');
      setSchedules(prev => prev.map(s =>
        s.id === sched.id ? { ...s, counter_id: null, counter_number: null, departure_order: null } : s
      ));
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors du retrait d\'assignation');
    }
  };

  const filtered = statusFilter === 'all'
    ? schedules
    : schedules.filter(s => s.status === statusFilter);

  const departNumberByDest = (() => {
    const counters: Record<string, number> = {};
    const map = new Map<string, number>();
    for (const s of schedules) {
      const dest = (s.arrival_station_name || '').toLowerCase();
      counters[dest] = (counters[dest] || 0) + 1;
      map.set(s.id, counters[dest]);
    }
    return map;
  })();

  const stats = {
    total: schedules.length,
    planifie: schedules.filter(s => s.status === 'planifie').length,
    en_cours: schedules.filter(s => s.status === 'en_cours').length,
    termine: schedules.filter(s => s.status === 'termine').length,
    annule: schedules.filter(s => s.status === 'annule').length,
    convoi: schedules.filter(s => s.status === 'convoi').length,
    totalPassengers: schedules.reduce((sum, s) => sum + s.seats_reserved, 0),
  };

  const getNextSchedule = () => {
    return schedules.find(s => s.status === 'planifie' || s.status === 'en_cours');
  };

  const nextSched = getNextSchedule();

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <div className="w-10 h-10 border-4 rounded-full animate-spin"
          style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  if (!station) {
    return (
      <div className="p-8 text-center py-20">
        <MapPin className="w-12 h-12 mx-auto mb-3 opacity-30" style={{ color: 'var(--text-muted)' }} />
        <p className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>Aucune gare assignée</p>
        <p className="mt-1" style={{ color: 'var(--text-secondary)' }}>Contactez l'administrateur pour être rattaché à votre gare.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {selectedDate === format(new Date(), 'yyyy-MM-dd') ? 'Planning du jour' : 'Planning'}
          </h1>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="flex items-center gap-1 text-sm font-medium" style={{ color: 'var(--primary)' }}>
              <MapPin className="w-4 h-4" />
              {station.name}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>·</span>
            <span className="text-sm capitalize" style={{ color: 'var(--text-secondary)' }}>
              {format(new Date(selectedDate + 'T00:00:00'), 'EEEE d MMMM yyyy', { locale: fr })}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>·</span>
            <span className="text-sm font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
              {format(currentTime, 'HH:mm')}
            </span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="ml-2 px-3 py-1.5 rounded-lg border text-sm font-medium cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1"
              style={{ borderColor: 'var(--primary)', color: 'var(--primary)', backgroundColor: 'var(--surface)', focusRingColor: 'var(--primary)' }}
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', backgroundColor: 'var(--surface)' }}
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Actualiser
          </button>
          {autoCloseAlerts.filter(a => a.missing_charges).length > 0 && (
            <button
              onClick={() => setShowAlerts(!showAlerts)}
              className="relative flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
            >
              <Bell className="w-4 h-4" />
              <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center">
                {autoCloseAlerts.filter(a => a.missing_charges).length}
              </span>
            </button>
          )}
          <button
            onClick={openDisplay}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border"
            style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}
          >
            <Monitor className="w-4 h-4" />
            Affichage
            <ExternalLink className="w-3.5 h-3.5 opacity-70" />
          </button>
          <button
            onClick={openRouteAssign}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border"
            style={{ borderColor: '#16A34A', color: '#16A34A' }}
          >
            <Layers className="w-4 h-4" />
            Lignes / Guichets
          </button>
          <Link to="/chef-gare/schedules/grouped"
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border"
            style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}>
            <Layers className="w-4 h-4" />
            Planning groupe
          </Link>
          <Link to="/chef-gare/schedules/new"
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ backgroundColor: 'var(--primary)' }}>
            <Plus className="w-4 h-4" />
            Nouveau voyage
          </Link>
        </div>
      </div>

      {/* Auto-close alerts panel */}
      {showAlerts && autoCloseAlerts.filter(a => a.missing_charges).length > 0 && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-red-100 border-b border-red-200">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              <span className="font-semibold text-red-800 text-sm">
                Voyages terminés automatiquement sans charges
              </span>
            </div>
            <button onClick={() => setShowAlerts(false)} className="text-red-400 hover:text-red-700">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="divide-y divide-red-100 max-h-48 overflow-y-auto">
            {autoCloseAlerts.filter(a => a.missing_charges).map((alert, idx) => (
              <div key={idx} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                <div className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                <div className="flex-1">
                  <span className="font-medium text-red-900">{alert.route_name}</span>
                  <span className="text-red-600 ml-2">({alert.plate_number})</span>
                  <span className="text-red-500 ml-2 text-xs">
                    {new Date(alert.departure).toLocaleDateString('fr-FR')} {new Date(alert.departure).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded text-xs font-bold bg-red-200 text-red-800">
                  Charges manquantes
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Next departure highlight */}
      {nextSched && (
        <div className="rounded-2xl p-5 border-2 flex items-center gap-6"
          style={{ backgroundColor: 'var(--primary-light)', borderColor: 'var(--primary)' }}>
          <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'var(--primary)' }}>
            <Navigation className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <p className="text-xs font-bold uppercase tracking-wider mb-0.5" style={{ color: 'var(--primary)' }}>
              Prochain départ
            </p>
            <p className="text-2xl font-black" style={{ color: 'var(--text-primary)' }}>
              {format(new Date(nextSched.departure_datetime), 'HH:mm')}
              <span className="text-lg font-semibold ml-2" style={{ color: 'var(--text-secondary)' }}>
                → {nextSched.arrival_station_name}
              </span>
            </p>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              {nextSched.route_name} · Bus {nextSched.bus_registration} · {nextSched.driver_name}
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm"
              style={{
                backgroundColor: STATUS_CONFIG[nextSched.status]?.bg,
                color: STATUS_CONFIG[nextSched.status]?.color,
                border: `1px solid ${STATUS_CONFIG[nextSched.status]?.border}`
              }}>
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_CONFIG[nextSched.status]?.dot }} />
              {STATUS_CONFIG[nextSched.status]?.label}
            </div>
            <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
              {nextSched.reservations_count} passager{nextSched.reservations_count !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: 'Total départs', value: stats.total, color: 'var(--text-primary)', bg: 'var(--surface)' },
          { label: 'Planifiés', value: stats.planifie, color: STATUS_CONFIG.planifie.color, bg: STATUS_CONFIG.planifie.bg },
          { label: 'En cours', value: stats.en_cours, color: STATUS_CONFIG.en_cours.color, bg: STATUS_CONFIG.en_cours.bg },
          { label: 'Terminés', value: stats.termine, color: STATUS_CONFIG.termine.color, bg: STATUS_CONFIG.termine.bg },
          { label: 'Convois', value: stats.convoi, color: STATUS_CONFIG.convoi.color, bg: STATUS_CONFIG.convoi.bg },
          { label: 'Annulés', value: stats.annule, color: STATUS_CONFIG.annule.color, bg: STATUS_CONFIG.annule.bg },
          { label: 'Passagers totaux', value: stats.totalPassengers, color: 'var(--text-primary)', bg: 'var(--surface)' },
        ].map((stat, i) => (
          <div key={i} className="rounded-xl p-4 border text-center"
            style={{ backgroundColor: stat.bg, borderColor: 'var(--border)' }}>
            <p className="text-2xl font-black" style={{ color: stat.color }}>{stat.value}</p>
            <p className="text-xs mt-0.5 font-medium" style={{ color: 'var(--text-muted)' }}>{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 p-1 rounded-xl border w-fit"
        style={{ backgroundColor: 'var(--surface-raised)', borderColor: 'var(--border)' }}>
        {[
          { key: 'all', label: `Tous (${stats.total})` },
          { key: 'planifie', label: `Planifiés (${stats.planifie})` },
          { key: 'en_cours', label: `En cours (${stats.en_cours})` },
          { key: 'termine', label: `Terminés (${stats.termine})` },
          { key: 'convoi', label: `Convois (${stats.convoi})` },
          { key: 'annule', label: `Annulés (${stats.annule})` },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
            style={{
              backgroundColor: statusFilter === tab.key ? 'var(--primary)' : 'transparent',
              color: statusFilter === tab.key ? 'white' : 'var(--text-secondary)',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Schedule list */}
      {filtered.length === 0 ? (
        <div className="text-center py-20 rounded-2xl border"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" style={{ color: 'var(--text-muted)' }} />
          <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            {statusFilter === 'all' ? 'Aucun départ prévu aujourd\'hui' : `Aucun départ "${STATUS_CONFIG[statusFilter]?.label}"`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(sched => {
            const cfg = STATUS_CONFIG[sched.status] || STATUS_CONFIG.planifie;
            const isExpanded = expandedId === sched.id;
            const depDate = new Date(sched.departure_datetime);
            const arrDate = new Date(sched.arrival_datetime);
            const fillPct = sched.fill_rate ??
              (sched.bus_capacity > 0 ? Math.round((sched.seats_reserved / sched.bus_capacity) * 100) : 0);
            const isActive = sched.status === 'en_cours';
            const isPast = sched.status === 'termine';
            const isCancelled = sched.status === 'annule';
            const isPastDay = selectedDate < format(new Date(), 'yyyy-MM-dd');
            const isConvoi = sched.status === 'convoi';

            return (
              <div
                key={sched.id}
                className="rounded-2xl border-2 overflow-hidden transition-all"
                style={{
                  borderColor: isActive ? 'var(--primary)' : cfg.border,
                  backgroundColor: 'var(--surface)',
                  opacity: (isPast || isCancelled) && !isConvoi ? 0.75 : 1,
                }}
              >
                {/* Main row */}
                <div
                  className="flex items-center gap-4 px-5 py-4 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : sched.id)}
                >
                  {/* Time */}
                  <div className="w-20 flex-shrink-0 text-center">
                    <p className="text-2xl font-black tabular-nums" style={{ color: isActive ? 'var(--primary)' : 'var(--text-primary)' }}>
                      {format(depDate, 'HH:mm')}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>départ</p>
                  </div>

                  {/* Route info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-base font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                        → {sched.arrival_station_name}
                      </p>
                      {sched.transit_stops.length > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ backgroundColor: 'var(--surface-raised)', color: 'var(--text-muted)' }}>
                          {sched.transit_stops.length} escale{sched.transit_stops.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>{sched.route_name}</p>
                    {/* Transit stops preview */}
                    {sched.transit_stops.length > 0 && (
                      <div className="flex items-center gap-1 mt-1 flex-wrap">
                        <Navigation className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                        {sched.transit_stops.slice(0, 3).map((t, i) => (
                          <span key={i} className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {i > 0 && <span className="mx-0.5">·</span>}
                            {t.station_name}
                            <span className="ml-1 font-medium">
                              {format(addMinutes(depDate, t.arrival_offset_minutes), 'HH:mm')}
                            </span>
                          </span>
                        ))}
                        {sched.transit_stops.length > 3 && (
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            +{sched.transit_stops.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Bus & Driver */}
                  <div className="hidden md:flex flex-col gap-1 w-36 flex-shrink-0">
                    <div className="flex items-center gap-1.5">
                      <Bus className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                      <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                        {sched.bus_registration === '—' && sched.is_anticipated ? 'A definir' : sched.bus_registration}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                      <span className="text-sm truncate" style={{ color: 'var(--text-secondary)' }}>
                        {sched.driver_name === '—' && sched.is_anticipated ? 'A definir' : sched.driver_name}
                      </span>
                    </div>
                    {sched.is_anticipated && (!sched.bus_registration || sched.bus_registration === '—' || !sched.driver_name || sched.driver_name === '—') && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 w-fit">
                        ANTICIPE
                      </span>
                    )}
                  </div>

                  {/* Passengers & fill */}
                  <div className="hidden md:flex flex-col items-center gap-1 w-24 flex-shrink-0">
                    {isConvoi ? (
                      <>
                        <div className="flex items-center gap-1">
                          <Truck className="w-3.5 h-3.5" style={{ color: '#F97316' }} />
                          <span className="text-sm font-bold" style={{ color: '#7C2D12' }}>
                            {sched.bus_capacity}/{sched.bus_capacity}
                          </span>
                        </div>
                        <div className="w-full h-1.5 rounded-full overflow-hidden"
                          style={{ backgroundColor: 'var(--border)' }}>
                          <div className="h-full rounded-full" style={{ width: '100%', backgroundColor: '#F97316' }} />
                        </div>
                        <span className="text-xs font-bold" style={{ color: '#F97316' }}>Convoi</span>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-1">
                          <Users className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                          <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                            {sched.seats_reserved}
                            {sched.bus_capacity > 0 && (
                              <span className="font-normal text-xs" style={{ color: 'var(--text-muted)' }}>
                                /{sched.bus_capacity}
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="w-full h-1.5 rounded-full overflow-hidden"
                          style={{ backgroundColor: 'var(--border)' }}>
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.min(fillPct, 100)}%`,
                              backgroundColor: fillPct >= 90 ? '#EF4444' : fillPct >= 70 ? '#F59E0B' : '#10B981',
                            }}
                          />
                        </div>
                        <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                          {fillPct}% rempli
                        </span>
                      </>
                    )}
                  </div>

                  {/* Counter assignment badge + departure order */}
                  <div className="hidden md:flex items-center gap-2 flex-shrink-0">
                    {departNumberByDest.get(sched.id) && (
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black text-white flex-shrink-0"
                        style={{ backgroundColor: 'var(--primary)' }}>
                        {departNumberByDest.get(sched.id)}
                      </div>
                    )}
                    {sched.counter_number != null ? (
                      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold border"
                        style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)', borderColor: 'var(--primary)' }}>
                        <Monitor className="w-3 h-3" />
                        Guichet {sched.counter_number}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium border border-dashed"
                        style={{ color: 'var(--text-muted)', borderColor: 'var(--border)' }}>
                        <Link2Off className="w-3 h-3" />
                        Non assigné
                      </div>
                    )}
                  </div>

                  {/* Status */}
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold"
                      style={{ backgroundColor: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cfg.dot }} />
                      {cfg.label}
                    </div>
                    {isExpanded
                      ? <ChevronDown className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                      : <ChevronRight className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                    }
                  </div>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="border-t px-5 pb-5 pt-4 space-y-5"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-raised)' }}>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* Horaires */}
                      <div className="space-y-2">
                        <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                          Horaires
                        </p>
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--primary)' }} />
                            <div>
                              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Départ :</span>
                              <span className="ml-1.5 font-bold" style={{ color: 'var(--text-primary)' }}>
                                {format(depDate, 'HH:mm')}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                            <div>
                              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Arrivée :</span>
                              <span className="ml-1.5 font-semibold" style={{ color: 'var(--text-secondary)' }}>
                                {format(arrDate, 'HH:mm')}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <TrendingUp className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                            <div>
                              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Durée :</span>
                              <span className="ml-1.5 font-semibold" style={{ color: 'var(--text-secondary)' }}>
                                {Math.round((arrDate.getTime() - depDate.getTime()) / 60000)} min
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Bus & Équipage */}
                      <div className="space-y-2">
                        <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                          Véhicule & Équipage
                        </p>
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <Bus className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--primary)' }} />
                            <div>
                              <span className="font-bold" style={{ color: 'var(--text-primary)' }}>
                                {sched.bus_registration}
                              </span>
                              {sched.bus_model && (
                                <span className="ml-1.5 text-sm" style={{ color: 'var(--text-muted)' }}>
                                  {sched.bus_model}
                                </span>
                              )}
                            </div>
                          </div>
                          {sched.bus_capacity > 0 && (
                            <div className="flex items-center gap-2">
                              <Armchair className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                                {sched.bus_capacity} sièges
                              </span>
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <User className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--primary)' }} />
                            <div>
                              <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                                {sched.driver_name}
                              </span>
                              {sched.driver_phone && (
                                <span className="ml-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                                  {sched.driver_phone}
                                </span>
                              )}
                            </div>
                          </div>
                          {sched.copilot_name && (
                            <div className="flex items-center gap-2">
                              <User className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                              <div>
                                <span className="text-xs mr-1" style={{ color: 'var(--text-muted)' }}>Copilote :</span>
                                <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                                  {sched.copilot_name}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Passagers */}
                      <div className="space-y-2">
                        <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                          {isConvoi ? 'Convoi' : 'Passagers'}
                        </p>
                        {isConvoi ? (
                          <div className="space-y-3">
                            <div className="rounded-xl p-4 border-2" style={{ backgroundColor: '#FFF7ED', borderColor: '#FDBA74' }}>
                              <div className="flex items-center gap-2 mb-2">
                                <Truck className="w-5 h-5" style={{ color: '#F97316' }} />
                                <span className="font-bold" style={{ color: '#7C2D12' }}>Départ en convoi</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-sm" style={{ color: '#92400E' }}>Places</span>
                                <span className="font-bold" style={{ color: '#7C2D12' }}>
                                  {sched.bus_capacity}/{sched.bus_capacity} vendues
                                </span>
                              </div>
                              <div className="w-full h-3 rounded-full overflow-hidden mt-2"
                                style={{ backgroundColor: '#FED7AA' }}>
                                <div className="h-full rounded-full" style={{ width: '100%', backgroundColor: '#F97316' }} />
                              </div>
                              {sched.convoy_amount != null && (
                                <div className="flex items-center justify-between mt-3 pt-3 border-t" style={{ borderColor: '#FDBA74' }}>
                                  <span className="text-sm font-medium" style={{ color: '#92400E' }}>Montant convoi</span>
                                  <span className="text-lg font-black" style={{ color: '#C2410C' }}>
                                    {sched.convoy_amount.toLocaleString()} FCFA
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Réservés</span>
                              <span className="font-bold" style={{ color: 'var(--text-primary)' }}>
                                {sched.seats_reserved}
                              </span>
                            </div>
                            {sched.bus_capacity > 0 && (
                              <>
                                <div className="flex items-center justify-between">
                                  <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Disponibles</span>
                                  <span className="font-bold" style={{ color: 'var(--text-primary)' }}>
                                    {sched.bus_capacity - sched.seats_reserved}
                                  </span>
                                </div>
                                <div className="w-full h-3 rounded-full overflow-hidden"
                                  style={{ backgroundColor: 'var(--border)' }}>
                                  <div
                                    className="h-full rounded-full transition-all"
                                    style={{
                                      width: `${Math.min(fillPct, 100)}%`,
                                      backgroundColor: fillPct >= 90 ? '#EF4444' : fillPct >= 70 ? '#F59E0B' : '#10B981',
                                    }}
                                  />
                                </div>
                                <p className="text-sm font-bold text-center" style={{ color: 'var(--text-secondary)' }}>
                                  {fillPct}% de remplissage
                                </p>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Transit stops timeline */}
                    {sched.transit_stops.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                          Itinéraire complet
                        </p>
                        <div className="flex items-start gap-0 overflow-x-auto pb-2">
                          {/* Origin */}
                          <div className="flex flex-col items-center flex-shrink-0 w-28">
                            <div className="w-4 h-4 rounded-full border-4 z-10"
                              style={{ backgroundColor: 'var(--primary)', borderColor: 'var(--primary)' }} />
                            <p className="text-xs font-bold mt-1 text-center" style={{ color: 'var(--primary)' }}>
                              {station.name}
                            </p>
                            <p className="text-xs font-mono font-semibold mt-0.5" style={{ color: 'var(--text-primary)' }}>
                              {format(depDate, 'HH:mm')}
                            </p>
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Départ</p>
                          </div>

                          {sched.transit_stops.map((stop, idx) => (
                            <React.Fragment key={idx}>
                              <div className="flex-1 h-0.5 mt-2 min-w-8"
                                style={{ backgroundColor: 'var(--border)' }} />
                              <div className="flex flex-col items-center flex-shrink-0 w-28">
                                <div className="w-3 h-3 rounded-full border-3 z-10"
                                  style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--primary)', border: '2px solid var(--primary)' }} />
                                <p className="text-xs font-semibold mt-1 text-center" style={{ color: 'var(--text-primary)' }}>
                                  {stop.station_name}
                                </p>
                                <p className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
                                  {format(addMinutes(depDate, stop.arrival_offset_minutes), 'HH:mm')}
                                </p>
                                {stop.price > 0 && (
                                  <p className="text-xs font-semibold" style={{ color: 'var(--primary)' }}>
                                    {stop.price.toLocaleString('fr-CI')} F
                                  </p>
                                )}
                                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Escale</p>
                              </div>
                            </React.Fragment>
                          ))}

                          {/* Final destination */}
                          <div className="flex-1 h-0.5 mt-2 min-w-8"
                            style={{ backgroundColor: 'var(--border)' }} />
                          <div className="flex flex-col items-center flex-shrink-0 w-28">
                            <div className="w-4 h-4 rounded-full border-4 z-10"
                              style={{ backgroundColor: '#10B981', borderColor: '#10B981' }} />
                            <p className="text-xs font-bold mt-1 text-center" style={{ color: '#059669' }}>
                              {sched.arrival_station_name}
                            </p>
                            <p className="text-xs font-mono font-semibold mt-0.5" style={{ color: 'var(--text-primary)' }}>
                              {format(arrDate, 'HH:mm')}
                            </p>
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Arrivée</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Notes */}
                    {sched.notes && (
                      <div className="p-3 rounded-xl border"
                        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
                        <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                          Notes planificateur
                        </p>
                        <p className="text-sm italic" style={{ color: 'var(--text-secondary)' }}>{sched.notes}</p>
                      </div>
                    )}

                    {/* Convoy closed notice */}
                    {isConvoi && (
                      <div className="flex items-center gap-2 px-4 py-3 rounded-xl border-2"
                        style={{ backgroundColor: '#FFF7ED', borderColor: '#FDBA74' }}>
                        <Truck className="w-4 h-4 flex-shrink-0" style={{ color: '#F97316' }} />
                        <p className="text-sm font-semibold" style={{ color: '#7C2D12' }}>
                          Départ cloture en convoi — Aucune modification possible
                        </p>
                      </div>
                    )}

                    {/* Edit schedule button */}
                    {!isCancelled && !isConvoi && sched.status !== 'termine' && (
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => setEditSchedule(sched)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors border"
                          style={{ backgroundColor: '#EFF6FF', color: '#1D4ED8', borderColor: '#93C5FD' }}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Modifier le depart
                        </button>
                      </div>
                    )}

                    {/* Status actions */}
                    {!isCancelled && !isConvoi && (
                      <div className="flex items-center gap-3 pt-1">
                        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                          Changer le statut :
                        </p>
                        {(() => {
                          const anticipatedIncomplete = sched.is_anticipated && (sched.bus_registration === '—' || sched.driver_name === '—');
                          return (
                        <div className="flex items-center gap-2 flex-wrap">
                          {isPastDay ? (
                            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-500 border border-gray-200">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Verrouillé (date passée)
                            </span>
                          ) : (
                          <>
                          {sched.status === 'planifie' && (
                            <button
                              onClick={() => updateStatus(sched.id, 'en_cours')}
                              disabled={updatingId === sched.id || anticipatedIncomplete}
                              title={anticipatedIncomplete ? 'Completez d\'abord le vehicule, le chauffeur et l\'heure de depart' : ''}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                              style={{ backgroundColor: STATUS_CONFIG.en_cours.bg, color: STATUS_CONFIG.en_cours.color, border: `1px solid ${STATUS_CONFIG.en_cours.border}` }}
                            >
                              <PlayCircle className="w-3.5 h-3.5" />
                              Lancer l'embarquement
                            </button>
                          )}
                          {sched.status === 'en_cours' && (
                            <button
                              onClick={() => updateStatus(sched.id, 'termine')}
                              disabled={updatingId === sched.id || anticipatedIncomplete}
                              title={anticipatedIncomplete ? 'Completez d\'abord le vehicule, le chauffeur et l\'heure de depart' : ''}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                              style={{ backgroundColor: STATUS_CONFIG.termine.bg, color: STATUS_CONFIG.termine.color, border: `1px solid ${STATUS_CONFIG.termine.border}` }}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Marquer comme parti
                            </button>
                          )}
                          {anticipatedIncomplete && sched.status === 'planifie' && (
                            <span className="text-xs font-medium px-2 py-1 rounded" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
                              Completez le vehicule, chauffeur et horaire pour activer l'embarquement
                            </span>
                          )}
                          {(sched.status === 'planifie' || sched.status === 'en_cours') && (
                            <>
                              <button
                                onClick={() => updateStatus(sched.id, 'retard')}
                                disabled={updatingId === sched.id}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors"
                                style={{ backgroundColor: STATUS_CONFIG.retard.bg, color: STATUS_CONFIG.retard.color, border: `1px solid ${STATUS_CONFIG.retard.border}` }}
                              >
                                <AlertTriangle className="w-3.5 h-3.5" />
                                Signaler retard
                              </button>
                              <button
                                onClick={() => openConvoyModal(sched)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors"
                                style={{ backgroundColor: STATUS_CONFIG.convoi.bg, color: STATUS_CONFIG.convoi.color, border: `1px solid ${STATUS_CONFIG.convoi.border}` }}
                              >
                                <Truck className="w-3.5 h-3.5" />
                                Enregistrer un convoi
                              </button>
                              <button
                                onClick={() => openBreakdownModal(sched)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors"
                                style={{ backgroundColor: STATUS_CONFIG.panne.bg, color: STATUS_CONFIG.panne.color, border: `1px solid ${STATUS_CONFIG.panne.border}` }}
                              >
                                <Wrench className="w-3.5 h-3.5" />
                                Signaler une panne
                              </button>
                            </>
                          )}
                          {sched.status === 'retard' && (
                            <>
                              <button
                                onClick={() => updateStatus(sched.id, 'en_cours')}
                                disabled={updatingId === sched.id}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors"
                                style={{ backgroundColor: STATUS_CONFIG.en_cours.bg, color: STATUS_CONFIG.en_cours.color, border: `1px solid ${STATUS_CONFIG.en_cours.border}` }}
                              >
                                <PlayCircle className="w-3.5 h-3.5" />
                                Reprendre
                              </button>
                              <button
                                onClick={() => openConvoyModal(sched)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors"
                                style={{ backgroundColor: STATUS_CONFIG.convoi.bg, color: STATUS_CONFIG.convoi.color, border: `1px solid ${STATUS_CONFIG.convoi.border}` }}
                              >
                                <Truck className="w-3.5 h-3.5" />
                                Enregistrer un convoi
                              </button>
                              <button
                                onClick={() => updateStatus(sched.id, 'annule')}
                                disabled={updatingId === sched.id}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors"
                                style={{ backgroundColor: STATUS_CONFIG.annule.bg, color: STATUS_CONFIG.annule.color, border: `1px solid ${STATUS_CONFIG.annule.border}` }}
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                Annuler
                              </button>
                            </>
                          )}
                          {(sched.status === 'planifie') && (
                            <button
                              onClick={() => updateStatus(sched.id, 'annule')}
                              disabled={updatingId === sched.id}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors"
                              style={{ backgroundColor: STATUS_CONFIG.annule.bg, color: STATUS_CONFIG.annule.color, border: `1px solid ${STATUS_CONFIG.annule.border}` }}
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              Annuler
                            </button>
                          )}
                          </>)}
                        </div>
                          );
                        })()}
                        {updatingId === sched.id && (
                          <div className="w-4 h-4 border-2 rounded-full animate-spin"
                            style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
                        )}
                      </div>
                    )}

                    {/* Counter assignment actions */}
                    {!isConvoi && <div className="flex items-center gap-3 pt-1 border-t flex-wrap"
                      style={{ borderColor: 'var(--border)' }}>
                      {departNumberByDest.get(sched.id) && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border"
                          style={{ backgroundColor: '#F0FDF4', color: '#16A34A', borderColor: '#86EFAC' }}>
                          N° Départ : {departNumberByDest.get(sched.id)}
                        </div>
                      )}
                      <p className="text-xs font-semibold uppercase tracking-wider flex-shrink-0"
                        style={{ color: 'var(--text-muted)' }}>
                        Guichet :
                      </p>
                      {sched.counter_number != null ? (
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border"
                            style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)', borderColor: 'var(--primary)' }}>
                            <Monitor className="w-3.5 h-3.5" />
                            Guichet {sched.counter_number}
                          </div>
                          <button
                            onClick={() => openAssignModal(sched)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors hover:bg-gray-50"
                            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                            <Pencil className="w-3 h-3" />
                            Modifier
                          </button>
                          <button
                            onClick={() => handleUnassign(sched)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors"
                            style={{ borderColor: '#FCA5A5', color: '#DC2626', backgroundColor: '#FEF2F2' }}>
                            <Link2Off className="w-3 h-3" />
                            Retirer
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => openAssignModal(sched)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                          style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)', border: '1px solid var(--primary)' }}>
                          <Link2 className="w-3.5 h-3.5" />
                          Assigner à un guichet
                        </button>
                      )}
                    </div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Ramassage section */}
      {ramassageSchedules.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: '#FFF7ED' }}>
              <Truck className="w-5 h-5" style={{ color: '#EA580C' }} />
            </div>
            <div>
              <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                Ramassages entrants
              </h2>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {ramassageSchedules.length} voyage(s) de ramassage a destination de votre gare
              </p>
            </div>
          </div>

          {ramassageSchedules.map(sched => {
            const depDate = new Date(sched.departure_datetime);
            const hasCollection = !!sched.ramassage_collection;
            return (
              <div key={sched.id} className="rounded-2xl border-2 overflow-hidden"
                style={{
                  borderColor: hasCollection ? '#86EFAC' : '#FDBA74',
                  backgroundColor: 'var(--surface)',
                }}>
                <div className="flex items-center gap-4 px-5 py-4">
                  <div className="w-20 flex-shrink-0 text-center">
                    <p className="text-2xl font-black tabular-nums" style={{ color: '#EA580C' }}>
                      {format(depDate, 'HH:mm')}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>depart</p>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs px-2 py-0.5 rounded-full font-bold"
                        style={{ backgroundColor: '#FFF7ED', color: '#EA580C', border: '1px solid #FDBA74' }}>
                        RAMASSAGE
                      </span>
                      <p className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
                        {sched.departure_station_name} → {sched.arrival_station_name}
                      </p>
                    </div>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                      {sched.route_name}
                    </p>
                  </div>

                  <div className="hidden md:flex flex-col gap-1 w-36 flex-shrink-0">
                    <div className="flex items-center gap-1.5">
                      <Bus className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                      <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {sched.bus_registration}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                      <span className="text-sm truncate" style={{ color: 'var(--text-secondary)' }}>
                        {sched.driver_name}
                      </span>
                    </div>
                  </div>

                  <div className="hidden md:flex flex-col items-center gap-1 w-28 flex-shrink-0">
                    <div className="flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                      <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                        {sched.seats_reserved || 0}
                        {sched.bus_capacity > 0 && (
                          <span className="font-normal text-xs" style={{ color: 'var(--text-muted)' }}>
                            /{sched.bus_capacity}
                          </span>
                        )}
                      </span>
                    </div>
                  </div>

                  {hasCollection ? (
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="text-right">
                        <p className="text-lg font-black" style={{ color: '#16A34A' }}>
                          {Number(sched.ramassage_collection.amount).toLocaleString()} F
                        </p>
                        <p className="text-xs" style={{ color: '#059669' }}>Montant enregistre</p>
                      </div>
                      <button onClick={() => openRamassageModal(sched)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                        <Pencil className="w-3 h-3" /> Modifier
                      </button>
                      <button onClick={() => handlePrintRamassage(sched)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                        <Printer className="w-3 h-3" /> Bordereau
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => openRamassageModal(sched)}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white flex-shrink-0"
                      style={{ backgroundColor: '#EA580C' }}>
                      <Banknote className="w-4 h-4" />
                      Montant ramassage
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Ramassage modal */}
      {ramassageModalSched && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setRamassageModalSched(null); }}>
          <div className="rounded-2xl shadow-xl w-full max-w-md"
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between px-6 py-5 border-b"
              style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: '#FFF7ED' }}>
                  <Truck className="w-5 h-5" style={{ color: '#EA580C' }} />
                </div>
                <div>
                  <p className="font-bold" style={{ color: 'var(--text-primary)' }}>
                    {ramassageModalSched.ramassage_collection ? 'Modifier le montant' : 'Montant ramassage'}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {format(new Date(ramassageModalSched.departure_datetime), 'HH:mm')} — {ramassageModalSched.route_name}
                  </p>
                </div>
              </div>
              <button onClick={() => setRamassageModalSched(null)}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                style={{ color: 'var(--text-muted)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mx-6 mt-5 p-4 rounded-xl border" style={{ backgroundColor: 'var(--surface-raised)', borderColor: 'var(--border)' }}>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Origine :</span>
                  <span className="ml-1 font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {ramassageModalSched.departure_station_name}
                  </span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Bus :</span>
                  <span className="ml-1 font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {ramassageModalSched.bus_registration}
                  </span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Chauffeur :</span>
                  <span className="ml-1 font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {ramassageModalSched.driver_name}
                  </span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Places vendues :</span>
                  <span className="ml-1 font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {ramassageModalSched.seats_reserved || 0}/{ramassageModalSched.bus_capacity}
                  </span>
                </div>
              </div>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
                  Montant collecte (FCFA) *
                </label>
                <div className="relative">
                  <Banknote className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: 'var(--text-muted)' }} />
                  <input
                    type="number"
                    min="1"
                    value={ramassageAmount}
                    onChange={(e) => setRamassageAmount(e.target.value ? Number(e.target.value) : '')}
                    placeholder="Ex: 15000"
                    className="w-full pl-10 pr-4 py-3 rounded-xl border text-base font-semibold focus:outline-none focus:ring-2"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
                  Observation (optionnel)
                </label>
                <textarea
                  value={ramassageObs}
                  onChange={(e) => setRamassageObs(e.target.value)}
                  placeholder="Remarque..."
                  rows={2}
                  className="w-full px-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2 resize-none"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
                />
              </div>
              <div className="p-3 rounded-lg border" style={{ backgroundColor: '#FFF7ED', borderColor: '#FDBA74' }}>
                <p className="text-xs" style={{ color: '#9A3412' }}>
                  Le montant du ramassage sera ajoute automatiquement a la recette du jour, du bus, et de la societe.
                </p>
              </div>
            </div>

            <div className="flex gap-3 px-6 pb-6">
              <button onClick={() => setRamassageModalSched(null)}
                className="flex-1 px-4 py-3 rounded-xl border text-sm font-medium"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                Annuler
              </button>
              <button
                onClick={handleSaveRamassage}
                disabled={ramassageSaving || !ramassageAmount || Number(ramassageAmount) <= 0}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{ backgroundColor: '#EA580C' }}>
                {ramassageSaving ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Enregistrement...</>
                ) : (
                  <><Banknote className="w-4 h-4" /> Enregistrer</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Convoy modal */}
      {convoySchedule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={(e) => { if (e.target === e.currentTarget) closeConvoyModal(); }}>
          <div className="rounded-2xl shadow-xl w-full max-w-md"
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-5 border-b"
              style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: '#FFF7ED' }}>
                  <Truck className="w-5 h-5" style={{ color: '#F97316' }} />
                </div>
                <div>
                  <p className="font-bold" style={{ color: 'var(--text-primary)' }}>
                    Enregistrer un convoi
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {format(new Date(convoySchedule.departure_datetime), 'HH:mm')} — {convoySchedule.route_name}
                  </p>
                </div>
              </div>
              <button onClick={closeConvoyModal}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                style={{ color: 'var(--text-muted)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Departure info */}
            <div className="mx-6 mt-5 p-4 rounded-xl border" style={{ backgroundColor: 'var(--surface-raised)', borderColor: 'var(--border)' }}>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Bus :</span>
                  <span className="ml-1 font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {convoySchedule.bus_registration}
                  </span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Capacite :</span>
                  <span className="ml-1 font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {convoySchedule.bus_capacity} places
                  </span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Chauffeur :</span>
                  <span className="ml-1 font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {convoySchedule.driver_name}
                  </span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Destination :</span>
                  <span className="ml-1 font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {convoySchedule.arrival_station_name}
                  </span>
                </div>
              </div>
            </div>

            {/* Form */}
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
                  Montant du convoi (FCFA) *
                </label>
                <div className="relative">
                  <Banknote className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: 'var(--text-muted)' }} />
                  <input
                    type="number"
                    min="1"
                    value={convoyAmount}
                    onChange={(e) => setConvoyAmount(e.target.value ? Number(e.target.value) : '')}
                    placeholder="Ex: 500000"
                    className="w-full pl-10 pr-4 py-3 rounded-xl border text-base font-semibold focus:outline-none focus:ring-2"
                    style={{
                      borderColor: 'var(--border)',
                      backgroundColor: 'var(--surface)',
                      color: 'var(--text-primary)',
                    }}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
                  Observation (optionnel)
                </label>
                <textarea
                  value={convoyObservation}
                  onChange={(e) => setConvoyObservation(e.target.value)}
                  placeholder="Motif ou remarque..."
                  rows={2}
                  className="w-full px-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2 resize-none"
                  style={{
                    borderColor: 'var(--border)',
                    backgroundColor: 'var(--surface)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>

              {/* Confirmation warning */}
              {convoyConfirmStep && (
                <div className="p-4 rounded-xl border-2" style={{ backgroundColor: '#FEF2F2', borderColor: '#FECACA' }}>
                  <p className="text-sm font-bold mb-1" style={{ color: '#991B1B' }}>
                    Confirmer l'enregistrement du convoi ?
                  </p>
                  <p className="text-xs" style={{ color: '#B91C1C' }}>
                    Cette action est irreversible. Le depart sera cloture, toutes les places seront marquees comme vendues
                    ({convoySchedule.bus_capacity}/{convoySchedule.bus_capacity}), et aucune vente de billet ne sera plus possible.
                  </p>
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="flex gap-3 px-6 pb-6">
              <button onClick={closeConvoyModal}
                className="flex-1 px-4 py-3 rounded-xl border text-sm font-medium"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                Annuler
              </button>
              <button
                onClick={handleConvoySubmit}
                disabled={convoySubmitting || !convoyAmount || Number(convoyAmount) <= 0}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{ backgroundColor: convoyConfirmStep ? '#DC2626' : '#EA580C' }}>
                {convoySubmitting ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Enregistrement...</>
                ) : convoyConfirmStep ? (
                  'Confirmer definitivement'
                ) : (
                  <><Truck className="w-4 h-4" /> Enregistrer le convoi</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Breakdown modal */}
      {breakdownSchedule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={(e) => { if (e.target === e.currentTarget) closeBreakdownModal(); }}>
          <div className="rounded-2xl shadow-xl w-full max-w-lg"
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between px-6 py-5 border-b"
              style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: '#FEF2F2' }}>
                  <Wrench className="w-5 h-5" style={{ color: '#DC2626' }} />
                </div>
                <div>
                  <p className="font-bold" style={{ color: 'var(--text-primary)' }}>
                    Signaler une panne
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {format(new Date(breakdownSchedule.departure_datetime), 'HH:mm')} — {breakdownSchedule.route_name}
                  </p>
                </div>
              </div>
              <button onClick={closeBreakdownModal}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                style={{ color: 'var(--text-muted)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mx-6 mt-5 p-4 rounded-xl border" style={{ backgroundColor: 'var(--surface-raised)', borderColor: 'var(--border)' }}>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Bus :</span>
                  <span className="ml-1 font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {breakdownSchedule.bus_registration}
                  </span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Chauffeur :</span>
                  <span className="ml-1 font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {breakdownSchedule.driver_name}
                  </span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Passagers :</span>
                  <span className="ml-1 font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {breakdownSchedule.seats_reserved}/{breakdownSchedule.bus_capacity}
                  </span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Remplissage :</span>
                  <span className="ml-1 font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {Math.round(Number(breakdownSchedule.fill_rate ?? 0))} %
                  </span>
                </div>
              </div>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
                  Motif de la panne *
                </label>
                <input
                  type="text"
                  value={breakdownReason}
                  onChange={(e) => setBreakdownReason(e.target.value)}
                  placeholder="Ex: Probleme moteur, crevaison, surchauffe..."
                  className="w-full px-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
                  Observations (optionnel)
                </label>
                <textarea
                  value={breakdownObservation}
                  onChange={(e) => setBreakdownObservation(e.target.value)}
                  placeholder="Details complementaires, localisation, gravite..."
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2 resize-none"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
                />
              </div>
              <div className="p-3 rounded-lg border" style={{ backgroundColor: '#FEF3C7', borderColor: '#FCD34D' }}>
                <p className="text-xs" style={{ color: '#92400E' }}>
                  Le voyage passera au statut "Panne signalee" et le gestionnaire de la societe recevra une notification pour gerer le remplacement.
                </p>
              </div>
            </div>

            <div className="flex gap-3 px-6 pb-6">
              <button onClick={closeBreakdownModal}
                className="flex-1 px-4 py-3 rounded-xl border text-sm font-medium"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                Annuler
              </button>
              <button
                onClick={handleBreakdownSubmit}
                disabled={breakdownSubmitting || !breakdownReason.trim()}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{ backgroundColor: '#DC2626' }}>
                {breakdownSubmitting ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Envoi...</>
                ) : (
                  <><Wrench className="w-4 h-4" /> Signaler la panne</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assignment modal */}
      {assignModalSchedule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={(e) => { if (e.target === e.currentTarget) closeAssignModal(); }}>
          <div className="rounded-2xl shadow-xl w-full max-w-md"
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-5 border-b"
              style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: 'var(--primary-light)' }}>
                  <Link2 className="w-5 h-5" style={{ color: 'var(--primary)' }} />
                </div>
                <div>
                  <p className="font-bold" style={{ color: 'var(--text-primary)' }}>
                    {assignModalSchedule.counter_number != null ? 'Modifier l\'assignation' : 'Assigner à un guichet'}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {format(new Date(assignModalSchedule.departure_datetime), 'HH:mm')} → {assignModalSchedule.arrival_station_name}
                  </p>
                </div>
              </div>
              <button onClick={closeAssignModal}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                style={{ color: 'var(--text-muted)' }}>
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            {/* Current assignment */}
            {assignModalSchedule.counter_number != null && (
              <div className="mx-6 mt-5 px-4 py-3 rounded-xl flex items-center gap-2"
                style={{ backgroundColor: 'var(--primary-light)', border: '1px solid var(--primary)' }}>
                <Monitor className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--primary)' }} />
                <p className="text-sm font-medium" style={{ color: 'var(--primary)' }}>
                  Actuellement assigné au Guichet {assignModalSchedule.counter_number}
                </p>
              </div>
            )}

            {/* Counter selector */}
            <div className="px-6 py-5">
              <label className="block text-sm font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>
                Sélectionner le guichet
              </label>
              {counters.length === 0 ? (
                <p className="text-sm italic" style={{ color: 'var(--text-muted)' }}>
                  Aucun guichet configuré pour cette gare
                </p>
              ) : (
                <div className="space-y-2">
                  {counters.map(counter => (
                    <button
                      key={counter.id}
                      onClick={() => setSelectedCounterId(counter.id)}
                      className="w-full flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-all"
                      style={{
                        borderColor: selectedCounterId === counter.id ? 'var(--primary)' : 'var(--border)',
                        backgroundColor: selectedCounterId === counter.id ? 'var(--primary-light)' : 'transparent',
                      }}>
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg flex-shrink-0 text-white"
                        style={{ backgroundColor: counter.is_active ? 'var(--primary)' : '#9CA3AF' }}>
                        {counter.counter_number}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                          Guichet {counter.counter_number}
                        </p>
                        {counter.user_name ? (
                          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                            {counter.user_name}
                          </p>
                        ) : (
                          <p className="text-xs italic" style={{ color: 'var(--text-muted)' }}>Non assigné</p>
                        )}
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${counter.is_active ? 'text-green-700 bg-green-100' : 'text-gray-500 bg-gray-100'}`}>
                        {counter.is_active ? 'Actif' : 'Inactif'}
                      </span>
                      {selectedCounterId === counter.id && (
                        <CheckCircle2 className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--primary)' }} />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="flex gap-3 px-6 pb-6">
              <button onClick={closeAssignModal}
                className="flex-1 px-4 py-3 rounded-xl border text-sm font-medium"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                Annuler
              </button>
              <button
                onClick={handleAssign}
                disabled={assigning || !selectedCounterId}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--primary)' }}>
                {assigning ? 'Assignation...' : 'Confirmer l\'assignation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Route assignment modal */}
      {routeAssignOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setRouteAssignOpen(false); }}>
          <div className="rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between px-6 py-5 border-b flex-shrink-0"
              style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: '#DCFCE7' }}>
                  <Layers className="w-5 h-5" style={{ color: '#16A34A' }} />
                </div>
                <div>
                  <p className="font-bold" style={{ color: 'var(--text-primary)' }}>
                    Assignation des lignes aux guichets
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    Selectionnez les itineraires que chaque guichet peut vendre
                  </p>
                </div>
              </div>
              <button onClick={() => setRouteAssignOpen(false)}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                style={{ color: 'var(--text-muted)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              {availableRoutes.length === 0 ? (
                <div className="text-center py-12">
                  <Navigation className="w-10 h-10 mx-auto mb-3 opacity-30" style={{ color: 'var(--text-muted)' }} />
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    Aucune ligne active trouvee pour cette gare
                  </p>
                </div>
              ) : (
                counters.map(counter => {
                  const assigned = counterRouteMap[counter.id] || new Set();
                  const isSaving = savingRoutes === counter.id;
                  return (
                    <div key={counter.id} className="rounded-xl border overflow-hidden"
                      style={{ borderColor: 'var(--border)' }}>
                      <div className="flex items-center justify-between px-4 py-3 border-b"
                        style={{ backgroundColor: 'var(--surface-raised)', borderColor: 'var(--border)' }}>
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm text-white"
                            style={{ backgroundColor: counter.is_active ? 'var(--primary)' : '#9CA3AF' }}>
                            {counter.counter_number}
                          </div>
                          <div>
                            <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                              Guichet {counter.counter_number}
                            </p>
                            {counter.user_name && (
                              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                {counter.user_name}
                              </p>
                            )}
                          </div>
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{
                              backgroundColor: assigned.size > 0 ? '#DCFCE7' : '#F3F4F6',
                              color: assigned.size > 0 ? '#16A34A' : '#9CA3AF',
                            }}>
                            {assigned.size} ligne{assigned.size !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <button
                          onClick={() => handleSaveCounterRoutes(counter.id)}
                          disabled={isSaving}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
                          style={{ backgroundColor: '#16A34A' }}>
                          {isSaving ? (
                            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sauvegarde...</>
                          ) : (
                            <><CheckCircle2 className="w-3.5 h-3.5" /> Sauvegarder</>
                          )}
                        </button>
                      </div>
                      <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {availableRoutes.map(route => {
                          const checked = assigned.has(route.id);
                          return (
                            <button key={route.id}
                              onClick={() => toggleRouteForCounter(counter.id, route.id)}
                              className="flex items-center gap-2.5 p-2.5 rounded-lg border text-left transition-all text-sm"
                              style={{
                                borderColor: checked ? '#16A34A' : 'var(--border)',
                                backgroundColor: checked ? '#F0FDF4' : 'transparent',
                              }}>
                              <div className="w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0"
                                style={{
                                  borderColor: checked ? '#16A34A' : '#D1D5DB',
                                  backgroundColor: checked ? '#16A34A' : 'transparent',
                                }}>
                                {checked && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                              </div>
                              <span className="truncate font-medium"
                                style={{ color: checked ? '#15803D' : 'var(--text-secondary)' }}>
                                {route.name}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex-shrink-0 px-6 py-4 border-t" style={{ borderColor: 'var(--border)' }}>
              <button onClick={() => setRouteAssignOpen(false)}
                className="w-full px-4 py-3 rounded-xl border text-sm font-medium"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Schedule Modal */}
      {editSchedule && (
        <EditScheduleModal
          schedule={{
            id: editSchedule.id,
            route_name: editSchedule.route_name,
            departure_datetime: editSchedule.departure_datetime,
            arrival_datetime: editSchedule.arrival_datetime || '',
            bus_registration: editSchedule.bus_registration,
            bus_capacity: editSchedule.bus_capacity,
            driver_name: editSchedule.driver_name,
            seats_reserved: editSchedule.seats_reserved,
            status: editSchedule.status,
          }}
          stationId={station?.id || ''}
          userId={user?.id || ''}
          onClose={() => setEditSchedule(null)}
          onSaved={() => { setEditSchedule(null); loadSchedules(station!.id, selectedDate); }}
        />
      )}
    </div>
  );
}
