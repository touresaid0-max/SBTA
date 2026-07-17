import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import {
  ChevronLeft, ChevronRight, Bus, Clock, Banknote,
  Plus, X, Loader2, RefreshCw, FileText, ChevronDown, ChevronUp,
  Utensils, Fuel, Route, MoreHorizontal, Lock,
} from 'lucide-react'
import { format, addDays, subDays, startOfDay } from 'date-fns'
import { fr } from 'date-fns/locale'
import { supabase } from '@/services/supabase'
import { createCounterCharge, fetchScheduleCharges, checkChargeExists } from '@/services/counter.service'
import type { ScheduleReceiptSummary, CounterCharge, ChargeType } from '@/types/counter.types'
import { CHARGE_LABELS } from '@/constants/charges'

// ── icône par type de charge ────────────────────────────────────
const CHARGE_ICONS: Record<ChargeType, React.ReactNode> = {
  ration:               <Utensils className="w-4 h-4" />,
  carburant_complement: <Fuel className="w-4 h-4" />,
  peage:                <Route className="w-4 h-4" />,
  autres:               <MoreHorizontal className="w-4 h-4" />,
}

const CHARGE_COLORS: Record<ChargeType, { bg: string; text: string; border: string }> = {
  ration:               { bg: '#FEF9C3', text: '#854D0E', border: '#FDE047' },
  carburant_complement: { bg: '#DBEAFE', text: '#1E40AF', border: '#93C5FD' },
  peage:                { bg: '#DCFCE7', text: '#166534', border: '#86EFAC' },
  autres:               { bg: '#F3F4F6', text: '#4B5563', border: '#D1D5DB' },
}

// ── Ligne départ expandable ─────────────────────────────────────
interface DepartureRowProps {
  dep: ScheduleReceiptSummary
  counterId: string
  stationId: string
  locked: boolean
  onChargesChange: (scheduleId: string, charges: CounterCharge[]) => void
}

const UNIQUE_CHARGE_TYPES: ChargeType[] = ['ration', 'carburant_complement', 'peage']

