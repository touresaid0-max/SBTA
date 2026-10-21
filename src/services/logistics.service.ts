import { supabase } from '@/services/supabase'
import type {
  ServiceType,
  ServiceTypeInput,
  Provider,
  ProviderInput,
  Vehicle,
  VehicleInput,
  VehicleDocument,
  VehicleDocumentInput,
  VehiclePlate,
  ProvisionalPlateInput,
  DefinitivePlateInput,
  DocumentStatus,
  PlateStatus,
  AlertLevel,
  DocumentAlert,
} from '@/types/logistics.types'

export interface LogisticsBus {
  id:                  string
  registration_number: string
  brand:               string | null
  manufacturer:        string | null
  model:               string | null
  total_seats:         number | null
  company_id:          string | null
  status:              string | null
  is_active:           boolean | null
}

export interface LogisticsCompany {
  id:   string
  name: string
  code: string
}

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser()
  if (!data.user) throw new Error('Utilisateur non authentifié')
  return data.user.id
}

// ── Service types ────────────────────────────────────────────────

function mapServiceType(row: any): ServiceType {
  return {
    ...row,
    default_amount: Number(row.default_amount ?? 0),
    default_provider_name: row.default_provider?.name ?? null,
  }
}

export async function fetchServiceTypes(): Promise<ServiceType[]> {
  const { data, error } = await supabase
    .from('logistics_service_types')
    .select('*, default_provider:logistics_providers(id,name)')
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []).map(mapServiceType)
}

export async function createServiceType(input: ServiceTypeInput): Promise<ServiceType> {
  const { data, error } = await supabase
    .from('logistics_service_types')
    .insert(input)
    .select('*, default_provider:logistics_providers(id,name)')
    .single()
  if (error) throw error
  return mapServiceType(data)
}

export async function updateServiceType(id: string, input: ServiceTypeInput): Promise<ServiceType> {
  const { data, error } = await supabase
    .from('logistics_service_types')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*, default_provider:logistics_providers(id,name)')
    .single()
  if (error) throw error
  return mapServiceType(data)
}

export async function deleteServiceType(id: string): Promise<void> {
  const { error } = await supabase.from('logistics_service_types').delete().eq('id', id)
  if (error) throw error
}

// ── Providers ────────────────────────────────────────────────────

