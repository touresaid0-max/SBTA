import { useState, useEffect, useCallback } from 'react';
import {
  Archive, Database, HardDrive, Clock, Play, Search, X, RefreshCw,
  Settings, CheckCircle2, AlertCircle, CalendarClock, Boxes, Ticket,
  CreditCard, Bus, Loader2,
} from 'lucide-react';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../store/authStore';
import { formatCurrency } from '../../utils/formatCurrency';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import toast from 'react-hot-toast';

interface RunDetail {
  source_table: string;
  label: string;
  action: string;
  archived: number;
  deleted: number;
  status: string;
  error?: string;
}
interface ArchiveRun {
  id: string;
  run_type: string;
  status: string;
  started_at: string;
  finished_at?: string;
  total_archived: number;
  total_purged: number;
  details: RunDetail[];
  error?: string;
}
interface Policy {
  source_table: string;
  label: string;
  category: string;
  action: string;
  retention_months: number;
  date_column: string;
  is_active: boolean;
  sort_order: number;
}
interface Dashboard {
  counts_by_type: Record<string, number>;
  total_archived: number;
  active_db_size_pretty: string;
  archive_size_pretty: string;
  last_run_at: string | null;
  schedule_label: string;
  last_runs: ArchiveRun[];
  policies: Policy[];
}
interface ArchivedRecord {
  id: string;
  source_table: string;
  source_id: string;
  reference: string | null;
  client_name: string | null;
  client_phone: string | null;
  amount: number | null;
  record_date: string | null;
  archived_at: string;
  data: Record<string, unknown>;
}

const CATEGORY_LABEL: Record<string, string> = {
  metier: 'Métier (archivé)',
  temporaire: 'Temporaire (purgé)',
  log: 'Journaux (purgés)',
};
const ACTION_COLOR: Record<string, string> = {
  archive: '#0B7439',
  purge: '#D97706',
  keep: '#6B7280',
};

function fmtDate(d?: string | null) {
  if (!d) return '—';
  try {
    return format(new Date(d), 'dd MMM yyyy HH:mm', { locale: fr });
  } catch {
    return '—';
  }
}

