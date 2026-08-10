import { useState, useEffect, useRef, useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, MapPin, Droplets, DollarSign, Calendar,
  Search, AlertCircle, CheckCircle, Plus, Trash2, Save, Fuel,
} from 'lucide-react'
import { supabase } from '../../services/supabase'
import { useAuthStore } from '../../store/authStore'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

/* ─── types ──────────────────────────────────────────────── */

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

interface CityOption {
  id: string
  name: string
  region: string | null
}

interface FuelStationCity {
  fuel_station_id: string
  city_id: string
}

interface WithdrawalLine {
  key: string
  busSearch: string
  selectedBus: BusOption | null
  fuelType: string
  liters: string
  withdrawalDate: string
}

/* ─── constants ──────────────────────────────────────────── */

const FUEL_LABELS: Record<string, string> = { essence: 'Essence', gasoil: 'Gasoil' }
const FUEL_COLORS: Record<string, string> = { essence: '#F59E0B', gasoil: '#3B82F6' }

const inputCls =
  'w-full px-3 py-2.5 border rounded-xl text-sm outline-none transition-colors focus:border-[#0B7439]'

let lineCounter = 0
const makeLine = (): WithdrawalLine => ({
  key: `line-${++lineCounter}`,
  busSearch: '',
  selectedBus: null,
  fuelType: '',
  liters: '',
  withdrawalDate: format(new Date(), 'yyyy-MM-dd'),
})

/* ─── component ──────────────────────────────────────────── */

