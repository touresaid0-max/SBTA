import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Bus, Tag, CreditCard as Edit2, Plus, RefreshCw, FileText,
  ExternalLink, History, Upload, X, ShieldCheck,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'
import { formatCurrency } from '@/utils/formatCurrency'
import {
  fetchVehicle, updateVehicle, fetchVehicleDocuments, fetchVehiclePlates,
  fetchServiceTypes, fetchProviders, fetchVehicles,
  addProvisionalPlate, replaceWithDefinitivePlate, uploadLogisticsDocument,
  effectiveStatus, alertLevel, STATUS_LABELS, PLATE_STATUS_LABELS,
} from '@/services/logistics.service'
import type {
  Vehicle, VehicleDocument, VehiclePlate, ServiceType, Provider,
  PlateStatus, ProvisionalPlateInput, DefinitivePlateInput,
} from '@/types/logistics.types'
import DocumentModal, { type DocModalMode } from './DocumentModal'

const STATUS_STYLE: Record<string, { bg: string; text: string; dot: string }> = {
  green:  { bg: '#E7F6EC', text: '#0B7439', dot: '#16A34A' },
  orange: { bg: '#FEF3C7', text: '#B45309', dot: '#F59E0B' },
  red:    { bg: '#FEE2E2', text: '#B91C1C', dot: '#DC2626' },
  blue:   { bg: '#DBEAFE', text: '#1D4ED8', dot: '#2563EB' },
  gray:   { bg: '#F3F4F6', text: '#6B7280', dot: '#9CA3AF' },
}

const inputCls = 'w-full px-3 py-2 rounded-lg border border-[#E2EAE5] text-sm text-[#1A2E22] focus:outline-none focus:ring-2 focus:ring-[#0B7439]/30 focus:border-[#0B7439]'

