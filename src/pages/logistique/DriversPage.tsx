import { useState, useEffect, useCallback } from 'react'
import {
  Users, Bus, Plus, Search, X, Pencil, Trash2, UserPlus,
  AlertTriangle, Star, ChevronDown, Car, Phone, Calendar,
  CheckCircle2, User,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/services/supabase'
import {
  fetchBusesWithDrivers,
  createDriverFromLogistique,
  updateDriverFromLogistique,
  type LogistiqueBusWithDrivers,
  type LogistiqueDriver,
} from '@/services/logistiqueDrivers.service'

interface Company { id: string; name: string; code: string; parent_id?: string | null; is_group?: boolean }
interface Station  { id: string; name: string }
interface BusOption { id: string; registration_number: string; brand: string | null; model: string | null; class: string | null; company_id: string | null }
interface RouteOption { id: string; name: string }

const WARNING_DAYS = 30
const LICENSE_CATEGORIES = ['A', 'B', 'C', 'D', 'E', 'DE', 'C+E', 'A+B+C+D+E']

function isExpiringSoon(expiry: string | null) {
  if (!expiry) return false
  return (new Date(expiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24) < WARNING_DAYS
}

const inputCls = 'w-full border border-[#E2EAE5] rounded-xl px-3 py-2.5 text-sm text-[#374151] focus:outline-none focus:border-[#0B7439] transition-colors'
const selectCls = inputCls + ' appearance-none pr-8 bg-white'

function SelectWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      {children}
      <ChevronDown className="absolute right-2.5 top-3 w-4 h-4 text-[#9CA3AF] pointer-events-none" />
    </div>
  )
}

