import { useState, useEffect, useMemo } from 'react';
import { Search, Filter, RefreshCw, ScrollText, Lock, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../store/authStore';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import toast from 'react-hot-toast';

interface LogEntry {
  id: string;
  user_id?: string;
  target_id?: string;
  target_type?: string;
  action: string;
  description?: string;
  old_values?: Record<string, unknown>;
  new_values?: Record<string, unknown>;
  ip_address?: string;
  created_at: string;
  users?: { first_name?: string; last_name?: string; full_name?: string; email: string; role: string };
}

const OP_COLORS: Record<string, string> = {
  created: '#0B7439', insert: '#0B7439', login: '#0B7439',
  updated: '#D97706', update: '#D97706', role_changed: '#D97706', password_reset: '#D97706',
  deleted: '#AF3029', delete: '#AF3029', suspended: '#AF3029',
  logout: '#6B7280',
};

const opColor = (action: string) => {
  const key = action.toLowerCase();
  const match = Object.keys(OP_COLORS).find((k) => key.includes(k));
  return match ? OP_COLORS[match] : '#6B7280';
};

function getUserName(log: LogEntry) {
  if (!log.users) return '—';
  const u = log.users;
  return u.first_name ? `${u.first_name} ${u.last_name}` : u.full_name || u.email;
}

function PasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const email = useAuthStore((s) => s.user?.email);
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [checking, setChecking] = useState(false);

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setChecking(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        toast.error('Mot de passe incorrect');
        return;
      }
      onUnlock();
    } catch {
      toast.error('Erreur de vérification');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex items-center justify-center py-16">
      <form
        onSubmit={verify}
        className="w-full max-w-sm rounded-2xl border p-8 text-center"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div
          className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
          style={{ backgroundColor: 'var(--primary-light, #E7F6EC)' }}
        >
          <Lock className="h-7 w-7" style={{ color: 'var(--primary)' }} />
        </div>
        <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Accès protégé
        </h2>
        <p className="mt-1 mb-6 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Entrez votre mot de passe administrateur pour consulter le journal d'audit.
        </p>
        <div className="relative">
          <input
            type={show ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mot de passe"
            autoFocus
            className="w-full rounded-lg border px-4 py-3 pr-11 text-sm focus:outline-none focus:ring-2"
            style={{ borderColor: 'var(--border)' }}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2"
            aria-label={show ? 'Masquer' : 'Afficher'}
          >
            {show ? (
              <EyeOff className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
            ) : (
              <Eye className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
            )}
          </button>
        </div>
        <button
          type="submit"
          disabled={checking || !password}
          className="mt-4 w-full rounded-lg px-4 py-3 font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: 'var(--primary)' }}
        >
          {checking ? 'Vérification...' : 'Accéder'}
        </button>
      </form>
    </div>
  );
}

