import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  Download, Printer, Loader2, Filter, Bus, X,
} from 'lucide-react'
import { format, startOfWeek, startOfMonth, startOfYear, endOfWeek, endOfMonth, endOfYear } from 'date-fns'
import { fr } from 'date-fns/locale'
import * as XLSX from 'xlsx'
import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'

import {
  fetchPosSchedules, fetchPosReservations, fetchPosCharges,
  fetchCompaniesHierarchy, fetchBusesForAbg, fetchAgbovilleStations,
  fetchCountersByStations, ABG_SEGMENTS,
  type PosScheduleRow, type PosReservationRow, type PosChargeRow,
} from '@/services/abg.service'

type PeriodId = 'jour' | 'hebdo' | 'mensuel' | 'annuel' | 'custom'

const safe = (v: unknown): number => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0 }
const fmtN = (n: number) => new Intl.NumberFormat('fr-CI', { maximumFractionDigits: 0 }).format(n)
const fmt = (n: number) => fmtN(n) + ' F'

function getDateRange(id: PeriodId, customFrom?: string, customTo?: string): { from: string; to: string } {
  const now = new Date()
  switch (id) {
    case 'jour': return { from: format(now, 'yyyy-MM-dd'), to: format(now, 'yyyy-MM-dd') }
    case 'hebdo': return { from: format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'), to: format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd') }
    case 'mensuel': return { from: format(startOfMonth(now), 'yyyy-MM-dd'), to: format(endOfMonth(now), 'yyyy-MM-dd') }
    case 'annuel': return { from: format(startOfYear(now), 'yyyy-MM-dd'), to: format(endOfYear(now), 'yyyy-MM-dd') }
    case 'custom': return { from: customFrom ?? format(now, 'yyyy-MM-dd'), to: customTo ?? format(now, 'yyyy-MM-dd') }
  }
}

const PERIOD_LABELS: Record<PeriodId, string> = {
  jour: 'Journalier', hebdo: 'Hebdomadaire', mensuel: 'Mensuel', annuel: 'Annuel', custom: 'Personnalisé',
}

interface RecetteRow {
  carMat: string
  depNum: number | string
  routeName: string
  stationName: string
  counterNumber: string
  companyCode: string
  recettes: number
  rations: number
  carburant: number
  peages: number
  autres: number
  resultat: number
}

interface Filters {
  periodId: PeriodId
  customFrom: string
  customTo: string
  segmentCode: string
  companyCode: string
  groupCode: string
  subGroupCode: string
  stationId: string
  counterId: string
  matricule: string
}

