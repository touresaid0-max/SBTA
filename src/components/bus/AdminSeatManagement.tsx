import { useState, useEffect, useCallback } from 'react'
import { X, Ban, XCircle, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react'
import { supabase } from '../../services/supabase'
import { fetchScheduleSeatMap } from '../../services/seatMap.service'
import type { EnrichedSeat, EnrichedRow, ScheduleSeatMap } from '../../types/seatMap.types'
import toast from 'react-hot-toast'

interface AdminSeatManagementProps {
  busId: string
  busRegistration: string
  onClose: () => void
}

type ActionType = 'cancel' | 'deactivate'

interface PendingAction {
  seat: EnrichedSeat
  action: ActionType
  reason: string
}

export default function AdminSeatManagement({ busId, busRegistration, onClose }: AdminSeatManagementProps) {
  const [scheduleId, setScheduleId] = useState<string | null>(null)
  const [scheduleInfo, setScheduleInfo] = useState<string>('')
  const [seatMap, setSeatMap] = useState<ScheduleSeatMap | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedSeats, setSelectedSeats] = useState<EnrichedSeat[]>([])
  const [showActionDialog, setShowActionDialog] = useState(false)
  const [actionType, setActionType] = useState<ActionType>('cancel')
  const [reason, setReason] = useState('')
  const [processing, setProcessing] = useState(false)
  const [noSchedule, setNoSchedule] = useState(false)

  useEffect(() => {
    loadActiveSchedule()
  }, [busId])

  const loadActiveSchedule = async () => {
    setLoading(true)
    const today = new Date().toISOString().split('T')[0]
    const { data, error } = await supabase
      .from('schedules')
      .select('id, route_name, departure_datetime, status')
      .eq('bus_id', busId)
      .gte('departure_datetime', `${today}T00:00:00`)
      .lte('departure_datetime', `${today}T23:59:59`)
      .in('status', ['planifie', 'en_cours', 'convoi', 'panne'])
      .order('departure_datetime', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (error || !data) {
      setNoSchedule(true)
      setLoading(false)
      return
    }

    setScheduleId(data.id)
    const time = data.departure_datetime ? new Date(data.departure_datetime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''
    setScheduleInfo(`${data.route_name ?? 'Trajet'} (${time})`)
    await loadSeatMap(data.id)
  }

  const loadSeatMap = async (schId: string) => {
    setLoading(true)
    const map = await fetchScheduleSeatMap(schId)
    setSeatMap(map)
    setLoading(false)
  }

  const handleSeatClick = useCallback((seat: EnrichedSeat) => {
    if (seat.status !== 'occupied' && seat.status !== 'online_reserved' && seat.status !== 'available' && seat.status !== 'out_of_service') return
    setSelectedSeats(prev => {
      const exists = prev.find(s => s.id === seat.id)
      if (exists) return prev.filter(s => s.id !== seat.id)
      return [...prev, seat]
    })
  }, [])

  const openAction = (type: ActionType) => {
    setActionType(type)
    setReason('')
    setShowActionDialog(true)
  }

  const executeAction = async () => {
    if (!scheduleId || selectedSeats.length === 0) return
    setProcessing(true)

    let successCount = 0
    let totalDeducted = 0

    for (const seat of selectedSeats) {
      if (actionType === 'cancel') {
        if (seat.status !== 'occupied' && seat.status !== 'online_reserved') continue
        if (!seat.reservation_id) continue
        const { data } = await supabase.rpc('admin_cancel_seat', {
          p_reservation_id: seat.reservation_id,
          p_schedule_id: scheduleId,
          p_seat_label: seat.label,
          p_reason: reason,
        })
        if (data?.success) {
          successCount++
          totalDeducted += Number(data.amount_deducted) || 0
        }
      } else {
        const { data } = await supabase.rpc('admin_deactivate_seat', {
          p_schedule_id: scheduleId,
          p_bus_id: busId,
          p_seat_label: seat.label,
          p_reason: reason,
        })
        if (data?.success) {
          successCount++
          totalDeducted += Number(data.amount_deducted) || 0
        }
      }
    }

    setProcessing(false)
    setShowActionDialog(false)
    setSelectedSeats([])

    if (successCount > 0) {
      const msg = actionType === 'cancel'
        ? `${successCount} siège(s) annulé(s) — ${totalDeducted.toLocaleString('fr-CI')} F déduits`
        : `${successCount} siège(s) désactivé(s)`
      toast.success(msg)
      if (scheduleId) await loadSeatMap(scheduleId)
    } else {
      toast.error('Aucune action effectuée')
    }
  }

  const getSeatStyle = (seat: EnrichedSeat) => {
    const isSelected = selectedSeats.some(s => s.id === seat.id)
    if (isSelected) return 'bg-red-500 border-red-600 text-white ring-2 ring-red-400 ring-offset-1 scale-105'
    switch (seat.status) {
      case 'occupied':
        return 'bg-slate-200 border-slate-400 text-slate-700 hover:bg-red-100 hover:border-red-300 cursor-pointer'
      case 'online_reserved':
        return 'bg-amber-100 border-amber-400 text-amber-800 hover:bg-red-100 hover:border-red-300 cursor-pointer'
      case 'out_of_service':
        return 'bg-gray-100 border-gray-300 text-gray-400 hover:bg-red-100 hover:border-red-300 cursor-pointer'
      case 'available':
        return 'bg-green-50 border-green-300 text-green-700 hover:bg-red-100 hover:border-red-300 cursor-pointer'
      default:
        return 'bg-white border-slate-200 text-slate-400 cursor-not-allowed'
    }
  }

  const occupiedSelected = selectedSeats.filter(s => s.status === 'occupied' || s.status === 'online_reserved')
  const canCancel = occupiedSelected.length > 0
  const canDeactivate = selectedSeats.length > 0

  if (noSchedule) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">Gestion des sièges</h2>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button>
          </div>
          <div className="text-center py-8">
            <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-3" />
            <p className="text-gray-600">Aucun trajet actif aujourd'hui pour le bus <strong>{busRegistration}</strong>.</p>
            <p className="text-sm text-gray-500 mt-2">La gestion des sièges n'est possible que lorsqu'un trajet est programmé.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Gestion des sièges — {busRegistration}</h2>
            {scheduleInfo && <p className="text-sm text-gray-500 mt-0.5">{scheduleInfo}</p>}
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 transition-colors"><X className="w-5 h-5" /></button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-[#0B7439]" />
            </div>
          ) : seatMap ? (
            <div className="space-y-4">
              {/* Stats */}
              <div className="grid grid-cols-4 gap-3">
                <div className="bg-green-50 rounded-xl p-3 text-center">
                  <div className="text-xl font-bold text-green-700">{seatMap.available_count}</div>
                  <div className="text-xs text-green-600">Disponibles</div>
                </div>
                <div className="bg-slate-100 rounded-xl p-3 text-center">
                  <div className="text-xl font-bold text-slate-700">{seatMap.occupied_count}</div>
                  <div className="text-xs text-slate-500">Vendus</div>
                </div>
                <div className="bg-gray-100 rounded-xl p-3 text-center">
                  <div className="text-xl font-bold text-gray-500">{seatMap.out_of_service_count}</div>
                  <div className="text-xs text-gray-400">HS</div>
                </div>
                <div className="bg-amber-50 rounded-xl p-3 text-center">
                  <div className="text-xl font-bold text-amber-700">
                    {seatMap.total_seats > 0 ? Math.round((seatMap.occupied_count / seatMap.total_seats) * 100) : 0}%
                  </div>
                  <div className="text-xs text-amber-600">Remplissage</div>
                </div>
              </div>

              {/* Legend */}
              <div className="flex flex-wrap gap-3 text-xs px-1">
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-50 border border-green-300" /> Disponible</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-200 border border-slate-400" /> Vendu</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-100 border border-amber-400" /> Reserv. en ligne</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-100 border border-gray-300" /> Hors service</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500 border border-red-600" /> Selection</span>
              </div>

              {/* Seat Grid */}
              <div className="border rounded-xl p-4 overflow-x-auto bg-slate-50">
                <div className="flex flex-col items-center gap-1.5 min-w-fit">
                  {/* Driver */}
                  <div className="flex items-center justify-center bg-slate-800 rounded-lg py-1.5 px-4 mb-2">
                    <span className="text-white text-xs font-semibold">CONDUCTEUR</span>
                  </div>

                  {seatMap.enriched_layout.filter(r => r.seats.some(s => s.side !== 'back')).map((row: EnrichedRow) => {
                    const leftSeats = row.seats.filter(s => s.side === 'left')
                    const rightSeats = row.seats.filter(s => s.side === 'right')
                    return (
                      <div key={row.row} className="flex items-center gap-1">
                        <span className="text-[10px] text-slate-400 w-4 text-right">{row.row}</span>
                        <div className="flex gap-1">
                          {leftSeats.map(seat => (
                            <button
                              key={seat.id}
                              onClick={() => handleSeatClick(seat)}
                              title={`${seat.label}${seat.passenger_name ? ` — ${seat.passenger_name}` : ''}${seat.status === 'out_of_service' ? ' (HS)' : ''}`}
                              className={`w-10 h-10 rounded-md border-2 flex items-center justify-center text-[10px] font-bold transition-all ${getSeatStyle(seat)}`}
                            >
                              {seat.status === 'out_of_service' ? '×' : seat.label}
                            </button>
                          ))}
                        </div>
                        <div className="w-5" />
                        <div className="flex gap-1">
                          {rightSeats.map(seat => (
                            <button
                              key={seat.id}
                              onClick={() => handleSeatClick(seat)}
                              title={`${seat.label}${seat.passenger_name ? ` — ${seat.passenger_name}` : ''}${seat.status === 'out_of_service' ? ' (HS)' : ''}`}
                              className={`w-10 h-10 rounded-md border-2 flex items-center justify-center text-[10px] font-bold transition-all ${getSeatStyle(seat)}`}
                            >
                              {seat.status === 'out_of_service' ? '×' : seat.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })}

                  {/* Back row */}
                  {seatMap.enriched_layout.filter(r => r.seats.every(s => s.side === 'back')).map((row: EnrichedRow) => (
                    <div key={`back-${row.row}`} className="flex gap-1 mt-2 border-t pt-2 border-dashed border-slate-300">
                      {row.seats.map(seat => (
                        <button
                          key={seat.id}
                          onClick={() => handleSeatClick(seat)}
                          title={`${seat.label}${seat.passenger_name ? ` — ${seat.passenger_name}` : ''}`}
                          className={`w-10 h-10 rounded-md border-2 flex items-center justify-center text-[10px] font-bold transition-all ${getSeatStyle(seat)}`}
                        >
                          {seat.status === 'out_of_service' ? '×' : seat.label}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">Impossible de charger le plan des sièges.</div>
          )}
        </div>

        {/* Footer actions */}
        {selectedSeats.length > 0 && (
          <div className="border-t p-4 bg-gray-50 rounded-b-2xl">
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <span className="font-medium text-gray-700">{selectedSeats.length} siège(s) sélectionné(s)</span>
                {occupiedSelected.length > 0 && (
                  <span className="text-gray-500 ml-2">
                    ({occupiedSelected.reduce((s, seat) => s + seat.price, 0).toLocaleString('fr-CI')} F)
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedSeats([])}
                  className="px-3 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-100 transition-colors"
                >
                  Tout desélectionner
                </button>
                {canCancel && (
                  <button
                    onClick={() => openAction('cancel')}
                    className="px-4 py-2 text-sm rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors flex items-center gap-2"
                  >
                    <XCircle className="w-4 h-4" />
                    Annuler ({occupiedSelected.length})
                  </button>
                )}
                {canDeactivate && (
                  <button
                    onClick={() => openAction('deactivate')}
                    className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors flex items-center gap-2"
                  >
                    <Ban className="w-4 h-4" />
                    Désactiver ({selectedSeats.length})
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Confirm dialog */}
      {showActionDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowActionDialog(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              {actionType === 'cancel' ? (
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                  <XCircle className="w-5 h-5 text-amber-600" />
                </div>
              ) : (
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                  <Ban className="w-5 h-5 text-red-600" />
                </div>
              )}
              <div>
                <h3 className="font-bold text-gray-900">
                  {actionType === 'cancel' ? 'Confirmer l\'annulation' : 'Confirmer la désactivation'}
                </h3>
                <p className="text-sm text-gray-500">
                  {actionType === 'cancel'
                    ? `${occupiedSelected.length} siège(s) seront libérés et le montant déduit des recettes.`
                    : `${selectedSeats.length} siège(s) seront marqués hors service et ne pourront plus être vendus.`
                  }
                </p>
              </div>
            </div>

            {actionType === 'cancel' && occupiedSelected.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                <div className="text-sm font-medium text-amber-800 mb-1">Sièges a annuler:</div>
                <div className="flex flex-wrap gap-1">
                  {occupiedSelected.map(s => (
                    <span key={s.id} className="px-2 py-0.5 bg-amber-200 text-amber-900 rounded text-xs font-medium">
                      {s.label} {s.passenger_name ? `(${s.passenger_name})` : ''}
                    </span>
                  ))}
                </div>
                <div className="text-sm font-bold text-amber-900 mt-2">
                  Montant a deduire: {occupiedSelected.reduce((s, seat) => s + seat.price, 0).toLocaleString('fr-CI')} F
                </div>
              </div>
            )}

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Motif *</label>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                rows={3}
                placeholder="Indiquez le motif de cette action..."
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-[#0B7439] focus:border-transparent"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowActionDialog(false)}
                className="flex-1 px-4 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-50"
              >
                Retour
              </button>
              <button
                onClick={executeAction}
                disabled={processing || !reason.trim()}
                className={`flex-1 px-4 py-2 text-sm rounded-lg text-white flex items-center justify-center gap-2 ${
                  actionType === 'cancel'
                    ? 'bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300'
                    : 'bg-red-600 hover:bg-red-700 disabled:bg-red-300'
                }`}
              >
                {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                {processing ? 'En cours...' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
