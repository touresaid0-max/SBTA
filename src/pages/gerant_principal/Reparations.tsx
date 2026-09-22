import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { X, Pencil, Info, Wrench, Trash2, Search, ChevronDown } from 'lucide-react'
import toast from 'react-hot-toast'
import ListPage from '@/components/garage/ListPage'
import {
  fetchReparations, createReparation, updateReparation, deleteReparation,
  fetchTypesTechniciens, fetchTechniciens, fetchBusesForGarage, fetchPieces,
} from '@/services/garageSbta.service'
import { supabase } from '@/services/supabase'
import type { GarageReparation, GarageTypeTechnicien, GarageBus, GaragePiece, ReparationStatut } from '@/types/garage.types'
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

interface Technicien {
  id: string
  full_name: string
  type_technicien_id: string | null
  type_technicien_nom: string | null
}

interface FormState {
  bus_id: string
  date: string
  statut: ReparationStatut
  technicien_id: string
  type_technicien_id: string
  piece_id: string
  description: string
}

function PieceAutocomplete({
  pieces,
  value,
  onChange,
  inputCls,
}: {
  pieces: GaragePiece[]
  value: string
  onChange: (id: string) => void
  inputCls: string
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const selected = useMemo(() => pieces.find(p => p.id === value), [pieces, value])

  const filtered = useMemo(() => {
    if (!query.trim()) return pieces
    const q = query.toLowerCase().trim()
    return pieces.filter(p =>
      p.nom.toLowerCase().includes(q) ||
      (p.reference?.toLowerCase().includes(q) ?? false) ||
      (p.marque?.toLowerCase().includes(q) ?? false),
    )
  }, [pieces, query])

  useEffect(() => {
    if (highlighted >= filtered.length) setHighlighted(0)
  }, [filtered.length, highlighted])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        if (selected) setQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [selected])

  const handleSelect = (piece: GaragePiece) => {
    onChange(piece.id)
    setOpen(false)
    setQuery('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setOpen(true)
        e.preventDefault()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted(h => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[highlighted]) handleSelect(filtered[highlighted])
    } else if (e.key === 'Escape') {
      setOpen(false)
      setQuery('')
    }
  }

  return (
    <div ref={containerRef} className="relative">
      {open ? (
        <div className={`flex items-center gap-2 ${inputCls}`}>
          <Search className="w-4 h-4 flex-shrink-0 text-[#6B7280]" />
          <input
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true); setHighlighted(0) }}
            onKeyDown={handleKeyDown}
            placeholder="Rechercher une pièce..."
            className="flex-1 bg-transparent outline-none text-sm"
            autoFocus
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`flex items-center justify-between gap-2 ${inputCls} text-left`}
        >
          <span className={selected ? 'text-[#1A2E22]' : 'text-[#9CA3AF]'}>
            {selected ? `${selected.nom}${selected.reference ? ` (${selected.reference})` : ''}` : 'Rechercher une pièce...'}
          </span>
          <ChevronDown className="w-4 h-4 flex-shrink-0 text-[#6B7280]" />
        </button>
      )}

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-[#E2EAE5] bg-white max-h-56 overflow-y-auto shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-sm text-center text-[#6B7280]">Aucune pièce trouvée</div>
          ) : (
            filtered.map((piece, idx) => (
              <button
                key={piece.id}
                type="button"
                onMouseEnter={() => setHighlighted(idx)}
                onClick={() => handleSelect(piece)}
                className="w-full text-left px-3 py-2.5 flex flex-col gap-0.5 transition-colors"
                style={{ backgroundColor: idx === highlighted ? '#F0F7F4' : 'transparent' }}
              >
                <span className={`text-sm font-medium truncate ${piece.id === value ? 'text-[#0B7439]' : 'text-[#1A2E22]'}`}>
                  {piece.nom}
                </span>
                <span className="text-xs text-[#6B7280] truncate">
                  {piece.reference}{piece.marque ? ` · ${piece.marque}` : ''}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function TechnicienAutocomplete({
  techniciens,
  value,
  onChange,
  inputCls,
}: {
  techniciens: Technicien[]
  value: string
  onChange: (id: string, typeTechnicienId: string | null) => void
  inputCls: string
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const selected = useMemo(() => techniciens.find(t => t.id === value), [techniciens, value])

  const filtered = useMemo(() => {
    if (!query.trim()) return techniciens
    const q = query.toLowerCase().trim()
    return techniciens.filter(t =>
      t.full_name.toLowerCase().includes(q) ||
      (t.type_technicien_nom?.toLowerCase().includes(q) ?? false),
    )
  }, [techniciens, query])

  useEffect(() => {
    if (highlighted >= filtered.length) setHighlighted(0)
  }, [filtered.length, highlighted])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        if (selected) setQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [selected])

  const handleSelect = (tech: Technicien) => {
    onChange(tech.id, tech.type_technicien_id)
    setOpen(false)
    setQuery('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setOpen(true)
        e.preventDefault()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted(h => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[highlighted]) handleSelect(filtered[highlighted])
    } else if (e.key === 'Escape') {
      setOpen(false)
      setQuery('')
    }
  }

  return (
    <div ref={containerRef} className="relative">
      {open ? (
        <div className={`flex items-center gap-2 ${inputCls}`}>
          <Search className="w-4 h-4 flex-shrink-0 text-[#6B7280]" />
          <input
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true); setHighlighted(0) }}
            onKeyDown={handleKeyDown}
            placeholder="Rechercher un technicien..."
            className="flex-1 bg-transparent outline-none text-sm"
            autoFocus
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`flex items-center justify-between gap-2 ${inputCls} text-left`}
        >
          <span className={selected ? 'text-[#1A2E22]' : 'text-[#9CA3AF]'}>
            {selected ? selected.full_name : 'Rechercher un technicien...'}
          </span>
          <ChevronDown className="w-4 h-4 flex-shrink-0 text-[#6B7280]" />
        </button>
      )}

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-[#E2EAE5] bg-white max-h-56 overflow-y-auto shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-sm text-center text-[#6B7280]">Aucun technicien trouvé</div>
          ) : (
            filtered.map((tech, idx) => (
              <button
                key={tech.id}
                type="button"
                onMouseEnter={() => setHighlighted(idx)}
                onClick={() => handleSelect(tech)}
                className="w-full text-left px-3 py-2.5 flex flex-col gap-0.5 transition-colors"
                style={{ backgroundColor: idx === highlighted ? '#F0F7F4' : 'transparent' }}
              >
                <span className={`text-sm font-medium truncate ${tech.id === value ? 'text-[#0B7439]' : 'text-[#1A2E22]'}`}>
                  {tech.full_name}
                </span>
                {tech.type_technicien_nom && (
                  <span className="text-xs text-[#6B7280] truncate">{tech.type_technicien_nom}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function BusAutocomplete({
  buses,
  value,
  onChange,
  inputCls,
}: {
  buses: GarageBus[]
  value: string
  onChange: (id: string) => void
  inputCls: string
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const selected = useMemo(() => buses.find(b => b.id === value), [buses, value])

  const filtered = useMemo(() => {
    if (!query.trim()) return buses
    const q = query.toLowerCase().trim()
    return buses.filter(b =>
      b.immatriculation.toLowerCase().includes(q) ||
      (b.company?.name?.toLowerCase().includes(q) ?? false),
    )
  }, [buses, query])

  useEffect(() => {
    if (highlighted >= filtered.length) setHighlighted(0)
  }, [filtered.length, highlighted])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        if (selected) setQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [selected])

  const handleSelect = (bus: GarageBus) => {
    onChange(bus.id)
    setOpen(false)
    setQuery('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setOpen(true)
        e.preventDefault()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted(h => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[highlighted]) handleSelect(filtered[highlighted])
    } else if (e.key === 'Escape') {
      setOpen(false)
      setQuery('')
    }
  }

  return (
    <div ref={containerRef} className="relative">
      {open ? (
        <div className={`flex items-center gap-2 ${inputCls}`}>
          <Search className="w-4 h-4 flex-shrink-0 text-[#6B7280]" />
          <input
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true); setHighlighted(0) }}
            onKeyDown={handleKeyDown}
            placeholder="Rechercher une immatriculation..."
            className="flex-1 bg-transparent outline-none text-sm"
            autoFocus
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`flex items-center justify-between gap-2 ${inputCls} text-left`}
        >
          <span className={selected ? 'text-[#1A2E22] font-mono font-medium' : 'text-[#9CA3AF]'}>
            {selected ? selected.immatriculation : 'Rechercher une immatriculation...'}
          </span>
          <ChevronDown className="w-4 h-4 flex-shrink-0 text-[#6B7280]" />
        </button>
      )}

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-[#E2EAE5] bg-white max-h-56 overflow-y-auto shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-sm text-center text-[#6B7280]">Aucun car trouvé</div>
          ) : (
            filtered.map((bus, idx) => (
              <button
                key={bus.id}
                type="button"
                onMouseEnter={() => setHighlighted(idx)}
                onClick={() => handleSelect(bus)}
                className="w-full text-left px-3 py-2.5 flex flex-col gap-0.5 transition-colors"
                style={{ backgroundColor: idx === highlighted ? '#F0F7F4' : 'transparent' }}
              >
                <span className={`text-sm font-mono font-medium truncate ${bus.id === value ? 'text-[#0B7439]' : 'text-[#1A2E22]'}`}>
                  {bus.immatriculation}
                </span>
                {bus.company?.name && (
                  <span className="text-xs text-[#6B7280] truncate">{bus.company.name}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export default function GarageReparations() {
  const [reparations, setReparations] = useState<GarageReparation[]>([])
  const [buses, setBuses] = useState<GarageBus[]>([])
  const [typesTech, setTypesTech] = useState<GarageTypeTechnicien[]>([])
  const [techniciens, setTechniciens] = useState<Technicien[]>([])
  const [pieces, setPieces] = useState<GaragePiece[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<GarageReparation | null>(null)
  const [detail, setDetail] = useState<GarageReparation | null>(null)

  const [form, setForm] = useState<FormState>({
    bus_id: '', date: new Date().toISOString().slice(0, 10),
    statut: 'BROUILLON', technicien_id: '', type_technicien_id: '', piece_id: '', description: '',
  })

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([fetchReparations(), fetchBusesForGarage(), fetchTypesTechniciens(), fetchTechniciens(), fetchPieces()])
      .then(([r, b, t, techs, p]) => {
        const sorted = [...r].sort((a, b2) => {
          const regA = a.bus?.registration_number ?? a.car?.immatriculation ?? ''
          const regB = b2.bus?.registration_number ?? b2.car?.immatriculation ?? ''
          if (regA !== regB) return regA.localeCompare(regB)
          return b2.date.localeCompare(a.date)
        })
        setReparations(sorted); setBuses(b); setTypesTech(t); setTechniciens(techs); setPieces(p)
      })
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
    setForm({ bus_id: '', date: new Date().toISOString().slice(0, 10), statut: 'BROUILLON', technicien_id: '', type_technicien_id: '', piece_id: '', description: '' })
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
      piece_id: r.piece_id ?? '',
      description: r.description,
    })
    setShowModal(true)
  }

  const handleTechnicienChange = (techId: string, typeTechId: string | null) => {
    setForm(f => ({ ...f, technicien_id: techId, type_technicien_id: typeTechId ?? '' }))
  }

  const handleSave = async () => {
    if (!form.bus_id) { toast.error('Sélectionnez un car'); return }
    try {
      const payload = {
        bus_id: form.bus_id,
        piece_id: form.piece_id || null,
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

  const selectedTypeTechNom = useMemo(() => {
    if (!form.type_technicien_id) return null
    return typesTech.find(t => t.id === form.type_technicien_id)?.nom ?? null
  }, [form.type_technicien_id, typesTech])

  return (
    <>
      <ListPage
        title="Gestion des réparations"
        subtitle={`${reparations.length} réparation(s) enregistrée(s)`}
        data={reparations}
        loading={loading}
        searchFields={['description', 'bus.registration_number', 'car.immatriculation', 'type_technicien.nom', 'piece.nom', 'piece.reference']}
        onCreate={openCreate}
        createLabel="Créer une réparation"
        columns={[
          { key: 'date', label: 'Date', render: (r: GarageReparation) => formatDate(r.date) },
          { key: 'bus', label: 'N° Car', render: (r: GarageReparation) => (
            <span className="font-mono font-medium text-[#0B7439]">
              {r.bus?.registration_number ?? r.car?.immatriculation ?? '—'}
            </span>
          )},
          { key: 'piece', label: 'Pièce', render: (r: GarageReparation) => (
            <span className="text-sm text-[#1A2E22] line-clamp-1 max-w-[140px]">
              {r.piece?.nom ?? '—'}
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
                  <BusAutocomplete
                    buses={buses}
                    value={form.bus_id}
                    onChange={(id) => setForm({ ...form, bus_id: id })}
                    inputCls={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#4A6B55] mb-1">Date</label>
                  <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className={inputCls} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[#4A6B55] mb-1">Pièce</label>
                <PieceAutocomplete
                  pieces={pieces}
                  value={form.piece_id}
                  onChange={(id) => setForm({ ...form, piece_id: id })}
                  inputCls={inputCls}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#4A6B55] mb-1">Statut</label>
                <select value={form.statut} onChange={e => setForm({ ...form, statut: e.target.value as ReparationStatut })} className={inputCls}>
                  <option value="BROUILLON">BROUILLON</option>
                  <option value="EN RÉPARATION">EN RÉPARATION</option>
                  <option value="LIBÉRÉ">LIBÉRÉ</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[#4A6B55] mb-1">Technicien</label>
                <TechnicienAutocomplete
                  techniciens={techniciens}
                  value={form.technicien_id}
                  onChange={handleTechnicienChange}
                  inputCls={inputCls}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#4A6B55] mb-1">Type de technicien</label>
                <div className={`${inputCls} bg-[#F4F7F5] flex items-center ${selectedTypeTechNom ? 'text-[#1A2E22]' : 'text-[#9CA3AF]'}`}>
                  {selectedTypeTechNom ?? (form.technicien_id ? 'Aucun type associé' : 'Sélectionnez un technicien')}
                </div>
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
              <div className="flex justify-between"><span className="text-[#6B7280]">Pièce</span><span className="text-[#1A2E22]">{detail.piece?.nom ?? (detail.piece?.reference ? `(${detail.piece.reference})` : '—')}</span></div>
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
