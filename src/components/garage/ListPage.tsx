import { useState, useMemo, type ReactNode } from 'react'
import { Search, RotateCcw, Plus } from 'lucide-react'

interface Column<T> {
  key: string
  label: string
  render?: (row: T) => ReactNode
  className?: string
}

interface ListPageProps<T> {
  title: string
  subtitle?: string
  data: T[]
  loading: boolean
  columns: Column<T>[]
  searchFields: (keyof T | string)[]
  onCreate?: () => void
  createLabel?: string
  rowActions?: (row: T) => ReactNode
  extraFilters?: ReactNode
  pageSize?: number
}

export function usePagination<T>(data: T[], pageSize = 10) {
  const [page, setPage] = useState(0)
  const total = data.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = page * pageSize
  const end = Math.min(start + pageSize, total)
  const pageData = data.slice(start, end)
  return { page, setPage, total, totalPages, start, end, pageData }
}

export default function ListPage<T extends { id: string }>({
  title, subtitle, data, loading, columns, searchFields,
  onCreate, createLabel, rowActions, extraFilters, pageSize = 10,
}: ListPageProps<T>) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)

  const filtered = useMemo(() => {
    if (!search) return data
    const q = search.toLowerCase()
    return data.filter(row =>
      searchFields.some(field => {
        const val = field.includes('.')
          ? field.split('.').reduce((obj: Record<string, unknown> | undefined, key) => (obj as Record<string, unknown>)?.[key] as Record<string, unknown> | undefined, row as unknown as Record<string, unknown>)
          : (row as Record<string, unknown>)[field]
        return String(val ?? '').toLowerCase().includes(q)
      })
    )
  }, [data, search, searchFields])

  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(page, totalPages - 1)
  const start = currentPage * pageSize
  const end = Math.min(start + pageSize, total)
  const pageData = filtered.slice(start, end)

  const resetFilters = () => { setSearch(''); setPage(0) }

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1A2E22]">{title}</h1>
          {subtitle && <p className="text-sm text-[#6B7280] mt-1">{subtitle}</p>}
        </div>
        {onCreate && (
          <button onClick={onCreate}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#0B7439] text-white rounded-xl font-medium hover:bg-[#095e2e] transition-colors">
            <Plus className="w-4 h-4" /> {createLabel ?? 'Créer'}
          </button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8AA898]" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(0) }}
            placeholder="Rechercher..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[#E2EAE5] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439]" />
        </div>
        {extraFilters}
        <button onClick={resetFilters}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#E2EAE5] text-sm font-medium text-[#4A6B55] hover:bg-[#F8FAF8] transition-colors">
          <RotateCcw className="w-4 h-4" /> Reset
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F8FAF8] border-b border-[#E2EAE5]">
                  {columns.map(col => (
                    <th key={col.key} className={`px-4 py-3 font-semibold text-[#4A6B55] text-left ${col.className ?? ''}`}>
                      {col.label}
                    </th>
                  ))}
                  {rowActions && <th className="px-4 py-3 font-semibold text-[#4A6B55] text-center">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {pageData.length === 0 ? (
                  <tr><td colSpan={columns.length + (rowActions ? 1 : 0)} className="text-center py-12 text-[#8AA898]">Aucune ligne trouvée</td></tr>
                ) : pageData.map(row => (
                  <tr key={row.id} className="border-t border-[#E2EAE5] hover:bg-[#F8FAF8] transition-colors">
                    {columns.map(col => (
                      <td key={col.key} className={`px-4 py-3 ${col.className ?? ''}`}>
                        {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '—')}
                      </td>
                    ))}
                    {rowActions && <td className="px-4 py-3 text-center">{rowActions(row)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#E2EAE5] text-sm text-[#6B7280]">
            <span>Affichage des lignes {total === 0 ? 0 : start + 1} à {end} sur {total} lignes au total</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={currentPage === 0}
                className="px-3 py-1.5 rounded-lg border border-[#E2EAE5] disabled:opacity-40 hover:bg-[#F8FAF8] transition-colors">
                Précédent
              </button>
              <span className="font-medium text-[#1A2E22]">Page {currentPage + 1} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={currentPage >= totalPages - 1}
                className="px-3 py-1.5 rounded-lg border border-[#E2EAE5] disabled:opacity-40 hover:bg-[#F8FAF8] transition-colors">
                Suivant
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
