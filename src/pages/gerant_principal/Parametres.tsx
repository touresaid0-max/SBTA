import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { X, Pencil, Plus, Truck, Wrench, Building2, Layers, GitBranch, FileText, CircleDot, UserCog } from 'lucide-react'
import toast from 'react-hot-toast'
import ListPage from '@/components/garage/ListPage'
import {
  fetchFournisseurs, createFournisseur, updateFournisseur, deleteFournisseur,
  fetchCars, createCar, updateCar, deleteCar,
  fetchTypesTechniciens, createTypeTechnicien, updateTypeTechnicien, deleteTypeTechnicien,
  fetchFamilles, createFamille, updateFamille, deleteFamille,
  fetchSousFamilles, createSousFamille, updateSousFamille, deleteSousFamille,
  fetchGroupes, fetchSettings, updateSetting,
} from '@/services/garageSbta.service'
import type { GarageFournisseur, GarageCar, GarageTypeTechnicien, GarageFamille, GarageSousFamille, GarageGroupe, GarageSetting } from '@/types/garage.types'
import { supabase } from '@/services/supabase'
import { createEmployeeByHR } from '@/services/employeeAccount.service'
import GarageReports from './Reports'

type Section = 'fournisseurs' | 'cars' | 'types_techniciens' | 'techniciens' | 'familles' | 'sous_familles' | 'rapports'

const VALID_SECTIONS: Section[] = ['fournisseurs', 'cars', 'types_techniciens', 'techniciens', 'familles', 'sous_familles', 'rapports']

