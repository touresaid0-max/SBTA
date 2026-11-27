import { format } from 'date-fns';

/**
 * A departure saved without a time (guichet, before 26/11/2026) is at 00:00 exactly (Abidjan is
 * UTC+0): its time is unknown, it is not a departure at midnight (audit chef de gare G1, G2).
 */
export function hasUnknownTime(value: string | Date | null | undefined): boolean {
  if (!value) return false;
  const d = value instanceof Date ? value : new Date(value);
  return !isNaN(d.getTime()) && d.getUTCHours() === 0 && d.getUTCMinutes() === 0;
}

/** HH:mm of a departure, or `unknown` (« --:-- » by default) when its time is unknown. */
export function departureTimeLabel(value: string | Date, unknown = '--:--'): string {
  return hasUnknownTime(value) ? unknown : format(value instanceof Date ? value : new Date(value), 'HH:mm');
}

/** HH:mm of a time counted from the departure (arrival, stop): unknown when the departure's is. */
export function timeFromDepartureLabel(departure: string | Date, value: string | Date, unknown = '--:--'): string {
  return hasUnknownTime(departure) ? unknown : format(value instanceof Date ? value : new Date(value), 'HH:mm');
}

/**
 * Arrival of a departure (audit G3): the guichet saved departure + 8 h whatever the line. When the
 * gap saved is exactly 8 h and the departure holds another duration (that of its line), the
 * arrival is departure + that duration. The server computes it so for the new departures.
 */
export function departureArrival(departure: string, arrival: string, durationMinutes?: number | null): string {
  if (!departure || !arrival || !durationMinutes || durationMinutes <= 0 || durationMinutes === 480) return arrival;
  const dep = new Date(departure).getTime();
  if (isNaN(dep) || new Date(arrival).getTime() - dep !== 8 * 3600_000) return arrival;
  return new Date(dep + durationMinutes * 60_000).toISOString();
}

/**
 * Chef de gare only (27/11/2026): a departure saved at the guichet without a time is at 00:00; its
 * time of creation at the guichet (created_at) is shown instead, marked « auto ». The guichet and
 * the ticket never show it. `durationMinutes` (the line's) gives the arrival.
 */
export function withCreationTime<T extends { departure_datetime: string; arrival_datetime?: string | null }>(
  row: T,
  createdAt?: string | null,
  durationMinutes?: number | null,
): T & { auto_time: boolean } {
  if (!createdAt || !hasUnknownTime(row.departure_datetime)) return { ...row, auto_time: false };
  const dep = new Date(row.departure_datetime);
  const created = new Date(createdAt);
  if (isNaN(dep.getTime()) || isNaN(created.getTime())) return { ...row, auto_time: false };
  // Created another day (the day before, for the next day): its time says nothing of the departure
  if (created.toISOString().slice(0, 10) !== dep.toISOString().slice(0, 10)) return { ...row, auto_time: false };
  dep.setUTCHours(created.getUTCHours(), created.getUTCMinutes(), 0, 0);
  const arrival = durationMinutes && durationMinutes > 0
    ? new Date(dep.getTime() + durationMinutes * 60_000).toISOString()
    : row.arrival_datetime;
  return { ...row, departure_datetime: dep.toISOString(), arrival_datetime: arrival, auto_time: true };
}
