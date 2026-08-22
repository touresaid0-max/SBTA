import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Eye, RotateCcw, ChevronDown, UserX, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/services/supabase'
import { fetchEmployees, reactivateEmployee, requestEmployeeDeletion } from '@/services/hr.service'
import { useAuthStore } from '@/store/authStore'
import { resolveCompanyIds, buildCompanyGroups } from '@/utils/companyGroups'
import type { Employee, EmployeeFilters } from '@/types/hr.types'

const ROLE_LABELS: Record<string, string> = {
  chauffeur: 'Chauffeur', guichetier: 'Guichetier', agent_reservation: 'Agent Réservation', mecanicien: 'Mécanicien',
  pompiste: 'Pompiste', chef_garage: 'Chef Garage', chef_gare: 'Chef Gare', bagagiste: 'Bagagiste',
  gestionnaire: 'Gestionnaire', planificateur: 'Planificateur',
  comptable: 'Comptable', daf: 'DAF', rh: 'RH', admin: 'Admin', dg: 'Directeur Général',
  charge_achat: "Chargé d'Achat",
  agent_colis: 'Agent Courrier', superviseur_colis: 'Superviseur Courrier',
  gerant_principal: 'Gérant Principal',
  responsable_assurance: 'Responsable Service Assurance',
  responsable_logistique: 'Responsable Logistique',
}

interface Company { id: string; name: string; code: string; parent_id?: string | null; is_group?: boolean }

