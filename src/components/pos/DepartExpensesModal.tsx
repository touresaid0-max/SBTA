import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle, Loader2, Receipt, X } from 'lucide-react';
import { saveDepense, getDepensesForDepart, expenseCategory, type DepenseRecord } from '@/services/pos/depenseService';
import type { DepartRecord } from '@/services/pos/db';
import { formatCurrency } from '@/utils/formatCurrency';
import { checkAmounts, AMOUNT_RULES } from '@/utils/amountLimits';

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

const FIELD_OF_CATEGORY: Record<string, ExpenseField> = {
  ration: 'ratio',
  peage: 'peages',
  carburant_complement: 'carburant',
  autres: 'autres',
};

const EMPTY_VALUES: ExpenseValues = { ratio: '', peages: '', carburant: '', autres: '' };

/** Amount recorded for each type (one expense per type and departure, audit M3). */
function recordedAmounts(depenses: DepenseRecord[]): Record<ExpenseField, number | null> {
  const totals: Record<ExpenseField, number | null> = { ratio: null, peages: null, carburant: null, autres: null };
  for (const depense of depenses) {
    const field = FIELD_OF_CATEGORY[expenseCategory(depense)] ?? 'autres';
    totals[field] = (totals[field] ?? 0) + depense.amount;
  }
  return totals;
}

function valuesOf(recorded: Record<ExpenseField, number | null>): ExpenseValues {
  const values = { ...EMPTY_VALUES };
  for (const { field } of EXPENSES) values[field] = recorded[field] !== null ? String(recorded[field]) : '';
  return values;
}

export default function DepartExpensesModal({ depart, stationId, counterId, onClose, onSaved }: Props) {
  const [depenses, setDepenses] = useState<DepenseRecord[]>([]);
  const [values, setValues] = useState<ExpenseValues>(EMPTY_VALUES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = async () => {
    const items = (await getDepensesForDepart(depart.id)).filter(item => item.description !== '__deleted__');
    setDepenses(items);
    setValues(valuesOf(recordedAmounts(items)));
  };

  useEffect(() => {
    load()
      .catch(() => setError('Impossible de charger les dépenses du départ.'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depart.id]);

  const recorded = useMemo(() => recordedAmounts(depenses), [depenses]);
  const totalRecorded = depenses.reduce((total, depense) => total + depense.amount, 0);
  const changed = EXPENSES.filter(({ field }) => values[field] !== (recorded[field] !== null ? String(recorded[field]) : ''));

  const updateValue = (field: ExpenseField, value: string) => {
    setValues(previous => ({ ...previous, [field]: value.replace(/[^0-9]/g, '') }));
    setError('');
    setSuccess('');
  };

  const handleSave = async () => {
    // A recorded expense is modified, never emptied here (an expense is cancelled by a change request)
    const emptied = changed.find(({ field }) => recorded[field] !== null && !(Number(values[field]) > 0));
    if (emptied) {
      setError(`Le montant « ${emptied.label} » ne peut pas être vide ou nul. Pour annuler cette dépense, faites une demande de modification.`);
      return;
    }
    const entries = changed
      .map(expense => ({ ...expense, amount: Number(values[expense.field]) || 0 }))
      .filter(expense => expense.amount > 0);
    if (entries.length === 0) {
      setError('Aucun montant modifié.');
      return;
    }
    // Typing slip on an amount (audit m5): refused above the maximum, confirmed when unusual
    const amountCheck = checkAmounts(entries.map(e => ({ value: e.amount, rule: AMOUNT_RULES.expense, detail: e.label })));
    if (!amountCheck.ok) {
      if (amountCheck.error) setError(amountCheck.error);
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');
    try {
      let created = 0;
      let updated = 0;
      for (const expense of entries) {
        const { mode } = await saveDepense({
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
        if (mode === 'created') created++;
        if (mode === 'updated') updated++;
      }
      await load();
      await onSaved();
      setSuccess(updated > 0
        ? `${created > 0 ? `${created} dépense(s) enregistrée(s), ` : ''}${updated} dépense(s) modifiée(s) : le nouveau montant remplace l'ancien.`
        : 'Dépenses enregistrées.');
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
              <Receipt className="h-4 w-4" /> Enregistré pour ce départ
            </div>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--primary)' }} />
            ) : (
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                {EXPENSES.map(expense => (
                  <div key={expense.field}>
                    <p style={{ color: 'var(--text-muted)' }}>{expense.label}</p>
                    <p className="font-bold" style={{ color: 'var(--text-primary)' }}>{recorded[expense.field] !== null ? formatCurrency(recorded[expense.field] ?? 0) : '—'}</p>
                  </div>
                ))}
              </div>
            )}
            {depenses.length > 0 && (
              <p className="mt-2 border-t pt-2 text-xs font-bold" style={{ borderColor: 'var(--border)', color: 'var(--danger)' }}>
                Total dépenses : {formatCurrency(totalRecorded)}
              </p>
            )}
          </div>

          <div>
            <p className="mb-3 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Montants des dépenses</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {EXPENSES.map(expense => (
                <label key={expense.field} className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
                  {expense.label}
                  {recorded[expense.field] !== null && <span className="ml-1 font-normal" style={{ color: 'var(--text-muted)' }}>(à modifier)</span>}
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
            Une seule dépense de chaque type par départ. Une dépense déjà enregistrée se modifie : le montant saisi remplace l'ancien, il ne s'y ajoute pas.
            Une dépense déjà validée repasse « en attente » si son montant change.
          </p>

          <div className="flex gap-3">
            <button type="button" onClick={onClose} disabled={saving} className="flex-1 rounded-xl border-2 py-3 text-sm font-bold" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
              Annuler
            </button>
            <button type="button" onClick={handleSave} disabled={saving || loading || changed.length === 0} className="flex-1 rounded-xl py-3 text-sm font-bold text-white disabled:opacity-60" style={{ backgroundColor: 'var(--primary)' }}>
              {saving ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : 'Enregistrer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
