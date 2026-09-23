import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { X, Pencil, Info, Wrench, Trash2, Search, ChevronDown, Calendar, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import ListPage from '@/components/garage/ListPage'
import {
  fetchReparations, createReparation, updateReparation, deleteReparation,
  fetchTypesTechniciens, fetchTechniciens, fetchBusesForGarage, fetchSorties,
} from '@/services/garageSbta.service'
import { supabase } from '@/services/supabase'
import type { GarageReparation, GarageTypeTechnicien, GarageBus, GarageSortiePiece, ReparationStatut } from '@/types/garage.types'
import { formatDate } from '@/components/garage/reportHelpers'
import { formatCurrency } from '@/utils/formatCurrency'

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
  description: string
}

function getLatestSortieDate(reparation: GarageReparation): string {
  return (reparation.reparation_pieces ?? [])
    .map(piece => piece.date_sortie)
    .filter((date): date is string => Boolean(date))
    .reduce((latest, date) => date > latest ? date : latest, reparation.date)
}

type PeriodFilter = 'all' | 'day' | 'week' | 'month'

function getPeriodStart(periodFilter: PeriodFilter): Date | null {
  if (periodFilter === 'all') return null
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (periodFilter === 'day') return today
  if (periodFilter === 'week') {
    const startOfWeek = new Date(today)
    startOfWeek.setDate(today.getDate() - today.getDay() + 1)
    return startOfWeek
  }
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

function filterPiecesByPeriod(pieces: GarageReparationPiece[], periodFilter: PeriodFilter): GarageReparationPiece[] {
  const start = getPeriodStart(periodFilter)
  if (!start) return pieces
  return pieces.filter(rp => {
    if (!rp.date_sortie) return false
    return new Date(rp.date_sortie) >= start
  })
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

type StatutFilter = 'all' | ReparationStatut

export default function GarageReparations() {
  const [reparations, setReparations] = useState<GarageReparation[]>([])
  const [buses, setBuses] = useState<GarageBus[]>([])
  const [typesTech, setTypesTech] = useState<GarageTypeTechnicien[]>([])
  const [techniciens, setTechniciens] = useState<Technicien[]>([])
  const [sorties, setSorties] = useState<GarageSortiePiece[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<GarageReparation | null>(null)
  const [detail, setDetail] = useState<GarageReparation | null>(null)
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('all')
  const [statutFilter, setStatutFilter] = useState<StatutFilter>('all')

  const [form, setForm] = useState<FormState>({
    bus_id: '', date: new Date().toISOString().slice(0, 10),
    statut: 'BROUILLON', technicien_id: '', type_technicien_id: '', description: '',
  })

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([fetchReparations(), fetchBusesForGarage(), fetchTypesTechniciens(), fetchTechniciens(), fetchSorties()])
      .then(([r, b, t, techs, sortiesStock]) => {
        const sorted = [...r].sort((a, b2) => {
          return b2.date.localeCompare(a.date)
        })
        setReparations(sorted); setBuses(b); setTypesTech(t); setTechniciens(techs); setSorties(sortiesStock)
      })
      .catch(() => toast.error('Erreur de chargement'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  // Realtime: recharger quand une réparation ou pièce liée change
  useEffect(() => {
    const channel = supabase
      .channel('garage-reparations-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'garage_reparations' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'garage_reparation_pieces' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

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

  const handleTechnicienChange = (techId: string, typeTechId: string | null) => {
    setForm(f => ({ ...f, technicien_id: techId, type_technicien_id: typeTechId ?? '' }))
  }

  const handleSave = async () => {
    if (!form.bus_id) { toast.error('Sélectionnez un car'); return }
    try {
      const payload = {
        bus_id: form.bus_id,
        piece_id: null,
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

  const matchingSorties = useMemo(() => {
    if (!editing || !form.bus_id || !form.date) return []
    return sorties.filter(sortie => sortie.car_id === form.bus_id && sortie.date === form.date)
  }, [editing, form.bus_id, form.date, sorties])

  const selectedTypeTechNom = useMemo(() => {
    if (!form.type_technicien_id) return null
    return typesTech.find(t => t.id === form.type_technicien_id)?.nom ?? null
  }, [form.type_technicien_id, typesTech])

  const periodPiecesFor = useCallback(
    (r: GarageReparation) => filterPiecesByPeriod(r.reparation_pieces ?? [], periodFilter),
    [periodFilter],
  )

  const displayDateFor = useCallback((r: GarageReparation) => {
    const visible = periodPiecesFor(r)
    const dates = visible.map(p => p.date_sortie).filter((d): d is string => Boolean(d))
    if (dates.length > 0) return dates.reduce((latest, d) => d > latest ? d : latest, dates[0])
    return getLatestSortieDate(r)
  }, [periodPiecesFor])

  const visiblePiecesFor = useCallback(
    (r: GarageReparation) => {
      const periodPieces = periodPiecesFor(r)
      const displayDate = displayDateFor(r)
      const dateMatch = periodPieces.filter(rp => rp.date_sortie === displayDate)
      return dateMatch.length > 0 ? dateMatch : periodPieces
    },
    [periodPiecesFor, displayDateFor],
  )

  const filteredReparations = useMemo(() => {
    return reparations
      .filter(r => {
        if (statutFilter !== 'all' && r.statut !== statutFilter) return false
        if (periodFilter !== 'all') {
          const visible = filterPiecesByPeriod(r.reparation_pieces ?? [], periodFilter)
          if (visible.length === 0) return false
        }
        return true
      })
      .sort((a, b) => displayDateFor(b).localeCompare(displayDateFor(a)))
  }, [reparations, periodFilter, statutFilter, displayDateFor])

  const statutCounts = useMemo(() => {
    const counts = { BROUILLON: 0, 'EN RÉPARATION': 0, LIBÉRÉ: 0 }
    const busIds = { BROUILLON: new Set<string>(), 'EN RÉPARATION': new Set<string>(), LIBÉRÉ: new Set<string>() }
    for (const r of filteredReparations) {
      if (r.statut in counts) {
        counts[r.statut]++
        const busId = r.bus_id ?? r.car_id
        if (busId) busIds[r.statut].add(busId)
      }
    }
    return {
      BROUILLON: { total: counts.BROUILLON, buses: busIds.BROUILLON.size },
      'EN RÉPARATION': { total: counts['EN RÉPARATION'], buses: busIds['EN RÉPARATION'].size },
      LIBÉRÉ: { total: counts.LIBÉRÉ, buses: busIds.LIBÉRÉ.size },
    }
  }, [filteredReparations])

  const longRepairs = useMemo(() => {
    const now = new Date()
    const alerts: { registration: string; days: number; date: string }[] = []
    const seenBusIds = new Set<string>()
    for (const r of filteredReparations) {
      if (r.statut !== 'EN RÉPARATION') continue
      const busId = r.bus_id ?? r.car_id
      if (busId && seenBusIds.has(busId)) continue
      if (busId) seenBusIds.add(busId)
      const rDate = new Date(r.date)
      const diffMs = now.getTime() - rDate.getTime()
      const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
      if (days > 10) {
        alerts.push({
          registration: r.bus?.registration_number ?? r.car?.immatriculation ?? '—',
          days,
          date: r.date,
        })
      }
    }
    return alerts.sort((a, b) => b.days - a.days)
  }, [filteredReparations])

  const periodBtnCls = (active: boolean) => `px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${active ? 'bg-[#0B7439] text-white' : 'bg-[#F4F7F5] text-[#4A6B55] hover:bg-[#E3F0F9]'}`
  const statutBtnCls = (active: boolean) => `px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${active ? 'bg-[#0B7439] text-white' : 'bg-[#F4F7F5] text-[#4A6B55] hover:bg-[#E3F0F9]'}`

  return (
    <>
      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[#6B7280]" />
            <span className="text-xs font-medium text-[#4A6B55]">Période :</span>
            <button className={periodBtnCls(periodFilter === 'all')} onClick={() => setPeriodFilter('all')}>Toutes</button>
            <button className={periodBtnCls(periodFilter === 'day')} onClick={() => setPeriodFilter('day')}>Jour</button>
            <button className={periodBtnCls(periodFilter === 'week')} onClick={() => setPeriodFilter('week')}>Semaine</button>
            <button className={periodBtnCls(periodFilter === 'month')} onClick={() => setPeriodFilter('month')}>Mois</button>
          </div>
          <div className="w-px h-5 bg-[#E2EAE5]" />
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[#4A6B55]">Statut :</span>
            <button className={statutBtnCls(statutFilter === 'all')} onClick={() => setStatutFilter('all')}>Tous</button>
            <button className={statutBtnCls(statutFilter === 'BROUILLON')} onClick={() => setStatutFilter('BROUILLON')}>Brouillon</button>
            <button className={statutBtnCls(statutFilter === 'EN RÉPARATION')} onClick={() => setStatutFilter('EN RÉPARATION')}>En réparation</button>
            <button className={statutBtnCls(statutFilter === 'LIBÉRÉ')} onClick={() => setStatutFilter('LIBÉRÉ')}>Libéré</button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-xl border border-[#E2EAE5] p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#6B7280]">Brouillon</span>
              <span className="text-lg font-bold text-[#6B7280]">{statutCounts.BROUILLON.total}</span>
            </div>
            <div className="text-xs text-[#9CA3AF] mt-0.5">{statutCounts.BROUILLON.buses} bus</div>
          </div>
          <div className="bg-white rounded-xl border border-[#FEE2E2] p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#DC2626]">En réparation</span>
              <span className="text-lg font-bold text-[#DC2626]">{statutCounts['EN RÉPARATION'].total}</span>
            </div>
            <div className="text-xs text-[#DC2626]/70 mt-0.5">{statutCounts['EN RÉPARATION'].buses} bus</div>
          </div>
          <div className="bg-white rounded-xl border border-[#E8F5EC] p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#0B7439]">Libéré</span>
              <span className="text-lg font-bold text-[#0B7439]">{statutCounts.LIBÉRÉ.total}</span>
            </div>
            <div className="text-xs text-[#0B7439]/70 mt-0.5">{statutCounts.LIBÉRÉ.buses} bus</div>
          </div>
        </div>

        {longRepairs.length > 0 && (
          <div className="bg-[#FFF7ED] border border-[#FDBA74] rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-[#D97706]" />
              <span className="text-sm font-semibold text-[#D97706]">Bus en réparation depuis plus de 10 jours</span>
            </div>
            <div className="space-y-1.5">
              {longRepairs.map(a => (
                <div key={a.registration + a.date} className="flex items-center justify-between text-sm">
                  <span className="font-mono font-medium text-[#1A2E22]">{a.registration}</span>
                  <span className="text-[#D97706] font-medium">{a.days} jour(s) — depuis le {formatDate(a.date)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <ListPage
        title="Gestion des réparations"
        subtitle={`${filteredReparations.length} réparation(s) affichée(s)`}
        data={filteredReparations}
        loading={loading}
        searchFields={['description', 'bus.registration_number', 'car.immatriculation', 'type_technicien.nom', 'piece.nom', 'piece.reference']}
        pageSize={50}
        columns={[
          { key: 'date', label: 'Date', render: (r: GarageReparation) => formatDate(displayDateFor(r)) },
          { key: 'bus', label: 'N° Car', render: (r: GarageReparation) => (
            <span className="font-mono font-medium text-[#0B7439]">
              {r.bus?.registration_number ?? r.car?.immatriculation ?? '—'}
            </span>
          )},
          { key: 'piece', label: 'Pièces', render: (r: GarageReparation) => {
            const linked = visiblePiecesFor(r)
            if (linked.length > 0) {
              return (
                <div className="text-sm text-[#1A2E22] max-w-[250px]">
                  {linked.map((rp) => (
                    <div key={rp.id} className="line-clamp-1">
                      {rp.date_sortie && <span className="text-xs text-[#6B7280] mr-1">{formatDate(rp.date_sortie)}</span>}
                      {rp.piece?.reference && <span className="text-xs text-[#0B7439] font-mono mr-1">{rp.piece.reference}</span>}
                      {rp.piece?.nom ?? '—'} — Qté : {rp.quantite} — {rp.montant ? formatCurrency(rp.montant) : ''}
                    </div>
                  ))}
                </div>
              )
            }
            if (periodFilter !== 'all') return <span className="text-sm text-[#6B7280] italic">Aucune sortie sur la période</span>
            return <span className="text-sm text-[#1A2E22]">{r.piece?.nom ?? '—'}</span>
          }},
          { key: 'statut', label: 'Statut', render: (r: GarageReparation) => <ReparationStatusBadge statut={r.statut} /> },
          { key: 'technicien', label: 'Technicien', render: (r: GarageReparation) => {
            const tech = techniciens.find(t => t.id === r.technicien_id)
            return <span>{tech?.full_name || '—'}</span>
          }},
          { key: 'type_technicien', label: 'Type technicien', render: (r: GarageReparation) => r.type_technicien?.nom ?? '—' },
          { key: 'description', label: 'Description', render: (r: GarageReparation) => {
            const linked = visiblePiecesFor(r)
            if (linked.length > 0) {
              return (
                <div className="text-[#4A6B55] text-xs max-w-xs whitespace-pre-line">
                  {linked.map(rp => `${rp.date_sortie ? formatDate(rp.date_sortie) + ' — ' : ''}${rp.piece?.reference ?? ''} ${rp.piece?.nom ?? 'pièce inconnue'} — Qté : ${rp.quantite}${rp.montant ? ' — ' + formatCurrency(rp.montant) : ''}`).join('\n')}
                </div>
              )
            }
            if (periodFilter !== 'all') return <span className="text-[#6B7280] text-xs italic">Aucune sortie sur la période</span>
            return <span className="text-[#4A6B55] line-clamp-1 max-w-xs">{r.description || '—'}</span>
          }},
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
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden">
            <div className="flex-shrink-0 flex items-center justify-between p-6 border-b border-[#E2EAE5]">
              <h2 className="text-lg font-bold text-[#1A2E22] flex items-center gap-2"><Wrench className="w-5 h-5 text-[#0B7439]" />{editing ? 'Modifier la réparation' : 'Nouvelle réparation'}</h2>
              <button onClick={() => setShowModal(false)} className="p-1 rounded-lg hover:bg-[#F4F7F5]"><X className="w-5 h-5 text-[#6B7280]" /></button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-6 space-y-4">
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
              {editing && (
                <div className="bg-[#F8FAF8] rounded-xl p-4 space-y-2">
                  <label className="block text-sm font-semibold text-[#4A6B55]">Pièces sorties pour ce car et cette date</label>
                  {matchingSorties.length > 0 ? (
                    <div className="space-y-1.5">
                      {matchingSorties.map((sortie: GarageSortiePiece) => (
                        <div key={sortie.id} className="flex justify-between items-center text-sm bg-white rounded-lg px-3 py-2 border border-[#E2EAE5]">
                          <div className="flex flex-col">
                            <span className="text-[#1A2E22] font-medium">{sortie.piece?.nom ?? 'pièce inconnue'}</span>
                            <span className="text-xs text-[#6B7280]">{formatDate(sortie.date)}</span>
                          </div>
                          <span className="text-[#4A6B55]">Qté : {sortie.quantite}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-[#6B7280] italic">Aucune sortie de stock pour ce car à cette date.</p>
                  )}
                </div>
              )}
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
            <div className="flex-shrink-0 flex justify-end gap-3 p-6 border-t border-[#E2EAE5] bg-white">
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
              {(detail.reparation_pieces ?? []).length > 0 && (
                <div className="pt-2 border-t border-[#E2EAE5]">
                  <span className="text-[#6B7280] block mb-2">Pièces sorties pour ce car</span>
                  <div className="space-y-1.5">
                    {(detail.reparation_pieces ?? []).map(rp => (
                      <div key={rp.id} className="flex justify-between items-center text-sm bg-[#F8FAF8] rounded-lg px-3 py-2">
                        <div className="flex flex-col">
                          <span className="text-[#1A2E22] font-medium">{rp.piece?.nom ?? 'pièce inconnue'}</span>
                          {rp.date_sortie && <span className="text-xs text-[#6B7280]">{formatDate(rp.date_sortie)}</span>}
                        </div>
                        <span className="text-[#4A6B55]">Qté : {rp.quantite}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
