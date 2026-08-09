import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/services/supabase'
import { Settings, Plus, Trash2, Pencil, X, Check } from 'lucide-react'
import toast from 'react-hot-toast'

interface Societe {
  id: string
  code: string
  name: string
  sub_group: string | null
  is_active: boolean
}

interface Segment {
  id: string
  code: string
  label: string
  origin_city: string
  destination_city: string
  is_active: boolean
}

interface GuichetSrc {
  id: string
  station_id: string
  societe_id: string
  gare_label: string
  is_active: boolean
}

interface Station {
  id: string
  name: string
}

type Tab = 'societes' | 'segments' | 'guichets'

const TABS: { key: Tab; label: string }[] = [
  { key: 'societes', label: 'Sociétés' },
  { key: 'segments', label: 'Segments directionnels' },
  { key: 'guichets', label: 'Guichets source' },
]

const inputCls = 'w-full border border-[#E2EAE5] rounded-lg px-3 py-2 text-sm text-[#374151] focus:outline-none focus:border-[#0B7439] transition-colors'

export default function Referentiels() {
  const [tab, setTab] = useState<Tab>('societes')
  const [societes, setSocietes] = useState<Societe[]>([])
  const [segments, setSegments] = useState<Segment[]>([])
  const [guichets, setGuichets] = useState<GuichetSrc[]>([])
  const [stations, setStations] = useState<Station[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [socRes, segRes, guichetRes, stationRes] = await Promise.all([
      supabase.from('abg_societes').select('*').order('code'),
      supabase.from('abg_segments').select('*').order('code'),
      supabase.from('abg_guichet_srcs').select('*').order('gare_label'),
      supabase.from('stations').select('id, name').order('name'),
    ])
    if (socRes.data) setSocietes(socRes.data)
    if (segRes.data) setSegments(segRes.data)
    if (guichetRes.data) setGuichets(guichetRes.data)
    if (stationRes.data) setStations(stationRes.data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const toggleActive = async (table: string, id: string, current: boolean) => {
    const { error } = await supabase.from(table).update({ is_active: !current }).eq('id', id)
    if (error) {
      toast.error('Erreur lors de la mise à jour')
    } else {
      toast.success('Statut mis à jour')
      load()
    }
  }

  const deleteRow = async (table: string, id: string) => {
    if (!confirm('Confirmer la suppression ?')) return
    const { error } = await supabase.from(table).delete().eq('id', id)
    if (error) {
      toast.error('Erreur lors de la suppression')
    } else {
      toast.success('Supprimé avec succès')
      load()
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Référentiels</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
          Sociétés, segments directionnels et guichets source de la ligne Agboville
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setEditing(null); setAdding(false) }}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              tab === t.key
                ? 'bg-[#0B7439] text-white'
                : 'bg-white border border-[#E2EAE5] text-[#4A6B55] hover:bg-[#F8FAF8]'
            }`}
          >
            <Settings className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : tab === 'societes' ? (
          <SocietesTab
            data={societes}
            adding={adding}
            setAdding={setAdding}
            editing={editing}
            setEditing={setEditing}
            onToggle={(id, val) => toggleActive('abg_societes', id, val)}
            onDelete={(id) => deleteRow('abg_societes', id)}
            onReload={load}
          />
        ) : tab === 'segments' ? (
          <SegmentsTab
            data={segments}
            adding={adding}
            setAdding={setAdding}
            editing={editing}
            setEditing={setEditing}
            onToggle={(id, val) => toggleActive('abg_segments', id, val)}
            onDelete={(id) => deleteRow('abg_segments', id)}
            onReload={load}
          />
        ) : (
          <GuichetsTab
            data={guichets}
            stations={stations}
            societes={societes}
            adding={adding}
            setAdding={setAdding}
            editing={editing}
            setEditing={setEditing}
            onToggle={(id, val) => toggleActive('abg_guichet_srcs', id, val)}
            onDelete={(id) => deleteRow('abg_guichet_srcs', id)}
            onReload={load}
          />
        )}
      </div>
    </div>
  )
}

/* ============ Sociétés Tab ============ */
function SocietesTab({ data, adding, setAdding, editing, setEditing, onToggle, onDelete, onReload }: {
  data: Societe[]
  adding: boolean
  setAdding: (v: boolean) => void
  editing: string | null
  setEditing: (v: string | null) => void
  onToggle: (id: string, val: boolean) => void
  onDelete: (id: string) => void
  onReload: () => void
}) {
  const [form, setForm] = useState({ code: '', name: '', sub_group: '' })

  const save = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      toast.error('Le code et le nom sont obligatoires')
      return
    }
    const { error } = await supabase.from('abg_societes').insert({
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      sub_group: form.sub_group.trim() || null,
    })
    if (error) {
      toast.error(error.message)
    } else {
      toast.success('Société ajoutée')
      setForm({ code: '', name: '', sub_group: '' })
      setAdding(false)
      onReload()
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between p-4 border-b border-[#E2EAE5]">
        <h3 className="text-sm font-semibold text-[#4A6B55]">Sociétés de la ligne Agboville</h3>
        {!adding && (
          <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0B7439] text-white rounded-lg text-sm font-medium hover:bg-[#085c2d] transition-colors">
            <Plus className="w-4 h-4" /> Ajouter
          </button>
        )}
      </div>

      {adding && (
        <div className="p-4 border-b border-[#E2EAE5] bg-[#F8FAF8]">
          <div className="grid grid-cols-3 gap-3">
            <input placeholder="Code (ex: SBTA)" value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))} className={inputCls} />
            <input placeholder="Nom" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className={inputCls} />
            <input placeholder="Sous-groupe (optionnel)" value={form.sub_group} onChange={e => setForm(p => ({ ...p, sub_group: e.target.value }))} className={inputCls} />
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={save} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0B7439] text-white rounded-lg text-sm font-medium hover:bg-[#085c2d]">
              <Check className="w-4 h-4" /> Enregistrer
            </button>
            <button onClick={() => setAdding(false)} className="flex items-center gap-1.5 px-3 py-1.5 border border-[#E2EAE5] text-[#6B7280] rounded-lg text-sm font-medium hover:bg-white">
              <X className="w-4 h-4" /> Annuler
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[#F8FAF8]">
            <tr>
              <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Code</th>
              <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Nom</th>
              <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Sous-groupe</th>
              <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Statut</th>
              <th className="text-center px-4 py-3 text-[#4A6B55] font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.map(row => (
              <tr key={row.id} className="border-t border-[#E2EAE5] hover:bg-[#F8FAF8] transition-colors">
                <td className="px-4 py-3 font-mono text-xs font-semibold text-[#0B7439]">{row.code}</td>
                <td className="px-4 py-3 text-[#374151]">{row.name}</td>
                <td className="px-4 py-3 text-[#6B7280]">{row.sub_group ?? '—'}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => onToggle(row.id, row.is_active)}
                    className={`px-2 py-1 rounded-full text-xs font-semibold ${row.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                  >
                    {row.is_active ? 'Actif' : 'Inactif'}
                  </button>
                </td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => onDelete(row.id)} className="text-red-500 hover:text-red-700 p-1">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
            {data.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center py-8 text-[#9CA3AF] text-sm">Aucune société</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ============ Segments Tab ============ */
function SegmentsTab({ data, adding, setAdding, editing, setEditing, onToggle, onDelete, onReload }: {
  data: Segment[]
  adding: boolean
  setAdding: (v: boolean) => void
  editing: string | null
  setEditing: (v: string | null) => void
  onToggle: (id: string, val: boolean) => void
  onDelete: (id: string) => void
  onReload: () => void
}) {
  const [form, setForm] = useState({ code: '', label: '', origin_city: '', destination_city: '' })

  const save = async () => {
    if (!form.code.trim() || !form.label.trim() || !form.origin_city.trim() || !form.destination_city.trim()) {
      toast.error('Tous les champs sont obligatoires')
      return
    }
    const { error } = await supabase.from('abg_segments').insert({
      code: form.code.trim().toUpperCase().replace(/\s+/g, '_'),
      label: form.label.trim(),
      origin_city: form.origin_city.trim(),
      destination_city: form.destination_city.trim(),
    })
    if (error) {
      toast.error(error.message)
    } else {
      toast.success('Segment ajouté')
      setForm({ code: '', label: '', origin_city: '', destination_city: '' })
      setAdding(false)
      onReload()
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between p-4 border-b border-[#E2EAE5]">
        <h3 className="text-sm font-semibold text-[#4A6B55]">Segments directionnels de la ligne Agboville</h3>
        {!adding && (
          <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0B7439] text-white rounded-lg text-sm font-medium hover:bg-[#085c2d] transition-colors">
            <Plus className="w-4 h-4" /> Ajouter
          </button>
        )}
      </div>

      {adding && (
        <div className="p-4 border-b border-[#E2EAE5] bg-[#F8FAF8]">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <input placeholder="Code (ex: YOPOUGON_AGBOVILLE)" value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))} className={inputCls} />
            <input placeholder="Libellé" value={form.label} onChange={e => setForm(p => ({ ...p, label: e.target.value }))} className={inputCls} />
            <input placeholder="Ville de départ" value={form.origin_city} onChange={e => setForm(p => ({ ...p, origin_city: e.target.value }))} className={inputCls} />
            <input placeholder="Ville d'arrivée" value={form.destination_city} onChange={e => setForm(p => ({ ...p, destination_city: e.target.value }))} className={inputCls} />
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={save} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0B7439] text-white rounded-lg text-sm font-medium hover:bg-[#085c2d]">
              <Check className="w-4 h-4" /> Enregistrer
            </button>
            <button onClick={() => setAdding(false)} className="flex items-center gap-1.5 px-3 py-1.5 border border-[#E2EAE5] text-[#6B7280] rounded-lg text-sm font-medium hover:bg-white">
              <X className="w-4 h-4" /> Annuler
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[#F8FAF8]">
            <tr>
              <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Code</th>
              <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Libellé</th>
              <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Départ</th>
              <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Arrivée</th>
              <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Statut</th>
              <th className="text-center px-4 py-3 text-[#4A6B55] font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.map(row => (
              <tr key={row.id} className="border-t border-[#E2EAE5] hover:bg-[#F8FAF8] transition-colors">
                <td className="px-4 py-3 font-mono text-xs font-semibold text-[#0B7439]">{row.code}</td>
                <td className="px-4 py-3 text-[#374151]">{row.label}</td>
                <td className="px-4 py-3 text-[#6B7280]">{row.origin_city}</td>
                <td className="px-4 py-3 text-[#6B7280]">{row.destination_city}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => onToggle(row.id, row.is_active)}
                    className={`px-2 py-1 rounded-full text-xs font-semibold ${row.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                  >
                    {row.is_active ? 'Actif' : 'Inactif'}
                  </button>
                </td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => onDelete(row.id)} className="text-red-500 hover:text-red-700 p-1">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
            {data.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-8 text-[#9CA3AF] text-sm">Aucun segment</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ============ Guichets Tab ============ */
function GuichetsTab({ data, stations, societes, adding, setAdding, editing, setEditing, onToggle, onDelete, onReload }: {
  data: GuichetSrc[]
  stations: Station[]
  societes: Societe[]
  adding: boolean
  setAdding: (v: boolean) => void
  editing: string | null
  setEditing: (v: string | null) => void
  onToggle: (id: string, val: boolean) => void
  onDelete: (id: string) => void
  onReload: () => void
}) {
  const [form, setForm] = useState({ station_id: '', societe_id: '', gare_label: '' })

  const save = async () => {
    if (!form.station_id || !form.societe_id || !form.gare_label.trim()) {
      toast.error('Tous les champs sont obligatoires')
      return
    }
    const { error } = await supabase.from('abg_guichet_srcs').insert({
      station_id: form.station_id,
      societe_id: form.societe_id,
      gare_label: form.gare_label.trim(),
    })
    if (error) {
      toast.error(error.message)
    } else {
      toast.success('Guichet ajouté')
      setForm({ station_id: '', societe_id: '', gare_label: '' })
      setAdding(false)
      onReload()
    }
  }

  const stationName = (id: string) => stations.find(s => s.id === id)?.name ?? '—'
  const societeName = (id: string) => societes.find(s => s.id === id)?.code ?? '—'

  return (
    <div>
      <div className="flex items-center justify-between p-4 border-b border-[#E2EAE5]">
        <h3 className="text-sm font-semibold text-[#4A6B55]">Guichets source — ligne Agboville par gare</h3>
        {!adding && (
          <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0B7439] text-white rounded-lg text-sm font-medium hover:bg-[#085c2d] transition-colors">
            <Plus className="w-4 h-4" /> Ajouter
          </button>
        )}
      </div>

      {adding && (
        <div className="p-4 border-b border-[#E2EAE5] bg-[#F8FAF8]">
          <div className="grid grid-cols-3 gap-3">
            <select value={form.station_id} onChange={e => setForm(p => ({ ...p, station_id: e.target.value }))} className={inputCls}>
              <option value="">— Gare SBTA —</option>
              {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={form.societe_id} onChange={e => setForm(p => ({ ...p, societe_id: e.target.value }))} className={inputCls}>
              <option value="">— Société —</option>
              {societes.map(s => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
            </select>
            <input placeholder="Libellé guichet (ex: Yopougon)" value={form.gare_label} onChange={e => setForm(p => ({ ...p, gare_label: e.target.value }))} className={inputCls} />
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={save} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0B7439] text-white rounded-lg text-sm font-medium hover:bg-[#085c2d]">
              <Check className="w-4 h-4" /> Enregistrer
            </button>
            <button onClick={() => setAdding(false)} className="flex items-center gap-1.5 px-3 py-1.5 border border-[#E2EAE5] text-[#6B7280] rounded-lg text-sm font-medium hover:bg-white">
              <X className="w-4 h-4" /> Annuler
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[#F8FAF8]">
            <tr>
              <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Gare (guichet)</th>
              <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Gare SBTA</th>
              <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Société</th>
              <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Statut</th>
              <th className="text-center px-4 py-3 text-[#4A6B55] font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.map(row => (
              <tr key={row.id} className="border-t border-[#E2EAE5] hover:bg-[#F8FAF8] transition-colors">
                <td className="px-4 py-3 text-[#374151] font-medium">{row.gare_label}</td>
                <td className="px-4 py-3 text-[#6B7280]">{stationName(row.station_id)}</td>
                <td className="px-4 py-3 font-mono text-xs font-semibold text-[#0B7439]">{societeName(row.societe_id)}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => onToggle(row.id, row.is_active)}
                    className={`px-2 py-1 rounded-full text-xs font-semibold ${row.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                  >
                    {row.is_active ? 'Actif' : 'Inactif'}
                  </button>
                </td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => onDelete(row.id)} className="text-red-500 hover:text-red-700 p-1">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
            {data.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center py-8 text-[#9CA3AF] text-sm">Aucun guichet source</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
