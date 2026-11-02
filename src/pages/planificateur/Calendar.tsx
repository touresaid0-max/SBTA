import React, { useState, useEffect, useCallback } from 'react';
import { Calendar as BigCalendar, momentLocalizer, View } from 'react-big-calendar';
import moment from 'moment';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { supabase } from '../../services/supabase';
import { Calendar as CalendarIcon, Filter, Plus, X, Clock, Bus, User, MapPin, Search, CreditCard as Edit2, History, AlertTriangle, CheckCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

moment.locale('fr');
const localizer = momentLocalizer(moment);

/* ─── types ────────────────────────────────────────────────── */

interface Schedule {
  id: string;
  route_id: string;
  bus_id: string;
  driver_id: string;
  copilot_id?: string;
  departure_datetime: string;
  arrival_datetime: string;
  status: string;
  fill_rate: number;
  route_name?: string;
  routes?: {
    id: string;
    origin_city?: { name: string };
    destination_city?: { name: string };
    origin_station?: { name: string };
    destination_station?: { name: string };
  };
  buses?: { id: string; registration_number: string; company_id: string; companies?: { name: string } };
  driver?: { full_name: string };
}

interface CalendarEvent {
  id: string; title: string; start: Date; end: Date; resource: Schedule;
}

interface BusOption {
  id: string; registration_number: string; model: string | null;
  capacity: number; status: string; companies?: { name: string };
  isAvailable: boolean; unavailableReason?: string;
}

interface DriverOption {
  id: string; full_name: string; phone?: string;
  isAvailable: boolean; unavailableReason?: string;
}

interface ChangeLog {
  id: string; change_type: string; reason: string; observation: string | null;
  changed_at: string;
  old_bus?: { registration_number: string } | null;
  new_bus?: { registration_number: string } | null;
  old_driver?: { full_name: string } | null;
  new_driver?: { full_name: string } | null;
  changer?: { full_name: string } | null;
}

type EditMode = 'bus' | 'driver' | null;

const REASONS = [
  'Panne bus',
  'Chauffeur indisponible',
  'Remplacement urgent',
  'Incident technique',
  'Erreur de planification',
  'Autre',
];

/* ─── component ─────────────────────────────────────────────── */

export default function ScheduleCalendar() {
  const navigate = useNavigate();

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('week');
  const [date, setDate] = useState(new Date());
  const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(null);

  // edit state
  const [editMode, setEditMode] = useState<EditMode>(null);
  const [editSearch, setEditSearch] = useState('');
  const [busOptions, setBusOptions] = useState<BusOption[]>([]);
  const [driverOptions, setDriverOptions] = useState<DriverOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [selectedNewBus, setSelectedNewBus] = useState<BusOption | null>(null);
  const [selectedNewDriver, setSelectedNewDriver] = useState<DriverOption | null>(null);
  const [reason, setReason] = useState('');
  const [observation, setObservation] = useState('');
  const [saving, setSaving] = useState(false);

  // history
  const [changeLogs, setChangeLogs] = useState<ChangeLog[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [filters, setFilters] = useState({ company: '', route: '', bus: '', driver: '' });
  const [companies, setCompanies] = useState<any[]>([]);
  const [routes, setRoutes] = useState<any[]>([]);
  const [filterBuses, setFilterBuses] = useState<any[]>([]);
  const [filterDrivers, setFilterDrivers] = useState<any[]>([]);

  useEffect(() => { loadFiltersData(); }, []);
  useEffect(() => { if (filterDrivers.length >= 0) loadSchedules(); }, [date, view, filters, filterDrivers]);

  /* ─── filter data ─── */

  const loadFiltersData = async () => {
    const [companiesRes, routesRes, busesRes, driversRes] = await Promise.all([
      supabase.from('companies').select('id, name').order('name'),
      supabase.from('routes').select('id, origin_city:origin_city_id(name), destination_city:destination_city_id(name)').eq('is_active', true),
      supabase.from('buses').select('id, registration_number, company_id').eq('is_active', true).order('registration_number'),
      supabase.from('users').select('id, full_name').eq('role', 'chauffeur').eq('is_active', true).order('full_name'),
    ]);
    setCompanies(companiesRes.data || []);
    setRoutes(routesRes.data || []);
    setFilterBuses(busesRes.data || []);
    setFilterDrivers(driversRes.data || []);
  };

  /* ─── schedules ─── */

  const loadSchedules = useCallback(async () => {
    setLoading(true);
    try {
      let startDate = new Date(date);
      let endDate = new Date(date);
      if (view === 'month') {
        startDate = new Date(date.getFullYear(), date.getMonth(), 1);
        endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      } else if (view === 'week') {
        const day = date.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        startDate = new Date(date); startDate.setDate(date.getDate() + diff);
        endDate = new Date(startDate); endDate.setDate(startDate.getDate() + 6);
      }
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);

      let query = supabase.from('schedules').select(`
        id, route_id, bus_id, driver_id, copilot_id,
        departure_datetime, arrival_datetime, status, fill_rate, route_name,
        routes:route_id(id, origin_city:origin_city_id(name), destination_city:destination_city_id(name),
          origin_station:origin_station_id(name), destination_station:destination_station_id(name)),
        buses:bus_id(id, registration_number, company_id, companies:company_id(name))
      `)
        .gte('departure_datetime', startDate.toISOString())
        .lte('departure_datetime', endDate.toISOString())
        .order('departure_datetime', { ascending: true });

      if (filters.route) query = query.eq('route_id', filters.route);
      if (filters.bus) query = query.eq('bus_id', filters.bus);
      if (filters.driver) query = query.eq('driver_id', filters.driver);

      const { data, error } = await query;
      if (error) throw error;

      let filtered = ((data as any[]) || []).map(s => ({
        ...s,
        driver: filterDrivers.find(d => d.id === s.driver_id)
          ? { full_name: filterDrivers.find(d => d.id === s.driver_id)!.full_name }
          : null,
      })) as Schedule[];

      if (filters.company) filtered = filtered.filter(s => s.buses?.company_id === filters.company);

      setSchedules(filtered);
      setEvents(filtered.map(s => {
        const origin = s.routes?.origin_city?.name || s.routes?.origin_station?.name || '';
        const dest = s.routes?.destination_city?.name || s.routes?.destination_station?.name || '';
        return {
          id: s.id,
          title: `${s.buses?.registration_number || 'Bus'} — ${s.route_name || (origin && dest ? `${origin} → ${dest}` : 'Voyage')}`,
          start: new Date(s.departure_datetime),
          end: new Date(s.arrival_datetime),
          resource: s,
        };
      }));
    } catch (err: any) {
      toast.error('Erreur de chargement des voyages');
    } finally { setLoading(false); }
  }, [date, view, filters, filterDrivers]);

  /* ─── open edit modal ─── */

  const openEdit = async (mode: EditMode) => {
    if (!selectedSchedule) return;
    const canEdit = ['planifie', 'en_cours'].includes(selectedSchedule.status);
    if (!canEdit) { toast.error('Ce voyage est terminé ou annulé — modification impossible.'); return; }
    setEditMode(mode);
    setEditSearch('');
    setSelectedNewBus(null);
    setSelectedNewDriver(null);
    setReason('');
    setObservation('');
    setLoadingOptions(true);

    if (mode === 'bus') {
      const { data: allBuses } = await supabase
        .from('buses')
        .select('id, registration_number, model, capacity, status, companies:company_id(name)')
        .eq('is_active', true)
        .in('status', ['disponible', 'en_service'])
        .order('registration_number');

      // find buses already busy on this slot (excluding current schedule)
      const { data: conflicts } = await supabase
        .from('schedules')
        .select('bus_id')
        .neq('id', selectedSchedule.id)
        .not('status', 'eq', 'annule')
        .lt('departure_datetime', selectedSchedule.arrival_datetime)
        .gt('arrival_datetime', selectedSchedule.departure_datetime);

      const busyBusIds = new Set((conflicts || []).map((c: any) => c.bus_id).filter(Boolean));

      setBusOptions((allBuses || []).map((b: any) => ({
        id: b.id, registration_number: b.registration_number,
        model: b.model, capacity: b.capacity, status: b.status,
        companies: b.companies,
        isAvailable: !busyBusIds.has(b.id),
        unavailableReason: busyBusIds.has(b.id) ? 'Déjà affecté sur ce créneau' : undefined,
      })));
    } else {
      const { data: allDrivers } = await supabase
        .from('users')
        .select('id, full_name, phone')
        .eq('role', 'chauffeur')
        .eq('is_active', true)
        .order('full_name');

      const { data: conflicts } = await supabase
        .from('schedules')
        .select('driver_id, copilot_id')
        .neq('id', selectedSchedule.id)
        .not('status', 'eq', 'annule')
        .lt('departure_datetime', selectedSchedule.arrival_datetime)
        .gt('arrival_datetime', selectedSchedule.departure_datetime);

      const busyDriverIds = new Set<string>();
      (conflicts || []).forEach((c: any) => {
        if (c.driver_id) busyDriverIds.add(c.driver_id);
        if (c.copilot_id) busyDriverIds.add(c.copilot_id);
      });

      setDriverOptions((allDrivers || []).map((d: any) => ({
        id: d.id, full_name: d.full_name, phone: d.phone,
        isAvailable: !busyDriverIds.has(d.id),
        unavailableReason: busyDriverIds.has(d.id) ? 'Déjà affecté sur ce créneau' : undefined,
      })));
    }
    setLoadingOptions(false);
  };

  /* ─── save change ─── */

  const saveChange = async () => {
    if (!selectedSchedule || !reason.trim()) { toast.error('Motif obligatoire'); return; }
    if (editMode === 'bus' && !selectedNewBus) { toast.error('Sélectionnez un bus'); return; }
    if (editMode === 'driver' && !selectedNewDriver) { toast.error('Sélectionnez un chauffeur'); return; }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non authentifié');

      if (editMode === 'bus') {
        const { error } = await supabase
          .from('schedules')
          .update({ bus_id: selectedNewBus!.id })
          .eq('id', selectedSchedule.id);
        if (error) throw error;

        await supabase.from('schedule_change_logs').insert({
          schedule_id: selectedSchedule.id,
          change_type: 'bus',
          old_bus_id: selectedSchedule.bus_id,
          new_bus_id: selectedNewBus!.id,
          reason: reason.trim(),
          observation: observation.trim() || null,
          changed_by: user.id,
        });

        toast.success(`Bus remplacé par ${selectedNewBus!.registration_number}`);

        // update local state so the modal reflects new data immediately
        setSelectedSchedule(prev => prev ? {
          ...prev,
          bus_id: selectedNewBus!.id,
          buses: { id: selectedNewBus!.id, registration_number: selectedNewBus!.registration_number, company_id: '', companies: selectedNewBus!.companies },
        } : null);
      } else {
        const { error } = await supabase
          .from('schedules')
          .update({ driver_id: selectedNewDriver!.id })
          .eq('id', selectedSchedule.id);
        if (error) throw error;

        await supabase.from('schedule_change_logs').insert({
          schedule_id: selectedSchedule.id,
          change_type: 'driver',
          old_driver_id: selectedSchedule.driver_id,
          new_driver_id: selectedNewDriver!.id,
          reason: reason.trim(),
          observation: observation.trim() || null,
          changed_by: user.id,
        });

        toast.success(`Chauffeur remplacé par ${selectedNewDriver!.full_name}`);

        setSelectedSchedule(prev => prev ? {
          ...prev,
          driver_id: selectedNewDriver!.id,
          driver: { full_name: selectedNewDriver!.full_name },
        } : null);
      }

      setEditMode(null);
      loadSchedules();
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors de la modification');
    } finally { setSaving(false); }
  };

  /* ─── history ─── */

  const loadHistory = async () => {
    if (!selectedSchedule) return;
    setLoadingHistory(true);
    setShowHistory(true);
    const { data, error } = await supabase
      .from('schedule_change_logs')
      .select(`
        id, change_type, reason, observation, changed_at,
        old_bus:old_bus_id(registration_number),
        new_bus:new_bus_id(registration_number),
        old_driver:old_driver_id(full_name),
        new_driver:new_driver_id(full_name),
        changer:changed_by(full_name)
      `)
      .eq('schedule_id', selectedSchedule.id)
      .order('changed_at', { ascending: false });

    if (!error) setChangeLogs((data as any) || []);
    setLoadingHistory(false);
  };

  /* ─── helpers ─── */

  const canModify = (s: Schedule) => ['planifie', 'en_cours'].includes(s.status);

  const eventStyleGetter = (event: CalendarEvent) => {
    const fr = event.resource.fill_rate || 0;
    const bg = fr >= 90 ? '#065F46' : fr >= 70 ? '#22C55E' : fr >= 40 ? '#F59E0B' : '#EF4444';
    return { style: { backgroundColor: bg, borderRadius: '4px', opacity: 0.9, color: 'white', border: '0px', fontSize: '12px', padding: '2px 4px' } };
  };

  const getStatusBadge = (status: string) => {
    const map: Record<string, { label: string; color: string; bg: string }> = {
      planifie: { label: 'Planifié',  color: '#3B82F6', bg: '#EFF6FF' },
      en_cours: { label: 'En cours', color: '#22C55E', bg: '#F0FDF4' },
      termine:  { label: 'Terminé',  color: '#6B7280', bg: '#F9FAFB' },
      annule:   { label: 'Annulé',   color: '#EF4444', bg: '#FEF2F2' },
    };
    const cfg = map[status] || { label: status, color: '#6B7280', bg: '#F9FAFB' };
    return <span className="px-2 py-1 rounded-full text-xs font-semibold" style={{ backgroundColor: cfg.bg, color: cfg.color }}>{cfg.label}</span>;
  };

  /* ─── derived filter for edit search ─── */

  const q = editSearch.trim().toLowerCase();
  const filteredBusOptions = q
    ? busOptions.filter(b => b.registration_number.toLowerCase().includes(q) || (b.model || '').toLowerCase().includes(q))
    : busOptions;
  const filteredDriverOptions = q
    ? driverOptions.filter(d => d.full_name.toLowerCase().includes(q))
    : driverOptions;

  /* ─── render ─────────────────────────────────────────────── */

  return (
    <div className="p-8">
      {/* header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Calendrier des voyages</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Planification et gestion des horaires</p>
        </div>
        <button onClick={() => navigate('/planificateur/schedules/new')}
          className="px-6 py-3 rounded-lg flex items-center gap-2 text-white font-medium"
          style={{ backgroundColor: 'var(--primary)' }}>
          <Plus className="w-5 h-5" /> Nouveau voyage
        </button>
      </div>

      {/* filters */}
      <div className="rounded-xl p-5 mb-6 border" style={{ backgroundColor: 'var(--surface, white)', borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Filter className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
            <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Filtres</h3>
          </div>
          {Object.values(filters).some(Boolean) && (
            <button onClick={() => setFilters({ company: '', route: '', bus: '', driver: '' })}
              className="flex items-center gap-1 text-sm px-3 py-1 rounded-lg border"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
              <X className="w-4 h-4" /> Effacer
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { key: 'company', label: 'Toutes les sociétés', items: companies, getLabel: (c: any) => c.name },
            { key: 'route', label: 'Tous les itinéraires', items: routes, getLabel: (r: any) => `${r.origin_city?.name || '?'} → ${r.destination_city?.name || '?'}` },
            { key: 'bus', label: 'Tous les bus', items: filterBuses, getLabel: (b: any) => b.registration_number },
            { key: 'driver', label: 'Tous les chauffeurs', items: filterDrivers, getLabel: (d: any) => d.full_name },
          ].map(({ key, label, items, getLabel }) => (
            <select key={key} value={(filters as any)[key]}
              onChange={e => setFilters(prev => ({ ...prev, [key]: e.target.value }))}
              className="px-3 py-2.5 border rounded-lg text-sm"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}>
              <option value="">{label}</option>
              {items.map((it: any) => <option key={it.id} value={it.id}>{getLabel(it)}</option>)}
            </select>
          ))}
        </div>
      </div>

      {/* calendar */}
      <div className="rounded-xl p-6 border mb-6" style={{ backgroundColor: 'var(--surface, white)', borderColor: 'var(--border)', height: '700px' }}>
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-12 h-12 border-4 rounded-full animate-spin mx-auto mb-4" style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
              <p style={{ color: 'var(--text-secondary)' }}>Chargement du calendrier...</p>
            </div>
          </div>
        ) : (
          <BigCalendar localizer={localizer} events={events}
            startAccessor="start" endAccessor="end"
            view={view} onView={setView} date={date} onNavigate={setDate}
            onSelectEvent={e => setSelectedSchedule(e.resource)}
            onSelectSlot={({ start }) => navigate('/planificateur/schedules/new', { state: { defaultDate: start } })}
            selectable eventPropGetter={eventStyleGetter} style={{ height: '100%' }}
            messages={{ next: 'Suivant', previous: 'Précédent', today: "Aujourd'hui", month: 'Mois', week: 'Semaine', day: 'Jour', agenda: 'Agenda', date: 'Date', time: 'Heure', event: 'Événement', noEventsInRange: 'Aucun voyage dans cette période', showMore: total => `+ ${total} autre(s)` }}
          />
        )}
      </div>

      {/* legend */}
      <div className="rounded-xl p-4 border" style={{ backgroundColor: 'var(--surface, white)', borderColor: 'var(--border)' }}>
        <div className="flex flex-wrap gap-4 text-sm">
          {[{ color: '#065F46', label: 'COMPLET (90%+)' }, { color: '#22C55E', label: 'BON (70-89%)' }, { color: '#F59E0B', label: 'OK (40-69%)' }, { color: '#EF4444', label: 'FAIBLE (0-39%)' }]
            .map(item => (
              <div key={item.label} className="flex items-center gap-2">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: item.color }} />
                <span style={{ color: 'var(--text-secondary)' }}>{item.label}</span>
              </div>
            ))}
          <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>Cliquez sur un créneau pour créer un voyage</span>
        </div>
      </div>

      {/* ── DETAIL MODAL ─────────────────────────────────── */}
      {selectedSchedule && !editMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={() => { setSelectedSchedule(null); setShowHistory(false); setChangeLogs([]); }}>
          <div className="rounded-2xl max-w-lg w-full mx-4 shadow-2xl overflow-hidden"
            style={{ backgroundColor: 'var(--surface, white)' }}
            onClick={e => e.stopPropagation()}>

            {/* modal header */}
            <div className="flex items-center justify-between px-8 pt-8 pb-4">
              <h3 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Détail du voyage</h3>
              <button onClick={() => { setSelectedSchedule(null); setShowHistory(false); setChangeLogs([]); }}
                className="p-2 rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
              </button>
            </div>

            <div className="px-8 pb-8 space-y-4 max-h-[80vh] overflow-y-auto">
              {/* route + status */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapPin className="w-5 h-5" style={{ color: 'var(--primary)' }} />
                  <div>
                    <p className="font-bold" style={{ color: 'var(--text-primary)' }}>
                      {selectedSchedule.route_name || `${selectedSchedule.routes?.origin_city?.name || '?'} → ${selectedSchedule.routes?.destination_city?.name || '?'}`}
                    </p>
                    {selectedSchedule.routes?.origin_station?.name && (
                      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        Gare {selectedSchedule.routes.origin_station.name} → {selectedSchedule.routes.destination_station?.name || '?'}
                      </p>
                    )}
                  </div>
                </div>
                {getStatusBadge(selectedSchedule.status)}
              </div>

              {/* times */}
              <div className="grid grid-cols-2 gap-4 p-4 rounded-xl" style={{ backgroundColor: 'var(--bg-subtle, #F9FAFB)' }}>
                {[{ label: 'Départ', dt: selectedSchedule.departure_datetime }, { label: 'Arrivée', dt: selectedSchedule.arrival_datetime }].map(({ label, dt }) => (
                  <div key={label}>
                    <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>{label}</p>
                    <p className="font-bold" style={{ color: 'var(--text-primary)' }}>{format(new Date(dt), 'dd/MM/yyyy', { locale: fr })}</p>
                    <p className="text-lg font-black" style={{ color: 'var(--primary)' }}>{format(new Date(dt), 'HH:mm')}</p>
                  </div>
                ))}
              </div>

              {/* bus row */}
              <div className="flex items-center gap-3 p-3 rounded-lg border" style={{ borderColor: 'var(--border)' }}>
                <Bus className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--primary)' }} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedSchedule.buses?.registration_number || '—'}</p>
                  {selectedSchedule.buses?.companies?.name && (
                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{selectedSchedule.buses.companies.name}</p>
                  )}
                </div>
                {canModify(selectedSchedule) && (
                  <button onClick={() => openEdit('bus')}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold border"
                    style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}>
                    <Edit2 className="w-3.5 h-3.5" /> Modifier
                  </button>
                )}
              </div>

              {/* driver row */}
              <div className="flex items-center gap-3 p-3 rounded-lg border" style={{ borderColor: 'var(--border)' }}>
                <User className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--primary)' }} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedSchedule.driver?.full_name || '—'}</p>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Chauffeur</p>
                </div>
                {canModify(selectedSchedule) && (
                  <button onClick={() => openEdit('driver')}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold border"
                    style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}>
                    <Edit2 className="w-3.5 h-3.5" /> Modifier
                  </button>
                )}
              </div>

              {/* fill rate */}
              {selectedSchedule.fill_rate !== undefined && (
                <div className="p-3 rounded-lg border" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Taux de remplissage</p>
                    <p className="font-bold" style={{ color: 'var(--text-primary)' }}>{selectedSchedule.fill_rate}%</p>
                  </div>
                  <div className="w-full h-2 rounded-full bg-gray-200 overflow-hidden">
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${selectedSchedule.fill_rate}%`, backgroundColor: selectedSchedule.fill_rate >= 70 ? '#22C55E' : selectedSchedule.fill_rate >= 40 ? '#F59E0B' : '#EF4444' }} />
                  </div>
                </div>
              )}

              {/* history toggle */}
              <button onClick={loadHistory}
                className="flex items-center gap-2 text-sm font-medium w-full justify-center py-2 rounded-lg border"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                <History className="w-4 h-4" /> Historique des modifications
              </button>

              {showHistory && (
                <div>
                  {loadingHistory ? (
                    <div className="flex justify-center py-4">
                      <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
                    </div>
                  ) : changeLogs.length === 0 ? (
                    <p className="text-sm text-center py-3" style={{ color: 'var(--text-muted)' }}>Aucune modification enregistrée</p>
                  ) : (
                    <div className="space-y-2">
                      {changeLogs.map(log => (
                        <div key={log.id} className="p-3 rounded-xl border text-sm" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle, #F9FAFB)' }}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                              {log.change_type === 'bus' ? 'Changement de bus' : 'Changement de chauffeur'}
                            </span>
                            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                              {format(new Date(log.changed_at), 'dd/MM/yyyy HH:mm')}
                            </span>
                          </div>
                          {log.change_type === 'bus' ? (
                            <p style={{ color: 'var(--text-secondary)' }}>
                              {(log.old_bus as any)?.registration_number || '?'} → <strong>{(log.new_bus as any)?.registration_number || '?'}</strong>
                            </p>
                          ) : (
                            <p style={{ color: 'var(--text-secondary)' }}>
                              {(log.old_driver as any)?.full_name || '?'} → <strong>{(log.new_driver as any)?.full_name || '?'}</strong>
                            </p>
                          )}
                          <p className="mt-1" style={{ color: 'var(--text-secondary)' }}>
                            <span className="font-medium">Motif :</span> {log.reason}
                          </p>
                          {log.observation && (
                            <p style={{ color: 'var(--text-secondary)' }}>
                              <span className="font-medium">Observation :</span> {log.observation}
                            </p>
                          )}
                          {(log.changer as any)?.full_name && (
                            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                              Par {(log.changer as any).full_name}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-8 pb-8">
              <button onClick={() => { setSelectedSchedule(null); setShowHistory(false); setChangeLogs([]); }}
                className="w-full px-4 py-2.5 rounded-lg border font-medium text-sm"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT MODAL (bus or driver) ────────────────────── */}
      {selectedSchedule && editMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
          onClick={() => setEditMode(null)}>
          <div className="rounded-2xl max-w-lg w-full mx-4 shadow-2xl overflow-hidden"
            style={{ backgroundColor: 'var(--surface, white)' }}
            onClick={e => e.stopPropagation()}>

            {/* header */}
            <div className="flex items-center justify-between px-8 pt-8 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-3">
                {editMode === 'bus' ? <Bus className="w-5 h-5" style={{ color: 'var(--primary)' }} /> : <User className="w-5 h-5" style={{ color: 'var(--primary)' }} />}
                <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                  {editMode === 'bus' ? 'Modifier le bus' : 'Modifier le chauffeur'}
                </h3>
              </div>
              <button onClick={() => setEditMode(null)} className="p-2 rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
              </button>
            </div>

            <div className="px-8 py-6 space-y-5 max-h-[75vh] overflow-y-auto">

              {/* current value */}
              <div className="px-4 py-3 rounded-xl border text-sm" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle, #F9FAFB)' }}>
                <p className="text-xs font-medium mb-0.5" style={{ color: 'var(--text-muted)' }}>
                  {editMode === 'bus' ? 'Bus actuel' : 'Chauffeur actuel'}
                </p>
                <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {editMode === 'bus' ? selectedSchedule.buses?.registration_number || '—' : selectedSchedule.driver?.full_name || '—'}
                </p>
              </div>

              {/* search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                <input type="text" value={editSearch} onChange={e => setEditSearch(e.target.value)}
                  placeholder={editMode === 'bus' ? 'Rechercher par plaque (AB-1234, 1234…)' : 'Rechercher par nom ou prénom…'}
                  className="w-full pl-9 pr-9 py-3 border rounded-xl text-sm outline-none"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
                {editSearch && (
                  <button onClick={() => setEditSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-100">
                    <X className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                  </button>
                )}
              </div>

              {/* selected new item summary */}
              {(selectedNewBus || selectedNewDriver) && (
                <div className="px-4 py-3 rounded-xl border-2 flex items-center gap-3"
                  style={{ borderColor: 'var(--primary)', backgroundColor: 'var(--primary-light)' }}>
                  <CheckCircle className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--primary)' }} />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                      {editMode === 'bus' ? selectedNewBus!.registration_number : selectedNewDriver!.full_name}
                    </p>
                    {editMode === 'bus' && selectedNewBus && (
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {[selectedNewBus.companies?.name, selectedNewBus.model, selectedNewBus.capacity ? `${selectedNewBus.capacity} places` : null].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                  <button onClick={() => editMode === 'bus' ? setSelectedNewBus(null) : setSelectedNewDriver(null)}
                    className="text-xs px-2 py-1 rounded-lg border font-medium"
                    style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}>
                    Changer
                  </button>
                </div>
              )}

              {/* list */}
              {loadingOptions ? (
                <div className="flex justify-center py-8">
                  <div className="w-8 h-8 border-4 rounded-full animate-spin" style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
                </div>
              ) : (
                <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                  {editMode === 'bus'
                    ? filteredBusOptions.map(bus => (
                        <div key={bus.id}
                          onClick={() => bus.isAvailable && setSelectedNewBus(bus)}
                          className="px-4 py-3 border-2 rounded-xl transition-all"
                          style={{
                            borderColor: selectedNewBus?.id === bus.id ? 'var(--primary)' : bus.isAvailable ? 'var(--border)' : '#E5E7EB',
                            backgroundColor: selectedNewBus?.id === bus.id ? 'var(--primary-light)' : bus.isAvailable ? 'transparent' : '#F9FAFB',
                            opacity: bus.isAvailable ? 1 : 0.5,
                            cursor: bus.isAvailable ? 'pointer' : 'not-allowed',
                          }}>
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <Bus className="w-4 h-4 flex-shrink-0" style={{ color: bus.isAvailable ? 'var(--primary)' : '#9CA3AF' }} />
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{bus.registration_number}</span>
                                  {bus.companies?.name && <><span style={{ color: 'var(--text-muted)' }}>·</span><span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{bus.companies.name}</span></>}
                                  {bus.model && <><span style={{ color: 'var(--text-muted)' }}>·</span><span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{bus.model}</span></>}
                                  {bus.capacity > 0 && <><span style={{ color: 'var(--text-muted)' }}>·</span><span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{bus.capacity} places</span></>}
                                </div>
                                <span className="text-xs font-semibold" style={{ color: bus.isAvailable ? '#16A34A' : '#DC2626' }}>
                                  {bus.isAvailable ? 'Disponible' : bus.unavailableReason || 'Non disponible'}
                                </span>
                              </div>
                            </div>
                            {selectedNewBus?.id === bus.id && <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--primary)' }} />}
                          </div>
                        </div>
                      ))
                    : filteredDriverOptions.map(driver => (
                        <div key={driver.id}
                          onClick={() => driver.isAvailable && setSelectedNewDriver(driver)}
                          className="px-4 py-3 border-2 rounded-xl transition-all"
                          style={{
                            borderColor: selectedNewDriver?.id === driver.id ? 'var(--primary)' : driver.isAvailable ? 'var(--border)' : '#E5E7EB',
                            backgroundColor: selectedNewDriver?.id === driver.id ? 'var(--primary-light)' : driver.isAvailable ? 'transparent' : '#F9FAFB',
                            opacity: driver.isAvailable ? 1 : 0.5,
                            cursor: driver.isAvailable ? 'pointer' : 'not-allowed',
                          }}>
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <User className="w-4 h-4 flex-shrink-0" style={{ color: driver.isAvailable ? 'var(--primary)' : '#9CA3AF' }} />
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{driver.full_name}</span>
                                  <span style={{ color: 'var(--text-muted)' }}>·</span>
                                  <span className="text-xs font-semibold" style={{ color: driver.isAvailable ? '#16A34A' : '#DC2626' }}>
                                    {driver.isAvailable ? 'Disponible' : driver.unavailableReason || 'Non disponible'}
                                  </span>
                                </div>
                              </div>
                            </div>
                            {selectedNewDriver?.id === driver.id && <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--primary)' }} />}
                          </div>
                        </div>
                      ))
                  }
                  {editMode === 'bus' && filteredBusOptions.length === 0 && (
                    <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>Aucun bus correspond à la recherche</p>
                  )}
                  {editMode === 'driver' && filteredDriverOptions.length === 0 && (
                    <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>Aucun chauffeur correspond à la recherche</p>
                  )}
                </div>
              )}

              {/* reason */}
              <div>
                <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--text-primary)' }}>
                  Motif de modification <span className="text-red-500">*</span>
                </label>
                <select value={reason} onChange={e => setReason(e.target.value)}
                  className="w-full px-3 py-2.5 border rounded-xl text-sm"
                  style={{ borderColor: reason ? 'var(--border)' : '#EF4444', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}>
                  <option value="">— Sélectionner un motif —</option>
                  {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              {/* observation */}
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Observation (optionnel)
                </label>
                <textarea value={observation} onChange={e => setObservation(e.target.value)}
                  rows={2} placeholder="Détails supplémentaires…"
                  className="w-full px-3 py-2.5 border rounded-xl text-sm resize-none"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
              </div>

              {/* validation warning */}
              {!reason && (
                <div className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg" style={{ backgroundColor: '#FEF9C3', color: '#92400E' }}>
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  Le motif est obligatoire pour enregistrer la modification.
                </div>
              )}
            </div>

            {/* footer actions */}
            <div className="flex gap-3 px-8 pb-8">
              <button onClick={() => setEditMode(null)}
                className="flex-1 px-4 py-2.5 rounded-lg border font-medium text-sm"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                Annuler
              </button>
              <button onClick={saveChange}
                disabled={saving || !reason || (editMode === 'bus' ? !selectedNewBus : !selectedNewDriver)}
                className="flex-1 px-4 py-2.5 rounded-lg text-white font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--primary)' }}>
                {saving ? 'Enregistrement…' : 'Enregistrer la modification'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