export async function fetchProviders(): Promise<Provider[]> {
  const { data, error } = await supabase
    .from('logistics_providers')
    .select('*')
    .order('name', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function createProvider(input: ProviderInput): Promise<Provider> {
  const { data, error } = await supabase
    .from('logistics_providers')
    .insert(input)
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function updateProvider(id: string, input: ProviderInput): Promise<Provider> {
  const { data, error } = await supabase
    .from('logistics_providers')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function deleteProvider(id: string): Promise<void> {
  const { error } = await supabase.from('logistics_providers').delete().eq('id', id)
  if (error) throw error
}

// ── Vehicles (fiche) ─────────────────────────────────────────────

function mapVehicle(row: any): Vehicle {
  return {
    ...row,
    company_name: row.company?.name ?? null,
    company_code: row.company?.code ?? null,
  }
}

export async function fetchVehicles(): Promise<Vehicle[]> {
  const { data, error } = await supabase
    .from('vehicle_logistics')
    .select('*, company:companies(id,name,code)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(mapVehicle)
}

export async function fetchVehicle(id: string): Promise<Vehicle> {
  const { data, error } = await supabase
    .from('vehicle_logistics')
    .select('*, company:companies(id,name,code)')
    .eq('id', id)
    .single()
  if (error) throw error
  return mapVehicle(data)
}

export async function createVehicle(input: VehicleInput): Promise<Vehicle> {
  const { data, error } = await supabase
    .from('vehicle_logistics')
    .insert(input)
    .select('*, company:companies(id,name,code)')
    .single()
  if (error) throw error
  return mapVehicle(data)
}

export async function updateVehicle(id: string, input: VehicleInput): Promise<Vehicle> {
  const { data, error } = await supabase
    .from('vehicle_logistics')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*, company:companies(id,name,code)')
    .single()
  if (error) throw error
  // Keep the linked bus plate in sync with the fiche (definitive plate wins, else provisional)
  if (data.bus_id) {
    const plate = data.registration_number || data.provisional_number
    if (plate) {
      await supabase
        .from('buses')
        .update({ registration_number: plate, updated_at: new Date().toISOString() })
        .eq('id', data.bus_id)
    }
  }
  return mapVehicle(data)
}

export async function deleteVehicle(id: string): Promise<void> {
  const { error } = await supabase.from('vehicle_logistics').delete().eq('id', id)
  if (error) throw error
}

// Picker list for documents/plates: every bus is selectable. Buses already linked
// to a vehicle_logistics fiche reuse it; the rest are shown as synthetic entries
// (id prefixed with "bus:") and get a real fiche created on first use.
export async function fetchVehiclesForPicker(): Promise<Vehicle[]> {
  const [buses, vehicles, companies] = await Promise.all([
    fetchBuses(),
    fetchVehicles(),
    fetchCompanies(),
  ])
  const companyName = new Map(companies.map(c => [c.id, c.name]))
  const ficheByBus = new Map<string, Vehicle>()
  for (const v of vehicles) if (v.bus_id) ficheByBus.set(v.bus_id, v)

  const result: Vehicle[] = []
  // Standalone fiches not linked to a bus
  for (const v of vehicles) if (!v.bus_id) result.push(v)

  for (const b of buses) {
    const fiche = ficheByBus.get(b.id)
    if (fiche) { result.push(fiche); continue }
    result.push({
      id: `bus:${b.id}`,
      bus_id: b.id,
      company_id: b.company_id,
      registration_number: b.registration_number,
      provisional_number: null,
      brand: b.brand ?? b.manufacturer,
      model: b.model,
      total_seats: b.total_seats,
      circulation_date: null,
      chassis_number: null,
      carte_grise_number: null,
      plate_status: 'definitive',
      observation: null,
      created_at: '',
      updated_at: '',
      company_name: b.company_id ? companyName.get(b.company_id) ?? null : null,
    })
  }
  return result
}

// Resolve a picker selection to a real vehicle_logistics id, creating the fiche
// for the bus if it does not exist yet.
export async function ensureVehicleForBus(busId: string): Promise<string> {
  const { data: existing, error: selErr } = await supabase
    .from('vehicle_logistics')
    .select('id')
    .eq('bus_id', busId)
    .maybeSingle()
  if (selErr) throw selErr
  if (existing) return existing.id

  const { data: bus, error: busErr } = await supabase
    .from('buses')
    .select('id, registration_number, brand, manufacturer, model, total_seats, company_id')
    .eq('id', busId)
    .single()
  if (busErr) throw busErr

  const { data, error } = await supabase
    .from('vehicle_logistics')
    .insert({
      bus_id: bus.id,
      company_id: bus.company_id,
      registration_number: bus.registration_number,
      brand: bus.brand ?? bus.manufacturer,
      model: bus.model,
      total_seats: bus.total_seats,
      plate_status: 'definitive',
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export async function fetchBuses(): Promise<LogisticsBus[]> {
  const { data, error } = await supabase
    .from('buses')
    .select('id, registration_number, brand, manufacturer, model, total_seats, company_id, status, is_active')
    .is('archived_at', null)
    .order('registration_number', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function fetchCompanies(): Promise<LogisticsCompany[]> {
  const { data, error } = await supabase
    .from('companies')
    .select('id, name, code')
    .order('name', { ascending: true })
  if (error) throw error
  return data ?? []
}

// ── Documents ────────────────────────────────────────────────────

function mapDocument(row: any): VehicleDocument {
  return {
    ...row,
    amount: Number(row.amount ?? 0),
    vehicle: row.vehicle ? { ...row.vehicle } : null,
  }
}

const DOC_SELECT = '*, vehicle:vehicle_logistics(id,registration_number,provisional_number,company_id,plate_status)'

export async function fetchDocuments(): Promise<VehicleDocument[]> {
  const { data, error } = await supabase
    .from('vehicle_documents')
    .select(DOC_SELECT)
    .order('expiry_date', { ascending: true })
  if (error) throw error
  return (data ?? []).map(mapDocument)
}

export async function fetchVehicleDocuments(vehicleId: string): Promise<VehicleDocument[]> {
  const { data, error } = await supabase
    .from('vehicle_documents')
    .select(DOC_SELECT)
    .eq('vehicle_id', vehicleId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(mapDocument)
}

export async function createDocument(input: VehicleDocumentInput): Promise<VehicleDocument> {
  const created_by = await currentUserId()
  const status = computeStatus(input.expiry_date)
  const { data, error } = await supabase
    .from('vehicle_documents')
    .insert({ ...input, created_by, is_current: true, status })
    .select(DOC_SELECT)
    .single()
  if (error) throw error
  return mapDocument(data)
}

export async function updateDocument(id: string, input: VehicleDocumentInput): Promise<VehicleDocument> {
  const status = computeStatus(input.expiry_date)
  const { data, error } = await supabase
    .from('vehicle_documents')
    .update({ ...input, status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(DOC_SELECT)
    .single()
  if (error) throw error
  return mapDocument(data)
}

export async function deleteDocument(id: string): Promise<void> {
  const { error } = await supabase.from('vehicle_documents').delete().eq('id', id)
  if (error) throw error
}

export async function renewDocument(oldId: string, input: VehicleDocumentInput): Promise<VehicleDocument> {
  const created_by = await currentUserId()
  const { error: archiveErr } = await supabase
    .from('vehicle_documents')
    .update({ status: 'renouvele', is_current: false, updated_at: new Date().toISOString() })
    .eq('id', oldId)
  if (archiveErr) throw archiveErr

  const status = computeStatus(input.expiry_date)
  const { data, error } = await supabase
    .from('vehicle_documents')
    .insert({ ...input, created_by, is_current: true, previous_document_id: oldId, status })
    .select(DOC_SELECT)
    .single()
  if (error) throw error
  return mapDocument(data)
}

// ── Plates ───────────────────────────────────────────────────────

export async function fetchAllPlates(): Promise<VehiclePlate[]> {
  const { data, error } = await supabase
    .from('vehicle_plates')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function fetchVehiclePlates(vehicleId: string): Promise<VehiclePlate[]> {
  const { data, error } = await supabase
    .from('vehicle_plates')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function addProvisionalPlate(vehicleId: string, input: ProvisionalPlateInput): Promise<VehiclePlate> {
  const changed_by = await currentUserId()
  // deactivate any current active plate
  await supabase
    .from('vehicle_plates')
    .update({ is_active: false, replaced_at: new Date().toISOString() })
    .eq('vehicle_id', vehicleId)
    .eq('is_active', true)

  const { data, error } = await supabase
    .from('vehicle_plates')
    .insert({
      vehicle_id: vehicleId,
      plate_type: 'provisoire',
      plate_number: input.plate_number,
      recepisse_date: input.recepisse_date,
      recepisse_expiry: input.recepisse_expiry,
      recepisse_url: input.recepisse_url,
      observation: input.observation,
      is_active: true,
      changed_by,
    })
    .select('*')
    .single()
  if (error) throw error

  await supabase
    .from('vehicle_logistics')
    .update({ provisional_number: input.plate_number, plate_status: 'provisoire', updated_at: new Date().toISOString() })
    .eq('id', vehicleId)

  await syncBusRegistration(vehicleId, input.plate_number)

  return data
}

// Propagate the current plate to the linked bus (admin/global fleet view).
async function syncBusRegistration(vehicleId: string, plate: string): Promise<void> {
  if (!plate) return
  const { data: vl } = await supabase
    .from('vehicle_logistics')
    .select('bus_id')
    .eq('id', vehicleId)
    .maybeSingle()
  if (vl?.bus_id) {
    await supabase
      .from('buses')
      .update({ registration_number: plate, updated_at: new Date().toISOString() })
      .eq('id', vl.bus_id)
  }
}

// Remplacement par plaque définitive: la plaque provisoire n'est jamais supprimée,
// elle est conservée dans l'historique (is_active=false, replaced_at, replaced_by_plate_id).
export async function replaceWithDefinitivePlate(
  vehicleId: string,
  oldPlateId: string | null,
  input: DefinitivePlateInput,
): Promise<VehiclePlate> {
  const changed_by = await currentUserId()

  const { data, error } = await supabase
    .from('vehicle_plates')
    .insert({
      vehicle_id: vehicleId,
      plate_type: 'definitive',
      plate_number: input.plate_number,
      carte_grise_number: input.carte_grise_number,
      carte_grise_issue_date: input.carte_grise_issue_date,
      carte_grise_received_date: input.carte_grise_received_date,
      carte_grise_url: input.carte_grise_url,
      observation: input.observation,
      is_active: false,
      changed_by,
    })
    .select('*')
    .single()
  if (error) throw error

  // Archive the old provisional plate (never deleted)
  if (oldPlateId) {
    await supabase
      .from('vehicle_plates')
      .update({
        is_active: false,
        replaced_at: new Date().toISOString(),
        replaced_by_plate_id: data.id,
      })
      .eq('id', oldPlateId)
  } else {
    await supabase
      .from('vehicle_plates')
      .update({ is_active: false, replaced_at: new Date().toISOString(), replaced_by_plate_id: data.id })
      .eq('vehicle_id', vehicleId)
      .eq('is_active', true)
  }

  // Activate the new definitive plate
  const { data: activated, error: actErr } = await supabase
    .from('vehicle_plates')
    .update({ is_active: true })
    .eq('id', data.id)
    .select('*')
    .single()
  if (actErr) throw actErr

  await supabase
    .from('vehicle_logistics')
    .update({
      registration_number: input.plate_number,
      carte_grise_number: input.carte_grise_number,
      plate_status: 'carte_grise_disponible',
      updated_at: new Date().toISOString(),
    })
    .eq('id', vehicleId)

  await syncBusRegistration(vehicleId, input.plate_number)

  return activated
}

// ── Upload ───────────────────────────────────────────────────────

export async function uploadLogisticsDocument(file: File): Promise<string> {
  const ext = file.name.split('.').pop()
  const path = `docs/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from('logistics-documents').upload(path, file, {
    contentType: file.type,
    upsert: false,
  })
  if (error) throw error
  const { data } = supabase.storage.from('logistics-documents').getPublicUrl(path)
  return data.publicUrl
}

// ── Helpers: status & alerts ─────────────────────────────────────

export function daysUntil(dateStr: string | null): number {
  if (!dateStr) return Infinity
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(dateStr)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

export function computeStatus(expiry: string | null): DocumentStatus {
  if (!expiry) return 'valide'
  const d = daysUntil(expiry)
  if (d < 0) return 'expire'
  if (d <= 30) return 'proche_echeance'
  return 'valide'
}

export function effectiveStatus(doc: VehicleDocument): DocumentStatus {
  if (doc.status === 'renouvele') return 'renouvele'
  if (doc.status === 'inactif') return 'inactif'
  return computeStatus(doc.expiry_date)
}

export function alertLevel(doc: VehicleDocument): AlertLevel {
  const s = effectiveStatus(doc)
  switch (s) {
    case 'renouvele': return 'blue'
    case 'expire':    return 'red'
    case 'proche_echeance': return 'orange'
    case 'inactif':   return 'gray'
    default:          return 'green'
  }
}

const ALERT_THRESHOLDS: (90 | 60 | 30 | 15 | 7)[] = [7, 15, 30, 60, 90]

export function buildAlerts(documents: VehicleDocument[]): DocumentAlert[] {
  const alerts: DocumentAlert[] = []
  for (const doc of documents) {
    if (!doc.is_current) continue
    if (doc.status === 'renouvele' || doc.status === 'inactif') continue
    if (!doc.expiry_date) continue
    const d = daysUntil(doc.expiry_date)
    const reg = doc.vehicle?.registration_number || doc.vehicle?.provisional_number || 'Véhicule'

    let threshold: 90 | 60 | 30 | 15 | 7 | 0 | null = null
    let level: AlertLevel = 'green'
    let message = ''

    if (d < 0) {
      threshold = 0
      level = 'red'
      message = `${reg} · ${doc.service_type_name} : expiré depuis ${Math.abs(d)} j`
    } else if (d === 0) {
      threshold = 0
      level = 'red'
      message = `${reg} · ${doc.service_type_name} : échéance aujourd'hui`
    } else {
      const hit = ALERT_THRESHOLDS.find((t) => d <= t)
      if (hit) {
        threshold = hit
        level = d <= 15 ? 'orange' : 'orange'
        message = `${reg} · ${doc.service_type_name} : échéance dans ${d} j`
      }
    }

    if (threshold !== null) {
      alerts.push({ document: doc, level, daysLeft: d, threshold, message })
    }
  }
  return alerts.sort((a, b) => a.daysLeft - b.daysLeft)
}

export const STATUS_LABELS: Record<DocumentStatus, string> = {
  valide:          'Valide',
  proche_echeance: 'Proche échéance',
  expire:          'Expiré',
  renouvele:       'Renouvelé',
  inactif:         'Inactif',
}

export const PLATE_STATUS_LABELS: Record<PlateStatus, string> = {
  provisoire:             'Plaque provisoire',
  definitive:             'Plaque définitive',
  attente_carte_grise:    'En attente carte grise',
  carte_grise_disponible: 'Carte grise disponible',
}

export function computeExpiry(issueDate: string, validityMonths: number): string {
  if (!issueDate || !validityMonths) return ''
  const d = new Date(issueDate)
  d.setMonth(d.getMonth() + validityMonths)
  return d.toISOString().slice(0, 10)
}
