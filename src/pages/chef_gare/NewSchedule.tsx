import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import {
  ArrowLeft, MapPin, Bus, User, AlertTriangle, CheckCircle,
  Clock, Navigation, Plus, Trash2, ChevronRight, Search, X, Truck
} from 'lucide-react';
import { validateSchedule, getAvailableBuses, getAvailableDrivers, formatHours } from '../../services/scheduleValidation';
import { addMinutes, format } from 'date-fns';

interface City { id: string; name: string; }
interface Station { id: string; name: string; city_id: string; city_name?: string; }
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
  station_id: string; station_name: string; arrival_offset_minutes: number;
  departure_offset_minutes: number; position: number;
}

export default function ChefGareNewSchedule() {
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [buses, setBuses] = useState<BusOption[]>([]);
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [allStations, setAllStations] = useState<Station[]>([]);
  const [myStationId, setMyStationId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    route_id: '',
    departure_station_id: '',
    arrival_station_id: '',
    departure_datetime: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    arrival_datetime: '',
    bus_id: '',
    driver_id: '',
    copilot_id: '',
    is_ramassage: false,
  });

  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);
  const [transitStops, setTransitStops] = useState<TransitStop[]>([]);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingBuses, setLoadingBuses] = useState(false);
  const [loadingDrivers, setLoadingDrivers] = useState(false);
  const [busSearch, setBusSearch] = useState('');
  const [driverSearch, setDriverSearch] = useState('');
  const [routeSearch, setRouteSearch] = useState('');

  const formDataRef = useRef(formData);
  useEffect(() => { formDataRef.current = formData; }, [formData]);

  useEffect(() => {
    initData();
    loadAllStations();
  }, []);

  useEffect(() => {
    if (formData.route_id) {
      const route = routes.find(r => r.id === formData.route_id);
      setSelectedRoute(route || null);
      if (route) {
        setFormData(prev => ({
          ...prev,
          departure_station_id: myStationId || route.origin_station_id || '',
          arrival_station_id: route.destination_station_id || '',
        }));
        const predefined: TransitStop[] = (route.stops || []).map((s, i) => ({
          station_id: s.station_id, station_name: s.station?.name || '',
          arrival_offset_minutes: s.offset_minutes, departure_offset_minutes: s.offset_minutes + 10,
          position: i + 1,
        }));
        setTransitStops(predefined);
        if (formData.departure_datetime) {
          const dep = new Date(formData.departure_datetime);
          const arr = addMinutes(dep, route.estimated_duration_minutes);
          setFormData(prev => ({ ...prev, arrival_datetime: format(arr, "yyyy-MM-dd'T'HH:mm") }));
        }
      }
    }
  }, [formData.route_id, routes]);

  useEffect(() => {
    if (selectedRoute && formData.departure_datetime) {
      const dep = new Date(formData.departure_datetime);
      const arr = addMinutes(dep, selectedRoute.estimated_duration_minutes);
      setFormData(prev => ({ ...prev, arrival_datetime: format(arr, "yyyy-MM-dd'T'HH:mm") }));
    }
  }, [formData.departure_datetime, selectedRoute]);

  // Buses and drivers are loaded explicitly when navigating to their steps (see goToStep5/6)

  const initData = async () => {
    const { data: stationId } = await supabase.rpc('get_my_station_id');
    if (!stationId) {
      toast.error('Aucune gare assignée à votre compte');
      return;
    }
    setMyStationId(stationId);
    // Get the city_id of this station to filter routes by origin city
    const { data: stationData } = await supabase
      .from('stations').select('city_id').eq('id', stationId).maybeSingle();
    await loadRoutes(stationId, stationData?.city_id ?? null);
  };

  const loadAllStations = async () => {
    const { data } = await supabase
      .from('stations').select('id, name, city_id, cities:city_id(name)')
      .eq('is_active', true).order('name');
    if (data) setAllStations(data.map((s: any) => ({ ...s, city_name: s.cities?.name || '' })));
  };

  const loadRoutes = async (stationId: string, cityId: string | null) => {
    let query = supabase
      .from('routes')
      .select(`
        id, name, distance_km, estimated_duration_minutes, base_price,
        origin_city_id, destination_city_id, origin_station_id, destination_station_id,
        origin_city:origin_city_id(id, name), destination_city:destination_city_id(id, name),
        stops:route_stops(id, station_id, position, offset_minutes, cumulative_distance_km, station:station_id(id, name, city_id))
      `)
      .eq('is_active', true);

    // Filter by origin_station_id if set, otherwise fall back to origin_city_id
    if (cityId) {
      query = query.or(`origin_station_id.eq.${stationId},and(origin_station_id.is.null,origin_city_id.eq.${cityId})`);
    } else {
      query = query.eq('origin_station_id', stationId);
    }

    const { data, error } = await query.order('name');
    if (error) { toast.error('Erreur de chargement des itinéraires'); return; }
    const sorted = (data || []).map((r: any) => ({
      ...r, stops: (r.stops || []).sort((a: RouteStop, b: RouteStop) => a.position - b.position),
    }));
    setRoutes(sorted);
  };

  const loadAvailableBuses = async (dep?: string, arr?: string) => {
    const departure_datetime = dep ?? formDataRef.current.departure_datetime;
    const arrival_datetime = arr ?? formDataRef.current.arrival_datetime;
    if (!departure_datetime || !arrival_datetime) return;
    setLoadingBuses(true);
    try {
      const result = await getAvailableBuses(departure_datetime, arrival_datetime);
      setBuses(result);
    } catch (err: any) {
      toast.error(`Erreur bus: ${err?.message || err}`);
    } finally { setLoadingBuses(false); }
  };

  const loadAvailableDrivers = async (dep?: string, arr?: string) => {
    const departure_datetime = dep ?? formDataRef.current.departure_datetime;
    const arrival_datetime = arr ?? formDataRef.current.arrival_datetime;
    setLoadingDrivers(true);
    try {
      const { data: allDrivers, error } = await supabase
        .from('users')
        .select('id, full_name, phone')
        .eq('role', 'chauffeur')
        .eq('is_active', true)
        .order('full_name');

      if (error) {
        toast.error(`Erreur chargement chauffeurs: ${error.message}`);
        setDrivers([]);
        return;
      }

      if (!departure_datetime || !arrival_datetime) {
        // No datetimes yet — show all as available
        setDrivers((allDrivers || []).map(d => ({
          ...d, isAvailable: true, hoursToday: 0, hoursWeek: 0,
          hoursRemainingToday: 9, hoursRemainingWeek: 48,
        })));
        return;
      }

      // Find drivers busy on this slot
      const { data: conflicts } = await supabase
        .from('schedules')
        .select('driver_id, copilot_id')
        .lt('departure_datetime', arrival_datetime)
        .gt('arrival_datetime', departure_datetime)
        .not('status', 'eq', 'annule');

      const busyIds = new Set<string>();
      (conflicts || []).forEach((s: any) => {
        if (s.driver_id) busyIds.add(s.driver_id);
        if (s.copilot_id) busyIds.add(s.copilot_id);
      });

      const mapped = (allDrivers || []).map(d => ({
        ...d,
        isAvailable: !busyIds.has(d.id),
        availabilityMessage: busyIds.has(d.id) ? 'Déjà affecté sur ce créneau' : null,
        hoursToday: 0, hoursWeek: 0, hoursRemainingToday: 9, hoursRemainingWeek: 48,
      })).sort((a, b) => (a.isAvailable === b.isAvailable ? 0 : a.isAvailable ? -1 : 1));

      setDrivers(mapped);
    } catch (err: any) {
      toast.error(`Erreur chauffeurs: ${err?.message || err}`);
      setDrivers([]);
    } finally {
      setLoadingDrivers(false);
    }
  };

  const validateForm = async (): Promise<boolean> => {
    const result = await validateSchedule(
      formData.route_id, formData.bus_id, formData.driver_id,
      formData.copilot_id || null, formData.departure_datetime, formData.arrival_datetime
    );
    setValidationErrors(result.errors);
    return result.isValid;
  };

  const addTransitStop = () => setTransitStops(prev => [...prev, {
    station_id: '', station_name: '', arrival_offset_minutes: 60,
    departure_offset_minutes: 75, position: prev.length + 1,
  }]);

  const removeTransitStop = (i: number) => setTransitStops(prev =>
    prev.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, position: idx + 1 }))
  );

  const updateTransitStop = (i: number, field: keyof TransitStop, value: any) => {
    setTransitStops(prev => {
      const updated = [...prev];
      if (field === 'station_id') {
        const st = allStations.find(s => s.id === value);
        updated[i] = { ...updated[i], station_id: value, station_name: st?.name || '' };
      } else {
        updated[i] = { ...updated[i], [field]: value };
      }
      return updated;
    });
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const isValid = await validateForm();
      if (!isValid) { toast.error('Veuillez corriger les erreurs'); setLoading(false); return; }
      const { error } = await supabase.from('schedules').insert([{
        route_id: formData.route_id,
        bus_id: formData.bus_id,
        driver_id: formData.driver_id,
        copilot_id: formData.copilot_id || null,
        departure_station_id: formData.departure_station_id || null,
        arrival_station_id: formData.arrival_station_id || null,
        departure_datetime: formData.departure_datetime,
        arrival_datetime: formData.arrival_datetime,
        status: 'planifie',
        is_ramassage: formData.is_ramassage,
        transit_stops: transitStops.filter(s => s.station_id).map(s => ({
          station_id: s.station_id, station_name: s.station_name,
          arrival_offset_minutes: s.arrival_offset_minutes,
          departure_offset_minutes: s.departure_offset_minutes, position: s.position,
        })),
      }]);
      if (error) throw error;
      toast.success('Voyage créé avec succès');
      navigate('/chef-gare/planning');
    } catch (error: any) {
      toast.error(error.message || 'Erreur lors de la création du voyage');
    } finally { setLoading(false); }
  };

  const stationsForDeparture = selectedRoute
    ? allStations.filter(s => s.city_id === selectedRoute.origin_city_id)
    : [];
  const stationsForArrival = selectedRoute
    ? allStations.filter(s => s.city_id === selectedRoute.destination_city_id)
    : [];
  const usedStationIds = new Set([
    formData.departure_station_id, formData.arrival_station_id,
    ...transitStops.map(s => s.station_id),
  ]);

  const STEPS = ['Itinéraire', 'Gares', 'Transits', 'Horaire', 'Bus', 'Chauffeur'];

  const renderStep1 = () => {
    const rq = routeSearch.trim().toLowerCase();
    const filteredRoutes = rq
      ? routes.filter(r =>
          (r.origin_city?.name || '').toLowerCase().includes(rq) ||
          (r.destination_city?.name || '').toLowerCase().includes(rq) ||
          (r.name || '').toLowerCase().includes(rq)
        )
      : routes;
    return (
    <div>
      <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
        Étape 1 : Sélection de l'itinéraire
      </h2>
      <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
        Choisissez l'itinéraire — la gare de départ sera pré-sélectionnée sur votre gare.
      </p>
      {/* Search field */}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
        <input
          type="text"
          value={routeSearch}
          onChange={e => setRouteSearch(e.target.value)}
          placeholder="Rechercher un itinéraire (ville de départ, arrivée, nom)…"
          className="w-full pl-9 pr-9 py-3 border rounded-xl text-sm outline-none focus:ring-2"
          style={{
            borderColor: 'var(--border)',
            backgroundColor: 'var(--surface)',
            color: 'var(--text-primary)',
          }}
        />
        {routeSearch && (
          <button onClick={() => setRouteSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-100">
            <X className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
          </button>
        )}
      </div>
      <div className="space-y-3">
        {filteredRoutes.map(route => (
          <div key={route.id} onClick={() => setFormData(prev => ({ ...prev, route_id: route.id }))}
            className="p-4 border-2 rounded-xl cursor-pointer transition-all"
            style={{
              borderColor: formData.route_id === route.id ? 'var(--primary)' : 'var(--border)',
              backgroundColor: formData.route_id === route.id ? 'var(--primary-light)' : 'transparent',
            }}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3 flex-1">
                <div className="flex flex-col items-center mt-1 gap-1">
                  <div className="w-3 h-3 rounded-full border-2" style={{ borderColor: 'var(--primary)', backgroundColor: 'var(--primary)' }} />
                  <div className="w-0.5 h-6" style={{ backgroundColor: 'var(--neutral-300)' }} />
                  <MapPin className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>
                      {route.origin_city?.name || '—'}
                    </span>
                    <ChevronRight className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                    <span className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>
                      {route.destination_city?.name || '—'}
                    </span>
                  </div>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{route.name}</p>
                  <div className="flex gap-4 mt-2 text-sm flex-wrap" style={{ color: 'var(--text-secondary)' }}>
                    <span>{route.distance_km} km</span>
                    <span>{formatHours(route.estimated_duration_minutes / 60)} de trajet</span>
                    {(route.stops || []).length > 0 && (
                      <span className="flex items-center gap-1">
                        <Navigation className="w-3 h-3" />
                        {(route.stops || []).length} arrêt{(route.stops || []).length > 1 ? 's' : ''} intermédiaire{(route.stops || []).length > 1 ? 's' : ''}
                      </span>
                    )}
                    <span className="font-semibold" style={{ color: 'var(--primary)' }}>
                      {route.base_price?.toLocaleString()} FCFA
                    </span>
                  </div>
                </div>
              </div>
              {formData.route_id === route.id && (
                <CheckCircle className="w-6 h-6 flex-shrink-0" style={{ color: 'var(--primary)' }} />
              )}
            </div>
          </div>
        ))}
        {routes.length === 0 && (
          <div className="text-center py-10 rounded-xl border-2 border-dashed" style={{ borderColor: 'var(--border)' }}>
            <p style={{ color: 'var(--text-secondary)' }}>Aucun itinéraire actif disponible</p>
          </div>
        )}
        {routes.length > 0 && filteredRoutes.length === 0 && (
          <div className="text-center py-10 rounded-xl border-2 border-dashed" style={{ borderColor: 'var(--border)' }}>
            <p style={{ color: 'var(--text-secondary)' }}>Aucun itinéraire ne correspond à « {routeSearch} »</p>
          </div>
        )}
      </div>
      <div className="flex justify-end mt-6">
        <button onClick={() => setStep(2)} disabled={!formData.route_id}
          className="px-6 py-3 rounded-lg text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: 'var(--primary)' }}>
          Continuer
        </button>
      </div>
    </div>
    );
  };

  const renderStep2 = () => (
    <div>
      <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
        Étape 2 : Gares de départ et d'arrivée
      </h2>
      <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
        La gare de départ est pré-sélectionnée sur votre gare. Confirmez ou ajustez.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
        <div>
          <label className="block mb-2 font-medium text-sm" style={{ color: 'var(--text-secondary)' }}>
            Gare de départ ({selectedRoute?.origin_city?.name}) *
          </label>
          <select value={formData.departure_station_id}
            onChange={(e) => setFormData(prev => ({ ...prev, departure_station_id: e.target.value }))}
            className="w-full p-3 border rounded-xl text-sm"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}>
            <option value="">Choisir une gare...</option>
            {stationsForDeparture.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block mb-2 font-medium text-sm" style={{ color: 'var(--text-secondary)' }}>
            Gare d'arrivée ({selectedRoute?.destination_city?.name}) *
          </label>
          <select value={formData.arrival_station_id}
            onChange={(e) => setFormData(prev => ({ ...prev, arrival_station_id: e.target.value }))}
            className="w-full p-3 border rounded-xl text-sm"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}>
            <option value="">Choisir une gare...</option>
            {stationsForArrival.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex gap-4 mt-6">
        <button onClick={() => setStep(1)} className="px-6 py-3 rounded-lg border text-sm font-medium"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Retour</button>
        <button onClick={() => setStep(3)}
          disabled={!formData.departure_station_id || !formData.arrival_station_id}
          className="px-6 py-3 rounded-lg text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: 'var(--primary)' }}>
          Continuer
        </button>
      </div>
    </div>
  );

  const renderStep3 = () => (
    <div>
      <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
        Étape 3 : Points de transit (optionnel)
      </h2>
      <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
        Ajoutez des arrêts intermédiaires entre le départ et l'arrivée.
      </p>
      <div className="mb-4 p-3 rounded-xl flex items-center gap-3 border text-sm"
        style={{ backgroundColor: 'var(--surface-raised)', borderColor: 'var(--border)' }}>
        <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
          {allStations.find(s => s.id === formData.departure_station_id)?.name || '—'}
        </span>
        <ChevronRight className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
        <span style={{ color: 'var(--text-muted)' }}>transits...</span>
        <ChevronRight className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
        <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
          {allStations.find(s => s.id === formData.arrival_station_id)?.name || '—'}
        </span>
      </div>
      <div className="space-y-3 mb-4">
        {transitStops.map((stop, i) => (
          <div key={i} className="p-4 border rounded-xl" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
                style={{ backgroundColor: 'var(--primary)' }}>{i + 1}</div>
              <span className="font-medium text-sm" style={{ color: 'var(--text-secondary)' }}>Arrêt intermédiaire</span>
              <button onClick={() => removeTransitStop(i)}
                className="ml-auto p-1 rounded-lg hover:bg-red-50 text-red-500 transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-3 sm:col-span-1">
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Gare</label>
                <select value={stop.station_id} onChange={(e) => updateTransitStop(i, 'station_id', e.target.value)}
                  className="w-full p-2 border rounded-lg text-sm"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}>
                  <option value="">Choisir...</option>
                  {allStations.filter(s => !usedStationIds.has(s.id) || s.id === stop.station_id)
                    .map(s => <option key={s.id} value={s.id}>{s.name} ({s.city_name})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Arrivée (min)</label>
                <input type="number" min={1} value={stop.arrival_offset_minutes}
                  onChange={(e) => updateTransitStop(i, 'arrival_offset_minutes', parseInt(e.target.value))}
                  className="w-full p-2 border rounded-lg text-sm"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Départ (min)</label>
                <input type="number" min={1} value={stop.departure_offset_minutes}
                  onChange={(e) => updateTransitStop(i, 'departure_offset_minutes', parseInt(e.target.value))}
                  className="w-full p-2 border rounded-lg text-sm"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
              </div>
            </div>
          </div>
        ))}
      </div>
      <button onClick={addTransitStop}
        className="flex items-center gap-2 px-4 py-2 border-2 border-dashed rounded-xl text-sm font-medium w-full justify-center hover:bg-gray-50 transition-colors"
        style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}>
        <Plus className="w-4 h-4" /> Ajouter un point de transit
      </button>
      <div className="flex gap-4 mt-6">
        <button onClick={() => setStep(2)} className="px-6 py-3 rounded-lg border text-sm font-medium"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Retour</button>
        <button onClick={() => setStep(4)} className="px-6 py-3 rounded-lg text-white font-medium"
          style={{ backgroundColor: 'var(--primary)' }}>Continuer</button>
      </div>
    </div>
  );

  const renderStep4 = () => (
    <div>
      <h2 className="text-xl font-bold mb-6" style={{ color: 'var(--text-primary)' }}>
        Étape 4 : Date et heure de départ
      </h2>
      <div>
        <label className="block mb-2 font-medium text-sm" style={{ color: 'var(--text-secondary)' }}>
          Date et heure de départ *
        </label>
        <input type="datetime-local" value={formData.departure_datetime}
          onChange={(e) => setFormData(prev => ({ ...prev, departure_datetime: e.target.value }))}
          className="w-full p-3 border rounded-xl text-sm"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
      </div>
      {selectedRoute && formData.departure_datetime && (
        <div className="mt-4 p-4 rounded-xl" style={{ backgroundColor: 'var(--primary-light)' }}>
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-5 h-5" style={{ color: 'var(--primary)' }} />
            <span className="font-semibold text-sm" style={{ color: 'var(--primary)' }}>Arrivée estimée</span>
          </div>
          <p className="text-lg font-bold" style={{ color: 'var(--primary)' }}>
            {formData.arrival_datetime ? format(new Date(formData.arrival_datetime), 'dd/MM/yyyy à HH:mm') : '—'}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
            Durée : {formatHours(selectedRoute.estimated_duration_minutes / 60)}
          </p>
        </div>
      )}
      <div className="flex gap-4 mt-6">
        <button onClick={() => setStep(3)} className="px-6 py-3 rounded-lg border text-sm font-medium"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Retour</button>
        <button onClick={() => { setStep(5); loadAvailableBuses(formData.departure_datetime, formData.arrival_datetime); }} disabled={!formData.departure_datetime}
          className="px-6 py-3 rounded-lg text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: 'var(--primary)' }}>Continuer</button>
      </div>
    </div>
  );

  const renderStep5 = () => {
    const q = busSearch.trim().toLowerCase();
    const filteredBuses = q
      ? buses.filter(b =>
          b.license_plate.toLowerCase().includes(q) ||
          (b.model || '').toLowerCase().includes(q)
        )
      : buses;

    const selectedBus = buses.find(b => b.id === formData.bus_id);

    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Étape 5 : Sélection du bus</h2>
          <button onClick={loadAvailableBuses} disabled={loadingBuses}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
            <Clock className="w-4 h-4" /> Rafraîchir
          </button>
        </div>

        {/* Search field */}
        <div className="relative mb-5">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            value={busSearch}
            onChange={e => setBusSearch(e.target.value)}
            placeholder="Rechercher par plaque (ex: AB-1234-CI, 1234, AB-…)"
            className="w-full pl-9 pr-9 py-3 border rounded-xl text-sm outline-none focus:ring-2"
            style={{
              borderColor: 'var(--border)',
              backgroundColor: 'var(--surface)',
              color: 'var(--text-primary)',
            }}
          />
          {busSearch && (
            <button onClick={() => setBusSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-100">
              <X className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
            </button>
          )}
        </div>

        {/* Selected bus summary */}
        {selectedBus && (
          <div className="mb-4 px-4 py-3 rounded-xl flex items-center gap-3 border-2"
            style={{ borderColor: 'var(--primary)', backgroundColor: 'var(--primary-light)' }}>
            <CheckCircle className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--primary)' }} />
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{selectedBus.license_plate}</p>
              <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                {[selectedBus.companies?.name, selectedBus.model, selectedBus.capacity ? `${selectedBus.capacity} places` : null].filter(Boolean).join(' · ')}
              </p>
            </div>
            <button onClick={() => setFormData(prev => ({ ...prev, bus_id: '' }))}
              className="text-xs px-2 py-1 rounded-lg border font-medium"
              style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}>
              Changer
            </button>
          </div>
        )}

        {loadingBuses ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-4 rounded-full animate-spin"
              style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
            <span className="ml-3 text-sm" style={{ color: 'var(--text-secondary)' }}>Vérification...</span>
          </div>
        ) : (
          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {filteredBuses.map(bus => {
              const isSelected = formData.bus_id === bus.id;
              const hasConflict = !bus.isAvailable;
              return (
                <div key={bus.id}
                  onClick={() => setFormData(prev => ({ ...prev, bus_id: bus.id }))}
                  className="px-4 py-3 border-2 rounded-xl transition-all cursor-pointer"
                  style={{
                    borderColor: isSelected ? 'var(--primary)' : hasConflict ? '#FBBF24' : 'var(--border)',
                    backgroundColor: isSelected ? 'var(--primary-light)' : hasConflict ? '#FFFBEB' : 'transparent',
                  }}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Bus className="w-4 h-4 flex-shrink-0"
                        style={{ color: isSelected ? 'var(--primary)' : hasConflict ? '#D97706' : 'var(--primary)' }} />
                      <div className="min-w-0">
                        {/* Row 1: plate | company | capacity */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                            {bus.license_plate}
                          </span>
                          {bus.companies?.name && (
                            <>
                              <span style={{ color: 'var(--text-muted)' }}>·</span>
                              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                                {bus.companies.name}
                              </span>
                            </>
                          )}
                          {bus.model && (
                            <>
                              <span style={{ color: 'var(--text-muted)' }}>·</span>
                              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{bus.model}</span>
                            </>
                          )}
                          {bus.capacity > 0 && (
                            <>
                              <span style={{ color: 'var(--text-muted)' }}>·</span>
                              <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                                {bus.capacity} places
                              </span>
                            </>
                          )}
                        </div>
                        {/* Row 2: availability status */}
                        <span className="inline-block mt-0.5 text-xs font-semibold"
                          style={{ color: hasConflict ? '#DC2626' : '#16A34A' }}>
                          {hasConflict ? (bus.availabilityMessage || 'Ce bus est déjà affecté sur ce créneau.') : 'Disponible'}
                        </span>
                      </div>
                    </div>
                    {isSelected && (
                      <CheckCircle className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--primary)' }} />
                    )}
                  </div>
                  {/* Inline conflict warning when selected */}
                  {isSelected && hasConflict && (
                    <div className="mt-2 flex items-start gap-2 rounded-lg px-3 py-2"
                      style={{ backgroundColor: '#FEE2E2', border: '1px solid #FECACA' }}>
                      <span className="text-xs font-bold" style={{ color: '#DC2626' }}>
                        Avertissement : Ce bus est déjà affecté sur ce créneau. Vous pouvez quand même enregistrer le voyage.
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
            {filteredBuses.length === 0 && buses.length > 0 && (
              <div className="text-center py-8 rounded-xl border-2 border-dashed" style={{ borderColor: 'var(--border)' }}>
                <Search className="w-8 h-8 mx-auto mb-2" style={{ color: '#D1D5DB' }} />
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Aucun bus correspond à "<span className="font-medium">{busSearch}</span>"
                </p>
                <button onClick={() => setBusSearch('')} className="mt-2 text-xs underline" style={{ color: 'var(--primary)' }}>
                  Effacer la recherche
                </button>
              </div>
            )}
            {buses.length === 0 && (
              <div className="text-center py-10 rounded-xl border-2 border-dashed" style={{ borderColor: 'var(--border)' }}>
                <Bus className="w-10 h-10 mx-auto mb-3" style={{ color: '#D1D5DB' }} />
                <p style={{ color: 'var(--text-secondary)' }}>Aucun bus disponible pour ce créneau</p>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-4 mt-6">
          <button onClick={() => setStep(4)} className="px-6 py-3 rounded-lg border text-sm font-medium"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Retour</button>
          <button onClick={() => { setStep(6); loadAvailableDrivers(formData.departure_datetime, formData.arrival_datetime); }} disabled={!formData.bus_id}
            className="px-6 py-3 rounded-lg text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--primary)' }}>Continuer</button>
        </div>
      </div>
    );
  };

  const renderStep6 = () => {
    const dq = driverSearch.trim().toLowerCase();
    const filteredDrivers = dq
      ? drivers.filter(d => d.full_name.toLowerCase().includes(dq))
      : drivers;

    const selectedDriver = drivers.find(d => d.id === formData.driver_id);

    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Étape 6 : Chauffeur et confirmation</h2>
          <button onClick={loadAvailableDrivers} disabled={loadingDrivers}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
            <Clock className="w-4 h-4" /> Rafraîchir
          </button>
        </div>

        {/* Search field */}
        <div className="relative mb-5">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            value={driverSearch}
            onChange={e => setDriverSearch(e.target.value)}
            placeholder="Rechercher par nom ou prénom…"
            className="w-full pl-9 pr-9 py-3 border rounded-xl text-sm outline-none focus:ring-2"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
          />
          {driverSearch && (
            <button onClick={() => setDriverSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-100">
              <X className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
            </button>
          )}
        </div>

        {/* Selected driver summary */}
        {selectedDriver && (
          <div className="mb-4 px-4 py-3 rounded-xl flex items-center gap-3 border-2"
            style={{ borderColor: 'var(--primary)', backgroundColor: 'var(--primary-light)' }}>
            <CheckCircle className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--primary)' }} />
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{selectedDriver.full_name}</p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {formatHours(selectedDriver.hoursRemainingToday)} restantes · Disponible
              </p>
            </div>
            <button onClick={() => setFormData(prev => ({ ...prev, driver_id: '' }))}
              className="text-xs px-2 py-1 rounded-lg border font-medium"
              style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}>
              Changer
            </button>
          </div>
        )}

        {loadingDrivers ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-4 rounded-full animate-spin"
              style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
            <span className="ml-3 text-sm" style={{ color: 'var(--text-secondary)' }}>Vérification...</span>
          </div>
        ) : (
          <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1 mb-6">
            {filteredDrivers.map(driver => {
              const pct = Math.min(100, (driver.hoursRemainingToday / 9) * 100);
              const isSelected = formData.driver_id === driver.id;
              const hasConflict = !driver.isAvailable && !!driver.availabilityMessage && driver.availabilityMessage.includes('créneau');
              const isHoursBlocked = !driver.isAvailable && !hasConflict;
              return (
                <div key={driver.id}
                  onClick={() => !isHoursBlocked && setFormData(prev => ({ ...prev, driver_id: driver.id }))}
                  className="px-4 py-3 border-2 rounded-xl transition-all"
                  style={{
                    borderColor: isSelected ? 'var(--primary)' : hasConflict ? '#FBBF24' : isHoursBlocked ? '#E5E7EB' : 'var(--border)',
                    backgroundColor: isSelected ? 'var(--primary-light)' : hasConflict ? '#FFFBEB' : isHoursBlocked ? '#F9FAFB' : 'transparent',
                    opacity: isHoursBlocked ? 0.5 : 1,
                    cursor: isHoursBlocked ? 'not-allowed' : 'pointer',
                  }}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <User className="w-4 h-4 flex-shrink-0"
                        style={{ color: isSelected ? 'var(--primary)' : hasConflict ? '#D97706' : isHoursBlocked ? '#9CA3AF' : 'var(--primary)' }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                            {driver.full_name}
                          </span>
                          <span style={{ color: 'var(--text-muted)' }}>·</span>
                          <span className="text-xs font-semibold"
                            style={{ color: driver.hoursRemainingToday < 2 ? '#DC2626' : 'var(--text-secondary)' }}>
                            {formatHours(driver.hoursRemainingToday)} restantes
                          </span>
                          <span style={{ color: 'var(--text-muted)' }}>·</span>
                          <span className="text-xs font-semibold"
                            style={{ color: driver.isAvailable ? '#16A34A' : '#DC2626' }}>
                            {driver.isAvailable ? 'Disponible' : hasConflict ? 'Déjà affecté' : (driver.availabilityMessage || 'Non disponible')}
                          </span>
                        </div>
                        <div className="mt-1.5 w-full h-1.5 rounded-full bg-gray-200 overflow-hidden">
                          <div className="h-full rounded-full transition-all"
                            style={{ width: `${pct}%`, backgroundColor: pct < 20 ? '#DC2626' : pct < 50 ? '#F59E0B' : '#16A34A' }} />
                        </div>
                      </div>
                    </div>
                    {isSelected && (
                      <CheckCircle className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--primary)' }} />
                    )}
                  </div>
                  {/* Inline conflict warning when selected */}
                  {isSelected && hasConflict && (
                    <div className="mt-2 flex items-start gap-2 rounded-lg px-3 py-2"
                      style={{ backgroundColor: '#FEE2E2', border: '1px solid #FECACA' }}>
                      <span className="text-xs font-bold" style={{ color: '#DC2626' }}>
                        Avertissement : Ce chauffeur est déjà affecté à un autre créneau. Vous pouvez quand même enregistrer le voyage.
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
            {filteredDrivers.length === 0 && drivers.length > 0 && (
              <div className="text-center py-8 rounded-xl border-2 border-dashed" style={{ borderColor: 'var(--border)' }}>
                <Search className="w-8 h-8 mx-auto mb-2" style={{ color: '#D1D5DB' }} />
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Aucun chauffeur correspond à "<span className="font-medium">{driverSearch}</span>"
                </p>
                <button onClick={() => setDriverSearch('')} className="mt-2 text-xs underline" style={{ color: 'var(--primary)' }}>
                  Effacer la recherche
                </button>
              </div>
            )}
            {drivers.length === 0 && (
              <div className="text-center py-10 rounded-xl border-2 border-dashed" style={{ borderColor: 'var(--border)' }}>
                <User className="w-10 h-10 mx-auto mb-3" style={{ color: '#D1D5DB' }} />
                <p style={{ color: 'var(--text-secondary)' }}>Aucun chauffeur disponible</p>
              </div>
            )}
          </div>
        )}

        <div className="mb-6">
          <button
            type="button"
            onClick={() => setFormData(prev => ({ ...prev, is_ramassage: !prev.is_ramassage }))}
            className="w-full flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-all"
            style={{
              borderColor: formData.is_ramassage ? '#EA580C' : 'var(--border)',
              backgroundColor: formData.is_ramassage ? '#FFF7ED' : 'transparent',
            }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: formData.is_ramassage ? '#FDBA74' : 'var(--neutral-100)' }}>
              <Truck className="w-5 h-5" style={{ color: formData.is_ramassage ? '#9A3412' : 'var(--text-muted)' }} />
            </div>
            <div className="flex-1">
              <p className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Ramassage</p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Cocher si ce voyage est un trajet de ramassage. La gare de destination pourra enregistrer le montant collecte.
              </p>
            </div>
            <div className="w-6 h-6 rounded border-2 flex items-center justify-center flex-shrink-0"
              style={{
                borderColor: formData.is_ramassage ? '#EA580C' : '#D1D5DB',
                backgroundColor: formData.is_ramassage ? '#EA580C' : 'transparent',
              }}>
              {formData.is_ramassage && <CheckCircle className="w-4 h-4 text-white" />}
            </div>
          </button>
        </div>

        <div className="mb-6">
          <label className="block mb-2 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            Copilote (optionnel)
          </label>
          <select value={formData.copilot_id}
            onChange={(e) => setFormData(prev => ({ ...prev, copilot_id: e.target.value }))}
            className="w-full p-3 border rounded-xl text-sm"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}>
            <option value="">Aucun copilote</option>
            {drivers.filter(d => d.isAvailable && d.id !== formData.driver_id).map(d => (
              <option key={d.id} value={d.id}>{d.full_name} — {formatHours(d.hoursRemainingToday)} restantes</option>
            ))}
          </select>
        </div>

        {validationErrors.length > 0 && (
          <div className="mb-6 p-4 rounded-xl border-2" style={{ backgroundColor: '#FEF2F2', borderColor: '#EF4444' }}>
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: '#EF4444' }} />
              <div>
                <p className="font-semibold mb-2 text-sm" style={{ color: '#EF4444' }}>Erreurs :</p>
                <ul className="list-disc list-inside space-y-1">
                  {validationErrors.map((err, idx) => (
                    <li key={idx} className="text-sm" style={{ color: '#DC2626' }}>{err}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-4 mt-6">
          <button onClick={() => setStep(5)} className="px-6 py-3 rounded-lg border text-sm font-medium"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Retour</button>
          <button onClick={handleSubmit} disabled={loading || !formData.driver_id}
            className="flex-1 px-6 py-3 rounded-lg text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--primary)' }}>
            {loading ? 'Création en cours...' : 'Créer le voyage'}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <button onClick={() => navigate('/chef-gare/planning')}
        className="flex items-center gap-2 mb-6 text-sm hover:underline"
        style={{ color: 'var(--text-secondary)' }}>
        <ArrowLeft className="w-4 h-4" />
        Retour au planning
      </button>
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
          Nouveau voyage
        </h1>
        <div className="flex gap-1 mt-4">
          {STEPS.map((label, i) => {
            const s = i + 1;
            return (
              <div key={s} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full h-2 rounded-full transition-all"
                  style={{ backgroundColor: s <= step ? 'var(--primary)' : 'var(--neutral-200)' }} />
                <span className="text-xs hidden sm:block"
                  style={{ color: s === step ? 'var(--primary)' : 'var(--text-muted)', fontWeight: s === step ? 700 : 400 }}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="rounded-2xl p-8 border shadow-sm" style={{ backgroundColor: 'var(--surface)' }}>
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}
        {step === 5 && renderStep5()}
        {step === 6 && renderStep6()}
      </div>
    </div>
  );
}
