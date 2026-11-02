import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { PAGE_SIZE_OPTIONS } from '@/hooks/usePagination';

interface Props {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  /** Plural name of the rows, e.g. "départs" */
  itemLabel: string;
}

export default function Pagination({ page, pageCount, pageSize, total, onPageChange, onPageSizeChange, itemLabel }: Props) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  const navButton = (label: string, target: number, disabled: boolean, icon: ReactNode) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onPageChange(target)}
      className="flex h-8 w-8 items-center justify-center rounded-lg border disabled:cursor-not-allowed disabled:opacity-40"
      style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', backgroundColor: 'var(--surface)' }}
    >
      {icon}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
      <label className="flex items-center gap-2 font-bold">
        Afficher
        <select
          value={pageSize}
          onChange={e => onPageSizeChange(Number(e.target.value))}
          className="rounded-lg border px-2 py-1 text-sm"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
        >
          {PAGE_SIZE_OPTIONS.map(size => <option key={size} value={size}>{size}</option>)}
        </select>
        par page
      </label>

      <span className="font-bold">
        {first}–{last} sur {total} {itemLabel}
      </span>

      <div className="flex items-center gap-1">
        {navButton('Première page', 1, page <= 1, <ChevronsLeft className="h-4 w-4" />)}
        {navButton('Page précédente', page - 1, page <= 1, <ChevronLeft className="h-4 w-4" />)}
        <span className="px-2 font-bold" style={{ color: 'var(--text-primary)' }}>
          Page {page} / {pageCount}
        </span>
        {navButton('Page suivante', page + 1, page >= pageCount, <ChevronRight className="h-4 w-4" />)}
        {navButton('Dernière page', pageCount, page >= pageCount, <ChevronsRight className="h-4 w-4" />)}
      </div>
    </div>
  );
}
