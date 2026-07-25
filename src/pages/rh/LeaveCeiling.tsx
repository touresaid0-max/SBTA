import { useState, useEffect, useCallback } from 'react'
import {
  CalendarClock, Plus, Search, X, Pencil, Trash2, Eye,
  Building2, AlertTriangle, Download,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/store/authStore'
import { fetchEmployees } from '@/services/hr.service'
import {
  fetchLeaveCeilings, createLeaveCeiling, updateLeaveCeiling, deleteLeaveCeiling,
  fetchLeaveSettings, updateLeaveSettings,
} from '@/services/leave.service'
import {
  CEILING_STATUS_LABELS,
} from '@/types/leave.types'
import type {
  LeaveCeiling as Ceiling, LeaveCeilingInput, CeilingStatus, LeaveSettings,
} from '@/types/leave.types'
import type { Employee } from '@/types/hr.types'
import { buildCompanyGroups, resolveCompanyIds } from '@/utils/companyGroups'
import type { CompanyWithHierarchy } from '@/utils/companyGroups'

type Company = CompanyWithHierarchy

const ROLE_LABELS: Record<string, string> = {
  chauffeur: 'Chauffeur', guichetier: 'Guichetier', agent_reservation: 'Agent Réservation',
  mecanicien: 'Mécanicien', pompiste: 'Pompiste', chef_garage: 'Chef Garage', chef_gare: 'Chef Gare',
  bagagiste: 'Bagagiste', gestionnaire: 'Gestionnaire', planificateur: 'Planificateur',
  comptable: 'Comptable', daf: 'DAF', rh: 'RH', admin: 'Admin', charge_achat: "Chargé d'Achat",
  agent_colis: 'Agent Courrier', superviseur_colis: 'Superviseur Courrier',
  gerant_principal: 'Gérant Principal', responsable_assurance: 'Resp. Assurance',
  responsable_logistique: 'Resp. Logistique', carburant: 'Carburant', agent_qhse: 'Agent QHSE',
}

export default function LeaveCeilingPage() {
  const { user } = useAuthStore()
  const [loading, setLoading] = useState(true)
  const [ceilings, setCeilings] = useState<Ceiling[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [settings, setSettings] = useState<LeaveSettings | null>(null)
  const [savingBlock, setSavingBlock] = useState(false)

  // Filters
  const [search, setSearch] = useState('')
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear())
  const [companyFilter, setCompanyFilter] = useState('')
  const [employeeFilter, setEmployeeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  // Modal
  const [showForm, setShowForm] = useState(false)
  const [editingCeiling, setEditingCeiling] = useState<Ceiling | null>(null)
  const [viewingCeiling, setViewingCeiling] = useState<Ceiling | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Ceiling | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [ceils, emps, s, comps] = await Promise.all([
        fetchLeaveCeilings(),
        fetchEmployees({
          company_id: null, station_id: null, role: null,
          contract_type: null, contract_nature: null, status: 'active', search: '',
        }),
        fetchLeaveSettings(),
        supabase.from('companies').select('id, name, code, parent_id, is_group').order('name').then(r => r.data ?? []),
      ])
      setCeilings(ceils)
      setEmployees(emps)
      setSettings(s)
      setCompanies(comps as Company[])
    } catch {
      toast.error('Erreur lors du chargement')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // ── Filters ──
  const filtered = ceilings.filter(c => {
    if (yearFilter && c.year !== yearFilter) return false
    if (statusFilter && c.status !== statusFilter) return false
    if (employeeFilter && c.employee_id !== employeeFilter) return false
    if (companyFilter) {
      const matchIds = resolveCompanyIds(companyFilter, companies)
      if (!c.company_id || !matchIds.includes(c.company_id)) return false
    }
    if (search) {
      const s = search.toLowerCase()
      return (
        c.employee_name.toLowerCase().includes(s) ||
        (c.company_name ?? '').toLowerCase().includes(s) ||
        (c.motif ?? '').toLowerCase().includes(s) ||
        (c.observations ?? '').toLowerCase().includes(s)
      )
    }
    return true
  })

  // ── Actions ──
  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteLeaveCeiling(deleteTarget.id)
      toast.success('Plafond supprimé')
      setDeleteTarget(null)
      loadData()
    } catch {
      toast.error('Erreur lors de la suppression')
    }
  }

  const handleToggleBlock = async () => {
    if (!settings) return
    setSavingBlock(true)
    try {
      const newVal = !settings.block_on_ceiling_exceed
      await updateLeaveSettings({ block_on_ceiling_exceed: newVal }, user?.id ?? '')
      setSettings({ ...settings, block_on_ceiling_exceed: newVal })
      toast.success(newVal ? 'Blocage activé — les demandes dépassant le plafond seront refusées' : 'Blocage désactivé — alerte seulement')
    } catch {
      toast.error('Erreur lors de la modification')
    } finally {
      setSavingBlock(false)
    }
  }

  const exportExcel = async () => {
    try {
      const XLSX = await import('xlsx')
      const data = filtered.map(c => ({
        'Employé': c.employee_name,
        'Société': c.company_name ?? '—',
        'Motif': c.motif ?? '—',
        'Année': c.year,
        'Plafond (jours)': c.ceiling_days,
        "Date d'effet": c.effective_date,
        'Statut': CEILING_STATUS_LABELS[c.status],
        'Observations': c.observations ?? '—',
      }))
      const wb = XLSX.utils.book_new()
      const ws = XLSX.utils.json_to_sheet(data)
      XLSX.utils.book_append_sheet(wb, ws, 'Plafonds de congés')
      XLSX.writeFile(wb, `plafonds_conges_${yearFilter}.xlsx`)
      toast.success('Export Excel réussi')
    } catch {
      toast.error("Erreur lors de l'export Excel")
    }
  }

  const exportPDF = async () => {
    try {
      const jsPDF = (await import('jspdf')).default
      const doc = new jsPDF('l', 'mm', 'a4')
      const pageWidth = doc.internal.pageSize.getWidth()

      doc.setFontSize(14)
      doc.setFont('helvetica', 'bold')
      doc.text(`Plafonds de congés — ${yearFilter}`, 14, 15)
      doc.setFontSize(9)
      doc.setFont('helvetica', 'normal')
      doc.text(`Généré le ${new Date().toLocaleDateString('fr-FR')} — ${filtered.length} plafond(s)`, 14, 21)

      const headers = ['Employé', 'Société', 'Année', 'Plafond (j)', 'Effet', 'Statut']
      const colWidths = [55, 45, 20, 25, 30, 25]
      let y = 30
      let x = 14
      doc.setFillColor(11, 116, 57)
      doc.rect(14, y - 5, pageWidth - 28, 8, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(8)
      doc.setFont('helvetica', 'bold')
      headers.forEach((h, i) => { doc.text(h, x, y); x += colWidths[i] })

      doc.setTextColor(0, 0, 0)
      doc.setFont('helvetica', 'normal')
      y += 6
      filtered.forEach((c, idx) => {
        if (y > 195) { doc.addPage(); y = 20 }
        if (idx % 2 === 0) {
          doc.setFillColor(245, 247, 245)
          doc.rect(14, y - 4, pageWidth - 28, 6, 'F')
        }
        x = 14
        const values = [
          c.employee_name.substring(0, 30),
          (c.company_name ?? '—').substring(0, 24),
          String(c.year),
          String(c.ceiling_days),
          c.effective_date,
          CEILING_STATUS_LABELS[c.status],
        ]
        values.forEach((v, i) => { doc.text(v, x, y); x += colWidths[i] })
        y += 6
      })

      doc.save(`plafonds_conges_${yearFilter}.pdf`)
      toast.success('Export PDF réussi')
    } catch {
      toast.error("Erreur lors de l'export PDF")
    }
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Plafonds de congés</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Attribution d'un plafond annuel de congés individuel par employé
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportExcel} disabled={filtered.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm border transition-colors disabled:opacity-50"
            style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
            <Download className="w-4 h-4" /> Excel
          </button>
          <button onClick={exportPDF} disabled={filtered.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm border transition-colors disabled:opacity-50"
            style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
            <Download className="w-4 h-4" /> PDF
          </button>
          <button onClick={() => { setEditingCeiling(null); setShowForm(true) }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm text-white transition-colors"
            style={{ backgroundColor: 'var(--primary)' }}>
            <Plus className="w-4 h-4" /> Nouveau plafond
          </button>
        </div>
      </div>

      {/* Block/alert setting */}
      {settings && (
        <div className="rounded-xl border p-4 flex items-center justify-between"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5" style={{ color: '#D97706' }} />
            <div>
              <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                Comportement en cas de dépassement de plafond
              </p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {settings.block_on_ceiling_exceed
                  ? 'Blocage activé — les demandes dépassant le plafond seront automatiquement refusées'
                  : 'Alerte seulement — les demandes seront créées avec une alerte de dépassement'}
              </p>
            </div>
          </div>
          <button onClick={handleToggleBlock} disabled={savingBlock}
            className="px-4 py-2 rounded-lg font-medium text-sm transition-colors disabled:opacity-50"
            style={{
              backgroundColor: settings.block_on_ceiling_exceed ? '#FEE2E2' : 'var(--primary-light)',
              color: settings.block_on_ceiling_exceed ? '#AF3029' : 'var(--primary)',
            }}>
            {settings.block_on_ceiling_exceed ? 'Désactiver le blocage' : 'Activer le blocage'}
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="rounded-xl border p-4" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            <input placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)}
              className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
          </div>
          <select value={yearFilter} onChange={e => setYearFilter(parseInt(e.target.value))}
            className="border rounded-lg px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <select value={companyFilter} onChange={e => setCompanyFilter(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
            <option value="">Toutes les sociétés</option>
            {(() => {
              const { groups, standalone } = buildCompanyGroups(companies)
              return (
                <>
                  {groups.map(({ group, subsidiaries }) => (
                    <optgroup key={group.id} label={group.name}>
                      <option value={group.id}>{group.name} (groupe)</option>
                      {subsidiaries.map(s => (
                        <option key={s.id} value={s.id}>{`\u00A0\u00A0${s.name} (${s.code})`}</option>
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
          <select value={employeeFilter} onChange={e => setEmployeeFilter(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
            <option value="">Tous les employés</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
            <option value="">Tous les statuts</option>
            {Object.entries(CEILING_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 rounded-full animate-spin"
              style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40" style={{ color: 'var(--text-muted)' }}>
            <CalendarClock className="w-10 h-10 mb-2 opacity-30" />
            <p className="text-sm">Aucun plafond de congés trouvé</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead style={{ backgroundColor: 'var(--bg-subtle)' }}>
                <tr>
                  <th className="text-left p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Employé</th>
                  <th className="text-left p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Société</th>
                  <th className="text-left p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Motif</th>
                  <th className="text-center p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Année</th>
                  <th className="text-center p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Plafond</th>
                  <th className="text-left p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Date d'effet</th>
                  <th className="text-left p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Statut</th>
                  <th className="text-center p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.id} className="border-t hover:bg-gray-50 transition-colors" style={{ borderColor: 'var(--border)' }}>
                    <td className="p-3 font-medium" style={{ color: 'var(--text-primary)' }}>{c.employee_name}</td>
                    <td className="p-3" style={{ color: 'var(--text-secondary)' }}>{c.company_name ?? '—'}</td>
                    <td className="p-3 max-w-[180px] truncate" style={{ color: 'var(--text-secondary)' }} title={c.motif ?? ''}>
                      {c.motif ?? '—'}
                    </td>
                    <td className="p-3 text-center" style={{ color: 'var(--text-primary)' }}>{c.year}</td>
                    <td className="p-3 text-center font-semibold" style={{ color: 'var(--primary)' }}>
                      {c.ceiling_days} j
                    </td>
                    <td className="p-3" style={{ color: 'var(--text-secondary)' }}>
                      {new Date(c.effective_date).toLocaleDateString('fr-FR')}
                    </td>
                    <td className="p-3">
                      <span className="px-2 py-1 rounded-lg text-xs font-medium"
                        style={{
                          backgroundColor: c.status === 'actif' ? '#DCFCE7' : '#FEE2E2',
                          color: c.status === 'actif' ? '#0B7439' : '#AF3029',
                        }}>
                        {CEILING_STATUS_LABELS[c.status]}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex gap-1 justify-center">
                        <button onClick={() => setViewingCeiling(c)} title="Consulter"
                          className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--text-secondary)' }}>
                          <Eye className="w-4 h-4" />
                        </button>
                        <button onClick={() => { setEditingCeiling(c); setShowForm(true) }} title="Modifier"
                          className="p-1.5 rounded-lg transition-colors" style={{ color: '#1D6FA4' }}>
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => setDeleteTarget(c)} title="Supprimer"
                          className="p-1.5 rounded-lg transition-colors" style={{ color: '#AF3029' }}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Form modal */}
      {showForm && (
        <CeilingFormModal
          employees={employees}
          companies={companies}
          existing={editingCeiling}
          onClose={() => { setShowForm(false); setEditingCeiling(null) }}
          onSaved={() => { setShowForm(false); setEditingCeiling(null); loadData() }}
          creatorId={user?.id}
        />
      )}

      {/* View modal */}
      {viewingCeiling && (
        <ViewCeilingModal ceiling={viewingCeiling} onClose={() => setViewingCeiling(null)} />
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#FEE2E2' }}>
                <Trash2 className="w-5 h-5" style={{ color: '#AF3029' }} />
              </div>
              <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Supprimer le plafond</h3>
            </div>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Voulez-vous vraiment supprimer le plafond de <strong>{deleteTarget.employee_name}</strong> pour {deleteTarget.year} ?
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 border rounded-xl text-sm" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                Annuler
              </button>
              <button onClick={handleDelete}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
                style={{ backgroundColor: '#AF3029' }}>
                Confirmer la suppression
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════
// CEILING FORM MODAL
// ═════════════════════════════════════════════════════════════════════
function CeilingFormModal({ employees, existing, onClose, onSaved, creatorId }: {
  employees: Employee[]
  companies: Company[]
  existing: Ceiling | null
  onClose: () => void
  onSaved: () => void
  creatorId?: string
}) {
  const [employeeId, setEmployeeId] = useState(existing?.employee_id ?? '')
  const [motif, setMotif] = useState(existing?.motif ?? '')
  const [year, setYear] = useState(existing?.year ?? new Date().getFullYear())
  const [ceilingDays, setCeilingDays] = useState(existing?.ceiling_days ?? 26)
  const [effectiveDate, setEffectiveDate] = useState(existing?.effective_date ?? new Date().toISOString().split('T')[0])
  const [observations, setObservations] = useState(existing?.observations ?? '')
  const [status, setStatus] = useState<CeilingStatus>(existing?.status ?? 'actif')
  const [saving, setSaving] = useState(false)

  const selectedEmp = employees.find(e => e.id === employeeId)

  const handleSubmit = async () => {
    if (!employeeId || !selectedEmp) {
      toast.error('Veuillez sélectionner un employé')
      return
    }
    if (ceilingDays < 0) {
      toast.error('Le plafond ne peut pas être négatif')
      return
    }
    if (!effectiveDate) {
      toast.error('Veuillez renseigner la date d\'effet')
      return
    }

    const input: LeaveCeilingInput = {
      employee_id: employeeId,
      employee_name: selectedEmp.full_name,
      company_id: selectedEmp.company_id,
      company_name: selectedEmp.company_name,
      motif: motif || null,
      year,
      ceiling_days: ceilingDays,
      effective_date: effectiveDate,
      observations: observations || null,
      status,
      created_by: creatorId,
    }

    setSaving(true)
    try {
      if (existing) {
        await updateLeaveCeiling(existing.id, input)
        toast.success('Plafond modifié')
      } else {
        await createLeaveCeiling(input)
        toast.success('Plafond créé')
      }
      onSaved()
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg === 'UNIQUE_CEILING') {
        toast.error(`Un plafond actif existe déjà pour ${selectedEmp.full_name} en ${year}. Désactivez l'ancien ou changez l'année.`)
      } else {
        toast.error('Erreur lors de l\'enregistrement')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            {existing ? 'Modifier le plafond' : 'Nouveau plafond de congés'}
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>

        {/* Employee */}
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Employé *</label>
          {existing ? (
            <div className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-primary)' }}>
              {existing.employee_name}
            </div>
          ) : (
            <select value={employeeId} onChange={e => setEmployeeId(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}>
              <option value="">Sélectionner un employé</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>
                  {e.full_name} — {ROLE_LABELS[e.role] ?? e.role}
                  {e.company_name ? ` (${e.company_name})` : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Company (auto) */}
        {selectedEmp && (
          <div className="rounded-lg p-3 text-sm flex items-center gap-2"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}>
            <Building2 className="w-4 h-4 flex-shrink-0" />
            <span>Société: <strong style={{ color: 'var(--text-primary)' }}>{selectedEmp.company_name ?? 'SBTA Holding'}</strong></span>
          </div>
        )}

        {/* Motif */}
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Motif</label>
          <input type="text" value={motif} onChange={e => setMotif(e.target.value)}
            placeholder="Ex: Régularisation, ancienneté, accord particulier..."
            className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }} />
        </div>

        {/* Year + Days */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Année *</label>
            <select value={year} onChange={e => setYear(parseInt(e.target.value))}
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}>
              {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Plafond (jours) *</label>
            <input type="number" min={0} value={ceilingDays}
              onChange={e => setCeilingDays(parseInt(e.target.value) || 0)}
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }} />
          </div>
        </div>

        {/* Effective date */}
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Date d'effet *</label>
          <input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }} />
        </div>

        {/* Status */}
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Statut</label>
          <select value={status} onChange={e => setStatus(e.target.value as CeilingStatus)}
            className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}>
            {Object.entries(CEILING_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>

        {/* Observations */}
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Observations</label>
          <textarea value={observations} onChange={e => setObservations(e.target.value)}
            placeholder="Notes complémentaires..."
            className="w-full border rounded-lg px-3 py-2 text-sm min-h-[60px]" style={{ borderColor: 'var(--border)' }} />
        </div>

        <div className="flex gap-3 justify-end">
          <button onClick={onClose}
            className="px-4 py-2 border rounded-xl text-sm" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
            Annuler
          </button>
          <button onClick={handleSubmit} disabled={saving}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--primary)' }}>
            {saving ? 'Enregistrement...' : existing ? 'Modifier' : 'Créer le plafond'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════
// VIEW MODAL
// ═════════════════════════════════════════════════════════════════════
function ViewCeilingModal({ ceiling, onClose }: {
  ceiling: Ceiling
  onClose: () => void
}) {
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Employé', value: ceiling.employee_name },
    { label: 'Société', value: ceiling.company_name ?? '—' },
    { label: 'Motif', value: ceiling.motif ?? '—' },
    { label: 'Année', value: String(ceiling.year) },
    { label: 'Plafond annuel', value: `${ceiling.ceiling_days} jours` },
    { label: 'Date d\'effet', value: new Date(ceiling.effective_date).toLocaleDateString('fr-FR') },
    { label: 'Statut', value: CEILING_STATUS_LABELS[ceiling.status] },
    { label: 'Observations', value: ceiling.observations ?? '—' },
    { label: 'Créé le', value: new Date(ceiling.created_at).toLocaleDateString('fr-FR') },
  ]

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Détail du plafond</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex justify-between py-2 border-b" style={{ borderColor: 'var(--border)' }}>
              <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{r.label}</span>
              <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{r.value}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <button onClick={onClose}
            className="px-4 py-2 border rounded-xl text-sm" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  )
}
