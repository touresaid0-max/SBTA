import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CalendarDays, Clock, Plus, CheckCircle, XCircle, Ban, Settings as SettingsIcon,
  Search, ChevronDown, AlertTriangle, X, Eye, RotateCcw,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/store/authStore'
import { fetchEmployees } from '@/services/hr.service'
import {
  fetchLeaveRequests, createLeaveRequest, updateLeaveStatus, cancelLeaveRequest,
  fetchPermissionRequests, createPermissionRequest, updatePermissionStatus, cancelPermissionRequest,
  fetchLeaveSettings, updateLeaveSettings, fetchLeaveAlerts, dismissAlert,
  generateAlerts, calculateLeaveDays, calculatePermissionHours,
} from '@/services/leave.service'
import {
  LEAVE_TYPE_LABELS, LEAVE_STATUS_LABELS, PERMISSION_TYPE_LABELS, PERMISSION_STATUS_LABELS,
  EXCEPTIONAL_LEAVE_REASONS,
} from '@/types/leave.types'
import type {
  LeaveRequest, PermissionRequest, LeaveSettings, LeaveAlert,
  LeaveType, LeaveStatus, PermissionType, PermissionStatus,
} from '@/types/leave.types'
import type { Employee } from '@/types/hr.types'
import StatusBadge from '@/components/shared/StatusBadge'

type TabType = 'conges' | 'permissions' | 'settings'

const ROLE_LABELS: Record<string, string> = {
  chauffeur: 'Chauffeur', guichetier: 'Guichetier', agent_reservation: 'Agent Réservation',
  mecanicien: 'Mécanicien', pompiste: 'Pompiste', chef_garage: 'Chef Garage', chef_gare: 'Chef Gare',
  bagagiste: 'Bagagiste', gestionnaire: 'Gestionnaire', planificateur: 'Planificateur',
  comptable: 'Comptable', daf: 'DAF', rh: 'RH', admin: 'Admin', charge_achat: "Chargé d'Achat",
  agent_colis: 'Agent Courrier', superviseur_colis: 'Superviseur Courrier',
  gerant_principal: 'Gérant Principal', responsable_assurance: 'Resp. Assurance',
  responsable_logistique: 'Resp. Logistique', carburant: 'Carburant', agent_qhse: 'Agent QHSE',
}

