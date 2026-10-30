import React, { useState, useCallback } from 'react'
import type { DeckType } from './BusParametersStep'

export type CellType = 'normal' | 'vip' | 'couchette' | 'aisle' | 'hors_service' | 'pmr' | 'empty'
export type AutoNumberMode = 'sequential' | 'sequential_reverse' | 'row_col' | 'row_number'

export interface GridCell {
  id: string
  label: string
  col: number
  type: CellType
  is_empty: boolean
  is_aisle: boolean
  custom_price: number | null
}

export interface GridRow {
  row: number
  row_type: 'normal' | 'back'
  cells: GridCell[]
}

export type GridLayout = GridRow[]

interface DeckConfig {
  rows: number
  cols: number
  aislePositions: number[]
  hasBackRow: boolean
  backRowSeats: number
  layout: GridLayout | null
}

export const defaultDeckConfig = (): DeckConfig => ({
  rows: 10,
  cols: 4,
  aislePositions: [2],
  hasBackRow: true,
  backRowSeats: 5,
  layout: null,
})

interface SeatPlanBuilderProps {
  deckType: DeckType
  driverPosition?: 'gauche' | 'droite'
  simpleDeck: DeckConfig
  lowerDeck: DeckConfig
  upperDeck: DeckConfig
  onSimpleChange: (d: DeckConfig) => void
  onLowerChange: (d: DeckConfig) => void
  onUpperChange: (d: DeckConfig) => void
}

function generateLayout(
  rows: number,
  totalCols: number,
  aisleAfterColumns: number[],
  hasBackRow: boolean,
  backRowSeats: number,
  defaultSeatType: 'normal' | 'vip' | 'couchette' = 'normal'
): GridLayout {
  let seatCounter = 1
  const layout: GridLayout = []

  for (let row = 1; row <= rows; row++) {
    const cells: GridCell[] = []
    for (let col = 1; col <= totalCols; col++) {
      const isAisle = aisleAfterColumns.includes(col - 1) && col > 1

      if (isAisle) {
        cells.push({ id: '', label: '', col, type: 'aisle', is_empty: true, is_aisle: true, custom_price: null })
      } else {
        const label = `${seatCounter}`
        cells.push({ id: label, label, col, type: defaultSeatType, is_empty: false, is_aisle: false, custom_price: null })
        seatCounter++
      }
    }
    layout.push({ row, row_type: 'normal', cells })
  }

  if (hasBackRow) {
    const backCells = Array.from({ length: backRowSeats }, (_, i) => ({
      id: `${seatCounter + i}`,
      label: `${seatCounter + i}`,
      col: i + 1,
      type: defaultSeatType as CellType,
      is_empty: false,
      is_aisle: false,
      custom_price: null,
    }))
    layout.push({ row: rows + 1, row_type: 'back', cells: backCells })
  }

  return layout
}

function autoNumberLayout(layout: GridLayout, mode: AutoNumberMode): GridLayout {
  let counter = 1
  return layout.map(row => {
    if (mode === 'sequential_reverse') {
      const reservable = row.cells
        .map((cell, idx) => ({ cell, idx }))
        .filter(({ cell }) => !cell.is_aisle && !cell.is_empty)
      const base = counter
      const count = reservable.length
      const newCells = [...row.cells]
      reservable.forEach(({ cell, idx }, k) => {
        const label = `${base + count - 1 - k}`
        newCells[idx] = { ...cell, id: label, label }
      })
      counter += count
      return { ...row, cells: newCells }
    }
    return {
      ...row,
      cells: row.cells.map(cell => {
        if (cell.is_aisle || cell.is_empty) return cell
        let label: string
        const colInRow = cell.col
        switch (mode) {
          case 'sequential':
            label = `${counter}`
            break
          case 'row_col':
            label = `${row.row}${String.fromCharCode(64 + colInRow)}`
            break
          case 'row_number':
            label = `${row.row}${colInRow}`
            break
          default:
            label = `${counter}`
        }
        counter++
        return { ...cell, id: label, label }
      }),
    }
  })
}

export function countReservableSeats(layout: GridLayout): number {
  return layout.reduce((acc, row) => acc + row.cells.filter(c => !c.is_aisle && !c.is_empty && c.label !== '').length, 0)
}

const EMPTY_CELL = { label: '', id: '', type: 'empty' as CellType, is_aisle: false, is_empty: true, custom_price: null }

