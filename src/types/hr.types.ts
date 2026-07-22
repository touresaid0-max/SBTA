import type { SBTARole } from '@/store/authStore'

export type ContractType    = 'titulaire' | 'contractuel' | 'stagiaire'
export type ContractNature  = 'CDI' | 'CDD'
export type Gender          = 'M' | 'F'
export type MaritalStatus   = 'celibataire' | 'marie' | 'divorce' | 'veuf'
export type SeniorityStatus = 'non_eligible' | 'eligible' | 'converti'
export type PaymentStatus   = 'du' | 'paye' | 'annule'

export interface Employee {
  id:                       string
  auth_user_id?:            string | null
  first_name:               string
  last_name:                string
  full_name:                string
  email:                    string
  professional_email?:      string | null
  personal_email?:          string | null
  phone:                    string | null
  source_table?:            'employees' | 'users'
  gender:                   Gender | null
  nationality:              string | null
  date_naissance:           string | null
  role:                     SBTARole
  employee_id:              string | null
  avatar_url:               string | null

  // Données RH
  company_id:               string | null
  company_name:             string | null
  company_code:             string | null
  station_id:               string | null
  station_name:             string | null
  hire_date:                string | null
  years_of_service:         number | null
  seniority_text:           string | null
  salary:                   number | null
  contract_type:            ContractType | null
  contract_nature:          ContractNature | null
  cnps_number:              string | null
  children_count:           number
  marital_status:           MaritalStatus | null
  contract_url:             string | null
  status:                   string

  // Spécifique chauffeurs
  bus_id:                   string | null
  bus_registration:         string | null
  bus_brand:                string | null
  bus_model:                string | null
  bus_class:                string | null
  license_number:           string | null
  license_expiry:           string | null
  license_category:         string | null
  driver_average_rating:    number
  driver_performance_level: string

  // Rémunération contractuelle (nouvelles colonnes)
  daily_rate:                 number | null
  days_worked_this_month:     number
  current_month_earnings:     number
  seniority_eligibility_date: string | null
  seniority_status:           SeniorityStatus
  assigned_route_id:          string | null

  // Audit
  created_at:               string
  deactivated_at:           string | null
  deactivation_reason:      string | null
}

// --- Employé enrichi avec champ route associée ---
export interface EmployeeExtended extends Employee {
  assigned_route_name: string | null
}

export interface CompanyPayroll {
  company_id:        string
  company_name:      string
  company_code:      string
  parent_id?:        string | null
  is_group?:         boolean
  total_employees:   number
  titulaires:        number
  contractuels:      number
  masse_salariale:   number
  salaire_moyen:     number
  salaire_min:       number
  salaire_max:       number
  nb_chauffeurs:     number
  nb_guichetiers:    number
  nb_mecaniciens:    number
  employes_actifs:   number
  employes_inactifs: number
}

// --- Masse salariale enrichie (vue v2) ---
export interface CompanyPayrollEnriched extends CompanyPayroll {
  masse_salariale_totale:       number
  masse_salariale_fixe:         number
  masse_salariale_variable:     number
  chauffeurs_salaries:          number
  chauffeurs_contractuels:      number
  salaire_moyen_titulaire:      number
  remuneration_moy_contractuel: number
  eligibles_passage_salarial:   number
}

export interface EmployeeFilters {
  company_id:    string | null
  company_ids?:  string[] | null
  station_id:    string | null
  role:          string | null
  contract_type: ContractType | null
  contract_nature?: ContractNature | null
  status:        string | null
  search:        string
}

// --- Taux journalier par itinéraire ---
export interface DriverDailyRate {
  id:           string
  route_id:     string
  route_name:   string
  company_id:   string
  company_name: string
  ticket_price: number
  daily_rate:   number
  is_active:    boolean
  notes:        string | null
  created_at:   string
}

// --- Journal journalier d'un contractuel ---
export interface DriverDailyLog {
  id:             string
  driver_id:      string
  driver_name:    string
  company_id:     string
  schedule_id:    string | null
  route_id:       string | null
  work_date:      string
  daily_rate:     number
  route_name:     string | null
  ticket_price:   number | null
  payment_status: PaymentStatus
  paid_at:        string | null
  created_at:     string
}

// --- Résumé mensuel d'un contractuel ---
export interface ContractualMonthlySummary {
  driver_id:    string
  driver_name:  string
  employee_id:  string | null
  company_name: string
  company_code: string
  month:        string
  month_label:  string
  days_worked:  number
  avg_daily_rate: number
  total_earned: number
  days_paid:    number
  days_pending: number
  amount_paid:  number
  amount_pending: number
  daily_detail: Array<{
    route:   string
    date:    string
    rate:    number
    ticket:  number
    paid:    boolean
  }>
}

// --- Paramètres d'ancienneté ---
export interface SenioritySettings {
  seniority_threshold_months: number
  requires_hr_validation:     boolean
}

// ============================================================
// PAYROLL MODULE TYPES
// ============================================================

