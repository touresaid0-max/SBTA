// Âge légal de départ à la retraite en Côte d'Ivoire
export const RETIREMENT_AGE = 60

// Seuil d'alerte : un an avant l'âge de la retraite
export const RETIREMENT_ALERT_MONTHS = 12

function parseDob(dateNaissance: string | null | undefined): Date | null {
  if (!dateNaissance) return null
  const dob = new Date(dateNaissance)
  return isNaN(dob.getTime()) ? null : dob
}

export function computeAge(dateNaissance: string | null | undefined): number | null {
  const dob = parseDob(dateNaissance)
  if (!dob) return null
  const now = new Date()
  let age = now.getFullYear() - dob.getFullYear()
  const m = now.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--
  return age
}

export function retirementDate(dateNaissance: string | null | undefined): Date | null {
  const dob = parseDob(dateNaissance)
  if (!dob) return null
  const d = new Date(dob)
  d.setFullYear(d.getFullYear() + RETIREMENT_AGE)
  return d
}

// Nombre de mois (peut être négatif si la retraite est déjà atteinte/dépassée)
export function monthsUntilRetirement(dateNaissance: string | null | undefined): number | null {
  const rd = retirementDate(dateNaissance)
  if (!rd) return null
  const now = new Date()
  return (rd.getFullYear() - now.getFullYear()) * 12 + (rd.getMonth() - now.getMonth())
}

// Vrai si l'employé est à un an ou moins de la retraite (ou l'a déjà atteinte)
export function isNearRetirement(dateNaissance: string | null | undefined): boolean {
  const m = monthsUntilRetirement(dateNaissance)
  if (m === null) return false
  return m <= RETIREMENT_ALERT_MONTHS
}

export function isRetirementReached(dateNaissance: string | null | undefined): boolean {
  const m = monthsUntilRetirement(dateNaissance)
  if (m === null) return false
  return m <= 0
}
