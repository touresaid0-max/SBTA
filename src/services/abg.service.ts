import { supabase } from './supabase'

export interface Bordereau {
  id: string
  bordereau_date: string
  guichet_src_id: string | null
  gare_label: string
  segment_code: string | null
  societe_code: string
  source: 'auto' | 'import'
  schedule_id: string | null
  total_tickets: number
  total_seats: number
  total_mt_ticket: number
  total_depense_pr: number
  total_solde: number
  total_baggage: number
  status: 'recu' | 'verifie' | 'ecart'
  ecart_comment: string | null
  verified_by: string | null
  verified_at: string | null
  created_at: string
  updated_at: string
}

export interface BordereauLigne {
  id: string
  bordereau_id: string
  car_matricule: string
  departure_number: number | null
  seats: number
  mt_ticket: number
  depense_pr: number
  solde_ticket: number
  bagage: number
}

export interface AbgSociete {
  id: string
  code: string
  name: string
  sub_group: string | null
  is_active: boolean
}

export interface AbgSegment {
  id: string
  code: string
  label: string
  origin_city: string
  destination_city: string
  is_active: boolean
}

export interface AbgGuichetSrc {
  id: string
  station_id: string
  societe_id: string
  gare_label: string
  is_active: boolean
}

export interface DailyConsolidation {
  date: string
  gare_label: string
  societe_code: string
  segment_code: string | null
  nb_bordereaux: number
  total_seats: number
  recettes_totales: number
  depense_pr: number
  rations: number
  gasoil: number
  peages: number
  autres_depenses: number
  resultats: number
  bagage_total: number
  cars_liste: string | null
}

export interface WeeklyConsolidation {
  semaine: string
  societe_code: string
  libelle: string
  total_seats: number
  recettes: number
  depense_pr: number
  rations: number
  gasoil: number
  peages: number
  autres_depenses: number
  resultats: number
  bagage_total: number
}

export interface MonthlyConsolidation {
  mois: string
  societe_code: string
  segment_code: string | null
  semaine_mois: string
  recettes: number
  depenses: number
  resultats: number
  bagage_total: number
  total_seats: number
}

export interface AnnualConsolidation {
  annee: string
  mois_num: string
  mois_label: string
  societe_code: string
  segment_code: string | null
  recettes: number
  depenses: number
  resultats: number
  bagage_total: number
  total_seats: number
}