export default function DeactivatedEmployeesPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()

  const [employees, setEmployees] = useState<Employee[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyFilter, setCompanyFilter] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [reactivatingId, setReactivatingId] = useState<string | null>(null)
  const [deletionTarget, setDeletionTarget] = useState<Employee | null>(null)
  const [requestingDeletion, setRequestingDeletion] = useState(false)
  const [deletionConfirmText, setDeletionConfirmText] = useState('')

  useEffect(() => {
    supabase.from('companies').select('id, name, code, parent_id, is_group').order('name')
      .then(({ data }) => { if (data) setCompanies(data) })
  }, [])

  const loadEmployees = useCallback(() => {
    setLoading(true)
    const filters: EmployeeFilters = {
      company_id: companyFilter,
      company_ids: companyFilter ? resolveCompanyIds(companyFilter, companies) : null,
      station_id: null,
      role: null,
      contract_type: null,
      contract_nature: null,
      status: 'inactive',
      search,
    }
    fetchEmployees(filters)
      .then(data => setEmployees(data.filter(e => e.status === 'inactive')))
      .catch(() => toast.error('Erreur lors du chargement'))
      .finally(() => setLoading(false))
  }, [companyFilter, companies, search])

  useEffect(() => { loadEmployees() }, [loadEmployees])

  const handleReactivate = async (emp: Employee) => {
    setReactivatingId(emp.id)
    try {
      await reactivateEmployee(emp.id)
      toast.success(`${emp.full_name} réactivé avec succès`)
      setEmployees(prev => prev.filter(e => e.id !== emp.id))
    } catch {
      toast.error('Erreur lors de la réactivation')
    } finally {
      setReactivatingId(null)
    }
  }

  const handleRequestDeletion = async () => {
    if (!deletionTarget || !user) return
    if (deletionConfirmText !== 'DEMANDER') return
    setRequestingDeletion(true)
    try {
      await requestEmployeeDeletion(deletionTarget.id, user.id)
      toast.success(`${deletionTarget.full_name} envoyé vers Admin > Utilisateurs en attente de suppression`)
      setEmployees(prev => prev.filter(e => e.id !== deletionTarget.id))
      setDeletionTarget(null)
      setDeletionConfirmText('')
    } catch {
      toast.error('Erreur lors de la demande de suppression')
    } finally {
      setRequestingDeletion(false)
    }
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1A2E22]">Employés désactivés</h1>
          <p className="text-sm text-[#6B7280] mt-1">
            {loading ? 'Chargement...' : `${employees.length} employé${employees.length > 1 ? 's' : ''} désactivé${employees.length > 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      {/* Info banner */}
      <div className="bg-[#FEF3C7] border border-[#FCD34D] rounded-xl p-4 flex items-start gap-3">
        <UserX className="w-5 h-5 text-[#D97706] flex-shrink-0 mt-0.5" />
        <div className="text-sm text-[#92400E]">
          <strong>Employés hors effectif.</strong> Ces employés sont exclus de la masse salariale, des effectifs actifs et des tableaux de bord RH.
          L'historique et les données sont conservés. La réactivation est possible à tout moment.
          Pour supprimer définitivement un employé, une demande doit être envoyée à l'Administrateur qui traitera la suppression depuis <strong>Admin &gt; Utilisateurs</strong>.
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] p-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="relative">
            <select
              value={companyFilter ?? ''}
              onChange={e => setCompanyFilter(e.target.value || null)}
              className="w-full border border-[#E2EAE5] rounded-lg px-3 py-2 text-sm appearance-none text-[#374151] bg-white pr-8"
            >
              <option value="">Toutes les sociétés</option>
              {(() => {
                const { groups, standalone } = buildCompanyGroups(companies)
                return (
                  <>
                    {groups.map(g => (
                      <optgroup key={g.group.id} label={g.group.name}>
                        <option value={g.group.id}>{g.group.name} (groupe + sous-groupes)</option>
                        {g.subsidiaries.map(s => (
                          <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
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
            <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-[#9CA3AF] pointer-events-none" />
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-[#9CA3AF]" />
            <input
              placeholder="Nom, email, matricule..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full border border-[#E2EAE5] rounded-lg pl-9 pr-3 py-2 text-sm text-[#374151]"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : employees.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-[#6B7280]">
            <UserX className="w-10 h-10 mb-2 opacity-30" />
            <p className="text-sm">Aucun employé désactivé</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#F8FAF8]">
                <tr>
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold w-14">Photo</th>
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Nom & Prénom</th>
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Société</th>
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Poste</th>
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Désactivé le</th>
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Motif</th>
                  <th className="text-center px-4 py-3 text-[#4A6B55] font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {employees.map(emp => (
                  <tr key={emp.id} className="border-t border-[#E2EAE5] hover:bg-[#F8FAF8] transition-colors">
                    <td className="px-4 py-3">
                      {emp.avatar_url ? (
                        <img src={emp.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover opacity-60" />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-[#F3F4F6] flex items-center justify-center text-[#6B7280] font-bold text-sm">
                          {(emp.first_name?.[0] ?? '').toUpperCase()}{(emp.last_name?.[0] ?? '').toUpperCase()}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[#6B7280]">{emp.full_name}</div>
                      <div className="text-xs text-[#9CA3AF]">{emp.email}</div>
                      {emp.employee_id && (
                        <div className="text-xs text-[#9CA3AF] font-mono">{emp.employee_id}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[#6B7280]">{emp.company_code ?? '—'}</div>
                      <div className="text-xs text-[#9CA3AF]">{emp.company_name ?? 'HOLDING'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 rounded-lg text-xs font-medium bg-[#F3F4F6] text-[#6B7280]">
                        {ROLE_LABELS[emp.role] ?? emp.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#6B7280] text-xs">
                      {(emp as any).deactivated_at
                        ? new Date((emp as any).deactivated_at).toLocaleDateString('fr-FR')
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-[#6B7280] text-xs max-w-[200px] truncate" title={(emp as any).deactivation_reason ?? ''}>
                      {(emp as any).deactivation_reason ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 justify-center">
                        <button
                          onClick={() => navigate(`/rh/employees/${emp.id}`)}
                          className="p-1.5 rounded-lg hover:bg-[#D4EDDA] text-[#0B7439] transition-colors"
                          title="Voir la fiche"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleReactivate(emp)}
                          disabled={reactivatingId === emp.id}
                          className="p-1.5 rounded-lg hover:bg-[#DBEAFE] text-[#1D6FA4] transition-colors disabled:opacity-50"
                          title="Réactiver"
                        >
                          {reactivatingId === emp.id
                            ? <div className="w-4 h-4 border-2 border-[#1D6FA4] border-t-transparent rounded-full animate-spin" />
                            : <RotateCcw className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => { setDeletionTarget(emp); setDeletionConfirmText('') }}
                          className="p-1.5 rounded-lg hover:bg-[#FEF3C7] text-[#D97706] transition-colors"
                          title="Demander la suppression définitive"
                        >
                          <Send className="w-4 h-4" />
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

      {/* Request deletion confirmation modal */}
      {deletionTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#FEF3C7] flex items-center justify-center flex-shrink-0">
                <Send className="w-5 h-5 text-[#D97706]" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[#1A2E22]">Demande de suppression définitive</h3>
                <p className="text-sm text-[#6B7280]">Transmission à l'Administrateur</p>
              </div>
            </div>
            <div className="bg-[#FFFBEB] border border-[#FCD34D] rounded-xl p-4 text-sm text-[#92400E]">
              Vous allez demander la suppression définitive de l'employé{' '}
              <strong>{deletionTarget.full_name}</strong>. L'employé sera envoyé vers{' '}
              <strong>Admin &gt; Utilisateurs &gt; Inactifs / Suspendus</strong> avec le statut
              « En attente de suppression définitive ». Seul l'Administrateur pourra alors procéder
              à la suppression. Les données sont conservées en attendant.
            </div>
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1">
                Pour confirmer, tapez <strong>DEMANDER</strong>
              </label>
              <input
                value={deletionConfirmText}
                onChange={e => setDeletionConfirmText(e.target.value)}
                className="w-full border border-[#E2EAE5] rounded-xl px-3 py-2 text-sm text-[#374151]"
                placeholder="DEMANDER"
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setDeletionTarget(null); setDeletionConfirmText('') }}
                className="px-4 py-2 border border-[#E2EAE5] rounded-xl text-sm text-[#6B7280] hover:bg-[#F8FAF8]"
              >
                Annuler
              </button>
              <button
                onClick={handleRequestDeletion}
                disabled={deletionConfirmText !== 'DEMANDER' || requestingDeletion}
                className="px-4 py-2 bg-[#D97706] text-white rounded-xl text-sm font-semibold hover:bg-[#B45309] disabled:opacity-50 transition-colors"
              >
                {requestingDeletion ? 'Envoi...' : 'Demander la suppression'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
