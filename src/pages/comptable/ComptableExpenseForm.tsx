import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Save, Plus, Car, Search, X, Building2, Wrench, MapPin,
  Package, ChevronDown, AlertTriangle, Trash2, Receipt,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/store/authStore'
import type { ExpenseCategory } from '@/types/chargeAchat.types'

// ── Types ──────────────────────────────────────────────────────────────────────

type ExpenseType = 'stock' | 'other'

interface GarageOption { id: string; name: string; code: string; city: string; region: string | null }
interface FleetVehicle  { id: string; registration_number: string; company_id: string; is_active: boolean }

interface StockItem {
  id: string
  designation: string
  code_article: string | null
  stock_min: number
  stock_initial: number
  prix_unitaire: number
  stock_final: number
}

interface StockLine {
  stockItemId: string
  designation: string
  codeArticle: string
  stockDisponible: number
  prixUnitaire: number
  quantite: string
  garageId: string
  garageName: string
  busImmat: string
  observations: string
}

interface OtherForm {
  registration_number: string
  expense_date:        string
  category_id:         string
  description:         string
  supplier:            string
  amount:              string
  notes:               string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const EMPTY_OTHER: OtherForm = {
  registration_number: '', expense_date: format(new Date(), 'yyyy-MM-dd'),
  category_id: '', description: '', supplier: '', amount: '', notes: '',
}

const EMPTY_STOCK_LINE_EXTRA = { quantite: '1', garageId: '', garageName: '', busImmat: '', observations: '' }

const REGIONAL_GARAGE_CODES = ['GAR-OME-001', 'GAR-DVO-001', 'GAR-GGN-001', 'GAR-SPD-001', 'GAR-SBR-001', 'GAR-CENT']
const REGIONAL_COMPANIES    = ['TST', 'ETL', 'SNT']

function getWeekStart(dateStr: string): string {
  const d   = new Date(dateStr)
  const day = d.getDay()
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  return format(d, 'yyyy-MM-dd')
}

const fmt = (n: number) => new Intl.NumberFormat('fr-FR').format(n)

// ── Component ─────────────────────────────────────────────────────────────────

export default function ComptableExpenseForm() {
  const navigate  = useNavigate()
  const { id }    = useParams<{ id?: string }>()
  const { user }  = useAuthStore()
  const isEdit    = !!id
  const companyId = user?.company_id ?? null

  // Type selector (only relevant for new entries)
  const [expenseType, setExpenseType] = useState<ExpenseType | null>(isEdit ? 'other' : null)

  // Shared
  const [loading,     setLoading]     = useState(false)
  const [companyName, setCompanyName] = useState('')
  const [companyCode, setCompanyCode] = useState('')
  const [categories,  setCategories]  = useState<ExpenseCategory[]>([])
  const [vehicles,    setVehicles]    = useState<FleetVehicle[]>([])
  const [garages,     setGarages]     = useState<GarageOption[]>([])
  const [stockItems,  setStockItems]  = useState<StockItem[]>([])

  // Plate autocomplete (shared)
  const [plateInput,      setPlateInput]      = useState('')
  const [showSugg,        setShowSugg]        = useState(false)
  const [selectedVehicle, setSelectedVehicle] = useState<FleetVehicle | null>(null)
  const [plateNotFound,   setPlateNotFound]   = useState(false)
  const suggestRef  = useRef<HTMLDivElement>(null)
  const plateRef    = useRef<HTMLInputElement>(null)

  // Garage autocomplete (other form)
  const [garageInput,    setGarageInput]    = useState('')
  const [showGarageSugg, setShowGarageSugg] = useState(false)
  const [selectedGarage, setSelectedGarage] = useState<GarageOption | null>(null)
  const garageRef = useRef<HTMLDivElement>(null)

  // Other-expense form
  const [other, setOther] = useState<OtherForm>(EMPTY_OTHER)

  // Category autocomplete (other form)
  const [catSearch,   setCatSearch]   = useState('')
  const [showCatSugg, setShowCatSugg] = useState(false)
  const catRef = useRef<HTMLDivElement>(null)

  // Stock section
  const [stockLines,    setStockLines]    = useState<StockLine[]>([])
  const [stockDate,     setStockDate]     = useState(format(new Date(), 'yyyy-MM-dd'))
  const [stockSearch,   setStockSearch]   = useState('')
  const [showPicker,    setShowPicker]    = useState(false)
  const [stockNotes,    setStockNotes]    = useState('')
  const pickerRef = useRef<HTMLDivElement>(null)

  // Per-line garage
  const [lineGarSearch, setLineGarSearch] = useState<Record<number, string>>({})
  const [lineGarOpen,   setLineGarOpen]   = useState<Record<number, boolean>>({})

  // ── Load data ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!companyId) return
    const load = async () => {
      const [catRes, vehRes, garRes, coRes, siRes, mvRes] = await Promise.all([
        supabase.from('expense_categories').select('*').order('sort_order'),
        supabase.from('fleet_vehicles').select('id,registration_number,company_id,is_active').eq('company_id', companyId).eq('is_active', true),
        supabase.from('garages').select('id,name,code,city,region').neq('status', 'archive').order('name'),
        supabase.from('companies').select('name,code').eq('id', companyId).maybeSingle(),
        supabase.from('comptable_stock_items').select('id,designation,code_article,stock_min,stock_initial,prix_unitaire').eq('company_id', companyId).order('designation'),
        supabase.from('comptable_stock_movements').select('stock_item_id,movement_type,quantity').eq('company_id', companyId),
      ])

      if (catRes.data) setCategories(catRes.data)
      if (vehRes.data) setVehicles(vehRes.data as FleetVehicle[])

      if (coRes.data) {
        const co = coRes.data as { name: string; code: string }
        setCompanyName(co.name)
        setCompanyCode(co.code)
        const all = (garRes.data ?? []) as GarageOption[]
        setGarages(REGIONAL_COMPANIES.includes(co.code) ? all.filter(g => REGIONAL_GARAGE_CODES.includes(g.code)) : all)
      }

      const mvMap: Record<string, { e: number; s: number }> = {}
      for (const m of (mvRes.data ?? []) as { stock_item_id: string; movement_type: string; quantity: number }[]) {
        if (!mvMap[m.stock_item_id]) mvMap[m.stock_item_id] = { e: 0, s: 0 }
        if (m.movement_type === 'entree') mvMap[m.stock_item_id].e += Number(m.quantity)
        else mvMap[m.stock_item_id].s += Number(m.quantity)
      }
      setStockItems(((siRes.data ?? []) as Omit<StockItem, 'stock_final'>[]).map(item => ({
        ...item,
        stock_final: Number(item.stock_initial) + (mvMap[item.id]?.e ?? 0) - (mvMap[item.id]?.s ?? 0),
      })))
    }
    load()
  }, [companyId])

  // Load edit data
  useEffect(() => {
    if (!isEdit || !id) return
    supabase.from('vehicle_expenses').select('*').eq('id', id).maybeSingle().then(({ data }) => {
      if (!data) return
      setOther({
        registration_number: data.registration_number ?? '',
        expense_date:        data.expense_date ?? '',
        category_id:         data.category_id ?? '',
        description:         data.description ?? '',
        supplier:            data.supplier ?? '',
        amount:              data.amount?.toString() ?? '',
        notes:               data.notes ?? '',
      })
      setPlateInput(data.registration_number ?? '')
      if (data.supplier) setGarageInput(data.supplier)
    })
  }, [isEdit, id])

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (suggestRef.current && !suggestRef.current.contains(e.target as Node)) {
        setShowSugg(false)
        if (plateInput && !selectedVehicle) checkPlate(plateInput)
      }
      if (garageRef.current && !garageRef.current.contains(e.target as Node)) setShowGarageSugg(false)
      if (catRef.current && !catRef.current.contains(e.target as Node)) setShowCatSugg(false)
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowPicker(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [plateInput, selectedVehicle])

  // ── Plate helpers ────────────────────────────────────────────────────────────

  const plateSuggestions = plateInput.trim().length >= 1
    ? vehicles.filter(v => v.registration_number.toLowerCase().includes(plateInput.toLowerCase()))
    : []

  const checkPlate = (p: string) => {
    if (!p.trim()) { setPlateNotFound(false); return }
    setPlateNotFound(!vehicles.some(v => v.registration_number.toLowerCase() === p.toLowerCase()))
  }

  const selectVehicle = (v: FleetVehicle) => {
    setSelectedVehicle(v)
    setPlateInput(v.registration_number)
    setOther(f => ({ ...f, registration_number: v.registration_number }))
    setShowSugg(false)
    setPlateNotFound(false)
  }

  const clearVehicle = () => {
    setSelectedVehicle(null)
    setPlateInput('')
    setPlateNotFound(false)
    setOther(f => ({ ...f, registration_number: '' }))
    setTimeout(() => plateRef.current?.focus(), 50)
  }

  const handlePlateChange = (val: string) => {
    const up = val.toUpperCase()
    setPlateInput(up)
    setSelectedVehicle(null)
    setPlateNotFound(false)
    setShowSugg(up.trim().length >= 1)
    setOther(f => ({ ...f, registration_number: up }))
  }

  const vehicleIsValid = isEdit ? !!other.registration_number : !!selectedVehicle

  // ── Stock helpers ─────────────────────────────────────────────────────────────

  const filteredStock = stockItems.filter(s => {
    const q = stockSearch.toLowerCase()
    return s.designation.toLowerCase().includes(q) || (s.code_article ?? '').toLowerCase().includes(q)
  })

  const reservedFor = (itemId: string, excl?: number) =>
    stockLines.reduce((s, l, i) => i !== excl && l.stockItemId === itemId ? s + (Number(l.quantite) || 0) : s, 0)

  const availableFor = (item: StockItem, excl?: number) => item.stock_final - reservedFor(item.id, excl)

  const addLine = (item: StockItem) => {
    if (availableFor(item) <= 0) { toast.error('Stock insuffisant pour cet article'); return }
    const autoImmat = other.registration_number.trim() || plateInput.trim()
    setStockLines(prev => [...prev, {
      stockItemId: item.id, designation: item.designation, codeArticle: item.code_article ?? '',
      stockDisponible: item.stock_final, prixUnitaire: item.prix_unitaire,
      ...EMPTY_STOCK_LINE_EXTRA,
      busImmat: autoImmat,
    }])
    setShowPicker(false)
    setStockSearch('')
  }

  const updateLine = (idx: number, field: keyof StockLine, val: string) =>
    setStockLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: val } : l))

  const removeLine = (idx: number) => setStockLines(prev => prev.filter((_, i) => i !== idx))

  const lineTotal   = (l: StockLine) => Math.round((Number(l.quantite) || 0) * l.prixUnitaire)
  const stockTotal  = stockLines.reduce((s, l) => s + lineTotal(l), 0)

  // ── Validation ────────────────────────────────────────────────────────────────

  const validateStock = () => {
    if (!vehicleIsValid) { toast.error("L'immatriculation est obligatoire"); return false }
    if (!companyId) { toast.error('Société introuvable'); return false }
    if (!stockDate) { toast.error('La date est obligatoire'); return false }
    if (stockLines.length === 0) { toast.error('Ajoutez au moins un article depuis le stock'); return false }
    for (let i = 0; i < stockLines.length; i++) {
      const l   = stockLines[i]
      const qty = Number(l.quantite)
      if (!qty || qty <= 0) { toast.error(`Ligne ${i + 1} : quantité invalide`); return false }
      const avail = availableFor({ id: l.stockItemId } as StockItem & { stock_final: number }, i) + qty
      if (qty > avail) { toast.error(`Ligne ${i + 1} : quantité supérieure au stock disponible (max ${avail})`); return false }
    }
    return true
  }

  const validateOther = () => {
    if (!other.registration_number.trim()) { toast.error("L'immatriculation est obligatoire"); return false }
    if (!isEdit && !selectedVehicle) { toast.error('Aucun véhicule trouvé pour cette plaque.'); return false }
    if (!companyId) { toast.error('Société introuvable'); return false }
    if (!other.expense_date) { toast.error('La date est obligatoire'); return false }
    if (!other.description.trim()) { toast.error('La description est obligatoire'); return false }
    if (!other.amount || isNaN(Number(other.amount)) || Number(other.amount) < 0) { toast.error('Le montant est invalide'); return false }
    return true
  }

  // ── Save ──────────────────────────────────────────────────────────────────────

  const saveStock = async (addAnother = false) => {
    if (!validateStock()) return
    setLoading(true)
    try {
      // Create a synthetic vehicle_expense representing the total stock movement
      const needsValidation = REGIONAL_COMPANIES.includes(companyCode)
      const payload = {
        company_id:          companyId,
        vehicle_id:          selectedVehicle?.id ?? null,
        registration_number: other.registration_number.trim().toUpperCase(),
        expense_date:        stockDate,
        week_start:          getWeekStart(stockDate),
        category_id:         null,
        description:         `Sortie stock — ${stockLines.map(l => l.designation).join(', ')}`,
        supplier:            null,
        amount:              stockTotal,
        notes:               stockNotes.trim() || null,
        updated_at:          new Date().toISOString(),
        created_by:          user?.id ?? null,
        source:              'comptable',
        validation_status:   needsValidation ? 'en_attente' : 'validee',
      }
      const { data: inserted, error } = await supabase.from('vehicle_expenses').insert(payload).select('id').single()
      if (error) throw error

      const movements = stockLines.map(l => ({
        company_id:          companyId,
        stock_item_id:       l.stockItemId,
        movement_type:       'sortie' as const,
        quantity:            Number(l.quantite),
        unit_price:          l.prixUnitaire,
        expense_reference:   inserted?.id ?? null,
        garage_id:           l.garageId || null,
        registration_number: l.busImmat || other.registration_number.trim().toUpperCase() || null,
        notes:               l.observations || null,
        created_by:          user?.id ?? null,
        movement_date:       stockDate,
      }))
      const { error: mvErr } = await supabase.from('comptable_stock_movements').insert(movements)
      if (mvErr) throw mvErr

      toast.success(needsValidation
        ? `Depense en attente de validation — ${stockLines.length} sortie(s) de stock`
        : `Depense enregistree — ${stockLines.length} sortie(s) de stock`
      )

      if (addAnother) {
        setStockLines([])
        setStockNotes('')
        setStockDate(format(new Date(), 'yyyy-MM-dd'))
        setSelectedVehicle(null)
        setPlateInput('')
        setOther(EMPTY_OTHER)
      } else {
        navigate('/comptable/expenses')
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setLoading(false)
    }
  }

  const saveOther = async (addAnother = false) => {
    if (!validateOther()) return
    setLoading(true)
    const needsValidation = REGIONAL_COMPANIES.includes(companyCode)
    const payload = {
      company_id:          companyId,
      vehicle_id:          selectedVehicle?.id ?? null,
      registration_number: other.registration_number.trim().toUpperCase(),
      expense_date:        other.expense_date,
      week_start:          getWeekStart(other.expense_date),
      category_id:         other.category_id || null,
      description:         other.description.trim(),
      supplier:            other.supplier.trim() || null,
      amount:              Math.round(Number(other.amount)),
      notes:               other.notes.trim() || null,
      updated_at:          new Date().toISOString(),
      source:              'comptable',
      validation_status:   needsValidation ? 'en_attente' : 'validee',
    }
    try {
      if (isEdit) {
        const { error } = await supabase.from('vehicle_expenses').update(payload).eq('id', id)
        if (error) throw error
        toast.success('Depense mise a jour')
      } else {
        const { error } = await supabase.from('vehicle_expenses').insert({ ...payload, created_by: user?.id ?? null })
        if (error) throw error
        toast.success(needsValidation ? 'Depense en attente de validation' : 'Depense enregistree')
      }
      if (addAnother) {
        setOther({ ...EMPTY_OTHER, expense_date: other.expense_date })
        setPlateInput('')
        setSelectedVehicle(null)
        setPlateNotFound(false)
      } else {
        navigate('/comptable/expenses')
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setLoading(false)
    }
  }

  // ── Shared sub-components (inline) ───────────────────────────────────────────

  const inputCls  = 'w-full px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500'
  const inputStyle = { backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }

  // Plaque field (shared between both types)
  const PlateField = (
    <div>
      <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
        Plaque d'immatriculation <span style={{ color: '#DC2626' }}>*</span>
      </label>
      {vehicleIsValid ? (
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg" style={{ backgroundColor: '#d4edda', border: '1px solid #86efac' }}>
          <Car className="w-4 h-4 flex-shrink-0" style={{ color: '#0B7439' }} />
          <span className="font-mono font-bold text-sm flex-1" style={{ color: '#0B7439' }}>{other.registration_number || plateInput}</span>
          {!isEdit && (
            <button type="button" onClick={clearVehicle} className="p-0.5 rounded hover:bg-green-200 transition-colors">
              <X className="w-4 h-4" style={{ color: '#0B7439' }} />
            </button>
          )}
        </div>
      ) : (
        <div ref={suggestRef} className="relative">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--bg-subtle)', border: `1px solid ${plateNotFound ? '#DC2626' : 'var(--border)'}` }}>
            <Search className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
            <input
              ref={plateRef}
              value={plateInput}
              onChange={e => handlePlateChange(e.target.value)}
              onFocus={() => { if (plateInput.trim().length >= 1) setShowSugg(true) }}
              onBlur={() => setTimeout(() => { if (!selectedVehicle && plateInput.trim()) checkPlate(plateInput); setShowSugg(false) }, 150)}
              placeholder="ex: AA-266-GY-05"
              className="flex-1 bg-transparent text-sm outline-none font-mono"
              style={{ color: 'var(--text-primary)' }}
              autoFocus
              autoComplete="off"
            />
            {plateInput && (
              <button type="button" onMouseDown={() => { setPlateInput(''); setSelectedVehicle(null); setPlateNotFound(false); setOther(f => ({ ...f, registration_number: '' })); setShowSugg(false) }}>
                <X className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
              </button>
            )}
          </div>
          {showSugg && plateSuggestions.length > 0 && (
            <div className="absolute z-30 left-0 right-0 top-full mt-1 rounded-xl shadow-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', maxHeight: 260 }}>
              <div className="overflow-y-auto" style={{ maxHeight: 260 }}>
                {plateSuggestions.map(v => (
                  <button key={v.id} type="button" onMouseDown={() => selectVehicle(v)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors">
                    <Car className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                    <span className="font-mono font-bold text-sm flex-1" style={{ color: 'var(--text-primary)' }}>{v.registration_number}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {plateNotFound && <p className="mt-1.5 text-xs font-medium" style={{ color: '#DC2626' }}>Aucun véhicule trouvé pour cette plaque dans votre parc.</p>}
        </div>
      )}
    </div>
  )

  // Company badge (shared)
  const CompanyBadge = (
    <div>
      <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Société rattachée</label>
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)' }}>
        <Building2 className="w-4 h-4 flex-shrink-0" style={{ color: '#1D4ED8' }} />
        <span className="text-sm font-semibold flex-1" style={{ color: 'var(--text-primary)' }}>{companyName || '—'}</span>
        {companyCode && <span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ backgroundColor: '#DBEAFE', color: '#1D4ED8' }}>{companyCode}</span>}
      </div>
    </div>
  )

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/comptable/expenses')} className="p-2 rounded-lg hover:bg-gray-100">
          <ArrowLeft className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
        </button>
        <div>
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            {isEdit ? 'Modifier la dépense' : 'Nouvelle dépense véhicule'}
          </h1>
          {companyName && (
            <div className="flex items-center gap-1.5 mt-0.5">
              <Building2 className="w-3.5 h-3.5" style={{ color: '#1D4ED8' }} />
              <span className="text-xs font-semibold" style={{ color: '#1D4ED8' }}>{companyName}</span>
              <span className="text-xs px-1.5 py-0.5 rounded font-bold" style={{ backgroundColor: '#DBEAFE', color: '#1D4ED8' }}>{companyCode}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Type selector (new only) ──────────────────────────────────────────── */}
      {!isEdit && !expenseType && (
        <div className="rounded-xl p-6" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-sm font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Type de dépense</p>
          <p className="text-xs mb-5" style={{ color: 'var(--text-muted)' }}>Choisissez le type de dépense à enregistrer</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            <button type="button" onClick={() => setExpenseType('stock')}
              className="flex flex-col items-start gap-3 p-5 rounded-xl text-left transition-all hover:shadow-md"
              style={{ backgroundColor: '#F0FDF4', border: '2px solid #86efac' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#d4edda' }}>
                <Package className="w-5 h-5" style={{ color: '#0B7439' }} />
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color: '#0B7439' }}>Articles depuis le stock</p>
                <p className="text-xs mt-1" style={{ color: '#166534' }}>
                  Sélectionnez des articles disponibles en stock. Les quantités seront déduites automatiquement.
                </p>
              </div>
            </button>

            <button type="button" onClick={() => setExpenseType('other')}
              className="flex flex-col items-start gap-3 p-5 rounded-xl text-left transition-all hover:shadow-md"
              style={{ backgroundColor: '#EFF6FF', border: '2px solid #BFDBFE' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#DBEAFE' }}>
                <Receipt className="w-5 h-5" style={{ color: '#1D4ED8' }} />
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color: '#1D4ED8' }}>Autre dépense</p>
                <p className="text-xs mt-1" style={{ color: '#1E40AF' }}>
                  Dépense externe sans impact sur le stock : réparation, carburant, prestation, etc.
                </p>
              </div>
            </button>

          </div>
        </div>
      )}

      {/* ── STOCK FORM ────────────────────────────────────────────────────────── */}
      {(expenseType === 'stock' && !isEdit) && (
        <>
          {/* Change type chip */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold" style={{ backgroundColor: '#d4edda', color: '#0B7439' }}>
              <Package className="w-3.5 h-3.5" /> Articles depuis le stock
            </div>
            <button type="button" onClick={() => { setExpenseType(null); setStockLines([]); setSelectedVehicle(null); setPlateInput(''); setOther(EMPTY_OTHER) }}
              className="text-xs font-medium hover:underline" style={{ color: 'var(--text-muted)' }}>
              Changer de type
            </button>
          </div>

          {/* Plaque + société + date */}
          <div className="rounded-xl p-5 space-y-5" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            {PlateField}
            {CompanyBadge}
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Date <span style={{ color: '#DC2626' }}>*</span></label>
              <input type="date" value={stockDate} onChange={e => setStockDate(e.target.value)} className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Notes générales (optionnel)</label>
              <textarea value={stockNotes} onChange={e => setStockNotes(e.target.value)} rows={2} placeholder="Observations sur cette dépense de stock…" className={inputCls} style={{ ...inputStyle, resize: 'none' }} />
            </div>
          </div>

          {/* Articles section */}
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>

            {/* Section header */}
            <div className="px-5 py-3.5 flex items-center justify-between" style={{ backgroundColor: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4" style={{ color: '#0B7439' }} />
                <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Articles utilisés depuis le stock</span>
                {stockLines.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ backgroundColor: '#d4edda', color: '#0B7439' }}>{stockLines.length}</span>
                )}
              </div>
              <div ref={pickerRef} className="relative">
                <button type="button" onClick={() => { setShowPicker(v => !v); setStockSearch('') }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                  style={{ backgroundColor: '#0B7439', color: '#fff' }}>
                  <Plus className="w-3.5 h-3.5" /> Ajouter un article
                  <ChevronDown className="w-3 h-3 opacity-70" />
                </button>
                {showPicker && (
                  <div className="absolute z-40 right-0 top-full mt-1 rounded-xl shadow-2xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', width: 360 }}>
                    <div className="p-3 border-b" style={{ borderColor: 'var(--border)' }}>
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)' }}>
                        <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                        <input autoFocus value={stockSearch} onChange={e => setStockSearch(e.target.value)}
                          placeholder="Rechercher par code ou désignation…"
                          className="flex-1 bg-transparent text-xs outline-none" style={{ color: 'var(--text-primary)' }} />
                        {stockSearch && <button onMouseDown={() => setStockSearch('')}><X className="w-3 h-3" style={{ color: 'var(--text-muted)' }} /></button>}
                      </div>
                    </div>
                    <div className="overflow-y-auto" style={{ maxHeight: 280 }}>
                      {filteredStock.length === 0 ? (
                        <div className="p-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>Aucun article trouvé</div>
                      ) : filteredStock.map(item => {
                        const avail    = availableFor(item)
                        const disabled = avail <= 0
                        return (
                          <button key={item.id} type="button" disabled={disabled} onMouseDown={() => addLine(item)}
                            className="w-full flex items-start gap-3 px-4 py-3 text-left border-b last:border-0"
                            style={{ borderColor: 'var(--border)', opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
                            onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--bg-subtle)' }}
                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '' }}>
                            <Package className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: disabled ? '#DC2626' : '#0B7439' }} />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>{item.designation}</p>
                              {item.code_article && <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{item.code_article}</p>}
                              <div className="flex items-center gap-3 mt-0.5">
                                <span className="text-xs font-semibold" style={{ color: disabled ? '#DC2626' : '#0B7439' }}>Stock dispo: {avail}</span>
                                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{fmt(item.prix_unitaire)} XOF/u</span>
                              </div>
                            </div>
                            {disabled && <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: '#DC2626' }} />}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Lines */}
            {stockLines.length === 0 ? (
              <div className="px-5 py-10 text-center" style={{ backgroundColor: 'var(--surface)' }}>
                <Package className="w-8 h-8 mx-auto mb-2 opacity-25" style={{ color: 'var(--text-muted)' }} />
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Aucun article sélectionné — ajoutez des articles depuis le stock.</p>
              </div>
            ) : (
              <div style={{ backgroundColor: 'var(--surface)' }}>
                {stockLines.map((line, idx) => {
                  const avail      = availableFor({ id: line.stockItemId } as StockItem & { stock_final: number }, idx) + (Number(line.quantite) || 0)
                  const qty        = Number(line.quantite) || 0
                  const overStock  = qty > avail
                  const garQ       = (lineGarSearch[idx] ?? '').toLowerCase()
                  const garMatches = garQ.length >= 1 ? garages.filter(g => g.name.toLowerCase().includes(garQ) || g.city.toLowerCase().includes(garQ) || g.code.toLowerCase().includes(garQ)) : []

                  return (
                    <div key={idx} className="p-4 border-b last:border-0 space-y-3" style={{ borderColor: 'var(--border)' }}>

                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: '#d4edda', color: '#0B7439' }}>{idx + 1}</span>
                          <div className="min-w-0">
                            <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{line.designation}</p>
                            <div className="flex items-center gap-3 mt-0.5">
                              {line.codeArticle && <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{line.codeArticle}</span>}
                              <span className="text-xs font-semibold" style={{ color: '#0B7439' }}>Stock: {line.stockDisponible}</span>
                              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{fmt(line.prixUnitaire)} XOF/u</span>
                            </div>
                          </div>
                        </div>
                        <button type="button" onClick={() => removeLine(idx)} className="p-1.5 rounded-lg hover:bg-red-50 flex-shrink-0 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" style={{ color: '#DC2626' }} />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">

                        <div>
                          <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Quantité <span style={{ color: '#DC2626' }}>*</span></label>
                          <input type="number" min="0.5" step="0.5" value={line.quantite}
                            onChange={e => updateLine(idx, 'quantite', e.target.value)}
                            className={inputCls} style={{ ...inputStyle, border: `1px solid ${overStock ? '#DC2626' : 'var(--border)'}` }} />
                          {overStock && <p className="text-xs mt-0.5 font-medium" style={{ color: '#DC2626' }}>Max: {avail}</p>}
                        </div>

                        <div>
                          <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Montant total</label>
                          <div className="px-3 py-2 rounded-lg text-sm font-bold" style={{ backgroundColor: '#d4edda', color: '#0B7439', border: '1px solid #86efac' }}>
                            {fmt(lineTotal(line))} <span className="text-xs font-normal">XOF</span>
                          </div>
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Bus concerné (immat.)</label>
                          <input value={line.busImmat} onChange={e => updateLine(idx, 'busImmat', e.target.value.toUpperCase())}
                            placeholder="ex: AA-266-GY-05" className={inputCls} style={{ ...inputStyle, fontFamily: 'monospace' }} />
                        </div>

                        <div className="sm:col-span-2 relative">
                          <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Garage concerné</label>
                          {line.garageId ? (
                            <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE' }}>
                              <Wrench className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#1D4ED8' }} />
                              <span className="text-xs font-semibold flex-1 truncate" style={{ color: '#1E3A5F' }}>{line.garageName}</span>
                              <button type="button" onClick={() => { updateLine(idx, 'garageId', ''); updateLine(idx, 'garageName', ''); setLineGarSearch(s => ({ ...s, [idx]: '' })) }}>
                                <X className="w-3.5 h-3.5" style={{ color: '#1D4ED8' }} />
                              </button>
                            </div>
                          ) : (
                            <div className="relative">
                              <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)' }}>
                                <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                                <input value={lineGarSearch[idx] ?? ''}
                                  onChange={e => { setLineGarSearch(s => ({ ...s, [idx]: e.target.value })); setLineGarOpen(o => ({ ...o, [idx]: true })) }}
                                  onFocus={() => setLineGarOpen(o => ({ ...o, [idx]: true }))}
                                  onBlur={() => setTimeout(() => setLineGarOpen(o => ({ ...o, [idx]: false })), 150)}
                                  placeholder="Rechercher un garage…"
                                  className="flex-1 bg-transparent text-xs outline-none" style={{ color: 'var(--text-primary)' }} autoComplete="off" />
                              </div>
                              {lineGarOpen[idx] && garMatches.length > 0 && (
                                <div className="absolute z-30 left-0 right-0 top-full mt-1 rounded-xl shadow-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', maxHeight: 180 }}>
                                  <div className="overflow-y-auto" style={{ maxHeight: 180 }}>
                                    {garMatches.map(g => (
                                      <button key={g.id} type="button" onMouseDown={() => { updateLine(idx, 'garageId', g.id); updateLine(idx, 'garageName', g.name); setLineGarSearch(s => ({ ...s, [idx]: g.name })); setLineGarOpen(o => ({ ...o, [idx]: false })) }}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                                        <Wrench className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                                        <div className="flex-1 min-w-0">
                                          <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{g.name}</p>
                                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{g.city}</p>
                                        </div>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="col-span-2 sm:col-span-4">
                          <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Observations</label>
                          <input value={line.observations} onChange={e => updateLine(idx, 'observations', e.target.value)}
                            placeholder="Remarques sur l'utilisation de cet article…" className={inputCls} style={inputStyle} />
                        </div>
                      </div>
                    </div>
                  )
                })}

                <div className="px-5 py-3 flex items-center justify-between" style={{ backgroundColor: 'var(--bg-subtle)', borderTop: '1px solid var(--border)' }}>
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Total articles ({stockLines.length} ligne{stockLines.length > 1 ? 's' : ''})</span>
                  <span className="text-sm font-bold" style={{ color: '#0B7439' }}>{fmt(stockTotal)} XOF</span>
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 flex-wrap">
            <button onClick={() => saveStock(false)} disabled={loading || !vehicleIsValid || stockLines.length === 0}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#0B7439', color: '#fff' }}>
              <Save className="w-4 h-4" />
              {loading ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            <button onClick={() => saveStock(true)} disabled={loading || !vehicleIsValid || stockLines.length === 0}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
              <Plus className="w-4 h-4" /> Enregistrer et ajouter une autre
            </button>
            <button onClick={() => navigate('/comptable/expenses')} className="px-4 py-2.5 rounded-xl text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
              Annuler
            </button>
          </div>
        </>
      )}

      {/* ── OTHER EXPENSE FORM ────────────────────────────────────────────────── */}
      {(expenseType === 'other' || isEdit) && (
        <>
          {/* Change type chip (new only) */}
          {!isEdit && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold" style={{ backgroundColor: '#DBEAFE', color: '#1D4ED8' }}>
                <Receipt className="w-3.5 h-3.5" /> Autre dépense
              </div>
              <button type="button" onClick={() => { setExpenseType(null); setSelectedVehicle(null); setPlateInput(''); setOther(EMPTY_OTHER) }}
                className="text-xs font-medium hover:underline" style={{ color: 'var(--text-muted)' }}>
                Changer de type
              </button>
            </div>
          )}

          <div className="rounded-xl p-5 space-y-5" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>

            {PlateField}
            {CompanyBadge}

            {/* Date */}
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Date <span style={{ color: '#DC2626' }}>*</span></label>
              <input type="date" value={other.expense_date} onChange={e => setOther(f => ({ ...f, expense_date: e.target.value }))} className={inputCls} style={inputStyle} />
            </div>

            {/* Garage */}
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Garage / Lieu</label>
              {selectedGarage ? (
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg" style={{ backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE' }}>
                  <Wrench className="w-4 h-4 flex-shrink-0" style={{ color: '#1D4ED8' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: '#1E3A5F' }}>{selectedGarage.name}</p>
                    <p className="text-xs flex items-center gap-1" style={{ color: '#3B82F6' }}>
                      <MapPin className="w-3 h-3" />
                      {selectedGarage.city}{selectedGarage.region ? ` — ${selectedGarage.region}` : ''}
                      <span className="ml-1 font-mono font-bold">{selectedGarage.code}</span>
                    </p>
                  </div>
                  <button type="button" onClick={() => { setSelectedGarage(null); setGarageInput(''); setOther(f => ({ ...f, supplier: '' })) }} className="p-0.5 rounded hover:bg-blue-100 flex-shrink-0">
                    <X className="w-4 h-4" style={{ color: '#1D4ED8' }} />
                  </button>
                </div>
              ) : (
                <div ref={garageRef} className="relative">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)' }}>
                    <Search className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                    <input value={garageInput}
                      onChange={e => { setGarageInput(e.target.value); setOther(f => ({ ...f, supplier: e.target.value })); setShowGarageSugg(e.target.value.trim().length >= 1) }}
                      onFocus={() => { if (garageInput.trim().length >= 1) setShowGarageSugg(true) }}
                      onBlur={() => setTimeout(() => setShowGarageSugg(false), 150)}
                      placeholder="Rechercher un garage ou saisir un lieu…"
                      className="flex-1 bg-transparent text-sm outline-none" style={{ color: 'var(--text-primary)' }} autoComplete="off" />
                    {garageInput && (
                      <button type="button" onMouseDown={() => { setGarageInput(''); setOther(f => ({ ...f, supplier: '' })); setShowGarageSugg(false) }}>
                        <X className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                      </button>
                    )}
                  </div>
                  {showGarageSugg && (() => {
                    const q = garageInput.toLowerCase()
                    const matches = garages.filter(g => g.name.toLowerCase().includes(q) || g.city.toLowerCase().includes(q) || g.code.toLowerCase().includes(q))
                    return matches.length > 0 ? (
                      <div className="absolute z-30 left-0 right-0 top-full mt-1 rounded-xl shadow-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', maxHeight: 240 }}>
                        <div className="overflow-y-auto" style={{ maxHeight: 240 }}>
                          {matches.map(g => (
                            <button key={g.id} type="button" onMouseDown={() => { setSelectedGarage(g); setGarageInput(g.name); setOther(f => ({ ...f, supplier: g.name })); setShowGarageSugg(false) }}
                              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors">
                              <Wrench className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{g.name}</p>
                                <p className="text-xs flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                                  <MapPin className="w-3 h-3" />{g.city}{g.region ? ` — ${g.region}` : ''}
                                </p>
                              </div>
                              <span className="text-xs px-2 py-0.5 rounded-full font-mono font-bold flex-shrink-0" style={{ backgroundColor: '#d4edda', color: '#0B7439' }}>{g.code}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null
                  })()}
                </div>
              )}
            </div>

            {/* Catégorie */}
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Catégorie</label>
              <div ref={catRef} className="relative">
                {other.category_id ? (() => {
                  const sel = categories.find(c => c.id === other.category_id)
                  if (!sel) return null
                  return (
                    <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg" style={{ backgroundColor: sel.color + '20', border: `1px solid ${sel.color}` }}>
                      <span>{sel.icon}</span>
                      <span className="text-sm font-semibold flex-1 truncate" style={{ color: sel.color }}>{sel.name}</span>
                      <button type="button" onClick={() => { setOther(f => ({ ...f, category_id: '' })); setCatSearch(''); setShowCatSugg(true) }}
                        className="p-0.5 rounded hover:bg-black/5 flex-shrink-0">
                        <X className="w-3.5 h-3.5" style={{ color: sel.color }} />
                      </button>
                    </div>
                  )
                })() : (
                  <>
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)' }}>
                      <Search className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                      <input value={catSearch}
                        onChange={e => { setCatSearch(e.target.value); setShowCatSugg(true) }}
                        onFocus={() => setShowCatSugg(true)}
                        onBlur={() => setTimeout(() => setShowCatSugg(false), 150)}
                        placeholder="Rechercher une catégorie…"
                        className="flex-1 bg-transparent text-sm outline-none" style={{ color: 'var(--text-primary)' }} autoComplete="off" />
                      {catSearch && (
                        <button type="button" onMouseDown={() => { setCatSearch(''); setShowCatSugg(false) }}>
                          <X className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                        </button>
                      )}
                    </div>
                    {showCatSugg && (() => {
                      const q = catSearch.toLowerCase().trim()
                      const matches = q ? categories.filter(c => c.name.toLowerCase().includes(q)) : categories
                      if (matches.length === 0) {
                        return (
                          <div className="absolute z-30 left-0 right-0 top-full mt-1 rounded-xl shadow-xl" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
                            <div className="px-4 py-3 text-xs text-center" style={{ color: 'var(--text-muted)' }}>Aucune catégorie trouvée</div>
                          </div>
                        )
                      }
                      return (
                        <div className="absolute z-30 left-0 right-0 top-full mt-1 rounded-xl shadow-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', maxHeight: 240 }}>
                          <div className="overflow-y-auto" style={{ maxHeight: 240 }}>
                            {matches.map(c => (
                              <button key={c.id} type="button" onMouseDown={() => { setOther(f => ({ ...f, category_id: c.id })); setCatSearch(''); setShowCatSugg(false) }}
                                className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors border-b last:border-0"
                                style={{ borderColor: 'var(--border)' }}>
                                <span className="flex-shrink-0">{c.icon}</span>
                                <span className="text-sm font-medium truncate flex-1" style={{ color: 'var(--text-primary)' }}>{c.name}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                    })()}
                  </>
                )}
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Description <span style={{ color: '#DC2626' }}>*</span></label>
              <input value={other.description} onChange={e => setOther(f => ({ ...f, description: e.target.value }))}
                placeholder="ex: Dépannage flexible, Collage pneus…" className={inputCls} style={inputStyle} />
            </div>

            {/* Montant */}
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Montant (XOF) <span style={{ color: '#DC2626' }}>*</span></label>
              <div className="relative">
                <input type="number" min="0" step="500" value={other.amount} onChange={e => setOther(f => ({ ...f, amount: e.target.value }))}
                  placeholder="0" className={inputCls + ' pr-14'} style={inputStyle} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>XOF</span>
              </div>
              {other.amount && !isNaN(Number(other.amount)) && (
                <p className="text-xs mt-1 font-medium" style={{ color: '#0B7439' }}>{fmt(Number(other.amount))} XOF</p>
              )}
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Notes (optionnel)</label>
              <textarea value={other.notes} onChange={e => setOther(f => ({ ...f, notes: e.target.value }))}
                rows={2} placeholder="Observations complémentaires…" className={inputCls} style={{ ...inputStyle, resize: 'none' }} />
            </div>

          </div>

          {/* Actions */}
          <div className="flex gap-3 flex-wrap">
            <button onClick={() => saveOther(false)} disabled={loading || (!isEdit && !vehicleIsValid)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#1D4ED8', color: '#fff' }}>
              <Save className="w-4 h-4" />
              {loading ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            {!isEdit && (
              <button onClick={() => saveOther(true)} disabled={loading || !vehicleIsValid}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                <Plus className="w-4 h-4" /> Enregistrer et ajouter une autre
              </button>
            )}
            <button onClick={() => navigate('/comptable/expenses')} className="px-4 py-2.5 rounded-xl text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
              Annuler
            </button>
          </div>
        </>
      )}

    </div>
  )
}
