import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import { addMinutes, format } from 'date-fns';
import {
  ArrowLeft, MapPin, Bus, User, Plus, Trash2, ChevronRight,
  Search, X, CheckCircle, AlertTriangle, Clock, Copy,
  Navigation, Calendar, Loader2, ChevronDown, ChevronUp, Truck
} from 'lucide-react';
import { getAvailableBuses, getAvailableDrivers, formatHours } from '../../services/scheduleValidation';

interface City { id: string; name: string }
interface Station { id: string; name: string; city_id: string; city_name?: string }
interface RouteStop {
  id: string; station_id: string; position: number; offset_minutes: number;
  cumulative_distance_km?: number; station?: Station;
}
interface Route {
  id: string; name: string; distance_km: number; estimated_duration_minutes: number;
  base_price: number; origin_city_id: string; destination_city_id: string;
  origin_station_id?: string; destination_station_id?: string;
  origin_city?: City; destination_city?: City; stops?: RouteStop[];
}
interface BusOption {
  id: string; license_plate: string; model: string; capacity: number; status: string;
  companies: { name: string }; isAvailable: boolean; availabilityMessage?: string;
}
interface DriverOption {
  id: string; full_name: string; phone: string; isAvailable: boolean;
  availabilityMessage?: string; hoursToday: number; hoursWeek: number;
  hoursRemainingToday: number; hoursRemainingWeek: number;
}
interface TransitStop {
  station_id: string; station_name: string;
  arrival_offset_minutes: number; departure_offset_minutes: number; position: number;
}

interface TripEntry {
  uid: string;
  route_id: string;
  route_name: string;
  origin_city: string;
  destination_city: string;
  departure_station_id: string;
  arrival_station_id: string;
  transit_stops: TransitStop[];
  departure_datetime: string;
  arrival_datetime: string;
  bus_id: string;
  driver_id: string;
  copilot_id: string;
  estimated_duration_minutes: number;
  is_ramassage: boolean;
}

const STEPS = [
  { id: 'routes', label: 'Itineraires' },
  { id: 'stations', label: 'Gares' },
  { id: 'transits', label: 'Transits' },
  { id: 'schedule', label: 'Horaires' },
  { id: 'buses', label: 'Bus' },
  { id: 'drivers', label: 'Chauffeurs' },
  { id: 'summary', label: 'Recapitulatif' },
];

let uidCounter = 0;
function nextUid(): string { return `trip_${++uidCounter}_${Date.now()}`; }

