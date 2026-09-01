import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Users, Bus, TrendingUp, Download, Printer, Ban,
  AlertOctagon, Receipt, Wallet, Landmark, Search, Filter,
} from 'lucide-react'
import { supabase } from '@/services/supabase'
import { fetchEmployees, fetchPayrollByCompany } from '@/services/hr.service'
import { resolveCompanyIds, type CompanyWithHierarchy } from '@/utils/companyGroups'
import { CompanyGroupSelect } from '@/components/shared/CompanyGroupSelect'
import type {
  Employee, CompanyPayroll, EmployeeSuspension, ExplanationRequest,
  SalaryDeduction, EmployeeLoan, PaySlip,
} from '@/types/hr.types'

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────
const fmtMoney = (n: number | null | undefined) =>
  `${Number(n ?? 0).toLocaleString('fr-FR')} FCFA`

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('fr-FR') : '—'

const ROLE_LABELS: Record<string, string> = {
  chauffeur: 'Chauffeur', guichetier: 'Guichetier', agent_reservation: 'Agent Réservation', mecanicien: 'Mécanicien',
  pompiste: 'Pompiste', chef_garage: 'Chef Garage', chef_gare: 'Chef Gare', bagagiste: 'Bagagiste',
  gestionnaire: 'Gestionnaire', planificateur: 'Planificateur',
  comptable: 'Comptable', daf: 'DAF', rh: 'RH', admin: 'Admin', dg: 'Directeur Général',
  gerant_principal: 'Gérant Principal',
  responsable_assurance: 'Responsable Service Assurance',
  responsable_logistique: 'Responsable Logistique',
  charge_achat: "Chargé d'Achat",
  agent_colis: 'Agent Courrier', superviseur_colis: 'Superviseur Courrier',
  gestion_agboville: 'Gestion Agboville', carburant: 'Agent Carburant',
}

const SUSPENSION_LABELS: Record<string, string> = {
  absence_prolongee: 'Absence prolongée', suspension_disciplinaire: 'Suspension disciplinaire',
  depart: 'Départ', contrat_expire: 'Contrat expiré', autre: 'Autre',
}

const DEDUCTION_LABELS: Record<string, string> = {
  contravention: 'Contravention', emprunt: 'Emprunt', avance: 'Avance', acompte: 'Acompte',
  absence_non_justifiee: 'Absence non justifiée', sanction_financiere: 'Sanction financière',
  autre: 'Autre',
}

const LOAN_LABELS: Record<string, string> = {
  emprunt: 'Emprunt', avance: 'Avance', acompte: 'Acompte',
}

const EXPLANATION_LABELS: Record<string, string> = {
  en_attente: 'En attente', repondu: 'Répondu',
  sanction_appliquee: 'Sanction appliquée', classe: 'Classé',
}

const LOAN_STATUS: Record<string, string> = {
  en_cours: 'En cours', solde: 'Soldé', annule: 'Annulé',
}

const DEDUCTION_STATUS: Record<string, string> = {
  active: 'Active', applied: 'Appliquée', cancelled: 'Annulée',
}

const MONTHS = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc']

const CONTRACT_TYPES: { value: string; label: string }[] = [
  { value: 'titulaire', label: 'Titulaires' },
  { value: 'contractuel', label: 'Contractuels' },
  { value: 'stagiaire', label: 'Stagiaires' },
]

const CONTRACT_NATURES: { value: string; label: string }[] = [
  { value: 'CDI', label: 'CDI' },
  { value: 'CDD', label: 'CDD' },
]

const EMPLOYEE_STATUSES: { value: string; label: string }[] = [
  { value: 'active', label: 'Actifs' },
  { value: 'pending', label: 'En attente' },
  { value: 'suspended', label: 'Suspendus' },
]

const ROLE_CATEGORIES: { value: string; label: string; roles: string[] }[] = [
  { value: 'direction', label: 'Direction', roles: ['admin', 'dg', 'daf', 'rh', 'gestionnaire', 'gestion_agboville', 'gerant_principal', 'planificateur', 'comptable'] },
  { value: 'operationnel', label: 'Opérationnel', roles: ['chauffeur', 'guichetier', 'mecanicien', 'pompiste', 'chef_garage', 'chef_gare', 'bagagiste', 'agent_reservation', 'responsable_assurance', 'responsable_logistique', 'charge_achat', 'carburant'] },
  { value: 'courrier', label: 'Courrier', roles: ['agent_colis', 'superviseur_colis'] },
]