export default function Archives() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';

  const [tab, setTab] = useState<'dashboard' | 'search' | 'config'>('dashboard');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_archive_dashboard');
    if (error) {
      toast.error("Impossible de charger le tableau de bord des archives");
      setDashboard(null);
    } else {
      setDashboard(data as Dashboard);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const runNow = async () => {
    if (!isAdmin) return;
    if (!window.confirm(
      "Lancer l'archivage maintenant ?\n\nLes données plus anciennes que la durée de conservation configurée seront déplacées vers les archives (consultables) et retirées des tables actives."
    )) return;
    setRunning(true);
    const { error } = await supabase.rpc('run_archive', { p_run_type: 'manual' });
    if (error) {
      toast.error(error.message || "Échec de l'archivage");
    } else {
      toast.success('Archivage terminé');
      await loadDashboard();
    }
    setRunning(false);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-xl"
            style={{ backgroundColor: 'var(--primary-light, #E7F6EC)' }}
          >
            <Archive className="h-6 w-6" style={{ color: 'var(--primary)' }} />
          </div>
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              Archives
            </h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Archivage intelligent des données historiques
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadDashboard}
            className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            <RefreshCw className="h-4 w-4" /> Actualiser
          </button>
          {isAdmin && (
            <button
              onClick={runNow}
              disabled={running}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: 'var(--primary)' }}
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Archiver maintenant
            </button>
          )}
        </div>
      </div>

      <div className="mb-6 flex gap-1 border-b" style={{ borderColor: 'var(--border)' }}>
        {([
          ['dashboard', 'Tableau de bord'],
          ['search', 'Consultation'],
          ['config', 'Configuration'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors"
            style={{
              color: tab === key ? 'var(--primary)' : 'var(--text-muted)',
              borderColor: tab === key ? 'var(--primary)' : 'transparent',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--primary)' }} />
        </div>
      ) : (
        <>
          {tab === 'dashboard' && <DashboardTab dashboard={dashboard} />}
          {tab === 'search' && <SearchTab policies={dashboard?.policies || []} />}
          {tab === 'config' && (
            <ConfigTab
              policies={dashboard?.policies || []}
              isAdmin={isAdmin}
              onChanged={loadDashboard}
            />
          )}
        </>
      )}
    </div>
  );
}

function KpiCard({ icon, label, value, sub }: {
  icon: React.ReactNode; label: string; value: string; sub?: string;
}) {
  return (
    <div
      className="rounded-xl border p-5"
      style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-center gap-2 mb-3" style={{ color: 'var(--text-muted)' }}>
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{value}</div>
      {sub && <div className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>{sub}</div>}
    </div>
  );
}

function DashboardTab({ dashboard }: { dashboard: Dashboard | null }) {
  if (!dashboard) {
    return (
      <div className="rounded-xl border p-8 text-center" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
        Aucune donnée disponible.
      </div>
    );
  }
  const c = dashboard.counts_by_type || {};
  const nf = (n: number) => (n || 0).toLocaleString('fr-FR');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={<Boxes className="h-4 w-4" />} label="Réservations archivées" value={nf(c.reservations)} />
        <KpiCard icon={<Ticket className="h-4 w-4" />} label="Billets en ligne archivés" value={nf(c.mobile_bookings)} />
        <KpiCard icon={<CreditCard className="h-4 w-4" />} label="Paiements archivés" value={nf(c.payments)} />
        <KpiCard icon={<Bus className="h-4 w-4" />} label="Voyages archivés" value={nf(c.schedules)} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={<Database className="h-4 w-4" />} label="Taille base active" value={dashboard.active_db_size_pretty} />
        <KpiCard icon={<HardDrive className="h-4 w-4" />} label="Taille des archives" value={dashboard.archive_size_pretty} sub={`${nf(dashboard.total_archived)} enregistrements`} />
        <KpiCard icon={<Clock className="h-4 w-4" />} label="Dernier archivage" value={dashboard.last_run_at ? fmtDate(dashboard.last_run_at) : 'Jamais'} />
        <KpiCard icon={<CalendarClock className="h-4 w-4" />} label="Prochain archivage" value={dashboard.schedule_label} />
      </div>

      <div className="rounded-xl border" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="border-b px-5 py-3" style={{ borderColor: 'var(--border)' }}>
          <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Derniers archivages</h3>
        </div>
        {dashboard.last_runs.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            Aucun archivage exécuté pour le moment.
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {dashboard.last_runs.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="flex items-center gap-3">
                  {r.status === 'completed' ? (
                    <CheckCircle2 className="h-5 w-5" style={{ color: '#0B7439' }} />
                  ) : r.status === 'failed' ? (
                    <AlertCircle className="h-5 w-5" style={{ color: '#AF3029' }} />
                  ) : (
                    <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--text-muted)' }} />
                  )}
                  <div>
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {fmtDate(r.started_at)}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {r.run_type === 'auto' ? 'Automatique' : 'Manuel'}
                    </div>
                  </div>
                </div>
                <div className="text-right text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <span className="font-semibold" style={{ color: '#0B7439' }}>{r.total_archived}</span> archivés
                  {' · '}
                  <span className="font-semibold" style={{ color: '#D97706' }}>{r.total_purged}</span> purgés
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SearchTab({ policies }: { policies: Policy[] }) {
  const [term, setTerm] = useState('');
  const [source, setSource] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [rows, setRows] = useState<ArchivedRecord[]>([]);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<ArchivedRecord | null>(null);

  const archivableSources = policies.filter((p) => p.action === 'archive');
  const labelOf = (t: string) => policies.find((p) => p.source_table === t)?.label || t;

  const runSearch = useCallback(async () => {
    setBusy(true);
    let q = supabase
      .from('archived_records')
      .select('*', { count: 'exact' })
      .order('archived_at', { ascending: false })
      .limit(200);

    if (source !== 'all') q = q.eq('source_table', source);
    const t = term.trim();
    if (t) {
      const like = `%${t}%`;
      q = q.or(`reference.ilike.${like},client_name.ilike.${like},client_phone.ilike.${like}`);
    }
    if (dateFrom) q = q.gte('record_date', dateFrom);
    if (dateTo) q = q.lte('record_date', `${dateTo}T23:59:59`);

    const { data, error, count: cnt } = await q;
    if (error) {
      toast.error('Erreur lors de la recherche');
      setRows([]);
      setCount(0);
    } else {
      setRows((data as ArchivedRecord[]) || []);
      setCount(cnt || 0);
    }
    setBusy(false);
  }, [term, source, dateFrom, dateTo]);

  useEffect(() => {
    runSearch();
  }, [runSearch]);

  const reset = () => {
    setTerm(''); setSource('all'); setDateFrom(''); setDateTo('');
  };

  return (
    <div className="space-y-4">
      <div
        className="rounded-xl border p-4"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative lg:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'var(--text-muted)' }} />
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="N° ticket, référence paiement, client, téléphone..."
              className="w-full rounded-lg border py-2.5 pl-9 pr-9 text-sm focus:outline-none focus:ring-2"
              style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            />
            {term && (
              <button onClick={() => setTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                <X className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
              </button>
            )}
          </div>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="rounded-lg border py-2.5 px-3 text-sm focus:outline-none focus:ring-2"
            style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          >
            <option value="all">Tous les types</option>
            {archivableSources.map((p) => (
              <option key={p.source_table} value={p.source_table}>{p.label}</option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <input
              type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="w-full rounded-lg border py-2.5 px-2 text-sm focus:outline-none focus:ring-2"
              style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            />
            <span style={{ color: 'var(--text-muted)' }}>→</span>
            <input
              type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="w-full rounded-lg border py-2.5 px-2 text-sm focus:outline-none focus:ring-2"
              style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            />
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {busy ? 'Recherche...' : `${count.toLocaleString('fr-FR')} résultat(s)`}
          </span>
          <button onClick={reset} className="text-xs font-medium" style={{ color: 'var(--primary)' }}>
            Réinitialiser
          </button>
        </div>
      </div>

      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                <th className="px-4 py-3 text-left font-medium">Type</th>
                <th className="px-4 py-3 text-left font-medium">Référence</th>
                <th className="px-4 py-3 text-left font-medium">Client</th>
                <th className="px-4 py-3 text-left font-medium">Téléphone</th>
                <th className="px-4 py-3 text-right font-medium">Montant</th>
                <th className="px-4 py-3 text-left font-medium">Date</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !busy ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center" style={{ color: 'var(--text-muted)' }}>
                    Aucune archive trouvée.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{labelOf(r.source_table)}</td>
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>{r.reference || '—'}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{r.client_name || '—'}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{r.client_phone || '—'}</td>
                    <td className="px-4 py-3 text-right" style={{ color: 'var(--text-secondary)' }}>{r.amount != null ? formatCurrency(r.amount) : '—'}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{r.record_date ? fmtDate(r.record_date) : '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => setDetail(r)} className="text-xs font-medium" style={{ color: 'var(--primary)' }}>
                        Détails
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {detail && <DetailModal record={detail} label={labelOf(detail.source_table)} onClose={() => setDetail(null)} />}
    </div>
  );
}

function DetailModal({ record, label, onClose }: { record: ArchivedRecord; label: string; onClose: () => void }) {
  const entries = Object.entries(record.data || {});
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-2xl border flex flex-col"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>{label}</h3>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Archivé le {fmtDate(record.archived_at)}</p>
          </div>
          <button onClick={onClose}><X className="h-5 w-5" style={{ color: 'var(--text-muted)' }} /></button>
        </div>
        <div className="overflow-y-auto p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
            {entries.map(([k, v]) => (
              <div key={k} className="min-w-0">
                <div className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{k}</div>
                <div className="text-sm break-words" style={{ color: 'var(--text-primary)' }}>
                  {v === null || v === undefined || v === ''
                    ? '—'
                    : typeof v === 'object'
                    ? JSON.stringify(v)
                    : String(v)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfigTab({ policies, isAdmin, onChanged }: {
  policies: Policy[]; isAdmin: boolean; onChanged: () => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);

  const grouped: Record<string, Policy[]> = { metier: [], temporaire: [], log: [] };
  policies.forEach((p) => { (grouped[p.category] ||= []).push(p); });

  const updatePolicy = async (source_table: string, patch: Partial<Policy>) => {
    if (!isAdmin) return;
    setSaving(source_table);
    const { error } = await supabase.from('archive_policies').update(patch).eq('source_table', source_table);
    if (error) toast.error("Modification refusée");
    else { toast.success('Mis à jour'); await onChanged(); }
    setSaving(null);
  };

  return (
    <div className="space-y-6">
      {!isAdmin && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
          La configuration est en lecture seule. Seul un administrateur peut la modifier.
        </div>
      )}
      {(['metier', 'temporaire', 'log'] as const).map((cat) => (
        <div key={cat} className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="border-b px-5 py-3 flex items-center gap-2" style={{ borderColor: 'var(--border)' }}>
            <Settings className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
            <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>{CATEGORY_LABEL[cat]}</h3>
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {(grouped[cat] || []).map((p) => (
              <div key={p.source_table} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{p.label}</span>
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase text-white"
                      style={{ backgroundColor: ACTION_COLOR[p.action] }}
                    >
                      {p.action === 'archive' ? 'Archivage' : p.action === 'purge' ? 'Purge' : 'Conservé'}
                    </span>
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Table {p.source_table} · ancienneté sur {p.date_column}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    Conservation
                    <input
                      type="number" min={0} defaultValue={p.retention_months} disabled={!isAdmin || saving === p.source_table}
                      onBlur={(e) => {
                        const v = parseInt(e.target.value, 10);
                        if (!Number.isNaN(v) && v !== p.retention_months) updatePolicy(p.source_table, { retention_months: v });
                      }}
                      className="w-16 rounded-lg border px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                    />
                    mois
                  </label>
                  <button
                    onClick={() => updatePolicy(p.source_table, { is_active: !p.is_active })}
                    disabled={!isAdmin || saving === p.source_table}
                    className="relative h-6 w-11 rounded-full transition-colors disabled:opacity-50"
                    style={{ backgroundColor: p.is_active ? 'var(--primary)' : 'var(--border)' }}
                    aria-label="Activer / désactiver"
                  >
                    <span
                      className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all"
                      style={{ left: p.is_active ? '22px' : '2px' }}
                    />
                  </button>
                </div>
              </div>
            ))}
            {(grouped[cat] || []).length === 0 && (
              <div className="px-5 py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                Aucune règle dans cette catégorie.
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
