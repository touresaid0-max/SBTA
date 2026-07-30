import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Package, PackagePlus, ArrowDownToLine, Banknote, CheckCircle2,
  Printer, Eye, ArrowRight, RefreshCw, Bell, X, Truck, FileText, ChevronDown,
  Filter, MapPin, Bus, User, Loader2, QrCode, Layers, PackageCheck, Send, Search,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/services/supabase'
import {
  fetchOutgoingParcelsPeriod,
  fetchIncomingParcelsPeriod,
  updateParcelStatus,
  bulkUpdateParcelStatus,
  fetchScheduleDriverName,
  fetchScheduleTransportInfo,
  type ParcelPeriod,
} from '@/services/parcel.service'
import { getParcelActionPermission } from '@/utils/parcelPermissions'
import { printBordereauCourrier } from '@/utils/printBordereau'
import type { Parcel, ParcelStatus } from '@/types/parcel.types'

// A bordereau group = all parcels sharing the same bus + destination
interface BordereauGroup {
  key:          string        // unique key for react
  destination:  string        // recipient_city
  busReg:       string        // bus_registration or ''
  scheduleId:   string | null // first schedule_id found in group (for driver lookup)
  driverName:   string        // resolved driver name or '' = needs manual input
  parcels:      Parcel[]
}

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<ParcelStatus, { label: string; color: string; bg: string }> = {
  enregistre:    { label: 'Enregistré',    color: '#0B7439', bg: '#d4edda' },
  mis_en_paquet: { label: 'Mis en paquet', color: '#1D6FA4', bg: '#DBEAFE' },
  expedie:       { label: 'Expédié',       color: '#D97706', bg: '#FEF3C7' },
  arrive:        { label: 'Arrivé',        color: '#0B7439', bg: '#d4edda' },
  livre:         { label: 'Retiré',        color: '#059669', bg: '#D1FAE5' },
  retourne:      { label: 'Retourné',      color: '#92400E', bg: '#FEF3C7' },
  perdu:         { label: 'Perdu',         color: '#AF3029', bg: '#f8d7d5' },
}

const PERIOD_LABELS: Record<ParcelPeriod, string> = {
  today: "Aujourd'hui",
  week:  'Cette semaine',
  month: 'Ce mois',
  all:   'Tous',
}

type StatusFilter = 'all' | ParcelStatus

const OUTGOING_STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all',          label: 'Tous' },
  { value: 'enregistre',   label: 'Enregistré' },
  { value: 'mis_en_paquet',label: 'Mis en paquet' },
  { value: 'expedie',      label: 'Expédié' },
  { value: 'retourne',     label: 'Retourné' },
  { value: 'perdu',        label: 'Perdu' },
]

const INCOMING_STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all',    label: 'Tous' },
  { value: 'expedie', label: 'Expédié' },
  { value: 'arrive',  label: 'Arrivé' },
  { value: 'livre',   label: 'Retiré' },
]

