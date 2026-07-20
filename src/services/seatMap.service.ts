import { supabase } from './supabase'
import type { ScheduleSeatMap, EnrichedSeat, SeatStatus, EnrichedRow, SeatRow, OnlineReservationInfo } from '../types/seatMap.types'
import { normalizeLegacyLayout, generateSeatLayout, generateDefaultLayoutFromTotalSeats } from '../utils/generateSeatLayout'

const SEAT_CONFIG_COLUMNS = 'id, name, total_seats, rows, left_columns, right_columns, back_row, back_row_seats, aisle_position, seat_layout, seat_layout_v2'

async function loadSeatConfig(configId: string): Promise<any | null> {
  const { data } = await supabase
    .from('bus_seat_config')
    .select(SEAT_CONFIG_COLUMNS)
    .eq('id', configId)
    .maybeSingle()
  return data
}

export async function getSiblingScheduleIds(scheduleId: string): Promise<string[]> {
  const { data } = await supabase.rpc('get_sibling_schedule_ids', { p_schedule_id: scheduleId })
  if (data && Array.isArray(data)) return data as string[]
  return [scheduleId]
}

export async function getSiblingOccupancy(scheduleId: string): Promise<number> {
  const siblingIds = await getSiblingScheduleIds(scheduleId)
  const { data } = await supabase
    .from('reservations')
    .select('total_seats')
    .in('schedule_id', siblingIds)
    .in('status', ['confirme', 'confirmee', 'en_attente', 'embarque'])
  return (data ?? []).reduce((sum, r) => sum + (r.total_seats ?? 1), 0)
}

