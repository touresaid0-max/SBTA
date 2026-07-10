import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Filter, CreditCard as Edit2, Trash2, ChevronLeft, ChevronRight, Download, ChevronDown, CheckCircle, Clock } from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/store/authStore'
import type { VehicleExpense, ExpenseCategory } from '@/types/chargeAchat.types'

const PAGE_SIZE = 20
const fmt = (n: number) => new Intl.NumberFormat('fr-FR').format(n) + ' XOF'
const REGIONAL_COMPANIES = ['TST', 'ETL', 'SNT']

export default function ComptableExpensesList() {
  const navigate  = useNavigate()
  const { user }  = useAuthStore()
  const companyId = user?.company_id ?? null

  const [expenses,    setExpenses]    = useState<VehicleExpense[]>([])
  const [total,       setTotal]       = useState(0)
  const [page,        setPage]        = useState(1)
  const [loading,     setLoading]     = useState(true)
  const [deleting,    setDeleting]    = useState<string | null>(null)
  const [busIds,      setBusIds]      = useState<string[] | null>(null)
  const [companyCode, setCompanyCode] = useState('')

  const [search,      setSearch]      = useState('')
  const [vehicle,     setVehicle]     = useState('')
  const [categoryId,  setCategoryId]  = useState('')
  const [dateFrom,    setDateFrom]    = useState('')
  const [dateTo,      setDateTo]      = useState('')
  const [amtMin,      setAmtMin]      = useState('')
  const [amtMax,      setAmtMax]      = useState('')
  const [sortField,   setSortField]   = useState<'expense_date' | 'amount'>('expense_date')
  const [sortDir]                     = useState<'desc' | 'asc'>('desc')
  const [statusFilter, setStatusFilter] = useState<'all' | 'en_attente' | 'validee'>('all')

  const [categories,  setCategories]  = useState<ExpenseCategory[]>([])
  const [showFilters, setShowFilters] = useState(false)
  const [validating,  setValidating]  = useState<string | null>(null)

  const isRegional = REGIONAL_COMPANIES.includes(companyCode)

  useEffect(() => {
    supabase.from('expense_categories').select('*').order('sort_order').then(({ data }) => {
      if (data) setCategories(data)
    })
    if (companyId) {
      supabase.from('buses').select('id').eq('company_id', companyId).then(({ data }) => {
        setBusIds(data ? data.map((b: { id: string }) => b.id) : [])
      })
      supabase.from('companies').select('code').eq('id', companyId).maybeSingle().then(({ data }) => {
        if (data?.code) setCompanyCode(data.code)
      })
    } else {
      setBusIds([])
    }
  }, [companyId])

  const load = useCallback(async () => {
    if (busIds === null || !companyId) return
    setLoading(true)
    try {
      let q = supabase
        .from('vehicle_expenses')
        .select('*, company:companies(name,code), category:expense_categories(name,icon,color)', { count: 'exact' })
        .eq('company_id', companyId)
        .eq('source', 'comptable')

      if (statusFilter !== 'all') q = q.eq('validation_status', statusFilter)
      if (vehicle)    q = q.ilike('registration_number', `%${vehicle}%`)
      if (categoryId) q = q.eq('category_id', categoryId)
      if (dateFrom)   q = q.gte('expense_date', dateFrom)
      if (dateTo)     q = q.lte('expense_date', dateTo)
      if (amtMin)     q = q.gte('amount', Number(amtMin))
      if (amtMax)     q = q.lte('amount', Number(amtMax))
      if (search) q = q.or(`description.ilike.%${search}%,registration_number.ilike.%${search}%,supplier.ilike.%${search}%`)

      q = q.order(sortField, { ascending: sortDir === 'asc' })
      q = q.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

      const { data, count } = await q
      setExpenses((data ?? []) as VehicleExpense[])
      setTotal(count ?? 0)
    } finally {
      setLoading(false)
    }
  }, [companyId, busIds, search, vehicle, categoryId, dateFrom, dateTo, amtMin, amtMax, sortField, sortDir, page, statusFilter])

  useEffect(() => { setPage(1) }, [search, vehicle, categoryId, dateFrom, dateTo, amtMin, amtMax, statusFilter])
  useEffect(() => { load() }, [load])

  const handleValidate = async (id: string) => {
    setValidating(id)
    const { error } = await supabase
      .from('vehicle_expenses')
      .update({ validation_status: 'validee', validated_at: new Date().toISOString(), validated_by: user?.id })
      .eq('id', id)
    if (error) { toast.error('Erreur lors de la validation'); setValidating(null); return }
    toast.success('Depense validee')
    load()
    setValidating(null)
  }

  const handleBulkValidate = async () => {
    const pendingIds = expenses.filter(e => e.validation_status === 'en_attente').map(e => e.id)
    if (pendingIds.length === 0) { toast.error('Aucune depense en attente sur cette page'); return }
    if (!confirm(`Valider ${pendingIds.length} depense(s) en attente ?`)) return
    setValidating('bulk')
    const { error } = await supabase
      .from('vehicle_expenses')
      .update({ validation_status: 'validee', validated_at: new Date().toISOString(), validated_by: user?.id })
      .in('id', pendingIds)
    if (error) { toast.error('Erreur lors de la validation'); setValidating(null); return }
    toast.success(`${pendingIds.length} depense(s) validee(s)`)
    load()
    setValidating(null)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer cette dépense ?')) return
    setDeleting(id)
    const { error } = await supabase.from('vehicle_expenses').delete().eq('id', id)
    if (error) { toast.error('Erreur lors de la suppression'); setDeleting(null); return }
    toast.success('Dépense supprimée')
    load()
    setDeleting(null)
  }

  const exportExcel = async () => {
    if (!companyId) return
    const { utils, writeFile } = await import('xlsx')
    let q = supabase.from('vehicle_expenses').select('*, category:expense_categories(name,icon,color)').eq('company_id', companyId).eq('source', 'comptable')
    if (vehicle)    q = q.ilike('registration_number', `%${vehicle}%`)
    if (categoryId) q = q.eq('category_id', categoryId)
    if (dateFrom)   q = q.gte('expense_date', dateFrom)
    if (dateTo)     q = q.lte('expense_date', dateTo)
    if (amtMin)     q = q.gte('amount', Number(amtMin))
    if (amtMax)     q = q.lte('amount', Number(amtMax))
    if (search)     q = q.or(`description.ilike.%${search}%,registration_number.ilike.%${search}%,supplier.ilike.%${search}%`)
    q = q.order('expense_date')
    const { data } = await q
    const all = (data ?? []) as VehicleExpense[]

    const wb = utils.book_new()
    const rows: unknown[][] = [
      [`DÉPENSES ${dateFrom ? `DU ${dateFrom}` : ''} ${dateTo ? `AU ${dateTo}` : ''}`],
      [],
      ['Date', 'Immatriculation', 'Catégorie', 'Description', 'Fournisseur', 'Montant (XOF)'],
      ...all.map(r => [r.expense_date, r.registration_number, r.category?.name ?? '', r.description, r.supplier ?? '', Number(r.amount)]),
      [],
      ['', '', '', '', 'TOTAL', all.reduce((a, b) => a + Number(b.amount), 0)],
    ]
    const ws = utils.aoa_to_sheet(rows)
    utils.book_append_sheet(wb, ws, 'Dépenses')
    writeFile(wb, `depenses_${format(new Date(), 'yyyy-MM-dd')}.xlsx`)
  }

  const pages = Math.ceil(total / PAGE_SIZE)
  const totalAmt = expenses.reduce((a, b) => a + Number(b.amount), 0)

  const thCls = "px-3 py-3 text-left text-xs font-semibold"

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-7xl mx-auto">

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Depenses vehicules</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{total} depenses trouvees</p>
        </div>
        <div className="flex items-center gap-2">
          {isRegional && expenses.some(e => e.validation_status === 'en_attente') && (
            <button onClick={handleBulkValidate} disabled={validating === 'bulk'} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-50" style={{ backgroundColor: '#0B7439', color: '#fff' }}>
              <CheckCircle className="w-3.5 h-3.5" /> Tout valider
            </button>
          )}
          <button onClick={exportExcel} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold" style={{ backgroundColor: '#1D6FA4', color: '#fff' }}>
            <Download className="w-3.5 h-3.5" /> Excel
          </button>
          <button onClick={() => navigate('/comptable/expenses/new')} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold" style={{ backgroundColor: '#0B7439', color: '#fff' }}>
            <Plus className="w-4 h-4" /> Nouvelle depense
          </button>
        </div>
      </div>

      {isRegional && (
        <div className="flex gap-1 p-1 rounded-lg" style={{ backgroundColor: 'var(--bg-subtle)' }}>
          {([['all', 'Toutes'], ['en_attente', 'En attente'], ['validee', 'Validees']] as const).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setStatusFilter(val)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all"
              style={{
                backgroundColor: statusFilter === val ? (val === 'en_attente' ? '#FEF3C7' : val === 'validee' ? '#D1FAE5' : 'var(--surface)') : 'transparent',
                color: statusFilter === val ? (val === 'en_attente' ? '#92400E' : val === 'validee' ? '#065F46' : 'var(--text-primary)') : 'var(--text-muted)',
                boxShadow: statusFilter === val ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
              }}
            >
              {val === 'en_attente' && <Clock className="w-3 h-3" />}
              {val === 'validee' && <CheckCircle className="w-3 h-3" />}
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="rounded-xl p-3 space-y-3" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher par description, immatriculation, fournisseur…" className="w-full pl-9 pr-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
          </div>
          <button onClick={() => setShowFilters(f => !f)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium" style={{ backgroundColor: showFilters ? '#0B7439' : 'var(--bg-subtle)', color: showFilters ? '#fff' : 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            <Filter className="w-3.5 h-3.5" /> Filtres
          </button>
        </div>

        {showFilters && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Immatriculation</label>
              <input value={vehicle} onChange={e => setVehicle(e.target.value)} placeholder="Filtrer…" className="w-full px-2.5 py-1.5 rounded-lg text-xs" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Catégorie</label>
              <div className="relative">
                <select value={categoryId} onChange={e => setCategoryId(e.target.value)} className="w-full px-2.5 py-1.5 rounded-lg text-xs appearance-none" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                  <option value="">Toutes</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Trier par</label>
              <div className="relative">
                <select value={sortField} onChange={e => setSortField(e.target.value as 'expense_date' | 'amount')} className="w-full px-2.5 py-1.5 rounded-lg text-xs appearance-none" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                  <option value="expense_date">Date</option>
                  <option value="amount">Montant</option>
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Date début</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-full px-2.5 py-1.5 rounded-lg text-xs" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Date fin</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-full px-2.5 py-1.5 rounded-lg text-xs" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Montant min</label>
              <input type="number" value={amtMin} onChange={e => setAmtMin(e.target.value)} placeholder="0" className="w-full px-2.5 py-1.5 rounded-lg text-xs" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Montant max</label>
              <input type="number" value={amtMax} onChange={e => setAmtMax(e.target.value)} placeholder="∞" className="w-full px-2.5 py-1.5 rounded-lg text-xs" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            </div>
            <div className="flex items-end">
              <button onClick={() => { setVehicle(''); setCategoryId(''); setDateFrom(''); setDateTo(''); setAmtMin(''); setAmtMax(''); setSearch(''); setStatusFilter('all') }} className="text-xs px-3 py-1.5 rounded-lg" style={{ color: '#DC2626', backgroundColor: '#fee2e2', border: '1px solid #fca5a5' }}>
                Reinitialiser
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                {['Date', 'Vehicule', 'Categorie', 'Description', 'Fournisseur', 'Montant', ...(isRegional ? ['Statut'] : [])].map(h => (
                  <th key={h} className={thCls} style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
                <th className="px-3 py-3 w-24" />
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {loading ? (
                <tr><td colSpan={isRegional ? 8 : 7} className="py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Chargement...</td></tr>
              ) : expenses.length === 0 ? (
                <tr><td colSpan={isRegional ? 8 : 7} className="py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Aucune depense trouvee</td></tr>
              ) : expenses.map(e => (
                <tr key={e.id} className="hover:bg-gray-50 transition-colors" style={isRegional && e.validation_status === 'en_attente' ? { backgroundColor: '#FFFBEB' } : {}}>
                  <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {format(new Date(e.expense_date), 'dd/MM/yy', { locale: fr })}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{e.registration_number}</td>
                  <td className="px-3 py-2.5 text-xs">
                    {e.category ? (
                      <span className="flex items-center gap-1"><span>{e.category.icon}</span><span style={{ color: e.category.color }}>{e.category.name}</span></span>
                    ) : <span style={{ color: 'var(--text-muted)' }}>--</span>}
                  </td>
                  <td className="px-3 py-2.5 max-w-[200px]">
                    <p className="truncate text-xs" style={{ color: 'var(--text-primary)' }}>{e.description}</p>
                  </td>
                  <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{e.supplier ?? '--'}</td>
                  <td className="px-3 py-2.5 font-bold text-xs" style={{ color: Number(e.amount) >= 200000 ? '#DC2626' : 'var(--text-primary)' }}>
                    {fmt(Number(e.amount))}
                  </td>
                  {isRegional && (
                    <td className="px-3 py-2.5">
                      {e.validation_status === 'en_attente' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
                          <Clock className="w-3 h-3" /> En attente
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>
                          <CheckCircle className="w-3 h-3" /> Validee
                        </span>
                      )}
                    </td>
                  )}
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1">
                      {isRegional && e.validation_status === 'en_attente' && (
                        <button onClick={() => handleValidate(e.id)} disabled={validating === e.id} className="p-1.5 rounded hover:bg-green-50 disabled:opacity-50" title="Valider">
                          <CheckCircle className="w-3.5 h-3.5" style={{ color: '#0B7439' }} />
                        </button>
                      )}
                      <button onClick={() => navigate(`/comptable/expenses/${e.id}/edit`)} className="p-1.5 rounded hover:bg-gray-100" title="Modifier">
                        <Edit2 className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                      </button>
                      <button onClick={() => handleDelete(e.id)} disabled={deleting === e.id} className="p-1.5 rounded hover:bg-red-50" title="Supprimer">
                        <Trash2 className="w-3.5 h-3.5" style={{ color: deleting === e.id ? '#D1D5DB' : '#DC2626' }} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            {expenses.length > 0 && (
              <tfoot>
                <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                  <td colSpan={isRegional ? 6 : 5} className="px-3 py-2.5 text-right text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                    Total page ({expenses.length} lignes) :
                  </td>
                  <td className="px-3 py-2.5 text-xs font-bold" style={{ color: '#0B7439' }}>{fmt(totalAmt)}</td>
                  {isRegional && <td />}
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t" style={{ borderColor: 'var(--border)' }}>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Page {page} / {pages} — {total} résultats</p>
            <div className="flex gap-1">
              <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="p-1.5 rounded disabled:opacity-40 hover:bg-gray-100">
                <ChevronLeft className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
              </button>
              <button disabled={page === pages} onClick={() => setPage(p => p + 1)} className="p-1.5 rounded disabled:opacity-40 hover:bg-gray-100">
                <ChevronRight className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
