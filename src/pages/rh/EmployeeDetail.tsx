import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Pencil, Ban, User, Building2,
  MapPin, FileText, Star, Upload, Download,
  AlertTriangle, ShieldCheck, DollarSign, TrendingUp, Calendar, Camera, CalendarClock, AlertCircle, RotateCcw,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/services/supabase'
import { uploadContract, uploadAvatar, deactivateEmployee, reactivateEmployee, convertToSalaried, fetchEmployeeById } from '@/services/hr.service'
import { useAuthStore } from '@/store/authStore'
import type { Employee } from '@/types/hr.types'
import { computeAge, monthsUntilRetirement, isNearRetirement, isRetirementReached, RETIREMENT_AGE } from '@/utils/retirement'

const ROLE_LABELS: Record<string, string> = {
  chauffeur: 'Chauffeur', guichetier: 'Guichetier', agent_reservation: 'Agent Réservation', mecanicien: 'Technicien',
  pompiste: 'Pompiste', chef_garage: 'Chef Garage', chef_gare: 'Chef Gare', bagagiste: 'Bagagiste',
  gestionnaire: 'Gestionnaire', planificateur: 'Planificateur',
  comptable: 'Comptable', daf: 'DAF', rh: 'RH', admin: 'Admin', dg: 'Directeur Général',
  charge_achat: "Chargé d'Achat",
  agent_colis: 'Agent Courrier', superviseur_colis: 'Superviseur Courrier',
  gerant_principal: 'Gérant Principal',
  responsable_assurance: 'Responsable Service Assurance',
  responsable_logistique: 'Responsable Logistique',
}

const GENDER_LABELS: Record<string, string> = { M: 'Masculin', F: 'Féminin' }
const MARITAL_LABELS: Record<string, string> = {
  celibataire: 'Célibataire', marie: 'Marié(e)', divorce: 'Divorcé(e)', veuf: 'Veuf/Veuve',
}

const SUSPENSION_LABELS: Record<string, string> = {
  absence_prolongee: 'Absence prolongée',
  suspension_disciplinaire: 'Suspension disciplinaire',
  depart: 'Départ',
  contrat_expire: 'Contrat expiré',
  autre: 'Autre',
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-2 border-b border-[#F4F7F5] last:border-0">
      <span className="text-xs text-[#8AA898] w-32 flex-shrink-0 pt-0.5 font-medium uppercase tracking-wide">{label}</span>
      <span className="text-sm text-[#1A2E22] font-medium">{value ?? '—'}</span>
    </div>
  )
}

function Section({ title, icon: Icon, children }: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-2xl border border-[#E2EAE5] p-6">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-5 h-5 text-[#0B7439]" />
        <h3 className="font-bold text-[#1A2E22]">{title}</h3>
      </div>
      {children}
    </div>
  )
}