export type PaySlipStatus = 'draft' | 'validated' | 'paid'
export type LoanType = 'emprunt' | 'avance' | 'acompte'
export type LoanStatus = 'en_cours' | 'solde' | 'annule'
export type DeductionType = 'contravention' | 'emprunt' | 'avance' | 'acompte' | 'absence_non_justifiee' | 'sanction_financiere' | 'autre'
export type DeductionStatus = 'active' | 'applied' | 'cancelled'
export type SuspensionType = 'absence_prolongee' | 'suspension_disciplinaire' | 'depart' | 'contrat_expire' | 'autre'
export type ExplanationStatus = 'en_attente' | 'repondu' | 'sanction_appliquee' | 'classe'

export interface PaySlip {
  id: string
  employee_id: string
  employee_source: 'employees' | 'users'
  company_id: string | null
  period_year: number
  period_month: number
  employee_name: string
  employee_matricule: string | null
  employee_role: string | null
  employee_cnps: string | null
  employee_nationality?: string | null
  employee_marital_status: string | null
  employee_children_count: number
  employee_hire_date?: string | null
  contract_type: ContractType | null
  base_salary: number
  sursalaire: number
  primes: number
  indemnites: number
  avantages: number
  primes_non_imposables: number
  gross_salary: number
  retenues: number
  cnps_employee: number
  cnps_employer: number
  its: number
  cn: number
  igr: number
  cmu_employee: number
  cmu_employer: number
  transport_allowance: number
  taxable_gross: number
  parts: number
  loan_deductions: number
  deduction_details: DeductionDetail[]
  prime_details?: PrimeDetail[]
  net_salary: number
  status: PaySlipStatus
  validated_by: string | null
  validated_at: string | null
  paid_at: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  company?: { id: string; name: string; code: string } | null
}

export interface DeductionDetail {
  type: 'emprunt' | 'avance' | 'acompte' | 'contravention' | 'absence_non_justifiee' | 'sanction_financiere' | 'autre'
  label: string
  amount: number
  ref_id?: string
}

// --- Rubriques de primes ---
export type PrimePeriodicity = 'mensuelle' | 'ponctuelle' | 'annuelle'
export type PrimeCalcType = 'fixed' | 'percent_base' | 'seniority'
export type PrimeBucket = 'sursalaire' | 'transport' | 'primes' | 'indemnites' | 'avantages'

export interface PrimeRubric {
  id: string
  code: string
  label: string
  is_taxable: boolean
  periodicity: PrimePeriodicity
  calc_type: PrimeCalcType
  default_amount: number
  percent_rate: number
  target_bucket: PrimeBucket
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface EmployeePrime {
  id: string
  employee_id: string
  employee_source: 'employees' | 'users'
  company_id: string | null
  employee_name: string
  rubric_id: string
  amount: number | null
  period_year: number | null
  period_month: number | null
  is_active: boolean
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  rubric?: PrimeRubric | null
  company?: { id: string; name: string; code: string } | null
}

export interface PrimeDetail {
  rubric_code: string
  label: string
  amount: number
  taxable: boolean
}

export interface PaySlipLine {
  id: string
  pay_slip_id: string
  category: 'gain' | 'deduction'
  line_type: string
  label: string
  base: number | null
  rate: number | null
  amount: number
  sort_order: number
  created_at: string
}

export interface EmployeeLoan {
  id: string
  employee_id: string
  employee_source: 'employees' | 'users'
  company_id: string | null
  loan_type: LoanType
  employee_name: string
  amount_granted: number
  request_date: string
  validation_date: string | null
  installment_count: number
  installment_amount: number
  repayment_start: string | null
  repayment_end: string | null
  remaining_balance: number
  status: LoanStatus
  notes: string | null
  approved_by: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  company?: { id: string; name: string; code: string } | null
}

export interface LoanRepayment {
  id: string
  loan_id: string
  pay_slip_id: string | null
  period_year: number
  period_month: number
  amount: number
  repayment_date: string
  created_at: string
}

export interface SalaryDeduction {
  id: string
  employee_id: string
  employee_source: 'employees' | 'users'
  company_id: string | null
  employee_name: string
  deduction_type: DeductionType
  period_year: number
  period_month: number
  amount: number
  motif: string | null
  status: DeductionStatus
  pay_slip_id: string | null
  loan_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  company?: { id: string; name: string; code: string } | null
}

export interface EmployeeSuspension {
  id: string
  employee_id: string
  employee_source: 'employees' | 'users'
  company_id: string | null
  employee_name: string
  suspension_type: SuspensionType
  start_date: string
  end_date: string | null
  motif: string | null
  is_salary_suspended: boolean
  is_active: boolean
  decided_by: string | null
  lifted_by: string | null
  lifted_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  company?: { id: string; name: string; code: string } | null
}

export interface ExplanationRequest {
  id: string
  employee_id: string
  employee_source: 'employees' | 'users'
  company_id: string | null
  employee_name: string
  request_date: string
  motif: string
  description: string | null
  proposed_sanction: string | null
  applied_sanction: string | null
  responsible_id: string | null
  responsible_name: string | null
  status: ExplanationStatus
  employee_response: string | null
  response_date: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  company?: { id: string; name: string; code: string } | null
}
