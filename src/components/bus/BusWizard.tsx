import React, { useState, useRef, useEffect } from 'react'
import { X, Search, ChevronDown, Building2 } from 'lucide-react'
import toast from 'react-hot-toast'
import BusParametersStep, { type BusParameters, type DeckParameters, defaultDeckParameters } from './BusParametersStep'
import SeatPlanBuilder, { type GridLayout, defaultDeckConfig, countReservableSeats } from './SeatPlanBuilder'
import BusSummaryStep from './BusSummaryStep'
import { saveBusWithSeatConfig } from '../../services/busConfig.service'

interface Company {
  id: string
  name: string
  code?: string
  parent_id?: string | null
  is_group?: boolean
}

interface SeatConfig {
  id: string
  name: string
  total_capacity: number
}

interface Amenity {
  id: string
  name: string
  icon: string
}

interface GeneralFormData {
  registration_number: string
  brand: string
  model: string
  year: number
  class: 'standard' | 'vip' | 'executive'
  company_id: string
  fuel_type: string
  fuel_capacity: number
  fuel_consumption: number
  insurance_expiry: string
  vignette_expiry: string
  technical_inspection_expiry: string
  photo_url: string
  amenities: string[]
}

interface ExistingBusConfig {
  deckType: 'simple' | 'imperial'
  driverPosition: 'gauche' | 'droite'
  sleepingType: 'aucun' | 'couchettes' | 'mixte'
  maxCapacity: number
  seatsSoldFrom?: number
  aisleAfterColumns: number[]
  hasBackRow: boolean
  backRowSeats: number
  totalRows: number
  totalCols: number
  seatConfigId?: string
  simpleLayout?: GridLayout
  lowerConfigId?: string
  upperConfigId?: string
  lowerLayout?: GridLayout
  upperLayout?: GridLayout
}

interface BusWizardProps {
  editingId: string | null
  initialGeneralData: GeneralFormData
  companies: Company[]
  seatConfigs: SeatConfig[]
  amenities: Amenity[]
  existingConfig?: ExistingBusConfig
  onClose: () => void
  onSaved: () => void
}

// ─── Hierarchical Company Picker ────────────────────────────────────────────

