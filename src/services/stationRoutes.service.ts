import { supabase } from './supabase';

/**
 * Lines of a station (audit chef de gare B3): the lines ticked on its guichets, plus the lines
 * whose origin station is this one. A line is often used by several stations (« Adjame -
 * Agboville » at ADJAME-AGBOVILLE, Gare Yopougon and YOP-DALOA), so origin_station_id alone
 * cannot say it, and most lines have none: the screens fell back on every line of the city.
 *
 * Empty when the station has no line at all (no guichet line, no origin line): the caller then
 * keeps its former fallback, so that such a station is not left without lines.
 */
export async function fetchStationRouteIds(stationId: string): Promise<string[]> {
  const [{ data: counters }, { data: ownRoutes }] = await Promise.all([
    supabase.from('counters').select('id').eq('station_id', stationId),
    supabase.from('routes').select('id').eq('origin_station_id', stationId).eq('is_active', true),
  ]);
  const counterIds = (counters || []).map((c: { id: string }) => c.id);
  let assigned: string[] = [];
  if (counterIds.length > 0) {
    const { data } = await supabase.from('counter_routes').select('route_id').in('counter_id', counterIds);
    assigned = (data || []).map((r: { route_id: string }) => r.route_id);
  }
  return [...new Set([...assigned, ...(ownRoutes || []).map((r: { id: string }) => r.id)])];
}

/** Routes ordered with the station's lines first, then by name. */
export function stationRoutesFirst<T extends { id: string; name?: string | null }>(routes: T[], stationRouteIds: string[]): T[] {
  const own = new Set(stationRouteIds);
  return [...routes].sort((a, b) =>
    Number(own.has(b.id)) - Number(own.has(a.id)) || String(a.name ?? '').localeCompare(String(b.name ?? ''), 'fr'));
}
