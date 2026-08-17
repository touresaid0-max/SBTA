import { useEffect, useState, useCallback } from 'react'
import { X, Pencil, Info, Wrench, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import ListPage from '@/components/garage/ListPage'
import {
  fetchReparations, createReparation, updateReparation, deleteReparation,
  fetchTypesTechniciens, fetchTechniciens, fetchBusesForGarage,
} from '@/services/garageSbta.service'
import { supabase } from '@/services/supabase'
import type { GarageReparation, GarageTypeTechnicien, GarageBus, ReparationStatut } from '@/types/garage.types'
import { formatDate } from '@/components/garage/reportHelpers'

const STATUT_COLORS: Record<ReparationStatut, { bg: string; text: string; label: string }> = {
  BROUILLON:     { bg: 'bg-[#E5E7EB]', text: 'text-[#6B7280]', label: 'BROUILLON' },
  'EN RÉPARATION': { bg: 'bg-[#FEE2E2]', text: 'text-[#DC2626]', label: 'EN RÉPARATION' },
  LIBÉRÉ:        { bg: 'bg-[#E8F5EC]', text: 'text-[#0B7439]', label: 'LIBÉRÉ' },
}

export function ReparationStatusBadge({ statut }: { statut: ReparationStatut }) {
  const c = STATUT_COLORS[statut] ?? STATUT_COLORS.BROUILLON
  return <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${c.bg} ${c.text}`}>{c.label}</span>
}

interface FormState {
  bus_id: string
  date: string
  statut: ReparationStatut
  technicien_id: string
  type_technicien_id: string
  description: string
}

export default function GarageReparations() {
  const [reparations, setReparations] = useState<GarageReparation[]>([])
  const [buses, setBuses] = useState<GarageBus[]>([])
  const [typesTech, setTypesTech] = useState<GarageTypeTechnicien[]>([])
  const [techniciens, setTechniciens] = useState<{ id: string; full_name: string; type_technicien_id: string | null }[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<GarageReparation | null>(null)
  const [detail, setDetail] = useState<GarageReparation | null>(null)

  const [form, setForm] = useState<FormState>({
    bus_id: '', date: new Date().toISOString().slice(0, 10),
    statut: 'BROUILLON', technicien_id: '', type_technicien_id: '', description: '',
  })

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([fetchReparations(), fetchBusesForGarage(), fetchTypesTechniciens(), fetchTechniciens()])
      .then(([r, b, t, techs]) => { setReparations(r); setBuses(b); setTypesTech(t); setTechniciens(techs) })
      .catch(() => toast.error('Erreur de chargement'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  // Realtime: recharger quand une réparation change
  useEffect(() => {
    const channel = supabase
      .channel('garage-reparations-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'garage_reparations' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  const openCreate = () => {
    setEditing(null)
    setForm({ bus_id: '', date: new Date().toISOString().slice(0, 10), statut: 'BROUILLON', technicien_id: '', type_technicien_id: '', description: '' })
    setShowModal(true)
  }
  const openEdit = (r: GarageReparation) => {
    setEditing(r)
    setForm({
      bus_id: r.bus_id ?? r.car_id,
      date: r.date,
      statut: r.statut,
      technicien_id: r.technicien_id ?? '',
      type_technicien_id: r.type_technicien_id ?? '',
      description: r.description,
    })
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!form.bus_id) { toast.error('Sélectionnez un car'); return }
    try {
      const payload = {
        bus_id: form.bus_id,
        date: form.date,
        statut: form.statut,
        technicien_id: form.technicien_id || null,
        type_technicien_id: form.type_technicien_id || null,
        description: form.description,
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

  const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439]'

  return (
    <>
      <ListPage
        title="Gestion des réparations"
        subtitle={`${reparations.length} réparation(s) enregistrée(s)`}
        data={reparations}
        loading={loading}
        searchFields={['description', 'bus.registration_number', 'car.immatriculation', 'type_technicien.nom']}
        onCreate={openCreate}
        createLabel="Créer une réparation"
        columns={[
          { key: 'date', label: 'Date', render: (r: GarageReparation) => formatDate(r.date) },
          { key: 'bus', label: 'N° Car', render: (r: GarageReparation) => (
            <span className="font-mono font-medium text-[#0B7439]">
              {r.bus?.registration_number ?? r.car?.immatriculation ?? '—'}
            </span>
          )},
          { key: 'statut', label: 'Statut', render: (r: GarageReparation) => <ReparationStatusBadge statut={r.statut} /> },
          { key: 'technicien', label: 'Technicien', render: (r: GarageReparation) => {
            const tech = techniciens.find(t => t.id === r.technicien_id)
            return <span>{tech?.full_name || '—'}</span>
          }},
          { key: 'type_technicien', label: 'Type technicien', render: (r: GarageReparation) => r.type_technicien?.nom ?? '—' },
          { key: 'description', label: 'Description', render: (r: GarageReparation) => (
            <span className="text-[#4A6B55] line-clamp-1 max-w-xs">{r.description || '—'}</span>
          )},
        ]}
        rowActions={(r: GarageReparation) => (
          <div className="flex items-center justify-center gap-1">
            <button onClick={() => setDetail(r)} className="p-1.5 rounded-lg hover:bg-[#E3F0F9] text-[#1D6FA4]" title="Détail"><Info className="w-4 h-4" /></button>
            <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg hover:bg-[#FEF3C7] text-[#D97706]" title="Modifier"><Pencil className="w-4 h-4" /></button>
            <button onClick={() => handleDelete(r)} className="p-1.5 rounded-lg hover:bg-[#FEF2F2] text-[#AF3029]" title="Supprimer"><Trash2 className="w-4 h-4" /></button>
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
                  <select value={form.bus_id} onChange={e => setForm({ ...form, bus_id: e.target.value })} className={inputCls}>
                    <option value="">—</option>
                    {buses.map(b => <option key={b.id} value={b.id}>{b.immatriculation}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#4A6B55] mb-1">Date</label>
                  <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#4A6B55] mb-1">Statut</label>
                  <select value={form.statut} onChange={e => setForm({ ...form, statut: e.target.value as ReparationStatut })} className={inputCls}>
                    <option value="BROUILLON">BROUILLON</option>
                    <option value="EN RÉPARATION">EN RÉPARATION</option>
                    <option value="LIBÉRÉ">LIBÉRÉ</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#4A6B55] mb-1">Type de technicien</label>
                  <select value={form.type_technicien_id} onChange={e => setForm({ ...form, type_technicien_id: e.target.value })} className={inputCls}>
                    <option value="">—</option>
                    {typesTech.map(t => <option key={t.id} value={t.id}>{t.nom}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[#4A6B55] mb-1">Technicien</label>
                <select value={form.technicien_id} onChange={e => setForm({ ...form, technicien_id: e.target.value })} className={inputCls}>
                  <option value="">—</option>
                  {techniciens.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[#4A6B55] mb-1">Description</label>
                <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3} className={`${inputCls} resize-none`} />
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
              <div className="flex justify-between"><span className="text-[#6B7280]">Car</span><span className="font-mono font-medium text-[#0B7439]">{detail.bus?.registration_number ?? detail.car?.immatriculation ?? '—'}</span></div>
              <div className="flex justify-between items-center"><span className="text-[#6B7280]">Statut</span><ReparationStatusBadge statut={detail.statut} /></div>
              <div className="flex justify-between"><span className="text-[#6B7280]">Technicien</span><span className="text-[#1A2E22]">{techniciens.find(t => t.id === detail.technicien_id)?.full_name ?? '—'}</span></div>
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
