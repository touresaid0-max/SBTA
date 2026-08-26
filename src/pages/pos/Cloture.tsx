import { useState, useEffect, useCallback, useMemo } from 'react';
import POSLayout from '@/components/pos/POSLayout';
import { usePOSSession } from '@/services/pos/POSSessionContext';
import {
  getAllDeparts, getDepartById, cloturerDepart, computeSolde,
  type DepartRecord,
} from '@/services/pos/departService';
import { getTicketsForDepart, type TicketRecord } from '@/services/pos/ticketService';
import { getBagagesForDepart, type BagageRecord } from '@/services/pos/bagageService';
import { getDepensesForDepart, getDepenseTotalForDepart, type DepenseRecord } from '@/services/pos/depenseService';
import { formatCurrency } from '@/utils/formatCurrency';
import ChangeRequestButton from '@/components/shared/ChangeRequestButton';
import {
  AlertCircle, CheckCircle, Loader2, Lock,
  Ticket as TicketIcon, Package, Wallet,
  TrendingDown, Calendar as CalendarIcon, CheckSquare, Square,
} from 'lucide-react';

export default function POSCloture() {
  const { session } = usePOSSession();

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

  // Date filter — defaults to today
  const todayStr = new Date().toISOString().slice(0, 10);
  const [filterDate, setFilterDate] = useState(todayStr);

  // Multi-select for batch clôture
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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
  }, [session?.station_id, session?.counter_id]);

  useEffect(() => { loadData(); }, [loadData]);

  // Filter departs by selected date
  const filteredDeparts = useMemo(() => {
    return departs.filter(d => d.departure_date === filterDate);
  }, [departs, filterDate]);

  // Reset multi-select when date changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [filterDate]);

  const [liveTotDepense, setLiveTotDepense] = useState(0);

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
        const visibleDepenses = dp.filter(x => x.description !== '__deleted__');
        setTickets(t.filter(x => x.status !== 'cancelled'));
        setBagages(b);
        setDepenses(visibleDepenses);
        setLiveTotDepense(visibleDepenses.reduce((sum, x) => sum + x.amount, 0));
      }
    })();
  }, [selectedId]);

  const solde = useMemo(() => selected ? (selected.mt_ticket + selected.mt_bagage - liveTotDepense) : 0, [selected, liveTotDepense]);

  // Toggle individual depart selection for batch
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    const closable = filteredDeparts.filter(d => !d.cloture);
    if (selectedIds.size === closable.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(closable.map(d => d.id)));
    }
  };

  const selectedClosableCount = useMemo(() => {
    return filteredDeparts.filter(d => !d.cloture && selectedIds.has(d.id)).length;
  }, [filteredDeparts, selectedIds]);

  // Batch clôture
  const handleBatchCloture = async () => {
    const toClose = filteredDeparts.filter(d => !d.cloture && selectedIds.has(d.id));
    if (toClose.length === 0) {
      setError('Aucun départ sélectionné à clôturer');
      return;
    }
    setActionLoading(true);
    setError('');
    let successCount = 0;
    let failCount = 0;
    for (const d of toClose) {
      try {
        await cloturerDepart(d.id, session?.full_name);
        successCount++;
      } catch {
        failCount++;
      }
    }
    // Refresh state
    setDeparts(prev => prev.map(x => selectedIds.has(x.id) ? { ...x, cloture: true } : x));
    if (selectedId && selectedIds.has(selectedId)) {
      const d = await getDepartById(selectedId);
      setSelected(d ?? null);
    }
    setSelectedIds(new Set());
    setActionLoading(false);
    if (failCount === 0) {
      setSuccess(`${successCount} départ${successCount > 1 ? 's' : ''} clôturé${successCount > 1 ? 's' : ''} — verrouillé${successCount > 1 ? 's' : ''} en lecture seule`);
    } else {
      setError(`${successCount} clôturé(s), ${failCount} échec(s)`);
    }
    setTimeout(() => { setSuccess(''); setError(''); }, 4000);
  };

  // Single clôture (detail view)
  const handleCloture = async () => {
    if (!selectedId) return;
    setActionLoading(true);
    setError('');
    try {
      await cloturerDepart(selectedId, session?.full_name);
      const d = await getDepartById(selectedId);
      setSelected(d ?? null);
      const dp = await getDepensesForDepart(selectedId);
      const visibleDepenses = dp.filter(x => x.description !== '__deleted__');
      setDepenses(visibleDepenses);
      setLiveTotDepense(visibleDepenses.reduce((sum, x) => sum + x.amount, 0));
      setDeparts(prev => prev.map(x => x.id === selectedId ? { ...x, cloture: true } : x));
      setSuccess('Départ clôturé — verrouillé en lecture seule');
      setTimeout(() => setSuccess(''), 3000);
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

        {/* Date filter */}
        <div className="rounded-xl p-4 mb-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <label className="block text-xs font-bold mb-1 flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
            <CalendarIcon className="w-3.5 h-3.5" /> Sélectionner la période
          </label>
          <input
            type="date"
            value={filterDate}
            onChange={e => setFilterDate(e.target.value)}
            className={fieldInput}
            style={fieldStyle}
          />
          <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
            {filteredDeparts.length} départ{filteredDeparts.length > 1 ? 's' : ''} trouvé{filteredDeparts.length > 1 ? 's' : ''} pour le {new Date(filterDate).toLocaleDateString('fr-FR')}
          </p>
        </div>

        {/* Multi-select depart list */}
        <div className="rounded-xl p-4 mb-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between mb-3">
            <label className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
              Sélectionner les départs à clôturer
            </label>
            <button
              onClick={selectAll}
              className="text-xs font-bold flex items-center gap-1.5 px-2 py-1 rounded-lg transition-colors"
              style={{ color: 'var(--primary)', border: '1px solid var(--primary)' }}
            >
              {selectedIds.size === filteredDeparts.filter(d => !d.cloture).length && selectedIds.size > 0 ? (
                <><Square className="w-3.5 h-3.5" /> Tout désélectionner</>
              ) : (
                <><CheckSquare className="w-3.5 h-3.5" /> Tout sélectionner</>
              )}
            </button>
          </div>

          {filteredDeparts.length === 0 ? (
            <p className="text-sm text-center py-6" style={{ color: 'var(--text-muted)' }}>
              Aucun départ pour cette date
            </p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {filteredDeparts.map(d => (
                <label
                  key={d.id}
                  className="flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-colors"
                  style={{
                    backgroundColor: selectedIds.has(d.id) ? 'var(--primary-light, #EFF6FF)' : 'var(--surface-raised)',
                    border: `1px solid ${selectedIds.has(d.id) ? 'var(--primary)' : 'var(--border)'}`,
                    opacity: d.cloture ? 0.6 : 1,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(d.id)}
                    disabled={d.cloture}
                    onChange={() => toggleSelect(d.id)}
                    className="w-4 h-4 flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                      #{d.route_number} — {d.route_name} — {d.departure_time}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {d.seats_sold}/{d.seats_total} sièges · {formatCurrency(d.mt_ticket + d.mt_bagage)}
                    </p>
                  </div>
                  {d.cloture && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold flex items-center gap-1 flex-shrink-0" style={{ backgroundColor: 'var(--danger-light)', color: 'var(--danger)' }}>
                      <Lock className="w-3 h-3" /> Clôturé
                    </span>
                  )}
                </label>
              ))}
            </div>
          )}

          {/* Batch clôture button */}
          {selectedClosableCount > 0 && (
            <button
              onClick={handleBatchCloture}
              disabled={actionLoading}
              className="w-full mt-3 py-3.5 rounded-xl font-bold text-white text-sm disabled:opacity-60 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
              style={{ backgroundColor: 'var(--primary)' }}
            >
              {actionLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Lock className="w-5 h-5" />}
              Clôturer {selectedClosableCount} départ{selectedClosableCount > 1 ? 's' : ''} sélectionné{selectedClosableCount > 1 ? 's' : ''}
            </button>
          )}
        </div>

        {/* Detail view for a single depart */}
        <div className="rounded-xl p-4 mb-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <label className="block text-xs font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>Consulter un départ (détail)</label>
          <select value={selectedId} onChange={e => setSelectedId(e.target.value)} className={fieldInput} style={fieldStyle}>
            <option value="">Sélectionner...</option>
            {filteredDeparts.map(d => (
              <option key={d.id} value={d.id}>
                #{d.route_number} — {d.route_name} — {d.departure_time}
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
                  <p className="text-sm font-bold" style={{ color: 'var(--danger)' }}>{formatCurrency(liveTotDepense)}</p>
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

            {/* Actions */}
            {!selected.cloture ? (
              <div className="pb-4">
                <button
                  onClick={handleCloture}
                  disabled={actionLoading}
                  className="w-full py-4 rounded-xl font-bold text-white text-base disabled:opacity-60 flex items-center justify-center gap-2"
                  style={{ backgroundColor: 'var(--primary)' }}
                >
                  {actionLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Lock className="w-5 h-5" />}
                  Clôturer le départ
                </button>
              </div>
            ) : (
              <div className="rounded-xl p-4 mb-4" style={{ backgroundColor: 'var(--surface)', border: '2px solid var(--border)' }}>
                <Lock className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
                <p className="text-sm font-bold text-center" style={{ color: 'var(--text-primary)' }}>Ce départ est clôturé</p>
                <p className="text-xs mt-1 text-center" style={{ color: 'var(--text-secondary)' }}>
                  Vente et bagages verrouillés. {selected.cloture_at && `Clôturé le ${new Date(selected.cloture_at).toLocaleString('fr-FR')}`}
                </p>
                <p className="text-xs mt-2 text-center" style={{ color: 'var(--text-muted)' }}>
                  Pour déclôturer, passez par la procédure « Demande modif./supp. »
                </p>
                <div className="flex justify-center mt-3">
                  <ChangeRequestButton
                    operationType="cloture"
                    operationId={selected.id}
                    operationTable="schedules"
                    operationReference={`Départ #${selected.route_number} — ${selected.route_name} — ${selected.departure_date}`}
                    operationSnapshot={{
                      id: selected.id,
                      route_number: selected.route_number,
                      route_name: selected.route_name,
                      departure_date: selected.departure_date,
                      departure_time: selected.departure_time,
                      cloture: selected.cloture,
                      cloture_at: selected.cloture_at,
                      cloture_by: selected.cloture_by,
                      mt_ticket: selected.mt_ticket,
                      mt_bagage: selected.mt_bagage,
                      tot_depense: selected.tot_depense,
                      solde: selected.solde,
                    }}
                    stationId={session?.station_id}
                    stationName={session?.station_name}
                    label="Demande modif./supp. pour déclôturer"
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </POSLayout>
  );
}
