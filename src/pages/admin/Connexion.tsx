import { useState, useEffect, useCallback } from 'react';
import { Search, RefreshCw, Wifi, WifiOff, MessageCircle, Clock, MapPin, Monitor } from 'lucide-react';
import { supabase } from '../../services/supabase';
import { format, differenceInMinutes } from 'date-fns';
import { fr } from 'date-fns/locale';
import toast from 'react-hot-toast';
import ChatPanel from '../../components/admin/ChatPanel';

interface ConnectedUser {
  id: string;
  full_name: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  phone?: string;
  avatar_url?: string;
  station_id?: string;
  station_name?: string;
  counter_name?: string;
  last_activity?: string;
  is_online: boolean;
  session_start?: string;
}

const MONITORED_ROLES = ['guichetier', 'chef_gare', 'bagagiste', 'agent_colis', 'chauffeur', 'comptable'];

const ROLE_LABELS: Record<string, string> = {
  guichetier: 'Guichetier',
  chef_gare: 'Chef de gare',
  bagagiste: 'Bagagiste',
  agent_colis: 'Agent colis',
  chauffeur: 'Chauffeur',
  comptable: 'Comptable',
};

const ROLE_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  guichetier: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
  chef_gare: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  bagagiste: { bg: 'bg-purple-50', text: 'text-purple-700', dot: 'bg-purple-500' },
  agent_colis: { bg: 'bg-cyan-50', text: 'text-cyan-700', dot: 'bg-cyan-500' },
  chauffeur: { bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
  comptable: { bg: 'bg-rose-50', text: 'text-rose-700', dot: 'bg-rose-500' },
};