function DepartureRow({ dep, counterId, stationId, locked, onChargesChange }: DepartureRowProps) {
  const [expanded,    setExpanded]    = useState(false)
  const [charges,     setCharges]     = useState<CounterCharge[]>([])
  const [loadingCh,   setLoadingCh]   = useState(false)
  const [showForm,    setShowForm]    = useState(false)
  const [chargeType,  setChargeType]  = useState<ChargeType>('ration')
  const [description, setDescription] = useState('')
  const [amount,      setAmount]      = useState<number | ''>('')
  const [submitting,  setSubmitting]  = useState(false)

  const existingTypes = new Set(charges.map(c => c.charge_type))

  const loadCharges = useCallback(async () => {
    setLoadingCh(true)
    try {
      const data = await fetchScheduleCharges(dep.schedule_id)
      setCharges(data)
      onChargesChange(dep.schedule_id, data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingCh(false)
    }
  }, [dep.schedule_id, onChargesChange])

  useEffect(() => {
    if (expanded && charges.length === 0) loadCharges()
  }, [expanded])

  const handleSubmit = async () => {
    if (!amount || Number(amount) <= 0) { toast.error('Montant requis'); return }
    if (chargeType === 'autres' && !description.trim()) { toast.error('La description est obligatoire pour le type "Autres"'); return }
    setSubmitting(true)
    try {
      await createCounterCharge({
        schedule_id: dep.schedule_id,
        counter_id:  counterId,
        station_id:  stationId,
        bus_id:      dep.bus_id,
        charge_type: chargeType,
        description: description.trim(),
        amount:      Number(amount),
      })
      toast.success('Charge enregistrée')
      setAmount('')
      setDescription('')
      setShowForm(false)
      await loadCharges()
    } catch (e: any) {
      console.error(e)
      toast.error('Erreur : ' + (e.message ?? 'inconnue'))
    } finally {
      setSubmitting(false)
    }
  }

  const totalCharges = charges.reduce((s, c) => s + Number(c.amount), 0)
  const hasCharges   = charges.length > 0

  return (
    <div className={`border rounded-2xl overflow-hidden ${locked ? 'border-[#E2E8F0] bg-[#F9FAFB] opacity-70' : 'border-[#E2EAE5] bg-white'}`}>
      {/* En-tête de la ligne départ — toujours visible */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full text-left px-5 py-4 hover:bg-[#F8FAF8] transition-colors"
      >
        <div className="flex items-center gap-4 flex-wrap">
          {/* Lock indicator */}
          {locked && (
            <div className="flex-shrink-0">
              <Lock className="w-4 h-4 text-[#94A3B8]" />
            </div>
          )}
          {/* Numéro */}
          <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm
                          ${locked ? 'bg-[#94A3B8]' : 'bg-[#0B7439]'} text-white`}>
            {dep.departure_number ?? '—'}
          </div>

          {/* Heure + bus */}
          <div className="flex-shrink-0 min-w-[80px]">
            <div className="flex items-center gap-1 text-[#1A2E22] font-bold text-base">
              <Clock className="w-3.5 h-3.5 text-[#8AA898]" />
              {format(new Date(dep.departure_datetime), 'HH:mm')}
            </div>
            <p className="text-xs text-[#8AA898] mt-0.5 font-mono">{dep.registration_number}</p>
          </div>

          {/* Ligne / destination */}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-[#1A2E22] text-sm truncate">{dep.route_name}</p>
            <p className="text-xs text-[#8AA898]">
              {dep.origin_city} → {dep.destination_city}
              {dep.driver_name && dep.driver_name !== '—' && ` · Chauf. ${dep.driver_name}`}
            </p>
          </div>

          {/* Sièges */}
          <div className="flex-shrink-0 text-center">
            <p className="text-xs text-[#8AA898]">Sièges</p>
            <p className="font-bold text-sm text-[#1A2E22]">
              {dep.seats_sold}<span className="text-[#8AA898] font-normal">/{dep.capacity}</span>
            </p>
          </div>

          {/* Recettes */}
          <div className="flex-shrink-0 text-right">
            <p className="text-xs text-[#8AA898]">Recettes</p>
            <p className="font-bold text-sm text-[#059669]">
              {Number(dep.total_ticket_amount).toLocaleString('fr-CI')} F
            </p>
          </div>

          {/* Charges badge */}
          <div className="flex-shrink-0 text-right">
            <p className="text-xs text-[#8AA898]">Charges</p>
            <p className={`font-bold text-sm ${hasCharges || totalCharges > 0 ? 'text-[#AF3029]' : 'text-[#8AA898]'}`}>
              {Number(dep.total_charges).toLocaleString('fr-CI')} F
            </p>
          </div>

          {/* Solde */}
          <div className="flex-shrink-0 text-right">
            <p className="text-xs text-[#8AA898]">Solde</p>
            <p className="font-bold text-sm text-[#1D6FA4]">
              {Number(dep.solde_ticket).toLocaleString('fr-CI')} F
            </p>
          </div>

          {/* Flèche */}
          <div className="flex-shrink-0 text-[#8AA898]">
            {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </div>
        </div>
      </button>

      {/* Panneau expandable */}
      {expanded && (
        <div className="border-t border-[#E2EAE5] bg-[#FAFCFA] px-5 py-4">

          {/* Contexte bus */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 p-3 bg-white rounded-xl border border-[#E2EAE5]">
            {[
              { label: 'Bus',       value: dep.registration_number },
              { label: 'Capacité', value: `${dep.capacity} places` },
              { label: 'Chauffeur', value: dep.driver_name ?? '—' },
              { label: 'Prix/place', value: `${Number(dep.base_price).toLocaleString('fr-CI')} F` },
            ].map(item => (
              <div key={item.label}>
                <p className="text-xs text-[#8AA898]">{item.label}</p>
                <p className="font-semibold text-sm text-[#1A2E22]">{item.value}</p>
              </div>
            ))}
          </div>

          {/* Liste des charges existantes */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-bold text-sm text-[#1A2E22]">
                Charges saisies
                {charges.length > 0 && (
                  <span className="ml-2 text-xs font-normal text-[#8AA898]">({charges.length})</span>
                )}
              </h4>
              <button
                onClick={loadCharges}
                disabled={loadingCh}
                className="p-1.5 rounded-lg hover:bg-[#E2EAE5] text-[#6B7280] transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingCh ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {loadingCh ? (
              <div className="flex justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-[#0B7439]" />
              </div>
            ) : charges.length === 0 ? (
              <div className="text-center py-4 text-[#8AA898] text-sm bg-white rounded-xl border border-dashed border-[#E2EAE5]">
                Aucune charge pour ce départ
              </div>
            ) : (
              <div className="space-y-2">
                {charges.map(c => {
                  const col = CHARGE_COLORS[c.charge_type as ChargeType] ?? { bg: '#F4F7F5', text: '#4A6B55', border: '#E2EAE5' }
                  return (
                    <div key={c.id}
                      className="flex items-center justify-between bg-white rounded-xl px-4 py-3
                                 border border-[#E2EAE5]">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: col.bg, color: col.text }}>
                          {CHARGE_ICONS[c.charge_type as ChargeType]}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-[#1A2E22]">
                            {CHARGE_LABELS[c.charge_type] ?? c.charge_type}
                          </p>
                          {c.description && (
                            <p className="text-xs text-[#8AA898]">{c.description}</p>
                          )}
                          <p className="text-xs text-[#8AA898]">
                            {new Date(c.created_at).toLocaleTimeString('fr-CI', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className="font-bold text-[#AF3029]">
                          {Number(c.amount).toLocaleString('fr-CI')} F
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          c.status === 'valide'  ? 'bg-[#d4edda] text-[#0B7439]' :
                          c.status === 'rejete' ? 'bg-[#f8d7d5] text-[#AF3029]' :
                                                   'bg-[#FEF3C7] text-[#D97706]'
                        }`}>
                          {c.status === 'valide' ? 'Validé' : c.status === 'rejete' ? 'Rejeté' : 'En attente'}
                        </span>
                      </div>
                    </div>
                  )
                })}
                {/* Total charges */}
                <div className="flex justify-between px-4 py-2.5 bg-white rounded-xl border border-[#E2EAE5]">
                  <span className="text-sm text-[#4A6B55] font-medium">Total charges</span>
                  <span className="font-bold text-[#AF3029]">
                    {totalCharges.toLocaleString('fr-CI')} FCFA
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Formulaire d'ajout */}
          {showForm ? (
            <div className="bg-white rounded-2xl border border-[#E2EAE5] p-4">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-bold text-sm text-[#1A2E22]">Nouvelle charge</h4>
                <button
                  onClick={() => { setShowForm(false); setAmount(''); setDescription('') }}
                  className="p-1.5 rounded-lg hover:bg-[#F4F7F5] text-[#6B7280]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Sélection type */}
              <div className="grid grid-cols-4 gap-2 mb-3">
                {(Object.entries(CHARGE_LABELS) as [ChargeType, string][]).map(([val, label]) => {
                  const col = CHARGE_COLORS[val]
                  const alreadyUsed = UNIQUE_CHARGE_TYPES.includes(val) && existingTypes.has(val)
                  return (
                    <button
                      key={val}
                      type="button"
                      onClick={() => !alreadyUsed && setChargeType(val)}
                      disabled={alreadyUsed}
                      className={`py-3 rounded-xl text-xs font-semibold border-2 transition-all flex flex-col items-center gap-1.5 relative ${
                        alreadyUsed
                          ? 'border-[#E2EAE5] bg-[#F9FAFB] text-[#D1D5DB] cursor-not-allowed opacity-50'
                          : chargeType === val
                          ? 'border-[#0B7439] bg-[#d4edda] text-[#0B7439]'
                          : 'border-[#E2EAE5] bg-white text-[#4A6B55] hover:border-[#0B7439]'
                      }`}
                      title={alreadyUsed ? `${label} déjà enregistré pour ce voyage` : ''}
                    >
                      <span style={{ color: alreadyUsed ? '#D1D5DB' : chargeType === val ? '#0B7439' : col.text }}>
                        {CHARGE_ICONS[val]}
                      </span>
                      {label}
                      {alreadyUsed && (
                        <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#FEE2E2] text-[#DC2626] flex items-center justify-center text-[10px] font-bold">
                          ✓
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Warning if selected type already exists */}
              {UNIQUE_CHARGE_TYPES.includes(chargeType) && existingTypes.has(chargeType) && (
                <div className="mb-3 px-3 py-2 rounded-xl bg-[#FEF3C7] border border-[#FBBF24] text-[#92400E] text-xs font-medium">
                  Les {CHARGE_LABELS[chargeType].toLowerCase()} de ce voyage ont déjà été enregistrés.
                </div>
              )}

              {/* Description */}
              <input
                type="text"
                placeholder={chargeType === 'autres'
                  ? 'Description de la charge (obligatoire) *'
                  : 'Description (ex : Péage Singrobo, Ration chauffeur…)'}
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="w-full border rounded-xl px-4 py-2.5 text-sm mb-3
                           focus:outline-none focus:ring-2 focus:ring-[#0B7439] text-[#1A2E22]"
                style={{ borderColor: chargeType === 'autres' && !description.trim() ? '#FBBF24' : '#E2EAE5' }}
              />

              {/* Montant */}
              <div className="relative mb-4">
                <input
                  type="number"
                  min="0"
                  step="500"
                  placeholder="Montant"
                  value={amount}
                  onChange={e => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full border border-[#E2EAE5] rounded-xl px-4 py-2.5 text-sm pr-16
                             focus:outline-none focus:ring-2 focus:ring-[#0B7439] text-[#1A2E22]
                             [appearance:textfield]"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-[#8AA898]">FCFA</span>
              </div>

              {/* Bouton valider */}
              <button
                onClick={handleSubmit}
                disabled={
                  !amount || Number(amount) <= 0 || submitting ||
                  (chargeType === 'autres' && !description.trim()) ||
                  (UNIQUE_CHARGE_TYPES.includes(chargeType) && existingTypes.has(chargeType))
                }
                className="w-full h-11 rounded-xl bg-[#0B7439] hover:bg-[#085c2d] text-white font-bold
                           text-sm transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {submitting
                  ? <><Loader2 className="w-4 h-4 animate-spin" />Enregistrement…</>
                  : 'Enregistrer la charge'
                }
              </button>
            </div>
          ) : locked ? (
            <div className="w-full h-10 rounded-xl border-2 border-dashed border-[#D1D5DB] text-[#94A3B8]
                         font-semibold text-sm flex items-center justify-center gap-2">
              <Lock className="w-4 h-4" />
              Verrouillé (date passée)
            </div>
          ) : (
            <button
              onClick={() => {
                const allTypes: ChargeType[] = ['ration', 'carburant_complement', 'peage', 'autres']
                const firstAvailable = allTypes.find(t =>
                  !UNIQUE_CHARGE_TYPES.includes(t) || !existingTypes.has(t)
                ) ?? 'autres'
                setChargeType(firstAvailable)
                setShowForm(true)
              }}
              className="w-full h-10 rounded-xl border-2 border-dashed border-[#0B7439] text-[#0B7439]
                         font-semibold text-sm hover:bg-[#d4edda] transition-colors flex items-center
                         justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Ajouter une charge
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ══ PAGE PRINCIPALE ══════════════════════════════════════════════
export default function ChargesPage() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const [departures,   setDepartures]   = useState<ScheduleReceiptSummary[]>([])
  const [loading,      setLoading]      = useState(true)
  const [counterId,    setCounterId]    = useState<string>('')
  const [stationId,    setStationId]    = useState<string>('')
  const [stationName,  setStationName]  = useState<string>('')
  const [noCounter,    setNoCounter]    = useState(false)
  // Totaux calculés en temps réel depuis les charges chargées par les lignes
  const [chargesMap, setChargesMap] = useState<Record<string, CounterCharge[]>>({})

  const totalRecettes = departures.reduce((s, d) => s + Number(d.total_ticket_amount), 0)
  const totalCharges  = Object.values(chargesMap).flat().reduce((s, c) => s + Number(c.amount), 0)

  // ── Chargement info guichet ────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: counter } = await supabase
        .from('counters')
        .select('id, station_id, counter_number')
        .eq('assigned_user_id', user.id)
        .maybeSingle()

      if (!counter) { setNoCounter(true); setLoading(false); return }

      setCounterId(counter.id)
      setStationId(counter.station_id)

      // Auto-terminate past en_cours/retard schedules
      try {
        await supabase.rpc('auto_terminate_past_schedules', { p_station_id: counter.station_id });
      } catch (_) {}

      const { data: station } = await supabase
        .from('stations')
        .select('name')
        .eq('id', counter.station_id)
        .maybeSingle()
      setStationName(station?.name ?? counter.counter_number ?? '')
    })()
  }, [])

  // ── Chargement départs ─────────────────────────────────────────
  useEffect(() => {
    if (!stationId) return
    loadDepartures()
  }, [stationId, selectedDate])

  const loadDepartures = async () => {
    setLoading(true)
    setChargesMap({})
    try {
      const dateStr = format(selectedDate, 'yyyy-MM-dd')
      let query = supabase
        .from('schedule_receipt_summary')
        .select('*')
        .eq('station_id', stationId)
        .gte('departure_datetime', `${dateStr}T00:00:00`)
        .lte('departure_datetime', `${dateStr}T23:59:59`)
        .order('departure_datetime', { ascending: true })

      // Guichetier: see only departures assigned to their counter
      if (counterId) query = query.eq('counter_id', counterId)

      const { data, error } = await query
      if (error) throw error
      setDepartures(data ?? [])
    } catch (e: any) {
      console.error(e)
      toast.error('Erreur chargement des départs')
    } finally {
      setLoading(false)
    }
  }

  const handleChargesChange = useCallback((scheduleId: string, charges: CounterCharge[]) => {
    setChargesMap(prev => ({ ...prev, [scheduleId]: charges }))
  }, [])

  if (noCounter) {
    return (
      <div className="p-8 text-center">
        <Bus className="w-16 h-16 mx-auto mb-4 text-[#E2EAE5]" />
        <h2 className="text-xl font-bold text-[#1A2E22] mb-2">Aucun guichet assigné</h2>
        <p className="text-[#8AA898]">Contactez votre administrateur pour qu'il vous assigne un guichet.</p>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#1A2E22]">Gestion des charges</h1>
        <p className="text-sm text-[#6B7280] mt-0.5">
          {stationName && <span className="font-medium text-[#0B7439]">{stationName} · </span>}
          Rations, carburant complément, péages et autres par départ
        </p>
      </div>

      {/* Barre navigation date + KPIs */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] px-5 py-4">
        <div className="flex flex-wrap items-center gap-4 justify-between">
          {/* Sélecteur date */}
          <div className="flex items-center gap-2">
            <button onClick={() => setSelectedDate(d => subDays(d, 1))}
              className="p-2 rounded-xl hover:bg-[#F4F7F5] text-[#4A6B55] transition-colors border border-[#E2EAE5]">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <input
              type="date"
              value={format(selectedDate, 'yyyy-MM-dd')}
              onChange={e => e.target.value && setSelectedDate(new Date(e.target.value))}
              className="border border-[#E2EAE5] rounded-xl px-3 py-2 text-sm text-[#1A2E22]
                         focus:outline-none focus:ring-2 focus:ring-[#0B7439]"
            />
            <button onClick={() => setSelectedDate(d => addDays(d, 1))}
              className="p-2 rounded-xl hover:bg-[#F4F7F5] text-[#4A6B55] transition-colors border border-[#E2EAE5]">
              <ChevronRight className="w-4 h-4" />
            </button>
            <button onClick={() => setSelectedDate(new Date())}
              className="px-3 py-2 text-xs font-semibold rounded-xl bg-[#0B7439] text-white hover:bg-[#085c2d] transition-colors">
              Aujourd'hui
            </button>
            <button onClick={loadDepartures} disabled={loading}
              className="p-2 rounded-xl hover:bg-[#F4F7F5] text-[#4A6B55] transition-colors border border-[#E2EAE5]">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* KPIs */}
          <div className="flex gap-6 flex-wrap">
            <div>
              <p className="text-xs text-[#8AA898]">Départs</p>
              <p className="font-bold text-[#1A2E22]">{departures.length}</p>
            </div>
            <div>
              <p className="text-xs text-[#8AA898]">Recettes billets</p>
              <p className="font-bold text-[#059669]">{totalRecettes.toLocaleString('fr-CI')} F</p>
            </div>
            <div>
              <p className="text-xs text-[#8AA898]">Total charges</p>
              <p className={`font-bold ${totalCharges > 0 ? 'text-[#AF3029]' : 'text-[#8AA898]'}`}>
                {totalCharges.toLocaleString('fr-CI')} F
              </p>
            </div>
            <div>
              <p className="text-xs text-[#8AA898]">Solde net</p>
              <p className="font-bold text-[#1D6FA4]">
                {(totalRecettes - totalCharges).toLocaleString('fr-CI')} F
              </p>
            </div>
          </div>
        </div>

        {/* Légende types de charges */}
        <div className="flex gap-3 mt-4 pt-3 border-t border-[#F4F7F5]">
          {(Object.entries(CHARGE_LABELS) as [ChargeType, string][]).map(([type, label]) => {
            const col = CHARGE_COLORS[type]
            return (
              <div key={type} className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg"
                style={{ backgroundColor: col.bg, color: col.text }}>
                {CHARGE_ICONS[type]}
                {label}
              </div>
            )
          })}
        </div>
      </div>

      {/* Liste des départs */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-10 h-10 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : departures.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2EAE5] py-16 text-center">
          <FileText className="w-12 h-12 mx-auto mb-3 text-[#E2EAE5]" />
          <p className="font-semibold text-[#4A6B55]">
            Aucun départ le {format(selectedDate, 'EEEE d MMMM yyyy', { locale: fr })}
          </p>
          <p className="text-sm text-[#8AA898] mt-1">
            Naviguez vers une autre date ou vérifiez les plannings
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {departures.map(dep => (
            <DepartureRow
              key={dep.schedule_id}
              dep={dep}
              counterId={counterId}
              stationId={stationId}
              locked={selectedDate < startOfDay(new Date())}
              onChargesChange={handleChargesChange}
            />
          ))}
        </div>
      )}
    </div>
  )
}
