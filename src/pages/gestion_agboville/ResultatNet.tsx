import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  fetchBordereaux, fetchDepenses, fetchSocietes, fetchSegments, fetchDispatches,
  upsertDispatch, updateDispatchStatut, formatCFA,
  type Bordereau, type AbgDepense, type AbgSociete, type AbgDispatch,
} from '@/services/abg.service'
import { exportPDF, exportTableExcel } from '@/utils/abgExports'
import {
  TrendingUp, BarChart3, Send, CheckCircle2, Clock, FileDown, FileSpreadsheet,
  Plus, Printer,
} from 'lucide-react'
import toast from 'react-hot-toast'

type Period = 'hebdo' | 'mensuel' | 'annuel'

const SOCIETE_ORDER = ['SBTA', 'TST', 'ETL', 'SNT', 'GROUP_OUME', 'AUTRES']

const DISPATCH_STATUT: Record<string, { label: string; bg: string; text: string; icon: typeof Clock }> = {
  genere:  { label: 'Généré',  bg: 'bg-gray-100',   text: 'text-gray-600',   icon: Clock },
  envoye:  { label: 'Envoyé',   bg: 'bg-blue-50',    text: 'text-blue-600',   icon: Send },
  recu:    { label: 'Reçu',     bg: 'bg-green-50',   text: 'text-green-600',  icon: CheckCircle2 },
}

