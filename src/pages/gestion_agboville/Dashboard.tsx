import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  TrendingUp, TrendingDown, DollarSign, Bus, Calendar, Ticket,
  Receipt, LayoutDashboard, Download, Loader2, BarChart3, FileText,
} from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts'
import { format, startOfWeek, startOfMonth, startOfYear, endOfWeek, endOfMonth, endOfYear } from 'date-fns'
import { fr } from 'date-fns/locale'
import * as XLSX from 'xlsx'
import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'

import {
  fetchPosSchedules, fetchPosReservations, fetchPosCharges,
  fetchDepenses, fetchSocietes,
  type PosScheduleRow, type PosReservationRow, type PosChargeRow,
  type AbgDepense, type AbgSociete,
} from '@/services/abg.service'
import { formatCFA } from '@/utils/formatCurrency'

type PeriodId = 'jour' | 'hebdo' | 'mensuel' | 'annuel' | 'custom'

const safe = (v: unknown): number => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

const fmtN = (n: number) => new Intl.NumberFormat('fr-CI', { maximumFractionDigits: 0 }).format(n)
const fmt = (n: number) => fmtN(n) + ' F'
const fmtM = (n: number) =>
  Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(0) + 'k' : String(Math.round(n))

function getDateRange(id: PeriodId, customFrom?: string, customTo?: string): { from: string; to: string } {
  const now = new Date()
  switch (id) {
    case 'jour':
      return { from: format(now, 'yyyy-MM-dd'), to: format(now, 'yyyy-MM-dd') }
    case 'hebdo':
      return { from: format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'), to: format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd') }
    case 'mensuel':
      return { from: format(startOfMonth(now), 'yyyy-MM-dd'), to: format(endOfMonth(now), 'yyyy-MM-dd') }
    case 'annuel':
      return { from: format(startOfYear(now), 'yyyy-MM-dd'), to: format(endOfYear(now), 'yyyy-MM-dd') }
    case 'custom':
      return { from: customFrom ?? format(now, 'yyyy-MM-dd'), to: customTo ?? format(now, 'yyyy-MM-dd') }
  }
}

const PERIOD_LABELS: Record<PeriodId, string> = {
  jour: 'Journalier', hebdo: 'Hebdomadaire', mensuel: 'Mensuel', annuel: 'Annuel', custom: 'Personnalisé',
}

interface ScheduleAgg {
  schedule: PosScheduleRow
  recettes: number
  tickets: number
  sieges: number
  rations: number
  carburant: number
  peages: number
  autres: number
}

