import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bus, Plus, Search, ArrowRight, X } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  fetchVehicles, createVehicle, fetchBuses, fetchCompanies, PLATE_STATUS_LABELS,
} from '@/services/logistics.service'
import type {
  Vehicle, VehicleInput, PlateStatus,
} from '@/types/logistics.types'
import type { LogisticsBus, LogisticsCompany } from '@/services/logistics.service'

const PLATE_STYLE: Record<PlateStatus, { bg: string; text: string }> = {
  provisoire:             { bg: '#FEF3C7', text: '#B45309' },
  attente_carte_grise:    { bg: '#FEF3C7', text: '#B45309' },
  definitive:             { bg: '#E7F6EC', text: '#0B7439' },
  carte_grise_disponible: { bg: '#DBEAFE', text: '#1D4ED8' },
}

const EMPTY: VehicleInput = {
  bus_id: null, company_id: null, registration_number: null, provisional_number: null,
  brand: null, model: null, total_seats: null, circulation_date: null,
  chassis_number: null, carte_grise_number: null, plate_status: 'provisoire', observation: null,
}

export default function VehiclesList() {
  const navigate = useNavigate()
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [buses, setBuses] = useState<LogisticsBus[]>([])
  const [companies, setCompanies] = useState<LogisticsCompany[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<VehicleInput>(EMPTY)
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    Promise.all([fetchVehicles(), fetchBuses(), fetchCompanies()])
      .then(([v, b, c]) => { setVehicles(v); setBuses(b); setCompanies(c) })
      .catch((err) => { console.error(err); toast.error('Erreur lors du chargement') })
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const onPickBus = (busId: string) => {
    const b = buses.find(x => x.id === busId)
    if (!b) { setForm(f => ({ ...f, bus_id: null })); return }
    setForm(f => ({
      ...f,
      bus_id: b.id,
      company_id: b.company_id,
      registration_number: b.registration_number,
      brand: b.brand ?? b.manufacturer,
      model: b.model,
      total_seats: b.total_seats,
    }))
  }

  const save = async () => {
    setSaving(true)
    try {
      const v = await createVehicle(form)
      toast.success('Fiche véhicule créée')
      setModalOpen(false); setForm(EMPTY)
      navigate(`/logistique/vehicles/${v.id}`)
    } catch (err) { console.error(err); toast.error('Erreur lors de l\'enregistrement') }
    finally { setSaving(false) }
  }

  const filtered = vehicles.filter(v => {
    if (!search) return true
    const q = search.toLowerCase()
    return [v.registration_number, v.provisional_number, v.brand, v.model, v.chassis_number, v.company_name]
      .some(x => (x ?? '').toLowerCase().includes(q))
  })

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-[#E7F6EC] flex items-center justify-center">
            <Bus className="w-6 h-6 text-[#0B7439]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#1A2E22]">Parc véhicules</h1>
            <p className="text-sm text-[#6B7280]">Fiches bus & immatriculations</p>
          </div>
        </div>
        <button onClick={() => { setForm(EMPTY); setModalOpen(true) }} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0B7439] text-white text-sm font-medium hover:bg-[#095e2f] transition-colors">
          <Plus className="w-4 h-4" /> Nouvelle fiche
        </button>
      </div>

      <div className="relative max-w-sm">
        <Search className="w-4 h-4 text-[#9CA3AF] absolute left-3 top-1/2 -translate-y-1/2" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher..." className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#E2EAE5] text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/30" />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2EAE5] text-center py-16 text-[#6B7280]">Aucune fiche véhicule.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(v => {
            const ps = PLATE_STYLE[v.plate_status]
            return (
              <button key={v.id} onClick={() => navigate(`/logistique/vehicles/${v.id}`)} className="bg-white rounded-2xl border border-[#E2EAE5] p-5 text-left hover:shadow-md transition-shadow group">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono font-bold text-[#0B7439] text-lg truncate">{v.registration_number || v.provisional_number || 'Sans plaque'}</p>
                    <p className="text-sm text-[#4A6B55] truncate">{[v.brand, v.model].filter(Boolean).join(' ') || '—'}</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-[#9CA3AF] group-hover:text-[#0B7439] flex-shrink-0" />
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: ps.bg, color: ps.text }}>{PLATE_STATUS_LABELS[v.plate_status]}</span>
                  <span className="text-xs text-[#8AA898]">{v.company_name || '—'}</span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2EAE5]">
              <h2 className="font-semibold text-[#1A2E22]">Nouvelle fiche véhicule</h2>
              <button onClick={() => setModalOpen(false)} className="p-1.5 rounded-lg hover:bg-[#F3F4F6]"><X className="w-5 h-5 text-[#6B7280]" /></button>
            </div>
            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <Field label="Bus existant (optionnel)">
                <select value={form.bus_id ?? ''} onChange={e => onPickBus(e.target.value)} className={inputCls}>
                  <option value="">— Saisie manuelle —</option>
                  {buses.map(b => <option key={b.id} value={b.id}>{b.registration_number} · {[b.brand, b.model].filter(Boolean).join(' ')}</option>)}
                </select>
              </Field>
              <Field label="Société propriétaire">
                <select value={form.company_id ?? ''} onChange={e => setForm({ ...form, company_id: e.target.value || null })} className={inputCls}>
                  <option value="">— Aucune —</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
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
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-[#E2EAE5]">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 rounded-xl border border-[#E2EAE5] text-[#4A6B55] text-sm font-medium hover:bg-[#F8FAF8]">Annuler</button>
              <button onClick={save} disabled={saving} className="px-4 py-2 rounded-xl bg-[#0B7439] text-white text-sm font-medium hover:bg-[#095e2f] disabled:opacity-60">{saving ? 'Enregistrement...' : 'Créer la fiche'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const inputCls = 'w-full px-3 py-2 rounded-lg border border-[#E2EAE5] text-sm text-[#1A2E22] focus:outline-none focus:ring-2 focus:ring-[#0B7439]/30 focus:border-[#0B7439]'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div><label className="block text-xs font-medium text-[#4A6B55] mb-1.5">{label}</label>{children}</div>)
}