export default function SuiviRecettes() {
  const reportRef = useRef<HTMLDivElement>(null)

  const [filters, setFilters] = useState<Filters>({
    periodId: 'mensuel', customFrom: format(new Date(), 'yyyy-MM-dd'), customTo: format(new Date(), 'yyyy-MM-dd'),
    segmentCode: '', companyCode: '', groupCode: '', subGroupCode: '', stationId: '', counterId: '', matricule: '',
  })
  const [showFilters, setShowFilters] = useState(true)

  const [schedules, setSchedules] = useState<PosScheduleRow[]>([])
  const [reservations, setReservations] = useState<PosReservationRow[]>([])
  const [charges, setCharges] = useState<PosChargeRow[]>([])
  const [companies, setCompanies] = useState<{ id: string; code: string; name: string; parent_id: string | null; is_group: boolean }[]>([])
  const [groups, setGroups] = useState<{ code: string; name: string }[]>([])
  const [subGroups, setSubGroups] = useState<{ code: string; name: string; parent_code: string }[]>([])
  const [buses, setBuses] = useState<{ id: string; registration_number: string }[]>([])
  const [stations, setStations] = useState<{ id: string; name: string }[]>([])
  const [counters, setCounters] = useState<{ id: string; counter_number: string; station_id: string }[]>([])
  const [loading, setLoading] = useState(true)

  const { from, to } = useMemo(() => getDateRange(filters.periodId, filters.customFrom, filters.customTo), [filters.periodId, filters.customFrom, filters.customTo])

  useEffect(() => {
    (async () => {
      try {
        const [hier, busList, stationList, counterList] = await Promise.all([
          fetchCompaniesHierarchy(), fetchBusesForAbg(), fetchAgbovilleStations(), fetchCountersByStations(),
        ])
        setCompanies(hier.companies)
        setGroups(hier.groups)
        setSubGroups(hier.subGroups)
        setBuses(busList)
        setStations(stationList)
        setCounters(counterList)
      } catch { /* non-critical */ }
    })()
  }, [])

  const availableSubGroups = useMemo(() => {
    if (!filters.groupCode) return subGroups
    const groupId = companies.find(c => c.code === filters.groupCode)?.id
    if (!groupId) return subGroups
    return subGroups.filter(sg => companies.find(c => c.code === sg.code)?.parent_id === groupId)
  }, [filters.groupCode, subGroups, companies])

  const independentCompanies = useMemo(() => companies.filter(c => !c.is_group && !c.parent_id), [companies])

  const availableCounters = useMemo(() => {
    if (filters.stationId) return counters.filter(c => c.station_id === filters.stationId)
    return counters
  }, [filters.stationId, counters])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const segmentCodes = filters.segmentCode ? [filters.segmentCode] : undefined
      const stationFilterIds = filters.stationId ? [filters.stationId] : undefined
      const counterFilterIds = filters.counterId ? [filters.counterId] : undefined
      const scheds = await fetchPosSchedules({
        dateFrom: from, dateTo: to,
        stationIds: stationFilterIds,
        counterIds: counterFilterIds,
        segmentCodes,
      })
      setSchedules(scheds)

      const sIds = scheds.map(s => s.id)
      if (sIds.length > 0) {
        const [res, chg] = await Promise.all([fetchPosReservations(sIds), fetchPosCharges(sIds)])
        setReservations(res)
        setCharges(chg)
      } else {
        setReservations([])
        setCharges([])
      }
    } catch { /* non-critical */ } finally {
      setLoading(false)
    }
  }, [from, to, filters.stationId, filters.counterId, filters.segmentCode])

  useEffect(() => { loadData() }, [loadData])

  const counterMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of counters) m.set(c.id, c.counter_number)
    return m
  }, [counters])

  const rows: RecetteRow[] = useMemo(() => {
    const resMap = new Map<string, number>()
    for (const r of reservations) {
      if (r.status !== 'confirmed' && r.status !== 'paid' && r.status !== 'confirmee' && r.payment_status !== 'paid' && r.payment_status !== 'payee') continue
      resMap.set(r.schedule_id, (resMap.get(r.schedule_id) ?? 0) + safe(r.total_price) + safe(r.baggage_fee))
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

    return schedules
      .filter(s => {
        if (filters.companyCode && s.company_code !== filters.companyCode) return false
        if (filters.subGroupCode && s.company_code !== filters.subGroupCode) return false
        if (filters.groupCode) {
          const comp = companies.find(c => c.code === s.company_code)
          if (!comp || comp.parent_id !== companies.find(c => c.code === filters.groupCode)?.id) return false
        }
        if (filters.matricule && !(s.bus_registration ?? '').toLowerCase().includes(filters.matricule.toLowerCase())) return false
        return true
      })
      .map(s => {
        const recettes = resMap.get(s.id) ?? 0
        const c = chgMap.get(s.id) ?? { rations: 0, carburant: 0, peages: 0, autres: 0 }
        const totalCharges = c.rations + c.carburant + c.peages + c.autres
        return {
          carMat: s.bus_registration ?? '—',
          depNum: s.departure_number ?? '—',
          routeName: s.route_name ?? '—',
          stationName: s.departure_station_name ?? '—',
          counterNumber: s.counter_id ? counterMap.get(s.counter_id) ?? '—' : '—',
          companyCode: s.company_code ?? '—',
          recettes,
          rations: c.rations,
          carburant: c.carburant,
          peages: c.peages,
          autres: c.autres,
          resultat: recettes - totalCharges,
        }
      })
      .sort((a, b) => b.recettes - a.recettes)
  }, [schedules, reservations, charges, filters, companies, counterMap])

  const totals = useMemo(() => ({
    recettes: rows.reduce((s, r) => s + r.recettes, 0),
    rations: rows.reduce((s, r) => s + r.rations, 0),
    carburant: rows.reduce((s, r) => s + r.carburant, 0),
    peages: rows.reduce((s, r) => s + r.peages, 0),
    autres: rows.reduce((s, r) => s + r.autres, 0),
    resultat: rows.reduce((s, r) => s + r.resultat, 0),
  }), [rows])

  const exportExcel = () => {
    const wb = XLSX.utils.book_new()
    const data = rows.map(r => ({
      'N° Car': r.carMat, 'N° Départ': r.depNum, 'Ligne': r.routeName, 'Gare': r.stationName,
      'Guichet': r.counterNumber, 'Société': r.companyCode,
      'Recettes totales': r.recettes, 'Rations': r.rations,
      'Carburant': r.carburant, 'Péages': r.peages, 'Autres dépenses': r.autres, 'Résultat': r.resultat,
    }))
    data.push({
      'N° Car': 'TOTAL', 'N° Départ': '', 'Ligne': '', 'Gare': '', 'Guichet': '', 'Société': '',
      'Recettes totales': totals.recettes, 'Rations': totals.rations,
      'Carburant': totals.carburant, 'Péages': totals.peages, 'Autres dépenses': totals.autres,
      'Résultat': totals.resultat,
    })
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Suivi des recettes')
    XLSX.writeFile(wb, `suivi_recettes_${from}_${to}.xlsx`)
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
    pdf.save(`suivi_recettes_${from}_${to}.pdf`)
  }

  const resetFilters = () => setFilters(f => ({
    ...f, segmentCode: '', companyCode: '', groupCode: '', subGroupCode: '', stationId: '', counterId: '', matricule: '',
  }))

  const hasActiveFilters = filters.segmentCode || filters.companyCode || filters.groupCode || filters.subGroupCode || filters.stationId || filters.counterId || filters.matricule

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-[#1a2a22]">Suivi des recettes</h1>
          <p className="text-sm mt-1 text-[#6B7280]">
            Données des guichets POS · {PERIOD_LABELS[filters.periodId]} · du {format(new Date(from), 'dd/MM/yyyy', { locale: fr })} au {format(new Date(to), 'dd/MM/yyyy', { locale: fr })}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowFilters(s => !s)}
            className="px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 bg-white border border-[#E2EAE5] text-[#374151] hover:bg-[#F8FAF8]">
            <Filter className="w-3.5 h-3.5" /> Filtres
          </button>
          <button onClick={exportExcel} className="px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 bg-white border border-[#E2EAE5] text-[#374151] hover:bg-[#F8FAF8]">
            <Download className="w-3.5 h-3.5" /> Excel
          </button>
          <button onClick={exportPdf} className="px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 bg-white border border-[#E2EAE5] text-[#374151] hover:bg-[#F8FAF8]">
            <Printer className="w-3.5 h-3.5" /> PDF
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {(Object.keys(PERIOD_LABELS) as PeriodId[]).map(p => (
          <button key={p} onClick={() => setFilters(f => ({ ...f, periodId: p }))}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${filters.periodId === p ? 'text-white' : ''}`}
            style={filters.periodId === p ? { background: '#0B7439' } : { background: '#fff', border: '1px solid #E2EAE5', color: '#374151' }}>
            {PERIOD_LABELS[p]}
          </button>
        ))}
        {filters.periodId === 'custom' && (
          <>
            <input type="date" value={filters.customFrom} onChange={e => setFilters(f => ({ ...f, customFrom: e.target.value }))}
              className="px-2 py-1.5 rounded-lg text-xs border border-[#E2EAE5] text-[#374151]" />
            <span className="text-xs text-[#6B7280]">au</span>
            <input type="date" value={filters.customTo} onChange={e => setFilters(f => ({ ...f, customTo: e.target.value }))}
              className="px-2 py-1.5 rounded-lg text-xs border border-[#E2EAE5] text-[#374151]" />
          </>
        )}
      </div>

      {showFilters && (
        <div className="bg-white rounded-xl border border-[#E2EAE5] p-4 mb-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-[#6B7280] mb-1 block">Ligne</label>
              <select value={filters.segmentCode} onChange={e => setFilters(f => ({ ...f, segmentCode: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-[#E2EAE5] rounded-lg">
                <option value="">Toutes les lignes</option>
                {ABG_SEGMENTS.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-[#6B7280] mb-1 block">Société</label>
              <select value={filters.companyCode} onChange={e => setFilters(f => ({ ...f, companyCode: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-[#E2EAE5] rounded-lg">
                <option value="">Toutes</option>
                {independentCompanies.map(c => <option key={c.id} value={c.code}>{c.code} — {c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-[#6B7280] mb-1 block">Groupe</label>
              <select value={filters.groupCode} onChange={e => setFilters(f => ({ ...f, groupCode: e.target.value, subGroupCode: '' }))}
                className="w-full px-3 py-2 text-sm border border-[#E2EAE5] rounded-lg">
                <option value="">Tous</option>
                {groups.map(g => <option key={g.code} value={g.code}>{g.code} — {g.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-[#6B7280] mb-1 block">Sous-groupe</label>
              <select value={filters.subGroupCode} onChange={e => setFilters(f => ({ ...f, subGroupCode: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-[#E2EAE5] rounded-lg">
                <option value="">Tous</option>
                {availableSubGroups.map(sg => <option key={sg.code} value={sg.code}>{sg.code}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-[#6B7280] mb-1 block">Gare</label>
              <select value={filters.stationId} onChange={e => setFilters(f => ({ ...f, stationId: e.target.value, counterId: '' }))}
                className="w-full px-3 py-2 text-sm border border-[#E2EAE5] rounded-lg">
                <option value="">Toutes</option>
                {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-[#6B7280] mb-1 block">Guichet</label>
              <select value={filters.counterId} onChange={e => setFilters(f => ({ ...f, counterId: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-[#E2EAE5] rounded-lg">
                <option value="">Tous</option>
                {availableCounters.map(c => <option key={c.id} value={c.id}>{c.counter_number}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-[#6B7280] mb-1 block">Matricule du car</label>
              <input value={filters.matricule} onChange={e => setFilters(f => ({ ...f, matricule: e.target.value }))}
                placeholder="ex: 1234 AB 01"
                className="w-full px-3 py-2 text-sm border border-[#E2EAE5] rounded-lg" />
            </div>
          </div>
          {hasActiveFilters && (
            <div className="mt-3 flex justify-end">
              <button onClick={resetFilters} className="text-xs text-[#6B7280] hover:text-[#0B7439] underline flex items-center gap-1">
                <X className="w-3 h-3" /> Réinitialiser les filtres
              </button>
            </div>
          )}
        </div>
      )}

      <div ref={reportRef} className="bg-white rounded-xl border border-[#E2EAE5] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-8 h-8 animate-spin text-[#0B7439]" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40">
            <Bus className="w-10 h-10 text-gray-300 mb-2" />
            <p className="text-sm text-[#9CA3AF]">Aucune donnée POS sur la période sélectionnée pour les 5 lignes.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#F8FAF8] sticky top-0">
                <tr>
                  <th className="text-left px-3 py-3 text-[#4A6B55] font-semibold whitespace-nowrap">N° Car</th>
                  <th className="text-left px-3 py-3 text-[#4A6B55] font-semibold whitespace-nowrap">N° Départ</th>
                  <th className="text-left px-3 py-3 text-[#4A6B55] font-semibold whitespace-nowrap">Ligne</th>
                  <th className="text-left px-3 py-3 text-[#4A6B55] font-semibold whitespace-nowrap">Gare</th>
                  <th className="text-left px-3 py-3 text-[#4A6B55] font-semibold whitespace-nowrap">Guichet</th>
                  <th className="text-left px-3 py-3 text-[#4A6B55] font-semibold whitespace-nowrap">Société</th>
                  <th className="text-right px-3 py-3 text-[#4A6B55] font-semibold whitespace-nowrap">Recettes totales</th>
                  <th className="text-right px-3 py-3 text-[#4A6B55] font-semibold whitespace-nowrap">Rations</th>
                  <th className="text-right px-3 py-3 text-[#4A6B55] font-semibold whitespace-nowrap">Carburant</th>
                  <th className="text-right px-3 py-3 text-[#4A6B55] font-semibold whitespace-nowrap">Péages</th>
                  <th className="text-right px-3 py-3 text-[#4A6B55] font-semibold whitespace-nowrap">Autres dépenses</th>
                  <th className="text-right px-3 py-3 text-[#4A6B55] font-semibold whitespace-nowrap">Résultat</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-[#E2EAE5] hover:bg-[#F8FAF8] transition-colors">
                    <td className="px-3 py-2.5 font-medium text-[#1a2a22] whitespace-nowrap">{r.carMat}</td>
                    <td className="px-3 py-2.5 text-[#374151]">{r.depNum}</td>
                    <td className="px-3 py-2.5 text-[#374151] max-w-[200px] truncate">{r.routeName}</td>
                    <td className="px-3 py-2.5 text-[#6B7280] whitespace-nowrap">{r.stationName}</td>
                    <td className="px-3 py-2.5 text-[#6B7280] whitespace-nowrap">{r.counterNumber}</td>
                    <td className="px-3 py-2.5 text-[#6B7280] whitespace-nowrap">{r.companyCode}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-[#1a2a22] whitespace-nowrap">{fmt(r.recettes)}</td>
                    <td className="px-3 py-2.5 text-right text-orange-600 whitespace-nowrap">{fmt(r.rations)}</td>
                    <td className="px-3 py-2.5 text-right text-blue-600 whitespace-nowrap">{fmt(r.carburant)}</td>
                    <td className="px-3 py-2.5 text-right text-[#0B7439] whitespace-nowrap">{fmt(r.peages)}</td>
                    <td className="px-3 py-2.5 text-right text-[#6B7280] whitespace-nowrap">{fmt(r.autres)}</td>
                    <td className={`px-3 py-2.5 text-right font-bold whitespace-nowrap ${r.resultat >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(r.resultat)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-[#0B7439]/5 border-t-2 border-[#0B7439]/20">
                <tr className="font-bold">
                  <td className="px-3 py-3 text-[#1a2a22]" colSpan={6}>TOTAL ({rows.length} lignes)</td>
                  <td className="px-3 py-3 text-right text-[#1a2a22] whitespace-nowrap">{fmt(totals.recettes)}</td>
                  <td className="px-3 py-3 text-right text-orange-700 whitespace-nowrap">{fmt(totals.rations)}</td>
                  <td className="px-3 py-3 text-right text-blue-700 whitespace-nowrap">{fmt(totals.carburant)}</td>
                  <td className="px-3 py-3 text-right text-[#0B7439] whitespace-nowrap">{fmt(totals.peages)}</td>
                  <td className="px-3 py-3 text-right text-[#6B7280] whitespace-nowrap">{fmt(totals.autres)}</td>
                  <td className={`px-3 py-3 text-right whitespace-nowrap ${totals.resultat >= 0 ? 'text-green-700' : 'text-red-700'}`}>{fmt(totals.resultat)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
