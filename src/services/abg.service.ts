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
