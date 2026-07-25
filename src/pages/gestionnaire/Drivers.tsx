import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Users, Bus, Search, Plus, Pencil, ChevronDown, UserPlus, X, UserCheck,
  AlertTriangle, RefreshCw,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/services/supabase'
import {
  fetchBusesWithDrivers, createDriverFromLogistique, updateDriverFromLogistique,
  fetchDriverDetail,
  type LogistiqueDriver, type LogistiqueBusWithDrivers,
} from '@/services/logistiqueDrivers.service'

const LICENSE_CATEGORIES = ['A', 'A1', 'B', 'B1', 'C', 'C1', 'D', 'D1', 'E']
const WARNING_DAYS = 30

interface Company { id: string; name: string; code: string; parent_id?: string | null; is_group?: boolean }
interface Station { id: string; name: string }
interface BusOption { id: string; registration_number: string; brand: string | null; model: string | null; company_id: string | null }
interface RouteOption { id: string; name: string }

interface DriverForm {
  first_name: string; last_name: string; phone: string; gender: string
  nationality: string; date_naissance: string; personal_email: string; professional_email: string
  company_id: string; station_id: string; contract_type: string; contract_nature: string
  hire_date: string; salary: string; daily_rate: string; cnps_number: string
  children_count: string; marital_status: string; bus_id: string
  license_number: string; license_expiry: string; license_category: string
  employee_id: string; assigned_route_id: string
}

const EMPTY_DRIVER_FORM: DriverForm = {
  first_name: '', last_name: '', phone: '', gender: '', nationality: '', date_naissance: '',
  personal_email: '', professional_email: '', company_id: '', station_id: '',
  contract_type: '', contract_nature: '', hire_date: '', salary: '', daily_rate: '',
  cnps_number: '', children_count: '0', marital_status: '', bus_id: '',
  license_number: '', license_expiry: '', license_category: '', employee_id: '',
  assigned_route_id: '',
}

const inputCls = 'w-full border rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-offset-0 transition-colors'
const selectCls = inputCls

function FieldGroup({ label, required, hint, children }: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-primary)' }}>
        {label}{required && <span style={{ color: '#EF4444' }}> *</span>}
        {hint && <span className="text-xs font-normal ml-1" style={{ color: 'var(--text-muted)' }}>({hint})</span>}
      </label>
      {children}
    </div>
  )
}

function SelectWrap({ children }: { children: React.ReactNode }) {
  return <div className="relative">{children}</div>
}

function isExpiringSoon(dateStr: string | null): boolean {
  if (!dateStr) return false
  const d = new Date(dateStr)
  const now = new Date()
  const diff = (d.getTime() - now.getTime()) / 86_400_000
  return diff >= 0 && diff <= WARNING_DAYS
}

