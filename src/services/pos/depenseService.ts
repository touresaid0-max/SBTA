import { db, type DepenseRecord, type DepartRecord } from './db';
import { localInsert, localUpdate, localDelete, getAll } from './offlineStore';
import { getDepartById, updateDepart } from './departService';
import { normalizeExpenseType } from './syncEngine';

export type { DepenseRecord };

export async function getDepensesForDepart(departId: string): Promise<DepenseRecord[]> {
  const all = await getAll<DepenseRecord>('depenses');
  return all.filter(d => d.depart_id === departId);
}

export async function getDepenseTotalForDepart(departId: string): Promise<number> {
  const depenses = await getDepensesForDepart(departId);
  return depenses
    .filter(d => d.description !== '__deleted__')
    .reduce((total, depense) => total + depense.amount, 0);
}

export async function getDepensesForStation(stationId: string): Promise<DepenseRecord[]> {
  const all = await getAll<DepenseRecord>('depenses');
  return all.filter(d => d.station_id === stationId);
}

export async function getDepensesForOtherStation(stationId: string): Promise<DepenseRecord[]> {
  const all = await getAll<DepenseRecord>('depenses');
  return all.filter(d => d.depart_id !== '' && d.station_id === stationId);
}

export interface CreateDepenseParams {
  departId: string;
  type: string;
  label: string;
  amount: number;
  description: string;
  stationId: string;
  busId?: string;
  counterId?: string;
  expenseDate: string;
}

/** Type of an expense as the server knows it: ration, carburant_complement, peage or autres. */
export function expenseCategory(d: Pick<DepenseRecord, 'type' | 'label'> | { type?: string; label?: string }): string {
  return normalizeExpenseType(d.type ?? d.label);
}

export const EXPENSE_CATEGORY_NAMES: Record<string, string> = {
  ration: 'Le ratio',
  carburant_complement: 'Le carburant',
  peage: 'Le péage',
  autres: 'La dépense « Autres »',
};

/** Expenses of this type recorded for the departure (one, or several entered before the rule). */
export async function getDepensesOfCategory(departId: string, category: string): Promise<DepenseRecord[]> {
  const all = await getDepensesForDepart(departId);
  return all
    .filter(d => d.description !== '__deleted__' && expenseCategory(d) === category)
    .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));
}

/**
 * One expense of each type per departure, never added up (audit M3). The first one of its type
 * is created; after that, saving MODIFIES it: the amount entered replaces the former one, on the
 * device and on the server.
 */
export async function saveDepense(params: CreateDepenseParams): Promise<{ depense: DepenseRecord; mode: 'created' | 'updated' | 'unchanged' }> {
  const depart = await getDepartById(params.departId);
  if (!depart) throw new Error('Départ introuvable');
  if (depart.cloture) throw new Error('Ce départ est clôturé — impossible de modifier ses dépenses');

  const category = expenseCategory(params);
  const same = await getDepensesOfCategory(params.departId, category);
  if (same.length === 0) {
    const depense = await createDepense(params);
    return { depense, mode: 'created' };
  }

  const [kept, ...former] = same;
  const unchanged = former.length === 0
    && kept.amount === params.amount
    && kept.label === params.label
    && kept.description === params.description
    && kept.expense_date === params.expenseDate;
  if (unchanged) return { depense: kept, mode: 'unchanged' };

  if (former.length > 0) {
    // Entries added up before the rule: only the modified one is kept. They are removed from the
    // device with their operations not sent yet; the server removes its copies when it receives
    // the modification.
    const formerIds = new Set(former.map(d => d.id));
    await db.transaction('rw', db.depenses, db.sync_queue, async () => {
      await db.depenses.bulkDelete([...formerIds]);
      const queued = await db.sync_queue.where('entity').equals('depenses')
        .filter(i => formerIds.has(String(i.payload?.id ?? '')) && i.status !== 'done')
        .primaryKeys();
      await db.sync_queue.bulkDelete(queued);
    });
  }

  const updated = await localUpdate<DepenseRecord>('depenses', kept.id, {
    amount: params.amount,
    label: params.label,
    description: params.description,
    expense_date: params.expenseDate,
  });
  await recalcDepartTotals(params.departId);
  return { depense: updated ?? kept, mode: 'updated' };
}

/** Creates the first expense of its type for the departure; refused when there is one already. */
export async function createDepense(params: CreateDepenseParams): Promise<DepenseRecord> {
  const depart = await getDepartById(params.departId);
  if (!depart) throw new Error('Départ introuvable');
  if (depart.cloture) throw new Error('Ce départ est clôturé — impossible d\'ajouter une dépense');

  const category = expenseCategory(params);
  if ((await getDepensesOfCategory(params.departId, category)).length > 0) {
    const feminine = category === 'autres';
    throw new Error(`${EXPENSE_CATEGORY_NAMES[category]} de ce départ est déjà enregistré${feminine ? 'e' : ''} : modifiez-l${feminine ? 'a' : 'e'} au lieu d'en ajouter un${feminine ? 'e' : ''} autre.`);
  }

  const depense = await localInsert<DepenseRecord>('depenses', {
    depart_id: params.departId,
    type: params.type,
    label: params.label,
    amount: params.amount,
    description: params.description,
    station_id: params.stationId,
    bus_id: params.busId,
    counter_id: params.counterId,
    expense_date: params.expenseDate,
  });

  await recalcDepartTotals(params.departId);

  return depense;
}

export async function deleteDepense(depenseId: string): Promise<void> {
  const all = await getAll<DepenseRecord>('depenses');
  const depense = all.find(d => d.id === depenseId);
  if (!depense) return;

  await localDelete('depenses', depenseId);

  await recalcDepartTotals(depense.depart_id);
}

export async function recalcDepartTotals(departId: string): Promise<DepartRecord | null> {
  const depart = await getDepartById(departId);
  if (!depart) return null;

  const depenses = await getDepensesForDepart(departId);
  const validDepenses = depenses.filter(d => d.description !== '__deleted__');
  const newTotDepense = validDepenses.reduce((sum, d) => sum + d.amount, 0);

  return updateDepart(departId, {
    tot_depense: newTotDepense,
    solde: depart.mt_ticket - newTotDepense,
    caisse: depart.mt_ticket - newTotDepense,
  });
}