export default function GroupedPlanning() {
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [allStations, setAllStations] = useState<Station[]>([]);
  const [myStationId, setMyStationId] = useState<string | null>(null);
  const [selectedRouteIds, setSelectedRouteIds] = useState<string[]>([]);
  const [trips, setTrips] = useState<TripEntry[]>([]);
  const [buses, setBuses] = useState<BusOption[]>([]);
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingBuses, setLoadingBuses] = useState(false);
  const [loadingDrivers, setLoadingDrivers] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [busSearch, setBusSearch] = useState('');
  const [driverSearch, setDriverSearch] = useState('');
  const [expandedTrips, setExpandedTrips] = useState<Set<string>>(new Set());
  const [routeSearch, setRouteSearch] = useState('');
  const [isAnticipated, setIsAnticipated] = useState(false);

  useEffect(() => { initData(); }, []);

  const initData = async () => {
    setLoading(true);
    try {
      const [{ data: stationId }, { data: stationsData }] = await Promise.all([
        supabase.rpc('get_my_station_id'),
        supabase.from('stations').select('id, name, city_id, cities:city_id(name)')
          .eq('is_active', true).order('name'),
      ]);

      if (!stationId) { toast.error('Aucune gare assignee a votre compte'); return; }
      setMyStationId(stationId);
      if (stationsData) setAllStations(stationsData.map((s: any) => ({ ...s, city_name: s.cities?.name || '' })));

      const { data: stationData } = await supabase.from('stations').select('city_id').eq('id', stationId).maybeSingle();
      const cityId = stationData?.city_id ?? null;

      let query = supabase
        .from('routes')
        .select(`id, name, distance_km, estimated_duration_minutes, base_price,
          origin_city_id, destination_city_id, origin_station_id, destination_station_id,
          origin_city:origin_city_id(id, name), destination_city:destination_city_id(id, name),
          stops:route_stops(id, station_id, position, offset_minutes, cumulative_distance_km, station:station_id(id, name, city_id))`)
        .eq('is_active', true);

      if (cityId) {
        query = query.or(`origin_station_id.eq.${stationId},and(origin_station_id.is.null,origin_city_id.eq.${cityId})`);
      } else {
        query = query.eq('origin_station_id', stationId);
      }

      const { data: routeData } = await query.order('name');
      const sorted = (routeData || []).map((r: any) => ({
        ...r, stops: (r.stops || []).sort((a: RouteStop, b: RouteStop) => a.position - b.position),
      }));
      setRoutes(sorted);
    } finally { setLoading(false); }
  };

  const selectedRoutes = useMemo(() => routes.filter(r => selectedRouteIds.includes(r.id)), [routes, selectedRouteIds]);

  const toggleRoute = (routeId: string) => {
    setSelectedRouteIds(prev =>
      prev.includes(routeId) ? prev.filter(id => id !== routeId) : [...prev, routeId]
    );
  };

  const buildTripsFromRoutes = () => {
    const existing = new Map(trips.map(t => [t.route_id, t]));
    const newTrips: TripEntry[] = selectedRoutes.map(route => {
      const prev = existing.get(route.id);
      if (prev) return prev;

      const depStations = allStations.filter(s => s.city_id === route.origin_city_id);
      const arrStations = allStations.filter(s => s.city_id === route.destination_city_id);
      const predefinedTransits: TransitStop[] = (route.stops || []).map((s, i) => ({
        station_id: s.station_id, station_name: s.station?.name || '',
        arrival_offset_minutes: s.offset_minutes, departure_offset_minutes: s.offset_minutes + 10,
        position: i + 1,
      }));

      return {
        uid: nextUid(),
        route_id: route.id,
        route_name: route.name,
        origin_city: route.origin_city?.name || '',
        destination_city: route.destination_city?.name || '',
        departure_station_id: myStationId || route.origin_station_id || depStations[0]?.id || '',
        arrival_station_id: route.destination_station_id || arrStations[0]?.id || '',
        transit_stops: predefinedTransits,
        departure_datetime: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
        arrival_datetime: '',
        bus_id: '',
        driver_id: '',
        copilot_id: '',
        estimated_duration_minutes: route.estimated_duration_minutes,
        is_ramassage: false,
      };
    });
    setTrips(newTrips);
  };

  const updateTrip = (uid: string, updates: Partial<TripEntry>) => {
    setTrips(prev => prev.map(t => t.uid === uid ? { ...t, ...updates } : t));
  };

  const removeTrip = (uid: string) => {
    setTrips(prev => prev.filter(t => t.uid !== uid));
  };

  const duplicateTrip = (uid: string) => {
    setTrips(prev => {
      const idx = prev.findIndex(t => t.uid === uid);
      if (idx === -1) return prev;
      const source = prev[idx];
      const copy: TripEntry = {
        ...source,
        uid: nextUid(),
        bus_id: '',
        driver_id: '',
        copilot_id: '',
      };
      const result = [...prev];
      result.splice(idx + 1, 0, copy);
      return result;
    });
  };

  const recalcArrival = (trip: TripEntry, depDt: string): string => {
    if (!depDt) return '';
    return format(addMinutes(new Date(depDt), trip.estimated_duration_minutes), "yyyy-MM-dd'T'HH:mm");
  };

  const handleDepartureDatetimeChange = (uid: string, value: string) => {
    setTrips(prev => prev.map(t => {
      if (t.uid !== uid) return t;
      return { ...t, departure_datetime: value, arrival_datetime: recalcArrival(t, value) };
    }));
  };

  // Step navigation
  const goStep = (s: number) => {
    if (s === 1) buildTripsFromRoutes();
    if (s === 4) {
      trips.forEach(t => {
        if (t.departure_datetime && !t.arrival_datetime) {
          updateTrip(t.uid, { arrival_datetime: recalcArrival(t, t.departure_datetime) });
        }
      });
    }
    if (s === 4) loadBuses();
    if (s === 5) loadDriversList();
    setStep(s);
  };

  const loadBuses = async () => {
    if (trips.length === 0) return;
    setLoadingBuses(true);
    try {
      const earliest = trips.reduce((min, t) => t.departure_datetime < min ? t.departure_datetime : min, trips[0].departure_datetime);
      const latest = trips.reduce((max, t) => (t.arrival_datetime || t.departure_datetime) > max ? (t.arrival_datetime || t.departure_datetime) : max, trips[0].arrival_datetime || trips[0].departure_datetime);
      const result = await getAvailableBuses(earliest, latest);
      setBuses(result);
    } catch { toast.error('Erreur chargement des bus'); }
    finally { setLoadingBuses(false); }
  };

  const loadDriversList = async () => {
    if (trips.length === 0) return;
    setLoadingDrivers(true);
    try {
      const earliest = trips.reduce((min, t) => t.departure_datetime < min ? t.departure_datetime : min, trips[0].departure_datetime);
      const latest = trips.reduce((max, t) => (t.arrival_datetime || t.departure_datetime) > max ? (t.arrival_datetime || t.departure_datetime) : max, trips[0].arrival_datetime || trips[0].departure_datetime);
      const result = await getAvailableDrivers(earliest, latest);
      setDrivers(result);
    } catch { toast.error('Erreur chargement des chauffeurs'); }
    finally { setLoadingDrivers(false); }
  };

  // Validation alerts
  const getAlerts = (): { uid: string; message: string; type: 'error' | 'warning' }[] => {
    const alerts: { uid: string; message: string; type: 'error' | 'warning' }[] = [];
    const busAssignments = new Map<string, string[]>();
    const driverAssignments = new Map<string, string[]>();

    trips.forEach((t, i) => {
      const label = `Voyage ${i + 1} (${t.origin_city} → ${t.destination_city})`;
      if (!isAnticipated && !t.departure_datetime) alerts.push({ uid: t.uid, message: `${label} : horaire manquant`, type: 'error' });
      if (!t.arrival_station_id) alerts.push({ uid: t.uid, message: `${label} : destination manquante`, type: 'error' });
      if (!isAnticipated && !t.bus_id) alerts.push({ uid: t.uid, message: `${label} : bus non sélectionné`, type: 'error' });
      if (!isAnticipated && !t.driver_id) alerts.push({ uid: t.uid, message: `${label} : chauffeur non sélectionné`, type: 'error' });

      if (t.bus_id) {
        const prev = busAssignments.get(t.bus_id) || [];
        prev.push(label);
        busAssignments.set(t.bus_id, prev);
      }
      if (t.driver_id) {
        const prev = driverAssignments.get(t.driver_id) || [];
        prev.push(label);
        driverAssignments.set(t.driver_id, prev);
      }
    });

    busAssignments.forEach((labels, busId) => {
      if (labels.length > 1) {
        const bus = buses.find(b => b.id === busId);
        alerts.push({ uid: '', message: `Bus ${bus?.license_plate || busId} affecté à ${labels.length} voyages : ${labels.join(', ')}`, type: 'warning' });
      }
    });

    driverAssignments.forEach((labels, driverId) => {
      if (labels.length > 1) {
        const driver = drivers.find(d => d.id === driverId);
        alerts.push({ uid: '', message: `Chauffeur ${driver?.full_name || driverId} affecté à ${labels.length} voyages : ${labels.join(', ')}`, type: 'warning' });
      }
    });

    return alerts;
  };

  const handleSubmit = async () => {
    const alerts = getAlerts();
    const errors = alerts.filter(a => a.type === 'error');
    if (errors.length > 0) {
      toast.error(`${errors.length} erreur(s) à corriger avant la validation`);
      return;
    }

    setSubmitting(true);
    try {
      const inserts = trips.map(t => ({
        route_id: t.route_id,
        bus_id: t.bus_id || null,
        driver_id: t.driver_id || null,
        copilot_id: t.copilot_id || null,
        departure_station_id: t.departure_station_id || null,
        arrival_station_id: t.arrival_station_id || null,
        departure_datetime: t.departure_datetime || new Date().toISOString(),
        arrival_datetime: t.arrival_datetime || new Date().toISOString(),
        is_ramassage: t.is_ramassage,
        is_anticipated: isAnticipated,
        status: 'planifie' as const,
        ...(isAnticipated && !t.bus_id ? { seats_available: 60 } : {}),
        transit_stops: t.transit_stops.filter(s => s.station_id).map(s => ({
          station_id: s.station_id, station_name: s.station_name,
          arrival_offset_minutes: s.arrival_offset_minutes,
          departure_offset_minutes: s.departure_offset_minutes, position: s.position,
        })),
      }));

      const { error } = await supabase.from('schedules').insert(inserts);
      if (error) throw error;

      toast.success(`${inserts.length} voyage(s) créé(s) avec succès`);
      navigate('/chef-gare/planning');
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors de la création des voyages');
    } finally { setSubmitting(false); }
  };

  const toggleExpand = (uid: string) => {
    setExpandedTrips(prev => {
      const next = new Set(prev);
      next.has(uid) ? next.delete(uid) : next.add(uid);
      return next;
    });
  };

  const filteredRoutes = routeSearch.trim()
    ? routes.filter(r => {
        const q = routeSearch.toLowerCase();
        return r.name.toLowerCase().includes(q)
          || (r.origin_city?.name || '').toLowerCase().includes(q)
          || (r.destination_city?.name || '').toLowerCase().includes(q);
      })
    : routes;

  const filteredBuses = busSearch.trim()
    ? buses.filter(b => b.license_plate.toLowerCase().includes(busSearch.toLowerCase()) || (b.model || '').toLowerCase().includes(busSearch.toLowerCase()))
    : buses;

  const filteredDrivers = driverSearch.trim()
    ? drivers.filter(d => d.full_name.toLowerCase().includes(driverSearch.toLowerCase()) || (d.phone || '').includes(driverSearch))
    : drivers;

  // ─── RENDER ──────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--primary)' }} />
      </div>
    );
  }

  const renderStepRoutes = () => (
    <div>
      <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Sélection des itinéraires</h2>
      <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
        Cochez les itinéraires à planifier. Vous pourrez dupliquer chaque itinéraire pour créer plusieurs départs.
      </p>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
        <input type="text" value={routeSearch} onChange={e => setRouteSearch(e.target.value)}
          placeholder="Rechercher un itinéraire..."
          className="w-full pl-9 pr-9 py-2.5 border rounded-xl text-sm outline-none focus:ring-2"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
        {routeSearch && (
          <button onClick={() => setRouteSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2">
            <X className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
          </button>
        )}
      </div>

      <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
        {filteredRoutes.map(route => {
          const selected = selectedRouteIds.includes(route.id);
          return (
            <div key={route.id} onClick={() => toggleRoute(route.id)}
              className="p-4 border-2 rounded-xl cursor-pointer transition-all"
              style={{
                borderColor: selected ? 'var(--primary)' : 'var(--border)',
                backgroundColor: selected ? 'var(--primary-light)' : 'transparent',
              }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <input type="checkbox" checked={selected} readOnly className="w-4 h-4 rounded accent-current" style={{ accentColor: 'var(--primary)' }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{route.origin_city?.name || '--'}</span>
                      <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                      <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{route.destination_city?.name || '--'}</span>
                    </div>
                    <div className="flex gap-3 mt-1 text-xs flex-wrap" style={{ color: 'var(--text-secondary)' }}>
                      <span>{route.distance_km} km</span>
                      <span>{formatHours(route.estimated_duration_minutes / 60)}</span>
                      {(route.stops || []).length > 0 && (
                        <span className="flex items-center gap-1">
                          <Navigation className="w-3 h-3" />{(route.stops || []).length} arrêt(s)
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {selected && <CheckCircle className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--primary)' }} />}
              </div>
            </div>
          );
        })}
        {filteredRoutes.length === 0 && (
          <div className="text-center py-10 rounded-xl border-2 border-dashed" style={{ borderColor: 'var(--border)' }}>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Aucun itinéraire trouvé</p>
          </div>
        )}
      </div>

      {/* Anticipated departure checkbox */}
      <div className="mt-5 p-4 rounded-xl border-2 border-dashed"
        style={{ borderColor: isAnticipated ? '#D97706' : 'var(--border)', backgroundColor: isAnticipated ? '#FFFBEB' : 'transparent' }}>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={isAnticipated} onChange={e => setIsAnticipated(e.target.checked)}
            className="mt-0.5 w-5 h-5 rounded border-gray-300 text-amber-600 focus:ring-amber-500" />
          <div>
            <span className="text-sm font-semibold" style={{ color: isAnticipated ? '#92400E' : 'var(--text-primary)' }}>
              Départ anticipé
            </span>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              Créer les départs immédiatement pour permettre la vente rapide des billets, même si le véhicule, l'heure et le chauffeur ne sont pas encore connus.
            </p>
          </div>
        </label>
      </div>

      <div className="flex justify-between items-center mt-6">
        <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
          {selectedRouteIds.length} itinéraire(s) sélectionné(s)
        </span>
        <button onClick={() => goStep(1)} disabled={selectedRouteIds.length === 0}
          className="px-6 py-3 rounded-lg text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: 'var(--primary)' }}>Continuer</button>
      </div>
    </div>
  );

  const renderStepStations = () => (
    <div>
      <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Gares d'arrivée</h2>
      <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
        Confirmez la gare d'arrivée pour chaque itinéraire. La gare de départ est votre gare.
      </p>
      <div className="space-y-4">
        {trips.map((trip, i) => {
          const route = routes.find(r => r.id === trip.route_id);
          const arrivalStations = allStations.filter(s => s.city_id === route?.destination_city_id);
          return (
            <div key={trip.uid} className="p-4 rounded-xl border" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: 'var(--primary)' }}>{i + 1}</div>
                <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{trip.origin_city} → {trip.destination_city}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Gare de départ</label>
                  <input type="text" readOnly
                    value={allStations.find(s => s.id === trip.departure_station_id)?.name || '--'}
                    className="w-full p-2.5 border rounded-lg text-sm"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--neutral-50)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Gare d'arrivée *</label>
                  <select value={trip.arrival_station_id}
                    onChange={e => updateTrip(trip.uid, { arrival_station_id: e.target.value })}
                    className="w-full p-2.5 border rounded-lg text-sm"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}>
                    <option value="">Choisir...</option>
                    {arrivalStations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-4 mt-6">
        <button onClick={() => setStep(0)} className="px-6 py-3 rounded-lg border text-sm font-medium"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Retour</button>
        <button onClick={() => goStep(2)}
          className="px-6 py-3 rounded-lg text-white font-medium"
          style={{ backgroundColor: 'var(--primary)' }}>Continuer</button>
      </div>
    </div>
  );

  const renderStepTransits = () => (
    <div>
      <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Points de transit</h2>
      <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
        Les arrêts intermédiaires sont pré-remplis depuis l'itinéraire. Vous pouvez les modifier ou en ajouter.
      </p>
      <div className="space-y-4">
        {trips.map((trip, i) => {
          const expanded = expandedTrips.has(trip.uid);
          return (
            <div key={trip.uid} className="rounded-xl border" style={{ borderColor: 'var(--border)' }}>
              <button onClick={() => toggleExpand(trip.uid)} className="w-full flex items-center justify-between p-4">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: 'var(--primary)' }}>{i + 1}</div>
                  <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{trip.origin_city} → {trip.destination_city}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: 'var(--neutral-100)', color: 'var(--text-secondary)' }}>
                    {trip.transit_stops.length} arrêt(s)
                  </span>
                </div>
                {expanded ? <ChevronUp className="w-4 h-4" style={{ color: 'var(--text-muted)' }} /> : <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />}
              </button>
              {expanded && (
                <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor: 'var(--border)' }}>
                  <div className="pt-3 flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {allStations.find(s => s.id === trip.departure_station_id)?.name || '--'}
                    </span>
                    <ChevronRight className="w-3 h-3" /> transits... <ChevronRight className="w-3 h-3" />
                    <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {allStations.find(s => s.id === trip.arrival_station_id)?.name || '--'}
                    </span>
                  </div>
                  {trip.transit_stops.map((stop, si) => {
                    const usedIds = new Set([trip.departure_station_id, trip.arrival_station_id, ...trip.transit_stops.map(ts => ts.station_id)]);
                    return (
                      <div key={si} className="p-3 border rounded-lg" style={{ borderColor: 'var(--border)' }}>
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ backgroundColor: 'var(--primary)' }}>{si + 1}</div>
                          <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Arrêt intermédiaire</span>
                          <button onClick={() => {
                            const newStops = trip.transit_stops.filter((_, idx) => idx !== si).map((s, idx) => ({ ...s, position: idx + 1 }));
                            updateTrip(trip.uid, { transit_stops: newStops });
                          }} className="ml-auto p-1 rounded hover:bg-red-50 text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-[10px] font-medium mb-0.5" style={{ color: 'var(--text-muted)' }}>Gare</label>
                            <select value={stop.station_id}
                              onChange={e => {
                                const st = allStations.find(s => s.id === e.target.value);
                                const newStops = [...trip.transit_stops];
                                newStops[si] = { ...newStops[si], station_id: e.target.value, station_name: st?.name || '' };
                                updateTrip(trip.uid, { transit_stops: newStops });
                              }}
                              className="w-full p-1.5 border rounded text-xs"
                              style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                              <option value="">Choisir...</option>
                              {allStations.filter(s => !usedIds.has(s.id) || s.id === stop.station_id).map(s =>
                                <option key={s.id} value={s.id}>{s.name} ({s.city_name})</option>
                              )}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] font-medium mb-0.5" style={{ color: 'var(--text-muted)' }}>Arrivee (min)</label>
                            <input type="number" min={1} value={stop.arrival_offset_minutes}
                              onChange={e => {
                                const newStops = [...trip.transit_stops];
                                newStops[si] = { ...newStops[si], arrival_offset_minutes: parseInt(e.target.value) || 0 };
                                updateTrip(trip.uid, { transit_stops: newStops });
                              }}
                              className="w-full p-1.5 border rounded text-xs"
                              style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                          </div>
                          <div>
                            <label className="block text-[10px] font-medium mb-0.5" style={{ color: 'var(--text-muted)' }}>Depart (min)</label>
                            <input type="number" min={1} value={stop.departure_offset_minutes}
                              onChange={e => {
                                const newStops = [...trip.transit_stops];
                                newStops[si] = { ...newStops[si], departure_offset_minutes: parseInt(e.target.value) || 0 };
                                updateTrip(trip.uid, { transit_stops: newStops });
                              }}
                              className="w-full p-1.5 border rounded text-xs"
                              style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <button onClick={() => {
                    const newStops = [...trip.transit_stops, {
                      station_id: '', station_name: '', arrival_offset_minutes: 60,
                      departure_offset_minutes: 75, position: trip.transit_stops.length + 1,
                    }];
                    updateTrip(trip.uid, { transit_stops: newStops });
                  }}
                    className="flex items-center gap-2 px-3 py-2 border-2 border-dashed rounded-lg text-xs font-medium w-full justify-center"
                    style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}>
                    <Plus className="w-3.5 h-3.5" /> Ajouter un arrêt
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex gap-4 mt-6">
        <button onClick={() => setStep(1)} className="px-6 py-3 rounded-lg border text-sm font-medium"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Retour</button>
        {isAnticipated ? (
          <>
            <button onClick={() => goStep(3)}
              className="px-6 py-3 rounded-lg border text-sm font-medium"
              style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}>Ajouter horaire/bus/chauffeur (optionnel)</button>
            <button onClick={handleSubmit} disabled={submitting}
              className="px-6 py-3 rounded-lg text-white font-semibold disabled:opacity-50 flex items-center gap-2"
              style={{ backgroundColor: '#D97706' }}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              Créer les départs anticipés
            </button>
          </>
        ) : (
          <button onClick={() => goStep(3)}
            className="px-6 py-3 rounded-lg text-white font-medium"
            style={{ backgroundColor: 'var(--primary)' }}>Continuer</button>
        )}
      </div>
    </div>
  );

  const renderStepSchedule = () => (
    <div>
      <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Dates et heures de départ</h2>
      <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
        Définissez l'heure de départ pour chaque voyage. Dupliquez un itinéraire pour créer plusieurs départs.
      </p>
      <div className="space-y-3">
        {trips.map((trip, i) => (
          <div key={trip.uid} className="p-4 rounded-xl border" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: 'var(--primary)' }}>{i + 1}</div>
                <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{trip.origin_city} → {trip.destination_city}</span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => duplicateTrip(trip.uid)} title="Dupliquer"
                  className="p-1.5 rounded-lg border hover:bg-gray-50 transition-colors"
                  style={{ borderColor: 'var(--border)' }}>
                  <Copy className="w-3.5 h-3.5" style={{ color: 'var(--primary)' }} />
                </button>
                {trips.filter(t => t.route_id === trip.route_id).length > 1 && (
                  <button onClick={() => removeTrip(trip.uid)} title="Supprimer"
                    className="p-1.5 rounded-lg border hover:bg-red-50 transition-colors"
                    style={{ borderColor: 'var(--border)' }}>
                    <Trash2 className="w-3.5 h-3.5 text-red-500" />
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Date et heure de départ *</label>
                <input type="datetime-local" value={trip.departure_datetime}
                  onChange={e => handleDepartureDatetimeChange(trip.uid, e.target.value)}
                  className="w-full p-2.5 border rounded-lg text-sm"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Arrivee estimee</label>
                <div className="p-2.5 rounded-lg text-sm font-medium" style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
                  {trip.arrival_datetime ? format(new Date(trip.arrival_datetime), 'dd/MM/yyyy HH:mm') : '--'}
                  <span className="text-xs ml-2 opacity-70">({formatHours(trip.estimated_duration_minutes / 60)})</span>
                </div>
              </div>
            </div>
            <button type="button"
              onClick={() => updateTrip(trip.uid, { is_ramassage: !trip.is_ramassage })}
              className="w-full flex items-center gap-3 mt-3 p-3 rounded-xl border-2 text-left transition-all"
              style={{
                borderColor: trip.is_ramassage ? '#EA580C' : 'var(--border)',
                backgroundColor: trip.is_ramassage ? '#FFF7ED' : 'transparent',
              }}>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: trip.is_ramassage ? '#FDBA74' : 'var(--neutral-100)' }}>
                <Truck className="w-4.5 h-4.5" style={{ color: trip.is_ramassage ? '#9A3412' : 'var(--text-muted)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Ramassage</p>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Cocher si ce voyage est un trajet de ramassage. La gare de destination pourra enregistrer le montant collecte.
                </p>
              </div>
              <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border-2"
                style={{
                  borderColor: trip.is_ramassage ? '#EA580C' : '#D1D5DB',
                  backgroundColor: trip.is_ramassage ? '#EA580C' : 'transparent',
                }}>
                {trip.is_ramassage && <CheckCircle className="w-4 h-4 text-white" />}
              </div>
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-4 mt-6">
        <button onClick={() => setStep(2)} className="px-6 py-3 rounded-lg border text-sm font-medium"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Retour</button>
        <button onClick={() => goStep(4)}
          disabled={!isAnticipated && trips.some(t => !t.departure_datetime)}
          className="px-6 py-3 rounded-lg text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: 'var(--primary)' }}>Continuer</button>
      </div>
    </div>
  );

  const renderStepBuses = () => (
    <div>
      <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Affectation des bus</h2>
      <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
        Assignez un bus a chaque voyage. Recherchez par plaque d'immatriculation.
      </p>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
        <input type="text" value={busSearch} onChange={e => setBusSearch(e.target.value)}
          placeholder="Rechercher par plaque ou modele..."
          className="w-full pl-9 pr-9 py-2.5 border rounded-xl text-sm outline-none focus:ring-2"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
        {busSearch && (
          <button onClick={() => setBusSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2">
            <X className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
          </button>
        )}
      </div>

      {loadingBuses ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--primary)' }} />
        </div>
      ) : (
        <div className="space-y-4">
          {trips.map((trip, i) => {
            const selectedBus = buses.find(b => b.id === trip.bus_id);
            const usedByOthers = new Set(
              trips.filter(t => t.uid !== trip.uid && t.bus_id).map(t => t.bus_id)
            );
            return (
              <div key={trip.uid} className="p-4 rounded-xl border" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: 'var(--primary)' }}>{i + 1}</div>
                  <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                    {trip.origin_city} → {trip.destination_city}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {trip.departure_datetime ? format(new Date(trip.departure_datetime), 'HH:mm') : ''}
                  </span>
                </div>

                {selectedBus ? (
                  <div className="flex items-center gap-3 p-3 rounded-lg border-2" style={{ borderColor: 'var(--primary)', backgroundColor: 'var(--primary-light)' }}>
                    <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--primary)' }} />
                    <div className="flex-1 min-w-0">
                      <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{selectedBus.license_plate}</span>
                      <span className="text-xs ml-2" style={{ color: 'var(--text-secondary)' }}>
                        {[selectedBus.companies?.name, selectedBus.capacity ? `${selectedBus.capacity} pl.` : null].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                    <button onClick={() => updateTrip(trip.uid, { bus_id: '' })}
                      className="text-xs px-2 py-1 rounded border font-medium"
                      style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}>Changer</button>
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                    {filteredBuses.map(bus => {
                      const hasConflict = !bus.isAvailable;
                      const alreadySelected = usedByOthers.has(bus.id);
                      return (
                        <div key={bus.id}
                          onClick={() => {
                            if (alreadySelected) { toast.error('Déjà sélectionné'); return; }
                            updateTrip(trip.uid, { bus_id: bus.id });
                          }}
                          className={`flex items-center gap-3 p-2.5 border rounded-lg transition-colors ${alreadySelected ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-gray-50'}`}
                          style={{ borderColor: alreadySelected ? '#FBBF24' : hasConflict ? '#FBBF24' : 'var(--border)', backgroundColor: alreadySelected ? '#FFFBEB' : hasConflict ? '#FFFBEB' : 'transparent' }}>
                          <Bus className="w-4 h-4 flex-shrink-0" style={{ color: alreadySelected ? '#D97706' : hasConflict ? '#D97706' : 'var(--primary)' }} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-xs" style={{ color: 'var(--text-primary)' }}>{bus.license_plate}</span>
                              {bus.companies?.name && <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{bus.companies.name}</span>}
                              {bus.capacity > 0 && <span className="text-[10px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{bus.capacity} pl.</span>}
                            </div>
                            <span className="text-[10px] font-semibold" style={{ color: alreadySelected ? '#D97706' : hasConflict ? '#DC2626' : '#16A34A' }}>
                              {alreadySelected ? 'Déjà sélectionné' : hasConflict ? 'Deja affecte' : 'Disponible'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                    {filteredBuses.length === 0 && (
                      <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>Aucun bus trouvé</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex gap-4 mt-6">
        <button onClick={() => setStep(3)} className="px-6 py-3 rounded-lg border text-sm font-medium"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Retour</button>
        <button onClick={() => goStep(5)}
          className="px-6 py-3 rounded-lg text-white font-medium"
          style={{ backgroundColor: 'var(--primary)' }}>Continuer</button>
      </div>
    </div>
  );

  const renderStepDrivers = () => (
    <div>
      <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Affectation des chauffeurs</h2>
      <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
        Assignez un chauffeur a chaque voyage.
      </p>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
        <input type="text" value={driverSearch} onChange={e => setDriverSearch(e.target.value)}
          placeholder="Rechercher par nom, telephone..."
          className="w-full pl-9 pr-9 py-2.5 border rounded-xl text-sm outline-none focus:ring-2"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
        {driverSearch && (
          <button onClick={() => setDriverSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2">
            <X className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
          </button>
        )}
      </div>

      {loadingDrivers ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--primary)' }} />
        </div>
      ) : (
        <div className="space-y-4">
          {trips.map((trip, i) => {
            const selectedDriver = drivers.find(d => d.id === trip.driver_id);
            const driverUsedByOthers = new Set(
              trips.filter(t => t.uid !== trip.uid && t.driver_id).map(t => t.driver_id)
            );
            return (
              <div key={trip.uid} className="p-4 rounded-xl border" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: 'var(--primary)' }}>{i + 1}</div>
                  <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                    {trip.origin_city} → {trip.destination_city}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {trip.departure_datetime ? format(new Date(trip.departure_datetime), 'HH:mm') : ''}
                  </span>
                  {trip.bus_id && (
                    <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: 'var(--neutral-100)', color: 'var(--text-secondary)' }}>
                      {buses.find(b => b.id === trip.bus_id)?.license_plate || ''}
                    </span>
                  )}
                </div>

                {selectedDriver ? (
                  <div className="flex items-center gap-3 p-3 rounded-lg border-2" style={{ borderColor: 'var(--primary)', backgroundColor: 'var(--primary-light)' }}>
                    <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--primary)' }} />
                    <div className="flex-1 min-w-0">
                      <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{selectedDriver.full_name}</span>
                      <span className="text-xs ml-2" style={{ color: 'var(--text-secondary)' }}>
                        {formatHours(selectedDriver.hoursRemainingToday)} restantes
                      </span>
                    </div>
                    <button onClick={() => updateTrip(trip.uid, { driver_id: '' })}
                      className="text-xs px-2 py-1 rounded border font-medium"
                      style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}>Changer</button>
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                    {filteredDrivers.map(driver => {
                      const hasConflict = !driver.isAvailable && !!driver.availabilityMessage?.includes('creneau');
                      const isHoursBlocked = !driver.isAvailable && !hasConflict;
                      const alreadySelected = driverUsedByOthers.has(driver.id);
                      return (
                        <div key={driver.id}
                          onClick={() => {
                            if (alreadySelected) { toast.error('Déjà sélectionné'); return; }
                            if (!isHoursBlocked) updateTrip(trip.uid, { driver_id: driver.id });
                          }}
                          className="flex items-center gap-3 p-2.5 border rounded-lg transition-colors"
                          style={{
                            borderColor: alreadySelected ? '#FBBF24' : hasConflict ? '#FBBF24' : isHoursBlocked ? '#E5E7EB' : 'var(--border)',
                            backgroundColor: alreadySelected ? '#FFFBEB' : hasConflict ? '#FFFBEB' : isHoursBlocked ? '#F9FAFB' : 'transparent',
                            opacity: alreadySelected ? 0.6 : isHoursBlocked ? 0.5 : 1,
                            cursor: alreadySelected || isHoursBlocked ? 'not-allowed' : 'pointer',
                          }}>
                          <User className="w-4 h-4 flex-shrink-0" style={{ color: alreadySelected ? '#D97706' : hasConflict ? '#D97706' : isHoursBlocked ? '#9CA3AF' : 'var(--primary)' }} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-xs" style={{ color: 'var(--text-primary)' }}>{driver.full_name}</span>
                              <span className="text-[10px] font-semibold" style={{ color: alreadySelected ? '#D97706' : driver.isAvailable ? '#16A34A' : '#DC2626' }}>
                                {alreadySelected ? 'Déjà sélectionné' : driver.isAvailable ? 'Disponible' : hasConflict ? 'Deja affecte' : (driver.availabilityMessage || 'Non disponible')}
                              </span>
                            </div>
                            <div className="mt-1 w-full h-1 rounded-full bg-gray-200 overflow-hidden">
                              <div className="h-full rounded-full" style={{
                                width: `${Math.min(100, (driver.hoursRemainingToday / 9) * 100)}%`,
                                backgroundColor: driver.hoursRemainingToday < 2 ? '#DC2626' : driver.hoursRemainingToday < 4.5 ? '#F59E0B' : '#16A34A',
                              }} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {filteredDrivers.length === 0 && (
                      <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>Aucun chauffeur trouvé</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex gap-4 mt-6">
        <button onClick={() => setStep(4)} className="px-6 py-3 rounded-lg border text-sm font-medium"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Retour</button>
        <button onClick={() => goStep(6)}
          className="px-6 py-3 rounded-lg text-white font-medium"
          style={{ backgroundColor: 'var(--primary)' }}>Recapitulatif</button>
      </div>
    </div>
  );

  const renderStepSummary = () => {
    const alerts = getAlerts();
    const errors = alerts.filter(a => a.type === 'error');
    const warnings = alerts.filter(a => a.type === 'warning');

    return (
      <div>
        <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Recapitulatif</h2>
        <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
          Verifiez les {trips.length} voyage(s) avant validation.
        </p>

        {errors.length > 0 && (
          <div className="mb-4 p-4 rounded-xl border-2" style={{ backgroundColor: '#FEF2F2', borderColor: '#FECACA' }}>
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: '#EF4444' }} />
              <div>
                <p className="font-bold text-sm mb-1" style={{ color: '#DC2626' }}>Erreurs ({errors.length})</p>
                <ul className="space-y-0.5">
                  {errors.map((a, i) => <li key={i} className="text-xs" style={{ color: '#DC2626' }}>{a.message}</li>)}
                </ul>
              </div>
            </div>
          </div>
        )}

        {warnings.length > 0 && (
          <div className="mb-4 p-4 rounded-xl border-2" style={{ backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }}>
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: '#D97706' }} />
              <div>
                <p className="font-bold text-sm mb-1" style={{ color: '#B45309' }}>Avertissements ({warnings.length})</p>
                <ul className="space-y-0.5">
                  {warnings.map((a, i) => <li key={i} className="text-xs" style={{ color: '#92400E' }}>{a.message}</li>)}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Summary table */}
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-xs">
            <thead>
              <tr style={{ backgroundColor: 'var(--neutral-50)' }}>
                <th className="text-left px-3 py-2.5 font-semibold" style={{ color: 'var(--text-secondary)' }}>#</th>
                <th className="text-left px-3 py-2.5 font-semibold" style={{ color: 'var(--text-secondary)' }}>Itineraire</th>
                <th className="text-left px-3 py-2.5 font-semibold hidden sm:table-cell" style={{ color: 'var(--text-secondary)' }}>Gare arrivee</th>
                <th className="text-left px-3 py-2.5 font-semibold hidden md:table-cell" style={{ color: 'var(--text-secondary)' }}>Transits</th>
                <th className="text-left px-3 py-2.5 font-semibold" style={{ color: 'var(--text-secondary)' }}>Depart</th>
                <th className="text-left px-3 py-2.5 font-semibold" style={{ color: 'var(--text-secondary)' }}>Bus</th>
                <th className="text-left px-3 py-2.5 font-semibold" style={{ color: 'var(--text-secondary)' }}>Chauffeur</th>
                <th className="text-left px-3 py-2.5 font-semibold hidden sm:table-cell" style={{ color: 'var(--text-secondary)' }}>Places</th>
                <th className="text-left px-3 py-2.5 font-semibold" style={{ color: 'var(--text-secondary)' }}>Statut</th>
              </tr>
            </thead>
            <tbody>
              {trips.map((trip, i) => {
                const bus = buses.find(b => b.id === trip.bus_id);
                const driver = drivers.find(d => d.id === trip.driver_id);
                const arrStation = allStations.find(s => s.id === trip.arrival_station_id);
                const hasError = !trip.bus_id || !trip.driver_id || !trip.departure_datetime || !trip.arrival_station_id;
                return (
                  <tr key={trip.uid} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-3 py-2.5 font-bold" style={{ color: 'var(--text-primary)' }}>{i + 1}</td>
                    <td className="px-3 py-2.5">
                      <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{trip.origin_city} → {trip.destination_city}</span>
                    </td>
                    <td className="px-3 py-2.5 hidden sm:table-cell" style={{ color: 'var(--text-secondary)' }}>
                      {arrStation?.name || '--'}
                    </td>
                    <td className="px-3 py-2.5 hidden md:table-cell" style={{ color: 'var(--text-secondary)' }}>
                      {trip.transit_stops.filter(s => s.station_id).length || '--'}
                    </td>
                    <td className="px-3 py-2.5">
                      {trip.departure_datetime ? (
                        <div>
                          <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                            {format(new Date(trip.departure_datetime), 'HH:mm')}
                          </div>
                          <div style={{ color: 'var(--text-muted)' }}>
                            {format(new Date(trip.departure_datetime), 'dd/MM')}
                          </div>
                        </div>
                      ) : <span style={{ color: '#DC2626' }}>--</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {bus ? (
                        <div>
                          <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{bus.license_plate}</div>
                          <div style={{ color: 'var(--text-muted)' }}>{bus.companies?.name || ''}</div>
                        </div>
                      ) : <span style={{ color: '#DC2626' }}>--</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {driver ? (
                        <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{driver.full_name}</span>
                      ) : <span style={{ color: '#DC2626' }}>--</span>}
                    </td>
                    <td className="px-3 py-2.5 hidden sm:table-cell font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {bus?.capacity || '--'}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col gap-1">
                        {hasError ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ backgroundColor: '#FEF2F2', color: '#DC2626' }}>
                            <AlertTriangle className="w-3 h-3" /> Incomplet
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ backgroundColor: '#F0FDF4', color: '#16A34A' }}>
                            <CheckCircle className="w-3 h-3" /> Pret
                          </span>
                        )}
                        {trip.is_ramassage && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ backgroundColor: '#FFF7ED', color: '#EA580C' }}>
                            <Truck className="w-3 h-3" /> Ramassage
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex gap-4 mt-6">
          <button onClick={() => setStep(5)} className="px-6 py-3 rounded-lg border text-sm font-medium"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Retour</button>
          <button onClick={handleSubmit}
            disabled={submitting || errors.length > 0}
            className="flex-1 px-6 py-3 rounded-lg text-white font-bold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            style={{ backgroundColor: 'var(--primary)' }}>
            {submitting ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Creation en cours...</>
            ) : (
              <><CheckCircle className="w-4 h-4" /> Valider le planning groupe ({trips.length} voyage{trips.length > 1 ? 's' : ''})</>
            )}
          </button>
        </div>
      </div>
    );
  };

  const stepRenderers = [
    renderStepRoutes, renderStepStations, renderStepTransits,
    renderStepSchedule, renderStepBuses, renderStepDrivers, renderStepSummary,
  ];

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto">
      <button onClick={() => navigate('/chef-gare/planning')}
        className="flex items-center gap-2 mb-6 text-sm hover:underline"
        style={{ color: 'var(--text-secondary)' }}>
        <ArrowLeft className="w-4 h-4" /> Retour au planning
      </button>

      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
          Planning groupe
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Planifiez plusieurs voyages en une seule operation.
        </p>
        <div className="flex gap-1 mt-4">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full h-2 rounded-full transition-all"
                style={{ backgroundColor: i <= step ? 'var(--primary)' : 'var(--neutral-200)' }} />
              <span className="text-[10px] sm:text-xs hidden sm:block"
                style={{ color: i === step ? 'var(--primary)' : 'var(--text-muted)', fontWeight: i === step ? 700 : 400 }}>
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl p-4 sm:p-8 border shadow-sm" style={{ backgroundColor: 'var(--surface)' }}>
        {stepRenderers[step]()}
      </div>
    </div>
  );
}
