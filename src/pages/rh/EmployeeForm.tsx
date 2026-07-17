import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Save, User, Building2, Car, Info, ChevronDown, Camera, X, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/services/supabase'
import { uploadAvatar } from '@/services/hr.service'
import type { ContractType, Gender, MaritalStatus } from '@/types/hr.types'
import type { SBTARole } from '@/store/authStore'
import { computeAge, monthsUntilRetirement, RETIREMENT_AGE, RETIREMENT_ALERT_MONTHS } from '@/utils/retirement'

const EDGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rh-create-employee`

async function callEdge(method: 'POST' | 'PUT', body: Record<string, unknown>): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(EDGE_URL, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? ''}`,
    },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? `Erreur ${res.status}`)
}

const OPERATIONAL_ROLES: SBTARole[] = [
  'chauffeur', 'guichetier', 'chef_garage', 'mecanicien', 'pompiste', 'chef_gare', 'gestionnaire',
  'agent_colis', 'agent_reservation', 'comptable', 'carburant', 'bagagiste',
]

// Rôles nécessitant une gare d'affectation obligatoire
const REQUIRES_STATION: SBTARole[] = ['agent_colis', 'chef_gare']

// Rôles opérationnels pour lesquels la société est facultative
const COMPANY_OPTIONAL_ROLES: SBTARole[] = ['agent_colis', 'chef_gare', 'guichetier']

// Rôles rattachés automatiquement à la holding SBTA (pas de sélection société)
const HOLDING_ROLES: SBTARole[] = ['charge_achat', 'rh', 'planificateur', 'daf', 'gerant_principal', 'agent_qhse']
const SBTA_HOLDING_ID = '11111111-1111-1111-1111-111111111111'

const ROLE_OPTIONS: { value: SBTARole; label: string; group: string }[] = [
  { value: 'gestionnaire',      label: 'Gestionnaire',        group: 'Direction' },
  { value: 'planificateur',     label: 'Planificateur',       group: 'Direction' },
  { value: 'comptable',         label: 'Comptable',           group: 'Direction' },
  { value: 'rh',                label: 'Responsable RH',      group: 'Direction' },
  { value: 'charge_achat',      label: "Chargé d'Achat",      group: 'Direction' },
  { value: 'gerant_principal',  label: 'Gérant Principal',     group: 'Direction' },
  { value: 'responsable_assurance', label: 'Responsable Service Assurance', group: 'Direction' },
  { value: 'responsable_logistique', label: 'Responsable Logistique', group: 'Direction' },
  { value: 'agent_qhse',          label: 'Agent QHSE',             group: 'Direction' },
  { value: 'chauffeur',         label: 'Chauffeur',           group: 'Opérationnel' },
  { value: 'guichetier',        label: 'Guichetier',          group: 'Opérationnel' },
  { value: 'agent_reservation', label: 'Agent Réservation',   group: 'Opérationnel' },
  { value: 'chef_garage',       label: 'Chef Garage',         group: 'Opérationnel' },
  { value: 'mecanicien',        label: 'Mécanicien',          group: 'Opérationnel' },
  { value: 'pompiste',          label: 'Pompiste',            group: 'Opérationnel' },
  { value: 'chef_gare',         label: 'Chef Gare',           group: 'Opérationnel' },
  { value: 'bagagiste',         label: 'Bagagiste',           group: 'Opérationnel' },
  { value: 'agent_colis',       label: 'Agent Courrier',         group: 'Courrier' },
  { value: 'superviseur_colis', label: 'Superviseur Courrier',   group: 'Courrier' },
  { value: 'carburant',         label: 'Carburant',           group: 'Opérationnel' },
]

const LICENSE_CATEGORIES = ['B', 'C', 'D', 'DE', 'C+E']

interface Company { id: string; name: string; code: string; parent_id?: string | null; is_group?: boolean }
interface Station  { id: string; name: string }
interface Bus      { id: string; registration_number: string; brand: string; model: string; class: string; company_id: string }
interface Route    { id: string; name: string; base_price: number }

