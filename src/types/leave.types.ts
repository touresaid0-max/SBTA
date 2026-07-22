// ── Congés et Permissions — Types ──────────────────────────────────

export type LeaveType =
  | 'conge_annuel'
  | 'conge_maladie'
  | 'conge_maternite'
  | 'conge_paternite'
  | 'conge_exceptionnel'
  | 'conge_sans_solde'

export type LeaveStatus = 'en_attente' | 'valide' | 'refuse' | 'annule' | 'termine'

export type PermissionType =
  | 'personnelle'
  | 'maladie'
  | 'familiale'
  | 'administrative'
  | 'autre'

export type PermissionStatus = 'en_attente' | 'valide' | 'refuse' | 'annule'

export type AlertType =
  | 'leave_return_soon'
  | 'permission_end_soon'
  | 'leave_pending_validation'

export interface LeaveRequest {
  id:                string
  employee_id:       string
  employee_source:   'employees' | 'users'
  company_id:        string | null
  employee_name:     string
  leave_type:        LeaveType
  start_date:        string
  end_date:          string
  days_count:        number
  reason:            string | null
  status:            LeaveStatus
  validated_by:      string | null
  validated_at:      string | null
  refusal_reason:    string | null
  created_by:        string | null
  created_at:        string
  updated_at:        string
  company?:          { id: string; name: string; code: string } | null
}

export interface PermissionRequest {
  id:                string
  employee_id:       string
  employee_source:   'employees' | 'users'
  company_id:        string | null
  employee_name:     string
  permission_type:   PermissionType
  start_datetime:    string
  end_datetime:      string
  duration_hours:    number
  reason:            string | null
  justification_url: string | null
  status:            PermissionStatus
  validated_by:      string | null
  validated_at:      string | null
  refusal_reason:    string | null
  created_by:        string | null
  created_at:        string
  updated_at:        string
  company?:          { id: string; name: string; code: string } | null
}

export interface LeaveSettings {
  id:                              string
  annual_leave_days:               number
  carryover_enabled:               boolean
  carryover_max_days:              number
  carryover_deadline_month:        number
  alert_days_before_return:        number
  permission_alert_hours_before_end: number
  updated_by:                      string | null
  updated_at:                      string
}

export interface LeaveAlert {
  id:              string
  alert_type:      AlertType
  leave_request_id:     string | null
  permission_request_id: string | null
  employee_id:    string
  employee_name:  string
  company_id:     string | null
  target_date:    string
  message:        string
  is_read:        boolean
  is_resolved:    boolean
  created_at:     string
}

// ── Balance summary for an employee ──
export interface LeaveBalance {
  employee_id:     string
  employee_name:   string
  company_id:      string | null
  company_name:    string | null
  annual_entitled: number
  days_taken:      number
  days_remaining:  number
  days_pending:    number
  carryover_days:  number
}

export interface LeaveReportRow {
  employee_id:      string
  employee_name:    string
  role:             string
  company_name:     string
  station_name:     string | null
  annual_entitled:  number
  days_taken:       number
  days_remaining:   number
  permissions_count: number
  permissions_hours: number
  leave_periods:    Array<{ type: LeaveType; start: string; end: string; days: number; status: LeaveStatus }>
  permission_periods: Array<{ type: PermissionType; start: string; end: string; hours: number; status: PermissionStatus }>
}

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  conge_annuel:       'Congé annuel',
  conge_maladie:      'Congé maladie',
  conge_maternite:    'Congé maternité',
  conge_paternite:    'Congé paternité',
  conge_exceptionnel: 'Congé exceptionnel',
  conge_sans_solde:   'Congé sans solde',
}

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  en_attente: 'En attente',
  valide:     'Validé',
  refuse:     'Refusé',
  annule:     'Annulé',
  termine:    'Terminé',
}

export const PERMISSION_TYPE_LABELS: Record<PermissionType, string> = {
  personnelle:   'Personnelle',
  maladie:       'Maladie',
  familiale:     'Familiale',
  administrative: 'Administrative',
  autre:         'Autre',
}

export const PERMISSION_STATUS_LABELS: Record<PermissionStatus, string> = {
  en_attente: 'En attente',
  valide:     'Validé',
  refuse:     'Refusé',
  annule:     'Annulé',
}

// Exceptional leave reasons and their legal durations (Code Travail CI)
export const EXCEPTIONAL_LEAVE_REASONS: Array<{ reason: string; days: number }> = [
  { reason: 'Mariage du travailleur', days: 4 },
  { reason: 'Décès du conjoint ou parent', days: 3 },
  { reason: 'Baptême / naissance enfant', days: 1 },
  { reason: 'Autre événement familial', days: 1 },
]
