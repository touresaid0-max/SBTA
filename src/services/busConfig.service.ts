import { supabase } from './supabase'
import type { GridLayout } from '../components/bus/SeatPlanBuilder'

function countReservableSeats(layout: GridLayout): number {
  return layout
    .flatMap(r => r.cells)
    .filter(c => !c.is_aisle && !c.is_empty && c.label !== '').length
}

function layoutToSeatRows(layout: GridLayout): object[] {
  const rows: object[] = []
  layout.forEach(row => {
    const seats = row.cells
      .filter(c => !c.is_aisle && !c.is_empty && c.label !== '')
      .map(c => ({
        id: c.id || c.label,
        label: c.label,
        side: row.row_type === 'back' ? 'back' : 'left',
        type:
          c.type === 'hors_service'
            ? 'hors_service'
            : c.type === 'vip'
            ? 'vip'
            : c.type === 'pmr'
            ? 'pmr'
            : c.type === 'couchette'
            ? 'couchette'
            : 'normal',
        position: { row: row.row, col: c.col },
        custom_price: c.custom_price,
      }))
    if (seats.length > 0) {
      rows.push({ row: row.row, seats })
    }
  })
  return rows
}

// Same grid position = same physical seat, so a label change there is a renumbering.
export function buildSeatRemap(pairs: Array<[GridLayout | null | undefined, GridLayout | null | undefined]>): Record<string, string> {
  const mapping: Record<string, string> = {}
  const ambiguous = new Set<string>()
  pairs.forEach(([before, after]) => {
    if (!before || !after) return
    before.forEach((row, ri) => row.cells.forEach((oldCell, ci) => {
      const newCell = after[ri]?.cells[ci]
      if (!newCell) return
      const isSeat = (c: typeof oldCell) => !c.is_aisle && !c.is_empty && c.label !== ''
      if (!isSeat(oldCell) || !isSeat(newCell) || oldCell.label === newCell.label) return
      if (mapping[oldCell.label] && mapping[oldCell.label] !== newCell.label) ambiguous.add(oldCell.label)
      mapping[oldCell.label] = newCell.label
    }))
  })
  ambiguous.forEach(label => delete mapping[label])
  return mapping
}

export async function remapBusSeatNumbers(busId: string, mapping: Record<string, string>): Promise<void> {
  if (Object.keys(mapping).length === 0) return
  const { error } = await supabase.rpc('remap_bus_seat_numbers', { p_bus_id: busId, p_mapping: mapping })
  if (error) throw error
}

interface BusData {
  registration_number?: string
  brand?: string
  model?: string
  year?: number
  class?: string
  company_id?: string
  fuel_type?: string
  fuel_capacity?: number
  fuel_consumption?: number
  insurance_expiry?: string | null
  vignette_expiry?: string | null
  technical_inspection_expiry?: string | null
  photo_url?: string | null
  amenities?: string[]
  seat_config_id?: string
  max_allowed_capacity?: number
  seats_sold_from?: number
  sleeping_type?: string
  [key: string]: unknown
}

export interface SaveBusParams {
  busData: BusData
  layout: GridLayout
  lowerLayout?: GridLayout
  upperLayout?: GridLayout
  deckType: 'simple' | 'imperial'
  driverPosition: 'gauche' | 'droite'
  aisleAfterColumns: number[]
  hasBackRow: boolean
  backRowSeats: number
  totalRows: number
  totalCols: number
  isUpdate: boolean
  existingBusId?: string
  existingSeatConfigId?: string
  existingLowerConfigId?: string
  existingUpperConfigId?: string
}

