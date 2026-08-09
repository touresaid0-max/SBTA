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
  const { data, error } = await supabase
    .from('abg_societes')
    .select('*')
    .eq('is_active', true)
    .order('code')
  if (error) throw error
  return data ?? []
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

export function formatCFA(n: number | null | undefined): string {
  if (n === null || n === undefined) return '0'
  return Math.round(Number(n)).toLocaleString('fr-FR')
}