// ─── Component ────────────────────────────────────────────────────────────────
export default function AgentColisDashboard() {
  const { user } = useAuthStore()
  const navigate  = useNavigate()

  // All fetched data (full period for lists)
  const [outgoing, setOutgoing] = useState<Parcel[]>([])
  const [incoming, setIncoming] = useState<Parcel[]>([])
  const [loading,  setLoading]  = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Tabs / filters
  const [tab,            setTab]            = useState<'sortants' | 'entrants'>('sortants')
  const [period,         setPeriod]         = useState<ParcelPeriod>('today')
  const [outStatusFilter, setOutStatusFilter] = useState<StatusFilter>('all')
  const [incStatusFilter, setIncStatusFilter] = useState<StatusFilter>('all')

  // Alerts for new incoming
  const [newAlerts, setNewAlerts] = useState<{ id: string; code: string; sender: string; origin: string }[]>([])
  const prevIncomingIds = useRef<Set<string>>(new Set())

  // Bordereau courrier modal
  const [showCourrierModal,  setShowCourrierModal]  = useState(false)
  const [bordereauGroups,    setBordereauGroups]    = useState<BordereauGroup[]>([])
  const [loadingGroups,      setLoadingGroups]      = useState(false)
  // Grouped by destination
  const [groupByDest, setGroupByDest] = useState(false)
  const [bulkLoading, setBulkLoading] = useState<string | null>(null)
  const [bulkConfirm, setBulkConfirm] = useState<{
    dest: string; action: 'mis_en_paquet' | 'expedie'; ids: string[]; fromStatus: string
  } | null>(null)

  // Expedition modal state (bus + driver autocomplete)
  const [expeditionModal, setExpeditionModal] = useState<{
    dest: string; ids: string[]
  } | null>(null)
  const [expBusSearch, setExpBusSearch] = useState('')
  const [expAllBuses, setExpAllBuses] = useState<{ id: string; registration_number: string; brand: string | null }[]>([])
  const [expBusLoading, setExpBusLoading] = useState(false)
  const [expSelectedBus, setExpSelectedBus] = useState<{ id: string; registration_number: string; brand: string | null } | null>(null)
  const [expBusOpen, setExpBusOpen] = useState(false)
  const [expDriverSearch, setExpDriverSearch] = useState('')
  const [expDriverResults, setExpDriverResults] = useState<{ id: string; full_name: string }[]>([])
  const [expDriverLoading, setExpDriverLoading] = useState(false)
  const [expSelectedDriver, setExpSelectedDriver] = useState<{ id: string; full_name: string } | null>(null)
  const [expDriverOpen, setExpDriverOpen] = useState(false)
  const [expSubmitting, setExpSubmitting] = useState(false)
  const expBusRef = useRef<HTMLDivElement>(null)
  const expDriverRef = useRef<HTMLDivElement>(null)

  const stationId    = user?.station_id    ?? null
  const stationName  = user?.station_name  ?? ''
  const stationPhone = user?.station_phone ?? ''

  // ── Load parcels with selected period ──────────────────────────────────────
  const loadParcels = useCallback(async () => {
    if (!stationId) return
    setLoading(true)
    try {
      const [out, inc] = await Promise.all([
        fetchOutgoingParcelsPeriod(stationId, period),
        fetchIncomingParcelsPeriod(stationId, period),
      ])
      setOutgoing(out)
      setIncoming(inc)

      // Detect truly new arrivals since last load
      const newOnes = inc.filter(p => !prevIncomingIds.current.has(p.id) && p.status !== 'livre')
      if (newOnes.length > 0 && prevIncomingIds.current.size > 0) {
        setNewAlerts(prev => [
          ...prev,
          ...newOnes.map(p => ({
            id:     p.id,
            code:   p.parcel_code,
            sender: p.sender_name,
            origin: (p as any).origin_station?.name ?? p.sender_phone,
          })),
        ])
      }
      prevIncomingIds.current = new Set(inc.map(p => p.id))
    } catch {
      toast.error('Erreur chargement courriers')
    } finally {
      setLoading(false)
    }
  }, [stationId, period])

  useEffect(() => {
    if (stationId) loadParcels()
    else setLoading(false)
  }, [stationId, loadParcels])

  // ── Realtime subscriptions ─────────────────────────────────────────────────
  useEffect(() => {
    if (!stationId) return
    const channel = supabase
      .channel(`parcels-agent-${stationId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'parcels',
        filter: `destination_station_id=eq.${stationId}`,
      }, (payload) => {
        const p = payload.new as any
        setNewAlerts(prev => [...prev, {
          id: p.id, code: p.parcel_code, sender: p.sender_name, origin: p.sender_phone,
        }])
        loadParcels()
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'parcels',
        filter: `destination_station_id=eq.${stationId}`,
      }, () => loadParcels())
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'parcels',
        filter: `origin_station_id=eq.${stationId}`,
      }, () => loadParcels())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [stationId, loadParcels])

  // ── Expedition modal: bus search ──────────────────────────────────────────
  // ── Expedition modal: load all buses once when modal opens ────────────────
  useEffect(() => {
    if (!expeditionModal) return
    let cancelled = false
    ;(async () => {
      setExpBusLoading(true)
      try {
        const { data } = await supabase
          .from('buses')
          .select('id, registration_number, brand')
          .order('registration_number')
        if (!cancelled) setExpAllBuses(data ?? [])
      } catch { if (!cancelled) setExpAllBuses([]) }
      finally { if (!cancelled) setExpBusLoading(false) }
    })()
    return () => { cancelled = true }
  }, [expeditionModal])

  const expFilteredBuses = useMemo(() => {
    const q = expBusSearch.trim().toLowerCase()
    const list = q ? expAllBuses.filter(b => b.registration_number.toLowerCase().includes(q)) : expAllBuses
    return list.slice(0, 50)
  }, [expAllBuses, expBusSearch])

  // ── Expedition modal: driver search ───────────────────────────────────────
  useEffect(() => {
    if (!expeditionModal) return
    if (expDriverSearch.length < 2) { setExpDriverResults([]); return }
    const t = setTimeout(async () => {
      setExpDriverLoading(true)
      try {
        const { data } = await supabase
          .from('users')
          .select('id, full_name')
          .eq('role', 'chauffeur')
          .eq('is_active', true)
          .ilike('full_name', `%${expDriverSearch}%`)
          .order('full_name')
          .limit(10)
        setExpDriverResults(data ?? [])
      } catch { setExpDriverResults([]) }
      finally { setExpDriverLoading(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [expDriverSearch, expeditionModal])

  // Close expedition dropdowns on outside click
  useEffect(() => {
    if (!expeditionModal) return
    function handleClick(e: MouseEvent) {
      if (expBusRef.current && !expBusRef.current.contains(e.target as Node)) setExpBusOpen(false)
      if (expDriverRef.current && !expDriverRef.current.contains(e.target as Node)) setExpDriverOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [expeditionModal])

  // ── Submit expedition with bus + driver ────────────────────────────────────
  async function handleExpeditionSubmit() {
    if (!expeditionModal || !expSelectedBus || !expSelectedDriver) {
      toast.error('Veuillez sélectionner un bus et un chauffeur')
      return
    }
    setExpSubmitting(true)
    try {
      const now = new Date().toISOString()
      const { data: { user: authUser } } = await supabase.auth.getUser()

      const { data, error } = await supabase
        .from('parcels')
        .update({
          status: 'expedie',
          shipped_at: now,
          shipped_by: authUser?.id,
          bus_id: expSelectedBus.id,
          driver_id: expSelectedDriver.id,
          updated_at: now,
        })
        .in('id', expeditionModal.ids)
        .select('id')

      if (error) throw error
      const count = data?.length ?? 0
      toast.success(`${count} courrier${count > 1 ? 's' : ''} expédié${count > 1 ? 's' : ''} — ${expeditionModal.dest}`)
      setExpeditionModal(null)
      resetExpeditionState()
      loadParcels()
    } catch (e: any) {
      toast.error(e.message || 'Erreur lors de l\'expédition')
    } finally {
      setExpSubmitting(false)
    }
  }

  function resetExpeditionState() {
    setExpBusSearch('')
    setExpAllBuses([])
    setExpSelectedBus(null)
    setExpBusOpen(false)
    setExpDriverSearch('')
    setExpDriverResults([])
    setExpSelectedDriver(null)
    setExpDriverOpen(false)
  }

  // ── KPI counters — always based on TODAY regardless of list period filter ──
  const todayStr = new Date().toISOString().slice(0, 10)

  // Sortants du jour = enregistrés aujourd'hui depuis cette gare
  const kpiSortants = useMemo(
    () => outgoing.filter(p => p.registered_at?.startsWith(todayStr)),
    [outgoing, todayStr],
  )

  // Entrants du jour = arrivés/expédiés vers cette gare, non encore livrés
  const kpiEntrants = useMemo(
    () => incoming.filter(p =>
      p.status !== 'livre' &&
      (p.shipped_at?.startsWith(todayStr) || p.arrived_at?.startsWith(todayStr) || p.registered_at?.startsWith(todayStr))
    ),
    [incoming, todayStr],
  )

  // Livrés du jour = livrés aujourd'hui à cette gare
  const kpiLivres = useMemo(
    () => incoming.filter(p => p.status === 'livre' && p.delivered_at?.startsWith(todayStr)),
    [incoming, todayStr],
  )

  // Recettes du jour = total des colis sortants enregistrés aujourd'hui
  const kpiRevenue = useMemo(
    () => kpiSortants.reduce((s, p) => s + Number(p.total_amount ?? 0), 0),
    [kpiSortants],
  )

  // ── Filtered lists for the tabs ────────────────────────────────────────────
  const filteredOutgoing = useMemo(() => {
    if (outStatusFilter === 'all') return outgoing
    return outgoing.filter(p => p.status === outStatusFilter)
  }, [outgoing, outStatusFilter])

  const filteredIncoming = useMemo(() => {
    if (incStatusFilter === 'all') return incoming
    return incoming.filter(p => p.status === incStatusFilter)
  }, [incoming, incStatusFilter])

  const displayList = tab === 'sortants' ? filteredOutgoing : filteredIncoming

  // ── Destination groups ────────────────────────────────────────────────────
  interface DestGroup {
    dest: string
    parcels: Parcel[]
    enregistreCount: number
    misEnPaquetCount: number
  }
  const destinationGroups = useMemo<DestGroup[]>(() => {
    if (!groupByDest) return []
    const map = new Map<string, Parcel[]>()
    for (const p of displayList) {
      const dest = tab === 'sortants'
        ? (p.recipient_city?.trim() || 'DESTINATION INCONNUE')
        : ((p as any).origin_station?.name?.trim() || 'ORIGINE INCONNUE')
      if (!map.has(dest)) map.set(dest, [])
      map.get(dest)!.push(p)
    }
    return Array.from(map.entries())
      .map(([dest, parcels]) => ({
        dest,
        parcels,
        enregistreCount: parcels.filter(p => p.status === 'enregistre').length,
        misEnPaquetCount: parcels.filter(p => p.status === 'mis_en_paquet').length,
      }))
      .sort((a, b) => b.parcels.length - a.parcels.length)
  }, [displayList, groupByDest, tab])

  // ── Actions ────────────────────────────────────────────────────────────────
  async function handleBulkAction() {
    if (!bulkConfirm) return
    const { action, ids, dest } = bulkConfirm
    setBulkLoading(dest)
    setBulkConfirm(null)
    try {
      const { updated } = await bulkUpdateParcelStatus(ids, action)
      const label = action === 'mis_en_paquet' ? 'mis en paquet' : 'expédiés'
      toast.success(`${updated} courrier${updated > 1 ? 's' : ''} ${label} — ${dest}`)
      loadParcels()
    } catch (e: any) {
      toast.error(e.message || 'Erreur lors de la mise à jour')
    } finally {
      setBulkLoading(null)
    }
  }

  async function handleAdvance(parcel: Parcel, nextStatus: ParcelStatus) {
    setActionLoading(parcel.id)
    try {
      await updateParcelStatus(parcel.id, nextStatus)
      toast.success(`Statut mis à jour : ${STATUS_CONFIG[nextStatus].label}`)
      loadParcels()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setActionLoading(null)
    }
  }

  // ── Bordereau courrier ─────────────────────────────────────────────────────
  // Build groups from the current outgoing list (today's parcels by default)
  async function openBordereauModal() {
    setLoadingGroups(true)
    setShowCourrierModal(true)

    // Use today's outgoing parcels; fall back to all loaded outgoing parcels
    const todayStr    = new Date().toISOString().slice(0, 10)
    const todayParcels = outgoing.filter(p => p.registered_at?.startsWith(todayStr))
    const source       = todayParcels.length > 0 ? todayParcels : outgoing

    // Collect all unique schedule_ids so we can batch-resolve bus/driver in one shot
    const scheduleIds = [...new Set(source.map(p => p.schedule_id).filter(Boolean) as string[])]
    const transportMap = await fetchScheduleTransportInfo(scheduleIds).catch(() => new Map())

    // Resolve direct bus_id / driver_id for parcels without a schedule
    const directBusIds = [...new Set(source.filter(p => !p.schedule_id && (p as any).bus_id).map(p => (p as any).bus_id as string))]
    const directDriverIds = [...new Set(source.filter(p => !p.schedule_id && (p as any).driver_id).map(p => (p as any).driver_id as string))]

    const busNameMap = new Map<string, string>()
    const driverNameMap = new Map<string, string>()

    if (directBusIds.length > 0) {
      const { data: buses } = await supabase.from('buses').select('id, registration_number').in('id', directBusIds)
      for (const b of buses ?? []) busNameMap.set(b.id, b.registration_number ?? '')
    }
    if (directDriverIds.length > 0) {
      const { data: drivers } = await supabase.from('users').select('id, full_name').in('id', directDriverIds)
      for (const d of drivers ?? []) driverNameMap.set(d.id, d.full_name ?? '')
    }

    // Group by (schedule_id || bus_id || '', destination) so every unique trip is its own group
    const map = new Map<string, BordereauGroup>()
    for (const p of source) {
      const schedId  = p.schedule_id ?? ''
      const busId    = (p as any).bus_id ?? ''
      const driverId = (p as any).driver_id ?? ''
      const dest     = p.recipient_city?.trim() || 'DESTINATION INCONNUE'
      const groupKey = schedId || busId || ''
      const key      = `${groupKey}||${dest}`

      if (!map.has(key)) {
        const transport = schedId ? transportMap.get(schedId) : undefined
        const directBusReg    = busId    ? busNameMap.get(busId) ?? ''    : ''
        const directDriverNm  = driverId ? driverNameMap.get(driverId) ?? '' : ''
        map.set(key, {
          key,
          destination: dest,
          busReg:      transport?.busReg     || directBusReg,
          scheduleId:  schedId || null,
          driverName:  transport?.driverName || directDriverNm,
          parcels:     [],
        })
      }
      map.get(key)!.parcels.push(p)
    }

    setBordereauGroups(Array.from(map.values()))
    setLoadingGroups(false)
  }

  function handlePrintGroup(group: BordereauGroup) {
    const now        = new Date()
    const driverName = group.driverName
    printBordereauCourrier({
      station_name:     stationName,
      station_phone:    stationPhone,
      destination:      group.destination,
      date:             format(now, 'dd/MM/yyyy', { locale: fr }),
      bus_registration: group.busReg || '—',
      driver_name:      driverName  || '—',
      parcels:          group.parcels,
      print_date:       format(now, 'dd/MM/yyyy', { locale: fr }),
      print_time:       format(now, 'HH:mm', { locale: fr }),
    })
  }

  function handlePrintAllGroups() {
    // Print one PDF per group sequentially with small delay so browser handles download
    bordereauGroups.forEach((g, i) => {
      setTimeout(() => handlePrintGroup(g), i * 400)
    })
  }

  const today = format(new Date(), 'dd/MM/yyyy', { locale: fr })

  // ── No station guard ───────────────────────────────────────────────────────
  if (!loading && !stationId) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] p-4">
        <div className="w-full max-w-sm rounded-xl p-6 text-center" style={{ backgroundColor: 'var(--surface)', border: '2px solid #D97706' }}>
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: '#FEF3C7' }}>
            <Bell className="w-7 h-7" style={{ color: '#D97706' }} />
          </div>
          <h2 className="text-base font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Aucune gare rattachée</h2>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Aucune gare n'est rattachée à votre compte. Veuillez contacter l'administrateur.
          </p>
        </div>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="agent-colis-theme p-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-5 lg:space-y-6 overflow-x-hidden" style={{ backgroundColor: 'var(--bg-subtle)', minHeight: '100vh' }}>

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl lg:text-2xl font-bold truncate" style={{ color: 'var(--text-primary)' }}>
            Gestion des Courriers
          </h1>
          <p className="text-xs sm:text-sm mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
            {stationName || 'Gare'} — {today}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={loadParcels}
            className="p-2 rounded-lg border"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            title="Actualiser"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={openBordereauModal}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap border"
            style={{ borderColor: '#1D6FA4', color: '#1D6FA4', backgroundColor: '#EFF6FF' }}
            title="Imprimer le bordereau courrier"
          >
            <FileText className="w-4 h-4" />
            <span className="hidden sm:inline">Bordereau</span>
          </button>
          <Link
            to="/agent-colis/new"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap"
            style={{ backgroundColor: '#0B7439', color: '#fff' }}
          >
            <PackagePlus className="w-4 h-4" />
            <span className="hidden xs:inline">Nouveau courrier</span>
            <span className="xs:hidden">Nouveau</span>
          </Link>
        </div>
      </div>

      {/* Alertes colis entrants */}
      {newAlerts.length > 0 && (
        <div className="space-y-2">
          {newAlerts.map((alert, idx) => (
            <div
              key={`${alert.id}-${idx}`}
              className="flex items-center gap-2 sm:gap-3 rounded-xl px-3 sm:px-4 py-2.5 sm:py-3"
              style={{ backgroundColor: '#FFF7ED', border: '2px solid #F97316' }}
            >
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#FFEDD5' }}>
                <Truck className="w-4 h-4 sm:w-5 sm:h-5" style={{ color: '#EA580C' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs sm:text-sm font-bold" style={{ color: '#9A3412' }}>Nouveau courrier entrant</p>
                <p className="text-xs truncate" style={{ color: '#C2410C' }}>
                  <span className="font-mono font-bold">{alert.code}</span>
                  {' '}— {alert.sender}
                  {alert.origin ? ` · ${alert.origin}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={() => { navigate(`/agent-colis/parcels/${alert.id}`); setNewAlerts(prev => prev.filter((_, i) => i !== idx)) }}
                  className="text-xs font-semibold px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg"
                  style={{ backgroundColor: '#EA580C', color: '#fff' }}
                >
                  Voir
                </button>
                <button onClick={() => setNewAlerts(prev => prev.filter((_, i) => i !== idx))} className="p-1 rounded-lg hover:bg-orange-100">
                  <X className="w-4 h-4" style={{ color: '#9A3412' }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Bannière colis entrants en attente */}
      {kpiEntrants.length > 0 && newAlerts.length === 0 && (
        <div
          className="flex items-center gap-2 sm:gap-3 rounded-xl px-3 sm:px-4 py-2.5 cursor-pointer"
          style={{ backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE' }}
          onClick={() => { setTab('entrants'); setIncStatusFilter('all') }}
        >
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#DBEAFE' }}>
            <Bell className="w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color: '#1D6FA4' }} />
          </div>
          <p className="text-xs sm:text-sm flex-1" style={{ color: '#1E40AF' }}>
            <span className="font-bold">{kpiEntrants.length} courrier{kpiEntrants.length > 1 ? 's' : ''} entrant{kpiEntrants.length > 1 ? 's' : ''}</span>
            {' '}en attente de traitement aujourd'hui
          </p>
          <ArrowRight className="w-4 h-4 flex-shrink-0" style={{ color: '#1D6FA4' }} />
        </div>
      )}

      {/* KPI Cards — basés sur AUJOURD'HUI uniquement, indépendants du filtre période */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 lg:gap-4">
        {[
          {
            label: 'Courriers sortants',
            subtitle: "Aujourd'hui",
            value: kpiSortants.length,
            icon: <Package className="w-4 h-4 sm:w-5 sm:h-5" />,
            color: '#0B7439', bg: '#d4edda',
            onClick: () => { setTab('sortants'); setPeriod('today'); setOutStatusFilter('all') },
          },
          {
            label: 'Courriers entrants',
            subtitle: "Aujourd'hui (non retirés)",
            value: kpiEntrants.length,
            icon: <ArrowDownToLine className="w-4 h-4 sm:w-5 sm:h-5" />,
            color: '#1D6FA4', bg: '#DBEAFE',
            onClick: () => { setTab('entrants'); setPeriod('today'); setIncStatusFilter('all') },
          },
          {
            label: 'Recettes du jour',
            subtitle: '',
            value: kpiRevenue.toLocaleString('fr-CI') + ' F',
            icon: <Banknote className="w-4 h-4 sm:w-5 sm:h-5" />,
            color: '#D97706', bg: '#FEF3C7',
            onClick: undefined,
          },
          {
            label: 'Retirés',
            subtitle: "Aujourd'hui",
            value: kpiLivres.length,
            icon: <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5" />,
            color: '#059669', bg: '#D1FAE5',
            onClick: () => { setTab('entrants'); setPeriod('today'); setIncStatusFilter('livre') },
          },
        ].map(card => (
          <div
            key={card.label}
            onClick={card.onClick}
            className={`rounded-xl p-3 sm:p-4 flex items-center gap-2 sm:gap-3 ${card.onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: card.bg, color: card.color }}>
              {card.icon}
            </div>
            <div className="min-w-0">
              <p className="text-xs leading-tight truncate" style={{ color: 'var(--text-muted)' }}>{card.label}</p>
              <p className="text-sm sm:text-lg font-bold truncate" style={{ color: 'var(--text-primary)' }}>{card.value}</p>
              {card.subtitle && <p className="text-xs truncate" style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>{card.subtitle}</p>}
            </div>
          </div>
        ))}
      </div>

      {/* Tabs + Filtres + Liste */}
      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>

        {/* Tabs */}
        <div className="flex border-b" style={{ borderColor: 'var(--border)' }}>
          {(['sortants', 'entrants'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="flex-1 py-2.5 sm:py-3 text-xs sm:text-sm font-semibold transition-colors"
              style={{
                borderBottom: tab === t ? '2px solid #0B7439' : '2px solid transparent',
                color: tab === t ? '#0B7439' : 'var(--text-secondary)',
                backgroundColor: 'transparent',
              }}
            >
              {t === 'sortants'
                ? `Sortants (${filteredOutgoing.length})`
                : `Entrants (${filteredIncoming.length})`}
            </button>
          ))}
        </div>

        {/* Barre de filtres */}
        <div
          className="px-3 py-2.5 flex items-center gap-2 flex-wrap border-b"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)' }}
        >
          <Filter className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />

          {/* Filtre période */}
          <div className="flex items-center gap-1 flex-wrap">
            {(Object.keys(PERIOD_LABELS) as ParcelPeriod[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className="px-2 py-1 rounded-md text-xs font-medium transition-colors"
                style={{
                  backgroundColor: period === p ? '#0B7439' : 'transparent',
                  color: period === p ? '#fff' : 'var(--text-secondary)',
                  border: period === p ? 'none' : '1px solid var(--border)',
                }}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>

          {/* Séparateur */}
          <div className="w-px h-4 mx-1 flex-shrink-0" style={{ backgroundColor: 'var(--border)' }} />

          {/* Bouton Scanner QR Code — onglet entrants uniquement */}
          {tab === 'entrants' && (
            <button
              onClick={() => navigate('/agent-colis/scan')}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors"
              style={{ backgroundColor: '#0B7439', color: '#fff' }}
            >
              <QrCode className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Scanner QR</span>
              <span className="sm:hidden">Scan</span>
            </button>
          )}

          {/* Filtre statut — adapté à l'onglet actif */}
          <div className="relative flex-shrink-0">
            <select
              value={tab === 'sortants' ? outStatusFilter : incStatusFilter}
              onChange={e => {
                const val = e.target.value as StatusFilter
                tab === 'sortants' ? setOutStatusFilter(val) : setIncStatusFilter(val)
              }}
              className="appearance-none text-xs rounded-md px-2.5 py-1 pr-6 font-medium"
              style={{
                border: '1px solid var(--border)',
                backgroundColor: 'var(--surface)',
                color: 'var(--text-secondary)',
              }}
            >
              {(tab === 'sortants' ? OUTGOING_STATUS_FILTERS : INCOMING_STATUS_FILTERS).map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
          </div>

          {/* Toggle groupe par destination */}
          <button
            onClick={() => setGroupByDest(g => !g)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ml-auto flex-shrink-0"
            style={{
              backgroundColor: groupByDest ? '#0B7439' : 'transparent',
              color: groupByDest ? '#fff' : 'var(--text-secondary)',
              border: groupByDest ? 'none' : '1px solid var(--border)',
            }}
          >
            <Layers className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Par destination</span>
            <span className="sm:hidden">Grouper</span>
          </button>
        </div>

        {/* Liste */}
        {loading ? (
          <div className="py-12 flex justify-center">
            <div className="w-7 h-7 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#0B7439', borderTopColor: 'transparent' }} />
          </div>
        ) : displayList.length === 0 ? (
          <div className="py-12 text-center" style={{ color: 'var(--text-muted)' }}>
            <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">Aucun courrier {tab === 'sortants' ? 'sortant' : 'entrant'}</p>
            <p className="text-xs mt-1">
              Période : {PERIOD_LABELS[period]}
              {(tab === 'sortants' ? outStatusFilter : incStatusFilter) !== 'all'
                ? ` · Statut : ${STATUS_CONFIG[tab === 'sortants' ? outStatusFilter as ParcelStatus : incStatusFilter as ParcelStatus]?.label}`
                : ''}
            </p>
          </div>
        ) : groupByDest && destinationGroups.length > 0 ? (
          /* ── Grouped by destination view ──────────────────────── */
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {destinationGroups.map(group => {
              const isOriginTab = tab === 'sortants'
              const canBulkPack  = isOriginTab && group.enregistreCount > 0
              const canBulkShip  = isOriginTab && group.misEnPaquetCount > 0
              const isBulkLoading = bulkLoading === group.dest

              const enregistreIds   = group.parcels.filter(p => p.status === 'enregistre').map(p => p.id)
              const misEnPaquetIds  = group.parcels.filter(p => p.status === 'mis_en_paquet').map(p => p.id)

              return (
                <div key={group.dest} className="py-3 px-3 sm:px-4 space-y-2">
                  {/* Group header */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <MapPin className="w-4 h-4 flex-shrink-0" style={{ color: '#0B7439' }} />
                      <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                        {group.dest}
                      </span>
                      <span
                        className="px-2 py-0.5 rounded-full text-xs font-bold flex-shrink-0"
                        style={{ backgroundColor: '#0B7439', color: '#fff' }}
                      >
                        {group.parcels.length}
                      </span>
                    </div>
                    {isBulkLoading && (
                      <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" style={{ color: '#0B7439' }} />
                    )}
                  </div>

                  {/* Status breakdown */}
                  <div className="flex flex-wrap gap-1.5">
                    {group.enregistreCount > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: '#d4edda', color: '#0B7439' }}>
                        {group.enregistreCount} enregistré{group.enregistreCount > 1 ? 's' : ''}
                      </span>
                    )}
                    {group.misEnPaquetCount > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: '#DBEAFE', color: '#1D6FA4' }}>
                        {group.misEnPaquetCount} en paquet
                      </span>
                    )}
                    {group.parcels.filter(p => p.status === 'expedie').length > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: '#FEF3C7', color: '#D97706' }}>
                        {group.parcels.filter(p => p.status === 'expedie').length} expédié{group.parcels.filter(p => p.status === 'expedie').length > 1 ? 's' : ''}
                      </span>
                    )}
                    {group.parcels.filter(p => p.status === 'arrive').length > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: '#d4edda', color: '#0B7439' }}>
                        {group.parcels.filter(p => p.status === 'arrive').length} arrivé{group.parcels.filter(p => p.status === 'arrive').length > 1 ? 's' : ''}
                      </span>
                    )}
                    {group.parcels.filter(p => p.status === 'livre').length > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: '#D1FAE5', color: '#059669' }}>
                        {group.parcels.filter(p => p.status === 'livre').length} retiré{group.parcels.filter(p => p.status === 'livre').length > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>

                  {/* Parcel codes list */}
                  <div className="flex flex-wrap gap-1">
                    {group.parcels.slice(0, 8).map(p => (
                      <button
                        key={p.id}
                        onClick={() => navigate(`/agent-colis/parcels/${p.id}`)}
                        className="px-1.5 py-0.5 rounded text-xs font-mono hover:opacity-80 transition-opacity"
                        style={{
                          backgroundColor: STATUS_CONFIG[p.status]?.bg ?? '#F3F4F6',
                          color: STATUS_CONFIG[p.status]?.color ?? '#6B7280',
                          border: `1px solid ${STATUS_CONFIG[p.status]?.color ?? '#D1D5DB'}20`,
                        }}
                      >
                        {p.parcel_code}
                      </button>
                    ))}
                    {group.parcels.length > 8 && (
                      <span className="px-1.5 py-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                        +{group.parcels.length - 8} autres
                      </span>
                    )}
                  </div>

                  {/* Bulk actions */}
                  {(canBulkPack || canBulkShip) && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {canBulkPack && (
                        <button
                          onClick={() => setBulkConfirm({
                            dest: group.dest,
                            action: 'mis_en_paquet',
                            ids: enregistreIds,
                            fromStatus: 'enregistre',
                          })}
                          disabled={!!bulkLoading}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 transition-colors"
                          style={{ backgroundColor: '#1D6FA4', color: '#fff' }}
                        >
                          <PackageCheck className="w-3.5 h-3.5" />
                          Tout mettre en paquet ({group.enregistreCount})
                        </button>
                      )}
                      {canBulkShip && (
                        <button
                          onClick={() => {
                            resetExpeditionState()
                            setExpeditionModal({ dest: group.dest, ids: misEnPaquetIds })
                          }}
                          disabled={!!bulkLoading}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 transition-colors"
                          style={{ backgroundColor: '#0B7439', color: '#fff' }}
                        >
                          <Send className="w-3.5 h-3.5" />
                          Tout expédier ({group.misEnPaquetCount})
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <>
            {/* Mobile / Tablette : cartes */}
            <div className="lg:hidden divide-y" style={{ borderColor: 'var(--border)' }}>
              {displayList.map(parcel => {
                const sc = STATUS_CONFIG[parcel.status]
                const isLoadingRow = actionLoading === parcel.id
                const perm = stationId
                  ? getParcelActionPermission(
                      parcel.status,
                      parcel.origin_station_id,
                      parcel.destination_station_id,
                      stationId,
                    )
                  : { allowed: false as const, reason: '' }

                return (
                  <div key={parcel.id} className="p-3 sm:p-4 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-bold text-sm" style={{ color: '#0B7439' }}>
                        {parcel.parcel_code}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0" style={{ backgroundColor: sc.bg, color: sc.color }}>
                        {sc.label}
                      </span>
                    </div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                          {tab === 'sortants' ? parcel.recipient_name : parcel.sender_name}
                        </p>
                        <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                          {tab === 'sortants'
                            ? parcel.recipient_city
                            : (parcel as any).origin_station?.name ?? '—'}
                        </p>
                      </div>
                      <p className="text-sm font-semibold flex-shrink-0" style={{ color: 'var(--text-primary)' }}>
                        {Number(parcel.total_amount ?? 0).toLocaleString('fr-CI')} F
                      </p>
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => navigate(`/agent-colis/parcels/${parcel.id}`)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-medium"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Voir
                      </button>

                      {perm.allowed ? (
                        <button
                          onClick={() => handleAdvance(parcel, perm.nextStatus)}
                          disabled={isLoadingRow}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 flex-1"
                          style={{ backgroundColor: '#0B7439', color: '#fff' }}
                        >
                          {isLoadingRow ? '...' : (
                            <>
                              <ArrowRight className="w-3.5 h-3.5 flex-shrink-0" />
                              <span className="truncate">{perm.labelShort}</span>
                            </>
                          )}
                        </button>
                      ) : perm.reason ? (
                        <span
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium flex-1 cursor-not-allowed"
                          style={{ backgroundColor: '#F3F4F6', color: '#9CA3AF', border: '1px solid #E5E7EB' }}
                          title={perm.reason}
                        >
                          <ArrowRight className="w-3.5 h-3.5 flex-shrink-0 opacity-40" />
                          <span className="truncate opacity-60">
                            {parcel.status === 'expedie' && parcel.origin_station_id === stationId
                              ? 'Expédié'
                              : 'Indisponible'}
                          </span>
                        </span>
                      ) : null}
                    </div>
                    {!perm.allowed && perm.reason && parcel.status === 'expedie' && parcel.origin_station_id === stationId && (
                      <p className="text-xs px-1" style={{ color: '#D97706' }}>{perm.reason}</p>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Desktop : tableau */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                    {(tab === 'sortants'
                      ? ['CODE', 'DESTINATAIRE', 'DESTINATION', 'MONTANT', 'STATUT', 'ACTIONS']
                      : ['CODE', 'EXPÉDITEUR', 'ORIGINE', 'MONTANT', 'STATUT', 'ACTIONS']
                    ).map(h => (
                      <th key={h} className="px-4 py-3 text-left font-semibold text-xs" style={{ color: 'var(--text-muted)' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                  {displayList.map(parcel => {
                    const sc = STATUS_CONFIG[parcel.status]
                    const isLoadingRow = actionLoading === parcel.id
                    const perm = stationId
                      ? getParcelActionPermission(
                          parcel.status,
                          parcel.origin_station_id,
                          parcel.destination_station_id,
                          stationId,
                        )
                      : { allowed: false as const, reason: '' }

                    return (
                      <tr key={parcel.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-mono font-bold" style={{ color: '#0B7439' }}>
                          {parcel.parcel_code}
                        </td>
                        <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>
                          {tab === 'sortants' ? parcel.recipient_name : parcel.sender_name}
                        </td>
                        <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>
                          {tab === 'sortants' ? parcel.recipient_city : (parcel as any).origin_station?.name ?? '—'}
                        </td>
                        <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>
                          {Number(parcel.total_amount ?? 0).toLocaleString('fr-CI')} F
                        </td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-1 rounded-full text-xs font-semibold" style={{ backgroundColor: sc.bg, color: sc.color }}>
                            {sc.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => navigate(`/agent-colis/parcels/${parcel.id}`)}
                              className="p-1.5 rounded hover:bg-gray-100" title="Voir détail"
                            >
                              <Eye className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                            </button>

                            {perm.allowed ? (
                              <button
                                onClick={() => handleAdvance(parcel, perm.nextStatus)}
                                disabled={isLoadingRow}
                                className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium disabled:opacity-50"
                                style={{ backgroundColor: '#0B7439', color: '#fff' }}
                              >
                                {isLoadingRow ? '...' : (<><ArrowRight className="w-3 h-3" />{perm.label}</>)}
                              </button>
                            ) : perm.reason ? (
                              <span
                                className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium cursor-not-allowed"
                                style={{ backgroundColor: '#F3F4F6', color: '#9CA3AF', border: '1px solid #E5E7EB' }}
                                title={perm.reason}
                              >
                                <ArrowRight className="w-3 h-3 opacity-40" />
                                {parcel.status === 'expedie' && parcel.origin_station_id === stationId ? 'Expédié' : 'N/A'}
                              </span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Bulk action confirmation modal */}
      {bulkConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}>
          <div className="w-full max-w-sm rounded-2xl shadow-2xl p-5 space-y-4" style={{ backgroundColor: 'var(--surface)' }}>
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{
                  backgroundColor: bulkConfirm.action === 'mis_en_paquet' ? '#DBEAFE' : '#d4edda',
                  color: bulkConfirm.action === 'mis_en_paquet' ? '#1D6FA4' : '#0B7439',
                }}
              >
                {bulkConfirm.action === 'mis_en_paquet'
                  ? <PackageCheck className="w-5 h-5" />
                  : <Send className="w-5 h-5" />}
              </div>
              <div>
                <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                  {bulkConfirm.action === 'mis_en_paquet'
                    ? 'Tout mettre en paquet'
                    : 'Tout expédier'}
                </h3>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{bulkConfirm.dest}</p>
              </div>
            </div>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {bulkConfirm.action === 'mis_en_paquet'
                ? `${bulkConfirm.ids.length} courrier${bulkConfirm.ids.length > 1 ? 's' : ''} enregistré${bulkConfirm.ids.length > 1 ? 's' : ''} vont passer au statut "En paquet".`
                : `${bulkConfirm.ids.length} courrier${bulkConfirm.ids.length > 1 ? 's' : ''} en paquet vont passer au statut "Expédié".`}
            </p>
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => setBulkConfirm(null)}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium border"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              >
                Annuler
              </button>
              <button
                onClick={handleBulkAction}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-bold"
                style={{
                  backgroundColor: bulkConfirm.action === 'mis_en_paquet' ? '#1D6FA4' : '#0B7439',
                  color: '#fff',
                }}
              >
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bordereau Courrier Modal */}
      {showCourrierModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}>
          <div
            className="w-full rounded-2xl shadow-2xl flex flex-col"
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              maxWidth: '520px',
              maxHeight: '90vh',
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#DBEAFE' }}>
                  <FileText className="w-4 h-4" style={{ color: '#1D6FA4' }} />
                </div>
                <div>
                  <h2 className="font-bold text-base leading-tight" style={{ color: 'var(--text-primary)' }}>
                    Bordereaux Courrier
                  </h2>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {format(new Date(), 'dd/MM/yyyy', { locale: fr })} — {stationName}
                  </p>
                </div>
              </div>
              <button onClick={() => setShowCourrierModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">

              {/* Loading */}
              {loadingGroups && (
                <div className="flex items-center justify-center gap-3 py-8">
                  <Loader2 className="w-5 h-5 animate-spin" style={{ color: '#1D6FA4' }} />
                  <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    Récupération des informations…
                  </span>
                </div>
              )}

              {/* No parcels */}
              {!loadingGroups && bordereauGroups.length === 0 && (
                <div className="text-center py-8">
                  <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
                    Aucun courrier sortant aujourd'hui
                  </p>
                </div>
              )}

              {/* Groups */}
              {!loadingGroups && bordereauGroups.map(group => {
                return (
                  <div
                    key={group.key}
                    className="rounded-xl overflow-hidden"
                    style={{ border: '1px solid var(--border)' }}
                  >
                    {/* Group header */}
                    <div className="px-4 py-3" style={{ backgroundColor: '#F0FDF4', borderBottom: '1px solid #BBF7D0' }}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <MapPin className="w-4 h-4 flex-shrink-0" style={{ color: '#0B7439' }} />
                          <span className="font-bold text-sm truncate" style={{ color: '#0B7439' }}>
                            {group.destination}
                          </span>
                          <span
                            className="px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0"
                            style={{ backgroundColor: '#0B7439', color: '#fff' }}
                          >
                            {group.parcels.length} courrier{group.parcels.length > 1 ? 's' : ''}
                          </span>
                        </div>
                        <button
                          onClick={() => handlePrintGroup(group)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold flex-shrink-0"
                          style={{ backgroundColor: '#1D6FA4', color: '#fff' }}
                        >
                          <Printer className="w-3.5 h-3.5" />
                          Imprimer
                        </button>
                      </div>
                    </div>

                    {/* Bus + driver info */}
                    <div className="px-4 py-3 space-y-2.5">
                      {/* Bus registration */}
                      <div className="flex items-center gap-2">
                        <Bus className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                        <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Matricule :</span>
                        <span className="text-xs font-bold font-mono" style={{ color: 'var(--text-primary)' }}>
                          {group.busReg || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontFamily: 'inherit' }}>non renseigné</span>}
                        </span>
                      </div>

                      {/* Driver name — read-only, sourced from planning */}
                      <div className="flex items-center gap-2">
                        <User className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                        <span className="text-xs font-semibold flex-shrink-0" style={{ color: 'var(--text-muted)' }}>Chauffeur :</span>
                        {group.driverName ? (
                          <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                            {group.driverName}
                          </span>
                        ) : (
                          <span className="text-xs" style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                            Non planifié
                          </span>
                        )}
                      </div>

                      {/* Parcel codes summary */}
                      <div className="flex flex-wrap gap-1 pt-1">
                        {group.parcels.slice(0, 6).map(p => (
                          <span
                            key={p.id}
                            className="px-1.5 py-0.5 rounded text-xs font-mono"
                            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
                          >
                            {p.parcel_code}
                          </span>
                        ))}
                        {group.parcels.length > 6 && (
                          <span className="px-1.5 py-0.5 rounded text-xs" style={{ color: 'var(--text-muted)' }}>
                            +{group.parcels.length - 6} autres
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Footer */}
            {!loadingGroups && bordereauGroups.length > 0 && (
              <div className="px-5 pb-5 pt-3 border-t flex gap-2 flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
                <button
                  onClick={() => setShowCourrierModal(false)}
                  className="flex-1 py-2.5 rounded-lg text-sm font-semibold border"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                >
                  Fermer
                </button>
                {bordereauGroups.length > 1 && (
                  <button
                    onClick={handlePrintAllGroups}
                    className="flex-1 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2"
                    style={{ backgroundColor: '#0B7439', color: '#fff' }}
                  >
                    <Printer className="w-4 h-4" />
                    Tout imprimer ({bordereauGroups.length})
                  </button>
                )}
              </div>
            )}
            {!loadingGroups && bordereauGroups.length === 0 && (
              <div className="px-5 pb-5 pt-3 border-t flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
                <button
                  onClick={() => setShowCourrierModal(false)}
                  className="w-full py-2.5 rounded-lg text-sm font-semibold border"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                >
                  Fermer
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Expedition Modal — Bus + Driver selection */}
      {expeditionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}>
          <div className="w-full max-w-md rounded-2xl shadow-2xl p-5 space-y-5" style={{ backgroundColor: 'var(--surface)' }}>
            {/* Header */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#d4edda', color: '#0B7439' }}>
                <Send className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Validation d'expédition</h3>
                <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                  {expeditionModal.ids.length} courrier{expeditionModal.ids.length > 1 ? 's' : ''} — {expeditionModal.dest}
                </p>
              </div>
              <button onClick={() => { setExpeditionModal(null); resetExpeditionState() }} className="ml-auto p-1.5 rounded-lg hover:bg-gray-100 flex-shrink-0">
                <X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>

            {/* Bus autocomplete */}
            <div ref={expBusRef} className="relative">
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Plaque d'immatriculation du bus *
              </label>
              {expSelectedBus ? (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border" style={{ borderColor: '#0B7439', backgroundColor: '#f0faf4' }}>
                  <Bus className="w-4 h-4 flex-shrink-0" style={{ color: '#0B7439' }} />
                  <span className="flex-1 text-sm font-bold font-mono" style={{ color: '#0B7439' }}>
                    {expSelectedBus.registration_number}
                  </span>
                  <button type="button" onClick={() => { setExpSelectedBus(null); setExpBusSearch('') }} className="p-0.5 rounded hover:bg-green-100">
                    <X className="w-3.5 h-3.5" style={{ color: '#0B7439' }} />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                  <input
                    className="w-full pl-9 pr-3 py-2.5 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-green-500"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
                    placeholder="Rechercher par plaque..."
                    value={expBusSearch}
                    onChange={e => { setExpBusSearch(e.target.value); setExpBusOpen(true) }}
                    onFocus={() => setExpBusOpen(true)}
                  />
                </div>
              )}
              {expBusOpen && !expSelectedBus && (
                <div className="absolute z-20 left-0 right-0 mt-1 rounded-lg border overflow-hidden shadow-lg" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', maxHeight: 180, overflowY: 'auto' }}>
                  {expBusLoading && <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>Chargement des bus...</div>}
                  {!expBusLoading && expFilteredBuses.length === 0 && (
                    <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>Aucun bus trouvé</div>
                  )}
                  {expFilteredBuses.map(b => (
                    <button
                      key={b.id}
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b last:border-0 text-sm"
                      style={{ borderColor: 'var(--border)' }}
                      onClick={() => { setExpSelectedBus(b); setExpBusOpen(false); setExpBusSearch('') }}
                    >
                      <span className="font-mono font-bold" style={{ color: '#0B7439' }}>{b.registration_number}</span>
                      {b.brand && <span className="ml-2 text-xs" style={{ color: 'var(--text-secondary)' }}>{b.brand}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Driver autocomplete */}
            <div ref={expDriverRef} className="relative">
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Nom du chauffeur *
              </label>
              {expSelectedDriver ? (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border" style={{ borderColor: '#1D6FA4', backgroundColor: '#EFF6FF' }}>
                  <User className="w-4 h-4 flex-shrink-0" style={{ color: '#1D6FA4' }} />
                  <span className="flex-1 text-sm font-bold" style={{ color: '#1D6FA4' }}>
                    {expSelectedDriver.full_name}
                  </span>
                  <button type="button" onClick={() => { setExpSelectedDriver(null); setExpDriverSearch('') }} className="p-0.5 rounded hover:bg-blue-100">
                    <X className="w-3.5 h-3.5" style={{ color: '#1D6FA4' }} />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                  <input
                    className="w-full pl-9 pr-3 py-2.5 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
                    placeholder="Rechercher par nom..."
                    value={expDriverSearch}
                    onChange={e => { setExpDriverSearch(e.target.value); setExpDriverOpen(true) }}
                    onFocus={() => expDriverSearch.length >= 2 && setExpDriverOpen(true)}
                  />
                </div>
              )}
              {expDriverOpen && !expSelectedDriver && (
                <div className="absolute z-20 left-0 right-0 mt-1 rounded-lg border overflow-hidden shadow-lg" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', maxHeight: 180, overflowY: 'auto' }}>
                  {expDriverLoading && <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>Recherche...</div>}
                  {!expDriverLoading && expDriverSearch.length >= 2 && expDriverResults.length === 0 && (
                    <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>Aucun chauffeur trouvé</div>
                  )}
                  {expDriverResults.map(d => (
                    <button
                      key={d.id}
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b last:border-0 text-sm"
                      style={{ borderColor: 'var(--border)' }}
                      onClick={() => { setExpSelectedDriver(d); setExpDriverOpen(false); setExpDriverSearch('') }}
                    >
                      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{d.full_name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => { setExpeditionModal(null); resetExpeditionState() }}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium border"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              >
                Annuler
              </button>
              <button
                onClick={handleExpeditionSubmit}
                disabled={!expSelectedBus || !expSelectedDriver || expSubmitting}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ backgroundColor: '#0B7439', color: '#fff' }}
              >
                {expSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {expSubmitting ? 'Expédition...' : 'Valider l\'expédition'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