function buildConfigPayload(
  layout: GridLayout,
  deckLevel: string,
  registrationNumber: string,
  params: Pick<SaveBusParams, 'driverPosition' | 'aisleAfterColumns' | 'hasBackRow' | 'backRowSeats' | 'totalCols' | 'totalRows'>
) {
  const seatRows = layoutToSeatRows(layout)
  const normalRows = layout.filter(r => r.row_type !== 'back')
  const totalSeats = countReservableSeats(layout)

  const deckSuffix =
    deckLevel === 'simple'
      ? 'Plan principal'
      : deckLevel === 'inferieur'
      ? 'Niveau inférieur'
      : 'Niveau supérieur'

  const aisleCount = params.aisleAfterColumns.length
  const seatCols = params.totalCols - aisleCount
  const leftCols = params.aisleAfterColumns[0] ?? Math.floor(seatCols / 2)
  const rightCols = seatCols - leftCols

  return {
    name: `${registrationNumber} — ${deckSuffix}`,
    total_capacity: totalSeats,
    total_seats: totalSeats,
    rows: normalRows.length,
    left_columns: leftCols,
    right_columns: rightCols,
    has_back_row: params.hasBackRow,
    back_row: params.hasBackRow,
    back_row_seats: params.hasBackRow ? params.backRowSeats : 0,
    aisle_position: params.aisleAfterColumns[0] ?? 2,
    seat_layout: seatRows,
    grid_layout: layout,
    deck_level: deckLevel,
    driver_position: params.driverPosition,
    total_columns: params.totalCols,
    aisle_after_columns: params.aisleAfterColumns,
    default_seat_type: 'normal',
    is_active: true,
    generated_at: new Date().toISOString(),
  }
}

async function upsertSeatConfig(
  payload: ReturnType<typeof buildConfigPayload>,
  existingId?: string
): Promise<string> {
  const userId = (await supabase.auth.getUser()).data.user?.id ?? null

  if (existingId) {
    const { data, error } = await supabase
      .from('bus_seat_config')
      .update({ ...payload, last_modified_by: userId })
      .eq('id', existingId)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) throw new Error('Impossible de mettre à jour la configuration de siège')
    return data.id
  } else {
    const { data, error } = await supabase
      .from('bus_seat_config')
      .insert(payload)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) throw new Error('Impossible de créer la configuration de siège')
    return data.id
  }
}

export async function saveBusWithSeatConfig(params: SaveBusParams): Promise<string> {
  const {
    busData,
    layout,
    lowerLayout,
    upperLayout,
    deckType,
    isUpdate,
    existingBusId,
    existingSeatConfigId,
    existingLowerConfigId,
    existingUpperConfigId,
  } = params

  const regNum = busData.registration_number ?? 'BUS'

  if (deckType === 'simple') {
    const configPayload = buildConfigPayload(layout, 'simple', regNum, params)
    const configId = await upsertSeatConfig(configPayload, isUpdate ? existingSeatConfigId : undefined)

    const busPayload = {
      ...busData,
      seat_config_id: configId,
      capacity: configPayload.total_seats,
      total_seats: configPayload.total_seats,
      max_allowed_capacity: busData.max_allowed_capacity ?? configPayload.total_seats,
      bus_deck_type: 'simple',
      driver_position: params.driverPosition,
    }

    if (isUpdate && existingBusId) {
      const { error } = await supabase.from('buses').update(busPayload).eq('id', existingBusId)
      if (error) throw error
      return existingBusId
    } else {
      const { data, error } = await supabase
        .from('buses')
        .insert({ ...busPayload, status: 'disponible' })
        .select('id')
        .maybeSingle()
      if (error) throw error
      if (!data) throw new Error('Impossible de créer le bus')
      return data.id
    }
  } else {
    if (!lowerLayout || !upperLayout) {
      throw new Error('Les deux niveaux doivent être configurés pour un bus impérial')
    }

    const lowerPayload = buildConfigPayload(lowerLayout, 'inferieur', regNum, params)
    const upperPayload = buildConfigPayload(upperLayout, 'superieur', regNum, params)

    const lowerConfigId = await upsertSeatConfig(lowerPayload, isUpdate ? existingLowerConfigId : undefined)
    const upperConfigId = await upsertSeatConfig(upperPayload, isUpdate ? existingUpperConfigId : undefined)

    const totalSeats = lowerPayload.total_seats + upperPayload.total_seats

    const busPayload = {
      ...busData,
      lower_deck_config_id: lowerConfigId,
      upper_deck_config_id: upperConfigId,
      capacity: totalSeats,
      total_seats: totalSeats,
      max_allowed_capacity: busData.max_allowed_capacity ?? totalSeats,
      bus_deck_type: 'imperial',
      driver_position: params.driverPosition,
    }

    if (isUpdate && existingBusId) {
      const { error } = await supabase.from('buses').update(busPayload).eq('id', existingBusId)
      if (error) throw error
      return existingBusId
    } else {
      const { data, error } = await supabase
        .from('buses')
        .insert({ ...busPayload, status: 'disponible' })
        .select('id')
        .maybeSingle()
      if (error) throw error
      if (!data) throw new Error('Impossible de créer le bus')
      return data.id
    }
  }
}
