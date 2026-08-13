import { supabase } from '@/services/supabase'

export interface LogistiqueDriver {
  id:                   string
  first_name:           string
  last_name:            string
  full_name:            string
  source_table:         'employees' | 'users'
  license_number:       string | null
  license_expiry:       string | null
  license_category:     string | null
  company_id:           string | null
  company_name:         string | null
  company_code:         string | null
  contract_type:        string | null
  bus_id:               string | null
  bus_registration:     string | null
  hire_date:            string | null
  employee_id:          string | null
  status:               string
  phone:                string | null
  avatar_url:           string | null
  probation_end_date:   string | null
  probation_treated_at: string | null
  assigned_route_id:    string | null
  assigned_route_name:  string | null
  contract_nature:      string | null
  employee_status:      string | null
  company_parent_id:    string | null
  company_is_group:     boolean | null
}

export interface LogistiqueBusWithDrivers {
  id:                  string
  registration_number: string
  brand:               string | null
  manufacturer:        string | null
  model:               string | null
  total_seats:         number | null
  company_id:          string | null
  company_name:        string | null
  status:              string | null
  is_active:           boolean | null
  drivers:             LogistiqueDriver[]
}

export interface LogistiqueDriversResponse {
  buses:             LogistiqueBusWithDrivers[]
  unassignedDrivers: LogistiqueDriver[]
}

const EDGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/logistique-drivers`

async function callEdge(method: string, body?: Record<string, unknown>, queryId?: string): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession()
  const url = queryId ? `${EDGE_URL}?id=${encodeURIComponent(queryId)}` : EDGE_URL
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? ''}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  if (!res.ok) {
    const errMsg = typeof json.error === 'string' ? json.error
      : (json.error?.message ?? JSON.stringify(json.error ?? `Erreur ${res.status}`))
    throw new Error(errMsg)
  }
  return json
}

export async function fetchBusesWithDrivers(): Promise<LogistiqueDriversResponse> {
  const data = await callEdge('GET')
  return data as LogistiqueDriversResponse
}

export async function fetchDriverDetail(id: string): Promise<Record<string, unknown> & { source_table: 'employees' | 'users' }> {
  const data = await callEdge('GET', undefined, id)
  return data.driver
}

export async function createDriverFromLogistique(input: {
  first_name: string
  last_name: string
  phone?: string | null
  gender?: string | null
  nationality?: string | null
  date_naissance?: string | null
  personal_email?: string | null
  professional_email?: string | null
  company_id?: string | null
  station_id?: string | null
  hire_date: string
  contract_type: string
  contract_nature?: string | null
  employee_status?: string | null
  salary?: number | null
  daily_rate?: number | null
  cnps_number?: string | null
  children_count?: number
  marital_status?: string | null
  bus_id?: string | null
  license_number?: string | null
  license_expiry?: string | null
  license_category?: string | null
  employee_id?: string | null
  assigned_route_id?: string | null
  avatar_url?: string | null
}): Promise<{ id: string }> {
  const data = await callEdge('POST', input)
  return data.employee
}

export async function updateDriverFromLogistique(input: {
  id: string
  source_table?: 'employees' | 'users'
  [key: string]: unknown
}): Promise<void> {
  await callEdge('PUT', input)
}

export async function treatProbation(input: {
  id: string
  source_table?: 'employees' | 'users'
}): Promise<void> {
  await callEdge('PATCH', input)
}