const ALL_ROLES = ROLE_CATEGORIES.flatMap(c => c.roles)


// ──────────────────────────────────────────────────────────────
// Report definitions
// ──────────────────────────────────────────────────────────────
type ReportKey =
  | 'employes' | 'chauffeurs' | 'suspensions' | 'explications'
  | 'masse' | 'retenues' | 'emprunts' | 'declarations'

interface ReportColumn {
  header: string
  cell: (row: any) => string
  right?: boolean
}

interface ReportStat { label: string; value: string }

interface ReportDef {
  key: ReportKey
  title: string
  subtitle: string
  icon: React.ComponentType<{ className?: string }>
  color: string
  load: () => Promise<any[]>
  columns: ReportColumn[]
  summary: (rows: any[]) => ReportStat[]
  dateField?: (row: any) => string | null
  companyField?: (row: any) => string | null
}

const REPORTS: ReportDef[] = [
  {
    key: 'employes',
    title: 'Rapport des employés',
    subtitle: 'Effectif complet, postes et rémunérations',
    icon: Users,
    color: '#0B7439',
    load: () => fetchEmployees({ company_id: null, station_id: null, role: null, contract_type: null, contract_nature: null, status: null, search: '' }),
    dateField: (e: Employee) => e.hire_date ?? null,
    companyField: (e: Employee) => e.company_id ?? null,
    columns: [
      { header: 'Matricule', cell: (e: Employee) => e.employee_id ?? '—' },
      { header: 'Nom complet', cell: (e: Employee) => e.full_name },
      { header: 'Poste', cell: (e: Employee) => ROLE_LABELS[e.role] ?? e.role },
      { header: 'Société', cell: (e: Employee) => e.company_code ?? 'HOLDING' },
      { header: 'Gare', cell: (e: Employee) => e.station_name ?? '—' },
      { header: 'Contrat', cell: (e: Employee) => e.contract_type ?? '—' },
      { header: 'Entrée', cell: (e: Employee) => fmtDate(e.hire_date) },
      { header: 'Ancienneté', cell: (e: Employee) => e.years_of_service != null ? `${e.years_of_service} an(s)` : '—' },
      { header: 'Salaire', right: true, cell: (e: Employee) => fmtMoney(e.salary) },
      { header: 'Statut', cell: (e: Employee) => e.status },
    ],
    summary: (rows: Employee[]) => [
      { label: 'Effectif total', value: String(rows.length) },
      { label: 'Actifs', value: String(rows.filter(e => e.status === 'active').length) },
      { label: 'Titulaires', value: String(rows.filter(e => e.contract_type === 'titulaire').length) },
      { label: 'Contractuels', value: String(rows.filter(e => e.contract_type === 'contractuel').length) },
      { label: 'Masse salariale', value: fmtMoney(rows.reduce((s, e) => s + Number(e.salary ?? 0), 0)) },
    ],
  },
  {
    key: 'chauffeurs',
    title: 'Rapport des chauffeurs',
    subtitle: 'Affectations bus, permis et performance',
    icon: Bus,
    color: '#1D6FA4',
    load: async () => {
      const all = await fetchEmployees({ company_id: null, station_id: null, role: 'chauffeur', contract_type: null, contract_nature: null, status: null, search: '' })
      return all
    },
    dateField: (e: Employee) => e.hire_date ?? null,
    companyField: (e: Employee) => e.company_id ?? null,
    columns: [
      { header: 'Nom complet', cell: (e: Employee) => e.full_name },
      { header: 'Société', cell: (e: Employee) => e.company_code ?? 'HOLDING' },
      { header: 'Gare', cell: (e: Employee) => e.station_name ?? '—' },
      { header: 'Bus', cell: (e: Employee) => e.bus_registration ?? '—' },
      { header: 'N° permis', cell: (e: Employee) => e.license_number ?? '—' },
      { header: 'Catégorie', cell: (e: Employee) => e.license_category ?? '—' },
      { header: 'Expiration', cell: (e: Employee) => fmtDate(e.license_expiry) },
      { header: 'Contrat', cell: (e: Employee) => e.contract_type ?? '—' },
      { header: 'Note', right: true, cell: (e: Employee) => e.driver_average_rating ? e.driver_average_rating.toFixed(1) : '—' },
      { header: 'Niveau', cell: (e: Employee) => e.driver_performance_level || '—' },
    ],
    summary: (rows: Employee[]) => {
      const withBus = rows.filter(e => e.bus_registration).length
      const expiring = rows.filter(e => e.license_expiry && (new Date(e.license_expiry).getTime() - Date.now()) / 86_400_000 < 60).length
      const rated = rows.filter(e => e.driver_average_rating > 0)
      const avg = rated.length ? rated.reduce((s, e) => s + e.driver_average_rating, 0) / rated.length : 0
      return [
        { label: 'Chauffeurs', value: String(rows.length) },
        { label: 'Avec bus affecté', value: String(withBus) },
        { label: 'Permis < 60 jours', value: String(expiring) },
        { label: 'Note moyenne', value: avg ? avg.toFixed(2) : '—' },
      ]
    },
  },
  {
    key: 'suspensions',
    title: 'Rapport des suspensions',
    subtitle: 'Suspensions et sanctions disciplinaires',
    icon: Ban,
    color: '#AF3029',
    load: async () => {
      const { data } = await supabase.from('employee_suspensions')
        .select('*, company:companies(id, name, code)')
        .order('created_at', { ascending: false })
      return (data ?? []) as EmployeeSuspension[]
    },
    dateField: (s: EmployeeSuspension) => s.start_date ?? null,
    companyField: (s: EmployeeSuspension) => s.company_id ?? null,
    columns: [
      { header: 'Employé', cell: (s: EmployeeSuspension) => s.employee_name },
      { header: 'Société', cell: (s: EmployeeSuspension) => s.company?.code ?? '—' },
      { header: 'Type', cell: (s: EmployeeSuspension) => SUSPENSION_LABELS[s.suspension_type] ?? s.suspension_type },
      { header: 'Début', cell: (s: EmployeeSuspension) => fmtDate(s.start_date) },
      { header: 'Fin', cell: (s: EmployeeSuspension) => fmtDate(s.end_date) },
      { header: 'Salaire suspendu', cell: (s: EmployeeSuspension) => s.is_salary_suspended ? 'Oui' : 'Non' },
      { header: 'Motif', cell: (s: EmployeeSuspension) => s.motif ?? '—' },
      { header: 'Statut', cell: (s: EmployeeSuspension) => s.is_active ? 'Active' : 'Levée' },
    ],
    summary: (rows: EmployeeSuspension[]) => [
      { label: 'Total', value: String(rows.length) },
      { label: 'Actives', value: String(rows.filter(s => s.is_active).length) },
      { label: 'Levées', value: String(rows.filter(s => !s.is_active).length) },
      { label: 'Salaire suspendu', value: String(rows.filter(s => s.is_salary_suspended && s.is_active).length) },
    ],
  },
  {
    key: 'explications',
    title: 'Rapport des demandes d\'explication',
    subtitle: 'Demandes, réponses et sanctions',
    icon: AlertOctagon,
    color: '#D97706',
    load: async () => {
      const { data } = await supabase.from('explanation_requests')
        .select('*, company:companies(id, name, code)')
        .order('request_date', { ascending: false })
      return (data ?? []) as ExplanationRequest[]
    },
    dateField: (r: ExplanationRequest) => r.request_date ?? null,
    companyField: (r: ExplanationRequest) => r.company_id ?? null,
    columns: [
      { header: 'Employé', cell: (r: ExplanationRequest) => r.employee_name },
      { header: 'Société', cell: (r: ExplanationRequest) => r.company?.code ?? '—' },
      { header: 'Date', cell: (r: ExplanationRequest) => fmtDate(r.request_date) },
      { header: 'Motif', cell: (r: ExplanationRequest) => r.motif },
      { header: 'Sanction proposée', cell: (r: ExplanationRequest) => r.proposed_sanction ?? '—' },
      { header: 'Sanction appliquée', cell: (r: ExplanationRequest) => r.applied_sanction ?? '—' },
      { header: 'Responsable', cell: (r: ExplanationRequest) => r.responsible_name ?? '—' },
      { header: 'Statut', cell: (r: ExplanationRequest) => EXPLANATION_LABELS[r.status] ?? r.status },
    ],
    summary: (rows: ExplanationRequest[]) => [
      { label: 'Total', value: String(rows.length) },
      { label: 'En attente', value: String(rows.filter(r => r.status === 'en_attente').length) },
      { label: 'Répondues', value: String(rows.filter(r => r.status === 'repondu').length) },
      { label: 'Sanctions appliquées', value: String(rows.filter(r => r.status === 'sanction_appliquee').length) },
    ],
  },
  {
    key: 'masse',
    title: 'Rapport de masse salariale',
    subtitle: 'Masse salariale par société',
    icon: TrendingUp,
    color: '#0B7439',
    load: () => fetchPayrollByCompany(),
    companyField: (c: CompanyPayroll) => c.company_id ?? null,
    columns: [
      { header: 'Société', cell: (c: CompanyPayroll) => c.company_name },
      { header: 'Code', cell: (c: CompanyPayroll) => c.company_code },
      { header: 'Effectif', right: true, cell: (c: CompanyPayroll) => String(c.total_employees) },
      { header: 'Titulaires', right: true, cell: (c: CompanyPayroll) => String(c.titulaires) },
      { header: 'Contractuels', right: true, cell: (c: CompanyPayroll) => String(c.contractuels) },
      { header: 'Masse salariale', right: true, cell: (c: CompanyPayroll) => fmtMoney(c.masse_salariale) },
      { header: 'Salaire moyen', right: true, cell: (c: CompanyPayroll) => fmtMoney(Math.round(Number(c.salaire_moyen))) },
      { header: 'Chauffeurs', right: true, cell: (c: CompanyPayroll) => String(c.nb_chauffeurs) },
      { header: 'Guichetiers', right: true, cell: (c: CompanyPayroll) => String(c.nb_guichetiers) },
      { header: 'Mécaniciens', right: true, cell: (c: CompanyPayroll) => String(c.nb_mecaniciens) },
    ],
    summary: (rows: CompanyPayroll[]) => {
      const emp = rows.reduce((s, c) => s + Number(c.total_employees), 0)
      const masse = rows.reduce((s, c) => s + Number(c.masse_salariale), 0)
      return [
        { label: 'Sociétés', value: String(rows.length) },
        { label: 'Effectif total', value: String(emp) },
        { label: 'Masse salariale totale', value: fmtMoney(masse) },
        { label: 'Salaire moyen global', value: fmtMoney(emp ? Math.round(masse / emp) : 0) },
      ]
    },
  },
  {
    key: 'retenues',
    title: 'Rapport des retenues',
    subtitle: 'Retenues appliquées sur salaire',
    icon: Receipt,
    color: '#AF3029',
    load: async () => {
      const { data } = await supabase.from('salary_deductions')
        .select('*, company:companies(id, name, code)')
        .order('created_at', { ascending: false })
      return (data ?? []) as SalaryDeduction[]
    },
    dateField: (d: SalaryDeduction) => `${d.period_year}-${String(d.period_month).padStart(2, '0')}` ?? null,
    companyField: (d: SalaryDeduction) => d.company_id ?? null,
    columns: [
      { header: 'Employé', cell: (d: SalaryDeduction) => d.employee_name },
      { header: 'Société', cell: (d: SalaryDeduction) => d.company?.code ?? '—' },
      { header: 'Type', cell: (d: SalaryDeduction) => DEDUCTION_LABELS[d.deduction_type] ?? d.deduction_type },
      { header: 'Période', cell: (d: SalaryDeduction) => `${MONTHS[d.period_month - 1] ?? d.period_month} ${d.period_year}` },
      { header: 'Montant', right: true, cell: (d: SalaryDeduction) => fmtMoney(d.amount) },
      { header: 'Motif', cell: (d: SalaryDeduction) => d.motif ?? '—' },
      { header: 'Statut', cell: (d: SalaryDeduction) => DEDUCTION_STATUS[d.status] ?? d.status },
    ],
    summary: (rows: SalaryDeduction[]) => {
      const active = rows.filter(d => d.status !== 'cancelled')
      return [
        { label: 'Total retenues', value: String(rows.length) },
        { label: 'Actives', value: String(rows.filter(d => d.status === 'active').length) },
        { label: 'Annulées', value: String(rows.filter(d => d.status === 'cancelled').length) },
        { label: 'Montant total', value: fmtMoney(active.reduce((s, d) => s + Number(d.amount), 0)) },
      ]
    },
  },
  {
    key: 'emprunts',
    title: 'Rapport des emprunts / avances',
    subtitle: 'Emprunts, avances et acomptes',
    icon: Wallet,
    color: '#1D6FA4',
    load: async () => {
      const { data } = await supabase.from('employee_loans')
        .select('*, company:companies(id, name, code)')
        .order('created_at', { ascending: false })
      return (data ?? []) as EmployeeLoan[]
    },
    dateField: (l: EmployeeLoan) => l.request_date ?? null,
    companyField: (l: EmployeeLoan) => l.company_id ?? null,
    columns: [
      { header: 'Employé', cell: (l: EmployeeLoan) => l.employee_name },
      { header: 'Société', cell: (l: EmployeeLoan) => l.company?.code ?? '—' },
      { header: 'Type', cell: (l: EmployeeLoan) => LOAN_LABELS[l.loan_type] ?? l.loan_type },
      { header: 'Montant accordé', right: true, cell: (l: EmployeeLoan) => fmtMoney(l.amount_granted) },
      { header: 'Demande', cell: (l: EmployeeLoan) => fmtDate(l.request_date) },
      { header: 'Échéances', right: true, cell: (l: EmployeeLoan) => String(l.installment_count) },
      { header: 'Mensualité', right: true, cell: (l: EmployeeLoan) => fmtMoney(l.installment_amount) },
      { header: 'Solde restant', right: true, cell: (l: EmployeeLoan) => fmtMoney(l.remaining_balance) },
      { header: 'Statut', cell: (l: EmployeeLoan) => LOAN_STATUS[l.status] ?? l.status },
    ],
    summary: (rows: EmployeeLoan[]) => [
      { label: 'Total', value: String(rows.length) },
      { label: 'En cours', value: String(rows.filter(l => l.status === 'en_cours').length) },
      { label: 'Montant accordé', value: fmtMoney(rows.reduce((s, l) => s + Number(l.amount_granted), 0)) },
      { label: 'Solde restant', value: fmtMoney(rows.filter(l => l.status === 'en_cours').reduce((s, l) => s + Number(l.remaining_balance), 0)) },
    ],
  },
  {
    key: 'declarations',
    title: 'Rapport des déclarations sociales',
    subtitle: `Cotisations CNPS et ITS — ${new Date().getFullYear()}`,
    icon: Landmark,
    color: '#0B7439',
    load: async () => {
      const { data } = await supabase.from('pay_slips')
        .select('*, company:companies(id, name, code)')
        .eq('period_year', new Date().getFullYear())
        .order('employee_name')
      return (data ?? []) as PaySlip[]
    },
    dateField: (p: PaySlip) => `${p.period_year}-${String(p.period_month).padStart(2, '0')}` ?? null,
    companyField: (p: PaySlip) => p.company_id ?? null,
    columns: [
      { header: 'Employé', cell: (p: PaySlip) => p.employee_name },
      { header: 'Société', cell: (p: PaySlip) => p.company?.code ?? '—' },
      { header: 'Matricule', cell: (p: PaySlip) => p.employee_matricule ?? '—' },
      { header: 'N° CNPS', cell: (p: PaySlip) => p.employee_cnps ?? '—' },
      { header: 'Période', cell: (p: PaySlip) => `${MONTHS[p.period_month - 1] ?? p.period_month} ${p.period_year}` },
      { header: 'Brut', right: true, cell: (p: PaySlip) => fmtMoney(p.gross_salary) },
      { header: 'CNPS sal.', right: true, cell: (p: PaySlip) => fmtMoney(p.cnps_employee) },
      { header: 'CNPS emp.', right: true, cell: (p: PaySlip) => fmtMoney(p.cnps_employer) },
      { header: 'ITS', right: true, cell: (p: PaySlip) => fmtMoney(p.its) },
      { header: 'Net', right: true, cell: (p: PaySlip) => fmtMoney(p.net_salary) },
    ],
    summary: (rows: PaySlip[]) => [
      { label: 'Bulletins', value: String(rows.length) },
      { label: 'Total brut', value: fmtMoney(rows.reduce((s, p) => s + Number(p.gross_salary), 0)) },
      { label: 'CNPS total', value: fmtMoney(rows.reduce((s, p) => s + Number(p.cnps_employee) + Number(p.cnps_employer), 0)) },
      { label: 'ITS total', value: fmtMoney(rows.reduce((s, p) => s + Number(p.its), 0)) },
    ],
  },
]

