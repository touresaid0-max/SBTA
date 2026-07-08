import { supabase } from './supabase'
import type {
  CounterCharge, ScheduleReceiptSummary,
  BordereauDepartData, BordereauRecettesData,
  BordereauDestinationGroup,
} from '@/types/counter.types'

export async function fetchTodayDepartures(counterId: string): Promise<ScheduleReceiptSummary[]> {
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('schedule_receipt_summary')
    .select('*')
    .eq('counter_id', counterId)
    .eq('departure_date', today)
    .order('departure_number', { ascending: true })  // departure_number is now departure_order via view

  if (error) throw error
  return data ?? []
}

export async function assignDepartureNumber(scheduleId: string, counterId: string): Promise<number> {
  const { data, error } = await supabase.rpc('assign_departure_to_counter', {
    p_schedule_id: scheduleId,
    p_counter_id:  counterId,
  })
  if (error) throw error
  return data as number
}

const UNIQUE_CHARGE_TYPES = ['ration', 'carburant_complement', 'peage']

export async function checkChargeExists(
  scheduleId: string,
  chargeType: string,
): Promise<CounterCharge | null> {
  if (!UNIQUE_CHARGE_TYPES.includes(chargeType)) return null
  const { data } = await supabase
    .from('counter_charges')
    .select('*')
    .eq('schedule_id', scheduleId)
    .eq('charge_type', chargeType)
    .maybeSingle()
  return data ?? null
}

export async function createCounterCharge(charge: {
  schedule_id:  string
  counter_id:   string
  station_id:   string
  bus_id:       string
  charge_type:  string
  description:  string
  amount:       number
  receipt_url?: string
}): Promise<CounterCharge> {
  if (UNIQUE_CHARGE_TYPES.includes(charge.charge_type)) {
    const existing = await checkChargeExists(charge.schedule_id, charge.charge_type)
    if (existing) {
      throw new Error(`Les ${charge.charge_type === 'ration' ? 'ratios' : charge.charge_type === 'carburant_complement' ? 'compléments carburant' : 'péages'} de ce voyage ont déjà été enregistrés.`)
    }
  }

  const { data: { user } } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from('counter_charges')
    .insert({ ...charge, created_by: user?.id, charge_date: new Date().toISOString().slice(0, 10) })
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') {
      throw new Error(`Les ${charge.charge_type === 'ration' ? 'ratios' : charge.charge_type === 'carburant_complement' ? 'compléments carburant' : 'péages'} de ce voyage ont déjà été enregistrés.`)
    }
    throw error
  }
  return data
}

