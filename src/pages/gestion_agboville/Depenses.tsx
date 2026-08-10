import { useState, useEffect, useCallback, useRef } from 'react'
import {
  fetchDepenses, fetchDepenseCategories, createDepense, deleteDepense,
  createDepenseCategory, fetchBusesForAbg, fetchSocietes,
  formatCFA, type AbgDepense, type AbgDepenseCategory,
} from '@/services/abg.service'
import {
  Receipt, Plus, Trash2, X, Filter, Wallet, Printer, FileSpreadsheet, ChevronDown, Check,
} from 'lucide-react'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'
import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'

type TypeFilter = 'all' | 'AO' | 'HAO'
type PeriodPreset = 'journalier' | 'hebdomadaire' | 'mensuel' | 'annuel' | 'custom'

const GARE_DEFAULT = 'Agboville'

const inputCls = 'w-full border border-[#E2EAE5] rounded-lg px-3 py-2 text-sm text-[#374151] focus:outline-none focus:border-[#0B7439] transition-colors'

function todayISO() {
  return new Date().toISOString().split('T')[0]
}

function dateRangeForPreset(preset: PeriodPreset): { from: string; to: string } {
  const now = new Date()
  const to = now.toISOString().split('T')[0]
  if (preset === 'journalier') {
    return { from: to, to }
  }
  if (preset === 'hebdomadaire') {
    const from = new Date(now)
    from.setDate(now.getDate() - 6)
    return { from: from.toISOString().split('T')[0], to }
  }
  if (preset === 'mensuel') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1)
    return { from: from.toISOString().split('T')[0], to }
  }
  if (preset === 'annuel') {
    const from = new Date(now.getFullYear(), 0, 1)
    return { from: from.toISOString().split('T')[0], to }
  }
  return { from: '', to }
}

const PERIOD_LABELS: Record<PeriodPreset, string> = {
  journalier: 'Journalier',
  hebdomadaire: 'Hebdomadaire',
  mensuel: 'Mensuel',
  annuel: 'Annuel',
  custom: 'Période personnalisée',
}

interface DepenseRowDraft {
  id: string
  date_depense: string
  categorie: string
  nature: string
  montant: string
  car_matricule: string
  societe_code: string
  gare_label: string
}

function emptyDraft(): DepenseRowDraft {
  return {
    id: crypto.randomUUID(),
    date_depense: todayISO(),
    categorie: '',
    nature: '',
    montant: '',
    car_matricule: '',
    societe_code: '',
    gare_label: GARE_DEFAULT,
  }
}

