import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import jsPDF from 'jspdf';
import {
  ArrowLeft, Bus, User, MapPin, Search, X, CheckCircle, Clock,
  Loader2, ChevronRight, Armchair, Printer, Check, AlertTriangle,
  Zap, RefreshCw, Ticket, ChevronDown, ChevronUp, Users
} from 'lucide-react';
import { fetchScheduleSeatMap, tryLockSeat, releaseSeatLock, isSeatStillAvailable, subscribeToSeatChanges, getSiblingScheduleIds } from '../../services/seatMap.service';
import type { ScheduleSeatMap, EnrichedSeat } from '../../types/seatMap.types';
import { SeatMap as SeatMapComponent } from '../../components/bus/SeatMap';

/* ─── types ──────────────────────────────────────────────── */
interface City { id: string; name: string }

interface ScheduleItem {
  id: string;
  route_name: string;
  departure_datetime: string;
  arrival_datetime: string;
  price: number;
  seats_available: number;
  seats_reserved: number;
  bus_id: string;
  route_id: string;
  is_anticipated: boolean;
  buses: {
    registration_number: string;
    total_seats: number;
    class: string;
    model: string | null;
    seat_config_id: string | null;
  };
  route: {
    id: string;
    name: string;
    base_price: number;
  };
  origin_city_name: string;
  destination_city_name: string;
  driver_name: string;
  departure_number: number | null;
}

interface TicketEntry {
  uid: string;
  scheduleId: string;
  seatLabel: string;
  passengerName: string;
  passengerPhone: string;
  price: number;
}

interface ConfirmedGroup {
  booking_reference: string;
  schedule: ScheduleItem;
  tickets: TicketEntry[];
  totalPrice: number;
}

type PrintStatus = 'pending' | 'printing' | 'printed' | 'error';

interface PrintQueueItem {
  ticket: TicketEntry;
  status: PrintStatus;
  index: number;
  reservationId?: string;
}

interface SavedPrintSession {
  confirmedGroup: ConfirmedGroup;
  printQueue: PrintQueueItem[];
}

const STORAGE_KEY = 'sbta_grouped_sale_print_sessions';

function loadSessionsFromStorage(): SavedPrintSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedPrintSession[];
    return parsed.filter(s => s.printQueue.some(q => q.status === 'pending' || q.status === 'error'));
  } catch { return []; }
}

function saveSessionsToStorage(sessions: SavedPrintSession[]) {
  try {
    const active = sessions.filter(s => s.printQueue.some(q => q.status === 'pending' || q.status === 'error'));
    if (active.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(active));
    }
  } catch {}
}

