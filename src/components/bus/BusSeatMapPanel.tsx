import { useMemo } from 'react'
import { User } from 'lucide-react'
import type { EnrichedSeat, EnrichedRow, ScheduleSeatMap } from '../../types/seatMap.types'
import { SeatCell } from './SeatCell'
import { SeatLegend } from './SeatLegend'
import { formatCurrency } from '../../utils/formatCurrency'

const SEAT_W = 38
const SEAT_GAP = 6
const AISLE_W = 24

interface BusSeatMapPanelProps {
  seatMap: ScheduleSeatMap
  selectedSeats: EnrichedSeat[]
  onSeatToggle: (seat: EnrichedSeat) => void
  showPassengerNames?: boolean
  lockCountdowns?: Record<string, number>
}

function calcBodyWidth(leftCols: number, rightCols: number): number {
  const left = leftCols * SEAT_W + Math.max(0, leftCols - 1) * SEAT_GAP
  const right = rightCols * SEAT_W + Math.max(0, rightCols - 1) * SEAT_GAP
  return left + AISLE_W + right
}

export function BusSeatMapPanel({
  seatMap,
  selectedSeats,
  onSeatToggle,
  showPassengerNames = false,
  lockCountdowns = {},
}: BusSeatMapPanelProps) {
  const selectedIds = useMemo(() => new Set(selectedSeats.map(s => s.id)), [selectedSeats])

  const handleSeatSelect = (seat: EnrichedSeat) => {
    const isSelected = selectedIds.has(seat.id)
    // Allow deselecting a seat we already selected (even if now locked_by_me)
    if (!isSelected && seat.status !== 'available' && seat.status !== 'locked_by_me') return
    onSeatToggle(seat)
  }

  const { config, enriched_layout } = seatMap
  const leftCols = config.columns_left ?? 2
  const rightCols = config.columns_right ?? 1
  const bodyWidth = calcBodyWidth(leftCols, rightCols)
  const rowNumberWidth = 20

  const normalRows = enriched_layout.filter(r => r.seats.some(s => s.side !== 'back'))
  const backRows = enriched_layout.filter(r => r.seats.every(s => s.side === 'back'))

  const allSeats = enriched_layout.flatMap(r => r.seats)
  const bookableCount = allSeats.filter(s => s.status === 'available').length
  const aisleCount = config.rows ?? normalRows.length

  const leftW = leftCols * SEAT_W + Math.max(0, leftCols - 1) * SEAT_GAP

  const totalPrice = selectedSeats.reduce((sum, s) => sum + s.price, 0)

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

      <div className="p-4 sm:p-6 overflow-x-auto">
        <div
          className="flex flex-col gap-2"
          style={{ minWidth: rowNumberWidth + bodyWidth + 32 }}
        >
          <div
            className="flex items-center gap-2 bg-[#1B2B1E] rounded-xl py-2.5 px-4 mb-1 self-start"
            style={{ marginLeft: rowNumberWidth + 8 }}
          >
            <User className="w-4 h-4 text-slate-300 flex-shrink-0" />
            <span className="text-white text-xs font-bold tracking-wide uppercase">
              Conducteur · Côté gauche
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            {normalRows.map((row: EnrichedRow) => {
              const leftSeats = row.seats.filter(s => s.side === 'left')
              const rightSeats = row.seats.filter(s => s.side === 'right')

              return (
                <div key={`row-${row.row}`} className="flex items-center gap-2">
                  <span
                    className="text-[10px] text-slate-400 font-medium text-right flex-shrink-0"
                    style={{ width: rowNumberWidth }}
                  >
                    {row.row}
                  </span>

                  <div className="flex items-center" style={{ gap: 0 }}>
                    <div
                      className="flex items-center gap-[6px]"
                      style={{ width: leftW }}
                    >
                      {leftSeats.map(seat => (
                        <SeatCell
                          key={seat.id}
                          seat={seat}
                          isSelected={selectedIds.has(seat.id)}
                          onSelect={handleSeatSelect}
                          showPassengerName={showPassengerNames}
                          lockCountdown={lockCountdowns[seat.id]}
                        />
                      ))}
                      {leftSeats.length < leftCols && Array.from({ length: leftCols - leftSeats.length }).map((_, i) => (
                        <div key={`el-${i}`} className="flex-shrink-0" style={{ width: SEAT_W, height: 40 }} />
                      ))}
                    </div>

                    <div
                      className="flex items-center justify-center flex-shrink-0"
                      style={{ width: AISLE_W }}
                    >
                      <div className="w-px h-7 bg-slate-200" />
                    </div>

                    <div className="flex items-center gap-[6px]">
                      {rightSeats.map(seat => (
                        <SeatCell
                          key={seat.id}
                          seat={seat}
                          isSelected={selectedIds.has(seat.id)}
                          onSelect={handleSeatSelect}
                          showPassengerName={showPassengerNames}
                          lockCountdown={lockCountdowns[seat.id]}
                        />
                      ))}
                      {rightSeats.length < rightCols && Array.from({ length: rightCols - rightSeats.length }).map((_, i) => (
                        <div key={`er-${i}`} className="flex-shrink-0" style={{ width: SEAT_W, height: 40 }} />
                      ))}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {backRows.length > 0 && (
            <>
              <div
                className="flex items-center gap-2 my-0.5"
                style={{ marginLeft: rowNumberWidth + 8 }}
              >
                <div className="flex-1 border-t border-dashed border-slate-200" style={{ maxWidth: bodyWidth }} />
              </div>
              {backRows.map((row: EnrichedRow) => (
                <div key={`back-${row.row}`} className="flex items-center gap-2">
                  <span
                    className="text-[10px] text-slate-400 font-medium text-right flex-shrink-0"
                    style={{ width: rowNumberWidth }}
                  >
                    —
                  </span>
                  <div className="flex gap-[6px]">
                    {row.seats.filter(s => s.side === 'back').map(seat => (
                      <SeatCell
                        key={seat.id}
                        seat={seat}
                        isSelected={selectedIds.has(seat.id)}
                        onSelect={handleSeatSelect}
                        showPassengerName={showPassengerNames}
                        lockCountdown={lockCountdowns[seat.id]}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}

          <div
            className="flex items-center justify-center bg-[#2D3748] rounded-xl py-2 px-4 mt-2 self-start"
            style={{ marginLeft: rowNumberWidth + 8, minWidth: bodyWidth }}
          >
            <span className="text-slate-300 text-[10px] font-bold tracking-widest uppercase">
              Arrière du bus
            </span>
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-6 py-4 border-t border-slate-100 space-y-4">
        <SeatLegend bookableCount={bookableCount} aisleCount={aisleCount} />
        <div className="border-t border-slate-100 pt-4">
          {selectedSeats.length === 0 ? (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Cliquez sur un siège disponible pour le sélectionner
            </p>
          ) : (
            <div>
              <p className="text-xs text-slate-500">
                {selectedSeats.length} place{selectedSeats.length > 1 ? 's' : ''} sélectionnée{selectedSeats.length > 1 ? 's' : ''} — {selectedSeats.map(s => s.label).join(', ')}
              </p>
              <p className="text-xl font-black text-[#0B7439] leading-none mt-0.5">
                {formatCurrency(totalPrice)}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
