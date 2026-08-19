import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/services/supabase';

export interface CompanyInfo {
  id: string;
  name: string;
  code: string;
}

/**
 * Returns the company IDs a comptable is allowed to access, plus the
 * resolved company records (name, code) for display in selectors.
 *
 * - For comptables: returns the array of assigned company IDs from
 *   `comptable_companies`. If empty, the comptable has no company access.
 * - For non-comptable roles: returns null, meaning "no multi-company
 *   restriction — use the existing single company_id filter".
 */
export function useComptableCompanies() {
  const { user } = useAuthStore();
  const [companyInfos, setCompanyInfos] = useState<CompanyInfo[]>([]);

  const isComptable = user?.role === 'comptable';
  const assigned = isComptable ? (user.assigned_company_ids ?? []) : [];
  const assignedKey = assigned.join(',');

  useEffect(() => {
    if (assigned.length === 0) { setCompanyInfos([]); return; }
    supabase
      .from('companies')
      .select('id, name, code')
      .in('id', assigned)
      .then(({ data }) => {
        setCompanyInfos((data ?? []) as CompanyInfo[]);
      });
  }, [assignedKey]);

  if (!isComptable) {
    return { allowedCompanyIds: null as string[] | null, companyInfos };
  }

  return { allowedCompanyIds: assigned, companyInfos };
}
