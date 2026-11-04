import React, { useState, useEffect } from 'react';
import {
  Calendar, Plus, CreditCard as Edit2, Trash2, Bus, Route as RouteIcon,
  Clock, User, RotateCcw, CheckCircle2, X, History, AlertTriangle, Loader2,
  Search, Filter, MapPin, Receipt, Unlock
} from 'lucide-react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import { format, startOfDay } from 'date-fns';

function toLocalDatetimeInput(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface RouteData {
  id: string;
  name: string;
}

interface BusData {
  id: string;
  registration_number: string;
  capacity: number;
}

interface Driver {
  id: string;
  full_name: string;
}

interface Schedule {
  id: string;
  route_id: string;
  route_name: string;
  bus_id: string;
  driver_id: string;
  copilot_id?: string;
  departure_datetime: string;
  arrival_datetime: string;
  price: number;
  seats_available: number;
  seats_reserved: number;
  fill_rate: number;
  status: 'planifie' | 'en_cours' | 'termine' | 'annule';
  departure_station_id?: string | null;
  departure_number?: number | null;
  /** Set when the admin re-opened the closed departure (admin_toggle_schedule_status) */
  admin_reactivated_at?: string | null;
  routes?: { name: string };
  buses?: { registration_number: string };
  drivers?: { full_name: string };
  copilots?: { full_name: string };
}

interface ReactivationLog {
  id: string;
  schedule_id: string;
  action: string;
  old_status: string;
  new_status: string;
  reason: string;
  performed_at: string;
  user_role: string;
  user_full_name: string;
}

interface StationOption {
  id: string;
  name: string;
}

/** Expense of a departure (counter_charges), shown in the departure's window */
interface DepartureCharge {
  id: string;
  charge_type: string;
  description: string | null;
  amount: number;
  status: string;
  charge_date: string | null;
  created_at: string;
  users?: { full_name: string | null } | null;
}

/** Change of the departure or of what belongs to it (admin_schedule_history) */
interface HistoryEntry {
  id: string;
  created_at: string;
  target_type: string;
  target_id: string;
  action: string;
  user_name: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
}

const CHARGE_TYPE_LABELS: Record<string, string> = {
  ration: 'Ratio',
  carburant_complement: 'Carburant',
  peage: 'Péage',
  autres: 'Autres',
};

const CHARGE_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  en_attente: { label: 'En attente', color: '#D97706' },
  valide: { label: 'Validée', color: '#16A34A' },
  rejete: { label: 'Rejetée', color: '#DC2626' },
};

const TARGET_LABELS: Record<string, string> = {
  schedules: 'Départ',
  reservations: 'Ticket',
  counter_charges: 'Dépense',
  baggage_tickets: 'Bagage',
};

const ACTION_LABELS: Record<string, string> = { insert: 'ajouté', update: 'modifié', delete: 'supprimé' };
// « Dépense modifiée », « Ticket modifié »
const FEMININE_TARGETS = new Set(['counter_charges']);

function actionLabel(entry: { target_type: string; action: string }): string {
  const label = ACTION_LABELS[entry.action] ?? entry.action;
  return FEMININE_TARGETS.has(entry.target_type) && ACTION_LABELS[entry.action] ? `${label}e` : label;
}

// Status values as the users know them (departures, expenses, tickets, baggage)
const STATUS_VALUE_LABELS: Record<string, string> = {
  planifie: 'Planifié', en_cours: 'En cours', termine: 'Terminé', annule: 'Annulé',
  en_attente: 'En attente', valide: 'Validée', rejete: 'Rejetée',
  confirme: 'Confirmé', embarque: 'Embarqué', paye: 'Payé', annulee: 'Annulée',
};

// Fields shown in the history, with their label (the others are counted, not listed)
const FIELD_LABELS: Record<string, string> = {
  status: 'Statut',
  amount: 'Montant',
  charge_type: 'Type',
  description: 'Libellé',
  price: 'Prix',
  total_price: 'Montant',
  passenger_name: 'Passager',
  passenger_phone: 'Téléphone',
  seat_numbers: 'Sièges',
  destination: 'Destination',
  destination_city_name: 'Destination',
  owner_name: 'Propriétaire',
  payment_status: 'Paiement',
  departure_datetime: 'Départ',
  arrival_datetime: 'Arrivée',
  bus_id: 'Bus',
  driver_id: 'Chauffeur',
  seats_reserved: 'Places vendues',
  seats_total: 'Places',
  charge_date: 'Date',
};
const IGNORED_FIELDS = new Set(['updated_at', 'created_at', 'id', 'fill_rate', 'seats_available']);

function showValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'number') return value.toLocaleString('fr-FR');
  if (typeof value === 'object') return JSON.stringify(value);
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const d = new Date(text);
    if (!isNaN(d.getTime())) return format(d, 'dd/MM/yyyy HH:mm');
  }
  return text;
}

function fieldValue(key: string, value: unknown): string {
  if ((key === 'status' || key === 'payment_status') && typeof value === 'string') return STATUS_VALUE_LABELS[value] ?? value;
  if (key === 'charge_type' && typeof value === 'string') return CHARGE_TYPE_LABELS[value] ?? value;
  return showValue(value);
}