// ──────────────────────────────────────────────────────────────
// Export helpers
// ──────────────────────────────────────────────────────────────
function exportCSV(def: ReportDef, rows: any[]) {
  const headers = def.columns.map(c => c.header)
  const lines = rows.map(r => def.columns.map(c => `"${c.cell(r).replace(/"/g, '""')}"`).join(';'))
  const content = [headers.join(';'), ...lines].join('\n')
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${def.key}_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function printReport(def: ReportDef, rows: any[]) {
  const stats = def.summary(rows)
  const today = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
  const summaryHtml = stats.map(s => `
    <div class="stat"><span class="stat-label">${s.label}</span><span class="stat-value">${s.value}</span></div>
  `).join('')
  const headHtml = def.columns.map(c => `<th class="${c.right ? 'r' : ''}">${c.header}</th>`).join('')
  const bodyHtml = rows.map(r => `
    <tr>${def.columns.map(c => `<td class="${c.right ? 'r' : ''}">${c.cell(r)}</td>`).join('')}</tr>
  `).join('')

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8" />
  <title>${def.title}</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    * { box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; }
    body { margin: 0; color: #1A2E22; }
    .head { display: flex; justify-content: space-between; align-items: flex-start;
      border-bottom: 3px solid #0B7439; padding-bottom: 12px; margin-bottom: 16px; }
    .brand { font-size: 22px; font-weight: 800; color: #0B7439; letter-spacing: 1px; }
    .brand small { display: block; font-size: 11px; font-weight: 600; color: #4A6B55; letter-spacing: .5px; }
    .doc-title { font-size: 16px; font-weight: 700; text-align: right; }
    .doc-date { font-size: 11px; color: #6B7280; text-align: right; margin-top: 4px; }
    .stats { display: flex; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
    .stat { flex: 1; min-width: 140px; background: #F4F7F5; border: 1px solid #E2EAE5;
      border-radius: 8px; padding: 10px 12px; }
    .stat-label { display: block; font-size: 10px; color: #4A6B55; text-transform: uppercase; letter-spacing: .5px; }
    .stat-value { display: block; font-size: 16px; font-weight: 800; color: #0B7439; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
    thead th { background: #0B7439; color: #fff; padding: 7px 8px; text-align: left; font-weight: 700; }
    thead th.r { text-align: right; }
    tbody td { padding: 6px 8px; border-bottom: 1px solid #E2EAE5; }
    tbody td.r { text-align: right; }
    tbody tr:nth-child(even) { background: #F8FAF8; }
    .foot { margin-top: 14px; font-size: 10px; color: #8AA898; text-align: center; }
  </style></head><body>
    <div class="head">
      <div class="brand">SBTA<small>Société Burkinabè de Transport et d'Affrètement</small></div>
      <div><div class="doc-title">${def.title}</div><div class="doc-date">Édité le ${today}</div></div>
    </div>
    <div class="stats">${summaryHtml}</div>
    <table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>
    <div class="foot">${rows.length} ligne(s) — Document généré automatiquement par le module RH SBTA</div>
    <script>window.onload = function () { window.print(); }</script>
  </body></html>`

  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(html)
  w.document.close()
}

// ──────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const [searchParams] = useSearchParams()
  const reportKey = (searchParams.get('r') ?? 'employes') as ReportKey
  const def = REPORTS.find(r => r.key === reportKey) ?? REPORTS[0]

  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [companies, setCompanies] = useState<CompanyWithHierarchy[]>([])
  const [companyFilter, setCompanyFilter] = useState('')
  const [periodMode, setPeriodMode] = useState<'all' | 'month' | 'custom'>('all')
  const [monthFilter, setMonthFilter] = useState(new Date().toISOString().slice(0, 7))
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [stations, setStations] = useState<{ id: string; name: string }[]>([])
  const [contractType, setContractType] = useState('')
  const [contractNature, setContractNature] = useState('')
  const [stationFilter, setStationFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])

  const isEmployeeReport = reportKey === 'employes' || reportKey === 'chauffeurs'

  useEffect(() => {
    supabase.from('companies').select('id, name, code, parent_id, is_group').order('name')
      .then(({ data }) => { if (data) setCompanies(data as CompanyWithHierarchy[]) })
    supabase.from('stations').select('id, name').order('name')
      .then(({ data }) => { if (data) setStations(data ?? []) })
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setSearch('')
    setCompanyFilter('')
    setPeriodMode('all')
    setDateFrom('')
    setDateTo('')
    setContractType('')
    setContractNature('')
    setStationFilter('')
    setStatusFilter('')
    setSelectedCategories([])
    def.load()
      .then(data => { if (!cancelled) setRows(data) })
      .catch(err => { if (!cancelled) { console.error(err); setError('Impossible de charger les données de ce rapport.') } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [def])

  const filtered = useMemo(() => {
    let result = rows
    // company filter
    if (companyFilter && def.companyField) {
      const matchIds = resolveCompanyIds(companyFilter, companies)
      result = result.filter(r => {
        const cid = def.companyField!(r)
        return cid != null && matchIds.includes(cid)
      })
    }
    // employee-specific filters
    if (isEmployeeReport) {
      if (contractType) {
        result = result.filter((e: Employee) => e.contract_type === contractType)
      }
      if (contractNature) {
        result = result.filter((e: Employee) => e.contract_nature === contractNature)
      }
      if (stationFilter) {
        result = result.filter((e: Employee) => e.station_id === stationFilter)
      }
      if (statusFilter) {
        result = result.filter((e: Employee) => e.status === statusFilter)
      }
      if (selectedCategories.length > 0) {
        const matchRoles = new Set(selectedCategories.flatMap(cat =>
          ROLE_CATEGORIES.find(c => c.value === cat)?.roles ?? []
        ))
        result = result.filter((e: Employee) => matchRoles.has(e.role))
      }
    }
    // period filter
    if (periodMode !== 'all' && def.dateField) {
      result = result.filter(r => {
        const d = def.dateField!(r)
        if (!d) return false
        if (periodMode === 'month' && monthFilter) {
          if (!d.startsWith(monthFilter)) return false
        }
        if (periodMode === 'custom') {
          if (dateFrom && d < dateFrom) return false
          if (dateTo && d > dateTo) return false
        }
        return true
      })
    }
    // text search
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(r => def.columns.some(c => c.cell(r).toLowerCase().includes(q)))
    }
    // sort: employee reports sorted by company code then name
    if (isEmployeeReport) {
      result = [...result].sort((a, b) => {
        const ca = (a as Employee).company_code ?? 'ZZZ'
        const cb = (b as Employee).company_code ?? 'ZZZ'
        if (ca !== cb) return ca.localeCompare(cb)
        return ((a as Employee).full_name ?? '').localeCompare((b as Employee).full_name ?? '')
      })
    }
    return result
  }, [rows, search, def, companyFilter, companies, periodMode, monthFilter, dateFrom, dateTo, isEmployeeReport, contractType, contractNature, stationFilter, statusFilter, selectedCategories])

  const stats = useMemo(() => def.summary(filtered), [filtered, def])
  const Icon = def.icon

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: def.color + '18' }}>
            <Icon className="w-6 h-6" style={{ color: def.color }} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#1A2E22]">{def.title}</h1>
            <p className="text-sm text-[#6B7280] mt-0.5">{def.subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportCSV(def, filtered)}
            disabled={loading || filtered.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-[#E2EAE5] text-[#4A6B55] hover:bg-[#F8FAF8] transition-colors disabled:opacity-40"
          >
            <Download className="w-4 h-4" /> CSV
          </button>
          <button
            onClick={() => printReport(def, filtered)}
            disabled={loading || filtered.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg text-white transition-colors disabled:opacity-40"
            style={{ backgroundColor: def.color }}
          >
            <Printer className="w-4 h-4" /> Imprimer / PDF
          </button>
        </div>
      </div>

      {/* Report tabs */}
      <div className="flex flex-wrap gap-2">
        {REPORTS.map(r => {
          const active = r.key === def.key
          return (
            <Link
              key={r.key}
              to={`/rh/reports?r=${r.key}`}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                active
                  ? 'bg-[#0B7439] text-white border-[#0B7439]'
                  : 'bg-white text-[#4A6B55] border-[#E2EAE5] hover:bg-[#F8FAF8]'
              }`}
            >
              {r.title.replace('Rapport de la ', '').replace('Rapport des ', '').replace('Rapport de ', '').replace('Rapport ', '')}
            </Link>
          )
        })}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {stats.map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-[#E2EAE5] p-4">
            <p className="text-xs text-[#8AA898] uppercase tracking-wide">{s.label}</p>
            <p className="text-lg font-bold mt-1" style={{ color: def.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8AA898]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher dans le rapport…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[#E2EAE5] focus:outline-none focus:ring-2 focus:ring-[#0B7439]/30"
          />
        </div>
        <button onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium"
          style={{ backgroundColor: showFilters ? '#0B743910' : 'white', border: '1px solid #E2EAE5', color: showFilters ? '#0B7439' : '#4A6B55' }}>
          <Filter className="w-3.5 h-3.5" />Filtres
        </button>
      </div>

      {showFilters && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-xl p-4 bg-white border border-[#E2EAE5]">
          {def.companyField && (
            <div>
              <label className="block text-xs font-semibold mb-1 text-[#4A6B55]">Société</label>
              <CompanyGroupSelect
                companies={companies}
                value={companyFilter}
                onChange={setCompanyFilter}
                placeholder="Toutes les sociétés"
                className="w-full px-2 py-1.5 rounded-lg text-xs border border-[#E2EAE5] text-[#1A2E22]"
              />
            </div>
          )}
          {isEmployeeReport && (
            <>
              <div>
                <label className="block text-xs font-semibold mb-1 text-[#4A6B55]">Contrat</label>
                <select value={contractType} onChange={e => setContractType(e.target.value)}
                  className="w-full px-2 py-1.5 rounded-lg text-xs border border-[#E2EAE5] text-[#1A2E22]">
                  <option value="">Tous les contrats</option>
                  {CONTRACT_TYPES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 text-[#4A6B55]">Nature</label>
                <select value={contractNature} onChange={e => setContractNature(e.target.value)}
                  className="w-full px-2 py-1.5 rounded-lg text-xs border border-[#E2EAE5] text-[#1A2E22]">
                  <option value="">Toutes les natures</option>
                  {CONTRACT_NATURES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 text-[#4A6B55]">Gare</label>
                <select value={stationFilter} onChange={e => setStationFilter(e.target.value)}
                  className="w-full px-2 py-1.5 rounded-lg text-xs border border-[#E2EAE5] text-[#1A2E22]">
                  <option value="">Toutes les gares</option>
                  {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 text-[#4A6B55]">Statut</label>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                  className="w-full px-2 py-1.5 rounded-lg text-xs border border-[#E2EAE5] text-[#1A2E22]">
                  <option value="">Tous les statuts</option>
                  {EMPLOYEE_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div className="col-span-1 sm:col-span-3">
                <label className="block text-xs font-semibold mb-1.5 text-[#4A6B55]">Postes / Catégories</label>
                <div className="flex flex-wrap gap-2">
                  {ROLE_CATEGORIES.map(cat => {
                    const active = selectedCategories.includes(cat.value)
                    return (
                      <button key={cat.value} type="button"
                        onClick={() => setSelectedCategories(prev =>
                          active ? prev.filter(c => c !== cat.value) : [...prev, cat.value]
                        )}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                        style={{
                          backgroundColor: active ? '#0B7439' : '#F4F7F5',
                          color: active ? '#fff' : '#4A6B55',
                          border: '1px solid ' + (active ? '#0B7439' : '#E2EAE5'),
                        }}>
                        {cat.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </>
          )}
          {def.dateField && (
            <>
              <div>
                <label className="block text-xs font-semibold mb-1 text-[#4A6B55]">Période</label>
                <select value={periodMode} onChange={e => setPeriodMode(e.target.value as any)}
                  className="w-full px-2 py-1.5 rounded-lg text-xs border border-[#E2EAE5] text-[#1A2E22]">
                  <option value="all">Toutes périodes</option>
                  <option value="month">Par mois</option>
                  <option value="custom">Dates personnalisées</option>
                </select>
              </div>
              {periodMode === 'month' && (
                <div>
                  <label className="block text-xs font-semibold mb-1 text-[#4A6B55]">Mois</label>
                  <input type="month" value={monthFilter} onChange={e => setMonthFilter(e.target.value)}
                    className="w-full px-2 py-1.5 rounded-lg text-xs border border-[#E2EAE5] text-[#1A2E22]" />
                </div>
              )}
              {periodMode === 'custom' && (
                <div className="col-span-1 sm:col-span-3 grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-[#4A6B55]">Du</label>
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                      className="w-full px-2 py-1.5 rounded-lg text-xs border border-[#E2EAE5] text-[#1A2E22]" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-[#4A6B55]">Au</label>
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                      className="w-full px-2 py-1.5 rounded-lg text-xs border border-[#E2EAE5] text-[#1A2E22]" />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="p-10 text-center text-[#AF3029] text-sm">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-[#8AA898] text-sm">Aucune donnée à afficher pour ce rapport.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F4F7F5] border-b border-[#E2EAE5]">
                  {def.columns.map(c => (
                    <th key={c.header}
                      className={`px-4 py-3 font-semibold text-[#1A2E22] whitespace-nowrap ${c.right ? 'text-right' : 'text-left'}`}>
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={r.id ?? r.company_id ?? i} className="border-b border-[#F0F4F1] hover:bg-[#F8FAF8]">
                    {def.columns.map(c => (
                      <td key={c.header}
                        className={`px-4 py-2.5 whitespace-nowrap ${c.right ? 'text-right font-medium text-[#1A2E22]' : 'text-[#4A6B55]'}`}>
                        {c.cell(r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && !error && filtered.length > 0 && (
        <p className="text-xs text-[#8AA898]">{filtered.length} ligne(s) affichée(s){search && ` sur ${rows.length}`}</p>
      )}
    </div>
  )
}
