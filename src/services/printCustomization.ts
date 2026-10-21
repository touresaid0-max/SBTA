import { supabase } from './supabase'

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

export async function getPrintCustomization(): Promise<PrintCustomization> {
  if (cached && Date.now() - cacheTime < CACHE_TTL) return cached

  const { data, error } = await supabase
    .from('print_customization')
    .select('*')
    .eq('id', 1)
    .maybeSingle()

  if (error || !data) {
    return { ...DEFAULTS }
  }

  cached = { ...DEFAULTS, ...data } as PrintCustomization
  cacheTime = Date.now()
  return cached
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
  return cached
}

export function invalidatePrintCustomizationCache(): void {
  cached = null
  cacheTime = 0
}
