import { useState, useEffect, useCallback } from 'react'
import {
  fetchDepenseCategories, createDepenseCategory, updateDepenseCategory, deleteDepenseCategory,
  type AbgDepenseCategory,
} from '@/services/abg.service'
import { Settings, Plus, Pencil, Trash2, X, Check, Eye, EyeOff } from 'lucide-react'
import toast from 'react-hot-toast'

const inputCls = 'w-full border border-[#E2EAE5] rounded-lg px-3 py-2 text-sm text-[#374151] focus:outline-none focus:border-[#0B7439] transition-colors'

export default function Parametrage() {
  const [categories, setCategories] = useState<AbgDepenseCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'AO' | 'HAO'>('AO')
  const [editing, setEditing] = useState<AbgDepenseCategory | null>(null)
  const [showForm, setShowForm] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const cats = await fetchDepenseCategories()
      setCategories(cats)
    } catch {
      toast.error('Erreur lors du chargement des catégories')
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const aoCats = categories.filter(c => c.type_depense === 'AO').sort((a, b) => a.sort_order - b.sort_order)
  const haoCats = categories.filter(c => c.type_depense === 'HAO').sort((a, b) => a.sort_order - b.sort_order)
  const currentCats = tab === 'AO' ? aoCats : haoCats

  const handleDelete = async (cat: AbgDepenseCategory) => {
    if (!confirm(`Supprimer la catégorie « ${cat.label} » ?`)) return
    try {
      await deleteDepenseCategory(cat.id)
      toast.success('Catégorie supprimée')
      load()
    } catch {
      toast.error('Erreur lors de la suppression')
    }
  }

  const toggleActive = async (cat: AbgDepenseCategory) => {
    try {
      await updateDepenseCategory(cat.id, { is_active: !cat.is_active })
      load()
    } catch {
      toast.error('Erreur lors de la modification')
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-[1200px] mx-auto">
      <div>
        <div className="flex items-center gap-2">
          <Settings className="w-6 h-6 text-[#0B7439]" />
          <h1 className="text-2xl font-bold text-[#1a2a22]">Paramétrage</h1>
        </div>
        <p className="text-sm mt-1 text-[#6B7280]">Gestion des catégories de dépenses AO et HAO</p>
      </div>

      {/* Tab selector */}
      <div className="flex gap-2">
        {(['AO', 'HAO'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 px-4 py-3 rounded-xl text-sm font-semibold border-2 transition-colors ${
              tab === t
                ? (t === 'AO' ? 'bg-blue-50 border-blue-400 text-blue-700' : 'bg-orange-50 border-orange-400 text-orange-700')
                : 'bg-white border-[#E2EAE5] text-[#6B7280] hover:bg-[#F8FAF8]'
            }`}>
            {t === 'AO' ? 'Catégories AO — Activités Ordinaires' : 'Catégories HAO — Hors Activités Ordinaires'}
            <span className="ml-2 text-xs opacity-70">({(t === 'AO' ? aoCats : haoCats).length})</span>
          </button>
        ))}
      </div>

      {/* Add button */}
      <div className="flex justify-end">
        <button onClick={() => { setEditing(null); setShowForm(true) }}
          className="flex items-center gap-1.5 px-4 py-2 bg-[#0B7439] text-white rounded-xl text-sm font-medium hover:bg-[#085c2d] transition-colors">
          <Plus className="w-4 h-4" /> Ajouter une catégorie
        </button>
      </div>

      {/* List */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : currentCats.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40">
            <Settings className="w-10 h-10 text-gray-300 mb-2" />
            <p className="text-sm text-[#9CA3AF]">Aucune catégorie {tab}. Cliquez sur « Ajouter une catégorie » pour commencer.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#F8FAF8]">
                <tr>
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Code</th>
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Libellé</th>
                  <th className="text-center px-4 py-3 text-[#4A6B55] font-semibold">Ordre</th>
                  <th className="text-center px-4 py-3 text-[#4A6B55] font-semibold">Statut</th>
                  <th className="text-center px-4 py-3 text-[#4A6B55] font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {currentCats.map(cat => (
                  <tr key={cat.id} className="border-t border-[#E2EAE5] hover:bg-[#F8FAF8] transition-colors">
                    <td className="px-4 py-3 text-[#6B7280] font-mono text-xs">{cat.code}</td>
                    <td className="px-4 py-3 text-[#374151] font-medium">{cat.label}</td>
                    <td className="px-4 py-3 text-center text-[#6B7280]">{cat.sort_order}</td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => toggleActive(cat)}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                          cat.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                        }`}>
                        {cat.is_active ? <><Eye className="w-3 h-3" /> Actif</> : <><EyeOff className="w-3 h-3" /> Inactif</>}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => { setEditing(cat); setShowForm(true) }}
                          className="p-1.5 text-[#6B7280] hover:text-[#0B7439] hover:bg-[#0B7439]/5 rounded-lg transition-colors">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(cat)}
                          className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <CategoryForm
          typeDepense={tab}
          category={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load() }}
        />
      )}
    </div>
  )
}

