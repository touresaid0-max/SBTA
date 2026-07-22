import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Plus, FileText, Eye, Pencil, Ban, ChevronDown } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/services/supabase'
import { fetchEmployees, deactivateEmployee } from '@/services/hr.service'
import { useAuthStore } from '@/store/authStore'
import { resolveCompanyIds, buildCompanyGroups } from '@/utils/companyGroups'
import type { Employee, EmployeeFilters, ContractType, ContractNature } from '@/types/hr.types'

const ROLE_LABELS: Record<string, string> = {
  chauffeur: 'Chauffeur', guichetier: 'Guichetier', agent_reservation: 'Agent Réservation', mecanicien: 'Mécanicien',
  pompiste: 'Pompiste', chef_garage: 'Chef Garage', chef_gare: 'Chef Gare', bagagiste: 'Bagagiste',
  gestionnaire: 'Gestionnaire', planificateur: 'Planificateur',
  comptable: 'Comptable', daf: 'DAF', rh: 'RH', admin: 'Admin',
  charge_achat: "Chargé d'Achat",
  agent_colis: 'Agent Courrier', superviseur_colis: 'Superviseur Courrier',
  gerant_principal: 'Gérant Principal',
  responsable_assurance: 'Responsable Service Assurance',
  responsable_logistique: 'Responsable Logistique',
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

interface Company { id: string; name: string; code: string; parent_id?: string | null; is_group?: boolean }
interface Station { id: string; name: string }

interface DeactivateModal {
  employee: Employee
  reason: string
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

  const loadEmployees = useCallback(() => {
    setLoading(true)
    const effectiveFilters: EmployeeFilters = {
      ...filters,
      company_ids: filters.company_id ? resolveCompanyIds(filters.company_id, companies) : null,
      role: activeTab === 'all' ? null : activeTab,
    }
    fetchEmployees(effectiveFilters)
      .then(setEmployees)
      .catch(() => toast.error('Erreur lors du chargement des employés'))
      .finally(() => setLoading(false))
  }, [filters, activeTab, companies])

  useEffect(() => { loadEmployees() }, [loadEmployees])

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

  const isDriverTab = activeTab === 'chauffeur'

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1A2E22]">Employés</h1>
          <p className="text-sm text-[#6B7280] mt-1">
            {loading ? 'Chargement...' : `${employees.length} employé${employees.length > 1 ? 's' : ''} trouvé${employees.length > 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex gap-3">
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
            <select
              value={filters.company_id ?? ''}
              onChange={e => setFilters(p => ({ ...p, company_id: e.target.value || null }))}
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
              <option value="stagiaire">Stagiaires</option>
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
              <option value="inactive">Inactifs</option>
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
          const count = tab.key === 'all' ? employees.length : employees.filter(e => e.role === tab.key).length
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
        ) : employees.length === 0 ? (
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
                {employees.map(emp => (
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
                              {emp.contract_nature}
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
      </div>

      {/* Deactivate modal */}
      {deactivateModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-[#1A2E22] mb-1">Désactiver l'employé</h3>
            <p className="text-sm text-[#6B7280] mb-4">
              Vous allez désactiver <strong>{deactivateModal.employee.full_name}</strong>. Cette action est réversible.
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
    </div>
  )
}