const SESSION_ID = `gs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
let ticketUid = 0;

/* ─── main component ─────────────────────────────────────── */
export default function GroupedSale() {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  /* state: init */
  const [myCounterId, setMyCounterId] = useState<string | null>(null);
  const [myStationId, setMyStationId] = useState<string | null>(null);
  const [myCityId, setMyCityId] = useState<string | null>(null);
  const [myStationName, setMyStationName] = useState('');
  const [loading, setLoading] = useState(true);

  /* state: destination selection */
  const [destinations, setDestinations] = useState<City[]>([]);
  const [selectedDestIds, setSelectedDestIds] = useState<string[]>([]);

  /* state: schedules */
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [loadingSchedules, setLoadingSchedules] = useState(false);
  const [activeScheduleId, setActiveScheduleId] = useState<string | null>(null);

  /* state: seat map */
  const [seatMap, setSeatMap] = useState<ScheduleSeatMap | null>(null);
  const [anticipatedCount, setAnticipatedCount] = useState(1);
  const [loadingSeatMap, setLoadingSeatMap] = useState(false);
  const [selectedSeats, setSelectedSeats] = useState<EnrichedSeat[]>([]);
  const [lockCountdowns, setLockCountdowns] = useState<Record<string, number>>({});
  const selectedIdsRef = useRef<Set<string>>(new Set());
  const lockExpiriesRef = useRef<Record<string, string>>({});
  const suppressCountRef = useRef(0);
  const unsubRef = useRef<(() => void) | null>(null);

  /* state: ticket generation */
  const [tickets, setTickets] = useState<TicketEntry[]>([]);
  const [processing, setProcessing] = useState(false);
  const [confirmedGroup, setConfirmedGroup] = useState<ConfirmedGroup | null>(null);

  /* state: progressive print queue */
  const [printQueue, setPrintQueue] = useState<PrintQueueItem[]>([]);
  const [isPrintingOne, setIsPrintingOne] = useState(false);
  const [savedPrintSessions, setSavedPrintSessions] = useState<SavedPrintSession[]>(() => loadSessionsFromStorage());

  /* state: ticket validation mode */
  type TicketMode = 'choose' | 'manual' | 'quick' | null;
  const [ticketMode, setTicketMode] = useState<TicketMode>(null);

  /* state: step flow */
  type Step = 'destinations' | 'schedules' | 'sale' | 'confirmed';
  const [step, setStep] = useState<Step>('destinations');

  const activeSchedule = schedules.find(s => s.id === activeScheduleId) || null;

  /* ─── sync saved sessions to localStorage ────────────────── */
  useEffect(() => {
    saveSessionsToStorage(savedPrintSessions);
  }, [savedPrintSessions]);

  /* ─── init ──────────────────────────────────────────────── */
  useEffect(() => {
    initGuichetier();
    return () => { unsubRef.current?.(); };
  }, []);

  const initGuichetier = async () => {
    setLoading(true);
    try {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) return;

      const { data: counter } = await supabase
        .from('counters')
        .select('id, station_id, stations:station_id(name, city_id)')
        .eq('assigned_user_id', u.id)
        .maybeSingle();

      if (!counter) {
        toast.error('Aucun guichet assigne a votre compte');
        return;
      }

      setMyCounterId(counter.id);
      setMyStationId(counter.station_id);
      const st = counter.stations as any;
      if (st) {
        setMyCityId(st.city_id);
        setMyStationName(st.name || '');
      }

      await loadDestinations(counter.id, st?.city_id);
    } finally {
      setLoading(false);
    }
  };

  /* ─── load destinations ─────────────────────────────────── */
  const loadDestinations = async (counterId: string, originCityId: string) => {
    const { data: assignedRoutes } = await supabase
      .from('counter_routes')
      .select('route_id')
      .eq('counter_id', counterId);

    if (!assignedRoutes || assignedRoutes.length === 0) {
      setDestinations([]);
      return;
    }

    const routeIds = assignedRoutes.map(r => r.route_id);

    const { data: routes } = await supabase
      .from('routes')
      .select('destination_city_id')
      .in('id', routeIds)
      .eq('is_active', true);

    if (!routes || routes.length === 0) { setDestinations([]); return; }

    const destCityIds = [...new Set(routes.map(r => r.destination_city_id))];

    const { data: cities } = await supabase
      .from('cities')
      .select('id, name')
      .in('id', destCityIds)
      .order('name');

    setDestinations(cities || []);
  };

  const toggleDest = (id: string) => {
    setSelectedDestIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  /* ─── load schedules ────────────────────────────────────── */
  const loadSchedules = async () => {
    if (!myCounterId || !myCityId || selectedDestIds.length === 0) return;
    setLoadingSchedules(true);

    try {
      const today = format(new Date(), 'yyyy-MM-dd');
      const startOfDay = `${today}T00:00:00+00:00`;
      const endOfDay = `${today}T23:59:59+00:00`;

      const { data: routeData } = await supabase
        .from('routes')
        .select('id, name, base_price, origin_city_id, destination_city_id')
        .eq('origin_city_id', myCityId)
        .in('destination_city_id', selectedDestIds)
        .eq('is_active', true);

      if (!routeData || routeData.length === 0) { setSchedules([]); setStep('schedules'); return; }

      const routeIds = routeData.map(r => r.id);

      const { data: schedData } = await supabase
        .from('schedules')
        .select(`
          id, route_name, departure_datetime, arrival_datetime,
          price, seats_available, seats_reserved, bus_id, route_id, is_anticipated,
          buses:bus_id(registration_number, total_seats, class, model, seat_config_id),
          driver:driver_id(full_name)
        `)
        .in('route_id', routeIds)
        .in('status', ['planifie', 'en_cours'])
        .gte('departure_datetime', startOfDay)
        .lte('departure_datetime', endOfDay)
        .order('departure_datetime');

      if (!schedData) { setSchedules([]); setStep('schedules'); return; }

      // Get assigned routes for this counter
      const { data: assignedRoutes } = await supabase
        .from('counter_routes')
        .select('route_id')
        .eq('counter_id', myCounterId);
      const assignedRouteIds = new Set((assignedRoutes || []).map((r: any) => r.route_id));

      // Get departure sequence info for display
      const scheduleIds = schedData.map((s: any) => s.id);
      const { data: assignedSeq } = await supabase
        .from('departure_sequence')
        .select('schedule_id, departure_order, departure_number')
        .in('schedule_id', scheduleIds);

      const assignedMap = new Map((assignedSeq || []).map((d: any) => [d.schedule_id, d]));

      const { data: cityData } = await supabase
        .from('cities')
        .select('id, name')
        .in('id', [...new Set([myCityId, ...selectedDestIds])]);

      const cityMap = new Map((cityData || []).map(c => [c.id, c.name]));
      const routeMap = new Map(routeData.map(r => [r.id, r]));

      const enriched: ScheduleItem[] = schedData
        .filter((s: any) => assignedRouteIds.has(s.route_id))
        .map((s: any) => {
          const route = routeMap.get(s.route_id);
          const seq = assignedMap.get(s.id);
          return {
            ...s,
            is_anticipated: (s as any).is_anticipated ?? false,
            price: s.price ?? route?.base_price ?? 0,
            route: route || { id: s.route_id, name: s.route_name, base_price: 0 },
            origin_city_name: cityMap.get(myCityId!) || '',
            destination_city_name: cityMap.get(route?.destination_city_id || '') || '',
            driver_name: (s.driver as any)?.full_name || '--',
            departure_number: seq?.departure_order ?? seq?.departure_number ?? null,
          };
        });

      setSchedules(enriched);
      setStep('schedules');
    } catch {
      toast.error('Erreur chargement des voyages');
    } finally {
      setLoadingSchedules(false);
    }
  };

  /* ─── seat map ──────────────────────────────────────────── */
  const loadSeatMap = useCallback(async (scheduleId: string, silent = false) => {
    if (!silent) setLoadingSeatMap(true);
    try {
      const data = await fetchScheduleSeatMap(scheduleId);
      const mergedLayout = data.enriched_layout.map(row => ({
        ...row,
        seats: row.seats.map(seat => {
          if (selectedIdsRef.current.has(seat.id)) {
            return { ...seat, status: 'locked_by_me' as const };
          }
          return seat;
        }),
      }));

      const allSeats = mergedLayout.flatMap(r => r.seats);
      setSeatMap({
        ...data,
        enriched_layout: mergedLayout,
        available_count: allSeats.filter(s => s.status === 'available').length,
        occupied_count: allSeats.filter(s => ['occupied', 'boarding', 'my_reservation'].includes(s.status)).length,
      });
    } catch {
      toast.error('Erreur chargement du plan de sieges');
    } finally {
      if (!silent) setLoadingSeatMap(false);
    }
  }, []);

  const selectScheduleForSale = async (schedule: ScheduleItem) => {
    releaseAllLocks();
    setActiveScheduleId(schedule.id);
    setSelectedSeats([]);
    selectedIdsRef.current = new Set();
    lockExpiriesRef.current = {};
    setTickets([]);
    setTicketMode(null);
    quickConfirmRef.current = false;
    setStep('sale');
    if (!schedule.is_anticipated) {
      await loadSeatMap(schedule.id);

      unsubRef.current?.();
      const siblingIds = await getSiblingScheduleIds(schedule.id);
      unsubRef.current = subscribeToSeatChanges(schedule.id, () => {
        if (suppressCountRef.current > 0) { suppressCountRef.current--; return; }
        loadSeatMap(schedule.id, true);
      }, siblingIds);
    } else {
      setSeatMap(null);
      setAnticipatedCount(1);
    }
  };

  const switchSchedule = async (schedule: ScheduleItem) => {
    releaseAllLocks();
    setActiveScheduleId(schedule.id);
    setSelectedSeats([]);
    selectedIdsRef.current = new Set();
    lockExpiriesRef.current = {};
    setTickets([]);
    setTicketMode(null);
    quickConfirmRef.current = false;
    if (!schedule.is_anticipated) {
      await loadSeatMap(schedule.id);

      unsubRef.current?.();
      const siblingIds = await getSiblingScheduleIds(schedule.id);
      unsubRef.current = subscribeToSeatChanges(schedule.id, () => {
        if (suppressCountRef.current > 0) { suppressCountRef.current--; return; }
        loadSeatMap(schedule.id, true);
      }, siblingIds);
    } else {
      setSeatMap(null);
      setAnticipatedCount(1);
    }
  };

  /* ─── seat toggle (manual) ──────────────────────────────── */
  const toggleSeat = useCallback(async (seat: EnrichedSeat) => {
    if (!activeScheduleId) return;
    const isSelected = selectedIdsRef.current.has(seat.id);

    if (!isSelected && seat.status !== 'available' && seat.status !== 'locked_by_me') return;

    if (isSelected) {
      selectedIdsRef.current.delete(seat.id);
      delete lockExpiriesRef.current[seat.id];
      setSelectedSeats(prev => prev.filter(s => s.id !== seat.id));
      setTickets(prev => prev.filter(t => t.seatLabel !== seat.label));

      setSeatMap(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          available_count: prev.available_count + 1,
          enriched_layout: prev.enriched_layout.map(row => ({
            ...row,
            seats: row.seats.map(s => s.id === seat.id ? { ...s, status: 'available' as const } : s),
          })),
        };
      });

      suppressCountRef.current++;
      releaseSeatLock(activeScheduleId, seat.id).catch(() => {});
    } else {
      selectedIdsRef.current.add(seat.id);
      setSelectedSeats(prev => [...prev, seat]);

      setSeatMap(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          available_count: Math.max(0, prev.available_count - 1),
          enriched_layout: prev.enriched_layout.map(row => ({
            ...row,
            seats: row.seats.map(s => s.id === seat.id ? { ...s, status: 'locked_by_me' as const } : s),
          })),
        };
      });

      suppressCountRef.current++;
      const lock = await tryLockSeat(activeScheduleId, seat.id, SESSION_ID);
      if (!lock) {
        selectedIdsRef.current.delete(seat.id);
        setSelectedSeats(prev => prev.filter(s => s.id !== seat.id));
        setSeatMap(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            available_count: prev.available_count + 1,
            enriched_layout: prev.enriched_layout.map(row => ({
              ...row,
              seats: row.seats.map(s => s.id === seat.id ? { ...s, status: 'locked' as const } : s),
            })),
          };
        });
        loadSeatMap(activeScheduleId, true);
        toast.error(`Siege ${seat.label} indisponible`);
        return;
      }
      lockExpiriesRef.current[seat.id] = lock.expires_at;
    }
  }, [activeScheduleId, loadSeatMap]);

  /* ─── auto-select seats ─────────────────────────────────── */
  const [autoCount, setAutoCount] = useState(5);

  const autoSelectSeats = async () => {
    if (!seatMap || !activeScheduleId) return;
    const available = seatMap.enriched_layout
      .flatMap(r => r.seats)
      .filter(s => s.status === 'available' && s.type !== 'hors_service');

    const toSelect = available.slice(0, autoCount);
    if (toSelect.length === 0) {
      toast.error('Aucun siege disponible');
      return;
    }

    for (const seat of toSelect) {
      await toggleSeat(seat);
    }
    toast.success(`${toSelect.length} siege(s) selectionne(s)`);
  };

  /* ─── generate tickets from selected seats ──────────────── */
  const generateTickets = () => {
    if (!activeSchedule) return;
    const newTickets: TicketEntry[] = selectedSeats
      .filter(s => !tickets.some(t => t.seatLabel === s.label))
      .map(s => ({
        uid: `t_${++ticketUid}`,
        scheduleId: activeSchedule.id,
        seatLabel: s.label,
        passengerName: '',
        passengerPhone: '',
        price: s.price || activeSchedule.price || 0,
      }));

    setTickets(prev => [...prev, ...newTickets]);
    setTicketMode('choose');
  };

  /* ─── generate tickets for anticipated trips (random seats) ─ */
  const generateAnticipatedTickets = () => {
    if (!activeSchedule) return;
    const count = Math.max(1, Math.min(anticipatedCount, activeSchedule.seats_available - tickets.length));
    if (count <= 0) { toast.error('Aucun siege disponible'); return; }

    const capacity = activeSchedule.buses?.total_seats || 60;
    const usedLabels = new Set(tickets.map(t => t.seatLabel));
    const newTickets: TicketEntry[] = [];
    for (let i = 0; i < count; i++) {
      let label = '';
      let attempts = 0;
      do {
        label = String(Math.floor(Math.random() * capacity) + 1);
        attempts++;
      } while (usedLabels.has(label) && attempts < 200);
      usedLabels.add(label);
      newTickets.push({
        uid: `t_${++ticketUid}`,
        scheduleId: activeSchedule.id,
        seatLabel: label,
        passengerName: '',
        passengerPhone: '',
        price: activeSchedule.price || 0,
      });
    }

    setTickets(prev => [...prev, ...newTickets]);
    setTicketMode('choose');
  };

  /* ─── quick validation (auto-fill + confirm + print) ───── */
  const handleQuickValidation = async () => {
    setTickets(prev => prev.map(t => ({
      ...t,
      passengerName: t.passengerName.trim() || 'CLIENT GUICHET',
      passengerPhone: t.passengerPhone.trim() || '\u2014',
    })));
    setTicketMode('quick');
  };

  const quickConfirmRef = useRef(false);
  useEffect(() => {
    if (ticketMode !== 'quick' || quickConfirmRef.current) return;
    if (tickets.length === 0 || tickets.some(t => !t.passengerName.trim())) return;
    quickConfirmRef.current = true;
    handleConfirmSale();
  }, [ticketMode, tickets]);


  /* ─── release all locks ─────────────────────────────────── */
  const releaseAllLocks = useCallback(() => {
    const sid = activeScheduleId;
    if (!sid) return;
    const toRelease = [...selectedIdsRef.current];
    selectedIdsRef.current = new Set();
    lockExpiriesRef.current = {};
    suppressCountRef.current += toRelease.length;
    toRelease.forEach(id => releaseSeatLock(sid, id).catch(() => {}));
  }, [activeScheduleId]);

  /* ─── lock countdown ────────────────────────────────────── */
  useEffect(() => {
    const timer = setInterval(() => {
      const expiries = lockExpiriesRef.current;
      if (Object.keys(expiries).length === 0) return;
      const now = Date.now();
      const next: Record<string, number> = {};
      const expired: string[] = [];
      for (const [id, exp] of Object.entries(expiries)) {
        const rem = Math.max(0, Math.round((new Date(exp).getTime() - now) / 1000));
        next[id] = rem;
        if (rem === 0) expired.push(id);
      }
      setLockCountdowns(next);
      if (expired.length > 0) {
        expired.forEach(id => {
          delete lockExpiriesRef.current[id];
          selectedIdsRef.current.delete(id);
        });
        setSelectedSeats(prev => prev.filter(s => !expired.includes(s.id)));
        setTickets(prev => prev.filter(t => {
          const seat = selectedSeats.find(s => s.label === t.seatLabel);
          return !seat || !expired.includes(seat.id);
        }));
        if (activeScheduleId) loadSeatMap(activeScheduleId, true);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [activeScheduleId, loadSeatMap, selectedSeats]);

  /* ─── confirm sale ──────────────────────────────────────── */
  const handleConfirmSale = async () => {
    if (!activeSchedule || tickets.length === 0) return;

    const incomplete = tickets.filter(t => !t.passengerName.trim());
    if (incomplete.length > 0) {
      toast.error('Veuillez renseigner le nom du passager pour chaque ticket');
      return;
    }

    setProcessing(true);
    try {
      const seatNumbers = tickets.map(t => t.seatLabel);

      if (!activeSchedule.is_anticipated) {
        const checks = await Promise.all(
          seatNumbers.map(s => isSeatStillAvailable(activeSchedule.id, s))
        );
        const conflictIdx = checks.findIndex(ok => !ok);
        if (conflictIdx !== -1) {
          toast.error(`Siege ${seatNumbers[conflictIdx]} deja reserve. Veuillez actualiser.`);
          await loadSeatMap(activeSchedule.id);
          setProcessing(false);
          return;
        }
      }

      const totalPrice = tickets.reduce((s, t) => s + t.price, 0);
      const reference = `SBTA-${new Date().getFullYear()}-${Math.random().toString(36).substr(2, 8).toUpperCase()}`;

      const reservationInserts = tickets.map((t, i) => ({
        schedule_id: activeSchedule.id,
        passenger_name: t.passengerName.trim(),
        passenger_phone: t.passengerPhone?.trim() || '',
        seat_numbers: [t.seatLabel],
        total_seats: 1,
        total_price: t.price,
        booking_reference: `${reference}-${i + 1}`,
        qr_code: `${reference}-${i + 1}`,
        status: 'en_attente',
        payment_status: 'en_attente',
        booked_by: user?.id,
      }));

      const { data: reservations, error: resError } = await supabase
        .from('reservations')
        .insert(reservationInserts)
        .select();

      if (resError) throw resError;

      const group: ConfirmedGroup = {
        booking_reference: reference,
        schedule: activeSchedule,
        tickets,
        totalPrice,
      };
      setConfirmedGroup(group);

      setPrintQueue(tickets.map((t, i) => ({
        ticket: t,
        status: 'pending' as PrintStatus,
        index: i,
        reservationId: reservations?.[i]?.id,
      })));

      selectedIdsRef.current = new Set();
      lockExpiriesRef.current = {};
      setSelectedSeats([]);
      setStep('confirmed');
      toast.success(`${seatNumbers.length} billet(s) charge(s) — imprimez pour valider la vente`);
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors de la vente');
    } finally {
      setProcessing(false);
    }
  };

  /* ─── print single ticket ───────────────────────────────── */
  const printSingleTicket = async (ticket: TicketEntry, ticketIndex: number) => {
    if (!confirmedGroup) return;
    const { schedule, booking_reference } = confirmedGroup;

    const formatAmount = (n: number): string => {
      const str = Math.round(n).toString();
      let result = '';
      for (let i = 0; i < str.length; i++) {
        if (i > 0 && (str.length - i) % 3 === 0) result += ' ';
        result += str[i];
      }
      return result + ' f';
    };

    const W = 80;
    const L = 4;
    const R = 76;
    const MID = 46;
    const depDate = format(new Date(schedule.departure_datetime), 'dd/MM/yyyy');
    const depTime = format(new Date(schedule.departure_datetime), 'HH:mm');
    const origin = schedule.origin_city_name.toUpperCase();
    const dest = schedule.destination_city_name.toUpperCase();
    const busReg = schedule.buses?.registration_number || '--';
    const printDt = format(new Date(), 'dd/MM/yyyy HH:mm:ss');
    const departureNum = schedule.departure_number ?? '';

    let logoDataUrl: string | null = null;
    try {
      const resp = await fetch('/logo_sbta02.JPG');
      const blob = await resp.blob();
      logoDataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    } catch {}

    const ticketH = 126;
    const doc = new jsPDF({ unit: 'mm', format: [W, ticketH] });

    const dashed = (y: number) => {
      doc.setLineDashPattern([1.2, 1.0], 0);
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.3);
      doc.line(L, y, R, y);
      doc.setLineDashPattern([], 0);
    };
    const solid = (y: number) => {
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.3);
      doc.line(L, y, R, y);
    };

    const oY = 0;
    const tarif = formatAmount(ticket.price);
    const refFull = `${booking_reference}-${ticketIndex + 1}`;

    if (logoDataUrl) {
      doc.addImage(logoDataUrl, 'JPEG', 3, oY + 3, 18, 16);
    } else {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.text('S.B.T.A', 12, oY + 9, { align: 'center' });
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(0, 0, 0);
    doc.text('SBTA', R, oY + 11, { align: 'right' });
    doc.setFontSize(5.5);
    doc.setFont('helvetica', 'normal');
    doc.text("Societe Bonkoungou Transport de L'Agneby", R, oY + 15, { align: 'right' });
    doc.text('Tel 01 14 34 60 / 01 14 34 87', R, oY + 18.5, { align: 'right' });
    solid(oY + 21);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('DEPART', L, oY + 29);
    doc.setLineWidth(0.3);
    doc.line(MID, oY + 22, MID, oY + 33);
    doc.setFontSize(13);
    doc.text(String(departureNum), (MID + R) / 2, oY + 29, { align: 'center' });
    dashed(oY + 33);

    doc.setFontSize(10);
    doc.text(origin, L, oY + 41);
    doc.setFontSize(9);
    doc.text('=>', 38, oY + 41, { align: 'center' });
    doc.text(dest, R, oY + 41, { align: 'right' });
    dashed(oY + 45);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('SIEGE', L, oY + 52);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(ticket.seatLabel, 16, oY + 52);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('TARIF', 53, oY + 52);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(tarif, R, oY + 52, { align: 'right' });
    dashed(oY + 57);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('CAR', L, oY + 64);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(busReg.substring(0, 18), 16, oY + 64);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('N\u00b0TICKET', 38, oY + 64);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(11, 116, 57);
    doc.text(refFull, R, oY + 64, { align: 'right' });
    doc.setTextColor(0, 0, 0);
    dashed(oY + 69);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('DATE :', L, oY + 76);
    doc.setFont('helvetica', 'bold');
    doc.text(depDate, 17, oY + 76);
    doc.setFont('helvetica', 'normal');
    doc.text('HEURE:', 47, oY + 76);
    doc.setFont('helvetica', 'bold');
    doc.text(depTime, 62, oY + 76);
    dashed(oY + 81);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('PASSAGER:', L, oY + 87);
    doc.setFont('helvetica', 'bold');
    doc.text(ticket.passengerName.toUpperCase().substring(0, 30), 22, oY + 87);
    dashed(oY + 91);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.text('NB. Tout ticket encaisse n est plus remboursable', 40, oY + 97, { align: 'center' });
    dashed(oY + 101);
    doc.setFontSize(6);
    doc.text('VEUILLEZ CONSERVER LES TICKETS JUSQU\'A DESTINATION', 40, oY + 107, { align: 'center' });
    dashed(oY + 111);

    doc.setFontSize(6.5);
    doc.text('V10  Imprimer le :', L, oY + 117);
    doc.text(printDt, R, oY + 117, { align: 'right' });

    doc.setLineWidth(0.4);
    doc.rect(2, oY + 2, W - 4, 119);

    doc.autoPrint();
    const blobUrl = doc.output('bloburl');
    const printWin = window.open(blobUrl as unknown as string, '_blank');
    if (printWin) {
      printWin.addEventListener('afterprint', () => printWin.close());
    }
  };

  /* ─── finalize a single ticket sale (reservation + payment + seat count) */
  const finalizeTicketSale = async (queueItem: PrintQueueItem) => {
    if (!queueItem.reservationId || !confirmedGroup) return;
    const scheduleId = confirmedGroup.schedule.id;

    await supabase
      .from('reservations')
      .update({ status: 'confirmee', payment_status: 'payee' })
      .eq('id', queueItem.reservationId);

    await supabase.from('payments').insert({
      reservation_id: queueItem.reservationId,
      amount: queueItem.ticket.price,
      payment_method: 'especes',
      status: 'reussie',
      processed_by: user?.id,
    });

    const { data: sched } = await supabase
      .from('schedules')
      .select('seats_available, seats_reserved')
      .eq('id', scheduleId)
      .single();

    if (sched) {
      await supabase.from('schedules').update({
        seats_available: Math.max(0, sched.seats_available - 1),
        seats_reserved: (sched.seats_reserved || 0) + 1,
      }).eq('id', scheduleId);
    }
  };

  /* ─── print next ticket in queue ───────────────────────── */
  const printNextTicket = useCallback(async () => {
    if (isPrintingOne || !confirmedGroup) return;

    const nextIdx = printQueue.findIndex(q => q.status === 'pending');
    if (nextIdx === -1) return;

    setIsPrintingOne(true);
    setPrintQueue(prev => prev.map((q, i) =>
      i === nextIdx ? { ...q, status: 'printing' as PrintStatus } : q
    ));

    try {
      await printSingleTicket(printQueue[nextIdx].ticket, printQueue[nextIdx].index);
      await finalizeTicketSale(printQueue[nextIdx]);
      setPrintQueue(prev => prev.map((q, i) =>
        i === nextIdx ? { ...q, status: 'printed' as PrintStatus } : q
      ));
    } catch {
      setPrintQueue(prev => prev.map((q, i) =>
        i === nextIdx ? { ...q, status: 'error' as PrintStatus } : q
      ));
      toast.error(`Erreur impression billet ${printQueue[nextIdx].ticket.seatLabel}`);
    } finally {
      setIsPrintingOne(false);
    }
  }, [isPrintingOne, confirmedGroup, printQueue]);

  /* ─── retry a failed ticket ────────────────────────────── */
  const retryPrint = useCallback((idx: number) => {
    setPrintQueue(prev => prev.map((q, i) =>
      i === idx ? { ...q, status: 'pending' as PrintStatus } : q
    ));
  }, []);

  /* ─── keyboard: Enter to print next ────────────────────── */
  useEffect(() => {
    if (step !== 'confirmed') return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.repeat) {
        e.preventDefault();
        printNextTicket();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [step, printNextTicket]);

  /* ─── save / restore print sessions ────────────────────── */
  const saveCurrentPrintSession = useCallback(() => {
    if (!confirmedGroup || printQueue.length === 0) return;
    const hasPending = printQueue.some(q => q.status === 'pending' || q.status === 'error');
    if (!hasPending) {
      setSavedPrintSessions(prev =>
        prev.filter(s => s.confirmedGroup.booking_reference !== confirmedGroup.booking_reference)
      );
      return;
    }
    setSavedPrintSessions(prev => {
      const existing = prev.findIndex(s => s.confirmedGroup.booking_reference === confirmedGroup.booking_reference);
      const entry: SavedPrintSession = { confirmedGroup, printQueue };
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = entry;
        return updated;
      }
      return [...prev, entry];
    });
  }, [confirmedGroup, printQueue]);

  /* ─── auto-save current session on print progress ──────── */
  useEffect(() => {
    if (step !== 'confirmed' || !confirmedGroup || printQueue.length === 0) return;
    saveCurrentPrintSession();
  }, [printQueue, step]);

  const restorePrintSession = useCallback((session: SavedPrintSession) => {
    setConfirmedGroup(session.confirmedGroup);
    setPrintQueue(session.printQueue);
    setStep('confirmed');
  }, []);

  /* ─── new sale (reset) ──────────────────────────────────── */
  const startNewSale = () => {
    saveCurrentPrintSession();
    setConfirmedGroup(null);
    setPrintQueue([]);
    setTickets([]);
    setSelectedSeats([]);
    selectedIdsRef.current = new Set();
    lockExpiriesRef.current = {};
    setTicketMode(null);
    quickConfirmRef.current = false;
    setStep('schedules');
  };

  /* ─── render helpers ────────────────────────────────────── */
  const formatPrice = (n: number) => n.toLocaleString('fr-FR') + ' FCFA';

  /* ─── RENDER ────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--primary)' }} />
      </div>
    );
  }

  /* ── Step: Destinations ─────────────────────────────────── */
  const renderDestinations = () => (
    <div>
      {/* Pending print sessions banner */}
      {savedPrintSessions.length > 0 && (
        <div className="mb-5 p-4 rounded-xl border-2" style={{ borderColor: '#F59E0B', backgroundColor: '#FFFBEB' }}>
          <div className="flex items-center gap-2 mb-3">
            <Printer className="w-5 h-5" style={{ color: '#D97706' }} />
            <p className="font-bold text-sm" style={{ color: '#92400E' }}>
              Impressions en attente
            </p>
          </div>
          <div className="space-y-2">
            {savedPrintSessions.map((session, idx) => {
              const sPrinted = session.printQueue.filter(q => q.status === 'printed').length;
              const sTotal = session.printQueue.length;
              const sRemaining = sTotal - sPrinted;
              if (sRemaining <= 0) return null;
              return (
                <button key={idx} onClick={() => {
                  setSavedPrintSessions(prev => prev.filter((_, j) => j !== idx));
                  restorePrintSession(session);
                }}
                  className="w-full flex items-center justify-between p-3 rounded-xl border text-sm transition-all hover:shadow-md"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: '#DBEAFE' }}>
                      <Ticket className="w-5 h-5" style={{ color: 'var(--primary)' }} />
                    </div>
                    <div className="text-left">
                      <p className="font-bold" style={{ color: 'var(--text-primary)' }}>
                        {session.confirmedGroup.schedule.origin_city_name} → {session.confirmedGroup.schedule.destination_city_name}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {session.confirmedGroup.booking_reference} - {format(new Date(session.confirmedGroup.schedule.departure_datetime), 'HH:mm')}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold" style={{ color: '#D97706' }}>
                      {sPrinted}/{sTotal}
                    </p>
                    <p className="text-xs" style={{ color: '#92400E' }}>
                      {sRemaining} restant(s)
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
        Selection des destinations
      </h2>
      <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
        Selectionnez les villes d'arrivee des voyages planifies par le Chef de Gare.
      </p>

      {destinations.length === 0 ? (
        <div className="text-center py-12 rounded-xl border-2 border-dashed" style={{ borderColor: 'var(--border)' }}>
          <MapPin className="w-10 h-10 mx-auto mb-3" style={{ color: '#D1D5DB' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            Aucun voyage planifie pour aujourd'hui
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            Le Chef de Gare n'a pas encore assigne de departs a votre guichet.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {destinations.map(city => {
            const sel = selectedDestIds.includes(city.id);
            return (
              <div key={city.id} onClick={() => toggleDest(city.id)}
                className="p-4 border-2 rounded-xl cursor-pointer transition-all flex items-center gap-3"
                style={{
                  borderColor: sel ? 'var(--primary)' : 'var(--border)',
                  backgroundColor: sel ? 'var(--primary-light)' : 'transparent',
                }}>
                <input type="checkbox" checked={sel} readOnly className="w-4 h-4 rounded"
                  style={{ accentColor: 'var(--primary)' }} />
                <MapPin className="w-4 h-4" style={{ color: sel ? 'var(--primary)' : 'var(--text-muted)' }} />
                <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                  {myStationName || 'Depart'} → {city.name}
                </span>
                {sel && <CheckCircle className="w-5 h-5 ml-auto" style={{ color: 'var(--primary)' }} />}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex justify-between items-center mt-6">
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {selectedDestIds.length} destination(s)
        </span>
        <button onClick={loadSchedules} disabled={selectedDestIds.length === 0 || loadingSchedules}
          className="px-6 py-3 rounded-lg text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          style={{ backgroundColor: 'var(--primary)' }}>
          {loadingSchedules ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
          Voir les voyages
        </button>
      </div>
    </div>
  );

  /* ── Step: Schedules ────────────────────────────────────── */
  const renderSchedules = () => (
    <div>
      {/* Pending print sessions */}
      {savedPrintSessions.filter(s => s.printQueue.some(q => q.status === 'pending' || q.status === 'error')).length > 0 && (
        <div className="mb-4 p-3 rounded-xl border-2" style={{ borderColor: '#F59E0B', backgroundColor: '#FFFBEB' }}>
          <div className="flex items-center gap-2 mb-2">
            <Printer className="w-4 h-4" style={{ color: '#D97706' }} />
            <p className="text-xs font-bold" style={{ color: '#92400E' }}>
              Impressions en attente
            </p>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {savedPrintSessions.map((session, idx) => {
              const sp = session.printQueue.filter(q => q.status === 'printed').length;
              const st = session.printQueue.length;
              const sr = st - sp;
              if (sr <= 0) return null;
              return (
                <button key={idx} onClick={() => {
                  setSavedPrintSessions(prev => prev.filter((_, j) => j !== idx));
                  restorePrintSession(session);
                }}
                  className="px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap border transition-all hover:shadow-sm flex items-center gap-2"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
                  <span style={{ color: 'var(--text-primary)' }}>
                    {session.confirmedGroup.schedule.destination_city_name}
                  </span>
                  <span className="font-bold" style={{ color: '#D97706' }}>{sp}/{st}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
        Voyages disponibles
      </h2>
      <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
        {schedules.length} voyage(s) assigne(s) a votre guichet. Selectionnez un voyage pour commencer la vente.
      </p>

      {schedules.length === 0 ? (
        <div className="text-center py-12 rounded-xl border-2 border-dashed" style={{ borderColor: 'var(--border)' }}>
          <Bus className="w-10 h-10 mx-auto mb-3" style={{ color: '#D1D5DB' }} />
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Aucun voyage disponible</p>
        </div>
      ) : (
        <div className="space-y-3">
          {schedules.map(schedule => (
            <div key={schedule.id} className="p-4 border rounded-xl" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                      {schedule.origin_city_name} → {schedule.destination_city_name}
                    </span>
                    {schedule.departure_number && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-bold text-white"
                        style={{ backgroundColor: 'var(--primary)' }}>
                        N{schedule.departure_number}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {format(new Date(schedule.departure_datetime), 'HH:mm')}
                    </span>
                    <span className="flex items-center gap-1">
                      <Bus className="w-3 h-3" />
                      {schedule.buses?.registration_number || '--'}
                    </span>
                    <span className="flex items-center gap-1">
                      <User className="w-3 h-3" />
                      {schedule.driver_name}
                    </span>
                    <span className="flex items-center gap-1">
                      <Armchair className="w-3 h-3" />
                      <span className="font-bold" style={{ color: schedule.seats_available > 0 ? '#16A34A' : '#DC2626' }}>
                        {schedule.seats_available} dispo
                      </span>
                      / {schedule.seats_reserved} vendus
                    </span>
                    {schedule.is_anticipated && (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: '#EA580C' }}>
                        <Zap className="w-2.5 h-2.5" /> Anticipe
                      </span>
                    )}
                  </div>
                </div>
                <button onClick={() => selectScheduleForSale(schedule)}
                  disabled={schedule.seats_available <= 0}
                  className="px-4 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 flex-shrink-0"
                  style={{ backgroundColor: 'var(--primary)' }}>
                  <Ticket className="w-4 h-4" />
                  Passer a la vente
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-4 mt-6">
        <button onClick={() => setStep('destinations')}
          className="px-6 py-3 rounded-lg border text-sm font-medium"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
          Retour
        </button>
      </div>
    </div>
  );

  /* ── Step: Sale (seat map + tickets) ────────────────────── */
  const renderSale = () => {
    if (!activeSchedule) return null;

    const otherSchedules = schedules.filter(s => s.id !== activeScheduleId);

    return (
      <div>
        {/* Schedule tabs for switching */}
        {schedules.length > 1 && (
          <div className="mb-4 flex gap-2 overflow-x-auto pb-2">
            {schedules.map(s => (
              <button key={s.id} onClick={() => s.id !== activeScheduleId && switchSchedule(s)}
                className="px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap border-2 transition-all flex-shrink-0"
                style={{
                  borderColor: s.id === activeScheduleId ? 'var(--primary)' : 'var(--border)',
                  backgroundColor: s.id === activeScheduleId ? 'var(--primary-light)' : 'transparent',
                  color: s.id === activeScheduleId ? 'var(--primary)' : 'var(--text-secondary)',
                }}>
                {s.destination_city_name} {format(new Date(s.departure_datetime), 'HH:mm')}
                <span className="ml-1 opacity-70">({s.seats_available} pl.)</span>
              </button>
            ))}
          </div>
        )}

        {/* Active schedule info */}
        <div className="p-4 rounded-xl border-2 mb-4" style={{ borderColor: 'var(--primary)', backgroundColor: 'var(--primary-light)' }}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-bold" style={{ color: 'var(--text-primary)' }}>
                  {activeSchedule.origin_city_name} → {activeSchedule.destination_city_name}
                </span>
                {activeSchedule.departure_number && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-bold text-white"
                    style={{ backgroundColor: 'var(--primary)' }}>
                    N{activeSchedule.departure_number}
                  </span>
                )}
              </div>
              <div className="flex gap-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                <span>{format(new Date(activeSchedule.departure_datetime), 'HH:mm')}</span>
                <span>{activeSchedule.buses?.registration_number}</span>
                <span>{activeSchedule.driver_name}</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold" style={{ color: 'var(--primary)' }}>
                {activeSchedule.seats_available - selectedSeats.length}
              </div>
              <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>places restantes</div>
            </div>
          </div>
        </div>

        {/* Auto-select controls (non-anticipated only) */}
        {!activeSchedule.is_anticipated && (
        <div className="flex items-center gap-3 mb-4 p-3 rounded-xl border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--neutral-50)' }}>
          <Zap className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--primary)' }} />
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Selection automatique :</span>
          <input type="number" min={1} max={activeSchedule.seats_available} value={autoCount}
            onChange={e => setAutoCount(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-16 px-2 py-1.5 border rounded-lg text-sm text-center"
            style={{ borderColor: 'var(--border)' }} />
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>siege(s)</span>
          <button onClick={autoSelectSeats}
            className="px-4 py-1.5 rounded-lg text-white text-sm font-semibold flex items-center gap-1.5"
            style={{ backgroundColor: 'var(--primary)' }}>
            <Zap className="w-3.5 h-3.5" />
            Selection auto
          </button>
        </div>
        )}

        {/* Anticipated departure: count selector (no seat map) */}
        {activeSchedule.is_anticipated && (
          <div className="mb-4 p-5 rounded-xl border-2" style={{ borderColor: 'var(--primary)', backgroundColor: 'var(--primary-light)' }}>
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-5 h-5" style={{ color: 'var(--primary)' }} />
              <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                Depart anticipe - Vente sans plan de sieges
              </span>
            </div>
            <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>
              Les sieges seront attribues automatiquement et de maniere aleatoire par le systeme.
            </p>
            <div className="flex items-center gap-3 mb-4">
              <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Nombre de billets :</label>
              <input type="number" min={1} max={Math.max(1, activeSchedule.seats_available - tickets.length)}
                value={anticipatedCount}
                onChange={e => setAnticipatedCount(Math.max(1, Math.min(parseInt(e.target.value) || 1, activeSchedule.seats_available - tickets.length)))}
                className="w-20 px-3 py-2 border-2 rounded-lg text-sm text-center font-bold"
                style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }} />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                / {Math.max(0, activeSchedule.seats_available - tickets.length)} disponible(s)
              </span>
            </div>
            <button onClick={generateAnticipatedTickets}
              disabled={tickets.length >= activeSchedule.seats_available}
              className="w-full py-2.5 rounded-lg text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: 'var(--primary)' }}>
              <Ticket className="w-4 h-4" />
              Charger les tickets ({Math.min(anticipatedCount, Math.max(0, activeSchedule.seats_available - tickets.length))})
            </button>
          </div>
        )}

        {/* Seat map (non-anticipated only) */}
        {!activeSchedule.is_anticipated && (
        <div className="mb-4">
          {loadingSeatMap ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--primary)' }} />
            </div>
          ) : seatMap ? (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded border bg-white" style={{ borderColor: '#CBD5E1' }}></span> Libre
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded" style={{ backgroundColor: '#0B7439' }}></span> Selectionne
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded" style={{ backgroundColor: '#F1F5F9' }}></span> Occupe
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded" style={{ backgroundColor: '#FFF7ED' }}></span> Verrouille
                  </span>
                </div>
                <button onClick={() => loadSeatMap(activeSchedule.id)}
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                  <RefreshCw className="w-3.5 h-3.5" /> Actualiser
                </button>
              </div>
              <SeatMapComponent
                seatMap={seatMap}
                selectedSeats={selectedSeats}
                onSeatToggle={toggleSeat}
                lockCountdowns={lockCountdowns}
              />
            </div>
          ) : (
            <div className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>
              Plan de sieges indisponible
            </div>
          )}
        </div>
        )}

        {/* Selected seats summary + generate tickets (non-anticipated only) */}
        {!activeSchedule.is_anticipated && selectedSeats.length > 0 && (
          <div className="p-4 rounded-xl border-2 mb-4" style={{ borderColor: 'var(--primary)', backgroundColor: 'var(--primary-light)' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Armchair className="w-5 h-5" style={{ color: 'var(--primary)' }} />
                <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                  {selectedSeats.length} siege(s) selectionne(s)
                </span>
              </div>
              <span className="font-bold" style={{ color: 'var(--primary)' }}>
                {formatPrice(selectedSeats.reduce((s, seat) => s + (seat.price || activeSchedule.price || 0), 0))}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {selectedSeats.map(s => (
                <span key={s.id} className="px-2 py-1 rounded text-xs font-bold text-white"
                  style={{ backgroundColor: 'var(--primary)' }}>
                  {s.label}
                  {lockCountdowns[s.id] !== undefined && (
                    <span className="ml-1 opacity-70 text-[10px]">{lockCountdowns[s.id]}s</span>
                  )}
                </span>
              ))}
            </div>
            <button onClick={generateTickets}
              className="w-full py-2.5 rounded-lg text-white font-bold text-sm flex items-center justify-center gap-2"
              style={{ backgroundColor: 'var(--primary)' }}>
              <Ticket className="w-4 h-4" />
              Charger les tickets ({selectedSeats.length})
            </button>
          </div>
        )}

        {/* Mode choice: after "Charger les tickets" */}
        {tickets.length > 0 && ticketMode === 'choose' && (
          <div className="mb-4">
            <h3 className="font-bold text-sm mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <Users className="w-4 h-4" />
              {tickets.length} ticket(s) charge(s) -- Choisissez le mode de validation
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Option 1: Manual entry */}
              <button onClick={() => setTicketMode('manual')}
                className="p-5 border-2 rounded-xl text-left transition-all hover:shadow-md group"
                style={{ borderColor: 'var(--border)' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}>
                <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-3"
                  style={{ backgroundColor: '#E0F2FE' }}>
                  <User className="w-5 h-5" style={{ color: '#0369A1' }} />
                </div>
                <div className="font-bold text-sm mb-1" style={{ color: 'var(--text-primary)' }}>
                  Saisir les informations passagers
                </div>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  Renseignez le nom et le telephone de chaque passager avant de valider la vente.
                </p>
              </button>

              {/* Option 2: Quick validation */}
              <button onClick={handleQuickValidation}
                disabled={processing}
                className="p-5 border-2 rounded-xl text-left transition-all hover:shadow-md relative overflow-hidden"
                style={{ borderColor: 'var(--border)' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#16A34A')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}>
                <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-3"
                  style={{ backgroundColor: '#DCFCE7' }}>
                  <Zap className="w-5 h-5" style={{ color: '#16A34A' }} />
                </div>
                <div className="font-bold text-sm mb-1" style={{ color: 'var(--text-primary)' }}>
                  Validation rapide
                </div>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  Generer et imprimer les billets immediatement. Passager : CLIENT GUICHET, Contact : {'\u2014'}
                </p>
                {processing && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.85)' }}>
                    <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--primary)' }} />
                  </div>
                )}
              </button>
            </div>

            <div className="mt-4 p-3 rounded-xl flex items-center justify-between" style={{ backgroundColor: 'var(--neutral-50)' }}>
              <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                {tickets.length} billet(s){!activeSchedule.is_anticipated ? ` - ${selectedSeats.map(s => s.label).join(', ')}` : ` - Sieges auto (${tickets.map(t => t.seatLabel).join(', ')})`}
              </span>
              <span className="font-bold" style={{ color: 'var(--primary)' }}>
                {formatPrice(tickets.reduce((s, t) => s + t.price, 0))}
              </span>
            </div>
          </div>
        )}

        {/* Quick validation in progress */}
        {tickets.length > 0 && ticketMode === 'quick' && !confirmedGroup && (
          <div className="mb-4 p-6 rounded-xl border-2 text-center" style={{ borderColor: 'var(--primary)', backgroundColor: 'var(--primary-light)' }}>
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" style={{ color: 'var(--primary)' }} />
            <p className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
              Validation rapide en cours...
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              {tickets.length} billet(s) CLIENT GUICHET
            </p>
          </div>
        )}

        {/* Manual ticket entries */}
        {tickets.length > 0 && ticketMode === 'manual' && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-sm flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <Users className="w-4 h-4" />
                Tickets a emettre ({tickets.length})
              </h3>
              <button onClick={() => setTicketMode('choose')}
                className="text-xs px-3 py-1.5 rounded-lg border flex items-center gap-1"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                <ArrowLeft className="w-3 h-3" /> Changer le mode
              </button>
            </div>
            <div className="space-y-2">
              {tickets.map((ticket, i) => (
                <div key={ticket.uid} className="p-3 border rounded-xl" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                      style={{ backgroundColor: 'var(--primary)' }}>
                      {ticket.seatLabel}
                    </span>
                    <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                      Siege {ticket.seatLabel} - {formatPrice(ticket.price)}
                    </span>
                    <button onClick={() => setTickets(prev => prev.filter(t => t.uid !== ticket.uid))}
                      className="ml-auto p-1 rounded hover:bg-red-50">
                      <X className="w-3.5 h-3.5 text-red-500" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="text" placeholder="Nom du passager *"
                      value={ticket.passengerName}
                      onChange={e => setTickets(prev => prev.map(t =>
                        t.uid === ticket.uid ? { ...t, passengerName: e.target.value } : t
                      ))}
                      className="w-full px-2.5 py-2 border rounded-lg text-sm"
                      style={{ borderColor: !ticket.passengerName.trim() ? '#FBBF24' : 'var(--border)', color: 'var(--text-primary)' }} />
                    <input type="text" placeholder="Telephone"
                      value={ticket.passengerPhone}
                      onChange={e => setTickets(prev => prev.map(t =>
                        t.uid === ticket.uid ? { ...t, passengerPhone: e.target.value } : t
                      ))}
                      className="w-full px-2.5 py-2 border rounded-lg text-sm"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 p-4 rounded-xl border-2" style={{ borderColor: 'var(--primary)' }}>
              <div className="flex items-center justify-between mb-3">
                <span className="font-bold" style={{ color: 'var(--text-primary)' }}>
                  Total : {tickets.length} billet(s)
                </span>
                <span className="text-xl font-bold" style={{ color: 'var(--primary)' }}>
                  {formatPrice(tickets.reduce((s, t) => s + t.price, 0))}
                </span>
              </div>
              <button onClick={handleConfirmSale}
                disabled={processing || tickets.length === 0 || tickets.some(t => !t.passengerName.trim())}
                className="w-full py-3 rounded-lg text-white font-bold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{ backgroundColor: 'var(--primary)' }}>
                {processing ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Validation en cours...</>
                ) : (
                  <><CheckCircle className="w-4 h-4" /> Valider la vente groupee ({tickets.length} billets)</>
                )}
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-4 mt-6">
          <button onClick={() => { releaseAllLocks(); setStep('schedules'); }}
            className="px-6 py-3 rounded-lg border text-sm font-medium"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
            Retour aux voyages
          </button>
        </div>
      </div>
    );
  };

  /* ── Step: Confirmed ────────────────────────────────────── */
  const renderConfirmed = () => {
    if (!confirmedGroup) return null;

    const printedCount = printQueue.filter(q => q.status === 'printed').length;
    const pendingCount = printQueue.filter(q => q.status === 'pending').length;
    const errorCount = printQueue.filter(q => q.status === 'error').length;
    const totalCount = printQueue.length;
    const allDone = pendingCount === 0 && errorCount === 0;
    const progressPct = totalCount > 0 ? Math.round((printedCount / totalCount) * 100) : 0;
    const printedRevenue = printQueue.filter(q => q.status === 'printed').reduce((s, q) => s + q.ticket.price, 0);
    const pendingRevenue = confirmedGroup.totalPrice - printedRevenue;

    const statusLabel = (s: PrintStatus) => {
      switch (s) {
        case 'pending': return 'En attente';
        case 'printing': return 'Impression...';
        case 'printed': return 'Imprime';
        case 'error': return 'Erreur impression';
      }
    };
    const statusColor = (s: PrintStatus) => {
      switch (s) {
        case 'pending': return { bg: '#F3F4F6', text: '#6B7280' };
        case 'printing': return { bg: '#DBEAFE', text: '#2563EB' };
        case 'printed': return { bg: '#D1FAE5', text: '#059669' };
        case 'error': return { bg: '#FEE2E2', text: '#DC2626' };
      }
    };
    const statusIcon = (s: PrintStatus) => {
      switch (s) {
        case 'pending': return <Clock className="w-3.5 h-3.5" />;
        case 'printing': return <Loader2 className="w-3.5 h-3.5 animate-spin" />;
        case 'printed': return <Check className="w-3.5 h-3.5" />;
        case 'error': return <AlertTriangle className="w-3.5 h-3.5" />;
      }
    };

    const otherSessions = savedPrintSessions.filter(
      s => s.confirmedGroup.booking_reference !== confirmedGroup.booking_reference
        && s.printQueue.some(q => q.status === 'pending' || q.status === 'error')
    );

    return (
      <div>
        {/* Destination tabs for switching between sessions */}
        {otherSessions.length > 0 && (
          <div className="mb-5">
            <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>
              Destinations avec impressions en cours
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              <div className="px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap border-2 flex-shrink-0"
                style={{ borderColor: 'var(--primary)', backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
                {confirmedGroup.schedule.destination_city_name}
                <span className="ml-1.5 opacity-70">{printedCount}/{totalCount}</span>
              </div>
              {otherSessions.map((session, idx) => {
                const sp = session.printQueue.filter(q => q.status === 'printed').length;
                const st = session.printQueue.length;
                return (
                  <button key={idx} onClick={() => {
                    saveCurrentPrintSession();
                    setSavedPrintSessions(prev => prev.filter(s => s.confirmedGroup.booking_reference !== session.confirmedGroup.booking_reference));
                    restorePrintSession(session);
                  }}
                    className="px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap border-2 flex-shrink-0 transition-all hover:shadow-sm"
                    style={{ borderColor: '#F59E0B', backgroundColor: '#FFFBEB', color: '#92400E' }}>
                    {session.confirmedGroup.schedule.destination_city_name}
                    <span className="ml-1.5 opacity-70">{sp}/{st}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
            style={{ backgroundColor: '#D1FAE5' }}>
            <CheckCircle className="w-8 h-8" style={{ color: '#059669' }} />
          </div>
          <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
            Vente groupee confirmee
          </h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {confirmedGroup.tickets.length} billet(s) charge(s) — {printedCount} vendu(s)
          </p>
        </div>

        {/* Trip info */}
        <div className="p-4 rounded-xl border mb-4" style={{ borderColor: 'var(--border)' }}>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Reference</span>
              <p className="font-bold" style={{ color: '#059669' }}>{confirmedGroup.booking_reference}</p>
            </div>
            <div>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Itineraire</span>
              <p className="font-bold" style={{ color: 'var(--text-primary)' }}>
                {confirmedGroup.schedule.origin_city_name} → {confirmedGroup.schedule.destination_city_name}
              </p>
            </div>
            <div>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Depart</span>
              <p className="font-bold" style={{ color: 'var(--text-primary)' }}>
                {format(new Date(confirmedGroup.schedule.departure_datetime), 'dd/MM/yyyy HH:mm')}
              </p>
            </div>
            <div>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Bus</span>
              <p className="font-bold" style={{ color: 'var(--text-primary)' }}>
                {confirmedGroup.schedule.buses?.registration_number}
              </p>
            </div>
            <div>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Recettes encaissees</span>
              <p className="text-lg font-bold" style={{ color: '#16A34A' }}>
                {formatPrice(printedRevenue)}
              </p>
              {pendingRevenue > 0 && (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  En attente : {formatPrice(pendingRevenue)}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Print progress card */}
        <div className="p-5 rounded-xl border-2 mb-4" style={{
          borderColor: allDone ? '#059669' : 'var(--primary)',
          backgroundColor: allDone ? '#F0FDF4' : 'var(--primary-light)',
        }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: allDone ? '#D1FAE5' : '#DBEAFE' }}>
                <Printer className="w-6 h-6" style={{ color: allDone ? '#059669' : 'var(--primary)' }} />
              </div>
              <div>
                <p className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                  Billets vendus : {printedCount} / {totalCount}
                </p>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {pendingCount > 0 ? `${pendingCount} en attente d'impression` : 'Tous les billets sont vendus'}
                </p>
                {printedRevenue > 0 && (
                  <p className="text-sm font-bold mt-0.5" style={{ color: '#16A34A' }}>
                    Recettes : {formatPrice(printedRevenue)}
                  </p>
                )}
              </div>
            </div>
            {errorCount > 0 && (
              <span className="px-2.5 py-1 rounded-full text-xs font-bold"
                style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>
                {errorCount} erreur(s)
              </span>
            )}
          </div>

          {/* Progress bar */}
          <div className="w-full h-2.5 rounded-full overflow-hidden mb-4" style={{ backgroundColor: '#E5E7EB' }}>
            <div className="h-full rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${progressPct}%`,
                backgroundColor: allDone ? '#059669' : 'var(--primary)',
              }} />
          </div>

          {!allDone && (
            <button onClick={printNextTicket}
              disabled={isPrintingOne || pendingCount === 0}
              className="w-full py-3 rounded-lg text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              style={{ backgroundColor: 'var(--primary)' }}>
              {isPrintingOne ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Impression en cours...</>
              ) : (
                <><Printer className="w-4 h-4" /> Imprimer le billet suivant</>
              )}
            </button>
          )}
          {!allDone && (
            <p className="text-center text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
              Appuyez sur la touche <kbd className="px-1.5 py-0.5 rounded border text-[10px] font-mono font-bold"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--neutral-50)' }}>ENTRER</kbd> pour imprimer le billet suivant
            </p>
          )}
          {allDone && (
            <div className="text-center">
              <p className="text-sm font-bold" style={{ color: '#059669' }}>
                Tous les billets ont ete imprimes !
              </p>
            </div>
          )}
        </div>

        {/* Ticket list with print status */}
        <div className="rounded-xl border overflow-hidden mb-6" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-xs">
            <thead>
              <tr style={{ backgroundColor: 'var(--neutral-50)' }}>
                <th className="text-left px-3 py-2.5 font-semibold" style={{ color: 'var(--text-secondary)' }}>#</th>
                <th className="text-left px-3 py-2.5 font-semibold" style={{ color: 'var(--text-secondary)' }}>Siege</th>
                <th className="text-left px-3 py-2.5 font-semibold" style={{ color: 'var(--text-secondary)' }}>Passager</th>
                <th className="text-right px-3 py-2.5 font-semibold" style={{ color: 'var(--text-secondary)' }}>Prix</th>
                <th className="text-center px-3 py-2.5 font-semibold" style={{ color: 'var(--text-secondary)' }}>Statut</th>
                <th className="text-center px-3 py-2.5 font-semibold" style={{ color: 'var(--text-secondary)' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {printQueue.map((q, i) => {
                const sc = statusColor(q.status);
                return (
                  <tr key={q.ticket.uid} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-3 py-2.5 font-medium" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                    <td className="px-3 py-2.5 font-bold" style={{ color: 'var(--primary)' }}>{q.ticket.seatLabel}</td>
                    <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>{q.ticket.passengerName}</td>
                    <td className="px-3 py-2.5 text-right font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {formatPrice(q.ticket.price)}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
                        style={{ backgroundColor: sc.bg, color: sc.text }}>
                        {statusIcon(q.status)}
                        {statusLabel(q.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {q.status === 'error' && (
                        <button onClick={() => retryPrint(i)}
                          className="text-xs px-2 py-1 rounded-lg border font-medium"
                          style={{ borderColor: '#FBBF24', color: '#D97706', backgroundColor: '#FFFBEB' }}>
                          <RefreshCw className="w-3 h-3 inline mr-1" />
                          Reessayer
                        </button>
                      )}
                      {q.status === 'printed' && (
                        <button onClick={async () => {
                          await printSingleTicket(q.ticket, q.index);
                        }}
                          className="text-xs px-2 py-1 rounded-lg border font-medium"
                          style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                          <Printer className="w-3 h-3 inline mr-1" />
                          Reimprimer
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col sm:flex-row gap-3">
          <button onClick={startNewSale}
            className="flex-1 py-3 rounded-lg border-2 font-bold flex items-center justify-center gap-2"
            style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}>
            <Ticket className="w-4 h-4" />
            Nouvelle vente groupee
          </button>
        </div>

        <button onClick={() => {
          saveCurrentPrintSession();
          navigate('/guichetier/dashboard');
        }}
          className="w-full mt-3 py-2.5 rounded-lg border text-sm font-medium"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
          Retour au tableau de bord
        </button>
      </div>
    );
  };

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto">
      <button onClick={() => step === 'destinations' ? navigate('/guichetier/dashboard') : step === 'sale' ? (releaseAllLocks(), setStep('schedules')) : setStep('destinations')}
        className="flex items-center gap-2 mb-6 text-sm hover:underline"
        style={{ color: 'var(--text-secondary)' }}>
        <ArrowLeft className="w-4 h-4" />
        {step === 'destinations' ? 'Tableau de bord' : step === 'sale' ? 'Retour aux voyages' : 'Retour'}
      </button>

      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
          Vente groupee
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Vendez rapidement plusieurs billets sur les voyages planifies.
        </p>
        {myStationName && (
          <div className="flex items-center gap-1.5 mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            <MapPin className="w-3 h-3" /> {myStationName}
            <span className="mx-1">-</span>
            {format(new Date(), 'EEEE d MMMM yyyy', { locale: fr })}
          </div>
        )}
      </div>

      <div className="rounded-2xl p-4 sm:p-8 border shadow-sm" style={{ backgroundColor: 'var(--surface)' }}>
        {step === 'destinations' && renderDestinations()}
        {step === 'schedules' && renderSchedules()}
        {step === 'sale' && renderSale()}
        {step === 'confirmed' && renderConfirmed()}
      </div>
    </div>
  );
}