export async function fetchScheduleSeatMap(
  scheduleId: string,
  deckLevel: 'simple' | 'lower' | 'upper' = 'simple'
): Promise<ScheduleSeatMap> {
  const { data: schedule, error: scheduleError } = await supabase
    .from('schedules')
    .select(`
      id,
      seats_available,
      seats_reserved,
      price,
      buses (
        id,
        registration_number,
        class,
        total_seats,
        bus_deck_type,
        seat_config_id,
        lower_deck_config_id,
        upper_deck_config_id
      ),
      routes (
        base_price
      )
    `)
    .eq('id', scheduleId)
    .single()

  if (scheduleError || !schedule) {
    throw new Error(`Voyage introuvable : ${scheduleError?.message}`)
  }

  const bus = schedule.buses as any

  // Anticipated departure with no bus assigned — no seat map available
  if (!bus) {
    throw new Error('__NO_BUS__')
  }

  const isImperial = bus?.bus_deck_type === 'imperial'

  let rawConfig: any = null

  if (isImperial) {
    const configId = deckLevel === 'upper' ? bus?.upper_deck_config_id : bus?.lower_deck_config_id
    if (configId) rawConfig = await loadSeatConfig(configId)
  } else if (bus?.seat_config_id) {
    rawConfig = await loadSeatConfig(bus.seat_config_id)
  }

  const route = schedule.routes as any
  const schedulePrice: number = (schedule as any).price ?? route?.base_price ?? 0
  const vipPrice: number = schedulePrice * 1.5

  if (!rawConfig) {
    const totalSeats: number = bus?.total_seats ?? 34
    const defaults = generateDefaultLayoutFromTotalSeats(totalSeats)
    const generatedLayout = generateSeatLayout(
      defaults.rows,
      defaults.leftColumns,
      defaults.rightColumns,
      defaults.hasBackRow,
      defaults.backRowSeats
    )
    const syntheticConfig = {
      id: `auto-${bus?.id ?? 'bus'}`,
      name: `Plan ${bus?.registration_number ?? 'bus'} (auto)`,
      total_seats: totalSeats,
      rows: defaults.rows,
      columns_left: defaults.leftColumns,
      columns_right: defaults.rightColumns,
      has_back_row: defaults.hasBackRow,
      back_row_seats: defaults.backRowSeats,
      aisle_position: defaults.leftColumns,
      seat_layout: generatedLayout,
    }

    const siblingIds = await getSiblingScheduleIds(scheduleId)

    const [
      { data: reservations },
      { data: { user: currentUser } },
    ] = await Promise.all([
      supabase.from('reservations').select('id, seat_numbers, passenger_name, status, customer_id')
        .in('schedule_id', siblingIds).in('status', ['confirme', 'confirmee', 'en_attente', 'embarque']),
      supabase.auth.getUser(),
    ])

    const lockMap = await fetchActiveSeatLocksForSchedules(siblingIds)
    const onlineMap = await fetchOnlineReservedSeats(siblingIds)

    const occupiedMap: Record<string, { reservation_id: string; passenger_name: string; status: string; client_id: string }> = {}
    for (const res of reservations ?? []) {
      const seats: string[] = Array.isArray(res.seat_numbers) ? res.seat_numbers : []
      for (const seatNum of seats) {
        occupiedMap[seatNum] = { reservation_id: res.id, passenger_name: res.passenger_name, status: res.status, client_id: res.customer_id }
      }
    }

    const enrichedLayout: EnrichedRow[] = generatedLayout.map(row => ({
      row: row.row,
      seats: row.seats.map((seat): EnrichedSeat => {
        const occupied = occupiedMap[seat.id]
        const online = onlineMap[seat.id]
        const lock = lockMap[seat.id]
        let status: SeatStatus = 'available'
        let lock_expires_at: string | undefined

        if (occupied) {
          status = currentUser && occupied.client_id === currentUser.id ? 'my_reservation'
            : occupied.status === 'embarque' ? 'boarding' : 'occupied'
        } else if (online) {
          status = 'online_reserved'
        } else if (lock) {
          lock_expires_at = lock.expires_at
          status = currentUser && lock.locked_by === currentUser.id ? 'locked_by_me' : 'locked'
        }
        return { ...seat, status, reservation_id: occupied?.reservation_id, passenger_name: occupied?.passenger_name, price: schedulePrice, lock_expires_at, online_reservation: online }
      }),
    }))
    const allSeatsList = enrichedLayout.flatMap(r => r.seats)
    return {
      schedule_id: scheduleId,
      bus_id: bus?.id ?? '',
      bus_registration: bus?.registration_number ?? '',
      bus_class: bus?.class ?? 'standard',
      bus_deck_type: bus?.bus_deck_type ?? 'simple',
      config: syntheticConfig,
      enriched_layout: enrichedLayout,
      total_seats: totalSeats,
      available_count: allSeatsList.filter(s => s.status === 'available').length,
      occupied_count: allSeatsList.filter(s => ['occupied', 'boarding', 'my_reservation', 'online_reserved'].includes(s.status)).length,
      out_of_service_count: 0,
      base_price: schedulePrice,
      vip_price: vipPrice,
    }
  }

  const leftColumns: number = rawConfig.left_columns ?? rawConfig.columns_left ?? 2
  const rightColumns: number = rawConfig.right_columns ?? rawConfig.columns_right ?? 2
  const hasBackRow: boolean = rawConfig.back_row ?? rawConfig.has_back_row ?? false
  const backRowSeats: number = rawConfig.back_row_seats ?? 0

  let normalizedLayout: SeatRow[]
  const rawLayoutV2 = rawConfig.seat_layout_v2
  const rawLayout = rawLayoutV2 ?? rawConfig.seat_layout
  const aislePos: number = rawConfig.aisle_position ?? leftColumns

  if (!rawLayout || !Array.isArray(rawLayout) || rawLayout.length === 0) {
    normalizedLayout = generateSeatLayout(
      rawConfig.rows,
      leftColumns,
      rightColumns,
      hasBackRow,
      backRowSeats
    )
  } else {
    const firstRow = rawLayout[0]
    if (Array.isArray(firstRow)) {
      normalizedLayout = normalizeLegacyLayout(rawLayout as any[][], leftColumns)
    } else if (firstRow && typeof firstRow === 'object' && 'seats' in firstRow) {
      normalizedLayout = (rawLayout as SeatRow[]).map(row => ({
        ...row,
        seats: row.seats.map(seat => {
          if (seat.side === 'back') return seat
          const col = seat.position?.col ?? 1
          const correctSide = col > aislePos ? 'right' : 'left'
          if (seat.side === correctSide) return seat
          return { ...seat, side: correctSide as 'left' | 'right' }
        }),
      }))
    } else {
      normalizedLayout = generateSeatLayout(
        rawConfig.rows,
        leftColumns,
        rightColumns,
        hasBackRow,
        backRowSeats
      )
    }
  }

  const config = {
    id: rawConfig.id,
    name: rawConfig.name,
    total_seats: rawConfig.total_seats,
    rows: rawConfig.rows,
    columns_left: leftColumns,
    columns_right: rightColumns,
    has_back_row: hasBackRow,
    back_row_seats: backRowSeats,
    aisle_position: rawConfig.aisle_position ?? leftColumns,
    seat_layout: normalizedLayout,
  }

  const siblingIds = await getSiblingScheduleIds(scheduleId)

  const [
    { data: reservations, error: resError },
    { data: { user: currentUser } },
  ] = await Promise.all([
    supabase.from('reservations').select('id, seat_numbers, passenger_name, status, customer_id')
      .in('schedule_id', siblingIds).in('status', ['confirme', 'confirmee', 'en_attente', 'embarque']),
    supabase.auth.getUser(),
  ])

  if (resError) throw new Error(`Erreur chargement réservations : ${resError.message}`)

  const lockMap = await fetchActiveSeatLocksForSchedules(siblingIds)
  const onlineMap = await fetchOnlineReservedSeats(siblingIds)

  const occupiedMap: Record<string, { reservation_id: string; passenger_name: string; status: string; client_id: string }> = {}
  for (const res of reservations ?? []) {
    const seats: string[] = Array.isArray(res.seat_numbers) ? res.seat_numbers : []
    for (const seatNum of seats) {
      occupiedMap[seatNum] = { reservation_id: res.id, passenger_name: res.passenger_name, status: res.status, client_id: res.customer_id }
    }
  }

  const enrichedLayout: EnrichedRow[] = normalizedLayout.map((row) => ({
    row: row.row,
    seats: row.seats.map((seat): EnrichedSeat => {
      const occupied = occupiedMap[seat.id]
      const online = onlineMap[seat.id]
      const lock = lockMap[seat.id]
      let status: SeatStatus = 'available'
      let lock_expires_at: string | undefined

      if (seat.type === 'hors_service') {
        status = 'out_of_service'
      } else if (occupied) {
        status = currentUser && occupied.client_id === currentUser.id ? 'my_reservation'
          : occupied.status === 'embarque' ? 'boarding' : 'occupied'
      } else if (online) {
        status = 'online_reserved'
      } else if (lock) {
        lock_expires_at = lock.expires_at
        status = currentUser && lock.locked_by === currentUser.id ? 'locked_by_me' : 'locked'
      }

      const price = seat.type === 'vip' ? vipPrice : schedulePrice

      return { ...seat, status, reservation_id: occupied?.reservation_id, passenger_name: occupied?.passenger_name, price, lock_expires_at, online_reservation: online }
    }),
  }))

  const allSeats = enrichedLayout.flatMap(r => r.seats)
  const available_count = allSeats.filter(s => s.status === 'available').length
  const occupied_count = allSeats.filter(s => ['occupied', 'boarding', 'my_reservation', 'online_reserved'].includes(s.status)).length
  const out_of_service_count = allSeats.filter(s => s.status === 'out_of_service').length

  return {
    schedule_id: scheduleId,
    bus_id: bus.id,
    bus_registration: bus.registration_number,
    bus_class: bus.class,
    bus_deck_type: bus.bus_deck_type ?? 'simple',
    config,
    enriched_layout: enrichedLayout,
    total_seats: config.total_seats,
    available_count,
    occupied_count,
    out_of_service_count,
    base_price: schedulePrice,
    vip_price: vipPrice,
  }
}

