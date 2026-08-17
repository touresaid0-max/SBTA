import { supabase } from './supabase'
import { isNearRetirement, retirementDate } from '@/utils/retirement'
import type {
  Employee, EmployeeExtended, CompanyPayroll,
  EmployeeFilters, DriverDailyLog,
} from '@/types/hr.types'

// ── Chargement des employés (users + employees en parallèle) ──────
export async function fetchEmployees(filters: EmployeeFilters): Promise<Employee[]> {
  const SELECT_FIELDS = `
    id, first_name, last_name, phone, gender, nationality, date_naissance, role,
    employee_id, avatar_url, hire_date, salary,
    contract_type, contract_nature, cnps_number, children_count, marital_status,
    contract_url, bus_id, station_id, license_number, license_expiry,
    license_category, driver_average_rating, driver_performance_level,
    driver_total_reviews, daily_rate, days_worked_this_month, current_month_earnings,
    seniority_eligibility_date, seniority_status, assigned_route_id,
    deactivated_at, deactivation_reason, created_at, company_id,
    companies ( id, name, code ),
    stations  ( id, name ),
    buses     ( id, registration_number, brand, model, class )
  `

  // ── Requête sur users (comptes existants) ──
  let usersQ = supabase
    .from('users')
    .select(SELECT_FIELDS + ', email, status, is_active')
    .neq('role', 'client')
    .order('last_name', { ascending: true })

  if (filters.company_ids && filters.company_ids.length > 0) {
    usersQ = usersQ.in('company_id', filters.company_ids)
  } else if (filters.company_id) {
    usersQ = usersQ.eq('company_id', filters.company_id)
  }
  if (filters.station_id)    usersQ = usersQ.eq('station_id',    filters.station_id)
  if (filters.role)          usersQ = usersQ.eq('role',          filters.role)
  if (filters.contract_type) usersQ = usersQ.eq('contract_type', filters.contract_type)
  if (filters.contract_nature) usersQ = usersQ.eq('contract_nature', filters.contract_nature)
  if (filters.status === 'active') {
    usersQ = usersQ.eq('status', 'active')
  } else if (filters.status === 'inactive') {
    usersQ = usersQ.eq('status', 'inactive')
  } else if (filters.status === 'pending_deletion') {
    usersQ = usersQ.eq('status', 'pending_deletion')
  } else if (filters.status === 'pending') {
    // les users n'ont pas de statut "pending" — exclure de ce filtre
    usersQ = usersQ.eq('id', '00000000-0000-0000-0000-000000000000') // retourne rien
  }
  if (filters.search) {
    usersQ = usersQ.or(
      `first_name.ilike.%${filters.search}%,` +
      `last_name.ilike.%${filters.search}%,` +
      `email.ilike.%${filters.search}%,` +
      `employee_id.ilike.%${filters.search}%`
    )
  }

  // ── Requête sur employees (nouveau workflow RH) ──
  let empQ = supabase
    .from('employees')
    .select(SELECT_FIELDS + ', professional_email, personal_email, account_status, auth_user_id')
    .order('last_name', { ascending: true })

  if (filters.company_ids && filters.company_ids.length > 0) {
    empQ = empQ.in('company_id', filters.company_ids)
  } else if (filters.company_id) {
    empQ = empQ.eq('company_id', filters.company_id)
  }
  if (filters.station_id)    empQ = empQ.eq('station_id',    filters.station_id)
  if (filters.role)          empQ = empQ.eq('role',          filters.role)
  if (filters.contract_type) empQ = empQ.eq('contract_type', filters.contract_type)
  if (filters.contract_nature) empQ = empQ.eq('contract_nature', filters.contract_nature)
  if (filters.status) {
    empQ = empQ.eq('account_status', filters.status)
  }
  if (filters.search) {
    empQ = empQ.or(
      `first_name.ilike.%${filters.search}%,` +
      `last_name.ilike.%${filters.search}%,` +
      `professional_email.ilike.%${filters.search}%,` +
      `employee_id.ilike.%${filters.search}%`
    )
  }

  const [usersRes, empRes] = await Promise.all([usersQ, empQ])

  if (usersRes.error) console.error('fetchEmployees users error:', usersRes.error)
  if (empRes.error)   console.error('fetchEmployees employees error:', empRes.error)

  // auth_user_ids des fiches employees pour dédupliquer
  const empAuthIds = new Set(
    (empRes.data ?? []).map(e => e.auth_user_id).filter(Boolean)
  )

  const usersData = (usersRes.data ?? []).filter(u => !empAuthIds.has(u.id))
  const empData   = empRes.data ?? []

  const fromUsers = usersData.map(u => mapEmployeeRow(u, 'users'))
  const fromEmp   = empData.map(e => mapEmployeeRow({
    ...e,
    email: e.professional_email ?? e.personal_email ?? '',
  }, 'employees'))

  return [...fromUsers, ...fromEmp].sort((a, b) =>
    (a.last_name ?? '').localeCompare(b.last_name ?? '', 'fr')
  )
}

