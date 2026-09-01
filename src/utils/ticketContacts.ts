import { supabase } from '@/services/supabase'

export interface TicketContacts {
  chefGareName: string | null
  chefGarePhone: string | null
  guichetPhone: string | null
}

/**
 * Fetch the Chef de Gare and Guichetier phone numbers for a given counter.
 *
 * - The Guichetier is the user assigned to `counters.assigned_user_id`.
 * - The Chef de Gare is looked up via `station_managers` (junction table linking
 *   stations to chef_gare users), preferring the primary manager.
 *
 * Both phones are read from the `users` table `phone` column, which Admin
 * profiles manage.  The lookup does NOT modify any existing assignment logic.
 */
export async function fetchTicketContacts(counterId: string | null, stationId: string | null): Promise<TicketContacts> {
  if (!counterId && !stationId) return { chefGareName: null, chefGarePhone: null, guichetPhone: null }

  try {
    // Fetch the counter's assigned user (guichetier) and its station_id
    let guichetUserId: string | null = null
    let resolvedStationId = stationId

    if (counterId) {
      const { data: counter } = await supabase
        .from('counters')
        .select('assigned_user_id, station_id')
        .eq('id', counterId)
        .maybeSingle()
      if (counter) {
        guichetUserId = counter.assigned_user_id
        if (!resolvedStationId) resolvedStationId = counter.station_id
      }
    }

    // Fetch guichetier phone + name
    let guichetPhone: string | null = null
    if (guichetUserId) {
      const { data: guichetUser } = await supabase
        .from('users')
        .select('phone, full_name, first_name, last_name')
        .eq('id', guichetUserId)
        .maybeSingle()
      if (guichetUser) {
        guichetPhone = guichetUser.phone ?? null
      }
    }

    // Fetch the primary chef de gare for the station
    let chefGareName: string | null = null
    let chefGarePhone: string | null = null

    if (resolvedStationId) {
      const { data: managers } = await supabase
        .from('station_managers')
        .select('manager_id, is_primary, users:manager_id(phone, full_name, first_name, last_name)')
        .eq('station_id', resolvedStationId)
        .order('is_primary', { ascending: false })

      if (managers && managers.length > 0) {
        const top = managers[0]
        const u = Array.isArray((top as any).users) ? (top as any).users[0] : (top as any).users
        if (u) {
          chefGarePhone = u.phone ?? null
          chefGareName = u.full_name || [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || null
        }
      }
    }

    return { chefGareName, chefGarePhone, guichetPhone }
  } catch {
    return { chefGareName: null, chefGarePhone: null, guichetPhone: null }
  }
}