function CategoryForm({
  typeDepense, category, onClose, onSaved,
}: {
  typeDepense: 'AO' | 'HAO'
  category: AbgDepenseCategory | null
  onClose: () => void
  onSaved: () => void
}) {
  const [label, setLabel] = useState(category?.label ?? '')
  const [sortOrder, setSortOrder] = useState(category?.sort_order ?? 999)
  const [isActive, setIsActive] = useState(category?.is_active ?? true)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!label.trim()) {
      toast.error('Veuillez saisir un libellé')
      return
    }
    setSaving(true)
    try {
      if (category) {
        await updateDepenseCategory(category.id, {
          label: label.trim(),
          sort_order: sortOrder,
          is_active: isActive,
        })
        toast.success('Catégorie modifiée')
      } else {
        const code = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
        await createDepenseCategory({ code, label: label.trim(), type_depense: typeDepense })
        toast.success('Catégorie créée')
      }
      onSaved()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Erreur lors de l\'enregistrement')
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-xl p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-[#1a2a22]">
            {category ? 'Modifier la catégorie' : 'Nouvelle catégorie'} <span className={typeDepense === 'AO' ? 'text-blue-600' : 'text-orange-600'}>{typeDepense}</span>
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-[#F8FAF8] rounded-lg"><X className="w-5 h-5 text-[#6B7280]" /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-[#6B7280] mb-1 block">Libellé *</label>
            <input value={label} onChange={e => setLabel(e.target.value)} autoFocus
              placeholder="ex: Carburant, Maçonnerie, Entretien..." className={inputCls} />
            {!category && (
              <p className="text-xs text-[#9CA3AF] mt-1">Le code sera généré automatiquement à partir du libellé.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[#6B7280] mb-1 block">Ordre d'affichage</label>
              <input type="number" value={sortOrder} onChange={e => setSortOrder(parseInt(e.target.value) || 999)}
                className={inputCls} />
            </div>
            {category && (
              <div>
                <label className="text-xs text-[#6B7280] mb-1 block">Statut</label>
                <button type="button" onClick={() => setIsActive(a => !a)}
                  className={`w-full px-3 py-2 rounded-lg text-sm font-semibold border-2 transition-colors ${
                    isActive ? 'border-green-400 bg-green-50 text-green-700' : 'border-gray-300 bg-gray-50 text-gray-500'
                  }`}>
                  {isActive ? 'Actif' : 'Inactif'}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 border border-[#E2EAE5] text-[#6B7280] rounded-xl text-sm font-medium hover:bg-[#F8FAF8]">Annuler</button>
          <button onClick={save} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#0B7439] text-white rounded-xl text-sm font-medium hover:bg-[#085c2d] disabled:opacity-50">
            {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Check className="w-4 h-4" />}
            {category ? 'Modifier' : 'Créer'}
          </button>
        </div>
      </div>
    </div>
  )
}
