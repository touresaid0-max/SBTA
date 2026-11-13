import { useEffect, useMemo, useState } from 'react';
import { format, isSameDay, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Clock, Loader2, LogIn, LogOut, MapPin, X } from 'lucide-react';
import { supabase } from '../../services/supabase';

/**
 * Connection history of one user (Admin › Connexions): when he logged in and out, per day and
 * per month, and his total connection time. Read from user_sessions (one row per login).
 *
 * A session closed without logout (browser closed, power cut) is closed only at the next login,
 * sometimes the next day: its recorded end is not when the user left. Such sessions are shown
 * as « fin non enregistrée » and left out of the totals, so that the hours stay true.
 */

interface PanelUser {
  id: string;
  full_name: string;
  role: string;
  station_name?: string;
  counter_name?: string;
  is_online: boolean;
}

interface SessionRow {
  id: string;
  logged_in_at: string;
  logged_out_at: string | null;
  session_date: string | null;
  station_id: string | null;
}

type Kind = 'closed' | 'ongoing' | 'unrecorded';

interface Session {
  id: string;
  start: Date;
  end: Date | null;
  kind: Kind;
  minutes: number; // counted in the totals (0 when the end is not known)
  station: string;
}

const PAGE = 1000;

function formatMinutes(total: number): string {
  const m = Math.max(0, Math.round(total));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  return r === 0 ? `${h} h` : `${h} h ${String(r).padStart(2, '0')} min`;
}

function classify(row: SessionRow, isOnline: boolean, now: Date): Omit<Session, 'station'> {
  const start = parseISO(row.logged_in_at);
  const end = row.logged_out_at ? parseISO(row.logged_out_at) : null;
  if (!end) {
    // Still open: the current session of a user online today, otherwise an end never recorded
    if (isOnline && isSameDay(start, now)) {
      return { id: row.id, start, end: null, kind: 'ongoing', minutes: (now.getTime() - start.getTime()) / 60_000 };
    }
    return { id: row.id, start, end: null, kind: 'unrecorded', minutes: 0 };
  }
  // Closed on another day: closed by the next login, not by a logout
  if (!isSameDay(start, end)) return { id: row.id, start, end, kind: 'unrecorded', minutes: 0 };
  return { id: row.id, start, end, kind: 'closed', minutes: Math.max(0, (end.getTime() - start.getTime()) / 60_000) };
}

