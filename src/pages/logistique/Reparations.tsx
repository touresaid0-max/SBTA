import { useEffect, useState, useCallback } from 'react'
import { Wrench, Bus, Clock, X, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/services/supabase'
import { fetchReparationsEnCours, updateReparation, fetchTypesTechniciens, fetchTechniciens } from '@/services/garageSbta.service'
import { ReparationStatusBadge } from '@/pages/gerant_principal/Reparations'
import type { GarageReparation, GarageTypeTechnicien, ReparationStatut } from '@/types/garage.types'
import { formatDate } from '@/components/garage/reportHelpers'

export default function LogistiqueReparations() {
  const [reparations, setReparations] = useState<GarageReparation[]>([])
  const [typesTech, setTypesTech] = useState<GarageTypeTechnicien[]>([])
  const [techniciens, setTechniciens] = useState<{ id: string; full_name: string; type_technicien_id: string | null }[]>([])
  const [loading, setLoading] = useState(true)
  const [editModal, setEditModal] = useState<GarageReparation | null>(null)
  const [form, setForm] = useState({
    statut: 'BROUILLON' as ReparationStatut,
    technicien_id: '',
    type_technicien_id: '',
    description: '',
  })

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([fetchReparationsEnCours(), fetchTypesTechniciens(), fetchTechniciens()])
      .then(([r, t, techs]) => { setReparations(r); setTypesTech(t); setTechniciens(techs) })
      .catch(() => toast.error('Erreur de chargement'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const channel = supabase
      .channel('logistique-reparations')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'garage_reparations' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  const openEdit = (r: GarageReparation) => {
    setEditModal(r)
    setForm({
      statut: r.statut,
      technicien_id: r.technicien_id ?? '',
      type_technicien_id: r.type_technicien_id ?? '',
      description: r.description,
    })
  }

  const handleSave = async () => {
    if (!editModal) return
    try {
      await updateReparation(editModal.id, {
        statut: form.statut,
        technicien_id: form.technicien_id || null,
        type_technicien_id: form.type_technicien_id || null,
        description: form.description,
      })
      toast.success('Réparation mise à jour')
      setEditModal(null)
      load()
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erreur')
    }
  }

  const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439]'

  const totalEnReparation = reparations.length

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1A2E22] flex items-center gap-2">
          <Wrench className="w-6 h-6 text-[#DC2626]" />
          Cars en réparation
        </h1>
        <p className="text-sm text-[#6B7280] mt-1">
          {loading ? 'Chargement...' : `${totalEnReparation} car${totalEnReparation > 1 ? 's' : ''} actuellement en réparation`}
        </p>
      </div>

      {/* Alert banner */}
      {totalEnReparation > 0 && (
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-[#FEE2E2] border border-[#DC2626]">
          <AlertCircle className="w-5 h-5 text-[#DC2626] flex-shrink-0" />
          <p className="text-sm font-medium text-[#991B1B]">
            {totalEnReparation} car{totalEnReparation > 1 ? 's' : ''} indisponible{totalEnReparation > 1 ? 's' : ''} — non sélectionnable{totalEnReparation > 1 ? 's' : ''} dans les sorties de pièces, commandes et pneus.
          </p>
        </div>
      )}

      {/* Cards grid */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : totalEnReparation === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-[#6B7280]">
          <Bus className="w-10 h-10 mb-2 opacity-30" />
          <p className="text-sm">Aucun car en réparation actuellement</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {reparations.map(r => (
            <div key={r.id} className="bg-white rounded-2xl border border-[#E2EAE5] p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-xl bg-[#FEE2E2] flex items-center justify-center">
                    <Bus className="w-5 h-5 text-[#DC2626]" />
                  </div>
                  <div>
                    <p className="font-mono font-bold text-[#1A2E22]">
                      {r.bus?.registration_number ?? r.car?.immatriculation ?? 'N/A'}
                    </p>
                    <p className="text-xs text-[#6B7280]">{formatDate(r.date)}</p>
                  </div>
                </div>
                <ReparationStatusBadge statut={r.statut} />
              </div>

              <div className="space-y-1.5 text-sm mb-4">
                <div className="flex justify-between">
                  <span className="text-[#6B7280]">Technicien</span>
                  <span className="text-[#1A2E22] font-medium">{r.technicien?.full_name ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#6B7280]">Type</span>
                  <span className="text-[#1A2E22] font-medium">{r.type_technicien?.nom ?? '—'}</span>
                </div>
              </div>

              {r.description && (
                <p className="text-xs text-[#4A6B55] line-clamp-2 mb-4">{r.description}</p>
              )}

              <button
                onClick={() => openEdit(r)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#DC2626] text-white text-sm font-semibold hover:bg-[#B91C1C] transition-colors"
              >
                <Wrench className="w-4 h-4" />
                Modifier / Libérer
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Edit modal */}
      {editModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg">
            <div className="flex items-center justify-between p-6 border-b border-[#E2EAE5]">
              <h2 className="text-lg font-bold text-[#1A2E22] flex items-center gap-2">
                <Wrench className="w-5 h-5 text-[#DC2626]" />
                {editModal.bus?.registration_number ?? editModal.car?.immatriculation ?? 'Car'}
              </h2>
              <button onClick={() => setEditModal(null)} className="p-1 rounded-lg hover:bg-[#F4F7F5]">
                <X className="w-5 h-5 text-[#6B7280]" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#4A6B55] mb-1">Statut</label>
                <select value={form.statut} onChange={e => setForm({ ...form, statut: e.target.value as ReparationStatut })} className={inputCls}>
                  <option value="BROUILLON">BROUILLON</option>
                  <option value="EN RÉPARATION">EN RÉPARATION</option>
                  <option value="LIBÉRÉ">LIBÉRÉ</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#4A6B55] mb-1">Type technicien</label>
                  <select value={form.type_technicien_id} onChange={e => setForm({ ...form, type_technicien_id: e.target.value })} className={inputCls}>
                    <option value="">—</option>
                    {typesTech.map(t => <option key={t.id} value={t.id}>{t.nom}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#4A6B55] mb-1">Technicien</label>
                  <select value={form.technicien_id} onChange={e => setForm({ ...form, technicien_id: e.target.value })} className={inputCls}>
                    <option value="">—</option>
                    {techniciens.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[#4A6B55] mb-1">Description</label>
                <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3} className={`${inputCls} resize-none`} />
              </div>
              {form.statut === 'LIBÉRÉ' && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-[#E8F5EC] border border-[#0B7439]">
                  <Clock className="w-4 h-4 text-[#0B7439]" />
                  <p className="text-xs text-[#0B7439] font-medium">Le car redeviendra disponible dans tous les sélecteurs.</p>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 p-6 border-t border-[#E2EAE5]">
              <button onClick={() => setEditModal(null)} className="px-4 py-2.5 rounded-xl border border-[#E2EAE5] text-sm font-medium text-[#4A6B55] hover:bg-[#F8FAF8]">Annuler</button>
              <button onClick={handleSave} className="px-6 py-2.5 rounded-xl bg-[#0B7439] text-white text-sm font-medium hover:bg-[#095e2e]">Mettre à jour</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