export default function ResultatNet() {
  const [bordereaux, setBordereaux] = useState<Bordereau[]>([])
  const [depenses, setDepenses] = useState<AbgDepense[]>([])
  const [societes, setSocietes] = useState<AbgSociete[]>([])
  const [dispatches, setDispatches] = useState<AbgDispatch[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<Period>('mensuel')
  const [periodValue, setPeriodValue] = useState('')
  const [generating, setGenerating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [b, d, s, disp] = await Promise.all([
        fetchBordereaux(),
        fetchDepenses(),
        fetchSocietes(),
        fetchDispatches(),
      ])
      setBordereaux(b)
      setDepenses(d)
      setSocietes(s)
      setDispatches(disp)
    } catch { toast.error('Erreur lors du chargement') }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Period options
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

  const filteredBords = useMemo(() => {
    if (!periodValue) return bordereaux
    return bordereaux.filter(b => matchPeriod(b.bordereau_date, period, periodValue))
  }, [bordereaux, period, periodValue])

  const filteredDepenses = useMemo(() => {
    if (!periodValue) return depenses
    return depenses.filter(d => matchPeriod(d.date_depense, period, periodValue))
  }, [depenses, period, periodValue])

  // Consolidation par société
  const bySociete = useMemo(() => {
    const map: Record<string, { recettes: number; depense_pr: number; ao: number; hao: number; resultat: number }> = {}
    SOCIETE_ORDER.forEach(s => { map[s] = { recettes: 0, depense_pr: 0, ao: 0, hao: 0, resultat: 0 } })

    filteredBords.forEach(b => {
      if (!map[b.societe_code]) map[b.societe_code] = { recettes: 0, depense_pr: 0, ao: 0, hao: 0, resultat: 0 }
      map[b.societe_code].recettes += Number(b.total_mt_ticket)
      map[b.societe_code].depense_pr += Number(b.total_depense_pr)
      map[b.societe_code].resultat += Number(b.total_solde)
    })
    filteredDepenses.forEach(d => {
      const key = d.societe_code || 'AUTRES'
      if (!map[key]) map[key] = { recettes: 0, depense_pr: 0, ao: 0, hao: 0, resultat: 0 }
      if (d.type_depense === 'AO') map[key].ao += Number(d.montant)
      else map[key].hao += Number(d.montant)
      map[key].resultat -= Number(d.montant)
    })
    return map
  }, [filteredBords, filteredDepenses])

  const grandTotal = useMemo(() => {
    const recettes = Object.values(bySociete).reduce((a, v) => a + v.recettes, 0)
    const depense = Object.values(bySociete).reduce((a, v) => a + v.depense_pr, 0)
    const ao = Object.values(bySociete).reduce((a, v) => a + v.ao, 0)
    const hao = Object.values(bySociete).reduce((a, v) => a + v.hao, 0)
    const resultat = Object.values(bySociete).reduce((a, v) => a + v.resultat, 0)
    return { recettes, depense, ao, hao, resultat }
  }, [bySociete])

  const periodDispatches = dispatches.filter(d => d.periode_type === period && d.periode_value === periodValue)

  const handleGenerate = async () => {
    if (!periodValue) return
    setGenerating(true)
    try {
      for (const soc of SOCIETE_ORDER) {
        const d = bySociete[soc]
        if (!d || (d.recettes === 0 && d.depense_pr === 0 && d.ao === 0 && d.hao === 0 && d.resultat === 0)) continue
        await upsertDispatch({
          periode_type: period,
          periode_value: periodValue,
          societe_code: soc,
          recettes: d.recettes,
          depense_pr: d.depense_pr,
          total_ao: d.ao,
          total_hao: d.hao,
          resultat_net: d.resultat,
        })
      }
      toast.success('États de dispatch générés')
      load()
    } catch {
      toast.error('Erreur lors de la génération')
    }
    setGenerating(false)
  }

  const handleStatutChange = async (id: string, statut: 'genere' | 'envoye' | 'recu') => {
    try {
      await updateDispatchStatut(id, statut)
      toast.success('Statut mis à jour')
      load()
    } catch {
      toast.error('Erreur')
    }
  }

  const handleExportPDF = async () => {
    const headers = ['Société', 'Recettes', 'Dép. P/R', 'AO', 'HAO', 'Résultat net']
    const rows = SOCIETE_ORDER.filter(soc => {
      const d = bySociete[soc]
      return d && (d.recettes > 0 || d.depense_pr > 0 || d.ao > 0 || d.hao > 0 || d.resultat !== 0)
    }).map(soc => {
      const d = bySociete[soc]
      return [soc, formatCFA(d.recettes), formatCFA(d.depense_pr), formatCFA(d.ao), formatCFA(d.hao), formatCFA(d.resultat)]
    })
    const totals = ['TOTAL', formatCFA(grandTotal.recettes), formatCFA(grandTotal.depense), formatCFA(grandTotal.ao), formatCFA(grandTotal.hao), formatCFA(grandTotal.resultat)]
    await exportPDF('Résultat net & dispatch', `Période: ${periodValue}`, headers, rows, totals, `resultat_net_${periodValue}.pdf`)
    toast.success('PDF exporté')
  }

  const handleExportExcel = () => {
    const headers = ['Société', 'Recettes', 'Dép. P/R', 'AO', 'HAO', 'Résultat net']
    const rows = SOCIETE_ORDER.filter(soc => {
      const d = bySociete[soc]
      return d && (d.recettes > 0 || d.depense_pr > 0 || d.ao > 0 || d.hao > 0 || d.resultat !== 0)
    }).map(soc => {
      const d = bySociete[soc]
      return [soc, formatCFA(d.recettes), formatCFA(d.depense_pr), formatCFA(d.ao), formatCFA(d.hao), formatCFA(d.resultat)]
    })
    const totals = ['TOTAL', formatCFA(grandTotal.recettes), formatCFA(grandTotal.depense), formatCFA(grandTotal.ao), formatCFA(grandTotal.hao), formatCFA(grandTotal.resultat)]
    exportTableExcel('Résultat net & dispatch', headers, rows, totals, `resultat_net_${periodValue}.xlsx`)
    toast.success('Excel exporté')
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1a2a22]">Résultat net & dispatch</h1>
          <p className="text-sm mt-0.5 text-[#6B7280]">Résultat net consolidé et répartition par société</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExportPDF} className="flex items-center gap-1.5 px-3 py-2 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700">
            <FileDown className="w-4 h-4" /> PDF
          </button>
          <button onClick={handleExportExcel} className="flex items-center gap-1.5 px-3 py-2 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700">
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
        <button onClick={handleGenerate} disabled={generating || !periodValue}
          className="flex items-center gap-1.5 px-3 py-2 bg-[#0B7439] text-white rounded-lg text-sm font-medium hover:bg-[#085c2d] disabled:opacity-50">
          {generating ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Plus className="w-4 h-4" />}
          Générer dispatch
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Grand totals */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <GrandCard label="Recettes" value={formatCFA(grandTotal.recettes)} />
            <GrandCard label="Dép. P/R" value={formatCFA(grandTotal.depense)} />
            <GrandCard label="AO" value={formatCFA(grandTotal.ao)} color="text-blue-600" />
            <GrandCard label="HAO" value={formatCFA(grandTotal.hao)} color="text-orange-600" />
            <GrandCard label="Résultat net" value={formatCFA(grandTotal.resultat)} highlight />
          </div>

          {/* Table: résultat net par société */}
          <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E2EAE5]">
              <h3 className="text-sm font-semibold text-[#4A6B55]">Résultat net par société — {periodValue || '—'}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#F8FAF8]">
                  <tr>
                    <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Société</th>
                    <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Recettes</th>
                    <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Dép. P/R</th>
                    <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">AO</th>
                    <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">HAO</th>
                    <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Résultat net</th>
                    <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Marge</th>
                  </tr>
                </thead>
                <tbody>
                  {SOCIETE_ORDER.map(soc => {
                    const d = bySociete[soc]
                    if (!d || (d.recettes === 0 && d.depense_pr === 0 && d.ao === 0 && d.hao === 0 && d.resultat === 0)) return null
                    const marge = d.recettes > 0 ? (d.resultat / d.recettes) * 100 : 0
                    return (
                      <tr key={soc} className="border-t border-[#E2EAE5] hover:bg-[#F8FAF8] transition-colors">
                        <td className="px-4 py-3 font-mono text-xs font-semibold text-[#0B7439]">{soc}</td>
                        <td className="px-4 py-3 text-right text-[#374151] font-medium">{formatCFA(d.recettes)}</td>
                        <td className="px-4 py-3 text-right text-[#6B7280]">{formatCFA(d.depense_pr)}</td>
                        <td className="px-4 py-3 text-right text-blue-600">{formatCFA(d.ao)}</td>
                        <td className="px-4 py-3 text-right text-orange-600">{formatCFA(d.hao)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-[#0B7439]">{formatCFA(d.resultat)}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${marge >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {marge.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="bg-[#F8FAF8] border-t-2 border-[#E2EAE5]">
                  <tr>
                    <td className="px-4 py-3 font-bold text-[#4A6B55]">TOTAL</td>
                    <td className="px-4 py-3 text-right font-bold text-[#374151]">{formatCFA(grandTotal.recettes)}</td>
                    <td className="px-4 py-3 text-right font-bold text-[#374151]">{formatCFA(grandTotal.depense)}</td>
                    <td className="px-4 py-3 text-right font-bold text-blue-600">{formatCFA(grandTotal.ao)}</td>
                    <td className="px-4 py-3 text-right font-bold text-orange-600">{formatCFA(grandTotal.hao)}</td>
                    <td className="px-4 py-3 text-right font-bold text-[#0B7439]">{formatCFA(grandTotal.resultat)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Dispatch tracking */}
          <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E2EAE5] flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#4A6B55]">États de dispatch — {periodValue || '—'}</h3>
              <span className="text-xs text-[#6B7280]">{periodDispatches.length} état(s)</span>
            </div>
            {periodDispatches.length === 0 ? (
              <div className="p-8 text-center">
                <Send className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-[#9CA3AF]">Aucun dispatch généré. Cliquez sur « Générer dispatch ».</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#F8FAF8]">
                    <tr>
                      <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Société</th>
                      <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Recettes</th>
                      <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Résultat net</th>
                      <th className="text-center px-4 py-3 text-[#4A6B55] font-semibold">Statut</th>
                      <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Envoyé le</th>
                      <th className="text-center px-4 py-3 text-[#4A6B55] font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periodDispatches.map(disp => {
                      const st = DISPATCH_STATUT[disp.statut] ?? DISPATCH_STATUT.genere
                      const Icon = st.icon
                      return (
                        <tr key={disp.id} className="border-t border-[#E2EAE5] hover:bg-[#F8FAF8] transition-colors">
                          <td className="px-4 py-3 font-mono text-xs font-semibold text-[#0B7439]">{disp.societe_code}</td>
                          <td className="px-4 py-3 text-right text-[#374151] font-medium">{formatCFA(disp.recettes)}</td>
                          <td className="px-4 py-3 text-right font-semibold text-[#0B7439]">{formatCFA(disp.resultat_net)}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${st.bg} ${st.text}`}>
                              <Icon className="w-3 h-3" /> {st.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-[#6B7280]">{disp.envoye_at ? new Date(disp.envoye_at).toLocaleDateString('fr-FR') : '—'}</td>
                          <td className="px-4 py-3 text-center">
                            <select value={disp.statut} onChange={e => handleStatutChange(disp.id, e.target.value as 'genere' | 'envoye' | 'recu')}
                              className="border border-[#E2EAE5] rounded-lg px-2 py-1 text-xs text-[#374151] focus:outline-none focus:border-[#0B7439]">
                              <option value="genere">Généré</option>
                              <option value="envoye">Envoyé</option>
                              <option value="recu">Reçu</option>
                            </select>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function matchPeriod(dateStr: string, period: Period, value: string): boolean {
  const d = new Date(dateStr)
  if (period === 'hebdo') {
    const year = d.getFullYear()
    const onejan = new Date(year, 0, 1)
    const week = Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7)
    return `${year}-S${String(week).padStart(2, '0')}` === value
  } else if (period === 'mensuel') {
    return d.toISOString().slice(0, 7) === value
  } else {
    return String(d.getFullYear()) === value
  }
}

function GrandCard({ label, value, color, highlight }: { label: string; value: string; color?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${highlight ? 'bg-[#0B7439]/5 border-[#0B7439]/20' : 'bg-white border-[#E2EAE5]'}`}>
      <div className="flex items-center gap-2 mb-1">
        {highlight && <BarChart3 className="w-4 h-4 text-[#0B7439]" />}
        <p className="text-xs text-[#6B7280]">{label}</p>
      </div>
      <p className={`text-xl font-bold ${highlight ? 'text-[#0B7439]' : color ?? 'text-[#1a2a22]'}`}>{value}</p>
    </div>
  )
}
