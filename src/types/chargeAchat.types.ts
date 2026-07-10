export interface ExpenseCategory {
  id: string
  name: string
  icon: string
  color: string
  sort_order: number
}

export interface FleetVehicle {
  id: string
  registration_number: string
  company_id: string
  brand: string | null
  model: string | null
  is_active: boolean
  notes: string | null
  created_at: string
}

export type ExpenseValidationStatus = 'en_attente' | 'validee'

export interface VehicleExpense {
  id: string
  company_id: string
  vehicle_id: string | null
  registration_number: string
  expense_date: string
  week_start: string
  category_id: string | null
  description: string
  supplier: string | null
  amount: number
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  validation_status: ExpenseValidationStatus
  validated_at: string | null
  validated_by: string | null
  // joins
  company?: { name: string; code: string }
  category?: ExpenseCategory
}

export interface CompanySummary {
  company_id: string
  company_name: string
  company_code: string
  total: number
}

export interface VehicleSummary {
  vehicle_id: string | null
  registration_number: string
  company_id: string
  company_name: string
  total_week: number
  total_all: number
  incident_count: number
  last_intervention: string | null
  expenses: VehicleExpense[]
}

export interface FixedExpenseType {
  id: string
  name: string
  icon: string
  color: string
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface FixedExpense {
  id: string
  expense_type_id: string
  garage_id: string | null
  zone: string | null
  expense_date: string
  amount: number
  supplier: string | null
  invoice_reference: string | null
  observation: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  expense_type?: FixedExpenseType
  garage?: { id: string; name: string; city: string; region: string | null }
}
