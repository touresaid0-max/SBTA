import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, AlertTriangle, Package, CreditCard as Edit2, X, Save, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/store/authStore'

const fmt = (n: number) => new Intl.NumberFormat('fr-FR').format(n)

interface StockItem {
  id: string
  designation: string
  code_article: string | null
  stock_min: number
  stock_initial: number
  prix_unitaire: number
  entrees: number
  sorties: number
  stock_final: number
}

interface ItemForm {
  designation: string
  code_article: string
  stock_min: string
  stock_initial: string
  prix_unitaire: string
}

const EMPTY_FORM: ItemForm = { designation: '', code_article: '', stock_min: '', stock_initial: '0', prix_unitaire: '' }

export default function ComptableStock() {
  const { user }  = useAuthStore()
  const companyId = user?.company_id ?? null

  const [items,     setItems]     = useState<StockItem[]>([])
  const [loading,   setLoading]   = useState(true)
  const [showForm,  setShowForm]  = useState(false)
  const [editId,    setEditId]    = useState<string | null>(null)
  const [form,      setForm]      = useState<ItemForm>(EMPTY_FORM)
  const [saving,    setSaving]    = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen,  setSearchOpen]  = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    try {
      const [{ data: rawItems }, { data: movements }] = await Promise.all([
        supabase.from('comptable_stock_items').select('id, designation, code_article, stock_min, stock_initial, prix_unitaire').eq('company_id', companyId).order('designation'),
        supabase.from('comptable_stock_movements').select('stock_item_id, movement_type, quantity').eq('company_id', companyId),
      ])

      const mvByItem: Record<string, { entrees: number; sorties: number }> = {}
      for (const m of movements ?? []) {
        if (!mvByItem[m.stock_item_id]) mvByItem[m.stock_item_id] = { entrees: 0, sorties: 0 }
        if (m.movement_type === 'entree') mvByItem[m.stock_item_id].entrees += Number(m.quantity)
        else mvByItem[m.stock_item_id].sorties += Number(m.quantity)
      }

      const enriched: StockItem[] = (rawItems ?? []).map((item: { id: string; designation: string; code_article: string; stock_min: number; stock_initial: number; prix_unitaire: number }) => {
        const mv = mvByItem[item.id] ?? { entrees: 0, sorties: 0 }
        return {
          ...item,
          entrees: mv.entrees,
          sorties: mv.sorties,
          stock_final: Number(item.stock_initial) + mv.entrees - mv.sorties,
        }
      })

      setItems(enriched)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filteredItems = searchQuery.trim()
    ? items.filter(i => {
        const q = searchQuery.toLowerCase()
        return i.designation.toLowerCase().includes(q) || (i.code_article ?? '').toLowerCase().includes(q)
      })
    : items

  const suggestions = searchQuery.trim()
    ? items.filter(i => {
        const q = searchQuery.toLowerCase()
        return i.designation.toLowerCase().includes(q) || (i.code_article ?? '').toLowerCase().includes(q)
      }).slice(0, 8)
    : []

  const setF = (field: keyof ItemForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }))

  const openAdd = () => { setEditId(null); setForm(EMPTY_FORM); setShowForm(true) }
  const openEdit = (item: StockItem) => {
    setEditId(item.id)
    setForm({ designation: item.designation, code_article: item.code_article ?? '', stock_min: String(item.stock_min), stock_initial: String(item.stock_initial), prix_unitaire: String(item.prix_unitaire) })
    setShowForm(true)
  }
  const closeForm = () => { setShowForm(false); setEditId(null); setForm(EMPTY_FORM) }

  const save = async () => {
    if (!form.designation.trim()) { toast.error('La désignation est obligatoire'); return }
    if (!companyId) return
    setSaving(true)
    try {
      const payload = {
        company_id:    companyId,
        designation:   form.designation.trim(),
        code_article:  form.code_article.trim() || null,
        stock_min:     Number(form.stock_min) || 0,
        stock_initial: Number(form.stock_initial) || 0,
        prix_unitaire: Number(form.prix_unitaire) || 0,
        updated_at:    new Date().toISOString(),
      }
      if (editId) {
        const { error } = await supabase.from('comptable_stock_items').update(payload).eq('id', editId)
        if (error) throw error
        toast.success('Article mis à jour')
      } else {
        const { error } = await supabase.from('comptable_stock_items').insert({ ...payload, created_by: user?.id ?? null })
        if (error) throw error
        toast.success('Article ajouté')
      }
      closeForm()
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setSaving(false)
    }
  }

  const deleteItem = async (id: string) => {
    if (!confirm('Supprimer cet article ? Les mouvements associés seront aussi supprimés.')) return
    const { error } = await supabase.from('comptable_stock_items').delete().eq('id', id)
    if (error) { toast.error('Erreur lors de la suppression'); return }
    toast.success('Article supprimé')
    load()
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500'
  const inputStyle = { backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }

  const alertCount = items.filter(i => i.stock_final < i.stock_min).length

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-7xl mx-auto">

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Gestion des stocks</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Articles, niveaux et alertes de stock</p>
        </div>
        <div className="flex items-center gap-2">
          {alertCount > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ backgroundColor: '#fee2e2', color: '#DC2626' }}>
              <AlertTriangle className="w-3.5 h-3.5" />
              {alertCount} alerte{alertCount > 1 ? 's' : ''}
            </div>
          )}
          <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold" style={{ backgroundColor: '#0B7439', color: '#fff' }}>
            <Plus className="w-4 h-4" /> Nouvel article
          </button>
        </div>
      </div>

      {/* Search */}
      <div ref={searchRef} className="relative">
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <Search className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
          <input
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setSearchOpen(true) }}
            onFocus={() => { if (searchQuery.trim()) setSearchOpen(true) }}
            placeholder="Rechercher par désignation ou code article…"
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: 'var(--text-primary)' }}
          />
          {searchQuery && (
            <button onClick={() => { setSearchQuery(''); setSearchOpen(false) }} className="p-0.5 rounded hover:bg-gray-100">
              <X className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
            </button>
          )}
        </div>
        {searchOpen && suggestions.length > 0 && (
          <div className="absolute z-20 left-0 right-0 mt-1 rounded-xl shadow-lg overflow-hidden max-h-64 overflow-y-auto" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            {suggestions.map(s => (
              <button
                key={s.id}
                onClick={() => { setSearchQuery(s.designation); setSearchOpen(false) }}
                className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center justify-between gap-2 transition-colors"
              >
                <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{s.designation}</span>
                {s.code_article && <span className="text-xs font-mono flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{s.code_article}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit form */}
      {showForm && (
        <div className="rounded-xl p-5 space-y-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{editId ? 'Modifier l\'article' : 'Nouvel article de stock'}</h2>
            <button onClick={closeForm} className="p-1 rounded hover:bg-gray-100">
              <X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Désignation <span style={{ color: '#DC2626' }}>*</span></label>
              <input value={form.designation} onChange={setF('designation')} placeholder="ex: Huile moteur 5W40…" className={inputCls} style={inputStyle} autoFocus />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Code article</label>
              <input value={form.code_article} onChange={setF('code_article')} placeholder="ex: ART-001" className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Stock minimum</label>
              <input type="number" min="0" value={form.stock_min} onChange={setF('stock_min')} placeholder="0" className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Stock initial</label>
              <input type="number" min="0" value={form.stock_initial} onChange={setF('stock_initial')} placeholder="0" className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>P.U. (XOF)</label>
              <input type="number" min="0" step="100" value={form.prix_unitaire} onChange={setF('prix_unitaire')} placeholder="0" className={inputCls} style={inputStyle} />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: '#0B7439', color: '#fff' }}>
              <Save className="w-4 h-4" />
              {saving ? 'Enregistrement…' : editId ? 'Mettre à jour' : 'Enregistrer'}
            </button>
            <button onClick={closeForm} className="px-4 py-2.5 rounded-xl text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Annuler</button>
          </div>
        </div>
      )}

      {/* Stock table */}
      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                {['Désignation', 'Code article', 'Stock min', 'Stock initial', 'Entrée', 'Sortie', 'Alerte', 'Stock final', 'P.U.', 'Montant', ''].map(h => (
                  <th key={h} className="px-3 py-3 text-left text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {loading ? (
                <tr><td colSpan={11} className="py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Chargement…</td></tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center">
                    <Package className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{searchQuery ? 'Aucun article ne correspond à la recherche.' : 'Aucun article. Cliquez sur "Nouvel article" pour commencer.'}</p>
                  </td>
                </tr>
              ) : filteredItems.map(item => {
                const isAlert = item.stock_final < item.stock_min
                const montant = item.stock_final * item.prix_unitaire
                return (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors" style={isAlert ? { backgroundColor: '#FFF7F7' } : {}}>
                    <td className="px-3 py-2.5 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      <div className="flex items-center gap-2">
                        {isAlert && <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#DC2626' }} />}
                        {item.designation}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{item.code_article || '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-center font-semibold" style={{ color: 'var(--text-secondary)' }}>{item.stock_min}</td>
                    <td className="px-3 py-2.5 text-xs text-center" style={{ color: 'var(--text-secondary)' }}>{item.stock_initial}</td>
                    <td className="px-3 py-2.5 text-xs text-center font-semibold" style={{ color: '#0B7439' }}>{item.entrees > 0 ? `+${item.entrees}` : '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-center font-semibold" style={{ color: item.sorties > 0 ? '#DC2626' : 'var(--text-muted)' }}>{item.sorties > 0 ? `−${item.sorties}` : '—'}</td>
                    <td className="px-3 py-2.5 text-center">
                      {isAlert ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold" style={{ backgroundColor: '#fee2e2', color: '#DC2626' }}>
                          <AlertTriangle className="w-3 h-3" /> Bas
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded text-xs font-semibold" style={{ backgroundColor: '#d4edda', color: '#0B7439' }}>OK</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-center font-bold" style={{ color: isAlert ? '#DC2626' : 'var(--text-primary)', fontWeight: 700 }}>{item.stock_final}</td>
                    <td className="px-3 py-2.5 text-xs text-right" style={{ color: 'var(--text-secondary)' }}>
                      {item.prix_unitaire > 0 ? fmt(item.prix_unitaire) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-right font-bold" style={{ color: 'var(--text-primary)' }}>
                      {item.prix_unitaire > 0 ? fmt(montant) : '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(item)} className="p-1.5 rounded hover:bg-gray-100" title="Modifier">
                          <Edit2 className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                        </button>
                        <button onClick={() => deleteItem(item.id)} className="p-1.5 rounded hover:bg-red-50" title="Supprimer">
                          <X className="w-3.5 h-3.5" style={{ color: '#DC2626' }} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {filteredItems.length > 0 && (
              <tfoot>
                <tr style={{ backgroundColor: '#0B7439' }}>
                  <td colSpan={9} className="px-3 py-2.5 text-right text-xs font-bold text-white">VALEUR TOTALE DU STOCK</td>
                  <td className="px-3 py-2.5 text-right text-sm font-bold text-white">
                    {fmt(filteredItems.reduce((a, i) => a + (i.prix_unitaire > 0 ? i.stock_final * i.prix_unitaire : 0), 0))} XOF
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

    </div>
  )
}
