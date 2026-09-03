import { supabase } from './supabase';

export interface CreateEmployeePayload {
  first_name: string;
  last_name: string;
  gender?: 'M' | 'F';
  phone?: string;
  personal_email?: string;
  professional_email?: string;
  role: string;
  company_id?: string;
  station_id?: string;
  hire_date: string;
  contract_type?: 'titulaire' | 'contractuel';
  salary?: number;
  daily_rate?: number;
  cnps_number?: string;
  children_count?: number;
  marital_status?: 'celibataire' | 'marie' | 'divorce' | 'veuf';
  bus_id?: string;
  license_number?: string;
  license_expiry?: string;
  license_category?: string;
  employee_id?: string;
  assigned_route_id?: string;
}

export interface PendingEmployee {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  role: string;
  professional_email: string | null;
  personal_email: string | null;
  phone: string | null;
  employee_id: string | null;
  hire_date: string | null;
  account_status: string;
  created_by_hr_at: string;
  company_id: string | null;
  company_name: string | null;
  company_code: string | null;
  station_name: string | null;
}

// Créer un employé (appelé par le RH)
export async function createEmployeeByHR(employeeData: CreateEmployeePayload) {
  const { data: { session } } = await supabase.auth.getSession();

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rh-create-employee`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session?.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(employeeData),
    }
  );

  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result.employee;
}

// Créer le compte Auth (appelé par l'Admin)
export async function createAccountByAdmin(params: {
  employee_id: string;
  email: string;
  password: string;
  send_welcome_email: boolean;
  assigned_route_ids?: string[];
}) {
  const { data: { session } } = await supabase.auth.getSession();

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-create-account`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session?.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    }
  );

  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

// Charger les employés en attente de compte
export async function fetchPendingEmployees(): Promise<PendingEmployee[]> {
  const { data, error } = await supabase
    .from('employees_pending_account')
    .select('*')
    .order('created_by_hr_at', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

// Compter les employés en attente (uniquement depuis la table employees)
export async function countPendingAccounts(): Promise<number> {
  const { count, error } = await supabase
    .from('employees')
    .select('id', { count: 'exact', head: true })
    .eq('account_status', 'pending');

  if (error) return 0;
  return count ?? 0;
}