export default function GestionnaireDriversPage() {
  const { user } = useAuthStore()
  const companyId = user?.company_id ?? null

  const [buses, setBuses] = useState<LogistiqueBusWithDrivers[]>([])
  const [unassignedDrivers, setUnassignedDrivers] = useState<LogistiqueDriver[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedBus, setExpandedBus] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingDriver, setEditingDriver] = useState<LogistiqueDriver | null>(null)

  const [busOptions, setBusOptions] = useState<BusOption[]>([])
  const [stations, setStations] = useState<Station[]>([])
  const [routes, setRoutes] = useState<RouteOption[]>([])

  const loadData = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true)
    try {
      const data = await fetchBusesWithDrivers()
      setBuses(data.buses)
      setUnassignedDrivers(data.unassignedDrivers)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur lors du chargement')
    } finally {
      setLoading(false); setRefreshing(false)
    }
  }, [])

  const loadOptions = useCallback(async () => {
    const [busRes, staRes, rteRes] = await Promise.all([
      supabase.from('buses').select('id, registration_number, brand, model, company_id').order('registration_number'),
      supabase.from('stations').select('id, name').order('name'),
      supabase.from('routes').select('id, name').order('name'),
    ])
    if (busRes.data) setBusOptions(busRes.data as BusOption[])
    if (staRes.data) setStations(staRes.data as Station[])
    if (rteRes.data) setRoutes(rteRes.data as RouteOption[])
  }, [])

  useEffect(() => { loadData(); loadOptions() }, [loadData, loadOptions])

  // Frontend double-filter as a safety net (server already scopes by company).
  const scopedBusOptions = useMemo(
    () => companyId ? busOptions.filter(b => b.company_id === companyId) : busOptions,
    [busOptions, companyId],
  )

  const filteredBuses = buses.filter(b => {
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

  const filteredUnassigned = unassignedDrivers.filter(d => {
    if (search.trim()) {
      const q = search.toLowerCase()
      if (!d.full_name.toLowerCase().includes(q) &&
          !(d.employee_id ?? '').toLowerCase().includes(q)) return false
    }
    return true
  })

  const totalDrivers = buses.reduce((s, b) => s + b.drivers.length, 0) + unassignedDrivers.length
  const assignedCount = buses.reduce((s, b) => s + b.drivers.length, 0)
  const expiringLicenses = [...unassignedDrivers, ...buses.flatMap(b => b.drivers)]
    .filter(d => isExpiringSoon(d.license_expiry)).length

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-4 rounded-full animate-spin" style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Chauffeurs</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            Gérez les chauffeurs de votre société{user?.company_id ? '' : ' — '}
            {buses[0]?.company_name ?? 'Ma société'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => loadData(true)} disabled={refreshing}
            className="p-2 rounded-xl border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} style={{ color: 'var(--text-secondary)' }} />
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            <UserPlus className="w-4 h-4" />
            Nouveau chauffeur
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total bus', value: buses.length, color: '#3B82F6', icon: Bus },
          { label: 'Bus avec chauffeur', value: buses.filter(b => b.drivers.length > 0).length, color: '#10B981', icon: UserCheck },
          { label: 'Total chauffeurs', value: totalDrivers, color: '#F59E0B', icon: Users },
          {
            label: expiringLicenses > 0 ? `Permis < ${WARNING_DAYS}j` : 'Affectés',
            value: expiringLicenses > 0 ? expiringLicenses : assignedCount,
            color: expiringLicenses > 0 ? '#EF4444' : '#10B981',
            icon: expiringLicenses > 0 ? AlertTriangle : UserCheck,
          },
        ].map((kpi, i) => {
          const Icon = kpi.icon
          return (
            <div key={i} className="rounded-2xl border p-4 flex items-center gap-3" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <div className="w-2 h-10 rounded-full flex-shrink-0" style={{ backgroundColor: kpi.color }} />
              <div className="flex-1">
                <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{kpi.label}</p>
                <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{kpi.value}</p>
              </div>
              <Icon className="w-5 h-5 opacity-30" style={{ color: kpi.color }} />
            </div>
          )
        })}
      </div>

      {/* Search */}
      <div className="rounded-2xl border p-4" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-[#9CA3AF]" />
          <input
            placeholder="Rechercher par immatriculation, nom, matricule..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border rounded-xl pl-9 pr-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          />
        </div>
      </div>

      {/* Unassigned drivers */}
      {filteredUnassigned.length > 0 && (
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: '#FEF3C7', backgroundColor: 'var(--surface)' }}>
          <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ backgroundColor: '#FEF9E7', borderColor: '#FEF3C7' }}>
            <AlertTriangle className="w-4 h-4 text-[#D97706]" />
            <h3 className="text-sm font-semibold text-[#92400E]">
              Chauffeurs sans bus affecté ({filteredUnassigned.length})
            </h3>
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {filteredUnassigned.map(d => (
              <UnassignedDriverRow
                key={d.id}
                driver={d}
                busOptions={scopedBusOptions}
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
        {filteredBuses.length === 0 && filteredUnassigned.length === 0 ? (
          <div className="rounded-2xl border flex flex-col items-center justify-center h-40" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-muted)' }}>
            <Users className="w-10 h-10 mb-2 opacity-30" />
            <p className="text-sm">Aucun chauffeur trouvé</p>
          </div>
        ) : filteredBuses.length === 0 ? null : (
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

      {showCreateModal && (
        <DriverFormModal
          mode="create"
          fixedCompanyId={companyId}
          companies={[]}
          stations={stations}
          busOptions={scopedBusOptions}
          routes={routes}
          onClose={() => setShowCreateModal(false)}
          onSaved={() => { setShowCreateModal(false); loadData() }}
        />
      )}
      {editingDriver && (
        <DriverFormModal
          mode="edit"
          driver={editingDriver}
          fixedCompanyId={companyId}
          companies={[]}
          stations={stations}
          busOptions={scopedBusOptions}
          routes={routes}
          onClose={() => setEditingDriver(null)}
          onSaved={() => { setEditingDriver(null); loadData() }}
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
    <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
      <button
        onClick={onToggle}
        className="flex items-center w-full px-4 py-4 transition-colors text-left hover:opacity-80"
      >
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#DBEAFE' }}>
          <Bus className="w-5 h-5" style={{ color: '#1D6FA4' }} />
        </div>
        <div className="ml-3 flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold font-mono" style={{ color: 'var(--text-primary)' }}>{bus.registration_number}</span>
            {bus.brand && <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{bus.brand}{bus.model ? ` ${bus.model}` : ''}</span>}
            {bus.total_seats && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{bus.total_seats} places</span>}
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {bus.company_name ?? '—'}
            {bus.status && <> · {bus.status}</>}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{
              backgroundColor: bus.drivers.length > 0 ? '#DCFCE7' : '#FEF3C7',
              color: bus.drivers.length > 0 ? '#16A34A' : '#D97706',
            }}>
            <Users className="w-3.5 h-3.5" />
            {bus.drivers.length} chauffeur{bus.drivers.length !== 1 ? 's' : ''}
          </div>
          <ChevronDown
            className="w-5 h-5 transition-transform flex-shrink-0"
            style={{ color: 'var(--text-muted)', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
          />
        </div>
      </button>

      {isExpanded && (
        <div className="border-t" style={{ borderColor: 'var(--border)' }}>
          {bus.drivers.length === 0 ? (
            <div className="px-4 py-6 flex flex-col items-center text-center">
              <Users className="w-8 h-8 mb-1" style={{ color: 'var(--text-muted)' }} />
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Aucun chauffeur affecté à ce bus</p>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
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
  return (
    <div className="flex items-center px-4 py-3">
      {driver.avatar_url ? (
        <img src={driver.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
      ) : (
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
          style={{ backgroundColor: '#E0E7FF', color: '#4338CA' }}>
          {driver.first_name?.[0] ?? '?'}{driver.last_name?.[0] ?? ''}
        </div>
      )}
      <div className="ml-3 flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{driver.full_name}</span>
          {driver.employee_id && (
            <span className="text-xs px-1.5 py-0.5 rounded font-mono" style={{ backgroundColor: 'var(--border)', color: 'var(--text-secondary)' }}>
              {driver.employee_id}
            </span>
          )}
          {isExpiringSoon(driver.license_expiry) && (
            <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: '#FEE2E2', color: '#B91C1C' }}>
              Permis bientôt
            </span>
          )}
        </div>
        <div className="text-xs mt-0.5 flex items-center gap-2 flex-wrap" style={{ color: 'var(--text-muted)' }}>
          {driver.license_number && <span>Permis : {driver.license_number}</span>}
          {driver.license_category && <span>Cat. {driver.license_category}</span>}
          {driver.phone && <span>{driver.phone}</span>}
          {driver.contract_type && <span className="capitalize">{driver.contract_type}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button onClick={onEdit} className="p-2 rounded-lg transition-colors" style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--border)'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
          <Pencil className="w-4 h-4" />
        </button>
        <button onClick={onUnassign} className="p-2 rounded-lg transition-colors" style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--border)'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// ── Unassigned driver row ──
function UnassignedDriverRow({ driver, busOptions, onEdit, onAssign }: {
  driver: LogistiqueDriver
  busOptions: BusOption[]
  onEdit: () => void
  onAssign: (busId: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="px-4 py-3">
      <div className="flex items-center">
        {driver.avatar_url ? (
          <img src={driver.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
        ) : (
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
            style={{ backgroundColor: '#FEF3C7', color: '#B45309' }}>
            {driver.first_name?.[0] ?? '?'}{driver.last_name?.[0] ?? ''}
          </div>
        )}
        <div className="ml-3 flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{driver.full_name}</span>
            {driver.employee_id && (
              <span className="text-xs px-1.5 py-0.5 rounded font-mono" style={{ backgroundColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                {driver.employee_id}
              </span>
            )}
          </div>
          <div className="text-xs mt-0.5 flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
            {driver.company_name && <span>{driver.company_name}</span>}
            {driver.contract_type && <span className="capitalize">· {driver.contract_type}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={onEdit} className="p-2 rounded-lg transition-colors" style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--border)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
            <Pencil className="w-4 h-4" />
          </button>
          <div className="relative">
            <button onClick={() => setOpen(!open)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-white"
              style={{ backgroundColor: 'var(--primary)' }}>
              <Plus className="w-3.5 h-3.5" />
              Affecter
            </button>
            {open && (
              <div className="absolute right-0 z-20 mt-1 w-64 bg-white border rounded-xl shadow-lg p-2"
                style={{ borderColor: 'var(--border)' }}>
                <div className="max-h-48 overflow-y-auto space-y-0.5">
                  {busOptions.length === 0 ? (
                    <p className="text-xs text-center py-2" style={{ color: 'var(--text-muted)' }}>Aucun bus disponible</p>
                  ) : busOptions.map(b => (
                    <button key={b.id} onClick={() => { onAssign(b.id); setOpen(false) }}
                      className="flex items-center w-full px-2 py-1.5 rounded-lg text-left text-sm transition-colors"
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--border)'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                      <Bus className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--primary)' }} />
                      <span className="ml-2 font-mono font-medium" style={{ color: 'var(--text-primary)' }}>{b.registration_number}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Create / Edit modal ──
function DriverFormModal({ mode, driver, fixedCompanyId, companies, stations, busOptions, routes, onClose, onSaved }: {
  mode: 'create' | 'edit'
  driver?: LogistiqueDriver
  fixedCompanyId: string | null
  companies: Company[]
  stations: Station[]
  busOptions: BusOption[]
  routes: RouteOption[]
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<DriverForm>(() => ({
    ...EMPTY_DRIVER_FORM,
    company_id: fixedCompanyId ?? '',
  }))
  const [saving, setSaving] = useState(false)
  const [busSearch, setBusSearch] = useState('')
  const [busOpen, setBusOpen] = useState(false)

  useEffect(() => {
    if (mode === 'edit' && driver) {
      fetchDriverDetail(driver.id)
        .then((data) => {
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
              company_id: data.company_id ?? fixedCompanyId ?? '',
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
        .catch(() => toast.error('Impossible de charger les informations du chauffeur'))
    }
  }, [mode, driver, fixedCompanyId])

  const set = (field: keyof DriverForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [field]: e.target.value }))

  const searchedBuses = (() => {
    const q = busSearch.trim().toLowerCase()
    if (!q) return busOptions
    return busOptions.filter(b =>
      `${b.registration_number} ${b.brand ?? ''} ${b.model ?? ''}`.toLowerCase().includes(q)
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
        company_id: form.company_id || fixedCompanyId || null,
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
        toast.success(`Chauffeur ${form.first_name} ${form.last_name} créé`)
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

  const inputStyle = { borderColor: 'var(--border)', color: 'var(--text-primary)' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-white z-10" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#DBEAFE' }}>
              <UserPlus className="w-5 h-5" style={{ color: 'var(--primary)' }} />
            </div>
            <div>
              <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                {mode === 'create' ? 'Nouveau chauffeur' : 'Modifier le chauffeur'}
              </h2>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {mode === 'create' ? 'Chauffeur rattaché à votre société' : 'Synchronisé avec RH'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg" style={{ color: 'var(--text-secondary)' }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form body */}
        <div className="px-6 py-5 space-y-6">
          {mode === 'create' && (
            <div className="rounded-xl p-3 flex gap-3" style={{ backgroundColor: '#DBEAFE', color: '#1E3A8A' }}>
              <div className="text-sm">
                <strong>Information :</strong> Vous créez la fiche chauffeur pour votre société.
                Le compte de connexion sera créé séparément par l'administrateur.
                Le chauffeur apparaîtra dans <strong>RH &gt; Employés &gt; Chauffeurs</strong>.
              </div>
            </div>
          )}

          {/* Identity */}
          <div>
            <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>Identité</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FieldGroup label="Prénom" required>
                <input value={form.first_name} onChange={set('first_name')} className={inputCls} style={inputStyle} placeholder="Amara" />
              </FieldGroup>
              <FieldGroup label="Nom" required>
                <input value={form.last_name} onChange={set('last_name')} className={inputCls} style={inputStyle} placeholder="Koné" />
              </FieldGroup>
              <FieldGroup label="Téléphone">
                <input value={form.phone} onChange={set('phone')} className={inputCls} style={inputStyle} placeholder="+225 07 00 00 00" />
              </FieldGroup>
              <FieldGroup label="Sexe">
                <SelectWrap>
                  <select value={form.gender} onChange={set('gender')} className={selectCls} style={inputStyle}>
                    <option value="">—</option>
                    <option value="M">Masculin</option>
                    <option value="F">Féminin</option>
                  </select>
                </SelectWrap>
              </FieldGroup>
              <FieldGroup label="Nationalité">
                <input value={form.nationality} onChange={set('nationality')} className={inputCls} style={inputStyle} placeholder="Ivoirienne" />
              </FieldGroup>
              <FieldGroup label="Date de naissance">
                <input type="date" value={form.date_naissance} onChange={set('date_naissance')} className={inputCls} style={inputStyle} />
              </FieldGroup>
              <FieldGroup label="Email professionnel">
                <input type="email" value={form.professional_email} onChange={set('professional_email')} className={inputCls} style={inputStyle} placeholder="prenom.nom@societe.ci" />
              </FieldGroup>
              <FieldGroup label="Email personnel">
                <input type="email" value={form.personal_email} onChange={set('personal_email')} className={inputCls} style={inputStyle} placeholder="email@gmail.com" />
              </FieldGroup>
            </div>
          </div>

          {/* Professional */}
          <div>
            <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>Données professionnelles</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FieldGroup label="Société">
                <input value={fixedCompanyId ? 'Ma société' : '—'} disabled
                  className={inputCls} style={{ ...inputStyle, backgroundColor: 'var(--border)' }} />
              </FieldGroup>
              <FieldGroup label="Gare d'affectation">
                <SelectWrap>
                  <select value={form.station_id} onChange={set('station_id')} className={selectCls} style={inputStyle}>
                    <option value="">— Sélectionner —</option>
                    {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </SelectWrap>
              </FieldGroup>
              <FieldGroup label="Type de contrat" required>
                <SelectWrap>
                  <select value={form.contract_type} onChange={set('contract_type')} className={selectCls} style={inputStyle}>
                    <option value="">— Sélectionner —</option>
                    <option value="titulaire">Titulaire</option>
                    <option value="contractuel">Contractuel</option>
                    <option value="stagiaire">Stagiaire</option>
                  </select>
                </SelectWrap>
              </FieldGroup>
              <FieldGroup label="Nature du contrat">
                <SelectWrap>
                  <select value={form.contract_nature} onChange={set('contract_nature')} className={selectCls} style={inputStyle}>
                    <option value="">—</option>
                    <option value="CDI">CDI</option>
                    <option value="CDD">CDD</option>
                  </select>
                </SelectWrap>
              </FieldGroup>
              <FieldGroup label="Date d'entrée" required>
                <input type="date" value={form.hire_date} onChange={set('hire_date')} className={inputCls} style={inputStyle} />
              </FieldGroup>
              <FieldGroup label="Matricule" hint="Auto-généré si vide">
                <input value={form.employee_id} onChange={set('employee_id')} className={inputCls} style={inputStyle} placeholder="EMP-2026-0001" />
              </FieldGroup>
              {form.contract_type === 'titulaire' && (
                <FieldGroup label="Salaire (FCFA)" required>
                  <input type="number" value={form.salary} onChange={set('salary')} className={inputCls} style={inputStyle} placeholder="150000" />
                </FieldGroup>
              )}
              {isContractuel && (
                <FieldGroup label="Taux journalier (FCFA)" required>
                  <input type="number" value={form.daily_rate} onChange={set('daily_rate')} className={inputCls} style={inputStyle} placeholder="5000" />
                </FieldGroup>
              )}
            </div>
          </div>

          {/* Driver & license */}
          <div>
            <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>Informations chauffeur &amp; permis</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-primary)' }}>Bus affecté</label>
                <div className="relative">
                  <button type="button" onClick={() => setBusOpen(!busOpen)}
                    className="w-full flex items-center justify-between border rounded-xl px-3 py-2.5 text-sm transition-colors"
                    style={{ ...inputStyle, backgroundColor: 'white' }}>
                    {selectedBus ? (
                      <span className="flex items-center gap-2">
                        <Bus className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                        <span className="font-mono font-semibold">{selectedBus.registration_number}</span>
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{selectedBus.brand} {selectedBus.model}</span>
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>— Sélectionner un bus —</span>
                    )}
                    <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                  </button>
                  {busOpen && (
                    <div className="absolute z-20 mt-1 w-full bg-white border rounded-xl shadow-lg p-2" style={{ borderColor: 'var(--border)' }}>
                      <div className="relative mb-2">
                        <Search className="absolute left-2.5 top-2 w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                        <input placeholder="Rechercher..." value={busSearch} onChange={e => setBusSearch(e.target.value)}
                          className="w-full border rounded-lg pl-8 pr-3 py-1.5 text-xs" style={inputStyle} autoFocus />
                      </div>
                      <div className="max-h-48 overflow-y-auto space-y-0.5">
                        <button type="button"
                          onClick={() => { setForm(p => ({ ...p, bus_id: '' })); setBusOpen(false); setBusSearch('') }}
                          className="flex items-center w-full px-2 py-1.5 rounded-lg text-left text-xs transition-colors"
                          style={{ color: 'var(--text-muted)' }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--border)'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                          Aucun bus
                        </button>
                        {searchedBuses.map(b => (
                          <button key={b.id} type="button"
                            onClick={() => { setForm(p => ({ ...p, bus_id: b.id })); setBusOpen(false); setBusSearch('') }}
                            className="flex items-center w-full px-2 py-1.5 rounded-lg text-left transition-colors"
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--border)'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                            <Bus className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--primary)' }} />
                            <span className="ml-2 text-sm font-mono font-medium" style={{ color: 'var(--text-primary)' }}>{b.registration_number}</span>
                            <span className="ml-1.5 text-xs truncate" style={{ color: 'var(--text-muted)' }}>{b.brand} {b.model}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <FieldGroup label="N° de permis">
                <input value={form.license_number} onChange={set('license_number')} className={inputCls} style={inputStyle} placeholder="CI-123456" />
              </FieldGroup>
              <FieldGroup label="Catégorie de permis">
                <SelectWrap>
                  <select value={form.license_category} onChange={set('license_category')} className={selectCls} style={inputStyle}>
                    <option value="">—</option>
                    {LICENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </SelectWrap>
              </FieldGroup>
              <FieldGroup label="Expiration du permis">
                <input type="date" value={form.license_expiry} onChange={set('license_expiry')} className={inputCls} style={inputStyle} />
              </FieldGroup>
              {isContractuel && (
                <FieldGroup label="Itinéraire affecté">
                  <SelectWrap>
                    <select value={form.assigned_route_id} onChange={set('assigned_route_id')} className={selectCls} style={inputStyle}>
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
            <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>Informations RH</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FieldGroup label="N° CNPS">
                <input value={form.cnps_number} onChange={set('cnps_number')} className={inputCls} style={inputStyle} placeholder="12345678A" />
              </FieldGroup>
              <FieldGroup label="Situation matrimoniale">
                <SelectWrap>
                  <select value={form.marital_status} onChange={set('marital_status')} className={selectCls} style={inputStyle}>
                    <option value="">—</option>
                    <option value="celibataire">Célibataire</option>
                    <option value="marie">Marié(e)</option>
                    <option value="divorce">Divorcé(e)</option>
                    <option value="veuf">Veuf/Veuve</option>
                  </select>
                </SelectWrap>
              </FieldGroup>
              <FieldGroup label="Nombre d'enfants">
                <input type="number" min="0" max="20" value={form.children_count} onChange={set('children_count')} className={inputCls} style={inputStyle} />
              </FieldGroup>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t sticky bottom-0 bg-white" style={{ borderColor: 'var(--border)' }}>
          <button onClick={onClose}
            className="px-4 py-2 border rounded-xl text-sm transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
            Annuler
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-50"
            style={{ backgroundColor: 'var(--primary)' }}>
            {saving ? 'Enregistrement...' : (mode === 'create' ? 'Créer le chauffeur' : 'Enregistrer')}
          </button>
        </div>
      </div>
    </div>
  )
}
