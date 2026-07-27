import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';
import {
  Search, MapPin, ChevronRight, Bus, Users, Calendar,
  User, Phone, CreditCard, CheckCircle, Printer, ArrowLeft,
  Banknote, Smartphone, RefreshCw, Clock, AlertCircle, AlertTriangle, Tag,
  LayoutGrid, WifiOff, List, LogIn, LogOut, Luggage, ChevronDown, ChevronUp,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { formatCurrency } from '../../utils/formatCurrency';
import { QRCodeSVG } from 'qrcode.react';
import jsPDF from 'jspdf';
import { useSeatMap } from '../../hooks/useSeatMap';
import { BusSeatMapPanel } from '../../components/bus/BusSeatMapPanel';
import { isSeatStillAvailable, getSiblingOccupancy } from '../../services/seatMap.service';
import type { EnrichedSeat } from '../../types/seatMap.types';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useOfflineTickets } from '../../hooks/useOfflineTickets';
import { offlineStore, type CachedSchedule } from '../../services/offlineStore';
import { offlineSyncService } from '../../services/offlineSync';
import OfflineBanner from '../../components/guichetier/OfflineBanner';
import OfflineQueue from '../../components/guichetier/OfflineQueue';
import { printBaggageTicket, generateBaggageNumber, type BaggageTicketData } from '../../utils/printBaggageTicket';

interface City { id: string; name: string; }
interface Station { id: string; name: string; city_id: string; }

interface Schedule {
  id: string;
  route_name: string;
  departure_datetime: string;
  arrival_datetime: string;
  price: number;
  seats_available: number;
  seats_reserved: number;
  estimated_duration_minutes: number | null;
  notes: string | null;
  bus_id: string;
  is_anticipated?: boolean;
  buses: {
    registration_number: string;
    total_seats: number;
    class: string;
    model: string | null;
    brand: string | null;
    seat_config_id: string | null;
  } | null;
  route: {
    id: string;
    name: string;
    origin_city_id: string;
    destination_city_id: string;
    distance_km: number | null;
    base_price: number | null;
  };
  origin_city_name: string;
  destination_city_name: string;
  transit_stops?: { station_id: string; station_name: string; price: number; position: number; arrival_offset_minutes: number; departure_offset_minutes: number }[];
  transit_match?: { station_id: string; station_name: string; price: number };
}

interface ConfirmedTicket {
  booking_reference: string;
  passenger_name: string;
  passenger_phone: string;
  seat_numbers: string[];
  total_price: number;
  payment_method: string;
  schedule: Schedule;
  payment_reference?: string;
  change_amount?: number;
  savedOffline?: boolean;
  boarding_station?: string;
  alighting_station?: string;
  departure_number?: number | null;
  baggage?: BaggageTicketData;
}

type Step = 'search' | 'select' | 'seats' | 'confirm';

const STEPS: { id: Step; label: string }[] = [
  { id: 'search', label: 'Recherche' },
  { id: 'select', label: 'Voyage' },
  { id: 'seats', label: 'Vente' },
  { id: 'confirm', label: 'Confirmation' },
];

const BUS_CLASS_LABELS: Record<string, string> = {
  standard: 'Standard',
  vip: 'VIP',
  executive: 'Executive',
};

const PAYMENT_METHODS = [
  { value: 'especes', label: 'Espèces', icon: <Banknote className="w-6 h-6" /> },
  { value: 'mobile_money', label: 'Mobile Money', icon: <Smartphone className="w-6 h-6" /> },
  { value: 'carte', label: 'Carte bancaire', icon: <CreditCard className="w-6 h-6" /> },
  { value: 'virement', label: 'Virement', icon: <RefreshCw className="w-6 h-6" /> },
];