export default function EmployeeDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const [employee, setEmployee] = useState<Employee | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [deactivateReason, setDeactivateReason] = useState('')
  const [showDeactivateModal, setShowDeactivateModal] = useState(false)
  const [deactivating, setDeactivating] = useState(false)
  const [showConversionModal, setShowConversionModal] = useState(false)
  const [activeSuspension, setActiveSuspension] = useState<{
    suspension_type: string; start_date: string; end_date: string | null;
    motif: string | null; is_salary_suspended: boolean
  } | null>(null)
  const [newSalary, setNewSalary] = useState('')
  const [isConverting, setIsConverting] = useState(false)
  const [reactivating, setReactivating] = useState(false)

  useEffect(() => {
    if (!id) return
    fetchEmployeeById(id)
      .then(data => {
        if (!data) { toast.error('Employé introuvable'); return }
        setEmployee(data)
        // Fetch active suspension
        const sourceTable = data.source_table === 'users' ? 'users' : 'employees'
        supabase
          .from('employee_suspensions')
          .select('suspension_type, start_date, end_date, motif, is_salary_suspended')
          .eq('employee_id', data.id)
          .eq('employee_source', sourceTable)
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(1)
          .then(({ data: susp }) => setActiveSuspension(susp?.[0] ?? null))
      })
      .catch(() => toast.error('Erreur de chargement'))
      .finally(() => setLoading(false))
  }, [id])

  const handleUploadContract = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !id) return
    if (file.type !== 'application/pdf') { toast.error('Seuls les fichiers PDF sont acceptés'); return }
    setUploading(true)
    try {
      const sourceTable = (employee as any)?.source_table === 'employees' ? 'employees' : 'users'
      const url = await uploadContract(id, file, sourceTable)
      setEmployee(prev => prev ? { ...prev, contract_url: url } : null)
      toast.success('Contrat mis à jour')
    } catch {
      toast.error('Erreur lors du téléversement')
    } finally {
      setUploading(false)
    }
  }

  const handleUploadAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !id) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error('Seuls les formats JPG, PNG et WEBP sont acceptés')
      return
    }
    if (file.size > 5 * 1024 * 1024) { toast.error('La photo ne doit pas dépasser 5 Mo'); return }
    setUploadingAvatar(true)
    try {
      const sourceTable = (employee as any)?.source_table === 'employees' ? 'employees' : 'users'
      const url = await uploadAvatar(id, file, sourceTable)
      setEmployee(prev => prev ? { ...prev, avatar_url: url } : null)
      toast.success('Photo mise à jour')
    } catch {
      toast.error('Erreur lors du téléversement')
    } finally {
      setUploadingAvatar(false)
      if (avatarInputRef.current) avatarInputRef.current.value = ''
    }
  }

  const handleDeactivate = async () => {
    if (!id || !user) return
    setDeactivating(true)
    try {
      await deactivateEmployee(id, deactivateReason, user.id)
      toast.success('Employé désactivé')
      setShowDeactivateModal(false)
      setEmployee(prev => prev ? { ...prev, status: 'inactive', deactivation_reason: deactivateReason, deactivated_at: new Date().toISOString() } : null)
    } catch {
      toast.error('Erreur lors de la désactivation')
    } finally {
      setDeactivating(false)
    }
  }

  const handleReactivate = async () => {
    if (!id) return
    setReactivating(true)
    try {
      await reactivateEmployee(id)
      toast.success('Employé réactivé avec succès')
      setEmployee(prev => prev ? { ...prev, status: 'active', deactivation_reason: null, deactivated_at: null } : null)
    } catch {
      toast.error('Erreur lors de la réactivation')
    } finally {
      setReactivating(false)
    }
  }

  const handleConvertToSalaried = async () => {
    if (!employee || !user || !newSalary || parseFloat(newSalary) <= 0) return
    setIsConverting(true)
    try {
      await convertToSalaried({ driverId: employee.id, newSalary: parseFloat(newSalary), approvedBy: user.id })
      toast.success('Chauffeur converti en salarié avec succès')
      setShowConversionModal(false)
      setEmployee(prev => prev ? { ...prev, contract_type: 'titulaire', salary: parseFloat(newSalary), seniority_status: 'converti', daily_rate: null } : null)
    } catch {
      toast.error('Erreur lors de la conversion')
    } finally {
      setIsConverting(false)
    }
  }

  const isLicenseExpiringSoon = (expiry: string | null) => {
    if (!expiry) return false
    const days = (new Date(expiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    return days < 60
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!employee) return null

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      {/* Back + actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/rh/employees')}
          className="flex items-center gap-2 text-sm text-[#4A6B55] hover:text-[#0B7439] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Retour à la liste
        </button>
        <div className="flex gap-3">
          <button
            onClick={() => navigate(`/rh/employees/${employee.id}/edit`)}
            className="flex items-center gap-2 px-4 py-2 border border-[#E2EAE5] rounded-xl text-sm text-[#374151] hover:bg-[#F8FAF8] transition-colors"
          >
            <Pencil className="w-4 h-4" />
            Modifier
          </button>
          {employee.status === 'active' && (
            <button
              onClick={() => setShowDeactivateModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-[#AF3029] text-white rounded-xl text-sm font-semibold hover:bg-[#8B1F1A] transition-colors"
            >
              <Ban className="w-4 h-4" />
              Désactiver
            </button>
          )}
          {employee.status === 'inactive' && (
            <button
              onClick={handleReactivate}
              disabled={reactivating}
              className="flex items-center gap-2 px-4 py-2 bg-[#0B7439] text-white rounded-xl text-sm font-semibold hover:bg-[#085c2d] transition-colors disabled:opacity-50"
            >
              {reactivating
                ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <RotateCcw className="w-4 h-4" />}
              Réactiver
            </button>
          )}
        </div>
      </div>

      {/* Profile header */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] p-6">
        <div className="flex items-start gap-5">
          <div className="relative flex-shrink-0 group">
            {employee.avatar_url ? (
              <img src={employee.avatar_url} alt="" className="w-20 h-20 rounded-2xl object-cover" />
            ) : (
              <div className="w-20 h-20 rounded-2xl bg-[#D4EDDA] flex items-center justify-center text-[#0B7439] font-bold text-2xl">
                {(employee.first_name?.[0] ?? '').toUpperCase()}{(employee.last_name?.[0] ?? '').toUpperCase()}
              </div>
            )}
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              disabled={uploadingAvatar}
              className="absolute inset-0 rounded-2xl bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
              title="Changer la photo"
            >
              {uploadingAvatar
                ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <Camera className="w-5 h-5 text-white" />
              }
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleUploadAvatar}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-[#1A2E22]">{employee.full_name}</h2>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="px-2 py-0.5 rounded-lg text-xs font-medium bg-[#D4EDDA] text-[#0B7439]">
                    {ROLE_LABELS[employee.role] ?? employee.role}
                  </span>
                  {employee.company_name && (
                    <span className="text-sm text-[#4A6B55]">— {employee.company_name}</span>
                  )}
                  <span className={`px-2 py-0.5 rounded-lg text-xs font-semibold ${
                    employee.status === 'active'
                      ? 'bg-[#D4EDDA] text-[#0B7439]'
                      : 'bg-[#F3F4F6] text-[#6B7280]'
                  }`}>
                    {employee.status === 'active' ? 'Actif' : 'Inactif'}
                  </span>
                  {activeSuspension && (
                    <span className="px-2 py-0.5 rounded-lg text-xs font-semibold bg-[#FEF3C7] text-[#D97706]">
                      Suspendu{activeSuspension.is_salary_suspended ? ' (salaire suspendu)' : ''}
                    </span>
                  )}
                </div>
                {employee.employee_id && (
                  <p className="text-xs text-[#8AA898] mt-1 font-mono">Matricule : {employee.employee_id}</p>
                )}
              </div>
            </div>
            {employee.status === 'inactive' && employee.deactivation_reason && (
              <div className="mt-3 p-3 bg-[#FEF2F2] border border-[#FECACA] rounded-xl text-sm text-[#AF3029]">
                <strong>Motif de désactivation :</strong> {employee.deactivation_reason}
              </div>
            )}
            {activeSuspension && (
              <div className="mt-3 p-3 bg-[#FEF3C7] border border-[#FCD34D] rounded-xl flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-[#D97706] flex-shrink-0 mt-0.5" />
                <div className="text-sm text-[#92400E]">
                  <strong>Suspension active :</strong>{' '}
                  {SUSPENSION_LABELS[activeSuspension.suspension_type] ?? activeSuspension.suspension_type}
                  {' — '}du {new Date(activeSuspension.start_date).toLocaleDateString('fr-FR')}
                  {activeSuspension.end_date && ` au ${new Date(activeSuspension.end_date).toLocaleDateString('fr-FR')}`}
                  {activeSuspension.motif && `. Motif : ${activeSuspension.motif}`}
                  {activeSuspension.is_salary_suspended && (
                    <span className="block mt-1 text-[#AF3029] font-medium">
                      Le salaire est suspendu pour cette suspension. Le bulletin de paie reste néanmoins générable.
                    </span>
                  )}
                </div>
              </div>
            )}
            {isNearRetirement(employee.date_naissance) && (
              <div className="mt-3 p-3 bg-[#FEF2F2] border border-[#DC2626] rounded-xl flex items-start gap-2">
                <CalendarClock className="w-4 h-4 text-[#DC2626] flex-shrink-0 mt-0.5" />
                <div className="text-sm text-[#991B1B]">
                  {(() => {
                    const months = monthsUntilRetirement(employee.date_naissance)
                    const rd = employee.date_naissance ? new Date(employee.date_naissance) : null
                    const retYear = rd ? rd.getFullYear() + RETIREMENT_AGE : null
                    if (isRetirementReached(employee.date_naissance)) {
                      return <span><strong>Âge de la retraite atteint</strong> — l'âge légal de départ ({RETIREMENT_AGE} ans) est atteint ou dépassé.</span>
                    }
                    return <span><strong>Départ à la retraite proche</strong> — atteindra {RETIREMENT_AGE} ans dans {months} mois{retYear ? ` (en ${retYear})` : ''}.</span>
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Personal info */}
        <Section title="Informations personnelles" icon={User}>
          <InfoRow label="Téléphone" value={employee.phone} />
          <InfoRow label="Email pro."
            value={(employee as any).professional_email ?? employee.email ?? null} />
          {(employee as any).personal_email && (
            <InfoRow label="Email perso."
              value={(employee as any).personal_email} />
          )}
          <InfoRow label="Sexe"      value={employee.gender ? GENDER_LABELS[employee.gender] : null} />
          <InfoRow label="Date naiss."
            value={employee.date_naissance
              ? `${new Date(employee.date_naissance).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}${computeAge(employee.date_naissance) !== null ? ` — ${computeAge(employee.date_naissance)} ans` : ''}`
              : null} />
          <InfoRow label="Sit. matr." value={employee.marital_status ? MARITAL_LABELS[employee.marital_status] : null} />
          <InfoRow label="Nb enfants" value={employee.children_count} />
          <InfoRow label="N° CNPS"   value={employee.cnps_number} />
        </Section>

        {/* Professional info */}
        <Section title="Informations professionnelles" icon={Building2}>
          <InfoRow label="Société"
            value={employee.company_name ? `${employee.company_name} (${employee.company_code})` : 'HOLDING'} />
          <InfoRow label="Gare"      value={employee.station_name} />
          <InfoRow label="Poste"     value={ROLE_LABELS[employee.role] ?? employee.role} />
          {employee.role === 'mecanicien' && employee.technician_type_nom && (
            <InfoRow label="Type technicien" value={employee.technician_type_nom} />
          )}
          <InfoRow label="Contrat"
            value={employee.contract_type === 'titulaire' ? 'Titulaire (embauché)' : employee.contract_type === 'contractuel' ? 'Contractuel' : employee.contract_type === 'stagiaire' ? 'Stagiaire' : null} />
          <InfoRow label="Nature"
            value={employee.contract_nature ?? null} />
          <InfoRow label="Date entrée"
            value={employee.hire_date
              ? `${new Date(employee.hire_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}${employee.years_of_service !== null ? ` — ${employee.years_of_service} an${employee.years_of_service > 1 ? 's' : ''}` : ''}`
              : null} />
          <InfoRow label="Salaire"
            value={employee.salary !== null ? `${Number(employee.salary).toLocaleString('fr-CI')} FCFA / mois` : null} />
        </Section>

        {/* Driver-specific */}
        {employee.role === 'chauffeur' && (
          <Section title="Bus affecté" icon={MapPin}>
            <InfoRow label="Immatr."   value={employee.bus_registration} />
            <InfoRow label="Marque/Mod."
              value={employee.bus_brand || employee.bus_model
                ? `${employee.bus_brand ?? ''} ${employee.bus_model ?? ''}`.trim()
                : null} />
            <InfoRow label="Type"      value={employee.bus_class} />
            <InfoRow label="Permis"    value={employee.license_number} />
            <InfoRow label="Catégorie" value={employee.license_category} />
            <InfoRow label="Expiration permis"
              value={
                employee.license_expiry ? (
                  <span className={`flex items-center gap-1 ${isLicenseExpiringSoon(employee.license_expiry) ? 'text-[#D97706]' : ''}`}>
                    {new Date(employee.license_expiry).toLocaleDateString('fr-FR')}
                    {isLicenseExpiringSoon(employee.license_expiry) && (
                      <AlertTriangle className="w-3.5 h-3.5 text-[#D97706]" />
                    )}
                  </span>
                ) : null
              } />
          </Section>
        )}

        {/* Contract document */}
        <Section title="Contrat de travail" icon={FileText}>
          {employee.contract_url ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 bg-[#F8FAF8] rounded-xl border border-[#E2EAE5]">
                <FileText className="w-8 h-8 text-[#0B7439] flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[#1A2E22] truncate">
                    {employee.contract_url.split('/').pop()}
                  </p>
                  <p className="text-xs text-[#8AA898]">Contrat de travail</p>
                </div>
                <a
                  href={employee.contract_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 px-3 py-1.5 text-xs bg-[#0B7439] text-white rounded-lg hover:bg-[#085c2d] transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Télécharger
                </a>
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-2 text-sm text-[#4A6B55] hover:text-[#0B7439] transition-colors"
              >
                <Upload className="w-4 h-4" />
                {uploading ? 'Téléversement...' : 'Mettre à jour le contrat'}
              </button>
            </div>
          ) : (
            <div className="text-center py-4">
              <FileText className="w-10 h-10 text-[#9CA3AF] mx-auto mb-2 opacity-40" />
              <p className="text-sm text-[#6B7280] mb-3">Aucun contrat téléversé</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-2 px-4 py-2 bg-[#0B7439] text-white rounded-xl text-sm font-medium hover:bg-[#085c2d] transition-colors mx-auto"
              >
                <Upload className="w-4 h-4" />
                {uploading ? 'Téléversement...' : 'Téléverser le contrat'}
              </button>
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={handleUploadContract} />
        </Section>

        {/* Remuneration block — chauffeurs uniquement */}
        {employee.role === 'chauffeur' && (
          <div className="bg-white border border-[#E2EAE5] rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-5 h-5 text-[#0B7439]" />
              <h3 className="font-bold text-[#1A2E22]">Rémunération</h3>
            </div>

            {employee.contract_type === 'titulaire' && (
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-[#4A6B55]">Type</span>
                  <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-[#D4EDDA] text-[#0B7439]">Salarié (Titulaire)</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-[#4A6B55]">Salaire mensuel</span>
                  <span className="font-bold text-[#1A2E22] text-base">{employee.salary?.toLocaleString('fr-CI')} FCFA</span>
                </div>
                {employee.seniority_status === 'converti' && (
                  <div className="text-xs text-[#4A6B55] bg-[#F8FAF8] rounded-lg p-2 mt-1">
                    Converti depuis le statut contractuel
                  </div>
                )}
              </div>
            )}

            {employee.contract_type === 'contractuel' && (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-[#4A6B55]">Type</span>
                  <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-[#DBEAFE] text-[#1D6FA4]">Contractuel</span>
                </div>
                <div className="bg-[#F8FAF8] rounded-xl p-3 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-[#4A6B55]">Taux journalier</span>
                    <span className="font-bold text-[#1D6FA4]">
                      {employee.daily_rate != null ? `${Number(employee.daily_rate).toLocaleString('fr-CI')} FCFA / jour` : '—'}
                    </span>
                  </div>
                </div>
                <div className="border border-[#E2EAE5] rounded-xl p-3 space-y-2">
                  <div className="text-xs font-semibold text-[#4A6B55] uppercase tracking-wide">Mois en cours</div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <div className="text-lg font-bold text-[#1A2E22]">{employee.days_worked_this_month}</div>
                      <div className="text-xs text-[#8AA898]">Jours travaillés</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-[#0B7439]">{Number(employee.current_month_earnings).toLocaleString('fr-CI')}</div>
                      <div className="text-xs text-[#8AA898]">FCFA cumulés</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-[#D97706]">
                        {employee.daily_rate != null
                          ? (Number(employee.daily_rate) * Math.max(0, 26 - employee.days_worked_this_month)).toLocaleString('fr-CI')
                          : '—'}
                      </div>
                      <div className="text-xs text-[#8AA898]">FCFA restants est.</div>
                    </div>
                  </div>
                </div>
                {employee.seniority_status === 'eligible' && (
                  <div className="bg-[#FEF3C7] border border-[#D97706] rounded-xl p-3">
                    <div className="flex items-start gap-2">
                      <TrendingUp className="w-4 h-4 text-[#D97706] flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <div className="text-sm font-bold text-[#92400E]">Éligible au passage salarial</div>
                        {employee.seniority_eligibility_date && (
                          <div className="text-xs text-[#D97706] mt-0.5">
                            Ancienneté atteinte le {new Date(employee.seniority_eligibility_date).toLocaleDateString('fr-FR')}
                          </div>
                        )}
                        <button
                          onClick={() => { setNewSalary(''); setShowConversionModal(true) }}
                          className="mt-2 text-xs font-bold text-white bg-[#D97706] hover:bg-[#92400E] px-3 py-1.5 rounded-lg transition-colors"
                        >
                          Convertir en salarié
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {employee.seniority_status === 'non_eligible' && employee.seniority_eligibility_date && (
                  <div className="text-xs text-[#8AA898] text-center py-1">
                    Éligible au passage salarial le{' '}
                    <span className="font-medium text-[#4A6B55]">
                      {new Date(employee.seniority_eligibility_date).toLocaleDateString('fr-FR')}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Driver performance */}
        {employee.role === 'chauffeur' && (
          <Section title="Performance conduite" icon={Star}>
            <div className="flex items-center gap-4">
              <div className="text-center">
                <div className="text-3xl font-bold text-[#0B7439]">
                  {Number(employee.driver_average_rating).toFixed(1)}
                </div>
                <div className="flex gap-0.5 justify-center mt-1">
                  {[1,2,3,4,5].map(i => (
                    <Star key={i} className={`w-4 h-4 ${i <= Math.round(Number(employee.driver_average_rating)) ? 'text-[#F59E0B] fill-[#F59E0B]' : 'text-[#D1D5DB]'}`} />
                  ))}
                </div>
                <div className="text-xs text-[#8AA898] mt-1">Note moyenne</div>
              </div>
              <div className="flex-1 space-y-2">
                {employee.driver_performance_level && (
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-[#0B7439]" />
                    <span className="text-sm font-medium text-[#1A2E22]">
                      Niveau : {employee.driver_performance_level}
                    </span>
                  </div>
                )}
                <div className="text-sm text-[#4A6B55]">
                  {(employee as any).driver_total_reviews ?? 0} évaluation{((employee as any).driver_total_reviews ?? 0) > 1 ? 's' : ''}
                </div>
              </div>
            </div>
          </Section>
        )}
      </div>

      {/* Conversion modal */}
      {showConversionModal && employee && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-[#1A2E22]">Conversion en salarié</h3>
            <div className="bg-[#F8FAF8] rounded-xl p-4 space-y-1">
              <div className="font-bold text-[#1A2E22]">{employee.full_name}</div>
              <div className="text-sm text-[#4A6B55]">{employee.company_name}</div>
              {employee.hire_date && (
                <div className="text-sm text-[#4A6B55]">
                  En poste depuis le {new Date(employee.hire_date).toLocaleDateString('fr-FR')}
                  {employee.years_of_service != null ? ` — ${employee.years_of_service} an${employee.years_of_service > 1 ? 's' : ''}` : ''}
                </div>
              )}
              {employee.daily_rate != null && (
                <div className="text-sm text-[#4A6B55]">
                  Taux contractuel actuel : {Number(employee.daily_rate).toLocaleString('fr-CI')} FCFA/jour
                </div>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-[#1A2E22]">Nouveau salaire mensuel (FCFA) *</label>
              <input
                type="number" min="1"
                value={newSalary}
                onChange={e => setNewSalary(e.target.value)}
                placeholder="Ex : 350000"
                className="w-full border border-[#E2EAE5] rounded-xl px-4 py-3 mt-1 text-lg font-bold focus:outline-none focus:border-[#0B7439]"
              />
              <p className="text-xs text-[#8AA898] mt-1">Effectif à partir du 1er du mois prochain</p>
            </div>
            <div className="bg-[#D4EDDA] rounded-xl p-3 text-sm text-[#0B7439]">
              Cette action : change le statut en Titulaire, supprime le taux journalier et enregistre l'action dans le journal d'activité.
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowConversionModal(false)}
                className="flex-1 py-3 border border-[#E2EAE5] rounded-xl text-[#4A6B55] font-medium hover:bg-[#F8FAF8]">
                Annuler
              </button>
              <button
                onClick={handleConvertToSalaried}
                disabled={!newSalary || parseFloat(newSalary) <= 0 || isConverting}
                className="flex-1 py-3 bg-[#0B7439] text-white rounded-xl font-bold disabled:opacity-50 hover:bg-[#085c2d] transition-colors"
              >
                {isConverting ? 'Conversion...' : 'Confirmer la conversion'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deactivate modal */}
      {showDeactivateModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-[#1A2E22] mb-1">Désactiver l'employé</h3>
            <p className="text-sm text-[#6B7280] mb-4">
              Vous allez désactiver <strong>{employee.full_name}</strong>. Le compte sera suspendu immédiatement.
            </p>
            <label className="block text-sm font-medium text-[#374151] mb-1">Motif *</label>
            <textarea
              rows={3}
              placeholder="Ex : Fin de contrat, départ volontaire..."
              value={deactivateReason}
              onChange={e => setDeactivateReason(e.target.value)}
              className="w-full border border-[#E2EAE5] rounded-xl px-3 py-2 text-sm resize-none mb-4"
            />
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowDeactivateModal(false)}
                className="px-4 py-2 border border-[#E2EAE5] rounded-xl text-sm text-[#6B7280] hover:bg-[#F8FAF8]">
                Annuler
              </button>
              <button
                onClick={handleDeactivate}
                disabled={!deactivateReason.trim() || deactivating}
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