export async function fetchBordereaux(filters?: {
  gare?: string
  societe?: string
  segment?: string
  status?: string
  dateFrom?: string
  dateTo?: string
}): Promise<Bordereau[]> {
  let q = supabase
    .from('abg_bordereaux')
    .select('*')
    .order('bordereau_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (filters?.gare) q = q.eq('gare_label', filters.gare)
  if (filters?.societe) q = q.eq('societe_code', filters.societe)
  if (filters?.segment) q = q.eq('segment_code', filters.segment)
  if (filters?.status) q = q.eq('status', filters.status)
  if (filters?.dateFrom) q = q.gte('bordereau_date', filters.dateFrom)
  if (filters?.dateTo) q = q.lte('bordereau_date', filters.dateTo)

  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

export async function fetchBordereauLignes(bordereauId: string): Promise<BordereauLigne[]> {
  const { data, error } = await supabase
    .from('abg_bordereau_lignes')
    .select('*')
    .eq('bordereau_id', bordereauId)
    .order('car_matricule')
  if (error) throw error
  return data ?? []
}

export async function fetchSocietes(): Promise<AbgSociete[]> {
  // 1. Fetch companies (has hierarchy via parent_id / is_group)
  const { data: companies, error: err1 } = await supabase
    .from('companies')
    .select('id, code, name, parent_id, is_group, is_active')
    .order('code')
  if (err1) throw err1

  // Build parent-id → parent-code map
  const parentCodeMap = new Map<string, string>()
  for (const c of companies ?? []) parentCodeMap.set(c.id, c.code)

  // Map companies to AbgSociete with sub_group derived from hierarchy:
  //  - a group row gets sub_group = its own code (acts as the group key)
  //  - a child row gets sub_group = its parent's code
  //  - standalone rows get sub_group = null
  const fromCompanies: AbgSociete[] = (companies ?? []).map(c => ({
    id: c.id,
    code: c.code,
    name: c.name,
    sub_group: c.is_group ? c.code : (c.parent_id ? parentCodeMap.get(c.parent_id) ?? null : null),
    is_active: c.is_active,
  }))

  // 2. Fetch abg_societes for entries that exist only there (e.g. AUTRES)
  const { data: abgOnly, error: err2 } = await supabase
    .from('abg_societes')
    .select('*')
    .eq('is_active', true)
    .order('code')
  if (err2) throw err2

  const existingCodes = new Set(fromCompanies.map(s => s.code))
  const extra = (abgOnly ?? []).filter(s => !existingCodes.has(s.code))

  return [...fromCompanies, ...extra]
}

export async function fetchSegments(): Promise<AbgSegment[]> {
  const { data, error } = await supabase
    .from('abg_segments')
    .select('*')
    .eq('is_active', true)
    .order('code')
  if (error) throw error
  return data ?? []
}

export async function fetchGuichetSrcs(): Promise<AbgGuichetSrc[]> {
  const { data, error } = await supabase
    .from('abg_guichet_srcs')
    .select('*')
    .eq('is_active', true)
    .order('gare_label')
  if (error) throw error
  return data ?? []
}

export async function importBordereau(data: {
  bordereau_date: string
  guichet_src_id?: string | null
  gare_label: string
  segment_code?: string
  societe_code: string
  total_tickets?: number
  total_seats?: number
  total_mt_ticket?: number
  total_depense_pr?: number
  total_baggage?: number
  lignes: Array<{
    car_matricule: string
    departure_number?: string
    seats?: number
    mt_ticket?: number
    depense_pr?: number
    bagage?: number
  }>
}): Promise<string> {
  const { data: result, error } = await supabase.rpc('abg_import_bordereau', {
    p_data: data as unknown as Record<string, unknown>,
  })
  if (error) throw error
  return result as string
}

export async function verifyBordereau(
  bordereauId: string,
  action: 'verify' | 'dispute',
  comment?: string
): Promise<{ success?: boolean; error?: string; ecarts?: string[]; status?: string }> {
  const { data, error } = await supabase.rpc('abg_verify_bordereau', {
    p_bordereau_id: bordereauId,
    p_action: action,
    p_comment: comment ?? null,
  })
  if (error) throw error
  return data as { success?: boolean; error?: string; ecarts?: string[]; status?: string }
}

export async function fetchDailyConsolidation(dateFrom?: string, dateTo?: string): Promise<DailyConsolidation[]> {
  let q = supabase.from('abg_daily_consolidation').select('*')
  if (dateFrom) q = q.gte('date', dateFrom)
  if (dateTo) q = q.lte('date', dateTo)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

export async function fetchWeeklyConsolidation(): Promise<WeeklyConsolidation[]> {
  const { data, error } = await supabase.from('abg_weekly_consolidation').select('*')
  if (error) throw error
  return data ?? []
}

export async function fetchMonthlyConsolidation(): Promise<MonthlyConsolidation[]> {
  const { data, error } = await supabase.from('abg_monthly_consolidation').select('*')
  if (error) throw error
  return data ?? []
}

export async function fetchAnnualConsolidation(): Promise<AnnualConsolidation[]> {
  const { data, error } = await supabase.from('abg_annual_consolidation').select('*')
  if (error) throw error
  return data ?? []
}

// ============================================================
// Dépenses AO / HAO
// ============================================================

export interface AbgDepense {
  id: string
  date_depense: string
  source_libelle: string
  nature: string
  montant: number
  type_depense: 'AO' | 'HAO'
  categorie: string | null
  societe_code: string | null
  car_matricule: string | null
  gare_label: string | null
  description: string | null
  created_by: string | null
  created_at: string
}

export interface AbgDepenseCategory {
  id: string
  code: string
  label: string
  type_depense: 'AO' | 'HAO'
  is_active: boolean
  sort_order: number
}

export async function fetchDepenses(filters?: {
  type?: string
  categorie?: string
  source?: string
  dateFrom?: string
  dateTo?: string
}): Promise<AbgDepense[]> {
  let q = supabase
    .from('abg_depenses')
    .select('*')
    .order('date_depense', { ascending: false })
    .order('created_at', { ascending: false })

  if (filters?.type) q = q.eq('type_depense', filters.type)
  if (filters?.categorie) q = q.eq('categorie', filters.categorie)
  if (filters?.source) q = q.eq('source_libelle', filters.source)
  if (filters?.dateFrom) q = q.gte('date_depense', filters.dateFrom)
  if (filters?.dateTo) q = q.lte('date_depense', filters.dateTo)

  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

export async function fetchDepenseCategories(): Promise<AbgDepenseCategory[]> {
  const { data, error } = await supabase
    .from('abg_depense_categories')
    .select('*')
    .eq('is_active', true)
    .order('type_depense')
    .order('sort_order')
  if (error) throw error
  return data ?? []
}

export async function createDepense(depense: Omit<AbgDepense, 'id' | 'created_by' | 'created_at'>): Promise<AbgDepense> {
  const { data, error } = await supabase
    .from('abg_depenses')
    .insert(depense)
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function deleteDepense(id: string): Promise<void> {
  const { error } = await supabase.from('abg_depenses').delete().eq('id', id)
  if (error) throw error
}

export async function createDepenseCategory(cat: {
  code: string
  label: string
  type_depense: 'AO' | 'HAO'
}): Promise<AbgDepenseCategory> {
  const { data, error } = await supabase
    .from('abg_depense_categories')
    .insert({ code: cat.code, label: cat.label, type_depense: cat.type_depense, is_active: true, sort_order: 999 })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function updateDepenseCategory(id: string, patch: { label?: string; is_active?: boolean; sort_order?: number }): Promise<AbgDepenseCategory> {
  const { data, error } = await supabase
    .from('abg_depense_categories')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function deleteDepenseCategory(id: string): Promise<void> {
  const { error } = await supabase.from('abg_depense_categories').delete().eq('id', id)
  if (error) throw error
}

export async function fetchBusesForAbg(): Promise<{ id: string; registration_number: string; model: string | null; manufacturer: string | null; company_id: string | null }[]> {
  const { data, error } = await supabase
    .from('buses')
    .select('id, registration_number, model, manufacturer, company_id')
    .order('registration_number')
  if (error) throw error
  return (data ?? []) as { id: string; registration_number: string; model: string | null; manufacturer: string | null; company_id: string | null }[]
}

// ============================================================
// POS Revenue Tracking (Suivi des recettes)
// ============================================================

export interface PosScheduleRow {
  id: string
  route_id: string | null
  route_name: string | null
  bus_id: string | null
  bus_registration: string | null
  company_id: string | null
  company_code: string | null
  company_parent_id: string | null
  departure_station_id: string | null
  departure_station_name: string | null
  departure_number: number | null
  departure_datetime: string
  status: string
  seats_reserved: number
  seats_available: number
  price: number
  segment_code: string | null
  counter_id: string | null
}

export interface AbgSegmentPair {
  code: string
  label: string
  departureStationId: string
  arrivalStationId: string
}

export const ABG_SEGMENTS: AbgSegmentPair[] = [
  { code: 'YOPOUGON_AGBOVILLE', label: 'Yopougon → Agboville', departureStationId: '232639e7-86ef-4506-a46f-b0a36868859a', arrivalStationId: '61c66685-897b-45a6-bd87-99d2810fb75b' },
  { code: 'AGBOVILLE_YOPOUGON', label: 'Agboville → Yopougon', departureStationId: '61c66685-897b-45a6-bd87-99d2810fb75b', arrivalStationId: '232639e7-86ef-4506-a46f-b0a36868859a' },
  { code: 'ADJAME_MIRADOR_AGBOVILLE', label: 'Adjamé Mirador → Agboville', departureStationId: '5b5a48ba-06a8-4cda-8be1-0f80e9a6d54e', arrivalStationId: '61c66685-897b-45a6-bd87-99d2810fb75b' },
  { code: 'AGBOVILLE_ADJAME', label: 'Agboville → Adjamé', departureStationId: '61c66685-897b-45a6-bd87-99d2810fb75b', arrivalStationId: '51000001-0000-0000-0000-000000000001' },
  { code: 'AGBOVILLE_GAGNOA_AGBOVILLE', label: 'Agboville → Gagnoa → Agboville', departureStationId: '61c66685-897b-45a6-bd87-99d2810fb75b', arrivalStationId: '6e4fbaa3-836a-4a94-883e-42e6330cd4f0' },
]

export async function fetchPosSchedules(filters?: {
  dateFrom?: string
  dateTo?: string
  stationIds?: string[]
  counterIds?: string[]
  segmentCodes?: string[]
}): Promise<PosScheduleRow[]> {
  const activeSegments = filters?.segmentCodes && filters.segmentCodes.length > 0
    ? ABG_SEGMENTS.filter(s => filters.segmentCodes!.includes(s.code))
    : ABG_SEGMENTS

  const depStationIds = [...new Set(activeSegments.map(s => s.departureStationId))]
  const segmentPairs = new Map<string, AbgSegmentPair>()
  for (const seg of activeSegments) {
    segmentPairs.set(`${seg.departureStationId}|${seg.arrivalStationId}`, seg)
  }
  const segmentByDeparture = new Map<string, AbgSegmentPair[]>()
  for (const seg of activeSegments) {
    const list = segmentByDeparture.get(seg.departureStationId) ?? []
    list.push(seg)
    segmentByDeparture.set(seg.departureStationId, list)
  }

  function matchSegment(s: { departure_station_id: string | null; arrival_station_id: string | null; route_name: string | null }): AbgSegmentPair | null {
    if (!s.departure_station_id) return null
    const pairKey = `${s.departure_station_id}|${s.arrival_station_id}`
    const exact = segmentPairs.get(pairKey)
    if (exact) return exact
    const candidates = segmentByDeparture.get(s.departure_station_id)
    if (!candidates) return null
    if (s.arrival_station_id) {
      const byArrival = candidates.find(c => c.arrivalStationId === s.arrival_station_id)
      if (byArrival) return byArrival
    }
    const routeLower = (s.route_name ?? '').toLowerCase()
    for (const c of candidates) {
      const destLower = c.label.split('→')[1]?.trim().toLowerCase() ?? ''
      if (destLower && routeLower.includes(destLower)) return c
    }
    if (candidates.length === 1) return candidates[0]
    return null
  }

  let q = supabase
    .from('schedules')
    .select(`
      id, route_id, route_name, bus_id, departure_station_id, arrival_station_id, counter_id, departure_number,
      departure_datetime, status, seats_reserved, seats_available, price
    `)
    .order('departure_datetime', { ascending: false })

  if (filters?.dateFrom) q = q.gte('departure_datetime', filters.dateFrom)
  if (filters?.dateTo) q = q.lte('departure_datetime', filters.dateTo + 'T23:59:59')
  if (filters?.stationIds && filters.stationIds.length > 0) {
    q = q.in('departure_station_id', filters.stationIds)
  } else {
    q = q.in('departure_station_id', depStationIds)
  }
  if (filters?.counterIds && filters.counterIds.length > 0) q = q.in('counter_id', filters.counterIds)

  const { data: schedules, error } = await q
  if (error) throw error
  if (!schedules || schedules.length === 0) return []

  const filteredSchedules = schedules.filter(s => matchSegment(s) !== null)
  if (filteredSchedules.length === 0) return []

  const busIds = [...new Set(filteredSchedules.map(s => s.bus_id).filter(Boolean))] as string[]
  const stationIds = [...new Set(filteredSchedules.map(s => s.departure_station_id).filter(Boolean))] as string[]

  const [busesRes, stationsRes, companiesRes] = await Promise.all([
    busIds.length > 0
      ? supabase.from('buses').select('id, registration_number, company_id').in('id', busIds)
      : Promise.resolve({ data: [], error: null }),
    stationIds.length > 0
      ? supabase.from('stations').select('id, name').in('id', stationIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('companies').select('id, code, parent_id'),
  ])

  if (busesRes.error) throw busesRes.error
  if (stationsRes.error) throw stationsRes.error
  if (companiesRes.error) throw companiesRes.error

  const busMap = new Map<string, { registration_number: string; company_id: string | null }>()
  for (const b of (busesRes.data ?? []) as { id: string; registration_number: string; company_id: string | null }[]) {
    busMap.set(b.id, { registration_number: b.registration_number, company_id: b.company_id })
  }

  const stationMap = new Map<string, string>()
  for (const s of (stationsRes.data ?? []) as { id: string; name: string }[]) {
    stationMap.set(s.id, s.name)
  }

  const companyMap = new Map<string, { code: string; parent_id: string | null }>()
  for (const c of (companiesRes.data ?? []) as { id: string; code: string; parent_id: string | null }[]) {
    companyMap.set(c.id, { code: c.code, parent_id: c.parent_id })
  }

  return filteredSchedules.map(s => {
    const bus = s.bus_id ? busMap.get(s.bus_id) : null
    const company = bus?.company_id ? companyMap.get(bus.company_id) : null
    const seg = matchSegment(s)
    return {
      id: s.id,
      route_id: s.route_id,
      route_name: seg?.label ?? s.route_name,
      bus_id: s.bus_id,
      bus_registration: bus?.registration_number ?? null,
      company_id: bus?.company_id ?? null,
      company_code: company?.code ?? null,
      company_parent_id: company?.parent_id ?? null,
      departure_station_id: s.departure_station_id,
      departure_station_name: s.departure_station_id ? stationMap.get(s.departure_station_id) ?? null : null,
      departure_number: s.departure_number,
      departure_datetime: s.departure_datetime,
      status: s.status,
      seats_reserved: s.seats_reserved ?? 0,
      seats_available: s.seats_available ?? 0,
      price: s.price ?? 0,
      segment_code: seg?.code ?? null,
      counter_id: s.counter_id ?? null,
    }
  })
}

export interface PosReservationRow {
  id: string
  schedule_id: string
  total_seats: number
  total_price: number
  baggage_fee: number
  status: string
  payment_status: string | null
  created_at: string
}

export async function fetchPosReservations(scheduleIds: string[]): Promise<PosReservationRow[]> {
  if (scheduleIds.length === 0) return []
  const all: PosReservationRow[] = []
  for (let i = 0; i < scheduleIds.length; i += 200) {
    const batch = scheduleIds.slice(i, i + 200)
    const { data, error } = await supabase
      .from('reservations')
      .select('id, schedule_id, total_seats, total_price, baggage_fee, status, payment_status, created_at')
      .in('schedule_id', batch)
    if (error) throw error
    if (data) all.push(...(data as PosReservationRow[]))
  }
  return all
}

export interface PosChargeRow {
  id: string
  schedule_id: string
  charge_type: string
  description: string | null
  amount: number
  status: string
}

export async function fetchPosCharges(scheduleIds: string[]): Promise<PosChargeRow[]> {
  if (scheduleIds.length === 0) return []
  const all: PosChargeRow[] = []
  for (let i = 0; i < scheduleIds.length; i += 200) {
    const batch = scheduleIds.slice(i, i + 200)
    const { data, error } = await supabase
      .from('counter_charges')
      .select('id, schedule_id, charge_type, description, amount, status')
      .in('schedule_id', batch)
    if (error) throw error
    if (data) all.push(...(data as PosChargeRow[]))
  }
  return all
}

export function classifyCharge(chargeType: string, description: string | null): 'rations' | 'carburant' | 'peages' | 'autres' {
  const ct = chargeType.toLowerCase()
  if (ct === 'ration') return 'rations'
  if (ct === 'carburant_complement' || ct === 'carburant') return 'carburant'
  if (ct === 'peage') return 'peages'
  const desc = (description ?? '').toLowerCase().trim()
  if (desc.includes('ration') || desc === 'ratios' || desc === 'ratio') return 'rations'
  if (desc.includes('carburant') || desc.includes('essence')) return 'carburant'
  if (desc.includes('peage') || desc.includes('péage') || desc.includes('toll')) return 'peages'
  return 'autres'
}

export async function fetchAgbovilleStations(): Promise<{ id: string; name: string }[]> {
  const stationIds = [...new Set(ABG_SEGMENTS.flatMap(s => [s.departureStationId, s.arrivalStationId]))]
  const { data, error } = await supabase
    .from('stations')
    .select('id, name')
    .in('id', stationIds)
    .order('name')
  if (error) throw error
  return (data ?? []) as { id: string; name: string }[]
}

export async function fetchCountersByStations(stationIds?: string[]): Promise<{ id: string; counter_number: string; station_id: string }[]> {
  let q = supabase.from('counters').select('id, counter_number, station_id').order('counter_number')
  if (stationIds && stationIds.length > 0) q = q.in('station_id', stationIds)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as { id: string; counter_number: string; station_id: string }[]
}

export async function fetchCompaniesHierarchy(): Promise<{
  companies: { id: string; code: string; name: string; parent_id: string | null; is_group: boolean }[]
  groups: { code: string; name: string }[]
  subGroups: { code: string; name: string; parent_code: string }[]
}> {
  const { data, error } = await supabase
    .from('companies')
    .select('id, code, name, parent_id, is_group')
    .order('code')
  if (error) throw error

  const companies = (data ?? []) as { id: string; code: string; name: string; parent_id: string | null; is_group: boolean }[]
  const idToCode = new Map<string, string>()
  for (const c of companies) idToCode.set(c.id, c.code)

  const groups = companies.filter(c => c.is_group).map(c => ({ code: c.code, name: c.name }))
  const subGroups = companies
    .filter(c => !c.is_group && c.parent_id)
    .map(c => ({ code: c.code, name: c.name, parent_code: idToCode.get(c.parent_id!) ?? '' }))

  return { companies, groups, subGroups }
}

// ============================================================
// Dispatches
// ============================================================

export interface AbgDispatch {
  id: string
  periode_type: 'hebdo' | 'mensuel' | 'annuel'
  periode_value: string
  societe_code: string
  sous_groupe: string | null
  responsable_nom: string | null
  comptable_nom: string | null
  recettes: number
  depense_pr: number
  total_ao: number
  total_hao: number
  resultat_net: number
  statut: 'genere' | 'envoye' | 'recu'
  envoye_at: string | null
  envoye_par: string | null
  note: string | null
  created_at: string
  updated_at: string
}

export async function fetchDispatches(periodeType?: string, periodeValue?: string): Promise<AbgDispatch[]> {
  let q = supabase.from('abg_dispatches').select('*').order('periode_value', { ascending: false }).order('societe_code')
  if (periodeType) q = q.eq('periode_type', periodeType)
  if (periodeValue) q = q.eq('periode_value', periodeValue)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

export async function upsertDispatch(dispatch: {
  periode_type: 'hebdo' | 'mensuel' | 'annuel'
  periode_value: string
  societe_code: string
  sous_groupe?: string | null
  responsable_nom?: string | null
  comptable_nom?: string | null
  recettes: number
  depense_pr: number
  total_ao: number
  total_hao: number
  resultat_net: number
}): Promise<AbgDispatch> {
  const { data, error } = await supabase
    .from('abg_dispatches')
    .upsert(dispatch, { onConflict: 'periode_type,periode_value,societe_code' })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function updateDispatchStatut(id: string, statut: 'genere' | 'envoye' | 'recu', note?: string): Promise<void> {
  const update: Record<string, unknown> = { statut, updated_at: new Date().toISOString() }
  if (statut === 'envoye') {
    update.envoye_at = new Date().toISOString()
    update.envoye_par = null
  }
  if (note !== undefined) update.note = note
  const { error } = await supabase.from('abg_dispatches').update(update).eq('id', id)
  if (error) throw error
}

export function formatCFA(n: number | null | undefined): string {
  if (n === null || n === undefined) return '0'
  return Math.round(Number(n)).toLocaleString('fr-FR')
}