function isSeat(cell: GridCell): boolean {
  return !cell.is_aisle && !cell.is_empty
}

// Next number after the highest existing one, so deleted numbers are never recreated.
function nextSeatNumber(layout: GridLayout): number {
  let max = 0
  layout.forEach(row => row.cells.forEach(cell => {
    if (isSeat(cell) && /^\d+$/.test(cell.label)) max = Math.max(max, parseInt(cell.label, 10))
  }))
  return max + 1
}

function applyCellUpdate(layout: GridLayout, rowIdx: number, colIdx: number, updated: GridCell): GridLayout {
  let cell = updated
  if (cell.is_aisle) {
    cell = { ...cell, label: '', id: '' }
  } else if (!cell.is_empty) {
    const label = cell.label.trim()
    const finalLabel = label || `${nextSeatNumber(layout.map((row, ri) => ({
      ...row,
      cells: row.cells.map((c, ci) => (ri === rowIdx && ci === colIdx ? { ...c, ...EMPTY_CELL } : c)),
    })))}`
    cell = { ...cell, label: finalLabel, id: finalLabel }
  }

  const relabel = new Map<string, string>()
  if (isSeat(cell)) {
    const taken = new Set<string>()
    layout.forEach((row, ri) => row.cells.forEach((c, ci) => {
      if (!(ri === rowIdx && ci === colIdx) && isSeat(c)) taken.add(c.label)
    }))
    if (taken.has(cell.label)) {
      if (/^\d+$/.test(cell.label)) {
        // Shift the contiguous run N, N+1, ... by one so the chosen number becomes free.
        let n = parseInt(cell.label, 10)
        while (taken.has(`${n}`)) {
          relabel.set(`${n}`, `${n + 1}`)
          n++
        }
      } else {
        let next = nextSeatNumber(layout)
        while (taken.has(`${next}`) || `${next}` === cell.label) next++
        relabel.set(cell.label, `${next}`)
      }
    }
  }

  return layout.map((row, ri) => ({
    ...row,
    cells: row.cells.map((c, ci) => {
      if (ri === rowIdx && ci === colIdx) return cell
      const newLabel = isSeat(c) ? relabel.get(c.label) : undefined
      return newLabel ? { ...c, label: newLabel, id: newLabel } : c
    }),
  }))
}

export function countAisles(layout: GridLayout): number {
  return layout.reduce((acc, row) => acc + row.cells.filter(c => c.is_aisle).length, 0)
}

export function countByType(layout: GridLayout, type: CellType): number {
  return layout.reduce((acc, row) => acc + row.cells.filter(c => c.type === type && !c.is_aisle).length, 0)
}

interface CellPopupProps {
  cell: GridCell
  row: GridRow
  onApply: (updated: GridCell) => void
  onClose: () => void
}

