import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Bus, MapPin, Droplets, DollarSign, Calendar, FileText, Search, AlertCircle, CheckCircle } from 'lucide-react'
import { supabase } from '../../services/supabase'
import { useAuthStore } from '../../store/authStore'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

interface BusOption {
  id: string
  registration_number: string
  brand: string
  model: string
  company_id: string
}

interface StationOption {
  id: string
  name: string
  code: string
  fuel_types: string[]
  price_essence: number | null
  price_gasoil: number | null
}

const FUEL_LABELS: Record<string, string> = { essence: 'Essence', gasoil: 'Gasoil' }
const FUEL_COLORS: Record<string, string> = { essence: '#F59E0B', gasoil: '#3B82F6' }

const inputCls = 'w-full px-3 py-2.5 border rounded-xl text-sm outline-none transition-colors'
  + ' focus:border-[#0B7439]'

export default function CarburantNewWithdrawal() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  const [buses,    setBuses]    = useState<BusOption[]>([])
  const [stations, setStations] = useState<StationOption[]>([])
  const [cities,   setCities]   = useState<string[]>([])

  // search state
  const [busSearch,          setBusSearch]          = useState('')
  const [showBusDropdown,    setShowBusDropdown]    = useState(false)
  const [citySearch,         setCitySearch]         = useState('')
  const [showCityDropdown,   setShowCityDropdown]   = useState(false)
  const [cityConfirmed,      setCityConfirmed]      = useState(false)

  // selected
  const [selectedBus,     setSelectedBus]     = useState<BusOption | null>(null)
  const [selectedStation, setSelectedStation] = useState<StationOption | null>(null)

  // form fields
  const [fuelType,        setFuelType]        = useState('')
  const [liters,          setLiters]          = useState('')
  const [withdrawalDate,  setWithdrawalDate]  = useState(format(new Date(), 'yyyy-MM-dd'))
  const [observations,    setObservations]    = useState('')
  const [saving,          setSaving]          = useState(false)

  useEffect(() => {
    const loadData = async () => {
      const [busRes, stnRes, cityRes] = await Promise.all([
        supabase.from('buses').select('id,registration_number,brand,model,company_id').eq('is_active', true).order('registration_number'),
        supabase.from('fuel_stations').select('id,name,code,fuel_types,price_essence,price_gasoil').eq('is_active', true).order('name'),
        supabase.from('cities').select('name').order('name'),
      ])
      if (busRes.data) setBuses(busRes.data as BusOption[])
      if (stnRes.data) setStations(stnRes.data as StationOption[])
      if (cityRes.data) setCities(cityRes.data.map((c: any) => c.name))
    }
    loadData()
  }, [])

  // derived
  const unitPrice: number | null = selectedStation && fuelType
    ? (fuelType === 'essence' ? selectedStation.price_essence : selectedStation.price_gasoil)
    : null

  const litersNum   = parseFloat(liters) || 0
  const totalAmount = unitPrice != null && litersNum > 0 ? unitPrice * litersNum : null
  const priceUndefined = selectedStation && fuelType && unitPrice == null

  const filteredBuses = buses.filter(b =>
    !busSearch || b.registration_number.toLowerCase().includes(busSearch.toLowerCase())
  )

  const selectBus = (bus: BusOption) => {
    setSelectedBus(bus)
    setBusSearch(bus.registration_number)
    setShowBusDropdown(false)
  }

  const selectStation = (station: StationOption) => {
    setSelectedStation(station)
    setFuelType('')
  }

  const validate = () => {
    if (!selectedBus)                        { toast.error('Sélectionnez un bus');                    return false }
    if (!selectedStation)                    { toast.error('Sélectionnez une station');                return false }
    if (!fuelType)                           { toast.error('Sélectionnez un type de carburant');       return false }
    if (!liters || litersNum < 1)            { toast.error('Le nombre de litres doit être ≥ 1');       return false }
    if (totalAmount == null)                 { toast.error('Montant non calculé — vérifiez le prix'); return false }
    return true
  }

  const handleSave = async () => {
    if (!validate()) return
    setSaving(true)
    try {
      const payload = {
        company_id:          selectedBus!.company_id,
        bus_id:              selectedBus!.id,
        registration_number: selectedBus!.registration_number,
        driver_id:           null,
        driver_name:         null,
        fuel_station_id:     selectedStation!.id,
        station_name:        selectedStation!.name,
        station_code:        selectedStation!.code,
        city:                cityConfirmed ? citySearch.trim() : null,
        fuel_type:           fuelType,
        liters:              litersNum,
        unit_price:          unitPrice,
        total_amount:        totalAmount!,
        withdrawal_date:     withdrawalDate,
        observations:        observations.trim() || null,
        created_by:          user?.id ?? null,
      }
      const { error } = await supabase.from('comptable_fuel_withdrawals').insert(payload)
      if (error) throw error
      toast.success('Prélèvement enregistré')
      navigate('/carburant/dashboard')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(msg || "Erreur lors de l'enregistrement")
    } finally {
      setSaving(false)
    }
  }

  const sectionHdr = (icon: React.ReactNode, title: string) => (
    <div className="flex items-center gap-2 mb-4">
      {icon}
      <h3 className="font-semibold text-sm uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>{title}</h3>
    </div>
  )

  const lbl = (text: string, required?: boolean) => (
    <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
      {text}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  )

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <button onClick={() => navigate('/carburant/dashboard')}
          className="p-2 rounded-xl hover:bg-gray-100 transition-colors"
          style={{ color: 'var(--text-secondary)' }}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl lg:text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Nouveau prélèvement carburant
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Enregistrez un prélèvement pour n'importe quel bus
          </p>
        </div>
      </div>

      <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="px-6 lg:px-8 py-6 space-y-6">

          {/* ── Véhicule ── */}
          <div>
            {sectionHdr(<Bus className="w-4 h-4" style={{ color: '#0B7439' }} />, 'Véhicule')}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Bus search */}
              <div>
                {lbl('Immatriculation', true)}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    value={busSearch}
                    onChange={e => { setBusSearch(e.target.value); setShowBusDropdown(true); setSelectedBus(null) }}
                    onFocus={() => setShowBusDropdown(true)}
                    onBlur={() => setTimeout(() => setShowBusDropdown(false), 150)}
                    placeholder="Rechercher par plaque…"
                    className="w-full pl-9 pr-3 py-2.5 border rounded-xl text-sm outline-none font-mono transition-colors"
                    style={{ borderColor: selectedBus ? '#0B7439' : 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
                  />
                  {showBusDropdown && filteredBuses.length > 0 && (
                    <div className="absolute top-full left-0 right-0 z-20 mt-1 rounded-xl border shadow-lg overflow-hidden"
                      style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
                      <div className="max-h-52 overflow-y-auto">
                        {filteredBuses.map(b => (
                          <button key={b.id} type="button" onMouseDown={() => selectBus(b)}
                            className="w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors"
                            style={{ color: 'var(--text-primary)' }}>
                            <span className="text-sm font-mono font-semibold">{b.registration_number}</span>
                            {(b.brand || b.model) && <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>{b.brand} {b.model}</span>}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {selectedBus && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <CheckCircle className="w-3.5 h-3.5 text-green-600" />
                    <span className="text-xs text-green-600">Bus sélectionné</span>
                  </div>
                )}
              </div>


            </div>
          </div>

          <div className="border-t" style={{ borderColor: 'var(--border)' }} />

          {/* ── Station & Carburant ── */}
          <div>
            {sectionHdr(<MapPin className="w-4 h-4" style={{ color: '#16A34A' }} />, 'Station & Carburant')}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                {lbl('Station', true)}
                <select
                  value={selectedStation?.id || ''}
                  onChange={e => { const s = stations.find(st => st.id === e.target.value) ?? null; if (s) selectStation(s); else { setSelectedStation(null); setFuelType('') } }}
                  className="w-full px-3 py-2.5 border rounded-xl text-sm transition-colors"
                  style={{ borderColor: selectedStation ? '#0B7439' : 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
                >
                  <option value="">Sélectionner une station</option>
                  {stations.map(s => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
                </select>
              </div>
              <div>
                {lbl('Ville')}
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                  <input type="text" value={citySearch}
                    onChange={e => { setCitySearch(e.target.value); setShowCityDropdown(true); setCityConfirmed(false) }}
                    onFocus={() => setShowCityDropdown(true)}
                    onBlur={() => setTimeout(() => setShowCityDropdown(false), 150)}
                    placeholder="Rechercher une ville…"
                    className="w-full pl-9 pr-3 py-2.5 border rounded-xl text-sm outline-none transition-colors"
                    style={{ borderColor: cityConfirmed ? '#0B7439' : 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
                  {showCityDropdown && citySearch.length > 0 && (
                    <div className="absolute top-full left-0 right-0 z-20 mt-1 rounded-xl border shadow-lg overflow-hidden"
                      style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
                      <div className="max-h-52 overflow-y-auto">
                        {cities.filter(c => c.toLowerCase().includes(citySearch.toLowerCase())).length > 0 ? (
                          cities.filter(c => c.toLowerCase().includes(citySearch.toLowerCase())).map(c => (
                            <button key={c} type="button"
                              onMouseDown={() => { setCitySearch(c); setCityConfirmed(true); setShowCityDropdown(false) }}
                              className="w-full text-left px-4 py-2.5 hover:bg-gray-50 text-sm transition-colors"
                              style={{ color: 'var(--text-primary)' }}>
                              {c}
                            </button>
                          ))
                        ) : (
                          <div className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>Aucune ville trouvée</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                {cityConfirmed && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <CheckCircle className="w-3.5 h-3.5 text-green-600" />
                    <span className="text-xs text-green-600">Ville sélectionnée</span>
                  </div>
                )}
              </div>
            </div>

            {selectedStation && (
              <div className="mt-4">
                {lbl('Type de carburant', true)}
                <div className="flex gap-3 flex-wrap">
                  {selectedStation.fuel_types.map(ft => {
                    const sel = fuelType === ft
                    return (
                      <button key={ft} type="button" onClick={() => setFuelType(ft)}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl border text-sm font-semibold transition-all"
                        style={{
                          borderColor: sel ? FUEL_COLORS[ft] : 'var(--border)',
                          backgroundColor: sel ? `${FUEL_COLORS[ft]}15` : 'transparent',
                          color: sel ? FUEL_COLORS[ft] : 'var(--text-secondary)',
                        }}>
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: sel ? FUEL_COLORS[ft] : '#D1D5DB' }} />
                        {FUEL_LABELS[ft] ?? ft}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="border-t" style={{ borderColor: 'var(--border)' }} />

          {/* ── Quantité & Montant ── */}
          <div>
            {sectionHdr(<Droplets className="w-4 h-4" style={{ color: '#3B82F6' }} />, 'Quantité & Montant')}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                {lbl('Litres prélevés', true)}
                <div className="relative">
                  <Droplets className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                  <input type="number" min={1} step="0.5" value={liters} onChange={e => setLiters(e.target.value)}
                    placeholder="0"
                    className="w-full pl-9 pr-3 py-2.5 border rounded-xl text-sm outline-none"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
                </div>
              </div>
              <div>
                {lbl('Prix unitaire (FCFA/L)')}
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                  <input type="text" readOnly
                    value={unitPrice != null ? `${unitPrice.toLocaleString('fr-FR')} FCFA/L` : '—'}
                    className="w-full pl-9 pr-3 py-2.5 border rounded-xl text-sm"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)', color: 'var(--text-secondary)' }} />
                </div>
              </div>
              <div>
                {lbl('Montant total', true)}
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: totalAmount != null ? '#0B7439' : 'var(--text-muted)' }} />
                  <input type="text" readOnly
                    value={totalAmount != null ? `${Math.round(totalAmount).toLocaleString('fr-FR')} FCFA` : '—'}
                    className="w-full pl-9 pr-3 py-2.5 border rounded-xl text-sm font-bold"
                    style={{
                      borderColor: totalAmount != null ? '#0B7439' : 'var(--border)',
                      backgroundColor: totalAmount != null ? '#F0FDF4' : 'var(--bg-subtle)',
                      color: totalAmount != null ? '#0B7439' : 'var(--text-muted)',
                    }} />
                </div>
              </div>
            </div>
            {priceUndefined && (
              <div className="mt-3 flex items-center gap-2 p-3 rounded-xl"
                style={{ backgroundColor: '#FEF3C7', border: '1px solid #FCD34D' }}>
                <AlertCircle className="w-4 h-4 flex-shrink-0 text-amber-600" />
                <p className="text-xs text-amber-700 font-medium">
                  Prix unitaire non défini pour ce type de carburant dans la station sélectionnée.
                </p>
              </div>
            )}
          </div>

          <div className="border-t" style={{ borderColor: 'var(--border)' }} />

          {/* ── Date & Observations ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              {lbl('Date du prélèvement', true)}
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                <input type="date" value={withdrawalDate} onChange={e => setWithdrawalDate(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 border rounded-xl text-sm outline-none"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
              </div>
            </div>
            <div>
              {lbl('Observations')}
              <div className="relative">
                <FileText className="absolute left-3 top-3 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                <textarea value={observations} onChange={e => setObservations(e.target.value)}
                  rows={3} placeholder="Remarques…"
                  className="w-full pl-9 pr-3 py-2.5 border rounded-xl text-sm resize-none outline-none"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 lg:px-8 py-6 border-t" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)' }}>
          <button onClick={() => navigate('/carburant/dashboard')}
            className="flex-1 px-4 py-3 rounded-xl border font-semibold text-sm transition-colors hover:bg-gray-50"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
            Annuler
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 px-4 py-3 rounded-xl text-white font-semibold text-sm disabled:opacity-50 transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#0B7439' }}>
            {saving ? 'Enregistrement…' : 'Enregistrer le prélèvement'}
          </button>
        </div>
      </div>
    </div>
  )
}