export default function SessionHistoryPanel({ user, onClose }: { user: PanelUser; onClose: () => void }) {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [stations, setStations] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState(() => format(new Date(), 'yyyy-MM'));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all: SessionRow[] = [];
        for (let guard = 0; guard < 50; guard++) {
          const { data, error: err } = await supabase
            .from('user_sessions')
            .select('id, logged_in_at, logged_out_at, session_date, station_id')
            .eq('user_id', user.id)
            .order('logged_in_at', { ascending: false })
            .range(all.length, all.length + PAGE - 1);
          if (err) throw err;
          const page = (data ?? []) as SessionRow[];
          all.push(...page);
          if (page.length < PAGE) break;
        }
        const ids = [...new Set(all.map(r => r.station_id).filter((v): v is string => !!v))];
        const names = new Map<string, string>();
        if (ids.length > 0) {
          const { data } = await supabase.from('stations').select('id, name').in('id', ids);
          for (const s of (data ?? []) as { id: string; name: string }[]) names.set(s.id, s.name);
        }
        if (!cancelled) { setRows(all); setStations(names); }
      } catch {
        if (!cancelled) setError('Impossible de charger l’historique des connexions.');
      }
    })();
    return () => { cancelled = true; };
  }, [user.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const now = useMemo(() => new Date(), [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const sessions: Session[] = useMemo(
    () => (rows ?? []).map(r => ({ ...classify(r, user.is_online, now), station: (r.station_id && stations.get(r.station_id)) || '' })),
    [rows, stations, user.is_online, now],
  );

  const sum = (list: Session[]) => list.reduce((n, s) => n + s.minutes, 0);
  const today = sessions.filter(s => isSameDay(s.start, now));
  const inMonth = sessions.filter(s => format(s.start, 'yyyy-MM') === month);
  const unrecordedInMonth = inMonth.filter(s => s.kind === 'unrecorded').length;
  const firstDate = sessions.length > 0 ? sessions[sessions.length - 1].start : null;

  const days = useMemo(() => {
    const m = new Map<string, Session[]>();
    for (const s of inMonth) {
      const k = format(s.start, 'yyyy-MM-dd');
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return [...m.entries()].map(([day, list]) => ({ day, list: [...list].sort((a, b) => a.start.getTime() - b.start.getTime()) }));
  }, [inMonth]);

  const monthDate = parseISO(`${month}-01`);
  const shiftMonth = (delta: number) => {
    const d = new Date(monthDate.getFullYear(), monthDate.getMonth() + delta, 1);
    setMonth(format(d, 'yyyy-MM'));
  };
  const isCurrentMonth = month === format(now, 'yyyy-MM');

  const card = (label: string, value: string, sub?: string, accent = '#0B7439') => (
    <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className="text-base font-bold" style={{ color: accent }}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400">{sub}</p>}
    </div>
  );

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/10" onClick={onClose} aria-hidden="true" />
      <aside role="dialog" aria-label={`Historique des connexions de ${user.full_name}`}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[440px] flex-col border-l border-gray-200 bg-white shadow-2xl animate-slide-in">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 text-sm font-semibold text-white">
              {user.full_name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-900">{user.full_name}</p>
              <p className="truncate text-xs text-gray-500">
                Historique des connexions{user.station_name ? ` · ${user.station_name}` : ''}{user.counter_name ? ` · ${user.counter_name}` : ''}
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Fermer" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {rows == null && !error && (
            <div className="flex items-center gap-2 py-10 text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /> Chargement…</div>
          )}
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"><AlertTriangle className="h-4 w-4" /> {error}</div>
          )}

          {rows && (
            <>
              {/* Totals */}
              <div className="grid grid-cols-2 gap-2">
                {card('Aujourd’hui', formatMinutes(sum(today)), `${today.length} connexion${today.length > 1 ? 's' : ''}`)}
                {card(isCurrentMonth ? 'Ce mois-ci' : format(monthDate, 'MMMM yyyy', { locale: fr }), formatMinutes(sum(inMonth)), `${inMonth.length} connexion${inMonth.length > 1 ? 's' : ''} · ${days.length} jour${days.length > 1 ? 's' : ''}`)}
                {card('Total à ce jour', formatMinutes(sum(sessions)), firstDate ? `depuis le ${format(firstDate, 'dd/MM/yyyy')}` : 'aucune connexion', '#1D4ED8')}
                {card('Moyenne par jour (mois)', days.length > 0 ? formatMinutes(sum(inMonth) / days.length) : '—', 'jours connectés', '#7C3AED')}
              </div>

              {/* Month */}
              <div className="flex items-center justify-between rounded-lg border border-gray-100 px-2 py-1.5">
                <button onClick={() => shiftMonth(-1)} aria-label="Mois précédent" className="rounded-md p-1 text-gray-500 hover:bg-gray-100"><ChevronLeft className="h-4 w-4" /></button>
                <span className="flex items-center gap-1.5 text-sm font-semibold capitalize text-gray-800">
                  <CalendarDays className="h-4 w-4 text-gray-400" /> {format(monthDate, 'MMMM yyyy', { locale: fr })}
                </span>
                <button onClick={() => shiftMonth(1)} disabled={isCurrentMonth} aria-label="Mois suivant" className="rounded-md p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
              </div>

              {/* Days */}
              {days.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400">Aucune connexion ce mois-ci.</p>
              ) : days.map(({ day, list }) => (
                <div key={day} className="overflow-hidden rounded-xl border border-gray-100">
                  <div className="flex items-center justify-between bg-gray-50 px-3 py-2">
                    <span className="text-xs font-semibold capitalize text-gray-700">{format(parseISO(day), 'EEEE dd/MM/yyyy', { locale: fr })}</span>
                    <span className="text-xs font-bold text-emerald-700">{list.every(x => x.kind === 'unrecorded') ? '—' : formatMinutes(sum(list))}</span>
                  </div>
                  <ul className="divide-y divide-gray-50">
                    {list.map(s => (
                      <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-gray-800">
                            <span className="flex items-center gap-1"><LogIn className="h-3 w-3 text-emerald-500" />{format(s.start, 'HH:mm')}</span>
                            <span className="text-gray-300">→</span>
                            {s.kind === 'ongoing' && <span className="font-medium text-emerald-600">en cours</span>}
                            {s.kind === 'closed' && s.end && <span className="flex items-center gap-1"><LogOut className="h-3 w-3 text-gray-400" />{format(s.end, 'HH:mm')}</span>}
                            {s.kind === 'unrecorded' && <span className="text-amber-600">fin non enregistrée</span>}
                          </div>
                          {s.station && <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-gray-400"><MapPin className="h-2.5 w-2.5" />{s.station}</p>}
                        </div>
                        <span className={`flex flex-shrink-0 items-center gap-1 font-semibold ${s.kind === 'unrecorded' ? 'text-gray-300' : s.kind === 'ongoing' ? 'text-emerald-600' : 'text-gray-700'}`}>
                          <Clock className="h-3 w-3" />{s.kind === 'unrecorded' ? '—' : formatMinutes(s.minutes)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              {unrecordedInMonth > 0 && (
                <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  {unrecordedInMonth} connexion{unrecordedInMonth > 1 ? 's' : ''} sans déconnexion enregistrée (navigateur fermé, coupure) : non comptée{unrecordedInMonth > 1 ? 's' : ''} dans les totaux.
                </p>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
