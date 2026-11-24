import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import {
  Luggage, Printer, RefreshCw, Bus, Clock, MapPin, Loader2, CheckCircle2, WifiOff, FileText, ScrollText,
} from 'lucide-react';
import {
  saveRef, getRef, enqueueBaggage, queuedBaggages, flushBaggages, isNetworkFailure,
  saveProvisional, provisionalFor,
} from '@/services/bagagiste/offlineBagages';
import { printDepartureSheets, printEndOfDayBaggage, type DepartureSheet } from '@/utils/printBagagisteSheets';
import { uuidV4 } from '@/utils/uuid';
import {
  printBaggageTicket, generateBaggageNumber, type BaggageTicketData,
} from '../../utils/printBaggageTicket';
import PhoneInputCI from '@/components/shared/PhoneInputCI';
import { phoneCIError } from '@/utils/phoneCI';

interface StationOption {
  id: string;
  name: string;
}

interface DepartureRow {
  id: string;
  route_name: string;
  destination: string;
  departure_datetime: string;
  status: string;
  bus_registration: string;
  departure_order: number | null;
  source: string;
  counter_number?: string;
}

/** A line of the station (offline list): its name and destination */
interface LineOption { id: string; name: string; destination: string }

interface RecentSale {
  id: string;
  baggage_number: string;
  destination: string;
  price: number;
  owner_name: string;
  created_at: string;
  /** Kept on the device, not on the server yet */
  pending?: boolean;
}

type BaggageMode = 'none' | 'avec_ticket' | 'avec_ticket_reporte' | 'sans_ticket';

interface BaggageForm {
  mode: BaggageMode;
  destination: string;
  price: number;
  seat_number: string;
  departure_number: string;
  bus_registration: string;
  description: string;
  owner_name: string;
  owner_phone: string;
}

const EMPTY_FORM: BaggageForm = {
  mode: 'none',
  destination: '',
  price: 0,
  seat_number: '',
  departure_number: '',
  bus_registration: '',
  description: '',
  owner_name: '',
  owner_phone: '',
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  planifie: { label: 'Planifié', color: 'var(--primary)' },
  en_cours: { label: 'En cours', color: 'var(--warning)' },
  embarquement: { label: 'Embarquement', color: 'var(--warning)' },
  retard: { label: 'Retard', color: 'var(--error)' },
  parti: { label: 'Parti', color: 'var(--text-muted)' },
  termine: { label: 'Terminé', color: 'var(--text-muted)' },
  annule: { label: 'Annulé', color: 'var(--error)' },
};

