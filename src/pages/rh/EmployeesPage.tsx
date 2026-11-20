import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Plus, FileText, Eye, Pencil, Ban, ChevronDown, UserX, KeyRound, Trash2, Truck } from 'lucide-react'
import CreateAccountModal from '@/components/admin/CreateAccountModal'
import type { PendingEmployee } from '@/services/employeeAccount.service'
import toast from 'react-hot-toast'
import { supabase } from '@/services/supabase'
import { fetchEmployees, deactivateEmployee, deleteEmployeePermanently, activateDriversWithoutLogin } from '@/services/hr.service'
import { useAuthStore } from '@/store/authStore'
import { resolveCompanyIds } from '@/utils/companyGroups'
import { CompanyGroupSelect } from '@/components/shared/CompanyGroupSelect'
import type { Employee, EmployeeFilters, ContractType, ContractNature } from '@/types/hr.types'
import { CONTRACT_NATURE_LABELS } from '@/types/hr.types'
import Pagination from '@/components/pos/Pagination'
import { usePagination } from '@/hooks/usePagination'

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
  gestion_agboville: 'Gestion Agboville',
}

const TABS = [
  { key: 'all',         label: 'Tous' },
  { key: 'chauffeur',   label: 'Chauffeurs' },
  { key: 'guichetier',  label: 'Guichetiers' },
  { key: 'mecanicien',  label: 'Mécaniciens' },
  { key: 'pompiste',    label: 'Pompistes' },
  { key: 'chef_garage', label: 'Chefs Garage' },
  { key: 'chef_gare',   label: 'Chefs Gare' },
  { key: 'bagagiste',   label: 'Bagagistes' },
]