export default function VehicleDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const isReadOnly = user?.role === 'logistique'
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [documents, setDocuments] = useState<VehicleDocument[]>([])
  const [plates, setPlates] = useState<VehiclePlate[]>([])
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [allVehicles, setAllVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [docModal, setDocModal] = useState<{ mode: DocModalMode; doc: VehicleDocument | null } | null>(null)
  const [provModal, setProvModal] = useState(false)
  const [defModal, setDefModal] = useState(false)
  const [editFiche, setEditFiche] = useState(false)

  const load = () => {
    if (!id) return
    setLoading(true)
    Promise.all([
      fetchVehicle(id), fetchVehicleDocuments(id), fetchVehiclePlates(id),
      fetchServiceTypes(), fetchProviders(), fetchVehicles(),
    ])
      .then(([v, d, p, s, pr, av]) => { setVehicle(v); setDocuments(d); setPlates(p); setServiceTypes(s); setProviders(pr); setAllVehicles(av) })
      .catch((err) => { console.error(err); toast.error('Erreur lors du chargement') })
      .finally(() => setLoading(false))
  }
  useEffect(load, [id])

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" /></div>
  }
  if (!vehicle) {
    return <div className="p-6 text-center text-[#6B7280]">Fiche introuvable.</div>
  }

  const activePlate = plates.find(p => p.is_active) ?? null
  const ps = PLATE_STATUS_LABELS[vehicle.plate_status]

  const infoRows: [string, string][] = [
    ['Société propriétaire', vehicle.company_name || '—'],
    ['Immatriculation actuelle', vehicle.registration_number || '—'],
    ['Numéro provisoire WWW', vehicle.provisional_number || '—'],
    ['Marque', vehicle.brand || '—'],
    ['Modèle', vehicle.model || '—'],
    ['Nombre de places', vehicle.total_seats != null ? String(vehicle.total_seats) : '—'],
    ['Date mise en circulation', vehicle.circulation_date ? new Date(vehicle.circulation_date).toLocaleDateString('fr-FR') : '—'],
    ['Numéro châssis', vehicle.chassis_number || '—'],
    ['Numéro carte grise', vehicle.carte_grise_number || '—'],
  ]

  return (
    <div className="space-y-6 p-6">
      <button onClick={() => navigate('/logistique/vehicles')} className="inline-flex items-center gap-2 text-sm text-[#4A6B55] hover:text-[#0B7439]">
        <ArrowLeft className="w-4 h-4" /> Retour au parc
      </button>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-[#E7F6EC] flex items-center justify-center"><Bus className="w-6 h-6 text-[#0B7439]" /></div>
          <div>
            <h1 className="text-2xl font-bold text-[#1A2E22] font-mono">{vehicle.registration_number || vehicle.provisional_number || 'Sans plaque'}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-[#DBEAFE] text-[#1D4ED8]">{ps}</span>
              <span className="text-sm text-[#6B7280]">{[vehicle.brand, vehicle.model].filter(Boolean).join(' ')}</span>
            </div>
          </div>
        </div>
        {!isReadOnly && (
          <button onClick={() => setEditFiche(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-[#E2EAE5] text-[#4A6B55] text-sm font-medium hover:bg-[#F8FAF8]">
            <Edit2 className="w-4 h-4" /> Modifier la fiche
          </button>
        )}
      </div>

      {/* Fiche info */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
        <h2 className="font-semibold text-[#1A2E22] mb-4">Informations véhicule</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {infoRows.map(([k, v]) => (
            <div key={k}><p className="text-xs text-[#8AA898]">{k}</p><p className="text-sm font-medium text-[#1A2E22]">{v}</p></div>
          ))}
        </div>
        {vehicle.observation && <p className="mt-4 text-sm text-[#4A6B55]">{vehicle.observation}</p>}
      </div>

      {/* Plates section */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2EAE5]">
          <div className="flex items-center gap-2"><Tag className="w-5 h-5 text-[#0B7439]" /><h2 className="font-semibold text-[#1A2E22]">Plaques & immatriculation</h2></div>
          {!isReadOnly && (
            <div className="flex gap-2">
              <button onClick={() => setProvModal(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#FEF3C7] text-[#B45309] text-sm font-medium hover:bg-[#FDE68A]">
                <Plus className="w-4 h-4" /> Plaque provisoire
              </button>
              <button onClick={() => setDefModal(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0B7439] text-white text-sm font-medium hover:bg-[#095e2f]">
                <RefreshCw className="w-4 h-4" /> Remplacer par définitive
              </button>
            </div>
          )}
        </div>

        {activePlate && (
          <div className="px-5 py-4 bg-[#F8FAF8] border-b border-[#E2EAE5]">
            <p className="text-xs text-[#8AA898] mb-1">Plaque active</p>
            <div className="flex items-center gap-3">
              <span className="font-mono font-bold text-lg text-[#0B7439]">{activePlate.plate_number}</span>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-[#E7F6EC] text-[#0B7439]">{activePlate.plate_type === 'provisoire' ? 'Provisoire' : 'Définitive'}</span>
            </div>
          </div>
        )}

        <div className="px-5 py-4">
          <div className="flex items-center gap-2 mb-3"><History className="w-4 h-4 text-[#6B7280]" /><h3 className="text-sm font-semibold text-[#4A6B55]">Historique des plaques</h3></div>
          {plates.length === 0 ? (
            <p className="text-sm text-[#6B7280] py-4 text-center">Aucune plaque enregistrée.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[#8AA898] text-left text-xs">
                    <th className="py-2 font-medium">Plaque</th>
                    <th className="py-2 font-medium">Type</th>
                    <th className="py-2 font-medium">Récépissé / Carte grise</th>
                    <th className="py-2 font-medium">Statut</th>
                    <th className="py-2 font-medium">Document</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0F4F1]">
                  {plates.map(p => (
                    <tr key={p.id}>
                      <td className="py-2.5 font-mono font-semibold text-[#1A2E22]">{p.plate_number}</td>
                      <td className="py-2.5 text-[#4A6B55]">{p.plate_type === 'provisoire' ? 'Provisoire' : 'Définitive'}</td>
                      <td className="py-2.5 text-[#4A6B55]">
                        {p.plate_type === 'provisoire'
                          ? (p.recepisse_date ? `Récépissé ${new Date(p.recepisse_date).toLocaleDateString('fr-FR')}` : '—')
                          : (p.carte_grise_number || '—')}
                      </td>
                      <td className="py-2.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${p.is_active ? 'bg-[#E7F6EC] text-[#0B7439]' : 'bg-[#F3F4F6] text-[#6B7280]'}`}>
                          {p.is_active ? 'Active' : (p.replaced_at ? 'Remplacée' : 'Inactive')}
                        </span>
                      </td>
                      <td className="py-2.5">
                        {(p.recepisse_url || p.carte_grise_url)
                          ? <a href={p.recepisse_url || p.carte_grise_url!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#0B7439] hover:underline"><ExternalLink className="w-3.5 h-3.5" /> Voir</a>
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-[#8AA898]">Le numéro provisoire n'est jamais supprimé : il est conservé dans l'historique lors du passage en plaque définitive.</p>
        </div>
      </div>

      {/* Documents section */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2EAE5]">
          <div className="flex items-center gap-2"><FileText className="w-5 h-5 text-[#0B7439]" /><h2 className="font-semibold text-[#1A2E22]">Documents rattachés</h2></div>
          {!isReadOnly && (
            <button onClick={() => setDocModal({ mode: 'create', doc: null })} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0B7439] text-white text-sm font-medium hover:bg-[#095e2f]">
              <Plus className="w-4 h-4" /> Ajouter
            </button>
          )}
        </div>
        {documents.length === 0 ? (
          <div className="text-center py-12 text-[#6B7280]"><ShieldCheck className="w-9 h-9 text-[#9CA3AF] mx-auto mb-2" />Aucun document.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F8FAF8] text-[#4A6B55] text-left">
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 font-semibold">Prestataire</th>
                  <th className="px-4 py-3 font-semibold">Établi</th>
                  <th className="px-4 py-3 font-semibold">Échéance</th>
                  <th className="px-4 py-3 font-semibold text-right">Montant</th>
                  <th className="px-4 py-3 font-semibold">Statut</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F4F1]">
                {documents.map(d => {
                  const st = effectiveStatus(d)
                  const c = STATUS_STYLE[alertLevel(d)]
                  return (
                    <tr key={d.id} className={`hover:bg-[#F8FAF8] ${!d.is_current ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-3 text-[#1A2E22]">{d.service_type_name}{d.year_concerned ? ` ${d.year_concerned}` : ''}</td>
                      <td className="px-4 py-3 text-[#4A6B55]">{d.provider_name || '—'}</td>
                      <td className="px-4 py-3 text-[#4A6B55]">{d.issue_date ? new Date(d.issue_date).toLocaleDateString('fr-FR') : '—'}</td>
                      <td className="px-4 py-3 text-[#4A6B55]">{d.expiry_date ? new Date(d.expiry_date).toLocaleDateString('fr-FR') : '—'}</td>
                      <td className="px-4 py-3 text-right text-[#4A6B55]">{formatCurrency(d.amount)}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: c.bg, color: c.text }}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c.dot }} />{STATUS_LABELS[st]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {d.document_url && <a href={d.document_url} target="_blank" rel="noreferrer" className="p-2 rounded-lg hover:bg-[#F3F4F6] text-[#4A6B55]"><ExternalLink className="w-4 h-4" /></a>}
                          {!isReadOnly && d.is_current && <button onClick={() => setDocModal({ mode: 'renew', doc: d })} className="p-2 rounded-lg hover:bg-[#DBEAFE] text-[#1D4ED8]" title="Renouveler"><RefreshCw className="w-4 h-4" /></button>}
                          {!isReadOnly && d.is_current && <button onClick={() => setDocModal({ mode: 'edit', doc: d })} className="p-2 rounded-lg hover:bg-[#E7F6EC] text-[#0B7439]"><Edit2 className="w-4 h-4" /></button>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {docModal && (
        <DocumentModal
          mode={docModal.mode}
          vehicles={allVehicles}
          serviceTypes={serviceTypes}
          providers={providers}
          existing={docModal.doc}
          lockedVehicleId={vehicle.id}
          onClose={() => setDocModal(null)}
          onSaved={() => { setDocModal(null); load() }}
        />
      )}

      {editFiche && <EditFicheModal vehicle={vehicle} onClose={() => setEditFiche(false)} onSaved={() => { setEditFiche(false); load() }} />}
      {provModal && <ProvisionalModal vehicleId={vehicle.id} onClose={() => setProvModal(false)} onSaved={() => { setProvModal(false); load() }} />}
      {defModal && <DefinitiveModal vehicleId={vehicle.id} activePlateId={activePlate?.id ?? null} onClose={() => setDefModal(false)} onSaved={() => { setDefModal(false); load() }} />}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div><label className="block text-xs font-medium text-[#4A6B55] mb-1.5">{label}</label>{children}</div>)
}

function ModalShell({ title, onClose, onSave, saving, children, saveLabel = 'Enregistrer' }: { title: string; onClose: () => void; onSave: () => void; saving: boolean; children: React.ReactNode; saveLabel?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2EAE5]">
          <h2 className="font-semibold text-[#1A2E22]">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#F3F4F6]"><X className="w-5 h-5 text-[#6B7280]" /></button>
        </div>
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">{children}</div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-[#E2EAE5]">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-[#E2EAE5] text-[#4A6B55] text-sm font-medium hover:bg-[#F8FAF8]">Annuler</button>
          <button onClick={onSave} disabled={saving} className="px-4 py-2 rounded-xl bg-[#0B7439] text-white text-sm font-medium hover:bg-[#095e2f] disabled:opacity-60">{saving ? 'Enregistrement...' : saveLabel}</button>
        </div>
      </div>
    </div>
  )
}

function EditFicheModal({ vehicle, onClose, onSaved }: { vehicle: Vehicle; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    bus_id: vehicle.bus_id, company_id: vehicle.company_id,
    registration_number: vehicle.registration_number, provisional_number: vehicle.provisional_number,
    brand: vehicle.brand, model: vehicle.model, total_seats: vehicle.total_seats,
    circulation_date: vehicle.circulation_date, chassis_number: vehicle.chassis_number,
    carte_grise_number: vehicle.carte_grise_number, plate_status: vehicle.plate_status, observation: vehicle.observation,
  })
  const [saving, setSaving] = useState(false)
  const save = async () => {
    setSaving(true)
    try { await updateVehicle(vehicle.id, form); toast.success('Fiche mise à jour'); onSaved() }
    catch (err) { console.error(err); toast.error('Erreur lors de l\'enregistrement') }
    finally { setSaving(false) }
  }
  return (
    <ModalShell title="Modifier la fiche" onClose={onClose} onSave={save} saving={saving}>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Immatriculation actuelle"><input value={form.registration_number ?? ''} onChange={e => setForm({ ...form, registration_number: e.target.value || null })} className={inputCls} /></Field>
        <Field label="Numéro provisoire WWW"><input value={form.provisional_number ?? ''} onChange={e => setForm({ ...form, provisional_number: e.target.value || null })} className={inputCls} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Marque"><input value={form.brand ?? ''} onChange={e => setForm({ ...form, brand: e.target.value || null })} className={inputCls} /></Field>
        <Field label="Modèle"><input value={form.model ?? ''} onChange={e => setForm({ ...form, model: e.target.value || null })} className={inputCls} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Nombre de places"><input type="number" min={0} value={form.total_seats ?? ''} onChange={e => setForm({ ...form, total_seats: e.target.value ? Number(e.target.value) : null })} className={inputCls} /></Field>
        <Field label="Date mise en circulation"><input type="date" value={form.circulation_date ?? ''} onChange={e => setForm({ ...form, circulation_date: e.target.value || null })} className={inputCls} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Numéro châssis"><input value={form.chassis_number ?? ''} onChange={e => setForm({ ...form, chassis_number: e.target.value || null })} className={inputCls} /></Field>
        <Field label="Numéro carte grise"><input value={form.carte_grise_number ?? ''} onChange={e => setForm({ ...form, carte_grise_number: e.target.value || null })} className={inputCls} /></Field>
      </div>
      <Field label="Statut plaque">
        <select value={form.plate_status} onChange={e => setForm({ ...form, plate_status: e.target.value as PlateStatus })} className={inputCls}>
          {Object.entries(PLATE_STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </Field>
      <Field label="Observation"><textarea rows={2} value={form.observation ?? ''} onChange={e => setForm({ ...form, observation: e.target.value || null })} className={inputCls} /></Field>
    </ModalShell>
  )
}

function FileUpload({ url, onUrl }: { url: string | null; onUrl: (u: string) => void }) {
  const [uploading, setUploading] = useState(false)
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setUploading(true)
    try { onUrl(await uploadLogisticsDocument(file)); toast.success('Document téléchargé') }
    catch (err) { console.error(err); toast.error('Échec du téléchargement') }
    finally { setUploading(false) }
  }
  return (
    <div className="flex items-center gap-3">
      <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[#E2EAE5] text-sm text-[#4A6B55] cursor-pointer hover:bg-[#F8FAF8]">
        <Upload className="w-4 h-4" /> {uploading ? 'Envoi...' : 'Choisir un fichier'}
        <input type="file" accept="image/jpeg,image/png,image/jpg,application/pdf" onChange={onFile} className="hidden" />
      </label>
      {url && <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-[#0B7439] hover:underline"><FileText className="w-4 h-4" /> Voir</a>}
    </div>
  )
}

function ProvisionalModal({ vehicleId, onClose, onSaved }: { vehicleId: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<ProvisionalPlateInput>({ plate_number: '', recepisse_date: null, recepisse_expiry: null, recepisse_url: null, observation: null })
  const [saving, setSaving] = useState(false)
  const save = async () => {
    if (!form.plate_number.trim()) { toast.error('Numéro de plaque requis'); return }
    setSaving(true)
    try { await addProvisionalPlate(vehicleId, form); toast.success('Plaque provisoire enregistrée'); onSaved() }
    catch (err) { console.error(err); toast.error('Erreur lors de l\'enregistrement') }
    finally { setSaving(false) }
  }
  return (
    <ModalShell title="Nouvelle plaque provisoire (WWW)" onClose={onClose} onSave={save} saving={saving}>
      <Field label="Numéro provisoire WWW *"><input value={form.plate_number} onChange={e => setForm({ ...form, plate_number: e.target.value })} className={inputCls} /></Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Date récépissé provisoire"><input type="date" value={form.recepisse_date ?? ''} onChange={e => setForm({ ...form, recepisse_date: e.target.value || null })} className={inputCls} /></Field>
        <Field label="Date expiration récépissé"><input type="date" value={form.recepisse_expiry ?? ''} onChange={e => setForm({ ...form, recepisse_expiry: e.target.value || null })} className={inputCls} /></Field>
      </div>
      <Field label="Document récépissé"><FileUpload url={form.recepisse_url} onUrl={u => setForm({ ...form, recepisse_url: u })} /></Field>
      <Field label="Observation"><textarea rows={2} value={form.observation ?? ''} onChange={e => setForm({ ...form, observation: e.target.value || null })} className={inputCls} /></Field>
    </ModalShell>
  )
}

function DefinitiveModal({ vehicleId, activePlateId, onClose, onSaved }: { vehicleId: string; activePlateId: string | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<DefinitivePlateInput>({ plate_number: '', carte_grise_number: null, carte_grise_issue_date: null, carte_grise_received_date: null, carte_grise_url: null, observation: null })
  const [saving, setSaving] = useState(false)
  const save = async () => {
    if (!form.plate_number.trim()) { toast.error('Nouvelle plaque requise'); return }
    setSaving(true)
    try { await replaceWithDefinitivePlate(vehicleId, activePlateId, form); toast.success('Plaque définitive enregistrée'); onSaved() }
    catch (err) { console.error(err); toast.error('Erreur lors de l\'enregistrement') }
    finally { setSaving(false) }
  }
  return (
    <ModalShell title="Remplacement par plaque définitive" onClose={onClose} onSave={save} saving={saving} saveLabel="Remplacer">
      <div className="text-xs px-3 py-2 rounded-lg bg-[#DBEAFE] text-[#1D4ED8]">L'ancienne plaque provisoire sera conservée dans l'historique.</div>
      <Field label="Nouvelle plaque *"><input value={form.plate_number} onChange={e => setForm({ ...form, plate_number: e.target.value })} className={inputCls} /></Field>
      <Field label="Numéro carte grise"><input value={form.carte_grise_number ?? ''} onChange={e => setForm({ ...form, carte_grise_number: e.target.value || null })} className={inputCls} /></Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Date établissement carte grise"><input type="date" value={form.carte_grise_issue_date ?? ''} onChange={e => setForm({ ...form, carte_grise_issue_date: e.target.value || null })} className={inputCls} /></Field>
        <Field label="Date réception"><input type="date" value={form.carte_grise_received_date ?? ''} onChange={e => setForm({ ...form, carte_grise_received_date: e.target.value || null })} className={inputCls} /></Field>
      </div>
      <Field label="Document carte grise"><FileUpload url={form.carte_grise_url} onUrl={u => setForm({ ...form, carte_grise_url: u })} /></Field>
      <Field label="Observation"><textarea rows={2} value={form.observation ?? ''} onChange={e => setForm({ ...form, observation: e.target.value || null })} className={inputCls} /></Field>
    </ModalShell>
  )
}
