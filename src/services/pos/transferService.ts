import { db, type TransferLogRecord, type PendingTransferRecord, type TicketRecord, type DepartRecord } from './db';
import { getAll, localUpdate } from './offlineStore';
import { supabase } from '@/services/supabase';
import { transferTicketsToDepart, getDepartById, updateDepart } from './departService';

function uuid(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function getCurrentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

// ── Transfer log (audit trail) ──

export async function logTransfer(params: {
  sourceDepartId: string;
  targetDepartId?: string;
  routeId?: string;
  oldBusId?: string;
  newBusId?: string;
  oldBusPlate?: string;
  newBusPlate?: string;
  oldCapacity: number;
  newCapacity: number;
  transferredCount: number;
  retainedCount: number;
  transferReason: string;
  ticketIds: string[];
}): Promise<TransferLogRecord> {
  const userId = await getCurrentUserId();
  const id = uuid();
  const record: TransferLogRecord = {
    id,
    source_depart_id: params.sourceDepartId,
    target_depart_id: params.targetDepartId,
    route_id: params.routeId,
    old_bus_id: params.oldBusId,
    new_bus_id: params.newBusId,
    old_bus_plate: params.oldBusPlate,
    new_bus_plate: params.newBusPlate,
    old_capacity: params.oldCapacity,
    new_capacity: params.newCapacity,
    transferred_count: params.transferredCount,
    retained_count: params.retainedCount,
    transfer_reason: params.transferReason,
    ticket_ids: params.ticketIds,
    transferred_by: userId ?? undefined,
    transferred_at: nowIso(),
    status: params.targetDepartId ? 'completed' : 'pending',
  };

  await db.transfer_logs.put(record);

  try {
    await supabase.from('ticket_transfer_logs').insert({
      id: record.id,
      source_schedule_id: record.source_depart_id,
      target_schedule_id: record.target_depart_id ?? null,
      old_bus_id: record.old_bus_id ?? null,
      new_bus_id: record.new_bus_id ?? null,
      old_capacity: record.old_capacity,
      new_capacity: record.new_capacity,
      transferred_count: record.transferred_count,
      retained_count: record.retained_count,
      transfer_reason: record.transfer_reason,
      ticket_ids: JSON.stringify(record.ticket_ids),
      transferred_by: userId,
      transferred_at: record.transferred_at,
      status: record.status,
    });
  } catch (err) {
    console.error('[transfer] log insert failed:', err);
  }

  return record;
}

export async function getTransferHistory(departId: string): Promise<TransferLogRecord[]> {
  const all = await db.transfer_logs.toArray();
  return all
    .filter(l => l.source_depart_id === departId || l.target_depart_id === departId)
    .sort((a, b) => b.transferred_at.localeCompare(a.transferred_at));
}

// ── Pending transfers (queue for when next depart doesn't exist yet) ──

export async function savePendingTransfer(params: {
  sourceDepartId: string;
  routeId?: string;
  stationId?: string;
  counterId?: string;
  oldBusId?: string;
  newBusId?: string;
  oldBusPlate?: string;
  newBusPlate?: string;
  oldCapacity: number;
  newCapacity: number;
  surplusCount: number;
  ticketIds: string[];
  ticketData: TicketRecord[];
}): Promise<PendingTransferRecord> {
  const userId = await getCurrentUserId();
  const id = uuid();
  const record: PendingTransferRecord = {
    id,
    source_depart_id: params.sourceDepartId,
    route_id: params.routeId,
    station_id: params.stationId,
    counter_id: params.counterId,
    old_bus_id: params.oldBusId,
    new_bus_id: params.newBusId,
    old_bus_plate: params.oldBusPlate,
    new_bus_plate: params.newBusPlate,
    old_capacity: params.oldCapacity,
    new_capacity: params.newCapacity,
    surplus_count: params.surplusCount,
    ticket_ids: params.ticketIds,
    ticket_data: params.ticketData,
    created_by: userId ?? undefined,
    created_at: nowIso(),
    status: 'pending',
  };

  await db.pending_transfers.put(record);

  try {
    await supabase.from('pending_ticket_transfers').insert({
      id: record.id,
      source_schedule_id: record.source_depart_id,
      route_id: record.route_id ?? null,
      station_id: record.station_id ?? null,
      counter_id: record.counter_id ?? null,
      old_bus_id: record.old_bus_id ?? null,
      new_bus_id: record.new_bus_id ?? null,
      old_capacity: record.old_capacity,
      new_capacity: record.new_capacity,
      surplus_count: record.surplus_count,
      ticket_ids: JSON.stringify(record.ticket_ids),
      ticket_data: JSON.stringify(record.ticket_data),
      created_by: userId,
      created_at: record.created_at,
      status: 'pending',
    });
  } catch (err) {
    console.error('[transfer] pending insert failed:', err);
  }

  return record;
}

export async function getPendingTransfersForRoute(
  routeId: string,
  stationId?: string,
): Promise<PendingTransferRecord[]> {
  const all = await db.pending_transfers.toArray();
  return all.filter(p =>
    p.status === 'pending' &&
    p.route_id === routeId &&
    (stationId ? p.station_id === stationId : true),
  );
}

export async function getPendingTransfersForStation(stationId: string): Promise<PendingTransferRecord[]> {
  const all = await db.pending_transfers.toArray();
  return all.filter(p => p.status === 'pending' && p.station_id === stationId);
}

export async function checkAndApplyPendingTransfers(
  newDepart: DepartRecord,
  stationId?: string,
): Promise<{ applied: PendingTransferRecord[]; totalTransferred: number }> {
  if (!newDepart.route_id) return { applied: [], totalTransferred: 0 };

  const pending = await getPendingTransfersForRoute(newDepart.route_id, stationId);
  if (pending.length === 0) return { applied: [], totalTransferred: 0 };

  let totalTransferred = 0;
  const applied: PendingTransferRecord[] = [];

  for (const p of pending) {
    // Re-fetch ticket records from local DB to ensure they're current
    const allTickets = await getAll<TicketRecord>('tickets');
    const ticketsToTransfer = allTickets.filter(t => p.ticket_ids.includes(t.id) && t.status !== 'cancelled');

    if (ticketsToTransfer.length === 0) {
      // Tickets no longer exist or all cancelled — mark as applied (nothing to do)
      await markPendingApplied(p.id, newDepart.id);
      continue;
    }

    // Check capacity on new depart
    const targetSoldTickets = allTickets.filter(
      t => t.depart_id === newDepart.id && t.status !== 'cancelled',
    );
    const availableSeats = newDepart.seats_total - targetSoldTickets.length;

    if (availableSeats < ticketsToTransfer.length) {
      // Not enough space on this depart — skip, try next time
      continue;
    }

    await transferTicketsToDepart(ticketsToTransfer, newDepart);

    // Recalculate new depart totals
    const updatedAllTickets = await getAll<TicketRecord>('tickets');
    const newDepartActive = updatedAllTickets.filter(
      t => t.depart_id === newDepart.id && t.status !== 'cancelled',
    );
    const newMtTicket = newDepartActive.reduce((sum, t) => sum + t.price, 0);
    await updateDepart(newDepart.id, {
      seats_sold: newDepartActive.length,
      mt_ticket: newMtTicket,
      solde: newMtTicket + newDepart.mt_bagage - newDepart.tot_depense,
      caisse: newMtTicket + newDepart.mt_bagage - newDepart.tot_depense,
    });

    // Recalculate source depart totals
    const sourceActive = updatedAllTickets.filter(
      t => t.depart_id === p.source_depart_id && t.status !== 'cancelled',
    );
    const sourceMtTicket = sourceActive.reduce((sum, t) => sum + t.price, 0);
    const sourceDepart = await getDepartById(p.source_depart_id);
    if (sourceDepart) {
      await updateDepart(p.source_depart_id, {
        seats_sold: sourceActive.length,
        mt_ticket: sourceMtTicket,
        solde: sourceMtTicket + sourceDepart.mt_bagage - sourceDepart.tot_depense,
        caisse: sourceMtTicket + sourceDepart.mt_bagage - sourceDepart.tot_depense,
      });
    }

    await markPendingApplied(p.id, newDepart.id);
    await logTransfer({
      sourceDepartId: p.source_depart_id,
      targetDepartId: newDepart.id,
      routeId: p.route_id,
      oldBusId: p.old_bus_id,
      newBusId: p.new_bus_id,
      oldBusPlate: p.old_bus_plate,
      newBusPlate: p.new_bus_plate,
      oldCapacity: p.old_capacity,
      newCapacity: p.new_capacity,
      transferredCount: ticketsToTransfer.length,
      retainedCount: p.old_capacity - p.surplus_count,
      transferReason: 'pending_transfer_applied',
      ticketIds: ticketsToTransfer.map(t => t.id),
    });

    totalTransferred += ticketsToTransfer.length;
    applied.push(p);
  }

  return { applied, totalTransferred };
}

async function markPendingApplied(pendingId: string, targetDepartId: string): Promise<void> {
  const ts = nowIso();
  const updated: Partial<PendingTransferRecord> = {
    status: 'applied',
    applied_to_depart_id: targetDepartId,
    applied_at: ts,
  };
  await db.pending_transfers.update(pendingId, updated);

  try {
    await supabase
      .from('pending_ticket_transfers')
      .update({
        status: 'applied',
        applied_to_schedule_id: targetDepartId,
        applied_at: ts,
      })
      .eq('id', pendingId);
  } catch (err) {
    console.error('[transfer] pending update failed:', err);
  }
}

export async function cancelPendingTransfer(pendingId: string): Promise<void> {
  await db.pending_transfers.update(pendingId, { status: 'cancelled' });
  try {
    await supabase
      .from('pending_ticket_transfers')
      .update({ status: 'cancelled' })
      .eq('id', pendingId);
  } catch {
    /* offline ok */
  }
}

// ── Full transfer flow (used by EditDepartModal) ──

export async function executeFullTransfer(params: {
  depart: DepartRecord;
  surplusTickets: TicketRecord[];
  nextDepart: DepartRecord | null;
  newBusId: string;
  newBusPlate: string;
  newCapacity: number;
  oldCapacity: number;
  transferReason?: string;
}): Promise<{ transferred: boolean; pendingSaved: boolean }> {
  const { depart, surplusTickets, nextDepart, newBusId, newBusPlate, newCapacity, oldCapacity } = params;

  if (surplusTickets.length === 0) return { transferred: false, pendingSaved: false };

  const ticketIds = surplusTickets.map(t => t.id);
  const transferReason = params.transferReason ?? 'capacity_reduction';

  if (nextDepart) {
    // Direct transfer
    await transferTicketsToDepart(surplusTickets, nextDepart);

    // Recalculate source depart (old bus revenue reduced)
    const allTickets = await getAll<TicketRecord>('tickets');
    const sourceActive = allTickets.filter(
      t => t.depart_id === depart.id && t.status !== 'cancelled',
    );
    const sourceMtTicket = sourceActive.reduce((sum, t) => sum + t.price, 0);
    await updateDepart(depart.id, {
      seats_sold: sourceActive.length,
      mt_ticket: sourceMtTicket,
      solde: sourceMtTicket + depart.mt_bagage - depart.tot_depense,
      caisse: sourceMtTicket + depart.mt_bagage - depart.tot_depense,
    });

    // Recalculate target depart (new bus gets the revenue)
    const targetActive = allTickets.filter(
      t => t.depart_id === nextDepart.id && t.status !== 'cancelled',
    );
    const targetMtTicket = targetActive.reduce((sum, t) => sum + t.price, 0);
    await updateDepart(nextDepart.id, {
      seats_sold: targetActive.length,
      mt_ticket: targetMtTicket,
      solde: targetMtTicket + nextDepart.mt_bagage - nextDepart.tot_depense,
      caisse: targetMtTicket + nextDepart.mt_bagage - nextDepart.tot_depense,
    });

    await logTransfer({
      sourceDepartId: depart.id,
      targetDepartId: nextDepart.id,
      routeId: depart.route_id,
      oldBusId: depart.bus_id,
      newBusId,
      oldBusPlate: depart.bus_plate,
      newBusPlate,
      oldCapacity,
      newCapacity,
      transferredCount: surplusTickets.length,
      retainedCount: sourceActive.length,
      transferReason,
      ticketIds,
    });

    return { transferred: true, pendingSaved: false };
  } else {
    // No next depart — save pending transfer
    await savePendingTransfer({
      sourceDepartId: depart.id,
      routeId: depart.route_id,
      stationId: depart.station_id,
      counterId: depart.counter_id,
      oldBusId: depart.bus_id,
      newBusId,
      oldBusPlate: depart.bus_plate,
      newBusPlate,
      oldCapacity,
      newCapacity,
      surplusCount: surplusTickets.length,
      ticketIds,
      ticketData: surplusTickets,
    });

    return { transferred: false, pendingSaved: true };
  }
}