function CompanyPicker({
  companies,
  value,
  onChange,
}: {
  companies: Company[]
  value: string
  onChange: (id: string) => void
}) {
  const [search,   setSearch]   = useState('')
  const [open,     setOpen]     = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Split into groups + standalone (same logic as buildCompanyGroups)
  const groupCompanies = companies.filter(c => c.is_group)
  const selectableCompanies = companies.filter(c => !c.is_group) // subsidiaries + standalone

  const filterMatch = (c: Company) =>
    !search ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.code ?? '').toLowerCase().includes(search.toLowerCase())

  const selected = companies.find(c => c.id === value)

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-2.5 border-2 rounded-xl text-sm text-left transition-colors"
        style={{
          borderColor: open ? '#0B7439' : '#E2EAE5',
          backgroundColor: '#fff',
          color: selected ? '#1A2E22' : '#9AB4A0',
        }}
      >
        {selected ? (
          <>
            <Building2 className="w-4 h-4 flex-shrink-0" style={{ color: '#0B7439' }} />
            <span className="flex-1 font-medium truncate">{selected.name}</span>
            {selected.code && (
              <span className="text-xs px-1.5 py-0.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: '#d4edda', color: '#0B7439' }}>
                {selected.code}
              </span>
            )}
          </>
        ) : (
          <>
            <Building2 className="w-4 h-4 flex-shrink-0" style={{ color: '#9AB4A0' }} />
            <span className="flex-1">Sélectionner une société</span>
          </>
        )}
        <ChevronDown
          className="w-4 h-4 flex-shrink-0 transition-transform"
          style={{ color: '#9AB4A0', transform: open ? 'rotate(180deg)' : 'none' }}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute z-50 left-0 right-0 top-full mt-1 rounded-xl shadow-xl overflow-hidden"
          style={{ backgroundColor: '#fff', border: '1px solid #E2EAE5', maxHeight: 320 }}
        >
          {/* Search */}
          <div className="px-3 py-2 border-b" style={{ borderColor: '#E2EAE5' }}>
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ backgroundColor: '#F4F7F5' }}>
              <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#9AB4A0' }} />
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Rechercher une société…"
                className="flex-1 bg-transparent text-sm outline-none"
                style={{ color: '#1A2E22' }}
              />
              {search && (
                <button type="button" onClick={() => setSearch('')}>
                  <X className="w-3.5 h-3.5" style={{ color: '#9AB4A0' }} />
                </button>
              )}
            </div>
          </div>

          <div className="overflow-y-auto" style={{ maxHeight: 250 }}>
            {/* Groups with subsidiaries */}
            {groupCompanies.map(group => {
              const subsidiaries = selectableCompanies.filter(
                c => c.parent_id === group.id && filterMatch(c)
              )
              const groupMatch = filterMatch(group)
              if (!groupMatch && subsidiaries.length === 0) return null
              return (
                <div key={group.id}>
                  {/* Group header — not selectable */}
                  <div
                    className="flex items-center gap-2 px-4 py-2"
                    style={{ backgroundColor: '#F0FBF4', borderBottom: '1px solid #E2EAE5' }}
                  >
                    <span className="text-xs font-bold uppercase tracking-wide" style={{ color: '#0B7439' }}>
                      {group.name}
                    </span>
                    {group.code && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full font-bold"
                        style={{ backgroundColor: '#d4edda', color: '#0B7439' }}>
                        {group.code}
                      </span>
                    )}
                    <span className="text-xs ml-auto" style={{ color: '#6B9A7B' }}>
                      {subsidiaries.length} filiale{subsidiaries.length > 1 ? 's' : ''}
                    </span>
                  </div>
                  {/* Subsidiaries */}
                  {subsidiaries.map(sub => (
                    <button
                      key={sub.id}
                      type="button"
                      onMouseDown={() => { onChange(sub.id); setOpen(false); setSearch('') }}
                      className="w-full flex items-center gap-3 pl-8 pr-4 py-2.5 text-left transition-colors hover:bg-[#F0FBF4]"
                      style={{ backgroundColor: value === sub.id ? '#E8F5EC' : undefined }}
                    >
                      <span className="text-xs text-[#9AB4A0] flex-shrink-0">└</span>
                      <span className="text-sm font-medium flex-1" style={{ color: '#1A2E22' }}>{sub.name}</span>
                      {sub.code && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: value === sub.id ? '#0B7439' : '#E2EAE5', color: value === sub.id ? '#fff' : '#4A6B55' }}>
                          {sub.code}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )
            })}

            {/* Standalone companies (no parent, not a group) */}
            {(() => {
              const standalone = selectableCompanies.filter(
                c => !c.parent_id && filterMatch(c)
              )
              if (standalone.length === 0) return null
              return (
                <div>
                  <div
                    className="flex items-center gap-2 px-4 py-2"
                    style={{ backgroundColor: '#F4F7F5', borderBottom: '1px solid #E2EAE5', borderTop: '1px solid #E2EAE5' }}
                  >
                    <span className="text-xs font-bold uppercase tracking-wide" style={{ color: '#4A6B55' }}>
                      Autres sociétés
                    </span>
                  </div>
                  {standalone.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onMouseDown={() => { onChange(c.id); setOpen(false); setSearch('') }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[#F0FBF4]"
                      style={{ backgroundColor: value === c.id ? '#E8F5EC' : undefined }}
                    >
                      <Building2 className="w-4 h-4 flex-shrink-0" style={{ color: '#9AB4A0' }} />
                      <span className="text-sm font-medium flex-1" style={{ color: '#1A2E22' }}>{c.name}</span>
                      {c.code && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: value === c.id ? '#0B7439' : '#E2EAE5', color: value === c.id ? '#fff' : '#4A6B55' }}>
                          {c.code}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )
            })()}

            {/* Empty state */}
            {groupCompanies.every(g => {
              const subs = selectableCompanies.filter(c => c.parent_id === g.id && filterMatch(c))
              return !filterMatch(g) && subs.length === 0
            }) && selectableCompanies.filter(c => !c.parent_id && filterMatch(c)).length === 0 && (
              <p className="px-4 py-4 text-sm text-center" style={{ color: '#9AB4A0' }}>
                Aucune société trouvée
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────

type WizardStep = 1 | 2 | 3 | 4

const STEPS = [
  { id: 1, label: 'Infos générales' },
  { id: 2, label: 'Paramètres bus' },
  { id: 3, label: 'Plan de sièges' },
  { id: 4, label: 'Récapitulatif' },
]

function StepIndicator({ current, onGo }: { current: WizardStep; onGo: (s: WizardStep) => void }) {
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((step, idx) => {
        const isActive = step.id === current
        const isDone = step.id < current
        return (
          <React.Fragment key={step.id}>
            <button
              type="button"
              onClick={() => isDone && onGo(step.id as WizardStep)}
              disabled={!isDone && !isActive}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                isActive
                  ? 'bg-[#0B7439] text-white shadow-sm'
                  : isDone
                  ? 'bg-[#F0FBF4] text-[#0B7439] hover:bg-[#E2F4EA] cursor-pointer'
                  : 'bg-[#F4F7F5] text-[#9AB4A0] cursor-not-allowed'
              }`}
            >
              <span className={`w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center ${
                isActive ? 'bg-white/20' : isDone ? 'bg-[#0B7439] text-white' : 'bg-[#D1DFD6] text-[#7A9A84]'
              }`}>
                {isDone ? (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : step.id}
              </span>
              <span className="hidden sm:inline">{step.label}</span>
            </button>
            {idx < STEPS.length - 1 && (
              <div className={`h-px w-4 ${isDone ? 'bg-[#0B7439]' : 'bg-[#E2EAE5]'}`} />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

export default function BusWizard({
  editingId,
  initialGeneralData,
  companies,
  seatConfigs,
  amenities,
  existingConfig,
  onClose,
  onSaved,
}: BusWizardProps) {
  const [step, setStep] = useState<WizardStep>(1)
  const [isSaving, setIsSaving] = useState(false)

  const [generalData, setGeneralData] = useState<GeneralFormData>(initialGeneralData)

  const [params, setParams] = useState<BusParameters>(() => ({
    driverPosition: existingConfig?.driverPosition ?? 'gauche',
    deckType: existingConfig?.deckType ?? 'simple',
    sleepingType: existingConfig?.sleepingType ?? 'aucun',
    totalSeats: 50,
    maxCapacity: existingConfig?.maxCapacity ?? 50,
    seatsSoldFrom: existingConfig?.seatsSoldFrom ?? 1,
  }))

  const [deckParams, setDeckParams] = useState<DeckParameters>(() => ({
    rows: existingConfig?.totalRows ?? 10,
    cols: existingConfig ? existingConfig.totalCols - existingConfig.aisleAfterColumns.length : 4,
    aisleAfterCol: existingConfig?.aisleAfterColumns[0] ?? 2,
    hasBackRow: existingConfig?.hasBackRow ?? true,
    backRowSeats: existingConfig?.backRowSeats ?? 5,
  }))

  const [simpleDeck, setSimpleDeck] = useState(() => {
    if (existingConfig?.deckType === 'simple' && existingConfig.simpleLayout) {
      const aislePositions = existingConfig.aisleAfterColumns
      const totalCols = existingConfig.totalCols
      return {
        rows: existingConfig.totalRows,
        cols: totalCols,
        aislePositions,
        hasBackRow: existingConfig.hasBackRow,
        backRowSeats: existingConfig.backRowSeats,
        layout: existingConfig.simpleLayout,
      }
    }
    return defaultDeckConfig()
  })

  const [lowerDeck, setLowerDeck] = useState(() => {
    if (existingConfig?.deckType === 'imperial' && existingConfig.lowerLayout) {
      const aislePositions = existingConfig.aisleAfterColumns
      const totalCols = existingConfig.totalCols
      return {
        rows: existingConfig.totalRows,
        cols: totalCols,
        aislePositions,
        hasBackRow: existingConfig.hasBackRow,
        backRowSeats: existingConfig.backRowSeats,
        layout: existingConfig.lowerLayout,
      }
    }
    return defaultDeckConfig()
  })

  const [upperDeck, setUpperDeck] = useState(() => {
    if (existingConfig?.deckType === 'imperial' && existingConfig.upperLayout) {
      const aislePositions = existingConfig.aisleAfterColumns
      const totalCols = existingConfig.totalCols
      return {
        rows: existingConfig.totalRows,
        cols: totalCols,
        aislePositions,
        hasBackRow: existingConfig.hasBackRow,
        backRowSeats: existingConfig.backRowSeats,
        layout: existingConfig.upperLayout,
      }
    }
    return defaultDeckConfig()
  })

  const toggleAmenity = (id: string) => {
    setGeneralData(prev => ({
      ...prev,
      amenities: prev.amenities.includes(id)
        ? prev.amenities.filter(a => a !== id)
        : [...prev.amenities, id],
    }))
  }

  const buildLayoutFromDeckParams = (dp: DeckParameters): GridLayout => {
    const aislePositions = dp.aisleAfterCol > 0 ? [dp.aisleAfterCol] : []
    const totalCols = dp.cols + (dp.aisleAfterCol > 0 ? 1 : 0)
    const defaultSeatType = params.sleepingType === 'couchettes' ? 'couchette' : 'normal'
    let seatCounter = 1
    const layout: GridLayout = []
    for (let row = 1; row <= dp.rows; row++) {
      const cells = []
      for (let col = 1; col <= totalCols; col++) {
        const isAisle = aislePositions.includes(col - 1) && col > 1
        if (isAisle) {
          cells.push({ id: '', label: '', col, type: 'aisle' as const, is_empty: true, is_aisle: true, custom_price: null })
        } else {
          const label = `${seatCounter}`
          cells.push({ id: label, label, col, type: defaultSeatType as 'normal' | 'couchette', is_empty: false, is_aisle: false, custom_price: null })
          seatCounter++
        }
      }
      layout.push({ row, row_type: 'normal', cells })
    }
    if (dp.hasBackRow && dp.backRowSeats > 0) {
      const backCells = Array.from({ length: dp.backRowSeats }, (_, i) => ({
        id: `${seatCounter + i}`,
        label: `${seatCounter + i}`,
        col: i + 1,
        type: defaultSeatType as 'normal' | 'couchette',
        is_empty: false,
        is_aisle: false,
        custom_price: null,
      }))
      layout.push({ row: dp.rows + 1, row_type: 'back', cells: backCells })
    }
    return layout
  }

  const syncDeckConfigFromParams = (dp: DeckParameters) => {
    const aislePositions = dp.aisleAfterCol > 0 ? [dp.aisleAfterCol] : []
    const totalCols = dp.cols + (dp.aisleAfterCol > 0 ? 1 : 0)
    const base = { rows: dp.rows, cols: totalCols, aislePositions, hasBackRow: dp.hasBackRow, backRowSeats: dp.backRowSeats }
    return base
  }

  const handleGoToStep3 = () => {
    const base = syncDeckConfigFromParams(deckParams)
    const isSimple = params.deckType === 'simple'
    if (isSimple) {
      if (!simpleDeck.layout) {
        const layout = buildLayoutFromDeckParams(deckParams)
        const totalSeats = countReservableSeats(layout)
        setParams(prev => ({ ...prev, totalSeats }))
        setSimpleDeck({ ...base, layout })
      } else {
        setSimpleDeck(prev => ({ ...prev, ...base }))
      }
    } else {
      if (!lowerDeck.layout) {
        const layout = buildLayoutFromDeckParams(deckParams)
        setLowerDeck({ ...base, layout })
      } else {
        setLowerDeck(prev => ({ ...prev, ...base }))
      }
      if (!upperDeck.layout) {
        const layout = buildLayoutFromDeckParams(deckParams)
        setUpperDeck({ ...base, layout })
      } else {
        setUpperDeck(prev => ({ ...prev, ...base }))
      }
    }
    setStep(3)
  }

  const handleNextStep = () => {
    if (step === 1) {
      if (!generalData.registration_number || !generalData.company_id) {
        toast.error('Immatriculation et société sont obligatoires')
        return
      }
      setStep(2)
    } else if (step === 2) {
      handleGoToStep3()
    } else if (step === 3) {
      const isSimple = params.deckType === 'simple'
      const hasLayout = isSimple ? !!simpleDeck.layout : (!!lowerDeck.layout || !!upperDeck.layout)
      if (!hasLayout) {
        toast.error('Veuillez générer le plan de sièges avant de continuer')
        return
      }
      setStep(4)
    }
  }

  const handleSave = async () => {
    if (!generalData.registration_number || !generalData.company_id) {
      toast.error('Veuillez compléter les informations générales')
      setStep(1)
      return
    }

    const isSimple = params.deckType === 'simple'

    if (isSimple && !simpleDeck.layout) {
      toast.error('Veuillez générer le plan de sièges à l\'étape 3')
      setStep(3)
      return
    }

    if (!isSimple && !lowerDeck.layout && !upperDeck.layout) {
      toast.error('Veuillez configurer au moins un niveau à l\'étape 3')
      setStep(3)
      return
    }

    setIsSaving(true)
    try {
      const busData = {
        registration_number: generalData.registration_number,
        brand: generalData.brand,
        model: generalData.model,
        year: generalData.year,
        class: generalData.class,
        company_id: generalData.company_id,
        fuel_type: generalData.fuel_type,
        fuel_capacity: generalData.fuel_capacity,
        fuel_consumption: generalData.fuel_consumption,
        insurance_expiry: generalData.insurance_expiry || null,
        vignette_expiry: generalData.vignette_expiry || null,
        technical_inspection_expiry: generalData.technical_inspection_expiry || null,
        photo_url: generalData.photo_url || null,
        amenities: generalData.amenities,
        bus_deck_type: params.deckType,
        sleeping_type: params.sleepingType,
        max_allowed_capacity: params.maxCapacity,
        seats_sold_from: params.seatsSoldFrom,
      }

      const activeDeck = isSimple ? simpleDeck : lowerDeck
      const activeLayout = isSimple ? simpleDeck.layout! : (lowerDeck.layout ?? upperDeck.layout!)

      await saveBusWithSeatConfig({
        busData,
        layout: activeLayout,
        lowerLayout: isSimple ? undefined : lowerDeck.layout ?? undefined,
        upperLayout: isSimple ? undefined : upperDeck.layout ?? undefined,
        deckType: params.deckType,
        driverPosition: params.driverPosition,
        aisleAfterColumns: activeDeck.aislePositions,
        hasBackRow: activeDeck.hasBackRow,
        backRowSeats: activeDeck.backRowSeats,
        totalRows: activeDeck.rows,
        totalCols: activeDeck.cols,
        isUpdate: !!editingId,
        existingBusId: editingId ?? undefined,
        existingSeatConfigId: existingConfig?.seatConfigId,
        existingLowerConfigId: existingConfig?.lowerConfigId,
        existingUpperConfigId: existingConfig?.upperConfigId,
      })

      toast.success(editingId ? 'Bus mis à jour' : 'Bus créé avec succès')
      onSaved()
      onClose()
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors de la sauvegarde')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-4xl my-8 shadow-2xl">
        <div className="p-5 border-b border-[#E2EAE5] flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-[#1A2E22]">
              {editingId ? 'Modifier' : 'Nouveau'} bus
            </h2>
            <p className="text-sm text-[#4A6B55] mt-0.5">Configuration complète en 4 étapes</p>
          </div>
          <div className="flex items-center gap-4">
            <StepIndicator current={step} onGo={s => setStep(s)} />
            <button
              type="button"
              onClick={onClose}
              className="p-2 hover:bg-[#F4F7F5] rounded-lg transition-colors text-[#4A6B55]"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 min-h-[400px]">
          {step === 1 && (
            <div className="space-y-6">
              <h3 className="text-base font-bold text-[#1A2E22]">Informations générales</h3>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-[#1A2E22] mb-1.5">Immatriculation *</label>
                  <input
                    type="text"
                    value={generalData.registration_number}
                    onChange={e => setGeneralData({ ...generalData, registration_number: e.target.value })}
                    className="w-full px-4 py-2.5 border-2 border-[#E2EAE5] rounded-xl text-sm focus:outline-none focus:border-[#0B7439]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-[#1A2E22] mb-1.5">Société *</label>
                  <CompanyPicker
                    companies={companies}
                    value={generalData.company_id}
                    onChange={id => setGeneralData({ ...generalData, company_id: id })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-[#1A2E22] mb-1.5">Marque</label>
                  <input
                    type="text"
                    value={generalData.brand}
                    onChange={e => setGeneralData({ ...generalData, brand: e.target.value })}
                    className="w-full px-4 py-2.5 border-2 border-[#E2EAE5] rounded-xl text-sm focus:outline-none focus:border-[#0B7439]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-[#1A2E22] mb-1.5">Modèle</label>
                  <input
                    type="text"
                    value={generalData.model}
                    onChange={e => setGeneralData({ ...generalData, model: e.target.value })}
                    className="w-full px-4 py-2.5 border-2 border-[#E2EAE5] rounded-xl text-sm focus:outline-none focus:border-[#0B7439]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-[#1A2E22] mb-1.5">Année *</label>
                  <input
                    type="number"
                    value={generalData.year}
                    onChange={e => setGeneralData({ ...generalData, year: parseInt(e.target.value) })}
                    className="w-full px-4 py-2.5 border-2 border-[#E2EAE5] rounded-xl text-sm focus:outline-none focus:border-[#0B7439]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-[#1A2E22] mb-1.5">Classe *</label>
                  <select
                    value={generalData.class}
                    onChange={e => setGeneralData({ ...generalData, class: e.target.value as any })}
                    className="w-full px-4 py-2.5 border-2 border-[#E2EAE5] rounded-xl text-sm focus:outline-none focus:border-[#0B7439]"
                    required
                  >
                    <option value="standard">Standard</option>
                    <option value="vip">VIP</option>
                    <option value="executive">Executive</option>
                  </select>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-bold text-[#1A2E22] mb-3">Commodités</h4>
                <div className="grid grid-cols-3 gap-2">
                  {amenities.map(a => (
                    <label
                      key={a.id}
                      className="flex items-center gap-2 p-3 border-2 border-[#E2EAE5] rounded-xl cursor-pointer hover:border-[#0B7439] transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={generalData.amenities.includes(a.id)}
                        onChange={() => toggleAmenity(a.id)}
                        className="w-4 h-4 accent-[#0B7439]"
                      />
                      <span>{a.icon}</span>
                      <span className="text-sm">{a.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-sm font-bold text-[#1A2E22] mb-3">Carburant</h4>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-[#1A2E22] mb-1.5">Type</label>
                    <select
                      value={generalData.fuel_type}
                      onChange={e => setGeneralData({ ...generalData, fuel_type: e.target.value })}
                      className="w-full px-4 py-2.5 border-2 border-[#E2EAE5] rounded-xl text-sm focus:outline-none focus:border-[#0B7439]"
                    >
                      <option value="diesel">Diesel</option>
                      <option value="essence">Essence</option>
                      <option value="hybride">Hybride</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-[#1A2E22] mb-1.5">Réservoir (L)</label>
                    <input
                      type="number"
                      value={generalData.fuel_capacity}
                      onChange={e => setGeneralData({ ...generalData, fuel_capacity: parseFloat(e.target.value) })}
                      className="w-full px-4 py-2.5 border-2 border-[#E2EAE5] rounded-xl text-sm focus:outline-none focus:border-[#0B7439]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-[#1A2E22] mb-1.5">Consommation (L/100)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={generalData.fuel_consumption}
                      onChange={e => setGeneralData({ ...generalData, fuel_consumption: parseFloat(e.target.value) })}
                      className="w-full px-4 py-2.5 border-2 border-[#E2EAE5] rounded-xl text-sm focus:outline-none focus:border-[#0B7439]"
                    />
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-bold text-[#1A2E22] mb-3">Documents</h4>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-[#1A2E22] mb-1.5">Expiration assurance</label>
                    <input
                      type="date"
                      value={generalData.insurance_expiry}
                      onChange={e => setGeneralData({ ...generalData, insurance_expiry: e.target.value })}
                      className="w-full px-4 py-2.5 border-2 border-[#E2EAE5] rounded-xl text-sm focus:outline-none focus:border-[#0B7439]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-[#1A2E22] mb-1.5">Expiration vignette</label>
                    <input
                      type="date"
                      value={generalData.vignette_expiry}
                      onChange={e => setGeneralData({ ...generalData, vignette_expiry: e.target.value })}
                      className="w-full px-4 py-2.5 border-2 border-[#E2EAE5] rounded-xl text-sm focus:outline-none focus:border-[#0B7439]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-[#1A2E22] mb-1.5">Visite technique</label>
                    <input
                      type="date"
                      value={generalData.technical_inspection_expiry}
                      onChange={e => setGeneralData({ ...generalData, technical_inspection_expiry: e.target.value })}
                      className="w-full px-4 py-2.5 border-2 border-[#E2EAE5] rounded-xl text-sm focus:outline-none focus:border-[#0B7439]"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-[#1A2E22] mb-1.5">URL photo du bus</label>
                <input
                  type="url"
                  value={generalData.photo_url}
                  onChange={e => setGeneralData({ ...generalData, photo_url: e.target.value })}
                  className="w-full px-4 py-2.5 border-2 border-[#E2EAE5] rounded-xl text-sm focus:outline-none focus:border-[#0B7439]"
                  placeholder="https://..."
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <BusParametersStep
              params={params}
              onChange={setParams}
              deckParams={deckParams}
              onDeckParamsChange={setDeckParams}
            />
          )}

          {step === 3 && (
            <SeatPlanBuilder
              deckType={params.deckType}
              driverPosition={params.driverPosition}
              simpleDeck={simpleDeck}
              lowerDeck={lowerDeck}
              upperDeck={upperDeck}
              onSimpleChange={setSimpleDeck}
              onLowerChange={setLowerDeck}
              onUpperChange={setUpperDeck}
            />
          )}

          {step === 4 && (
            <BusSummaryStep
              generalInfo={generalData}
              params={params}
              simpleLayout={simpleDeck.layout}
              lowerLayout={lowerDeck.layout}
              upperLayout={upperDeck.layout}
              companies={companies}
              isSaving={isSaving}
              onSave={handleSave}
              onBack={() => setStep(3)}
            />
          )}
        </div>

        {step !== 4 && (
          <div className="px-6 py-4 border-t border-[#E2EAE5] flex justify-between items-center">
            <button
              type="button"
              onClick={() => step > 1 && setStep((step - 1) as WizardStep)}
              disabled={step === 1}
              className="px-5 py-2.5 border-2 border-[#E2EAE5] text-[#4A6B55] rounded-xl text-sm font-semibold hover:border-[#0B7439] hover:text-[#0B7439] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Précédent
            </button>
            <button
              type="button"
              onClick={handleNextStep}
              className="px-6 py-2.5 bg-[#0B7439] text-white rounded-xl text-sm font-bold hover:bg-[#085c2d] transition-colors"
            >
              {step === 2 ? 'Générer et voir le plan' : step === 3 ? 'Voir le récapitulatif' : 'Continuer'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
