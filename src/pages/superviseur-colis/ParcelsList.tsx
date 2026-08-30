import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Package, Search, RefreshCw, Eye, Printer, Filter, X, ArrowUpDown, ChevronLeft, ChevronRight, CreditCard as Edit2, Trash2, Save, Truck } from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { fetchAllParcels, fetchParcelAgentInfo, updateParcelFields, deleteParcel } from '@/services/parcel.service'
import { buildReceiptData, printParcelTicket } from '@/utils/printParcelTicket'
import { supabase } from '@/services/supabase'
import type { Parcel, ParcelStatus } from '@/types/parcel.types'

const STATUS_CONFIG: Record<ParcelStatus, { label: string; color: string; bg: string }> = {
  enregistre:    { label: 'Enregistré',    color: '#0B7439', bg: '#d4edda' },
  mis_en_paquet: { label: 'Mis en paquet', color: '#1D6FA4', bg: '#DBEAFE' },
  expedie:       { label: 'Expédié',       color: '#D97706', bg: '#FEF3C7' },
  arrive:        { label: 'Arrivé',        color: '#1D6FA4', bg: '#DBEAFE' },
  livre:         { label: 'Retiré',        color: '#0B7439', bg: '#d4edda' },
  retourne:      { label: 'Retourné',      color: '#92400E', bg: '#FEF3C7' },
  perdu:         { label: 'Perdu',         color: '#AF3029', bg: '#f8d7d5' },
}

const PAGE_SIZE = 20

type SortField = 'registered_at' | 'parcel_code' | 'total_amount' | 'status'
type SortDir   = 'asc' | 'desc'

interface Station { id: string; name: string; city_name: string }
interface DriverOption { id: string; full_name: string }
interface BusOption { id: string; registration_number: string }

interface EditForm {
  parcel_code: string
  sender_name: string
  sender_phone: string
  recipient_name: string
  recipient_phone: string
  recipient_city: string
  origin_station_id: string
  destination_station_id: string
  total_amount: string
  delivery_fee: string
  status: ParcelStatus
  registered_at: string
  content_description: string
  notes: string
  bus_registration: string
  driver_id: string
  driver_name: string
}

function parcelToForm(p: Parcel): EditForm {
  return {
    parcel_code: p.parcel_code,
    sender_name: p.sender_name,
    sender_phone: p.sender_phone,
    recipient_name: p.recipient_name,
    recipient_phone: p.recipient_phone,
    recipient_city: p.recipient_city,
    origin_station_id: p.origin_station_id,
    destination_station_id: p.destination_station_id,
    total_amount: String(p.total_amount ?? 0),
    delivery_fee: String(p.delivery_fee ?? 0),
    status: p.status,
    registered_at: p.registered_at ? p.registered_at.slice(0, 16) : '',
    content_description: p.content_description ?? '',
    notes: p.notes ?? '',
    bus_registration: p.bus_registration ?? '',
    driver_id: p.driver_id ?? '',
    driver_name: p.driver_name ?? '',
  }
}