function CellPopup({ cell, row, onApply, onClose }: CellPopupProps) {
  const [label, setLabel] = useState(cell.label)
  const [type, setType] = useState<CellType>(cell.is_aisle ? 'aisle' : cell.type)
  const [customPrice, setCustomPrice] = useState(cell.custom_price ?? 0)

  const apply = () => {
    const isAisle = type === 'aisle'
    const isEmpty = type === 'empty'
    onApply({
      ...cell,
      label,
      id: label,
      type,
      is_aisle: isAisle,
      is_empty: isEmpty,
      custom_price: customPrice > 0 ? customPrice : null,
    })
    onClose()
  }

  const clearSeat = () => {
    onApply({ ...cell, label: '', id: '', type: 'empty', is_aisle: false, is_empty: true, custom_price: null })
    onClose()
  }

  const typeOptions: { value: CellType; label: string }[] = [
    { value: 'normal', label: 'Normal' },
    { value: 'vip', label: 'VIP' },
    { value: 'couchette', label: 'Couchette' },
    { value: 'aisle', label: 'Allée' },
    { value: 'hors_service', label: 'Hors service' },
    { value: 'pmr', label: 'PMR' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-80 p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-bold text-[#1A2E22]">Configurer la cellule</h4>
          <button onClick={onClose} className="text-[#4A6B55] hover:text-[#1A2E22]">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-[#4A6B55] mb-4">Rangée {row.row_type === 'back' ? 'fond' : row.row}, Colonne {cell.col}</p>

        <div className="mb-4">
          <label className="block text-sm font-semibold text-[#1A2E22] mb-1.5">Numéro du siège</label>
          <input
            type="text"
            value={label}
            onChange={e => setLabel(e.target.value)}
            className="w-full px-3 py-2 border-2 border-[#E2EAE5] rounded-xl text-sm focus:outline-none focus:border-[#0B7439]"
            placeholder="vide = espace libre"
          />
          <p className="mt-1 text-xs text-[#4A6B55]">Vide = espace libre non réservable</p>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-semibold text-[#1A2E22] mb-2">Type</label>
          <div className="grid grid-cols-2 gap-2">
            {typeOptions.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setType(opt.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border-2 transition-colors ${
                  type === opt.value
                    ? 'bg-[#0B7439] border-[#0B7439] text-white'
                    : 'bg-white border-[#E2EAE5] text-[#4A6B55] hover:border-[#0B7439]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-5">
          <label className="block text-sm font-semibold text-[#1A2E22] mb-1.5">Prix personnalisé (optionnel)</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              value={customPrice}
              onChange={e => setCustomPrice(+e.target.value)}
              className="flex-1 px-3 py-2 border-2 border-[#E2EAE5] rounded-xl text-sm focus:outline-none focus:border-[#0B7439]"
            />
            <span className="text-sm text-[#4A6B55] font-medium">FCFA</span>
          </div>
          <p className="mt-1 text-xs text-[#4A6B55]">0 = prix de la route</p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={apply}
            className="flex-1 px-4 py-2.5 bg-[#0B7439] text-white text-sm font-bold rounded-xl hover:bg-[#085c2d] transition-colors"
          >
            Appliquer
          </button>
          <button
            type="button"
            onClick={clearSeat}
            className="flex-1 px-4 py-2.5 border-2 border-red-200 text-red-600 text-sm font-bold rounded-xl hover:bg-red-50 transition-colors"
          >
            Effacer
          </button>
        </div>
      </div>
    </div>
  )
}

interface SeatGridProps {
  layout: GridLayout
  selectedCells: string[]
  onCellClick: (rowIdx: number, colIdx: number) => void
  onCellSelect: (id: string) => void
  multiSelectMode: boolean
}

function cellBgClass(cell: GridCell, isSelected: boolean): string {
  if (isSelected) return 'bg-[#0B7439] border-[#085c2d] text-white ring-2 ring-[#0B7439]/30'
  if (cell.is_aisle) return 'bg-transparent border-transparent cursor-default'
  if (cell.is_empty) return 'bg-[#F8FAFC] border-dashed border-[#CBD5E1] text-[#CBD5E1] cursor-pointer'
  switch (cell.type) {
    case 'vip': return 'bg-[#FFFBEB] border-[#FCD34D] text-[#92400E] cursor-pointer hover:scale-105 transition-transform'
    case 'couchette': return 'bg-[#EFF6FF] border-[#93C5FD] text-[#1D4ED8] cursor-pointer hover:scale-105 transition-transform'
    case 'hors_service': return 'bg-[#FEF2F2] border-[#FECACA] text-[#DC2626] cursor-pointer'
    case 'pmr': return 'bg-[#F0FDF4] border-[#86EFAC] text-[#16A34A] cursor-pointer'
    default: return 'bg-white border-[#CBD5E1] text-[#334155] cursor-pointer hover:border-[#0B7439] hover:scale-105 transition-transform'
  }
}

function SeatGrid({ layout, selectedCells, onCellClick, onCellSelect, multiSelectMode }: SeatGridProps) {
  return (
    <div className="space-y-1.5">
      {layout.map((row, rowIdx) => (
        <div key={`row-${row.row}`} className={`flex items-center gap-1 ${row.row_type === 'back' ? 'mt-3' : ''}`}>
          {row.row_type === 'back' ? (
            <>
              <span className="text-[10px] text-[#4A6B55] w-6 text-right shrink-0 font-medium">—</span>
              <div className="flex gap-1 w-full border-t-2 border-dashed border-[#E2EAE5] pt-2">
                {row.cells.map((cell, colIdx) => {
                  const isSelected = selectedCells.includes(`${rowIdx}-${colIdx}`)
                  return (
                    <button
                      key={colIdx}
                      type="button"
                      onClick={() => multiSelectMode ? onCellSelect(`${rowIdx}-${colIdx}`) : onCellClick(rowIdx, colIdx)}
                      className={[
                        'w-10 h-11 rounded-lg border-2 text-[10px] font-bold flex flex-col items-center justify-center select-none',
                        cellBgClass(cell, isSelected),
                      ].join(' ')}
                      title={cell.is_aisle ? 'Allée' : `Siège ${cell.label || '(vide)'}`}
                    >
                      {cell.is_aisle ? null : cell.is_empty ? <span className="text-[9px]">+</span> : cell.label}
                    </button>
                  )
                })}
              </div>
            </>
          ) : (
            <>
              <span className="text-[10px] text-[#4A6B55] w-6 text-right shrink-0 font-medium">{row.row}</span>
              <div className="flex gap-1">
                {row.cells.map((cell, colIdx) => {
                  const isSelected = selectedCells.includes(`${rowIdx}-${colIdx}`)
                  if (cell.is_aisle) {
                    return (
                      <div key={colIdx} className="w-5 flex items-center justify-center">
                        <div className="w-px h-8 bg-[#E2EAE5]" />
                      </div>
                    )
                  }
                  return (
                    <button
                      key={colIdx}
                      type="button"
                      onClick={() => multiSelectMode ? onCellSelect(`${rowIdx}-${colIdx}`) : onCellClick(rowIdx, colIdx)}
                      className={[
                        'w-10 h-11 rounded-lg border-2 text-[10px] font-bold flex flex-col items-center justify-center select-none',
                        cellBgClass(cell, isSelected),
                      ].join(' ')}
                      title={`Siège ${cell.label || '(vide)'} — ${cell.type}`}
                    >
                      {cell.is_empty ? <span className="text-[9px]">+</span> : cell.label}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  )
}

interface DeckBuilderProps {
  config: DeckConfig
  onChange: (c: DeckConfig) => void
  title?: string
  driverPosition?: 'gauche' | 'droite'
}

function DeckBuilder({ config, onChange, title, driverPosition = 'gauche' }: DeckBuilderProps) {
  const [popupTarget, setPopupTarget] = useState<{ rowIdx: number; colIdx: number } | null>(null)
  const [selectedCells, setSelectedCells] = useState<string[]>([])
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [autoNumberMode, setAutoNumberMode] = useState<AutoNumberMode>('sequential')

  const update = (partial: Partial<DeckConfig>) => onChange({ ...config, ...partial })

  const toggleAislePosition = (col: number) => {
    const positions = config.aislePositions.includes(col)
      ? config.aislePositions.filter(p => p !== col)
      : [...config.aislePositions, col].sort((a, b) => a - b)
    update({ aislePositions: positions, layout: null })
  }

  const handleGenerate = () => {
    const layout = generateLayout(
      config.rows,
      config.cols,
      config.aislePositions,
      config.hasBackRow,
      config.backRowSeats
    )
    update({ layout })
  }

  const handleAddRow = () => {
    if (!config.layout) return
    const nextRow = config.layout.length + 1
    let seatNumber = nextSeatNumber(config.layout)
    const newCells: GridCell[] = []
    for (let col = 1; col <= config.cols; col++) {
      const isAisle = config.aislePositions.includes(col - 1) && col > 1
      if (isAisle) {
        newCells.push({ id: '', label: '', col, type: 'aisle', is_empty: true, is_aisle: true, custom_price: null })
      } else {
        const label = `${seatNumber++}`
        newCells.push({ id: label, label, col, type: 'normal', is_empty: false, is_aisle: false, custom_price: null })
      }
    }
    const newLayout = [...config.layout, { row: nextRow, row_type: 'normal' as const, cells: newCells }]
    update({ layout: newLayout })
  }

  const handleRemoveLastRow = () => {
    if (!config.layout || config.layout.length <= 1) return
    update({ layout: config.layout.slice(0, -1) })
  }

  const handleAutoNumber = () => {
    if (!config.layout) return
    update({ layout: autoNumberLayout(config.layout, autoNumberMode) })
  }

  const handleAutoNumberModeChange = (mode: AutoNumberMode) => {
    setAutoNumberMode(mode)
    if (config.layout) {
      update({ layout: autoNumberLayout(config.layout, mode) })
    }
  }

  const handleSelectAll = () => {
    if (!config.layout) return
    const all: string[] = []
    config.layout.forEach((row, ri) => {
      row.cells.forEach((cell, ci) => {
        if (!cell.is_aisle) all.push(`${ri}-${ci}`)
      })
    })
    setSelectedCells(all)
    setMultiSelectMode(true)
  }

  const handleClearSelection = () => {
    setSelectedCells([])
    setMultiSelectMode(false)
  }

  const applyTypeToSelection = (type: CellType) => {
    if (!config.layout) return
    let seatNumber = nextSeatNumber(config.layout)
    const newLayout = config.layout.map((row, ri) => ({
      ...row,
      cells: row.cells.map((cell, ci) => {
        if (selectedCells.includes(`${ri}-${ci}`) && !cell.is_aisle) {
          if (cell.is_empty || cell.label === '') {
            const label = `${seatNumber++}`
            return { ...cell, label, id: label, type, is_empty: false }
          }
          return { ...cell, type, is_empty: false }
        }
        return cell
      }),
    }))
    update({ layout: newLayout })
    setSelectedCells([])
    setMultiSelectMode(false)
  }

  const handleCellClick = (rowIdx: number, colIdx: number) => {
    setPopupTarget({ rowIdx, colIdx })
  }

  const handleCellToggleSelect = (id: string) => {
    setSelectedCells(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    )
  }

  const handlePopupApply = (updated: GridCell) => {
    if (!popupTarget || !config.layout) return
    const { rowIdx, colIdx } = popupTarget
    update({ layout: applyCellUpdate(config.layout, rowIdx, colIdx, updated) })
  }

  const popupCell = popupTarget && config.layout
    ? config.layout[popupTarget.rowIdx]?.cells[popupTarget.colIdx]
    : null
  const popupRow = popupTarget && config.layout
    ? config.layout[popupTarget.rowIdx]
    : null

  return (
    <div>
      {title && <h4 className="font-bold text-[#1A2E22] mb-4">{title}</h4>}

      {!config.layout ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-[#1A2E22] mb-1.5">Nombre de rangées *</label>
              <input
                type="number"
                min={1}
                max={30}
                value={config.rows}
                onChange={e => update({ rows: Math.max(1, +e.target.value) })}
                className="w-full px-3 py-2.5 border-2 border-[#E2EAE5] rounded-xl text-sm focus:outline-none focus:border-[#0B7439]"
                placeholder="ex: 12"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[#1A2E22] mb-1.5">Nombre de colonnes total *</label>
              <input
                type="number"
                min={2}
                max={8}
                value={config.cols}
                onChange={e => update({ cols: Math.max(2, +e.target.value), aislePositions: [], layout: null })}
                className="w-full px-3 py-2.5 border-2 border-[#E2EAE5] rounded-xl text-sm focus:outline-none focus:border-[#0B7439]"
                placeholder="ex: 4"
              />
              <p className="mt-1 text-xs text-[#4A6B55]">Inclut les allées — ex: 4 pour un bus 2+2</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-[#1A2E22] mb-1.5">Position(s) des allées</label>
            <p className="text-xs text-[#4A6B55] mb-2">
              Indiquer après quelle(s) colonne(s) se trouve une allée. Ex: [2] = bus 2+2 | [1] = bus 1+2
            </p>
            <div className="flex gap-2 flex-wrap">
              {Array.from({ length: config.cols - 1 }, (_, i) => i + 1).map(col => (
                <button
                  key={col}
                  type="button"
                  onClick={() => toggleAislePosition(col)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border-2 transition-colors ${
                    config.aislePositions.includes(col)
                      ? 'bg-[#0B7439] border-[#0B7439] text-white'
                      : 'bg-white border-[#E2EAE5] text-[#4A6B55] hover:border-[#0B7439]'
                  }`}
                >
                  Après col. {col} {config.aislePositions.includes(col) ? '✓' : '+'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="backRow"
              checked={config.hasBackRow}
              onChange={e => update({ hasBackRow: e.target.checked })}
              className="w-4 h-4 accent-[#0B7439]"
            />
            <label htmlFor="backRow" className="text-sm font-medium text-[#1A2E22]">Rangée du fond (banquette arrière)</label>
            {config.hasBackRow && (
              <input
                type="number"
                min={1}
                max={8}
                value={config.backRowSeats}
                onChange={e => update({ backRowSeats: +e.target.value })}
                className="w-16 px-2 py-1 border-2 border-[#E2EAE5] rounded-lg text-center text-sm focus:outline-none focus:border-[#0B7439]"
              />
            )}
            {config.hasBackRow && (
              <span className="text-xs text-[#4A6B55]">sièges</span>
            )}
          </div>

          <button
            type="button"
            onClick={handleGenerate}
            className="w-full py-3 bg-[#0B7439] text-white font-bold rounded-xl hover:bg-[#085c2d] transition-colors text-sm"
          >
            Générer le plan de sièges
          </button>
        </div>
      ) : (
        <div>
          <div className="flex gap-2 flex-wrap mb-4 items-center">
            <button type="button" onClick={handleAddRow}
              className="px-3 py-1.5 text-xs font-medium border-2 border-[#E2EAE5] rounded-lg text-[#4A6B55] hover:border-[#0B7439] hover:text-[#0B7439] transition-colors">
              + Rangée
            </button>
            <button type="button" onClick={handleRemoveLastRow}
              className="px-3 py-1.5 text-xs font-medium border-2 border-[#FECACA] rounded-lg text-red-500 hover:bg-red-50 transition-colors">
              − Rangée
            </button>

            <select
              value={autoNumberMode}
              onChange={e => handleAutoNumberModeChange(e.target.value as AutoNumberMode)}
              className="px-2 py-1.5 text-xs border-2 border-[#E2EAE5] rounded-lg focus:outline-none focus:border-[#0B7439]"
            >
              <option value="sequential">Séquentiel (1, 2, 3...)</option>
              <option value="sequential_reverse">Séquentiel inversé (...3, 2, 1)</option>
              <option value="row_col">Rangée+Lettre (1A, 1B...)</option>
              <option value="row_number">N° rangée (11, 12, 21...)</option>
            </select>
            <button type="button" onClick={handleAutoNumber}
              className="px-3 py-1.5 text-xs font-medium border-2 border-[#E2EAE5] rounded-lg text-[#4A6B55] hover:border-[#0B7439] hover:text-[#0B7439] transition-colors">
              Numérotation auto
            </button>

            {!multiSelectMode ? (
              <button type="button" onClick={() => { setMultiSelectMode(true) }}
                className="px-3 py-1.5 text-xs font-medium border-2 border-[#E2EAE5] rounded-lg text-[#4A6B55] hover:border-[#0B7439] hover:text-[#0B7439] transition-colors">
                Sélection multiple
              </button>
            ) : (
              <>
                <button type="button" onClick={handleSelectAll}
                  className="px-3 py-1.5 text-xs font-medium border-2 border-[#E2EAE5] rounded-lg text-[#4A6B55]">
                  Tout sélectionner
                </button>
                <button type="button" onClick={handleClearSelection}
                  className="px-3 py-1.5 text-xs font-medium border-2 border-[#FECACA] rounded-lg text-red-500">
                  Désélectionner
                </button>
              </>
            )}

            {selectedCells.length > 0 && (
              <>
                <span className="text-xs text-[#4A6B55] font-medium">{selectedCells.length} sièges :</span>
                <button type="button" onClick={() => applyTypeToSelection('vip')}
                  className="px-3 py-1.5 text-xs font-bold bg-[#FFFBEB] border-2 border-[#FCD34D] text-[#92400E] rounded-lg">
                  VIP
                </button>
                <button type="button" onClick={() => applyTypeToSelection('hors_service')}
                  className="px-3 py-1.5 text-xs font-bold bg-[#FEF2F2] border-2 border-[#FECACA] text-red-600 rounded-lg">
                  H.S.
                </button>
                <button type="button" onClick={() => applyTypeToSelection('normal')}
                  className="px-3 py-1.5 text-xs font-bold bg-[#F0FBF4] border-2 border-[#0B7439] text-[#0B7439] rounded-lg">
                  Normal
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => update({ layout: null })}
              className="ml-auto px-3 py-1.5 text-xs font-medium border-2 border-[#E2EAE5] rounded-lg text-[#4A6B55] hover:border-[#0B7439]"
            >
              Reconfigurer
            </button>
          </div>

          <div className="bg-[#F8FAF9] rounded-2xl border border-[#E2EAE5] p-4 overflow-x-auto">
            <div className={`flex items-center gap-2 bg-[#1A2E22] rounded-xl py-2.5 px-4 mb-4 max-w-max ${driverPosition === 'droite' ? 'ml-auto' : 'mr-auto'}`}>
              <svg className="w-4 h-4 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="8" r="4" /><path d="M4 20v-2a8 8 0 0 1 16 0v2" />
              </svg>
              <span className="text-white text-xs font-semibold tracking-wide">
                CONDUCTEUR · CÔTÉ {driverPosition === 'droite' ? 'DROIT' : 'GAUCHE'}
              </span>
            </div>

            <SeatGrid
              layout={config.layout}
              selectedCells={selectedCells}
              onCellClick={handleCellClick}
              onCellSelect={handleCellToggleSelect}
              multiSelectMode={multiSelectMode}
            />

            <div className="flex items-center justify-center mt-4">
              <div className="bg-[#2D4A38] rounded-xl py-2 px-6">
                <span className="text-slate-300 text-[10px] font-semibold tracking-widest">ARRIÈRE DU BUS</span>
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-3 items-center text-xs">
            {[
              { color: 'bg-[#E2EAE5]', label: 'Allée' },
              { color: 'bg-white border border-[#CBD5E1]', label: 'Normal' },
              { color: 'bg-[#FFFBEB] border border-[#FCD34D]', label: 'VIP' },
              { color: 'bg-[#EFF6FF] border border-[#93C5FD]', label: 'Couchette' },
              { color: 'bg-[#FEF2F2] border border-[#FECACA]', label: 'H.S.' },
              { color: 'bg-[#F0FDF4] border border-[#86EFAC]', label: 'PMR' },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-1.5">
                <div className={`w-4 h-4 rounded ${item.color}`} />
                <span className="text-[#4A6B55]">{item.label}</span>
              </div>
            ))}
            <span className="ml-auto font-semibold text-[#1A2E22]">
              Réservables : {countReservableSeats(config.layout)} | Allées : {countAisles(config.layout)}
            </span>
          </div>
        </div>
      )}

      {popupCell && popupRow && (
        <CellPopup
          cell={popupCell}
          row={popupRow}
          onApply={handlePopupApply}
          onClose={() => setPopupTarget(null)}
        />
      )}
    </div>
  )
}

export default function SeatPlanBuilder({
  deckType,
  driverPosition = 'gauche',
  simpleDeck,
  lowerDeck,
  upperDeck,
  onSimpleChange,
  onLowerChange,
  onUpperChange,
}: SeatPlanBuilderProps) {
  const [activeDeck, setActiveDeck] = useState<'lower' | 'upper'>('lower')

  if (deckType === 'simple') {
    return (
      <div>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-bold text-[#1A2E22]">Configuration du plan — Simple étage</h3>
          <span className="text-xs px-2.5 py-1 rounded-full bg-[#F0FBF4] text-[#0B7439] font-medium border border-[#C8E8D4]">
            Conducteur côté {driverPosition}
          </span>
        </div>
        <DeckBuilder config={simpleDeck} onChange={onSimpleChange} driverPosition={driverPosition} />
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-bold text-[#1A2E22]">Configuration du plan — Bus impérial (double étage)</h3>
        <span className="text-xs px-2.5 py-1 rounded-full bg-[#F0FBF4] text-[#0B7439] font-medium border border-[#C8E8D4]">
          Conducteur côté {driverPosition}
        </span>
      </div>
      <div className="flex gap-2 mb-6">
        <button
          type="button"
          onClick={() => setActiveDeck('lower')}
          className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold border-2 transition-colors ${
            activeDeck === 'lower'
              ? 'bg-[#0B7439] border-[#0B7439] text-white'
              : 'bg-white border-[#E2EAE5] text-[#4A6B55] hover:border-[#0B7439]'
          }`}
        >
          Niveau inférieur {lowerDeck.layout ? `(${countReservableSeats(lowerDeck.layout)} sièges)` : ''}
        </button>
        <button
          type="button"
          onClick={() => setActiveDeck('upper')}
          className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold border-2 transition-colors ${
            activeDeck === 'upper'
              ? 'bg-[#0B7439] border-[#0B7439] text-white'
              : 'bg-white border-[#E2EAE5] text-[#4A6B55] hover:border-[#0B7439]'
          }`}
        >
          Niveau supérieur {upperDeck.layout ? `(${countReservableSeats(upperDeck.layout)} sièges)` : ''}
        </button>
      </div>
      {activeDeck === 'lower' ? (
        <DeckBuilder config={lowerDeck} onChange={onLowerChange} driverPosition={driverPosition} />
      ) : (
        <DeckBuilder config={upperDeck} onChange={onUpperChange} driverPosition={driverPosition} />
      )}
    </div>
  )
}