export default function Connexion() {
  const [users, setUsers] = useState<ConnectedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline'>('all');
  const [chatTarget, setChatTarget] = useState<ConnectedUser | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const loadUsers = useCallback(async () => {
    try {
      const { data: usersData, error } = await supabase
        .from('users')
        .select('id, full_name, first_name, last_name, email, role, phone, avatar_url, station_id, stations!users_station_id_fkey(name)')
        .in('role', MONITORED_ROLES)
        .eq('is_active', true)
        .order('full_name');

      if (error) {
        console.error('Users query error:', error.message, error.code, error.details);
        throw error;
      }

      const activeSessionMap = new Map<string, { logged_in_at: string }>();
      try {
        const { data: sessions } = await supabase
          .from('user_sessions')
          .select('user_id, logged_in_at, logged_out_at')
          .is('logged_out_at', null)
          .gte('session_date', new Date().toISOString().split('T')[0]);
        sessions?.forEach(s => {
          activeSessionMap.set(s.user_id, { logged_in_at: s.logged_in_at });
        });
      } catch {}

      const counterMap = new Map<string, string>();
      try {
        const { data: counters } = await supabase
          .from('counters')
          .select('id, counter_number, assigned_user_id, station_id');
        counters?.forEach(c => {
          if (c.assigned_user_id) counterMap.set(c.assigned_user_id, c.counter_number || 'Guichet');
        });
      } catch {}

      const mapped: ConnectedUser[] = (usersData || []).map((u: any) => {
        const session = activeSessionMap.get(u.id);
        const isOnline = !!session;
        return {
          id: u.id,
          full_name: u.full_name || `${u.first_name || ''} ${u.last_name || ''}`.trim(),
          first_name: u.first_name || '',
          last_name: u.last_name || '',
          email: u.email,
          role: u.role,
          phone: u.phone,
          avatar_url: u.avatar_url,
          station_id: u.station_id,
          station_name: u.stations?.name || '',
          counter_name: counterMap.get(u.id) || '',
          is_online: isOnline,
          session_start: session?.logged_in_at,
          last_activity: session?.logged_in_at,
        };
      });

      mapped.sort((a, b) => {
        if (a.is_online && !b.is_online) return -1;
        if (!a.is_online && b.is_online) return 1;
        return a.full_name.localeCompare(b.full_name);
      });

      setUsers(mapped);
    } catch (err: any) {
      const msg = err?.message || 'Erreur inconnue';
      console.error('Connexion load error:', msg);
      toast.error(`Erreur: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(loadUsers, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, loadUsers]);

  const filteredUsers = users.filter(u => {
    const matchesSearch = !searchTerm || 
      u.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.station_name || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRole = roleFilter === 'all' || u.role === roleFilter;
    const matchesStatus = statusFilter === 'all' || 
      (statusFilter === 'online' && u.is_online) ||
      (statusFilter === 'offline' && !u.is_online);
    return matchesSearch && matchesRole && matchesStatus;
  });

  const onlineCount = users.filter(u => u.is_online).length;
  const offlineCount = users.filter(u => !u.is_online).length;

  const getSessionDuration = (start?: string) => {
    if (!start) return '';
    const mins = differenceInMinutes(new Date(), new Date(start));
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Connexions en direct</h1>
          <p className="text-sm text-gray-500 mt-1">Suivi des sessions utilisateurs actives</p>
        </div>
        <button
          onClick={() => { setLoading(true); loadUsers(); }}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium text-gray-700"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Actualiser
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center">
            <Wifi className="w-6 h-6 text-emerald-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{onlineCount}</p>
            <p className="text-sm text-gray-500">En ligne</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center">
            <WifiOff className="w-6 h-6 text-red-500" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{offlineCount}</p>
            <p className="text-sm text-gray-500">Hors ligne</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center">
            <Monitor className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{users.length}</p>
            <p className="text-sm text-gray-500">Total utilisateurs</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Rechercher par nom, email ou gare..."
              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 bg-white"
          >
            <option value="all">Tous les r{'\u00F4'}les</option>
            {MONITORED_ROLES.map(r => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {(['all', 'online', 'offline'] as const).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-4 py-2.5 text-sm font-medium transition-colors ${
                  statusFilter === s
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {s === 'all' ? 'Tous' : s === 'online' ? 'En ligne' : 'Hors ligne'}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
            />
            Auto-refresh
          </label>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Statut</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Utilisateur</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">R{'\u00F4'}le</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Point d'acc{'\u00E8'}s</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Dur{'\u00E9'}e session</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center">
                    <RefreshCw className="w-6 h-6 animate-spin text-gray-400 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">Chargement...</p>
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center">
                    <WifiOff className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">Aucun utilisateur trouv{'\u00E9'}</p>
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => (
                  <tr
                    key={u.id}
                    className="hover:bg-gray-50/80 transition-colors cursor-pointer group"
                    onClick={() => setChatTarget(u)}
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-center">
                        <div className="relative">
                          <div className={`w-3.5 h-3.5 rounded-full ${
                            u.is_online ? 'bg-emerald-500' : 'bg-red-400'
                          }`} />
                          {u.is_online && (
                            <div className="absolute inset-0 w-3.5 h-3.5 rounded-full bg-emerald-500 animate-ping opacity-30" />
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-gray-600 font-semibold text-sm flex-shrink-0">
                          {u.full_name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{u.full_name}</p>
                          <p className="text-xs text-gray-400">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                        ROLE_COLORS[u.role]?.bg || 'bg-gray-100'
                      } ${ROLE_COLORS[u.role]?.text || 'text-gray-700'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${ROLE_COLORS[u.role]?.dot || 'bg-gray-400'}`} />
                        {ROLE_LABELS[u.role] || u.role}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-col gap-0.5">
                        {u.station_name && (
                          <div className="flex items-center gap-1.5 text-xs text-gray-600">
                            <MapPin className="w-3 h-3 text-gray-400" />
                            {u.station_name}
                          </div>
                        )}
                        {u.counter_name && (
                          <div className="flex items-center gap-1.5 text-xs text-gray-500">
                            <Monitor className="w-3 h-3 text-gray-400" />
                            {u.counter_name}
                          </div>
                        )}
                        {!u.station_name && !u.counter_name && (
                          <span className="text-xs text-gray-400">-</span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      {u.is_online && u.session_start ? (
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-emerald-500" />
                          <span className="text-xs font-medium text-gray-700">
                            {getSessionDuration(u.session_start)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <button
                        onClick={(e) => { e.stopPropagation(); setChatTarget(u); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors text-xs font-medium opacity-0 group-hover:opacity-100"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        Chat
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Chat Panel */}
      {chatTarget && (
        <ChatPanel
          targetUser={{
            id: chatTarget.id,
            full_name: chatTarget.full_name,
            role: chatTarget.role,
            station_name: chatTarget.station_name,
          }}
          onClose={() => setChatTarget(null)}
        />
      )}
    </div>
  );
}