/** Text compared without case or accents: « KEÏTA » is found by « keita », « Koné » by « KONE » */
function normalized(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/**
 * Employees matching every word typed, in any order and any field: name and first name (in
 * either order), e-mails, matricule, phone. The search used to be made by the server field by
 * field: a full name (« kone vakaramoko ») or a name typed without its accent was not found.
 */
function matchesSearch(emp: Employee, search: string): boolean {
  const words = normalized(search).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const text = normalized([
    emp.first_name, emp.last_name, emp.full_name, emp.email, emp.professional_email,
    emp.personal_email, emp.employee_id, emp.phone,
  ].filter(Boolean).join(' '))
  return words.every(w => text.includes(w))
}

interface Company { id: string; name: string; code: string; parent_id?: string | null; is_group?: boolean }
interface Station { id: string; name: string }

interface DeactivateModal {
  employee: Employee
  reason: string
}

/** A pending employee of the RH list, in the shape the account window expects */
function toPendingEmployee(emp: Employee): PendingEmployee {
  return {
    id: emp.id,
    first_name: emp.first_name,
    last_name: emp.last_name,
    full_name: emp.full_name,
    role: emp.role,
    professional_email: emp.professional_email ?? null,
    personal_email: emp.personal_email ?? null,
    phone: emp.phone ?? null,
    employee_id: emp.employee_id,
    hire_date: emp.hire_date ?? null,
    account_status: 'pending',
    created_by_hr_at: '',
    company_id: emp.company_id,
    company_name: emp.company_name,
    company_code: emp.company_code,
    station_name: emp.station_name,
  }
}

export default function EmployeesPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()

  const [employees, setEmployees]     = useState<Employee[]>([])
  const [companies, setCompanies]     = useState<Company[]>([])
  const [stations,  setStations]      = useState<Station[]>([])
  const [filters, setFilters]         = useState<EmployeeFilters>({
    company_id: null, station_id: null, role: null,
    contract_type: null, contract_nature: null, status: null, search: '',
  })
  const [activeTab, setActiveTab]     = useState('all')
  const [loading, setLoading]         = useState(true)
  const [deactivateModal, setDeactivateModal] = useState<DeactivateModal | null>(null)
  const [deactivating, setDeactivating] = useState(false)

  useEffect(() => {
    const loadRef = async () => {
      const [companiesRes, stationsRes] = await Promise.all([
        supabase.from('companies').select('id, name, code, parent_id, is_group').order('name'),
        supabase.from('stations').select('id, name').order('name'),
      ])
      if (companiesRes.data) setCompanies(companiesRes.data)
      if (stationsRes.data)  setStations(stationsRes.data)
    }
    loadRef()
  }, [])

  // « Activer le compte » : le RH crée lui-même le compte de connexion (19/11/2026)
  const [accountEmployee, setAccountEmployee] = useState<PendingEmployee | null>(null)
  const [accountLoginOnly, setAccountLoginOnly] = useState(false)
  // Suppression définitive par le RH, après confirmation (20/11/2026)
  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  // Chauffeurs en attente : activation groupée sans connexion
  const [pendingDriverIds, setPendingDriverIds] = useState<string[]>([])
  const [confirmBulkDrivers, setConfirmBulkDrivers] = useState(false)
  const [bulkActivating, setBulkActivating] = useState(false)
  // Profils chauffeur sans connexion (compte verrouillé, adresse technique)
  const [noLoginProfileIds, setNoLoginProfileIds] = useState<Set<string>>(new Set())

  const loadDriverState = useCallback(async () => {
    const [pendingRes, profilesRes] = await Promise.all([
      supabase.from('employees').select('id').eq('role', 'chauffeur').eq('account_status', 'pending'),
      supabase.from('users').select('id').like('email', 'chauffeur.%@profil.sbta-gestion.cloud'),
    ])
    setPendingDriverIds((pendingRes.data ?? []).map(r => r.id as string))
    setNoLoginProfileIds(new Set((profilesRes.data ?? []).map(r => r.id as string)))
  }, [])

  useEffect(() => { void loadDriverState() }, [loadDriverState])

  const loadEmployees = useCallback(() => {
    setLoading(true)
    const effectiveFilters: EmployeeFilters = {
      ...filters,
      // Searched on the device (matchesSearch): without case or accents, words in any order
      search: '',
      company_ids: filters.company_id ? resolveCompanyIds(filters.company_id, companies) : null,
      role: activeTab === 'all' ? null : activeTab,
    }
    fetchEmployees(effectiveFilters)
      .then(data => setEmployees(data.filter(e => e.status !== 'inactive')))
      .catch(() => toast.error('Erreur lors du chargement des employés'))
      .finally(() => setLoading(false))
    // The search is not a dependency: typing does not reload the list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.company_id, filters.station_id, filters.contract_type, filters.contract_nature, filters.status, activeTab, companies])

  useEffect(() => { loadEmployees() }, [loadEmployees])

  // Realtime : notifier le RH quand un nouvel employé est créé (ex: par l'Admin)
  useEffect(() => {
    const channel = supabase
      .channel('rh-employees-new')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'employees' },
        (payload) => {
          const emp = payload.new as { first_name?: string; last_name?: string; role?: string; created_by?: string }
          // Skip if the RH created it themselves (created_by = current user)
          if (emp.created_by === user?.id) return
          const name = `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim()
          toast(`Nouvel employé synchronisé : ${name} (${emp.role ?? '—'})`, {
            duration: 6000,
            icon: '👤',
          })
          loadEmployees()
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [loadEmployees, user?.id])

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const name = await deleteEmployeePermanently(deleteTarget.id)
      toast.success(`${name || deleteTarget.full_name} a été supprimé définitivement`)
      setDeleteTarget(null)
      loadEmployees()
      void loadDriverState()
    } catch (err: unknown) {
      // Refused (history, administrator…): the reason stays in the window
      setDeleteError(err instanceof Error ? err.message : 'Suppression impossible')
    } finally {
      setDeleting(false)
    }
  }

  const handleBulkActivateDrivers = async () => {
    if (pendingDriverIds.length === 0) return
    setBulkActivating(true)
    try {
      const res = await activateDriversWithoutLogin(pendingDriverIds)
      toast.success(`${res.activated} chauffeur${res.activated > 1 ? 's' : ''} activé${res.activated > 1 ? 's' : ''} sans connexion`)
      if (res.skipped.length > 0) {
        toast(`${res.skipped.length} non activé${res.skipped.length > 1 ? 's' : ''} : ${res.skipped[0].raison}`, { duration: 8000 })
      }
      setConfirmBulkDrivers(false)
      loadEmployees()
      void loadDriverState()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erreur lors de l\u2019activation')
    } finally {
      setBulkActivating(false)
    }
  }

  const handleDeactivate = async () => {
    if (!deactivateModal || !user) return
    setDeactivating(true)
    try {
      await deactivateEmployee(deactivateModal.employee.id, deactivateModal.reason, user.id)
      toast.success('Employé désactivé avec succès')
      setDeactivateModal(null)
      loadEmployees()
    } catch {
      toast.error('Erreur lors de la désactivation')
    } finally {
      setDeactivating(false)
    }
  }

  /** An active chauffeur whose profile has no sign-in details (locked account, technical address) */
  const isNoLoginDriver = (emp: Employee) =>
    emp.role === 'chauffeur' && emp.status === 'active' && !!emp.auth_user_id && noLoginProfileIds.has(emp.auth_user_id)

  const isDriverTab = activeTab === 'chauffeur'

  const visibleEmployees = useMemo(
    () => employees.filter(e => matchesSearch(e, filters.search ?? '')),
    [employees, filters.search],
  )

  // Same pagination as the bus list: back to page 1 when a filter, the tab or the search changes
  const pagination = usePagination(
    visibleEmployees,
    'sbta_rh_employees_page_size',
    `${activeTab}|${filters.company_id}|${filters.station_id}|${filters.contract_type}|${filters.contract_nature}|${filters.status}|${filters.search}`,
  )

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1A2E22]">Employés</h1>
          <p className="text-sm text-[#6B7280] mt-1">
            {loading ? 'Chargement...' : `${visibleEmployees.length} employé${visibleEmployees.length > 1 ? 's' : ''} trouvé${visibleEmployees.length > 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-3 justify-end">
          {pendingDriverIds.length > 0 && (
            <button
              onClick={() => setConfirmBulkDrivers(true)}
              className="flex items-center gap-2 px-4 py-2 border border-[#0B7439] rounded-xl text-sm font-semibold text-[#0B7439] hover:bg-[#F0FAF3] transition-colors"
              title="Les chauffeurs ne se connectent pas : activés sans e-mail ni mot de passe"
            >
              <Truck className="w-4 h-4" />
              Activer les {pendingDriverIds.length} chauffeurs en attente
            </button>
          )}
          <button
            onClick={() => navigate('/rh/deactivated')}
            className="flex items-center gap-2 px-4 py-2 border border-[#E2EAE5] rounded-xl text-sm font-semibold text-[#6B7280] hover:bg-[#F8FAF8] transition-colors"
          >
            <UserX className="w-4 h-4" />
            Employés désactivés
          </button>
          <button
            onClick={() => navigate('/rh/employees/new')}
            className="flex items-center gap-2 px-4 py-2 bg-[#0B7439] text-white rounded-xl text-sm font-semibold hover:bg-[#085c2d] transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nouvel employé
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] p-4">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Company */}
          <div className="relative">
            <CompanyGroupSelect
              companies={companies}
              value={filters.company_id ?? ''}
              onChange={(id) => setFilters(p => ({ ...p, company_id: id || null }))}
              className="w-full border border-[#E2EAE5] rounded-lg px-3 py-2 text-sm appearance-none text-[#374151] bg-white pr-8"
            />
            <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-[#9CA3AF] pointer-events-none" />
          </div>

          {/* Station */}
          <div className="relative">
            <select
              value={filters.station_id ?? ''}
              onChange={e => setFilters(p => ({ ...p, station_id: e.target.value || null }))}
              className="w-full border border-[#E2EAE5] rounded-lg px-3 py-2 text-sm appearance-none text-[#374151] bg-white pr-8"
            >
              <option value="">Toutes les gares</option>
              {stations.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-[#9CA3AF] pointer-events-none" />
          </div>

          {/* Contract type */}
          <div className="relative">
            <select
              value={filters.contract_type ?? ''}
              onChange={e => setFilters(p => ({ ...p, contract_type: (e.target.value || null) as ContractType | null }))}
              className="w-full border border-[#E2EAE5] rounded-lg px-3 py-2 text-sm appearance-none text-[#374151] bg-white pr-8"
            >
              <option value="">Tous les contrats</option>
              <option value="titulaire">Titulaires</option>
              <option value="contractuel">Contractuels</option>
            </select>
            <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-[#9CA3AF] pointer-events-none" />
          </div>

          {/* Contract nature */}
          <div className="relative">
            <select
              value={filters.contract_nature ?? ''}
              onChange={e => setFilters(p => ({ ...p, contract_nature: (e.target.value || null) as ContractNature | null }))}
              className="w-full border border-[#E2EAE5] rounded-lg px-3 py-2 text-sm appearance-none text-[#374151] bg-white pr-8"
            >
              <option value="">Toutes les natures</option>
              <option value="CDI">CDI</option>
              <option value="CDD">CDD</option>
              <option value="STAGE">Stagiaires</option>
            </select>
            <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-[#9CA3AF] pointer-events-none" />
          </div>

          {/* Status */}
          <div className="relative">
            <select
              value={filters.status ?? ''}
              onChange={e => setFilters(p => ({ ...p, status: e.target.value || null }))}
              className="w-full border border-[#E2EAE5] rounded-lg px-3 py-2 text-sm appearance-none text-[#374151] bg-white pr-8"
            >
              <option value="">Tous les statuts</option>
              <option value="active">Actifs</option>
              <option value="pending">En attente</option>
              <option value="suspended">Suspendus</option>
            </select>
            <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-[#9CA3AF] pointer-events-none" />
          </div>

          {/* Search */}
          <div className="relative col-span-2 lg:col-span-1">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-[#9CA3AF]" />
            <input
              placeholder="Nom, email, matricule..."
              value={filters.search}
              onChange={e => setFilters(p => ({ ...p, search: e.target.value }))}
              className="w-full border border-[#E2EAE5] rounded-lg pl-9 pr-3 py-2 text-sm text-[#374151]"
            />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {TABS.map(tab => {
          const count = tab.key === 'all' ? visibleEmployees.length : visibleEmployees.filter(e => e.role === tab.key).length
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-[#0B7439] text-white'
                  : 'bg-white border border-[#E2EAE5] text-[#4A6B55] hover:bg-[#F8FAF8]'
              }`}
            >
              {tab.label}
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                activeTab === tab.key ? 'bg-white/20 text-white' : 'bg-[#F4F7F5] text-[#6B7280]'
              }`}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : visibleEmployees.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-[#6B7280]">
            <FileText className="w-10 h-10 mb-2 opacity-30" />
            <p className="text-sm">Aucun employé trouvé</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#F8FAF8]">
                <tr>
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold w-14">Photo</th>
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Nom & Prénom</th>
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Société</th>
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Gare</th>
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Poste</th>
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Contrat</th>
                  {isDriverTab && (
                    <>
                      <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Car affecté</th>
                      <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Type car</th>
                    </>
                  )}
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Ancienneté</th>
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Statut</th>
                  <th className="text-center px-4 py-3 text-[#4A6B55] font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagination.pageItems.map(emp => (
                  <tr key={emp.id} className="border-t border-[#E2EAE5] hover:bg-[#F8FAF8] transition-colors">
                    <td className="px-4 py-3">
                      {emp.avatar_url ? (
                        <img src={emp.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover" />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-[#D4EDDA] flex items-center justify-center text-[#0B7439] font-bold text-sm">
                          {(emp.first_name?.[0] ?? '').toUpperCase()}{(emp.last_name?.[0] ?? '').toUpperCase()}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[#1A2E22]">{emp.full_name}</div>
                      <div className="text-xs text-[#8AA898]">{emp.email}</div>
                      {emp.employee_id && (
                        <div className="text-xs text-[#4A6B55] font-mono">{emp.employee_id}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[#1A2E22]">{emp.company_code ?? '—'}</div>
                      <div className="text-xs text-[#8AA898]">{emp.company_name ?? 'HOLDING'}</div>
                    </td>
                    <td className="px-4 py-3 text-[#4A6B55]">{emp.station_name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 rounded-lg text-xs font-medium bg-[#D4EDDA] text-[#0B7439]">
                        {ROLE_LABELS[emp.role] ?? emp.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {emp.contract_type ? (
                        <div className="flex flex-col gap-1">
                          <span className={`px-2 py-1 rounded-lg text-xs font-medium w-fit ${
                            emp.contract_type === 'titulaire'
                              ? 'bg-[#D4EDDA] text-[#0B7439]'
                              : emp.contract_type === 'stagiaire'
                                ? 'bg-[#FEF3C7] text-[#D97706]'
                                : 'bg-[#DBEAFE] text-[#1D6FA4]'
                          }`}>
                            {emp.contract_type === 'titulaire' ? 'Titulaire' : emp.contract_type === 'stagiaire' ? 'Stagiaire' : 'Contractuel'}
                          </span>
                          {emp.contract_nature && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-[#F3F4F6] text-[#6B7280] w-fit">
                              {CONTRACT_NATURE_LABELS[emp.contract_nature] ?? emp.contract_nature}
                            </span>
                          )}
                        </div>
                      ) : <span className="text-[#9CA3AF]">—</span>}
                    </td>
                    {isDriverTab && (
                      <>
                        <td className="px-4 py-3 font-mono font-bold text-[#0B7439]">
                          {emp.bus_registration ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-[#4A6B55]">{emp.bus_class ?? '—'}</td>
                      </>
                    )}
                    <td className="px-4 py-3 text-[#4A6B55]">
                      {emp.years_of_service !== null
                        ? `${emp.years_of_service} an${emp.years_of_service > 1 ? 's' : ''}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {emp.status === 'active' && (
                        <span className="px-2 py-1 rounded-lg text-xs font-medium bg-[#D4EDDA] text-[#0B7439]">Actif</span>
                      )}
                      {isNoLoginDriver(emp) && (
                        <span className="ml-1 px-2 py-1 rounded-lg text-xs font-medium bg-[#F3F4F6] text-[#6B7280]" title="Chauffeur actif sans identifiants de connexion">
                          Sans connexion
                        </span>
                      )}
                      {emp.status === 'pending' && (
                        <span className="px-2 py-1 rounded-lg text-xs font-medium bg-[#FEF3C7] text-[#D97706]">En attente</span>
                      )}
                      {emp.status === 'suspended' && (
                        <span className="px-2 py-1 rounded-lg text-xs font-medium bg-[#FEE2E2] text-[#AF3029]">Suspendu</span>
                      )}
                      {(emp.status === 'inactive' || !emp.status) && (
                        <span className="px-2 py-1 rounded-lg text-xs font-medium bg-[#F3F4F6] text-[#6B7280]">Inactif</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 justify-center">
                        <button
                          onClick={() => navigate(`/rh/employees/${emp.id}`)}
                          className="p-1.5 rounded-lg hover:bg-[#D4EDDA] text-[#0B7439] transition-colors"
                          title="Voir"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => navigate(`/rh/employees/${emp.id}/edit`)}
                          className="p-1.5 rounded-lg hover:bg-[#FEF3C7] text-[#D97706] transition-colors"
                          title="Modifier"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        {(emp.status === 'pending' || isNoLoginDriver(emp)) && (
                          <button
                            onClick={() => { setAccountLoginOnly(emp.status !== 'pending'); setAccountEmployee(toPendingEmployee(emp)) }}
                            className="p-1.5 rounded-lg hover:bg-[#D4EDDA] text-[#0B7439] transition-colors"
                            title={emp.status === 'pending'
                              ? (emp.role === 'chauffeur' ? 'Activer le chauffeur (avec ou sans connexion)' : 'Créer et activer le compte de connexion')
                              : 'Donner des identifiants de connexion à ce chauffeur'}
                          >
                            <KeyRound className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => { setDeleteError(null); setDeleteTarget(emp) }}
                          disabled={emp.role === 'admin' || emp.id === user?.id || emp.auth_user_id === user?.id}
                          className="p-1.5 rounded-lg hover:bg-[#F8D7D5] text-[#AF3029] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                          title="Supprimer définitivement"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeactivateModal({ employee: emp, reason: '' })}
                          disabled={emp.status !== 'active'}
                          className="p-1.5 rounded-lg hover:bg-[#F8D7D5] text-[#AF3029] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                          title="Désactiver"
                        >
                          <Ban className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && visibleEmployees.length > 0 && (
          <div className="border-t border-[#E2EAE5] px-4 py-2">
            <Pagination
              page={pagination.page}
              pageCount={pagination.pageCount}
              pageSize={pagination.pageSize}
              total={pagination.total}
              onPageChange={pagination.setPage}
              onPageSizeChange={pagination.setPageSize}
              itemLabel="employés"
            />
          </div>
        )}
      </div>

      {/* Deactivate modal */}
      {deactivateModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-[#1A2E22] mb-1">Désactiver l'employé</h3>
            <p className="text-sm text-[#6B7280] mb-4">
              Vous allez désactiver <strong>{deactivateModal.employee.full_name}</strong>. L'employé sera retiré de la liste principale et déplacé vers la rubrique « Employés désactivés ». Cette action est réversible.
            </p>
            <label className="block text-sm font-medium text-[#374151] mb-1">Motif de désactivation *</label>
            <textarea
              rows={3}
              placeholder="Ex : Fin de contrat, départ volontaire..."
              value={deactivateModal.reason}
              onChange={e => setDeactivateModal(p => p ? { ...p, reason: e.target.value } : null)}
              className="w-full border border-[#E2EAE5] rounded-xl px-3 py-2 text-sm text-[#374151] resize-none mb-4"
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeactivateModal(null)}
                className="px-4 py-2 border border-[#E2EAE5] rounded-xl text-sm text-[#6B7280] hover:bg-[#F8FAF8]"
              >
                Annuler
              </button>
              <button
                onClick={handleDeactivate}
                disabled={!deactivateModal.reason.trim() || deactivating}
                className="px-4 py-2 bg-[#AF3029] text-white rounded-xl text-sm font-semibold hover:bg-[#8B1F1A] disabled:opacity-50 transition-colors"
              >
                {deactivating ? 'Désactivation...' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
      {accountEmployee && (
        <CreateAccountModal
          employee={accountEmployee}
          loginOnly={accountLoginOnly}
          onClose={() => setAccountEmployee(null)}
          onSuccess={() => { setAccountEmployee(null); loadEmployees(); void loadDriverState() }}
        />
      )}

      {/* Suppression définitive : confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => !deleting && setDeleteTarget(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-[#F8D7D5] flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5 text-[#AF3029]" />
              </div>
              <h3 className="text-lg font-bold text-[#1A2E22]">Supprimer définitivement ?</h3>
            </div>
            <p className="text-sm text-[#374151] mb-2">
              Voulez-vous vraiment supprimer <strong>{deleteTarget.full_name}</strong>
              {deleteTarget.employee_id ? <> (matricule {deleteTarget.employee_id})</> : null} ?
            </p>
            <p className="text-sm text-[#6B7280] mb-4">
              Sa fiche employé et son compte de connexion seront supprimés. <strong>Cette action est irréversible.</strong>{' '}
              Un employé qui a déjà travaillé (départs, tickets, courriers…) ne peut pas être supprimé : désactivez-le à la place.
            </p>
            {deleteError && (
              <div className="mb-4 rounded-xl border border-[#AF3029] bg-[#FEF2F2] p-3 text-sm text-[#991B1B]">
                {deleteError}
              </div>
            )}
            <div className="flex flex-wrap gap-3 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="px-4 py-2 border border-[#E2EAE5] rounded-xl text-sm text-[#6B7280] hover:bg-[#F8FAF8] disabled:opacity-50"
              >
                Annuler
              </button>
              {deleteError && deleteTarget.status === 'active' && (
                <button
                  onClick={() => { setDeactivateModal({ employee: deleteTarget, reason: '' }); setDeleteTarget(null) }}
                  className="px-4 py-2 border border-[#AF3029] rounded-xl text-sm font-semibold text-[#AF3029] hover:bg-[#FEF2F2]"
                >
                  Désactiver à la place
                </button>
              )}
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 bg-[#AF3029] text-white rounded-xl text-sm font-semibold hover:bg-[#8B1F1A] disabled:opacity-50 transition-colors"
              >
                {deleting ? 'Suppression...' : 'Oui, supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Activation groupée des chauffeurs sans connexion : confirmation */}
      {confirmBulkDrivers && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => !bulkActivating && setConfirmBulkDrivers(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-[#1A2E22] mb-2">Activer {pendingDriverIds.length} chauffeurs ?</h3>
            <p className="text-sm text-[#374151] mb-4">
              Les chauffeurs en attente seront activés <strong>sans connexion</strong> : aucun e-mail ni
              mot de passe, ils deviennent actifs et sélectionnables partout (départs, carburant, paie).
              Vous pourrez plus tard donner des identifiants à l&apos;un d&apos;eux (bouton clé).
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmBulkDrivers(false)}
                disabled={bulkActivating}
                className="px-4 py-2 border border-[#E2EAE5] rounded-xl text-sm text-[#6B7280] hover:bg-[#F8FAF8] disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                onClick={handleBulkActivateDrivers}
                disabled={bulkActivating}
                className="px-4 py-2 bg-[#0B7439] text-white rounded-xl text-sm font-semibold hover:bg-[#085c2d] disabled:opacity-50"
              >
                {bulkActivating ? 'Activation...' : `Oui, activer les ${pendingDriverIds.length}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
