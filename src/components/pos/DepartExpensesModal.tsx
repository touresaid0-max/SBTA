import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle, Loader2, Receipt, X } from 'lucide-react';
import { createDepense, getDepensesForDepart, type DepenseRecord } from '@/services/pos/depenseService';
import type { DepartRecord } from '@/services/pos/db';
import { formatCurrency } from '@/utils/formatCurrency';

interface Props {
  depart: DepartRecord;
  stationId?: string;
  counterId?: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

type ExpenseField = 'ratio' | 'peages' | 'carburant' | 'autres';

type ExpenseValues = Record<ExpenseField, string>;

const EXPENSES: { field: ExpenseField; label: string; type: string }[] = [
  { field: 'ratio', label: 'Ratio', type: 'ratio' },
  { field: 'peages', label: 'Péages', type: 'péages' },
  { field: 'carburant', label: 'Carburant', type: 'carburant' },
  { field: 'autres', label: 'Autres', type: 'autres' },
];

function expenseCategory(type: string, label: string): ExpenseField {
  const value = `${type} ${label}`.toLowerCase();
  if (value.includes('ratio') || value.includes('ration') || value.includes('frais de route')) return 'ratio';
  if (value.includes('péage') || value.includes('peage')) return 'peages';
  if (value.includes('carburant')) return 'carburant';
  return 'autres';
}

export default function DepartExpensesModal({ depart, stationId, counterId, onClose, onSaved }: Props) {
  const [depenses, setDepenses] = useState<DepenseRecord[]>([]);
  const [values, setValues] = useState<ExpenseValues>({ ratio: '', peages: '', carburant: '', autres: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    getDepensesForDepart(depart.id)
      .then(items => setDepenses(items.filter(item => item.description !== '__deleted__')))
      .catch(() => setError('Impossible de charger les dépenses du départ.'))
      .finally(() => setLoading(false));
  }, [depart.id]);

  const existingTotals = useMemo(() => depenses.reduce<Record<ExpenseField, number>>((totals, depense) => {
    const field = expenseCategory(depense.type, depense.label);
    totals[field] += depense.amount;
    return totals;
  }, { ratio: 0, peages: 0, carburant: 0, autres: 0 }), [depenses]);

  const totalExisting = depenses.reduce((total, depense) => total + depense.amount, 0);
  const hasValue = Object.values(values).some(value => Number(value) > 0);

  const updateValue = (field: ExpenseField, value: string) => {
    setValues(previous => ({ ...previous, [field]: value.replace(/[^0-9]/g, '') }));
    setError('');
    setSuccess('');
  };

  const handleSave = async () => {
    const entries = EXPENSES
      .map(expense => ({ ...expense, amount: Number(values[expense.field]) || 0 }))
      .filter(expense => expense.amount > 0);
    if (entries.length === 0) {
      setError('Saisissez au moins un montant.');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');
    try {
      for (const expense of entries) {
        await createDepense({
          departId: depart.id,
          type: expense.type,
          label: expense.label,
          amount: expense.amount,
          description: `Départ #${depart.route_number} — ${expense.label}`,
          stationId: stationId ?? depart.station_id,
          busId: depart.bus_id,
          counterId: counterId ?? depart.counter_id,
          expenseDate: depart.departure_date,
        });
      }
      const updated = await getDepensesForDepart(depart.id);
      setDepenses(updated.filter(item => item.description !== '__deleted__'));
      setValues({ ratio: '', peages: '', carburant: '', autres: '' });
      await onSaved();
      setSuccess('Dépenses enregistrées et synchronisées.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de l’enregistrement.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl shadow-2xl" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="flex items-start justify-between border-b px-5 py-4" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Dépenses du départ</h2>
            <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
              Départ #{depart.route_number} — {depart.route_name ?? 'Ligne'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5" style={{ color: 'var(--text-muted)' }}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[75vh] space-y-4 overflow-y-auto p-5">
          {error && (
            <div className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm" style={{ backgroundColor: 'var(--danger-light)', color: 'var(--danger)' }}>
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium" style={{ backgroundColor: 'var(--success-light)', color: 'var(--success)' }}>
              <CheckCircle className="h-4 w-4" /> {success}
            </div>
          )}

          <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-raised)' }}>
            <div className="mb-2 flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              <Receipt className="h-4 w-4" /> Déjà enregistré
            </div>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--primary)' }} />
            ) : (
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                {EXPENSES.map(expense => (
                  <div key={expense.field}>
                    <p style={{ color: 'var(--text-muted)' }}>{expense.label}</p>
                    <p className="font-bold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(existingTotals[expense.field])}</p>
                  </div>
                ))}
              </div>
            )}
            {depenses.length > 0 && (
              <p className="mt-2 border-t pt-2 text-xs font-bold" style={{ borderColor: 'var(--border)', color: 'var(--danger)' }}>
                Total dépenses : {formatCurrency(totalExisting)}
              </p>
            )}
          </div>

          <div>
            <p className="mb-3 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Ajouter des dépenses</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {EXPENSES.map(expense => (
                <label key={expense.field} className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
                  {expense.label}
                  <div className="relative mt-1">
                    <input
                      type="number"
                      min="0"
                      step="500"
                      inputMode="numeric"
                      value={values[expense.field]}
                      onChange={event => updateValue(expense.field, event.target.value)}
                      placeholder="0"
                      className="w-full rounded-lg border px-3 py-2.5 pr-16 text-sm outline-none"
                      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'var(--text-muted)' }}>FCFA</span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Les montants ajoutés apparaîtront automatiquement dans « Nouvelle dépense », « Dépenses du départ » et dans les totaux du départ.
          </p>

          <div className="flex gap-3">
            <button type="button" onClick={onClose} disabled={saving} className="flex-1 rounded-xl border-2 py-3 text-sm font-bold" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
              Annuler
            </button>
            <button type="button" onClick={handleSave} disabled={saving || !hasValue} className="flex-1 rounded-xl py-3 text-sm font-bold text-white disabled:opacity-60" style={{ backgroundColor: 'var(--primary)' }}>
              {saving ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : 'Enregistrer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
