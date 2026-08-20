import { useState, useMemo } from 'react';
import { Building2 } from 'lucide-react';
import { useComptableCompanies, type CompanyInfo } from '@/hooks/useComptableCompanies';
import { useAuthStore } from '@/store/authStore';

export interface CompanyFilterState {
  /** All assigned company IDs (or single user company_id for non-comptable) */
  allCompanyIds: string[];
  /** Currently selected company IDs. Empty = all companies. */
  selectedCompanyIds: string[];
  /** Resolved company records for display */
  companyInfos: CompanyInfo[];
  /** Whether the multi-company selector should be shown */
  hasMultiple: boolean;
}

/**
 * Hook that provides per-company filtering state for comptable modules.
 * - Default selection: all assigned companies (empty = "Toutes").
 * - When a specific company is selected, `selectedCompanyIds` contains one ID.
 * - For non-comptable roles or single-company comptables, returns the single
 *   company ID and `hasMultiple = false` (no selector shown).
 */
export function useCompanyFilter(): CompanyFilterState {
  const { user } = useAuthStore();
  const { allowedCompanyIds, companyInfos } = useComptableCompanies();
  const allCompanyIds = allowedCompanyIds ?? (user?.company_id ? [user.company_id] : []);
  const hasMultiple = allCompanyIds.length > 1;
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([]);

  return useMemo(
    () => ({
      allCompanyIds,
      selectedCompanyIds: selectedCompanyIds.length === 0 ? allCompanyIds : selectedCompanyIds,
      companyInfos,
      hasMultiple,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allCompanyIds.join(','), selectedCompanyIds.join(','), companyInfos],
  );
}

/**
 * Get the single company ID for inserts, when there's only one company.
 * Returns null if multiple companies are assigned and none is selected.
 */
export function getInsertCompanyId(filter: CompanyFilterState): string | null {
  if (filter.allCompanyIds.length === 1) return filter.allCompanyIds[0];
  if (filter.selectedCompanyIds.length === 1) return filter.selectedCompanyIds[0];
  return null;
}

interface CompanyFilterBarProps {
  filter: CompanyFilterState;
  onChange: (companyIds: string[]) => void;
  /** Optional label override */
  label?: string;
}

/**
 * UI component: a horizontal pill-style company selector.
 * Shows "Toutes" + one pill per assigned company. Hidden when hasMultiple is false.
 */
export function CompanyFilterBar({ filter, onChange, label }: CompanyFilterBarProps) {
  if (!filter.hasMultiple) return null;

  const { companyInfos, allCompanyIds } = filter;
  // "Toutes" is active when the user hasn't picked a specific company
  const isAllActive = filter.selectedCompanyIds.length === 0
    || filter.selectedCompanyIds.length === allCompanyIds.length;

  return (
    <div className="flex items-center gap-2 flex-wrap mb-5">
      <div className="flex items-center gap-1.5 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
        <Building2 className="w-4 h-4" />
        {label ?? 'Société'}
      </div>
      <button
        onClick={() => onChange([])}
        className="px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors"
        style={{
          backgroundColor: isAllActive ? 'var(--primary)' : 'transparent',
          color: isAllActive ? '#fff' : 'var(--text-secondary)',
          border: isAllActive ? 'none' : '1px solid var(--border)',
        }}
      >
        Toutes ({allCompanyIds.length})
      </button>
      {companyInfos.map(c => {
        const active = !isAllActive && filter.selectedCompanyIds.includes(c.id);
        return (
          <button
            key={c.id}
            onClick={() => onChange(isAllActive ? [c.id] : filter.selectedCompanyIds.includes(c.id) && filter.selectedCompanyIds.length === 1 ? [] : [c.id])}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors"
            style={{
              backgroundColor: active ? 'var(--primary)' : 'transparent',
              color: active ? '#fff' : 'var(--text-secondary)',
              border: active ? 'none' : '1px solid var(--border)',
            }}
          >
            {c.name} ({c.code})
          </button>
        );
      })}
    </div>
  );
}
