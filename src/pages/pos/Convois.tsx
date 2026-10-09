import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import POSLayout from '@/components/pos/POSLayout';
import { usePOSSession } from '@/services/pos/POSSessionContext';
import { supabase } from '@/services/supabase';
import { useAuthStore } from '@/store/authStore';
import toast from 'react-hot-toast';
import {
  Truck, Plus, Search, X, AlertTriangle, User, Banknote,
  CreditCard as Edit3, ChevronRight, RotateCcw, Receipt, Printer,
} from 'lucide-react';
import { format, parseISO, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import { formatCurrency, formatNumber } from '@/utils/formatCurrency';
import { printConvoyBordereau, type PrintConvoyData } from '@/services/pos/printService';
import ChangeRequestButton from '@/components/shared/ChangeRequestButton';

// ─── Types ────────────────────────────────────────────────────────────────────
interface RouteOption {
  id: string; name: string; base_price: number; estimated_duration_minutes?: number | null;
  origin_city: { id: string; name: string } | null;
  destination_city: { id: string; name: string } | null;
  origin_city_id: string; destination_city_id: string;
}
interface BusOption {
  id: string; registration_number: string; model: string | null; capacity: number;
  company: { id: string; name: string } | null; company_id: string | null;
}
interface DriverOption { id: string; full_name: string; phone: string | null }
interface StationOption { id: string; name: string; city_id: string }
interface CityOption { id: string; name: string; route_id: string; origin_name: string }

interface ConvoyRow {
  id: string;
  schedule_id: string;
  amount: number;
  trip_type: 'aller_simple' | 'aller_retour';
  passengers_count: number;
  ratio_amount: number;
  carburant_amount: number;
  peage_amount: number;
  autres_amount: number;
  observation: string | null;
  created_at: string;
  return_convoy_id: string | null;
  departure_datetime: string;
  return_departure_datetime: string | null;
  route_id: string;
  route_name: string;
  origin_city: string;
  destination_city: string;
  bus_id: string;
  bus_registration: string;
  bus_capacity: number;
  company_name: string;
  driver_id: string;
  driver_name: string;
  station_name: string;
}

interface ConvoyForm {
  trip_type: 'aller_simple' | 'aller_retour';
  route_id: string;
  departure_station_id: string;
  arrival_station_id: string;
  departure_datetime: string;
  arrival_datetime: string;
  bus_id: string;
  driver_id: string;
  passengers_count: string;
  amount: string;
  ratio_amount: string;
  carburant_amount: string;
  peage_amount: string;
  autres_amount: string;
  observation: string;
  retour_route_id: string;
  retour_departure_datetime: string;
  retour_arrival_datetime: string;
}

const EMPTY_FORM: ConvoyForm = {
  trip_type: 'aller_simple',
  route_id: '', departure_station_id: '', arrival_station_id: '',
  departure_datetime: '', arrival_datetime: '',
  bus_id: '', driver_id: '', passengers_count: '', amount: '',
  ratio_amount: '', carburant_amount: '', peage_amount: '', autres_amount: '',
  observation: '',
  retour_route_id: '', retour_departure_datetime: '', retour_arrival_datetime: '',
};

type PeriodPreset = 'today' | 'week' | 'month' | 'custom';

// ─── Autocomplete (self-contained) ────────────────────────────────────────────
interface AutocompleteProps<T> {
  items: T[];
  value: string;
  onChange: (id: string) => void;
  getLabel: (item: T) => string;
  getSub?: (item: T) => string;
  placeholder: string;
  renderExtra?: (item: T) => React.ReactNode;
}
function Autocomplete<T extends { id: string }>({
  items, value, onChange, getLabel, getSub, placeholder, renderExtra,
}: AutocompleteProps<T>) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = items.find(i => i.id === value);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? items.filter(i => getLabel(i).toLowerCase().includes(q) || (getSub?.(i)?.toLowerCase().includes(q) ?? false))
    : items;

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
        <input
          type="text"
          value={selected ? getLabel(selected) : query}
          onChange={e => { setQuery(e.target.value); onChange(''); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="w-full pl-9 pr-8 py-2.5 border rounded-lg text-sm outline-none focus:ring-2"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
        />
        {selected && (
          <button
            type="button"
            onClick={() => { onChange(''); setQuery(''); setOpen(true); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-100"
          >
            <X className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
          </button>
        )}
      </div>
      {open && filtered.length > 0 && (
        <div
          className="absolute z-30 left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-lg shadow-lg border"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          {filtered.slice(0, 30).map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => { onChange(item.id); setOpen(false); setQuery(''); }}
              className="w-full flex items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50 transition-colors"
              style={{ color: 'var(--text-primary)' }}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{getLabel(item)}</span>
                {getSub && <span className="block truncate text-xs" style={{ color: 'var(--text-muted)' }}>{getSub(item)}</span>}
              </span>
              {renderExtra?.(item)}
            </button>
          ))}
        </div>
      )}
      {open && filtered.length === 0 && (
        <div
          className="absolute z-30 left-0 right-0 mt-1 rounded-lg shadow-lg border px-3 py-2 text-sm"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text-muted)' }}
        >
          Aucun résultat
        </div>
      )}
    </div>
  );
}

