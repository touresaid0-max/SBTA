import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  Download, Printer, Loader2, Filter, FileText, X, TrendingUp, TrendingDown,
} from 'lucide-react'
import { format, startOfWeek, startOfMonth, startOfYear, endOfWeek, endOfMonth, endOfYear } from 'date-fns'
import { fr } from 'date-fns/locale'
import * as XLSX from 'xlsx'
import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'

import {
  fetchPosSchedules, fetchPosReservations, fetchPosCharges,
  fetchDepenses, fetchCompaniesHierarchy, fetchAgbovilleStations, fetchBusesForAbg, classifyCharge,
  type PosScheduleRow, type PosReservationRow, type PosChargeRow,
  type AbgDepense,
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

interface Filters {
  periodId: PeriodId
  customFrom: string
  customTo: string
  companyCode: string
  groupCode: string
  subGroupCode: string
  stationId: string
}

export default function RapportConsolide() {
  const reportRef = useRef<HTMLDivElement>(null)

  const [filters, setFilters] = useState<Filters>({
    periodId: 'mensuel', customFrom: format(new Date(), 'yyyy-MM-dd'), customTo: format(new Date(), 'yyyy-MM-dd'),
    companyCode: '', groupCode: '', subGroupCode: '', stationId: '',
  })
  const [showFilters, setShowFilters] = useState(true)

  const [schedules, setSchedules] = useState<PosScheduleRow[]>([])
  const [reservations, setReservations] = useState<PosReservationRow[]>([])
  const [charges, setCharges] = useState<PosChargeRow[]>([])
  const [depenses, setDepenses] = useState<AbgDepense[]>([])
  const [companies, setCompanies] = useState<{ id: string; code: string; name: string; parent_id: string | null; is_group: boolean }[]>([])
  const [groups, setGroups] = useState<{ code: string; name: string }[]>([])
  const [subGroups, setSubGroups] = useState<{ code: string; name: string; parent_code: string }[]>([])
  const [stations, setStations] = useState<{ id: string; name: string }[]>([])
  const [buses, setBuses] = useState<{ id: string; registration_number: string; company_id: string | null }[]>([])
  const [loading, setLoading] = useState(true)

  const { from, to } = useMemo(() => getDateRange(filters.periodId, filters.customFrom, filters.customTo), [filters.periodId, filters.customFrom, filters.customTo])

  useEffect(() => {
    (async () => {
      try {
        const [hier, stationList, busList] = await Promise.all([fetchCompaniesHierarchy(), fetchAgbovilleStations(), fetchBusesForAbg()])
        setCompanies(hier.companies); setGroups(hier.groups); setSubGroups(hier.subGroups); setStations(stationList); setBuses(busList.map(b => ({ id: b.id, registration_number: b.registration_number, company_id: b.company_id })))
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

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const stationFilterIds = filters.stationId ? [filters.stationId] : undefined
      const [scheds, deps] = await Promise.all([
        fetchPosSchedules({ dateFrom: from, dateTo: to, stationIds: stationFilterIds }),
        fetchDepenses({ dateFrom: from, dateTo: to }),
      ])
      setSchedules(scheds)
      setDepenses(deps)

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
  }, [from, to, filters.stationId])

  useEffect(() => { loadData() }, [loadData])

  const filteredSchedules = useMemo(() => {
    return schedules.filter(s => {
      if (filters.companyCode && s.company_code !== filters.companyCode) return false
      if (filters.subGroupCode && s.company_code !== filters.subGroupCode) return false
      if (filters.groupCode) {
        const comp = companies.find(c => c.code === s.company_code)
        if (!comp || comp.parent_id !== companies.find(c => c.code === filters.groupCode)?.id) return false
      }
      return true
    })
  }, [schedules, filters, companies])

  const report = useMemo(() => {
    const validScheduleIds = new Set(filteredSchedules.map(s => s.id))

    let totalRecettes = 0
    for (const r of reservations) {
      if (!validScheduleIds.has(r.schedule_id)) continue
      if (r.status !== 'confirmed' && r.status !== 'paid' && r.status !== 'confirmee' && r.payment_status !== 'paid' && r.payment_status !== 'payee') continue
      totalRecettes += safe(r.total_price) + safe(r.baggage_fee)
    }

    let rations = 0, carburant = 0, peages = 0, autres = 0
    for (const c of charges) {
      if (!validScheduleIds.has(c.schedule_id)) continue
      const amt = safe(c.amount)
      const cat = classifyCharge(c.charge_type, c.description)
      if (cat === 'rations') rations += amt
      else if (cat === 'carburant') carburant += amt
      else if (cat === 'peages') peages += amt
      else autres += amt
    }

    const totalChargesPr = rations + carburant + peages + autres

    const companyIdToCode = new Map<string, string>()
    for (const c of companies) companyIdToCode.set(c.id, c.code)
    const matriculeToCompanyCode = new Map<string, string | null>()
    for (const b of buses) {
      const code = b.company_id ? companyIdToCode.get(b.company_id) ?? null : null
      matriculeToCompanyCode.set(b.registration_number, code)
    }

    function depenseMatchesCompany(d: AbgDepense): boolean {
      let depCompanyCode: string | null = null
      if (d.type_depense === 'HAO') {
        depCompanyCode = d.societe_code
      } else {
        depCompanyCode = d.car_matricule ? matriculeToCompanyCode.get(d.car_matricule) ?? null : d.societe_code
      }
      if (!depCompanyCode) return false
      if (filters.companyCode && depCompanyCode !== filters.companyCode) return false
      if (filters.subGroupCode && depCompanyCode !== filters.subGroupCode) return false
      if (filters.groupCode) {
        const comp = companies.find(c => c.code === depCompanyCode)
        if (!comp || comp.parent_id !== companies.find(c => c.code === filters.groupCode)?.id) return false
      }
      return true
    }

    const filteredDepenses = depenses.filter(depenseMatchesCompany)

    const totalDepensesAo = filteredDepenses.filter(d => d.type_depense === 'AO').reduce((s, d) => s + safe(d.montant), 0)
    const totalDepensesHao = filteredDepenses.filter(d => d.type_depense === 'HAO').reduce((s, d) => s + safe(d.montant), 0)

    const totalChargesGeneral = totalChargesPr + totalDepensesAo + totalDepensesHao
    const beneficeNet = totalRecettes - totalChargesGeneral

    return { totalRecettes, rations, carburant, peages, autres, totalChargesPr, totalDepensesAo, totalDepensesHao, totalChargesGeneral, beneficeNet }
  }, [filteredSchedules, reservations, charges, depenses, filters, companies, buses])

  const exportExcel = () => {
    const wb = XLSX.utils.book_new()
    const data = [
      { 'Indicateur': 'Total recettes', 'Montant': report.totalRecettes },
      { 'Indicateur': 'Péages', 'Montant': report.peages },
      { 'Indicateur': 'Rations', 'Montant': report.rations },
      { 'Indicateur': 'Carburant', 'Montant': report.carburant },
      { 'Indicateur': 'Autres dépenses (P/R)', 'Montant': report.autres },
      { 'Indicateur': 'Total charges P/R', 'Montant': report.totalChargesPr },
      { 'Indicateur': 'Total dépenses AO', 'Montant': report.totalDepensesAo },
      { 'Indicateur': 'Total dépenses HAO', 'Montant': report.totalDepensesHao },
      { 'Indicateur': 'Total charges général', 'Montant': report.totalChargesGeneral },
      { 'Indicateur': 'Bénéfice net', 'Montant': report.beneficeNet },
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Rapport consolidé')
    XLSX.writeFile(wb, `rapport_consolide_${from}_${to}.xlsx`)
  }

  const exportPdf = async () => {
    if (!reportRef.current) return
    const canvas = await html2canvas(reportRef.current, { scale: 1.5, useCORS: true, backgroundColor: '#ffffff' })
    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const w = pdf.internal.pageSize.getWidth()
    const h = (canvas.height * w) / canvas.width
    const pageH = pdf.internal.pageSize.getHeight()
    let y = 0
    while (y < h) {
      if (y > 0) pdf.addPage()
      pdf.addImage(imgData, 'PNG', 0, -y, w, h)
      y += pageH
    }
    pdf.save(`rapport_consolide_${from}_${to}.pdf`)
  }

  const resetFilters = () => setFilters(f => ({ ...f, companyCode: '', groupCode: '', subGroupCode: '', stationId: '' }))
  const hasActiveFilters = filters.companyCode || filters.groupCode || filters.subGroupCode || filters.stationId

  const lineItem = (label: string, val: number, isTotal?: boolean, isResult?: boolean) => (
    <tr className={`border-t border-[#E2EAE5] ${isTotal ? 'bg-[#F8FAF8] font-bold' : ''}`}>
      <td className="px-4 py-3 text-[#374151]">
        {isResult && <span className="mr-1">{val >= 0 ? <TrendingUp className="w-4 h-4 inline text-green-600" /> : <TrendingDown className="w-4 h-4 inline text-red-600" />}</span>}
        {label}
      </td>
      <td className={`px-4 py-3 text-right whitespace-nowrap ${isResult ? (val >= 0 ? 'text-green-600' : 'text-red-600') : 'text-[#1a2a22]'} ${isTotal ? 'font-bold' : ''}`}>
        {fmt(val)}
      </td>
    </tr>
  )

  return (
    <div className="p-4 lg:p-6 max-w-[1200px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="w-6 h-6 text-[#0B7439]" />
            <h1 className="text-xl font-bold text-[#1a2a22]">Rapport financier consolidé</h1>
          </div>
          <p className="text-sm mt-1 text-[#6B7280]">
            {PERIOD_LABELS[filters.periodId]} · du {format(new Date(from), 'dd/MM/yyyy', { locale: fr })} au {format(new Date(to), 'dd/MM/yyyy', { locale: fr })}
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
              <select value={filters.stationId} onChange={e => setFilters(f => ({ ...f, stationId: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-[#E2EAE5] rounded-lg">
                <option value="">Toutes</option>
                {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
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
        ) : (
          <div className="p-6">
            <div className="mb-4">
              <h2 className="text-lg font-bold text-[#1a2a22]">Synthèse financière consolidée</h2>
              <p className="text-xs text-[#6B7280] mt-1">
                Consolidation automatique des recettes (ventes guichet) et charges (P/R, dépenses AO/HAO).
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#F8FAF8]">
                  <tr>
                    <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Indicateur</th>
                    <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItem('Total recettes', report.totalRecettes, true)}
                  {lineItem('Péages', report.peages)}
                  {lineItem('Rations', report.rations)}
                  {lineItem('Carburant', report.carburant)}
                  {lineItem('Autres dépenses (P/R)', report.autres)}
                  {lineItem('Total charges P/R', report.totalChargesPr, true)}
                  {lineItem('Total dépenses AO', report.totalDepensesAo)}
                  {lineItem('Total dépenses HAO', report.totalDepensesHao)}
                  {lineItem('Total charges général', report.totalChargesGeneral, true)}
                  {lineItem('Bénéfice net', report.beneficeNet, true, true)}
                </tbody>
              </table>
            </div>

            <div className="mt-6 p-4 rounded-lg" style={{ background: report.beneficeNet >= 0 ? '#ECFDF5' : '#FEF2F2' }}>
              <div className="flex items-center gap-3">
                {report.beneficeNet >= 0
                  ? <TrendingUp className="w-8 h-8 text-green-600" />
                  : <TrendingDown className="w-8 h-8 text-red-600" />}
                <div>
                  <p className="text-xs font-semibold text-[#6B7280]">Bénéfice net = Total recettes − Total charges − Dépenses AO − Dépenses HAO</p>
                  <p className="text-2xl font-bold" style={{ color: report.beneficeNet >= 0 ? '#10B981' : '#EF4444' }}>
                    {fmt(report.beneficeNet)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
