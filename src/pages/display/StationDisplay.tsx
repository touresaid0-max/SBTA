import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../../services/supabase';
import { format, addMinutes, differenceInMinutes } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Clock, Wifi, WifiOff, Bus, User, Navigation, AlertTriangle,
  Maximize2, Minimize2, Printer, X, Users, MapPin, RefreshCw,
  ChevronLeft, ChevronRight, CheckCircle, AlertCircle,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

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
  seats_available: number;
  seats_reserved: number;
  bus_capacity: number;
  fill_rate: number | null;
  bus_registration: string;
  bus_model: string;
  driver_name: string;
  driver_phone: string;
  copilot_name: string;
  departure_station_name: string;
  arrival_station_name: string;
  notes: string;
  transit_stops: TransitStop[];
}

// ─── Status config ─────────────────────────────────────────────────────────────

type StatusKey = 'planifie' | 'ouvert' | 'embarquement' | 'imminent' | 'en_cours' | 'termine' | 'retard' | 'annule' | 'complet';

const STATUS_CFG: Record<StatusKey, { label: string; color: string; bg: string; dot: string; pulse?: boolean; icon: React.ReactNode }> = {
  planifie:     { label: 'PLANIFIE',         color: '#1D4ED8', bg: 'rgba(29,78,216,0.13)',   dot: '#3B82F6', icon: <Clock className="w-4 h-4" /> },
  ouvert:       { label: 'OUVERT',           color: '#0369A1', bg: 'rgba(3,105,161,0.13)',   dot: '#0EA5E9', icon: <CheckCircle className="w-4 h-4" /> },
  embarquement: { label: 'EMBARQUEMENT',     color: '#C2410C', bg: 'rgba(234,88,12,0.14)',   dot: '#F97316', pulse: true, icon: <AlertTriangle className="w-4 h-4" /> },
  imminent:     { label: 'DEPART IMMINENT',  color: '#A16207', bg: 'rgba(234,179,8,0.18)',   dot: '#EAB308', pulse: true, icon: <Navigation className="w-4 h-4" /> },
  en_cours:     { label: 'EMBARQUEMENT',     color: '#C2410C', bg: 'rgba(234,88,12,0.14)',   dot: '#F97316', pulse: true, icon: <AlertTriangle className="w-4 h-4" /> },
  retard:       { label: 'RETARDE',          color: '#9A3412', bg: 'rgba(154,52,18,0.15)',   dot: '#F97316', pulse: true, icon: <AlertCircle className="w-4 h-4" /> },
  annule:       { label: 'ANNULE',           color: '#B91C1C', bg: 'rgba(185,28,28,0.13)',   dot: '#EF4444', icon: <X className="w-4 h-4" /> },
  complet:      { label: 'COMPLET',          color: '#6D28D9', bg: 'rgba(109,40,217,0.12)',  dot: '#8B5CF6', icon: <Users className="w-4 h-4" /> },
  termine:      { label: 'PARTI',            color: '#4B5563', bg: 'rgba(75,85,99,0.10)',    dot: '#9CA3AF', icon: <CheckCircle className="w-4 h-4" /> },
};

// ─── Theme ─────────────────────────────────────────────────────────────────────

const NIGHT = {
  bg: '#040810', surface: '#0D1424', surface2: '#131D30', border: '#1E2D45',
  text: '#F1F5F9', text2: '#94A3B8', text3: '#4B6280', green: '#0EBF6B', header: '#070E1C',
};
const DAY = {
  bg: '#EEF2F7', surface: '#FFFFFF', surface2: '#F5F8FA', border: '#D8E3EE',
  text: '#0A1628', text2: '#3D5573', text3: '#8FA3BE', green: '#0B7439', header: '#FFFFFF',
};

const ROWS_PER_PAGE = 9;
const PAGE_MS = 9000;
const REFRESH_MS = 30_000;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function computeEffectiveStatus(row: ScheduleRow, now: Date): StatusKey {
  const dep = new Date(row.departure_datetime);
  const minsUntil = differenceInMinutes(dep, now);
  const capacity = row.bus_capacity;

  // Manual overrides from Chef de Gare always take priority
  if (row.status === 'annule') return 'annule';
  if (row.status === 'termine') return 'termine';
  if (row.status === 'retard') return 'retard';

  // Bus full
  if (capacity > 0 && row.seats_available === 0 && minsUntil > 0) return 'complet';

  // Time-based automatic progression
  if (minsUntil <= 0) return 'termine';        // At/past departure = Parti
  if (minsUntil <= 10) return 'imminent';       // 10 min before = Depart imminent
  if (minsUntil <= 30) return 'embarquement';   // 30 min before = Embarquement
  return 'planifie';
}