export default function GarageParametres() {
  const [searchParams, setSearchParams] = useSearchParams()
  const sectionParam = searchParams.get('section') as Section | null
  const section: Section = sectionParam && VALID_SECTIONS.includes(sectionParam) ? sectionParam : 'fournisseurs'

  const setSection = useCallback((s: Section) => {
    setSearchParams({ section: s }, { replace: true })
  }, [setSearchParams])

  const [fournisseurs, setFournisseurs] = useState<GarageFournisseur[]>([])
  const [cars, setCars] = useState<GarageCar[]>([])
  const [typesTech, setTypesTech] = useState<GarageTypeTechnicien[]>([])
  const [familles, setFamilles] = useState<GarageFamille[]>([])
  const [sousFamilles, setSousFamilles] = useState<GarageSousFamille[]>([])
  const [groupes, setGroupes] = useState<GarageGroupe[]>([])
  const [settings, setSettings] = useState<GarageSetting[]>([])
  const [techniciens, setTechniciens] = useState<TechnicienRow[]>([])
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(false)

  const loadFournisseurs = useCallback(async () => {
    setLoading(true)
    try { setFournisseurs(await fetchFournisseurs()) } catch { toast.error('Erreur de chargement') }
    finally { setLoading(false) }
  }, [])

  const loadCars = useCallback(async () => {
    setLoading(true)
    try { const c = await fetchCars(); setCars(c); setGroupes(await fetchGroupes()) } catch { toast.error('Erreur de chargement') }
    finally { setLoading(false) }
  }, [])

  const loadTypesTech = useCallback(async () => {
    setLoading(true)
    try { setTypesTech(await fetchTypesTechniciens()) } catch { toast.error('Erreur de chargement') }
    finally { setLoading(false) }
  }, [])

  const loadFamilles = useCallback(async () => {
    setLoading(true)
    try { setFamilles(await fetchFamilles()) } catch { toast.error('Erreur de chargement') }
    finally { setLoading(false) }
  }, [])

  const loadSousFamilles = useCallback(async () => {
    setLoading(true)
    try { setSousFamilles(await fetchSousFamilles()); setFamilles(await fetchFamilles()) } catch { toast.error('Erreur de chargement') }
    finally { setLoading(false) }
  }, [])

  const loadRapports = useCallback(async () => {
    setLoading(true)
    try { setGroupes(await fetchGroupes()); setSettings(await fetchSettings()) } catch { toast.error('Erreur de chargement') }
    finally { setLoading(false) }
  }, [])

  const loadTechniciens = useCallback(async () => {
    setLoading(true)
    try {
      const [empRes, compRes] = await Promise.all([
        supabase.from('employees').select('id, first_name, last_name, phone, role, company_id, technician_type_id, account_status, companies(name)').eq('role', 'mecanicien').order('first_name'),
        supabase.from('companies').select('id, name').order('name'),
      ])
      if (empRes.error) throw empRes.error
      if (compRes.error) throw compRes.error
      setCompanies(compRes.data ?? [])
      const techRows: TechnicienRow[] = (empRes.data ?? []).map((e: any) => ({
        id: e.id,
        first_name: e.first_name,
        last_name: e.last_name,
        phone: e.phone ?? '',
        company_id: e.company_id ?? '',
        company_name: e.companies?.name ?? '—',
        technician_type_id: e.technician_type_id ?? '',
        account_status: e.account_status ?? 'pending',
      }))
      setTechniciens(techRows)
      const tt = await fetchTypesTechniciens()
      setTypesTech(tt)
    } catch { toast.error('Erreur de chargement des techniciens') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (section === 'fournisseurs') loadFournisseurs()
    else if (section === 'cars') loadCars()
    else if (section === 'types_techniciens') loadTypesTech()
    else if (section === 'techniciens') loadTechniciens()
    else if (section === 'familles') loadFamilles()
    else if (section === 'sous_familles') loadSousFamilles()
    else if (section === 'rapports') loadRapports()
  }, [section, loadFournisseurs, loadCars, loadTypesTech, loadTechniciens, loadFamilles, loadSousFamilles, loadRapports])

  const sections: { key: Section; label: string; icon: typeof Truck }[] = [
    { key: 'fournisseurs', label: 'Fournisseurs', icon: Building2 },
    { key: 'cars', label: 'Cars', icon: Truck },
    { key: 'types_techniciens', label: 'Type de techniciens', icon: Wrench },
    { key: 'techniciens', label: 'Techniciens', icon: UserCog },
    { key: 'familles', label: 'Familles', icon: Layers },
    { key: 'sous_familles', label: 'Sous familles', icon: GitBranch },
    { key: 'rapports', label: 'Rapports', icon: FileText },
  ]

  const [modal, setModal] = useState<{ type: string; data: unknown } | null>(null)

  const reload = useCallback(() => {
    if (section === 'fournisseurs') loadFournisseurs()
    else if (section === 'cars') loadCars()
    else if (section === 'types_techniciens') loadTypesTech()
    else if (section === 'techniciens') loadTechniciens()
    else if (section === 'familles') loadFamilles()
    else if (section === 'sous_familles') loadSousFamilles()
    else if (section === 'rapports') loadRapports()
  }, [section, loadFournisseurs, loadCars, loadTypesTech, loadTechniciens, loadFamilles, loadSousFamilles, loadRapports])

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1A2E22]">Paramètres</h1>
        <p className="text-sm text-[#6B7280] mt-1">Configuration du garage</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {sections.map(s => {
          const Icon = s.icon
          return (
            <button key={s.key} onClick={() => setSection(s.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${section === s.key ? 'bg-[#0B7439] text-white' : 'bg-white border border-[#E2EAE5] text-[#4A6B55] hover:bg-[#F8FAF8]'}`}>
              <Icon className="w-4 h-4" /> {s.label}
            </button>
          )
        })}
      </div>

      {section === 'fournisseurs' && <FournisseursSection data={fournisseurs} loading={loading} onReload={reload} modal={modal} setModal={setModal} />}
      {section === 'cars' && <CarsSection data={cars} groupes={groupes} loading={loading} onReload={reload} modal={modal} setModal={setModal} />}
      {section === 'types_techniciens' && <TypesTechSection data={typesTech} loading={loading} onReload={reload} modal={modal} setModal={setModal} />}
      {section === 'techniciens' && <TechniciensSection data={techniciens} typesTech={typesTech} companies={companies} loading={loading} onReload={reload} modal={modal} setModal={setModal} />}
      {section === 'familles' && <FamillesSection data={familles} loading={loading} onReload={reload} modal={modal} setModal={setModal} />}
      {section === 'sous_familles' && <SousFamillesSection data={sousFamilles} familles={familles} loading={loading} onReload={reload} modal={modal} setModal={setModal} />}
      {section === 'rapports' && <GarageReports groupes={groupes} settings={settings} onReload={reload} />}
    </div>
  )
}

// ── Fournisseurs ─────────────────────────────────────────────
function FournisseursSection({ data, loading, onReload, modal, setModal }: {
  data: GarageFournisseur[]; loading: boolean; onReload: () => void;
  modal: { type: string; data: unknown } | null; setModal: (m: { type: string; data: unknown } | null) => void;
}) {
  const [form, setForm] = useState({ nom: '', telephone: '', adresse: '', email: '' })

  const openCreate = () => { setForm({ nom: '', telephone: '', adresse: '', email: '' }); setModal({ type: 'fournisseur', data: null }) }
  const openEdit = (f: GarageFournisseur) => { setForm({ nom: f.nom, telephone: f.telephone, adresse: f.adresse, email: f.email }); setModal({ type: 'fournisseur', data: f }) }

  const handleSave = async () => {
    if (!form.nom.trim()) { toast.error('Nom requis'); return }
    try {
      const d = modal?.data as GarageFournisseur | null
      if (d) { await updateFournisseur(d.id, form); toast.success('Fournisseur mis à jour') }
      else { await createFournisseur(form); toast.success('Fournisseur créé') }
      setModal(null); onReload()
    } catch (err: unknown) { toast.error((err as Error).message || 'Erreur') }
  }

  return (
    <>
      <ListPage title="" data={data} loading={loading} searchFields={['nom', 'telephone', 'email']}
        onCreate={openCreate} createLabel="Créer un fournisseur"
        columns={[
          { key: 'nom', label: 'Nom', render: (f: GarageFournisseur) => <span className="font-medium text-[#1A2E22]">{f.nom}</span> },
          { key: 'telephone', label: 'Téléphone' },
          { key: 'adresse', label: 'Adresse' },
          { key: 'email', label: 'Email' },
        ]}
        rowActions={(f: GarageFournisseur) => (
          <div className="flex items-center justify-center gap-1">
            <button onClick={() => openEdit(f)} className="p-1.5 rounded-lg hover:bg-[#FEF3C7] text-[#D97706]"><Pencil className="w-4 h-4" /></button>
            <button onClick={async () => { if (confirm('Supprimer ?')) { await deleteFournisseur(f.id); toast.success('Supprimé'); onReload() } }} className="p-1.5 rounded-lg hover:bg-[#FEF2F2] text-[#AF3029]"><X className="w-4 h-4" /></button>
          </div>
        )}
      />
      {modal?.type === 'fournisseur' && (
        <Modal title={modal.data ? 'Modifier le fournisseur' : 'Nouveau fournisseur'} onClose={() => setModal(null)} onSave={handleSave}>
          <input value={form.nom} onChange={e => setForm({ ...form, nom: e.target.value })} placeholder="Nom *" className="modal-input" />
          <input value={form.telephone} onChange={e => setForm({ ...form, telephone: e.target.value })} placeholder="Téléphone" className="modal-input" />
          <input value={form.adresse} onChange={e => setForm({ ...form, adresse: e.target.value })} placeholder="Adresse" className="modal-input" />
          <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="Email" className="modal-input" />
        </Modal>
      )}
    </>
  )
}

// ── Cars ─────────────────────────────────────────────────────
function CarsSection({ data, groupes, loading, onReload, modal, setModal }: {
  data: GarageCar[]; groupes: GarageGroupe[]; loading: boolean; onReload: () => void;
  modal: { type: string; data: unknown } | null; setModal: (m: { type: string; data: unknown } | null) => void;
}) {
  const [form, setForm] = useState({ immatriculation: '', groupe_id: '' })

  const openCreate = () => { setForm({ immatriculation: '', groupe_id: '' }); setModal({ type: 'car', data: null }) }
  const openEdit = (c: GarageCar) => { setForm({ immatriculation: c.immatriculation, groupe_id: c.groupe_id ?? '' }); setModal({ type: 'car', data: c }) }

  const handleSave = async () => {
    if (!form.immatriculation.trim()) { toast.error('Immatriculation requise'); return }
    try {
      const d = modal?.data as GarageCar | null
      if (d) { await updateCar(d.id, form.immatriculation, form.groupe_id || null); toast.success('Car mis à jour') }
      else { await createCar(form.immatriculation, form.groupe_id || null); toast.success('Car créé') }
      setModal(null); onReload()
    } catch (err: unknown) { toast.error((err as Error).message || 'Erreur') }
  }

  return (
    <>
      <ListPage title="" data={data} loading={loading} searchFields={['immatriculation', 'groupe.nom']}
        onCreate={openCreate} createLabel="Créer un car"
        columns={[
          { key: 'immatriculation', label: 'Immatriculation', render: (c: GarageCar) => <span className="font-mono font-medium text-[#0B7439]">{c.immatriculation}</span> },
          { key: 'groupe.nom', label: 'Groupe', render: (c: GarageCar) => c.groupe?.nom ?? '—' },
        ]}
        rowActions={(c: GarageCar) => (
          <div className="flex items-center justify-center gap-1">
            <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg hover:bg-[#FEF3C7] text-[#D97706]"><Pencil className="w-4 h-4" /></button>
            <button onClick={async () => { if (confirm('Supprimer ?')) { await deleteCar(c.id); toast.success('Supprimé'); onReload() } }} className="p-1.5 rounded-lg hover:bg-[#FEF2F2] text-[#AF3029]"><X className="w-4 h-4" /></button>
          </div>
        )}
      />
      {modal?.type === 'car' && (
        <Modal title={modal.data ? 'Modifier le car' : 'Nouveau car'} onClose={() => setModal(null)} onSave={handleSave}>
          <input value={form.immatriculation} onChange={e => setForm({ ...form, immatriculation: e.target.value })} placeholder="Immatriculation * (ex: AA-690-CL)" className="modal-input" />
          <select value={form.groupe_id} onChange={e => setForm({ ...form, groupe_id: e.target.value })} className="modal-input">
            <option value="">— Groupe —</option>
            {groupes.map(g => <option key={g.id} value={g.id}>{g.nom}</option>)}
          </select>
        </Modal>
      )}
    </>
  )
}

// ── Types techniciens ────────────────────────────────────────
function TypesTechSection({ data, loading, onReload, modal, setModal }: {
  data: GarageTypeTechnicien[]; loading: boolean; onReload: () => void;
  modal: { type: string; data: unknown } | null; setModal: (m: { type: string; data: unknown } | null) => void;
}) {
  const [nom, setNom] = useState('')

  const openCreate = () => { setNom(''); setModal({ type: 'type_tech', data: null }) }
  const openEdit = (t: GarageTypeTechnicien) => { setNom(t.nom); setModal({ type: 'type_tech', data: t }) }

  const handleSave = async () => {
    if (!nom.trim()) { toast.error('Nom requis'); return }
    try {
      const d = modal?.data as GarageTypeTechnicien | null
      if (d) { await updateTypeTechnicien(d.id, nom); toast.success('Mis à jour') }
      else { await createTypeTechnicien(nom); toast.success('Créé') }
      setModal(null); onReload()
    } catch (err: unknown) { toast.error((err as Error).message || 'Erreur') }
  }

  return (
    <>
      <ListPage title="" data={data} loading={loading} searchFields={['nom']}
        onCreate={openCreate} createLabel="Créer un type"
        columns={[{ key: 'nom', label: 'Nom', render: (t: GarageTypeTechnicien) => <span className="font-medium text-[#1A2E22]">{t.nom}</span> }]}
        rowActions={(t: GarageTypeTechnicien) => (
          <div className="flex items-center justify-center gap-1">
            <button onClick={() => openEdit(t)} className="p-1.5 rounded-lg hover:bg-[#FEF3C7] text-[#D97706]"><Pencil className="w-4 h-4" /></button>
            <button onClick={async () => { if (confirm('Supprimer ?')) { await deleteTypeTechnicien(t.id); toast.success('Supprimé'); onReload() } }} className="p-1.5 rounded-lg hover:bg-[#FEF2F2] text-[#AF3029]"><X className="w-4 h-4" /></button>
          </div>
        )}
      />
      {modal?.type === 'type_tech' && (
        <Modal title={modal.data ? 'Modifier' : 'Nouveau type de technicien'} onClose={() => setModal(null)} onSave={handleSave}>
          <input value={nom} onChange={e => setNom(e.target.value)} placeholder="Nom *" className="modal-input" />
        </Modal>
      )}
    </>
  )
}

// ── Familles ─────────────────────────────────────────────────
function FamillesSection({ data, loading, onReload, modal, setModal }: {
  data: GarageFamille[]; loading: boolean; onReload: () => void;
  modal: { type: string; data: unknown } | null; setModal: (m: { type: string; data: unknown } | null) => void;
}) {
  const [nom, setNom] = useState('')

  const openCreate = () => { setNom(''); setModal({ type: 'famille', data: null }) }
  const openEdit = (f: GarageFamille) => { setNom(f.nom); setModal({ type: 'famille', data: f }) }

  const handleSave = async () => {
    if (!nom.trim()) { toast.error('Nom requis'); return }
    try {
      const d = modal?.data as GarageFamille | null
      if (d) { await updateFamille(d.id, nom); toast.success('Mis à jour') }
      else { await createFamille(nom); toast.success('Créé') }
      setModal(null); onReload()
    } catch (err: unknown) { toast.error((err as Error).message || 'Erreur') }
  }

  return (
    <>
      <ListPage title="" data={data} loading={loading} searchFields={['nom']}
        onCreate={openCreate} createLabel="Créer une famille"
        columns={[{ key: 'nom', label: 'Nom', render: (f: GarageFamille) => <span className="font-medium text-[#1A2E22]">{f.nom}</span> }]}
        rowActions={(f: GarageFamille) => (
          <div className="flex items-center justify-center gap-1">
            <button onClick={() => openEdit(f)} className="p-1.5 rounded-lg hover:bg-[#FEF3C7] text-[#D97706]"><Pencil className="w-4 h-4" /></button>
            <button onClick={async () => { if (confirm('Supprimer ?')) { await deleteFamille(f.id); toast.success('Supprimé'); onReload() } }} className="p-1.5 rounded-lg hover:bg-[#FEF2F2] text-[#AF3029]"><X className="w-4 h-4" /></button>
          </div>
        )}
      />
      {modal?.type === 'famille' && (
        <Modal title={modal.data ? 'Modifier' : 'Nouvelle famille'} onClose={() => setModal(null)} onSave={handleSave}>
          <input value={nom} onChange={e => setNom(e.target.value)} placeholder="Nom *" className="modal-input" />
        </Modal>
      )}
    </>
  )
}

// ── Sous-familles ────────────────────────────────────────────
function SousFamillesSection({ data, familles, loading, onReload, modal, setModal }: {
  data: GarageSousFamille[]; familles: GarageFamille[]; loading: boolean; onReload: () => void;
  modal: { type: string; data: unknown } | null; setModal: (m: { type: string; data: unknown } | null) => void;
}) {
  const [form, setForm] = useState({ nom: '', famille_id: '' })

  const openCreate = () => { setForm({ nom: '', famille_id: '' }); setModal({ type: 'sous_famille', data: null }) }
  const openEdit = (sf: GarageSousFamille) => { setForm({ nom: sf.nom, famille_id: sf.famille_id }); setModal({ type: 'sous_famille', data: sf }) }

  const handleSave = async () => {
    if (!form.nom.trim() || !form.famille_id) { toast.error('Nom et famille requis'); return }
    try {
      const d = modal?.data as GarageSousFamille | null
      if (d) { await updateSousFamille(d.id, form.nom, form.famille_id); toast.success('Mis à jour') }
      else { await createSousFamille(form.nom, form.famille_id); toast.success('Créé') }
      setModal(null); onReload()
    } catch (err: unknown) { toast.error((err as Error).message || 'Erreur') }
  }

  return (
    <>
      <ListPage title="" data={data} loading={loading} searchFields={['nom', 'famille.nom']}
        onCreate={openCreate} createLabel="Créer une sous-famille"
        columns={[
          { key: 'nom', label: 'Nom', render: (sf: GarageSousFamille) => <span className="font-medium text-[#1A2E22]">{sf.nom}</span> },
          { key: 'famille.nom', label: 'Famille', render: (sf: GarageSousFamille) => sf.famille?.nom ?? '—' },
        ]}
        rowActions={(sf: GarageSousFamille) => (
          <div className="flex items-center justify-center gap-1">
            <button onClick={() => openEdit(sf)} className="p-1.5 rounded-lg hover:bg-[#FEF3C7] text-[#D97706]"><Pencil className="w-4 h-4" /></button>
            <button onClick={async () => { if (confirm('Supprimer ?')) { await deleteSousFamille(sf.id); toast.success('Supprimé'); onReload() } }} className="p-1.5 rounded-lg hover:bg-[#FEF2F2] text-[#AF3029]"><X className="w-4 h-4" /></button>
          </div>
        )}
      />
      {modal?.type === 'sous_famille' && (
        <Modal title={modal.data ? 'Modifier' : 'Nouvelle sous-famille'} onClose={() => setModal(null)} onSave={handleSave}>
          <input value={form.nom} onChange={e => setForm({ ...form, nom: e.target.value })} placeholder="Nom *" className="modal-input" />
          <select value={form.famille_id} onChange={e => setForm({ ...form, famille_id: e.target.value })} className="modal-input">
            <option value="">— Famille —</option>
            {familles.map(f => <option key={f.id} value={f.id}>{f.nom}</option>)}
          </select>
        </Modal>
      )}
    </>
  )
}

// ── Techniciens ──────────────────────────────────────────────
interface TechnicienRow {
  id: string
  first_name: string
  last_name: string
  phone: string
  company_id: string
  company_name: string
  technician_type_id: string
  account_status: string
}

function TechniciensSection({ data, typesTech, companies, loading, onReload, modal, setModal }: {
  data: TechnicienRow[]; typesTech: GarageTypeTechnicien[]; companies: { id: string; name: string }[];
  loading: boolean; onReload: () => void;
  modal: { type: string; data: unknown } | null; setModal: (m: { type: string; data: unknown } | null) => void;
}) {
  const [form, setForm] = useState({ first_name: '', last_name: '', phone: '', company_id: '', technician_type_id: '' })
  const [saving, setSaving] = useState(false)

  const openCreate = () => { setForm({ first_name: '', last_name: '', phone: '', company_id: '', technician_type_id: '' }); setModal({ type: 'technicien', data: null }) }

  const handleSave = async () => {
    if (!form.first_name.trim()) { toast.error('Prénom requis'); return }
    if (!form.last_name.trim()) { toast.error('Nom requis'); return }
    setSaving(true)
    try {
      await createEmployeeByHR({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        phone: form.phone.trim() || undefined,
        role: 'mecanicien',
        company_id: form.company_id || undefined,
        hire_date: new Date().toISOString().slice(0, 10),
        contract_type: 'contractuel',
        technician_type_id: form.technician_type_id || undefined,
      } as any)
      toast.success('Technicien créé — visible dans Admin et RH')
      setModal(null); onReload()
    } catch (err: unknown) { toast.error((err as Error).message || 'Erreur') }
    finally { setSaving(false) }
  }

  const statusLabel: Record<string, { label: string; color: string }> = {
    pending: { label: 'En attente', color: 'text-[#D97706] bg-[#FEF3C7]' },
    active: { label: 'Actif', color: 'text-[#0B7439] bg-[#E8F5EC]' },
    suspended: { label: 'Suspendu', color: 'text-[#DC2626] bg-[#FEE2E2]' },
  }

  return (
    <>
      <ListPage title="" data={data} loading={loading} searchFields={['first_name', 'last_name', 'phone', 'company_name']}
        onCreate={openCreate} createLabel="Créer un technicien"
        columns={[
          { key: 'name', label: 'Nom', render: (t: TechnicienRow) => <span className="font-medium text-[#1A2E22]">{t.first_name} {t.last_name}</span> },
          { key: 'phone', label: 'Téléphone', render: (t: TechnicienRow) => t.phone || '—' },
          { key: 'company_name', label: 'Société', render: (t: TechnicienRow) => t.company_name },
          { key: 'type', label: 'Type technicien', render: (t: TechnicienRow) => {
            const type = typesTech.find(tt => tt.id === t.technician_type_id)
            return type ? type.nom : '—'
          }},
          { key: 'account_status', label: 'Statut compte', render: (t: TechnicienRow) => {
            const s = statusLabel[t.account_status] ?? statusLabel.pending
            return <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${s.color}`}>{s.label}</span>
          }},
        ]}
      />
      {modal?.type === 'technicien' && (
        <Modal title="Nouveau technicien" onClose={() => setModal(null)} onSave={handleSave}>
          <input value={form.first_name} onChange={e => setForm({ ...form, first_name: e.target.value })} placeholder="Prénom *" className="modal-input" />
          <input value={form.last_name} onChange={e => setForm({ ...form, last_name: e.target.value })} placeholder="Nom *" className="modal-input" />
          <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Téléphone" className="modal-input" />
          <div>
            <label className="block text-xs font-medium text-[#6B7280] mb-1">Rôle</label>
            <div className="modal-input bg-[#F4F7F5] text-[#6B7280]">Technicien (mécanicien)</div>
          </div>
          <select value={form.company_id} onChange={e => setForm({ ...form, company_id: e.target.value })} className="modal-input">
            <option value="">— Société —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={form.technician_type_id} onChange={e => setForm({ ...form, technician_type_id: e.target.value })} className="modal-input">
            <option value="">— Type technicien —</option>
            {typesTech.map(t => <option key={t.id} value={t.id}>{t.nom}</option>)}
          </select>
        </Modal>
      )}
    </>
  )
}

// ── Reusable Modal ───────────────────────────────────────────
function Modal({ title, onClose, onSave, children }: { title: string; onClose: () => void; onSave: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-6 border-b border-[#E2EAE5]">
          <h2 className="text-lg font-bold text-[#1A2E22]">{title}</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[#F4F7F5]"><X className="w-5 h-5 text-[#6B7280]" /></button>
        </div>
        <div className="p-6 space-y-4">
          <style>{`.modal-input { width: 100%; padding: 0.625rem 0.75rem; border-radius: 0.75rem; border: 1px solid #E2EAE5; font-size: 0.875rem; outline: none; } .modal-input:focus { box-shadow: 0 0 0 2px rgba(11,116,57,0.2); }`}</style>
          {children}
        </div>
        <div className="flex justify-end gap-3 p-6 border-t border-[#E2EAE5]">
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-[#E2EAE5] text-sm font-medium text-[#4A6B55] hover:bg-[#F8FAF8]">Annuler</button>
          <button onClick={onSave} className="px-6 py-2.5 rounded-xl bg-[#0B7439] text-white text-sm font-medium hover:bg-[#095e2e]">Enregistrer</button>
        </div>
      </div>
    </div>
  )
}