/** « Montant : 5 000 → 3 000 » lines of an update; the main values of an insert or delete */
function describeChange(entry: HistoryEntry): { lines: string[]; others: number } {
  const oldV = entry.old_values ?? {};
  const newV = entry.new_values ?? {};
  if (entry.action === 'update') {
    const changed = Object.keys(newV).filter(k => !IGNORED_FIELDS.has(k) && JSON.stringify(oldV[k]) !== JSON.stringify(newV[k]));
    const known = changed.filter(k => FIELD_LABELS[k]);
    return {
      lines: known.map(k => `${FIELD_LABELS[k]} : ${fieldValue(k, oldV[k])} → ${fieldValue(k, newV[k])}`),
      others: changed.length - known.length,
    };
  }
  const values = entry.action === 'delete' ? oldV : newV;
  const keys = ['charge_type', 'description', 'amount', 'passenger_name', 'seat_numbers', 'total_price', 'price', 'destination', 'status'];
  return {
    lines: keys.filter(k => values[k] !== undefined && values[k] !== null && values[k] !== '').map(k => `${FIELD_LABELS[k]} : ${fieldValue(k, values[k])}`),
    others: 0,
  };
}

// Departures listed per page
const PAGE_SIZE = 50;

export default function Schedules() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [routes, setRoutes] = useState<RouteData[]>([]);
  const [buses, setBuses] = useState<BusData[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Search / filter state
  const [searchRoute, setSearchRoute] = useState('');
  const [searchBus, setSearchBus] = useState('');
  const [searchDriver, setSearchDriver] = useState('');
  const [searchDeparture, setSearchDeparture] = useState('');
  const [searchArrival, setSearchArrival] = useState('');
  const [searchStation, setSearchStation] = useState('');
  const [stations, setStations] = useState<StationOption[]>([]);

  // Departure being edited, with its expenses
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [charges, setCharges] = useState<DepartureCharge[]>([]);
  const [chargesLoading, setChargesLoading] = useState(false);

  // Reactivation state
  const [reactivateModal, setReactivateModal] = useState<{ schedule: Schedule; action: 'reactivate' | 'reterminate' } | null>(null);
  const [reactivateReason, setReactivateReason] = useState('');
  const [reactivateLoading, setReactivateLoading] = useState(false);

  // History state
  const [historyModal, setHistoryModal] = useState<string | null>(null);
  const [historyLogs, setHistoryLogs] = useState<ReactivationLog[]>([]);
  const [historyChanges, setHistoryChanges] = useState<HistoryEntry[]>([]);
  const [historySince, setHistorySince] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);

  const [formData, setFormData] = useState({
    route_id: '',
    bus_id: '',
    driver_id: '',
    copilot_id: '',
    departure_datetime: '',
    arrival_datetime: '',
    price: 0,
    status: 'planifie' as 'planifie' | 'en_cours' | 'termine' | 'annule'
  });

  // Departures are read one page at a time, filtered by the database: loading the whole
  // history (and filtering here) grew every day and was capped at 1 000 rows.
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loadingPage, setLoadingPage] = useState(false);
  const [appliedFilters, setAppliedFilters] = useState({ route: '', bus: '', driver: '', departure: '', arrival: '', station: '' });

  useEffect(() => {
    loadReferences();
  }, []);

  // Typed filters are applied 300 ms after the last keystroke, from the first page
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = { route: searchRoute.trim(), bus: searchBus.trim(), driver: searchDriver.trim(), departure: searchDeparture, arrival: searchArrival, station: searchStation };
      setAppliedFilters(prev => {
        if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
        setPage(0);
        return next;
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [searchRoute, searchBus, searchDriver, searchDeparture, searchArrival, searchStation]);

  useEffect(() => {
    loadSchedules();
  }, [page, appliedFilters]);

  const nextDay = (day: string) => {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString();
  };

  const loadSchedules = async () => {
    setLoadingPage(true);
    try {
      const f = appliedFilters;
      let query = supabase
        .from('schedules')
        .select(`
          *,
          routes(name),
          buses:bus_id${f.bus ? '!inner' : ''}(registration_number),
          drivers:driver_id${f.driver ? '!inner' : ''}(full_name),
          copilots:copilot_id(full_name)
        `, { count: 'exact' });
      if (f.route) query = query.ilike('route_name', `%${f.route}%`);
      if (f.bus) query = query.ilike('buses.registration_number', `%${f.bus}%`);
      if (f.driver) query = query.ilike('drivers.full_name', `%${f.driver}%`);
      if (f.departure) query = query.gte('departure_datetime', `${f.departure}T00:00:00Z`).lt('departure_datetime', nextDay(f.departure));
      if (f.arrival) query = query.gte('arrival_datetime', `${f.arrival}T00:00:00Z`).lt('arrival_datetime', nextDay(f.arrival));
      if (f.station) query = query.eq('departure_station_id', f.station);

      const from = page * PAGE_SIZE;
      const { data, count, error } = await query
        .order('departure_datetime', { ascending: false })
        .order('id')
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;

      setSchedules(data || []);
      setTotal(count ?? 0);
    } catch (error: any) {
      toast.error('Erreur de chargement');
    } finally {
      setLoadingPage(false);
      setLoading(false);
    }
  };

  const loadReferences = async () => {
    try {
      const [routesRes, busesRes, driversRes, stationsRes] = await Promise.all([
        supabase.from('routes').select('id, name').eq('is_active', true).order('name'),
        supabase.from('buses').select('id, registration_number, capacity').eq('status', 'disponible').is('archived_at', null).order('registration_number'),
        supabase.from('users').select('id, full_name').eq('role', 'chauffeur').eq('is_active', true).order('full_name'),
        supabase.from('stations').select('id, name').order('name'),
      ]);
      if (!stationsRes.error) setStations((stationsRes.data ?? []) as StationOption[]);

      if (routesRes.error) throw routesRes.error;
      if (busesRes.error) throw busesRes.error;
      if (driversRes.error) throw driversRes.error;

      setRoutes(routesRes.data || []);
      setBuses(busesRes.data || []);
      setDrivers(driversRes.data || []);
    } catch (error: any) {
      toast.error('Erreur de chargement');
    }
  };

  // After a change: refresh the lists and the current page
  const loadData = () => Promise.all([loadReferences(), loadSchedules()]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate arrival is strictly after departure
    if (formData.departure_datetime && formData.arrival_datetime) {
      const dep = new Date(formData.departure_datetime);
      const arr = new Date(formData.arrival_datetime);
      if (arr <= dep) {
        toast.error("La date d'arrivée doit être strictement postérieure à la date de départ.");
        return;
      }
    }

    try {
      const payload = {
        route_id: formData.route_id,
        bus_id: formData.bus_id,
        driver_id: formData.driver_id,
        copilot_id: formData.copilot_id || null,
        departure_datetime: new Date(formData.departure_datetime).toISOString(),
        arrival_datetime: new Date(formData.arrival_datetime).toISOString(),
        price: formData.price,
        status: formData.status
      };

      if (editingId) {
        const { error } = await supabase
          .from('schedules')
          .update(payload)
          .eq('id', editingId);

        if (error) throw error;
        toast.success('Horaire mis à jour');
      } else {
        const { error } = await supabase
          .from('schedules')
          .insert([payload]);

        if (error) throw error;
        toast.success('Horaire créé');
      }

      closeForm();
      loadData();
    } catch (error: any) {
      console.error('Error saving schedule:', error);
      toast.error(error.message || 'Erreur lors de l\'enregistrement');
    }
  };

  const handleEdit = (schedule: Schedule) => {
    setFormData({
      route_id: schedule.route_id,
      bus_id: schedule.bus_id,
      driver_id: schedule.driver_id,
      copilot_id: schedule.copilot_id || '',
      departure_datetime: toLocalDatetimeInput(schedule.departure_datetime),
      arrival_datetime: toLocalDatetimeInput(schedule.arrival_datetime),
      // An empty price (departures made at the guichet) blocked the form: « Prix » is required
      price: schedule.price ?? 0,
      status: schedule.status
    });
    setEditingId(schedule.id);
    setEditingSchedule(schedule);
    setShowForm(true);
    void loadCharges(schedule.id);
  };

  /** Expenses recorded for the departure (ratio, carburant, péage, autres) */
  const loadCharges = async (scheduleId: string) => {
    setCharges([]);
    setChargesLoading(true);
    try {
      const { data, error } = await supabase
        .from('counter_charges')
        .select('id, charge_type, description, amount, status, charge_date, created_at, users:created_by(full_name)')
        .eq('schedule_id', scheduleId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setCharges((data ?? []) as unknown as DepartureCharge[]);
    } catch {
      toast.error('Dépenses du départ non chargées');
    } finally {
      setChargesLoading(false);
    }
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setEditingSchedule(null);
    setCharges([]);
    resetForm();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Voulez-vous vraiment supprimer cet horaire?')) return;

    try {
      const { error } = await supabase
        .from('schedules')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast.success('Horaire supprimé');
      loadData();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const resetForm = () => {
    setFormData({
      route_id: '',
      bus_id: '',
      driver_id: '',
      copilot_id: '',
      departure_datetime: '',
      arrival_datetime: '',
      price: 0,
      status: 'planifie'
    });
  };

  // --- Reactivation Logic ---
  const handleToggleStatus = async () => {
    if (!reactivateModal || !reactivateReason.trim()) {
      toast.error('Veuillez saisir un motif');
      return;
    }

    setReactivateLoading(true);
    try {
      const newStatus = reactivateModal.action === 'reactivate' ? 'en_cours' : 'termine';
      const { data, error } = await supabase.rpc('admin_toggle_schedule_status', {
        p_schedule_id: reactivateModal.schedule.id,
        p_new_status: newStatus,
        p_reason: reactivateReason.trim()
      });

      if (error) throw error;

      toast.success(
        reactivateModal.action === 'reactivate'
          ? 'Départ décloturé : le guichet peut le modifier'
          : 'Départ clôturé'
      );
      setReactivateModal(null);
      setReactivateReason('');
      if (showForm) closeForm();
      loadData();
    } catch (error: any) {
      toast.error(error.message || 'Erreur lors du changement de statut');
    } finally {
      setReactivateLoading(false);
    }
  };

  const loadHistory = async (scheduleId: string) => {
    setHistoryModal(scheduleId);
    setHistoryLoading(true);
    setHistoryChanges([]);
    setHistoryError('');
    try {
      const { data, error } = await supabase
        .from('schedule_reactivation_logs')
        .select('*')
        .eq('schedule_id', scheduleId)
        .order('performed_at', { ascending: false });

      if (error) throw error;
      const logs = (data || []) as ReactivationLog[];
      setHistoryLogs(logs);

      // Changes made since the departure was last re-opened (all of them if it never was)
      const lastReopen = logs.find(l => l.action === 'reactivate')?.performed_at ?? null;
      setHistorySince(lastReopen);
      const { data: changes, error: changesError } = await supabase.rpc('admin_schedule_history', {
        p_schedule_id: scheduleId,
        p_since: lastReopen,
      });
      if (changesError) {
        setHistoryError(/admin_schedule_history|function/i.test(changesError.message)
          ? 'Historique détaillé indisponible : appliquez la migration du 05/11/2026 dans Supabase.'
          : changesError.message);
      } else {
        setHistoryChanges((changes ?? []) as HistoryEntry[]);
      }
    } catch (error: any) {
      toast.error('Erreur chargement historique');
    } finally {
      setHistoryLoading(false);
    }
  };

  const isPastSchedule = (schedule: Schedule) => {
    const depDate = new Date(schedule.departure_datetime);
    return depDate < startOfDay(new Date());
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'planifie': return { bg: '#EFF6FF', text: '#2563EB' };
      case 'en_cours': return { bg: '#FFF7ED', text: '#EA580C' };
      case 'termine': return { bg: '#F0FDF4', text: '#16A34A' };
      case 'annule': return { bg: '#FEF2F2', text: '#DC2626' };
      default: return { bg: '#F3F4F6', text: '#6B7280' };
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'planifie': return 'Planifié';
      case 'en_cours': return 'En cours';
      case 'termine': return 'Terminé';
      case 'annule': return 'Annulé';
      default: return status;
    }
  };

  if (loading) {
    return <div className="p-8">Chargement...</div>;
  }

  const filteredSchedules = schedules;
  const hasFilters = Object.values(appliedFilters).some(Boolean);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            Planification
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            {total} horaire{total > 1 ? 's' : ''}{hasFilters ? ' (filtrés)' : ''}
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="px-6 py-3 rounded-lg flex items-center gap-2 text-white font-medium"
          style={{ backgroundColor: 'var(--primary)' }}
        >
          <Plus className="w-5 h-5" />
          Nouvel horaire
        </button>
      </div>

      {/* Search filters */}
      <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-[#64748B]" />
          <span className="text-sm font-semibold text-[#374151]">Filtres de recherche</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8]" />
            <select
              value={searchStation}
              onChange={e => setSearchStation(e.target.value)}
              title="Gare de départ"
              className="w-full pl-9 pr-3 py-2.5 border border-[#E2E8F0] rounded-lg text-sm bg-white
                         focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439] transition-colors"
            >
              <option value="">Toutes les gares</option>
              {stations.map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
            </select>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8]" />
            <input
              type="text"
              placeholder="Itinéraire..."
              value={searchRoute}
              onChange={e => setSearchRoute(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 border border-[#E2E8F0] rounded-lg text-sm
                         focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439] transition-colors"
            />
          </div>
          <div className="relative">
            <Bus className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8]" />
            <input
              type="text"
              placeholder="Bus (immatriculation)..."
              value={searchBus}
              onChange={e => setSearchBus(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 border border-[#E2E8F0] rounded-lg text-sm
                         focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439] transition-colors"
            />
          </div>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8]" />
            <input
              type="text"
              placeholder="Chauffeur..."
              value={searchDriver}
              onChange={e => setSearchDriver(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 border border-[#E2E8F0] rounded-lg text-sm
                         focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439] transition-colors"
            />
          </div>
          <div>
            <input
              type="date"
              value={searchDeparture}
              onChange={e => setSearchDeparture(e.target.value)}
              title="Date de départ"
              className="w-full px-3 py-2.5 border border-[#E2E8F0] rounded-lg text-sm
                         focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439] transition-colors"
            />
          </div>
          <div>
            <input
              type="date"
              value={searchArrival}
              onChange={e => setSearchArrival(e.target.value)}
              title="Date d'arrivée"
              className="w-full px-3 py-2.5 border border-[#E2E8F0] rounded-lg text-sm
                         focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439] transition-colors"
            />
          </div>
        </div>
        {(searchRoute || searchBus || searchDriver || searchDeparture || searchArrival || searchStation) && (
          <button
            onClick={() => { setSearchRoute(''); setSearchBus(''); setSearchDriver(''); setSearchDeparture(''); setSearchArrival(''); setSearchStation(''); }}
            className="mt-3 text-xs text-[#64748B] hover:text-[#1E293B] underline"
          >
            Effacer les filtres
          </button>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl w-full max-w-2xl my-8">
            <div className="p-6 border-b">
              <h2 className="text-2xl font-bold">
                {editingId ? 'Modifier' : 'Nouvel'} horaire
              </h2>
            </div>

            <form onSubmit={handleSubmit} className="p-6">
              <div className="space-y-4">
                <div>
                  <label className="block mb-2 font-medium">Itinéraire *</label>
                  <select
                    value={formData.route_id}
                    onChange={(e) => setFormData({ ...formData, route_id: e.target.value })}
                    className="w-full p-3 border rounded-lg"
                    required
                  >
                    <option value="">Sélectionner un itinéraire</option>
                    {routes.map(route => (
                      <option key={route.id} value={route.id}>{route.name}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block mb-2 font-medium">Bus *</label>
                    <select
                      value={formData.bus_id}
                      onChange={(e) => setFormData({ ...formData, bus_id: e.target.value })}
                      className="w-full p-3 border rounded-lg"
                      required
                    >
                      <option value="">Sélectionner un bus</option>
                      {buses.map(bus => (
                        <option key={bus.id} value={bus.id}>
                          {bus.registration_number} ({bus.capacity} places)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block mb-2 font-medium">Chauffeur *</label>
                    <select
                      value={formData.driver_id}
                      onChange={(e) => setFormData({ ...formData, driver_id: e.target.value })}
                      className="w-full p-3 border rounded-lg"
                      required
                    >
                      <option value="">Sélectionner un chauffeur</option>
                      {drivers.map(driver => (
                        <option key={driver.id} value={driver.id}>{driver.full_name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block mb-2 font-medium">Copilote (optionnel)</label>
                  <select
                    value={formData.copilot_id}
                    onChange={(e) => setFormData({ ...formData, copilot_id: e.target.value })}
                    className="w-full p-3 border rounded-lg"
                  >
                    <option value="">Aucun copilote</option>
                    {drivers.filter(d => d.id !== formData.driver_id).map(driver => (
                      <option key={driver.id} value={driver.id}>{driver.full_name}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block mb-2 font-medium">Date et heure de départ *</label>
                    <input
                      type="datetime-local"
                      value={formData.departure_datetime}
                      onChange={(e) => setFormData({ ...formData, departure_datetime: e.target.value })}
                      className="w-full p-3 border rounded-lg"
                      required
                    />
                  </div>

                  <div>
                    <label className="block mb-2 font-medium">Date et heure d'arrivée *</label>
                    <input
                      type="datetime-local"
                      value={formData.arrival_datetime}
                      onChange={(e) => setFormData({ ...formData, arrival_datetime: e.target.value })}
                      className="w-full p-3 border rounded-lg"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block mb-2 font-medium">Prix du billet (FCFA) *</label>
                  <input
                    type="number"
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
                    className="w-full p-3 border rounded-lg"
                    min="0"
                    step="100"
                    required
                  />
                </div>

                <div>
                  <label className="block mb-2 font-medium">Statut</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                    className="w-full p-3 border rounded-lg"
                  >
                    {/* A closed departure is re-opened with « Décloturer » (reason kept, guichet unlocked) */}
                    <option value="planifie" disabled={editingSchedule?.status === 'termine'}>Planifié</option>
                    <option value="en_cours" disabled={editingSchedule?.status === 'termine'}>En cours</option>
                    <option value="termine">Terminé</option>
                    <option value="annule" disabled={editingSchedule?.status === 'termine'}>Annulé</option>
                  </select>
                </div>

                {editingSchedule?.status === 'termine' && (
                  <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg border border-[#FDE68A] bg-[#FFFBEB]">
                    <AlertTriangle className="w-5 h-5 text-[#D97706] flex-shrink-0" />
                    <p className="flex-1 text-sm text-[#92400E] min-w-[200px]">
                      Ce départ est clôturé : le guichet ne peut plus le modifier.
                    </p>
                    <button
                      type="button"
                      onClick={() => setReactivateModal({ schedule: editingSchedule, action: 'reactivate' })}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-[#EA580C] hover:bg-[#C2410C]"
                    >
                      <Unlock className="w-4 h-4" /> Décloturer le départ
                    </button>
                  </div>
                )}
                {editingSchedule?.status === 'en_cours' && editingSchedule.admin_reactivated_at && (
                  <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg border border-[#BFDBFE] bg-[#EFF6FF]">
                    <Unlock className="w-5 h-5 text-[#2563EB] flex-shrink-0" />
                    <p className="flex-1 text-sm text-[#1E40AF] min-w-[200px]">
                      Décloturé le {format(new Date(editingSchedule.admin_reactivated_at), 'dd/MM/yyyy à HH:mm')} : le guichet peut le modifier.
                    </p>
                    <button
                      type="button"
                      onClick={() => loadHistory(editingSchedule.id)}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-[#BFDBFE] text-[#1E40AF] bg-white"
                    >
                      <History className="w-4 h-4" /> Historique des modifications
                    </button>
                  </div>
                )}

                {editingId && (
                  <div className="rounded-lg border">
                    <div className="flex items-center justify-between px-3 py-2 border-b bg-[#F8FAFC]">
                      <span className="flex items-center gap-2 text-sm font-semibold"><Receipt className="w-4 h-4" /> Dépenses du départ</span>
                      <span className="text-sm font-semibold text-[#DC2626]">
                        Total : {charges.filter(c => c.status !== 'rejete').reduce((sum, c) => sum + Number(c.amount || 0), 0).toLocaleString('fr-FR')} FCFA
                      </span>
                    </div>
                    {chargesLoading ? (
                      <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-[#0B7439]" /></div>
                    ) : charges.length === 0 ? (
                      <p className="px-3 py-4 text-sm text-center text-[#64748B]">Aucune dépense enregistrée pour ce départ.</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-[#64748B]">
                            <th className="px-3 py-2">Type</th>
                            <th className="px-3 py-2">Libellé</th>
                            <th className="px-3 py-2 text-right">Montant</th>
                            <th className="px-3 py-2">Statut</th>
                            <th className="px-3 py-2">Saisie par</th>
                          </tr>
                        </thead>
                        <tbody>
                          {charges.map(c => {
                            const st = CHARGE_STATUS_LABELS[c.status] ?? { label: c.status, color: '#6B7280' };
                            return (
                              <tr key={c.id} className="border-t">
                                <td className="px-3 py-2 font-medium">{CHARGE_TYPE_LABELS[c.charge_type] ?? c.charge_type}</td>
                                <td className="px-3 py-2 text-[#475569]">{c.description || '—'}</td>
                                <td className="px-3 py-2 text-right font-semibold" style={{ textDecoration: c.status === 'rejete' ? 'line-through' : undefined }}>{Number(c.amount || 0).toLocaleString('fr-FR')} FCFA</td>
                                <td className="px-3 py-2 text-xs font-semibold" style={{ color: st.color }}>{st.label}</td>
                                <td className="px-3 py-2 text-xs text-[#64748B]">
                                  {c.users?.full_name ?? '—'}
                                  <div>{format(new Date(c.created_at), 'dd/MM/yyyy HH:mm')}</div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>

              <div className="flex gap-4 mt-6">
                <button
                  type="submit"
                  className="px-6 py-3 rounded-lg text-white font-medium"
                  style={{ backgroundColor: 'var(--primary)' }}
                >
                  {editingId ? 'Mettre à jour' : 'Créer'}
                </button>
                <button
                  type="button"
                  onClick={closeForm}
                  className="px-6 py-3 rounded-lg border"
                >
                  Annuler
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reactivation Modal */}
      {reactivateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className="p-6 border-b border-[#F1F5F9]">
              <div className="flex items-center gap-3">
                {reactivateModal.action === 'reactivate' ? (
                  <div className="w-10 h-10 rounded-full bg-[#FFF7ED] flex items-center justify-center">
                    <RotateCcw className="w-5 h-5 text-[#EA580C]" />
                  </div>
                ) : (
                  <div className="w-10 h-10 rounded-full bg-[#F0FDF4] flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5 text-[#16A34A]" />
                  </div>
                )}
                <div>
                  <h3 className="text-lg font-bold text-[#1E293B]">
                    {reactivateModal.action === 'reactivate' ? 'Décloturer le départ' : 'Clôturer le départ'}
                  </h3>
                  <p className="text-sm text-[#64748B]">
                    {reactivateModal.schedule.routes?.name || 'N/A'} - {format(new Date(reactivateModal.schedule.departure_datetime), 'dd/MM/yyyy HH:mm')}
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-4">
              {reactivateModal.action === 'reactivate' && (
                <div className="flex items-start gap-3 p-3 bg-[#FFFBEB] rounded-lg border border-[#FDE68A]">
                  <AlertTriangle className="w-5 h-5 text-[#D97706] flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-[#92400E]">
                    Le départ sera décloturé (statut « En cours ») : le guichet le verra rouvert sur son poste à sa prochaine synchronisation et pourra modifier ses ventes, bagages et dépenses. Les modifications seront visibles dans l'historique.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-[#374151] mb-2">
                  Motif de {reactivateModal.action === 'reactivate' ? 'la réactivation' : 'la clôture'} *
                </label>
                <textarea
                  value={reactivateReason}
                  onChange={(e) => setReactivateReason(e.target.value)}
                  placeholder="Saisissez le motif obligatoire..."
                  rows={3}
                  className="w-full p-3 border border-[#D1D5DB] rounded-lg text-sm focus:ring-2 focus:ring-[#0B7439] focus:border-transparent resize-none"
                  autoFocus
                />
              </div>
            </div>

            <div className="p-6 border-t border-[#F1F5F9] flex gap-3">
              <button
                onClick={() => { setReactivateModal(null); setReactivateReason(''); }}
                className="flex-1 px-4 py-2.5 border border-[#D1D5DB] rounded-lg text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleToggleStatus}
                disabled={reactivateLoading || !reactivateReason.trim()}
                className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium text-white transition-colors
                  flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed
                  ${reactivateModal.action === 'reactivate'
                    ? 'bg-[#EA580C] hover:bg-[#C2410C]'
                    : 'bg-[#16A34A] hover:bg-[#15803D]'
                  }`}
              >
                {reactivateLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                {reactivateModal.action === 'reactivate' ? 'Décloturer' : 'Clôturer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History Modal */}
      {historyModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[85vh] flex flex-col">
            <div className="p-6 border-b border-[#F1F5F9] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#F1F5F9] flex items-center justify-center">
                  <History className="w-5 h-5 text-[#475569]" />
                </div>
                <h3 className="text-lg font-bold text-[#1E293B]">Historique des modifications</h3>
              </div>
              <button onClick={() => setHistoryModal(null)} className="p-2 hover:bg-[#F1F5F9] rounded-lg">
                <X className="w-5 h-5 text-[#64748B]" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {historyLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-[#0B7439]" />
                </div>
              ) : (
                <div className="space-y-6">
                  <section>
                    <h4 className="text-sm font-bold text-[#1E293B] mb-1">
                      {historySince
                        ? `Modifications depuis la réouverture du ${format(new Date(historySince), 'dd/MM/yyyy à HH:mm')}`
                        : 'Modifications du départ'}
                    </h4>
                    <p className="text-xs text-[#64748B] mb-3">Départ, tickets, bagages et dépenses, du plus récent au plus ancien.</p>
                    {historyError ? (
                      <p className="text-sm text-[#B45309]">{historyError}</p>
                    ) : historyChanges.length === 0 ? (
                      <p className="text-sm text-[#64748B]">Aucune modification{historySince ? ' depuis la réouverture' : ''}.</p>
                    ) : (
                      <div className="space-y-2">
                        {historyChanges.map(entry => {
                          const { lines, others } = describeChange(entry);
                          return (
                            <div key={entry.id} className="border border-[#E2E8F0] rounded-lg px-3 py-2">
                              <div className="flex flex-wrap items-center gap-2 text-sm">
                                <span className="font-semibold text-[#1E293B]">
                                  {TARGET_LABELS[entry.target_type] ?? entry.target_type} {actionLabel(entry)}
                                </span>
                                <span className="text-xs text-[#64748B]">par {entry.user_name}</span>
                                <span className="ml-auto text-xs text-[#64748B]">{format(new Date(entry.created_at), 'dd/MM/yyyy HH:mm')}</span>
                              </div>
                              {lines.length > 0 && (
                                <ul className="mt-1 text-xs text-[#475569] space-y-0.5">
                                  {lines.map(line => <li key={line}>{line}</li>)}
                                </ul>
                              )}
                              {others > 0 && <p className="mt-1 text-xs text-[#94A3B8]">{others} autre{others > 1 ? 's' : ''} champ{others > 1 ? 's' : ''} technique{others > 1 ? 's' : ''} modifié{others > 1 ? 's' : ''}</p>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  <section>
                    <h4 className="text-sm font-bold text-[#1E293B] mb-3">Clôtures et réouvertures</h4>
                    {historyLogs.length === 0 ? (
                      <p className="text-sm text-[#64748B]">Ce départ n'a jamais été décloturé.</p>
                    ) : (
                      <div className="space-y-3">
                        {historyLogs.map(log => (
                          <div key={log.id} className="border border-[#E2E8F0] rounded-xl p-4">
                            <div className="flex items-center gap-2 mb-2">
                              {log.action === 'reactivate' ? (
                                <RotateCcw className="w-4 h-4 text-[#EA580C]" />
                              ) : (
                                <CheckCircle2 className="w-4 h-4 text-[#16A34A]" />
                              )}
                              <span className="text-sm font-semibold text-[#1E293B]">
                                {log.action === 'reactivate' ? 'Déclôture' : 'Clôture'}
                              </span>
                              <span className="ml-auto text-xs text-[#64748B]">
                                {format(new Date(log.performed_at), 'dd/MM/yyyy HH:mm')}
                              </span>
                            </div>
                            <div className="text-xs text-[#64748B] space-y-1">
                              <p><span className="font-medium text-[#374151]">Par :</span> {log.user_full_name} ({log.user_role})</p>
                              <p><span className="font-medium text-[#374151]">Statut :</span> {getStatusLabel(log.old_status)} → {getStatusLabel(log.new_status)}</p>
                              <p><span className="font-medium text-[#374151]">Motif :</span> {log.reason}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border overflow-hidden">
        <table className="w-full">
          <thead style={{ backgroundColor: 'var(--neutral-100)' }}>
            <tr>
              <th className="text-left p-4 font-semibold">N°</th>
              <th className="text-left p-4 font-semibold">Itinéraire</th>
              <th className="text-left p-4 font-semibold">Bus</th>
              <th className="text-left p-4 font-semibold">Chauffeur</th>
              <th className="text-left p-4 font-semibold">Départ</th>
              <th className="text-left p-4 font-semibold">Arrivée</th>
              <th className="text-left p-4 font-semibold">Occupation</th>
              <th className="text-left p-4 font-semibold">Prix</th>
              <th className="text-left p-4 font-semibold">Statut</th>
              <th className="text-left p-4 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredSchedules.map((schedule, index) => {
              const statusColors = getStatusColor(schedule.status);
              const past = isPastSchedule(schedule);
              // Any closed departure can be re-opened (today's too), then closed again
              const canReactivate = schedule.status === 'termine';
              const canReterminate = schedule.status === 'en_cours' && (past || !!schedule.admin_reactivated_at);
              return (
                <tr key={schedule.id} className="border-t hover:bg-gray-50">
                  <td className="p-4 text-sm font-semibold text-[#64748B]">{page * PAGE_SIZE + index + 1}</td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <RouteIcon className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                      <span className="font-medium">{schedule.route_name || schedule.routes?.name || 'N/A'}</span>
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <Bus className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                      {schedule.buses?.registration_number || 'N/A'}
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                      <div>
                        <div className="font-medium">{schedule.drivers?.full_name || 'N/A'}</div>
                        {schedule.copilots?.full_name && (
                          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                            Copilote: {schedule.copilots.full_name}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                      <div>
                        <div className="text-sm font-medium">
                          {format(new Date(schedule.departure_datetime), 'HH:mm')}
                        </div>
                        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          {format(new Date(schedule.departure_datetime), 'dd/MM/yyyy')}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="text-sm font-medium">
                      {format(new Date(schedule.arrival_datetime), 'HH:mm')}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {format(new Date(schedule.arrival_datetime), 'dd/MM/yyyy')}
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="text-sm">
                      <div className="font-medium">{schedule.seats_reserved || 0}/{schedule.seats_available || 0}</div>
                      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {schedule.fill_rate?.toFixed(0) || 0}% rempli
                      </div>
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="font-medium">{schedule.price?.toLocaleString() || 0} FCFA</div>
                  </td>
                  <td className="p-4">
                    <span
                      className="px-3 py-1 rounded-full text-xs font-medium"
                      style={{
                        backgroundColor: statusColors.bg,
                        color: statusColors.text
                      }}
                    >
                      {getStatusLabel(schedule.status)}
                    </span>
                    {schedule.status !== 'termine' && schedule.admin_reactivated_at && (
                      <div className="mt-1 text-[11px] font-medium text-[#EA580C]">Décloturé</div>
                    )}
                  </td>
                  <td className="p-4">
                    <div className="flex gap-1 items-center">
                      {/* Reactivation buttons */}
                      {canReactivate && (
                        <button
                          onClick={() => setReactivateModal({ schedule, action: 'reactivate' })}
                          className="p-2 hover:bg-[#FFF7ED] rounded-lg transition-colors group"
                          title="Décloturer ce départ"
                        >
                          <RotateCcw className="w-4 h-4 text-[#EA580C] group-hover:text-[#C2410C]" />
                        </button>
                      )}
                      {canReterminate && (
                        <button
                          onClick={() => setReactivateModal({ schedule, action: 'reterminate' })}
                          className="p-2 hover:bg-[#F0FDF4] rounded-lg transition-colors group"
                          title="Clôturer ce départ"
                        >
                          <CheckCircle2 className="w-4 h-4 text-[#16A34A] group-hover:text-[#15803D]" />
                        </button>
                      )}
                      {/* History of the departure's changes */}
                      {(

                        <button
                          onClick={() => loadHistory(schedule.id)}
                          className="p-2 hover:bg-[#F1F5F9] rounded-lg transition-colors"
                          title="Historique des modifications"
                        >
                          <History className="w-4 h-4 text-[#64748B]" />
                        </button>
                      )}
                      <button
                        onClick={() => handleEdit(schedule)}
                        className="p-2 hover:bg-gray-100 rounded-lg"
                        title="Modifier"
                      >
                        <Edit2 className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                      </button>
                      <button
                        onClick={() => handleDelete(schedule.id)}
                        className="p-2 hover:bg-gray-100 rounded-lg"
                        title="Supprimer"
                      >
                        <Trash2 className="w-4 h-4" style={{ color: 'var(--danger)' }} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filteredSchedules.length === 0 && (
          <div className="text-center py-12">
            <Calendar className="w-16 h-16 mx-auto mb-4" style={{ color: 'var(--neutral-400)' }} />
            <p style={{ color: 'var(--text-secondary)' }}>
              {hasFilters ? 'Aucun résultat pour ces filtres' : 'Aucun horaire trouvé'}
            </p>
          </div>
        )}
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <span>
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} sur {total}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0 || loadingPage}
              className="px-3 py-1.5 border border-[#E2E8F0] rounded-lg disabled:opacity-40"
            >
              Précédent
            </button>
            <span>Page {page + 1} / {pageCount}</span>
            <button
              onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
              disabled={page >= pageCount - 1 || loadingPage}
              className="px-3 py-1.5 border border-[#E2E8F0] rounded-lg disabled:opacity-40"
            >
              Suivant
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
