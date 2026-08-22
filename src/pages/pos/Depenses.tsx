import { useState, useEffect, useCallback, useMemo } from 'react';
import { } from 'react-router-dom';
import POSLayout from '@/components/pos/POSLayout';
import { usePOSSession } from '@/services/pos/POSSessionContext';
import { getAllDeparts, getDepartById, computeSolde, type DepartRecord } from '@/services/pos/departService';
import { createDepense, getDepensesForDepart, getDepenseTotalForDepart, type DepenseRecord } from '@/services/pos/depenseService';
import { formatCurrency } from '@/utils/formatCurrency';
import {
  AlertCircle, CheckCircle, Loader2, Plus,
  Receipt,
} from 'lucide-react';
import ChangeRequestButton from '@/components/shared/ChangeRequestButton';

const EXPENSE_TYPES = [
  'Carburant compl.',
  'Rations',
  'Péages',
  'Autre',
];

export default function POSDepenses() {
  const { session } = usePOSSession();

  const [departs, setDeparts] = useState<DepartRecord[]>([]);
  const [selectedDepartId, setSelectedDepartId] = useState('');
  const [selectedDepart, setSelectedDepart] = useState<DepartRecord | null>(null);
  const [depenses, setDepenses] = useState<DepenseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [liveTotDepense, setLiveTotDepense] = useState(0);

  // Form state
  const [type, setType] = useState(EXPENSE_TYPES[0]);
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState(0);
  const [description, setDescription] = useState('');
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split('T')[0]);

  const loadData = useCallback(async () => {
    try {
      const all = await getAllDeparts(session?.station_id, session?.counter_id);
      const active = all.filter(d => !d.cancelled && !d.cloture);
      setDeparts(active);
      if (active.length > 0 && !selectedDepartId) {
        setSelectedDepartId(active[0].id);
      }
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }, [session?.station_id, session?.counter_id]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    (async () => {
      if (!selectedDepartId) { setSelectedDepart(null); setDepenses([]); setLiveTotDepense(0); return; }
      const d = await getDepartById(selectedDepartId);
      setSelectedDepart(d ?? null);
      const deps = await getDepensesForDepart(selectedDepartId);
      const visible = deps.filter(x => x.description !== '__deleted__');
      setDepenses(visible);
      setLiveTotDepense(visible.reduce((sum, x) => sum + x.amount, 0));
    })();
  }, [selectedDepartId]);

  const solde = useMemo(() => {
    if (!selectedDepart) return 0;
    return selectedDepart.mt_ticket + selectedDepart.mt_bagage - liveTotDepense;
  }, [selectedDepart, liveTotDepense]);

  const handleAdd = async () => {
    if (!selectedDepartId) { setError('Veuillez sélectionner un départ'); return; }
    if (amount <= 0) { setError('Montant invalide'); return; }
    if (!label.trim()) { setError('Veuillez saisir un libellé'); return; }

    setSaving(true);
    setError('');
    try {
      await createDepense({
        departId: selectedDepartId,
        type,
        label: label.trim(),
        amount,
        description: description.trim(),
        stationId: session?.station_id ?? '',
        busId: selectedDepart?.bus_id,
        counterId: selectedDepart?.counter_id ?? session?.counter_id,
        expenseDate,
      });

      const [d, deps] = await Promise.all([
        getDepartById(selectedDepartId),
        getDepensesForDepart(selectedDepartId),
      ]);
      const visible = deps.filter(x => x.description !== '__deleted__');
      setSelectedDepart(d ?? null);
      setDepenses(visible);
      setLiveTotDepense(visible.reduce((sum, x) => sum + x.amount, 0));

      setSuccess('Dépense enregistrée');
      setLabel('');
      setAmount(0);
      setDescription('');
      setTimeout(() => setSuccess(''), 2500);
    } catch (err: any) {
      setError(err?.message ?? 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  const fieldLabel = 'block text-xs font-bold mb-1';
  const fieldInput = 'w-full px-3 py-2.5 rounded-lg border-2 text-sm outline-none transition-colors';
  const fieldStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)' as const };

  if (loading) {
    return (
      <POSLayout showBack stationName={session?.station_name} activeRoute="Dépenses">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--primary)' }} />
        </div>
      </POSLayout>
    );
  }

  return (
    <POSLayout showBack stationName={session?.station_name} activeRoute="Dépenses">
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

        {/* Departure summary */}
        <div className="rounded-xl p-4 mb-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <div>
              <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>MT Ticket</p>
              <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(selectedDepart?.mt_ticket ?? 0)}</p>
            </div>
            <div>
              <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>MT Bagage</p>
              <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(selectedDepart?.mt_bagage ?? 0)}</p>
            </div>
            <div>
              <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Tot Dépense</p>
              <p className="text-sm font-bold" style={{ color: 'var(--danger)' }}>{formatCurrency(liveTotDepense)}</p>
            </div>
            <div>
              <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Solde</p>
              <p className="text-sm font-bold" style={{ color: solde >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatCurrency(solde)}</p>
            </div>
          </div>
          <div>
            <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Départ</label>
            <select
              value={selectedDepartId}
              onChange={e => setSelectedDepartId(e.target.value)}
              className={fieldInput}
              style={fieldStyle}
            >
              <option value="">Sélectionner un départ...</option>
              {departs.map(d => (
                <option key={d.id} value={d.id}>
                  #{d.route_number} — {d.route_name} — {d.departure_date} {d.departure_time}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Form */}
          <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h3 className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <Plus className="w-4 h-4" /> Nouvelle dépense
            </h3>
            <div className="space-y-3">
              <div>
                <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Type</label>
                <select value={type} onChange={e => setType(e.target.value)} className={fieldInput} style={fieldStyle}>
                  {EXPENSE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Libellé</label>
                <input type="text" value={label} onChange={e => setLabel(e.target.value)} className={fieldInput} style={fieldStyle} placeholder="Ex: Carburant trajet" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Montant</label>
                  <div className="relative">
                    <input type="number" min={0} value={amount || ''} onChange={e => setAmount(parseInt(e.target.value) || 0)} className={fieldInput} style={fieldStyle} placeholder="0" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'var(--text-muted)' }}>FCFA</span>
                  </div>
                </div>
                <div>
                  <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Date</label>
                  <input type="date" value={expenseDate} onChange={e => setExpenseDate(e.target.value)} className={fieldInput} style={fieldStyle} />
                </div>
              </div>
              <div>
                <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Description (optionnel)</label>
                <input type="text" value={description} onChange={e => setDescription(e.target.value)} className={fieldInput} style={fieldStyle} placeholder="Détails..." />
              </div>
              <button
                onClick={handleAdd}
                disabled={saving || !selectedDepartId || amount <= 0 || !label.trim()}
                className="w-full py-3 rounded-xl font-bold text-white text-sm disabled:opacity-60 flex items-center justify-center gap-2"
                style={{ backgroundColor: 'var(--primary)' }}
              >
                {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                Enregistrer la dépense
              </button>
            </div>
          </div>

          {/* Expense list */}
          <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="px-3 py-2.5" style={{ backgroundColor: 'var(--surface-raised)' }}>
              <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <Receipt className="w-4 h-4" /> Dépenses du départ
              </h3>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {depenses.length === 0 ? (
                <p className="text-center text-xs py-8" style={{ color: 'var(--text-muted)' }}>Aucune dépense</p>
              ) : (
                <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ color: 'var(--text-muted)' }}>
                      <th className="px-2 py-1.5 text-xs font-bold text-left">Libellé</th>
                      <th className="px-2 py-1.5 text-xs font-bold text-left">Type</th>
                      <th className="px-2 py-1.5 text-xs font-bold text-right">Montant</th>
                      <th className="px-2 py-1.5 text-xs font-bold text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {depenses.map(d => (
                      <tr key={d.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td className="px-2 py-2 text-xs" style={{ color: 'var(--text-primary)' }}>{d.label}</td>
                        <td className="px-2 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>{d.type}</td>
                        <td className="px-2 py-2 text-xs text-right font-bold" style={{ color: 'var(--danger)' }}>{formatCurrency(d.amount)}</td>
                        <td className="px-2 py-2 text-center">
                          <ChangeRequestButton
                            compact
                            operationType={d.type.toLowerCase().includes('carburant') ? 'carburant' : d.type.toLowerCase().includes('péage') || d.type.toLowerCase().includes('peage') ? 'peage' : d.type.toLowerCase().includes('ration') ? 'ration' : 'autres_depense'}
                            operationId={d.id}
                            operationTable="counter_charges"
                            operationReference={`Dépense ${d.label} — ${d.type}`}
                            operationSnapshot={d as unknown as Record<string, unknown>}
                            stationId={session?.station_id}
                            stationName={session?.station_name}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--border)' }}>
                      <td className="px-2 py-2 text-xs font-bold" colSpan={2} style={{ color: 'var(--text-primary)' }}>Total</td>
                      <td className="px-2 py-2 text-xs text-right font-bold" style={{ color: 'var(--danger)' }}>
                        {formatCurrency(depenses.reduce((s, d) => s + d.amount, 0))}
                      </td>
                      <td className="px-2 py-2"></td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </POSLayout>
  );
}