export default function GestionAgbovilleDashboard() {
  const navigate = useNavigate()
  const reportRef = useRef<HTMLDivElement>(null)

  const [periodId, setPeriodId] = useState<PeriodId>('mensuel')
  const [customFrom, setCustomFrom] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [customTo, setCustomTo] = useState(format(new Date(), 'yyyy-MM-dd'))

  const [schedules, setSchedules] = useState<PosScheduleRow[]>([])
  const [reservations, setReservations] = useState<PosReservationRow[]>([])
  const [charges, setCharges] = useState<PosChargeRow[]>([])
  const [depenses, setDepenses] = useState<AbgDepense[]>([])
  const [societes, setSocietes] = useState<AbgSociete[]>([])
  const [loading, setLoading] = useState(true)

  const { from, to } = useMemo(() => getDateRange(periodId, customFrom, customTo), [periodId, customFrom, customTo])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [scheds, deps, socs] = await Promise.all([
        fetchPosSchedules({ dateFrom: from, dateTo: to }),
        fetchDepenses({ dateFrom: from, dateTo: to }),
        fetchSocietes(),
      ])
      setSchedules(scheds)
      setDepenses(deps)
      setSocietes(socs)

      const sIds = scheds.map(s => s.id)
      if (sIds.length > 0) {
        const [res, chg] = await Promise.all([
          fetchPosReservations(sIds),
          fetchPosCharges(sIds),
        ])
        setReservations(res)
        setCharges(chg)
      } else {
        setReservations([])
        setCharges([])
      }
    } catch { /* non-critical */ } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => { loadData() }, [loadData])

  const aggBySchedule = useMemo<ScheduleAgg[]>(() => {
    const resMap = new Map<string, { recettes: number; tickets: number; sieges: number }>()
    for (const r of reservations) {
      if (r.status !== 'confirmed' && r.status !== 'paid' && r.payment_status !== 'paid') continue
      const prev = resMap.get(r.schedule_id) ?? { recettes: 0, tickets: 0, sieges: 0 }
      prev.recettes += safe(r.total_price) + safe(r.baggage_fee)
      prev.tickets += 1
      prev.sieges += safe(r.total_seats)
      resMap.set(r.schedule_id, prev)
    }

    const chgMap = new Map<string, { rations: number; carburant: number; peages: number; autres: number }>()
    for (const c of charges) {
      const prev = chgMap.get(c.schedule_id) ?? { rations: 0, carburant: 0, peages: 0, autres: 0 }
      const amt = safe(c.amount)
      if (c.charge_type === 'ration') prev.rations += amt
      else if (c.charge_type === 'carburant_complement') prev.carburant += amt
      else if (c.charge_type === 'peage') prev.peages += amt
      else prev.autres += amt
      chgMap.set(c.schedule_id, prev)
    }

    return schedules.map(s => {
      const r = resMap.get(s.id) ?? { recettes: 0, tickets: 0, sieges: 0 }
      const c = chgMap.get(s.id) ?? { rations: 0, carburant: 0, peages: 0, autres: 0 }
      return { schedule: s, ...r, ...c }
    })
  }, [schedules, reservations, charges])

  const kpis = useMemo(() => {
    const totalRecettes = aggBySchedule.reduce((s, r) => s + r.recettes, 0)
    const totalDepensesPr = aggBySchedule.reduce((s, r) => s + r.rations + r.carburant + r.peages + r.autres, 0)
    const totalDepensesAo = depenses.filter(d => d.type_depense === 'AO').reduce((s, d) => s + safe(d.montant), 0)
    const totalDepensesHao = depenses.filter(d => d.type_depense === 'HAO').reduce((s, d) => s + safe(d.montant), 0)
    const totalCharges = totalDepensesPr + totalDepensesAo + totalDepensesHao
    const resultatNet = totalRecettes - totalCharges
    const nbCars = new Set(aggBySchedule.map(r => r.schedule.bus_id).filter(Boolean)).size
    const nbDeparts = aggBySchedule.length
    const nbBillets = aggBySchedule.reduce((s, r) => s + r.tickets, 0)
    const nbSieges = aggBySchedule.reduce((s, r) => s + r.sieges, 0)
    return { totalRecettes, totalDepensesPr, totalDepensesAo, totalDepensesHao, totalCharges, resultatNet, nbCars, nbDeparts, nbBillets, nbSieges }
  }, [aggBySchedule, depenses])

  const series = useMemo(() => {
    const dayMap = new Map<string, { revenue: number; charges: number }>()
    for (const a of aggBySchedule) {
      const day = format(new Date(a.schedule.departure_datetime), 'yyyy-MM-dd')
      if (!dayMap.has(day)) dayMap.set(day, { revenue: 0, charges: 0 })
      const d = dayMap.get(day)!
      d.revenue += a.recettes
      d.charges += a.rations + a.carburant + a.peages + a.autres
    }
    for (const dep of depenses) {
      const day = dep.date_depense
      if (!dayMap.has(day)) dayMap.set(day, { revenue: 0, charges: 0 })
      dayMap.get(day)!.charges += safe(dep.montant)
    }
    return Array.from(dayMap.entries())
      .map(([day, v]) => ({ day, revenue: v.revenue, charges: v.charges }))
      .sort((a, b) => a.day.localeCompare(b.day))
  }, [aggBySchedule, depenses])

  const exportExcel = () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
      'Total recettes': kpis.totalRecettes,
      'Total dépenses P/R': kpis.totalDepensesPr,
      'Dépenses AO': kpis.totalDepensesAo,
      'Dépenses HAO': kpis.totalDepensesHao,
      'Total charges': kpis.totalCharges,
      'Résultat net': kpis.resultatNet,
      'Nombre de cars': kpis.nbCars,
      'Nombre de départs': kpis.nbDeparts,
      'Billets vendus': kpis.nbBillets,
      'Sièges vendus': kpis.nbSieges,
    }]), 'Synthèse')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(series.map(s => ({
      Date: s.day, Recettes: s.revenue, Charges: s.charges,
    }))), 'Évolution')
    XLSX.writeFile(wb, `dashboard_agboville_${from}_${to}.xlsx`)
  }

  const exportPdf = async () => {
    if (!reportRef.current) return
    const canvas = await html2canvas(reportRef.current, { scale: 1.5, useCORS: true, backgroundColor: '#ffffff' })
    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const w = pdf.internal.pageSize.getWidth()
    const h = (canvas.height * w) / canvas.width
    const pageH = pdf.internal.pageSize.getHeight()
    let y = 0
    while (y < h) {
      if (y > 0) pdf.addPage()
      pdf.addImage(imgData, 'PNG', 0, -y, w, h)
      y += pageH
    }
    pdf.save(`dashboard_agboville_${from}_${to}.pdf`)
  }

  const kpiCard = (label: string, val: string | number, icon: React.ReactNode, positive?: boolean) => (
    <div className="rounded-xl p-4 bg-white border border-[#E2EAE5]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-[#6B7280]">{label}</span>
        <span style={{ color: positive === undefined ? '#6B7280' : positive ? '#10B981' : '#EF4444' }}>{icon}</span>
      </div>
      <p className="text-lg font-bold" style={{ color: positive === undefined ? '#1a2a22' : positive ? '#10B981' : '#EF4444' }}>
        {typeof val === 'number' ? fmt(val) : val}
      </p>
    </div>
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-[#0B7439]" />
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <LayoutDashboard className="w-6 h-6 text-[#0B7439]" />
            <h1 className="text-xl font-bold text-[#1a2a22]">Tableau de bord — Gestion Agboville</h1>
          </div>
          <p className="text-sm mt-1 text-[#6B7280]">
            {PERIOD_LABELS[periodId]} · du {format(new Date(from), 'dd/MM/yyyy', { locale: fr })} au {format(new Date(to), 'dd/MM/yyyy', { locale: fr })}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportExcel} className="px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 bg-white border border-[#E2EAE5] text-[#374151] hover:bg-[#F8FAF8]">
            <Download className="w-3.5 h-3.5" /> Excel
          </button>
          <button onClick={exportPdf} className="px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 bg-white border border-[#E2EAE5] text-[#374151] hover:bg-[#F8FAF8]">
            <Download className="w-3.5 h-3.5" /> PDF
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {(Object.keys(PERIOD_LABELS) as PeriodId[]).map(p => (
          <button key={p} onClick={() => setPeriodId(p)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${periodId === p ? 'text-white' : ''}`}
            style={periodId === p ? { background: '#0B7439' } : { background: '#fff', border: '1px solid #E2EAE5', color: '#374151' }}>
            {PERIOD_LABELS[p]}
          </button>
        ))}
        {periodId === 'custom' && (
          <>
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              className="px-2 py-1.5 rounded-lg text-xs border border-[#E2EAE5] text-[#374151]" />
            <span className="text-xs text-[#6B7280]">au</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              className="px-2 py-1.5 rounded-lg text-xs border border-[#E2EAE5] text-[#374151]" />
          </>
        )}
      </div>

      <div ref={reportRef}>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
          {kpiCard('Total recettes', kpis.totalRecettes, <DollarSign className="w-4 h-4" />, true)}
          {kpiCard('Total dépenses', kpis.totalDepensesPr + kpis.totalDepensesAo + kpis.totalDepensesHao, <Receipt className="w-4 h-4" />, false)}
          {kpiCard('Total charges', kpis.totalCharges, <Receipt className="w-4 h-4" />, false)}
          {kpiCard('Résultat net', kpis.resultatNet, kpis.resultatNet >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />, kpis.resultatNet >= 0)}
          {kpiCard('Nombre de cars', kpis.nbCars, <Bus className="w-4 h-4" />)}
          {kpiCard('Nombre de départs', kpis.nbDeparts, <Calendar className="w-4 h-4" />)}
          {kpiCard('Billets vendus', kpis.nbBillets, <Ticket className="w-4 h-4" />)}
          {kpiCard('Sièges vendus', kpis.nbSieges, <Ticket className="w-4 h-4" />)}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <div className="lg:col-span-2 bg-white rounded-xl p-4 border border-[#E2EAE5]">
            <h3 className="text-sm font-bold mb-3 text-[#1a2a22]">Évolution des recettes et charges</h3>
            {series.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={series}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="chgGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#EF4444" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2EAE5" />
                  <XAxis dataKey="day" tickFormatter={d => format(new Date(d), 'dd/MM', { locale: fr })} tick={{ fontSize: 10 }} stroke="#6B7280" />
                  <YAxis tickFormatter={fmtM} tick={{ fontSize: 10 }} stroke="#6B7280" />
                  <Tooltip formatter={(v: number) => fmt(v)} labelFormatter={l => format(new Date(l), 'dd/MM/yyyy', { locale: fr })} />
                  <Area type="monotone" dataKey="revenue" name="Recettes" stroke="#10B981" fill="url(#revGrad)" strokeWidth={2} />
                  <Area type="monotone" dataKey="charges" name="Charges" stroke="#EF4444" fill="url(#chgGrad)" strokeWidth={2} strokeDasharray="5 5" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[260px] flex items-center justify-center text-sm text-[#9CA3AF]">Aucune donnée sur la période</div>
            )}
          </div>

          <div className="bg-white rounded-xl p-4 border border-[#E2EAE5]">
            <h3 className="text-sm font-bold mb-3 text-[#1a2a22]">Répartition des charges</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={[
                { name: 'Rations', val: aggBySchedule.reduce((s, r) => s + r.rations, 0), color: '#F59E0B' },
                { name: 'Carburant', val: aggBySchedule.reduce((s, r) => s + r.carburant, 0), color: '#3B82F6' },
                { name: 'Péages', val: aggBySchedule.reduce((s, r) => s + r.peages, 0), color: '#10B981' },
                { name: 'Autres', val: aggBySchedule.reduce((s, r) => s + r.autres, 0), color: '#6B7280' },
                { name: 'AO', val: kpis.totalDepensesAo, color: '#8B5CF6' },
                { name: 'HAO', val: kpis.totalDepensesHao, color: '#A855F7' },
              ].filter(e => e.val > 0)} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#E2EAE5" />
                <XAxis type="number" tickFormatter={fmtM} tick={{ fontSize: 10 }} stroke="#6B7280" />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} stroke="#6B7280" width={70} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Bar dataKey="val" radius={[0, 4, 4, 0]}>
                  {[{ name: '', val: 0, color: '#0B7439' }].map((_, i) => <Cell key={i} fill="#0B7439" />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-6">
        <button onClick={() => navigate('/gestion-agboville/suivi-recettes')}
          className="rounded-xl p-5 text-left flex items-start gap-3 transition-all hover:shadow-md bg-white border border-[#E2EAE5]">
          <BarChart3 className="w-6 h-6 text-[#0B7439]" />
          <div>
            <p className="text-sm font-bold text-[#1a2a22]">Suivi des recettes</p>
            <p className="text-xs text-[#6B7280]">Détail par car et départ : recettes, rations, carburant, péages, résultat</p>
          </div>
        </button>
        <button onClick={() => navigate('/gestion-agboville/rapport-consolide')}
          className="rounded-xl p-5 text-left flex items-start gap-3 transition-all hover:shadow-md bg-white border border-[#E2EAE5]">
          <FileText className="w-6 h-6 text-[#0B7439]" />
          <div>
            <p className="text-sm font-bold text-[#1a2a22]">Rapport financier consolidé</p>
            <p className="text-xs text-[#6B7280]">Consolidation de toutes les recettes et charges — bénéfice net</p>
          </div>
        </button>
      </div>
    </div>
  )
}