// ─── Main POS Convoi page ─────────────────────────────────────────────────────
export default function POSConvois() {
  const { session } = usePOSSession();
  const { user } = useAuthStore();

  const stationId = session?.station_id ?? null;
  const stationName = session?.station_name ?? null;
  const counterId = session?.counter_id ?? null;
  const assignedRouteIds = session?.assigned_route_ids ?? null;

  // Master data
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [allRoutes, setAllRoutes] = useState<RouteOption[]>([]);
  const [systemRoutes, setSystemRoutes] = useState<RouteOption[]>([]);
  const [buses, setBuses] = useState<BusOption[]>([]);
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [allStations, setAllStations] = useState<StationOption[]>([]);
  const [loading, setLoading] = useState(true);

  // Convoys list
  const [convoys, setConvoys] = useState<ConvoyRow[]>([]);
  const [listLoading, setListLoading] = useState(true);

  // Filters
  const [preset, setPreset] = useState<PeriodPreset>('today');
  const [dateFrom, setDateFrom] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [filterRoute, setFilterRoute] = useState('');
  const [filterBus, setFilterBus] = useState('');

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editConvoy, setEditConvoy] = useState<ConvoyRow | null>(null);
  const [form, setForm] = useState<ConvoyForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  // ─── Load master data ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!stationId) { setLoading(false); return; }
    (async () => {
      try {
        const { data: stData } = await supabase
          .from('stations').select('id, name, city_id').eq('id', stationId).maybeSingle();
        if (!stData) { setLoading(false); return; }

        // Resolve assigned route IDs for this counter (from session or DB)
        let assignedIds = assignedRouteIds;
        if ((!assignedIds || assignedIds.length === 0) && counterId) {
          try {
            const { data: cr } = await supabase
              .from('counter_routes')
              .select('route_id')
              .eq('counter_id', counterId);
            assignedIds = (cr ?? []).map(r => r.route_id as string);
          } catch { /* non-critical */ }
        }

        const [routesRes, systemRoutesRes, busesRes, driversRes, stationsRes] = await Promise.all([
          supabase
            .from('routes')
            .select('id, name, base_price, estimated_duration_minutes, origin_city_id, destination_city_id, origin_city:origin_city_id(id,name), destination_city:destination_city_id(id,name)')
            .eq('is_active', true)
            .or(`origin_station_id.eq.${stData.id},and(origin_station_id.is.null,origin_city_id.eq.${stData.city_id})`)
            .order('name'),
          supabase
            .from('routes')
            .select('id, name, base_price, estimated_duration_minutes, origin_city_id, destination_city_id, origin_city:origin_city_id(id,name), destination_city:destination_city_id(id,name)')
            .eq('is_active', true)
            .order('name'),
          supabase
            .from('buses')
            .select('id, registration_number, model, capacity, company_id, company:company_id(id, name)')
            .in('status', ['disponible', 'en_service'])
            .order('registration_number'),
          supabase
            .from('users').select('id, full_name, phone')
            .eq('role', 'chauffeur').eq('is_active', true).order('full_name'),
          supabase
            .from('stations').select('id, name, city_id').eq('is_active', true).order('name'),
        ]);

        const allStationRoutes = (routesRes.data || []) as unknown as RouteOption[];
        // Filter to only routes assigned to this guichetier's counter
        const myRoutes = assignedIds && assignedIds.length > 0
          ? allStationRoutes.filter(r => assignedIds.includes(r.id))
          : allStationRoutes;

        setRoutes(myRoutes);
        setAllRoutes(allStationRoutes);
        setSystemRoutes((systemRoutesRes.data || []) as unknown as RouteOption[]);
        setBuses((busesRes.data || []) as unknown as BusOption[]);
        setDrivers((driversRes.data || []) as unknown as DriverOption[]);
        setAllStations((stationsRes.data || []) as unknown as StationOption[]);
      } catch (err: any) {
        toast.error(err.message || 'Erreur de chargement');
      } finally {
        setLoading(false);
      }
    })();
  }, [stationId, counterId, assignedRouteIds]);

  // ─── Load convoys list ──────────────────────────────────────────────────────
  const applyPreset = useCallback((p: PeriodPreset) => {
    setPreset(p);
    const now = new Date();
    if (p === 'today') {
      const d = format(now, 'yyyy-MM-dd'); setDateFrom(d); setDateTo(d);
    } else if (p === 'week') {
      setDateFrom(format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
      setDateTo(format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
    } else if (p === 'month') {
      setDateFrom(format(startOfMonth(now), 'yyyy-MM-dd'));
      setDateTo(format(endOfMonth(now), 'yyyy-MM-dd'));
    }
  }, []);

  const loadConvoys = useCallback(async () => {
    if (!stationId) return;
    setListLoading(true);
    try {
      const { data, error } = await supabase
        .from('convoys')
        .select(`
          id, schedule_id, amount, trip_type, passengers_count,
          ratio_amount, carburant_amount, peage_amount, autres_amount,
          observation, created_at, return_convoy_id,
          return_convoy:return_convoy_id ( schedule:schedule_id ( departure_datetime ) ),
          schedule:schedule_id (
            id, departure_datetime, departure_station_id, route_id, bus_id, driver_id,
            route:route_id ( id, name, origin_city:origin_city_id(name), destination_city:destination_city_id(name) ),
            bus:bus_id ( id, registration_number, capacity, company:company_id(id, name) ),
            driver:driver_id ( id, full_name ),
            station:departure_station_id ( id, name )
          )
        `)
        .gte('created_at', `${dateFrom}T00:00:00`)
        .lte('created_at', `${dateTo}T23:59:59`)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const rows: ConvoyRow[] = (data || [])
        .filter((c: any) => c.schedule?.station?.id === stationId)
        .map((c: any) => {
          const s = c.schedule;
          const r = s?.route;
          const b = s?.bus;
          const d = s?.driver;
          return {
            id: c.id,
            schedule_id: s?.id,
            amount: Number(c.amount),
            trip_type: c.trip_type,
            passengers_count: c.passengers_count ?? 0,
            ratio_amount: Number(c.ratio_amount ?? 0),
            carburant_amount: Number(c.carburant_amount ?? 0),
            peage_amount: Number(c.peage_amount ?? 0),
            autres_amount: Number(c.autres_amount ?? 0),
            observation: c.observation,
            created_at: c.created_at,
            return_convoy_id: c.return_convoy_id,
            departure_datetime: s?.departure_datetime,
            return_departure_datetime: c.return_convoy?.schedule?.departure_datetime || null,
            route_id: s?.route_id,
            route_name: r?.name || '—',
            origin_city: r?.origin_city?.name || '—',
            destination_city: r?.destination_city?.name || '—',
            bus_id: s?.bus_id,
            bus_registration: b?.registration_number || '—',
            bus_capacity: b?.capacity ?? 0,
            company_name: b?.company?.name || '—',
            driver_id: s?.driver_id,
            driver_name: d?.full_name || '—',
            station_name: s?.station?.name || '—',
          };
        });

      setConvoys(rows);
    } catch (err: any) {
      toast.error(err.message || 'Erreur de chargement des convois');
    } finally {
      setListLoading(false);
    }
  }, [stationId, dateFrom, dateTo]);

  useEffect(() => { loadConvoys(); }, [loadConvoys]);

  // ─── Derived ────────────────────────────────────────────────────────────────
  const selectedRoute = systemRoutes.find(r => r.id === form.route_id) || routes.find(r => r.id === form.route_id) || null;
  const cityOptions = useMemo<CityOption[]>(() => {
    const seen = new Set<string>();
    return systemRoutes.flatMap(route => {
      const city = route.destination_city;
      if (!city || seen.has(city.id)) return [];
      seen.add(city.id);
      return [{ id: route.id, name: city.name, route_id: route.id, origin_name: route.origin_city?.name || '—' }];
    });
  }, [systemRoutes]);
  const returnCityOptions = useMemo<CityOption[]>(() => {
    const seen = new Set<string>();
    return systemRoutes.flatMap(route => {
      const city = route.destination_city;
      if (!city || seen.has(city.id)) return [];
      seen.add(city.id);
      return [{ id: route.id, name: city.name, route_id: route.id, origin_name: route.origin_city?.name || '—' }];
    });
  }, [systemRoutes]);
  const selectedBus = buses.find(b => b.id === form.bus_id) || null;
  const getMatchingReturnRouteId = (routeId: string) => {
    const destination = cityOptions.find(city => city.route_id === routeId)?.name;
    return returnCityOptions.find(city => city.name === destination)?.route_id || '';
  };
  const busCapacity = selectedBus?.capacity ?? 0;
  const passengers = parseInt(form.passengers_count) || 0;
  const isOverload = busCapacity > 0 && passengers > busCapacity;

  const totalCharges = (Number(form.ratio_amount) || 0) + (Number(form.carburant_amount) || 0)
    + (Number(form.peage_amount) || 0) + (Number(form.autres_amount) || 0);
  const solde = (Number(form.amount) || 0) - totalCharges;

  const filteredConvoys = useMemo(() => convoys.filter(c => {
    if (filterRoute && c.route_id !== filterRoute) return false;
    if (filterBus && c.bus_id !== filterBus) return false;
    return true;
  }), [convoys, filterRoute, filterBus]);

  const kpis = useMemo(() => {
    const totalAmount = filteredConvoys.reduce((s, c) => s + c.amount, 0);
    const totalChargesAll = filteredConvoys.reduce((s, c) => s + c.ratio_amount + c.carburant_amount + c.peage_amount + c.autres_amount, 0);
    const totalRatio = filteredConvoys.reduce((s, c) => s + c.ratio_amount, 0);
    const totalCarburant = filteredConvoys.reduce((s, c) => s + c.carburant_amount, 0);
    const totalPeage = filteredConvoys.reduce((s, c) => s + c.peage_amount, 0);
    const totalAutres = filteredConvoys.reduce((s, c) => s + c.autres_amount, 0);
    const totalSolde = totalAmount - totalChargesAll;
    const totalPassengers = filteredConvoys.reduce((s, c) => s + c.passengers_count, 0);
    return {
      totalAmount, totalChargesAll, totalSolde,
      totalRatio, totalCarburant, totalPeage, totalAutres,
      count: filteredConvoys.length, totalPassengers,
    };
  }, [filteredConvoys]);

  // ─── Modal handlers ─────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditConvoy(null);
    setForm({
      ...EMPTY_FORM,
      departure_station_id: stationId || '',
      departure_datetime: `${format(new Date(), 'yyyy-MM-dd')}T08:00`,
      arrival_datetime: `${format(new Date(), 'yyyy-MM-dd')}T12:00`,
      retour_departure_datetime: `${format(new Date(), 'yyyy-MM-dd')}T14:00`,
      retour_arrival_datetime: `${format(new Date(), 'yyyy-MM-dd')}T20:00`,
    });
    setShowModal(true);
  };

  const openEdit = (c: ConvoyRow) => {
    setEditConvoy(c);
    setForm({
      trip_type: c.trip_type,
      route_id: c.route_id,
      departure_station_id: stationId || '',
      arrival_station_id: '',
      departure_datetime: c.departure_datetime ? c.departure_datetime.slice(0, 16) : '',
      arrival_datetime: '',
      bus_id: c.bus_id,
      driver_id: c.driver_id,
      passengers_count: String(c.passengers_count),
      amount: String(c.amount),
      ratio_amount: String(c.ratio_amount),
      carburant_amount: String(c.carburant_amount),
      peage_amount: String(c.peage_amount),
      autres_amount: String(c.autres_amount),
      observation: c.observation || '',
      retour_route_id: '', retour_departure_datetime: '', retour_arrival_datetime: '',
    });
    setShowModal(true);
  };

  const closeModal = () => { setShowModal(false); setEditConvoy(null); setForm(EMPTY_FORM); };

  useEffect(() => {
    if (!selectedRoute || !showModal) return;
    const arrStation = allStations.find(s => s.city_id === selectedRoute.destination_city_id);
    setForm(prev => ({
      ...prev,
      arrival_station_id: arrStation?.id || prev.arrival_station_id,
      amount: prev.amount || String(selectedRoute.base_price || ''),
    }));
  }, [form.route_id]); // eslint-disable-line

  const canSubmit = form.route_id && form.bus_id && form.driver_id
    && form.departure_datetime && Number(form.amount) > 0
    && (editConvoy || form.trip_type === 'aller_simple' || (form.retour_route_id && form.retour_departure_datetime));

  // ─── Print bordereau ────────────────────────────────────────────────────────
  const handlePrint = async (c: ConvoyRow) => {
    const printData: PrintConvoyData = {
      convoy: {
        trip_type: c.trip_type,
        route_name: `${c.origin_city} → ${c.destination_city}`,
        departure_datetime: c.departure_datetime,
        bus_registration: c.bus_registration,
        driver_name: c.driver_name,
        company_name: c.company_name,
        passengers_count: c.passengers_count,
        amount: c.amount,
        ratio_amount: c.ratio_amount,
        carburant_amount: c.carburant_amount,
        peage_amount: c.peage_amount,
        autres_amount: c.autres_amount,
        observation: c.observation,
      },
      stationName: stationName ?? undefined,
    };
    try {
      const ok = await printConvoyBordereau(printData);
      if (!ok) toast.error('Impression impossible');
    } catch {
      toast.error('Erreur d\'impression');
    }
  };

  // ─── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!stationId) { toast.error('Session de guichet invalide'); return; }
    if (!canSubmit) { toast.error('Veuillez renseigner les champs obligatoires'); return; }
    if (isOverload && !window.confirm(`Risque de surcharge : ${passengers} passagers pour ${busCapacity} places. Continuer ?`)) return;

    setSubmitting(true);
    try {
      const amount = Number(form.amount);
      const passengersCount = parseInt(form.passengers_count) || 0;
      const charges = {
        ratio_amount: Number(form.ratio_amount) || 0,
        carburant_amount: Number(form.carburant_amount) || 0,
        peage_amount: Number(form.peage_amount) || 0,
        autres_amount: Number(form.autres_amount) || 0,
      };

      let createdConvoy: ConvoyRow | null = null;

      if (editConvoy) {
        const { error: cErr } = await supabase.from('convoys').update({
          amount,
          passengers_count: passengersCount,
          observation: form.observation.trim() || null,
          ...charges,
        }).eq('id', editConvoy.id);
        if (cErr) throw cErr;

        const depDate = form.departure_datetime.includes('T') ? form.departure_datetime : `${form.departure_datetime}:00`;
        const selectedRouteObj = routes.find(r => r.id === form.route_id);
        const durationMin = (selectedRouteObj as any)?.estimated_duration_minutes || 60;
        const arrDate = new Date(new Date(depDate).getTime() + durationMin * 60 * 1000).toISOString();

        const { error: sErr } = await supabase.from('schedules').update({
          bus_id: form.bus_id,
          driver_id: form.driver_id,
          departure_datetime: depDate,
          arrival_datetime: arrDate,
          route_id: form.route_id,
          updated_at: new Date().toISOString(),
        }).eq('id', editConvoy.schedule_id);
        if (sErr) throw sErr;

        toast.success('Convoi modifié avec succès');
      } else {
        const depDate = form.departure_datetime.includes('T') ? form.departure_datetime : `${form.departure_datetime}:00`;
        const selectedRouteObj = routes.find(r => r.id === form.route_id);
        const durationMin = (selectedRouteObj as any)?.estimated_duration_minutes || 60;
        const arrDate = new Date(new Date(depDate).getTime() + durationMin * 60 * 1000).toISOString();
        const baseSchedule: Record<string, any> = {
          route_id: form.route_id,
          departure_station_id: stationId,
          arrival_station_id: form.arrival_station_id || null,
          bus_id: form.bus_id,
          driver_id: form.driver_id,
          departure_datetime: depDate,
          arrival_datetime: arrDate,
          status: 'convoi',
          seats_available: 0,
          seats_reserved: passengersCount || busCapacity,
          fill_rate: 100,
          is_anticipated: false,
          is_ramassage: false,
        };

        const hasRetour = form.trip_type === 'aller_retour' && !!form.retour_route_id;
        const schedulesToInsert: Record<string, any>[] = [baseSchedule];
        if (hasRetour) {
          const retDep = form.retour_departure_datetime.includes('T')
            ? form.retour_departure_datetime : `${form.retour_departure_datetime}:00`;
          const retArr = new Date(new Date(retDep).getTime() + durationMin * 60 * 1000).toISOString();
          // The return leg comes back to this counter's station.
          schedulesToInsert.push({
            ...baseSchedule,
            route_id: form.retour_route_id,
            departure_station_id: form.arrival_station_id || stationId,
            arrival_station_id: stationId,
            departure_datetime: retDep,
            arrival_datetime: retArr,
          });
        }

        // Single insert so both legs are saved together or not at all.
        const { data: newScheds, error: sErr } = await supabase
          .from('schedules').insert(schedulesToInsert).select('id');
        if (sErr) throw sErr;
        if (!newScheds || newScheds.length !== schedulesToInsert.length) {
          throw new Error("Échec de l'enregistrement des trajets du convoi");
        }
        const newSched = newScheds[0];

        const convoyBase = {
          amount,
          passengers_count: passengersCount,
          observation: form.observation.trim() || null,
          created_by: user?.id,
          ...charges,
        };

        const allerConvoyId = crypto.randomUUID();
        const retourConvoyId = hasRetour ? crypto.randomUUID() : null;
        const convoysToInsert: Record<string, any>[] = [{
          ...convoyBase,
          id: allerConvoyId,
          schedule_id: newSched.id,
          trip_type: form.trip_type,
          return_convoy_id: retourConvoyId,
        }];
        if (hasRetour) {
          convoysToInsert.push({
            ...convoyBase,
            id: retourConvoyId,
            schedule_id: newScheds[1].id,
            trip_type: 'aller_retour',
          });
        }

        const { data: newConvoys, error: cErr } = await supabase
          .from('convoys').insert(convoysToInsert).select('id');
        if (cErr) throw cErr;
        if (!newConvoys || newConvoys.length !== convoysToInsert.length) {
          throw new Error("Échec de l'enregistrement du convoi");
        }

        // Build a ConvoyRow for immediate bordereau printing
        createdConvoy = {
          id: 'new',
          schedule_id: newSched.id,
          amount,
          trip_type: form.trip_type,
          passengers_count: passengersCount,
          ratio_amount: charges.ratio_amount,
          carburant_amount: charges.carburant_amount,
          peage_amount: charges.peage_amount,
          autres_amount: charges.autres_amount,
          observation: form.observation.trim() || null,
          created_at: new Date().toISOString(),
              return_convoy_id: null,
          return_departure_datetime: form.trip_type === 'aller_retour' ? form.retour_departure_datetime : null,
          departure_datetime: depDate,
          route_id: form.route_id,
          route_name: selectedRoute?.name ?? '—',
          origin_city: selectedRoute?.origin_city?.name ?? '—',
          destination_city: selectedRoute?.destination_city?.name ?? '—',
          bus_id: form.bus_id,
          bus_registration: selectedBus?.registration_number ?? '—',
          bus_capacity: selectedBus?.capacity ?? 0,
          company_name: selectedBus?.company?.name ?? '—',
          driver_id: form.driver_id,
          driver_name: drivers.find(d => d.id === form.driver_id)?.full_name ?? '—',
          station_name: stationName ?? '—',
        };

        toast.success('Convoi créé avec succès');
      }

      setShowModal(false);
      setEditConvoy(null);
      setForm(EMPTY_FORM);
      await loadConvoys();

      // Auto-print bordereau after creation
      if (createdConvoy) {
        setTimeout(() => handlePrint(createdConvoy!), 500);
      }
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors de l\'enregistrement');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  if (loading) return (
    <POSLayout stationName={stationName ?? undefined} activeRoute="Convoi" showBack>
      <div className="p-8 flex items-center justify-center min-h-64">
        <div className="w-8 h-8 border-4 rounded-full animate-spin" style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
      </div>
    </POSLayout>
  );

  return (
    <POSLayout stationName={stationName ?? undefined} activeRoute="Convoi" showBack>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <Truck className="w-5 h-5" style={{ color: 'var(--primary)' }} />
              Convois
            </h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              {stationName ?? '—'} · Création et gestion des convois
            </p>
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            <Plus className="w-4 h-4" /> Nouveau convoi
          </button>
        </div>

        {/* Period filter */}
        <div className="flex items-center gap-2 flex-wrap">
          {(['today', 'week', 'month', 'custom'] as PeriodPreset[]).map(p => (
            <button key={p} onClick={() => applyPreset(p)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg transition-all"
              style={{
                backgroundColor: preset === p ? 'var(--primary)' : 'var(--surface)',
                color: preset === p ? '#fff' : 'var(--text-secondary)',
                border: `1px solid ${preset === p ? 'var(--primary)' : 'var(--border)'}`,
              }}>
              {p === 'today' ? "Aujourd'hui" : p === 'week' ? 'Semaine' : p === 'month' ? 'Mois' : 'Personnalisé'}
            </button>
          ))}
          <div className="flex items-center gap-2 ml-2">
            <input type="date" value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); setPreset('custom'); }}
              className="px-3 py-1.5 border rounded-lg text-sm"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
            <span style={{ color: 'var(--text-muted)' }}>→</span>
            <input type="date" value={dateTo}
              onChange={e => { setDateTo(e.target.value); setPreset('custom'); }}
              className="px-3 py-1.5 border rounded-lg text-sm"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            { label: 'Convois', value: formatNumber(kpis.count), icon: <Truck className="w-4 h-4" />, color: '#0369A1' },
            { label: 'Montant', value: formatCurrency(kpis.totalAmount), icon: <Banknote className="w-4 h-4" />, color: '#16A34A' },
            { label: 'Charges', value: formatCurrency(kpis.totalChargesAll), icon: <Receipt className="w-4 h-4" />, color: '#D97706' },
            { label: 'Solde', value: formatCurrency(kpis.totalSolde), icon: <Banknote className="w-4 h-4" />, color: kpis.totalSolde >= 0 ? '#16A34A' : '#DC2626' },
            { label: 'Passagers', value: formatNumber(kpis.totalPassengers), icon: <User className="w-4 h-4" />, color: '#0EA5E9' },
          ].map((kpi, i) => (
            <div key={i} className="rounded-xl border p-3 flex items-center gap-3"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: `${kpi.color}15`, color: kpi.color }}>
                {kpi.icon}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium truncate" style={{ color: 'var(--text-muted)' }}>{kpi.label}</p>
                <p className="text-sm font-bold truncate" style={{ color: kpi.color }}>{kpi.value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Charge breakdown */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Ratio', value: kpis.totalRatio, color: '#0369A1' },
            { label: 'Carburant', value: kpis.totalCarburant, color: '#EA580C' },
            { label: 'Péage', value: kpis.totalPeage, color: '#7C3AED' },
            { label: 'Autres', value: kpis.totalAutres, color: '#64748B' },
          ].map((c, i) => (
            <div key={i} className="rounded-lg border px-4 py-2.5"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
              <p className="text-sm font-bold" style={{ color: c.color }}>{formatCurrency(c.value)}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Autocomplete<RouteOption>
            items={routes} value={filterRoute} onChange={setFilterRoute}
            getLabel={r => r.name}
            getSub={r => `${r.origin_city?.name || '—'} → ${r.destination_city?.name || '—'}`}
            placeholder="Filtrer par ligne…"
          />
          <Autocomplete<BusOption>
            items={buses} value={filterBus} onChange={setFilterBus}
            getLabel={b => b.registration_number}
            getSub={b => `${b.capacity} places`}
            placeholder="Filtrer par bus…"
          />
        </div>

        {/* Convoys table */}
        {listLoading ? (
          <div className="p-8 flex items-center justify-center">
            <div className="w-8 h-8 border-4 rounded-full animate-spin"
              style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
          </div>
        ) : filteredConvoys.length === 0 ? (
          <div className="text-center py-16 rounded-2xl border-2 border-dashed" style={{ borderColor: 'var(--border)' }}>
            <Truck className="w-12 h-12 mx-auto mb-3" style={{ color: '#D1D5DB' }} />
            <p className="font-medium" style={{ color: 'var(--text-secondary)' }}>Aucun convoi sur cette période</p>
            <button onClick={openCreate}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white"
              style={{ backgroundColor: 'var(--primary)' }}>
              <Plus className="w-4 h-4" /> Créer un convoi
            </button>
          </div>
        ) : (
          <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                    {['Date', 'Ligne', 'Bus', 'Société', 'Chauffeur', 'Type', 'Pass.', 'Montant', 'Charges', 'Solde', ''].map((h, i) => (
                      <th key={i} className="px-2 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                        style={{ color: 'var(--text-muted)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                  {filteredConvoys.map(c => {
                    const charges = c.ratio_amount + c.carburant_amount + c.peage_amount + c.autres_amount;
                    const cSolde = c.amount - charges;
                    const overload = c.passengers_count > c.bus_capacity && c.bus_capacity > 0;
                    return (
                      <tr key={c.id} className="hover:opacity-80 transition-opacity">
                        <td className="px-2 py-2.5 whitespace-nowrap font-medium" style={{ color: 'var(--text-primary)' }}>
                          <span className="block">Aller : {format(parseISO(c.departure_datetime || c.created_at), 'dd/MM HH:mm')}</span>
                          {c.return_departure_datetime && <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>Retour : {format(parseISO(c.return_departure_datetime), 'dd/MM HH:mm')}</span>}
                        </td>
                        <td className="px-2 py-2.5 whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                          {c.origin_city} → {c.destination_city}
                        </td>
                        <td className="px-2 py-2.5 whitespace-nowrap font-medium" style={{ color: 'var(--text-primary)' }}>{c.bus_registration}</td>
                        <td className="px-2 py-2.5 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{c.company_name}</td>
                        <td className="px-2 py-2.5 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{c.driver_name}</td>
                        <td className="px-2 py-2.5 whitespace-nowrap">
                          <span className="text-xs px-1.5 py-0.5 rounded-full"
                            style={{ backgroundColor: c.trip_type === 'aller_retour' ? '#EEF2FF' : 'var(--bg-subtle)', color: c.trip_type === 'aller_retour' ? '#4338CA' : 'var(--text-secondary)' }}>
                            {c.trip_type === 'aller_retour' ? 'A-R' : 'Aller'}
                          </span>
                        </td>
                        <td className="px-2 py-2.5 whitespace-nowrap">
                          <span className="flex items-center gap-1" style={{ color: overload ? '#DC2626' : 'var(--text-primary)' }}>
                            {overload && <AlertTriangle className="w-3 h-3" />}
                            {c.passengers_count}/{c.bus_capacity || '—'}
                          </span>
                        </td>
                        <td className="px-2 py-2.5 whitespace-nowrap font-bold" style={{ color: '#16A34A' }}>{formatCurrency(c.amount)}</td>
                        <td className="px-2 py-2.5 whitespace-nowrap" style={{ color: '#D97706' }}>{formatCurrency(charges)}</td>
                        <td className="px-2 py-2.5 whitespace-nowrap font-bold" style={{ color: cSolde >= 0 ? '#16A34A' : '#DC2626' }}>{formatCurrency(cSolde)}</td>
                        <td className="px-2 py-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <button onClick={() => handlePrint(c)}
                              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors" title="Imprimer bordereau">
                              <Printer className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                            </button>
                            <button onClick={() => openEdit(c)}
                              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors" title="Modifier">
                              <Edit3 className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                            </button>
                            <ChangeRequestButton
                              compact
                              operationType="convoy"
                              operationId={c.id}
                              operationTable="convoys"
                              operationReference={`Convoi ${c.origin_city} → ${c.destination_city} ${format(parseISO(c.departure_datetime || c.created_at), 'dd/MM HH:mm')}`}
                              operationSnapshot={c as unknown as Record<string, unknown>}
                              stationId={stationId}
                              stationName={stationName}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ backgroundColor: 'var(--primary-light)' }}>
                    <td colSpan={6} className="px-2 py-3 text-sm font-bold" style={{ color: 'var(--primary)' }}>
                      TOTAL ({kpis.count} convoi{kpis.count > 1 ? 's' : ''})
                    </td>
                    <td className="px-2 py-3 text-sm font-bold" style={{ color: 'var(--primary)' }}>{kpis.totalPassengers}</td>
                    <td className="px-2 py-3 text-sm font-bold" style={{ color: '#16A34A' }}>{formatCurrency(kpis.totalAmount)}</td>
                    <td className="px-2 py-3 text-sm font-bold" style={{ color: '#D97706' }}>{formatCurrency(kpis.totalChargesAll)}</td>
                    <td className="px-2 py-3 text-sm font-bold" style={{ color: kpis.totalSolde >= 0 ? '#16A34A' : '#DC2626' }}>{formatCurrency(kpis.totalSolde)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ─── Create/Edit modal ─────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl"
            style={{ backgroundColor: 'var(--surface)' }}>
            {/* Modal header */}
            <div className="sticky top-0 flex items-center justify-between px-6 py-4 border-b z-10"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
              <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <Truck className="w-5 h-5" style={{ color: 'var(--primary)' }} />
                {editConvoy ? 'Modifier le convoi' : 'Nouveau convoi'}
              </h2>
              <button onClick={closeModal} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Trip type */}
              <div>
                <label className="block mb-2 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Type de trajet</label>
                <div className="grid grid-cols-2 gap-3">
                  {([['aller_simple', 'Aller simple'], ['aller_retour', 'Aller – Retour']] as const).map(([val, label]) => (
                    <button key={val} type="button" onClick={() => setForm(p => ({
                      ...p,
                      trip_type: val,
                      ...(val === 'aller_retour' && p.route_id && !p.retour_route_id
                        ? { retour_route_id: getMatchingReturnRouteId(p.route_id) }
                        : {}),
                    }))}
                      className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 text-sm font-semibold transition-all"
                      style={{
                        borderColor: form.trip_type === val ? 'var(--primary)' : 'var(--border)',
                        backgroundColor: form.trip_type === val ? 'var(--primary-light)' : 'transparent',
                        color: form.trip_type === val ? 'var(--primary)' : 'var(--text-secondary)',
                      }}>
                      {val === 'aller_simple' ? <ChevronRight className="w-4 h-4" /> : <RotateCcw className="w-4 h-4" />}
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Route + datetime */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1.5 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Ville d'arrivée *</label>
                  <Autocomplete<CityOption>
                    items={cityOptions} value={form.route_id}
                    onChange={id => setForm(p => ({
                      ...p,
                      route_id: id,
                      ...(p.trip_type === 'aller_retour' ? { retour_route_id: getMatchingReturnRouteId(id) } : {}),
                    }))}
                    getLabel={city => city.name}
                    placeholder="Rechercher une ville…"
                  />
                </div>
                <div>
                  <label className="block mb-1.5 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Date d’aller *</label>
                  <input type="datetime-local" value={form.departure_datetime}
                    onChange={e => setForm(p => ({ ...p, departure_datetime: e.target.value }))}
                    className="w-full px-3 py-2.5 border rounded-lg text-sm"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
                </div>
              </div>

              {/* Retour (aller_retour only) */}
              {form.trip_type === 'aller_retour' && (
                <div className="rounded-xl border-2 border-dashed p-4" style={{ borderColor: '#4338CA', backgroundColor: '#EEF2FF' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <RotateCcw className="w-4 h-4" style={{ color: '#4338CA' }} />
                    <h3 className="text-sm font-bold" style={{ color: '#4338CA' }}>Trajet retour</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block mb-1.5 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Ville de retour *</label>
                      <Autocomplete<CityOption>
                        items={returnCityOptions} value={form.retour_route_id}
                        onChange={id => setForm(p => ({ ...p, retour_route_id: id }))}
                        getLabel={city => city.name}
                        placeholder="Rechercher une ville…"
                      />
                    </div>
                    <div>
                      <label className="block mb-1.5 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Date de retour *</label>
                      <input type="datetime-local" value={form.retour_departure_datetime}
                        onChange={e => setForm(p => ({ ...p, retour_departure_datetime: e.target.value }))}
                        className="w-full px-3 py-2.5 border rounded-lg text-sm"
                        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
                    </div>
                  </div>
                  <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                    Le retour utilise le même bus, chauffeur, passagers et charges que l'aller.
                  </p>
                </div>
              )}

              {/* Bus + Driver */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1.5 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                    Bus *
                    {selectedBus && (
                      <span className="ml-2 text-xs font-normal" style={{ color: 'var(--primary)' }}>
                        {selectedBus.capacity} places · {selectedBus.company?.name || '—'}
                      </span>
                    )}
                  </label>
                  <Autocomplete<BusOption>
                    items={buses} value={form.bus_id}
                    onChange={id => setForm(p => ({ ...p, bus_id: id }))}
                    getLabel={b => b.registration_number}
                    getSub={b => `${b.model || '—'} · ${b.capacity} places`}
                    placeholder="Rechercher un bus…"
                  />
                </div>
                <div>
                  <label className="block mb-1.5 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Chauffeur *</label>
                  <Autocomplete<DriverOption>
                    items={drivers} value={form.driver_id}
                    onChange={id => setForm(p => ({ ...p, driver_id: id }))}
                    getLabel={d => d.full_name}
                    getSub={d => d.phone || ''}
                    placeholder="Rechercher un chauffeur…"
                  />
                </div>
              </div>

              {/* Passengers + Amount */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1.5 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                    Nombre de passagers
                    {busCapacity > 0 && (
                      <span className="ml-2 text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
                        (capacité : {busCapacity})
                      </span>
                    )}
                  </label>
                  <input type="number" min={0} value={form.passengers_count}
                    onChange={e => setForm(p => ({ ...p, passengers_count: e.target.value }))}
                    className="w-full px-3 py-2.5 border rounded-lg text-sm"
                    style={{
                      borderColor: isOverload ? '#DC2626' : 'var(--border)',
                      backgroundColor: isOverload ? '#FEF2F2' : 'var(--surface)',
                      color: 'var(--text-primary)',
                    }} />
                  {isOverload && (
                    <p className="mt-1.5 text-xs flex items-center gap-1" style={{ color: '#DC2626' }}>
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Risque de surcharge : {passengers} passagers pour {busCapacity} places
                    </p>
                  )}
                </div>
                <div>
                  <label className="block mb-1.5 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Montant (FCFA) *</label>
                  <input type="number" min={0} value={form.amount}
                    onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
                    className="w-full px-3 py-2.5 border rounded-lg text-sm"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
                </div>
              </div>

              {/* ── Charges ── */}
              <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)' }}>
                <div className="flex items-center gap-2 mb-3">
                  <Receipt className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                  <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Charges du convoi</h3>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {([['ratio_amount', 'Ratio'], ['carburant_amount', 'Carburant'], ['peage_amount', 'Péage'], ['autres_amount', 'Autres']] as const).map(([key, label]) => (
                    <div key={key}>
                      <label className="block mb-1 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{label}</label>
                      <input type="number" min={0} value={(form as any)[key]}
                        onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                        className="w-full px-2.5 py-2 border rounded-lg text-sm"
                        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span style={{ color: 'var(--text-muted)' }}>Total charges : </span>
                  <span className="font-bold" style={{ color: '#D97706' }}>{formatCurrency(totalCharges)}</span>
                </div>
                <div className="flex items-center justify-between text-sm border-t mt-2 pt-2" style={{ borderColor: 'var(--border)' }}>
                  <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Solde (Montant − Charges) : </span>
                  <span className="font-bold" style={{ color: solde >= 0 ? '#16A34A' : '#DC2626' }}>{formatCurrency(solde)}</span>
                </div>
              </div>

              {/* Observation */}
              <div>
                <label className="block mb-1.5 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Observations</label>
                <textarea value={form.observation} rows={2}
                  onChange={e => setForm(p => ({ ...p, observation: e.target.value }))}
                  placeholder="Notes optionnelles…"
                  className="w-full px-3 py-2.5 border rounded-lg text-sm resize-none"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
              </div>
            </div>

            {/* Modal footer */}
            <div className="sticky bottom-0 flex items-center justify-end gap-3 px-6 py-4 border-t"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
              <button onClick={closeModal}
                className="px-4 py-2 rounded-lg border text-sm font-medium"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                Annuler
              </button>
              <button onClick={handleSubmit} disabled={!canSubmit || submitting}
                className="px-5 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                style={{ backgroundColor: 'var(--primary)' }}>
                {submitting && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {editConvoy ? 'Enregistrer' : 'Créer le convoi'}
              </button>
            </div>
          </div>
        </div>
      )}
    </POSLayout>
  );
}