// ── Récupérer un employé par ID (cherche dans employees puis users) ─
export async function fetchEmployeeById(id: string): Promise<Employee | null> {
  // Chercher dans employees d'abord
  const { data: empData } = await supabase
    .from('employees')
    .select(`
      id, auth_user_id, first_name, last_name, professional_email, personal_email,
      phone, gender, nationality, date_naissance, role, employee_id, avatar_url, account_status, hire_date, salary,
      contract_type, contract_nature, cnps_number, children_count, marital_status, contract_url,
      bus_id, station_id, license_number, license_expiry, license_category,
      driver_average_rating, driver_performance_level, driver_total_reviews,
      daily_rate, days_worked_this_month, current_month_earnings,
      seniority_eligibility_date, seniority_status, assigned_route_id,
      deactivated_at, deactivation_reason, created_at, company_id,
      technician_type_id,
      companies ( id, name, code ),
      stations  ( id, name ),
      buses     ( id, registration_number, brand, model, class ),
      technician_type:garage_types_techniciens ( id, nom )
    `)
    .eq('id', id)
    .maybeSingle()

  if (empData) {
    return mapEmployeeRow(empData, 'employees')
  }

  // Fallback : chercher dans users
  const { data: userData } = await supabase
    .from('users')
    .select(`
      id, first_name, last_name, email, phone, gender, nationality, date_naissance, role,
      employee_id, avatar_url, status, hire_date, salary,
      contract_type, contract_nature, cnps_number, children_count, marital_status,
      contract_url, bus_id, station_id, license_number, license_expiry,
      license_category, driver_average_rating, driver_performance_level,
      driver_total_reviews, deactivated_at, deactivation_reason, created_at,
      daily_rate, days_worked_this_month, current_month_earnings,
      seniority_eligibility_date, seniority_status, assigned_route_id,
      technician_type_id,
      companies ( id, name, code ),
      stations  ( id, name ),
      buses     ( id, registration_number, brand, model, class ),
      technician_type:garage_types_techniciens ( id, nom )
    `)
    .eq('id', id)
    .maybeSingle()

  if (userData) {
    return mapEmployeeRow({ ...userData, email: userData.email, status: userData.status }, 'users')
  }

  return null
}

