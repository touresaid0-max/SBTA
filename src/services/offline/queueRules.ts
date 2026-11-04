// Rules shared by the two sending queues kept on the device: the guichet's (services/pos) and the
// courrier's (services/courrier). They were written twice and had drifted apart: the courrier
// queue sent a failed operation again every 5 s, forever, and neither queue told a refusal by the
// server from a network failure.

/**
 * Operation states:
 * - pending: waiting to be sent;
 * - syncing: being sent (or its sending was cut, see STALE_SENDING_MS);
 * - error: failed for a passing reason (network, timeout, server unavailable): sent again later;
 * - failed: refused by the server (invalid data, constraint, access rules): sending it again as is
 *   would be refused again, so it is no longer sent by itself; « Réessayer » sends it once more;
 * - abandoned: given up by a guichetier, with a written reason; kept on the device as a trace;
 * - done: older versions only.
 */
export type QueueStatus = 'pending' | 'syncing' | 'done' | 'error' | 'failed' | 'abandoned';

/** States of an operation not on the server yet: counted in the banner, listed in the queue window. */
export const NOT_SENT_STATUSES: QueueStatus[] = ['pending', 'error', 'syncing', 'failed'];

interface QueueItemTiming {
  status: string;
  tries?: number;
  sending_since?: string;
}

// An operation is marked 'syncing' while it is being sent. If the page closes or reloads at that
// moment (update of the site, power cut, tab closed), it stays 'syncing': it must then be sent
// again, otherwise the sale never reaches the server. Older than this delay = interrupted send.
export const STALE_SENDING_MS = 2 * 60_000;

// A failed operation waits longer after each failure: 5 s, 10 s, 20 s… up to 10 minutes.
// « Réessayer » in the queue window sends it at once.
const FIRST_RETRY_MS = 5_000;
const MAX_RETRY_MS = 10 * 60_000;

/** Wait before sending again an operation that failed `tries` times. */
export function retryDelayMs(tries: number): number {
  return Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** Math.max(0, Math.min(tries, 20) - 1));
}

/** When a failed operation will be sent again (null: at the next sending). */
export function nextRetryAt(item: QueueItemTiming): number | null {
  if (item.status !== 'error' || !item.sending_since) return null;
  const last = Date.parse(item.sending_since);
  return Number.isNaN(last) ? null : last + retryDelayMs(item.tries ?? 1);
}

/** The operation is to be sent at this sending (refused and abandoned ones never are). */
export function isWaitingToSend(item: QueueItemTiming): boolean {
  if (item.status === 'pending') return true;
  if (item.status === 'error') return !(Date.now() < (nextRetryAt(item) ?? 0));
  if (item.status !== 'syncing') return false;
  const since = item.sending_since ? Date.parse(item.sending_since) : NaN;
  return !(Date.now() - since < STALE_SENDING_MS);
}

/** Refusal found by the app itself (e.g. a change the server's access rules did not apply). */
export class RefusedByServer extends Error {
  readonly permanent = true;
}

/**
 * The server refused the operation itself: sending it again unchanged gives the same answer.
 * Errors from the database (Postgres SQLSTATE) or from the REST layer (PGRST…) say so by their
 * code. No code (network failure, timeout, « waiting for… » set by the queue) = passing.
 */
export function isPermanentError(err: unknown): boolean {
  const e = err as { code?: unknown; permanent?: unknown } | null | undefined;
  if (e?.permanent === true) return true;
  const code = String(e?.code ?? '');
  if (!code) return false;
  if (/^PGRST[03]/.test(code)) return false; // server unreachable; session expired (signing in again fixes it)
  if (code === '23503') return false; // the row it refers to has not reached the server yet
  if (/^(08|40|53|54|55|57|58|XX)/.test(code)) return false; // connection, conflicts, resources, timeouts, server
  return /^(22|23|42|P0|PGRST[12])/.test(code); // invalid data, constraint, access rules, rule of a trigger, bad request
}

/** Shortest reason accepted to abandon an operation. */
export const MIN_ABANDON_REASON = 10;

/**
 * Order in which the operations were recorded on the device: their queue number, given in
 * sequence by the device's database. It used to be their time (created_at), taken from the
 * device's clock: a clock changed between two operations sent them out of order.
 */
export function byQueueOrder(a: { id?: number }, b: { id?: number }): number {
  return (a.id ?? 0) - (b.id ?? 0);
}
