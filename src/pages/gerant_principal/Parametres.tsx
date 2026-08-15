import { useEffect, useState } from 'react'
import { X, Pencil, Plus, Truck, Wrench, Building2, Layers, GitBranch, FileText, CircleDot } from 'lucide-react'
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
import GarageReports from './Reports'

type Section = 'fournisseurs' | 'cars' | 'types_techniciens' | 'familles' | 'sous_familles' | 'rapports'

export default function GarageParametres() {
  const [section, setSection] = useState<Section>('fournisseurs')
  const [fournisseurs, setFournisseurs] = useState<GarageFournisseur[]>([])
  const [cars, setCars] = useState<GarageCar[]>([])
  const [typesTech, setTypesTech] = useState<GarageTypeTechnicien[]>([])
  const [familles, setFamilles] = useState<GarageFamille[]>([])
  const [sousFamilles, setSousFamilles] = useState<GarageSousFamille[]>([])
  const [groupes, setGroupes] = useState<GarageGroupe[]>([])
  const [settings, setSettings] = useState<GarageSetting[]>([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    Promise.all([fetchFournisseurs(), fetchCars(), fetchTypesTechniciens(), fetchFamilles(), fetchSousFamilles(), fetchGroupes(), fetchSettings()])
      .then(([f, c, t, fam, sf, g, s]) => { setFournisseurs(f); setCars(c); setTypesTech(t); setFamilles(fam); setSousFamilles(sf); setGroupes(g); setSettings(s) })
      .catch(() => toast.error('Erreur de chargement'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const sections: { key: Section; label: string; icon: typeof Truck }[] = [
    { key: 'fournisseurs', label: 'Fournisseurs', icon: Building2 },
    { key: 'cars', label: 'Cars', icon: Truck },
    { key: 'types_techniciens', label: 'Type de techniciens', icon: Wrench },
    { key: 'familles', label: 'Familles', icon: Layers },
    { key: 'sous_familles', label: 'Sous familles', icon: GitBranch },
    { key: 'rapports', label: 'Rapports', icon: FileText },
  ]

  // ── Modal state helpers ──
  const [modal, setModal] = useState<{ type: string; data: unknown } | null>(null)

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

      {section === 'fournisseurs' && <FournisseursSection data={fournisseurs} loading={loading} onReload={load} modal={modal} setModal={setModal} />}
      {section === 'cars' && <CarsSection data={cars} groupes={groupes} loading={loading} onReload={load} modal={modal} setModal={setModal} />}
      {section === 'types_techniciens' && <TypesTechSection data={typesTech} loading={loading} onReload={load} modal={modal} setModal={setModal} />}
      {section === 'familles' && <FamillesSection data={familles} loading={loading} onReload={load} modal={modal} setModal={setModal} />}
      {section === 'sous_familles' && <SousFamillesSection data={sousFamilles} familles={familles} loading={loading} onReload={load} modal={modal} setModal={setModal} />}
      {section === 'rapports' && <GarageReports groupes={groupes} settings={settings} onReload={load} />}
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
