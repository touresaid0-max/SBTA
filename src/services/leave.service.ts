import { supabase } from './supabase'
import type {
  LeaveRequest, PermissionRequest, LeaveSettings, LeaveAlert,
  LeaveBalance, LeaveType, LeaveStatus, PermissionType, PermissionStatus,
} from '@/types/leave.types'

// ── Leave Requests CRUD ────────────────────────────────────────────

export async function fetchLeaveRequests(filters?: {
  employeeId?: string | null
  status?: LeaveStatus | null
  leaveType?: LeaveType | null
  companyId?: string | null
  year?: number | null
}): Promise<LeaveRequest[]> {
  let q = supabase
    .from('leave_requests')
    .select('*, company:companies(id, name, code)')
    .order('start_date', { ascending: false })

  if (filters?.employeeId) q = q.eq('employee_id', filters.employeeId)
  if (filters?.status)    q = q.eq('status', filters.status)
  if (filters?.leaveType) q = q.eq('leave_type', filters.leaveType)
  if (filters?.companyId) q = q.eq('company_id', filters.companyId)
  if (filters?.year) {
    const yStart = `${filters.year}-01-01`
    const yEnd = `${filters.year}-12-31`
    q = q.gte('start_date', yStart).lte('start_date', yEnd)
  }

  let { data, error } = await q

  // Fallback: if the company join fails (schema cache not yet reloaded),
  // retry without the join so the page still loads.
  if (error && error.message?.includes('company')) {
    let q2 = supabase
      .from('leave_requests')
      .select('*')
      .order('start_date', { ascending: false })
    if (filters?.employeeId) q2 = q2.eq('employee_id', filters.employeeId)
    if (filters?.status)    q2 = q2.eq('status', filters.status)
    if (filters?.leaveType) q2 = q2.eq('leave_type', filters.leaveType)
    if (filters?.companyId) q2 = q2.eq('company_id', filters.companyId)
    if (filters?.year) {
      const yStart = `${filters.year}-01-01`
      const yEnd = `${filters.year}-12-31`
      q2 = q2.gte('start_date', yStart).lte('start_date', yEnd)
    }
    const res2 = await q2
    data = res2.data
    error = res2.error
  }

  if (error) throw error
  return (data ?? []) as LeaveRequest[]
}

export async function createLeaveRequest(input: {
  employee_id: string
  employee_source: 'employees' | 'users'
  employee_name: string
  company_id: string | null
  leave_type: LeaveType
  start_date: string
  end_date: string
  days_count: number
  reason?: string
  created_by?: string
}): Promise<LeaveRequest> {
  const { data, error } = await supabase
    .from('leave_requests')
    .insert({
      ...input,
      status: 'en_attente',
    })
    .select('*')
    .single()
  if (error) throw error
  return data as LeaveRequest
}

