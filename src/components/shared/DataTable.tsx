import { useState } from 'react';
import { Search } from 'lucide-react';
import Pagination from '../pos/Pagination';
import { usePagination } from '../../hooks/usePagination';

interface Column<T> {
  key: string;
  label: string;
  render?: (item: T) => React.ReactNode;
  sortable?: boolean;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  searchable?: boolean;
  searchPlaceholder?: string;
  onRowClick?: (item: T) => void;
  emptyMessage?: string;
  /** localStorage key remembering the rows per page of this table */
  pageSizeKey?: string;
  /** Change it when the caller's filters change, to go back to page 1 */
  resetKey?: string;
  /** Plural name of the rows, e.g. "utilisateurs" */
  itemLabel?: string;
}

export default function DataTable<T extends Record<string, any>>({
  data,
  columns,
  searchable = true,
  searchPlaceholder = 'Rechercher...',
  onRowClick,
  emptyMessage = 'Aucune donnée disponible',
  pageSizeKey = 'sbta_datatable_page_size',
  resetKey = '',
  itemLabel = 'lignes',
}: DataTableProps<T>) {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

  const filteredData = data.filter((item) => {
    if (!searchTerm) return true;
    return Object.values(item).some((value) =>
      String(value).toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  const sortedData = [...filteredData].sort((a, b) => {
    if (!sortConfig) return 0;

    const aValue = a[sortConfig.key];
    const bValue = b[sortConfig.key];

    if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  // Same pagination as the guichet departures list: back to page 1 when the search, the sort
  // or the caller's filters (resetKey) change
  const pagination = usePagination(
    sortedData,
    pageSizeKey,
    `${searchTerm}|${sortConfig?.key}|${sortConfig?.direction}|${resetKey}`,
  );
  const paginatedData = pagination.pageItems;

  const handleSort = (key: string) => {
    setSortConfig((current) => {
      if (current?.key === key) {
        return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
    });
  };

  return (
    <div className="space-y-4">
      {searchable && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full pl-10 pr-4 py-2 rounded-lg border focus:outline-none focus:ring-2"
            style={{
              borderColor: 'var(--border)',
              backgroundColor: 'var(--surface)',
              color: 'var(--text-primary)',
            }}
          />
        </div>
      )}

      <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead style={{ backgroundColor: 'var(--surface-raised)' }}>
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    onClick={() => column.sortable && handleSort(column.key)}
                    className={`px-4 py-3 text-left text-sm font-medium ${column.sortable ? 'cursor-pointer hover:bg-gray-100' : ''}`}
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody style={{ backgroundColor: 'var(--surface)' }}>
              {paginatedData.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-8 text-center" style={{ color: 'var(--text-muted)' }}>
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                paginatedData.map((item, index) => (
                  <tr
                    key={index}
                    onClick={() => onRowClick?.(item)}
                    className={`border-t ${onRowClick ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                    style={{ borderColor: 'var(--border)' }}
                  >
                    {columns.map((column) => (
                      <td key={column.key} className="px-4 py-3 text-sm" style={{ color: 'var(--text-primary)' }}>
                        {column.render ? column.render(item) : item[column.key]}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {sortedData.length > 0 && (
          <div className="border-t px-4 py-2" style={{ borderColor: 'var(--border)' }}>
            <Pagination
              page={pagination.page}
              pageCount={pagination.pageCount}
              pageSize={pagination.pageSize}
              total={pagination.total}
              onPageChange={pagination.setPage}
              onPageSizeChange={pagination.setPageSize}
              itemLabel={itemLabel}
            />
          </div>
        )}
      </div>
    </div>
  );
}