function FieldGroup({ label, required, hint, children }: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-[#374151] mb-1.5">
        {label} {required && <span className="text-[#AF3029]">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-[#8AA898] mt-1">{hint}</p>}
    </div>
  )
}

export default function LogistiqueDriversPage() {
  const [buses, setBuses] = useState<LogistiqueBusWithDrivers[]>([])
  const [unassignedDrivers, setUnassignedDrivers] = useState<LogistiqueDriver[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [stations, setStations] = useState<Station[]>([])
  const [busOptions, setBusOptions] = useState<BusOption[]>([])
  const [routes, setRoutes] = useState<RouteOption[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingDriver, setEditingDriver] = useState<LogistiqueDriver | null>(null)
  const [expandedBus, setExpandedBus] = useState<string | null>(null)

  useEffect(() => {
    const loadRef = async () => {
      const [companiesRes, stationsRes, busesRes, routesRes] = await Promise.all([
        supabase.from('companies').select('id, name, code, parent_id, is_group').order('name'),
        supabase.from('stations').select('id, name').order('name'),
        supabase.from('buses').select('id, registration_number, brand, model, class, company_id').order('registration_number'),
        supabase.from('routes').select('id, name').eq('is_active', true).order('name'),
      ])
      if (companiesRes.data) setCompanies(companiesRes.data)
      if (stationsRes.data) setStations(stationsRes.data)
      if (busesRes.data) setBusOptions(busesRes.data)
      if (routesRes.data) setRoutes(routesRes.data)
    }
    loadRef()
  }, [])

  const loadData = useCallback(() => {
    setLoading(true)
    fetchBusesWithDrivers()
      .then(data => {
        setBuses(data.buses)
        setUnassignedDrivers(data.unassignedDrivers)
      })
      .catch(err => {
        console.error(err)
        toast.error('Erreur lors du chargement des données')
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const filteredBuses = buses.filter(b => {
    if (companyFilter && b.company_id !== companyFilter) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      const matchBus = b.registration_number.toLowerCase().includes(q) ||
        (b.brand ?? '').toLowerCase().includes(q) ||
        (b.model ?? '').toLowerCase().includes(q)
      const matchDriver = b.drivers.some(d =>
        d.full_name.toLowerCase().includes(q) ||
        (d.employee_id ?? '').toLowerCase().includes(q)
      )
      if (!matchBus && !matchDriver) return false
    }
    return true
  })

  const totalDrivers = buses.reduce((s, b) => s + b.drivers.length, 0) + unassignedDrivers.length
  const assignedCount = buses.reduce((s, b) => s + b.drivers.length, 0)
  const busWithDriversCount = buses.filter(b => b.drivers.length > 0).length
  const expiringLicenses = [...unassignedDrivers, ...buses.flatMap(b => b.drivers)]
    .filter(d => isExpiringSoon(d.license_expiry)).length

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1A2E22]">Bus / Chauffeurs</h1>
          <p className="text-sm text-[#6B7280] mt-1">
            Consultez les bus, créez les chauffeurs et affectez-les aux véhicules
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#0B7439] text-white rounded-xl text-sm font-semibold hover:bg-[#085c2d] transition-colors"
        >
          <UserPlus className="w-4 h-4" />
          Nouveau chauffeur
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total bus', value: buses.length, color: '#0B7439', icon: Bus },
          { label: 'Bus avec chauffeur', value: busWithDriversCount, color: '#1D6FA4', icon: CheckCircle2 },
          { label: 'Total chauffeurs', value: totalDrivers, color: '#D97706', icon: Users },
          {
            label: expiringLicenses > 0 ? `Permis < ${WARNING_DAYS}j` : 'Affectés',
            value: expiringLicenses > 0 ? expiringLicenses : assignedCount,
            color: expiringLicenses > 0 ? '#AF3029' : '#059669',
            icon: expiringLicenses > 0 ? AlertTriangle : Car,
          },
        ].map((kpi, i) => {
          const Icon = kpi.icon
          return (
            <div key={i} className="bg-white rounded-2xl border border-[#E2EAE5] p-4 flex items-center gap-3">
              <div className="w-2 h-10 rounded-full flex-shrink-0" style={{ backgroundColor: kpi.color }} />
              <div className="flex-1">
                <p className="text-xs text-[#6B7280] font-medium">{kpi.label}</p>
                <p className="text-xl font-bold text-[#1A2E22]">{kpi.value}</p>
              </div>
              <Icon className="w-5 h-5 opacity-30" style={{ color: kpi.color }} />
            </div>
          )
        })}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-[#9CA3AF]" />
            <input
              placeholder="Rechercher par immatriculation, nom, matricule..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full border border-[#E2EAE5] rounded-lg pl-9 pr-3 py-2 text-sm text-[#374151]"
            />
          </div>
          <SelectWrap>
            <select
              value={companyFilter}
              onChange={e => setCompanyFilter(e.target.value)}
              className={selectCls}
            >
              <option value="">Toutes les sociétés</option>
              {companies.filter(c => !c.parent_id).map(c => (
                <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
              ))}
            </select>
          </SelectWrap>
        </div>
      </div>

      {/* Unassigned drivers section */}
      {unassignedDrivers.length > 0 && (
        <div className="bg-white rounded-2xl border border-[#FEF3C7] overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 bg-[#FEF9E7] border-b border-[#FEF3C7]">
            <AlertTriangle className="w-4 h-4 text-[#D97706]" />
            <h3 className="text-sm font-semibold text-[#92400E]">
              Chauffeurs sans bus affecté ({unassignedDrivers.length})
            </h3>
          </div>
          <div className="divide-y divide-[#E2EAE5]">
            {unassignedDrivers.map(d => (
              <UnassignedDriverRow
                key={d.id}
                driver={d}
                busOptions={busOptions}
                onEdit={() => setEditingDriver(d)}
                onAssign={async (busId) => {
                  try {
                    await updateDriverFromLogistique({ id: d.id, source_table: d.source_table, bus_id: busId })
                    toast.success('Chauffeur affecté au bus')
                    loadData()
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Erreur lors de l\'affectation')
                  }
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Bus list with drivers */}
      <div className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredBuses.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#E2EAE5] flex flex-col items-center justify-center h-40 text-[#6B7280]">
            <Bus className="w-10 h-10 mb-2 opacity-30" />
            <p className="text-sm">Aucun bus trouvé</p>
          </div>
        ) : (
          filteredBuses.map(bus => (
            <BusDriverRow
              key={bus.id}
              bus={bus}
              isExpanded={expandedBus === bus.id}
              onToggle={() => setExpandedBus(expandedBus === bus.id ? null : bus.id)}
              onEditDriver={(d) => setEditingDriver(d)}
              onUnassign={async (driverId, sourceTable) => {
                try {
                  await updateDriverFromLogistique({ id: driverId, source_table: sourceTable, bus_id: null })
                  toast.success('Chauffeur retiré du bus')
                  loadData()
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Erreur')
                }
              }}
            />
          ))
        )}
      </div>

      {/* Create modal */}
      {showCreateModal && (
        <DriverFormModal
          mode="create"
          companies={companies}
          stations={stations}
          busOptions={busOptions}
          routes={routes}
          onClose={() => setShowCreateModal(false)}
          onSaved={() => {
            setShowCreateModal(false)
            loadData()
          }}
        />
      )}

      {/* Edit modal */}
      {editingDriver && (
        <DriverFormModal
          mode="edit"
          driver={editingDriver}
          companies={companies}
          stations={stations}
          busOptions={busOptions}
          routes={routes}
          onClose={() => setEditingDriver(null)}
          onSaved={() => {
            setEditingDriver(null)
            loadData()
          }}
        />
      )}
    </div>
  )
}

// ── Bus row with expandable drivers ──
function BusDriverRow({ bus, isExpanded, onToggle, onEditDriver, onUnassign }: {
  bus: LogistiqueBusWithDrivers
  isExpanded: boolean
  onToggle: () => void
  onEditDriver: (d: LogistiqueDriver) => void
  onUnassign: (driverId: string, sourceTable: 'employees' | 'users') => void
}) {
  return (
    <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
      {/* Bus header */}
      <button
        onClick={onToggle}
        className="flex items-center w-full px-4 py-4 hover:bg-[#F8FAF8] transition-colors text-left"
      >
        <div className="w-10 h-10 rounded-xl bg-[#D4EDDA] flex items-center justify-center flex-shrink-0">
          <Bus className="w-5 h-5 text-[#0B7439]" />
        </div>
        <div className="ml-3 flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-[#1A2E22] font-mono">{bus.registration_number}</span>
            {bus.brand && <span className="text-sm text-[#6B7280]">{bus.brand}{bus.model ? ` ${bus.model}` : ''}</span>}
            {bus.total_seats && <span className="text-xs text-[#8AA898]">{bus.total_seats} places</span>}
          </div>
          <div className="text-xs text-[#8AA898] mt-0.5">
            {bus.company_name ?? '—'}
            {bus.status && <> · {bus.status}</>}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{
              backgroundColor: bus.drivers.length > 0 ? '#D4EDDA' : '#FEF3C7',
              color: bus.drivers.length > 0 ? '#0B7439' : '#D97706',
            }}>
            <Users className="w-3.5 h-3.5" />
            {bus.drivers.length} chauffeur{bus.drivers.length !== 1 ? 's' : ''}
          </div>
          <ChevronDown
            className="w-5 h-5 text-[#9CA3AF] transition-transform flex-shrink-0"
            style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
          />
        </div>
      </button>

      {/* Expanded drivers */}
      {isExpanded && (
        <div className="border-t border-[#E2EAE5]">
          {bus.drivers.length === 0 ? (
            <div className="px-4 py-6 flex flex-col items-center text-center">
              <User className="w-8 h-8 text-[#C5D5CA] mb-1" />
              <p className="text-sm text-[#6B7280]">Aucun chauffeur affecté à ce bus</p>
              <p className="text-xs text-[#8AA898] mt-0.5">
                Créez un chauffeur ou affectez un chauffeur non assigné depuis la section ci-dessus
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#F4F7F5]">
              {bus.drivers.map(driver => (
                <DriverRow
                  key={driver.id}
                  driver={driver}
                  onEdit={() => onEditDriver(driver)}
                  onUnassign={() => onUnassign(driver.id, driver.source_table)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Single driver row inside a bus ──
function DriverRow({ driver, onEdit, onUnassign }: {
  driver: LogistiqueDriver
  onEdit: () => void
  onUnassign: () => void
}) {
  const expiring = isExpiringSoon(driver.license_expiry)
  return (
    <div className="flex items-center px-4 py-3 hover:bg-[#F8FAF8] transition-colors group">
      <div className="w-9 h-9 rounded-full bg-[#D4EDDA] flex items-center justify-center text-[#0B7439] font-bold text-sm flex-shrink-0">
        {driver.avatar_url ? (
          <img src={driver.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover" />
        ) : (
          driver.first_name?.[0]?.toUpperCase() ?? '?'
        )}
      </div>
      <div className="ml-3 flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[#1A2E22]">{driver.full_name}</span>
          {driver.contract_type && (
            <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
              driver.contract_type === 'titulaire' ? 'bg-[#D4EDDA] text-[#0B7439]' : 'bg-[#DBEAFE] text-[#1D6FA4]'
            }`}>
              {driver.contract_type === 'titulaire' ? 'Titulaire' : 'Contractuel'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-[#8AA898] mt-0.5">
          <span>{driver.employee_id ?? '—'}</span>
          {driver.phone && (
            <span className="flex items-center gap-1">
              <Phone className="w-3 h-3" />{driver.phone}
            </span>
          )}
          {driver.license_expiry && (
            <span className={`flex items-center gap-1 ${expiring ? 'text-[#D97706] font-medium' : ''}`}>
              <Calendar className="w-3 h-3" />
              Permis: {new Date(driver.license_expiry).toLocaleDateString('fr-FR')}
              {driver.license_category && ` (Cat. ${driver.license_category})`}
              {expiring && <AlertTriangle className="w-3 h-3" />}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onEdit}
          className="p-2 rounded-lg hover:bg-[#F4F7F5] text-[#4A6B55] transition-colors"
          title="Modifier"
        >
          <Pencil className="w-4 h-4" />
        </button>
        <button
          onClick={onUnassign}
          className="p-2 rounded-lg hover:bg-[#FEF3C7] text-[#D97706] transition-colors"
          title="Retirer du bus"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// ── Unassigned driver row with quick-assign ──
function UnassignedDriverRow({ driver, busOptions, onEdit, onAssign }: {
  driver: LogistiqueDriver
  busOptions: BusOption[]
  onEdit: () => void
  onAssign: (busId: string) => void
}) {
  const [showBusPicker, setShowBusPicker] = useState(false)
  const [busSearch, setBusSearch] = useState('')

  const filteredBuses = busOptions.filter(b => {
    const q = busSearch.trim().toLowerCase()
    if (!q) return true
    return `${b.registration_number} ${b.brand ?? ''} ${b.model ?? ''}`.toLowerCase().includes(q)
  })

  return (
    <div className="flex items-center px-4 py-3 hover:bg-[#F8FAF8] transition-colors group relative">
      <div className="w-9 h-9 rounded-full bg-[#FEF3C7] flex items-center justify-center text-[#D97706] font-bold text-sm flex-shrink-0">
        {driver.avatar_url ? (
          <img src={driver.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover" />
        ) : (
          driver.first_name?.[0]?.toUpperCase() ?? '?'
        )}
      </div>
      <div className="ml-3 flex-1 min-w-0">
        <span className="font-semibold text-[#1A2E22]">{driver.full_name}</span>
        <span className="ml-2 text-xs text-[#8AA898]">{driver.employee_id ?? '—'}</span>
        {driver.company_name && <span className="ml-2 text-xs text-[#8AA898]">{driver.company_name}</span>}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={onEdit}
          className="p-2 rounded-lg hover:bg-[#F4F7F5] text-[#4A6B55] transition-colors"
          title="Modifier"
        >
          <Pencil className="w-4 h-4" />
        </button>
        <button
          onClick={() => setShowBusPicker(!showBusPicker)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#0B7439] text-white hover:bg-[#085c2d] transition-colors"
        >
          <Car className="w-3.5 h-3.5" />
          Affecter à un bus
        </button>
      </div>
      {showBusPicker && (
        <div className="absolute right-4 top-12 z-20 w-72 bg-white rounded-xl border border-[#E2EAE5] shadow-lg p-3">
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-[#9CA3AF]" />
            <input
              placeholder="Rechercher un bus..."
              value={busSearch}
              onChange={e => setBusSearch(e.target.value)}
              className="w-full border border-[#E2EAE5] rounded-lg pl-8 pr-3 py-1.5 text-xs text-[#374151]"
              autoFocus
            />
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {filteredBuses.length === 0 ? (
              <p className="text-xs text-[#8AA898] text-center py-3">Aucun bus</p>
            ) : filteredBuses.map(b => (
              <button
                key={b.id}
                onClick={() => {
                  onAssign(b.id)
                  setShowBusPicker(false)
                  setBusSearch('')
                }}
                className="flex items-center w-full px-2 py-1.5 rounded-lg hover:bg-[#F4F7F5] text-left transition-colors"
              >
                <Bus className="w-4 h-4 text-[#0B7439] flex-shrink-0" />
                <span className="ml-2 text-sm font-mono font-medium text-[#1A2E22]">{b.registration_number}</span>
                <span className="ml-1 text-xs text-[#8AA898] truncate">{b.brand} {b.model}</span>
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowBusPicker(false)}
            className="w-full mt-2 text-xs text-[#8AA898] hover:text-[#4A6B55] py-1"
          >
            Annuler
          </button>
        </div>
      )}
    </div>
  )
}

// ── Driver create/edit form modal ──
interface DriverForm {
  first_name: string
  last_name: string
  phone: string
  gender: string
  nationality: string
  date_naissance: string
  personal_email: string
  professional_email: string
  company_id: string
  station_id: string
  contract_type: string
  contract_nature: string
  hire_date: string
  salary: string
  daily_rate: string
  cnps_number: string
  children_count: string
  marital_status: string
  bus_id: string
  license_number: string
  license_expiry: string
  license_category: string
  employee_id: string
  assigned_route_id: string
}

const EMPTY_DRIVER_FORM: DriverForm = {
  first_name: '', last_name: '', phone: '', gender: '', nationality: '', date_naissance: '',
  personal_email: '', professional_email: '', company_id: '', station_id: '',
  contract_type: '', contract_nature: '', hire_date: '', salary: '', daily_rate: '',
  cnps_number: '', children_count: '0', marital_status: '', bus_id: '',
  license_number: '', license_expiry: '', license_category: '', employee_id: '',
  assigned_route_id: '',
}

function DriverFormModal({ mode, driver, companies, stations, busOptions, routes, onClose, onSaved }: {
  mode: 'create' | 'edit'
  driver?: LogistiqueDriver
  companies: Company[]
  stations: Station[]
  busOptions: BusOption[]
  routes: RouteOption[]
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<DriverForm>(EMPTY_DRIVER_FORM)
  const [saving, setSaving] = useState(false)
  const [busSearch, setBusSearch] = useState('')
  const [busOpen, setBusOpen] = useState(false)

  useEffect(() => {
    if (mode === 'edit' && driver) {
      supabase.from('employees').select('*').eq('id', driver.id).maybeSingle()
        .then(async ({ data: emp }) => {
          const data = emp ?? await supabase.from('users').select('*').eq('id', driver.id).maybeSingle().then(r => r.data)
          if (data) {
            setForm({
              first_name: data.first_name ?? '',
              last_name: data.last_name ?? '',
              phone: data.phone ?? '',
              gender: data.gender ?? '',
              nationality: data.nationality ?? '',
              date_naissance: data.date_naissance ?? '',
              personal_email: data.personal_email ?? '',
              professional_email: data.professional_email ?? data.email ?? '',
              company_id: data.company_id ?? '',
              station_id: data.station_id ?? '',
              contract_type: data.contract_type ?? '',
              contract_nature: data.contract_nature ?? '',
              hire_date: data.hire_date ?? '',
              salary: data.salary?.toString() ?? '',
              daily_rate: data.daily_rate?.toString() ?? '',
              cnps_number: data.cnps_number ?? '',
              children_count: data.children_count?.toString() ?? '0',
              marital_status: data.marital_status ?? '',
              bus_id: data.bus_id ?? '',
              license_number: data.license_number ?? '',
              license_expiry: data.license_expiry ?? '',
              license_category: data.license_category ?? '',
              employee_id: data.employee_id ?? '',
              assigned_route_id: data.assigned_route_id ?? '',
            })
          }
        })
    }
  }, [mode, driver])

  const set = (field: keyof DriverForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [field]: e.target.value }))

  const filteredBuses = form.company_id
    ? busOptions.filter(b => b.company_id === form.company_id)
    : busOptions

  const searchedBuses = (() => {
    const q = busSearch.trim().toLowerCase()
    if (!q) return filteredBuses
    return filteredBuses.filter(b =>
      `${b.registration_number} ${b.brand ?? ''} ${b.model ?? ''} ${b.class ?? ''}`.toLowerCase().includes(q)
    )
  })()

  const selectedBus = busOptions.find(b => b.id === form.bus_id) ?? null
  const isContractuel = form.contract_type === 'contractuel'

  const validate = () => {
    if (!form.first_name.trim()) { toast.error('Le prénom est obligatoire'); return false }
    if (!form.last_name.trim()) { toast.error('Le nom est obligatoire'); return false }
    if (!form.hire_date) { toast.error("La date d'entrée est obligatoire"); return false }
    if (!form.contract_type) { toast.error('Le type de contrat est obligatoire'); return false }
    if (form.contract_type === 'titulaire' && !form.salary) {
      toast.error('Le salaire est obligatoire pour un titulaire'); return false
    }
    if (isContractuel && !form.daily_rate) {
      toast.error('Le taux journalier est obligatoire pour un contractuel'); return false
    }
    return true
  }

  const handleSave = async () => {
    if (!validate()) return
    setSaving(true)
    try {
      const payload = {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        phone: form.phone.trim() || null,
        gender: form.gender || null,
        nationality: form.nationality.trim() || null,
        date_naissance: form.date_naissance || null,
        personal_email: form.personal_email.trim() || null,
        professional_email: form.professional_email.trim() || null,
        company_id: form.company_id || null,
        station_id: form.station_id || null,
        contract_type: form.contract_type || null,
        contract_nature: form.contract_nature || null,
        hire_date: form.hire_date || null,
        salary: form.salary ? parseFloat(form.salary) : null,
        daily_rate: form.daily_rate ? parseFloat(form.daily_rate) : null,
        cnps_number: form.cnps_number.trim() || null,
        children_count: parseInt(form.children_count) || 0,
        marital_status: form.marital_status || null,
        bus_id: form.bus_id || null,
        license_number: form.license_number.trim() || null,
        license_expiry: form.license_expiry || null,
        license_category: form.license_category || null,
        employee_id: form.employee_id.trim() || null,
        assigned_route_id: form.assigned_route_id || null,
      }

      if (mode === 'create') {
        await createDriverFromLogistique(payload)
        toast.success(`Chauffeur ${form.first_name} ${form.last_name} créé avec succès`, { duration: 4000 })
      } else if (driver) {
        await updateDriverFromLogistique({ id: driver.id, source_table: driver.source_table, ...payload })
        toast.success('Chauffeur mis à jour')
      }
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur lors de l\'enregistrement')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E2EAE5] sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#D4EDDA] flex items-center justify-center">
              <UserPlus className="w-5 h-5 text-[#0B7439]" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#1A2E22]">
                {mode === 'create' ? 'Nouveau chauffeur' : 'Modifier le chauffeur'}
              </h2>
              <p className="text-xs text-[#6B7280]">
                {mode === 'create'
                  ? 'La fiche sera synchronisée avec RH > Employés > Chauffeurs'
                  : 'Les modifications seront synchronisées avec RH'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[#F4F7F5] text-[#4A6B55]">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form body */}
        <div className="px-6 py-5 space-y-6">
          {mode === 'create' && (
            <div className="bg-[#DBEAFE] border border-[#1D6FA4] rounded-xl p-3 flex gap-3">
              <div className="text-sm text-[#1A2E22]">
                <strong>Information :</strong> Vous créez la fiche chauffeur. Le compte de connexion
                sera créé séparément par l'administrateur. Le chauffeur apparaîtra automatiquement
                dans <strong>RH &gt; Employés &gt; Chauffeurs</strong>.
              </div>
            </div>
          )}

          {/* Identity section */}
          <div>
            <h3 className="text-sm font-bold text-[#1A2E22] mb-3">Identité</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FieldGroup label="Prénom" required>
                <input value={form.first_name} onChange={set('first_name')} className={inputCls} placeholder="Amara" />
              </FieldGroup>
              <FieldGroup label="Nom" required>
                <input value={form.last_name} onChange={set('last_name')} className={inputCls} placeholder="Koné" />
              </FieldGroup>
              <FieldGroup label="Téléphone">
                <input value={form.phone} onChange={set('phone')} className={inputCls} placeholder="+225 07 00 00 00" />
              </FieldGroup>
              <FieldGroup label="Sexe">
                <SelectWrap>
                  <select value={form.gender} onChange={set('gender')} className={selectCls}>
                    <option value="">—</option>
                    <option value="M">Masculin</option>
                    <option value="F">Féminin</option>
                  </select>
                </SelectWrap>
              </FieldGroup>
              <FieldGroup label="Nationalité">
                <input value={form.nationality} onChange={set('nationality')} className={inputCls} placeholder="Ivoirienne" />
              </FieldGroup>
              <FieldGroup label="Date de naissance">
                <input type="date" value={form.date_naissance} onChange={set('date_naissance')} className={inputCls} />
              </FieldGroup>
              <FieldGroup label="Email professionnel">
                <input type="email" value={form.professional_email} onChange={set('professional_email')} className={inputCls} placeholder="prenom.nom@societe.ci" />
              </FieldGroup>
              <FieldGroup label="Email personnel">
                <input type="email" value={form.personal_email} onChange={set('personal_email')} className={inputCls} placeholder="email@gmail.com" />
              </FieldGroup>
            </div>
          </div>

          {/* Professional section */}
          <div>
            <h3 className="text-sm font-bold text-[#1A2E22] mb-3">Données professionnelles</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FieldGroup label="Société">
                <SelectWrap>
                  <select value={form.company_id} onChange={set('company_id')} className={selectCls}>
                    <option value="">— Sélectionner —</option>
                    {companies.filter(c => !c.parent_id).map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                    ))}
                  </select>
                </SelectWrap>
              </FieldGroup>
              <FieldGroup label="Gare d'affectation">
                <SelectWrap>
                  <select value={form.station_id} onChange={set('station_id')} className={selectCls}>
                    <option value="">— Sélectionner —</option>
                    {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </SelectWrap>
              </FieldGroup>
              <FieldGroup label="Type de contrat" required>
                <SelectWrap>
                  <select value={form.contract_type} onChange={set('contract_type')} className={selectCls}>
                    <option value="">— Sélectionner —</option>
                    <option value="titulaire">Titulaire</option>
                    <option value="contractuel">Contractuel</option>
                    <option value="stagiaire">Stagiaire</option>
                  </select>
                </SelectWrap>
              </FieldGroup>
              <FieldGroup label="Nature du contrat">
                <SelectWrap>
                  <select value={form.contract_nature} onChange={set('contract_nature')} className={selectCls}>
                    <option value="">—</option>
                    <option value="CDI">CDI</option>
                    <option value="CDD">CDD</option>
                  </select>
                </SelectWrap>
              </FieldGroup>
              <FieldGroup label="Date d'entrée" required>
                <input type="date" value={form.hire_date} onChange={set('hire_date')} className={inputCls} />
              </FieldGroup>
              <FieldGroup label="Matricule" hint="Auto-généré si vide">
                <input value={form.employee_id} onChange={set('employee_id')} className={inputCls} placeholder="EMP-2026-0001" />
              </FieldGroup>
              {form.contract_type === 'titulaire' && (
                <FieldGroup label="Salaire (FCFA)" required>
                  <input type="number" value={form.salary} onChange={set('salary')} className={inputCls} placeholder="150000" />
                </FieldGroup>
              )}
              {isContractuel && (
                <FieldGroup label="Taux journalier (FCFA)" required>
                  <input type="number" value={form.daily_rate} onChange={set('daily_rate')} className={inputCls} placeholder="5000" />
                </FieldGroup>
              )}
            </div>
          </div>

          {/* Driver-specific section */}
          <div>
            <h3 className="text-sm font-bold text-[#1A2E22] mb-3">Informations chauffeur &amp; permis</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Bus assignment with searchable dropdown */}
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-[#374151] mb-1.5">Bus affecté</label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setBusOpen(!busOpen)}
                    className="w-full flex items-center justify-between border border-[#E2EAE5] rounded-xl px-3 py-2.5 text-sm text-[#374151] bg-white hover:border-[#0B7439] transition-colors"
                  >
                    {selectedBus ? (
                      <span className="flex items-center gap-2">
                        <Bus className="w-4 h-4 text-[#0B7439]" />
                        <span className="font-mono font-semibold">{selectedBus.registration_number}</span>
                        <span className="text-xs text-[#8AA898]">{selectedBus.brand} {selectedBus.model}</span>
                      </span>
                    ) : (
                      <span className="text-[#9CA3AF]">— Sélectionner un bus —</span>
                    )}
                    <ChevronDown className="w-4 h-4 text-[#9CA3AF]" />
                  </button>
                  {busOpen && (
                    <div className="absolute z-20 mt-1 w-full bg-white border border-[#E2EAE5] rounded-xl shadow-lg p-2">
                      <div className="relative mb-2">
                        <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-[#9CA3AF]" />
                        <input
                          placeholder="Rechercher par immatriculation, marque..."
                          value={busSearch}
                          onChange={e => setBusSearch(e.target.value)}
                          className="w-full border border-[#E2EAE5] rounded-lg pl-8 pr-3 py-1.5 text-xs text-[#374151]"
                          autoFocus
                        />
                      </div>
                      <div className="max-h-48 overflow-y-auto space-y-0.5">
                        <button
                          type="button"
                          onClick={() => { setForm(p => ({ ...p, bus_id: '' })); setBusOpen(false); setBusSearch('') }}
                          className="flex items-center w-full px-2 py-1.5 rounded-lg hover:bg-[#F4F7F5] text-left text-xs text-[#8AA898]"
                        >
                          Aucun bus
                        </button>
                        {searchedBuses.map(b => (
                          <button
                            key={b.id}
                            type="button"
                            onClick={() => { setForm(p => ({ ...p, bus_id: b.id })); setBusOpen(false); setBusSearch('') }}
                            className="flex items-center w-full px-2 py-1.5 rounded-lg hover:bg-[#F4F7F5] text-left"
                          >
                            <Bus className="w-4 h-4 text-[#0B7439] flex-shrink-0" />
                            <span className="ml-2 text-sm font-mono font-medium">{b.registration_number}</span>
                            <span className="ml-1.5 text-xs text-[#8AA898] truncate">{b.brand} {b.model}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <FieldGroup label="N° de permis">
                <input value={form.license_number} onChange={set('license_number')} className={inputCls} placeholder="CI-123456" />
              </FieldGroup>
              <FieldGroup label="Catégorie de permis">
                <SelectWrap>
                  <select value={form.license_category} onChange={set('license_category')} className={selectCls}>
                    <option value="">—</option>
                    {LICENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </SelectWrap>
              </FieldGroup>
              <FieldGroup label="Expiration du permis">
                <input type="date" value={form.license_expiry} onChange={set('license_expiry')} className={inputCls} />
              </FieldGroup>
              {isContractuel && (
                <FieldGroup label="Itinéraire affecté">
                  <SelectWrap>
                    <select value={form.assigned_route_id} onChange={set('assigned_route_id')} className={selectCls}>
                      <option value="">—</option>
                      {routes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </SelectWrap>
                </FieldGroup>
              )}
            </div>
          </div>

          {/* RH info */}
          <div>
            <h3 className="text-sm font-bold text-[#1A2E22] mb-3">Informations RH</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FieldGroup label="N° CNPS">
                <input value={form.cnps_number} onChange={set('cnps_number')} className={inputCls} placeholder="12345678A" />
              </FieldGroup>
              <FieldGroup label="Situation matrimoniale">
                <SelectWrap>
                  <select value={form.marital_status} onChange={set('marital_status')} className={selectCls}>
                    <option value="">—</option>
                    <option value="celibataire">Célibataire</option>
                    <option value="marie">Marié(e)</option>
                    <option value="divorce">Divorcé(e)</option>
                    <option value="veuf">Veuf/Veuve</option>
                  </select>
                </SelectWrap>
              </FieldGroup>
              <FieldGroup label="Nombre d'enfants">
                <input type="number" min="0" max="20" value={form.children_count} onChange={set('children_count')} className={inputCls} />
              </FieldGroup>
            </div>
          </div>
        </div>

        {/* Modal footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#E2EAE5] sticky bottom-0 bg-white">
          <button onClick={onClose}
            className="px-4 py-2 border border-[#E2EAE5] rounded-xl text-sm text-[#4A6B55] hover:bg-[#F4F7F5] transition-colors">
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 bg-[#0B7439] text-white rounded-xl text-sm font-semibold hover:bg-[#085c2d] disabled:opacity-50 transition-colors"
          >
            {saving ? 'Enregistrement...' : (mode === 'create' ? 'Créer le chauffeur' : 'Enregistrer')}
          </button>
        </div>
      </div>
    </div>
  )
}
