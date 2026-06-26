import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, User, MapPin, Package, DollarSign, FileText, CheckCircle2, AlertTriangle, Camera, Bus as BusIcon, Search, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/services/supabase'
import { createParcel, fetchParcelAgentInfo } from '@/services/parcel.service'
import { sendCourierCreatedSms } from '@/services/emisSms.service'
import { buildReceiptData, printParcelTicket } from '@/utils/printParcelTicket'
import ParcelPhotoCapture from '@/components/parcel/ParcelPhotoCapture'
import type { ScheduledBus } from '@/components/parcel/BusSelector'
import type { ParcelNature, ParcelPriority, Parcel } from '@/types/parcel.types'

interface Station { id: string; name: string; city_name?: string }
interface BusOption { id: string; registration_number: string; brand: string | null; model: string | null }
interface DriverOption { id: string; full_name: string }

const NATURE_OPTIONS: { value: ParcelNature; label: string }[] = [
  { value: 'autre', label: 'Autre' },
  { value: 'electronique', label: 'Électronique' },
  { value: 'vetement', label: 'Vêtement' },
  { value: 'document', label: 'Document' },
  { value: 'alimentaire', label: 'Alimentaire' },
  { value: 'medicament', label: 'Médicament' },
  { value: 'electromenager', label: 'Électroménager' },
  { value: 'fragile', label: 'Fragile' },
]

const PRIORITY_OPTIONS: { value: ParcelPriority; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'fragile', label: 'Fragile' },
]

