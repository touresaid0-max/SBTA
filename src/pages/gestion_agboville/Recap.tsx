import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  fetchBordereaux, fetchDepenses, fetchSocietes, fetchSegments, formatCFA,
  type Bordereau, type AbgDepense, type AbgSociete, type AbgSegment,
} from '@/services/abg.service'
import {
  ClipboardList, ChevronDown, ChevronRight, Calendar, TrendingUp, FileDown, FileSpreadsheet,
} from 'lucide-react'
import { Fragment } from 'react'
import toast from 'react-hot-toast'
import { exportPDF, exportTableExcel } from '@/utils/abgExports'

type Period = 'hebdo' | 'mensuel' | 'annuel'

const SOCIETE_ORDER = ['SBTA', 'TST', 'ETL', 'SNT', 'GROUP_OUME', 'AUTRES']

export default function Recap() {
  const [bordereaux, setBordereaux] = useState<Bordereau[]>([])
  const [depenses, setDepenses] = useState<AbgDepense[]>([])
  const [societes, setSocietes] = useState<AbgSociete[]>([])
  const [segments, setSegments] = useState<AbgSegment[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<Period>('mensuel')
  const [periodValue, setPeriodValue] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [b, d, s, seg] = await Promise.all([
        fetchBordereaux(),
        fetchDepenses(),
        fetchSocietes(),
        fetchSegments(),
      ])
      setBordereaux(b)
      setDepenses(d)
      setSocietes(s)
      setSegments(seg)
    } catch { toast.error('Erreur lors du chargement') }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Derive period options from bordereaux dates
  const periodOptions = useMemo(() => {
    const set = new Set<string>()
    bordereaux.forEach(b => {
      const d = new Date(b.bordereau_date)
      if (period === 'hebdo') {
        const year = d.getFullYear()
        const onejan = new Date(year, 0, 1)
        const week = Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7)
        set.add(`${year}-S${String(week).padStart(2, '0')}`)
      } else if (period === 'mensuel') {
        set.add(d.toISOString().slice(0, 7))
      } else {
        set.add(String(d.getFullYear()))
      }
    })
    const arr = Array.from(set).sort().reverse()
    if (arr.length > 0 && !periodValue) setPeriodValue(arr[0])
    return arr
  }, [bordereaux, period, periodValue])

  // Filter bordereaux by selected period
  const filteredBords = useMemo(() => {
    if (!periodValue) return bordereaux
    return bordereaux.filter(b => {
      const d = new Date(b.bordereau_date)
      if (period === 'hebdo') {
        const year = d.getFullYear()
        const onejan = new Date(year, 0, 1)
        const week = Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7)
        const key = `${year}-S${String(week).padStart(2, '0')}`
        return key === periodValue
      } else if (period === 'mensuel') {
        return d.toISOString().slice(0, 7) === periodValue
      } else {
        return String(d.getFullYear()) === periodValue
      }
    })
  }, [bordereaux, period, periodValue])

  const filteredDepenses = useMemo(() => {
    if (!periodValue) return depenses
    return depenses.filter(d => {
      const dt = new Date(d.date_depense)
      if (period === 'hebdo') {
        const year = dt.getFullYear()
        const onejan = new Date(year, 0, 1)
        const week = Math.ceil(((dt.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7)
        const key = `${year}-S${String(week).padStart(2, '0')}`
        return key === periodValue
      } else if (period === 'mensuel') {
        return dt.toISOString().slice(0, 7) === periodValue
      } else {
        return String(dt.getFullYear()) === periodValue
      }
    })
  }, [depenses, period, periodValue])

  // Consolidation par société
  const bySociete = useMemo(() => {
    const map: Record<string, { recettes: number; depense_pr: number; resultats: number; bagage: number }> = {}
    SOCIETE_ORDER.forEach(s => { map[s] = { recettes: 0, depense_pr: 0, resultats: 0, bagage: 0 } })

    filteredBords.forEach(b => {
      const key = b.societe_code
      if (!map[key]) map[key] = { recettes: 0, depense_pr: 0, resultats: 0, bagage: 0 }
      map[key].recettes += Number(b.total_mt_ticket)
      map[key].depense_pr += Number(b.total_depense_pr)
      map[key].resultats += Number(b.total_solde)
      map[key].bagage += Number(b.total_baggage)
    })

    // Add AO/HAO dépenses by société
    filteredDepenses.forEach(d => {
      const key = d.societe_code || 'AUTRES'
      if (!map[key]) map[key] = { recettes: 0, depense_pr: 0, resultats: 0, bagage: 0 }
      // Dépenses AO/HAO sont des "autres dépenses" — on les soustrait du résultat
      map[key].resultats -= Number(d.montant)
    })

    return map
  }, [filteredBords, filteredDepenses])

  // Consolidation par société × segment
  const bySocieteSegment = useMemo(() => {
    const map: Record<string, Record<string, { recettes: number; depense_pr: number; resultats: number; autres: number }>> = {}
    filteredBords.forEach(b => {
      const soc = b.societe_code
      const seg = b.segment_code ?? 'AUTRES'
      if (!map[soc]) map[soc] = {}
      if (!map[soc][seg]) map[soc][seg] = { recettes: 0, depense_pr: 0, resultats: 0, autres: 0 }
      map[soc][seg].recettes += Number(b.total_mt_ticket)
      map[soc][seg].depense_pr += Number(b.total_depense_pr)
      map[soc][seg].resultats += Number(b.total_solde)
    })
    // Add dépenses AO/HAO to societe's "AUTRES" segment
    filteredDepenses.forEach(d => {
      const soc = d.societe_code || 'AUTRES'
      if (!map[soc]) map[soc] = {}
      if (!map[soc]['AUTRES']) map[soc]['AUTRES'] = { recettes: 0, depense_pr: 0, resultats: 0, autres: 0 }
      map[soc]['AUTRES'].autres += Number(d.montant)
      map[soc]['AUTRES'].resultats -= Number(d.montant)
    })
    return map
  }, [filteredBords, filteredDepenses])

  // Consolidation par segment (toutes sociétés)
  const bySegment = useMemo(() => {
    const map: Record<string, { recettes: number; depense_pr: number; resultats: number }> = {}
    filteredBords.forEach(b => {
      const seg = b.segment_code ?? 'AUTRES'
      if (!map[seg]) map[seg] = { recettes: 0, depense_pr: 0, resultats: 0 }
      map[seg].recettes += Number(b.total_mt_ticket)
      map[seg].depense_pr += Number(b.total_depense_pr)
      map[seg].resultats += Number(b.total_solde)
    })
    return map
  }, [filteredBords])

  const segmentCodes = segments.map(s => s.code)
  const allSegments = [...segmentCodes, 'AUTRES']

  const grandTotal = useMemo(() => {
    const recettes = Object.values(bySociete).reduce((a, v) => a + v.recettes, 0)
    const depense = Object.values(bySociete).reduce((a, v) => a + v.depense_pr, 0)
    const resultats = Object.values(bySociete).reduce((a, v) => a + v.resultats, 0)
    const bagage = Object.values(bySociete).reduce((a, v) => a + v.bagage, 0)
    const aoDep = filteredDepenses.filter(d => d.type_depense === 'AO').reduce((a, d) => a + Number(d.montant), 0)
    const haoDep = filteredDepenses.filter(d => d.type_depense === 'HAO').reduce((a, d) => a + Number(d.montant), 0)
    return { recettes, depense, resultats, bagage, aoDep, haoDep }
  }, [bySociete, filteredDepenses])

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1a2a22]">Récap consolidé</h1>
          <p className="text-sm mt-0.5 text-[#6B7280]">Consolidation multi-sociétés par segment — ligne Agboville</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExportPDF} disabled={filteredBords.length === 0 && filteredDepenses.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 disabled:opacity-50">
            <FileDown className="w-4 h-4" /> PDF
          </button>
          <button onClick={handleExportExcel} disabled={filteredBords.length === 0 && filteredDepenses.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 disabled:opacity-50">
            <FileSpreadsheet className="w-4 h-4" /> Excel
          </button>
        </div>
      </div>

      {/* Period selector */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-[#6B7280] mb-1 block">Période</label>
          <div className="flex gap-1">
            {([
              { key: 'hebdo' as Period, label: 'Hebdo' },
              { key: 'mensuel' as Period, label: 'Mensuel' },
              { key: 'annuel' as Period, label: 'Annuel' },
            ]).map(p => (
              <button key={p.key} onClick={() => { setPeriod(p.key); setPeriodValue('') }}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  period === p.key ? 'bg-[#0B7439] text-white' : 'bg-white border border-[#E2EAE5] text-[#4A6B55] hover:bg-[#F8FAF8]'
                }`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs text-[#6B7280] mb-1 block">Valeur</label>
          <select value={periodValue} onChange={e => setPeriodValue(e.target.value)}
            className="border border-[#E2EAE5] rounded-lg px-3 py-2 text-sm text-[#374151] focus:outline-none focus:border-[#0B7439] min-w-[160px]">
            <option value="">— Choisir —</option>
            {periodOptions.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filteredBords.length === 0 && filteredDepenses.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2EAE5] flex flex-col items-center justify-center h-40">
          <ClipboardList className="w-10 h-10 text-gray-300 mb-2" />
          <p className="text-sm text-[#9CA3AF]">Aucune donnée pour cette période</p>
        </div>
      ) : (
        <>
          {/* Grand totals */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <GrandCard label="Recettes totales" value={formatCFA(grandTotal.recettes)} />
            <GrandCard label="Dépenses P/R + AO/HAO" value={formatCFA(grandTotal.depense + grandTotal.aoDep + grandTotal.haoDep)} />
            <GrandCard label="Résultat net" value={formatCFA(grandTotal.resultats)} highlight />
            <GrandCard label="Bagage" value={formatCFA(grandTotal.bagage)} />
          </div>

          {/* Table 1: Consolidé par société */}
          <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E2EAE5]">
              <h3 className="text-sm font-semibold text-[#4A6B55]">Consolidé par société</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#F8FAF8]">
                  <tr>
                    <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Libellé (société)</th>
                    <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Recettes</th>
                    <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Dép. P/R</th>
                    <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">AO</th>
                    <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">HAO</th>
                    <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Résultat</th>
                  </tr>
                </thead>
                <tbody>
                  {SOCIETE_ORDER.map(soc => {
                    const d = bySociete[soc]
                    if (!d) return null
                    const aoDep = filteredDepenses.filter(dep => (dep.societe_code || 'AUTRES') === soc && dep.type_depense === 'AO').reduce((a, dep) => a + Number(dep.montant), 0)
                    const haoDep = filteredDepenses.filter(dep => (dep.societe_code || 'AUTRES') === soc && dep.type_depense === 'HAO').reduce((a, dep) => a + Number(dep.montant), 0)
                    const hasData = d.recettes > 0 || d.depense_pr > 0 || d.resultats !== 0 || aoDep > 0 || haoDep > 0
                    if (!hasData) return null
                    const isOpen = expanded === soc
                    const socSegments = bySocieteSegment[soc] ?? {}
                    return (
                      <Fragment key={soc}>
                        <tr className="border-t border-[#E2EAE5] hover:bg-[#F8FAF8] transition-colors cursor-pointer"
                          onClick={() => setExpanded(isOpen ? null : soc)}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {isOpen ? <ChevronDown className="w-4 h-4 text-[#6B7280]" /> : <ChevronRight className="w-4 h-4 text-[#6B7280]" />}
                              <span className="font-mono text-xs font-semibold text-[#0B7439]">{soc}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right text-[#374151] font-medium">{formatCFA(d.recettes)}</td>
                          <td className="px-4 py-3 text-right text-[#6B7280]">{formatCFA(d.depense_pr)}</td>
                          <td className="px-4 py-3 text-right text-blue-600">{formatCFA(aoDep)}</td>
                          <td className="px-4 py-3 text-right text-orange-600">{formatCFA(haoDep)}</td>
                          <td className="px-4 py-3 text-right font-semibold text-[#0B7439]">{formatCFA(d.resultats)}</td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-[#F8FAF8]">
                            <td colSpan={6} className="px-4 py-3">
                              <table className="w-full text-xs">
                                <thead className="bg-white border border-[#E2EAE5]">
                                  <tr>
                                    <th className="text-left px-3 py-2 text-[#4A6B55] font-semibold">Segment</th>
                                    <th className="text-right px-3 py-2 text-[#4A6B55] font-semibold">Recettes</th>
                                    <th className="text-right px-3 py-2 text-[#4A6B55] font-semibold">Dép. P/R</th>
                                    <th className="text-right px-3 py-2 text-[#4A6B55] font-semibold">Autres dép.</th>
                                    <th className="text-right px-3 py-2 text-[#4A6B55] font-semibold">Résultat</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {allSegments.map(seg => {
                                    const sd = socSegments[seg]
                                    if (!sd || (sd.recettes === 0 && sd.depense_pr === 0 && sd.autres === 0)) return null
                                    const segLabel = segments.find(s => s.code === seg)?.label ?? 'AUTRES DÉPENSES'
                                    return (
                                      <tr key={seg} className="border-t border-[#E2EAE5]">
                                        <td className="px-3 py-2 text-[#374151]">{segLabel}</td>
                                        <td className="px-3 py-2 text-right text-[#374151] font-medium">{formatCFA(sd.recettes)}</td>
                                        <td className="px-3 py-2 text-right text-[#6B7280]">{formatCFA(sd.depense_pr)}</td>
                                        <td className="px-3 py-2 text-right text-orange-600">{formatCFA(sd.autres)}</td>
                                        <td className="px-3 py-2 text-right font-semibold text-[#0B7439]">{formatCFA(sd.resultats)}</td>
                                      </tr>
                                    )
                                  })}
                                  <tr className="border-t-2 border-[#E2EAE5] bg-white">
                                    <td className="px-3 py-2 font-semibold text-[#4A6B55]">Total {soc}</td>
                                    <td className="px-3 py-2 text-right font-semibold text-[#374151]">{formatCFA(d.recettes)}</td>
                                    <td className="px-3 py-2 text-right font-semibold text-[#374151]">{formatCFA(d.depense_pr)}</td>
                                    <td className="px-3 py-2 text-right font-semibold text-orange-600">{formatCFA(aoDep + haoDep)}</td>
                                    <td className="px-3 py-2 text-right font-semibold text-[#0B7439]">{formatCFA(d.resultats)}</td>
                                  </tr>
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
                <tfoot className="bg-[#F8FAF8] border-t-2 border-[#E2EAE5]">
                  <tr>
                    <td className="px-4 py-3 font-bold text-[#4A6B55]">TOTAL</td>
                    <td className="px-4 py-3 text-right font-bold text-[#374151]">{formatCFA(grandTotal.recettes)}</td>
                    <td className="px-4 py-3 text-right font-bold text-[#374151]">{formatCFA(grandTotal.depense)}</td>
                    <td className="px-4 py-3 text-right font-bold text-blue-600">{formatCFA(grandTotal.aoDep)}</td>
                    <td className="px-4 py-3 text-right font-bold text-orange-600">{formatCFA(grandTotal.haoDep)}</td>
                    <td className="px-4 py-3 text-right font-bold text-[#0B7439]">{formatCFA(grandTotal.resultats)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Table 2: Totaux par segment (toutes sociétés) */}
          <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E2EAE5]">
              <h3 className="text-sm font-semibold text-[#4A6B55]">Totaux consolidés par segment (toutes sociétés)</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#F8FAF8]">
                  <tr>
                    <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Segment</th>
                    <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Recettes</th>
                    <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Dép. P/R</th>
                    <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Résultat</th>
                  </tr>
                </thead>
                <tbody>
                  {allSegments.map(seg => {
                    const d = bySegment[seg]
                    if (!d || (d.recettes === 0 && d.depense_pr === 0 && d.resultats === 0)) return null
                    const segLabel = segments.find(s => s.code === seg)?.label ?? 'AUTRES'
                    return (
                      <tr key={seg} className="border-t border-[#E2EAE5] hover:bg-[#F8FAF8] transition-colors">
                        <td className="px-4 py-3 text-[#374151]">{segLabel}</td>
                        <td className="px-4 py-3 text-right text-[#374151] font-medium">{formatCFA(d.recettes)}</td>
                        <td className="px-4 py-3 text-right text-[#6B7280]">{formatCFA(d.depense_pr)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-[#0B7439]">{formatCFA(d.resultats)}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="bg-[#F8FAF8] border-t-2 border-[#E2EAE5]">
                  <tr>
                    <td className="px-4 py-3 font-bold text-[#4A6B55]">TOTAL</td>
                    <td className="px-4 py-3 text-right font-bold text-[#374151]">{formatCFA(grandTotal.recettes)}</td>
                    <td className="px-4 py-3 text-right font-bold text-[#374151]">{formatCFA(grandTotal.depense)}</td>
                    <td className="px-4 py-3 text-right font-bold text-[#0B7439]">{formatCFA(Object.values(bySegment).reduce((a, v) => a + v.resultats, 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function GrandCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${highlight ? 'bg-[#0B7439]/5 border-[#0B7439]/20' : 'bg-white border-[#E2EAE5]'}`}>
      <div className="flex items-center gap-2 mb-1">
        {highlight && <TrendingUp className="w-4 h-4 text-[#0B7439]" />}
        <p className="text-xs text-[#6B7280]">{label}</p>
      </div>
      <p className={`text-xl font-bold ${highlight ? 'text-[#0B7439]' : 'text-[#1a2a22]'}`}>{value}</p>
    </div>
  )
}