export default function LeavePermissionsPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()

  const [activeTab, setActiveTab] = useState<TabType>('conges')
  const [loading, setLoading] = useState(true)

  // Data
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([])
  const [permissionRequests, setPermissionRequests] = useState<PermissionRequest[]>([])
  const [alerts, setAlerts] = useState<LeaveAlert[]>([])
  const [settings, setSettings] = useState<LeaveSettings | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])

  // Filters
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [typeFilter, setTypeFilter] = useState<string>('')

  // Modals
  const [showLeaveForm, setShowLeaveForm] = useState(false)
  const [showPermForm, setShowPermForm] = useState(false)
  const [refuseTarget, setRefuseTarget] = useState<{ type: 'leave' | 'permission'; id: string } | null>(null)
  const [refuseReason, setRefuseReason] = useState('')

  // Settings form
  const [settingsForm, setSettingsForm] = useState<LeaveSettings | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [leaves, perms, s, alertList] = await Promise.all([
        fetchLeaveRequests(),
        fetchPermissionRequests(),
        fetchLeaveSettings(),
        fetchLeaveAlerts(),
      ])
      setLeaveRequests(leaves)
      setPermissionRequests(perms)
      setSettings(s)
      setSettingsForm(s)
      setAlerts(alertList)

      // Load employees for dropdowns
      const emps = await fetchEmployees({
        company_id: null, station_id: null, role: null,
        contract_type: null, contract_nature: null, status: 'active', search: '',
      })
      setEmployees(emps)

      // Generate alerts
      await generateAlerts(s)
    } catch {
      toast.error('Erreur lors du chargement')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // ── Filters ──
  const filteredLeaves = leaveRequests.filter(l => {
    if (statusFilter && l.status !== statusFilter) return false
    if (typeFilter && l.leave_type !== typeFilter) return false
    if (search) {
      const s = search.toLowerCase()
      return l.employee_name.toLowerCase().includes(s) || (l.reason ?? '').toLowerCase().includes(s)
    }
    return true
  })

  const filteredPerms = permissionRequests.filter(p => {
    if (statusFilter && p.status !== statusFilter) return false
    if (typeFilter && p.permission_type !== typeFilter) return false
    if (search) {
      const s = search.toLowerCase()
      return p.employee_name.toLowerCase().includes(s) || (p.reason ?? '').toLowerCase().includes(s)
    }
    return true
  })

  // ── Actions ──
  const handleValidateLeave = async (id: string) => {
    if (!user) return
    try {
      await updateLeaveStatus(id, 'valide', user.id)
      toast.success('Congé validé')
      loadData()
    } catch { toast.error('Erreur lors de la validation') }
  }

  const handleRefuseLeave = async () => {
    if (!refuseTarget || !user) return
    try {
      if (refuseTarget.type === 'leave') {
        await updateLeaveStatus(refuseTarget.id, 'refuse', user.id, refuseReason)
      } else {
        await updatePermissionStatus(refuseTarget.id, 'refuse', user.id, refuseReason)
      }
      toast.success('Demande refusée')
      setRefuseTarget(null)
      setRefuseReason('')
      loadData()
    } catch { toast.error('Erreur lors du refus') }
  }

  const handleValidatePerm = async (id: string) => {
    if (!user) return
    try {
      await updatePermissionStatus(id, 'valide', user.id)
      toast.success('Permission validée')
      loadData()
    } catch { toast.error('Erreur lors de la validation') }
  }

  const handleCancelLeave = async (id: string) => {
    try {
      await cancelLeaveRequest(id)
      toast.success('Demande annulée')
      loadData()
    } catch { toast.error('Erreur lors de l\'annulation') }
  }

  const handleCancelPerm = async (id: string) => {
    try {
      await cancelPermissionRequest(id)
      toast.success('Permission annulée')
      loadData()
    } catch { toast.error('Erreur lors de l\'annulation') }
  }

  const handleSaveSettings = async () => {
    if (!settingsForm || !user) return
    setSavingSettings(true)
    try {
      await updateLeaveSettings({
        annual_leave_days: settingsForm.annual_leave_days,
        carryover_enabled: settingsForm.carryover_enabled,
        carryover_max_days: settingsForm.carryover_max_days,
        carryover_deadline_month: settingsForm.carryover_deadline_month,
        alert_days_before_return: settingsForm.alert_days_before_return,
        permission_alert_hours_before_end: settingsForm.permission_alert_hours_before_end,
      }, user.id)
      toast.success('Paramètres enregistrés')
      loadData()
    } catch { toast.error('Erreur lors de l\'enregistrement') }
    finally { setSavingSettings(false) }
  }

  const handleDismissAlert = async (alertId: string) => {
    try {
      await dismissAlert(alertId)
      setAlerts(prev => prev.filter(a => a.id !== alertId))
    } catch { /* ignore */ }
  }

  const tabs = [
    { key: 'conges' as TabType, label: 'Congés', count: leaveRequests.length, icon: CalendarDays },
    { key: 'permissions' as TabType, label: 'Permissions', count: permissionRequests.length, icon: Clock },
    { key: 'settings' as TabType, label: 'Paramètres', count: 0, icon: SettingsIcon },
  ]

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Congés et Permissions</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Gestion des congés payés et permissions exceptionnelles — Code du Travail ivoirien
          </p>
        </div>
        {activeTab === 'conges' && (
          <button onClick={() => setShowLeaveForm(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm text-white transition-colors"
            style={{ backgroundColor: 'var(--primary)' }}>
            <Plus className="w-4 h-4" /> Nouveau congé
          </button>
        )}
        {activeTab === 'permissions' && (
          <button onClick={() => setShowPermForm(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm text-white transition-colors"
            style={{ backgroundColor: 'var(--primary)' }}>
            <Plus className="w-4 h-4" /> Nouvelle permission
          </button>
        )}
      </div>

      {/* Alerts banner */}
      {alerts.length > 0 && (
        <div className="rounded-xl border p-4 space-y-2"
          style={{ backgroundColor: '#FEF3C7', borderColor: '#FCD34D' }}>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5" style={{ color: '#D97706' }} />
            <span className="font-semibold text-sm" style={{ color: '#92400E' }}>
              {alerts.length} alerte{alerts.length > 1 ? 's' : ''} active{alerts.length > 1 ? 's' : ''}
            </span>
          </div>
          {alerts.slice(0, 5).map(a => (
            <div key={a.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2">
              <div className="flex items-center gap-2 text-sm" style={{ color: '#92400E' }}>
                <Clock className="w-4 h-4 flex-shrink-0" />
                <span>{a.message}</span>
                <span className="text-xs" style={{ color: '#6B7280' }}>
                  — {new Date(a.target_date).toLocaleDateString('fr-FR')}
                </span>
              </div>
              <button onClick={() => handleDismissAlert(a.id)}
                className="p-1 rounded hover:bg-gray-100 transition-colors" style={{ color: '#9CA3AF' }}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {alerts.length > 5 && (
            <p className="text-xs text-center" style={{ color: '#92400E' }}>
              +{alerts.length - 5} autre{alerts.length - 5 > 1 ? 's' : ''} alerte{alerts.length - 5 > 1 ? 's' : ''}
            </p>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="rounded-xl border" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="flex border-b" style={{ borderColor: 'var(--border)' }}>
          {tabs.map(({ key, label, count, icon: Icon }) => (
            <button key={key} onClick={() => { setActiveTab(key); setStatusFilter(''); setTypeFilter('') }}
              className="flex items-center gap-2 px-5 py-3 font-medium text-sm border-b-2 transition-colors"
              style={{
                borderBottomColor: activeTab === key ? 'var(--primary)' : 'transparent',
                color: activeTab === key ? 'var(--primary)' : 'var(--text-secondary)',
              }}>
              <Icon className="w-4 h-4" />
              {label}
              {count > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs font-bold"
                  style={{
                    backgroundColor: activeTab === key ? 'var(--primary-light)' : 'var(--bg-subtle)',
                    color: activeTab === key ? 'var(--primary)' : 'var(--text-secondary)',
                  }}>
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Filters bar */}
        {activeTab !== 'settings' && (
          <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                <input placeholder="Rechercher..."
                  value={search} onChange={e => setSearch(e.target.value)}
                  className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
              </div>
              <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
                className="border rounded-lg px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                <option value="">Tous les types</option>
                {activeTab === 'conges'
                  ? Object.entries(LEAVE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)
                  : Object.entries(PERMISSION_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                className="border rounded-lg px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                <option value="">Tous les statuts</option>
                {activeTab === 'conges'
                  ? Object.entries(LEAVE_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)
                  : Object.entries(PERMISSION_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="p-4">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <div className="w-8 h-8 border-4 rounded-full animate-spin"
                style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
            </div>
          ) : activeTab === 'conges' ? (
            <LeaveTable
              requests={filteredLeaves}
              onValidate={handleValidateLeave}
              onRefuse={(id) => { setRefuseTarget({ type: 'leave', id }); setRefuseReason('') }}
              onCancel={handleCancelLeave}
            />
          ) : activeTab === 'permissions' ? (
            <PermissionTable
              requests={filteredPerms}
              onValidate={handleValidatePerm}
              onRefuse={(id) => { setRefuseTarget({ type: 'permission', id }); setRefuseReason('') }}
              onCancel={handleCancelPerm}
            />
          ) : (
            <SettingsTab settings={settingsForm} onChange={setSettingsForm}
              onSave={handleSaveSettings} saving={savingSettings} />
          )}
        </div>
      </div>

      {/* Leave form modal */}
      {showLeaveForm && (
        <LeaveFormModal
          employees={employees}
          settings={settings}
          onClose={() => setShowLeaveForm(false)}
          onCreated={() => { setShowLeaveForm(false); loadData() }}
          creatorId={user?.id}
        />
      )}

      {/* Permission form modal */}
      {showPermForm && (
        <PermissionFormModal
          employees={employees}
          onClose={() => setShowPermForm(false)}
          onCreated={() => { setShowPermForm(false); loadData() }}
          creatorId={user?.id}
        />
      )}

      {/* Refuse modal */}
      {refuseTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#FEE2E2' }}>
                <XCircle className="w-5 h-5" style={{ color: '#AF3029' }} />
              </div>
              <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Refuser la demande</h3>
            </div>
            <textarea placeholder="Motif du refus (obligatoire)"
              value={refuseReason} onChange={e => setRefuseReason(e.target.value)}
              className="w-full border rounded-xl px-3 py-2 text-sm min-h-[80px]"
              style={{ borderColor: 'var(--border)' }} />
            <div className="flex gap-3 justify-end">
              <button onClick={() => { setRefuseTarget(null); setRefuseReason('') }}
                className="px-4 py-2 border rounded-xl text-sm" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                Annuler
              </button>
              <button onClick={handleRefuseLeave} disabled={!refuseReason.trim()}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: '#AF3029' }}>
                Confirmer le refus
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════
// LEAVE TABLE
// ═════════════════════════════════════════════════════════════════════
function LeaveTable({ requests, onValidate, onRefuse, onCancel }: {
  requests: LeaveRequest[]
  onValidate: (id: string) => void
  onRefuse: (id: string) => void
  onCancel: (id: string) => void
}) {
  if (requests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40" style={{ color: 'var(--text-muted)' }}>
        <CalendarDays className="w-10 h-10 mb-2 opacity-30" />
        <p className="text-sm">Aucune demande de congé</p>
      </div>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead style={{ backgroundColor: 'var(--bg-subtle)' }}>
          <tr>
            <th className="text-left p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Employé</th>
            <th className="text-left p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Type</th>
            <th className="text-left p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Période</th>
            <th className="text-center p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Jours</th>
            <th className="text-left p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Motif</th>
            <th className="text-left p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Statut</th>
            <th className="text-center p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {requests.map(r => (
            <tr key={r.id} className="border-t hover:bg-gray-50 transition-colors" style={{ borderColor: 'var(--border)' }}>
              <td className="p-3">
                <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{r.employee_name}</div>
                {r.company?.name && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.company.name}</div>}
              </td>
              <td className="p-3">
                <span className="px-2 py-1 rounded-lg text-xs font-medium"
                  style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
                  {LEAVE_TYPE_LABELS[r.leave_type]}
                </span>
              </td>
              <td className="p-3" style={{ color: 'var(--text-primary)' }}>
                {new Date(r.start_date).toLocaleDateString('fr-FR')} → {new Date(r.end_date).toLocaleDateString('fr-FR')}
              </td>
              <td className="p-3 text-center font-semibold" style={{ color: 'var(--text-primary)' }}>{r.days_count}</td>
              <td className="p-3 max-w-[200px] truncate" style={{ color: 'var(--text-secondary)' }} title={r.reason ?? ''}>
                {r.reason ?? '—'}
              </td>
              <td className="p-3"><StatusBadge status={r.status} /></td>
              <td className="p-3">
                <div className="flex gap-1 justify-center">
                  {r.status === 'en_attente' && (
                    <>
                      <button onClick={() => onValidate(r.id)} title="Valider"
                        className="p-1.5 rounded-lg transition-colors" style={{ color: '#0B7439' }}>
                        <CheckCircle className="w-4 h-4" />
                      </button>
                      <button onClick={() => onRefuse(r.id)} title="Refuser"
                        className="p-1.5 rounded-lg transition-colors" style={{ color: '#AF3029' }}>
                        <XCircle className="w-4 h-4" />
                      </button>
                    </>
                  )}
                  {(r.status === 'en_attente' || r.status === 'valide') && (
                    <button onClick={() => onCancel(r.id)} title="Annuler"
                      className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--text-muted)' }}>
                      <Ban className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════
// PERMISSION TABLE
// ═════════════════════════════════════════════════════════════════════
function PermissionTable({ requests, onValidate, onRefuse, onCancel }: {
  requests: PermissionRequest[]
  onValidate: (id: string) => void
  onRefuse: (id: string) => void
  onCancel: (id: string) => void
}) {
  if (requests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40" style={{ color: 'var(--text-muted)' }}>
        <Clock className="w-10 h-10 mb-2 opacity-30" />
        <p className="text-sm">Aucune demande de permission</p>
      </div>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead style={{ backgroundColor: 'var(--bg-subtle)' }}>
          <tr>
            <th className="text-left p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Employé</th>
            <th className="text-left p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Type</th>
            <th className="text-left p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Période</th>
            <th className="text-center p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Heures</th>
            <th className="text-left p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Motif</th>
            <th className="text-left p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Statut</th>
            <th className="text-center p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {requests.map(r => (
            <tr key={r.id} className="border-t hover:bg-gray-50 transition-colors" style={{ borderColor: 'var(--border)' }}>
              <td className="p-3">
                <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{r.employee_name}</div>
                {r.company?.name && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.company.name}</div>}
              </td>
              <td className="p-3">
                <span className="px-2 py-1 rounded-lg text-xs font-medium"
                  style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
                  {PERMISSION_TYPE_LABELS[r.permission_type]}
                </span>
              </td>
              <td className="p-3 text-xs" style={{ color: 'var(--text-primary)' }}>
                {new Date(r.start_datetime).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                <br />→ {new Date(r.end_datetime).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </td>
              <td className="p-3 text-center font-semibold" style={{ color: 'var(--text-primary)' }}>{r.duration_hours}h</td>
              <td className="p-3 max-w-[200px] truncate" style={{ color: 'var(--text-secondary)' }} title={r.reason ?? ''}>
                {r.reason ?? '—'}
              </td>
              <td className="p-3"><StatusBadge status={r.status} /></td>
              <td className="p-3">
                <div className="flex gap-1 justify-center">
                  {r.status === 'en_attente' && (
                    <>
                      <button onClick={() => onValidate(r.id)} title="Valider"
                        className="p-1.5 rounded-lg transition-colors" style={{ color: '#0B7439' }}>
                        <CheckCircle className="w-4 h-4" />
                      </button>
                      <button onClick={() => onRefuse(r.id)} title="Refuser"
                        className="p-1.5 rounded-lg transition-colors" style={{ color: '#AF3029' }}>
                        <XCircle className="w-4 h-4" />
                      </button>
                    </>
                  )}
                  {(r.status === 'en_attente' || r.status === 'valide') && (
                    <button onClick={() => onCancel(r.id)} title="Annuler"
                      className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--text-muted)' }}>
                      <Ban className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════
// SETTINGS TAB
// ═════════════════════════════════════════════════════════════════════
function SettingsTab({ settings, onChange, onSave, saving }: {
  settings: LeaveSettings | null
  onChange: (s: LeaveSettings) => void
  onSave: () => void
  saving: boolean
}) {
  if (!settings) return null
  return (
    <div className="max-w-2xl space-y-6">
      <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-subtle)' }}>
        <h3 className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Configuration des congés</h3>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Conforme au Code du Travail ivoirien — Art. 23: 2,5 jours calendaires par mois (26 jours/an)
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Jours de congé annuel</label>
          <input type="number" value={settings.annual_leave_days}
            onChange={e => onChange({ ...settings, annual_leave_days: parseInt(e.target.value) || 0 })}
            className="w-full border rounded-lg px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)' }} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Alerte fin de congé (jours avant)</label>
          <input type="number" value={settings.alert_days_before_return}
            onChange={e => onChange({ ...settings, alert_days_before_return: parseInt(e.target.value) || 0 })}
            className="w-full border rounded-lg px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)' }} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Alerte fin permission (heures avant)</label>
          <input type="number" value={settings.permission_alert_hours_before_end}
            onChange={e => onChange({ ...settings, permission_alert_hours_before_end: parseInt(e.target.value) || 0 })}
            className="w-full border rounded-lg px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)' }} />
        </div>
        <div className="flex items-center gap-3 pt-6">
          <input type="checkbox" id="carryover" checked={settings.carryover_enabled}
            onChange={e => onChange({ ...settings, carryover_enabled: e.target.checked })}
            className="w-5 h-5 rounded" />
          <label htmlFor="carryover" className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Autoriser le report de congés
          </label>
        </div>
        {settings.carryover_enabled && (
          <>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Report max (jours)</label>
              <input type="number" value={settings.carryover_max_days}
                onChange={e => onChange({ ...settings, carryover_max_days: parseInt(e.target.value) || 0 })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)' }} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Échéance report (mois)</label>
              <input type="number" value={settings.carryover_deadline_month} min={1} max={12}
                onChange={e => onChange({ ...settings, carryover_deadline_month: parseInt(e.target.value) || 3 })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)' }} />
            </div>
          </>
        )}
      </div>
      <div className="flex justify-end">
        <button onClick={onSave} disabled={saving}
          className="px-6 py-2 rounded-xl font-semibold text-sm text-white transition-colors disabled:opacity-50"
          style={{ backgroundColor: 'var(--primary)' }}>
          {saving ? 'Enregistrement...' : 'Enregistrer les paramètres'}
        </button>
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════
// LEAVE FORM MODAL
// ═════════════════════════════════════════════════════════════════════
function LeaveFormModal({ employees, settings, onClose, onCreated, creatorId }: {
  employees: Employee[]
  settings: LeaveSettings | null
  onClose: () => void
  onCreated: () => void
  creatorId?: string
}) {
  const [employeeId, setEmployeeId] = useState('')
  const [leaveType, setLeaveType] = useState<LeaveType>('conge_annuel')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const selectedEmp = employees.find(e => e.id === employeeId)
  const daysCount = startDate && endDate ? calculateLeaveDays(startDate, endDate) : 0

  // Auto-fill days for exceptional leave
  useEffect(() => {
    if (leaveType === 'conge_maternite' && startDate) {
      const end = new Date(startDate)
      end.setDate(end.getDate() + 98) // 14 weeks
      setEndDate(end.toISOString().split('T')[0])
    } else if (leaveType === 'conge_paternite' && startDate) {
      const end = new Date(startDate)
      end.setDate(end.getDate() + 1) // 2 working days
      setEndDate(end.toISOString().split('T')[0])
    }
  }, [leaveType, startDate])

  const handleSubmit = async () => {
    if (!employeeId || !startDate || !endDate || !selectedEmp) {
      toast.error('Veuillez remplir tous les champs obligatoires')
      return
    }
    if (new Date(startDate) > new Date(endDate)) {
      toast.error('La date de fin doit être après la date de début')
      return
    }
    setSaving(true)
    try {
      await createLeaveRequest({
        employee_id: employeeId,
        employee_source: selectedEmp.source_table ?? 'employees',
        employee_name: selectedEmp.full_name,
        company_id: selectedEmp.company_id,
        leave_type: leaveType,
        start_date: startDate,
        end_date: endDate,
        days_count: daysCount,
        reason: reason || undefined,
        created_by: creatorId,
      })
      toast.success('Demande de congé créée')
      onCreated()
    } catch {
      toast.error('Erreur lors de la création')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Nouvelle demande de congé</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>

        {/* Employee */}
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Employé *</label>
          <select value={employeeId} onChange={e => setEmployeeId(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}>
            <option value="">Sélectionner un employé</option>
            {employees.map(e => (
              <option key={e.id} value={e.id}>
                {e.full_name} — {ROLE_LABELS[e.role] ?? e.role} {e.company_name ? `(${e.company_name})` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Balance preview */}
        {selectedEmp && settings && (
          <div className="rounded-lg p-3 text-sm" style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}>
            <span className="font-medium">Solde annuel:</span> {settings.annual_leave_days} jours |
            <span className="font-medium ml-2">Jours pris cette année:</span> Calculé après validation
          </div>
        )}

        {/* Leave type */}
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Type de congé *</label>
          <select value={leaveType} onChange={e => setLeaveType(e.target.value as LeaveType)}
            className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}>
            {Object.entries(LEAVE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Date de début *</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Date de fin *</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }} />
          </div>
        </div>

        {/* Days count */}
        {daysCount > 0 && (
          <div className="rounded-lg p-3 text-sm" style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
            <strong>{daysCount} jour{daysCount > 1 ? 's' : ''}</strong> de congé (hors dimanches)
          </div>
        )}

        {/* Reason */}
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Motif</label>
          {leaveType === 'conge_exceptionnel' ? (
            <select onChange={e => setReason(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}>
              <option value="">Sélectionner un motif</option>
              {EXCEPTIONAL_LEAVE_REASONS.map(r => (
                <option key={r.reason} value={`${r.reason} (${r.days} jour${r.days > 1 ? 's' : ''})`}>
                  {r.reason} — {r.days} jour{r.days > 1 ? 's' : ''}
                </option>
              ))}
            </select>
          ) : (
            <textarea value={reason} onChange={e => setReason(e.target.value)}
              placeholder="Motif du congé..."
              className="w-full border rounded-lg px-3 py-2 text-sm min-h-[60px]" style={{ borderColor: 'var(--border)' }} />
          )}
        </div>

        <div className="flex gap-3 justify-end">
          <button onClick={onClose}
            className="px-4 py-2 border rounded-xl text-sm" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
            Annuler
          </button>
          <button onClick={handleSubmit} disabled={saving}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--primary)' }}>
            {saving ? 'Création...' : 'Créer la demande'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════
// PERMISSION FORM MODAL
// ═════════════════════════════════════════════════════════════════════
function PermissionFormModal({ employees, onClose, onCreated, creatorId }: {
  employees: Employee[]
  onClose: () => void
  onCreated: () => void
  creatorId?: string
}) {
  const [employeeId, setEmployeeId] = useState('')
  const [permType, setPermType] = useState<PermissionType>('personnelle')
  const [startDt, setStartDt] = useState('')
  const [endDt, setEndDt] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const selectedEmp = employees.find(e => e.id === employeeId)
  const hours = startDt && endDt ? calculatePermissionHours(startDt, endDt) : 0

  const handleSubmit = async () => {
    if (!employeeId || !startDt || !endDt || !selectedEmp) {
      toast.error('Veuillez remplir tous les champs obligatoires')
      return
    }
    if (new Date(startDt) >= new Date(endDt)) {
      toast.error('La fin doit être après le début')
      return
    }
    setSaving(true)
    try {
      await createPermissionRequest({
        employee_id: employeeId,
        employee_source: selectedEmp.source_table ?? 'employees',
        employee_name: selectedEmp.full_name,
        company_id: selectedEmp.company_id,
        permission_type: permType,
        start_datetime: startDt,
        end_datetime: endDt,
        duration_hours: hours,
        reason: reason || undefined,
        created_by: creatorId,
      })
      toast.success('Demande de permission créée')
      onCreated()
    } catch {
      toast.error('Erreur lors de la création')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Nouvelle demande de permission</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Employé *</label>
          <select value={employeeId} onChange={e => setEmployeeId(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}>
            <option value="">Sélectionner un employé</option>
            {employees.map(e => (
              <option key={e.id} value={e.id}>
                {e.full_name} — {ROLE_LABELS[e.role] ?? e.role} {e.company_name ? `(${e.company_name})` : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Type de permission *</label>
          <select value={permType} onChange={e => setPermType(e.target.value as PermissionType)}
            className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}>
            {Object.entries(PERMISSION_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Début *</label>
            <input type="datetime-local" value={startDt} onChange={e => setStartDt(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Fin *</label>
            <input type="datetime-local" value={endDt} onChange={e => setEndDt(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }} />
          </div>
        </div>

        {hours > 0 && (
          <div className="rounded-lg p-3 text-sm" style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
            <strong>{hours}h</strong> de permission
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Motif</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)}
            placeholder="Motif de la permission..."
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
            {saving ? 'Création...' : 'Créer la demande'}
          </button>
        </div>
      </div>
    </div>
  )
}
