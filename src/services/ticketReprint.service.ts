import { supabase } from './supabase'

/**
 * Ticket reprint authorizations.
 *
 * The admin selects sold seats in "Gestion des sièges" and authorizes the
 * guichet to reprint the matching tickets. Each authorization is single-use:
 * the guichet consumes it once the DUPLICATA has been printed successfully.
 */
export interface TicketReprintAuthorization {
  id: string
  schedule_id: string
  reservation_id: string
  seat_label: string
  reason: string | null
  authorized_at: string
}

interface RpcResult {
  success: boolean
  error?: string
  already_pending?: boolean
}

/** Pending authorizations for a schedule (empty list when offline or on error). */
export async function fetchPendingReprints(scheduleId: string): Promise<TicketReprintAuthorization[]> {
  const { data, error } = await supabase
    .from('ticket_reprint_authorizations')
    .select('id, schedule_id, reservation_id, seat_label, reason, authorized_at')
    .eq('schedule_id', scheduleId)
    .eq('status', 'pending')
    .order('authorized_at', { ascending: true })

  if (error || !data) return []
  return data as TicketReprintAuthorization[]
}

export async function authorizeReprint(
  scheduleId: string,
  reservationId: string,
  seatLabel: string,
  reason: string,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc('admin_authorize_ticket_reprint', {
    p_schedule_id: scheduleId,
    p_reservation_id: reservationId,
    p_seat_label: seatLabel,
    p_reason: reason,
  })
  if (error) return { success: false, error: error.message }
  return data as RpcResult
}

export async function revokeReprint(authorizationId: string): Promise<RpcResult> {
  const { data, error } = await supabase.rpc('admin_revoke_ticket_reprint', {
    p_authorization_id: authorizationId,
  })
  if (error) return { success: false, error: error.message }
  return data as RpcResult
}

export async function consumeReprint(authorizationId: string): Promise<RpcResult> {
  const { data, error } = await supabase.rpc('consume_ticket_reprint', {
    p_authorization_id: authorizationId,
  })
  if (error) return { success: false, error: error.message }
  return data as RpcResult
}