export default function NewParcelForm() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  const myStation: Station | null = user?.station_id
    ? { id: user.station_id, name: user.station_name ?? '' }
    : null
  const stationPhone = user?.station_phone ?? ''

  const [stations, setStations] = useState<Station[]>([])
  const [parcelPhotos, setParcelPhotos] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  // Bus search
  const [busSearch, setBusSearch] = useState('')
  const [busResults, setBusResults] = useState<BusOption[]>([])
  const [busLoading, setBusLoading] = useState(false)
  const [selectedBusOption, setSelectedBusOption] = useState<BusOption | null>(null)
  const [busDropdownOpen, setBusDropdownOpen] = useState(false)
  const busRef = useRef<HTMLDivElement>(null)

  // Driver search
  const [driverSearch, setDriverSearch] = useState('')
  const [driverResults, setDriverResults] = useState<DriverOption[]>([])
  const [driverLoading, setDriverLoading] = useState(false)
  const [selectedDriver, setSelectedDriver] = useState<DriverOption | null>(null)
  const [driverDropdownOpen, setDriverDropdownOpen] = useState(false)
  const driverRef = useRef<HTMLDivElement>(null)

  const [form, setForm] = useState({
    sender_name: '',
    sender_phone: '',
    recipient_name: '',
    recipient_phone: '',
    recipient_city: '',
    destination_station_id: '',
    declared_value: 0,
    delivery_fee: 1000,
    sms_tracking_fee: 100,
    priority: 'standard' as ParcelPriority,
    planned_date: '',
    nature: 'autre' as ParcelNature,
    content_description: '',
    notes: '',
  })

  useEffect(() => {
    async function loadStations() {
      const { data: stData } = await supabase
        .from('stations')
        .select('id, name, cities(name)')
        .eq('is_active', true)
        .order('name')
      setStations((stData ?? []).map((s: any) => ({ id: s.id, name: s.name, city_name: s.cities?.name ?? '' })))
    }
    loadStations()
  }, [])

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (busRef.current && !busRef.current.contains(e.target as Node)) setBusDropdownOpen(false)
      if (driverRef.current && !driverRef.current.contains(e.target as Node)) setDriverDropdownOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Bus search
  const searchBuses = useCallback(async (q: string) => {
    if (q.length < 2) { setBusResults([]); return }
    setBusLoading(true)
    try {
      const { data } = await supabase
        .from('buses')
        .select('id, registration_number, brand, model')
        .ilike('registration_number', `%${q}%`)
        .in('status', ['disponible', 'en_service'])
        .order('registration_number')
        .limit(10)
      setBusResults(data ?? [])
    } catch { setBusResults([]) }
    finally { setBusLoading(false) }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => searchBuses(busSearch), 300)
    return () => clearTimeout(t)
  }, [busSearch, searchBuses])

  // Driver search
  const searchDrivers = useCallback(async (q: string) => {
    if (q.length < 2) { setDriverResults([]); return }
    setDriverLoading(true)
    try {
      const { data } = await supabase
        .from('users')
        .select('id, full_name')
        .eq('role', 'chauffeur')
        .eq('is_active', true)
        .ilike('full_name', `%${q}%`)
        .order('full_name')
        .limit(10)
      setDriverResults(data ?? [])
    } catch { setDriverResults([]) }
    finally { setDriverLoading(false) }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => searchDrivers(driverSearch), 300)
    return () => clearTimeout(t)
  }, [driverSearch, searchDrivers])

  function set(field: string, value: unknown) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  // Build a ScheduledBus-compatible object for ticket printing
  const selectedBus: ScheduledBus | null = selectedBusOption ? {
    id: '',
    departure_datetime: '',
    arrival_datetime: null,
    estimated_duration_minutes: null,
    route_name: null,
    status: '',
    seats_available: null,
    seats_reserved: null,
    registration_number: selectedBusOption.registration_number,
    brand: selectedBusOption.brand,
    model: selectedBusOption.model,
    total_seats: null,
    company_name: null,
    driver_name: selectedDriver?.full_name ?? null,
    departure_station_id: '',
    arrival_station_id: '',
  } : null

  const total = Number(form.delivery_fee) + Number(form.sms_tracking_fee)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!myStation) { toast.error('Aucune gare associée à votre compte'); return }
    if (!form.recipient_name || !form.recipient_phone || !form.destination_station_id || !form.content_description) {
      toast.error('Veuillez remplir tous les champs obligatoires')
      return
    }

    setLoading(true)
    try {
      // Vérifier qu'un code agence est configuré pour cette destination
      const { data: destCode } = await supabase
        .from('station_destination_agency_codes')
        .select('agency_code')
        .eq('origin_station_id', myStation.id)
        .eq('destination_station_id', form.destination_station_id)
        .maybeSingle()

      if (!destCode?.agency_code) {
        toast('Aucun code agence configuré pour cette destination — le code agence général de la gare sera utilisé.', { icon: '⚠️' })
      }

      const parcel = await createParcel({
        sender_name:            form.sender_name,
        sender_phone:           form.sender_phone,
        sender_address:         null,
        recipient_name:         form.recipient_name,
        recipient_phone:        form.recipient_phone,
        recipient_city:         form.recipient_city,
        recipient_address:      null,
        origin_station_id:      myStation.id,
        destination_station_id: form.destination_station_id,
        declared_value:         Number(form.declared_value),
        delivery_fee:           Number(form.delivery_fee),
        sms_tracking_fee:       Number(form.sms_tracking_fee),
        priority:               form.priority,
        planned_date:           form.planned_date || null,
        schedule_id:            null,
        bus_id:                 selectedBusOption?.id || null,
        driver_id:              selectedDriver?.id || null,
        nature:                 form.nature,
        content_description:    form.content_description,
        parcel_photos:          parcelPhotos,
        notes:                  form.notes || null,
        company_id:             null,
      } as any)

      await supabase.from('parcel_tracking_events').insert({
        parcel_id:      parcel.id,
        event_type:     'enregistre',
        description:    'Courrier enregistré',
        station_id:     myStation.id,
        performer_name: user?.full_name ?? '',
      })

      toast.success('Courrier enregistré avec succès !')

      const agentInfo = await fetchParcelAgentInfo(myStation.id, form.destination_station_id).catch(() => null)
      await printParcelTicket(buildReceiptData(
        { ...parcel, origin_station_name: myStation.name } as Parcel,
        myStation.name,
        stationPhone,
        selectedBus,
        null,
        agentInfo,
      ))

      try {
        const smsResult = await sendCourierCreatedSms({
          id: parcel.id,
          parcel_code: parcel.parcel_code,
          recipient_name: parcel.recipient_name,
          recipient_phone: parcel.recipient_phone,
          recipient_city: parcel.recipient_city ?? form.recipient_city,
          tracking_url: parcel.tracking_url ?? '',
        })
        if (!smsResult.success && !smsResult.duplicate) {
          toast('Courrier enregistre, mais SMS non envoye.', { icon: '⚠️' })
        }
      } catch { /* SMS failure must not block */ }

      navigate('/agent-colis/dashboard')
    } catch (e: any) {
      toast.error(e.message ?? 'Erreur lors de l\'enregistrement')
    } finally {
      setLoading(false)
    }
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-green-500'
  const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }
  const labelCls = 'block text-xs font-semibold mb-1'
  const labelStyle = { color: 'var(--text-secondary)' }

  if (!myStation) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] p-4">
        <div className="w-full max-w-sm rounded-xl p-6 text-center" style={{ backgroundColor: 'var(--surface)', border: '2px solid #D97706' }}>
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: '#FEF3C7' }}>
            <AlertTriangle className="w-7 h-7" style={{ color: '#D97706' }} />
          </div>
          <h2 className="text-base font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Aucune gare rattachée</h2>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Aucune gare n'est rattachée à votre compte. Veuillez contacter l'administrateur.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="agent-colis-theme p-3 sm:p-4 lg:p-6 max-w-3xl mx-auto overflow-x-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-6">
        <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-gray-100 flex-shrink-0">
          <ArrowLeft className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
        </button>
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Nouveau Courrier</h1>
          <p className="text-xs sm:text-sm truncate" style={{ color: 'var(--text-muted)' }}>
            Gare de départ : {myStation?.name ?? '—'}
          </p>
        </div>
      </div>

      <form id="new-parcel-form" onSubmit={handleSubmit} className="space-y-4 sm:space-y-5 lg:space-y-6">

        {/* SECTION 1 — EXPÉDITEUR */}
        <section className="rounded-xl p-4 sm:p-5 space-y-3 sm:space-y-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 flex-shrink-0" style={{ color: '#0B7439' }} />
            <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Expéditeur</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls} style={labelStyle}>Nom complet *</label>
              <input className={inputCls} style={inputStyle} value={form.sender_name} onChange={e => set('sender_name', e.target.value)} required />
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>Téléphone *</label>
              <input className={inputCls} style={inputStyle} value={form.sender_phone} onChange={e => set('sender_phone', e.target.value)} required />
            </div>
          </div>
        </section>

        {/* SECTION 2 — DESTINATAIRE */}
        <section className="rounded-xl p-4 sm:p-5 space-y-3 sm:space-y-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 flex-shrink-0" style={{ color: '#1D6FA4' }} />
            <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Destinataire</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls} style={labelStyle}>Nom complet *</label>
              <input className={inputCls} style={inputStyle} value={form.recipient_name} onChange={e => set('recipient_name', e.target.value)} required />
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>Téléphone (SMS/WhatsApp) *</label>
              <input className={inputCls} style={inputStyle} value={form.recipient_phone} onChange={e => set('recipient_phone', e.target.value)} required />
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>Gare d'arrivée *</label>
              <select className={inputCls} style={inputStyle} value={form.destination_station_id} onChange={e => {
                const stationId = e.target.value
                const station = stations.find(s => s.id === stationId)
                setForm(prev => ({ ...prev, destination_station_id: stationId, recipient_city: station?.city_name ?? '' }))
              }} required>
                <option value="">Sélectionner une gare</option>
                {stations.filter(s => s.id !== myStation?.id).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>Ville de destination *</label>
              <input className={inputCls} style={{ ...inputStyle, backgroundColor: 'var(--bg-subtle)' }} value={form.recipient_city} readOnly tabIndex={-1} />
            </div>
          </div>
        </section>

        {/* SECTION 3 — DÉTAILS FINANCIERS & LOGISTIQUE */}
        <section className="rounded-xl p-4 sm:p-5 space-y-3 sm:space-y-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 flex-shrink-0" style={{ color: '#D97706' }} />
            <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Détails financiers & logistique</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls} style={labelStyle}>Valeur déclarée (FCFA)</label>
              <input type="number" min={0} className={inputCls} style={inputStyle} value={form.declared_value} onChange={e => set('declared_value', e.target.value)} />
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>Frais de livraison (FCFA) *</label>
              <input type="number" min={0} className={inputCls} style={inputStyle} value={form.delivery_fee} onChange={e => set('delivery_fee', e.target.value)} required />
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>Priorité</label>
              <select className={inputCls} style={inputStyle} value={form.priority} onChange={e => set('priority', e.target.value)}>
                {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            {/* Bus search */}
            {form.destination_station_id && (
              <div ref={busRef} className="relative">
                <label className={labelCls} style={labelStyle}>Bus (plaque d'immatriculation)</label>
                {selectedBusOption ? (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg border" style={{ borderColor: '#0B7439', backgroundColor: '#f0faf4' }}>
                    <BusIcon className="w-4 h-4 flex-shrink-0" style={{ color: '#0B7439' }} />
                    <span className="flex-1 text-sm font-semibold truncate" style={{ color: '#0B7439' }}>
                      {selectedBusOption.registration_number}
                      {selectedBusOption.brand ? ` — ${selectedBusOption.brand}` : ''}
                    </span>
                    <button type="button" onClick={() => { setSelectedBusOption(null); setBusSearch('') }} className="p-0.5 rounded hover:bg-green-100">
                      <X className="w-3.5 h-3.5" style={{ color: '#0B7439' }} />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                    <input
                      className={inputCls}
                      style={{ ...inputStyle, paddingLeft: '2rem' }}
                      placeholder="Rechercher par plaque..."
                      value={busSearch}
                      onChange={e => { setBusSearch(e.target.value); setBusDropdownOpen(true) }}
                      onFocus={() => busSearch.length >= 2 && setBusDropdownOpen(true)}
                    />
                  </div>
                )}
                {busDropdownOpen && !selectedBusOption && (
                  <div className="absolute z-20 left-0 right-0 mt-1 rounded-lg border overflow-hidden shadow-lg" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', maxHeight: 200, overflowY: 'auto' }}>
                    {busLoading && (
                      <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>Recherche...</div>
                    )}
                    {!busLoading && busSearch.length >= 2 && busResults.length === 0 && (
                      <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>Aucun bus trouvé</div>
                    )}
                    {busResults.map(b => (
                      <button
                        key={b.id}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b last:border-0 text-sm"
                        style={{ borderColor: 'var(--border)' }}
                        onClick={() => { setSelectedBusOption(b); setBusDropdownOpen(false); setBusSearch('') }}
                      >
                        <span className="font-mono font-bold" style={{ color: '#0B7439' }}>{b.registration_number}</span>
                        {b.brand && <span className="ml-2 text-xs" style={{ color: 'var(--text-secondary)' }}>{b.brand} {b.model ?? ''}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Driver search */}
            {form.destination_station_id && (
              <div ref={driverRef} className="relative">
                <label className={labelCls} style={labelStyle}>Chauffeur</label>
                {selectedDriver ? (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg border" style={{ borderColor: '#1D6FA4', backgroundColor: '#EFF6FF' }}>
                    <User className="w-4 h-4 flex-shrink-0" style={{ color: '#1D6FA4' }} />
                    <span className="flex-1 text-sm font-semibold truncate" style={{ color: '#1D6FA4' }}>
                      {selectedDriver.full_name}
                    </span>
                    <button type="button" onClick={() => { setSelectedDriver(null); setDriverSearch('') }} className="p-0.5 rounded hover:bg-blue-100">
                      <X className="w-3.5 h-3.5" style={{ color: '#1D6FA4' }} />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                    <input
                      className={inputCls}
                      style={{ ...inputStyle, paddingLeft: '2rem' }}
                      placeholder="Rechercher par nom..."
                      value={driverSearch}
                      onChange={e => { setDriverSearch(e.target.value); setDriverDropdownOpen(true) }}
                      onFocus={() => driverSearch.length >= 2 && setDriverDropdownOpen(true)}
                    />
                  </div>
                )}
                {driverDropdownOpen && !selectedDriver && (
                  <div className="absolute z-20 left-0 right-0 mt-1 rounded-lg border overflow-hidden shadow-lg" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', maxHeight: 200, overflowY: 'auto' }}>
                    {driverLoading && (
                      <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>Recherche...</div>
                    )}
                    {!driverLoading && driverSearch.length >= 2 && driverResults.length === 0 && (
                      <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>Aucun chauffeur trouvé</div>
                    )}
                    {driverResults.map(d => (
                      <button
                        key={d.id}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b last:border-0 text-sm"
                        style={{ borderColor: 'var(--border)' }}
                        onClick={() => { setSelectedDriver(d); setDriverDropdownOpen(false); setDriverSearch('') }}
                      >
                        <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{d.full_name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* SECTION 4 — PHOTO DU COLIS */}
        <section className="rounded-xl p-4 sm:p-5 space-y-3" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-1">
            <Camera className="w-4 h-4 flex-shrink-0" style={{ color: '#0B7439' }} />
            <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Photo du courrier</h2>
            <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)' }}>Optionnel — max 3 photos</span>
          </div>
          <ParcelPhotoCapture
            photos={parcelPhotos}
            onChange={setParcelPhotos}
            maxPhotos={3}
            disabled={loading}
          />
        </section>

        {/* SECTION 5 — DESCRIPTION DU COLIS */}
        <section className="rounded-xl p-4 sm:p-5 space-y-3 sm:space-y-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 flex-shrink-0" style={{ color: '#6B7280' }} />
            <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Description du courrier</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls} style={labelStyle}>Nature du courrier</label>
              <select className={inputCls} style={inputStyle} value={form.nature} onChange={e => set('nature', e.target.value)}>
                {NATURE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>Désignation / Contenu *</label>
              <input
                className={inputCls} style={inputStyle}
                placeholder="ex: 01 SHT BLC (HABIT)"
                value={form.content_description}
                onChange={e => set('content_description', e.target.value)}
                required
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls} style={labelStyle}>Notes (optionnel)</label>
              <textarea className={inputCls} style={inputStyle} rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
            </div>
          </div>
        </section>

        {/* SECTION 5 — RÉCAPITULATIF */}
        <section className="rounded-xl p-4 sm:p-5" style={{ backgroundColor: '#f0faf4', border: '2px solid #0B7439' }}>
          <div className="flex items-center gap-2 mb-3 sm:mb-4">
            <FileText className="w-4 h-4 flex-shrink-0" style={{ color: '#0B7439' }} />
            <h2 className="font-semibold text-sm" style={{ color: '#0B7439' }}>Récapitulatif</h2>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span style={{ color: '#374151' }}>Frais de livraison</span>
              <span className="font-medium">{Number(form.delivery_fee).toLocaleString('fr-CI')} FCFA</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: '#374151' }}>Frais SMS tracking</span>
              <span className="font-medium">{Number(form.sms_tracking_fee).toLocaleString('fr-CI')} FCFA</span>
            </div>
            <div className="border-t pt-2 mt-2 flex justify-between font-bold text-base" style={{ borderColor: '#0B7439' }}>
              <span style={{ color: '#0B7439' }}>TOTAL</span>
              <span style={{ color: '#0B7439' }}>{total.toLocaleString('fr-CI')} FCFA</span>
            </div>
          </div>
        </section>

        {/* Spacer so content isn't hidden behind the sticky bar on mobile */}
        <div className="h-32 lg:hidden" />
      </form>

      {/* Actions — sticky on mobile/tablet, inline on desktop */}
      <div
        className="sticky-form-actions flex flex-col sm:flex-row gap-2 sm:gap-3 sm:justify-end"
        style={{ backgroundColor: 'var(--bg-subtle)' }}
      >
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="w-full sm:w-auto px-5 py-2.5 rounded-lg border text-sm font-medium"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', backgroundColor: 'var(--surface)' }}
        >
          Annuler
        </button>
        <button
          type="submit"
          form="new-parcel-form"
          disabled={loading}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
          style={{ backgroundColor: '#0B7439', color: '#fff' }}
        >
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          {loading ? 'Enregistrement...' : 'Enregistrer + Imprimer'}
        </button>
      </div>
    </div>
  )
}