export default function SuperviseurParcelsList() {
  const navigate = useNavigate()
  const [parcels, setParcels]     = useState<Parcel[]>([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState<ParcelStatus | ''>('')
  const [page, setPage]           = useState(1)
  const [sortField, setSortField] = useState<SortField>('registered_at')
  const [sortDir, setSortDir]     = useState<SortDir>('desc')
  const today = format(new Date(), 'dd/MM/yyyy', { locale: fr })

  const [stations, setStations] = useState<Station[]>([])
  const [drivers, setDrivers] = useState<DriverOption[]>([])
  const [buses, setBuses] = useState<BusOption[]>([])
  const [editParcel, setEditParcel] = useState<Parcel | null>(null)
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [driverSearch, setDriverSearch] = useState('')
  const [busSearch, setBusSearch] = useState('')
  const [showDriverDropdown, setShowDriverDropdown] = useState(false)
  const [showBusDropdown, setShowBusDropdown] = useState(false)
  const driverRef = useRef<HTMLDivElement>(null)
  const busRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const all = await fetchAllParcels()
      setParcels(all)
    } catch {
      toast.error('Erreur chargement courriers')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    supabase
      .from('stations')
      .select('id, name, cities(name)')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        setStations((data ?? []).map((s: any) => ({ id: s.id, name: s.name, city_name: s.cities?.name ?? '' })))
      })
    supabase
      .from('users')
      .select('id, full_name')
      .eq('role', 'chauffeur')
      .eq('is_active', true)
      .order('full_name')
      .then(({ data }) => {
        setDrivers((data ?? []).map((d: any) => ({ id: d.id, full_name: d.full_name ?? '' })))
      })
    supabase
      .from('buses')
      .select('id, registration_number')
      .order('registration_number')
      .then(({ data }) => {
        setBuses((data ?? []).map((b: any) => ({ id: b.id, registration_number: b.registration_number })))
      })
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (driverRef.current && !driverRef.current.contains(e.target as Node)) setShowDriverDropdown(false)
      if (busRef.current && !busRef.current.contains(e.target as Node)) setShowBusDropdown(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Filter
  const filtered = parcels.filter(p => {
    const q = search.toLowerCase()
    const matchSearch = !q
      || p.parcel_code.toLowerCase().includes(q)
      || p.reference.toLowerCase().includes(q)
      || p.sender_name.toLowerCase().includes(q)
      || p.recipient_name.toLowerCase().includes(q)
      || p.recipient_city.toLowerCase().includes(q)
      || p.origin_station_name?.toLowerCase().includes(q)
      || p.destination_station_name?.toLowerCase().includes(q)
    const matchStatus = !statusFilter || p.status === statusFilter
    return matchSearch && matchStatus
  })

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    let va: string | number = 0, vb: string | number = 0
    if (sortField === 'registered_at') { va = a.registered_at; vb = b.registered_at }
    else if (sortField === 'parcel_code') { va = a.parcel_code; vb = b.parcel_code }
    else if (sortField === 'total_amount') { va = Number(a.total_amount); vb = Number(b.total_amount) }
    else if (sortField === 'status') { va = a.status; vb = b.status }
    if (va < vb) return sortDir === 'asc' ? -1 : 1
    if (va > vb) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const paginated  = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
    setPage(1)
  }

  function handleSearch(v: string) { setSearch(v); setPage(1) }
  function handleStatusFilter(v: ParcelStatus | '') { setStatusFilter(v); setPage(1) }

  async function handlePrint(parcel: Parcel) {
    const agentInfo = await fetchParcelAgentInfo(parcel.origin_station_id, parcel.destination_station_id).catch(() => null)
    await printParcelTicket(buildReceiptData(parcel, parcel.origin_station_name, '', null, parcel.driver_name, agentInfo))
  }

  function openEdit(parcel: Parcel) {
    setEditParcel(parcel)
    setEditForm(parcelToForm(parcel))
    setBusSearch('')
    setDriverSearch('')
  }

  function closeEdit() {
    setEditParcel(null)
    setEditForm(null)
  }

  async function handleSaveEdit() {
    if (!editParcel || !editForm) return
    setSaving(true)
    try {
      const fields: Record<string, unknown> = {}
      if (editForm.parcel_code !== editParcel.parcel_code) fields.parcel_code = editForm.parcel_code.trim()
      if (editForm.sender_name !== editParcel.sender_name) fields.sender_name = editForm.sender_name.trim()
      if (editForm.sender_phone !== editParcel.sender_phone) fields.sender_phone = editForm.sender_phone.trim()
      if (editForm.recipient_name !== editParcel.recipient_name) fields.recipient_name = editForm.recipient_name.trim()
      if (editForm.recipient_phone !== editParcel.recipient_phone) fields.recipient_phone = editForm.recipient_phone.trim()
      if (editForm.recipient_city !== editParcel.recipient_city) fields.recipient_city = editForm.recipient_city.trim()
      if (editForm.origin_station_id !== editParcel.origin_station_id) fields.origin_station_id = editForm.origin_station_id
      if (editForm.destination_station_id !== editParcel.destination_station_id) fields.destination_station_id = editForm.destination_station_id
      const newAmount = Number(editForm.total_amount)
      if (newAmount !== Number(editParcel.total_amount)) fields.total_amount = newAmount
      const newFee = Number(editForm.delivery_fee)
      if (newFee !== Number(editParcel.delivery_fee)) fields.delivery_fee = newFee
      if (editForm.status !== editParcel.status) fields.status = editForm.status
      const regDate = editForm.registered_at ? new Date(editForm.registered_at).toISOString() : editParcel.registered_at
      if (regDate !== editParcel.registered_at) fields.registered_at = regDate
      if (editForm.content_description !== (editParcel.content_description ?? '')) fields.content_description = editForm.content_description.trim()
      if (editForm.notes !== (editParcel.notes ?? '')) fields.notes = editForm.notes.trim() || null
      if (editForm.bus_registration !== (editParcel.bus_registration ?? '')) {
        const selectedBus = buses.find(b => b.registration_number === editForm.bus_registration.trim())
        fields.bus_id = selectedBus ? selectedBus.id : null
      }
      if (editForm.driver_id !== (editParcel.driver_id ?? '')) fields.driver_id = editForm.driver_id || null

      if (Object.keys(fields).length === 0) {
        toast('Aucune modification')
        closeEdit()
        return
      }

      await updateParcelFields(editParcel.id, fields)
      toast.success('Courrier mis à jour')
      closeEdit()
      await load()
    } catch (err: unknown) {
      const msg = (err as any)?.message || (err as any)?.details || 'Erreur lors de la mise à jour'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(parcel: Parcel) {
    if (!confirm(`Supprimer le courrier ${parcel.parcel_code} ? Cette action est irréversible.`)) return
    try {
      await deleteParcel(parcel.id)
      toast.success('Courrier supprimé')
      load()
    } catch (err: unknown) {
      const msg = (err as any)?.message || (err as any)?.details || 'Erreur lors de la suppression'
      toast.error(msg)
    }
  }

  const setF = (field: keyof EditForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setEditForm(f => f ? { ...f, [field]: e.target.value } : f)

  const SortIcon = ({ field }: { field: SortField }) => (
    <ArrowUpDown
      className="w-3 h-3 inline-block ml-1 opacity-50"
      style={{ opacity: sortField === field ? 1 : 0.4, color: sortField === field ? '#0B7439' : 'inherit' }}
    />
  )

  const statusCounts: Partial<Record<ParcelStatus, number>> = {}
  for (const p of parcels) {
    statusCounts[p.status] = (statusCounts[p.status] ?? 0) + 1
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500'
  const inputStyle = { backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4 lg:space-y-5" style={{ backgroundColor: 'var(--bg-subtle)', minHeight: '100vh' }}>

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Tous les courriers</h1>
          <p className="text-xs sm:text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {parcels.length} courrier{parcels.length > 1 ? 's' : ''} au total — {today}
          </p>
        </div>
        <button
          onClick={load}
          className="p-2 rounded-lg border flex-shrink-0"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          title="Actualiser"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Status chips summary */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => handleStatusFilter('')}
          className="px-3 py-1 rounded-full text-xs font-semibold transition-all"
          style={{
            backgroundColor: !statusFilter ? '#0B7439' : 'var(--surface)',
            color: !statusFilter ? '#fff' : 'var(--text-secondary)',
            border: '1px solid',
            borderColor: !statusFilter ? '#0B7439' : 'var(--border)',
          }}
        >
          Tous ({parcels.length})
        </button>
        {(Object.entries(STATUS_CONFIG) as [ParcelStatus, typeof STATUS_CONFIG[ParcelStatus]][]).map(([key, cfg]) =>
          (statusCounts[key] ?? 0) > 0 ? (
            <button
              key={key}
              onClick={() => handleStatusFilter(statusFilter === key ? '' : key)}
              className="px-3 py-1 rounded-full text-xs font-semibold transition-all"
              style={{
                backgroundColor: statusFilter === key ? cfg.color : cfg.bg,
                color: statusFilter === key ? '#fff' : cfg.color,
                border: '1px solid',
                borderColor: cfg.color + '40',
              }}
            >
              {cfg.label} ({statusCounts[key]})
            </button>
          ) : null
        )}
      </div>

      {/* Search + filters bar */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Rechercher par code, expéditeur, destinataire, ville, gare..."
            value={search}
            onChange={e => handleSearch(e.target.value)}
            className="w-full pl-9 pr-8 py-2 rounded-lg text-sm border"
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              outline: 'none',
            }}
          />
          {search && (
            <button
              onClick={() => handleSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2"
            >
              <X className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          <Filter className="w-3.5 h-3.5" />
          <select
            value={statusFilter}
            onChange={e => handleStatusFilter(e.target.value as ParcelStatus | '')}
            className="bg-transparent outline-none text-xs"
            style={{ color: 'var(--text-primary)' }}
          >
            <option value="">Tous les statuts</option>
            {(Object.entries(STATUS_CONFIG) as [ParcelStatus, typeof STATUS_CONFIG[ParcelStatus]][]).map(([key, cfg]) => (
              <option key={key} value={key}>{cfg.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Results count */}
      {(search || statusFilter) && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {filtered.length} résultat{filtered.length !== 1 ? 's' : ''} trouvé{filtered.length !== 1 ? 's' : ''}
        </p>
      )}

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        {loading ? (
          <div className="py-16 flex justify-center">
            <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#0B7439', borderTopColor: 'transparent' }} />
          </div>
        ) : paginated.length === 0 ? (
          <div className="py-16 text-center">
            <Package className="w-12 h-12 mx-auto mb-3 opacity-20" style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Aucun courrier trouvé</p>
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="lg:hidden divide-y" style={{ borderColor: 'var(--border)' }}>
              {paginated.map(parcel => {
                const sc = STATUS_CONFIG[parcel.status]
                return (
                  <div key={parcel.id} className="p-3 sm:p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-bold text-sm" style={{ color: '#0B7439' }}>
                        {parcel.parcel_code}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0" style={{ backgroundColor: sc.bg, color: sc.color }}>
                        {sc.label}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      <span><span style={{ color: 'var(--text-muted)' }}>De : </span>{parcel.sender_name}</span>
                      <span><span style={{ color: 'var(--text-muted)' }}>A : </span>{parcel.recipient_name}</span>
                      <span><span style={{ color: 'var(--text-muted)' }}>Gare départ : </span>{parcel.origin_station_name}</span>
                      <span><span style={{ color: 'var(--text-muted)' }}>Gare dest. : </span>{parcel.destination_station_name}</span>
                      <span><span style={{ color: 'var(--text-muted)' }}>Montant : </span><strong style={{ color: '#0B7439' }}>{Number(parcel.total_amount ?? 0).toLocaleString('fr-CI')} F</strong></span>
                      <span><span style={{ color: 'var(--text-muted)' }}>Date : </span>{format(new Date(parcel.registered_at), 'dd/MM/yyyy', { locale: fr })}</span>
                      {(parcel.bus_registration || parcel.driver_name) && (
                        <>
                          <span><span style={{ color: 'var(--text-muted)' }}>Plaque : </span>{parcel.bus_registration || '—'}</span>
                          <span><span style={{ color: 'var(--text-muted)' }}>Chauffeur : </span>{parcel.driver_name || '—'}</span>
                        </>
                      )}
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => navigate(`/superviseur-colis/parcels/${parcel.id}`)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold flex-1 justify-center"
                        style={{ backgroundColor: '#0B7439', color: '#fff' }}
                      >
                        <Eye className="w-3.5 h-3.5" /> Voir
                      </button>
                      <button
                        onClick={() => openEdit(parcel)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium"
                        style={{ borderColor: 'var(--border)', color: '#1D6FA4' }}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(parcel)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium"
                        style={{ borderColor: 'var(--border)', color: '#DC2626' }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handlePrint(parcel)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                      >
                        <Printer className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Desktop table */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                    <th className="px-4 py-3 text-left">
                      <button onClick={() => toggleSort('parcel_code')} className="flex items-center gap-1 font-semibold text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
                        Code <SortIcon field="parcel_code" />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-xs uppercase" style={{ color: 'var(--text-muted)' }}>Expéditeur</th>
                    <th className="px-4 py-3 text-left font-semibold text-xs uppercase" style={{ color: 'var(--text-muted)' }}>Destinataire</th>
                    <th className="px-4 py-3 text-left font-semibold text-xs uppercase" style={{ color: 'var(--text-muted)' }}>Gare départ</th>
                    <th className="px-4 py-3 text-left font-semibold text-xs uppercase" style={{ color: 'var(--text-muted)' }}>Gare destination</th>
                    <th className="px-4 py-3 text-left">
                      <button onClick={() => toggleSort('total_amount')} className="flex items-center gap-1 font-semibold text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
                        Montant <SortIcon field="total_amount" />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-xs uppercase" style={{ color: 'var(--text-muted)' }}>Transport</th>
                    <th className="px-4 py-3 text-left">
                      <button onClick={() => toggleSort('status')} className="flex items-center gap-1 font-semibold text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
                        Statut <SortIcon field="status" />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left">
                      <button onClick={() => toggleSort('registered_at')} className="flex items-center gap-1 font-semibold text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
                        Date <SortIcon field="registered_at" />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-xs uppercase" style={{ color: 'var(--text-muted)' }}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                  {paginated.map(parcel => {
                    const sc = STATUS_CONFIG[parcel.status]
                    return (
                      <tr key={parcel.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-mono font-bold text-sm" style={{ color: '#0B7439' }}>
                          {parcel.parcel_code}
                        </td>
                        <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>
                          <p className="font-medium text-sm">{parcel.sender_name}</p>
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{parcel.sender_phone}</p>
                        </td>
                        <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>
                          <p className="font-medium text-sm">{parcel.recipient_name}</p>
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{parcel.recipient_city}</p>
                        </td>
                        <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                          {parcel.origin_station_name}
                        </td>
                        <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                          {parcel.destination_station_name}
                        </td>
                        <td className="px-4 py-3 font-semibold text-sm" style={{ color: '#0B7439' }}>
                          {Number(parcel.total_amount ?? 0).toLocaleString('fr-CI')} F
                        </td>
                        <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>
                          {(parcel.bus_registration || parcel.driver_name) ? (
                            <div className="flex items-center gap-1.5">
                              <Truck className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                              <div className="text-xs leading-tight">
                                {parcel.bus_registration && <p className="font-mono font-semibold">{parcel.bus_registration}</p>}
                                {parcel.driver_name && <p>{parcel.driver_name}</p>}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-1 rounded-full text-xs font-semibold whitespace-nowrap" style={{ backgroundColor: sc.bg, color: sc.color }}>
                            {sc.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                          {format(new Date(parcel.registered_at), 'dd/MM/yyyy HH:mm', { locale: fr })}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => openEdit(parcel)}
                              className="p-1.5 rounded hover:bg-blue-50 transition-colors"
                              title="Modifier"
                            >
                              <Edit2 className="w-4 h-4" style={{ color: '#1D6FA4' }} />
                            </button>
                            <button
                              onClick={() => navigate(`/superviseur-colis/parcels/${parcel.id}`)}
                              className="p-1.5 rounded hover:bg-gray-100 transition-colors"
                              title="Voir détail"
                            >
                              <Eye className="w-4 h-4" style={{ color: '#0B7439' }} />
                            </button>
                            <button
                              onClick={() => handlePrint(parcel)}
                              className="p-1.5 rounded hover:bg-gray-100 transition-colors"
                              title="Imprimer ticket"
                            >
                              <Printer className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                            </button>
                            <button
                              onClick={() => handleDelete(parcel)}
                              className="p-1.5 rounded hover:bg-red-50 transition-colors"
                              title="Supprimer"
                            >
                              <Trash2 className="w-4 h-4" style={{ color: '#DC2626' }} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t" style={{ borderColor: 'var(--border)' }}>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Page {page} / {totalPages} — {filtered.length} résultats
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-1.5 rounded disabled:opacity-40"
                    style={{ border: '1px solid var(--border)' }}
                  >
                    <ChevronLeft className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    const start = Math.max(1, Math.min(page - 2, totalPages - 4))
                    const n = start + i
                    return (
                      <button
                        key={n}
                        onClick={() => setPage(n)}
                        className="w-7 h-7 rounded text-xs font-medium"
                        style={{
                          backgroundColor: page === n ? '#0B7439' : 'var(--surface)',
                          color: page === n ? '#fff' : 'var(--text-secondary)',
                          border: '1px solid var(--border)',
                        }}
                      >
                        {n}
                      </button>
                    )
                  })}
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="p-1.5 rounded disabled:opacity-40"
                    style={{ border: '1px solid var(--border)' }}
                  >
                    <ChevronRight className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Edit Modal */}
      {editParcel && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl p-6 space-y-5"
            style={{ backgroundColor: 'var(--surface)' }}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                Modifier le courrier {editParcel.parcel_code}
              </h2>
              <button onClick={closeEdit} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Code */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Code courrier</label>
                <input value={editForm.parcel_code} onChange={setF('parcel_code')} className={inputCls} style={inputStyle} />
              </div>
              {/* Status */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Statut</label>
                <select value={editForm.status} onChange={setF('status')} className={inputCls} style={inputStyle}>
                  {(Object.entries(STATUS_CONFIG) as [ParcelStatus, typeof STATUS_CONFIG[ParcelStatus]][]).map(([key, cfg]) => (
                    <option key={key} value={key}>{cfg.label}</option>
                  ))}
                </select>
              </div>
              {/* Sender name */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Expéditeur</label>
                <input value={editForm.sender_name} onChange={setF('sender_name')} className={inputCls} style={inputStyle} />
              </div>
              {/* Sender phone */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Tél. expéditeur</label>
                <input value={editForm.sender_phone} onChange={setF('sender_phone')} className={inputCls} style={inputStyle} />
              </div>
              {/* Recipient name */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Destinataire</label>
                <input value={editForm.recipient_name} onChange={setF('recipient_name')} className={inputCls} style={inputStyle} />
              </div>
              {/* Recipient phone */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Tél. destinataire</label>
                <input value={editForm.recipient_phone} onChange={setF('recipient_phone')} className={inputCls} style={inputStyle} />
              </div>
              {/* Recipient city */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Ville destinataire</label>
                <input value={editForm.recipient_city} onChange={setF('recipient_city')} className={inputCls} style={inputStyle} />
              </div>
              {/* Date */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Date d'enregistrement</label>
                <input type="datetime-local" value={editForm.registered_at} onChange={setF('registered_at')} className={inputCls} style={inputStyle} />
              </div>
              {/* Origin station */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Gare de départ</label>
                <select value={editForm.origin_station_id} onChange={setF('origin_station_id')} className={inputCls} style={inputStyle}>
                  <option value="">-- Sélectionner --</option>
                  {stations.map(s => (
                    <option key={s.id} value={s.id}>{s.name}{s.city_name ? ` (${s.city_name})` : ''}</option>
                  ))}
                </select>
              </div>
              {/* Destination station */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Gare de destination</label>
                <select value={editForm.destination_station_id} onChange={setF('destination_station_id')} className={inputCls} style={inputStyle}>
                  <option value="">-- Sélectionner --</option>
                  {stations.map(s => (
                    <option key={s.id} value={s.id}>{s.name}{s.city_name ? ` (${s.city_name})` : ''}</option>
                  ))}
                </select>
              </div>
              {/* Amount */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Montant total (F)</label>
                <input type="number" min="0" value={editForm.total_amount} onChange={setF('total_amount')} className={inputCls} style={inputStyle} />
              </div>
              {/* Delivery fee */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Frais de livraison (F)</label>
                <input type="number" min="0" value={editForm.delivery_fee} onChange={setF('delivery_fee')} className={inputCls} style={inputStyle} />
              </div>
              {/* Bus registration - autocomplete */}
              <div ref={busRef} className="relative">
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Plaque d'immatriculation</label>
                <input
                  value={busSearch !== '' ? busSearch : editForm.bus_registration}
                  onChange={e => { setBusSearch(e.target.value); setShowBusDropdown(true); setEditForm(f => f ? { ...f, bus_registration: e.target.value } : f) }}
                  onFocus={() => { setBusSearch(editForm.bus_registration); setShowBusDropdown(true) }}
                  placeholder="Rechercher une plaque..."
                  className={inputCls}
                  style={inputStyle}
                />
                {showBusDropdown && (
                  <div className="absolute z-30 left-0 right-0 mt-1 rounded-lg shadow-lg max-h-40 overflow-y-auto" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
                    {buses.filter(b => !busSearch || b.registration_number.toLowerCase().includes(busSearch.toLowerCase())).slice(0, 10).map(b => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => { setEditForm(f => f ? { ...f, bus_registration: b.registration_number } : f); setBusSearch(''); setShowBusDropdown(false) }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors font-mono"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {b.registration_number}
                      </button>
                    ))}
                    {buses.filter(b => !busSearch || b.registration_number.toLowerCase().includes(busSearch.toLowerCase())).length === 0 && (
                      <p className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>Aucun bus trouvé</p>
                    )}
                  </div>
                )}
              </div>
              {/* Driver - autocomplete */}
              <div ref={driverRef} className="relative">
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Chauffeur</label>
                <input
                  value={driverSearch !== '' ? driverSearch : editForm.driver_name}
                  onChange={e => { setDriverSearch(e.target.value); setShowDriverDropdown(true) }}
                  onFocus={() => { setDriverSearch(editForm.driver_name); setShowDriverDropdown(true) }}
                  placeholder="Rechercher un chauffeur..."
                  className={inputCls}
                  style={inputStyle}
                />
                {showDriverDropdown && (
                  <div className="absolute z-30 left-0 right-0 mt-1 rounded-lg shadow-lg max-h-40 overflow-y-auto" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
                    {drivers.filter(d => !driverSearch || d.full_name.toLowerCase().includes(driverSearch.toLowerCase())).slice(0, 10).map(d => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => { setEditForm(f => f ? { ...f, driver_id: d.id, driver_name: d.full_name } : f); setDriverSearch(''); setShowDriverDropdown(false) }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {d.full_name}
                      </button>
                    ))}
                    {drivers.filter(d => !driverSearch || d.full_name.toLowerCase().includes(driverSearch.toLowerCase())).length === 0 && (
                      <p className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>Aucun chauffeur trouvé</p>
                    )}
                  </div>
                )}
              </div>
              {/* Description */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Description du contenu</label>
                <input value={editForm.content_description} onChange={setF('content_description')} className={inputCls} style={inputStyle} />
              </div>
              {/* Notes */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Notes</label>
                <textarea value={editForm.notes} onChange={setF('notes')} rows={2} className={inputCls} style={inputStyle} />
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleSaveEdit}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors"
                style={{ backgroundColor: '#0B7439', color: '#fff' }}
              >
                <Save className="w-4 h-4" />
                {saving ? 'Enregistrement...' : 'Enregistrer les modifications'}
              </button>
              <button
                onClick={closeEdit}
                className="px-4 py-2.5 rounded-xl text-sm font-medium"
                style={{ color: 'var(--text-secondary)' }}
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
