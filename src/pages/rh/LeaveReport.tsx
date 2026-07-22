import { useState, useEffect, useCallback, useRef } from 'react'
import {
  FileText, Download, Calendar, Filter,
} from 'lucide-react'
import { buildCompanyGroups, resolveCompanyIds } from '@/utils/companyGroups'
import type { CompanyWithHierarchy } from '@/utils/companyGroups'
import toast from 'react-hot-toast'
import { supabase } from '@/services/supabase'
import { fetchEmployees } from '@/services/hr.service'
import {
  fetchLeaveRequests, fetchPermissionRequests, fetchLeaveSettings, fetchLeaveBalances,
} from '@/services/leave.service'
import {
  LEAVE_TYPE_LABELS, LEAVE_STATUS_LABELS, PERMISSION_TYPE_LABELS, PERMISSION_STATUS_LABELS,
} from '@/types/leave.types'
import type {
  LeaveRequest, PermissionRequest, LeaveSettings, LeaveBalance,
  LeaveReportRow,
} from '@/types/leave.types'
import type { Employee } from '@/types/hr.types'

const ROLE_LABELS: Record<string, string> = {
  chauffeur: 'Chauffeur', guichetier: 'Guichetier', agent_reservation: 'Agent Réservation',
  mecanicien: 'Mécanicien', pompiste: 'Pompiste', chef_garage: 'Chef Garage', chef_gare: 'Chef Gare',
  bagagiste: 'Bagagiste', gestionnaire: 'Gestionnaire', planificateur: 'Planificateur',
  comptable: 'Comptable', daf: 'DAF', rh: 'RH', admin: 'Admin', charge_achat: "Chargé d'Achat",
  agent_colis: 'Agent Courrier', superviseur_colis: 'Superviseur Courrier',
  gerant_principal: 'Gérant Principal', responsable_assurance: 'Resp. Assurance',
  responsable_logistique: 'Resp. Logistique', carburant: 'Carburant', agent_qhse: 'Agent QHSE',
}

type Company = CompanyWithHierarchy
interface Station { id: string; name: string; company_id: string | null }