export default function AuditLogs() {
  const [unlocked, setUnlocked] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [tableFilter, setTableFilter] = useState('all');
  const [opFilter, setOpFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('');
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const [{ data, error }, { count }] = await Promise.all([
        supabase
          .from('activity_logs')
          .select('*, users(first_name, last_name, full_name, email, role)')
          .order('created_at', { ascending: false })
          .limit(500),
        supabase.from('activity_logs').select('*', { count: 'exact', head: true }),
      ]);
      if (error) throw error;
      setLogs(data || []);
      setTotalCount(count ?? (data?.length || 0));
    } catch (error) {
      toast.error("Erreur lors du chargement du journal d'audit");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (unlocked) loadLogs();
  }, [unlocked]);

  const tables = useMemo(
    () => [...new Set(logs.map((l) => l.target_type).filter(Boolean))] as string[],
    [logs],
  );
  const operations = useMemo(
    () => [...new Set(logs.map((l) => l.action).filter(Boolean))],
    [logs],
  );

  const filteredLogs = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return logs.filter((log) => {
      if (tableFilter !== 'all' && log.target_type !== tableFilter) return false;
      if (opFilter !== 'all' && log.action !== opFilter) return false;
      if (dateFilter && format(new Date(log.created_at), 'yyyy-MM-dd') !== dateFilter) return false;
      if (!q) return true;
      return [
        log.action,
        log.target_type,
        log.target_id,
        getUserName(log),
        log.description,
        log.users?.email,
      ].some((x) => (x ?? '').toString().toLowerCase().includes(q));
    });
  }, [logs, searchTerm, tableFilter, opFilter, dateFilter]);

  if (!unlocked) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Journal d'audit
          </h1>
          <p className="mt-1" style={{ color: 'var(--text-secondary)' }}>
            Historique des opérations sensibles du système
          </p>
        </div>
        <PasswordGate onUnlock={() => setUnlocked(true)} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Journal d'audit
          </h1>
          <p className="mt-1" style={{ color: 'var(--text-secondary)' }}>
            {totalCount.toLocaleString('fr-FR')} événements enregistrés
          </p>
        </div>
        <button
          onClick={loadLogs}
          disabled={loading}
          className="px-4 py-2 rounded-lg flex items-center gap-2 border disabled:opacity-50"
          style={{ borderColor: 'var(--border)' }}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} style={{ color: 'var(--primary)' }} />
          Actualiser
        </button>
      </div>

      <div className="rounded-xl p-6" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="flex gap-3 mb-4 flex-wrap items-center">
          <div className="flex-1 min-w-48 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Rechercher par action, table, utilisateur, ID..."
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border text-sm"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
            <Filter className="w-4 h-4" /> Filtres
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Table</label>
            <select
              value={tableFilter}
              onChange={(e) => setTableFilter(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border text-sm"
              style={{ borderColor: 'var(--border)' }}
            >
              <option value="all">Toutes les tables</option>
              {tables.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Opération</label>
            <select
              value={opFilter}
              onChange={(e) => setOpFilter(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border text-sm"
              style={{ borderColor: 'var(--border)' }}
            >
              <option value="all">Toutes les opérations</option>
              {operations.map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Date</label>
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border text-sm"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-32">
            <RefreshCw className="w-6 h-6 animate-spin" style={{ color: 'var(--primary)' }} />
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="text-center py-12">
            <ScrollText className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
            <p style={{ color: 'var(--text-secondary)' }}>Aucun événement trouvé</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border" style={{ borderColor: 'var(--border)' }}>
            {filteredLogs.map((log, idx) => (
              <div
                key={log.id}
                onClick={() => setSelectedLog(log)}
                className="flex items-start gap-4 p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                style={{ borderBottom: idx < filteredLogs.length - 1 ? '1px solid var(--border)' : 'none' }}
              >
                <div className="w-2 h-2 rounded-full mt-2 flex-shrink-0" style={{ backgroundColor: opColor(log.action) }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ backgroundColor: `${opColor(log.action)}18`, color: opColor(log.action) }}
                      >
                        {log.action.replace(/_/g, ' ')}
                      </span>
                      {log.target_type && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-mono" style={{ backgroundColor: 'var(--surface-raised, #F3F4F6)', color: 'var(--text-secondary)' }}>
                          {log.target_type}
                        </span>
                      )}
                      <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {getUserName(log)}
                      </span>
                      {log.users?.role && (
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>({log.users.role})</span>
                      )}
                    </div>
                    <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                      {format(new Date(log.created_at), 'dd MMM yyyy HH:mm', { locale: fr })}
                    </span>
                  </div>
                  {log.description && (
                    <p className="text-sm mt-1 truncate" style={{ color: 'var(--text-secondary)' }}>{log.description}</p>
                  )}
                  {log.target_id && (
                    <p className="text-xs mt-0.5 font-mono" style={{ color: 'var(--text-muted)' }}>ID: {log.target_id}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedLog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setSelectedLog(null)}>
          <div
            className="rounded-xl p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto"
            style={{ backgroundColor: 'var(--surface)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Détails de l'événement</h3>
              <button onClick={() => setSelectedLog(null)} style={{ color: 'var(--text-muted)' }}>✕</button>
            </div>
            <div className="space-y-3">
              {[
                { label: 'Opération', value: selectedLog.action.replace(/_/g, ' ') },
                { label: 'Table', value: selectedLog.target_type || '—' },
                { label: 'ID cible', value: selectedLog.target_id || '—' },
                { label: 'Utilisateur', value: getUserName(selectedLog) },
                { label: 'Rôle', value: selectedLog.users?.role || '—' },
                { label: 'Date', value: format(new Date(selectedLog.created_at), "dd MMMM yyyy 'à' HH:mm:ss", { locale: fr }) },
                { label: 'IP', value: selectedLog.ip_address ? String(selectedLog.ip_address) : '—' },
                { label: 'Description', value: selectedLog.description || '—' },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between gap-4 py-2 border-b" style={{ borderColor: 'var(--border)' }}>
                  <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</span>
                  <span className="text-sm text-right" style={{ color: 'var(--text-primary)' }}>{value}</span>
                </div>
              ))}
              {selectedLog.new_values && Object.keys(selectedLog.new_values).length > 0 && (
                <div>
                  <p className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Nouvelles valeurs</p>
                  <pre className="text-xs p-3 rounded-lg overflow-x-auto" style={{ backgroundColor: 'var(--surface-raised)', color: 'var(--text-secondary)' }}>
                    {JSON.stringify(selectedLog.new_values, null, 2)}
                  </pre>
                </div>
              )}
              {selectedLog.old_values && Object.keys(selectedLog.old_values).length > 0 && (
                <div>
                  <p className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Anciennes valeurs</p>
                  <pre className="text-xs p-3 rounded-lg overflow-x-auto" style={{ backgroundColor: 'var(--surface-raised)', color: 'var(--text-secondary)' }}>
                    {JSON.stringify(selectedLog.old_values, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
