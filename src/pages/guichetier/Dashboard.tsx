import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  TicketCheck, DollarSign, Calendar, Gift, Users,
  Search, Check, RefreshCw, TrendingUp, Clock,
  CheckCircle, AlertCircle, Bus, ArrowRight, Printer, Banknote,
  ChevronLeft, ChevronRight, Truck, X, Loader2, Lock,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { format, startOfDay, endOfDay, addDays, subDays } from 'date-fns'
import { fr } from 'date-fns/locale'

import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/store/authStore'
import { formatCurrency } from '@/utils/formatCurrency'
import { fetchBorderauDepartData, fetchBorderauRecettesData } from '@/services/counter.service'
import { printBorderauRecettes } from '@/utils/printBordereau'
import { printBordereauDepartThermal } from '@/services/pos/printService'
import type { ScheduleReceiptSummary } from '@/types/counter.types'
import ChargesModal from '@/components/guichetier/ChargesModal'

interface DailyStats {
  ticketsSold: number
  totalReservations: number
  totalAmount: number
  paidAmount: number
  pendingAmount: number
}

interface RecentReservation {
  id: string
  booking_reference: string
  passenger_name: string
  total_price: number
  total_seats: number
  payment_status: string
  created_at: string
  route_label: string
}

export default function GuichetierDashboard() {
  const navigate = useNavigate()
  const { user: authUser } = useAuthStore()

  const [loading,        setLoading]        = useState(true)
  const [stats,          setStats]          = useState<DailyStats>({
    ticketsSold: 0, totalReservations: 0, totalAmount: 0, paidAmount: 0, pendingAmount: 0,
  })
  const [recentReservations, setRecentReservations] = useState<RecentReservation[]>([])
  const [redemptionCode,     setRedemptionCode]     = useState('')
  const [redemptionData,     setRedemptionData]     = useState<any>(null)
  const [searchingCode,      setSearchingCode]      = useState(false)
  const [validating,         setValidating]         = useState(false)

  // Infos guichet
  const [myCounterId,    setMyCounterId]    = useState<string | null>(null)
  const [myStationId,    setMyStationId]    = useState<string | null>(null)
  const [stationName,    setStationName]    = useState<string>('')
  const [counterNumber,  setCounterNumber]  = useState<string | null>(null)

  // Départs enrichis
  const [selectedDate,      setSelectedDate]      = useState<Date>(new Date())
  const [counterDepartures, setCounterDepartures] = useState<ScheduleReceiptSummary[]>([])
  const [depsLoading,       setDepsLoading]       = useState(false)
  const [chargesModal,      setChargesModal]       = useState<ScheduleReceiptSummary | null>(null)
  const [printingId,        setPrintingId]         = useState<string | null>(null)

  // Convoi
  const [convoyDep,          setConvoyDep]          = useState<ScheduleReceiptSummary | null>(null)
  const [convoyAmount,       setConvoyAmount]       = useState<number | ''>('')
  const [convoyObservation,  setConvoyObservation]  = useState('')
  const [convoySubmitting,   setConvoySubmitting]   = useState(false)
  const [convoyConfirmStep,  setConvoyConfirmStep]  = useState(false)

  // KPIs départs affichés
  const totalDepartures  = counterDepartures.length
  const totalSeats       = counterDepartures.reduce((s, d) => s + Number(d.seats_sold), 0)
  const totalCapacity    = counterDepartures.reduce((s, d) => s + Number(d.capacity), 0)
  const totalRemaining   = counterDepartures.reduce((s, d) => s + Number(d.seats_remaining), 0)
  const totalBreakdownTransfer = counterDepartures.reduce((s, d) => s + Number(d.breakdown_transfer ?? 0), 0)
  const totalRecettes    = counterDepartures.reduce((s, d) => s + Number(d.total_ticket_amount), 0) - totalBreakdownTransfer
  const totalChargesDay  = counterDepartures.reduce((s, d) => s + Number(d.total_charges), 0)

  // ── Chargement initial ──────────────────────────────────────────
  const loadDashboardData = useCallback(async () => {
    try {
      setLoading(true)
      await Promise.all([
        loadDailyStats(),
        loadRecentReservations(),
        loadCounterInfo(),
      ])
    } catch (error: any) {
      toast.error('Erreur de chargement')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadDashboardData() }, [loadDashboardData])

  // Recharge les stats du jour une fois le nom de la station connu (inclut les ventes en ligne)
  useEffect(() => {
    if (stationName) loadDailyStats()
  }, [stationName])

  // Recharge les départs quand la date change (le chargement initial est géré dans loadCounterInfo)
  useEffect(() => {
    if (!myStationId || !myCounterId) return
    loadStationDepartures(myStationId, selectedDate, myCounterId)
  }, [selectedDate])

  // ── Info guichet de l'utilisateur connecté ──────────────────────
  const loadCounterInfo = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // 1. Récupérer le counter de l'utilisateur
    const { data: counter, error: counterErr } = await supabase
      .from('counters')
      .select('id, station_id, counter_number')
      .eq('assigned_user_id', user.id)
      .maybeSingle()

    if (counterErr) console.error('Counter load error:', counterErr)
    if (!counter) return

    setMyCounterId(counter.id)
    setMyStationId(counter.station_id)
    setCounterNumber(counter.counter_number ?? null)

    // 2. Récupérer le nom de la station séparément
    const { data: station } = await supabase
      .from('stations')
      .select('name')
      .eq('id', counter.station_id)
      .maybeSingle()

    setStationName(station?.name ?? '')

    // Auto-terminate past en_cours/retard schedules
    try {
      await supabase.rpc('auto_terminate_past_schedules', { p_station_id: counter.station_id });
    } catch (_) {}

    // Charger les départs immédiatement avec le counterId connu
    loadStationDepartures(counter.station_id, selectedDate, counter.id)
  }

  // ── Départs de la station pour la date sélectionnée ─────────────
  const loadStationDepartures = async (stationId: string, date: Date, counterId?: string) => {
    setDepsLoading(true)
    const effectiveCounterId = counterId ?? myCounterId
    try {
      const dateStr = format(date, 'yyyy-MM-dd')
      const from = `${dateStr}T00:00:00`
      const to   = `${dateStr}T23:59:59`

      let query = supabase
        .from('schedule_receipt_summary')
        .select('*')
        .eq('station_id', stationId)
        .gte('departure_datetime', from)
        .lte('departure_datetime', to)
        .order('departure_datetime', { ascending: true })

      // Guichetier: see only departures assigned to their counter
      if (effectiveCounterId) {
        query = query.eq('counter_id', effectiveCounterId)
      }

      const { data, error } = await query

      if (error) throw error
      const departures = data ?? []

      // Auto-assigner dans l'ordre chronologique les numéros de départ manquants
      if (effectiveCounterId) {
        const unassigned = departures.filter(d => !d.departure_number)
        if (unassigned.length > 0) {
          for (const d of unassigned) {
            await supabase.rpc('assign_departure_to_counter', {
              p_schedule_id: d.schedule_id,
              p_counter_id: effectiveCounterId,
            })
          }
          // Recharger avec les numéros assignés
          const { data: refreshed } = await supabase
            .from('schedule_receipt_summary')
            .select('*')
            .eq('station_id', stationId)
            .eq('counter_id', effectiveCounterId)
            .gte('departure_datetime', from)
            .lte('departure_datetime', to)
            .order('departure_datetime', { ascending: true })
          setCounterDepartures(refreshed ?? departures)
          return
        }
      }

      setCounterDepartures(departures)
    } catch (err: any) {
      console.error('Departures load error:', err)
      toast.error('Erreur chargement des départs')
    } finally {
      setDepsLoading(false)
    }
  }

  const reloadDepartures = () => {
    if (myStationId) loadStationDepartures(myStationId, selectedDate, myCounterId ?? undefined)
  }

  // ── Stats journalières ──────────────────────────────────────────
  const loadDailyStats = async () => {
    const today    = startOfDay(new Date())
    const todayEnd = endOfDay(new Date())
    let query = supabase
      .from('reservations')
      .select('total_price, total_seats, payment_status')
      .gte('created_at', today.toISOString())
      .lte('created_at', todayEnd.toISOString())
      .neq('status', 'annulee')
    if (authUser?.id) query = query.eq('booked_by', authUser.id)
    const { data, error } = await query
    if (error) { console.error('Stats error:', error); return }
    const rows         = data ?? []
    const ticketsSold  = rows.reduce((s, r) => s + (r.total_seats || 1), 0)
    const totalAmount  = rows.reduce((s, r) => s + Number(r.total_price || 0), 0)
    const paidAmount   = rows.filter(r => r.payment_status === 'payee').reduce((s, r) => s + Number(r.total_price || 0), 0)
    const pendingAmount = rows.filter(r => r.payment_status === 'en_attente').reduce((s, r) => s + Number(r.total_price || 0), 0)

    let convoyTotal = 0
    if (authUser?.id) {
      const { data: convoys } = await supabase
        .from('convoys')
        .select('amount')
        .eq('created_by', authUser.id)
        .gte('created_at', today.toISOString())
        .lte('created_at', todayEnd.toISOString())
      convoyTotal = (convoys ?? []).reduce((s, c) => s + Number(c.amount || 0), 0)
    }

    // Réservations en ligne confirmées de la station (recette du jour)
    let onlineTickets = 0
    let onlineAmount = 0
    let onlineCount = 0
    if (stationName) {
      const todayStr = format(new Date(), 'yyyy-MM-dd')
      const { data: online } = await supabase
        .from('mobile_bookings')
        .select('seats_count, unit_price, assigned_seats')
        .eq('status', 'confirmed')
        .eq('travel_date', todayStr)
        .eq('origin_station', stationName)
      const onlineRows = online ?? []
      onlineCount = onlineRows.length
      onlineTickets = onlineRows.reduce((s, m: any) => s + (m.seats_count || m.assigned_seats?.length || 0), 0)
      onlineAmount = onlineRows.reduce((s, m: any) => s + Number(m.unit_price || 0) * Number(m.seats_count || 0), 0)
    }

    setStats({
      ticketsSold: ticketsSold + onlineTickets,
      totalReservations: rows.length + onlineCount,
      totalAmount: totalAmount + convoyTotal + onlineAmount,
      paidAmount: paidAmount + convoyTotal + onlineAmount,
      pendingAmount,
    })
  }

  const loadRecentReservations = async () => {
    let query = supabase
      .from('reservations')
      .select(`
        id, booking_reference, passenger_name, total_price, total_seats, payment_status, created_at,
        schedule:schedule_id (
          route_name,
          route:route_id (
            name,
            origin_city:origin_city_id ( name ),
            destination_city:destination_city_id ( name )
          )
        )
      `)
      .neq('status', 'annulee')
      .order('created_at', { ascending: false })
      .limit(6)
    // Guichetier: only own sales
    if (authUser?.id) query = query.eq('booked_by', authUser.id)
    const { data, error } = await query
    if (error) { console.error('Recent reservations error:', error); return }
    const rows = (data ?? []) as any[]
    setRecentReservations(rows.map(r => {
      const route = r.schedule?.route
      let label = '—'
      if (route?.origin_city && route?.destination_city) label = `${route.origin_city.name} → ${route.destination_city.name}`
      else if (r.schedule?.route_name) label = r.schedule.route_name
      else if (route?.name) label = route.name
      return { id: r.id, booking_reference: r.booking_reference, passenger_name: r.passenger_name, total_price: Number(r.total_price), total_seats: r.total_seats, payment_status: r.payment_status, created_at: r.created_at, route_label: label }
    }))
  }

  // ── Fidélité ────────────────────────────────────────────────────
  const handleSearchRedemption = async () => {
    if (!redemptionCode.trim()) { toast.error('Veuillez saisir un code'); return }
    try {
      setSearchingCode(true)
      const { data, error } = await supabase
        .from('loyalty_redemptions')
        .select(`*, customer:customer_id(full_name,email,phone), reward:reward_id(name,description,reward_type,reward_value)`)
        .eq('redemption_code', redemptionCode.trim().toUpperCase())
        .maybeSingle()
      if (error) throw error
      if (!data) { toast.error('Code introuvable'); setRedemptionData(null); return }
      setRedemptionData(data)
    } catch (e: any) { console.error(e); toast.error('Erreur lors de la recherche') }
    finally { setSearchingCode(false) }
  }

  const handleValidateRedemption = async () => {
    if (!redemptionData) return
    if (redemptionData.status === 'utilisee') { toast.error('Code déjà utilisé'); return }
    if (new Date(redemptionData.expires_at) < new Date()) { toast.error('Code expiré'); return }
    try {
      setValidating(true)
      const { error } = await supabase.from('loyalty_redemptions').update({ status: 'utilisee', used_at: new Date().toISOString() }).eq('id', redemptionData.id)
      if (error) throw error
      toast.success('Récompense validée !')
      setRedemptionCode(''); setRedemptionData(null)
    } catch (e: any) { console.error(e); toast.error('Erreur validation') }
    finally { setValidating(false) }
  }

  // ── Impression ──────────────────────────────────────────────────
  const handlePrintDepart = async (scheduleId: string) => {
    setPrintingId(scheduleId)
    try {
      const data = await fetchBorderauDepartData(scheduleId)
      printBordereauDepartThermal({ data })
    } catch (err: any) {
      console.error(err)
      toast.error('Erreur génération bordereau')
    } finally {
      setPrintingId(null)
    }
  }

  const handlePrintRecettes = async () => {
    if (!myCounterId) { toast.error('Aucun guichet assigné'); return }
    const dateStr = format(selectedDate, 'yyyy-MM-dd')
    try {
      const data = await fetchBorderauRecettesData(myCounterId, dateStr)
      if (!data) { toast.error('Aucune donnée pour cette journée'); return }
      printBorderauRecettes(data)
    } catch (err: any) {
      console.error(err)
      toast.error('Erreur génération bordereau')
    }
  }

  // ── Assigner numéro de départ si pas encore fait ────────────────
  const ensureDepartureNumber = async (scheduleId: string): Promise<ScheduleReceiptSummary | null> => {
    if (!myCounterId) return null
    try {
      await supabase.rpc('assign_departure_to_counter', {
        p_schedule_id: scheduleId,
        p_counter_id: myCounterId,
      })
      // Recharger ce schedule depuis la vue
      const { data } = await supabase
        .from('schedule_receipt_summary')
        .select('*')
        .eq('schedule_id', scheduleId)
        .maybeSingle()
      return data ?? null
    } catch (err) {
      console.error(err)
      return null
    }
  }

  const handleOpenCharges = async (dep: ScheduleReceiptSummary) => {
    // Si pas encore de numéro de départ, on l'assigne
    if (!dep.departure_number && myCounterId) {
      const updated = await ensureDepartureNumber(dep.schedule_id)
      if (updated) {
        setCounterDepartures(prev =>
          prev.map(d => d.schedule_id === dep.schedule_id ? updated : d)
        )
        setChargesModal(updated)
        return
      }
    }
    setChargesModal(dep)
  }

  const openConvoyModal = (dep: ScheduleReceiptSummary) => {
    setConvoyDep(dep)
    setConvoyAmount('')
    setConvoyObservation('')
    setConvoyConfirmStep(false)
  }

  const closeConvoyModal = () => {
    setConvoyDep(null)
    setConvoyConfirmStep(false)
  }

  const handleConvoySubmit = async () => {
    if (!convoyDep || !convoyAmount || Number(convoyAmount) <= 0) return
    if (!convoyConfirmStep) { setConvoyConfirmStep(true); return }

    setConvoySubmitting(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()

      const { data: existing } = await supabase
        .from('convoys')
        .select('id')
        .eq('schedule_id', convoyDep.schedule_id)
        .maybeSingle()

      if (!existing) {
        const { error: convoyErr } = await supabase.from('convoys').insert({
          schedule_id: convoyDep.schedule_id,
          amount: Number(convoyAmount),
          observation: convoyObservation.trim() || null,
          created_by: user?.id,
        })
        if (convoyErr) throw convoyErr
      }

      const { error: statusErr } = await supabase.from('schedules').update({
        status: 'convoi',
        seats_available: 0,
        seats_reserved: convoyDep.capacity,
        fill_rate: 100,
        updated_at: new Date().toISOString(),
      }).eq('id', convoyDep.schedule_id)
      if (statusErr) throw statusErr

      toast.success('Convoi enregistre avec succes')
      closeConvoyModal()
      reloadDepartures()
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors de l\'enregistrement du convoi')
    } finally {
      setConvoySubmitting(false)
    }
  }

  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="flex justify-between items-start gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1A2E22]">Dashboard Guichetier</h1>
          <p className="text-sm text-[#6B7280] mt-0.5">
            {stationName && <span className="font-medium text-[#0B7439]">{stationName} · </span>}
            {format(new Date(), 'EEEE d MMMM yyyy', { locale: fr })}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {counterNumber && (
            <div className="flex flex-col items-center justify-center px-5 py-2.5 rounded-2xl border-2 border-[#0B7439] bg-[#F0FAF4] shadow-sm">
              <span className="text-xs font-semibold text-[#4A6B55] uppercase tracking-wider leading-none mb-0.5">Guichet</span>
              <span className="text-3xl font-black text-[#0B7439] leading-none">{counterNumber}</span>
              {stationName && <span className="text-xs text-[#4A6B55] mt-0.5 truncate max-w-[120px]">{stationName}</span>}
            </div>
          )}
          <button
            onClick={loadDashboardData}
            disabled={loading}
            className="px-4 py-2 rounded-lg border border-[#E2EAE5] flex items-center gap-2
                       text-sm text-[#4A6B55] hover:bg-[#F8FAF8] transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Actualiser
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16">
          <div className="w-10 h-10 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[#6B7280] text-sm">Chargement...</p>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { label: 'Réservations',   value: String(stats.totalReservations),    icon: <Users className="w-5 h-5" />,        color: '#0B7439', bg: '#d4edda' },
              { label: 'Billets vendus', value: String(stats.ticketsSold),           icon: <TicketCheck className="w-5 h-5" />,  color: '#0B7439', bg: '#d4edda' },
              { label: 'Total encaissé', value: formatCurrency(stats.totalAmount),   icon: <DollarSign className="w-5 h-5" />,   color: '#059669', bg: '#d1fae5' },
              { label: 'Montant payé',   value: formatCurrency(stats.paidAmount),    icon: <CheckCircle className="w-5 h-5" />,  color: '#059669', bg: '#d1fae5' },
              { label: 'En attente',     value: formatCurrency(stats.pendingAmount), icon: <AlertCircle className="w-5 h-5" />,  color: '#D97706', bg: '#FEF3C7' },
            ].map(card => (
              <div key={card.label} className="rounded-xl p-4" style={{ backgroundColor: card.bg }}>
                <div className="flex items-center gap-2 mb-2">
                  <span style={{ color: card.color }}>{card.icon}</span>
                  <span className="text-xs font-medium text-[#6B7280]">{card.label}</span>
                </div>
                <p className="text-xl font-bold" style={{ color: card.color }}>{card.value}</p>
              </div>
            ))}
          </div>

          {/* ══ DÉPARTS & CHARGES ══════════════════════════════════════ */}
          <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">

            {/* Barre de titre */}
            <div className="px-6 py-4 border-b border-[#E2EAE5] bg-[#F8FAF8]">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <h2 className="font-bold text-[#1A2E22] flex items-center gap-2 text-lg">
                  <Bus className="w-5 h-5 text-[#0B7439]" />
                  Départs &amp; Charges guichet
                </h2>

                {/* Sélecteur de date */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedDate(d => subDays(d, 1))}
                    className="p-1.5 rounded-lg hover:bg-[#E2EAE5] text-[#4A6B55] transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <input
                    type="date"
                    value={format(selectedDate, 'yyyy-MM-dd')}
                    onChange={e => setSelectedDate(new Date(e.target.value))}
                    className="border border-[#E2EAE5] rounded-lg px-3 py-1.5 text-sm text-[#1A2E22]
                               focus:outline-none focus:ring-2 focus:ring-[#0B7439]"
                  />
                  <button
                    onClick={() => setSelectedDate(d => addDays(d, 1))}
                    className="p-1.5 rounded-lg hover:bg-[#E2EAE5] text-[#4A6B55] transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setSelectedDate(new Date())}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[#0B7439] text-white hover:bg-[#085c2d] transition-colors"
                  >
                    Aujourd'hui
                  </button>
                </div>

                {/* Bouton bordereau recettes */}
                <button
                  onClick={handlePrintRecettes}
                  disabled={!myCounterId || counterDepartures.length === 0}
                  className="flex items-center gap-2 px-4 py-2 border border-[#0B7439] text-[#0B7439]
                             rounded-xl text-sm font-medium hover:bg-[#d4edda] transition-colors
                             disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Printer className="w-4 h-4" />
                  Bordereau des recettes
                </button>
              </div>

              {/* KPIs résumé */}
              {counterDepartures.length > 0 && (
                <div className="flex flex-wrap gap-6 mt-4 pt-3 border-t border-[#E2EAE5]">
                  <div>
                    <p className="text-xs text-[#8AA898]">Départs</p>
                    <p className="font-bold text-sm text-[#1A2E22]">{totalDepartures}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[#8AA898]">Billets vendus</p>
                    <p className="font-bold text-sm text-[#1A2E22]">
                      {totalSeats}
                      <span className="font-normal text-[#8AA898] ml-1">/ {totalCapacity}</span>
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[#8AA898]">Sièges restants</p>
                    <p className="font-bold text-sm text-[#059669]">{totalRemaining}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[#8AA898]">MT Tickets</p>
                    <p className="font-bold text-sm text-[#059669]">{formatCurrency(totalRecettes)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[#8AA898]">Charges</p>
                    <p className="font-bold text-sm" style={{ color: totalChargesDay > 0 ? '#AF3029' : '#8AA898' }}>
                      {formatCurrency(totalChargesDay)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[#8AA898]">Solde</p>
                    <p className={`font-bold text-sm ${(totalRecettes - totalChargesDay) < 0 ? 'text-[#AF3029]' : 'text-[#1D6FA4]'}`}>
                      {formatCurrency(totalRecettes - totalChargesDay)}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Corps du tableau */}
            {!myStationId ? (
              <div className="py-16 text-center">
                <Bus className="w-12 h-12 mx-auto mb-3 opacity-20 text-[#6B7280]" />
                <p className="font-medium text-[#4A6B55]">Aucun guichet assigné à votre compte</p>
                <p className="text-sm text-[#8AA898] mt-1">Contactez votre administrateur</p>
              </div>
            ) : depsLoading ? (
              <div className="py-12 text-center">
                <div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin mx-auto" />
              </div>
            ) : counterDepartures.length === 0 ? (
              <div className="py-16 text-center">
                <Calendar className="w-12 h-12 mx-auto mb-3 opacity-20 text-[#6B7280]" />
                <p className="font-medium text-[#4A6B55]">
                  Aucun départ le {format(selectedDate, 'dd MMMM yyyy', { locale: fr })}
                </p>
                <p className="text-sm text-[#8AA898] mt-1">
                  Essayez une autre date ou vérifiez les plannings
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-[#F4F7F5]">
                      {[
                        { label: 'N° Dép.',   align: 'left' },
                        { label: 'Heure',     align: 'left' },
                        { label: 'Matricule', align: 'left' },
                        { label: 'Ligne',     align: 'left' },
                        { label: 'Statut',    align: 'center' },
                        { label: 'Sièges',    align: 'center' },
                        { label: 'MT Ticket', align: 'right' },
                        { label: 'Charges',   align: 'right' },
                        { label: 'Solde',     align: 'right' },
                        { label: 'Actions',   align: 'center' },
                      ].map(h => (
                        <th key={h.label}
                          className={`px-4 py-3 text-xs font-semibold text-[#6B7280] uppercase tracking-wide whitespace-nowrap text-${h.align}`}>
                          {h.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F4F7F5]">
                    {counterDepartures.map((d) => {
                      const hasCharges = Number(d.total_charges) > 0
                      const isConvoi = d.status === 'convoi'
                      const isPastDate = selectedDate < startOfDay(new Date())
                      const isLocked = d.status === 'termine' || (isPastDate && d.status !== 'en_cours' && d.status !== 'retard')
                      return (
                        <tr key={d.schedule_id} className={`transition-colors ${isLocked ? 'opacity-60 bg-[#F9FAFB]' : 'hover:bg-[#F8FAF8]'}`}>

                          {/* N° départ */}
                          <td className="px-4 py-3.5">
                            {d.departure_number ? (
                              <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full
                                               font-bold text-sm text-white ${isConvoi ? 'bg-[#EA580C]' : 'bg-[#0B7439]'}`}>
                                {d.departure_number}
                              </span>
                            ) : (
                              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full
                                               bg-[#E2EAE5] text-[#8AA898] font-medium text-xs">
                                —
                              </span>
                            )}
                          </td>

                          {/* Heure */}
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5 text-[#8AA898]" />
                              <span className="font-semibold text-sm text-[#1A2E22]">
                                {format(new Date(d.departure_datetime), 'HH:mm')}
                              </span>
                            </div>
                          </td>

                          {/* Matricule */}
                          <td className="px-4 py-3.5">
                            <span className="font-mono text-sm font-semibold text-[#1A2E22]">
                              {d.registration_number ?? '—'}
                            </span>
                          </td>

                          {/* Ligne */}
                          <td className="px-4 py-3.5">
                            <p className="text-sm text-[#1A2E22] max-w-[160px] truncate">{d.route_name}</p>
                            <p className="text-xs text-[#8AA898]">{d.destination_city}</p>
                            {Number(d.breakdown_transfer ?? 0) > 0 && (
                              <span
                                title={d.breakdown_split_reason ?? 'Répartition suite à panne'}
                                className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA]"
                              >
                                Répartition panne −{Number(d.breakdown_transfer).toLocaleString('fr-CI')} F
                              </span>
                            )}
                          </td>

                          {/* Statut */}
                          <td className="px-4 py-3.5 text-center">
                            {isConvoi ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold
                                             bg-[#FFF7ED] text-[#C2410C] border border-[#FDBA74]">
                                <Truck className="w-3 h-3" />
                                CONVOI
                              </span>
                            ) : d.status === 'termine' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium
                                             bg-[#ECFDF5] text-[#065F46] border border-[#A7F3D0]">
                                <CheckCircle className="w-3 h-3" />
                                Parti
                              </span>
                            ) : (
                              <span className="text-xs text-[#8AA898]">—</span>
                            )}
                          </td>

                          {/* Sièges */}
                          <td className="px-4 py-3.5 text-center">
                            {isConvoi ? (
                              <div className="flex flex-col items-center gap-0.5">
                                <div className="flex items-baseline gap-0.5">
                                  <span className="text-sm font-bold text-[#C2410C]">{d.capacity}/{d.capacity}</span>
                                </div>
                                <span className="text-xs font-semibold text-[#EA580C]">Boucle</span>
                                <div className="w-16 h-1.5 rounded-full overflow-hidden mt-0.5" style={{ backgroundColor: '#FED7AA' }}>
                                  <div className="h-full rounded-full" style={{ width: '100%', backgroundColor: '#F97316' }} />
                                </div>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center gap-0.5">
                                <div className="flex items-baseline gap-0.5">
                                  <span className="text-sm font-bold text-[#1A2E22]">{d.seats_sold}</span>
                                  <span className="text-xs text-[#8AA898]">vendus</span>
                                </div>
                                <div className="flex items-baseline gap-0.5">
                                  <span className={`text-xs font-semibold ${d.seats_remaining === 0 ? 'text-[#AF3029]' : 'text-[#059669]'}`}>
                                    {d.seats_remaining}
                                  </span>
                                  <span className="text-xs text-[#8AA898]">restants / {d.capacity}</span>
                                </div>
                                <div className="w-16 h-1.5 rounded-full bg-[#E2EAE5] overflow-hidden mt-0.5">
                                  <div
                                    className="h-full rounded-full transition-all"
                                    style={{
                                      width: d.capacity > 0 ? `${(d.seats_sold / d.capacity) * 100}%` : '0%',
                                      backgroundColor: d.seats_sold >= d.capacity ? '#AF3029' : d.seats_sold / d.capacity > 0.7 ? '#D97706' : '#0B7439',
                                    }}
                                  />
                                </div>
                              </div>
                            )}
                          </td>

                          {/* MT Ticket */}
                          <td className="px-4 py-3.5 text-right">
                            {isConvoi && d.convoy_amount != null ? (
                              <div>
                                <span className="text-sm font-bold text-[#C2410C]">
                                  {Number(d.convoy_amount).toLocaleString('fr-CI')} F
                                </span>
                                <p className="text-xs text-[#EA580C]">convoi</p>
                              </div>
                            ) : (
                              <span className="text-sm font-bold text-[#059669]">
                                {Number(d.total_ticket_amount).toLocaleString('fr-CI')} F
                              </span>
                            )}
                          </td>

                          {/* Charges */}
                          <td className="px-4 py-3.5 text-right">
                            <span className={`text-sm font-semibold ${hasCharges ? 'text-[#AF3029]' : 'text-[#8AA898]'}`}>
                              {Number(d.total_charges).toLocaleString('fr-CI')} F
                            </span>
                          </td>

                          {/* Solde */}
                          <td className="px-4 py-3.5 text-right">
                            {(() => {
                              const solde = Number(d.solde_ticket)
                              const isNeg = solde < 0
                              return (
                                <span className={`text-sm font-bold px-2 py-0.5 rounded-lg ${
                                  isNeg
                                    ? 'bg-[#fee2e2] text-[#AF3029]'
                                    : 'bg-[#d1fae5] text-[#059669]'
                                }`}>
                                  {isNeg ? '−' : '+'}{Math.abs(solde).toLocaleString('fr-CI')} F
                                </span>
                              )
                            })()}
                          </td>

                          {/* Actions */}
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-1 justify-center">
                              {isLocked ? (
                                <span className="text-xs font-medium text-[#94A3B8] px-2 py-1 rounded-lg bg-[#F1F5F9] border border-[#E2E8F0] whitespace-nowrap flex items-center gap-1">
                                  <Lock className="w-3 h-3" />
                                  Verrouillé
                                </span>
                              ) : isConvoi ? (
                                <span className="text-xs font-medium text-[#92400E] px-2 py-1 rounded-lg bg-[#FFF7ED] border border-[#FDBA74] whitespace-nowrap">
                                  Voyage boucle
                                </span>
                              ) : (
                                <>
                                  {/* Enregistrer un convoi */}
                                  {(d.status === 'planifie' || d.status === 'en_cours' || d.status === 'retard') && (
                                    <button
                                      onClick={() => openConvoyModal(d)}
                                      title="Enregistrer un convoi"
                                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                                                 bg-[#FFF7ED] text-[#C2410C] hover:bg-[#FFEDD5] border border-[#FDBA74]
                                                 transition-colors text-xs font-medium whitespace-nowrap"
                                    >
                                      <Truck className="w-3.5 h-3.5" />
                                      Convoi
                                    </button>
                                  )}
                                  {/* Gérer les charges */}
                                  <button
                                    onClick={() => handleOpenCharges(d)}
                                    title="Gérer les charges (rations, carburant, péages)"
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                                               bg-[#FEF3C7] text-[#D97706] hover:bg-[#FDE68A]
                                               transition-colors text-xs font-medium whitespace-nowrap"
                                  >
                                    <Banknote className="w-3.5 h-3.5" />
                                    Charges
                                  </button>
                                </>
                              )}
                              {/* Bordereau départ */}
                              <button
                                onClick={() => handlePrintDepart(d.schedule_id)}
                                disabled={printingId === d.schedule_id}
                                title="Imprimer le bordereau de départ"
                                className="p-2 rounded-lg hover:bg-[#d4edda] text-[#0B7439]
                                           transition-colors disabled:opacity-50"
                              >
                                {printingId === d.schedule_id ? (
                                  <RefreshCw className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Printer className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Dernières réservations ──────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white rounded-xl border border-[#E2EAE5]">
              <div className="p-5 border-b border-[#E2EAE5] flex items-center justify-between">
                <h2 className="font-bold text-[#1A2E22] flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-[#0B7439]" />
                  Dernières réservations (aujourd'hui)
                </h2>
              </div>
              <div className="divide-y divide-[#F4F7F5]">
                {recentReservations.length === 0 ? (
                  <div className="py-10 text-center">
                    <p className="text-sm text-[#8AA898]">Aucune réservation aujourd'hui</p>
                  </div>
                ) : recentReservations.map(r => (
                  <div key={r.id} className="px-5 py-3 hover:bg-[#F8FAF8] transition-colors">
                    <div className="flex justify-between items-start mb-1">
                      <p className="font-medium text-sm text-[#1A2E22]">{r.passenger_name}</p>
                      <p className="font-bold text-sm text-[#0B7439]">{formatCurrency(r.total_price)}</p>
                    </div>
                    <div className="flex justify-between items-center">
                      <p className="text-xs text-[#8AA898]">{r.route_label}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        r.payment_status === 'payee' ? 'bg-[#d1fae5] text-[#059669]' : 'bg-[#FEF3C7] text-[#D97706]'
                      }`}>
                        {r.payment_status === 'payee' ? 'Payé' : 'En attente'}
                      </span>
                    </div>
                    <p className="text-xs text-[#8AA898] mt-0.5">
                      {r.total_seats} billet{r.total_seats > 1 ? 's' : ''} · {format(new Date(r.created_at), 'HH:mm')}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Accès rapide */}
            <div className="bg-white rounded-xl border border-[#E2EAE5] p-6">
              <h3 className="font-bold mb-4 text-xs uppercase tracking-wider text-[#8AA898]">Accès rapide</h3>
              <div className="space-y-3">
                {[
                  { label: 'Vendre un billet',   desc: 'Nouvelle réservation',   icon: <TicketCheck className="w-5 h-5" />, path: '/guichetier/booking',            color: '#0B7439', bg: '#d4edda' },
                  { label: 'Vente groupée',      desc: 'Plusieurs billets',      icon: <Users className="w-5 h-5" />,       path: '/guichetier/grouped-sale',      color: '#0369A1', bg: '#E0F2FE' },
                  { label: 'Ma caisse',          desc: 'Transactions du jour',   icon: <DollarSign className="w-5 h-5" />,  path: '/guichetier/cash-register',     color: '#059669', bg: '#d1fae5' },
                  { label: 'Valider rédemption', desc: 'Points de fidélité',     icon: <Gift className="w-5 h-5" />,        path: '/guichetier/loyalty-redemption', color: '#D97706', bg: '#FEF3C7' },
                ].map(item => (
                  <button key={item.path} onClick={() => navigate(item.path)}
                    className="w-full p-4 rounded-xl border-2 border-[#E2EAE5] hover:border-[#0B7439]
                               hover:shadow-sm transition-all text-left flex items-center gap-3 group">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: item.bg }}>
                      <span style={{ color: item.color }}>{item.icon}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-sm text-[#1A2E22]">{item.label}</h4>
                      <p className="text-xs text-[#8AA898]">{item.desc}</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-[#8AA898] opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Validation fidélité ─────────────────────────────── */}
          <div className="bg-white rounded-xl border border-[#E2EAE5]">
            <div className="p-5 border-b border-[#E2EAE5]">
              <h2 className="font-bold text-[#1A2E22] flex items-center gap-2">
                <Gift className="w-4 h-4 text-[#0B7439]" />
                Validation de récompense fidélité
              </h2>
            </div>
            <div className="p-6">
              <div className="flex gap-3 mb-4">
                <input
                  type="text"
                  placeholder="Code de rédemption (ex: SBTA-XXXX)"
                  value={redemptionCode}
                  onChange={e => setRedemptionCode(e.target.value.toUpperCase())}
                  onKeyPress={e => e.key === 'Enter' && handleSearchRedemption()}
                  className="flex-1 px-4 py-2.5 border border-[#E2EAE5] rounded-lg font-mono text-sm
                             focus:outline-none focus:ring-2 focus:ring-[#0B7439]"
                />
                <button onClick={handleSearchRedemption} disabled={searchingCode}
                  className="px-6 py-2.5 rounded-lg font-medium flex items-center gap-2 text-sm
                             bg-[#0B7439] text-white hover:bg-[#085c2d] transition-colors">
                  {searchingCode ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Recherche...</> : <><Search className="w-4 h-4" />Rechercher</>}
                </button>
              </div>
              {redemptionData && (
                <div className="border border-[#E2EAE5] rounded-xl p-5">
                  <div className="grid md:grid-cols-2 gap-6 mb-4">
                    <div>
                      <p className="text-xs font-bold text-[#8AA898] uppercase mb-2">Client</p>
                      <p className="font-semibold text-[#1A2E22]">{redemptionData.customer?.full_name}</p>
                      <p className="text-sm text-[#6B7280]">{redemptionData.customer?.email}</p>
                      {redemptionData.customer?.phone && <p className="text-sm text-[#6B7280]">{redemptionData.customer.phone}</p>}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-[#8AA898] uppercase mb-2">Récompense</p>
                      <p className="font-bold text-lg text-[#0B7439]">{redemptionData.reward?.name}</p>
                      <p className="text-sm text-[#6B7280]">{redemptionData.reward?.description}</p>
                      <p className="text-xs text-[#8AA898] mt-1">Expire le {format(new Date(redemptionData.expires_at), 'dd/MM/yyyy')}</p>
                    </div>
                  </div>
                  <div className="flex justify-center mb-4">
                    <QRCodeSVG value={redemptionData.redemption_code} size={90} />
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => { setRedemptionCode(''); setRedemptionData(null) }}
                      className="flex-1 py-2.5 rounded-lg border border-[#E2EAE5] text-sm text-[#4A6B55] hover:bg-[#F8FAF8]">
                      Annuler
                    </button>
                    {redemptionData.status === 'utilisee' ? (
                      <div className="flex-1 py-2.5 rounded-lg text-center text-sm bg-[#F4F7F5] text-[#8AA898]">
                        Utilisé le {format(new Date(redemptionData.used_at), 'dd/MM/yyyy')}
                      </div>
                    ) : new Date(redemptionData.expires_at) < new Date() ? (
                      <div className="flex-1 py-2.5 rounded-lg text-center text-sm bg-[#f8d7d5] text-[#AF3029]">Code expiré</div>
                    ) : (
                      <button onClick={handleValidateRedemption} disabled={validating}
                        className="flex-1 py-2.5 rounded-lg font-medium flex items-center justify-center gap-2 text-sm
                                   bg-[#059669] text-white hover:bg-[#047857] transition-colors">
                        {validating ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Validation...</> : <><Check className="w-4 h-4" />Valider la récompense</>}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Modale convoi */}
      {convoyDep && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={(e) => { if (e.target === e.currentTarget) closeConvoyModal() }}>
          <div className="rounded-2xl shadow-xl w-full max-w-md bg-white border border-[#E2EAE5]">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-[#E2EAE5]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[#FFF7ED]">
                  <Truck className="w-5 h-5 text-[#F97316]" />
                </div>
                <div>
                  <p className="font-bold text-[#1A2E22]">Enregistrer un convoi</p>
                  <p className="text-xs text-[#6B7280]">
                    Dep. {convoyDep.departure_number ?? '—'} — {format(new Date(convoyDep.departure_datetime), 'HH:mm')} — {convoyDep.route_name}
                  </p>
                </div>
              </div>
              <button onClick={closeConvoyModal}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-[#8AA898]">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Departure info */}
            <div className="mx-6 mt-5 p-4 rounded-xl border border-[#E2EAE5] bg-[#F8FAF8]">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-[#8AA898]">Bus :</span>
                  <span className="ml-1 font-semibold text-[#1A2E22]">{convoyDep.registration_number}</span>
                </div>
                <div>
                  <span className="text-[#8AA898]">Capacite :</span>
                  <span className="ml-1 font-semibold text-[#1A2E22]">{convoyDep.capacity} places</span>
                </div>
                <div>
                  <span className="text-[#8AA898]">Chauffeur :</span>
                  <span className="ml-1 font-semibold text-[#1A2E22]">{convoyDep.driver_name}</span>
                </div>
                <div>
                  <span className="text-[#8AA898]">Destination :</span>
                  <span className="ml-1 font-semibold text-[#1A2E22]">{convoyDep.destination_city}</span>
                </div>
              </div>
            </div>

            {/* Form */}
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-2 text-[#4A6B55]">
                  Montant du convoi (FCFA) *
                </label>
                <div className="relative">
                  <Banknote className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#8AA898]" />
                  <input
                    type="number"
                    min="1"
                    value={convoyAmount}
                    onChange={(e) => setConvoyAmount(e.target.value ? Number(e.target.value) : '')}
                    placeholder="Ex: 500000"
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-[#E2EAE5] text-base font-semibold
                               text-[#1A2E22] bg-white focus:outline-none focus:ring-2 focus:ring-[#EA580C]"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2 text-[#4A6B55]">
                  Observation (optionnel)
                </label>
                <textarea
                  value={convoyObservation}
                  onChange={(e) => setConvoyObservation(e.target.value)}
                  placeholder="Motif ou remarque..."
                  rows={2}
                  className="w-full px-4 py-3 rounded-xl border border-[#E2EAE5] text-sm
                             text-[#1A2E22] bg-white focus:outline-none focus:ring-2 focus:ring-[#EA580C] resize-none"
                />
              </div>

              {/* Confirmation warning */}
              {convoyConfirmStep && (
                <div className="p-4 rounded-xl border-2 bg-[#FEF2F2] border-[#FECACA]">
                  <p className="text-sm font-bold mb-1 text-[#991B1B]">
                    Confirmer l'enregistrement du convoi ?
                  </p>
                  <p className="text-xs text-[#B91C1C]">
                    Cette action est irreversible. Le depart sera cloture, toutes les places seront marquees comme vendues
                    ({convoyDep.capacity}/{convoyDep.capacity}), et aucune vente de billet ne sera plus possible.
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex gap-3 px-6 pb-6">
              <button onClick={closeConvoyModal}
                className="flex-1 px-4 py-3 rounded-xl border border-[#E2EAE5] text-sm font-medium text-[#4A6B55]">
                Annuler
              </button>
              <button
                onClick={handleConvoySubmit}
                disabled={convoySubmitting || !convoyAmount || Number(convoyAmount) <= 0}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50
                           disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{ backgroundColor: convoyConfirmStep ? '#DC2626' : '#EA580C' }}>
                {convoySubmitting ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Enregistrement...</>
                ) : convoyConfirmStep ? (
                  'Confirmer definitivement'
                ) : (
                  <><Truck className="w-4 h-4" /> Enregistrer le convoi</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modale charges */}
      {chargesModal && (
        <ChargesModal
          schedule={chargesModal}
          onClose={() => {
            setChargesModal(null)
            reloadDepartures()
          }}
        />
      )}
    </div>
  )
}
