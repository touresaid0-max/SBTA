import { useState, useEffect, useCallback } from 'react'
import {
  fetchAnnualConsolidation, formatCFA,
  type AnnualConsolidation,
} from '@/services/abg.service'
import { TrendingUp, BarChart3 } from 'lucide-react'
import toast from 'react-hot-toast'

export default function ResultatNet() {
  const [data, setData] = useState<AnnualConsolidation[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedYear, setSelectedYear] = useState<string>('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await fetchAnnualConsolidation()
      setData(rows)
      const years = [...new Set(rows.map(r => r.annee))].sort().reverse()
      if (years.length > 0) setSelectedYear(years[0])
    } catch { toast.error('Erreur lors du chargement') }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const years = [...new Set(data.map(r => r.annee))].sort().reverse()
  const yearData = data.filter(r => r.annee === selectedYear)

  const bySociete = yearData.reduce((acc, r) => {
    if (!acc[r.societe_code]) acc[r.societe_code] = { recettes: 0, depenses: 0, resultats: 0, seats: 0 }
    acc[r.societe_code].recettes += Number(r.recettes)
    acc[r.societe_code].depenses += Number(r.depenses)
    acc[r.societe_code].resultats += Number(r.resultats)
    acc[r.societe_code].seats += r.total_seats
    return acc
  }, {} as Record<string, { recettes: number; depenses: number; resultats: number; seats: number }>)

  const bySegment = yearData.reduce((acc, r) => {
    const key = r.segment_code ?? '—'
    if (!acc[key]) acc[key] = { recettes: 0, depenses: 0, resultats: 0 }
    acc[key].recettes += Number(r.recettes)
    acc[key].depenses += Number(r.depenses)
    acc[key].resultats += Number(r.resultats)
    return acc
  }, {} as Record<string, { recettes: number; depenses: number; resultats: number }>)

  const grandTotal = yearData.reduce((a, r) => ({
    recettes: a.recettes + Number(r.recettes),
    depenses: a.depenses + Number(r.depenses),
    resultats: a.resultats + Number(r.resultats),
  }), { recettes: 0, depenses: 0, resultats: 0 })

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1a2a22]">Résultat net & dispatch</h1>
          <p className="text-sm mt-0.5 text-[#6B7280]">Résultat net et répartition par société / segment</p>
        </div>
        {years.length > 0 && (
          <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)}
            className="border border-[#E2EAE5] rounded-xl px-4 py-2 text-sm font-medium text-[#374151] focus:outline-none focus:border-[#0B7439]">
            {years.map(y => <option key={y} value={y}>Année {y}</option>)}
          </select>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : yearData.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2EAE5] flex flex-col items-center justify-center h-40">
          <TrendingUp className="w-10 h-10 text-gray-300 mb-2" />
          <p className="text-sm text-[#9CA3AF]">Aucune donnée disponible pour {selectedYear || 'cette période'}</p>
        </div>
      ) : (
        <>
          {/* Grand totals */}
          <div className="grid grid-cols-3 gap-3">
            <GrandCard label="Recettes nettes" value={formatCFA(grandTotal.recettes)} color="text-[#1a2a22]" />
            <GrandCard label="Dépenses totales" value={formatCFA(grandTotal.depenses)} color="text-[#6B7280]" />
            <GrandCard label="Résultat net" value={formatCFA(grandTotal.resultats)} color="text-[#0B7439]" highlight />
          </div>

          {/* By société */}
          <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E2EAE5]">
              <h3 className="text-sm font-semibold text-[#4A6B55]">Résultat par société — {selectedYear}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#F8FAF8]">
                  <tr>
                    <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Société</th>
                    <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Sièges</th>
                    <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Recettes</th>
                    <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Dépenses</th>
                    <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Résultat net</th>
                    <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Marge</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(bySociete).map(([soc, vals]) => {
                    const marge = vals.recettes > 0 ? (vals.resultats / vals.recettes) * 100 : 0
                    return (
                      <tr key={soc} className="border-t border-[#E2EAE5] hover:bg-[#F8FAF8] transition-colors">
                        <td className="px-4 py-3 font-mono text-xs font-semibold text-[#0B7439]">{soc}</td>
                        <td className="px-4 py-3 text-right text-[#374151]">{vals.seats}</td>
                        <td className="px-4 py-3 text-right text-[#374151] font-medium">{formatCFA(vals.recettes)}</td>
                        <td className="px-4 py-3 text-right text-[#6B7280]">{formatCFA(vals.depenses)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-[#0B7439]">{formatCFA(vals.resultats)}</td>
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
                    <td className="px-4 py-3 font-semibold text-[#4A6B55]">Total</td>
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3 text-right font-semibold text-[#374151]">{formatCFA(grandTotal.recettes)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-[#374151]">{formatCFA(grandTotal.depenses)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-[#0B7439]">{formatCFA(grandTotal.resultats)}</td>
                    <td className="px-4 py-3" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* By segment */}
          <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E2EAE5]">
              <h3 className="text-sm font-semibold text-[#4A6B55]">Résultat par segment — {selectedYear}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#F8FAF8]">
                  <tr>
                    <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Segment</th>
                    <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Recettes</th>
                    <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Dépenses</th>
                    <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Résultat net</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(bySegment).map(([seg, vals]) => (
                    <tr key={seg} className="border-t border-[#E2EAE5] hover:bg-[#F8FAF8] transition-colors">
                      <td className="px-4 py-3 text-[#374151]">{seg}</td>
                      <td className="px-4 py-3 text-right text-[#374151] font-medium">{formatCFA(vals.recettes)}</td>
                      <td className="px-4 py-3 text-right text-[#6B7280]">{formatCFA(vals.depenses)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-[#0B7439]">{formatCFA(vals.resultats)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function GrandCard({ label, value, color, highlight }: { label: string; value: string; color: string; highlight?: boolean }) {
  return (
    <div className={`rounded-2xl border p-5 ${highlight ? 'bg-[#0B7439]/5 border-[#0B7439]/20' : 'bg-white border-[#E2EAE5]'}`}>
      <div className="flex items-center gap-2 mb-1">
        {highlight && <BarChart3 className="w-4 h-4 text-[#0B7439]" />}
        <p className="text-xs text-[#6B7280]">{label}</p>
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  )
}
