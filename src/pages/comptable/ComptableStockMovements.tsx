import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, ChevronDown, X, Save, ArrowUpCircle, ArrowDownCircle, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/store/authStore'
import { useComptableCompanies, type CompanyInfo } from '@/hooks/useComptableCompanies'
import { CompanyFilterBar } from '@/components/shared/CompanyFilterBar'

interface StockMovement {
  id: string
  movement_date: string
  registration_number: string | null
  stock_item_id: string
  movement_type: 'entree' | 'sortie'
  quantity: number
  notes: string | null
  item?: { designation: string; code_article: string }
}

interface StockItem { id: string; designation: string; code_article: string }
interface MovementForm {
  stock_item_id: string
  movement_type: 'entree' | 'sortie'
  quantity: string
  movement_date: string
  registration_number: string
  notes: string
}

const EMPTY: MovementForm = {
  stock_item_id: '', movement_type: 'sortie', quantity: '',
  movement_date: format(new Date(), 'yyyy-MM-dd'), registration_number: '', notes: '',
}

export default function ComptableStockMovements() {
  const { user }  = useAuthStore()
  const { allowedCompanyIds, companyInfos } = useComptableCompanies()
  const allCompanyIds = allowedCompanyIds ?? (user?.company_id ? [user.company_id] : [])
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([])
  const companyIds = selectedCompanies.length > 0 ? selectedCompanies : allCompanyIds
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(companyIds[0] ?? null)

  const [movements,  setMovements]  = useState<StockMovement[]>([])
  const [items,      setItems]      = useState<StockItem[]>([])
  const [buses,      setBuses]      = useState<string[]>([])
  const [loading,    setLoading]    = useState(true)
  const [showForm,   setShowForm]   = useState(false)
  const [form,       setForm]       = useState<MovementForm>(EMPTY)
  const [saving,     setSaving]     = useState(false)
  const [filterType, setFilterType] = useState<'all' | 'entree' | 'sortie'>('all')
  const [filterItem, setFilterItem] = useState('')

  // Autocomplete state for form article field
  const [formArticleSearch, setFormArticleSearch] = useState('')
  const [formArticleOpen, setFormArticleOpen] = useState(false)
  const formArticleRef = useRef<HTMLDivElement>(null)

  // Autocomplete state for filter article field
  const [filterArticleSearch, setFilterArticleSearch] = useState('')
  const [filterArticleOpen, setFilterArticleOpen] = useState(false)
  const filterArticleRef = useRef<HTMLDivElement>(null)

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (formArticleRef.current && !formArticleRef.current.contains(e.target as Node)) setFormArticleOpen(false)
      if (filterArticleRef.current && !filterArticleRef.current.contains(e.target as Node)) setFilterArticleOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    if (companyIds.length === 0) return
    Promise.all([
      supabase.from('comptable_stock_items').select('id, designation, code_article').in('company_id', companyIds).order('designation'),
      supabase.from('fleet_vehicles').select('registration_number').in('company_id', companyIds).eq('is_active', true),
    ]).then(([itemsRes, busesRes]) => {
      if (itemsRes.data) setItems(itemsRes.data as StockItem[])
      if (busesRes.data) setBuses((busesRes.data as { registration_number: string }[]).map(v => v.registration_number).sort())
    })
  }, [companyIds])

  const load = useCallback(async () => {
    if (companyIds.length === 0) return
    setLoading(true)
    try {
      let q = supabase
        .from('comptable_stock_movements')
        .select('id, movement_date, registration_number, stock_item_id, movement_type, quantity, notes, item:comptable_stock_items(designation, code_article)')
        .in('company_id', companyIds)
        .order('movement_date', { ascending: false })

      if (filterType !== 'all') q = q.eq('movement_type', filterType)
      if (filterItem) q = q.eq('stock_item_id', filterItem)

      const { data } = await q
      setMovements((data ?? []) as StockMovement[])
    } finally {
      setLoading(false)
    }
  }, [companyIds, filterType, filterItem])

  useEffect(() => { load() }, [load])

  const setF = (field: keyof MovementForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }))

  const save = async () => {
    if (!form.stock_item_id) { toast.error('Sélectionnez un article'); return }
    if (!form.quantity || isNaN(Number(form.quantity)) || Number(form.quantity) <= 0) { toast.error('Quantité invalide'); return }
    if (companyIds.length === 0) return
    setSaving(true)
    try {
      const { error } = await supabase.from('comptable_stock_movements').insert({
        company_id:          selectedCompanyId,
        stock_item_id:       form.stock_item_id,
        movement_type:       form.movement_type,
        quantity:            Math.round(Number(form.quantity)),
        movement_date:       form.movement_date,
        registration_number: form.registration_number.trim() || null,
        notes:               form.notes.trim() || null,
        created_by:          user?.id ?? null,
      })
      if (error) throw error
      toast.success('Mouvement enregistré')
      setForm(EMPTY)
      setShowForm(false)
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setSaving(false)
    }
  }

  const deleteMovement = async (id: string) => {
    if (!confirm('Supprimer ce mouvement ?')) return
    const { error } = await supabase.from('comptable_stock_movements').delete().eq('id', id)
    if (error) { toast.error('Erreur'); return }
    toast.success('Mouvement supprimé')
    load()
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500'
  const inputStyle = { backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }

  const totalEntrees = movements.filter(m => m.movement_type === 'entree').reduce((a, b) => a + Number(b.quantity), 0)
  const totalSorties = movements.filter(m => m.movement_type === 'sortie').reduce((a, b) => a + Number(b.quantity), 0)

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-7xl mx-auto">

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Mouvements de stock</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Entrées et sorties par article et par bus</p>
        </div>
        <button onClick={() => { setShowForm(f => !f); setForm(EMPTY) }} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold" style={{ backgroundColor: '#0B7439', color: '#fff' }}>
          <Plus className="w-4 h-4" /> Nouveau mouvement
        </button>
      </div>

      <CompanyFilterBar filter={{ allCompanyIds, selectedCompanyIds: companyIds, companyInfos, hasMultiple: allCompanyIds.length > 1 }} onChange={setSelectedCompanies} />

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl p-4 flex items-center gap-3" style={{ backgroundColor: '#f0fdf4', border: '1px solid #86efac' }}>
          <ArrowUpCircle className="w-8 h-8 flex-shrink-0" style={{ color: '#0B7439' }} />
          <div>
            <p className="text-xs font-medium" style={{ color: '#166534' }}>Total entrées (filtré)</p>
            <p className="text-xl font-bold" style={{ color: '#0B7439' }}>{totalEntrees}</p>
          </div>
        </div>
        <div className="rounded-xl p-4 flex items-center gap-3" style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA' }}>
          <ArrowDownCircle className="w-8 h-8 flex-shrink-0" style={{ color: '#DC2626' }} />
          <div>
            <p className="text-xs font-medium" style={{ color: '#7F1D1D' }}>Total sorties (filtré)</p>
            <p className="text-xl font-bold" style={{ color: '#DC2626' }}>{totalSorties}</p>
          </div>
        </div>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="rounded-xl p-5 space-y-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Nouveau mouvement de stock</h2>
            <button onClick={() => setShowForm(false)} className="p-1 rounded hover:bg-gray-100">
              <X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {companyIds.length > 1 && (
              <div className="sm:col-span-3">
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Société <span style={{ color: '#DC2626' }}>*</span></label>
                <select value={selectedCompanyId ?? ''} onChange={e => setSelectedCompanyId(e.target.value)} className={inputCls} style={inputStyle}>
                  {companyInfos.map((c: CompanyInfo) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
                </select>
              </div>
            )}
            {/* Article — autocomplete */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Article <span style={{ color: '#DC2626' }}>*</span></label>
              <div className="relative" ref={formArticleRef}>
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  value={formArticleSearch}
                  onChange={e => { setFormArticleSearch(e.target.value); setFormArticleOpen(true) }}
                  onFocus={() => setFormArticleOpen(true)}
                  placeholder="Rechercher un article..."
                  className={inputCls + ' pl-9'}
                  style={inputStyle}
                />
                {form.stock_item_id && (
                  <button
                    type="button"
                    onClick={() => { setForm(f => ({ ...f, stock_item_id: '' })); setFormArticleSearch('') }}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                  >
                    <X className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                  </button>
                )}
                {formArticleOpen && (
                  <div className="absolute z-30 left-0 right-0 top-full mt-1 rounded-lg shadow-lg max-h-48 overflow-y-auto" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
                    {items
                      .filter(i => {
                        const q = formArticleSearch.toLowerCase()
                        return !q || i.designation.toLowerCase().includes(q) || i.code_article?.toLowerCase().includes(q)
                      })
                      .map(i => (
                        <button
                          key={i.id}
                          type="button"
                          onClick={() => {
                            setForm(f => ({ ...f, stock_item_id: i.id }))
                            setFormArticleSearch(i.designation + (i.code_article ? ` (${i.code_article})` : ''))
                            setFormArticleOpen(false)
                          }}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 transition-colors flex items-center justify-between"
                          style={{ color: form.stock_item_id === i.id ? '#0B7439' : 'var(--text-primary)' }}
                        >
                          <span className="font-medium">{i.designation}</span>
                          {i.code_article && <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>{i.code_article}</span>}
                        </button>
                      ))}
                    {items.filter(i => {
                      const q = formArticleSearch.toLowerCase()
                      return !q || i.designation.toLowerCase().includes(q) || i.code_article?.toLowerCase().includes(q)
                    }).length === 0 && (
                      <p className="px-3 py-3 text-xs text-center" style={{ color: 'var(--text-muted)' }}>Aucun article trouv&eacute;</p>
                    )}
                  </div>
                )}
              </div>
            </div>
            {/* Type */}
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Type</label>
              <div className="flex gap-2 h-[38px]">
                {(['entree', 'sortie'] as const).map(t => (
                  <button key={t} type="button" onClick={() => setForm(f => ({ ...f, movement_type: t }))} className="flex-1 rounded-lg text-sm font-semibold transition-all"
                    style={{
                      backgroundColor: form.movement_type === t ? (t === 'entree' ? '#0B7439' : '#DC2626') : 'var(--bg-subtle)',
                      color: form.movement_type === t ? '#fff' : 'var(--text-secondary)',
                      border: `1px solid ${form.movement_type === t ? (t === 'entree' ? '#0B7439' : '#DC2626') : 'var(--border)'}`,
                    }}>
                    {t === 'entree' ? 'Entrée' : 'Sortie'}
                  </button>
                ))}
              </div>
            </div>
            {/* Quantité */}
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Quantité <span style={{ color: '#DC2626' }}>*</span></label>
              <input type="number" min="1" value={form.quantity} onChange={setF('quantity')} placeholder="0" className={inputCls} style={inputStyle} />
            </div>
            {/* Date */}
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Date</label>
              <input type="date" value={form.movement_date} onChange={setF('movement_date')} className={inputCls} style={inputStyle} />
            </div>

            {/* Notes */}
            <div className="sm:col-span-3">
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Notes (optionnel)</label>
              <input value={form.notes} onChange={setF('notes')} placeholder="Observations…" className={inputCls} style={inputStyle} />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: '#0B7439', color: '#fff' }}>
              <Save className="w-4 h-4" />
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2.5 rounded-xl text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Annuler</button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="flex gap-1 rounded-lg p-1" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          {(['all', 'entree', 'sortie'] as const).map(t => (
            <button key={t} onClick={() => setFilterType(t)} className="px-3 py-1.5 rounded text-xs font-semibold transition-all"
              style={{
                backgroundColor: filterType === t ? (t === 'all' ? '#0B7439' : t === 'entree' ? '#0B7439' : '#DC2626') : 'transparent',
                color: filterType === t ? '#fff' : 'var(--text-secondary)',
              }}>
              {t === 'all' ? 'Tous' : t === 'entree' ? 'Entrées' : 'Sorties'}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[220px]" ref={filterArticleRef}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            value={filterArticleSearch}
            onChange={e => { setFilterArticleSearch(e.target.value); setFilterArticleOpen(true) }}
            onFocus={() => setFilterArticleOpen(true)}
            placeholder="Filtrer par article..."
            className="w-full pl-9 pr-8 py-1.5 rounded-lg text-xs outline-none"
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          />
          {filterItem && (
            <button
              onClick={() => { setFilterItem(''); setFilterArticleSearch('') }}
              className="absolute right-3 top-1/2 -translate-y-1/2"
            >
              <X className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
            </button>
          )}
          {filterArticleOpen && (
            <div className="absolute z-30 left-0 right-0 top-full mt-1 rounded-lg shadow-lg max-h-48 overflow-y-auto" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
              <button
                onClick={() => { setFilterItem(''); setFilterArticleSearch(''); setFilterArticleOpen(false) }}
                className="w-full px-3 py-2 text-left text-xs hover:bg-gray-100 font-medium transition-colors"
                style={{ color: !filterItem ? '#0B7439' : 'var(--text-secondary)' }}
              >
                Tous les articles
              </button>
              {items
                .filter(i => {
                  const q = filterArticleSearch.toLowerCase()
                  return !q || i.designation.toLowerCase().includes(q) || i.code_article?.toLowerCase().includes(q)
                })
                .map(i => (
                  <button
                    key={i.id}
                    onClick={() => {
                      setFilterItem(i.id)
                      setFilterArticleSearch(i.designation)
                      setFilterArticleOpen(false)
                    }}
                    className="w-full px-3 py-2 text-left text-xs hover:bg-gray-100 transition-colors flex items-center justify-between"
                    style={{ color: filterItem === i.id ? '#0B7439' : 'var(--text-primary)' }}
                  >
                    <span className="font-medium">{i.designation}</span>
                    {i.code_article && <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>{i.code_article}</span>}
                  </button>
                ))}
              {items.filter(i => {
                const q = filterArticleSearch.toLowerCase()
                return !q || i.designation.toLowerCase().includes(q) || i.code_article?.toLowerCase().includes(q)
              }).length === 0 && (
                <p className="px-3 py-3 text-xs text-center" style={{ color: 'var(--text-muted)' }}>Aucun article</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Movements table */}
      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[650px]">
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                {['Date', 'Immatriculation', 'Désignation', 'Code article', 'Entrée', 'Sortie', 'Notes', ''].map(h => (
                  <th key={h} className="px-3 py-3 text-left text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {loading ? (
                <tr><td colSpan={8} className="py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Chargement…</td></tr>
              ) : movements.length === 0 ? (
                <tr><td colSpan={8} className="py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Aucun mouvement trouvé</td></tr>
              ) : movements.map(m => (
                <tr key={m.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {format(new Date(m.movement_date), 'dd/MM/yy', { locale: fr })}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                    {m.registration_number ?? '—'}
                  </td>
                  <td className="px-3 py-2.5 text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                    {m.item?.designation ?? '—'}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                    {m.item?.code_article ?? '—'}
                  </td>
                  <td className="px-3 py-2.5 text-xs font-bold text-center" style={{ color: '#0B7439' }}>
                    {m.movement_type === 'entree' ? `+${m.quantity}` : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-xs font-bold text-center" style={{ color: '#DC2626' }}>
                    {m.movement_type === 'sortie' ? `−${m.quantity}` : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-xs max-w-[150px]">
                    <p className="truncate" style={{ color: 'var(--text-muted)' }}>{m.notes ?? '—'}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <button onClick={() => deleteMovement(m.id)} className="p-1.5 rounded hover:bg-red-50" title="Supprimer">
                      <X className="w-3.5 h-3.5" style={{ color: '#DC2626' }} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  )
}
