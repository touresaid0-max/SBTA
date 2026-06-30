import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Monitor, User, CheckCircle, RefreshCw, Hash,
  MapPin, Plus, X, Route, Clock, Play, Square, Timer,
  Wifi, WifiOff, LogIn, LogOut,
} from 'lucide-react';

interface RouteInfo { id: string; name: string }

interface ShiftInfo {
  id: string;
  started_at: string;
  ended_at: string | null;
}

interface SessionInfo {
  logged_in_at: string;
  logged_out_at: string | null;
}

interface Counter {
  id: string;
  counter_number: number;
  is_active: boolean;
  assigned_user_id: string | null;
  station_id: string;
  user?: { full_name: string; email: string } | null;
  todayStats?: { departures: number; tickets: number; revenue: number };
  routes: RouteInfo[];
  todayShifts: ShiftInfo[];
  isUserOnline: boolean;
  userSession: SessionInfo | null;
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h${m.toString().padStart(2, '0')}`;
}

export default function ChefGareCounters() {
  const { user } = useAuthStore();
  const [counters, setCounters] = useState<Counter[]>([]);
  const [loading, setLoading] = useState(true);
  const [stationId, setStationId] = useState<string | null>(null);
  const [allRoutes, setAllRoutes] = useState<RouteInfo[]>([]);
  const [routeModal, setRouteModal] = useState<Counter | null>(null);
  const [selectedRouteIds, setSelectedRouteIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: sid } = await supabase.rpc('get_my_station_id');
      if (!sid) { toast.error('Impossible de recuperer votre gare'); return; }
      setStationId(sid);

      const { count: chefCount } = await supabase
        .from('station_managers')
        .select('id', { count: 'exact', head: true })
        .eq('station_id', sid);
      const restrictManagerId = (chefCount ?? 0) > 1 ? user?.id ?? null : null;

      const today = new Date().toISOString().split('T')[0];

      let countersQuery = supabase
        .from('counters')
        .select('id, counter_number, is_active, assigned_user_id, station_id, user:assigned_user_id(full_name, email)')
        .eq('station_id', sid)
        .order('counter_number');
      if (restrictManagerId) countersQuery = countersQuery.eq('manager_id', restrictManagerId);

      const [countersRes, routesRes, crRes, shiftsRes, sessionsRes] = await Promise.all([
        countersQuery,
        supabase
          .from('routes')
          .select('id, name')
          .eq('origin_station_id', sid)
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('counter_routes')
          .select('counter_id, route_id, routes:route_id(id, name)'),
        supabase
          .from('counter_shifts')
          .select('id, counter_id, started_at, ended_at')
          .eq('station_id', sid)
          .eq('shift_date', today)
          .order('started_at', { ascending: true }),
        supabase
          .from('user_sessions')
          .select('user_id, logged_in_at, logged_out_at')
          .eq('station_id', sid)
          .eq('session_date', today)
          .order('logged_in_at', { ascending: false }),
      ]);

      if (countersRes.error) throw countersRes.error;

      const stationRoutes: RouteInfo[] = (routesRes.data || []) as RouteInfo[];
      setAllRoutes(stationRoutes);

      const crMap: Record<string, RouteInfo[]> = {};
      (crRes.data || []).forEach((cr: any) => {
        const r = Array.isArray(cr.routes) ? cr.routes[0] : cr.routes;
        if (!r) return;
        if (!crMap[cr.counter_id]) crMap[cr.counter_id] = [];
        crMap[cr.counter_id].push({ id: r.id, name: r.name });
      });

      const shiftsMap: Record<string, ShiftInfo[]> = {};
      (shiftsRes.data || []).forEach((s: any) => {
        if (!shiftsMap[s.counter_id]) shiftsMap[s.counter_id] = [];
        shiftsMap[s.counter_id].push({ id: s.id, started_at: s.started_at, ended_at: s.ended_at });
      });

      // Build sessions map: user_id -> latest session info
      const userSessionMap: Record<string, SessionInfo> = {};
      const onlineUserIds = new Set<string>();
      (sessionsRes.data || []).forEach((s: any) => {
        if (!userSessionMap[s.user_id]) {
          userSessionMap[s.user_id] = { logged_in_at: s.logged_in_at, logged_out_at: s.logged_out_at };
        }
        if (!s.logged_out_at) onlineUserIds.add(s.user_id);
      });

      const countersWithData = await Promise.all(
        (countersRes.data || []).map(async (c: any) => {
          const { data: statsData } = await supabase
            .from('schedule_receipt_summary')
            .select('schedule_id, seats_sold, total_ticket_amount')
            .eq('counter_id', c.id)
            .eq('departure_date', today);

          const isOnline = c.assigned_user_id ? onlineUserIds.has(c.assigned_user_id) : false;
          const session = c.assigned_user_id ? userSessionMap[c.assigned_user_id] || null : null;

          return {
            ...c,
            user: Array.isArray(c.user) ? c.user[0] || null : c.user,
            todayStats: {
              departures: statsData?.length || 0,
              tickets: statsData?.reduce((sum: number, r: any) => sum + (r.seats_sold || 0), 0) || 0,
              revenue: statsData?.reduce((sum: number, r: any) => sum + (r.total_ticket_amount || 0), 0) || 0,
            },
            routes: (crMap[c.id] || []).sort((a: RouteInfo, b: RouteInfo) => a.name.localeCompare(b.name)),
            todayShifts: shiftsMap[c.id] || [],
            isUserOnline: isOnline,
            userSession: session,
          };
        })
      );

      setCounters(countersWithData);
      setNow(Date.now());
    } catch (err: any) {
      toast.error('Erreur de chargement des guichets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleActive = async (counter: Counter) => {
    const willActivate = !counter.is_active;

    if (willActivate && !counter.assigned_user_id) {
      toast.error('Aucun guichetier assigne a ce guichet');
      return;
    }

    try {
      const { error } = await supabase
        .from('counters')
        .update({ is_active: willActivate })
        .eq('id', counter.id);
      if (error) throw error;

      toast.success(willActivate
        ? `Guichet ${counter.counter_number} active`
        : `Guichet ${counter.counter_number} desactive`
      );
      load();
    } catch (err: any) {
      toast.error(err.message || 'Erreur de mise a jour');
    }
  };

  const openRouteModal = (counter: Counter) => {
    setRouteModal(counter);
    setSelectedRouteIds(new Set(counter.routes.map(r => r.id)));
  };

  const toggleRoute = (routeId: string) => {
    setSelectedRouteIds(prev => {
      const next = new Set(prev);
      if (next.has(routeId)) next.delete(routeId);
      else next.add(routeId);
      return next;
    });
  };

  const saveRoutes = async () => {
    if (!routeModal) return;
    setSaving(true);
    try {
      const currentIds = new Set(routeModal.routes.map(r => r.id));
      const toAdd = [...selectedRouteIds].filter(id => !currentIds.has(id));
      const toRemove = [...currentIds].filter(id => !selectedRouteIds.has(id));

      if (toRemove.length > 0) {
        const { error } = await supabase
          .from('counter_routes')
          .delete()
          .eq('counter_id', routeModal.id)
          .in('route_id', toRemove);
        if (error) throw error;
      }

      if (toAdd.length > 0) {
        const rows = toAdd.map(route_id => ({ counter_id: routeModal.id, route_id }));
        const { error } = await supabase.from('counter_routes').insert(rows);
        if (error) throw error;
      }

      toast.success(`Lignes du Guichet ${routeModal.counter_number} mises a jour`);
      setRouteModal(null);
      load();
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const getShiftDisplay = (counter: Counter) => {
    const shifts = counter.todayShifts;
    if (shifts.length === 0 && !counter.userSession) return null;

    let totalWorkedMs = 0;
    for (const s of shifts) {
      const start = new Date(s.started_at).getTime();
      // Only count ongoing time if user is actually online
      const end = s.ended_at
        ? new Date(s.ended_at).getTime()
        : (counter.isUserOnline ? now : new Date(s.started_at).getTime());
      totalWorkedMs += end - start;
    }

    const session = counter.userSession;
    const firstStart = shifts.length > 0 ? shifts[0].started_at : session?.logged_in_at || '';
    const lastShift = shifts.length > 0 ? shifts[shifts.length - 1] : null;

    return {
      firstStart,
      isActive: counter.isUserOnline,
      lastEnd: lastShift?.ended_at || session?.logged_out_at || null,
      totalWorkedMs,
      loginTime: session?.logged_in_at || null,
      logoutTime: session?.logged_out_at || null,
    };
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <div className="w-8 h-8 border-4 rounded-full animate-spin"
          style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  const active = counters.filter(c => c.is_active);
  const online = counters.filter(c => c.isUserOnline);
  const assigned = counters.filter(c => c.assigned_user_id);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Guichets de la gare
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Vue d'ensemble, etat des guichets et lignes assignees
          </p>
        </div>
        <button onClick={load}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
          <RefreshCw className="w-4 h-4" /> Rafraichir
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Total guichets', value: counters.length, icon: <Hash className="w-5 h-5" />, color: 'var(--primary)' },
          { label: 'Guichetiers connectes', value: online.length, icon: <CheckCircle className="w-5 h-5" />, color: '#16A34A' },
          { label: 'Guichetiers assignes', value: assigned.length, icon: <User className="w-5 h-5" />, color: '#0369A1' },
        ].map((kpi, i) => (
          <div key={i} className="rounded-2xl p-5 border shadow-sm" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: `${kpi.color}18`, color: kpi.color }}>
                {kpi.icon}
              </div>
              <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{kpi.label}</span>
            </div>
            <p className="text-3xl font-bold" style={{ color: kpi.color }}>{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Counters grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {counters.map(counter => {
          const shift = getShiftDisplay(counter);
          return (
          <div key={counter.id}
            className="rounded-2xl border shadow-sm overflow-hidden"
            style={{ backgroundColor: 'var(--surface)', borderColor: counter.is_active ? 'var(--primary)' : 'var(--border)' }}>
            <div className="flex items-center justify-between px-5 py-4 border-b"
              style={{
                backgroundColor: counter.is_active ? 'var(--primary-light)' : 'var(--bg-subtle)',
                borderColor: 'var(--border)',
              }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-xl"
                  style={{ backgroundColor: counter.is_active ? 'var(--primary)' : '#9CA3AF', color: 'white' }}>
                  {counter.counter_number}
                </div>
                <div>
                  <p className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                    Guichet {counter.counter_number}
                  </p>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${counter.is_active ? 'text-green-700 bg-green-100' : 'text-gray-500 bg-gray-100'}`}>
                    {counter.is_active ? 'Actif' : 'Inactif'}
                  </span>
                </div>
              </div>
              <Monitor className="w-5 h-5" style={{ color: counter.is_active ? 'var(--primary)' : '#9CA3AF' }} />
            </div>

            <div className="p-5 space-y-4">
              {/* Assigned user */}
              <div className="flex items-start gap-3">
                <User className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                <div>
                  <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Guichetier assigne</p>
                  {counter.user ? (
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {counter.user.full_name}
                    </p>
                  ) : (
                    <p className="text-sm italic" style={{ color: 'var(--text-muted)' }}>Non assigne</p>
                  )}
                </div>
              </div>

              {/* Connection status & shift info */}
              {counter.assigned_user_id && (
                <div className="rounded-xl p-3 border" style={{
                  borderColor: counter.isUserOnline ? '#16A34A' : 'var(--border)',
                  backgroundColor: counter.isUserOnline ? '#F0FDF4' : 'var(--bg-subtle)',
                }}>
                  {/* Connection status badge */}
                  <div className="flex items-center gap-2 mb-2">
                    {counter.isUserOnline ? (
                      <Wifi className="w-3.5 h-3.5" style={{ color: '#16A34A' }} />
                    ) : (
                      <WifiOff className="w-3.5 h-3.5" style={{ color: '#9CA3AF' }} />
                    )}
                    <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2 py-0.5 rounded-full ${
                      counter.isUserOnline ? 'text-green-700 bg-green-100' : 'text-gray-500 bg-gray-100'
                    }`}>
                      {counter.isUserOnline && (
                        <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: '#16A34A' }} />
                      )}
                      {counter.isUserOnline ? 'Connecte - En service' : 'Deconnecte - Hors service'}
                    </span>
                  </div>

                  {shift ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
                          <LogIn className="w-3 h-3" /> Connexion
                        </span>
                        <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                          {format(new Date(shift.loginTime || shift.firstStart), 'dd/MM/yyyy', { locale: fr })} a {format(new Date(shift.loginTime || shift.firstStart), "HH'h'mm")}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
                          <LogOut className="w-3 h-3" /> Deconnexion
                        </span>
                        {counter.isUserOnline ? (
                          <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full"
                            style={{ backgroundColor: '#DCFCE7', color: '#16A34A' }}>
                            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: '#16A34A' }} />
                            En cours
                          </span>
                        ) : (
                          <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                            {shift.logoutTime ? format(new Date(shift.logoutTime), "HH'h'mm") : (shift.lastEnd ? format(new Date(shift.lastEnd), "HH'h'mm") : '--')}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between pt-1 mt-1 border-t" style={{ borderColor: 'var(--border)' }}>
                        <span className="text-xs flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
                          <Timer className="w-3 h-3" /> Temps travaille
                        </span>
                        <span className="text-sm font-black" style={{ color: counter.isUserOnline ? '#16A34A' : 'var(--primary)' }}>
                          {formatDuration(shift.totalWorkedMs)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs italic mt-1" style={{ color: 'var(--text-muted)' }}>
                      {counter.isUserOnline ? 'Session active, pas encore de service' : 'Non connecte aujourd\'hui'}
                    </p>
                  )}
                </div>
              )}

              {/* Assigned routes */}
              <div className="flex items-start gap-3">
                <Route className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Lignes assignees</p>
                  {counter.routes.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {counter.routes.map(r => (
                        <span key={r.id} className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ backgroundColor: '#DBEAFE', color: '#1D4ED8' }}>
                          {r.name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs italic" style={{ color: 'var(--text-muted)' }}>Toutes les lignes</p>
                  )}
                  <button onClick={() => openRouteModal(counter)}
                    className="mt-2 flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg border transition-colors hover:opacity-80"
                    style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}>
                    <MapPin className="w-3 h-3" /> Gerer les lignes
                  </button>
                </div>
              </div>

              {/* Today stats */}
              <div className="rounded-xl p-3 space-y-2" style={{ backgroundColor: 'var(--bg-subtle)' }}>
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  Aujourd'hui
                </p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                      {counter.todayStats?.departures ?? 0}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Departs</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                      {counter.todayStats?.tickets ?? 0}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Billets</p>
                  </div>
                  <div>
                    <p className="text-sm font-bold" style={{ color: '#16A34A' }}>
                      {((counter.todayStats?.revenue ?? 0) / 1000).toFixed(0)}k
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>FCFA</p>
                  </div>
                </div>
              </div>

              <button onClick={() => toggleActive(counter)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold border transition-all"
                style={{
                  borderColor: counter.is_active ? '#DC2626' : '#16A34A',
                  color: counter.is_active ? '#DC2626' : '#16A34A',
                  backgroundColor: counter.is_active ? '#FEF2F2' : '#F0FDF4',
                }}>
                {counter.is_active ? (
                  <><Square className="w-4 h-4" /> Desactiver</>
                ) : (
                  <><Play className="w-4 h-4" /> Activer</>
                )}
              </button>
            </div>
          </div>
          );
        })}
      </div>

      {counters.length === 0 && (
        <div className="text-center py-16 rounded-2xl border-2 border-dashed" style={{ borderColor: 'var(--border)' }}>
          <Monitor className="w-12 h-12 mx-auto mb-3" style={{ color: '#D1D5DB' }} />
          <p className="font-medium" style={{ color: 'var(--text-secondary)' }}>
            Aucun guichet configure pour cette gare
          </p>
        </div>
      )}

      {/* Route assignment modal */}
      {routeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={e => { if (e.target === e.currentTarget) setRouteModal(null); }}>
          <div className="rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between px-6 py-5 border-b" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg text-white"
                  style={{ backgroundColor: 'var(--primary)' }}>
                  {routeModal.counter_number}
                </div>
                <div>
                  <p className="font-bold" style={{ color: 'var(--text-primary)' }}>
                    Lignes du Guichet {routeModal.counter_number}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {routeModal.user?.full_name || 'Non assigne'}
                  </p>
                </div>
              </div>
              <button onClick={() => setRouteModal(null)} className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                style={{ color: 'var(--text-muted)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 max-h-[60vh] overflow-y-auto">
              <p className="text-xs font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>
                Selectionnez les lignes que ce guichet peut vendre. Si aucune ligne n'est selectionnee, le guichetier voit toutes les lignes.
              </p>
              {allRoutes.length === 0 ? (
                <p className="text-sm italic py-4 text-center" style={{ color: 'var(--text-muted)' }}>
                  Aucune ligne ne part de cette gare
                </p>
              ) : (
                <div className="space-y-2">
                  {allRoutes.map(route => {
                    const selected = selectedRouteIds.has(route.id);
                    return (
                      <button key={route.id} onClick={() => toggleRoute(route.id)}
                        className="w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all"
                        style={{
                          borderColor: selected ? 'var(--primary)' : 'var(--border)',
                          backgroundColor: selected ? 'var(--primary-light)' : 'transparent',
                        }}>
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{
                            backgroundColor: selected ? 'var(--primary)' : 'var(--bg-subtle)',
                            color: selected ? 'white' : 'var(--text-muted)',
                          }}>
                          {selected ? <CheckCircle className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                        </div>
                        <span className="text-sm font-medium flex-1" style={{ color: 'var(--text-primary)' }}>
                          {route.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex gap-3 px-6 pb-6">
              <button onClick={() => setRouteModal(null)}
                className="flex-1 px-4 py-3 rounded-xl border text-sm font-medium"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                Annuler
              </button>
              <button onClick={saveRoutes} disabled={saving}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--primary)' }}>
                {saving ? 'Enregistrement...' : `Enregistrer (${selectedRouteIds.size})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
