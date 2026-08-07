import { type DepenseRecord, type DepartRecord } from './db';
import { localInsert, localDelete, getAll } from './offlineStore';
import { getDepartById, updateDepart } from './departService';

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

export async function createDepense(params: CreateDepenseParams): Promise<DepenseRecord> {
  const depart = await getDepartById(params.departId);
  if (!depart) throw new Error('Départ introuvable');
  if (depart.cloture) throw new Error('Ce départ est clôturé — impossible d\'ajouter une dépense');

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
    solde: depart.mt_ticket + depart.mt_bagage - newTotDepense,
    caisse: depart.mt_ticket + depart.mt_bagage - newTotDepense,
  });
}
