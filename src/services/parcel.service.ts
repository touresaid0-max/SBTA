import { supabase } from './supabase'
import { sendCourierArrivedSms } from './emisSms.service'
import type { Parcel, ParcelTrackingEvent, ParcelKPIs } from '@/types/parcel.types'

export async function createParcel(
  data: Omit<Parcel, 'id' | 'parcel_code' | 'reference' | 'daily_sequence' | 'tracking_url' | 'status' | 'registered_at' | 'origin_station_name' | 'destination_station_name' | 'bus_registration' | 'registered_by_name' | 'company_name' | 'total_amount'>
): Promise<Parcel> {
  const { data: { user } } = await supabase.auth.getUser()

  const { data: parcel, error } = await supabase
    .from('parcels')
    .insert({ ...data, registered_by: user?.id })
    .select(`
      *,
      origin_station:stations!origin_station_id(id, name),
      dest_station:stations!destination_station_id(id, name),
      companies(name)
    `)
    .single()

  if (error) throw error
  return parcel
}

export async function updateParcelStatus(
  parcelId: string,
  newStatus: string,
  additionalData: Record<string, unknown> = {}
): Promise<void> {
  const now = new Date().toISOString()
  const { data: { user } } = await supabase.auth.getUser()

  const payload: Record<string, unknown> = {
    status:     newStatus,
    updated_at: now,
    ...additionalData,
  }

  switch (newStatus) {
    case 'mis_en_paquet':
      payload.packaged_at = now
      payload.packaged_by = user?.id
      break
    case 'expedie':
      payload.shipped_at = now
      payload.shipped_by = user?.id
      break
    case 'arrive':
      payload.arrived_at = now
      payload.arrived_by = user?.id
      break
    case 'livre':
      payload.delivered_at = now
      payload.delivered_by = user?.id
      break
  }

  const { error } = await supabase.from('parcels').update(payload).eq('id', parcelId)
  if (error) throw error

  if (newStatus === 'arrive') {
    try {
      const { data: p } = await supabase
        .from('parcels')
        .select('id, recipient_phone')
        .eq('id', parcelId)
        .maybeSingle()
      if (p?.recipient_phone) {
        await sendCourierArrivedSms({ id: p.id, recipient_phone: p.recipient_phone })
      }
    } catch { /* SMS must not block status update */ }
  }
}

export async function bulkUpdateParcelStatus(
  parcelIds: string[],
  newStatus: string,
): Promise<{ updated: number }> {
  if (parcelIds.length === 0) return { updated: 0 }

  const now = new Date().toISOString()
  const { data: { user } } = await supabase.auth.getUser()

  const payload: Record<string, unknown> = { status: newStatus, updated_at: now }
  switch (newStatus) {
    case 'mis_en_paquet':
      payload.packaged_at = now
      payload.packaged_by = user?.id
      break
    case 'expedie':
      payload.shipped_at = now
      payload.shipped_by = user?.id
      break
    case 'arrive':
      payload.arrived_at = now
      payload.arrived_by = user?.id
      break
    case 'livre':
      payload.delivered_at = now
      payload.delivered_by = user?.id
      break
  }

  const { data, error } = await supabase
    .from('parcels')
    .update(payload)
    .in('id', parcelIds)
    .select('id')

  if (error) throw error
  return { updated: data?.length ?? 0 }
}

export async function updateParcelFields(
  parcelId: string,
  fields: Partial<Pick<Parcel, 'parcel_code' | 'sender_name' | 'sender_phone' | 'recipient_name' | 'recipient_phone' | 'recipient_city' | 'origin_station_id' | 'destination_station_id' | 'delivery_fee' | 'status' | 'registered_at' | 'content_description' | 'notes' | 'driver_id'>> & { bus_id?: string | null },
): Promise<void> {
  const now = new Date().toISOString()
  const { data: { user } } = await supabase.auth.getUser()

  const { total_amount: _omit, ...rest } = fields as Record<string, unknown>
  const payload: Record<string, unknown> = { ...rest, updated_at: now }

  if (fields.status) {
    switch (fields.status) {
      case 'mis_en_paquet':
        payload.packaged_at = now
        payload.packaged_by = user?.id
        break
      case 'expedie':
        payload.shipped_at = now
        payload.shipped_by = user?.id
        break
      case 'arrive':
        payload.arrived_at = now
        payload.arrived_by = user?.id
        break
      case 'livre':
        payload.delivered_at = now
        payload.delivered_by = user?.id
        break
    }
  }

  const { error, count } = await supabase.from('parcels').update(payload).eq('id', parcelId).select('id')
  if (error) throw error
  if (count === 0) throw new Error('Aucune ligne mise à jour — vérifiez vos permissions.')

  if (fields.status === 'arrive') {
    try {
      const { data: p } = await supabase
        .from('parcels')
        .select('id, recipient_phone')
        .eq('id', parcelId)
        .maybeSingle()
      if (p?.recipient_phone) {
        await sendCourierArrivedSms({ id: p.id, recipient_phone: p.recipient_phone })
      }
    } catch { /* SMS must not block */ }
  }
}

