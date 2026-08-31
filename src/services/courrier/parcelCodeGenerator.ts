import { db } from './db'

const APP_TRACKING_URL = 'https://sbta-pink.vercel.app'

function pad(num: number, len: number): string {
  return num.toString().padStart(len, '0')
}

function formatReference(date: Date, code: string): string {
  const mm = pad(date.getMonth() + 1, 2)
  const dd = pad(date.getDate(), 2)
  const hh = pad(date.getHours(), 2)
  const mi = pad(date.getMinutes(), 2)
  const suffix = code.slice(-4)
  return `${mm}/${dd}-${hh}${mi}-${suffix}`
}

/**
 * Generate a parcel code matching the online DB trigger format:
 *   agency_code + 4-digit random suffix (e.g. "012829")
 * Falls back to 6-digit random if no agency_code.
 *
 * Ensures uniqueness against existing local parcels (IndexedDB).
 */
async function generateUniqueCode(agencyCode: string | null): Promise<string> {
  const existing = await db.parcels.toArray()
  const existingCodes = new Set(existing.map(p => p.parcel_code))

  for (let attempt = 0; attempt < 100; attempt++) {
    let code: string
    if (agencyCode && agencyCode.length > 0) {
      const suffix = pad(Math.floor(Math.random() * 9999) + 1, 4)
      code = `${agencyCode}${suffix}`
    } else {
      code = pad(Math.floor(Math.random() * 999999) + 1, 6)
    }
    if (!existingCodes.has(code)) return code
  }

  // Extremely unlikely fallback
  return `${agencyCode ?? ''}${pad(Date.now() % 10000, 4)}`
}

/**
 * Get the next daily sequence number for a station, counting both
 * local parcels and matching the online trigger's logic (max + 1).
 */
async function getNextDailySequence(stationId: string): Promise<number> {
  const today = new Date().toISOString().split('T')[0]
  const localParcels = await db.parcels
    .where('origin_station_id')
    .equals(stationId)
    .toArray()

  let maxSeq = 0
  for (const p of localParcels) {
    if (p.registered_at && p.registered_at.startsWith(today)) {
      if (p.daily_sequence > maxSeq) maxSeq = p.daily_sequence
    }
  }
  return maxSeq + 1
}

/**
 * Generate all parcel codes locally, matching the online DB trigger format.
 * Returns parcel_code, reference, daily_sequence, and tracking_url.
 */
export async function generateOfflineParcelCodes(
  stationId: string,
  agencyCode: string | null,
): Promise<{
  parcel_code: string
  reference: string
  daily_sequence: number
  tracking_url: string
}> {
  const code = await generateUniqueCode(agencyCode)
  const now = new Date()
  const reference = formatReference(now, code)
  const daily_sequence = await getNextDailySequence(stationId)
  const tracking_url = `${APP_TRACKING_URL}/track/${code}`

  return { parcel_code: code, reference, daily_sequence, tracking_url }
}
