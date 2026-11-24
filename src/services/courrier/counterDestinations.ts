import { getAssignedRouteIds, getGares, getLignes } from '@/services/pos/departService'
import { getReferentiel } from '@/services/pos/referentiels'

/**
 * Arrival stations a guichetier may choose for a parcel: those of the lines assigned to the
 * guichet (chef de gare › Guichets). For each line: its destination station, every station of its
 * destination city and of its stop cities (route_city_stops), and its station stops (route_stops).
 *
 * - `stationIds` null: the lines are not known on this device (lists not loaded yet), no filter.
 * - `noLines` true: the guichet has no line assigned, so no arrival station.
 * Read from the lists kept on the device: works offline as online.
 */
export async function counterDestinationStationIds(
  counterId: string | null | undefined,
  knownRouteIds: string[],
  online: boolean,
): Promise<{ stationIds: Set<string> | null; noLines: boolean }> {
  // The guichet's lines: asked to the server when online (the chef de gare may just have changed
  // them), at most 3 s when the device already knows them; otherwise the ones kept at login
  const fromServer = online && counterId ? getAssignedRouteIds(counterId) : Promise.resolve([] as string[])
  const fresh = knownRouteIds.length > 0
    ? await Promise.race([fromServer, new Promise<string[]>(resolve => setTimeout(() => resolve([]), 3_000))])
    : await fromServer
  const routeIds = new Set(fresh.length > 0 ? fresh : knownRouteIds)
  if (routeIds.size === 0) return { stationIds: new Set(), noLines: true }

  const [lignes, gares, cityStops, stationStops] = await Promise.all([
    getLignes().catch(() => []),
    getGares().catch(() => []),
    getReferentiel<{ route_id: string; city_id: string }>('route_city_stops').catch(() => []),
    getReferentiel<{ route_id: string; station_id: string }>('tarifs').catch(() => []),
  ])
  const myLines = lignes.filter(l => routeIds.has(l.id))
  if (myLines.length === 0) return { stationIds: null, noLines: false }

  const stationIds = new Set<string>()
  const cityIds = new Set<string>()
  for (const l of myLines) {
    if (l.destination_station_id) stationIds.add(l.destination_station_id)
    if (l.destination_city_id) cityIds.add(l.destination_city_id)
  }
  for (const s of cityStops) if (routeIds.has(s.route_id) && s.city_id) cityIds.add(s.city_id)
  for (const s of stationStops) if (routeIds.has(s.route_id) && s.station_id) stationIds.add(s.station_id)
  for (const g of gares) if (g.city_id && cityIds.has(g.city_id)) stationIds.add(g.id)
  return { stationIds, noLines: false }
}