const SHIPPED_OR_LATER: string[] = ['expedie', 'arrive', 'livre', 'retourne', 'perdu']

export async function updateParcelNames(
  parcelId: string,
  fields: { sender_name?: string; recipient_name?: string },
): Promise<void> {
  const { data: current, error: fetchErr } = await supabase
    .from('parcels')
    .select('status')
    .eq('id', parcelId)
    .maybeSingle()

  if (fetchErr) throw fetchErr
  if (!current) throw new Error('Courrier introuvable')
  if (SHIPPED_OR_LATER.includes(current.status)) {
    throw new Error('Modification impossible : le courrier a déjà été expédié')
  }

  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (fields.sender_name !== undefined) payload.sender_name = fields.sender_name.trim()
  if (fields.recipient_name !== undefined) payload.recipient_name = fields.recipient_name.trim()

  if (Object.keys(payload).length <= 1) return

  const { error } = await supabase.from('parcels').update(payload).eq('id', parcelId)
  if (error) throw error
}

export async function markTicketPrinted(parcelId: string): Promise<void> {
  const { error } = await supabase
    .from('parcels')
    .update({ ticket_printed: true, updated_at: new Date().toISOString() })
    .eq('id', parcelId)
  if (error) throw error
}

export async function deleteParcel(parcelId: string): Promise<void> {
  const { error: evtErr } = await supabase
    .from('parcel_tracking_events')
    .delete()
    .eq('parcel_id', parcelId)
  if (evtErr) throw evtErr

  const { error } = await supabase.from('parcels').delete().eq('id', parcelId)
  if (error) throw error
}