interface FormData {
  first_name:           string
  last_name:            string
  personal_email:       string
  professional_email:   string
  phone:                string
  gender:               Gender | ''
  nationality:          string
  date_naissance:       string
  role:                 SBTARole | ''
  company_id:           string
  station_id:           string
  contract_type:        ContractType | ''
  hire_date:            string
  salary:               string
  employee_id:          string
  cnps_number:          string
  children_count:       string
  marital_status:       MaritalStatus | ''
  bus_id:               string
  license_number:       string
  license_expiry:       string
  license_category:     string
  avatar_url:           string
  daily_rate:           string
  assigned_route_id:    string
}

const EMPTY_FORM: FormData = {
  first_name: '', last_name: '', personal_email: '', professional_email: '',
  phone: '', gender: '', nationality: '', date_naissance: '', role: '', company_id: '', station_id: '',
  contract_type: '', hire_date: '', salary: '', employee_id: '',
  cnps_number: '', children_count: '0', marital_status: '', bus_id: '',
  license_number: '', license_expiry: '', license_category: '',
  avatar_url: '', daily_rate: '', assigned_route_id: '',
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

export default function EmployeeForm() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isEdit = !!id

  const [form, setForm]               = useState<FormData>(EMPTY_FORM)
  const [companies, setCompanies]     = useState<Company[]>([])
  const [stations,  setStations]      = useState<Station[]>([])
  const [buses,     setBuses]         = useState<Bus[]>([])
  const [routes,    setRoutes]        = useState<Route[]>([])
  const [saving, setSaving]           = useState(false)
  const [loading, setLoading]         = useState(isEdit)
  const [avatarFile, setAvatarFile]   = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string>('')
  const [busSearch, setBusSearch]     = useState('')
  const [busOpen, setBusOpen]         = useState(false)
  const avatarInputRef                = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const loadRef = async () => {
      const [companiesRes, stationsRes, busesRes, routesRes] = await Promise.all([
        supabase.from('companies').select('id, name, code, parent_id, is_group').order('name'),
        supabase.from('stations').select('id, name').order('name'),
        supabase.from('buses').select('id, registration_number, brand, model, class, company_id').order('registration_number'),
        supabase.from('routes').select('id, name, base_price').eq('is_active', true).order('name'),
      ])
      if (companiesRes.data) setCompanies(companiesRes.data)
      if (stationsRes.data)  setStations(stationsRes.data)
      if (busesRes.data)     setBuses(busesRes.data)
      if (routesRes.data)    setRoutes(routesRes.data)
    }
    loadRef()
  }, [])

  useEffect(() => {
    if (!isEdit || !id) return

    const load = async () => {
      // Chercher d'abord dans employees, puis fallback users
      const { data: emp } = await supabase.from('employees').select('*').eq('id', id).maybeSingle()

      const data = emp ?? await supabase.from('users').select('*').eq('id', id)
        .maybeSingle().then(r => r.data)

      if (data) {
        setForm({
          first_name:         data.first_name ?? '',
          last_name:          data.last_name ?? '',
          personal_email:     data.personal_email ?? '',
          professional_email: data.professional_email ?? data.email ?? '',
          phone:              data.phone ?? '',
          gender:             data.gender ?? '',
          nationality:        data.nationality ?? '',
          date_naissance:     data.date_naissance ?? '',
          role:               data.role ?? '',
          company_id:         data.company_id ?? '',
          station_id:         data.station_id ?? '',
          contract_type:      data.contract_type ?? '',
          hire_date:          data.hire_date ?? '',
          salary:             data.salary?.toString() ?? '',
          employee_id:        data.employee_id ?? '',
          cnps_number:        data.cnps_number ?? '',
          children_count:     data.children_count?.toString() ?? '0',
          marital_status:     data.marital_status ?? '',
          bus_id:             data.bus_id ?? '',
          license_number:     data.license_number ?? '',
          license_expiry:     data.license_expiry ?? '',
          license_category:   data.license_category ?? '',
          avatar_url:         data.avatar_url ?? '',
          daily_rate:         data.daily_rate?.toString() ?? '',
          assigned_route_id:  data.assigned_route_id ?? '',
        })
      }
      setLoading(false)
    }
    load()
  }, [id, isEdit])

  const set = (field: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [field]: e.target.value }))

  const filteredBuses = form.company_id
    ? buses.filter(b => b.company_id === form.company_id)
    : buses

  const searchedBuses = (() => {
    const q = busSearch.trim().toLowerCase()
    if (!q) return filteredBuses
    return filteredBuses.filter(b =>
      `${b.registration_number} ${b.brand} ${b.model} ${b.class}`.toLowerCase().includes(q)
    )
  })()

  const selectedBus = buses.find(b => b.id === form.bus_id) ?? null

  const isHoldingRole = form.role ? HOLDING_ROLES.includes(form.role as SBTARole) : false
  const needsCompany  = form.role ? OPERATIONAL_ROLES.includes(form.role as SBTARole) && form.role !== 'bagagiste' && !COMPANY_OPTIONAL_ROLES.includes(form.role as SBTARole) : false
  const needsStation  = form.role ? REQUIRES_STATION.includes(form.role as SBTARole) : false

  // Auto-assign holding company when role is a holding role
  useEffect(() => {
    if (isHoldingRole && form.company_id !== SBTA_HOLDING_ID) {
      setForm(f => ({ ...f, company_id: SBTA_HOLDING_ID, station_id: '' }))
    }
    if (!isHoldingRole && !needsCompany && form.company_id === SBTA_HOLDING_ID) {
      setForm(f => ({ ...f, company_id: '' }))
    }
  }, [form.role]) // eslint-disable-line react-hooks/exhaustive-deps
  const isDriver      = form.role === 'chauffeur'
  const isContractuel = form.contract_type === 'contractuel'

  const validate = () => {
    if (!form.first_name.trim()) { toast.error('Le prénom est obligatoire'); return false }
    if (!form.last_name.trim())  { toast.error('Le nom est obligatoire'); return false }
    if (!isEdit && !form.professional_email.trim() && !form.personal_email.trim()) {
      toast.error('Au moins un email est obligatoire'); return false
    }
    if (!form.role)              { toast.error('Le poste est obligatoire'); return false }
    if (!form.hire_date)         { toast.error("La date d'entrée est obligatoire"); return false }
    if (!form.contract_type)     { toast.error('Le type de contrat est obligatoire'); return false }
    if (form.contract_type === 'titulaire' && !form.salary) {
      toast.error('Le salaire est obligatoire pour un titulaire'); return false
    }
    if (form.contract_type === 'contractuel' && !form.daily_rate && isDriver) {
      toast.error('Le taux journalier est obligatoire pour un chauffeur contractuel'); return false
    }
    if (needsCompany && !form.company_id) { toast.error('La société est obligatoire pour ce poste'); return false }
    if (needsStation && !form.station_id) { toast.error('La gare d\'affectation est obligatoire pour ce poste'); return false }
    return true
  }

  const buildPayload = () => ({
    first_name:        form.first_name.trim(),
    last_name:         form.last_name.trim(),
    phone:             form.phone.trim() || null,
    gender:            form.gender     || null,
    nationality:       form.nationality.trim() || null,
    date_naissance:    form.date_naissance || null,
    role:              form.role,
    company_id:        form.company_id  || null,
    station_id:        form.station_id  || null,
    contract_type:     form.contract_type || null,
    hire_date:         form.hire_date   || null,
    salary:            form.salary      ? parseFloat(form.salary)      : null,
    employee_id:       form.employee_id.trim()  || null,
    cnps_number:       form.cnps_number.trim()  || null,
    children_count:    parseInt(form.children_count) || 0,
    marital_status:    form.marital_status || null,
    bus_id:            isDriver && form.bus_id          ? form.bus_id          : null,
    license_number:    isDriver ? form.license_number.trim()  || null : null,
    license_expiry:    isDriver ? form.license_expiry   || null : null,
    license_category:  isDriver ? form.license_category || null : null,
    avatar_url:        form.avatar_url.trim() || null,
    daily_rate:        isDriver && isContractuel && form.daily_rate ? parseFloat(form.daily_rate) : null,
    assigned_route_id: isDriver && form.assigned_route_id ? form.assigned_route_id : null,
  })

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error('Seuls les formats JPG, PNG et WEBP sont acceptés')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('La photo ne doit pas dépasser 5 Mo')
      return
    }
    setAvatarFile(file)
    setAvatarPreview(URL.createObjectURL(file))
  }

  const handleSave = async () => {
    if (!validate()) return
    setSaving(true)
    try {
      const base = buildPayload()
      const emails = {
        professional_email: form.professional_email.trim() || null,
        personal_email:     form.personal_email.trim() || null,
      }

      if (isEdit && id) {
        await callEdge('PUT', { id, ...base, ...emails })
        if (avatarFile) {
          const { data: emp } = await supabase.from('employees').select('id').eq('id', id).maybeSingle()
          const table = emp ? 'employees' : 'users'
          const url = await uploadAvatar(id, avatarFile, table)
          setForm(p => ({ ...p, avatar_url: url }))
        }
        toast.success('Employé mis à jour')
      } else {
        await callEdge('POST', { ...base, ...emails })
        toast.success(
          `Fiche créée pour ${form.first_name} ${form.last_name}. L'administrateur pourra créer le compte de connexion.`,
          { duration: 5000 }
        )
      }

      navigate('/rh/employees')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(msg || "Erreur lors de l'enregistrement")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/rh/employees')}
            className="p-2 rounded-xl hover:bg-[#F8FAF8] text-[#4A6B55] transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-[#1A2E22]">
              {isEdit ? "Modifier l'employé" : 'Nouvel employé'}
            </h1>
            <p className="text-sm text-[#6B7280]">
              {isEdit ? 'Mettre à jour les informations' : 'Créer une nouvelle fiche employé'}
            </p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#0B7439] text-white rounded-xl text-sm font-semibold hover:bg-[#085c2d] disabled:opacity-50 transition-colors"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </div>

      {/* Bandeau informatif (création seulement) */}
      {!isEdit && (
        <div className="bg-[#DBEAFE] border border-[#1D6FA4] rounded-2xl p-4 flex gap-3">
          <Info className="w-5 h-5 text-[#1D6FA4] flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-bold text-[#1A2E22] text-sm">Information importante</div>
            <div className="text-sm text-[#374151] mt-0.5">
              Vous créez la <strong>fiche employé</strong> (données RH).
              Le compte de connexion à la plateforme sera créé séparément par l'administrateur.
              L'employé apparaîtra automatiquement dans la liste de l'admin en attente de compte.
            </div>
          </div>
        </div>
      )}

      {/* Section 1: Identity */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] p-6">
        <div className="flex items-center gap-2 mb-5">
          <User className="w-5 h-5 text-[#0B7439]" />
          <h2 className="font-bold text-[#1A2E22]">Identité</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FieldGroup label="Prénom" required>
            <input value={form.first_name} onChange={set('first_name')} className={inputCls} placeholder="Amara" />
          </FieldGroup>
          <FieldGroup label="Nom" required>
            <input value={form.last_name} onChange={set('last_name')} className={inputCls} placeholder="Koné" />
          </FieldGroup>
          <FieldGroup label="Email professionnel" hint="Sera utilisé par l'admin pour créer le compte de connexion">
            <input type="email" value={form.professional_email} onChange={set('professional_email')} className={inputCls} placeholder="prenom.nom@societe.ci" />
          </FieldGroup>
          <FieldGroup label="Email personnel">
            <input type="email" value={form.personal_email} onChange={set('personal_email')} className={inputCls} placeholder="email@gmail.com" />
          </FieldGroup>
          <FieldGroup label="Téléphone">
            <input value={form.phone} onChange={set('phone')} className={inputCls} placeholder="+225 07 00 00 00" />
          </FieldGroup>
          <FieldGroup label="Sexe">
            <SelectWrap>
              <select value={form.gender} onChange={set('gender')} className={selectCls}>
                <option value="">— Sélectionner —</option>
                <option value="M">Masculin</option>
                <option value="F">Féminin</option>
              </select>
            </SelectWrap>
          </FieldGroup>
          <FieldGroup label="Nationalité">
            <input value={form.nationality} onChange={set('nationality')} className={inputCls} placeholder="Ivoirienne" />
          </FieldGroup>
          <FieldGroup
            label="Date de naissance"
            hint={(() => {
              const age = computeAge(form.date_naissance)
              if (age === null) return `Sert au calcul du départ à la retraite (${RETIREMENT_AGE} ans)`
              const months = monthsUntilRetirement(form.date_naissance)
              if (months !== null && months <= 0) return `${age} ans — âge de la retraite (${RETIREMENT_AGE} ans) atteint`
              if (months !== null && months <= RETIREMENT_ALERT_MONTHS) return `${age} ans — retraite dans ${months} mois`
              return `${age} ans`
            })()}
          >
            <input type="date" value={form.date_naissance} onChange={set('date_naissance')} className={inputCls} />
          </FieldGroup>
          <FieldGroup label="Situation matrimoniale">
            <SelectWrap>
              <select value={form.marital_status} onChange={set('marital_status')} className={selectCls}>
                <option value="">— Sélectionner —</option>
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
          <FieldGroup label="N° CNPS">
            <input value={form.cnps_number} onChange={set('cnps_number')} className={inputCls} placeholder="12345678A" />
          </FieldGroup>
          <FieldGroup label="Photo de profil">
            <div className="flex items-center gap-4">
              <div className="relative w-20 h-20 flex-shrink-0">
                {(avatarPreview || form.avatar_url) ? (
                  <img
                    src={avatarPreview || form.avatar_url}
                    alt="Photo"
                    className="w-20 h-20 rounded-xl object-cover border border-[#E2EAE5]"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-xl bg-[#F4F7F5] border border-dashed border-[#C5D5CA] flex items-center justify-center">
                    <User className="w-8 h-8 text-[#8AA898]" />
                  </div>
                )}
                {(avatarPreview || form.avatar_url) && (
                  <button
                    type="button"
                    onClick={() => { setAvatarFile(null); setAvatarPreview(''); setForm(p => ({ ...p, avatar_url: '' })) }}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-[#AF3029] text-white rounded-full flex items-center justify-center hover:bg-[#8B1F1A] transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              <div className="flex-1">
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleAvatarChange}
                />
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  className="flex items-center gap-2 px-4 py-2 border border-[#E2EAE5] rounded-xl text-sm text-[#374151] hover:bg-[#F4F7F5] transition-colors"
                >
                  <Camera className="w-4 h-4 text-[#0B7439]" />
                  {avatarPreview || form.avatar_url ? 'Changer la photo' : 'Choisir une photo'}
                </button>
                <p className="text-xs text-[#8AA898] mt-1.5">JPG, PNG ou WEBP — max 5 Mo</p>
              </div>
            </div>
          </FieldGroup>
        </div>
      </div>

      {/* Section 2: Professional data */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] p-6">
        <div className="flex items-center gap-2 mb-5">
          <Building2 className="w-5 h-5 text-[#0B7439]" />
          <h2 className="font-bold text-[#1A2E22]">Données professionnelles</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FieldGroup label="Poste" required>
            <SelectWrap>
              <select value={form.role} onChange={set('role')} className={selectCls}>
                <option value="">— Sélectionner un poste —</option>
                {['Direction', 'Opérationnel', 'Courrier'].map(group => (
                  <optgroup key={group} label={group}>
                    {ROLE_OPTIONS.filter(r => r.group === group).map(r => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </SelectWrap>
          </FieldGroup>
          <FieldGroup label={`Société${needsCompany ? ' *' : ''}`}>
            {isHoldingRole ? (
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium"
                style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              >
                <Building2 className="w-4 h-4 flex-shrink-0" style={{ color: '#0B7439' }} />
                <span style={{ color: 'var(--text-primary)' }}>SBTA</span>
                <span className="ml-auto text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#d4edda', color: '#0B7439' }}>Holding</span>
              </div>
            ) : (
              <SelectWrap>
                <select value={form.company_id} onChange={set('company_id')} className={selectCls}>
                  <option value="">{needsCompany ? '— Obligatoire —' : '— Sélectionner une société —'}</option>
                  {/* Groups with subsidiaries */}
                  {companies.filter(c => c.is_group).map(group => {
                    const subs = companies.filter(c => c.parent_id === group.id)
                    return (
                      <optgroup key={group.id} label={`${group.name} — Groupe (${subs.length} filiales)`}>
                        {subs.sort((a, b) => a.code.localeCompare(b.code)).map(sub => (
                          <option key={sub.id} value={sub.id}>↳ {sub.name} ({sub.code})</option>
                        ))}
                      </optgroup>
                    )
                  })}
                  {/* Autonomous companies */}
                  {companies.filter(c => !c.is_group && !c.parent_id).length > 0 && (
                    <optgroup label="Sociétés autonomes">
                      {companies
                        .filter(c => !c.is_group && !c.parent_id)
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map(c => (
                          <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                        ))
                      }
                    </optgroup>
                  )}
                </select>
              </SelectWrap>
            )}
          </FieldGroup>
          <FieldGroup label={`Gare d'affectation${needsStation ? ' *' : ''}`} hint={needsStation ? 'Obligatoire pour ce poste' : undefined}>
            <SelectWrap>
              <select value={form.station_id} onChange={set('station_id')} className={selectCls}>
                <option value="">{needsStation ? '— Obligatoire —' : '— Sélectionner une gare —'}</option>
                {stations.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </SelectWrap>
          </FieldGroup>
          <FieldGroup label="Type de contrat" required>
            <SelectWrap>
              <select value={form.contract_type} onChange={set('contract_type')} className={selectCls}>
                <option value="">— Sélectionner —</option>
                <option value="titulaire">Titulaire (embauché permanent)</option>
                <option value="contractuel">Contractuel (stagiaire / CDD)</option>
              </select>
            </SelectWrap>
          </FieldGroup>
          <FieldGroup label="Date d'entrée" required>
            <input type="date" value={form.hire_date} onChange={set('hire_date')} className={inputCls} />
          </FieldGroup>
          <FieldGroup
            label={form.contract_type === 'contractuel' ? 'Salaire de référence (FCFA / mois)' : 'Salaire (FCFA / mois)'}
            hint={form.contract_type === 'contractuel' ? 'Optionnel pour les contractuels — le taux journalier est utilisé' : undefined}
          >
            <input type="number" min="0" value={form.salary} onChange={set('salary')} className={inputCls} placeholder="450000" />
          </FieldGroup>
          <FieldGroup label="Matricule interne">
            <input value={form.employee_id} onChange={set('employee_id')} className={inputCls} placeholder="EMP-2024-0001" />
          </FieldGroup>
        </div>
      </div>

      {/* Section 3: Driver-specific */}
      {isDriver && (
        <div className="bg-white rounded-2xl border border-[#E2EAE5] p-6">
          <div className="flex items-center gap-2 mb-5">
            <Car className="w-5 h-5 text-[#0B7439]" />
            <h2 className="font-bold text-[#1A2E22]">Informations chauffeur</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {isContractuel && (
              <>
                <FieldGroup
                  label="Taux journalier (FCFA / jour)"
                  required
                  hint="Rémunération par jour travaillé"
                >
                  <input type="number" min="0" value={form.daily_rate}
                    onChange={set('daily_rate')} className={inputCls} placeholder="5000" />
                </FieldGroup>
                <FieldGroup label="Itinéraire de référence">
                  <SelectWrap>
                    <select value={form.assigned_route_id} onChange={set('assigned_route_id')} className={selectCls}>
                      <option value="">— Aucun itinéraire —</option>
                      {routes.map(r => (
                        <option key={r.id} value={r.id}>{r.name} (billet : {r.base_price.toLocaleString('fr-CI')} F)</option>
                      ))}
                    </select>
                  </SelectWrap>
                </FieldGroup>
              </>
            )}
            <FieldGroup label="Bus affecté">
              {selectedBus ? (
                <div className="flex items-center gap-2 border border-[#0B7439] bg-[#F0FAF4] rounded-xl px-3 py-2.5">
                  <Car className="w-4 h-4 text-[#0B7439] flex-shrink-0" />
                  <span className="text-sm text-[#1A2E22] font-medium">
                    {selectedBus.registration_number} — {selectedBus.brand} {selectedBus.model} ({selectedBus.class})
                  </span>
                  <button
                    type="button"
                    onClick={() => { setForm(p => ({ ...p, bus_id: '' })); setBusSearch(''); setBusOpen(false) }}
                    className="ml-auto p-1 rounded-lg text-[#4A6B55] hover:bg-[#DCEEE3] transition-colors"
                    title="Changer de bus"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-3 top-3 w-4 h-4 text-[#9CA3AF] pointer-events-none" />
                  <input
                    value={busSearch}
                    onChange={e => { setBusSearch(e.target.value); setBusOpen(true) }}
                    onFocus={() => setBusOpen(true)}
                    onBlur={() => setTimeout(() => setBusOpen(false), 150)}
                    className={inputCls + ' pl-9'}
                    placeholder="Rechercher un bus (immat., marque, modèle)"
                  />
                  {busOpen && (
                    <div className="absolute z-20 mt-1 w-full max-h-60 overflow-auto bg-white border border-[#E2EAE5] rounded-xl shadow-lg">
                      {searchedBuses.length === 0 ? (
                        <div className="px-3 py-2.5 text-sm text-[#8AA898]">
                          {filteredBuses.length === 0 ? 'Aucun bus disponible' : `Aucun bus ne correspond à « ${busSearch} »`}
                        </div>
                      ) : (
                        searchedBuses.map(b => (
                          <button
                            key={b.id}
                            type="button"
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => { setForm(p => ({ ...p, bus_id: b.id })); setBusSearch(''); setBusOpen(false) }}
                            className="w-full text-left px-3 py-2.5 text-sm text-[#374151] hover:bg-[#F0FAF4] transition-colors"
                          >
                            <span className="font-medium text-[#1A2E22]">{b.registration_number}</span> — {b.brand} {b.model} ({b.class})
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
              {form.company_id && filteredBuses.length === 0 && (
                <p className="text-xs text-[#D97706] mt-1">Aucun bus actif pour cette société.</p>
              )}
            </FieldGroup>
            <FieldGroup label="N° de permis">
              <input value={form.license_number} onChange={set('license_number')} className={inputCls} placeholder="AB123456" />
            </FieldGroup>
            <FieldGroup label="Date d'expiration du permis">
              <input type="date" value={form.license_expiry} onChange={set('license_expiry')} className={inputCls} />
            </FieldGroup>
            <FieldGroup label="Catégorie de permis">
              <SelectWrap>
                <select value={form.license_category} onChange={set('license_category')} className={selectCls}>
                  <option value="">— Sélectionner —</option>
                  {LICENSE_CATEGORIES.map(c => (
                    <option key={c} value={c}>Catégorie {c}</option>
                  ))}
                </select>
              </SelectWrap>
            </FieldGroup>
          </div>
        </div>
      )}

      {/* Bottom save */}
      <div className="flex justify-end gap-3 pb-6">
        <button onClick={() => navigate('/rh/employees')}
          className="px-5 py-2.5 border border-[#E2EAE5] rounded-xl text-sm text-[#6B7280] hover:bg-[#F8FAF8] transition-colors">
          Annuler
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#0B7439] text-white rounded-xl text-sm font-semibold hover:bg-[#085c2d] disabled:opacity-50 transition-colors"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </div>
    </div>
  )
}
