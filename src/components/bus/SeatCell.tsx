import { memo } from 'react'
import type { EnrichedSeat } from '../../types/seatMap.types'

interface SeatCellProps {
  seat: EnrichedSeat
  isSelected: boolean
  onSelect: (seat: EnrichedSeat) => void
  showPassengerName?: boolean
  lockCountdown?: number
}

function getSeatStyle(seat: EnrichedSeat, isSelected: boolean): string {
  if (isSelected) {
    return 'bg-[#0B7439] border-[#085c2d] text-white shadow-md scale-105 cursor-pointer ring-2 ring-[#0B7439] ring-offset-1'
  }
  switch (seat.status) {
    case 'occupied':
      return 'bg-red-500 border-red-600 text-white cursor-not-allowed'
    case 'online_reserved':
      return 'bg-[#FCD34D] border-[#D97706] text-[#78350F] cursor-not-allowed'
    case 'out_of_service':
      return 'bg-[#FFF0F0] border-[#FECACA] text-[#EF4444] cursor-not-allowed'
    case 'boarding':
      return 'bg-blue-50 border-blue-200 text-blue-500 cursor-not-allowed'
    case 'my_reservation':
      return 'bg-green-50 border-green-200 text-green-600 cursor-not-allowed'
    default:
      if (seat.type === 'vip') {
        return 'bg-[#FFFBEB] border-[#FCD34D] text-[#92400E] hover:bg-amber-100 hover:scale-105 cursor-pointer active:scale-95 transition-all'
      }
      if (seat.type === 'handicape') {
        return 'bg-[#EFF6FF] border-[#BFDBFE] text-[#3B82F6] hover:bg-blue-100 hover:scale-105 cursor-pointer active:scale-95 transition-all'
      }
      if (seat.type === 'hors_service') {
        return 'bg-[#FFF0F0] border-[#FECACA] text-[#EF4444] cursor-not-allowed'
      }
      return 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-[#0B7439] hover:text-[#0B7439] hover:scale-105 cursor-pointer active:scale-95 transition-all'
  }
}

function getSeatContent(seat: EnrichedSeat, isSelected: boolean) {
  const status = isSelected ? 'selected' : seat.status
  if (status === 'occupied') {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 opacity-90">
        <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
      </svg>
    )
  }
  if (seat.type === 'hors_service' || status === 'out_of_service') {
    return <span className="text-xs font-bold">H.S.</span>
  }
  return <span className="text-[12px] font-bold leading-none">{seat.label}</span>
}

function getSeatTooltip(seat: EnrichedSeat, isSelected: boolean): string {
  if (isSelected) return `Siège ${seat.label} — Cliquer pour désélectionner`
  switch (seat.status) {
    case 'available':
      return `Siège ${seat.label} — ${seat.price.toLocaleString('fr-CI')} FCFA${seat.type === 'vip' ? ' (VIP)' : seat.type === 'handicape' ? ' (PMR)' : ''}`
    case 'occupied': return `Siège ${seat.label} — Occupé`
    case 'online_reserved': {
      const o = seat.online_reservation
      return o
        ? `Siège ${seat.label} — Réservé en ligne (/sbtamobile)\n${o.customer_name}${o.customer_phone ? ' · ' + o.customer_phone : ''}\nBillet ${o.booking_ref} · ${o.amount.toLocaleString('fr-CI')} FCFA · ${o.status === 'confirmed' ? 'Confirmé' : o.status}`
        : `Siège ${seat.label} — Réservé en ligne`
    }
    case 'out_of_service': return `Siège ${seat.label} — Hors service`
    case 'boarding': return `Siège ${seat.label} — En embarquement`
    case 'my_reservation': return `Siège ${seat.label} — Votre réservation`
    default: return `Siège ${seat.label}`
  }
}

export const SeatCell = memo(function SeatCell({
  seat,
  isSelected,
  onSelect,
  lockCountdown,
}: SeatCellProps) {
  const isDisabled = !isSelected && seat.status !== 'available' && seat.status !== 'locked_by_me'

  return (
    <button
      type="button"
      onClick={() => !isDisabled && onSelect(seat)}
      disabled={isDisabled}
      title={getSeatTooltip(seat, isSelected)}
      aria-label={`Siège ${seat.label}`}
      aria-pressed={isSelected}
      className={[
        'flex flex-col items-center justify-center rounded-lg border-2 select-none transition-all duration-150',
        'w-[38px] h-[40px] flex-shrink-0',
        getSeatStyle(seat, isSelected),
      ].join(' ')}
    >
      {getSeatContent(seat, isSelected)}
      {(isSelected || seat.status === 'locked_by_me') && lockCountdown !== undefined && (
        <span className="text-[8px] leading-none opacity-80">{lockCountdown}s</span>
      )}
    </button>
  )
})
