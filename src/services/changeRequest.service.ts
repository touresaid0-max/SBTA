import { supabase } from './supabase';

export type ChangeRequestType = 'modification' | 'suppression';
export type ChangeRequestStatus =
  | 'en_attente'
  | 'autorisee_modification'
  | 'autorisee_suppression'
  | 'refusee'
  | 'executee'
  | 'annulee';

export type OperationType =
  | 'ticket_sale'
  | 'reservation'
  | 'departure_expense'
  | 'carburant'
  | 'peage'
  | 'ration'
  | 'autres_depense'
  | 'courrier_entrant'
  | 'courrier_sortant'
  | 'paiement_recette'
  | 'convoy'
  | 'baggage'
  | 'other';

export interface ChangeRequest {
  id: string;
  request_number: string;
  request_type: ChangeRequestType;
  operation_type: OperationType | string;
  operation_id: string;
  operation_table: string;
  operation_reference: string;
  operation_snapshot: Record<string, unknown> | null;
  requested_by: string;
  requester_name: string;
  requester_role: string;
  station_id: string | null;
  station_name: string | null;
  reason: string;
  error_description: string;
  modification_details: string | null;
  new_values: Record<string, unknown> | null;
  justification_doc_url: string | null;
  additional_comment: string | null;
  status: ChangeRequestStatus;
  is_emergency: boolean;
  emergency_justification: string | null;
  reviewed_by: string | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  review_comment: string | null;
  executed_by: string | null;
  executor_name: string | null;
  executed_at: string | null;
  execution_notes: string | null;
  old_values_snapshot: Record<string, unknown> | null;
  new_values_applied: Record<string, unknown> | null;
  deleted_record_snapshot: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface ChangeRequestEvent {
  id: string;
  request_id: string;
  event_type: 'created' | 'reviewed' | 'executed' | 'refused' | 'cancelled' | 'emergency_override';
  performed_by: string;
  performer_name: string;
  performer_role: string;
  comment: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface SubmitChangeRequestParams {
  request_type: ChangeRequestType;
  operation_type: OperationType | string;
  operation_id: string;
  operation_table: string;
  operation_reference: string;
  operation_snapshot?: Record<string, unknown> | null;
  reason: string;
  error_description: string;
  modification_details?: string | null;
  new_values?: Record<string, unknown> | null;
  justification_doc_url?: string | null;
  additional_comment?: string | null;
  station_id?: string | null;
  station_name?: string | null;
  is_emergency?: boolean;
  emergency_justification?: string | null;
}

export async function submitChangeRequest(
  params: SubmitChangeRequestParams
): Promise<{ id: string } | { error: string }> {
  const { data, error } = await supabase.rpc('submit_change_request', {
    p_request_type: params.request_type,
    p_operation_type: params.operation_type,
    p_operation_id: params.operation_id,
    p_operation_table: params.operation_table,
    p_operation_reference: params.operation_reference,
    p_operation_snapshot: params.operation_snapshot ?? null,
    p_reason: params.reason,
    p_error_description: params.error_description,
    p_modification_details: params.modification_details ?? null,
    p_new_values: params.new_values ?? null,
    p_justification_doc_url: params.justification_doc_url ?? null,
    p_additional_comment: params.additional_comment ?? null,
    p_station_id: params.station_id ?? null,
    p_station_name: params.station_name ?? null,
    p_is_emergency: params.is_emergency ?? false,
    p_emergency_justification: params.emergency_justification ?? null,
  });
  if (error) return { error: error.message };
  return { id: data as string };
}

export async function reviewChangeRequest(
  requestId: string,
  decision: 'autoriser_modification' | 'autoriser_suppression' | 'refuser',
  reviewComment: string,
  isEmergencyOverride = false
): Promise<{ success: boolean } | { error: string }> {
  const { data, error } = await supabase.rpc('review_change_request', {
    p_request_id: requestId,
    p_decision: decision,
    p_review_comment: reviewComment,
    p_is_emergency_override: isEmergencyOverride,
  });
  if (error) return { error: error.message };
  return { success: data as boolean };
}

export async function executeChangeRequest(
  requestId: string,
  executionNotes: string,
  oldValues?: Record<string, unknown> | null,
  newValues?: Record<string, unknown> | null,
  deletedSnapshot?: Record<string, unknown> | null
): Promise<{ success: boolean } | { error: string }> {
  const { data, error } = await supabase.rpc('execute_change_request', {
    p_request_id: requestId,
    p_execution_notes: executionNotes,
    p_old_values: oldValues ?? null,
    p_new_values: newValues ?? null,
    p_deleted_snapshot: deletedSnapshot ?? null,
  });
  if (error) return { error: error.message };
  return { success: data as boolean };
}

export async function cancelChangeRequest(
  requestId: string,
  cancelReason: string
): Promise<{ success: boolean } | { error: string }> {
  const { data, error } = await supabase.rpc('cancel_change_request', {
    p_request_id: requestId,
    p_cancel_reason: cancelReason,
  });
  if (error) return { error: error.message };
  return { success: data as boolean };
}

export async function fetchChangeRequests(filters?: {
  status?: ChangeRequestStatus | 'all';
  stationId?: string;
  requestedBy?: string;
  limit?: number;
}): Promise<ChangeRequest[]> {
  let query = supabase
    .from('operation_change_requests')
    .select('*')
    .order('created_at', { ascending: false });

  if (filters?.status && filters.status !== 'all') {
    query = query.eq('status', filters.status);
  }
  if (filters?.stationId) {
    query = query.eq('station_id', filters.stationId);
  }
  if (filters?.requestedBy) {
    query = query.eq('requested_by', filters.requestedBy);
  }
  if (filters?.limit) {
    query = query.limit(filters.limit);
  }

  const { data, error } = await query;
  if (error) {
    console.error('fetchChangeRequests error:', error);
    return [];
  }
  return (data ?? []) as ChangeRequest[];
}

export async function fetchChangeRequestEvents(
  requestId: string
): Promise<ChangeRequestEvent[]> {
  const { data, error } = await supabase
    .from('operation_change_request_events')
    .select('*')
    .eq('request_id', requestId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('fetchChangeRequestEvents error:', error);
    return [];
  }
  return (data ?? []) as ChangeRequestEvent[];
}

export type ExistingRequestStatus = 'none' | 'pending' | 'executed';

export async function checkExistingChangeRequest(
  operationTable: string,
  operationId: string
): Promise<{ status: ExistingRequestStatus; existingStatus?: ChangeRequestStatus }> {
  const { data, error } = await supabase
    .from('operation_change_requests')
    .select('id, status')
    .eq('operation_table', operationTable)
    .eq('operation_id', operationId)
    .in('status', ['en_attente', 'autorisee_modification', 'autorisee_suppression', 'executee'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return { status: 'none' };
  if (!data) return { status: 'none' };

  const reqStatus = data.status as ChangeRequestStatus;
  if (reqStatus === 'executee') {
    return { status: 'executed', existingStatus: reqStatus };
  }
  return { status: 'pending', existingStatus: reqStatus };
}

export const STATUS_LABELS: Record<ChangeRequestStatus, string> = {
  en_attente: 'En attente d\'autorisation',
  autorisee_modification: 'Modification autorisée',
  autorisee_suppression: 'Suppression autorisée',
  refusee: 'Refusée',
  executee: 'Exécutée',
  annulee: 'Annulée',
};

export const STATUS_COLORS: Record<ChangeRequestStatus, string> = {
  en_attente: '#F59E0B',
  autorisee_modification: '#3B82F6',
  autorisee_suppression: '#EF4444',
  refusee: '#6B7280',
  executee: '#10B981',
  annulee: '#9CA3AF',
};

export const OPERATION_LABELS: Record<string, string> = {
  ticket_sale: 'Vente de ticket',
  reservation: 'Réservation',
  departure_expense: 'Dépense du départ',
  carburant: 'Carburant',
  peage: 'Péage',
  ration: 'Rations',
  autres_depense: 'Autres dépenses',
  courrier_entrant: 'Courrier entrant',
  courrier_sortant: 'Courrier sortant',
  paiement_recette: 'Paiement / recette',
  convoy: 'Convoi',
  baggage: 'Bagage',
  other: 'Autre opération',
};
