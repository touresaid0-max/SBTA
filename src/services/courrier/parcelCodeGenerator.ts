import { db } from './db'
import { trustedNow, trustedNowIso } from '@/services/offline/deviceClock'

export const APP_TRACKING_URL = 'https://sbta-gestion.cloud'

function pad(num: number, len: number): string {
  return num.toString().padStart(len, '0')
}

export function formatReference(date: Date, code: string): string {
  const mm = pad(date.getMonth() + 1, 2)
  const dd = pad(date.getDate(), 2)
  const hh = pad(date.getHours(), 2)
  const mi = pad(date.getMinutes(), 2)
  // The whole code, as on the server: the reference is unique, and with numbers that follow on
  // the last 4 characters repeat between agencies (530001, 230001, 630001 → 0001)
  return `${mm}/${dd}-${hh}${mi}-${code}`
}

// Offline codes used to look like the server's (agency code + 4 random digits) and were only
// checked against the parcels of the device: with 9 999 codes per agency, a code already taken on
// the server was likely once an agency had thousands of parcels, and the parcel was then refused
// for good while its receipt was already in the client's hands.
// They now have their own form: agency code + « H » (hors ligne) + 5 characters drawn among 31
// (no 0/O, 1/I/L), e.g. « GTH7K2QM ». The server's codes never have that form, and two devices
// offline at the same time draw the same code about once in 28 million.
const OFFLINE_MARK = 'H'
const OFFLINE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const OFFLINE_RANDOM_LENGTH = 5

function randomOfflinePart(): string {
  const values = crypto.getRandomValues(new Uint32Array(OFFLINE_RANDOM_LENGTH))
  return Array.from(values, v => OFFLINE_ALPHABET[v % OFFLINE_ALPHABET.length]).join('')
}

/** Agency code that starts a parcel code (offline or server form). */
export function agencyCodeOf(parcelCode: string): string {
  const offline = parcelCode.match(new RegExp(`^(.*)${OFFLINE_MARK}[${OFFLINE_ALPHABET}]{${OFFLINE_RANDOM_LENGTH}}$`))
  if (offline) return offline[1]
  return parcelCode.length > 4 ? parcelCode.slice(0, -4) : ''
}

/**
 * New offline parcel code, not used by a parcel known on the device, nor by `isTaken` when given
 * (e.g. a check on the server once online).
 */
export async function generateOfflineParcelCode(
  agencyCode: string | null,
  isTaken?: (code: string) => Promise<boolean>,
): Promise<string> {
  const existingCodes = new Set((await db.parcels.toArray()).map(p => p.parcel_code))
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = `${agencyCode ?? ''}${OFFLINE_MARK}${randomOfflinePart()}`
    if (existingCodes.has(code)) continue
    if (isTaken && await isTaken(code)) continue
    return code
  }
  throw new Error('Impossible de créer un code courrier unique')
}

// ── Parcel codes: strict sequence online, distinct code offline ──
// Online, the server gives the next number of the sending station when the parcel is saved:
// 6 digits in all, 020001, 020002, 020003… (migrations 20261109120000 and 20261110120000), with
// no number lost. Offline, the parcel gets a code of its own form (agency code + H + 5
// characters, above), final, that takes no number of the sequence. Numbers are no longer
// reserved in advance: every browser opened on the courrier took 40 of them, and the next parcel
// online got 020122 instead of 020003.

/** Codes reserved in advance by an earlier version, still kept on this device: removed. */
export async function removeReservedParcelCodes(): Promise<void> {
  await db.referentiels.where('key').startsWith('parcel_codes_').delete()
}

/** Agency code of a station, from the stations kept on the device ('' when it has none). */
export async function stationAgencyCode(stationId: string): Promise<string> {
  const record = await db.referentiels.get('stations_all')
  const station = (record?.data as { id: string; agency_code?: string | null }[] | undefined)?.find(s => s.id === stationId)
  return (station?.agency_code ?? '').trim()
}

/**
 * Get the next daily sequence number for a station, counting both
 * local parcels and matching the online trigger's logic (max + 1).
 */
async function getNextDailySequence(stationId: string): Promise<number> {
  const today = trustedNowIso().split('T')[0]
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
 * Generate all parcel codes locally (offline form: agency code + H + 5 characters, see above).
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
  if (!agencyCode) throw new Error('Code agence non défini pour cette gare : demandez à l\'administrateur de le saisir (Gares), puis enregistrez le courrier.')
  const code = await generateOfflineParcelCode(agencyCode)
  const now = trustedNow()
  const reference = formatReference(now, code)
  const daily_sequence = await getNextDailySequence(stationId)
  const tracking_url = `${APP_TRACKING_URL}/track/${code}`

  return { parcel_code: code, reference, daily_sequence, tracking_url }
}