export function subscribeToSeatChanges(
  scheduleId: string,
  onUpdate: () => void,
  siblingIds?: string[]
) {
  const allIds = siblingIds && siblingIds.length > 1 ? siblingIds : [scheduleId]

  const channel = supabase.channel(`seat-map-${scheduleId}`)

  for (const sid of allIds) {
    channel
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations', filter: `schedule_id=eq.${sid}` }, () => onUpdate())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'seat_locks', filter: `schedule_id=eq.${sid}` }, () => onUpdate())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mobile_bookings', filter: `schedule_id=eq.${sid}` }, () => onUpdate())
  }

  channel.subscribe()

  return () => supabase.removeChannel(channel)
}

export async function isSeatStillAvailable(
  scheduleId: string,
  seatNumber: string
): Promise<boolean> {
  const siblingIds = await getSiblingScheduleIds(scheduleId)
  const { data, error } = await supabase
    .from('reservations')
    .select('id')
    .in('schedule_id', siblingIds)
    .contains('seat_numbers', [seatNumber])
    .in('status', ['confirme', 'confirmee', 'en_attente', 'embarque'])
    .maybeSingle()

  if (error) throw error
  if (data !== null) return false

  const seatInt = parseInt(seatNumber, 10)
  if (!Number.isNaN(seatInt)) {
    const { data: online } = await supabase
      .from('mobile_bookings')
      .select('id')
      .in('schedule_id', siblingIds)
      .eq('status', 'confirmed')
      .contains('assigned_seats', [seatInt])
      .maybeSingle()
    if (online !== null) return false
  }

  return true
}