export default function BagagisteBaggageSale() {
  const { user } = useAuthStore();

  const [loading, setLoading] = useState(true);
  const [stations, setStations] = useState<StationOption[]>([]);
  const [stationId, setStationId] = useState<string>('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [departures, setDepartures] = useState<DepartureRow[]>([]);
  const [loadingDepartures, setLoadingDepartures] = useState(false);
  const [selected, setSelected] = useState<DepartureRow | null>(null);
  const [form, setForm] = useState<BaggageForm>(EMPTY_FORM);
  const [processing, setProcessing] = useState(false);
  // The phone error shows at once after a refused save, not only after leaving the field
  const [triedSave, setTriedSave] = useState(false);
  const [recentSales, setRecentSales] = useState<RecentSale[]>([]);
  const [tpeMode, setTpeMode] = useState<'sans_guichet' | 'avec_guichet'>('sans_guichet');
  const [tpeCounterId, setTpeCounterId] = useState<string | null>(null);
  // Without network: everything below is read from the device, the baggage is kept here
  const [online, setOnline] = useState<boolean>(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [lines, setLines] = useState<LineOption[]>([]);
  const [buses, setBuses] = useState<string[]>([]);
  // The departure written on the passenger's ticket: line, number, bus
  const [ticketLine, setTicketLine] = useState('');
  const [ticketNumber, setTicketNumber] = useState('');
  const [ticketBus, setTicketBus] = useState('');

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const stationName = stations.find(s => s.id === stationId)?.name || 'SBTA';
  // The gares the bagagiste is assigned to (the lines offered must leave from one of them)
  const myStationIds = stations.map(s => s.id).sort().join(',');
  const deferredTpe = tpeMode === 'avec_guichet';

  const loadStations = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const cacheKey = `stations:${user.id}`;
    try {
      const { data, error } = await supabase
        .from('station_baggage_handlers')
        .select('station_id, stations:station_id(id, name)')
        .eq('handler_id', user.id);
      if (error) throw error;
      const opts: StationOption[] = (data || [])
        .map((r: any) => r.stations)
        .filter(Boolean)
        .map((s: any) => ({ id: s.id, name: s.name }));
      setStations(opts);
      void saveRef(cacheKey, opts);
      if (opts.length > 0) setStationId(prev => prev || opts[0].id);
    } catch (err: any) {
      // Without network: the stations kept on the device
      const cached = await getRef<StationOption[]>(cacheKey);
      if (cached && cached.length > 0) {
        setStations(cached);
        setStationId(prev => prev || cached[0].id);
      } else {
        toast.error(err.message || 'Erreur de chargement des gares');
      }
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { loadStations(); }, [loadStations]);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('users')
      .select('tpe_pos_enabled, tpe_mode, tpe_counter_id')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.tpe_pos_enabled && data.tpe_mode === 'avec_guichet') {
          setTpeMode('avec_guichet');
          setTpeCounterId(data.tpe_counter_id ?? null);
        }
      });
  }, [user?.id]);

  // The provisional departures (created from a passenger's ticket) not known by the server yet
  const withProvisional = useCallback(async (rows: DepartureRow[]): Promise<DepartureRow[]> => {
    if (!stationId) return rows;
    const known = new Set(rows.map(r => r.departure_order).filter(n => n != null));
    const prov = (await provisionalFor(stationId, date))
      .filter(p => !known.has(p.number))
      .map<DepartureRow>(p => ({
        id: p.key, route_name: p.route_name, destination: p.destination,
        departure_datetime: `${p.date}T00:00:00`, status: 'planifie', bus_registration: p.bus_registration,
        departure_order: p.number, source: 'provisoire',
      }));
    return [...rows, ...prov].sort((a, b) => (a.departure_order ?? 999) - (b.departure_order ?? 999));
  }, [stationId, date]);

  const loadDepartures = useCallback(async () => {
    if (!stationId) { setDepartures([]); return; }
    setLoadingDepartures(true);
    try {
      const dayStart = new Date(date + 'T00:00:00');
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const { data, error } = await supabase
        .from('schedules')
        .select(`
          id, route_name, departure_datetime, status, source, departure_number, route_number, bus_id,
          bus:bus_id(registration_number),
          counter_id,
          arrival_station:arrival_station_id(name)
        `)
        .eq('departure_station_id', stationId)
        .gte('departure_datetime', dayStart.toISOString())
        .lt('departure_datetime', dayEnd.toISOString())
        .order('departure_datetime', { ascending: true });
      if (error) throw error;

      const scheduleIds = (data || []).map((s: any) => s.id);
      const orderMap: Record<string, number> = {};
      if (scheduleIds.length > 0) {
        const { data: depSeq } = await supabase
          .from('departure_sequence')
          .select('schedule_id, departure_order, departure_number')
          .in('schedule_id', scheduleIds);
        (depSeq || []).forEach((d: any) => {
          const num = d.departure_order ?? d.departure_number ?? null;
          if (num != null) orderMap[d.schedule_id] = num;
        });
      }

      const scheduleRows = (data || []) as any[];
      const busIds = scheduleRows.map(s => s.bus_id).filter(Boolean);
      const busMap: Record<string, string> = {};
      if (busIds.length > 0) {
        const { data: buses } = await supabase
          .from('buses')
          .select('id, registration_number')
          .in('id', busIds);
        (buses || []).forEach((b: any) => {
          if (b.registration_number) busMap[b.id] = b.registration_number;
        });
      }

      // The guichet of each departure (for the departure sheets), read apart: schedules has no link
      // declared to counters, and asking it with the departures had the whole request refused
      const counterMap: Record<string, string> = {};
      const counterIds = [...new Set(scheduleRows.map(s => s.counter_id).filter(Boolean))];
      if (counterIds.length > 0) {
        const { data: counters } = await supabase.from('counters').select('id, counter_number').in('id', counterIds);
        (counters || []).forEach((c: any) => { if (c.counter_number) counterMap[c.id] = c.counter_number; });
      }
      const rows: DepartureRow[] = scheduleRows.map((s: any) => {
        const busReg = busMap[s.bus_id]
          || (Array.isArray(s.bus) ? s.bus?.[0]?.registration_number : s.bus?.registration_number)
          || '';
        return {
          id: s.id,
          route_name: s.route_name || '—',
          destination: s.arrival_station?.name || s.route_name || '—',
          departure_datetime: s.departure_datetime,
          status: s.status || 'planifie',
          bus_registration: busReg,
          departure_order: orderMap[s.id] ?? (s.source === 'guichet' ? (s.route_number ?? s.departure_number ?? null) : null),
          source: s.source || 'chef_gare',
          counter_number: (s.counter_id && counterMap[s.counter_id]) || '',
        };
      });
      void saveRef(`deps:${stationId}:${date}`, rows);
      setDepartures(await withProvisional(rows));
    } catch (err: any) {
      // Without network: the departures of that day kept on the device, and the provisional ones
      const cached = await getRef<DepartureRow[]>(`deps:${stationId}:${date}`);
      if (!cached && !isNetworkFailure(err)) toast.error(err.message || 'Erreur de chargement des départs');
      setDepartures(await withProvisional(cached ?? []));
    } finally {
      setLoadingDepartures(false);
    }
  }, [stationId, date, withProvisional]);

  useEffect(() => { loadDepartures(); }, [loadDepartures]);

  // Lines of the station and buses: kept on the device for the offline form
  useEffect(() => {
    if (!stationId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('routes')
          .select('id, name, origin_station_id, destination_city:destination_city_id(name)')
          .order('name');
        if (error) throw error;
        // Only the lines that leave from the bagagiste's own gares (24/11/2026). The lines of the
        // station chosen are those of its guichets and of its departures of the last 30 days, but
        // some guichets of Yopougon also have lines of Adjamé or Abengourou, and departures were
        // created on them: a line whose gare of origin is not one of his gares is never shown.
        // Failing any, the lines whose gare of origin is one of his gares. Never by city (Adjamé
        // and Yopougon are both in Abidjan), never every line of the company.
        const all = (data || []) as any[];
        const myGares = new Set(myStationIds.split(',').filter(Boolean));
        myGares.add(stationId);
        // Most lines of Abidjan have no gare of origin, only the city: the start of the line's name
        // tells it (« Yop - Divo » leaves from Yopougon, « Adjame - Divo » from Adjamé)
        const words = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
          .split(/[^a-z0-9]+/).filter(w => w.length >= 3 && w !== 'gare' && w !== 'sbta');
        const myWords = stations.filter(st => myGares.has(st.id)).map(st => words(st.name)[0]).filter(Boolean);
        const startsFromMyGare = (name: string) => {
          const first = words(String(name || '').split(/\s[-\u2013\u2014]|[-\u2013\u2014]\s/)[0] || '')[0];
          return !!first && myWords.some(w => w.startsWith(first) || first.startsWith(w));
        };
        const fromMyGares = (r: { origin_station_id?: string | null; name?: string }) => r.origin_station_id
          ? myGares.has(String(r.origin_station_id))
          : startsFromMyGare(String(r.name ?? ''));
        const ids = new Set<string>();
        const { data: counters } = await supabase.from('counters').select('id').eq('station_id', stationId);
        const counterIds = ((counters || []) as any[]).map(c => c.id);
        if (counterIds.length > 0) {
          const { data: cr } = await supabase.from('counter_routes').select('route_id').in('counter_id', counterIds);
          ((cr || []) as any[]).forEach(r => ids.add(String(r.route_id)));
        }
        const { data: deps } = await supabase.from('schedules').select('route_id').eq('departure_station_id', stationId)
          .gte('departure_datetime', new Date(Date.now() - 30 * 86400_000).toISOString()).limit(1000);
        ((deps || []) as any[]).forEach(d => { if (d.route_id) ids.add(String(d.route_id)); });
        let mine = all.filter(r => ids.has(String(r.id)) && fromMyGares(r));
        if (mine.length === 0) mine = all.filter(fromMyGares);
        const list: LineOption[] = mine.map(r => ({
          id: r.id, name: r.name,
          destination: ((Array.isArray(r.destination_city) ? r.destination_city[0]?.name : r.destination_city?.name) || '').toUpperCase(),
        }));
        const { data: busRows } = await supabase.from('buses').select('registration_number').order('registration_number');
        const busList = ((busRows || []) as any[]).map(b => String(b.registration_number || '').trim()).filter(Boolean);
        if (cancelled) return;
        setLines(list); setBuses(busList);
        void saveRef(`lines:${stationId}`, list);
        if (busList.length > 0) void saveRef('buses', busList);
      } catch {
        const [l, b] = await Promise.all([getRef<LineOption[]>(`lines:${stationId}`), getRef<string[]>('buses')]);
        if (cancelled) return;
        setLines(l ?? []); setBuses(b ?? []);
      }
    })();
    return () => { cancelled = true; };
  }, [stationId, myStationIds, stations, online]);

  const loadRecentSales = useCallback(async () => {
    if (!user?.id) return;
    const dayStart = new Date(date + 'T00:00:00');
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const cacheKey = `sales:${user.id}:${date}`;
    let server: RecentSale[] = [];
    const { data, error } = await supabase
      .from('baggage_tickets')
      .select('id, baggage_number, destination, price, owner_name, created_at')
      .eq('sold_by', user.id)
      .gte('created_at', dayStart.toISOString())
      .lt('created_at', dayEnd.toISOString())
      .order('created_at', { ascending: false });
    if (!error && data) { server = data as RecentSale[]; void saveRef(cacheKey, server); }
    else server = (await getRef<RecentSale[]>(cacheKey)) ?? [];
    // The baggage of that day still on the device
    const known = new Set(server.map(r => r.id));
    const queued = (await queuedBaggages())
      .map(q => q.row as any)
      .filter(r => r.sold_by === user.id && String(r.created_at ?? '').slice(0, 10) === date && !known.has(r.id))
      .map<RecentSale>(r => ({ id: r.id, baggage_number: r.baggage_number, destination: r.destination, price: r.price, owner_name: r.owner_name, created_at: r.created_at, pending: true }));
    setPendingCount((await queuedBaggages()).length);
    setRecentSales([...queued, ...server]);
  }, [user?.id, date]);

  // Baggage kept on the device: sent when the network is back, then every 30 s while some are left
  useEffect(() => {
    let stop = false;
    const run = async () => {
      const before = (await queuedBaggages()).length;
      if (before > 0 && navigator.onLine) {
        const res = await flushBaggages();
        if (!stop && res.sent > 0) { toast.success(`${res.sent} bagage(s) enregistré(s) hors ligne envoyé(s) au serveur`); void loadRecentSales(); }
      }
      if (!stop) setPendingCount((await queuedBaggages()).length);
    };
    void run();
    const timer = setInterval(run, 30_000);
    return () => { stop = true; clearInterval(timer); };
  }, [online, loadRecentSales]);

  useEffect(() => { loadRecentSales(); }, [loadRecentSales]);

  const selectDeparture = (dep: DepartureRow) => {
    setSelected(dep);
    setForm({
      ...EMPTY_FORM,
      bus_registration: dep.bus_registration,
      departure_number: dep.departure_order != null ? String(dep.departure_order) : '',
      destination: dep.destination,
    });
  };

  const switchMode = (mode: BaggageMode) => {
    if (mode === 'none' || !selected) {
      setForm(prev => ({
        ...prev,
        mode: 'none',
        destination: '',
        seat_number: '',
        bus_registration: '',
        departure_number: '',
      }));
      return;
    }
    setForm(prev => ({
      ...prev,
      mode,
      destination: selected.destination,
      bus_registration: selected.bus_registration,
      departure_number: selected.departure_order != null ? String(selected.departure_order) : prev.departure_number,
      seat_number: mode === 'sans_ticket' ? '' : prev.seat_number,
    }));
  };

  const depLabel = (dep: DepartureRow) =>
    dep.departure_order != null ? `Départ ${dep.departure_order}` : 'Départ';

  // The departure written on the passenger's ticket: the known departure of that number, otherwise a
  // provisional one (kept on the device), where the next passengers of the same number go too
  const ticketNumberValue = parseInt(ticketNumber, 10);
  const ticketDepartureKnown = Number.isFinite(ticketNumberValue)
    && departures.some(d => d.departure_order === ticketNumberValue);
  const applyTicketDeparture = async () => {
    const n = ticketNumberValue;
    if (!Number.isFinite(n) || n <= 0) { toast.error('Saisissez le N° de départ écrit sur le ticket'); return; }
    const found = departures.find(d => d.departure_order === n);
    if (found) { selectDeparture(found); return; }
    const line = lines.find(l => l.id === ticketLine);
    if (!line) { toast.error('Choisissez la ligne écrite sur le ticket'); return; }
    const key = `prov:${stationId}:${date}:${n}`;
    await saveProvisional({
      key, station_id: stationId, date, number: n, route_name: line.name,
      destination: line.destination, bus_registration: ticketBus, created_at: new Date().toISOString(),
    });
    const dep: DepartureRow = {
      id: key, route_name: line.name, destination: line.destination, departure_datetime: `${date}T00:00:00`,
      status: 'planifie', bus_registration: ticketBus, departure_order: n, source: 'provisoire',
    };
    setDepartures(prev => [...prev.filter(d => d.id !== key), dep].sort((a, b) => (a.departure_order ?? 999) - (b.departure_order ?? 999)));
    selectDeparture(dep);
    toast.success(`Départ ${n} créé comme départ provisoire : les passagers suivants du N°${n} iront dessus`);
  };

  // One sheet per departure: the baggage of the station for that day (server + kept on the device)
  const handleSheets = async () => {
    type Row = { id: string; baggage_number: string; schedule_id: string | null; departure_number: number | null; bus_registration: string | null; destination: string; seat_number: string | null; owner_name: string; price: number };
    const dayStart = new Date(date + 'T00:00:00');
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
    const cacheKey = `sheet:${stationId}:${date}`;
    let server: Row[] = [];
    const { data, error } = await supabase
      .from('baggage_tickets')
      .select('id, baggage_number, schedule_id, departure_number, bus_registration, destination, seat_number, owner_name, price')
      .eq('station_id', stationId)
      .gte('created_at', dayStart.toISOString())
      .lt('created_at', dayEnd.toISOString());
    if (!error && data) { server = data as Row[]; void saveRef(cacheKey, server); }
    else server = (await getRef<Row[]>(cacheKey)) ?? [];
    const known = new Set(server.map(r => r.id));
    const queued = (await queuedBaggages()).map(q => q.row as unknown as Row & { station_id: string; created_at: string })
      .filter(r => r.station_id === stationId && String(r.created_at).slice(0, 10) === date && !known.has(r.id));
    const all = [...server, ...queued];
    if (all.length === 0) { toast.error('Aucun bagage pour cette date'); return; }
    const groups = new Map<string, { dep: DepartureRow | undefined; num: number | null; rows: Row[] }>();
    for (const r of all) {
      const dep = departures.find(d => d.id === r.schedule_id) ?? departures.find(d => r.departure_number != null && d.departure_order === r.departure_number);
      const key = dep?.id ?? `n:${r.departure_number ?? '?'}`;
      const g = groups.get(key) ?? { dep, num: dep?.departure_order ?? r.departure_number, rows: [] };
      g.rows.push(r);
      groups.set(key, g);
    }
    const sheets: DepartureSheet[] = [...groups.values()]
      .sort((a, b) => (a.num ?? 999) - (b.num ?? 999))
      .map(g => ({
        number: g.num,
        route_name: g.dep?.route_name ?? '',
        destination: g.dep?.destination ?? g.rows[0]?.destination ?? '',
        bus_registration: g.dep?.bus_registration || g.rows.find(r => r.bus_registration)?.bus_registration || '',
        counter_number: g.dep?.counter_number ?? '',
        provisional: !g.dep || g.dep.source === 'provisoire',
        baggages: g.rows.map(r => ({ baggage_number: r.baggage_number, destination: r.destination, seat_number: r.seat_number, owner_name: r.owner_name, price: Number(r.price) || 0 })),
      }));
    if (!printDepartureSheets({ sheets, stationName, date, bagagiste: user?.full_name ?? '' })) {
      toast.error('Autorisez les fenêtres pop-up pour imprimer');
    }
  };

  // End of the day: the bagagiste's baggage of that day (server + kept on the device)
  const handleEndOfDay = () => {
    const amount = recentSales.reduce((sum, r) => sum + (Number(r.price) || 0), 0);
    if (!printEndOfDayBaggage({ date, bagagiste: user?.full_name ?? '', stationName, count: recentSales.length, amount })) {
      toast.error('Autorisez les fenêtres pop-up pour imprimer');
    }
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setTriedSave(false);
  };

  const handleSave = async () => {
    if (!selected) {
      toast.error('Sélectionnez un départ planifié');
      return;
    }
    if (form.mode === 'none') {
      toast.error('Choisissez le type de bagage (avec ticket, reporté ou sans siège)');
      return;
    }
    if (!form.owner_name.trim() || !form.owner_phone.trim() || !form.destination.trim()) {
      toast.error('Remplissez au minimum : propriétaire, contact et destination');
      return;
    }
    // Côte d'Ivoire number of 10 digits (01, 05, 07, 21, 25, 27): « 0 » or 3 digits were accepted
    const phoneError = phoneCIError(form.owner_phone, true);
    if (phoneError) {
      setTriedSave(true);
      toast.error(`Contact : ${phoneError}`);
      return;
    }
    if (form.price <= 0) {
      toast.error('Le prix du bagage doit être supérieur à 0');
      return;
    }
    if ((form.mode === 'avec_ticket' || form.mode === 'avec_ticket_reporte') && !form.seat_number.trim()) {
      toast.error('Saisissez le numéro de siège pour un bagage avec ticket');
      return;
    }

    setProcessing(true);
    try {
      const baggageNumber = generateBaggageNumber();
      const departureNumber = form.departure_number ? parseInt(form.departure_number) : null;
      const modeLabel = form.mode === 'avec_ticket' ? 'Avec ticket'
        : form.mode === 'avec_ticket_reporte' ? 'Avec ticket reporte'
        : 'Sans siege';

      // The baggage is saved on the device first when there is no network (or the server does not
      // answer): printed at once, sent later. A provisional departure has no server id: the server
      // links the baggage by station, day and departure number.
      const row: Record<string, unknown> = {
          id: uuidV4(),
          created_at: new Date().toISOString(),
          baggage_number: baggageNumber,
          schedule_id: selected.source === 'provisoire' ? null : selected.id,
          reservation_id: null,
          destination: form.destination.trim(),
          price: form.price,
          seat_number: form.mode === 'sans_ticket' ? null : (form.seat_number.trim() || null),
          departure_number: departureNumber,
          bus_registration: form.bus_registration.trim() || null,
          description: form.description.trim() || null,
          owner_name: form.owner_name.trim(),
          owner_phone: form.owner_phone.trim(),
          has_ticket: form.mode === 'avec_ticket' || form.mode === 'avec_ticket_reporte',
          counter_id: deferredTpe ? tpeCounterId : null,
          station_id: stationId,
          sold_by: user!.id,
          payment_status: deferredTpe ? 'en_attente' : 'paye',
        };
      let keptOnDevice = false;
      if (navigator.onLine) {
        const { error } = await supabase.from('baggage_tickets').insert(row);
        if (error) {
          if (!isNetworkFailure(error)) throw error;
          await enqueueBaggage(row);
          keptOnDevice = true;
        }
      } else {
        await enqueueBaggage(row);
        keptOnDevice = true;
      }

      const ticketData: BaggageTicketData = {
        baggage_number: baggageNumber,
        destination: form.destination,
        price: form.price,
        seat_number: form.mode === 'sans_ticket' ? null : (form.seat_number || null),
        departure_number: departureNumber,
        bus_registration: form.bus_registration || null,
        description: form.description || null,
        owner_name: form.owner_name,
        owner_phone: form.owner_phone,
        station_name: stationName,
        mode_label: modeLabel,
      };

      printBaggageTicket(ticketData);
      toast.success(keptOnDevice
        ? 'Ticket bagage imprimé — enregistré sur le poste, envoyé dès le retour d\'Internet'
        : deferredTpe
          ? 'Bagage enregistré — paiement à confirmer au guichet'
          : 'Ticket bagage imprimé');
      resetForm();
      loadRecentSales();
    } catch (err: any) {
      console.error('Erreur sauvegarde bagage:', err);
      toast.error(err.message || 'Erreur lors de la sauvegarde du bagage');
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <div
          className="w-8 h-8 border-4 rounded-full animate-spin"
          style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }}
        />
      </div>
    );
  }

  if (stations.length === 0) {
    return (
      <div className="p-8">
        <div
          className="rounded-2xl border shadow-sm px-6 py-12 text-center max-w-xl mx-auto"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <Luggage className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
            Aucune gare affectée
          </h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Vous n'êtes affecté à aucune gare pour le moment. Demandez à votre chef de gare de vous
            affecter afin de vendre des tickets bagages.
          </p>
        </div>
      </div>
    );
  }

  const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' };
  const lockedBg = 'var(--neutral-50)';

  return (
    <div className="p-6 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Luggage className="w-7 h-7" style={{ color: 'var(--primary)' }} /> Vente de bagages
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Sélectionnez un départ planifié puis enregistrez le ticket bagage
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {stations.length > 1 && (
            <select
              value={stationId}
              onChange={e => { setStationId(e.target.value); setSelected(null); }}
              className="px-4 py-2.5 rounded-lg border text-sm font-medium"
              style={inputStyle}
            >
              {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <input
            type="date"
            value={date}
            onChange={e => { setDate(e.target.value); setSelected(null); }}
            className="px-4 py-2.5 rounded-lg border text-sm font-medium"
            style={inputStyle}
          />
          <button
            onClick={() => void handleSheets()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 text-sm font-semibold"
            style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}
            title="Une feuille par départ : ses bagages classés par destination"
          >
            <FileText className="w-4 h-4" /> Feuilles par départ
          </button>
          <button
            onClick={handleEndOfDay}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 text-sm font-semibold"
            style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}
            title="Nombre de bagages et montant de la journée"
          >
            <ScrollText className="w-4 h-4" /> Bordereau fin de caisse
          </button>
          <button
            onClick={() => { loadDepartures(); loadRecentSales(); }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            <RefreshCw className="w-4 h-4" /> Rafraîchir
          </button>
        </div>
      </div>

      {(!online || pendingCount > 0) && (
        <div role="status" className="mb-5 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
          style={{ backgroundColor: !online ? '#F59E0B' : 'var(--warning-light, #FEF3C7)', color: !online ? '#fff' : 'var(--warning, #B45309)' }}>
          <WifiOff className="w-4 h-4 flex-shrink-0" />
          {!online
            ? `Hors ligne — les bagages sont enregistrés sur ce poste${pendingCount > 0 ? ` · ${pendingCount} bagage(s) pas encore envoyé(s), ils partiront dès le retour d'Internet` : ''}`
            : `${pendingCount} bagage(s) enregistré(s) hors ligne en cours d'envoi au serveur`}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Departures list */}
        <div className="lg:col-span-2">
          <div
            className="rounded-2xl border shadow-sm overflow-hidden"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <Bus className="w-5 h-5" style={{ color: 'var(--primary)' }} />
              <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                Départs planifiés ({departures.length})
              </h2>
            </div>

            {loadingDepartures ? (
              <div className="py-12 flex justify-center">
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--primary)' }} />
              </div>
            ) : departures.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <Clock className="w-9 h-9 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Aucun départ planifié pour cette date.
                </p>
              </div>
            ) : (
              <ul className="divide-y max-h-[70vh] overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
                {departures.map(dep => {
                  const isSel = selected?.id === dep.id;
                  const st = STATUS_LABELS[dep.status] || { label: dep.status, color: 'var(--text-muted)' };
                  return (
                    <li key={dep.id}>
                      <button
                        onClick={() => selectDeparture(dep)}
                        className="w-full text-left px-5 py-4 transition-colors"
                        style={{ backgroundColor: isSel ? 'var(--primary)12' : 'transparent' }}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="flex-shrink-0 inline-flex items-center justify-center px-2.5 py-1 rounded-lg text-sm font-black"
                              style={{
                                backgroundColor: isSel ? 'var(--primary)' : 'var(--primary)1A',
                                color: isSel ? '#fff' : 'var(--primary)',
                              }}
                            >
                              {depLabel(dep)}
                            </span>
                            {dep.source === 'provisoire' && (
                              <span className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: '#FEF3C7', color: '#B45309' }} title="Créé depuis le ticket d'un voyageur : relié au départ du guichet de même numéro dès que possible">
                                PROVISOIRE
                              </span>
                            )}
                            <span className="font-semibold text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                              {dep.route_name}
                            </span>
                          </div>
                          <span
                            className="flex-shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full"
                            style={{ backgroundColor: `${st.color}1A`, color: st.color }}
                          >
                            {st.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 mt-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            {format(new Date(dep.departure_datetime), 'HH:mm')}
                          </span>
                          {dep.bus_registration && (
                            <span className="flex items-center gap-1">
                              <Bus className="w-3.5 h-3.5" /> {dep.bus_registration}
                            </span>
                          )}
                          <span className="truncate">→ {dep.destination}</span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {recentSales.length > 0 && (
            <div
              className="rounded-2xl border shadow-sm overflow-hidden mt-6"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
                <CheckCircle2 className="w-5 h-5" style={{ color: 'var(--success)' }} />
                <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Mes ventes du jour ({recentSales.length}) — {recentSales.reduce((sum, r) => sum + (Number(r.price) || 0), 0).toLocaleString('fr-FR')} F
                </h2>
              </div>
              <ul className="divide-y max-h-64 overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
                {recentSales.map(s => (
                  <li key={s.id} className="flex items-center justify-between px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                        {s.owner_name} — {s.destination}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {format(new Date(s.created_at), 'HH:mm')} · {s.baggage_number}
                        {s.pending && <span className="ml-1 font-semibold" style={{ color: 'var(--warning, #B45309)' }}>· sur le poste, pas encore envoyé</span>}
                      </p>
                    </div>
                    <span className="text-sm font-semibold whitespace-nowrap" style={{ color: 'var(--primary)' }}>
                      {s.price.toLocaleString('fr-FR')} F
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Baggage form */}
        <div className="lg:col-span-3">
          <div
            className="rounded-2xl border shadow-sm p-6"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            {/* The departure written on the passenger's ticket (also without network) */}
            <div className="mb-5 pb-5 border-b" style={{ borderColor: 'var(--border)' }}>
              <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Départ du ticket voyageur</p>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Ligne</label>
                  <select value={ticketLine} onChange={e => setTicketLine(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-sm" style={inputStyle}>
                    <option value="">{lines.length > 0 ? 'Choisir la ligne…' : 'Aucune ligne gardée sur ce poste'}</option>
                    {lines.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>N° de départ (ticket)</label>
                  <input type="number" min={1} inputMode="numeric" value={ticketNumber} onChange={e => setTicketNumber(e.target.value)} placeholder="Ex : 5" className="w-full px-3 py-2 rounded-lg border text-sm" style={inputStyle} />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Car</label>
                  <select value={ticketBus} onChange={e => setTicketBus(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-sm" style={inputStyle}>
                    <option value="">—</option>
                    {buses.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
                <p className="text-xs font-semibold" style={{ color: ticketDepartureKnown ? 'var(--success)' : 'var(--warning, #B45309)' }}>
                  {!Number.isFinite(ticketNumberValue) ? 'Ou cliquez sur un départ dans la liste.'
                    : ticketDepartureKnown ? `Départ ${ticketNumberValue} trouvé.`
                    : `Départ ${ticketNumberValue} pas encore connu : il sera créé comme départ provisoire, les passagers suivants du N°${ticketNumberValue} iront dessus.`}
                </p>
                <button type="button" onClick={() => void applyTicketDeparture()} className="px-4 py-2 rounded-lg text-sm font-bold text-white" style={{ backgroundColor: 'var(--primary)' }}>
                  Utiliser ce départ
                </button>
              </div>
            </div>

            {!selected ? (
              <div className="py-10 text-center">
                <MapPin className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Choisissez le départ du ticket ci-dessus, ou un départ dans la liste, pour vendre un ticket bagage.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-5 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Départ sélectionné</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className="inline-flex items-center justify-center px-3 py-1 rounded-lg text-base font-black"
                        style={{ backgroundColor: 'var(--primary)', color: '#fff' }}
                      >
                        {depLabel(selected)}
                      </span>
                      <span className="text-lg font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                        {selected.route_name}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {format(new Date(selected.departure_datetime), 'HH:mm')}
                      </span>
                      {selected.bus_registration && (
                        <span className="flex items-center gap-1">
                          <Bus className="w-3.5 h-3.5" /> {selected.bus_registration}
                        </span>
                      )}
                      <span>→ {selected.destination}</span>
                    </div>
                  </div>
                  <Luggage className="w-9 h-9 flex-shrink-0" style={{ color: 'var(--primary)' }} />
                </div>

                {/* Mode selection */}
                <div className="flex flex-wrap gap-4 mb-5">
                  {([
                    { value: 'avec_ticket' as BaggageMode, label: 'Avec ticket' },
                    { value: 'avec_ticket_reporte' as BaggageMode, label: 'Avec ticket reporté' },
                    { value: 'sans_ticket' as BaggageMode, label: 'Sans siège' },
                  ]).map(opt => (
                    <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        checked={form.mode === opt.value}
                        onChange={() => switchMode(form.mode === opt.value ? 'none' : opt.value)}
                        className="w-4 h-4"
                        style={{ accentColor: 'var(--primary)' }}
                      />
                      <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{opt.label}</span>
                    </label>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Destination *</label>
                    <input
                      type="text"
                      value={form.destination}
                      onChange={e => setForm({ ...form, destination: e.target.value.toUpperCase() })}
                      readOnly={form.mode !== 'none'}
                      className="w-full px-3 py-2 rounded-lg border text-sm"
                      style={{ ...inputStyle, backgroundColor: form.mode !== 'none' ? lockedBg : 'var(--surface)' }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Prix (F) *</label>
                    <input
                      type="number"
                      min={0}
                      value={form.price || ''}
                      onChange={e => setForm({ ...form, price: parseInt(e.target.value) || 0 })}
                      className="w-full px-3 py-2 rounded-lg border text-sm"
                      style={inputStyle}
                    />
                  </div>

                  {form.mode === 'sans_ticket' ? (
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>N° départ</label>
                      <input
                        type="text"
                        value={form.departure_number}
                        onChange={e => setForm({ ...form, departure_number: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border text-sm"
                        style={inputStyle}
                      />
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Siège</label>
                        <input
                          type="text"
                          value={form.seat_number}
                          onChange={e => setForm({ ...form, seat_number: e.target.value.toUpperCase() })}
                          placeholder="Ex: 12 ou 12, 13"
                          className="w-full px-3 py-2 rounded-lg border text-sm"
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>N° départ</label>
                        <input
                          type="text"
                          value={form.departure_number}
                          onChange={e => setForm({ ...form, departure_number: e.target.value })}
                          className="w-full px-3 py-2 rounded-lg border text-sm"
                          style={inputStyle}
                        />
                      </div>
                    </>
                  )}

                  <div className={form.mode === 'sans_ticket' ? '' : 'sm:col-span-2'}>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Car / Immatriculation</label>
                    <input
                      type="text"
                      value={form.bus_registration}
                      readOnly
                      className="w-full px-3 py-2 rounded-lg border text-sm font-medium"
                      style={{ ...inputStyle, backgroundColor: lockedBg }}
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Description du bagage</label>
                    <input
                      type="text"
                      value={form.description}
                      onChange={e => setForm({ ...form, description: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border text-sm"
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Propriétaire *</label>
                    <input
                      type="text"
                      value={form.owner_name}
                      onChange={e => setForm({ ...form, owner_name: e.target.value.toUpperCase() })}
                      className="w-full px-3 py-2 rounded-lg border text-sm"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Contact *</label>
                    <PhoneInputCI
                      value={form.owner_phone}
                      onChange={national => setForm({ ...form, owner_phone: national })}
                      required
                      showError={triedSave}
                      className="w-full px-3 py-2 rounded-lg border text-sm"
                      style={inputStyle}
                    />
                  </div>
                </div>

                <button
                  onClick={handleSave}
                  disabled={processing || form.mode === 'none'}
                  className="mt-6 w-full flex items-center justify-center gap-2 py-3 rounded-lg font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: 'var(--primary)' }}
                >
                  {processing ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Traitement…</>
                  ) : (
                    <><Printer className="w-4 h-4" /> Imprimer ticket bagage</>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
