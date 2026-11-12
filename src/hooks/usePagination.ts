import { useEffect, useMemo, useState } from 'react';

export const PAGE_SIZE_OPTIONS = [20, 25, 40, 50] as const;
const DEFAULT_PAGE_SIZE = 20;

interface PaginationOptions {
  /** Choices offered in « Afficher … par page » (default 20, 25, 40, 50) */
  sizes?: readonly number[];
  /** Rows per page until the user picks another number (default 20) */
  defaultSize?: number;
}

function readPageSize(storageKey: string, sizes: readonly number[], fallback: number): number {
  try {
    const saved = Number(localStorage.getItem(storageKey));
    return sizes.includes(saved) ? saved : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Page of a list shown in a table. The number of rows per page is remembered on the device
 * (per screen); the page goes back to the first one whenever `resetKey` changes (filters, sort).
 */
export function usePagination<T>(items: T[], storageKey: string, resetKey: unknown, options: PaginationOptions = {}) {
  const sizes = options.sizes ?? PAGE_SIZE_OPTIONS;
  const [pageSize, setPageSizeState] = useState<number>(() => readPageSize(storageKey, sizes, options.defaultSize ?? DEFAULT_PAGE_SIZE));
  const [page, setPage] = useState(1);

  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));

  useEffect(() => { setPage(1); }, [resetKey]);
  // A list that shrank (cancellation, new filter) must not leave an empty page shown
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);

  const pageItems = useMemo(
    () => items.slice((page - 1) * pageSize, page * pageSize),
    [items, page, pageSize],
  );

  const setPageSize = (size: number) => {
    setPageSizeState(size);
    setPage(1);
    try { localStorage.setItem(storageKey, String(size)); } catch { /* not remembered */ }
  };

  return { page, setPage, pageSize, setPageSize, pageCount, pageItems, total: items.length, sizes };
}