export default function CarburantNewWithdrawal() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  const [buses, setBuses] = useState<BusOption[]>([])
  const [allStations, setAllStations] = useState<StationOption[]>([])
  const [cities, setCities] = useState<CityOption[]>([])
  const [stationCityMap, setStationCityMap] = useState<Record<string, string[]>>({})

  // city autocomplete
  const [citySearch, setCitySearch] = useState('')
  const [showCityDropdown, setShowCityDropdown] = useState(false)
  const [selectedCity, setSelectedCity] = useState<CityOption | null>(null)

  // station
  const [selectedStation, setSelectedStation] = useState<StationOption | null>(null)

  // lines
  const [lines, setLines] = useState<WithdrawalLine[]>([makeLine()])
  const [openBusKey, setOpenBusKey] = useState<string | null>(null)
  const cityRef = useRef<HTMLDivElement>(null)

  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const loadData = async () => {
      const [busRes, stnRes, cityRes, assocRes] = await Promise.all([
        supabase
          .from('buses')
          .select('id,registration_number,brand,model,company_id')
          .eq('is_active', true)
          .order('registration_number'),
        supabase
          .from('fuel_stations')
          .select('id,name,code,fuel_types,price_essence,price_gasoil')
          .eq('is_active', true)
          .order('name'),
        supabase.from('cities').select('id,name,region').order('name'),
        supabase.from('fuel_station_cities').select('fuel_station_id,city_id'),
      ])
      if (busRes.data) setBuses(busRes.data as BusOption[])
      if (stnRes.data) setAllStations(stnRes.data as StationOption[])
      if (cityRes.data) setCities(cityRes.data as CityOption[])

      const map: Record<string, string[]> = {}
      ;(assocRes.data as FuelStationCity[])?.forEach(a => {
        if (!map[a.city_id]) map[a.city_id] = []
        map[a.city_id].push(a.fuel_station_id)
      })
      setStationCityMap(map)
    }
    loadData()
  }, [])

  // close city dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (cityRef.current && !cityRef.current.contains(e.target as Node)) {
        setShowCityDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  /* ─── derived: stations filtered by city ─── */

  const filteredStations = useMemo(() => {
    if (!selectedCity) return allStations
    const stationIds = stationCityMap[selectedCity.id] || []
    return allStations.filter(s => stationIds.includes(s.id))
  }, [allStations, selectedCity, stationCityMap])

  /* ─── city autocomplete ─── */

  const filteredCities = useMemo(() => {
    const q = citySearch.toLowerCase().trim()
    if (!q) return cities.slice(0, 20)
    return cities.filter(c => c.name.toLowerCase().includes(q) || (c.region ?? '').toLowerCase().includes(q)).slice(0, 20)
  }, [cities, citySearch])

  const selectCity = (city: CityOption) => {
    setSelectedCity(city)
    setCitySearch(city.name)
    setShowCityDropdown(false)
    setSelectedStation(null)
    setLines([makeLine()])
  }

  const selectStation = (stationId: string) => {
    const s = filteredStations.find(st => st.id === stationId) ?? null
    setSelectedStation(s)
    // reset fuel types in all lines since station changed
    setLines(prev => prev.map(l => ({ ...l, fuelType: '' })))
  }

  /* ─── line helpers ─── */

  const updateLine = (key: string, patch: Partial<WithdrawalLine>) => {
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)))
  }

  const addLine = () => {
    setLines(prev => [...prev, makeLine()])
  }

  const removeLine = (key: string) => {
    setLines(prev => {
      if (prev.length === 1) {
        toast.error('Au moins une ligne est requise')
        return prev
      }
      return prev.filter(l => l.key !== key)
    })
  }

  const selectBusForLine = (key: string, bus: BusOption) => {
    updateLine(key, { busSearch: bus.registration_number, selectedBus: bus })
    setOpenBusKey(null)
  }

  /* ─── price helpers ─── */

  const getUnitPrice = (fuelType: string): number | null => {
    if (!selectedStation || !fuelType) return null
    return fuelType === 'essence' ? selectedStation.price_essence : selectedStation.price_gasoil
  }

  const getLineTotal = (line: WithdrawalLine): number | null => {
    const price = getUnitPrice(line.fuelType)
    const lit = parseFloat(line.liters) || 0
    if (price == null || lit <= 0) return null
    return price * lit
  }

  /* ─── grand total ─── */

  const grandTotal = useMemo(() => {
    return lines.reduce((sum, l) => {
      const t = getLineTotal(l)
      return sum + (t ?? 0)
    }, 0)
  }, [lines, selectedStation])

  /* ─── validation & save ─── */

  const validate = (): boolean => {
    if (!selectedCity) { toast.error('Sélectionnez une ville'); return false }
    if (!selectedStation) { toast.error('Sélectionnez une station'); return false }

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      const n = i + 1
      if (!l.selectedBus) { toast.error(`Ligne ${n}: sélectionnez une immatriculation`); return false }
      if (!l.fuelType) { toast.error(`Ligne ${n}: sélectionnez un type de carburant`); return false }
      const lit = parseFloat(l.liters) || 0
      if (!l.liters || lit < 1) { toast.error(`Ligne ${n}: les litres doivent être ≥ 1`); return false }
      if (getUnitPrice(l.fuelType) == null) { toast.error(`Ligne ${n}: prix unitaire non défini pour ce carburant`); return false }
      if (!l.withdrawalDate) { toast.error(`Ligne ${n}: sélectionnez une date`); return false }
    }
    return true
  }

  const handleSave = async () => {
    if (!validate()) return
    setSaving(true)
    try {
      const payload = lines.map(l => ({
        company_id: l.selectedBus!.company_id,
        bus_id: l.selectedBus!.id,
        registration_number: l.selectedBus!.registration_number,
        driver_id: null,
        driver_name: null,
        fuel_station_id: selectedStation!.id,
        station_name: selectedStation!.name,
        station_code: selectedStation!.code,
        city: selectedCity?.name ?? null,
        fuel_type: l.fuelType,
        liters: parseFloat(l.liters) || 0,
        unit_price: getUnitPrice(l.fuelType),
        total_amount: getLineTotal(l)!,
        withdrawal_date: l.withdrawalDate,
        observations: null,
        created_by: user?.id ?? null,
      }))

      const { error } = await supabase.from('comptable_fuel_withdrawals').insert(payload)
      if (error) throw error
      toast.success(`${payload.length} prélèvement${payload.length > 1 ? 's' : ''} enregistré${payload.length > 1 ? 's' : ''}`)
      navigate('/carburant/dashboard')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(msg || "Erreur lors de l'enregistrement")
    } finally {
      setSaving(false)
    }
  }

  /* ─── UI bits ─── */

  const lbl = (text: string, required?: boolean) => (
    <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
      {text}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  )

  const sectionHdr = (icon: ReactNode, title: string, subtitle?: string) => (
    <div className="flex items-center gap-2 mb-4">
      {icon}
      <div>
        <h3 className="font-semibold text-sm uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
          {title}
        </h3>
        {subtitle && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{subtitle}</p>}
      </div>
    </div>
  )

  /* ─── render ──────────────────────────────────────────── */

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <button
          onClick={() => navigate('/carburant/dashboard')}
          className="p-2 rounded-xl hover:bg-gray-100 transition-colors"
          style={{ color: 'var(--text-secondary)' }}
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl lg:text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Nouveau prélèvement carburant
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Enregistrez plusieurs prélèvements pour une même station
          </p>
        </div>
      </div>

      <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="px-6 lg:px-8 py-6 space-y-6">

          {/* ── Étape 1: Ville + Station ── */}
          <div>
            {sectionHdr(
              <MapPin className="w-4 h-4" style={{ color: '#16A34A' }} />,
              'Ville & Station',
              'Sélectionnez d\'abord la ville, puis la station correspondante',
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Ville autocomplete */}
              <div className="relative" ref={cityRef}>
                {lbl('Ville', true)}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    value={citySearch}
                    onChange={e => {
                      setCitySearch(e.target.value)
                      setShowCityDropdown(true)
                      setSelectedCity(null)
                      setSelectedStation(null)
                    }}
                    onFocus={() => setShowCityDropdown(true)}
                    placeholder="Rechercher une ville…"
                    className="w-full pl-9 pr-3 py-2.5 border rounded-xl text-sm outline-none transition-colors"
                    style={{
                      borderColor: selectedCity ? '#0B7439' : 'var(--border)',
                      backgroundColor: 'var(--surface)',
                      color: 'var(--text-primary)',
                    }}
                  />
                </div>
                {showCityDropdown && (
                  <div className="absolute z-20 mt-1 w-full rounded-xl border shadow-lg max-h-52 overflow-y-auto"
                    style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
                    {filteredCities.length === 0 ? (
                      <div className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                        Aucune ville trouvée
                      </div>
                    ) : (
                      filteredCities.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          onMouseDown={() => selectCity(c)}
                          className="w-full text-left px-4 py-2.5 hover:bg-gray-50 text-sm transition-colors flex items-center gap-2"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          <MapPin className="w-3.5 h-3.5" style={{ color: '#3B82F6' }} />
                          <span className="font-medium">{c.name}</span>
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{c.region}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
                {selectedCity && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <CheckCircle className="w-3.5 h-3.5 text-green-600" />
                    <span className="text-xs text-green-600">Ville sélectionnée</span>
                  </div>
                )}
              </div>

              {/* Station select — disabled until city chosen */}
              <div>
                {lbl('Station', true)}
                <select
                  value={selectedStation?.id || ''}
                  onChange={e => selectStation(e.target.value)}
                  disabled={!selectedCity}
                  className="w-full px-3 py-2.5 border rounded-xl text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    borderColor: selectedStation ? '#0B7439' : 'var(--border)',
                    backgroundColor: 'var(--surface)',
                    color: 'var(--text-primary)',
                  }}
                >
                  <option value="">
                    {selectedCity
                      ? filteredStations.length > 0
                        ? 'Sélectionner une station'
                        : 'Aucune station pour cette ville'
                      : 'Sélectionnez d\'abord une ville'}
                  </option>
                  {filteredStations.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                  ))}
                </select>
                {selectedStation && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <CheckCircle className="w-3.5 h-3.5 text-green-600" />
                    <span className="text-xs text-green-600">
                      {selectedStation.name} — {selectedStation.fuel_types.map(ft => FUEL_LABELS[ft] ?? ft).join(' / ')}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="border-t" style={{ borderColor: 'var(--border)' }} />

          {/* ── Étape 2: Lignes de prélèvement ── */}
          {selectedStation ? (
            <div>
              {sectionHdr(
                <Droplets className="w-4 h-4" style={{ color: '#3B82F6' }} />,
                'Lignes de prélèvement',
                `${lines.length} ligne${lines.length > 1 ? 's' : ''} — rattachées à ${selectedStation.name}`,
              )}

              <div className="space-y-3">
                {lines.map((line, idx) => {
                  const unitPrice = getUnitPrice(line.fuelType)
                  const total = getLineTotal(line)
                  const priceUndefined = line.fuelType && unitPrice == null

                  return (
                    <div
                      key={line.key}
                      className="rounded-xl border p-4 transition-colors"
                      style={{
                        borderColor: 'var(--border)',
                        backgroundColor: idx % 2 === 0 ? 'var(--surface)' : 'var(--bg-subtle)',
                      }}
                    >
                      {/* line header */}
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-bold px-2.5 py-1 rounded-lg"
                          style={{ backgroundColor: '#0B743915', color: '#0B7439' }}>
                          Ligne {idx + 1}
                        </span>
                        {lines.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeLine(line.key)}
                            className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border transition-colors hover:bg-red-50"
                            style={{ borderColor: '#EF444440', color: '#EF4444' }}
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Retirer
                          </button>
                        )}
                      </div>

                      {/* line fields — responsive grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                        {/* Immatriculation with autocomplete */}
                        <div className="md:col-span-1">
                          {lbl('Immatriculation', true)}
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                            <input
                              type="text"
                              value={line.busSearch}
                              onChange={e => {
                                updateLine(line.key, { busSearch: e.target.value, selectedBus: null })
                                setOpenBusKey(line.key)
                              }}
                              onFocus={() => setOpenBusKey(line.key)}
                              onBlur={() => setTimeout(() => { if (openBusKey === line.key) setOpenBusKey(null) }, 150)}
                              placeholder="Rechercher…"
                              className="w-full pl-9 pr-3 py-2.5 border rounded-xl text-sm outline-none font-mono transition-colors"
                              style={{
                                borderColor: line.selectedBus ? '#0B7439' : 'var(--border)',
                                backgroundColor: 'var(--surface)',
                                color: 'var(--text-primary)',
                              }}
                            />
                            {openBusKey === line.key && (
                              <div className="absolute z-20 mt-1 w-full rounded-xl border shadow-lg max-h-48 overflow-y-auto"
                                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
                                {buses
                                  .filter(b => !line.busSearch || b.registration_number.toLowerCase().includes(line.busSearch.toLowerCase()))
                                  .slice(0, 12)
                                  .map(b => (
                                    <button
                                      key={b.id}
                                      type="button"
                                      onMouseDown={() => selectBusForLine(line.key, b)}
                                      className="w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors"
                                      style={{ color: 'var(--text-primary)' }}
                                    >
                                      <span className="text-sm font-mono font-semibold">{b.registration_number}</span>
                                      {(b.brand || b.model) && (
                                        <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>
                                          {b.brand} {b.model}
                                        </span>
                                      )}
                                    </button>
                                  ))}
                                {buses.filter(b => !line.busSearch || b.registration_number.toLowerCase().includes(line.busSearch.toLowerCase())).length === 0 && (
                                  <div className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                                    Aucun bus trouvé
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Type de carburant */}
                        <div>
                          {lbl('Carburant', true)}
                          <select
                            value={line.fuelType}
                            onChange={e => updateLine(line.key, { fuelType: e.target.value })}
                            className={inputCls}
                            style={{
                              borderColor: line.fuelType ? FUEL_COLORS[line.fuelType] : 'var(--border)',
                              backgroundColor: 'var(--surface)',
                              color: 'var(--text-primary)',
                            }}
                          >
                            <option value="">Type…</option>
                            {selectedStation.fuel_types.map(ft => (
                              <option key={ft} value={ft}>{FUEL_LABELS[ft] ?? ft}</option>
                            ))}
                          </select>
                        </div>

                        {/* Litres */}
                        <div>
                          {lbl('Litres', true)}
                          <div className="relative">
                            <Droplets className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                            <input
                              type="number"
                              min={1}
                              step="0.5"
                              value={line.liters}
                              onChange={e => updateLine(line.key, { liters: e.target.value })}
                              placeholder="0"
                              className="w-full pl-9 pr-3 py-2.5 border rounded-xl text-sm outline-none"
                              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
                            />
                          </div>
                        </div>

                        {/* Date */}
                        <div>
                          {lbl('Date', true)}
                          <div className="relative">
                            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                            <input
                              type="date"
                              value={line.withdrawalDate}
                              onChange={e => updateLine(line.key, { withdrawalDate: e.target.value })}
                              className="w-full pl-9 pr-3 py-2.5 border rounded-xl text-sm outline-none"
                              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
                            />
                          </div>
                        </div>
                      </div>

                      {/* price + total row */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                        <div>
                          {lbl('Prix unitaire (FCFA/L)')}
                          <div className="relative">
                            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                            <input
                              type="text"
                              readOnly
                              value={unitPrice != null ? `${unitPrice.toLocaleString('fr-FR')} FCFA/L` : '—'}
                              className="w-full pl-9 pr-3 py-2.5 border rounded-xl text-sm"
                              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}
                            />
                          </div>
                        </div>
                        <div>
                          {lbl('Montant total', true)}
                          <div className="relative">
                            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: total != null ? '#0B7439' : 'var(--text-muted)' }} />
                            <input
                              type="text"
                              readOnly
                              value={total != null ? `${Math.round(total).toLocaleString('fr-FR')} FCFA` : '—'}
                              className="w-full pl-9 pr-3 py-2.5 border rounded-xl text-sm font-bold"
                              style={{
                                borderColor: total != null ? '#0B7439' : 'var(--border)',
                                backgroundColor: total != null ? '#F0FDF4' : 'var(--bg-subtle)',
                                color: total != null ? '#0B7439' : 'var(--text-muted)',
                              }}
                            />
                          </div>
                        </div>
                      </div>

                      {priceUndefined && (
                        <div className="mt-3 flex items-center gap-2 p-3 rounded-xl"
                          style={{ backgroundColor: '#FEF3C7', border: '1px solid #FCD34D' }}>
                          <AlertCircle className="w-4 h-4 flex-shrink-0 text-amber-600" />
                          <p className="text-xs text-amber-700 font-medium">
                            Prix unitaire non défini pour ce carburant à cette station.
                          </p>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* add line button */}
              <button
                type="button"
                onClick={addLine}
                className="mt-4 flex items-center gap-2 px-5 py-2.5 rounded-xl border-2 border-dashed font-semibold text-sm transition-colors hover:bg-gray-50"
                style={{ borderColor: '#0B743950', color: '#0B7439' }}
              >
                <Plus className="w-4 h-4" /> Ajouter une ligne
              </button>

              {/* grand total */}
              <div className="mt-5 flex items-center justify-between p-4 rounded-xl"
                style={{ backgroundColor: '#F0FDF4', border: '1px solid #0B743930' }}>
                <div className="flex items-center gap-2">
                  <Fuel className="w-5 h-5" style={{ color: '#0B7439' }} />
                  <span className="text-sm font-semibold" style={{ color: '#0B7439' }}>
                    Total général ({lines.length} ligne{lines.length > 1 ? 's' : ''})
                  </span>
                </div>
                <span className="text-xl font-bold" style={{ color: '#0B7439' }}>
                  {Math.round(grandTotal).toLocaleString('fr-FR')} FCFA
                </span>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 border-2 border-dashed rounded-2xl"
              style={{ borderColor: 'var(--border)' }}>
              <MapPin className="w-10 h-10 mx-auto mb-3" style={{ color: '#D1D5DB' }} />
              <p className="font-semibold" style={{ color: 'var(--text-secondary)' }}>
                Sélectionnez une ville puis une station
              </p>
              <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                pour commencer à ajouter des lignes de prélèvement
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 lg:px-8 py-6 border-t" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)' }}>
          <button
            onClick={() => navigate('/carburant/dashboard')}
            className="flex-1 px-4 py-3 rounded-xl border font-semibold text-sm transition-colors hover:bg-gray-50"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !selectedStation}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-white font-semibold text-sm disabled:opacity-50 transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#0B7439' }}
          >
            <Save className="w-4 h-4" />
            {saving ? 'Enregistrement…' : `Enregistrer tous les prélèvements (${lines.length})`}
          </button>
        </div>
      </div>
    </div>
  )
}
