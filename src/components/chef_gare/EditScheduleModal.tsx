import { useState, useEffect, useMemo } from 'react'
import { X, Bus, User, MapPin, Clock, Loader2, AlertTriangle, CheckCircle2, Search } from 'lucide-react'
import { supabase } from '../../services/supabase'
import toast from 'react-hot-toast'

interface ScheduleData {
  id: string
  route_name: string
  departure_datetime: string
  arrival_datetime: string
  bus_registration: string
  bus_capacity: number
  driver_name: string
  seats_reserved: number
  status: string
}

interface RouteOption {
  id: string
  name: string
  estimated_duration_minutes: number | null
}

interface BusOption {
  id: string
  registration_number: string
  model: string
  brand: string
  capacity: number
  company_id: string
}

interface DriverOption {
  id: string
  full_name: string
  phone: string | null
}

interface Props {
  schedule: ScheduleData
  stationId: string
  userId: string
  onClose: () => void
  onSaved: () => void
}

export default function EditScheduleModal({ schedule, stationId, userId, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [routes, setRoutes] = useState<RouteOption[]>([])
  const [buses, setBuses] = useState<BusOption[]>([])
  const [drivers, setDrivers] = useState<DriverOption[]>([])

  // Current DB values (fetched fresh)
  const [currentRouteId, setCurrentRouteId] = useState<string>('')
  const [currentBusId, setCurrentBusId] = useState<string>('')
  const [currentDriverId, setCurrentDriverId] = useState<string>('')
  const [currentDeparture, setCurrentDeparture] = useState<string>('')

  // Form values
  const [routeId, setRouteId] = useState<string>('')
  const [busId, setBusId] = useState<string>('')
  const [driverId, setDriverId] = useState<string>('')
  const [departureTime, setDepartureTime] = useState<string>('')
  const [reason, setReason] = useState<string>('')

  // Search states
  const [busSearch, setBusSearch] = useState('')
  const [driverSearch, setDriverSearch] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)

    // Fetch the schedule's current full data
    const { data: sched } = await supabase
      .from('schedules')
      .select('route_id, bus_id, driver_id, departure_datetime, arrival_datetime, departure_station_id')
      .eq('id', schedule.id)
      .maybeSingle()

    if (!sched) {
      toast.error('Impossible de charger le depart')
      onClose()
      return
    }

    setCurrentRouteId(sched.route_id || '')
    setCurrentBusId(sched.bus_id || '')
    setCurrentDriverId(sched.driver_id || '')
    setCurrentDeparture(sched.departure_datetime || '')

    setRouteId(sched.route_id || '')
    setBusId(sched.bus_id || '')
    setDriverId(sched.driver_id || '')

    // Format departure time for input
    if (sched.departure_datetime) {
      const dt = new Date(sched.departure_datetime)
      setDepartureTime(`${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`)
    }

    // Load routes for this station
    const { data: stationData } = await supabase
      .from('stations')
      .select('city_id')
      .eq('id', stationId)
      .maybeSingle()

    const { data: routesData } = await supabase
      .from('routes')
      .select('id, name, estimated_duration_minutes')
      .eq('is_active', true)
      .order('name')

    setRoutes(routesData || [])

    // Load all active buses
    const { data: busesData } = await supabase
      .from('buses')
      .select('id, registration_number, model, brand, capacity, company_id')
      .eq('is_active', true)
      .in('status', ['disponible', 'en_service'])
      .order('registration_number')

    setBuses(busesData || [])

    // Load drivers
    const { data: driversData } = await supabase
      .from('users')
      .select('id, full_name, phone')
      .eq('role', 'chauffeur')
      .eq('is_active', true)
      .order('full_name')

    setDrivers(driversData || [])
    setLoading(false)
  }

  const selectedBus = useMemo(() => buses.find(b => b.id === busId), [buses, busId])
  const currentBus = useMemo(() => buses.find(b => b.id === currentBusId), [buses, currentBusId])

  const hasChanges = routeId !== currentRouteId || busId !== currentBusId ||
    driverId !== currentDriverId || departureTime !== formatTimeFromISO(currentDeparture)

  const busChanged = busId !== currentBusId
  const seatWarning = busChanged && selectedBus && currentBus &&
    selectedBus.capacity < schedule.seats_reserved

  const filteredBuses = useMemo(() => {
    if (!busSearch.trim()) return buses
    const q = busSearch.toLowerCase()
    return buses.filter(b =>
      b.registration_number.toLowerCase().includes(q) ||
      b.model?.toLowerCase().includes(q) ||
      b.brand?.toLowerCase().includes(q)
    )
  }, [buses, busSearch])

  const filteredDrivers = useMemo(() => {
    if (!driverSearch.trim()) return drivers
    const q = driverSearch.toLowerCase()
    return drivers.filter(d => d.full_name.toLowerCase().includes(q))
  }, [drivers, driverSearch])

  function formatTimeFromISO(iso: string): string {
    if (!iso) return ''
    const dt = new Date(iso)
    return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
  }

  async function handleSave() {
    if (!hasChanges) {
      toast('Aucune modification detectee')
      return
    }
    if (!reason.trim()) {
      toast.error('Veuillez indiquer le motif de la modification')
      return
    }
    if (seatWarning) {
      const confirm = window.confirm(
        `Attention : le nouveau vehicule n'a que ${selectedBus!.capacity} places mais ${schedule.seats_reserved} reservations existent deja. Les reservations excedentaires devront etre gerees manuellement. Continuer ?`
      )
      if (!confirm) return
    }

    setSaving(true)
    try {
      // Build update payload
      const update: Record<string, any> = { updated_at: new Date().toISOString() }

      if (routeId !== currentRouteId) {
        update.route_id = routeId
        // arrival_station will be derived from route; update to match
        const selectedRoute = routes.find(r => r.id === routeId)
        if (selectedRoute) {
          // The trigger auto_extract_route_info will update route_name automatically
        }
      }

      if (busId !== currentBusId) {
        update.bus_id = busId
        // Update seats_available based on new bus capacity
        const newBus = buses.find(b => b.id === busId)
        if (newBus) {
          const newAvailable = Math.max(0, newBus.capacity - schedule.seats_reserved)
          update.seats_available = newAvailable
        }
      }

      if (driverId !== currentDriverId) {
        update.driver_id = driverId
      }

      if (departureTime !== formatTimeFromISO(currentDeparture)) {
        // Reconstruct full datetime from selected date + new time
        const currentDt = new Date(currentDeparture)
        const [hours, minutes] = departureTime.split(':').map(Number)
        currentDt.setHours(hours, minutes, 0, 0)
        update.departure_datetime = currentDt.toISOString()

        // Update arrival based on estimated duration
        const selectedRoute = routes.find(r => r.id === routeId)
        const duration = selectedRoute?.estimated_duration_minutes || 180
        const arrivalDt = new Date(currentDt.getTime() + duration * 60000)
        update.arrival_datetime = arrivalDt.toISOString()
      }

      // Apply the update
      const { error } = await supabase
        .from('schedules')
        .update(update)
        .eq('id', schedule.id)

      if (error) throw error

      // Determine change type for audit log
      let changeType = 'multiple'
      const changes: string[] = []
      if (routeId !== currentRouteId) changes.push('route')
      if (busId !== currentBusId) changes.push('bus')
      if (driverId !== currentDriverId) changes.push('driver')
      if (departureTime !== formatTimeFromISO(currentDeparture)) changes.push('departure_time')
      if (changes.length === 1) changeType = changes[0]

      // Insert audit log
      await supabase.from('schedule_change_logs').insert({
        schedule_id: schedule.id,
        change_type: changeType,
        old_bus_id: busId !== currentBusId ? currentBusId || null : null,
        new_bus_id: busId !== currentBusId ? busId : null,
        old_driver_id: driverId !== currentDriverId ? currentDriverId || null : null,
        new_driver_id: driverId !== currentDriverId ? driverId : null,
        old_route_id: routeId !== currentRouteId ? currentRouteId || null : null,
        new_route_id: routeId !== currentRouteId ? routeId : null,
        old_departure_datetime: departureTime !== formatTimeFromISO(currentDeparture) ? currentDeparture : null,
        new_departure_datetime: update.departure_datetime || null,
        reason: reason.trim(),
        changed_by: userId,
      })

      toast.success('Depart modifie avec succes')
      onSaved()
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors de la modification')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-[#0B7439]/5 to-transparent">
          <div>
            <h2 className="text-lg font-bold text-[#1A2E22]">Modifier le depart</h2>
            <p className="text-xs text-[#6B7280] mt-0.5">
              {schedule.route_name} — {new Date(schedule.departure_datetime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
          <button onClick={onClose}
            className="p-2 rounded-xl hover:bg-gray-100 transition-colors">
            <X className="w-5 h-5 text-[#6B7280]" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-[#0B7439]" />
            </div>
          ) : (
            <>
              {/* Route */}
              <div>
                <label className="flex items-center gap-2 text-sm font-semibold text-[#1A2E22] mb-2">
                  <MapPin className="w-4 h-4 text-[#0B7439]" />
                  Ligne (itineraire)
                </label>
                <select value={routeId} onChange={e => setRouteId(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439] transition-all">
                  <option value="">— Selectionner une ligne —</option>
                  {routes.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
                {routeId !== currentRouteId && (
                  <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> La ligne sera modifiee
                  </p>
                )}
              </div>

              {/* Bus */}
              <div>
                <label className="flex items-center gap-2 text-sm font-semibold text-[#1A2E22] mb-2">
                  <Bus className="w-4 h-4 text-[#0B7439]" />
                  Vehicule (matricule)
                </label>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input type="text" value={busSearch} onChange={e => setBusSearch(e.target.value)}
                    placeholder="Rechercher un vehicule..."
                    className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#0B7439]/20" />
                </div>
                <select value={busId} onChange={e => setBusId(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439] transition-all"
                  size={Math.min(6, filteredBuses.length + 1)}>
                  {filteredBuses.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.registration_number} — {b.brand} {b.model} ({b.capacity} places)
                    </option>
                  ))}
                </select>
                {busChanged && selectedBus && (
                  <div className="mt-2 space-y-1">
                    <p className="text-xs text-amber-600 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      Changement de vehicule : {currentBus?.registration_number} → {selectedBus.registration_number}
                    </p>
                    <p className="text-xs text-gray-500">
                      Capacite : {selectedBus.capacity} places
                      {schedule.seats_reserved > 0 && ` | ${schedule.seats_reserved} reservation(s) existante(s)`}
                    </p>
                    {seatWarning && (
                      <p className="text-xs text-red-600 font-semibold flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        Le nouveau vehicule a moins de places que les reservations existantes !
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Driver */}
              <div>
                <label className="flex items-center gap-2 text-sm font-semibold text-[#1A2E22] mb-2">
                  <User className="w-4 h-4 text-[#0B7439]" />
                  Chauffeur
                </label>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input type="text" value={driverSearch} onChange={e => setDriverSearch(e.target.value)}
                    placeholder="Rechercher un chauffeur..."
                    className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#0B7439]/20" />
                </div>
                <select value={driverId} onChange={e => setDriverId(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439] transition-all"
                  size={Math.min(6, filteredDrivers.length + 1)}>
                  <option value="">— Selectionner un chauffeur —</option>
                  {filteredDrivers.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.full_name}{d.phone ? ` (${d.phone})` : ''}
                    </option>
                  ))}
                </select>
                {driverId !== currentDriverId && driverId && (
                  <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Le chauffeur sera change
                  </p>
                )}
              </div>

              {/* Departure time */}
              <div>
                <label className="flex items-center gap-2 text-sm font-semibold text-[#1A2E22] mb-2">
                  <Clock className="w-4 h-4 text-[#0B7439]" />
                  Heure de depart
                </label>
                <input type="time" value={departureTime} onChange={e => setDepartureTime(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439] transition-all" />
                {departureTime !== formatTimeFromISO(currentDeparture) && departureTime && (
                  <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    Heure modifiee : {formatTimeFromISO(currentDeparture)} → {departureTime}
                  </p>
                )}
              </div>

              {/* Reason */}
              <div>
                <label className="text-sm font-semibold text-[#1A2E22] mb-2 block">
                  Motif de la modification <span className="text-red-500">*</span>
                </label>
                <textarea value={reason} onChange={e => setReason(e.target.value)}
                  rows={2}
                  placeholder="Ex: Panne du vehicule, remplacement chauffeur, changement de planning..."
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439] transition-all resize-none" />
              </div>

              {/* Summary */}
              {hasChanges && (
                <div className="p-4 rounded-xl bg-blue-50 border border-blue-200">
                  <p className="text-sm font-semibold text-blue-800 mb-2">Resume des modifications :</p>
                  <ul className="text-xs text-blue-700 space-y-1">
                    {routeId !== currentRouteId && (
                      <li className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
                        Ligne : {routes.find(r => r.id === currentRouteId)?.name || '—'} → {routes.find(r => r.id === routeId)?.name || '—'}
                      </li>
                    )}
                    {busId !== currentBusId && (
                      <li className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
                        Vehicule : {currentBus?.registration_number || '—'} → {selectedBus?.registration_number || '—'}
                      </li>
                    )}
                    {driverId !== currentDriverId && (
                      <li className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
                        Chauffeur : {drivers.find(d => d.id === currentDriverId)?.full_name || '—'} → {drivers.find(d => d.id === driverId)?.full_name || '—'}
                      </li>
                    )}
                    {departureTime !== formatTimeFromISO(currentDeparture) && (
                      <li className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
                        Heure : {formatTimeFromISO(currentDeparture)} → {departureTime}
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50/50">
          <button onClick={onClose}
            className="px-5 py-2.5 rounded-xl text-sm font-medium text-[#6B7280] hover:bg-gray-100 transition-colors">
            Annuler
          </button>
          <button onClick={handleSave}
            disabled={saving || !hasChanges || !reason.trim() || loading}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: '#0B7439' }}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Enregistrer les modifications
          </button>
        </div>
      </div>
    </div>
  )
}