export async function updateLeaveStatus(
  id: string,
  status: LeaveStatus,
  validatedBy: string,
  refusalReason?: string
): Promise<void> {
  const update: Record<string, unknown> = {
    status,
    validated_by: validatedBy,
    validated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  if (refusalReason) update.refusal_reason = refusalReason

  const { error } = await supabase.from('leave_requests').update(update).eq('id', id)
  if (error) throw error
}

export async function cancelLeaveRequest(id: string): Promise<void> {
  const { error } = await supabase
    .from('leave_requests')
    .update({ status: 'annule', updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// ── Permission Requests CRUD ───────────────────────────────────────

export async function fetchPermissionRequests(filters?: {
  employeeId?: string | null
  status?: PermissionStatus | null
  permissionType?: PermissionType | null
  companyId?: string | null
  year?: number | null
}): Promise<PermissionRequest[]> {
  let q = supabase
    .from('permission_requests')
    .select('*, company:companies(id, name, code)')
    .order('start_datetime', { ascending: false })

  if (filters?.employeeId)    q = q.eq('employee_id', filters.employeeId)
  if (filters?.status)        q = q.eq('status', filters.status)
  if (filters?.permissionType) q = q.eq('permission_type', filters.permissionType)
  if (filters?.companyId)     q = q.eq('company_id', filters.companyId)
  if (filters?.year) {
    const yStart = `${filters.year}-01-01T00:00:00`
    const yEnd = `${filters.year}-12-31T23:59:59`
    q = q.gte('start_datetime', yStart).lte('start_datetime', yEnd)
  }

  let { data, error } = await q

  // Fallback without join if schema cache not yet reloaded
  if (error && error.message?.includes('company')) {
    let q2 = supabase
      .from('permission_requests')
      .select('*')
      .order('start_datetime', { ascending: false })
    if (filters?.employeeId)    q2 = q2.eq('employee_id', filters.employeeId)
    if (filters?.status)        q2 = q2.eq('status', filters.status)
    if (filters?.permissionType) q2 = q2.eq('permission_type', filters.permissionType)
    if (filters?.companyId)     q2 = q2.eq('company_id', filters.companyId)
    if (filters?.year) {
      const yStart = `${filters.year}-01-01T00:00:00`
      const yEnd = `${filters.year}-12-31T23:59:59`
      q2 = q2.gte('start_datetime', yStart).lte('start_datetime', yEnd)
    }
    const res2 = await q2
    data = res2.data
    error = res2.error
  }

  if (error) throw error
  return (data ?? []) as PermissionRequest[]
}

export async function createPermissionRequest(input: {
  employee_id: string
  employee_source: 'employees' | 'users'
  employee_name: string
  company_id: string | null
  permission_type: PermissionType
  start_datetime: string
  end_datetime: string
  duration_hours: number
  reason?: string
  justification_url?: string | null
  created_by?: string
}): Promise<PermissionRequest> {
  const { data, error } = await supabase
    .from('permission_requests')
    .insert({
      ...input,
      status: 'en_attente',
    })
    .select('*')
    .single()
  if (error) throw error
  return data as PermissionRequest
}

export async function updatePermissionStatus(
  id: string,
  status: PermissionStatus,
  validatedBy: string,
  refusalReason?: string
): Promise<void> {
  const update: Record<string, unknown> = {
    status,
    validated_by: validatedBy,
    validated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  if (refusalReason) update.refusal_reason = refusalReason

  const { error } = await supabase.from('permission_requests').update(update).eq('id', id)
  if (error) throw error
}

export async function cancelPermissionRequest(id: string): Promise<void> {
  const { error } = await supabase
    .from('permission_requests')
    .update({ status: 'annule', updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// ── Settings ───────────────────────────────────────────────────────

export async function fetchLeaveSettings(): Promise<LeaveSettings> {
  const { data, error } = await supabase
    .from('leave_settings')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data) {
    const { data: created, error: insErr } = await supabase
      .from('leave_settings')
      .insert({ annual_leave_days: 26, carryover_enabled: true, carryover_max_days: 10, carryover_deadline_month: 3 })
      .select('*')
      .single()
    if (insErr) throw insErr
    return created as LeaveSettings
  }
  return data as LeaveSettings
}

export async function updateLeaveSettings(
  settings: Partial<LeaveSettings>,
  updatedBy: string
): Promise<void> {
  const { data: existing } = await supabase
    .from('leave_settings')
    .select('id')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('leave_settings')
      .update({ ...settings, updated_by: updatedBy, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('leave_settings')
      .insert({ ...settings, updated_by: updatedBy })
    if (error) throw error
  }
}

// ── Alerts ─────────────────────────────────────────────────────────

export async function fetchLeaveAlerts(): Promise<LeaveAlert[]> {
  const { data, error } = await supabase
    .from('leave_alerts')
    .select('*')
    .eq('is_resolved', false)
    .order('target_date', { ascending: true })
  if (error) throw error
  return (data ?? []) as LeaveAlert[]
}

export async function dismissAlert(id: string): Promise<void> {
  const { error } = await supabase
    .from('leave_alerts')
    .update({ is_read: true, is_resolved: true })
    .eq('id', id)
  if (error) throw error
}

export async function markAlertRead(id: string): Promise<void> {
  const { error } = await supabase
    .from('leave_alerts')
    .update({ is_read: true })
    .eq('id', id)
  if (error) throw error
}

/**
 * Scans active leave & permission requests and generates alerts for:
 * - Leave returning soon (5 days before end_date)
 * - Permission ending soon (24h before end_datetime)
 * Idempotent — won't create duplicate alerts for the same request+date.
 */
export async function generateAlerts(settings: LeaveSettings): Promise<void> {
  const today = new Date()
  const alertDate = new Date(today)
  alertDate.setDate(today.getDate() + settings.alert_days_before_return)

  // ── Leave return alerts ──
  const { data: activeLeaves } = await supabase
    .from('leave_requests')
    .select('id, employee_id, employee_name, company_id, end_date')
    .eq('status', 'valide')
    .gte('end_date', today.toISOString().split('T')[0])

  if (activeLeaves) {
    for (const leave of activeLeaves) {
      const endDate = new Date(leave.end_date)
      const diffDays = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
      if (diffDays <= settings.alert_days_before_return && diffDays >= 0) {
        const targetDateStr = leave.end_date
        const { data: existing } = await supabase
          .from('leave_alerts')
          .select('id')
          .eq('leave_request_id', leave.id)
          .eq('target_date', targetDateStr)
          .maybeSingle()
        if (!existing) {
          await supabase.from('leave_alerts').insert({
            alert_type: 'leave_return_soon',
            leave_request_id: leave.id,
            employee_id: leave.employee_id,
            employee_name: leave.employee_name,
            company_id: leave.company_id,
            target_date: targetDateStr,
            message: `${leave.employee_name} — Fin de congé dans ${diffDays} jour${diffDays > 1 ? 's' : ''} (${new Date(leave.end_date).toLocaleDateString('fr-FR')})`,
          })
        }
      }
    }
  }

  // ── Permission end alerts ──
  const nowIso = today.toISOString()
  const alertWindow = new Date(today)
  alertWindow.setHours(today.getHours() + settings.permission_alert_hours_before_end)

  const { data: activePerms } = await supabase
    .from('permission_requests')
    .select('id, employee_id, employee_name, company_id, end_datetime')
    .eq('status', 'valide')
    .gte('end_datetime', nowIso)

  if (activePerms) {
    for (const perm of activePerms) {
      const endTime = new Date(perm.end_datetime)
      const diffHours = (endTime.getTime() - today.getTime()) / (1000 * 60 * 60)
      if (diffHours <= settings.permission_alert_hours_before_end && diffHours > 0) {
        const targetDateStr = perm.end_datetime.split('T')[0]
        const { data: existing } = await supabase
          .from('leave_alerts')
          .select('id')
          .eq('permission_request_id', perm.id)
          .eq('target_date', targetDateStr)
          .maybeSingle()
        if (!existing) {
          await supabase.from('leave_alerts').insert({
            alert_type: 'permission_end_soon',
            permission_request_id: perm.id,
            employee_id: perm.employee_id,
            employee_name: perm.employee_name,
            company_id: perm.company_id,
            target_date: targetDateStr,
            message: `${perm.employee_name} — Fin de permission dans ${Math.round(diffHours)}h (${new Date(perm.end_datetime).toLocaleString('fr-FR')})`,
          })
        }
      }
    }
  }
}

// ── Balance Calculation ────────────────────────────────────────────

/**
 * Calculates the leave balance for an employee for a given year.
 * annual_entitled = settings.annual_leave_days (+ carryover if enabled)
 * days_taken = sum of days_count for status 'valide' or 'termine'
 * days_pending = sum of days_count for status 'en_attente'
 * days_remaining = annual_entitled - days_taken
 */
export async function fetchLeaveBalance(
  employeeId: string,
  employeeName: string,
  companyId: string | null,
  companyName: string | null,
  settings: LeaveSettings,
  year: number
): Promise<LeaveBalance> {
  const yearStart = `${year}-01-01`
  const yearEnd = `${year}-12-31`

  const { data, error } = await supabase
    .from('leave_requests')
    .select('days_count, status, leave_type')
    .eq('employee_id', employeeId)
    .gte('start_date', yearStart)
    .lte('start_date', yearEnd)
    .in('status', ['valide', 'termine', 'en_attente'])

  if (error) throw error

  const rows = data ?? []
  const daysTaken = rows
    .filter(r => r.status === 'valide' || r.status === 'termine')
    .reduce((sum, r) => sum + r.days_count, 0)
  const daysPending = rows
    .filter(r => r.status === 'en_attente')
    .reduce((sum, r) => sum + r.days_count, 0)

  // Carryover: only applies to annual leave type, from previous year
  let carryover = 0
  if (settings.carryover_enabled) {
    const prevYearStart = `${year - 1}-01-01`
    const prevYearEnd = `${year - 1}-12-31`
    const { data: prevData } = await supabase
      .from('leave_requests')
      .select('days_count, status, leave_type')
      .eq('employee_id', employeeId)
      .eq('leave_type', 'conge_annuel')
      .gte('start_date', prevYearStart)
      .lte('start_date', prevYearEnd)
      .in('status', ['valide', 'termine'])
    const prevTaken = (prevData ?? []).reduce((s, r) => s + r.days_count, 0)
    carryover = Math.max(0, Math.min(settings.annual_leave_days - prevTaken, settings.carryover_max_days))
  }

  const annualEntitled = settings.annual_leave_days + carryover

  return {
    employee_id: employeeId,
    employee_name: employeeName,
    company_id: companyId,
    company_name: companyName,
    annual_entitled: annualEntitled,
    days_taken: daysTaken,
    days_remaining: annualEntitled - daysTaken,
    days_pending: daysPending,
    carryover_days: carryover,
  }
}

/**
 * Batch balance calculation for multiple employees.
 */
export async function fetchLeaveBalances(
  employees: Array<{ id: string; name: string; company_id: string | null; company_name: string | null }>,
  settings: LeaveSettings,
  year: number
): Promise<LeaveBalance[]> {
  const results: LeaveBalance[] = []
  for (const emp of employees) {
    const balance = await fetchLeaveBalance(
      emp.id, emp.name, emp.company_id, emp.company_name, settings, year
    )
    results.push(balance)
  }
  return results
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Calculates working days between two dates (excludes weekends).
 * Per Code du Travail CI, working days are Monday-Saturday (6-day week).
 */
export function calculateLeaveDays(startStr: string, endStr: string): number {
  const start = new Date(startStr)
  const end = new Date(endStr)
  if (start > end) return 0
  let count = 0
  const current = new Date(start)
  while (current <= end) {
    const day = current.getDay()
    // Sunday (0) is a rest day in Côte d'Ivoire
    if (day !== 0) count++
    current.setDate(current.getDate() + 1)
  }
  return count
}

/**
 * Calculates hours between two datetime strings.
 */
export function calculatePermissionHours(startIso: string, endIso: string): number {
  const start = new Date(startIso)
  const end = new Date(endIso)
  if (start >= end) return 0
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60) * 100) / 100
}
