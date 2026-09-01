import { supabase } from './supabase'
import { getPrintCustomization } from './printCustomization'

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

        // 1. Chef de gare phone — try counters.manager_id first
        let chefGareUserId: string | null = counter.manager_id ?? null

        // If no manager_id on counter, try station_managers junction
        if (!chefGareUserId && counter.station_id) {
          const { data: sm } = await supabase
            .from('station_managers')
            .select('user_id')
            .eq('station_id', counter.station_id)
            .limit(1)
            .maybeSingle()
          if (sm?.user_id) chefGareUserId = sm.user_id
        }

        // If still no chef de gare, try stations.station_manager_id
        if (!chefGareUserId && counter.station_id) {
          const { data: st } = await supabase
            .from('stations')
            .select('station_manager_id')
            .eq('id', counter.station_id)
            .maybeSingle()
          if (st?.station_manager_id) chefGareUserId = st.station_manager_id
        }

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