export default function LeaveReportPage() {
  const [loading, setLoading] = useState(true)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [stations, setStations] = useState<Station[]>([])
  const [settings, setSettings] = useState<LeaveSettings | null>(null)
  const [reportRows, setReportRows] = useState<LeaveReportRow[]>([])

  // Filters
  const [year, setYear] = useState(new Date().getFullYear())
  const [employeeFilter, setEmployeeFilter] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [stationFilter, setStationFilter] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [absenceTypeFilter, setAbsenceTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const reportRef = useRef<HTMLDivElement>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [emps, s, comps, stats] = await Promise.all([
        fetchEmployees({
          company_id: null, station_id: null, role: null,
          contract_type: null, contract_nature: null, status: 'active', search: '',
        }),
        fetchLeaveSettings(),
        supabase.from('companies').select('id, name, code, parent_id, is_group').order('name').then(r => r.data ?? []),
        supabase.from('stations').select('id, name, company_id').order('name').then(r => r.data ?? []),
      ])
      setEmployees(emps)
      setSettings(s)
      setCompanies(comps as Company[])
      setStations(stats as Station[])
    } catch {
      toast.error('Erreur lors du chargement')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const generateReport = useCallback(async () => {
    if (!settings) return
    setLoading(true)
    try {
      // Filter employees
      let filtered = employees
      if (companyFilter) {
        const matchIds = resolveCompanyIds(companyFilter, companies)
        filtered = filtered.filter(e => e.company_id && matchIds.includes(e.company_id))
      }
      if (stationFilter) filtered = filtered.filter(e => e.station_id === stationFilter)
      if (roleFilter) filtered = filtered.filter(e => e.role === roleFilter)
      if (employeeFilter) filtered = filtered.filter(e => e.id === employeeFilter)

      // Fetch all leave and permission requests for the year
      const [leaves, perms] = await Promise.all([
        fetchLeaveRequests({ year }),
        fetchPermissionRequests({ year }),
      ])

      // Fetch balances
      const empForBalance = filtered.map(e => ({
        id: e.id, name: e.full_name,
        company_id: e.company_id, company_name: e.company_name,
      }))
      const balances = await fetchLeaveBalances(empForBalance, settings, year)
      const balanceMap = new Map(balances.map(b => [b.employee_id, b]))

      // Build report rows
      const rows: LeaveReportRow[] = filtered.map(emp => {
        const empLeaves = leaves.filter(l => l.employee_id === emp.id)
        const empPerms = perms.filter(p => p.employee_id === emp.id)
        const bal = balanceMap.get(emp.id)

        return {
          employee_id: emp.id,
          employee_name: emp.full_name,
          role: ROLE_LABELS[emp.role] ?? emp.role,
          company_name: emp.company_name ?? 'SBTA Holding',
          station_name: emp.station_name ?? null,
          annual_entitled: bal?.annual_entitled ?? settings.annual_leave_days,
          days_taken: bal?.days_taken ?? 0,
          days_remaining: bal?.days_remaining ?? settings.annual_leave_days,
          permissions_count: empPerms.filter(p => p.status === 'valide').length,
          permissions_hours: empPerms
            .filter(p => p.status === 'valide')
            .reduce((s, p) => s + p.duration_hours, 0),
          leave_periods: empLeaves.map(l => ({
            type: l.leave_type, start: l.start_date, end: l.end_date,
            days: l.days_count, status: l.status,
          })),
          permission_periods: empPerms.map(p => ({
            type: p.permission_type, start: p.start_datetime, end: p.end_datetime,
            hours: p.duration_hours, status: p.status,
          })),
        }
      })

      // Apply absence type and status filters on rows
      let finalRows = rows
      if (absenceTypeFilter) {
        finalRows = finalRows.filter(r =>
          r.leave_periods.some(p => p.type === absenceTypeFilter) ||
          r.permission_periods.some(p => p.type === absenceTypeFilter)
        )
      }
      if (statusFilter) {
        finalRows = finalRows.filter(r =>
          r.leave_periods.some(p => p.status === statusFilter) ||
          r.permission_periods.some(p => p.status === statusFilter)
        )
      }

      setReportRows(finalRows)
      toast.success(`${finalRows.length} employé${finalRows.length > 1 ? 's' : ''} dans le rapport`)
    } catch {
      toast.error('Erreur lors de la génération du rapport')
    } finally {
      setLoading(false)
    }
  }, [employees, settings, year, companyFilter, stationFilter, roleFilter, employeeFilter, absenceTypeFilter, statusFilter])

  // ── Export Excel ──
  const exportExcel = async () => {
    try {
      const XLSX = await import('xlsx')
      const data = reportRows.map(r => ({
        'Employé': r.employee_name,
        'Poste': r.role,
        'Société': r.company_name,
        'Gare': r.station_name ?? '—',
        'Congés attribués': r.annual_entitled,
        'Congés pris': r.days_taken,
        'Congés restants': r.days_remaining,
        'Permissions (nb)': r.permissions_count,
        'Permissions (heures)': r.permissions_hours,
        'Périodes de congé': r.leave_periods
          .map(p => `${LEAVE_TYPE_LABELS[p.type]}: ${new Date(p.start).toLocaleDateString('fr-FR')} → ${new Date(p.end).toLocaleDateString('fr-FR')} (${p.days}j, ${LEAVE_STATUS_LABELS[p.status]})`)
          .join(' | '),
        'Périodes de permission': r.permission_periods
          .map(p => `${PERMISSION_TYPE_LABELS[p.type]}: ${new Date(p.start).toLocaleString('fr-FR')} (${p.hours}h, ${PERMISSION_STATUS_LABELS[p.status]})`)
          .join(' | '),
      }))

      // Totals by company
      const companyTotals: Record<string, { taken: number; remaining: number; perms: number; hours: number }> = {}
      reportRows.forEach(r => {
        if (!companyTotals[r.company_name]) {
          companyTotals[r.company_name] = { taken: 0, remaining: 0, perms: 0, hours: 0 }
        }
        companyTotals[r.company_name].taken += r.days_taken
        companyTotals[r.company_name].remaining += r.days_remaining
        companyTotals[r.company_name].perms += r.permissions_count
        companyTotals[r.company_name].hours += r.permissions_hours
      })
      const totalsSheet = Object.entries(companyTotals).map(([name, t]) => ({
        'Société': name,
        'Total congés pris': t.taken,
        'Total congés restants': t.remaining,
        'Total permissions (nb)': t.perms,
        'Total permissions (heures)': t.hours,
      }))

      const wb = XLSX.utils.book_new()
      const ws1 = XLSX.utils.json_to_sheet(data)
      XLSX.utils.book_append_sheet(wb, ws1, 'Analyse par employé')
      const ws2 = XLSX.utils.json_to_sheet(totalsSheet)
      XLSX.utils.book_append_sheet(wb, ws2, 'Totaux par société')

      XLSX.writeFile(wb, `analyse_conges_permissions_${year}.xlsx`)
      toast.success('Export Excel réussi')
    } catch {
      toast.error('Erreur lors de l\'export Excel')
    }
  }

  // ── Export PDF ──
  const exportPDF = async () => {
    try {
      const jsPDF = (await import('jspdf')).default
      await import('html2canvas')

      const doc = new jsPDF('l', 'mm', 'a4')
      const pageWidth = doc.internal.pageSize.getWidth()

      // Title
      doc.setFontSize(16)
      doc.setFont('helvetica', 'bold')
      doc.text(`Analyse annuelle des congés et permissions — ${year}`, 14, 15)
      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')
      doc.text(`Généré le ${new Date().toLocaleDateString('fr-FR')} — ${reportRows.length} employés`, 14, 22)

      // Table header
      let y = 30
      const headers = ['Employé', 'Poste', 'Société', 'Attribués', 'Pris', 'Restants', 'Perm (nb)', 'Perm (h)']
      const colWidths = [50, 35, 40, 22, 18, 22, 22, 22]
      let x = 14
      doc.setFillColor(11, 116, 57)
      doc.rect(14, y - 5, pageWidth - 28, 8, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(8)
      doc.setFont('helvetica', 'bold')
      headers.forEach((h, i) => {
        doc.text(h, x, y)
        x += colWidths[i]
      })

      // Rows
      doc.setTextColor(0, 0, 0)
      doc.setFont('helvetica', 'normal')
      y += 6
      reportRows.forEach((r, idx) => {
        if (y > 195) {
          doc.addPage()
          y = 20
        }
        if (idx % 2 === 0) {
          doc.setFillColor(245, 247, 245)
          doc.rect(14, y - 4, pageWidth - 28, 6, 'F')
        }
        x = 14
        const values = [
          r.employee_name.substring(0, 28),
          r.role.substring(0, 20),
          r.company_name.substring(0, 22),
          String(r.annual_entitled),
          String(r.days_taken),
          String(r.days_remaining),
          String(r.permissions_count),
          String(r.permissions_hours),
        ]
        values.forEach((v, i) => {
          doc.text(v, x, y)
          x += colWidths[i]
        })
        y += 6
      })

      // Totals
      y += 4
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      const totalTaken = reportRows.reduce((s, r) => s + r.days_taken, 0)
      const totalRemaining = reportRows.reduce((s, r) => s + r.days_remaining, 0)
      const totalPerms = reportRows.reduce((s, r) => s + r.permissions_count, 0)
      const totalHours = reportRows.reduce((s, r) => s + r.permissions_hours, 0)
      doc.text(`TOTAUX: ${totalTaken} jours pris | ${totalRemaining} jours restants | ${totalPerms} permissions (${totalHours}h)`, 14, y)

      doc.save(`analyse_conges_permissions_${year}.pdf`)
      toast.success('Export PDF réussi')
    } catch {
      toast.error('Erreur lors de l\'export PDF')
    }
  }

  const totalTaken = reportRows.reduce((s, r) => s + r.days_taken, 0)
  const totalRemaining = reportRows.reduce((s, r) => s + r.days_remaining, 0)
  const totalPerms = reportRows.reduce((s, r) => s + r.permissions_count, 0)
  const totalHours = reportRows.reduce((s, r) => s + r.permissions_hours, 0)

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Analyse annuelle des congés et permissions
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Rapport détaillé par employé, service, gare et société — {year}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportExcel} disabled={reportRows.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm border transition-colors disabled:opacity-50"
            style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
            <Download className="w-4 h-4" /> Excel
          </button>
          <button onClick={exportPDF} disabled={reportRows.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm text-white transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'var(--primary)' }}>
            <Download className="w-4 h-4" /> PDF
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-xl border p-4" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Filtres</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {/* Year */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Année</label>
            <select value={year} onChange={e => setYear(parseInt(e.target.value))}
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}>
              {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          {/* Employee */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Employé</label>
            <select value={employeeFilter} onChange={e => setEmployeeFilter(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}>
              <option value="">Tous les employés</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </div>
          {/* Company */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Société</label>
            <select value={companyFilter} onChange={e => setCompanyFilter(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}>
              <option value="">Toutes les sociétés</option>
              {(() => {
                const { groups, standalone } = buildCompanyGroups(companies)
                return (
                  <>
                    {groups.map(({ group, subsidiaries }) => (
                      <optgroup key={group.id} label={group.name}>
                        <option value={group.id}>
                          {group.name} (groupe + sous-groupes)
                        </option>
                        {subsidiaries.map(s => (
                          <option key={s.id} value={s.id}>
                            {`\u00A0\u00A0${s.name} (${s.code})`}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                    {standalone.map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                    ))}
                  </>
                )
              })()}
            </select>
          </div>
          {/* Station */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Gare</label>
            <select value={stationFilter} onChange={e => setStationFilter(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}>
              <option value="">Toutes les gares</option>
              {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          {/* Role */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Poste</label>
            <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}>
              <option value="">Tous les postes</option>
              {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          {/* Absence type */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Type d'absence</label>
            <select value={absenceTypeFilter} onChange={e => setAbsenceTypeFilter(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}>
              <option value="">Tous les types</option>
              <optgroup label="Congés">
                {Object.entries(LEAVE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </optgroup>
              <optgroup label="Permissions">
                {Object.entries(PERMISSION_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </optgroup>
            </select>
          </div>
          {/* Status */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Statut</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}>
              <option value="">Tous les statuts</option>
              <optgroup label="Congés">
                {Object.entries(LEAVE_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </optgroup>
              <optgroup label="Permissions">
                {Object.entries(PERMISSION_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </optgroup>
            </select>
          </div>
          {/* Generate button */}
          <div className="flex items-end">
            <button onClick={generateReport} disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--primary)' }}>
              {loading ? 'Génération...' : 'Générer le rapport'}
            </button>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      {reportRows.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Employés', value: reportRows.length, color: 'var(--primary)' },
            { label: 'Jours pris', value: totalTaken, color: '#D97706' },
            { label: 'Jours restants', value: totalRemaining, color: '#0B7439' },
            { label: 'Permissions', value: `${totalPerms} (${totalHours}h)`, color: '#1D6FA4' },
          ].map((card, i) => (
            <div key={i} className="rounded-xl border p-4" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{card.label}</p>
              <p className="text-2xl font-bold mt-1" style={{ color: card.color }}>{card.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Report table */}
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 rounded-full animate-spin"
              style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
          </div>
        ) : reportRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40" style={{ color: 'var(--text-muted)' }}>
            <FileText className="w-10 h-10 mb-2 opacity-30" />
            <p className="text-sm">Cliquez sur « Générer le rapport » pour afficher les données</p>
          </div>
        ) : (
          <div className="overflow-x-auto" ref={reportRef}>
            <table className="w-full text-sm">
              <thead style={{ backgroundColor: 'var(--bg-subtle)' }}>
                <tr>
                  <th className="text-left p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Employé</th>
                  <th className="text-left p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Poste</th>
                  <th className="text-left p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Société</th>
                  <th className="text-left p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Gare</th>
                  <th className="text-center p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Attribués</th>
                  <th className="text-center p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Pris</th>
                  <th className="text-center p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Restants</th>
                  <th className="text-center p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Perm (nb)</th>
                  <th className="text-center p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Perm (h)</th>
                  <th className="text-left p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Périodes d'absence</th>
                </tr>
              </thead>
              <tbody>
                {reportRows.map(r => (
                  <tr key={r.employee_id} className="border-t hover:bg-gray-50 transition-colors" style={{ borderColor: 'var(--border)' }}>
                    <td className="p-3 font-medium" style={{ color: 'var(--text-primary)' }}>{r.employee_name}</td>
                    <td className="p-3" style={{ color: 'var(--text-secondary)' }}>{r.role}</td>
                    <td className="p-3" style={{ color: 'var(--text-secondary)' }}>{r.company_name}</td>
                    <td className="p-3" style={{ color: 'var(--text-secondary)' }}>{r.station_name ?? '—'}</td>
                    <td className="p-3 text-center" style={{ color: 'var(--text-primary)' }}>{r.annual_entitled}</td>
                    <td className="p-3 text-center font-semibold" style={{ color: '#D97706' }}>{r.days_taken}</td>
                    <td className="p-3 text-center font-semibold" style={{ color: '#0B7439' }}>{r.days_remaining}</td>
                    <td className="p-3 text-center" style={{ color: 'var(--text-primary)' }}>{r.permissions_count}</td>
                    <td className="p-3 text-center" style={{ color: 'var(--text-primary)' }}>{r.permissions_hours}h</td>
                    <td className="p-3 max-w-[300px]">
                      <div className="space-y-1">
                        {r.leave_periods.map((p, i) => (
                          <div key={`l${i}`} className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                            <span className="font-medium">{LEAVE_TYPE_LABELS[p.type]}</span>: {new Date(p.start).toLocaleDateString('fr-FR')} → {new Date(p.end).toLocaleDateString('fr-FR')} ({p.days}j)
                          </div>
                        ))}
                        {r.permission_periods.map((p, i) => (
                          <div key={`p${i}`} className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            <span className="font-medium">{PERMISSION_TYPE_LABELS[p.type]}</span>: {new Date(p.start).toLocaleDateString('fr-FR')} ({p.hours}h)
                          </div>
                        ))}
                        {r.leave_periods.length === 0 && r.permission_periods.length === 0 && (
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                  <td colSpan={4} className="p-3 font-bold" style={{ color: 'var(--text-primary)' }}>TOTAUX</td>
                  <td className="p-3 text-center font-bold" style={{ color: 'var(--text-primary)' }}>{reportRows.reduce((s, r) => s + r.annual_entitled, 0)}</td>
                  <td className="p-3 text-center font-bold" style={{ color: '#D97706' }}>{totalTaken}</td>
                  <td className="p-3 text-center font-bold" style={{ color: '#0B7439' }}>{totalRemaining}</td>
                  <td className="p-3 text-center font-bold" style={{ color: 'var(--text-primary)' }}>{totalPerms}</td>
                  <td className="p-3 text-center font-bold" style={{ color: 'var(--text-primary)' }}>{totalHours}h</td>
                  <td className="p-3"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Totals by company */}
      {reportRows.length > 0 && (
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Totaux par société</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead style={{ backgroundColor: 'var(--bg-subtle)' }}>
                <tr>
                  <th className="text-left p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Société</th>
                  <th className="text-center p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Employés</th>
                  <th className="text-center p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Congés pris</th>
                  <th className="text-center p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Congés restants</th>
                  <th className="text-center p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Permissions</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(
                  reportRows.reduce((acc, r) => {
                    if (!acc[r.company_name]) acc[r.company_name] = { count: 0, taken: 0, remaining: 0, perms: 0, hours: 0 }
                    acc[r.company_name].count++
                    acc[r.company_name].taken += r.days_taken
                    acc[r.company_name].remaining += r.days_remaining
                    acc[r.company_name].perms += r.permissions_count
                    acc[r.company_name].hours += r.permissions_hours
                    return acc
                  }, {} as Record<string, { count: number; taken: number; remaining: number; perms: number; hours: number }>)
                ).map(([name, t]) => (
                  <tr key={name} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="p-3 font-medium" style={{ color: 'var(--text-primary)' }}>{name}</td>
                    <td className="p-3 text-center" style={{ color: 'var(--text-secondary)' }}>{t.count}</td>
                    <td className="p-3 text-center font-semibold" style={{ color: '#D97706' }}>{t.taken}</td>
                    <td className="p-3 text-center font-semibold" style={{ color: '#0B7439' }}>{t.remaining}</td>
                    <td className="p-3 text-center" style={{ color: 'var(--text-secondary)' }}>{t.perms} ({t.hours}h)</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