export default function Depenses() {
  const [depenses, setDepenses] = useState<AbgDepense[]>([])
  const [categories, setCategories] = useState<AbgDepenseCategory[]>([])
  const [buses, setBuses] = useState<{ id: string; registration_number: string }[]>([])
  const [societes, setSocietes] = useState<{ code: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showFilters, setShowFilters] = useState(true)

  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('mensuel')
  const [filters, setFilters] = useState({
    type: 'all' as TypeFilter,
    societe: '',
    dateFrom: dateRangeForPreset('mensuel').from,
    dateTo: dateRangeForPreset('mensuel').to,
  })

  const reportRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [deps, cats, busList, socList] = await Promise.all([
        fetchDepenses({
          type: filters.type === 'all' ? undefined : filters.type,
          dateFrom: filters.dateFrom || undefined,
          dateTo: filters.dateTo || undefined,
        }),
        fetchDepenseCategories(),
        fetchBusesForAbg(),
        fetchSocietes(),
      ])
      setDepenses(deps)
      setCategories(cats)
      setBuses(busList)
      setSocietes(socList)
    } catch {
      toast.error('Erreur lors du chargement')
    }
    setLoading(false)
  }, [filters])

  useEffect(() => { load() }, [load])

  const applyPreset = (preset: PeriodPreset) => {
    setPeriodPreset(preset)
    if (preset !== 'custom') {
      const r = dateRangeForPreset(preset)
      setFilters(p => ({ ...p, dateFrom: r.from, dateTo: r.to }))
    }
  }

  // Client-side filtering (source/societe may not be server-filtered)
  const filteredDepenses = depenses.filter(d => {
    if (filters.societe && d.societe_code !== filters.societe) return false
    return true
  })

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

  const subAO = filteredDepenses.filter(d => d.type_depense === 'AO').reduce((a, d) => a + Number(d.montant), 0)
  const subHAO = filteredDepenses.filter(d => d.type_depense === 'HAO').reduce((a, d) => a + Number(d.montant), 0)
  const total = subAO + subHAO

  const exportExcel = () => {
    const rows = filteredDepenses.map(d => ({
      Date: new Date(d.date_depense).toLocaleDateString('fr-FR'),
      Catégorie: d.categorie ?? '—',
      Libellé: d.nature,
      Montant: Number(d.montant),
      'Car / Société': d.car_matricule || d.societe_code || '—',
      Gare: d.gare_label ?? '—',
      Type: d.type_depense,
    }))
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(rows)
    XLSX.utils.sheet_add_aoa(ws, [
      [],
      ['Sous-total AO', subAO],
      ['Sous-total HAO', subHAO],
      ['Total général', total],
    ], { origin: -1 })
    XLSX.utils.book_append_sheet(wb, ws, 'Dépenses')
    const periodLabel = PERIOD_LABELS[periodPreset]
    XLSX.writeFile(wb, `depenses_agboville_${periodLabel.toLowerCase()}.xlsx`)
  }

  const exportPdf = async () => {
    if (!reportRef.current) return
    const canvas = await html2canvas(reportRef.current, { scale: 1.5, useCORS: true, backgroundColor: '#ffffff' })
    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const w = pdf.internal.pageSize.getWidth()
    const h = (canvas.height * w) / canvas.width
    const pageH = pdf.internal.pageSize.getHeight()
    let y = 0
    while (y < h) {
      if (y > 0) pdf.addPage()
      pdf.addImage(imgData, 'PNG', 0, -y, w, h)
      y += pageH
    }
    pdf.save(`depenses_agboville_${PERIOD_LABELS[periodPreset].toLowerCase()}.pdf`)
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1a2a22]">Dépenses AO / HAO</h1>
          <p className="text-sm mt-0.5 text-[#6B7280]">Registre des dépenses — gare d'Agboville ville</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportPdf}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-[#E2EAE5] rounded-xl text-sm font-medium text-[#4A6B55] hover:bg-[#F8FAF8] transition-colors">
            <Printer className="w-4 h-4" /> Imprimer / PDF
          </button>
          <button onClick={exportExcel}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-[#E2EAE5] rounded-xl text-sm font-medium text-[#4A6B55] hover:bg-[#F8FAF8] transition-colors">
            <FileSpreadsheet className="w-4 h-4" /> Export Excel
          </button>
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-[#0B7439] text-white rounded-xl text-sm font-medium hover:bg-[#085c2d] transition-colors">
            <Plus className="w-4 h-4" /> Nouvelle dépense
          </button>
        </div>
      </div>

      {/* Sub-totals */}
      <div className="grid grid-cols-3 gap-4">
        <SubTotalCard label="Sous-total AO — Activités Ordinaires" value={formatCFA(subAO)} color="text-blue-600" bg="bg-blue-50" border="border-blue-200" />
        <SubTotalCard label="Sous-total HAO — Hors Activités Ordinaires" value={formatCFA(subHAO)} color="text-orange-600" bg="bg-orange-50" border="border-orange-200" />
        <SubTotalCard label="Total général" value={formatCFA(total)} color="text-[#0B7439]" bg="bg-[#0B7439]/5" border="border-[#0B7439]/20" />
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="bg-white rounded-2xl border border-[#E2EAE5] p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(PERIOD_LABELS) as PeriodPreset[]).map(p => (
              <button key={p} onClick={() => applyPreset(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${periodPreset === p ? 'text-white' : ''}`}
                style={periodPreset === p ? { background: '#0B7439' } : { background: 'white', border: '1px solid #E2EAE5', color: '#6B7280' }}>
                {PERIOD_LABELS[p]}
              </button>
            ))}
            {periodPreset === 'custom' && (
              <>
                <input type="date" value={filters.dateFrom} onChange={e => setFilters(p => ({ ...p, dateFrom: e.target.value }))} className={`${inputCls} max-w-[160px]`} />
                <span className="text-xs text-[#6B7280]">au</span>
                <input type="date" value={filters.dateTo} onChange={e => setFilters(p => ({ ...p, dateTo: e.target.value }))} className={`${inputCls} max-w-[160px]`} />
              </>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-[#6B7280] mb-1 block">Type</label>
              <select value={filters.type} onChange={e => setFilters(p => ({ ...p, type: e.target.value as TypeFilter }))} className={inputCls}>
                <option value="all">Tous</option>
                <option value="AO">AO — Activités Ordinaires</option>
                <option value="HAO">HAO — Hors Activités Ordinaires</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-[#6B7280] mb-1 block">Société</label>
              <select value={filters.societe} onChange={e => setFilters(p => ({ ...p, societe: e.target.value }))} className={inputCls}>
                <option value="">Toutes</option>
                {societes.map(s => <option key={s.code} value={s.code}>{s.code} — {s.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={() => { setFilters({ type: 'all', societe: '', dateFrom: '', dateTo: '' }); setPeriodPreset('custom') }}
              className="text-xs text-[#6B7280] hover:text-[#0B7439] underline">Réinitialiser</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div ref={reportRef} className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredDepenses.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40">
            <Receipt className="w-10 h-10 text-gray-300 mb-2" />
            <p className="text-sm text-[#9CA3AF]">Aucune dépense sur la période sélectionnée. Cliquez sur « Nouvelle dépense » pour commencer.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#F8FAF8]">
                <tr>
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Date</th>
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Catégorie</th>
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Libellé</th>
                  <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Montant</th>
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Car / Société</th>
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Gare</th>
                  <th className="text-center px-4 py-3 text-[#4A6B55] font-semibold">Type</th>
                  <th className="text-center px-4 py-3 text-[#4A6B55] font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredDepenses.map(d => (
                  <tr key={d.id} className="border-t border-[#E2EAE5] hover:bg-[#F8FAF8] transition-colors">
                    <td className="px-4 py-3 text-[#374151] whitespace-nowrap">{new Date(d.date_depense).toLocaleDateString('fr-FR')}</td>
                    <td className="px-4 py-3 text-[#6B7280]">{d.categorie ?? '—'}</td>
                    <td className="px-4 py-3 text-[#374151] font-medium">{d.nature}</td>
                    <td className="px-4 py-3 text-right font-semibold text-[#1a2a22]">{formatCFA(d.montant)}</td>
                    <td className="px-4 py-3 text-[#374151]">{d.car_matricule || d.societe_code || '—'}</td>
                    <td className="px-4 py-3 text-[#6B7280]">{d.gare_label ?? '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                        d.type_depense === 'AO' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'
                      }`}>
                        {d.type_depense === 'AO' ? 'AO' : 'HAO'}
                      </span>
                    </td>
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
                  <td className="px-4 py-2 font-semibold text-blue-600" colSpan={3}>Sous-total AO</td>
                  <td className="px-4 py-2 text-right font-bold text-blue-600">{formatCFA(subAO)}</td>
                  <td colSpan={3} />
                </tr>
                <tr>
                  <td className="px-4 py-2 font-semibold text-orange-600" colSpan={3}>Sous-total HAO</td>
                  <td className="px-4 py-2 text-right font-bold text-orange-600">{formatCFA(subHAO)}</td>
                  <td colSpan={3} />
                </tr>
                <tr className="border-t border-[#E2EAE5]">
                  <td className="px-4 py-3 font-bold text-[#4A6B55]" colSpan={3}>Total général</td>
                  <td className="px-4 py-3 text-right font-bold text-[#0B7439] text-base">{formatCFA(total)}</td>
                  <td colSpan={3} />
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
          buses={buses}
          societes={societes}
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

/* ── Autocomplete combobox with "+" create button ── */
function Combobox({
  options,
  value,
  onChange,
  onCreate,
  placeholder,
  creatable,
}: {
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
  onCreate?: () => void
  placeholder?: string
  creatable?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const filtered = options.filter(o =>
    o.label.toLowerCase().includes(query.toLowerCase()) || o.value.toLowerCase().includes(query.toLowerCase())
  )
  const selected = options.find(o => o.value === value)
  const exactMatch = options.some(o => o.value.toLowerCase() === query.toLowerCase())

  return (
    <div className="relative">
      <div className="flex gap-1">
        <input
          value={open ? query : (selected?.label ?? value)}
          onFocus={() => { setOpen(true); setQuery(selected?.label ?? value) }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={e => {
            setQuery(e.target.value)
            setOpen(true)
            const match = options.find(o => o.label.toLowerCase() === e.target.value.toLowerCase())
            onChange(match ? match.value : e.target.value)
          }}
          placeholder={placeholder}
          className={inputCls}
        />
        {creatable && onCreate && (
          <button type="button" onClick={onCreate}
            className="flex-shrink-0 px-2 bg-[#0B7439] text-white rounded-lg hover:bg-[#085c2d] transition-colors">
            <Plus className="w-4 h-4" />
          </button>
        )}
        <button type="button" onClick={() => setOpen(o => !o)}
          className="flex-shrink-0 px-2 border border-[#E2EAE5] rounded-lg text-[#6B7280]">
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>
      {open && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-[#E2EAE5] rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {filtered.length === 0 && !exactMatch && (
            <div className="px-3 py-2 text-xs text-[#9CA3AF]">Aucune option. {creatable ? 'Cliquez sur « + » pour créer.' : ''}</div>
          )}
          {filtered.map(o => (
            <button key={o.value} type="button"
              onMouseDown={() => { onChange(o.value); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-[#F8FAF8] flex items-center justify-between">
              <span className="text-[#374151]">{o.label}</span>
              {o.value === value && <Check className="w-3.5 h-3.5 text-[#0B7439]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Modal to create a new category ── */
function CreateCategoryModal({
  typeDepense,
  onClose,
  onCreated,
}: {
  typeDepense: 'AO' | 'HAO'
  onClose: () => void
  onCreated: (cat: AbgDepenseCategory) => void
}) {
  const [label, setLabel] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!label.trim()) {
      toast.error('Veuillez saisir un nom de catégorie')
      return
    }
    const code = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    setSaving(true)
    try {
      const cat = await createDepenseCategory({ code, label: label.trim(), type_depense: typeDepense })
      toast.success('Catégorie créée')
      onCreated(cat)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Erreur lors de la création')
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-xl p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-[#1a2a22] mb-4">Nouvelle catégorie {typeDepense}</h3>
        <label className="text-xs text-[#6B7280] mb-1 block">Nom de la catégorie *</label>
        <input value={label} onChange={e => setLabel(e.target.value)} autoFocus
          placeholder="ex: Carburant, Maçonnerie..." className={inputCls} />
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 border border-[#E2EAE5] text-[#6B7280] rounded-xl text-sm font-medium hover:bg-[#F8FAF8]">Annuler</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 bg-[#0B7439] text-white rounded-xl text-sm font-medium hover:bg-[#085c2d] disabled:opacity-50">
            {saving ? 'Création...' : 'Créer'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Multi-entry form ── */
function DepenseForm({
  categories, buses, societes, onClose, onSaved,
}: {
  categories: AbgDepenseCategory[]
  buses: { id: string; registration_number: string }[]
  societes: { code: string; name: string }[]
  onClose: () => void
  onSaved: () => void
}) {
  const [tab, setTab] = useState<'AO' | 'HAO'>('AO')
  const [rows, setRows] = useState<DepenseRowDraft[]>([emptyDraft()])
  const [saving, setSaving] = useState(false)
  const [showCatModal, setShowCatModal] = useState(false)

  const aoCats = categories.filter(c => c.type_depense === 'AO')
  const haoCats = categories.filter(c => c.type_depense === 'HAO')
  const availableCats = tab === 'AO' ? aoCats : haoCats
  const catOptions = availableCats.map(c => ({ value: c.code, label: c.label }))

  const busOptions = buses.map(b => ({ value: b.registration_number, label: b.registration_number }))
  const societeOptions = societes.map(s => ({ value: s.code, label: `${s.code} — ${s.name}` }))

  // Collect existing natures from categories + previously typed values
  const natureOptions = availableCats.map(c => ({ value: c.label, label: c.label }))

  const updateRow = (id: string, patch: Partial<DepenseRowDraft>) => {
    setRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)))
  }

  const addRow = () => {
    setRows(prev => [...prev, emptyDraft()])
  }

  const removeRow = (id: string) => {
    setRows(prev => prev.length > 1 ? prev.filter(r => r.id !== id) : prev)
  }

  const handleCategoryCreated = (cat: AbgDepenseCategory) => {
    // Add to local category list (parent will reload on save)
    availableCats.push(cat)
    setShowCatModal(false)
    toast.success(`Catégorie « ${cat.label} » ajoutée`)
  }

  const save = async () => {
    // Validate
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      if (!r.nature.trim()) {
        toast.error(`Ligne ${i + 1}: le libellé est obligatoire`)
        return
      }
      const montant = parseFloat(r.montant)
      if (isNaN(montant) || montant <= 0) {
        toast.error(`Ligne ${i + 1}: montant invalide`)
        return
      }
      if (tab === 'HAO' && !r.societe_code) {
        toast.error(`Ligne ${i + 1}: la société est obligatoire pour une dépense HAO`)
        return
      }
    }

    setSaving(true)
    try {
      for (const r of rows) {
        const montant = parseFloat(r.montant)
        await createDepense({
          date_depense: r.date_depense,
          source_libelle: r.car_matricule || r.societe_code || GARE_DEFAULT,
          nature: r.nature.trim(),
          montant,
          type_depense: tab,
          categorie: r.categorie || null,
          societe_code: r.societe_code || null,
          car_matricule: r.car_matricule || null,
          gare_label: r.gare_label || GARE_DEFAULT,
          description: null,
        })
      }
      toast.success(`${rows.length} dépense(s) enregistrée(s)`)
      onSaved()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Erreur lors de l\'enregistrement')
    }
    setSaving(false)
  }

  const validRows = rows.filter(r => r.nature.trim() && r.montant && parseFloat(r.montant) > 0)
  const rowsTotal = validRows.reduce((a, r) => a + parseFloat(r.montant), 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative w-full max-w-3xl bg-white rounded-2xl shadow-xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-[#E2EAE5] px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-lg font-bold text-[#1a2a22]">Nouvelle dépense</h2>
            <p className="text-xs text-[#6B7280] mt-0.5">Saisie multiple — gare d'Agboville</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-[#F8FAF8] rounded-lg"><X className="w-5 h-5 text-[#6B7280]" /></button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Tab selector */}
          <div className="flex gap-2">
            {(['AO', 'HAO'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`flex-1 px-4 py-3 rounded-xl text-sm font-semibold border-2 transition-colors ${
                  tab === t
                    ? (t === 'AO' ? 'bg-blue-50 border-blue-400 text-blue-700' : 'bg-orange-50 border-orange-400 text-orange-700')
                    : 'bg-white border-[#E2EAE5] text-[#6B7280] hover:bg-[#F8FAF8]'
                }`}>
                {t === 'AO' ? 'AO — Activités Ordinaires' : 'HAO — Hors Activités Ordinaires'}
              </button>
            ))}
          </div>

          {/* Rows */}
          <div className="space-y-3">
            {rows.map((row, idx) => (
              <div key={row.id} className="border border-[#E2EAE5] rounded-xl p-4 space-y-3 relative">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#6B7280]">Dépense #{idx + 1}</span>
                  {rows.length > 1 && (
                    <button onClick={() => removeRow(row.id)} className="text-red-400 hover:text-red-600 p-1">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-[#6B7280] mb-1 block">Date</label>
                    <input type="date" value={row.date_depense}
                      onChange={e => updateRow(row.id, { date_depense: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs text-[#6B7280] mb-1 block">Catégorie ({tab})</label>
                    <Combobox
                      options={catOptions}
                      value={row.categorie}
                      onChange={v => {
                        updateRow(row.id, { categorie: v })
                        const cat = availableCats.find(c => c.code === v)
                        if (cat && !row.nature) updateRow(row.id, { nature: cat.label })
                      }}
                      onCreate={() => setShowCatModal(true)}
                      creatable
                      placeholder="Rechercher ou créer..."
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs text-[#6B7280] mb-1 block">Libellé *</label>
                  <Combobox
                    options={natureOptions}
                    value={row.nature}
                    onChange={v => updateRow(row.id, { nature: v })}
                    placeholder="Rechercher ou saisir un libellé..."
                  />
                </div>

                <div>
                  <label className="text-xs text-[#6B7280] mb-1 block">Montant (FCFA) *</label>
                  <input type="number" value={row.montant}
                    onChange={e => updateRow(row.id, { montant: e.target.value })}
                    placeholder="0" className={`${inputCls} text-lg font-semibold`} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {tab === 'AO' ? (
                    <div>
                      <label className="text-xs text-[#6B7280] mb-1 block">Matricule du car</label>
                      <Combobox
                        options={busOptions}
                        value={row.car_matricule}
                        onChange={v => updateRow(row.id, { car_matricule: v })}
                        placeholder="Rechercher un véhicule..."
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="text-xs text-[#6B7280] mb-1 block">Société *</label>
                      <Combobox
                        options={societeOptions}
                        value={row.societe_code}
                        onChange={v => updateRow(row.id, { societe_code: v })}
                        placeholder="Rechercher une société..."
                      />
                    </div>
                  )}
                  <div>
                    <label className="text-xs text-[#6B7280] mb-1 block">Gare</label>
                    <input value={row.gare_label} readOnly disabled
                      className={`${inputCls} bg-[#F8FAF8] text-[#6B7280] cursor-not-allowed`} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Add row */}
          <button onClick={addRow}
            className="w-full flex items-center justify-center gap-1.5 py-3 border-2 border-dashed border-[#0B7439]/30 rounded-xl text-sm font-semibold text-[#0B7439] hover:bg-[#0B7439]/5 transition-colors">
            <Plus className="w-4 h-4" /> Ajouter une dépense
          </button>

          {/* Mini total */}
          {validRows.length > 0 && (
            <div className="flex items-center justify-between bg-[#F8FAF8] rounded-xl px-4 py-3 border border-[#E2EAE5]">
              <span className="text-sm text-[#6B7280]">{validRows.length} dépense(s) prête(s) — {tab}</span>
              <span className="text-lg font-bold text-[#0B7439]">{formatCFA(rowsTotal)}</span>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-[#E2EAE5] px-6 py-3 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border border-[#E2EAE5] text-[#6B7280] rounded-xl text-sm font-medium hover:bg-[#F8FAF8]">Annuler</button>
          <button onClick={save} disabled={saving || validRows.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#0B7439] text-white rounded-xl text-sm font-medium hover:bg-[#085c2d] disabled:opacity-50">
            {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Plus className="w-4 h-4" />}
            Enregistrer ({validRows.length})
          </button>
        </div>
      </div>

      {showCatModal && (
        <CreateCategoryModal
          typeDepense={tab}
          onClose={() => setShowCatModal(false)}
          onCreated={handleCategoryCreated}
        />
      )}
    </div>
  )
}
