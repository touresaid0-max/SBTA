import { type DepartRecord } from './db';
import { localInsert, localUpdate, getAll } from './offlineStore';
import { getReferentiel } from './referentiels';

export type { DepartRecord };

export interface LigneRef { id: string; name: string; origin_station_id: string; is_active: boolean }
export interface VehiculeRef { id: string; plate_number: string; capacity: number; company_id: string; status: string }
export interface ChauffeurRef { id: string; full_name: string; email: string; role: string }
export interface GareRef { id: string; name: string; city: string; agency_code: string; is_active: boolean }

export async function getLignes(): Promise<LigneRef[]> {
  return getReferentiel<LigneRef>('lignes');
}
export async function getVehicules(): Promise<VehiculeRef[]> {
  return getReferentiel<VehiculeRef>('vehicules');
}
export async function getChauffeurs(): Promise<ChauffeurRef[]> {
  return getReferentiel<ChauffeurRef>('chauffeurs');
}
export async function getGares(): Promise<GareRef[]> {
  return getReferentiel<GareRef>('gares');
}

export async function nextDepartureNumber(stationId: string): Promise<number> {
  const all = await getAll<DepartRecord>('departs');
  const stationDeparts = all.filter(d => d.station_id === stationId);
  if (stationDeparts.length === 0) return 1;
  return Math.max(...stationDeparts.map(d => d.departure_number ?? 0)) + 1;
}

export async function nextRouteNumber(stationId: string, routeId: string): Promise<number> {
  const all = await getAll<DepartRecord>('departs');
  const routeDeparts = all.filter(d => d.station_id === stationId && d.route_id === routeId);
  if (routeDeparts.length === 0) return 1;
  return Math.max(...routeDeparts.map(d => d.route_number ?? 0)) + 1;
}

export async function createDepart(
  data: Omit<DepartRecord, 'id' | 'created_at' | 'updated_at' | 'synced' | 'departure_number' | 'route_number' | 'seats_sold' | 'cloture' | 'mt_ticket' | 'mt_bagage' | 'tot_depense' | 'solde' | 'caisse' | 'confirmed' | 'cancelled'>,
): Promise<DepartRecord> {
  const departureNumber = await nextDepartureNumber(data.station_id);
  const routeNumber = await nextRouteNumber(data.station_id, data.route_id);

  return localInsert<DepartRecord>('departs', {
    ...data,
    departure_number: departureNumber,
    route_number: routeNumber,
    seats_sold: 0,
    cloture: false,
    mt_ticket: 0,
    mt_bagage: 0,
    tot_depense: 0,
    solde: 0,
    caisse: 0,
    confirmed: false,
    cancelled: false,
  });
}

export async function updateDepart(
  id: string,
  patch: Partial<DepartRecord>,
): Promise<DepartRecord | null> {
  return localUpdate<DepartRecord>('departs', id, patch);
}

export async function getAllDeparts(stationId?: string): Promise<DepartRecord[]> {
  const all = await getAll<DepartRecord>('departs');
  if (stationId) return all.filter(d => d.station_id === stationId);
  return all;
}

export async function getDepartById(id: string): Promise<DepartRecord | undefined> {
  const all = await getAll<DepartRecord>('departs');
  return all.find(d => d.id === id);
}

export function seatsLibres(d: DepartRecord): number {
  return d.seats_total - d.seats_sold;
}

export function computeSolde(d: DepartRecord): number {
  return d.mt_ticket + d.mt_bagage - d.tot_depense;
}

export async function cloturerDepart(
  departId: string,
  userName?: string,
): Promise<DepartRecord | null> {
  return localUpdate<DepartRecord>('departs', departId, {
    cloture: true,
    cloture_at: new Date().toISOString(),
    cloture_by: userName,
  });
}

export async function getDepartsForOtherStations(currentStationId: string): Promise<DepartRecord[]> {
  const all = await getAll<DepartRecord>('departs');
  return all.filter(d => d.station_id !== currentStationId && !d.cancelled);
}