export default function TicketSale() {
  const { user } = useAuthStore();
  const { isOnline, wasOffline } = useOnlineStatus();
  const { tickets, pendingCount, syncing, syncNow, deleteTicket, reload: reloadOfflineTickets } = useOfflineTickets();
  const [showQueue, setShowQueue] = useState(false);

  // Server time sync: offset between local clock and server clock
  const serverOffsetRef = useRef(0);
  const getServerNow = useCallback(() => new Date(Date.now() + serverOffsetRef.current), []);
  const [now, setNow] = useState(() => new Date());
  const [driftWarning, setDriftWarning] = useState(false);
  const [step, setStep] = useState<Step>('search');
  const [cities, setCities] = useState<City[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(null);
  const [seatCount, setSeatCount] = useState(1);
  const {
    seatMap,
    isLoading: seatMapLoading,
    error: seatMapError,
    selectedSeats: enrichedSelectedSeats,
    toggleSeat,
    clearSelection: clearSeatSelection,
    totalSelectedPrice,
    refresh,
    lockCountdowns,
  } = useSeatMap({
    scheduleId: selectedSchedule?.id ?? null,
    enableRealtime: isOnline && step === 'seats',
  });

  const hasSeatMap = !seatMapLoading && !!seatMap;
  const selectedSeats = enrichedSelectedSeats.map(s => s.label);

  const [loadingSchedules, setLoadingSchedules] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [confirmedTicket, setConfirmedTicket] = useState<ConfirmedTicket | null>(null);
  const autoPrintAndResetRef = useRef(false);
  const printRef = useRef<HTMLDivElement>(null);
  const [myCounterId, setMyCounterId] = useState<string | null>(null);
  const [myStationId, setMyStationId] = useState<string | null>(null);
  const [myCityId, setMyCityId] = useState<string | null>(null);
  const [myStationName, setMyStationName] = useState<string | null>(null);
  const [assignedDestCityIds, setAssignedDestCityIds] = useState<string[] | null>(null);

  const [search, setSearch] = useState({
    origin_city_id: '',
    destination_city_id: '',
    date: format(new Date(), 'yyyy-MM-dd'),
  });

  const [passenger, setPassenger] = useState({
    name: '',
    phone: '',
    id_number: '',
  });

  const [boardingStationId, setBoardingStationId] = useState('');
  const [alightingStationId, setAlightingStationId] = useState('');
  const [boardingStations, setBoardingStations] = useState<Station[]>([]);
  const [alightingStations, setAlightingStations] = useState<Station[]>([]);

  interface TransitStopDest { station_id: string; station_name: string; city_name: string; price: number; position: number }
  const [transitDestinations, setTransitDestinations] = useState<TransitStopDest[]>([]);
  const [selectedTransitPrice, setSelectedTransitPrice] = useState<number | null>(null);

  const [payment, setPayment] = useState({
    method: 'especes' as 'especes' | 'carte' | 'mobile_money' | 'virement' | '',
    amount_received: 0,
    reference: '',
    mobile_provider: '',
  });

  const [showBaggage, setShowBaggage] = useState(false);
  const [showPassengerInfo, setShowPassengerInfo] = useState(false);
  type BaggageMode = 'none' | 'avec_ticket' | 'avec_ticket_reporte' | 'sans_ticket';
  const [baggageForm, setBaggageForm] = useState<{
    mode: BaggageMode;
    has_ticket: boolean;
    destination: string;
    price: number;
    seat_number: string;
    departure_number: string;
    bus_registration: string;
    description: string;
    owner_name: string;
    owner_phone: string;
  }>({
    mode: 'none',
    has_ticket: false,
    destination: '',
    price: 0,
    seat_number: '',
    departure_number: '',
    bus_registration: '',
    description: '',
    owner_name: '',
    owner_phone: '',
  });

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user: u } }) => {
      if (!u) return;
      const { data } = await supabase.from('counters')
        .select('id, station_id, stations:station_id(name, city_id)')
        .eq('assigned_user_id', u.id)
        .maybeSingle();
      if (!data) return;
      setMyCounterId(data.id);
      setMyStationId(data.station_id);
      const st = data.stations as any;
      if (st?.city_id) {
        setMyCityId(st.city_id);
        setMyStationName(st.name ?? null);
        setSearch(prev => ({ ...prev, origin_city_id: st.city_id }));
      }
      const { data: crData } = await supabase
        .from('counter_routes')
        .select('route_id, routes:route_id(destination_city_id)')
        .eq('counter_id', data.id);
      if (crData && crData.length > 0) {
        const routeIds = crData.map((cr: any) => cr.route_id).filter(Boolean);
        const destIds = new Set(crData.map((cr: any) => (cr.routes as any)?.destination_city_id).filter(Boolean));

        // Also include cities served by transit stops of assigned route schedules
        const { data: transitData } = await supabase
          .from('schedules')
          .select('transit_stops')
          .in('route_id', routeIds)
          .not('transit_stops', 'is', null);
        if (transitData) {
          const transitStationIds = new Set<string>();
          for (const sched of transitData) {
            const stops = (sched.transit_stops || []) as any[];
            for (const stop of stops) {
              if (stop.station_id) transitStationIds.add(stop.station_id);
            }
          }
          if (transitStationIds.size > 0) {
            const { data: stData } = await supabase
              .from('stations')
              .select('city_id')
              .in('id', [...transitStationIds]);
            if (stData) {
              for (const s of stData) {
                if (s.city_id) destIds.add(s.city_id);
              }
            }
          }
        }

        setAssignedDestCityIds([...destIds] as string[]);
      }
    });

    loadCities();
    const stopSync = offlineSyncService.startAutoSync(30_000);

    // Sync server time offset on mount and periodically
    const syncServerTime = async () => {
      try {
        const before = Date.now();
        const { data, error } = await supabase.rpc('get_server_time');
        const after = Date.now();
        if (!error && data) {
          const serverMs = new Date(data).getTime();
          const roundTripMs = after - before;
          const estimatedServerNow = serverMs + roundTripMs / 2;
          serverOffsetRef.current = estimatedServerNow - after;
          const driftSec = Math.abs(serverOffsetRef.current / 1000);
          setDriftWarning(driftSec > 300);
        }
      } catch (_) {}
    };
    syncServerTime();
    const serverSyncTimer = setInterval(syncServerTime, 60_000);

    // Horloge 1 s basée sur l'heure serveur
    const clockTimer = setInterval(() => setNow(new Date(Date.now() + serverOffsetRef.current)), 1000);

    // Toutes les 30 s, déclencher la transition planifie → en_cours en DB
    const transitionTimer = setInterval(async () => {
      try {
        await supabase.rpc('auto_transition_departed_schedules');
      } catch (_) {}
    }, 30_000);

    // Appel immédiat au montage
    supabase.rpc('auto_transition_departed_schedules').then(() => {}).catch(() => {});

    return () => {
      stopSync();
      clearInterval(clockTimer);
      clearInterval(transitionTimer);
      clearInterval(serverSyncTimer);
    };
  }, []);

  useEffect(() => {
    if (isOnline && pendingCount > 0) {
      syncNow();
    }
  }, [isOnline]);

  // Realtime: refresh seats_available when any displayed schedule changes
  const schedulesRef = useRef(schedules);
  schedulesRef.current = schedules;
  const selectedScheduleRef = useRef(selectedSchedule);
  selectedScheduleRef.current = selectedSchedule;

  useEffect(() => {
    if (!isOnline || schedules.length === 0) return;

    const channel = supabase
      .channel('guichetier-schedule-seats')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'schedules',
      }, (payload: any) => {
        const updated = payload.new;
        if (!updated) return;
        const current = schedulesRef.current;
        const busIds = new Set(current.map(s => s.bus_id));
        const scheduleIds = new Set(current.map(s => s.id));

        if (scheduleIds.has(updated.id) || busIds.has(updated.bus_id)) {
          setSchedules(prev => prev.map(s => {
            if (s.id === updated.id || (s.bus_id === updated.bus_id && s.departure_datetime === updated.departure_datetime)) {
              return { ...s, seats_available: updated.seats_available, seats_reserved: updated.seats_reserved };
            }
            return s;
          }));
          const sel = selectedScheduleRef.current;
          if (sel && (sel.id === updated.id || (sel.bus_id === updated.bus_id && sel.departure_datetime === updated.departure_datetime))) {
            setSelectedSchedule(prev => prev ? { ...prev, seats_available: updated.seats_available, seats_reserved: updated.seats_reserved } : prev);
          }
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, schedules.length]);

  const loadCities = async () => {
    try {
      const { data } = await supabase
        .from('cities')
        .select('id, name')
        .eq('is_active', true)
        .order('name');
      if (data && data.length > 0) {
        setCities(data);
        await offlineStore.cacheCities(data);
        return;
      }
    } catch (_) {}
    const cached = await offlineStore.getCachedCities();
    setCities(cached);
    if (cached.length === 0 && !isOnline) {
      toast('Mode hors-ligne : villes non disponibles. Connectez-vous une fois pour charger les données.', { icon: '📡' });
    }
  };

  const handleSearch = async () => {
    if (!search.origin_city_id || !search.destination_city_id) {
      toast.error('Sélectionnez les villes de départ et d\'arrivée');
      return;
    }
    if (search.origin_city_id === search.destination_city_id) {
      toast.error('Les villes de départ et d\'arrivée doivent être différentes');
      return;
    }

    setLoadingSchedules(true);
    try {
      await searchOnline();
    } catch (_) {
      try {
        await searchOffline();
      } catch (err: any) {
        toast.error('Impossible de rechercher des voyages');
      }
    } finally {
      setLoadingSchedules(false);
    }
  };

  const searchOnline = async () => {
    const startOfDay = `${search.date}T00:00:00+00:00`;
    const endOfDay = `${search.date}T23:59:59+00:00`;

    if (!myCounterId || !myStationId) {
      setSchedules([]);
      setStep('select');
      return;
    }

    const { data: assignedRoutes } = await supabase
      .from('counter_routes')
      .select('route_id')
      .eq('counter_id', myCounterId);
    const assignedRouteIds = new Set((assignedRoutes || []).map((r: any) => r.route_id));
    if (assignedRouteIds.size === 0) {
      setSchedules([]);
      setStep('select');
      return;
    }

    const originCityName = cities.find(c => c.id === search.origin_city_id)?.name || '';
    const destCityName = cities.find(c => c.id === search.destination_city_id)?.name || '';

    // 1) Direct route search: origin → destination
    const { data: routeData } = await supabase
      .from('routes')
      .select('id, name, origin_city_id, destination_city_id, distance_km, base_price')
      .eq('origin_city_id', search.origin_city_id)
      .eq('destination_city_id', search.destination_city_id)
      .eq('is_active', true);

    const directRouteIds = (routeData || []).map(r => r.id).filter(id => assignedRouteIds.has(id));
    const routeMap = Object.fromEntries((routeData || []).map(r => [r.id, r]));

    let directSchedules: any[] = [];
    if (directRouteIds.length > 0) {
      const { data } = await supabase
        .from('schedules')
        .select(`
          id, route_name, departure_datetime, arrival_datetime,
          price, seats_available, seats_reserved, estimated_duration_minutes, notes,
          route_id, bus_id, departure_station_id, transit_stops, is_anticipated,
          buses:bus_id(registration_number, total_seats, class, model, brand, seat_config_id)
        `)
        .in('route_id', directRouteIds)
        .eq('departure_station_id', myStationId)
        .in('status', ['planifie', 'en_cours', 'embarquement'])
        .gte('departure_datetime', startOfDay)
        .lte('departure_datetime', endOfDay)
        .order('departure_datetime');
      directSchedules = (data || []).filter(
        (s: any) => s.departure_station_id === myStationId && assignedRouteIds.has(s.route_id)
      );
    }

    // 2) Transit stop search: find schedules from origin that pass through the destination city
    const { data: destStations } = await supabase
      .from('stations')
      .select('id, city_id')
      .eq('city_id', search.destination_city_id)
      .eq('is_active', true);
    const destStationIds = new Set((destStations || []).map(s => s.id));

    let transitSchedules: any[] = [];
    const transitMatchMap = new Map<string, { station_id: string; station_name: string; price: number }>();

    if (destStationIds.size > 0) {
      // Find routes from this origin (any destination) assigned to this counter
      const { data: allOriginRoutes } = await supabase
        .from('routes')
        .select('id, name, origin_city_id, destination_city_id, distance_km, base_price')
        .eq('origin_city_id', search.origin_city_id)
        .neq('destination_city_id', search.destination_city_id)
        .eq('is_active', true);

      const transitRouteIds = (allOriginRoutes || []).map(r => r.id).filter(id => assignedRouteIds.has(id));
      if (transitRouteIds.length > 0) {
        const { data } = await supabase
          .from('schedules')
          .select(`
            id, route_name, departure_datetime, arrival_datetime,
            price, seats_available, seats_reserved, estimated_duration_minutes, notes,
            route_id, bus_id, departure_station_id, transit_stops, is_anticipated,
            buses:bus_id(registration_number, total_seats, class, model, brand, seat_config_id)
          `)
          .in('route_id', transitRouteIds)
          .eq('departure_station_id', myStationId)
          .in('status', ['planifie', 'en_cours', 'embarquement'])
          .gte('departure_datetime', startOfDay)
          .lte('departure_datetime', endOfDay)
          .not('transit_stops', 'is', null)
          .order('departure_datetime');

        // Filter: only keep schedules that have a transit stop matching a station in destination city
        for (const s of (data || [])) {
          if (s.departure_station_id !== myStationId || !assignedRouteIds.has(s.route_id)) continue;
          const stops = (s.transit_stops || []) as any[];
          const match = stops.find((st: any) => destStationIds.has(st.station_id) && st.price > 0);
          if (match) {
            transitSchedules.push(s);
            transitMatchMap.set(s.id, { station_id: match.station_id, station_name: match.station_name, price: match.price });
          }
        }

        // Add route data for transit schedules
        for (const r of (allOriginRoutes || [])) {
          if (!routeMap[r.id]) routeMap[r.id] = r;
        }
      }
    }

    // 3) Merge: direct schedules + transit schedules (deduplicate by id)
    const seenIds = new Set<string>();
    const enriched: Schedule[] = [];

    for (const s of directSchedules) {
      seenIds.add(s.id);
      const route = routeMap[s.route_id];
      enriched.push({
        ...s,
        price: s.price ?? route?.base_price ?? 0,
        route,
        origin_city_name: originCityName,
        destination_city_name: destCityName,
      });
    }

    for (const s of transitSchedules) {
      if (seenIds.has(s.id)) continue;
      seenIds.add(s.id);
      const route = routeMap[s.route_id];
      const match = transitMatchMap.get(s.id)!;
      enriched.push({
        ...s,
        price: match.price,
        route,
        origin_city_name: originCityName,
        destination_city_name: destCityName,
        transit_match: match,
      });
    }

    enriched.sort((a, b) => a.departure_datetime.localeCompare(b.departure_datetime));
    setSchedules(enriched);
    setStep('select');

    const anticipated = enriched.filter(s => s.is_anticipated);
    if (anticipated.length > 0) {
      const occupancyMap: Record<string, number> = {};
      await Promise.all(anticipated.map(async s => {
        occupancyMap[s.id] = await getSiblingOccupancy(s.id);
      }));
      setSchedules(prev => prev.map(s => {
        if (!s.is_anticipated) return s;
        const totalReserved = occupancyMap[s.id] ?? (s.seats_reserved || 0);
        const capacity = s.buses?.total_seats ?? 60;
        return { ...s, seats_reserved: totalReserved, seats_available: Math.max(0, capacity - totalReserved) };
      }));
    }

    const toCache: CachedSchedule[] = enriched.map(s => ({
      id: s.id,
      cachedAt: new Date().toISOString(),
      route_name: s.route_name,
      departure_datetime: s.departure_datetime,
      arrival_datetime: s.arrival_datetime,
      price: s.price,
      seats_available: s.seats_available,
      seats_reserved: s.seats_reserved,
      estimated_duration_minutes: s.estimated_duration_minutes,
      notes: s.notes,
      bus_id: s.bus_id,
      buses: s.buses,
      route: s.route,
      origin_city_name: originCityName,
      destination_city_name: destCityName,
      transit_stops: s.transit_stops,
    }));
    await offlineStore.cacheSchedules(toCache);
  };

  const searchOffline = async () => {
    const cached = await offlineStore.getCachedSchedules();
    const originCityName = cities.find(c => c.id === search.origin_city_id)?.name || '';
    const destCityName = cities.find(c => c.id === search.destination_city_id)?.name || '';

    const filtered = cached.filter(s => {
      const depDate = s.departure_datetime.split('T')[0];
      const matchDate = depDate === search.date;
      const matchOrigin = s.origin_city_name === originCityName;
      const matchDest = s.destination_city_name === destCityName;
      return matchDate && matchOrigin && matchDest;
    });

    const enriched: Schedule[] = filtered.map(s => ({
      id: s.id,
      route_name: s.route_name,
      departure_datetime: s.departure_datetime,
      arrival_datetime: s.arrival_datetime,
      price: s.price,
      seats_available: s.seats_available,
      seats_reserved: s.seats_reserved,
      estimated_duration_minutes: s.estimated_duration_minutes,
      notes: s.notes,
      bus_id: s.bus_id,
      buses: s.buses,
      route: s.route,
      origin_city_name: s.origin_city_name,
      destination_city_name: s.destination_city_name,
    }));

    if (enriched.length === 0) {
      toast('Aucun voyage en cache pour cette date/itinéraire. Connectez-vous pour actualiser.', { icon: '📡' });
    }

    setSchedules(enriched);
    setStep('select');
  };

  const loadStationsForCities = async (originCityId: string, destCityId: string) => {
    try {
      const { data } = await supabase
        .from('stations')
        .select('id, name, city_id')
        .in('city_id', [originCityId, destCityId])
        .eq('is_active', true)
        .order('name');
      if (data) {
        setBoardingStations(data.filter(s => s.city_id === originCityId));
        setAlightingStations(data.filter(s => s.city_id === destCityId));
      }
    } catch (_) {
      setBoardingStations([]);
      setAlightingStations([]);
    }
  };

  const handleSelectSchedule = async (schedule: Schedule) => {
    const serverNow = getServerNow();
    if (!schedule.is_anticipated && new Date(schedule.departure_datetime) <= serverNow) {
      toast.error('Vente impossible : la date de vente doit correspondre à la date système serveur.');
      return;
    }
    const tripCapacity = schedule.buses?.total_seats ?? 60;
    const tripFull = schedule.is_anticipated
      ? (schedule.seats_reserved || 0) >= tripCapacity
      : (schedule.seats_available ?? tripCapacity) === 0;
    if (tripFull) {
      toast.error('Ce voyage est complet');
      return;
    }
    setSelectedSchedule(schedule);
    clearSeatSelection();
    setSeatCount(1);
    setAlightingStationId('');
    setSelectedTransitPrice(null);

    // Extract transit stop destinations for this schedule + resolve city names
    const rawStops = (schedule.transit_stops || [])
      .filter((s: any) => s.station_id && s.price > 0)
      .sort((a: any, b: any) => a.position - b.position);

    let stops: TransitStopDest[] = rawStops.map((s: any) => ({
      station_id: s.station_id,
      station_name: s.station_name,
      city_name: '',
      price: s.price,
      position: s.position,
    }));

    // Lookup city names for transit stations
    if (stops.length > 0 && isOnline) {
      try {
        const stationIds = stops.map(s => s.station_id);
        const { data: stData } = await supabase
          .from('stations')
          .select('id, city_id')
          .in('id', stationIds);
        if (stData) {
          const cityIds = [...new Set(stData.map(s => s.city_id).filter(Boolean))];
          const { data: cityData } = await supabase
            .from('cities')
            .select('id, name')
            .in('id', cityIds);
          const cityMap = Object.fromEntries((cityData || []).map(c => [c.id, c.name]));
          const stationCityMap = Object.fromEntries(stData.map(s => [s.id, cityMap[s.city_id] || '']));
          stops = stops.map(s => ({ ...s, city_name: stationCityMap[s.station_id] || s.station_name }));
        }
      } catch (_) {}
    }
    // Fallback: use station name if city name not resolved
    stops = stops.map(s => ({ ...s, city_name: s.city_name || s.station_name }));
    setTransitDestinations(stops);

    // If this schedule was found via transit match, auto-select the transit destination
    if (schedule.transit_match) {
      setAlightingStationId(`transit:${schedule.transit_match.station_id}`);
      setSelectedTransitPrice(schedule.transit_match.price);
    }

    if (schedule.route?.origin_city_id && schedule.route?.destination_city_id) {
      await loadStationsForCities(schedule.route.origin_city_id, schedule.route.destination_city_id);
    }
    setBoardingStationId(myStationId ?? '');
    setStep('seats');
  };

  const effectiveSeatCount = hasSeatMap ? enrichedSelectedSeats.length : seatCount;
  const effectiveUnitPrice = selectedTransitPrice !== null ? selectedTransitPrice : (selectedSchedule?.price ?? 0);
  const totalAmount = hasSeatMap
    ? (selectedTransitPrice !== null
      ? effectiveUnitPrice * Math.max(1, effectiveSeatCount)
      : (totalSelectedPrice > 0 ? totalSelectedPrice : (selectedSchedule ? selectedSchedule.price * Math.max(1, effectiveSeatCount) : 0)))
    : (selectedSchedule ? effectiveUnitPrice * Math.max(1, effectiveSeatCount) : 0);
  const changeAmount = payment.method === 'especes' ? Math.max(0, payment.amount_received - totalAmount) : 0;

  useEffect(() => {
    if (payment.method === 'especes' && payment.amount_received !== totalAmount) {
      setPayment(p => ({ ...p, amount_received: totalAmount }));
    }
  }, [totalAmount, payment.method]);

  const validateSaleInputs = (): boolean => {
    if (!selectedSchedule) return false;
    const available = selectedSchedule.seats_available ?? selectedSchedule.buses?.total_seats ?? 60;
    if (hasSeatMap) {
      if (enrichedSelectedSeats.length === 0) { toast.error('Sélectionnez au moins un siège'); return false; }
      if (enrichedSelectedSeats.length > available) {
        toast.error(`Seulement ${available} place(s) disponible(s)`);
        return false;
      }
    } else {
      if (seatCount < 1) { toast.error('Sélectionnez au moins 1 siège'); return false; }
      if (seatCount > available) {
        toast.error(`Seulement ${available} place(s) disponible(s)`);
        return false;
      }
    }
    return true;
  };

  const buildSeatNumbers = (): string[] => {
    if (hasSeatMap) {
      return enrichedSelectedSeats.map(s => s.label);
    }
    const existing = selectedSchedule?.seats_reserved || 0;
    return Array.from({ length: seatCount }, (_, i) => `${existing + i + 1}`);
  };

  const boardingStationName = boardingStations.find(s => s.id === boardingStationId)?.name;
  const alightingStationName = alightingStationId.startsWith('transit:')
    ? transitDestinations.find(t => `transit:${t.station_id}` === alightingStationId)?.city_name
    : alightingStations.find(s => s.id === alightingStationId)?.name;

  // Display destination: use transit city name when selected, otherwise schedule destination
  const displayedDestination = alightingStationId.startsWith('transit:')
    ? (transitDestinations.find(t => `transit:${t.station_id}` === alightingStationId)?.city_name || selectedSchedule?.destination_city_name || '')
    : (selectedSchedule?.destination_city_name || '');

  const handleConfirmSale = async (printAndReset = false) => {
    autoPrintAndResetRef.current = printAndReset;
    if (!validateSaleInputs()) return;
    if (!selectedSchedule) return;

    if (baggageForm.mode === 'avec_ticket') {
      if (!isOnline) {
        toast.error('Le bagage avec ticket nécessite une connexion pour être associé au billet');
        return;
      }
      if (baggageForm.price <= 0) {
        toast.error('Indiquez le prix du bagage avant de confirmer la vente');
        return;
      }
    }

    setProcessing(true);

    // Server-side timestamp & fraud validation (online only)
    if (isOnline) {
      try {
        const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/validate-ticket-sale`;
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;

        const validationRes = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            schedule_id: selectedSchedule.id,
            counter_id: myCounterId,
            station_id: myStationId,
            client_timestamp: new Date().toISOString(),
          }),
        });

        const validationData = await validationRes.json();

        if (!validationData.allowed) {
          toast.error(validationData.reason || 'Vente impossible : la date de vente doit correspondre à la date système serveur.');
          setProcessing(false);
          return;
        }

        if (validationData.drift_warning) {
          toast('Attention : un decalage d\'horloge a ete detecte sur votre poste.', { icon: '⚠️', duration: 5000 });
        }
      } catch (validationErr) {
        // If validation endpoint is unreachable, fall back to RPC check
        try {
          const { data: serverTimeData } = await supabase.rpc('get_server_time');
          if (serverTimeData && !selectedSchedule.is_anticipated) {
            const serverNow = new Date(serverTimeData);
            const departure = new Date(selectedSchedule.departure_datetime);
            if (departure <= serverNow) {
              toast.error('Vente impossible : la date de vente doit correspondre à la date système serveur.');
              setProcessing(false);
              return;
            }
          }
        } catch (_) {}
      }
    }

    // Seat availability check (online + seat map)
    if (isOnline && hasSeatMap && enrichedSelectedSeats.length > 0) {
      const checks = await Promise.all(
        enrichedSelectedSeats.map(s => isSeatStillAvailable(selectedSchedule.id, s.id))
      );
      const conflictIdx = checks.findIndex(ok => !ok);
      if (conflictIdx !== -1) {
        const taken = enrichedSelectedSeats[conflictIdx];
        toast.error(`Le siège ${taken.label} vient d'être réservé. Veuillez en choisir un autre.`);
        await refresh();
        setStep('seats');
        setProcessing(false);
        return;
      }
    }

    const serverNow = getServerNow();
    const reference = `SBTA-${serverNow.getFullYear()}-${Math.random().toString(36).substr(2, 8).toUpperCase()}`;
    const seatNumbers = buildSeatNumbers();
    const count = seatNumbers.length;
    try {
      await confirmOnline(reference, seatNumbers, count, printAndReset);
    } catch (_) {
      try {
        await confirmOffline(reference, seatNumbers, count, printAndReset);
      } catch (offlineErr: any) {
        toast.error('Impossible de sauvegarder le billet');
        setProcessing(false);
        return;
      }
    } finally {
      setProcessing(false);
    }
  };

  const confirmOnline = async (reference: string, seatNumbers: string[], count: number, printAndReset = false) => {
    if (!selectedSchedule) return;

    const { data: reservation, error: resError } = await supabase
      .from('reservations')
      .insert({
        schedule_id: selectedSchedule.id,
        passenger_name: passenger.name.trim(),
        passenger_phone: passenger.phone.trim(),
        seat_numbers: seatNumbers,
        total_seats: count,
        total_price: totalAmount,
        booking_reference: reference,
        qr_code: reference,
        status: 'confirmee',
        payment_status: payment.method === 'especes' || payment.method === 'carte' ? 'payee' : 'en_attente',
        booked_by: user?.id,
        destination_city_name: displayedDestination || selectedSchedule.destination_city_name || null,
      })
      .select()
      .single();

    if (resError) throw resError;

    await supabase.from('payments').insert({
      reservation_id: reservation.id,
      amount: totalAmount,
      payment_method: payment.method,
      payment_reference: payment.reference || null,
      status: payment.method === 'especes' || payment.method === 'carte' ? 'reussie' : 'en_attente',
      processed_by: user?.id,
    });

    await supabase
      .from('schedules')
      .update({
        seats_available: Math.max(0, (selectedSchedule.seats_available ?? selectedSchedule.buses?.total_seats ?? 60) - count),
        seats_reserved: (selectedSchedule.seats_reserved || 0) + count,
      })
      .eq('id', selectedSchedule.id);

    // Récupérer le numéro d'ordre défini par le chef de gare (departure_order, unique par gare/date)
    let departureNumber: number | null = null;
    try {
      const { data: existing } = await supabase
        .from('departure_sequence')
        .select('departure_order, departure_number')
        .eq('schedule_id', selectedSchedule.id)
        .maybeSingle();
      if (existing) {
        departureNumber = existing.departure_order ?? existing.departure_number ?? null;
      }
    } catch (_) {}

    // Bagage avec ticket — associé au même billet, aux mêmes sièges et au même passager
    let baggageData: BaggageTicketData | null = null;
    if (baggageForm.mode === 'avec_ticket') {
      const baggageNumber = generateBaggageNumber();
      const baggageDestination = (baggageForm.destination.trim() || selectedSchedule.destination_city_name || '').toUpperCase();
      const busReg = selectedSchedule.buses?.registration_number || null;
      const seatStr = seatNumbers.join(', ');

      const { error: bagError } = await supabase
        .from('baggage_tickets')
        .insert({
          baggage_number: baggageNumber,
          schedule_id: selectedSchedule.id,
          reservation_id: reservation.id,
          destination: baggageDestination,
          price: baggageForm.price,
          seat_number: seatStr,
          departure_number: departureNumber,
          bus_registration: busReg,
          description: baggageForm.description.trim() || null,
          owner_name: baggageForm.owner_name.trim() || passenger.name.trim(),
          owner_phone: baggageForm.owner_phone.trim() || passenger.phone.trim(),
          has_ticket: true,
          counter_id: myCounterId,
          station_id: myStationId,
          sold_by: user!.id,
        });
      if (bagError) throw bagError;

      baggageData = {
        baggage_number: baggageNumber,
        destination: baggageDestination,
        price: baggageForm.price,
        seat_number: seatStr,
        departure_number: departureNumber,
        bus_registration: busReg,
        description: baggageForm.description || null,
        owner_name: baggageForm.owner_name.trim() || passenger.name,
        owner_phone: baggageForm.owner_phone.trim() || passenger.phone,
        station_name: myStationName || 'SBTA',
        mode_label: 'Avec ticket',
      };
    }

    setConfirmedTicket({
      booking_reference: reference,
      passenger_name: passenger.name,
      passenger_phone: passenger.phone,
      seat_numbers: seatNumbers,
      total_price: totalAmount,
      payment_method: payment.method,
      schedule: selectedSchedule,
      payment_reference: payment.reference || undefined,
      change_amount: changeAmount,
      savedOffline: false,
      boarding_station: boardingStationName,
      alighting_station: alightingStationName,
      departure_number: departureNumber,
      baggage: baggageData ?? undefined,
    });

    if (printAndReset) {
      toast.success('Vente confirmée — impression en cours');
    } else {
      setStep('confirm');
      toast.success('Billet vendu avec succès !');
    }
  };

  const confirmOffline = async (reference: string, seatNumbers: string[], count: number, printAndReset = false) => {
    if (!selectedSchedule || !user) return;

    await offlineStore.saveTicket({
      localId: `offline-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      createdAt: new Date().toISOString(),
      status: 'pending',
      scheduleId: selectedSchedule.id,
      scheduleSnapshot: {
        route_name: selectedSchedule.route_name,
        departure_datetime: selectedSchedule.departure_datetime,
        arrival_datetime: selectedSchedule.arrival_datetime,
        price: selectedSchedule.price,
        seats_available: selectedSchedule.seats_available,
        seats_reserved: selectedSchedule.seats_reserved,
        bus_registration: selectedSchedule.buses?.registration_number || '',
      },
      passengerName: passenger.name.trim(),
      passengerPhone: passenger.phone.trim(),
      seatNumbers,
      totalSeats: count,
      totalPrice: totalAmount,
      paymentMethod: payment.method,
      paymentReference: payment.reference || undefined,
      bookingReference: reference,
      bookedBy: user.id,
      changeAmount: changeAmount > 0 ? changeAmount : undefined,
      destinationCityName: displayedDestination || selectedSchedule.destination_city_name || undefined,
    });

    await offlineStore.decrementCachedScheduleSeats(selectedSchedule.id, count);

    const updatedSchedules = schedules.map(s =>
      s.id === selectedSchedule.id
        ? { ...s, seats_available: Math.max(0, s.seats_available - count), seats_reserved: (s.seats_reserved || 0) + count }
        : s
    );
    setSchedules(updatedSchedules);

    // Récupérer le numéro d'ordre défini par le chef de gare
    let departureNumberOffline: number | null = null;
    try {
      const { data: ds } = await supabase
        .from('departure_sequence')
        .select('departure_order, departure_number')
        .eq('schedule_id', selectedSchedule.id)
        .maybeSingle();
      if (ds) {
        departureNumberOffline = ds.departure_order ?? ds.departure_number ?? null;
      }
    } catch (_) {}

    setConfirmedTicket({
      booking_reference: reference,
      passenger_name: passenger.name,
      passenger_phone: passenger.phone,
      seat_numbers: seatNumbers,
      total_price: totalAmount,
      payment_method: payment.method,
      schedule: selectedSchedule,
      payment_reference: payment.reference || undefined,
      change_amount: changeAmount,
      savedOffline: true,
      boarding_station: boardingStationName,
      alighting_station: alightingStationName,
      departure_number: departureNumberOffline,
    });

    await reloadOfflineTickets();
    if (printAndReset) {
      toast.success('Vente confirmée — impression en cours');
    } else {
      setStep('confirm');
      toast.success('Billet sauvegardé hors-ligne ! Il sera synchronisé au retour du réseau.');
    }
  };

  const generatePDF = async () => {
    if (!confirmedTicket) return;

    // Use plain ASCII formatting — jsPDF cannot render Unicode narrow no-break spaces (U+202F)
    // produced by fr-FR locale, which appear as '/' in output.
    const formatAmount = (n: number): string => {
      const str = Math.round(n).toString();
      let result = '';
      for (let i = 0; i < str.length; i++) {
        if (i > 0 && (str.length - i) % 3 === 0) result += ' ';
        result += str[i];
      }
      return result + ' f';
    };

    const depDate = format(new Date(confirmedTicket.schedule.departure_datetime), 'dd/MM/yyyy');
    const depTime = confirmedTicket.schedule.is_anticipated && !confirmedTicket.schedule.bus_id
      ? '--'
      : format(new Date(confirmedTicket.schedule.departure_datetime), 'HH:mm');
    const origin = (confirmedTicket.schedule.origin_city_name || '').toUpperCase();
    const dest = (confirmedTicket.alighting_station || confirmedTicket.schedule.destination_city_name || '').toUpperCase();
    const tarif = formatAmount(confirmedTicket.total_price);
    const busReg = confirmedTicket.schedule.buses?.registration_number || '--';
    const printDt = format(new Date(), 'dd/MM/yyyy HH:mm:ss');

    const refFull = confirmedTicket.booking_reference;
    const departureNum = confirmedTicket.departure_number ?? '';

    const allSeats = confirmedTicket.seat_numbers;
    const seatsDisplay = allSeats.join(', ');

    const W = 80;
    // Layout constants — fixed split between left and right columns
    const L = 4;    // left margin
    const R = 76;   // right edge
    const MID = 46; // column split x (vertical divider on DEPART row)

    // Uniform vertical rhythm — keeps text off the separator lines
    const GAP = 6;   // separator -> next text baseline
    const PAD = 3;   // text baseline -> separator below

    // Seat column layout (shared by main ticket + souche)
    const seatsX   = 16;
    const colSplit = 52;
    const seatsMaxW = colSplit - seatsX;
    const lineH    = 4.5;

    // Gares (départ / arrivée) — fallback to city names when station missing
    const gareDep = String(confirmedTicket.boarding_station || confirmedTicket.schedule.origin_city_name || '--').toUpperCase();
    const gareArr = String(confirmedTicket.alighting_station || confirmedTicket.schedule.destination_city_name || '--').toUpperCase();

    // Measure dynamic content height so the ticket uses only the paper it needs
    const measureDoc = new jsPDF({ unit: 'mm', format: [W, 300] });
    measureDoc.setFont('helvetica', 'bold');
    measureDoc.setFontSize(9);
    const seatLineCount = Math.max(measureDoc.splitTextToSize(seatsDisplay, seatsMaxW).length, 1);
    const pageH = 200 + (seatLineCount - 1) * lineH * 2;

    const doc = new jsPDF({ unit: 'mm', format: [W, pageH] });

    const dashed = (y: number, x1 = L, x2 = R) => {
      doc.setLineDashPattern([1.2, 1.0], 0);
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.3);
      doc.line(x1, y, x2, y);
      doc.setLineDashPattern([], 0);
    };
    const solid = (y: number, x1 = L, x2 = R) => {
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.3);
      doc.line(x1, y, x2, y);
    };
    const heavyDotted = (y: number) => {
      doc.setLineDashPattern([1.5, 1.0], 0);
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.55);
      doc.line(2, y, 78, y);
      doc.setLineDashPattern([], 0);
    };

    // ── OUTER BORDER drawn after content (placeholder — updated below) ──

    // ── HEADER ──────────────────────────────────────────────
    try {
      const resp = await fetch('/logo_sbta02.JPG');
      const blob = await resp.blob();
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
      doc.addImage(dataUrl, 'JPEG', 3, 3, 18, 16);
    } catch {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(0, 0, 0);
      doc.text('S.B.T.A', 12, 9, { align: 'center' });
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(5.5);
      doc.text("L'Aventure continue", 12, 13, { align: 'center' });
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(0, 0, 0);
    doc.text('SBTA', R, 11, { align: 'right' });
    doc.setFontSize(5.5);
    doc.setFont('helvetica', 'normal');
    doc.text('Societe Bonkoungou Transport de L\'Agneby', R, 15, { align: 'right' });
    doc.text('Tel 01 14 34 60 / 01 14 34 87', R, 18.5, { align: 'right' });

    solid(21);
    let y = 21; // running vertical cursor

    // Gare label width (measured once at the size used below)
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    const gareValMaxW = R - L - doc.getTextWidth('GARE ARRIVEE ');
    const gareLine = (yy: number, label: string, value: string, x1: number, x2: number) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.text(label, x1, yy);
      doc.setFont('helvetica', 'bold');
      doc.text(doc.splitTextToSize(value, gareValMaxW)[0], x2, yy, { align: 'right' });
    };

    // ── DEPART row ───────────────────────────────────────────
    const depBaseY = y + GAP + 1;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('DEPART', L, depBaseY);
    doc.setLineWidth(0.3);
    doc.line(MID, y + 1, MID, depBaseY + PAD);
    doc.setFontSize(13);
    doc.text(String(departureNum), (MID + R) / 2, depBaseY, { align: 'center' });
    y = depBaseY + PAD;
    dashed(y);

    // ── ITINERARY row ────────────────────────────────────────
    const itiBaseY = y + GAP;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(origin, L, itiBaseY);
    doc.setFontSize(9);
    doc.text('=>', 38, itiBaseY, { align: 'center' });
    doc.text(dest, R, itiBaseY, { align: 'right' });
    y = itiBaseY + PAD;
    dashed(y);

    // ── GARES (départ / arrivée) ─────────────────────────────
    const gareDepY = y + 5;
    gareLine(gareDepY, 'GARE DEPART', gareDep, L, R);
    const gareArrY = gareDepY + 4.5;
    gareLine(gareArrY, 'GARE ARRIVEE', gareArr, L, R);
    y = gareArrY + PAD;
    dashed(y);

    // ── SIEGE | TARIF row (même ligne, colonnes distinctes) ──
    const siegeRowY = y + GAP;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('SIEGE', L, siegeRowY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(seatsDisplay, seatsX, siegeRowY, { maxWidth: seatsMaxW });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('TARIF', colSplit + 1, siegeRowY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(tarif, R, siegeRowY, { align: 'right' });

    const seatsLines = doc.splitTextToSize(seatsDisplay, seatsMaxW);
    const rowH       = Math.max(seatsLines.length, 1) * lineH;
    y = siegeRowY + rowH - lineH + PAD;
    dashed(y);

    // ── CAR | N°TICKET row (même ligne, colonnes fixes) ──────
    const carY       = y + GAP;
    const carColEnd  = 37; // frontière fixe entre les deux colonnes

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('CAR', L, carY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    const busRegMaxW = carColEnd - 16;
    const busRegLines = doc.splitTextToSize(busReg, busRegMaxW);
    doc.text(busRegLines[0], 16, carY);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('N\u00b0TICKET', carColEnd + 1, carY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(11, 116, 57);
    const refMaxW   = R - (carColEnd + 1) - doc.getTextWidth('N\u00b0TICKET ');
    const refLines  = doc.splitTextToSize(refFull, refMaxW);
    doc.text(refLines[0], R, carY, { align: 'right' });
    doc.setTextColor(0, 0, 0);
    y = carY + PAD;
    dashed(y);

    // ── DATE / HEURE row ─────────────────────────────────────
    const dateY = y + GAP;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('DATE :', L, dateY);
    doc.setFont('helvetica', 'bold');
    doc.text(depDate, 17, dateY);
    doc.setFont('helvetica', 'normal');
    doc.text('HEURE:', 47, dateY);
    doc.setFont('helvetica', 'bold');
    doc.text(depTime, 62, dateY);
    y = dateY + PAD;
    dashed(y);

    // ── NOTES ────────────────────────────────────────────────
    const noteGap = 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    let noteY = y + noteGap;
    doc.text('NB. Tout ticket encaisse n est plus remboursable', 40, noteY, { align: 'center' });
    dashed(noteY + PAD);
    noteY = noteY + PAD + noteGap;
    doc.text('SBTA pas responsable ces bagages sans ticket', 40, noteY, { align: 'center' });
    dashed(noteY + PAD);
    noteY = noteY + PAD + noteGap;
    doc.setFontSize(6);
    doc.text('VEUILLEZ CONSERVER LES TICKETS JUSQU\'A DESTINATION', 40, noteY, { align: 'center' });
    dashed(noteY + PAD);
    y = noteY + PAD;

    // ── PRINT LINE ───────────────────────────────────────────
    const printY = y + 5;
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'normal');
    doc.text('V10  Imprimer le :', L, printY);
    doc.text(printDt, R, printY, { align: 'right' });

    const solidY = printY + 4;
    solid(solidY);

    // ── OUTER BORDER (main ticket) — drawn with exact height ─
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.4);
    doc.rect(2, 2, W - 4, solidY - 2);

    // ══════════════════════ SOUCHE ═══════════════════════════
    const soucheStart = solidY + 4;
    heavyDotted(soucheStart);

    doc.setFont('helvetica', 'bolditalic');
    doc.setFontSize(12);
    doc.text('SOUCHE', 40, soucheStart + 7, { align: 'center' });

    const soucheBodyStart = soucheStart + 10;
    heavyDotted(soucheBodyStart);
    let sy = soucheBodyStart;

    // DEPART souche
    const sdepY = sy + GAP + 1;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('DEPART', L, sdepY);
    doc.setLineWidth(0.3);
    doc.line(MID, sy + 1, MID, sdepY + PAD);
    doc.text(String(departureNum), (MID + R) / 2, sdepY, { align: 'center' });
    sy = sdepY + PAD;
    dashed(sy, L, R);

    // itinerary souche
    const sitiY = sy + GAP;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text(origin, L, sitiY);
    doc.text('=>', 38, sitiY, { align: 'center' });
    doc.text(dest, R, sitiY, { align: 'right' });
    sy = sitiY + PAD;
    dashed(sy, L, R);

    // gares souche
    const sGareDepY = sy + 5;
    gareLine(sGareDepY, 'GARE DEPART', gareDep, L, R);
    const sGareArrY = sGareDepY + 4.5;
    gareLine(sGareArrY, 'GARE ARRIVEE', gareArr, L, R);
    sy = sGareArrY + PAD;
    dashed(sy, L, R);

    // siege | tarif souche (même ligne, colonnes distinctes)
    const ssiegeY = sy + GAP;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('SIEGE', L, ssiegeY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(seatsDisplay, seatsX, ssiegeY, { maxWidth: seatsMaxW });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('TARIF', colSplit + 1, ssiegeY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(tarif, R, ssiegeY, { align: 'right' });

    const ssLines  = doc.splitTextToSize(seatsDisplay, seatsMaxW);
    sy = ssiegeY + Math.max(ssLines.length, 1) * lineH - lineH + PAD;
    dashed(sy, L, R);

    // car | N°TICKET souche (même ligne, colonnes fixes)
    const scarY = sy + GAP;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text('CAR', L, scarY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    const sBusRegLines = doc.splitTextToSize(busReg, busRegMaxW);
    doc.text(sBusRegLines[0], 16, scarY);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.text('N\u00b0TICKET', carColEnd + 1, scarY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(11, 116, 57);
    const sRefLines = doc.splitTextToSize(refFull, refMaxW);
    doc.text(sRefLines[0], R, scarY, { align: 'right' });
    doc.setTextColor(0, 0, 0);
    sy = scarY + PAD;
    dashed(sy, L, R);

    // date/heure souche
    const sdateY = sy + GAP;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text('DATE :', L, sdateY);
    doc.setFont('helvetica', 'bold');
    doc.text(depDate, 17, sdateY);
    doc.setFont('helvetica', 'normal');
    doc.text('HEURE:', 47, sdateY);
    doc.setFont('helvetica', 'bold');
    doc.text(depTime, 62, sdateY);
    sy = sdateY + PAD;
    dashed(sy, L, R);

    // print line souche
    const sprintY = sy + 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.text('V10  Imprimer le :', L, sprintY);
    doc.text(printDt, R, sprintY, { align: 'right' });

    // souche outer border drawn with exact height
    doc.setLineWidth(0.4);
    doc.setDrawColor(0, 0, 0);
    doc.rect(2, soucheBodyStart, W - 4, sprintY + PAD - soucheBodyStart);

    doc.autoPrint();
    const blobUrl = doc.output('bloburl');
    const printWin = window.open(blobUrl as unknown as string, '_blank');
    if (printWin) {
      printWin.addEventListener('afterprint', () => printWin.close());
    }
    toast.success('Impression du billet lancee');

    // Bagage avec ticket — imprimé pour le même siège juste après le billet de voyage
    if (confirmedTicket.baggage) {
      printBaggageTicket(confirmedTicket.baggage);
    }
  };

  const [baggageProcessing, setBaggageProcessing] = useState(false);

  const handleSaveBaggage = async () => {
    if (!baggageForm.owner_name.trim() || !baggageForm.owner_phone.trim() || !baggageForm.destination.trim()) {
      toast.error('Remplissez au minimum : proprietaire, contact et destination');
      return;
    }
    if (baggageForm.price <= 0) {
      toast.error('Le prix du bagage doit etre superieur a 0');
      return;
    }

    setBaggageProcessing(true);

    try {
      const baggageNumber = generateBaggageNumber();
      const reservationId: string | null = null;
      const departureNumber: number | null = baggageForm.departure_number ? parseInt(baggageForm.departure_number) : null;

      const modeLabel = baggageForm.mode === 'avec_ticket' ? 'Avec ticket'
        : baggageForm.mode === 'avec_ticket_reporte' ? 'Avec ticket reporte'
        : baggageForm.mode === 'sans_ticket' ? 'Sans siege'
        : null;

      const { error } = await supabase
        .from('baggage_tickets')
        .insert({
          baggage_number: baggageNumber,
          schedule_id: selectedSchedule?.id || null,
          reservation_id: reservationId,
          destination: baggageForm.destination.trim(),
          price: baggageForm.price,
          seat_number: baggageForm.mode === 'sans_ticket' ? null : (baggageForm.seat_number.trim() || null),
          departure_number: departureNumber,
          bus_registration: baggageForm.bus_registration.trim() || null,
          description: baggageForm.description.trim() || null,
          owner_name: baggageForm.owner_name.trim(),
          owner_phone: baggageForm.owner_phone.trim(),
          has_ticket: baggageForm.mode === 'avec_ticket' || baggageForm.mode === 'avec_ticket_reporte',
          counter_id: myCounterId,
          station_id: myStationId,
          sold_by: user!.id,
        });

      if (error) throw error;

      const ticketData: BaggageTicketData = {
        baggage_number: baggageNumber,
        destination: baggageForm.destination,
        price: baggageForm.price,
        seat_number: baggageForm.mode === 'sans_ticket' ? null : (baggageForm.seat_number || null),
        departure_number: departureNumber,
        bus_registration: baggageForm.bus_registration || null,
        description: baggageForm.description || null,
        owner_name: baggageForm.owner_name,
        owner_phone: baggageForm.owner_phone,
        station_name: myStationName || 'SBTA',
        mode_label: modeLabel,
      };

      printBaggageTicket(ticketData);
      toast.success('Ticket bagage imprime');

      setBaggageForm({
        has_ticket: false, destination: '', price: 0, seat_number: '',
        departure_number: '', bus_registration: '', description: '',
        owner_name: '', owner_phone: '',
      });
      setShowBaggage(false);
    } catch (err: any) {
      console.error('Erreur sauvegarde bagage:', err);
      toast.error(err.message || 'Erreur lors de la sauvegarde du bagage');
    } finally {
      setBaggageProcessing(false);
    }
  };

  const switchBaggageMode = (mode: BaggageMode) => {
    if (mode === 'none') {
      setBaggageForm(prev => ({
        ...prev,
        mode: 'none',
        has_ticket: false,
        destination: '',
        seat_number: '',
        bus_registration: '',
        departure_number: '',
      }));
      return;
    }

    const autoFillSchedule = (mode === 'avec_ticket' || mode === 'avec_ticket_reporte' || mode === 'sans_ticket') && selectedSchedule;

    if (autoFillSchedule && selectedSchedule.id) {
      supabase
        .from('departure_sequence')
        .select('departure_order, departure_number')
        .eq('schedule_id', selectedSchedule.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data) {
            const num = data.departure_order ?? data.departure_number;
            if (num) setBaggageForm(prev => ({ ...prev, departure_number: String(num) }));
          }
        });
    }

    const seatLabels = (mode === 'avec_ticket' || mode === 'avec_ticket_reporte') && hasSeatMap
      ? enrichedSelectedSeats.map(s => s.label).join(', ')
      : '';

    setBaggageForm(prev => ({
      ...prev,
      mode,
      has_ticket: mode === 'avec_ticket' || mode === 'avec_ticket_reporte',
      destination: autoFillSchedule ? (displayedDestination || prev.destination) : prev.destination,
      bus_registration: autoFillSchedule ? (selectedSchedule.buses?.registration_number || prev.bus_registration) : prev.bus_registration,
      seat_number: mode === 'sans_ticket' ? '' : (seatLabels || prev.seat_number),
      owner_name: (mode === 'avec_ticket' || mode === 'avec_ticket_reporte') ? (passenger.name || prev.owner_name) : prev.owner_name,
      owner_phone: (mode === 'avec_ticket' || mode === 'avec_ticket_reporte') ? (passenger.phone || prev.owner_phone) : prev.owner_phone,
    }));
  };

  const resetSale = () => {
    setStep('search');
    setSelectedSchedule(null);
    setSchedules([]);
    clearSeatSelection();
    setSeatCount(1);
    setPassenger({ name: '', phone: '', id_number: '' });
    setPayment({ method: 'especes', amount_received: 0, reference: '', mobile_provider: '' });
    setConfirmedTicket(null);
    setBoardingStationId('');
    setAlightingStationId('');
    setBoardingStations([]);
    setAlightingStations([]);
    setShowBaggage(false);
    setBaggageForm({
      mode: 'none', has_ticket: false, destination: '', price: 0, seat_number: '',
      departure_number: '', bus_registration: '', description: '',
      owner_name: '', owner_phone: '',
    });
  };

  const continueSale = async () => {
    const schedule = confirmedTicket?.schedule;
    setConfirmedTicket(null);
    clearSeatSelection();
    setSeatCount(1);
    setPassenger({ name: '', phone: '', id_number: '' });
    setPayment({ method: 'especes', amount_received: 0, reference: '', mobile_provider: '' });
    setAlightingStationId('');
    setSelectedTransitPrice(null);
    setShowBaggage(false);
    setBaggageForm({
      mode: 'none', has_ticket: false, destination: '', price: 0, seat_number: '',
      departure_number: '', bus_registration: '', description: '',
      owner_name: '', owner_phone: '',
    });

    if (!schedule) { resetSale(); return; }

    // Refresh schedule seat availability
    try {
      if (schedule.is_anticipated) {
        const totalReserved = await getSiblingOccupancy(schedule.id);
        const capacity = schedule.buses?.total_seats ?? 60;
        const refreshed = { ...schedule, seats_reserved: totalReserved, seats_available: Math.max(0, capacity - totalReserved) };
        setSelectedSchedule(refreshed);
        setSchedules(prev => prev.map(s => s.id === refreshed.id ? refreshed : s));
      } else {
        const { data } = await supabase
          .from('schedules')
          .select('seats_available, seats_reserved')
          .eq('id', schedule.id)
          .maybeSingle();
        if (data) {
          const refreshed = { ...schedule, seats_available: data.seats_available, seats_reserved: data.seats_reserved };
          setSelectedSchedule(refreshed);
          setSchedules(prev => prev.map(s => s.id === refreshed.id ? refreshed : s));
        } else {
          setSelectedSchedule(schedule);
        }
      }
    } catch (_) {
      setSelectedSchedule(schedule);
    }

    // Re-extract transit stops and reload stations
    if (schedule.transit_stops) {
      const rawStops = (schedule.transit_stops || [])
        .filter((s: any) => s.station_id && s.price > 0)
        .sort((a: any, b: any) => a.position - b.position);
      let stops: TransitStopDest[] = rawStops.map((s: any) => ({
        station_id: s.station_id, station_name: s.station_name, city_name: '', price: s.price, position: s.position,
      }));
      if (stops.length > 0 && isOnline) {
        try {
          const stationIds = stops.map(s => s.station_id);
          const { data: stData } = await supabase.from('stations').select('id, city_id').in('id', stationIds);
          if (stData) {
            const cityIds = [...new Set(stData.map(s => s.city_id).filter(Boolean))];
            const { data: cityData } = await supabase.from('cities').select('id, name').in('id', cityIds);
            const cityMap = Object.fromEntries((cityData || []).map(c => [c.id, c.name]));
            const stationCityMap = Object.fromEntries(stData.map(s => [s.id, cityMap[s.city_id] || '']));
            stops = stops.map(s => ({ ...s, city_name: stationCityMap[s.station_id] || s.station_name }));
          }
        } catch (_) {}
      }
      stops = stops.map(s => ({ ...s, city_name: s.city_name || s.station_name }));
      setTransitDestinations(stops);
    }

    if (schedule.route?.origin_city_id && schedule.route?.destination_city_id) {
      await loadStationsForCities(schedule.route.origin_city_id, schedule.route.destination_city_id);
    }
    setBoardingStationId(myStationId ?? '');
    setStep('seats');
  };

  useEffect(() => {
    if (!confirmedTicket || !autoPrintAndResetRef.current) return;
    autoPrintAndResetRef.current = false;
    (async () => {
      await generatePDF();
      continueSale();
    })();
  }, [confirmedTicket]);

  useEffect(() => {
    if ((baggageForm.mode === 'avec_ticket' || baggageForm.mode === 'avec_ticket_reporte') && selectedSchedule) {
      const seatLabels = hasSeatMap ? enrichedSelectedSeats.map(s => s.label).join(', ') : '';
      setBaggageForm(prev => ({
        ...prev,
        seat_number: seatLabels,
        owner_name: passenger.name || prev.owner_name,
        owner_phone: passenger.phone || prev.owner_phone,
      }));
    }
  }, [enrichedSelectedSeats.length, passenger.name, passenger.phone]);

  const stepIndex = STEPS.findIndex(s => s.id === step);
  const originCity = cities.find(c => c.id === search.origin_city_id);
  const destCity = cities.find(c => c.id === search.destination_city_id);

  const getDuration = (dep: string, arr: string, minutes: number | null): string => {
    if (minutes) {
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      return h > 0 ? `${h}h${m > 0 ? m + 'min' : ''}` : `${m}min`;
    }
    const diff = new Date(arr).getTime() - new Date(dep).getTime();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return h > 0 ? `${h}h${m > 0 ? m + 'min' : ''}` : `${m}min`;
  };

  return (
    <div className={`${step === 'seats' ? 'max-w-7xl' : 'max-w-5xl'} mx-auto p-6 space-y-4`}>
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Vente de billet</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Procédure de vente au guichet</p>
        </div>
        <div className="flex items-center gap-2">
          {!isOnline && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold"
                  style={{ backgroundColor: '#FEF3C7', color: '#D97706' }}>
              <WifiOff className="w-3.5 h-3.5" />
              Hors-ligne
            </span>
          )}
          <button
            onClick={() => setShowQueue(true)}
            className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-semibold transition-all hover:shadow-sm"
            style={{ borderColor: pendingCount > 0 ? '#F59E0B' : 'var(--border)', color: 'var(--text-secondary)' }}
          >
            <List className="w-4 h-4" />
            File hors-ligne
            {pendingCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center rounded-full text-xs font-black text-white"
                    style={{ backgroundColor: '#DC2626' }}>
                {pendingCount > 9 ? '9+' : pendingCount}
              </span>
            )}
          </button>
        </div>
      </div>

      <OfflineBanner
        isOnline={isOnline}
        wasOffline={wasOffline}
        pendingCount={pendingCount}
        syncing={syncing}
        onSyncNow={syncNow}
        onShowQueue={() => setShowQueue(true)}
      />

      {driftWarning && (
        <div className="rounded-xl p-4 border flex items-start gap-3"
             style={{ backgroundColor: '#FEF2F2', borderColor: '#FECACA' }}>
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#DC2626' }} />
          <div>
            <p className="text-sm font-bold" style={{ color: '#DC2626' }}>
              Decalage d'horloge detecte
            </p>
            <p className="text-xs mt-0.5" style={{ color: '#991B1B' }}>
              L'heure de votre ordinateur ne correspond pas a l'heure du serveur. Les ventes utilisent uniquement l'heure officielle du serveur pour prevenir la fraude.
            </p>
          </div>
        </div>
      )}

      <div className="rounded-xl p-1 flex gap-1" style={{ backgroundColor: 'var(--surface-raised)' }}>
        {STEPS.map((s, i) => (
          <div
            key={s.id}
            className="flex-1 flex items-center justify-center py-2 rounded-lg text-xs font-semibold transition-all"
            style={{
              backgroundColor: i <= stepIndex ? 'var(--primary)' : 'transparent',
              color: i <= stepIndex ? 'white' : 'var(--text-muted)',
            }}
          >
            <span className="mr-1.5 w-4 h-4 rounded-full text-xs flex items-center justify-center"
              style={{ backgroundColor: i <= stepIndex ? 'rgba(255,255,255,0.25)' : 'var(--border)' }}>
              {i + 1}
            </span>
            <span className="hidden sm:inline">{s.label}</span>
          </div>
        ))}
      </div>

      {step === 'search' && (
        <div className="rounded-xl p-6 border" style={{ backgroundColor: 'var(--surface)' }}>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
              Rechercher un voyage disponible
            </h2>
            {!isOnline && (
              <span className="flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full"
                    style={{ backgroundColor: '#FEF3C7', color: '#D97706' }}>
                <WifiOff className="w-3 h-3" />
                Voyages depuis le cache local
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Ville de départ *
              </label>
              {myCityId ? (
                <div
                  className="w-full px-3 py-2.5 rounded-lg border text-sm font-semibold flex items-center gap-2"
                  style={{ borderColor: 'var(--primary)', backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}
                >
                  <MapPin className="w-4 h-4 flex-shrink-0" />
                  {cities.find(c => c.id === myCityId)?.name || myStationName || '...'}
                </div>
              ) : (
                <select
                  value={search.origin_city_id}
                  onChange={e => setSearch({ ...search, origin_city_id: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-lg border text-sm"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <option value="">Sélectionner...</option>
                  {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Ville d'arrivée *
              </label>
              <select
                value={search.destination_city_id}
                onChange={e => setSearch({ ...search, destination_city_id: e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg border text-sm"
                style={{ borderColor: 'var(--border)' }}
              >
                <option value="">Sélectionner...</option>
                {cities
                  .filter(c => c.id !== search.origin_city_id)
                  .filter(c => !assignedDestCityIds || assignedDestCityIds.includes(c.id))
                  .map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Date de départ *
              </label>
              <input
                type="date"
                value={search.date}
                onChange={e => setSearch({ ...search, date: e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg border text-sm"
                style={{ borderColor: 'var(--border)' }}
                min={format(getServerNow(), 'yyyy-MM-dd')}
              />
            </div>
          </div>
          <button
            onClick={handleSearch}
            disabled={loadingSchedules}
            className="w-full py-3 rounded-lg font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-60"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            {loadingSchedules ? (
              <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />Recherche en cours...</>
            ) : (
              <><Search className="w-5 h-5" />{isOnline ? 'Rechercher les voyages disponibles' : 'Rechercher dans le cache local'}</>
            )}
          </button>
        </div>
      )}

      {step === 'select' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                {schedules.length} voyage{schedules.length !== 1 ? 's' : ''} disponible{schedules.length !== 1 ? 's' : ''}
                {!isOnline && (
                  <span className="ml-2 text-xs font-normal px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: '#FEF3C7', color: '#D97706' }}>
                    cache local
                  </span>
                )}
              </h2>
              <p className="text-sm flex items-center gap-1.5 mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                <MapPin className="w-3.5 h-3.5" style={{ color: 'var(--primary)' }} />
                <strong>{originCity?.name}</strong>
                <ChevronRight className="w-3.5 h-3.5" />
                <strong>{destCity?.name}</strong>
                <span className="mx-1">·</span>
                <Calendar className="w-3.5 h-3.5" />
                {format(new Date(search.date + 'T12:00:00'), 'dd MMMM yyyy', { locale: fr })}
              </p>
            </div>
            <button
              onClick={() => setStep('search')}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border"
              style={{ color: 'var(--text-secondary)', borderColor: 'var(--border)' }}
            >
              <ArrowLeft className="w-4 h-4" />
              Modifier la recherche
            </button>
          </div>

          {schedules.length === 0 ? (
            <div className="rounded-xl p-12 text-center border" style={{ backgroundColor: 'var(--surface)' }}>
              <AlertCircle className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
              <p className="font-medium" style={{ color: 'var(--text-primary)' }}>Aucun voyage disponible</p>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                {!isOnline
                  ? 'Aucun voyage en cache. Connectez-vous pour actualiser les données.'
                  : 'Aucune ligne ne vous a été assignée pour cette date. Veuillez contacter le Chef de gare.'
                }
              </p>
              <button onClick={() => setStep('search')} className="mt-4 px-4 py-2 rounded-lg text-sm font-medium border">
                Nouvelle recherche
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {schedules.map(schedule => {
                const isAnticipatedIncomplete = schedule.is_anticipated && (!schedule.bus_id || !schedule.buses);
                const depTime = isAnticipatedIncomplete ? '--:--' : format(new Date(schedule.departure_datetime), 'HH:mm');
                const arrTime = isAnticipatedIncomplete ? '--:--' : format(new Date(schedule.arrival_datetime), 'HH:mm');
                const duration = isAnticipatedIncomplete ? null : getDuration(schedule.departure_datetime, schedule.arrival_datetime, schedule.estimated_duration_minutes);
                const availableSeats = schedule.seats_available ?? schedule.buses?.total_seats ?? 60;
                const tripCapacity = schedule.buses?.total_seats ?? 60;
                const isFull = schedule.is_anticipated
                  ? (schedule.seats_reserved || 0) >= tripCapacity
                  : availableSeats === 0;
                const isDeparted = !isAnticipatedIncomplete && new Date(schedule.departure_datetime) <= now;
                const isDisabled = isFull || isDeparted;
                const fillPct = schedule.buses?.total_seats
                  ? Math.round(((schedule.seats_reserved || 0) / schedule.buses.total_seats) * 100)
                  : schedule.is_anticipated ? Math.round(((schedule.seats_reserved || 0) / 60) * 100) : 0;

                return (
                  <div
                    key={schedule.id}
                    className="rounded-xl border transition-all"
                    style={{
                      backgroundColor: isDeparted ? '#FEF2F2' : 'var(--surface)',
                      opacity: isDisabled ? 0.72 : 1,
                      borderColor: isDeparted ? '#FECACA' : 'var(--border)',
                      boxShadow: isDeparted ? 'none' : undefined,
                    }}
                  >
                    <div className="p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-3">
                            <div className="text-center min-w-[56px]">
                              <p className="text-2xl font-black leading-none" style={{ color: 'var(--text-primary)' }}>{depTime}</p>
                              <p className="text-xs mt-0.5 font-medium" style={{ color: 'var(--primary)' }}>
                                {schedule.origin_city_name}
                              </p>
                            </div>
                            <div className="flex-1 flex flex-col items-center gap-1">
                              <div className="w-full flex items-center gap-2">
                                <div className="h-px flex-1" style={{ backgroundColor: 'var(--border)' }} />
                                <div className="flex flex-col items-center">
                                  <Bus className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                                  <span className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{duration}</span>
                                </div>
                                <div className="h-px flex-1" style={{ backgroundColor: 'var(--border)' }} />
                              </div>
                              <p className="text-xs text-center font-medium" style={{ color: 'var(--text-secondary)' }}>
                                {schedule.transit_match
                                  ? `${schedule.origin_city_name} \u2013 ${schedule.destination_city_name}`
                                  : (schedule.route?.name || schedule.route_name)}
                              </p>
                              {schedule.transit_match && (
                                <p className="text-[10px] text-center" style={{ color: '#1D4ED8' }}>
                                  (escale via {schedule.route?.name || schedule.route_name})
                                </p>
                              )}
                            </div>
                            <div className="text-center min-w-[56px]">
                              <p className="text-2xl font-black leading-none" style={{ color: 'var(--text-primary)' }}>{arrTime}</p>
                              <p className="text-xs mt-0.5 font-medium" style={{ color: 'var(--primary)' }}>
                                {schedule.destination_city_name}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 flex-wrap text-xs" style={{ color: 'var(--text-muted)' }}>
                            {isAnticipatedIncomplete ? (
                              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full font-bold"
                                style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
                                DEPART ANTICIPE
                              </span>
                            ) : (
                              <span className="flex items-center gap-1">
                                <Bus className="w-3.5 h-3.5" />
                                {schedule.buses?.registration_number}
                                {schedule.buses?.brand && ` · ${schedule.buses.brand}`}
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <Users className="w-3.5 h-3.5" />
                              <span style={{ color: isDeparted ? '#B91C1C' : isFull ? 'var(--danger)' : availableSeats <= 5 ? 'var(--warning)' : 'var(--success)' }}>
                                {isDeparted ? 'Embarquement' : isFull ? 'Complet' : `${availableSeats} place${availableSeats > 1 ? 's' : ''} dispo`}
                              </span>
                              {!isDeparted && <span style={{ color: 'var(--text-muted)' }}>/ {schedule.buses?.total_seats || 60}</span>}
                            </span>
                            {isDeparted && (
                              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full font-bold"
                                style={{ backgroundColor: '#FEE2E2', color: '#B91C1C' }}>
                                <Clock className="w-3 h-3" />
                                Embarquement — vente clôturée
                              </span>
                            )}
                            {!isDeparted && (
                              <span className="px-2 py-0.5 rounded-full font-semibold"
                                style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
                                {BUS_CLASS_LABELS[schedule.buses?.class] || 'Standard'}
                              </span>
                            )}
                            {schedule.buses?.seat_config_id && (
                              <span className="flex items-center gap-1">
                                <LayoutGrid className="w-3.5 h-3.5" />
                                Plan disponible
                              </span>
                            )}
                            {schedule.route?.distance_km && (
                              <span className="flex items-center gap-1">
                                <Tag className="w-3.5 h-3.5" />
                                {schedule.route.distance_km} km
                              </span>
                            )}
                            {schedule.transit_stops && schedule.transit_stops.length > 0 && (
                              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full font-medium"
                                style={{ backgroundColor: '#DBEAFE', color: '#1D4ED8' }}>
                                <MapPin className="w-3 h-3" />
                                {schedule.transit_stops.length} escale{schedule.transit_stops.length > 1 ? 's' : ''}
                              </span>
                            )}
                          </div>

                          <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border)' }}>
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${fillPct}%`,
                                backgroundColor: fillPct >= 90 ? 'var(--danger)' : fillPct >= 70 ? 'var(--warning)' : 'var(--success)',
                              }}
                            />
                          </div>
                        </div>

                        <div className="text-right flex flex-col items-end gap-3 flex-shrink-0">
                          <div>
                            <p className="text-2xl font-black leading-none" style={{ color: 'var(--primary)' }}>
                              {formatCurrency(schedule.price)}
                            </p>
                            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>par place</p>
                          </div>
                          <button
                            onClick={() => handleSelectSchedule(schedule)}
                            disabled={isDisabled}
                            className="px-5 py-2.5 rounded-lg text-sm font-bold text-white transition-all disabled:cursor-not-allowed"
                            style={{
                              backgroundColor: isDeparted ? '#DC2626' : isFull ? 'var(--text-muted)' : 'var(--primary)',
                              opacity: isDisabled ? 0.7 : 1,
                            }}
                          >
                            {isDeparted ? 'Embarquement' : isFull ? 'Complet' : 'Choisir'}
                          </button>
                        </div>
                      </div>

                      {schedule.notes && (
                        <div className="mt-3 px-3 py-2 rounded-lg text-xs"
                          style={{ backgroundColor: 'var(--warning-light)', color: 'var(--warning)' }}>
                          {schedule.notes}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {step === 'seats' && selectedSchedule && (
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-center gap-3">
            <button onClick={() => setStep('select')} style={{ color: 'var(--text-muted)' }}>
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Vente de billet</h2>
              <p className="text-sm flex items-center gap-1.5 mt-0.5 flex-wrap" style={{ color: 'var(--text-secondary)' }}>
                <span className="font-semibold">{selectedSchedule.origin_city_name}</span>
                <ChevronRight className="w-3 h-3" />
                <span className="font-semibold">{displayedDestination}</span>
                <span className="opacity-40">·</span>
                <Clock className="w-3.5 h-3.5" />
                {selectedSchedule.is_anticipated && !selectedSchedule.bus_id
                  ? 'Depart anticipe'
                  : format(new Date(selectedSchedule.departure_datetime), 'dd/MM/yyyy HH:mm')}
                <span className="opacity-40">·</span>
                <span className="font-bold" style={{ color: 'var(--primary)' }}>
                  {formatCurrency(effectiveUnitPrice)}/place
                </span>
              </p>
            </div>
          </div>

          {!isOnline && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                 style={{ backgroundColor: '#FEF3C7', color: '#D97706' }}>
              <WifiOff className="w-3.5 h-3.5 flex-shrink-0" />
              <span>Hors-ligne : le plan de sièges n'est pas disponible. Sélection manuelle.</span>
            </div>
          )}

          {/* Two-column layout: seat map left, sale panel right */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-5 items-start">

            {/* LEFT — Seat map */}
            <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: 'var(--surface)' }}>
              {seatMapError ? (
                <div className="p-6">
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {seatMapError}
                  </p>
                </div>
              ) : seatMapLoading ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <div className="w-8 h-8 rounded-full animate-spin" style={{ borderWidth: 3, borderStyle: 'solid', borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
                  <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Chargement du plan de sièges...</span>
                </div>
              ) : seatMap ? (
                <BusSeatMapPanel
                  seatMap={seatMap}
                  selectedSeats={enrichedSelectedSeats}
                  onSeatToggle={toggleSeat}
                  showPassengerNames={true}
                  lockCountdowns={lockCountdowns}
                />
              ) : (
                <div className="p-6">
                  {selectedSchedule.is_anticipated && !selectedSchedule.bus_id && (
                    <div className="mb-4 p-3 rounded-lg flex items-start gap-2" style={{ backgroundColor: '#FEF3C7', border: '1px solid #FDE68A' }}>
                      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#92400E' }} />
                      <p className="text-xs font-medium" style={{ color: '#92400E' }}>
                        Depart anticipe — vehicule non encore affecte. Les numeros de sieges seront attribues sequentiellement.
                      </p>
                    </div>
                  )}
                  <p className="text-xs font-medium mb-3" style={{ color: 'var(--text-muted)' }}>Nombre de places a reserver *</p>
                  <div className="flex items-center gap-3 mb-5">
                    <button
                      onClick={() => setSeatCount(c => Math.max(1, c - 1))}
                      className="w-10 h-10 rounded-lg border-2 flex items-center justify-center transition-all hover:bg-slate-50"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                      type="button"
                    >—</button>
                    <span className="text-3xl font-black w-12 text-center" style={{ color: 'var(--primary)' }}>
                      {seatCount}
                    </span>
                    <button
                      onClick={() => setSeatCount(c => Math.min(selectedSchedule.seats_available ?? selectedSchedule.buses?.total_seats ?? 60, c + 1))}
                      className="w-10 h-10 rounded-lg border-2 flex items-center justify-center transition-all hover:bg-slate-50"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                      type="button"
                    >+</button>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      / {selectedSchedule.seats_available ?? selectedSchedule.buses?.total_seats ?? 60} disponibles
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* RIGHT — Sale panel */}
            <div className="space-y-3">

              {/* Trip summary — compact card */}
              <div className="rounded-2xl border p-4 space-y-2.5" style={{ backgroundColor: 'var(--surface)' }}>
                <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Récapitulatif du voyage</h3>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between items-center">
                    <span style={{ color: 'var(--text-secondary)' }}>Trajet</span>
                    <span className="font-bold flex items-center gap-1">
                      {selectedSchedule.origin_city_name}
                      <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                      {displayedDestination}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span style={{ color: 'var(--text-secondary)' }}>Départ</span>
                    <span className="font-semibold">{format(new Date(selectedSchedule.departure_datetime), 'dd/MM/yyyy HH:mm')}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span style={{ color: 'var(--text-secondary)' }}>Bus</span>
                    <span className="font-semibold">{selectedSchedule.buses?.registration_number || '—'}</span>
                  </div>

                  {boardingStations.length > 0 && (
                    <div className="pt-1">
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                        <LogIn className="w-3 h-3 inline mr-1" />Gare d'embarquement
                      </label>
                      <div
                        className="w-full px-2.5 py-1.5 rounded-lg border text-sm font-semibold"
                        style={{ borderColor: 'var(--primary)', backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}
                      >
                        {boardingStations.find(s => s.id === boardingStationId)?.name || '—'}
                      </div>
                    </div>
                  )}

                  {(alightingStations.length > 0 || transitDestinations.length > 0) && (
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                        <LogOut className="w-3 h-3 inline mr-1" />Destination / Gare de débarquement
                      </label>
                      <select
                        value={alightingStationId}
                        onChange={e => {
                          const val = e.target.value;
                          setAlightingStationId(val);
                          if (val.startsWith('transit:')) {
                            const transitStop = transitDestinations.find(t => `transit:${t.station_id}` === val);
                            setSelectedTransitPrice(transitStop?.price ?? null);
                          } else if (val === '' || val === 'final') {
                            setSelectedTransitPrice(null);
                          } else {
                            setSelectedTransitPrice(null);
                          }
                        }}
                        className="w-full px-2.5 py-1.5 rounded-lg border text-sm"
                        style={{ borderColor: 'var(--border)' }}
                      >
                        <option value="">— Destination finale ({
                          selectedSchedule?.transit_match
                            ? cities.find(c => c.id === selectedSchedule.route?.destination_city_id)?.name || selectedSchedule?.route?.name?.split('–')[1]?.trim() || '?'
                            : selectedSchedule?.destination_city_name
                        }) —</option>
                        {transitDestinations.length > 0 && (
                          <optgroup label="Escales (arrêts intermédiaires)">
                            {transitDestinations.map(t => (
                              <option key={t.station_id} value={`transit:${t.station_id}`}>
                                {t.city_name} ({t.station_name}) — {t.price.toLocaleString('fr-CI')} FCFA
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {alightingStations.length > 0 && (
                          <optgroup label="Gares de la ville de destination">
                            {alightingStations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </optgroup>
                        )}
                      </select>
                      {selectedTransitPrice !== null && (
                        <p className="text-xs mt-1 font-medium" style={{ color: 'var(--primary)' }}>
                          Tarif arrêt intermédiaire : {selectedTransitPrice.toLocaleString('fr-CI')} FCFA / place
                        </p>
                      )}
                    </div>
                  )}

                  <div className="pt-1.5 border-t" style={{ borderColor: 'var(--border)' }}>
                    <div className="flex justify-between items-start">
                      <span style={{ color: 'var(--text-secondary)' }}>Sièges</span>
                      <div className="text-right">
                        {hasSeatMap ? (
                          enrichedSelectedSeats.length === 0
                            ? <span className="text-xs italic" style={{ color: 'var(--text-muted)' }}>Aucun siège sélectionné</span>
                            : <span className="font-bold font-mono text-sm" style={{ color: 'var(--primary)' }}>
                                {enrichedSelectedSeats.map(s => s.label).join(', ')}
                              </span>
                        ) : (
                          <span className="font-bold" style={{ color: 'var(--primary)' }}>
                            {seatCount} place{seatCount > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between items-center">
                    <span style={{ color: 'var(--text-secondary)' }}>Prix unitaire</span>
                    <span className="font-semibold">{formatCurrency(effectiveUnitPrice)}</span>
                  </div>
                  <div className="flex justify-between items-center rounded-lg px-3 py-2"
                       style={{ backgroundColor: 'var(--primary-light)' }}>
                    <span className="font-bold text-sm" style={{ color: 'var(--primary)' }}>Total à payer</span>
                    <span className="text-xl font-black" style={{ color: 'var(--primary)' }}>
                      {formatCurrency(totalAmount)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Baggage section — right after trip summary */}
              <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: 'var(--surface)' }}>
                <button
                  type="button"
                  onClick={() => setShowBaggage(!showBaggage)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Luggage className="w-4.5 h-4.5" style={{ color: 'var(--primary)' }} />
                    <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Bagage</span>
                  </div>
                  {showBaggage
                    ? <ChevronUp className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                    : <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                  }
                </button>

                {showBaggage && (
                  <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor: 'var(--border)' }}>
                    {/* Mode selection — exclusive checkboxes */}
                    <div className="pt-3 flex items-center gap-5 flex-wrap">
                      {([
                        { value: 'avec_ticket' as BaggageMode, label: 'Avec ticket' },
                        { value: 'avec_ticket_reporte' as BaggageMode, label: 'Avec ticket reporte' },
                        { value: 'sans_ticket' as BaggageMode, label: 'Sans siege' },
                      ]).map(opt => (
                        <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={baggageForm.mode === opt.value}
                            onChange={() => switchBaggageMode(baggageForm.mode === opt.value ? 'none' : opt.value)}
                            className="w-4 h-4 rounded"
                          />
                          <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{opt.label}</span>
                        </label>
                      ))}
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Destination *</label>
                        <input
                          type="text"
                          value={baggageForm.destination}
                          onChange={e => setBaggageForm({ ...baggageForm, destination: e.target.value.toUpperCase() })}
                          className="w-full px-2.5 py-2 rounded-lg border text-sm"
                          style={{ borderColor: 'var(--border)', backgroundColor: baggageForm.mode !== 'none' ? 'var(--neutral-50)' : 'white' }}
                          readOnly={baggageForm.mode !== 'none'}
                          placeholder="Ex: BOUAKE"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Prix (FCFA) *</label>
                        <input
                          type="number"
                          value={baggageForm.price || ''}
                          onChange={e => setBaggageForm({ ...baggageForm, price: parseInt(e.target.value) || 0 })}
                          className="w-full px-2.5 py-2 rounded-lg border text-sm"
                          style={{ borderColor: 'var(--border)' }}
                          placeholder="0"
                        />
                      </div>
                    </div>

                    {baggageForm.mode === 'sans_ticket' ? (
                      <div>
                        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>N depart</label>
                        <input
                          type="text"
                          value={baggageForm.departure_number}
                          readOnly
                          className="w-full px-2.5 py-2 rounded-lg border text-sm"
                          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--neutral-50)' }}
                          placeholder="--"
                        />
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Siege</label>
                          <input
                            type="text"
                            value={baggageForm.seat_number}
                            onChange={e => setBaggageForm({ ...baggageForm, seat_number: e.target.value })}
                            className="w-full px-2.5 py-2 rounded-lg border text-sm"
                            style={{ borderColor: 'var(--border)', backgroundColor: (baggageForm.mode === 'avec_ticket' || baggageForm.mode === 'avec_ticket_reporte') ? 'var(--neutral-50)' : 'white' }}
                            readOnly={baggageForm.mode === 'avec_ticket' || baggageForm.mode === 'avec_ticket_reporte'}
                            placeholder="--"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>N depart</label>
                          <input
                            type="text"
                            value={baggageForm.departure_number}
                            onChange={e => setBaggageForm({ ...baggageForm, departure_number: e.target.value })}
                            className="w-full px-2.5 py-2 rounded-lg border text-sm"
                            style={{ borderColor: 'var(--border)' }}
                            placeholder="--"
                          />
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Car (immatriculation)</label>
                      <input
                        type="text"
                        value={baggageForm.bus_registration}
                        onChange={e => setBaggageForm({ ...baggageForm, bus_registration: e.target.value.toUpperCase() })}
                        className="w-full px-2.5 py-2 rounded-lg border text-sm"
                        style={{ borderColor: 'var(--border)', backgroundColor: baggageForm.mode !== 'none' ? 'var(--neutral-50)' : 'white' }}
                        readOnly={baggageForm.mode !== 'none'}
                        placeholder="Ex: AA 830 HV 01"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Description du bagage</label>
                      <input
                        type="text"
                        value={baggageForm.description}
                        onChange={e => setBaggageForm({ ...baggageForm, description: e.target.value })}
                        className="w-full px-2.5 py-2 rounded-lg border text-sm"
                        style={{ borderColor: 'var(--border)' }}
                        placeholder="Ex: Valise noire, carton..."
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Proprietaire *</label>
                        <input
                          type="text"
                          value={baggageForm.owner_name}
                          onChange={e => setBaggageForm({ ...baggageForm, owner_name: e.target.value.toUpperCase() })}
                          className="w-full px-2.5 py-2 rounded-lg border text-sm"
                          style={{ borderColor: 'var(--border)' }}
                          placeholder="Nom et prenoms"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Contact *</label>
                        <input
                          type="text"
                          value={baggageForm.owner_phone}
                          onChange={e => setBaggageForm({ ...baggageForm, owner_phone: e.target.value })}
                          className="w-full px-2.5 py-2 rounded-lg border text-sm"
                          style={{ borderColor: 'var(--border)' }}
                          placeholder="07 XX XX XX XX"
                        />
                      </div>
                    </div>

                    {baggageForm.mode === 'avec_ticket' ? (
                      <div className="rounded-lg px-3 py-2 text-xs flex items-center gap-2"
                        style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
                        <Luggage className="w-3.5 h-3.5 flex-shrink-0" />
                        Le ticket bagage sera associé au billet (mêmes sièges) puis validé et imprimé à la confirmation de la vente.
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={handleSaveBaggage}
                        disabled={baggageProcessing}
                        className="w-full py-2.5 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-2 transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ backgroundColor: 'var(--primary)' }}
                      >
                        {baggageProcessing ? (
                          <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Traitement...</>
                        ) : (
                          <><Printer className="w-4 h-4" />Imprimer ticket bagage</>
                        )}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Passenger info */}
              <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: 'var(--surface)' }}>
                <button
                  type="button"
                  onClick={() => setShowPassengerInfo(!showPassengerInfo)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <User className="w-4.5 h-4.5" style={{ color: 'var(--primary)' }} />
                    <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Informations passager</span>
                    <span className="text-xs italic" style={{ color: 'var(--text-muted)' }}>(facultatif)</span>
                  </div>
                  {showPassengerInfo
                    ? <ChevronUp className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                    : <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                  }
                </button>

                {showPassengerInfo && (
                  <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor: 'var(--border)' }}>
                    <div className="pt-3">
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                        <User className="w-3 h-3 inline mr-1" />Nom complet
                        <span className="ml-1 text-xs italic" style={{ color: 'var(--text-muted)' }}>(facultatif)</span>
                      </label>
                      <input
                        type="text"
                        value={passenger.name}
                        onChange={e => setPassenger({ ...passenger, name: e.target.value.toUpperCase() })}
                        className="w-full px-3 py-2 rounded-lg border text-sm transition-colors"
                        style={{ borderColor: 'var(--border)' }}
                        placeholder="Ex: KOUASSI Jean"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                        <Phone className="w-3 h-3 inline mr-1" />Téléphone (optionnel)
                      </label>
                      <input
                        type="tel"
                        value={passenger.phone}
                        onChange={e => setPassenger({ ...passenger, phone: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border text-sm transition-colors"
                        style={{ borderColor: 'var(--border)' }}
                        placeholder="+225 07 XX XX XX XX"
                      />
                    </div>
                  </div>
                )}
              </div>

            </div>
          </div>

          {/* Print + Retour buttons — full width below both columns */}
          {(() => {
            const noSeats = hasSeatMap ? enrichedSelectedSeats.length === 0 : seatCount < 1;
            const disabled = processing || noSeats;

            return (
              <div className="flex gap-3 mt-3">
                <button
                  type="button"
                  onClick={() => handleConfirmSale(true)}
                  disabled={disabled}
                  className="flex-1 py-4 rounded-2xl font-bold text-base text-white flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                  style={{ backgroundColor: isOnline ? 'var(--success)' : '#D97706' }}
                >
                  {processing ? (
                    <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />Traitement...</>
                  ) : noSeats ? (
                    <><Printer className="w-5 h-5 opacity-60" />Sélectionnez un siège</>
                  ) : isOnline ? (
                    <><Printer className="w-5 h-5" />Imprimer le billet — {formatCurrency(totalAmount)}</>
                  ) : (
                    <><WifiOff className="w-5 h-5" />Sauvegarder hors-ligne — {formatCurrency(totalAmount)}</>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => { resetSale(); setStep('search'); }}
                  className="px-5 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 border-2 transition-all hover:opacity-80"
                  style={{ borderColor: 'var(--text-secondary)', color: 'var(--text-secondary)' }}
                >
                  <ArrowLeft className="w-5 h-5" />
                  Retourner à la vente
                </button>
              </div>
            );
          })()}
        </div>
      )}


      {step === 'confirm' && confirmedTicket && (
        <div className="space-y-4">
          <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--surface)' }}>
            <div className="p-6 flex items-center gap-4"
                 style={{ backgroundColor: confirmedTicket.savedOffline ? '#D97706' : 'var(--success)', color: 'white' }}>
              {confirmedTicket.savedOffline
                ? <WifiOff className="w-10 h-10 flex-shrink-0" />
                : <CheckCircle className="w-10 h-10 flex-shrink-0" />
              }
              <div>
                <h2 className="text-xl font-black">
                  {confirmedTicket.savedOffline ? 'Billet sauvegardé hors-ligne !' : 'Vente confirmée !'}
                </h2>
                <p className="text-sm opacity-90">
                  {confirmedTicket.savedOffline
                    ? 'Le billet sera synchronisé automatiquement au retour du réseau.'
                    : 'Le billet a été enregistré avec succès dans le système'
                  }
                </p>
              </div>
            </div>

            <div className="p-6" ref={printRef}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>
                      Référence de réservation
                    </p>
                    <p className="text-xl font-black font-mono" style={{ color: 'var(--primary)' }}>
                      {confirmedTicket.booking_reference}
                    </p>
                    {confirmedTicket.savedOffline && (
                      <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-xs font-semibold"
                            style={{ backgroundColor: '#FEF3C7', color: '#D97706' }}>
                        <WifiOff className="w-3 h-3" />
                        En attente de synchronisation
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Passager</p>
                      <p className="font-bold text-sm">{confirmedTicket.passenger_name}</p>
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{confirmedTicket.passenger_phone}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>
                        Siège{confirmedTicket.seat_numbers.length > 1 ? 's' : ''}
                      </p>
                      <p className="font-bold text-sm font-mono">
                        {[...confirmedTicket.seat_numbers].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(', ')}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {confirmedTicket.seat_numbers.length} place{confirmedTicket.seat_numbers.length > 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Itinéraire</p>
                    <div className="flex items-center gap-2">
                      <span className="font-bold">{confirmedTicket.schedule.origin_city_name}</span>
                      <ChevronRight className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                      <span className="font-bold">{confirmedTicket.alighting_station || confirmedTicket.schedule.destination_city_name}</span>
                    </div>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                      {confirmedTicket.schedule.is_anticipated && !confirmedTicket.schedule.bus_id
                        ? format(new Date(confirmedTicket.schedule.departure_datetime), 'dd MMMM yyyy', { locale: fr })
                        : format(new Date(confirmedTicket.schedule.departure_datetime), 'dd MMMM yyyy à HH:mm', { locale: fr })}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      Bus {confirmedTicket.schedule.buses?.registration_number} · {BUS_CLASS_LABELS[confirmedTicket.schedule.buses?.class] || 'Standard'}
                    </p>
                    {(confirmedTicket.boarding_station || confirmedTicket.alighting_station) && (
                      <div className="mt-2 space-y-1">
                        {confirmedTicket.boarding_station && (
                          <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                            <LogIn className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--success)' }} />
                            <span>Embarquement : <span className="font-semibold">{confirmedTicket.boarding_station}</span></span>
                          </div>
                        )}
                        {confirmedTicket.alighting_station && (
                          <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                            <LogOut className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--danger)' }} />
                            <span>Débarquement : <span className="font-semibold">{confirmedTicket.alighting_station}</span></span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Paiement</p>
                    <p className="text-2xl font-black" style={{ color: 'var(--success)' }}>
                      {formatCurrency(confirmedTicket.total_price)}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                      {({ especes: 'Espèces', carte: 'Carte bancaire', mobile_money: 'Mobile Money', virement: 'Virement' } as Record<string, string>)[confirmedTicket.payment_method] || confirmedTicket.payment_method}
                      {confirmedTicket.change_amount && confirmedTicket.change_amount > 0 && (
                        <span className="ml-2 font-semibold" style={{ color: 'var(--success)' }}>
                          · Rendu: {formatCurrency(confirmedTicket.change_amount)}
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex flex-col items-center justify-center gap-3">
                  <div className="p-4 bg-white rounded-xl border shadow-sm">
                    <QRCodeSVG
                      value={confirmedTicket.booking_reference}
                      size={180}
                      level="H"
                      includeMargin
                    />
                  </div>
                  <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
                    {confirmedTicket.savedOffline
                      ? 'Ce QR code sera valide après synchronisation'
                      : 'Scanner à l\'embarquement'
                    }
                  </p>
                </div>
              </div>
            </div>

            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={generatePDF}
                className="flex-1 py-3 rounded-xl font-bold flex items-center justify-center gap-2 border-2 transition-all hover:opacity-80"
                style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}
              >
                <Printer className="w-5 h-5" />
                Imprimer le billet
              </button>
              <button
                onClick={continueSale}
                className="flex-1 py-3 rounded-xl font-bold flex items-center justify-center gap-2 border-2 transition-all hover:opacity-80"
                style={{ borderColor: 'var(--success, #16A34A)', color: 'var(--success, #16A34A)' }}
              >
                <ChevronRight className="w-5 h-5" />
                Continuer la vente
              </button>
              <button
                onClick={resetSale}
                className="flex-1 py-3 rounded-xl font-bold text-white flex items-center justify-center gap-2 transition-all hover:opacity-90"
                style={{ backgroundColor: 'var(--primary)' }}
              >
                <RefreshCw className="w-5 h-5" />
                Nouvelle vente
              </button>
            </div>
          </div>
        </div>
      )}

      {showQueue && (
        <OfflineQueue
          tickets={tickets}
          syncing={syncing}
          isOnline={isOnline}
          onClose={() => setShowQueue(false)}
          onSyncNow={syncNow}
          onDelete={deleteTicket}
        />
      )}
    </div>
  );
}
