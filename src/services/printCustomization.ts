import { supabase } from './supabase'
import { isOnline } from './pos/syncEngine'

export interface PrintCustomization {
  id: number
  bus_ticket_phones: string[]
  bus_ticket_notes: string[]
  parcel_notes: string[]
  baggage_notes: string[]
  tpe_baggage_notice: string | null
  updated_at: string | null
}

const DEFAULT_TPE_BAGGAGE_NOTICE =
  "Le client doit declarer la valeur reelle des biens expedies, moyennant des frais equivalents a 10% des couts d'expedition (justificatif si necessaire). En cas de perte, la compagnie dispose de deux (2) semaines pour les recherches. Si elles echouent, un remboursement de 50% de la valeur declaree sera effectue sous deux (2) semaines supplementaires.";

const DEFAULTS: PrintCustomization = {
  id: 1,
  bus_ticket_phones: ['01 14 34 60 / 01 14 34 87'],
  bus_ticket_notes: [
    "NB : Tout ticket encaisse n'est plus remboursable.",
    "SBTA n'est pas responsable de ces bagages sans ticket.",
    "VEUILLEZ CONSERVER LES TICKETS JUSQU'A DESTINATION.",
  ],
  parcel_notes: [
    "AUCUN REMBOURSEMENT N'EST POSSIBLE APRES ENCAISSEMENT.",
    "NB : PASSE UN DELAI DE 14 JOURS, SBTA N'EST PAS RESPONSABLE EN CAS DE PERTE DE COLIS.",
  ],
  baggage_notes: [
    "AUCUN REMBOURSEMENT N'EST POSSIBLE APRES ENCAISSEMENT.",
    "NB : PASSE UN DELAI DE 14 JOURS, SBTA N'EST PAS RESPONSABLE EN CAS DE PERTE DE COLIS.",
  ],
  tpe_baggage_notice: DEFAULT_TPE_BAGGAGE_NOTICE,
  updated_at: null,
}

let cached: PrintCustomization | null = null
let cacheTime = 0
const CACHE_TTL = 30_000 // 30 seconds

// Every ticket printed asked the server for these settings once the 30 s copy had expired, even
// without network: the print waited behind the session's renewal attempts, for minutes at a
// station. The last settings read are kept on the device; without network they are used at once,
// and online the server gets PRINT_SERVER_WAIT_MS before the kept copy is printed.
const STORAGE_KEY = 'sbta_print_customization'
const PRINT_SERVER_WAIT_MS = 3_000

function keptCopy(): PrintCustomization {
  if (cached) return cached
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) } as PrintCustomization
  } catch { /* no copy on this device */ }
  return { ...DEFAULTS }
}

// The server did not answer: the kept copy is used for a minute, without asking again. The
// network often drops before the device notices: each ticket of a long series asked the server,
// and waited up to PRINT_SERVER_WAIT_MS for nothing.
const RETRY_AFTER_FAILURE_MS = 60_000
let lastFailure = 0

export async function getPrintCustomization(): Promise<PrintCustomization> {
  if (cached && Date.now() - cacheTime < CACHE_TTL) return cached
  if (!isOnline()) return keptCopy()
  if (Date.now() - lastFailure < RETRY_AFTER_FAILURE_MS) return keptCopy()

  const fromServer = (async () => {
    const { data, error } = await supabase
      .from('print_customization')
      .select('*')
      .eq('id', 1)
      .maybeSingle()
    if (error || !data) return null
    cached = { ...DEFAULTS, ...data } as PrintCustomization
    cacheTime = Date.now()
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cached)) } catch { /* kept for this page only */ }
    return cached
  })().catch(() => null)

  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), PRINT_SERVER_WAIT_MS) })
  try {
    const answer = await Promise.race([fromServer, late])
    if (!answer) lastFailure = Date.now()
    return answer ?? keptCopy()
  } finally {
    clearTimeout(timer)
  }
}

export async function savePrintCustomization(
  updates: Partial<Pick<PrintCustomization, 'bus_ticket_phones' | 'bus_ticket_notes' | 'parcel_notes' | 'baggage_notes' | 'tpe_baggage_notice'>>,
): Promise<PrintCustomization> {
  const { data, error } = await supabase
    .from('print_customization')
    .upsert({
      id: 1,
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1)
    .select()
    .single()

  if (error) throw error

  cached = data as PrintCustomization
  cacheTime = Date.now()
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cached)) } catch { /* kept for this page only */ }
  return cached
}

export function invalidatePrintCustomizationCache(): void {
  cached = null
  cacheTime = 0
}
