import { useState } from 'react'
import { useSeatMap } from '../../hooks/useSeatMap'
import { SeatMap } from '../../components/bus/SeatMap'
import { SeatSelectionSummary } from '../../components/bus/SeatSelectionSummary'
import { isSeatStillAvailable } from '../../services/seatMap.service'
import { supabase } from '../../services/supabase'
import { toast } from 'react-hot-toast'
import type { EnrichedSeat } from '../../types/seatMap.types'
import { formatCurrency } from '../../utils/formatCurrency'
import { useAuthStore } from '../../store/authStore'
import { generateBookingReference } from '../../utils/generateBookingReference'

interface BookingWithSeatMapProps {
  scheduleId: string
  onBookingComplete: (reservationIds: string[]) => void
}

interface PassengerForm {
  seat: EnrichedSeat
  passenger_name: string
  passenger_phone: string
  passenger_id_number: string
}

export function BookingWithSeatMap({ scheduleId, onBookingComplete }: BookingWithSeatMapProps) {
  const [selectedDeck, setSelectedDeck] = useState<'lower' | 'upper'>('lower')

  const deckLevel = selectedDeck === 'upper' ? 'upper' : 'lower'

  const {
    seatMap, isLoading, error,
    selectedSeats, toggleSeat, clearSelection, totalSelectedPrice,
    lockCountdowns,
  } = useSeatMap({ scheduleId, enableRealtime: true, deckLevel })

  const isImperial = seatMap?.bus_deck_type === 'imperial'

  const [step, setStep] = useState<'seat_selection' | 'passenger_forms' | 'payment'>('seat_selection')
  const [passengerForms, setPassengerForms] = useState<PassengerForm[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleConfirmSeats = () => {
    const forms: PassengerForm[] = selectedSeats.map(seat => ({
      seat,
      passenger_name: '',
      passenger_phone: '',
      passenger_id_number: '',
    }))
    setPassengerForms(forms)
    setStep('passenger_forms')
  }

  const handleSubmitReservations = async () => {
    setIsSubmitting(true)
    try {
      // Server-side timestamp validation before sale
      try {
        const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/validate-ticket-sale`
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token

        const validationRes = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            schedule_id: scheduleId,
            client_timestamp: new Date().toISOString(),
          }),
        })

        const validationData = await validationRes.json()
        if (!validationData.allowed) {
          toast.error(validationData.reason || 'Vente impossible : la date de vente doit correspondre à la date système serveur.')
          setIsSubmitting(false)
          return
        }
      } catch (validationErr) {
        // Fallback: check server time via RPC
        try {
          const { data: serverTimeData } = await supabase.rpc('get_server_time')
          if (serverTimeData) {
            // Fetch schedule departure to compare
            const { data: sched } = await supabase
              .from('schedules')
              .select('departure_datetime')
              .eq('id', scheduleId)
              .maybeSingle()
            if (sched && new Date(sched.departure_datetime) <= new Date(serverTimeData)) {
              toast.error('Vente impossible : la date de vente doit correspondre à la date système serveur.')
              setIsSubmitting(false)
              return
            }
          }
        } catch (_) {}
      }

      const availabilityChecks = await Promise.all(
        passengerForms.map(f => isSeatStillAvailable(scheduleId, f.seat.id))
      )
      const firstUnavailableIndex = availabilityChecks.findIndex(ok => !ok)

      if (firstUnavailableIndex !== -1) {
        const seatLabel = passengerForms[firstUnavailableIndex].seat.label
        toast.error(`Le siège ${seatLabel} vient d'être réservé. Veuillez en choisir un autre.`)
        clearSelection()
        setStep('seat_selection')
        return
      }

      const reservationsToInsert = passengerForms.map(f => ({
        schedule_id: scheduleId,
        seat_numbers: [f.seat.id],
        total_seats: 1,
        total_price: f.seat.price,
        passenger_name: f.passenger_name,
        passenger_phone: f.passenger_phone,
        status: 'confirmee',
        payment_status: 'payee',
        booking_reference: generateBookingReference(),
      }))

      const { data: createdReservations, error: insertError } = await supabase
        .from('reservations')
        .insert(reservationsToInsert)
        .select('id, booking_reference, seat_numbers')

      if (insertError) {
        if (insertError.code === '23505' || insertError.message?.toLowerCase().includes('unique')) {
          toast.error('Ce siège vient d\'être vendu par un autre guichet. Veuillez choisir un autre siège.')
          clearSelection()
          setStep('seat_selection')
          return
        }
        throw insertError
      }

      toast.success(`${createdReservations.length} réservation(s) créée(s) avec succès !`)
      onBookingComplete(createdReservations.map(r => r.id))
      clearSelection()
      setStep('seat_selection')

    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erreur lors de la réservation')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <div className="animate-spin w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full" />
      <p className="text-sm text-[#4A6B55]">Chargement du plan de sièges...</p>
    </div>
  )

  if (error) return (
    <div className="bg-[#f8d7d5] border border-[#AF3029] rounded-xl p-4 text-[#AF3029] text-sm">
      {error}
    </div>
  )

  if (!seatMap) return null

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-[#1A2E22] text-lg">Plan du bus</h2>
          <div className="flex gap-2 text-xs text-[#4A6B55]">
            <span className="font-semibold text-[#0B7439]">{seatMap.available_count}</span> disponibles
            <span>·</span>
            <span className="font-semibold text-[#AF3029]">{seatMap.occupied_count}</span> occupés
          </div>
        </div>

        {isImperial && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setSelectedDeck('lower'); clearSelection(); }}
              className={`flex-1 py-2 px-4 rounded-xl text-sm font-semibold border-2 transition-colors ${
                selectedDeck === 'lower'
                  ? 'bg-[#0B7439] border-[#0B7439] text-white'
                  : 'bg-white border-[#E2EAE5] text-[#4A6B55] hover:border-[#0B7439]'
              }`}
            >
              Niveau inférieur
            </button>
            <button
              type="button"
              onClick={() => { setSelectedDeck('upper'); clearSelection(); }}
              className={`flex-1 py-2 px-4 rounded-xl text-sm font-semibold border-2 transition-colors ${
                selectedDeck === 'upper'
                  ? 'bg-[#0B7439] border-[#0B7439] text-white'
                  : 'bg-white border-[#E2EAE5] text-[#4A6B55] hover:border-[#0B7439]'
              }`}
            >
              Niveau supérieur
            </button>
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-[#4A6B55]">
          <span className="w-2 h-2 rounded-full bg-[#0B7439] animate-pulse inline-block" />
          Plan mis à jour en temps réel
        </div>

        <SeatMap
          seatMap={seatMap}
          selectedSeats={selectedSeats}
          onSeatToggle={toggleSeat}
          showPassengerNames={true}
          maxSelectableSeats={99}
          lockCountdowns={lockCountdowns}
        />
      </div>

      <div className="space-y-4">
        <SeatSelectionSummary
          selectedSeats={selectedSeats}
          totalPrice={totalSelectedPrice}
          onRemoveSeat={(id) => {
            const seat = selectedSeats.find(s => s.id === id)
            if (seat) toggleSeat(seat)
          }}
          onConfirm={handleConfirmSeats}
          onClear={clearSelection}
        />

        {step === 'passenger_forms' && passengerForms.map((form, idx) => (
          <div key={form.seat.id} className="bg-white border border-[#E2EAE5] rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-[#1A2E22] text-sm">
                Siège {form.seat.label}{form.seat.type === 'vip' ? ' VIP' : ''}
              </h4>
              <span className="font-black text-[#0B7439] text-sm">
                {formatCurrency(form.seat.price)}
              </span>
            </div>
            <input
              placeholder="Nom complet (optionnel)"
              value={form.passenger_name}
              onChange={e => {
                const updated = [...passengerForms]
                updated[idx].passenger_name = e.target.value
                setPassengerForms(updated)
              }}
              className="w-full border border-[#E2EAE5] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]"
            />
            <input
              placeholder="Téléphone (optionnel)"
              value={form.passenger_phone}
              onChange={e => {
                const updated = [...passengerForms]
                updated[idx].passenger_phone = e.target.value
                setPassengerForms(updated)
              }}
              className="w-full border border-[#E2EAE5] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]"
            />
            <input
              placeholder="N° CNI / Passeport (optionnel)"
              value={form.passenger_id_number}
              onChange={e => {
                const updated = [...passengerForms]
                updated[idx].passenger_id_number = e.target.value
                setPassengerForms(updated)
              }}
              className="w-full border border-[#E2EAE5] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]"
            />
          </div>
        ))}

        {step === 'passenger_forms' && (
          <div className="bg-white border border-[#E2EAE5] rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[#4A6B55]">Total à encaisser</span>
              <span className="text-2xl font-black text-[#0B7439]">
                {formatCurrency(totalSelectedPrice)}
              </span>
            </div>
            {passengerForms.length > 1 && (
              <p className="text-xs text-[#4A6B55]">
                {passengerForms.length} passagers · {formatCurrency(totalSelectedPrice / passengerForms.length)} / place
              </p>
            )}
            <button
              onClick={handleSubmitReservations}
              disabled={isSubmitting}
              className="w-full bg-[#0B7439] hover:bg-[#085c2d] disabled:opacity-50 text-white font-bold rounded-xl h-12 text-sm transition-colors"
            >
              {isSubmitting
                ? 'Enregistrement...'
                : `Confirmer — ${formatCurrency(totalSelectedPrice)}`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
