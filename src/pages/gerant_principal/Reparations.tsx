import { useEffect, useState } from 'react'
import { X, Pencil, Info, Wrench } from 'lucide-react'
import toast from 'react-hot-toast'
import ListPage from '@/components/garage/ListPage'
import { fetchReparations, createReparation, updateReparation, deleteReparation, fetchCars, fetchTypesTechniciens } from '@/services/garageSbta.service'
import type { GarageReparation, GarageCar, GarageTypeTechnicien } from '@/types/garage.types'
import { formatDate } from '@/components/garage/reportHelpers'

export default function GarageReparations() {
  const [reparations, setReparations] = useState<GarageReparation[]>([])
  const [cars, setCars] = useState<GarageCar[]>([])
  const [typesTech, setTypesTech] = useState<GarageTypeTechnicien[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<GarageReparation | null>(null)
  const [detail, setDetail] = useState<GarageReparation | null>(null)

  const [form, setForm] = useState({
    car_id: '' as string, date: new Date().toISOString().slice(0, 10),
    statut: 'en cours' as 'en cours' | 'terminée',
    type_technicien_id: '' as string, description: '',
  })

  const load = () => {
    setLoading(true)
    Promise.all([fetchReparations(), fetchCars(), fetchTypesTechniciens()])
      .then(([r, c, t]) => { setReparations(r); setCars(c); setTypesTech(t) })
      .catch(() => toast.error('Erreur de chargement'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const openCreate = () => {
    setEditing(null)
    setForm({ car_id: '', date: new Date().toISOString().slice(0, 10), statut: 'en cours', type_technicien_id: '', description: '' })
    setShowModal(true)
  }
  const openEdit = (r: GarageReparation) => {
    setEditing(r)
    setForm({ car_id: r.car_id, date: r.date, statut: r.statut, type_technicien_id: r.type_technicien_id ?? '', description: r.description })
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!form.car_id) { toast.error('Sélectionnez un car'); return }
    try {
      const payload = {
        car_id: form.car_id, date: form.date, statut: form.statut,
        type_technicien_id: form.type_technicien_id || null, description: form.description,
      }
      if (editing) { await updateReparation(editing.id, payload); toast.success('Réparation mise à jour') }
      else { await createReparation(payload); toast.success('Réparation créée') }
      setShowModal(false); load()
    } catch (err: unknown) { toast.error((err as Error).message || 'Erreur') }
  }

  const handleDelete = async (r: GarageReparation) => {
    if (!confirm('Supprimer cette réparation ?')) return
    try { await deleteReparation(r.id); toast.success('Réparation supprimée'); load() }
    catch (err: unknown) { toast.error((err as Error).message || 'Erreur') }
  }

  return (
    <>
      <ListPage
        title="Gestion des réparations"
        subtitle={`${reparations.length} réparation(s) enregistrée(s)`}
        data={reparations}
        loading={loading}
        searchFields={['description', 'car.immatriculation', 'type_technicien.nom']}
        onCreate={openCreate}
        createLabel="Créer une réparation"
        columns={[
          { key: 'date', label: 'Date', render: (r: GarageReparation) => formatDate(r.date) },
          { key: 'car', label: 'N° Car', render: (r: GarageReparation) => <span className="font-mono font-medium text-[#0B7439]">{r.car?.immatriculation ?? '—'}</span> },
          { key: 'statut', label: 'Statut', render: (r: GarageReparation) => (
            <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${r.statut === 'en cours' ? 'bg-[#FEF3C7] text-[#D97706]' : 'bg-[#E8F5EC] text-[#0B7439]'}`}>
              {r.statut}
            </span>
          )},
          { key: 'type_technicien', label: 'Type technicien', render: (r: GarageReparation) => r.type_technicien?.nom ?? '—' },
          { key: 'description', label: 'Description' },
        ]}
        rowActions={(r: GarageReparation) => (
          <div className="flex items-center justify-center gap-1">
            <button onClick={() => setDetail(r)} className="p-1.5 rounded-lg hover:bg-[#E3F0F9] text-[#1D6FA4]" title="Détail"><Info className="w-4 h-4" /></button>
            <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg hover:bg-[#FEF3C7] text-[#D97706]" title="Modifier"><Pencil className="w-4 h-4" /></button>
            <button onClick={() => handleDelete(r)} className="p-1.5 rounded-lg hover:bg-[#FEF2F2] text-[#AF3029]" title="Supprimer"><X className="w-4 h-4" /></button>
          </div>
        )}
      />

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg">
            <div className="flex items-center justify-between p-6 border-b border-[#E2EAE5]">
              <h2 className="text-lg font-bold text-[#1A2E22] flex items-center gap-2"><Wrench className="w-5 h-5 text-[#0B7439]" />{editing ? 'Modifier la réparation' : 'Nouvelle réparation'}</h2>
              <button onClick={() => setShowModal(false)} className="p-1 rounded-lg hover:bg-[#F4F7F5]"><X className="w-5 h-5 text-[#6B7280]" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#4A6B55] mb-1">Car *</label>
                  <select value={form.car_id} onChange={e => setForm({ ...form, car_id: e.target.value })} className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm">
                    <option value="">—</option>
                    {cars.map(c => <option key={c.id} value={c.id}>{c.immatriculation}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#4A6B55] mb-1">Date</label>
                  <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#4A6B55] mb-1">Statut</label>
                  <select value={form.statut} onChange={e => setForm({ ...form, statut: e.target.value as 'en cours' | 'terminée' })} className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm">
                    <option value="en cours">En cours</option>
                    <option value="terminée">Terminée</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#4A6B55] mb-1">Type de technicien</label>
                  <select value={form.type_technicien_id} onChange={e => setForm({ ...form, type_technicien_id: e.target.value })} className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm">
                    <option value="">—</option>
                    {typesTech.map(t => <option key={t.id} value={t.id}>{t.nom}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[#4A6B55] mb-1">Description</label>
                <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3} className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm resize-none" />
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
              <h2 className="text-lg font-bold text-[#1A2E22]">Détail de la réparation</h2>
              <button onClick={() => setDetail(null)} className="p-1 rounded-lg hover:bg-[#F4F7F5]"><X className="w-5 h-5 text-[#6B7280]" /></button>
            </div>
            <div className="p-6 space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-[#6B7280]">Date</span><span className="text-[#1A2E22]">{formatDate(detail.date)}</span></div>
              <div className="flex justify-between"><span className="text-[#6B7280]">Car</span><span className="font-mono font-medium text-[#0B7439]">{detail.car?.immatriculation ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-[#6B7280]">Statut</span><span className={`px-2 py-0.5 rounded-lg text-xs font-semibold ${detail.statut === 'en cours' ? 'bg-[#FEF3C7] text-[#D97706]' : 'bg-[#E8F5EC] text-[#0B7439]'}`}>{detail.statut}</span></div>
              <div className="flex justify-between"><span className="text-[#6B7280]">Type technicien</span><span className="text-[#1A2E22]">{detail.type_technicien?.nom ?? '—'}</span></div>
              <div><span className="text-[#6B7280] block mb-1">Description</span><span className="text-[#1A2E22]">{detail.description || '—'}</span></div>
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