function formatDuration(dep: string, arr: string): string {
  const mins = differenceInMinutes(new Date(arr), new Date(dep));
  if (mins <= 0) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h${m > 0 ? m.toString().padStart(2, '0') : ''}` : `${m}min`;
}

// ─── Detail Modal ──────────────────────────────────────────────────────────────

function DetailModal({ row, now, theme, onClose }: {
  row: ScheduleRow; now: Date;
  theme: typeof DAY; onClose: () => void;
}) {
  const status = computeEffectiveStatus(row, now);
  const cfg = STATUS_CFG[status] || STATUS_CFG.planifie;
  const fillPct = row.bus_capacity > 0 ? Math.round(((row.seats_reserved) / row.bus_capacity) * 100) : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl overflow-hidden shadow-2xl"
        style={{ backgroundColor: theme.surface, border: `1.5px solid ${theme.border}` }}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: theme.border, backgroundColor: theme.surface2 }}>
          <div>
            <p className="text-xs font-black uppercase tracking-widest mb-1" style={{ color: theme.text3 }}>DÉTAIL DU VOYAGE</p>
            <h2 className="text-2xl font-black" style={{ color: theme.text }}>
              {format(new Date(row.departure_datetime), 'HH:mm')} &rarr; {row.arrival_station_name}
            </h2>
            <p className="text-sm mt-0.5 font-medium" style={{ color: theme.text2 }}>{row.route_name}</p>
          </div>
          <div className="flex items-center gap-3">
            <div
              className={`px-4 py-2 rounded-xl font-black text-sm inline-flex items-center gap-1.5 ${cfg.pulse ? 'animate-pulse' : ''}`}
              style={{ backgroundColor: cfg.bg, color: cfg.color }}
            >
              {cfg.icon}{cfg.label}
            </div>
            <button onClick={onClose} className="p-2 rounded-xl hover:opacity-70 transition-opacity" style={{ color: theme.text3 }}>
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Times */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl p-4" style={{ backgroundColor: theme.surface2, border: `1px solid ${theme.border}` }}>
              <p className="text-xs font-black uppercase tracking-wider mb-1" style={{ color: theme.text3 }}>DÉPART</p>
              <p className="text-3xl font-black tabular-nums" style={{ color: theme.green }}>
                {format(new Date(row.departure_datetime), 'HH:mm')}
              </p>
              <p className="text-sm font-medium mt-0.5" style={{ color: theme.text2 }}>{row.departure_station_name}</p>
            </div>
            <div className="rounded-xl p-4" style={{ backgroundColor: theme.surface2, border: `1px solid ${theme.border}` }}>
              <p className="text-xs font-black uppercase tracking-wider mb-1" style={{ color: theme.text3 }}>ARRIVÉE PRÉVUE</p>
              <p className="text-3xl font-black tabular-nums" style={{ color: theme.text }}>
                {format(new Date(row.arrival_datetime), 'HH:mm')}
              </p>
              <p className="text-sm font-medium mt-0.5" style={{ color: theme.text2 }}>
                {row.arrival_station_name} &bull; {formatDuration(row.departure_datetime, row.arrival_datetime)}
              </p>
            </div>
          </div>

          {/* Bus & Driver */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl p-4" style={{ backgroundColor: theme.surface2, border: `1px solid ${theme.border}` }}>
              <p className="text-xs font-black uppercase tracking-wider mb-2" style={{ color: theme.text3 }}>BUS</p>
              <div className="flex items-center gap-2">
                <Bus className="w-5 h-5 flex-shrink-0" style={{ color: theme.text3 }} />
                <p className="text-xl font-black" style={{ color: theme.text }}>{row.bus_registration || '—'}</p>
              </div>
              {row.bus_model && <p className="text-sm mt-1" style={{ color: theme.text2 }}>{row.bus_model}</p>}
              <p className="text-sm mt-0.5" style={{ color: theme.text2 }}>Capacité : {row.bus_capacity} places</p>
            </div>
            <div className="rounded-xl p-4" style={{ backgroundColor: theme.surface2, border: `1px solid ${theme.border}` }}>
              <p className="text-xs font-black uppercase tracking-wider mb-2" style={{ color: theme.text3 }}>CHAUFFEUR</p>
              <div className="flex items-center gap-2">
                <User className="w-5 h-5 flex-shrink-0" style={{ color: theme.text3 }} />
                <p className="text-base font-bold truncate" style={{ color: theme.text }}>{row.driver_name || '—'}</p>
              </div>
              {row.copilot_name && (
                <p className="text-sm mt-1" style={{ color: theme.text2 }}>Copilote : {row.copilot_name}</p>
              )}
            </div>
          </div>

          {/* Seats */}
          <div className="rounded-xl p-4" style={{ backgroundColor: theme.surface2, border: `1px solid ${theme.border}` }}>
            <p className="text-xs font-black uppercase tracking-wider mb-3" style={{ color: theme.text3 }}>OCCUPATION</p>
            <div className="flex items-center gap-6">
              <div className="flex-1">
                <div className="flex justify-between text-sm font-semibold mb-1.5" style={{ color: theme.text2 }}>
                  <span>{row.seats_reserved} billets vendus</span>
                  <span>{row.seats_available} places libres</span>
                </div>
                <div className="w-full h-4 rounded-full overflow-hidden" style={{ backgroundColor: theme.border }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(fillPct, 100)}%`,
                      backgroundColor: fillPct >= 90 ? '#EF4444' : fillPct >= 70 ? '#F59E0B' : theme.green,
                    }}
                  />
                </div>
                <p className="text-xs mt-1 font-medium" style={{ color: theme.text3 }}>{fillPct}% occupé</p>
              </div>
              <div className="text-center flex-shrink-0">
                <p className="text-4xl font-black tabular-nums" style={{ color: fillPct >= 90 ? '#EF4444' : theme.green }}>
                  {row.seats_available}
                </p>
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: theme.text3 }}>LIBRES</p>
              </div>
            </div>
          </div>

          {/* Transit stops */}
          {row.transit_stops.length > 0 && (
            <div className="rounded-xl p-4" style={{ backgroundColor: theme.surface2, border: `1px solid ${theme.border}` }}>
              <p className="text-xs font-black uppercase tracking-wider mb-3" style={{ color: theme.text3 }}>ARRÊTS INTERMÉDIAIRES</p>
              <div className="flex flex-wrap gap-2">
                {row.transit_stops.map((t, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ backgroundColor: theme.surface, border: `1px solid ${theme.border}` }}>
                    <MapPin className="w-3.5 h-3.5 flex-shrink-0" style={{ color: theme.text3 }} />
                    <span className="text-sm font-semibold" style={{ color: theme.text }}>{t.station_name}</span>
                    <span className="text-sm font-black tabular-nums" style={{ color: theme.green }}>
                      {format(addMinutes(new Date(row.departure_datetime), t.arrival_offset_minutes), 'HH:mm')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          {row.notes && (
            <div className="rounded-xl p-4" style={{ backgroundColor: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)' }}>
              <p className="text-xs font-black uppercase tracking-wider mb-1" style={{ color: '#B45309' }}>OBSERVATION</p>
              <p className="text-sm font-medium" style={{ color: '#92400E' }}>{row.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Print helper ──────────────────────────────────────────────────────────────

function printDepartures(rows: ScheduleRow[], stationName: string, now: Date) {
  const html = `
    <!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>Départs — ${stationName}</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 11px; margin: 20px; }
      h1 { font-size: 18px; margin-bottom: 4px; }
      p.sub { color: #666; margin-bottom: 16px; }
      table { width: 100%; border-collapse: collapse; }
      th { background: #0B7439; color: white; padding: 8px 6px; text-align: left; font-size: 10px; text-transform: uppercase; }
      td { padding: 7px 6px; border-bottom: 1px solid #e2e8f0; }
      tr:nth-child(even) td { background: #f8faf8; }
      .status { display: inline-block; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 10px; }
    </style></head><body>
    <h1>Tableau des départs — ${stationName}</h1>
    <p class="sub">Imprimé le ${format(now, 'EEEE d MMMM yyyy à HH:mm', { locale: fr })}</p>
    <table>
      <thead><tr>
        <th>Heure</th><th>Destination</th><th>Ligne</th>
        <th>Gare départ</th><th>Gare arrivée</th>
        <th>Plaque bus</th><th>Places dispo</th><th>Statut</th><th>Observation</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => {
          const st = computeEffectiveStatus(r, now);
          const cfg = STATUS_CFG[st];
          return `<tr>
            <td><strong>${format(new Date(r.departure_datetime), 'HH:mm')}</strong></td>
            <td>${r.arrival_station_name}</td>
            <td>${r.route_name}</td>
            <td>${r.departure_station_name}</td>
            <td>${r.arrival_station_name}</td>
            <td>${r.bus_registration}</td>
            <td>${r.seats_available} / ${r.bus_capacity}</td>
            <td><span class="status" style="background:${cfg.bg};color:${cfg.color}">${cfg.label}</span></td>
            <td>${r.notes || ''}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    </body></html>`;
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.print();
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function StationDisplay({ stationId: propId }: { stationId?: string } = {}) {
  const params = useParams<{ id: string }>();
  const id = propId || params.id;
  const [station, setStation] = useState<any>(null);
  const [departures, setDepartures] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [page, setPage] = useState(0);
  const [connected, setConnected] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedRow, setSelectedRow] = useState<ScheduleRow | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const pageTimerRef = useRef<NodeJS.Timeout | null>(null);

  const isNight = currentTime.getHours() >= 20 || currentTime.getHours() < 6;
  const T = isNight ? NIGHT : DAY;

  // ── Load station ──
  const loadStation = useCallback(async () => {
    if (!id) return;
    const { data } = await supabase
      .rpc('get_station_display_info', { p_station_id: id });
    if (data && data.length > 0) setStation(data[0]);
  }, [id]);

  // ── Map row ──
  const mapRow = (s: any): ScheduleRow => {
    const capacity = s.bus_capacity ?? s.bus?.total_seats ?? s.bus?.capacity ?? 0;
    const reserved = s.seats_reserved ?? 0;
    const available = s.seats_available ?? Math.max(0, capacity - reserved);
    const stops = Array.isArray(s.transit_stops) ? s.transit_stops : [];
    return {
      id: s.id,
      route_name: s.route_name || '—',
      departure_datetime: s.departure_datetime,
      arrival_datetime: s.arrival_datetime,
      status: s.status || 'planifie',
      seats_available: available,
      seats_reserved: reserved,
      bus_capacity: capacity,
      fill_rate: s.fill_rate ?? null,
      bus_registration: s.bus_registration || s.bus?.registration_number || '—',
      bus_model: s.bus_model || s.bus?.model || '',
      driver_name: s.driver_name || s.driver?.full_name || '—',
      driver_phone: s.driver_phone || s.driver?.phone || '',
      copilot_name: s.copilot_name || s.copilot?.full_name || '',
      departure_station_name: s.departure_station_name || s.departure_station?.name || '—',
      arrival_station_name: s.arrival_station_name || s.arrival_station?.name || '—',
      notes: s.notes || '',
      transit_stops: (stops as TransitStop[]).sort((a, b) => a.position - b.position),
    };
  };

  // ── Load schedules ──
  const loadSchedules = useCallback(async () => {
    if (!id) return;
    try {
      const today = new Date();
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      const { data, error } = await supabase
        .rpc('get_station_departures', { p_station_id: id, p_date: dateStr });

      if (error) throw error;
      setDepartures((data || []).map(mapRow));
      setLastRefresh(new Date());
    } catch (err) {
      console.error('Erreur chargement:', err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  // ── Effects ──
  useEffect(() => {
    loadStation();
    loadSchedules();
    void supabase.rpc('auto_transition_departed_schedules');

    const clock = setInterval(() => setCurrentTime(new Date()), 1000);

    const transitionTimer = setInterval(async () => {
      try {
        const { data: count } = await supabase.rpc('auto_transition_departed_schedules');
        if ((count ?? 0) > 0) loadSchedules();
        else loadSchedules(); // refresh anyway for seat counts
      } catch (_) {}
    }, REFRESH_MS);

    const channel = supabase
      .channel(`display-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules' }, () => {
        loadSchedules();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, () => {
        loadSchedules();
      })
      .subscribe((status) => { setConnected(status === 'SUBSCRIBED'); });

    return () => {
      clearInterval(clock);
      clearInterval(transitionTimer);
      channel.unsubscribe();
    };
  }, [id]);

  // Auto-page
  useEffect(() => {
    const tp = Math.ceil(departures.length / ROWS_PER_PAGE);
    if (tp <= 1) { setPage(0); return; }
    pageTimerRef.current = setInterval(() => {
      setPage(p => (p + 1) % tp);
    }, PAGE_MS);
    return () => { if (pageTimerRef.current) clearInterval(pageTimerRef.current); };
  }, [departures]);

  // Fullscreen API
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // ── Derived ──
  const sortedDepartures = [...departures].sort((a, b) => {
    const timeA = new Date(a.departure_datetime).getTime();
    const timeB = new Date(b.departure_datetime).getTime();
    if (timeA !== timeB) return timeA - timeB;
    const destA = (a.arrival_station_name || '').toLowerCase();
    const destB = (b.arrival_station_name || '').toLowerCase();
    if (destA !== destB) return destA.localeCompare(destB, 'fr');
    return 0;
  });

  const departNumberByRow = (() => {
    const counters: Record<string, number> = {};
    const map = new Map<string, number>();
    for (const row of sortedDepartures) {
      const dest = (row.arrival_station_name || '').toLowerCase();
      counters[dest] = (counters[dest] || 0) + 1;
      map.set(row.id, counters[dest]);
    }
    return map;
  })();

  const totalPages = Math.ceil(sortedDepartures.length / ROWS_PER_PAGE);
  const pageRows = sortedDepartures.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE);

  const boardingNow = sortedDepartures.filter(d => {
    const s = computeEffectiveStatus(d, currentTime);
    return s === 'embarquement' || s === 'imminent';
  });

  const nextDep = sortedDepartures.find(d => {
    const s = computeEffectiveStatus(d, currentTime);
    return ['planifie', 'embarquement', 'imminent', 'complet'].includes(s);
  });

  // ── Loading / no station ──
  if (!station && loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: T.bg }}>
        <div className="text-center">
          <div className="w-20 h-20 border-8 rounded-full animate-spin mx-auto mb-4"
            style={{ borderColor: T.green, borderTopColor: 'transparent' }} />
          <p className="text-2xl font-semibold" style={{ color: T.text }}>Chargement...</p>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen flex flex-col select-none"
      style={{ backgroundColor: T.bg, color: T.text, fontFamily: '"Inter", system-ui, sans-serif' }}
    >
      {/* ── HEADER ─────────────────────────────────────────────────── */}
      <header style={{ backgroundColor: T.header, borderBottom: `2px solid ${T.border}` }}>
        <div className="px-6 xl:px-10 py-4 flex items-center justify-between gap-4 flex-wrap">

          {/* Logo + Station */}
          <div className="flex items-center gap-4">
            <img src="/logosbta.png" alt="SBTA" className="w-14 h-14 object-contain flex-shrink-0" />
            <div>
              <h1 className="text-3xl xl:text-4xl font-black leading-tight tracking-tight" style={{ color: T.text }}>
                {station?.name || '—'}
              </h1>
              <p className="text-base font-semibold mt-0.5" style={{ color: T.text2 }}>
                {station?.city_name && <>{station.city_name}</>}
                {station?.address && <> &bull; {station.address}</>}
                <span className="ml-3 text-xs uppercase tracking-widest" style={{ color: T.text3 }}>
                  TABLEAU DES DÉPARTS
                </span>
              </p>
            </div>
          </div>

          {/* Boarding alert */}
          {boardingNow.length > 0 && (() => {
            const hasImminent = boardingNow.some(b => computeEffectiveStatus(b, currentTime) === 'imminent');
            const alertCfg = hasImminent ? STATUS_CFG.imminent : STATUS_CFG.embarquement;
            const alertLabel = hasImminent ? 'DEPART IMMINENT' : 'EMBARQUEMENT EN COURS';
            return (
              <div
                className="hidden lg:flex items-center gap-3 px-5 py-3 rounded-2xl border-2 animate-pulse flex-shrink-0"
                style={{ backgroundColor: alertCfg.bg, borderColor: alertCfg.dot }}
              >
                <AlertTriangle className="w-5 h-5 flex-shrink-0" style={{ color: alertCfg.dot }} />
                <div>
                  <p className="text-xs font-black uppercase tracking-widest" style={{ color: alertCfg.color }}>
                    {alertLabel}
                  </p>
                  <p className="text-sm font-bold mt-0.5" style={{ color: alertCfg.color }}>
                    {boardingNow.map(b =>
                      `${format(new Date(b.departure_datetime), 'HH:mm')} → ${b.arrival_station_name}`
                    ).join('  ·  ')}
                  </p>
                </div>
              </div>
            );
          })()}

          {/* Clock + controls */}
          <div className="flex items-center gap-4 flex-shrink-0">
            {/* Action buttons */}
            <div className="hidden md:flex items-center gap-2">
              <button
                onClick={() => printDepartures(sortedDepartures, station?.name || '', currentTime)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-all hover:opacity-80"
                style={{ backgroundColor: T.surface2, color: T.text2, border: `1px solid ${T.border}` }}
                title="Imprimer les départs"
              >
                <Printer className="w-4 h-4" />
                <span>Imprimer</span>
              </button>
              <button
                onClick={() => { setLoading(true); loadSchedules(); }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-all hover:opacity-80"
                style={{ backgroundColor: T.surface2, color: T.text2, border: `1px solid ${T.border}` }}
                title="Actualiser"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                onClick={toggleFullscreen}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-all hover:opacity-80"
                style={{ backgroundColor: T.green, color: 'white' }}
                title={isFullscreen ? 'Quitter plein écran' : 'Mode plein écran'}
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                <span>{isFullscreen ? 'Réduire' : 'Plein écran'}</span>
              </button>
            </div>

            {/* Clock */}
            <div className="text-right">
              <p className="text-4xl xl:text-5xl font-black tabular-nums tracking-tight leading-none" style={{ color: T.green }}>
                {format(currentTime, 'HH:mm:ss')}
              </p>
              <p className="text-sm capitalize font-medium mt-1" style={{ color: T.text2 }}>
                {format(currentTime, 'EEEE d MMMM yyyy', { locale: fr })}
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* ── NEXT DEPARTURE HIGHLIGHT ──────────────────────────────── */}
      {nextDep && (() => {
        const st = computeEffectiveStatus(nextDep, currentTime);
        const cfg = STATUS_CFG[st];
        return (
          <div className="px-6 xl:px-10 pt-4 pb-2">
            <div
              className="rounded-2xl p-4 xl:p-5 flex items-center gap-5 border-2"
              style={{ backgroundColor: `${T.green}12`, borderColor: T.green }}
            >
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: T.green }}
              >
                <Navigation className="w-7 h-7 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-black uppercase tracking-widest mb-0.5" style={{ color: T.green }}>
                  {st === 'embarquement' ? 'EMBARQUEMENT EN COURS' :
                   st === 'imminent' ? 'DEPART IMMINENT' :
                   st === 'retard' ? 'DEPART EN RETARD' : 'PROCHAIN DEPART'}
                </p>
                <div className="flex items-baseline gap-3 flex-wrap">
                  <p className="text-4xl xl:text-5xl font-black tabular-nums" style={{ color: T.text }}>
                    {format(new Date(nextDep.departure_datetime), 'HH:mm')}
                  </p>
                  <p className="text-2xl xl:text-3xl font-black" style={{ color: T.text }}>
                    &rarr; {nextDep.arrival_station_name}
                  </p>
                  <p className="text-base font-semibold" style={{ color: T.text2 }}>
                    {nextDep.route_name}
                  </p>
                </div>
                {nextDep.transit_stops.length > 0 && (
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <span className="text-xs font-bold uppercase tracking-wider" style={{ color: T.text3 }}>Via :</span>
                    {nextDep.transit_stops.slice(0, 4).map((t, i) => (
                      <span key={i} className="text-xs px-2 py-0.5 rounded-full font-semibold"
                        style={{ backgroundColor: T.surface2, color: T.text2 }}>
                        {t.station_name}
                      </span>
                    ))}
                    {nextDep.transit_stops.length > 4 && (
                      <span className="text-xs" style={{ color: T.text3 }}>+{nextDep.transit_stops.length - 4}</span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex-shrink-0 text-right space-y-2">
                <div
                  className={`px-4 py-2.5 rounded-xl font-black text-base inline-flex items-center gap-2 ${cfg.pulse ? 'animate-pulse' : ''}`}
                  style={{ backgroundColor: cfg.bg, color: cfg.color }}
                >
                  {cfg.icon}{cfg.label}
                </div>
                <div className="flex items-center gap-1.5 justify-end">
                  <Bus className="w-4 h-4" style={{ color: T.text3 }} />
                  <span className="text-lg font-black" style={{ color: T.text }}>{nextDep.bus_registration}</span>
                </div>
                <p className="text-sm font-medium" style={{ color: T.text2 }}>
                  {nextDep.seats_available} place{nextDep.seats_available > 1 ? 's' : ''} libre{nextDep.seats_available > 1 ? 's' : ''}
                </p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── TABLE ─────────────────────────────────────────────────── */}
      <div className="px-6 xl:px-10 pt-3 pb-4 flex-1">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="w-14 h-14 rounded-full animate-spin mb-4"
              style={{ border: `5px solid ${T.border}`, borderTopColor: T.green }} />
            <p className="text-xl font-semibold" style={{ color: T.text2 }}>Chargement des données...</p>
          </div>
        ) : pageRows.length === 0 ? (
          <div className="text-center py-24 rounded-xl"
            style={{ backgroundColor: T.surface, border: `1px solid ${T.border}` }}>
            <Bus className="w-16 h-16 mx-auto mb-4 opacity-20" style={{ color: T.text2 }} />
            <p className="text-3xl font-bold" style={{ color: T.text2 }}>Aucun départ prévu aujourd'hui</p>
            <p className="text-lg mt-2 font-medium" style={{ color: T.text3 }}>
              Veuillez consulter le guichet pour plus d'informations
            </p>
          </div>
        ) : (
          <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${T.border}` }}>
            <table className="w-full table-fixed border-collapse">
              <colgroup>
                <col style={{ width: '9%' }} />   {/* N° Départ */}
                <col style={{ width: '7%' }} />   {/* Heure */}
                <col style={{ width: '14%' }} />  {/* Destination */}
                <col style={{ width: '12%' }} />  {/* Ligne */}
                <col style={{ width: '12%' }} />  {/* Gare départ */}
                <col style={{ width: '12%' }} />  {/* Gare arrivée */}
                <col style={{ width: '10%' }} />  {/* Plaque */}
                <col style={{ width: '9%' }} />   {/* Places */}
                <col style={{ width: '15%' }} />  {/* Statut */}
              </colgroup>
              <thead>
                <tr style={{ backgroundColor: T.green, color: 'white' }}>
                  {[
                    { icon: <Navigation className="w-3.5 h-3.5" />, label: 'N° DÉPART' },
                    { icon: <Clock className="w-3.5 h-3.5" />, label: 'HEURE' },
                    { icon: <Navigation className="w-3.5 h-3.5" />, label: 'DESTINATION' },
                    { icon: null, label: 'LIGNE' },
                    { icon: <MapPin className="w-3.5 h-3.5" />, label: 'GARE DÉPART' },
                    { icon: <MapPin className="w-3.5 h-3.5" />, label: 'GARE ARRIVÉE' },
                    { icon: <Bus className="w-3.5 h-3.5" />, label: 'PLAQUE' },
                    { icon: <Users className="w-3.5 h-3.5" />, label: 'PLACES' },
                    { icon: null, label: 'STATUT', center: true },
                  ].map(({ icon, label, center }) => (
                    <th key={label}
                      className={`px-3 py-3 text-xs font-black tracking-widest uppercase whitespace-nowrap ${center ? 'text-center' : 'text-left'}`}>
                      <span className="inline-flex items-center gap-1">
                        {icon}{label}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row, idx) => {
                  const departNumber = departNumberByRow.get(row.id) || 1;
                  const status = computeEffectiveStatus(row, currentTime);
                  const cfg = STATUS_CFG[status] || STATUS_CFG.planifie;
                  const isPast = status === 'termine';
                  const isActive = status === 'embarquement' || status === 'imminent';
                  const isRetard = status === 'retard';
                  const isAnnule = status === 'annule';
                  const fillPct = row.bus_capacity > 0
                    ? Math.round((row.seats_reserved / row.bus_capacity) * 100)
                    : 0;
                  const isLast = idx === pageRows.length - 1;

                  const isImminent = status === 'imminent';
                  const isEmbarquement = status === 'embarquement';

                  const rowBg = isImminent
                    ? 'rgba(234,179,8,0.12)'
                    : isEmbarquement ? 'rgba(234,88,12,0.08)'
                    : isRetard ? 'rgba(249,115,22,0.07)'
                    : isAnnule ? 'rgba(239,68,68,0.05)'
                    : isPast   ? T.surface2
                    : idx % 2 === 0 ? T.surface : T.surface2;

                  const accentColor = isImminent ? '#EAB308'
                    : isEmbarquement ? '#F97316'
                    : isRetard ? '#F97316'
                    : isAnnule ? '#EF4444'
                    : isPast ? '#9CA3AF'
                    : 'transparent';

                  return (
                    <React.Fragment key={row.id}>
                      <tr
                        className="cursor-pointer transition-all"
                        style={{
                          backgroundColor: rowBg,
                          opacity: isPast || isAnnule ? 0.65 : 1,
                          borderBottom: isLast ? 'none' : `1px solid ${T.border}`,
                        }}
                        onClick={() => setSelectedRow(row)}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.filter = 'brightness(0.94)'}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.filter = ''}
                      >
                        {/* ── N° Départ ── */}
                        <td className="px-3 py-4 align-middle" style={{ borderLeft: `4px solid ${accentColor}` }}>
                          <div className="flex flex-col items-start">
                            <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: T.text3 }}>DÉPART</span>
                            <span className="text-2xl xl:text-3xl font-black tabular-nums" style={{ color: isActive ? cfg.color : T.green }}>
                              {departNumber}
                            </span>
                          </div>
                        </td>

                        {/* ── Heure ── */}
                        <td className="px-3 py-4 align-middle">
                          <span
                            className="text-xl xl:text-2xl font-black tabular-nums leading-none block"
                            style={{ color: isImminent ? '#A16207' : isEmbarquement ? '#C2410C' : isRetard ? '#C2410C' : isPast ? '#9CA3AF' : T.text }}
                          >
                            {format(new Date(row.departure_datetime), 'HH:mm')}
                          </span>
                          {(isImminent || isEmbarquement) && (() => {
                            const m = differenceInMinutes(new Date(row.departure_datetime), currentTime);
                            return (
                              <span className={`text-xs font-black mt-0.5 block ${isImminent ? 'animate-pulse' : ''}`}
                                style={{ color: isImminent ? '#A16207' : '#C2410C' }}>
                                dans {m} min
                              </span>
                            );
                          })()}
                        </td>

                        {/* ── Destination ── */}
                        <td className="px-3 py-4 align-middle">
                          <p className="text-lg xl:text-xl font-black leading-tight" style={{ color: T.text,
                            overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                            {row.arrival_station_name}
                          </p>
                          {row.transit_stops.length > 0 && (
                            <p className="text-xs mt-1 truncate" style={{ color: T.text3 }}>
                              Via {row.transit_stops.slice(0, 2).map(t => t.station_name).join(', ')}
                              {row.transit_stops.length > 2 ? ` +${row.transit_stops.length - 2}` : ''}
                            </p>
                          )}
                        </td>

                        {/* ── Ligne ── */}
                        <td className="px-3 py-4 align-middle">
                          <p className="text-sm font-semibold leading-snug" style={{ color: T.text2,
                            overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                            {row.route_name}
                          </p>
                          <p className="text-xs mt-0.5" style={{ color: T.text3 }}>
                            {formatDuration(row.departure_datetime, row.arrival_datetime)}
                          </p>
                        </td>

                        {/* ── Gare départ ── */}
                        <td className="px-3 py-4 align-middle">
                          <p className="text-sm font-semibold leading-snug" style={{ color: T.text2,
                            overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                            {row.departure_station_name}
                          </p>
                        </td>

                        {/* ── Gare arrivée ── */}
                        <td className="px-3 py-4 align-middle">
                          <p className="text-sm font-semibold leading-snug" style={{ color: T.text2,
                            overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                            {row.arrival_station_name}
                          </p>
                        </td>

                        {/* ── Plaque ── */}
                        <td className="px-3 py-4 align-middle">
                          <div className="flex items-center gap-1.5">
                            <Bus className="w-4 h-4 flex-shrink-0" style={{ color: T.text3 }} />
                            <span className="text-base font-black" style={{ color: T.text, wordBreak: 'break-all' }}>
                              {row.bus_registration}
                            </span>
                          </div>
                          {row.bus_model && (
                            <p className="text-xs mt-0.5 truncate" style={{ color: T.text3 }}>{row.bus_model}</p>
                          )}
                        </td>

                        {/* ── Places ── */}
                        <td className="px-3 py-4 align-middle">
                          <div className="flex items-baseline gap-0.5">
                            <span className="text-2xl xl:text-3xl font-black tabular-nums"
                              style={{ color: row.seats_available === 0 ? '#EF4444' : fillPct >= 80 ? '#F59E0B' : T.green }}>
                              {row.seats_available}
                            </span>
                            <span className="text-xs font-semibold" style={{ color: T.text3 }}>/{row.bus_capacity}</span>
                          </div>
                          <div className="w-full h-1.5 rounded-full mt-1 overflow-hidden" style={{ backgroundColor: T.border }}>
                            <div className="h-full rounded-full" style={{
                              width: `${Math.min(fillPct, 100)}%`,
                              backgroundColor: fillPct >= 90 ? '#EF4444' : fillPct >= 70 ? '#F59E0B' : T.green,
                            }} />
                          </div>
                        </td>

                        {/* ── Statut ── */}
                        <td className="px-3 py-4 align-middle text-center">
                          <div className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl font-black text-xs whitespace-nowrap ${cfg.pulse ? 'animate-pulse' : ''}`}
                            style={{ backgroundColor: cfg.bg, color: cfg.color }}>
                            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cfg.dot }} />
                            {cfg.label}
                          </div>
                        </td>
                      </tr>

                      {/* Alert banner */}
                      {isActive && (
                        <tr>
                          <td colSpan={9} className="py-2 text-center font-black text-xs tracking-widest uppercase"
                            style={{
                              backgroundColor: status === 'imminent' ? '#EAB308' : T.green,
                              color: status === 'imminent' ? '#422006' : 'white',
                            }}>
                            {status === 'imminent'
                              ? 'DEPART IMMINENT — PRESENTEZ-VOUS AU QUAI IMMEDIATEMENT'
                              : 'EMBARQUEMENT EN COURS — MONTEZ A BORD MAINTENANT'}
                          </td>
                        </tr>
                      )}
                      {isRetard && (
                        <tr>
                          <td colSpan={9} className="py-2 text-center font-black text-xs tracking-widest uppercase"
                            style={{ backgroundColor: 'rgba(249,115,22,0.15)', color: '#C2410C', borderTop: '1px solid #F97316' }}>
                            DEPART RETARDE — VEUILLEZ PATIENTER
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── FOOTER ─────────────────────────────────────────────────── */}
      <footer
        className="px-6 xl:px-10 py-3 flex items-center justify-between gap-4 flex-wrap border-t"
        style={{ backgroundColor: T.header, borderColor: T.border }}
      >
        {/* Left */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2" style={{ color: connected ? T.text3 : '#EF4444' }}>
            {connected
              ? <Wifi className="w-4 h-4" />
              : <WifiOff className="w-4 h-4" />}
            <span className="text-sm font-semibold">
              {connected ? 'Temps réel actif' : 'Connexion perdue'}
            </span>
          </div>
          <span className="text-xs font-medium" style={{ color: T.text3 }}>
            Mis à jour : {format(lastRefresh, 'HH:mm:ss')}
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                className="p-1.5 rounded-lg hover:opacity-70 transition-opacity"
                style={{ color: T.text3, backgroundColor: T.surface2 }}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex gap-1.5">
                {Array.from({ length: totalPages }).map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setPage(i)}
                    className="w-2.5 h-2.5 rounded-full transition-all"
                    style={{ backgroundColor: i === page ? T.green : T.border }}
                  />
                ))}
              </div>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                className="p-1.5 rounded-lg hover:opacity-70 transition-opacity"
                style={{ color: T.text3, backgroundColor: T.surface2 }}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <span className="text-xs font-medium" style={{ color: T.text3 }}>
                {page + 1}/{totalPages}
              </span>
            </div>
          )}
        </div>

        {/* Center: status legend */}
        <div className="hidden xl:flex items-center gap-3 flex-wrap">
          {(Object.entries(STATUS_CFG) as [StatusKey, typeof STATUS_CFG[StatusKey]][])
            .filter(([k]) => !['en_cours', 'ouvert'].includes(k))
            .map(([key, cfg]) => (
              <div key={key} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: cfg.dot }} />
                <span className="text-xs font-semibold" style={{ color: T.text3 }}>{cfg.label}</span>
              </div>
            ))}
        </div>

        {/* Right */}
        <div className="flex items-center gap-3">
          <p className="text-sm font-semibold" style={{ color: T.text2 }}>
            SBTA &bull; {station?.name}
          </p>
          <span className="text-sm tabular-nums font-bold" style={{ color: T.green }}>
            {format(currentTime, 'HH:mm:ss')}
          </span>
        </div>
      </footer>

      {/* ── DETAIL MODAL ──────────────────────────────────────────── */}
      {selectedRow && (
        <DetailModal
          row={selectedRow}
          now={currentTime}
          theme={T}
          onClose={() => setSelectedRow(null)}
        />
      )}
    </div>
  );
}