// ── Seat lock helpers ─────────────────────────────────────────────────────────

export async function tryLockSeat(
  scheduleId: string,
  seatNumber: string,
  sessionId: string
): Promise<{ expires_at: string } | null> {
  const { data, error } = await supabase
    .rpc('try_lock_seat', { p_schedule_id: scheduleId, p_seat_number: seatNumber, p_session_id: sessionId })

  if (error) {
    console.error('tryLockSeat error', error)
    return null
  }
  const rows = data as Array<{ expires_at: string }> | null
  return rows && rows.length > 0 ? rows[0] : null
}

export async function releaseSeatLock(scheduleId: string, seatNumber: string): Promise<void> {
  await supabase.rpc('release_seat_lock', { p_schedule_id: scheduleId, p_seat_number: seatNumber })
}

export async function fetchActiveSeatLocks(
  scheduleId: string
): Promise<Record<string, { locked_by: string; expires_at: string }>> {
  const { data } = await supabase
    .from('seat_locks')
    .select('seat_number, locked_by, expires_at')
    .eq('schedule_id', scheduleId)
    .gt('expires_at', new Date().toISOString())

  const map: Record<string, { locked_by: string; expires_at: string }> = {}
  for (const row of data ?? []) {
    map[row.seat_number] = { locked_by: row.locked_by, expires_at: row.expires_at }
  }
  return map
}

async function fetchActiveSeatLocksForSchedules(
  scheduleIds: string[]
): Promise<Record<string, { locked_by: string; expires_at: string }>> {
  const { data } = await supabase
    .from('seat_locks')
    .select('seat_number, locked_by, expires_at')
    .in('schedule_id', scheduleIds)
    .gt('expires_at', new Date().toISOString())

  const map: Record<string, { locked_by: string; expires_at: string }> = {}
  for (const row of data ?? []) {
    map[row.seat_number] = { locked_by: row.locked_by, expires_at: row.expires_at }
  }
  return map
}

type PassengerJson = { firstName?: string; lastName?: string; phone?: string }

// Sieges reserves via l'application mobile /sbtamobile (affiches en jaune).
async function fetchOnlineReservedSeats(
  scheduleIds: string[]
): Promise<Record<string, OnlineReservationInfo>> {
  const { data } = await supabase
    .from('mobile_bookings')
    .select('booking_ref, passengers, total, service_fee, payment_method, status, assigned_seats')
    .in('schedule_id', scheduleIds)
    .eq('status', 'confirmed')

  const map: Record<string, OnlineReservationInfo> = {}
  for (const row of data ?? []) {
    const seats: number[] = Array.isArray(row.assigned_seats) ? row.assigned_seats : []
    if (seats.length === 0) continue
    const first = (Array.isArray(row.passengers) ? row.passengers[0] : null) as PassengerJson | null
    const customer_name = first
      ? `${first.firstName ?? ''} ${first.lastName ?? ''}`.trim() || 'Client en ligne'
      : 'Client en ligne'
    const info: OnlineReservationInfo = {
      booking_ref: row.booking_ref ?? '',
      customer_name,
      customer_phone: first?.phone ?? '',
      amount: Number(row.total ?? 0),
      service_fee: Number(row.service_fee ?? 0),
      payment_method: row.payment_method ?? '',
      status: row.status ?? '',
    }
    for (const seat of seats) {
      map[String(seat)] = info
    }
  }
  return map
}
