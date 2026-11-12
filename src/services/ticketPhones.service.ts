import { supabase } from './supabase'
import { getPrintCustomization } from './printCustomization'
import { formatPhoneCI, normalizePhoneCI, isValidPhoneCI } from '@/utils/phoneCI'

interface CounterLinks {
  manager_id: string | null
  station_id: string | null
}

/**
 * Chef de gare of a guichet: counters.manager_id (multi-chef), then the primary chef of the gare
 * (station_managers), then stations.station_manager_id.
 */
async function resolveChefGareUserId(counter: CounterLinks | null, stationId?: string | null): Promise<string | null> {
  if (counter?.manager_id) return counter.manager_id
  const station = counter?.station_id ?? stationId ?? null
  if (!station) return null
  // The column is manager_id (user_id does not exist: the read failed on every ticket)
  const { data: sm } = await supabase
    .from('station_managers')
    .select('manager_id')
    .eq('station_id', station)
    .order('is_primary', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (sm?.manager_id) return sm.manager_id
  const { data: st } = await supabase
    .from('stations')
    .select('station_manager_id')
    .eq('id', station)
    .maybeSingle()
  return st?.station_manager_id ?? null
}

/** « 07 59 84 84 56 » for a valid Ivorian number, otherwise the number as saved. */
function displayPhone(phone: string): string {
  return isValidPhoneCI(normalizePhoneCI(phone)) ? formatPhoneCI(phone) : phone.trim()
}

const CHEF_PHONE_KEY = 'sbta_chef_gare_phone:'
const chefPhoneKey = (counterId?: string | null, stationId?: string | null) =>
  CHEF_PHONE_KEY + (counterId || stationId || '')

/** The chef de gare number last read for this guichet (kept on the device, for printing offline). */
export function cachedChefGarePhone(counterId?: string | null, stationId?: string | null): string {
  if (!counterId && !stationId) return ''
  try { return localStorage.getItem(chefPhoneKey(counterId, stationId)) ?? '' } catch { return '' }
}

/**
 * Phone number of the chef de gare of the guichet, for the bordereau des recettes
 * (« Tel : 07 59 84 84 56 »). Offline or on error: the number last read on this device, or ''.
 */
export async function getChefGarePhone(counterId?: string | null, stationId?: string | null): Promise<string> {
  if (!counterId && !stationId) return ''
  try {
    let counter: CounterLinks | null = null
    if (counterId) {
      const { data, error } = await supabase
        .from('counters')
        .select('manager_id, station_id')
        .eq('id', counterId)
        .maybeSingle()
      if (error) throw error
      counter = data
    }
    const chefId = await resolveChefGareUserId(counter, stationId)
    let phone = ''
    if (chefId) {
      const { data: chef, error } = await supabase.from('users').select('phone').eq('id', chefId).maybeSingle()
      if (error) throw error
      phone = chef?.phone ? displayPhone(chef.phone) : ''
    }
    try {
      if (phone) localStorage.setItem(chefPhoneKey(counterId, stationId), phone)
      else localStorage.removeItem(chefPhoneKey(counterId, stationId))
    } catch { /* not kept: read again next time */ }
    return phone
  } catch {
    return cachedChefGarePhone(counterId, stationId)
  }
}

/**
 * Fetches the phone numbers to display on printed bus tickets for a given counter.
 *
 * The phones are resolved as:
 *   1. The Chef de Gare phone — looked up via counters.manager_id (multi-chef), then
 *      station_managers junction, then stations.station_manager_id.
 *   2. The Guichetier phone — looked up via counters.assigned_user_id.
 *
 * Returns a formatted string like "07 59 84 84 56 / 05 44 45 46 66".
 * Falls back to the static print_customization bus_ticket_phones if no dynamic phones found.
 */
export async function getTicketPhoneLine(counterId?: string | null): Promise<string> {
  if (counterId) {
    try {
      const { data: counter } = await supabase
        .from('counters')
        .select('id, assigned_user_id, manager_id, station_id')
        .eq('id', counterId)
        .maybeSingle()

      if (counter) {
        const phones: string[] = []

        // 1. Chef de gare phone (counter, then gare)
        const chefGareUserId = await resolveChefGareUserId(counter)

        if (chefGareUserId) {
          const { data: chefUser } = await supabase
            .from('users')
            .select('phone')
            .eq('id', chefGareUserId)
            .maybeSingle()
          if (chefUser?.phone) phones.push(chefUser.phone)
        }

        // 2. Guichetier phone
        if (counter.assigned_user_id) {
          const { data: guichUser } = await supabase
            .from('users')
            .select('phone')
            .eq('id', counter.assigned_user_id)
            .maybeSingle()
          if (guichUser?.phone) phones.push(guichUser.phone)
        }

        if (phones.length > 0) {
          return phones.join(' / ')
        }
      }
    } catch {
      // fall through to default
    }
  }

  // Fallback to static customization
  const customization = await getPrintCustomization()
  return customization.bus_ticket_phones[0] || '01 14 34 60 / 01 14 34 87'
}
