import { useState, useEffect, useCallback } from 'react'
import {
  fetchDepenses, fetchDepenseCategories, createDepense, deleteDepense,
  formatCFA, type AbgDepense, type AbgDepenseCategory,
} from '@/services/abg.service'
import {
  Receipt, Plus, Trash2, X, Filter, Wallet,
} from 'lucide-react'
import toast from 'react-hot-toast'

type TypeFilter = 'all' | 'AO' | 'HAO'

const SOURCE_OPTIONS = [
  'GARE SBTA', 'BUREAU', 'MECANO', 'MOTO', '4x4',
]

const inputCls = 'w-full border border-[#E2EAE5] rounded-lg px-3 py-2 text-sm text-[#374151] focus:outline-none focus:border-[#0B7439] transition-colors'

export default function Depenses() {
  const [depenses, setDepenses] = useState<AbgDepense[]>([])
  const [categories, setCategories] = useState<AbgDepenseCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showFilters, setShowFilters] = useState(false)

  const [filters, setFilters] = useState({
    type: 'all' as TypeFilter,
    categorie: '',
    source: '',
    dateFrom: '',
    dateTo: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [deps, cats] = await Promise.all([
        fetchDepenses({
          type: filters.type === 'all' ? undefined : filters.type,
          categorie: filters.categorie || undefined,
          source: filters.source || undefined,
          dateFrom: filters.dateFrom || undefined,
          dateTo: filters.dateTo || undefined,
        }),
        fetchDepenseCategories(),
      ])
      setDepenses(deps)
      setCategories(cats)
    } catch {
      toast.error('Erreur lors du chargement')
    }
    setLoading(false)
  }, [filters])

  useEffect(() => { load() }, [load])

  const handleDelete = async (id: string) => {
    if (!confirm('Confirmer la suppression de cette dépense ?')) return
    try {
      await deleteDepense(id)
      toast.success('Dépense supprimée')
      load()
    } catch {
      toast.error('Erreur lors de la suppression')
    }
  }

  const subAO = depenses.filter(d => d.type_depense === 'AO').reduce((a, d) => a + Number(d.montant), 0)
  const subHAO = depenses.filter(d => d.type_depense === 'HAO').reduce((a, d) => a + Number(d.montant), 0)
  const total = subAO + subHAO

  const sourceOptions = [...new Set([...SOURCE_OPTIONS, ...depenses.map(d => d.source_libelle)])].sort()
  const categorieOptions = [...new Set(depenses.map(d => d.categorie).filter(Boolean))] as string[]

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1a2a22]">Dépenses AO / HAO</h1>
          <p className="text-sm mt-0.5 text-[#6B7280]">Registre des dépenses — gare d'Agboville ville</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowFilters(s => !s)}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-[#E2EAE5] rounded-xl text-sm font-medium text-[#4A6B55] hover:bg-[#F8FAF8] transition-colors">
            <Filter className="w-4 h-4" /> Filtrer
          </button>
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-[#0B7439] text-white rounded-xl text-sm font-medium hover:bg-[#085c2d] transition-colors">
            <Plus className="w-4 h-4" /> Nouvelle dépense
          </button>
        </div>
      </div>

      {/* Sub-totals */}
      <div className="grid grid-cols-3 gap-4">
        <SubTotalCard label="Sous-total AO" value={formatCFA(subAO)} color="text-blue-600" bg="bg-blue-50" border="border-blue-200" />
        <SubTotalCard label="Sous-total HAO" value={formatCFA(subHAO)} color="text-orange-600" bg="bg-orange-50" border="border-orange-200" />
        <SubTotalCard label="Total général" value={formatCFA(total)} color="text-[#0B7439]" bg="bg-[#0B7439]/5" border="border-[#0B7439]/20" />
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="bg-white rounded-2xl border border-[#E2EAE5] p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <label className="text-xs text-[#6B7280] mb-1 block">Type</label>
              <select value={filters.type} onChange={e => setFilters(p => ({ ...p, type: e.target.value as TypeFilter }))} className={inputCls}>
                <option value="all">Tous</option>
                <option value="AO">AO (Acquisition d'Ordinaire)</option>
                <option value="HAO">HAO (Hors Acquisition)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-[#6B7280] mb-1 block">Catégorie</label>
              <select value={filters.categorie} onChange={e => setFilters(p => ({ ...p, categorie: e.target.value }))} className={inputCls}>
                <option value="">Toutes</option>
                {categories.map(c => <option key={c.id} value={c.code}>{c.label} ({c.type_depense})</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-[#6B7280] mb-1 block">Source</label>
              <select value={filters.source} onChange={e => setFilters(p => ({ ...p, source: e.target.value }))} className={inputCls}>
                <option value="">Toutes</option>
                {sourceOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-[#6B7280] mb-1 block">Du</label>
              <input type="date" value={filters.dateFrom} onChange={e => setFilters(p => ({ ...p, dateFrom: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-[#6B7280] mb-1 block">Au</label>
              <input type="date" value={filters.dateTo} onChange={e => setFilters(p => ({ ...p, dateTo: e.target.value }))} className={inputCls} />
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={() => setFilters({ type: 'all', categorie: '', source: '', dateFrom: '', dateTo: '' })}
              className="text-xs text-[#6B7280] hover:text-[#0B7439] underline">Réinitialiser</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : depenses.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40">
            <Receipt className="w-10 h-10 text-gray-300 mb-2" />
            <p className="text-sm text-[#9CA3AF]">Aucune dépense enregistrée. Cliquez sur « Nouvelle dépense » pour commencer.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#F8FAF8]">
                <tr>
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Date</th>
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Source</th>
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Nature</th>
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Catégorie</th>
                  <th className="text-center px-4 py-3 text-[#4A6B55] font-semibold">Type</th>
                  <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Montant</th>
                  <th className="text-center px-4 py-3 text-[#4A6B55] font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {depenses.map(d => (
                  <tr key={d.id} className="border-t border-[#E2EAE5] hover:bg-[#F8FAF8] transition-colors">
                    <td className="px-4 py-3 text-[#374151] whitespace-nowrap">{new Date(d.date_depense).toLocaleDateString('fr-FR')}</td>
                    <td className="px-4 py-3 text-[#374151] font-medium">{d.source_libelle}</td>
                    <td className="px-4 py-3 text-[#374151]">{d.nature}</td>
                    <td className="px-4 py-3 text-[#6B7280]">{d.categorie ?? '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                        d.type_depense === 'AO' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'
                      }`}>
                        {d.type_depense}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-[#1a2a22]">{formatCFA(d.montant)}</td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => handleDelete(d.id)} className="text-red-400 hover:text-red-600 p-1">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-[#F8FAF8] border-t-2 border-[#E2EAE5]">
                <tr>
                  <td className="px-4 py-3 font-semibold text-[#4A6B55]" colSpan={5}>Total</td>
                  <td className="px-4 py-3 text-right font-bold text-[#0B7439]">{formatCFA(total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Form modal */}
      {showForm && (
        <DepenseForm
          categories={categories}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load() }}
        />
      )}
    </div>
  )
}

function SubTotalCard({ label, value, color, bg, border }: { label: string; value: string; color: string; bg: string; border: string }) {
  return (
    <div className={`rounded-xl border p-4 ${bg} ${border}`}>
      <div className="flex items-center gap-2 mb-1">
        <Wallet className={`w-4 h-4 ${color}`} />
        <p className="text-xs text-[#6B7280]">{label}</p>
      </div>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  )
}

function DepenseForm({ categories, onClose, onSaved }: {
  categories: AbgDepenseCategory[]
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    date_depense: new Date().toISOString().split('T')[0],
    source_libelle: 'GARE SBTA',
    nature: '',
    montant: '',
    type_depense: 'AO' as 'AO' | 'HAO',
    categorie: '',
    societe_code: '',
    car_matricule: '',
    gare_label: 'Agboville',
    description: '',
  })
  const [saving, setSaving] = useState(false)

  const aoCats = categories.filter(c => c.type_depense === 'AO')
  const haoCats = categories.filter(c => c.type_depense === 'HAO')
  const availableCats = form.type_depense === 'AO' ? aoCats : haoCats

  const onCategorieChange = (code: string) => {
    setForm(p => ({ ...p, categorie: code }))
    const cat = categories.find(c => c.code === code)
    if (cat) {
      setForm(p => ({ ...p, type_depense: cat.type_depense, nature: p.nature || cat.label }))
    }
  }

  const save = async () => {
    if (!form.date_depense || !form.source_libelle || !form.nature.trim() || !form.montant) {
      toast.error('Date, source, nature et montant sont obligatoires')
      return
    }
    const montant = parseFloat(form.montant)
    if (isNaN(montant) || montant <= 0) {
      toast.error('Le montant doit être un nombre positif')
      return
    }
    setSaving(true)
    try {
      await createDepense({
        date_depense: form.date_depense,
        source_libelle: form.source_libelle,
        nature: form.nature.trim(),
        montant,
        type_depense: form.type_depense,
        categorie: form.categorie || null,
        societe_code: form.societe_code || null,
        car_matricule: form.car_matricule || null,
        gare_label: form.gare_label || null,
        description: form.description || null,
      })
      toast.success('Dépense enregistrée')
      onSaved()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Erreur lors de l\'enregistrement')
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-[#E2EAE5] px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-lg font-bold text-[#1a2a22]">Nouvelle dépense</h2>
          <button onClick={onClose} className="p-2 hover:bg-[#F8FAF8] rounded-lg"><X className="w-5 h-5 text-[#6B7280]" /></button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Type selector */}
          <div className="flex gap-2">
            {(['AO', 'HAO'] as const).map(t => (
              <button key={t} onClick={() => setForm(p => ({ ...p, type_depense: t, categorie: '' }))}
                className={`flex-1 px-4 py-3 rounded-xl text-sm font-semibold border-2 transition-colors ${
                  form.type_depense === t
                    ? (t === 'AO' ? 'bg-blue-50 border-blue-400 text-blue-700' : 'bg-orange-50 border-orange-400 text-orange-700')
                    : 'bg-white border-[#E2EAE5] text-[#6B7280] hover:bg-[#F8FAF8]'
                }`}>
                {t === 'AO' ? 'AO — Activités Ordinaires' : 'HAO — Hors Activités Ordinaires'}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[#6B7280] mb-1 block">Date *</label>
              <input type="date" value={form.date_depense} onChange={e => setForm(p => ({ ...p, date_depense: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-[#6B7280] mb-1 block">Source / Libellé *</label>
              <input list="source-list" value={form.source_libelle} onChange={e => setForm(p => ({ ...p, source_libelle: e.target.value }))}
                placeholder="GARE SBTA, BUREAU, MECANO, MOTO, 4x4, ou matricule" className={inputCls} />
              <datalist id="source-list">
                {SOURCE_OPTIONS.map(s => <option key={s} value={s} />)}
              </datalist>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[#6B7280] mb-1 block">Catégorie</label>
              <select value={form.categorie} onChange={e => onCategorieChange(e.target.value)} className={inputCls}>
                <option value="">— Aucune —</option>
                {availableCats.map(c => <option key={c.id} value={c.code}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-[#6B7280] mb-1 block">Nature *</label>
              <input value={form.nature} onChange={e => setForm(p => ({ ...p, nature: e.target.value }))}
                placeholder="ex: carburant, essence, maçonnerie..." className={inputCls} />
            </div>
          </div>

          <div>
            <label className="text-xs text-[#6B7280] mb-1 block">Montant (FCFA) *</label>
            <input type="number" value={form.montant} onChange={e => setForm(p => ({ ...p, montant: e.target.value }))}
              placeholder="0" className={`${inputCls} text-lg font-semibold`} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-[#6B7280] mb-1 block">Société (optionnel)</label>
              <input value={form.societe_code} onChange={e => setForm(p => ({ ...p, societe_code: e.target.value }))}
                placeholder="ex: SBTA" className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-[#6B7280] mb-1 block">Matricule car (optionnel)</label>
              <input value={form.car_matricule} onChange={e => setForm(p => ({ ...p, car_matricule: e.target.value }))}
                placeholder="ex: 1234 AB 01" className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-[#6B7280] mb-1 block">Gare (optionnel)</label>
              <input value={form.gare_label} onChange={e => setForm(p => ({ ...p, gare_label: e.target.value }))}
                placeholder="ex: Agboville" className={inputCls} />
            </div>
          </div>

          <div>
            <label className="text-xs text-[#6B7280] mb-1 block">Description (optionnel)</label>
            <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              rows={2} placeholder="Détails complémentaires..." className={inputCls} />
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-[#E2EAE5] px-6 py-3 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border border-[#E2EAE5] text-[#6B7280] rounded-xl text-sm font-medium hover:bg-[#F8FAF8]">Annuler</button>
          <button onClick={save} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#0B7439] text-white rounded-xl text-sm font-medium hover:bg-[#085c2d] disabled:opacity-50">
            {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Plus className="w-4 h-4" />}
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  )
}