export async function fetchParcelByCode(code: string): Promise<Parcel | null> {
  const { data, error } = await supabase
    .from('parcels')
    .select(`
      *,
      origin_station:stations!origin_station_id(id, name),
      dest_station:stations!destination_station_id(id, name),
      companies(name)
    `)
    .or(`parcel_code.eq.${code},reference.eq.${code}`)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function fetchTrackingEvents(parcelId: string): Promise<ParcelTrackingEvent[]> {
  const { data, error } = await supabase
    .from('parcel_tracking_events')
    .select('*, stations(name)')
    .eq('parcel_id', parcelId)
    .order('event_at', { ascending: true })

  if (error) throw error
  return data ?? []
}

export async function fetchIncomingParcels(stationId: string): Promise<Parcel[]> {
  const { data, error } = await supabase
    .from('parcels')
    .select('*, origin_station:stations!origin_station_id(name)')
    .eq('destination_station_id', stationId)
    .in('status', ['expedie', 'arrive', 'livre'])
    .order('registered_at', { ascending: false })

  if (error) throw error
  return data ?? []
}

export async function fetchOutgoingParcels(stationId: string): Promise<Parcel[]> {
  const { data, error } = await supabase
    .from('parcels')
    .select('*, dest_station:stations!destination_station_id(name)')
    .eq('origin_station_id', stationId)
    .order('registered_at', { ascending: false })

  if (error) throw error
  return data ?? []
}

// Returns start-of-day ISO string for a given period offset in days (0 = today)
function periodStart(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function startOfWeek(): string {
  const d = new Date()
  const day = d.getDay()
  // Monday as week start
  const diff = (day === 0 ? -6 : 1 - day)
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function startOfMonth(): string {
  const d = new Date()
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export type ParcelPeriod = 'today' | 'week' | 'month' | 'all'

export function getPeriodStart(period: ParcelPeriod): string | null {
  switch (period) {
    case 'today': return periodStart(0)
    case 'week':  return startOfWeek()
    case 'month': return startOfMonth()
    case 'all':   return null
  }
}

export async function fetchOutgoingParcelsPeriod(
  stationId: string,
  period: ParcelPeriod,
  statusFilter?: string[],
): Promise<Parcel[]> {
  let q = supabase
    .from('parcels')
    .select('*, dest_station:stations!destination_station_id(name)')
    .eq('origin_station_id', stationId)

  const from = getPeriodStart(period)
  if (from) q = q.gte('registered_at', from)
  if (statusFilter && statusFilter.length > 0) q = q.in('status', statusFilter)

  const { data, error } = await q.order('registered_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

/**
 * Batch-fetch schedule transport info (bus registration + driver name) for a set
 * of schedule IDs. Uses a SECURITY DEFINER RPC to bypass RLS on the users table
 * which is not readable by agent_colis / superviseur_colis roles directly.
 */
export async function fetchScheduleTransportInfo(
  scheduleIds: string[],
): Promise<Map<string, { busReg: string; driverName: string }>> {
  if (scheduleIds.length === 0) return new Map()

  const { data, error } = await supabase
    .rpc('get_schedules_transport_info', { p_schedule_ids: scheduleIds })

  if (error || !data) return new Map()

  const result = new Map<string, { busReg: string; driverName: string }>()
  for (const row of data as Array<{ schedule_id: string; bus_registration: string | null; driver_name: string | null }>) {
    result.set(row.schedule_id, {
      busReg:     row.bus_registration ?? '',
      driverName: row.driver_name      ?? '',
    })
  }
  return result
}

export async function fetchIncomingParcelsPeriod(
  stationId: string,
  period: ParcelPeriod,
  statusFilter?: string[],
): Promise<Parcel[]> {
  let q = supabase
    .from('parcels')
    .select('*, origin_station:stations!origin_station_id(name)')
    .eq('destination_station_id', stationId)
    .in('status', statusFilter && statusFilter.length > 0 ? statusFilter : ['expedie', 'arrive', 'livre'])

  // For incoming, filter by shipped_at or arrived_at rather than registered_at
  // so that parcels registered at origin yesterday but arrived today still show up.
  // We use registered_at as fallback since that's the most reliably set timestamp.
  const from = getPeriodStart(period)
  if (from && period !== 'all') {
    // Use OR: shipped today OR arrived today OR registered today at this destination
    q = q.or(`shipped_at.gte.${from},arrived_at.gte.${from},registered_at.gte.${from}`)
  }

  const { data, error } = await q.order('registered_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function fetchAllParcels(stationId?: string | null): Promise<Parcel[]> {
  let query = supabase
    .from('parcels')
    .select(`
      *,
      origin_station:stations!origin_station_id(id, name),
      dest_station:stations!destination_station_id(id, name),
      companies(name),
      driver:users!parcels_driver_id_fkey(full_name),
      bus:buses!parcels_bus_id_fkey(registration_number)
    `)

  if (stationId) {
    query = query.or(`origin_station_id.eq.${stationId},destination_station_id.eq.${stationId}`)
  }

  const { data, error } = await query.order('registered_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((p: any) => ({
    ...p,
    origin_station_name: p.origin_station?.name ?? p.origin_station_name ?? '',
    destination_station_name: p.dest_station?.name ?? p.destination_station_name ?? '',
    company_name: p.companies?.name ?? p.company_name ?? '',
    driver_name: p.driver?.full_name ?? null,
    bus_registration: p.bus?.registration_number ?? null,
  }))
}

export async function fetchParcelKPIs(stationId?: string | null): Promise<ParcelKPIs> {
  const today = new Date().toISOString().slice(0, 10)
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

  const stationFilter = (q: ReturnType<typeof supabase.from>) =>
    stationId
      ? (q as any).or(`origin_station_id.eq.${stationId},destination_station_id.eq.${stationId}`)
      : q

  const [todayRes, transitRes, arrivedRes, deliveredRes, todayRevRes, monthRevRes] = await Promise.all([
    stationFilter(supabase.from('parcels').select('id', { count: 'exact', head: true })).gte('registered_at', today),
    stationFilter(supabase.from('parcels').select('id', { count: 'exact', head: true })).in('status', ['expedie', 'mis_en_paquet']),
    stationFilter(supabase.from('parcels').select('id', { count: 'exact', head: true })).eq('status', 'arrive'),
    stationFilter(supabase.from('parcels').select('id', { count: 'exact', head: true })).eq('status', 'livre'),
    stationFilter(supabase.from('parcels').select('total_amount')).gte('registered_at', today),
    stationFilter(supabase.from('parcels').select('total_amount')).gte('registered_at', startOfMonth),
  ])

  return {
    total_today:         todayRes.count ?? 0,
    total_en_transit:    transitRes.count ?? 0,
    total_arrived:       arrivedRes.count ?? 0,
    total_delivered:     deliveredRes.count ?? 0,
    total_revenue_today: (todayRevRes.data ?? []).reduce((s, p) => s + Number(p.total_amount), 0),
    total_revenue_month: (monthRevRes.data ?? []).reduce((s, p) => s + Number(p.total_amount), 0),
    avg_delivery_hours:  0,
  }
}


// Fetches driver name for a schedule id. Returns null if not found.
export async function fetchScheduleDriverName(scheduleId: string): Promise<string | null> {
  const { data } = await supabase
    .from('schedules')
    .select('driver:users!schedules_driver_id_fkey(full_name)')
    .eq('id', scheduleId)
    .maybeSingle()
  return (data as any)?.driver?.full_name ?? null
}

/**
 * Fetches the agent colis phone numbers for origin/destination stations
 * and the superviseur colis info for ticket printing.
 */
export async function fetchPosOriginPhones(
  guichetierId: string,
  stationId: string,
  fallbackGuichetierPhone: string | null,
): Promise<string | null> {
  const [selfRes, managersRes, stationRes] = await Promise.all([
    supabase.from('users').select('phone').eq('id', guichetierId).maybeSingle(),
    supabase
      .from('station_managers')
      .select('manager_id, is_primary')
      .eq('station_id', stationId)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true }),
    supabase.from('stations').select('station_manager_id').eq('id', stationId).maybeSingle(),
  ])

  const managerIds = [
    ...(managersRes.data ?? []).map(m => m.manager_id as string),
    stationRes.data?.station_manager_id as string | undefined,
  ].filter((id): id is string => !!id)

  let chefPhone: string | null = null
  if (managerIds.length > 0) {
    const { data: chefs } = await supabase
      .from('users')
      .select('id, phone')
      .in('id', managerIds)
      .eq('role', 'chef_gare')
    for (const id of managerIds) {
      const phone = chefs?.find(c => c.id === id)?.phone
      if (phone) { chefPhone = phone; break }
    }
  }

  const guichetierPhone = selfRes.data?.phone ?? fallbackGuichetierPhone
  const phones = [guichetierPhone, chefPhone].filter((p): p is string => !!p)
  return phones.length > 0 ? phones.join(' / ') : null
}

export async function fetchParcelAgentInfo(
  originStationId: string,
  destinationStationId: string,
): Promise<{
  origin_agent_phone: string | null
  destination_agent_phone: string | null
  supervisor_name: string | null
  supervisor_email: string | null
  supervisor_phone: string | null
}> {
  const [agentsRes, supervisorRes] = await Promise.all([
    supabase
      .from('station_agents')
      .select('station_id, is_primary, agent:agent_id(phone)')
      .in('station_id', [originStationId, destinationStationId])
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true }),
    supabase
      .from('users')
      .select('full_name, email, phone')
      .eq('role', 'superviseur_colis')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  let originPhone: string | null = null
  let destPhone: string | null = null

  for (const row of agentsRes.data ?? []) {
    const phone = (row as any).agent?.phone ?? null
    if (!phone) continue
    if (row.station_id === originStationId && !originPhone) originPhone = phone
    if (row.station_id === destinationStationId && !destPhone) destPhone = phone
  }

  const sup = supervisorRes.data
  return {
    origin_agent_phone:      originPhone,
    destination_agent_phone: destPhone,
    supervisor_name:         sup?.full_name ?? null,
    supervisor_email:        sup?.email     ?? null,
    supervisor_phone:        sup?.phone     ?? null,
  }
}