export async function fetchScheduleCharges(scheduleId: string): Promise<CounterCharge[]> {
  const { data, error } = await supabase
    .from('counter_charges')
    .select('*')
    .eq('schedule_id', scheduleId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return data ?? []
}

export async function fetchBorderauDepartData(scheduleId: string): Promise<BordereauDepartData> {
  const { data: summary, error } = await supabase
    .from('schedule_receipt_summary')
    .select('*')
    .eq('schedule_id', scheduleId)
    .maybeSingle()

  if (error) throw error
  if (!summary) throw new Error('Départ introuvable')

  // Fetch reservations grouped by destination for this schedule
  const { data: reservations } = await supabase
    .from('reservations')
    .select('destination_city_name, seat_numbers, total_price, total_seats')
    .eq('schedule_id', scheduleId)
    .in('status', ['confirmee', 'confirme', 'embarque', 'termine'])

  const groupMap = new Map<string, { seats: string[], amount: number, count: number }>()
  const defaultDest = summary.destination_city || ''

  for (const r of (reservations ?? [])) {
    const dest = r.destination_city_name || defaultDest
    const existing = groupMap.get(dest) || { seats: [], amount: 0, count: 0 }
    const seatNums = (r.seat_numbers ?? []).filter(Boolean)
    existing.seats.push(...seatNums)
    existing.amount += Number(r.total_price) || 0
    existing.count += r.total_seats || seatNums.length
    groupMap.set(dest, existing)
  }

  const destination_groups: BordereauDestinationGroup[] = Array.from(groupMap.entries())
    .map(([dest, g]) => ({
      destination: dest,
      seats_sold: g.count,
      unit_price: g.count > 0 ? Math.round(g.amount / g.count) : summary.base_price,
      amount: g.amount,
      seat_numbers: g.seats.sort((a, b) => parseInt(a) - parseInt(b)),
    }))
    .sort((a, b) => b.seats_sold - a.seats_sold)

  const now = new Date()
  return {
    station_name:        summary.station_name        ?? '',
    departure_number:    summary.departure_number    ?? 0,
    route_name:          summary.route_name,
    departure_date:      new Date(summary.departure_datetime).toLocaleDateString('fr-CI'),
    departure_time:      new Date(summary.departure_datetime).toLocaleTimeString('fr-CI', { hour: '2-digit', minute: '2-digit' }),
    registration_number: summary.registration_number ?? '',
    driver_name:         summary.driver_name         ?? '—',
    total_seats:         summary.capacity            ?? 0,
    seats_sold:          summary.seats_sold          ?? 0,
    seats_remaining:     summary.seats_remaining     ?? 0,
    destination:         summary.destination_city,
    unit_price:          summary.base_price,
    total_ticket_amount: summary.total_ticket_amount,
    total_charges:       summary.total_charges,
    total_rations:       summary.total_rations,
    total_carburant:     summary.total_carburant,
    total_peages:        summary.total_peages,
    total_autres:        summary.total_autres,
    convoy_amount:       summary.convoy_amount ?? 0,
    is_convoy:           summary.status === 'convoi',
    solde_ticket:        summary.solde_ticket,
    total_baggage:       summary.total_baggage,
    sold_seat_numbers:   (summary.sold_seat_numbers ?? [])
      .filter(Boolean)
      .sort((a: string, b: string) => parseInt(a) - parseInt(b)),
    destination_groups,
    print_date: now.toLocaleDateString('fr-CI'),
    print_time: now.toLocaleTimeString('fr-CI'),
  }
}

export async function fetchBorderauRecettesData(
  counterId: string,
  date: string,
): Promise<BordereauRecettesData | null> {
  // Get departure sequences for this counter + date
  const { data: departures, error: dsError } = await supabase
    .from('departure_sequence')
    .select('schedule_id, departure_number, departure_order')
    .eq('counter_id', counterId)
    .eq('departure_date', date)
    .order('departure_order', { ascending: true })

  if (dsError || !departures || departures.length === 0) return null

  const scheduleIds = departures.map(d => d.schedule_id)

  // Get full data from schedule_receipt_summary
  const { data: summaries, error: srsError } = await supabase
    .from('schedule_receipt_summary')
    .select('*')
    .in('schedule_id', scheduleIds)

  if (srsError || !summaries || summaries.length === 0) return null

  const summaryMap = new Map(summaries.map((s: any) => [s.schedule_id, s]))

  const rows = departures.map(dep => {
    const s: any = summaryMap.get(dep.schedule_id) || {}
    return {
      registration_number: s.registration_number ?? '',
      departure_number:    dep.departure_order ?? dep.departure_number ?? 0,
      seats_sold:          Number(s.seats_sold) || 0,
      total_ticket:        Number(s.total_ticket_amount) || 0,
      total_rations:       Number(s.total_rations) || 0,
      total_carburant:     Number(s.total_carburant) || 0,
      total_peages:        Number(s.total_peages) || 0,
      total_autres:        Number(s.total_autres) || 0,
      total_charges:       Number(s.total_charges) || 0,
      solde_ticket:        Number(s.solde_ticket) || 0,
      total_baggage:       Number(s.total_baggage) || 0,
    }
  })

  const routeNames = [...new Set(summaries.map((s: any) => s.route_name).filter(Boolean))].join(' / ')
  const stationName = summaries[0]?.station_name ?? ''

  const totals = rows.reduce((acc, r) => ({
    departures:      acc.departures + 1,
    seats_sold:      acc.seats_sold + r.seats_sold,
    total_ticket:    acc.total_ticket + r.total_ticket,
    total_rations:   acc.total_rations + r.total_rations,
    total_carburant: acc.total_carburant + r.total_carburant,
    total_peages:    acc.total_peages + r.total_peages,
    total_autres:    acc.total_autres + r.total_autres,
    total_charges:   acc.total_charges + r.total_charges,
    solde_ticket:    acc.solde_ticket + r.solde_ticket,
    total_baggage:   acc.total_baggage + r.total_baggage,
  }), { departures: 0, seats_sold: 0, total_ticket: 0, total_rations: 0, total_carburant: 0, total_peages: 0, total_autres: 0, total_charges: 0, solde_ticket: 0, total_baggage: 0 })

  const now = new Date()
  return {
    station_name:  stationName,
    route_name:    routeNames,
    date_from:     new Date(date).toLocaleDateString('fr-CI'),
    date_to:       new Date(date).toLocaleDateString('fr-CI'),
    print_date:    now.toLocaleDateString('fr-CI'),
    print_time:    now.toLocaleTimeString('fr-CI'),
    rows,
    totals,
  }
}
