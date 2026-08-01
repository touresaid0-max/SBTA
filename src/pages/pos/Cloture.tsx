import { useState, useEffect, useCallback, useMemo } from 'react';
import { } from 'react-router-dom';
import POSLayout from '@/components/pos/POSLayout';
import { usePOSSession } from '@/services/pos/POSSessionContext';
import {
  getAllDeparts, getDepartById, cloturerDepart, computeSolde,
  type DepartRecord,
} from '@/services/pos/departService';
import { getTicketsForDepart, type TicketRecord } from '@/services/pos/ticketService';
import { getBagagesForDepart, type BagageRecord } from '@/services/pos/bagageService';
import { getDepensesForDepart, type DepenseRecord } from '@/services/pos/depenseService';
import { syncNow } from '@/services/pos/syncService';
import { db } from '@/services/pos/db';
import { useSyncStatus } from '@/services/pos/useSyncStatus';
import { formatCurrency } from '@/utils/formatCurrency';
import {
  AlertCircle, CheckCircle, Loader2, Lock, UploadCloud,
  Ticket as TicketIcon, Package, Wallet,
  TrendingDown,
} from 'lucide-react';

export default function POSCloture() {
  const { session } = usePOSSession();
  const { isOnline, pendingCount, syncing } = useSyncStatus();

  const [departs, setDeparts] = useState<DepartRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selected, setSelected] = useState<DepartRecord | null>(null);
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [bagages, setBagages] = useState<BagageRecord[]>([]);
  const [depenses, setDepenses] = useState<DepenseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [syncResult, setSyncResult] = useState<{ synced: number; failed: number } | null>(null);

  const loadData = useCallback(async () => {
    try {
      const all = await getAllDeparts(session?.station_id, session?.counter_id);
      const active = all.filter(d => !d.cancelled);
      setDeparts(active);
      if (active.length > 0 && !selectedId) setSelectedId(active[0].id);
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    (async () => {
      if (!selectedId) { setSelected(null); return; }
      const d = await getDepartById(selectedId);
      setSelected(d ?? null);
      if (d) {
        const [t, b, dp] = await Promise.all([
          getTicketsForDepart(selectedId),
          getBagagesForDepart(selectedId),
          getDepensesForDepart(selectedId),
        ]);
        setTickets(t.filter(x => x.status !== 'cancelled'));
        setBagages(b);
        setDepenses(dp.filter(x => x.description !== '__deleted__'));
      }
    })();
  }, [selectedId]);

  const solde = useMemo(() => selected ? computeSolde(selected) : 0, [selected]);

  const handleClotureOnly = async () => {
    if (!selectedId) return;
    setActionLoading(true);
    setError('');
    try {
      await cloturerDepart(selectedId, session?.full_name);
      const d = await getDepartById(selectedId);
      setSelected(d ?? null);
      setDeparts(prev => prev.map(x => x.id === selectedId ? { ...x, cloture: true } : x));
      setSuccess('Départ clôturé — verrouillé en lecture seule');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err?.message ?? 'Erreur');
    } finally {
      setActionLoading(false);
    }
  };

  const handleClotureAndSync = async () => {
    if (!selectedId) return;
    setActionLoading(true);
    setError('');
    setSyncResult(null);
    try {
      await cloturerDepart(selectedId, session?.full_name);
      const d = await getDepartById(selectedId);
      setSelected(d ?? null);
      setDeparts(prev => prev.map(x => x.id === selectedId ? { ...x, cloture: true } : x));

      if (!isOnline) {
        setSuccess('Départ clôturé. Synchro en attente — réseau coupé. Les opérations seront poussées automatiquement à la reconnexion.');
        setTimeout(() => setSuccess(''), 4000);
        return;
      }

      const result = await syncNow();
      setSyncResult(result);
      const remaining = await db.sync_queue.where('status').anyOf(['pending', 'error']).count();
      if (result.failed === 0) {
        setSuccess(`Départ clôturé et ${result.synced} opération(s) synchronisée(s). File vide.`);
      } else {
        setSuccess(`Départ clôturé. ${result.synced} synchronisée(s), ${result.failed} échec(s). ${remaining} en attente.`);
      }
      setTimeout(() => setSuccess(''), 5000);
    } catch (err: any) {
      setError(err?.message ?? 'Erreur');
    } finally {
      setActionLoading(false);
    }
  };

  const fieldInput = 'w-full px-3 py-2.5 rounded-lg border-2 text-sm outline-none transition-colors';
  const fieldStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)' as const };

  if (loading) {
    return (
      <POSLayout showBack stationName={session?.station_name} activeRoute="Clôture">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--primary)' }} />
        </div>
      </POSLayout>
    );
  }

  return (
    <POSLayout showBack stationName={session?.station_name} activeRoute="Clôture">
      <div className="max-w-3xl mx-auto">
        {error && (
          <div className="rounded-xl px-3 py-2.5 mb-4 flex items-start gap-2 text-sm" style={{ backgroundColor: 'var(--danger-light)', color: 'var(--danger)' }}>
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="rounded-xl px-3 py-2.5 mb-4 flex items-center gap-2 text-sm font-medium" style={{ backgroundColor: 'var(--success-light)', color: 'var(--success)' }}>
            <CheckCircle className="w-4 h-4" /> {success}
          </div>
        )}

        {/* Depart selection */}
        <div className="rounded-xl p-4 mb-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <label className="block text-xs font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>Sélectionner un départ</label>
          <select value={selectedId} onChange={e => setSelectedId(e.target.value)} className={fieldInput} style={fieldStyle}>
            <option value="">Sélectionner...</option>
            {departs.map(d => (
              <option key={d.id} value={d.id}>
                #{d.route_number} — {d.route_name} — {d.departure_date} {d.departure_time}
                {d.cloture ? ' [CLÔTURÉ]' : ''}
              </option>
            ))}
          </select>
        </div>

        {selected && (
          <>
            {/* Summary */}
            <div className="rounded-xl p-4 mb-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                  Départ #{selected.route_number} — {selected.route_name}
                </h3>
                {selected.cloture && (
                  <span className="px-2 py-1 rounded-full text-xs font-bold flex items-center gap-1" style={{ backgroundColor: 'var(--danger-light)', color: 'var(--danger)' }}>
                    <Lock className="w-3 h-3" /> Clôturé
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg p-2.5" style={{ backgroundColor: 'var(--surface-raised)' }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <TicketIcon className="w-3.5 h-3.5" style={{ color: 'var(--info)' }} />
                    <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>MT Ticket</p>
                  </div>
                  <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(selected.mt_ticket)}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{tickets.length} ticket(s)</p>
                </div>
                <div className="rounded-lg p-2.5" style={{ backgroundColor: 'var(--surface-raised)' }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Package className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
                    <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>MT Bagage</p>
                  </div>
                  <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(selected.mt_bagage)}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{bagages.length} bagage(s)</p>
                </div>
                <div className="rounded-lg p-2.5" style={{ backgroundColor: 'var(--surface-raised)' }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <TrendingDown className="w-3.5 h-3.5" style={{ color: 'var(--danger)' }} />
                    <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Tot Dépense</p>
                  </div>
                  <p className="text-sm font-bold" style={{ color: 'var(--danger)' }}>{formatCurrency(selected.tot_depense)}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{depenses.length} dépense(s)</p>
                </div>
                <div className="rounded-lg p-2.5" style={{ backgroundColor: 'var(--surface-raised)' }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Wallet className="w-3.5 h-3.5" style={{ color: 'var(--success)' }} />
                    <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Solde</p>
                  </div>
                  <p className="text-sm font-bold" style={{ color: solde >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatCurrency(solde)}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Caisse nette</p>
                </div>
              </div>
            </div>

            {/* Sync status */}
            <div className="rounded-xl p-4 mb-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <UploadCloud className="w-5 h-5" style={{ color: pendingCount > 0 ? 'var(--warning)' : 'var(--success)' }} />
                  <div>
                    <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>File de synchronisation</p>
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {pendingCount > 0 ? `${pendingCount} opération(s) en attente` : 'File vide — tout est synchronisé'}
                      {!isOnline && ' · Hors ligne'}
                    </p>
                  </div>
                </div>
                {syncing && <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--primary)' }} />}
              </div>
              {syncResult && (
                <div className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Dernière synchro: {syncResult.synced} réussie(s), {syncResult.failed} échec(s)
                </div>
              )}
            </div>

            {/* Actions */}
            {!selected.cloture ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-4">
                <button
                  onClick={handleClotureOnly}
                  disabled={actionLoading}
                  className="py-4 rounded-xl font-bold text-base border-2 disabled:opacity-60 flex items-center justify-center gap-2"
                  style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                >
                  {actionLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Lock className="w-5 h-5" />}
                  Clôture départ
                </button>
                <button
                  onClick={handleClotureAndSync}
                  disabled={actionLoading}
                  className="py-4 rounded-xl font-bold text-white text-base disabled:opacity-60 flex items-center justify-center gap-2"
                  style={{ backgroundColor: 'var(--primary)' }}
                >
                  {actionLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <UploadCloud className="w-5 h-5" />}
                  Clôture + mise à jour web
                </button>
              </div>
            ) : (
              <div className="rounded-xl p-4 mb-4 text-center" style={{ backgroundColor: 'var(--surface)', border: '2px solid var(--border)' }}>
                <Lock className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Ce départ est clôturé</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                  Vente et bagages verrouillés. {selected.cloture_at && `Clôturé le ${new Date(selected.cloture_at).toLocaleString('fr-FR')}`}
                </p>
                {!isOnline && pendingCount > 0 && (
                  <button
                    onClick={handleClotureAndSync}
                    disabled={actionLoading || !isOnline}
                    className="mt-3 px-4 py-2 rounded-lg font-bold text-sm text-white disabled:opacity-60 flex items-center gap-2 mx-auto"
                    style={{ backgroundColor: 'var(--primary)' }}
                  >
                    {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                    Mettre à jour web maintenant
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </POSLayout>
  );
}
