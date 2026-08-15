import { useEffect, useState } from 'react'
import { X, Pencil, Info } from 'lucide-react'
import toast from 'react-hot-toast'
import ListPage from '@/components/garage/ListPage'
import { fetchPieces, createPiece, updatePiece, deletePiece, fetchFamilles, fetchSousFamilles } from '@/services/garageSbta.service'
import type { GaragePiece, GarageFamille, GarageSousFamille } from '@/types/garage.types'
import { formatFCFA } from '@/components/garage/reportHelpers'

export default function GaragePieces() {
  const [pieces, setPieces] = useState<GaragePiece[]>([])
  const [familles, setFamilles] = useState<GarageFamille[]>([])
  const [sousFamilles, setSousFamilles] = useState<GarageSousFamille[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<GaragePiece | null>(null)
  const [detail, setDetail] = useState<GaragePiece | null>(null)

  const [form, setForm] = useState({
    reference: '', nom: '', modele_serie: '', marque: '',
    seuil_alerte: 5, famille_id: '' as string, sous_famille_id: '' as string,
    prix_unitaire: 0,
  })

  const load = () => {
    setLoading(true)
    Promise.all([fetchPieces(), fetchFamilles(), fetchSousFamilles()])
      .then(([p, f, sf]) => { setPieces(p); setFamilles(f); setSousFamilles(sf) })
      .catch(() => toast.error('Erreur de chargement'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const openCreate = () => {
    setEditing(null)
    setForm({ reference: '', nom: '', modele_serie: '', marque: '', seuil_alerte: 5, famille_id: '', sous_famille_id: '', prix_unitaire: 0 })
    setShowModal(true)
  }
  const openEdit = (p: GaragePiece) => {
    setEditing(p)
    setForm({
      reference: p.reference, nom: p.nom, modele_serie: p.modele_serie, marque: p.marque,
      seuil_alerte: p.seuil_alerte, famille_id: p.famille_id ?? '', sous_famille_id: p.sous_famille_id ?? '',
      prix_unitaire: Number(p.prix_unitaire),
    })
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!form.reference.trim() || !form.nom.trim()) { toast.error('Référence et nom sont requis'); return }
    try {
      const payload = {
        reference: form.reference, nom: form.nom, modele_serie: form.modele_serie,
        marque: form.marque, seuil_alerte: form.seuil_alerte,
        famille_id: form.famille_id || null, sous_famille_id: form.sous_famille_id || null,
        prix_unitaire: form.prix_unitaire,
      }
      if (editing) { await updatePiece(editing.id, payload); toast.success('Pièce mise à jour') }
      else { await createPiece(payload); toast.success('Pièce créée') }
      setShowModal(false); load()
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erreur')
    }
  }

  const handleDelete = async (p: GaragePiece) => {
    if (!confirm(`Supprimer la pièce "${p.nom}" ?`)) return
    try { await deletePiece(p.id); toast.success('Pièce supprimée'); load() }
    catch (err: unknown) { toast.error((err as Error).message || 'Erreur') }
  }

  const filteredSousFamilles = form.famille_id
    ? sousFamilles.filter(sf => sf.famille_id === form.famille_id)
    : sousFamilles

  return (
    <>
      <ListPage
        title="Gestion des pièces"
        subtitle={`${pieces.length} pièce(s) au catalogue`}
        data={pieces}
        loading={loading}
        searchFields={['reference', 'nom', 'marque', 'modele_serie', 'famille.nom']}
        onCreate={openCreate}
        createLabel="Créer une pièce"
        columns={[
          { key: 'reference', label: 'Référence', render: (p: GaragePiece) => <span className="font-mono font-medium text-[#0B7439]">{p.reference}</span> },
          { key: 'nom', label: 'Nom', render: (p: GaragePiece) => <span className="font-medium text-[#1A2E22]">{p.nom}</span> },
          { key: 'marque', label: 'Marque' },
          { key: 'modele_serie', label: 'Modèle/Série' },
          { key: 'famille', label: 'Famille', render: (p: GaragePiece) => p.famille?.nom ?? '—' },
          { key: 'sous_famille', label: 'Sous-famille', render: (p: GaragePiece) => p.sous_famille?.nom ?? '—' },
          { key: 'prix_unitaire', label: 'Prix unitaire', className: 'text-right', render: (p: GaragePiece) => <span className="font-semibold text-[#1A2E22]">{formatFCFA(p.prix_unitaire)}</span> },
          { key: 'seuil_alerte', label: 'Seuil', className: 'text-right' },
        ]}
        rowActions={(p: GaragePiece) => (
          <div className="flex items-center justify-center gap-1">
            <button onClick={() => setDetail(p)} className="p-1.5 rounded-lg hover:bg-[#E3F0F9] text-[#1D6FA4]" title="Détail">
              <Info className="w-4 h-4" />
            </button>
            <button onClick={() => openEdit(p)} className="p-1.5 rounded-lg hover:bg-[#FEF3C7] text-[#D97706]" title="Modifier">
              <Pencil className="w-4 h-4" />
            </button>
            <button onClick={() => handleDelete(p)} className="p-1.5 rounded-lg hover:bg-[#FEF2F2] text-[#AF3029]" title="Supprimer">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      />

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-[#E2EAE5]">
              <h2 className="text-lg font-bold text-[#1A2E22]">{editing ? 'Modifier la pièce' : 'Nouvelle pièce'}</h2>
              <button onClick={() => setShowModal(false)} className="p-1 rounded-lg hover:bg-[#F4F7F5]"><X className="w-5 h-5 text-[#6B7280]" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#4A6B55] mb-1">Référence *</label>
                  <input value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })}
                    placeholder="ex: RF433"
                    className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/20" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#4A6B55] mb-1">Nom *</label>
                  <input value={form.nom} onChange={e => setForm({ ...form, nom: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/20" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#4A6B55] mb-1">Marque</label>
                  <input value={form.marque} onChange={e => setForm({ ...form, marque: e.target.value })}
                    placeholder="ex: GOLDEN DRAGON"
                    className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/20" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#4A6B55] mb-1">Modèle/Série</label>
                  <input value={form.modele_serie} onChange={e => setForm({ ...form, modele_serie: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/20" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#4A6B55] mb-1">Famille</label>
                  <select value={form.famille_id} onChange={e => setForm({ ...form, famille_id: e.target.value, sous_famille_id: '' })}
                    className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm">
                    <option value="">—</option>
                    {familles.map(f => <option key={f.id} value={f.id}>{f.nom}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#4A6B55] mb-1">Sous-famille</label>
                  <select value={form.sous_famille_id} onChange={e => setForm({ ...form, sous_famille_id: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm">
                    <option value="">—</option>
                    {filteredSousFamilles.map(sf => <option key={sf.id} value={sf.id}>{sf.nom}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#4A6B55] mb-1">Prix unitaire (FCFA)</label>
                  <input type="number" min={0} value={form.prix_unitaire} onChange={e => setForm({ ...form, prix_unitaire: Number(e.target.value) })}
                    className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/20" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#4A6B55] mb-1">Seuil d'alerte</label>
                  <input type="number" min={0} value={form.seuil_alerte} onChange={e => setForm({ ...form, seuil_alerte: Number(e.target.value) })}
                    className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/20" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 p-6 border-t border-[#E2EAE5]">
              <button onClick={() => setShowModal(false)} className="px-4 py-2.5 rounded-xl border border-[#E2EAE5] text-sm font-medium text-[#4A6B55] hover:bg-[#F8FAF8]">Annuler</button>
              <button onClick={handleSave} className="px-6 py-2.5 rounded-xl bg-[#0B7439] text-white text-sm font-medium hover:bg-[#095e2e]">{editing ? 'Mettre à jour' : 'Enregistrer'}</button>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-[#E2EAE5]">
              <h2 className="text-lg font-bold text-[#1A2E22]">Détail de la pièce</h2>
              <button onClick={() => setDetail(null)} className="p-1 rounded-lg hover:bg-[#F4F7F5]"><X className="w-5 h-5 text-[#6B7280]" /></button>
            </div>
            <div className="p-6 space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-[#6B7280]">Référence</span><span className="font-mono font-medium text-[#0B7439]">{detail.reference}</span></div>
              <div className="flex justify-between"><span className="text-[#6B7280]">Nom</span><span className="font-medium text-[#1A2E22]">{detail.nom}</span></div>
              <div className="flex justify-between"><span className="text-[#6B7280]">Marque</span><span className="text-[#1A2E22]">{detail.marque || '—'}</span></div>
              <div className="flex justify-between"><span className="text-[#6B7280]">Modèle/Série</span><span className="text-[#1A2E22]">{detail.modele_serie || '—'}</span></div>
              <div className="flex justify-between"><span className="text-[#6B7280]">Famille</span><span className="text-[#1A2E22]">{detail.famille?.nom ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-[#6B7280]">Sous-famille</span><span className="text-[#1A2E22]">{detail.sous_famille?.nom ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-[#6B7280]">Prix unitaire</span><span className="font-semibold text-[#1A2E22]">{formatFCFA(detail.prix_unitaire)}</span></div>
              <div className="flex justify-between"><span className="text-[#6B7280]">Seuil d'alerte</span><span className="text-[#1A2E22]">{detail.seuil_alerte}</span></div>
            </div>
            <div className="flex justify-end p-6 border-t border-[#E2EAE5]">
              <button onClick={() => setDetail(null)} className="px-6 py-2.5 rounded-xl bg-[#0B7439] text-white text-sm font-medium hover:bg-[#095e2e]">Fermer</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
