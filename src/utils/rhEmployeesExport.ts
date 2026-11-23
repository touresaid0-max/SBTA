import * as XLSX from 'xlsx'
import type { Employee } from '@/types/hr.types'
import { CONTRACT_NATURE_LABELS } from '@/types/hr.types'

const STATUS_LABELS: Record<string, string> = {
  active: 'Actif', pending: 'En attente', suspended: 'Suspendu', inactive: 'Inactif',
  pending_deletion: 'Suppression demandée',
}
const CONTRACT_TYPE_LABELS: Record<string, string> = { titulaire: 'Titulaire', contractuel: 'Contractuel' }
const MARITAL_LABELS: Record<string, string> = { celibataire: 'Célibataire', marie: 'Marié(e)', divorce: 'Divorcé(e)', veuf: 'Veuf / Veuve' }
const GENDER_LABELS: Record<string, string> = { M: 'Homme', F: 'Femme' }

/** 2026-01-31 or an ISO timestamp → 31/01/2026 */
function frDate(value: string | null | undefined): string {
  if (!value) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value
}

function fileSafe(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase()
}

export interface EmployeesExportOptions {
  /** Employees exactly as listed on screen (tab, filters and search applied, every page) */
  employees: Employee[]
  roleLabels: Record<string, string>
  /** Filters shown on the « Filtres » sheet, e.g. [['Poste', 'Chauffeurs'], ['Gare', 'Divo']] */
  filters: [string, string][]
  /** Chauffeur active without sign-in details (shown as « Actif (sans connexion) ») */
  isNoLoginDriver?: (emp: Employee) => boolean
  /** Added to the file name, e.g. « chauffeurs » */
  fileTag?: string
}

/** RH › Employés: the filtered list as an Excel file (sheet « Employés » + sheet « Filtres ») */
export function exportEmployeesExcel({ employees, roleLabels, filters, isNoLoginDriver, fileTag }: EmployeesExportOptions): void {
  const withDrivers = employees.some(e => e.role === 'chauffeur')

  const rows = employees.map(e => {
    const status = STATUS_LABELS[e.status] ?? e.status ?? ''
    const row: Record<string, string | number | null> = {
      'Matricule': e.employee_id ?? '',
      'Nom': e.last_name ?? '',
      'Prénom': e.first_name ?? '',
      'Poste': roleLabels[e.role] ?? e.role,
      'Société': e.company_name ?? 'HOLDING',
      'Code société': e.company_code ?? '',
      'Gare': e.station_name ?? '',
      'Type de contrat': e.contract_type ? (CONTRACT_TYPE_LABELS[e.contract_type] ?? e.contract_type) : '',
      'Nature du contrat': e.contract_nature ? (CONTRACT_NATURE_LABELS[e.contract_nature] ?? e.contract_nature) : '',
      "Date d'entrée": frDate(e.hire_date),
      'Ancienneté': e.seniority_text ?? '',
      'Salaire (FCFA)': e.salary ?? null,
      'Taux journalier (FCFA)': e.daily_rate ?? null,
      'Téléphone': e.phone ?? '',
      'E-mail': e.professional_email || e.email || e.personal_email || '',
      'N° CNPS': e.cnps_number ?? '',
      'Sexe': e.gender ? (GENDER_LABELS[e.gender] ?? e.gender) : '',
      'Date de naissance': frDate(e.date_naissance),
      'Nationalité': e.nationality ?? '',
      'Situation matrimoniale': e.marital_status ? (MARITAL_LABELS[e.marital_status] ?? e.marital_status) : '',
      "Nombre d'enfants": e.children_count ?? 0,
      'Statut': isNoLoginDriver?.(e) ? `${status} (sans connexion)` : status,
    }
    if (withDrivers) {
      row['Car affecté'] = e.bus_registration ?? ''
      row['Type de car'] = [e.bus_brand, e.bus_model, e.bus_class].filter(Boolean).join(' ')
      row['N° de permis'] = e.license_number ?? ''
      row['Catégorie de permis'] = e.license_category ?? ''
      row['Expiration du permis'] = frDate(e.license_expiry)
    }
    return row
  })

  const ws = XLSX.utils.json_to_sheet(rows)
  const headers = rows.length > 0 ? Object.keys(rows[0]) : ['Matricule', 'Nom', 'Prénom']
  if (rows.length === 0) XLSX.utils.sheet_add_aoa(ws, [headers])
  // Column widths from the longest value, header row filterable
  ws['!cols'] = headers.map(h => ({
    wch: Math.min(40, Math.max(h.length, ...rows.map(r => String(r[h] ?? '').length)) + 2),
  }))
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length, 1), c: headers.length - 1 } }) }

  const now = new Date()
  const stamp = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const info = XLSX.utils.aoa_to_sheet([
    ['Liste des employés — export RH'],
    ['Exporté le', stamp],
    ['Nombre d\'employés', employees.length],
    [],
    ['Filtres appliqués'],
    ...(filters.length > 0 ? filters : [['Aucun', 'Tous les employés']]),
  ])
  info['!cols'] = [{ wch: 24 }, { wch: 50 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Employés')
  XLSX.utils.book_append_sheet(wb, info, 'Filtres')
  const day = now.toISOString().slice(0, 10)
  XLSX.writeFile(wb, `employes${fileTag ? '_' + fileSafe(fileTag) : ''}_${day}.xlsx`)
}
