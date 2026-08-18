import { useAuthStore } from '@/store/authStore';

/**
 * Returns the company IDs a comptable is allowed to access.
 *
 * - For comptables: returns the array of assigned company IDs from
 *   `comptable_companies`. If empty, the comptable has no company access.
 * - For non-comptable roles: returns null, meaning "no multi-company
 *   restriction — use the existing single company_id filter".
 *
 * Usage in comptable pages:
 *   const { allowedCompanyIds } = useComptableCompanies();
 *   // If allowedCompanyIds is null, fall back to user.company_id.
 *   // If it's an empty array, show "no access".
 *   // If it has items, filter with .in('company_id', allowedCompanyIds).
 */
export function useComptableCompanies() {
  const { user } = useAuthStore();

  if (user?.role !== 'comptable') {
    return { allowedCompanyIds: null as string[] | null };
  }

  const assigned = user.assigned_company_ids ?? [];
  return { allowedCompanyIds: assigned };
}