function mapEmployeeRow(data: any, source: 'employees' | 'users'): Employee {
  const bus     = data.buses as any
  const company = data.companies as any
  const station = data.stations as any
  const techType = data.technician_type as any

  const email = source === 'employees'
    ? (data.professional_email ?? data.personal_email ?? '')
    : (data.email ?? '')

  const status = source === 'employees'
    ? (data.account_status === 'active' ? 'active'
      : data.account_status === 'suspended' ? 'suspended'
      : data.account_status === 'inactive' ? 'inactive'
      : data.account_status === 'pending_deletion' ? 'pending_deletion'
      : 'pending')
    : (data.status ?? (data.is_active ? 'active' : 'inactive'))

  return {
    ...data,
    email,
    status,
    full_name:               `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim() || email,
    company_name:            company?.name ?? null,
    company_code:            company?.code ?? null,
    station_name:            station?.name ?? null,
    bus_registration:        bus?.registration_number ?? null,
    bus_brand:               bus?.brand ?? null,
    bus_model:               bus?.model ?? null,
    bus_class:               bus?.class ?? null,
    driver_average_rating:    data.driver_average_rating ?? 0,
    driver_performance_level: data.driver_performance_level ?? '',
    children_count:           data.children_count ?? 0,
    years_of_service:         data.hire_date
      ? Math.floor((Date.now() - new Date(data.hire_date).getTime()) / (1000 * 60 * 60 * 24 * 365))
      : null,
    seniority_text:             null,
    daily_rate:                 data.daily_rate ?? null,
    days_worked_this_month:     data.days_worked_this_month ?? 0,
    current_month_earnings:     data.current_month_earnings ?? 0,
    seniority_eligibility_date: data.seniority_eligibility_date ?? null,
    seniority_status:           data.seniority_status ?? 'non_eligible',
    assigned_route_id:          data.assigned_route_id ?? null,
    technician_type_id:         data.technician_type_id ?? null,
    technician_type_nom:        techType?.nom ?? null,
  } as Employee
}

export async function fetchPayrollByCompany(): Promise<CompanyPayroll[]> {
  const { data, error } = await supabase
    .from('payroll_by_company')
    .select('*')
  if (error) throw error
  return data ?? []
}

// ── Upload contrat (fonctionne pour employees et users) ───────────
export async function uploadContract(employeeId: string, file: File, sourceTable: 'employees' | 'users' = 'users'): Promise<string> {
  const filePath = `contracts/${employeeId}/${Date.now()}_${file.name}`
  const { error } = await supabase.storage
    .from('hr-documents')
    .upload(filePath, file, { upsert: true, contentType: 'application/pdf' })
  if (error) throw error

  const { data: { publicUrl } } = supabase.storage
    .from('hr-documents')
    .getPublicUrl(filePath)

  const table = sourceTable === 'employees' ? 'employees' : 'users'
  await supabase.from(table)
    .update({ contract_url: publicUrl })
    .eq('id', employeeId)

  return publicUrl
}

// ── Upload photo (avatar) ─────────────────────────────────────────
export async function uploadAvatar(employeeId: string, file: File, sourceTable: 'employees' | 'users' = 'employees'): Promise<string> {
  const ext = file.name.split('.').pop() ?? 'jpg'
  const filePath = `${employeeId}/${Date.now()}.${ext}`
  const { error } = await supabase.storage
    .from('employee-avatars')
    .upload(filePath, file, { upsert: true, contentType: file.type })
  if (error) throw error

  const { data: { publicUrl } } = supabase.storage
    .from('employee-avatars')
    .getPublicUrl(filePath)

  await supabase.from(sourceTable)
    .update({ avatar_url: publicUrl })
    .eq('id', employeeId)

  return publicUrl
}

// ── Désactiver un employé ─────────────────────────────────────────
export async function deactivateEmployee(
  employeeId: string,
  reason: string,
  deactivatedBy: string
): Promise<void> {
  // Essayer d'abord dans employees
  const { data: empExists } = await supabase
    .from('employees')
    .select('id')
    .eq('id', employeeId)
    .maybeSingle()

  if (empExists) {
    const { error } = await supabase.from('employees').update({
      account_status:      'inactive',
      deactivated_at:      new Date().toISOString(),
      deactivated_by:      deactivatedBy,
      deactivation_reason: reason,
      updated_at:          new Date().toISOString(),
    }).eq('id', employeeId)
    if (error) throw error
    return
  }

  // Fallback users
  const { error } = await supabase.from('users').update({
    status:              'inactive',
    deactivated_at:      new Date().toISOString(),
    deactivated_by:      deactivatedBy,
    deactivation_reason: reason,
  }).eq('id', employeeId)
  if (error) throw error
}

// ── Réactiver un employé désactivé ────────────────────────────────
export async function reactivateEmployee(employeeId: string): Promise<void> {
  const { data: empExists } = await supabase
    .from('employees')
    .select('id')
    .eq('id', employeeId)
    .maybeSingle()

  if (empExists) {
    const { error } = await supabase.from('employees').update({
      account_status:      'active',
      deactivated_at:      null,
      deactivated_by:      null,
      deactivation_reason: null,
      updated_at:          new Date().toISOString(),
    }).eq('id', employeeId)
    if (error) throw error
    return
  }

  const { error } = await supabase.from('users').update({
    status:              'active',
    deactivated_at:      null,
    deactivated_by:      null,
    deactivation_reason: null,
  }).eq('id', employeeId)
  if (error) throw error
}

// ── Demander la suppression définitive (RH → Admin) ───────────────
export async function requestEmployeeDeletion(
  employeeId: string,
  requestedBy: string
): Promise<void> {
  const { data: emp } = await supabase
    .from('employees')
    .select('id, auth_user_id')
    .eq('id', employeeId)
    .maybeSingle()

  if (emp) {
    const { error } = await supabase.from('employees').update({
      account_status:         'pending_deletion',
      deletion_requested_at:  new Date().toISOString(),
      deletion_requested_by:  requestedBy,
      updated_at:             new Date().toISOString(),
    }).eq('id', employeeId)
    if (error) throw error

    if (emp.auth_user_id) {
      const { error: uErr } = await supabase.from('users').update({
        status:                 'pending_deletion',
        deletion_requested_at:  new Date().toISOString(),
        deletion_requested_by:  requestedBy,
      }).eq('id', emp.auth_user_id)
      if (uErr) throw uErr
    }
    return
  }

  const { error } = await supabase.from('users').update({
    status:                 'pending_deletion',
    deletion_requested_at:  new Date().toISOString(),
    deletion_requested_by:  requestedBy,
  }).eq('id', employeeId)
  if (error) throw error
}

// ── Supprimer définitivement un employé (admin uniquement) ────────
export async function deleteEmployeePermanently(
  employeeId: string,
  sourceTable: 'employees' | 'users'
): Promise<void> {
  const table = sourceTable === 'employees' ? 'employees' : 'users'
  const { error } = await supabase.from(table).delete().eq('id', employeeId)
  if (error) throw error
}

// ── Taux journaliers par itinéraire ──────────────────────────────
export async function fetchDriverDailyRates(companyId?: string) {
  let q = supabase
    .from('driver_daily_rates')
    .select(`
      *,
      routes ( id, name, base_price, distance_km,
        cities_origin:cities!routes_origin_city_id_fkey ( name ),
        cities_dest:cities!routes_destination_city_id_fkey ( name )
      ),
      companies ( id, name, code )
    `)
    .eq('is_active', true)
    .order('daily_rate', { ascending: false })

  if (companyId) q = q.eq('company_id', companyId)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

// ── Journal mensuel d'un contractuel ─────────────────────────────
export async function fetchDriverMonthlyLogs(
  driverId: string,
  month: string
): Promise<DriverDailyLog[]> {
  const startDate = `${month}-01`
  const endDate   = new Date(
    new Date(startDate).setMonth(new Date(startDate).getMonth() + 1)
  ).toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('driver_daily_logs')
    .select('*, routes ( name, base_price )')
    .eq('driver_id', driverId)
    .gte('work_date', startDate)
    .lt('work_date', endDate)
    .order('work_date', { ascending: false })

  if (error) throw error
  return data ?? []
}

// ── Calcul de la rémunération mensuelle d'un contractuel ─────────
export function calculateContractualMonthlyPay(logs: DriverDailyLog[]): {
  totalDays:     number
  totalEarned:   number
  paidDays:      number
  pendingDays:   number
  amountPaid:    number
  amountPending: number
  byRoute:       Record<string, { days: number; earned: number; routeName: string }>
} {
  const byRoute: Record<string, { days: number; earned: number; routeName: string }> = {}

  logs.forEach(log => {
    const key = log.route_id ?? 'sans_trajet'
    if (!byRoute[key]) byRoute[key] = { days: 0, earned: 0, routeName: log.route_name ?? '—' }
    byRoute[key].days   += 1
    byRoute[key].earned += Number(log.daily_rate)
  })

  const active = logs.filter(l => l.payment_status !== 'annule')
  return {
    totalDays:     active.length,
    totalEarned:   active.reduce((s, l) => s + Number(l.daily_rate), 0),
    paidDays:      active.filter(l => l.payment_status === 'paye').length,
    pendingDays:   active.filter(l => l.payment_status === 'du').length,
    amountPaid:    active.filter(l => l.payment_status === 'paye')
                        .reduce((s, l) => s + Number(l.daily_rate), 0),
    amountPending: active.filter(l => l.payment_status === 'du')
                        .reduce((s, l) => s + Number(l.daily_rate), 0),
    byRoute,
  }
}

// ── Chauffeurs éligibles au passage salarial ─────────────────────
export async function fetchSeniorityAlerts(): Promise<EmployeeExtended[]> {
  // Chercher dans employees (nouveau workflow)
  const { data: empData } = await supabase
    .from('employees')
    .select('*, companies ( name, code ), stations ( name )')
    .eq('role', 'chauffeur')
    .eq('seniority_status', 'eligible')
    .eq('account_status', 'active')
    .order('seniority_eligibility_date', { ascending: true })

  // Chercher dans users (ancien workflow)
  const { data: usersData } = await supabase
    .from('users')
    .select('*, companies ( name, code ), stations ( name )')
    .eq('role', 'chauffeur')
    .eq('seniority_status', 'eligible')
    .eq('status', 'active')
    .order('seniority_eligibility_date', { ascending: true })

  // Exclure les users déjà dans employees
  const empAuthIds = new Set((empData ?? []).map(e => e.auth_user_id).filter(Boolean))
  const filteredUsers = (usersData ?? []).filter(u => !empAuthIds.has(u.id))

  const combined = [
    ...(empData ?? []).map(u => mapEmployeeRow({ ...u, email: u.professional_email ?? u.personal_email ?? '' }, 'employees')),
    ...filteredUsers.map(u => mapEmployeeRow(u, 'users')),
  ]

  return combined.map(e => ({ ...e, assigned_route_name: null } as EmployeeExtended))
}

// ── Employés proches de la retraite (≤ 1 an avant 60 ans) ────────
export async function fetchRetirementAlerts(): Promise<EmployeeExtended[]> {
  const { data: empData } = await supabase
    .from('employees')
    .select('*, companies ( name, code ), stations ( name )')
    .not('date_naissance', 'is', null)
    .eq('account_status', 'active')

  const { data: usersData } = await supabase
    .from('users')
    .select('*, companies ( name, code ), stations ( name )')
    .not('date_naissance', 'is', null)
    .neq('role', 'client')
    .eq('status', 'active')

  const empAuthIds = new Set((empData ?? []).map(e => e.auth_user_id).filter(Boolean))
  const filteredUsers = (usersData ?? []).filter(u => !empAuthIds.has(u.id))

  const combined = [
    ...(empData ?? []).map(u => mapEmployeeRow({ ...u, email: u.professional_email ?? u.personal_email ?? '' }, 'employees')),
    ...filteredUsers.map(u => mapEmployeeRow(u, 'users')),
  ]

  return combined
    .filter(e => isNearRetirement(e.date_naissance))
    .map(e => ({ ...e, assigned_route_name: null } as EmployeeExtended))
    .sort((a, b) => {
      const da = retirementDate(a.date_naissance)?.getTime() ?? 0
      const db = retirementDate(b.date_naissance)?.getTime() ?? 0
      return da - db
    })
}

// ── Valider le passage contractuel → salarié ─────────────────────
export async function convertToSalaried(params: {
  driverId:   string
  newSalary:  number
  approvedBy: string
}): Promise<void> {
  // Essayer employees d'abord
  const { data: empExists } = await supabase
    .from('employees')
    .select('id')
    .eq('id', params.driverId)
    .maybeSingle()

  const table = empExists ? 'employees' : 'users'

  const { error } = await supabase
    .from(table)
    .update({
      contract_type:    'titulaire',
      salary:           params.newSalary,
      seniority_status: 'converti',
      daily_rate:       null,
      updated_at:       new Date().toISOString(),
    })
    .eq('id', params.driverId)

  if (error) throw error

  await supabase.from('activity_logs').insert({
    user_id:     params.approvedBy,
    target_id:   params.driverId,
    target_type: table === 'employees' ? 'employee' : 'user',
    action:      'driver_converted_to_salaried',
    description: `Chauffeur converti en salarié — Salaire : ${params.newSalary.toLocaleString('fr-CI')} FCFA`,
    new_values:  { contract_type: 'titulaire', salary: params.newSalary },
  })
}

// ── Paiement en lot des jours dus d'un contractuel ───────────────
export async function payContractualDays(
  driverId: string,
  logIds: string[],
  paidBy: string
): Promise<void> {
  const { error } = await supabase
    .from('driver_daily_logs')
    .update({
      payment_status: 'paye',
      paid_at:        new Date().toISOString(),
      paid_by:        paidBy,
    })
    .in('id', logIds)
    .eq('driver_id', driverId)

  if (error) throw error
}

// ── Mettre à jour un employé (employees ou users) ─────────────────
export async function updateEmployee(id: string, payload: Record<string, unknown>): Promise<void> {
  const { data: empExists } = await supabase
    .from('employees')
    .select('id')
    .eq('id', id)
    .maybeSingle()

  const table = empExists ? 'employees' : 'users'
  const updatePayload = {
    ...payload,
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase.from(table).update(updatePayload).eq('id', id)
  if (error) throw error
}
