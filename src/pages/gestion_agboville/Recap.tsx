import { useState, useEffect, useCallback } from 'react'
import {
  fetchBordereaux, fetchDailyConsolidation, formatCFA,
  type Bordereau, type DailyConsolidation,
} from '@/services/abg.service'
import { ClipboardList, ChevronDown, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'

export default function Recap() {
  const [daily, setDaily] = useState<DailyConsolidation[]>([])
  const [bordereaux, setBordereaux] = useState<Bordereau[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [d, b] = await Promise.all([
        fetchDailyConsolidation(),
        fetchBordereaux(),
      ])
      setDaily(d)
      setBordereaux(b)
    } catch { toast.error('Erreur lors du chargement') }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const byDate = daily.reduce((acc, r) => {
    if (!acc[r.date]) acc[r.date] = []
    acc[r.date].push(r)
    return acc
  }, {} as Record<string, DailyConsolidation[]>)

  const dates = Object.keys(byDate).sort().reverse()

  const grandTotal = daily.reduce((a, r) => ({
    recettes: a.recettes + Number(r.recettes_totales),
    depense: a.depense + Number(r.depense_pr),
    resultats: a.resultats + Number(r.resultats),
    bagage: a.bagage + Number(r.bagage_total),
  }), { recettes: 0, depense: 0, resultats: 0, bagage: 0 })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1a2a22]">Récap</h1>
        <p className="text-sm mt-0.5 text-[#6B7280]">Récapitulatif consolidé de la ligne Agboville — drill-down par date</p>
      </div>

      {/* Grand totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <TotalCard label="Recettes totales" value={formatCFA(grandTotal.recettes)} highlight />
        <TotalCard label="Dépenses P/R" value={formatCFA(grandTotal.depense)} />
        <TotalCard label="Résultats" value={formatCFA(grandTotal.resultats)} highlight />
        <TotalCard label="Bagage" value={formatCFA(grandTotal.bagage)} />
      </div>

      {/* Drill-down by date */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : dates.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40">
            <ClipboardList className="w-10 h-10 text-gray-300 mb-2" />
            <p className="text-sm text-[#9CA3AF]">Aucune donnée disponible</p>
          </div>
        ) : (
          <div className="divide-y divide-[#E2EAE5]">
            {dates.map(date => {
              const rows = byDate[date]
              const dayTotal = rows.reduce((a, r) => ({
                recettes: a.recettes + Number(r.recettes_totales),
                resultats: a.resultats + Number(r.resultats),
              }), { recettes: 0, resultats: 0 })
              const isOpen = expanded === date
              const dayBords = bordereaux.filter(b => b.bordereau_date === date)
              return (
                <div key={date}>
                  <button onClick={() => setExpanded(isOpen ? null : date)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#F8FAF8] transition-colors">
                    <div className="flex items-center gap-2">
                      {isOpen ? <ChevronDown className="w-4 h-4 text-[#6B7280]" /> : <ChevronRight className="w-4 h-4 text-[#6B7280]" />}
                      <span className="font-semibold text-[#1a2a22]">{new Date(date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                      <span className="text-xs text-[#6B7280]">{rows.length} entrée(s)</span>
                    </div>
                    <div className="flex gap-4 text-sm">
                      <span className="text-[#374151]">Recettes: <strong>{formatCFA(dayTotal.recettes)}</strong></span>
                      <span className="text-[#0B7439]">Résultat: <strong>{formatCFA(dayTotal.resultats)}</strong></span>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="bg-[#F8FAF8] p-4 space-y-3">
                      {/* Daily breakdown */}
                      <table className="w-full text-sm">
                        <thead className="bg-white border border-[#E2EAE5] rounded-lg">
                          <tr>
                            <th className="text-left px-3 py-2 text-[#4A6B55] font-semibold">Gare</th>
                            <th className="text-left px-3 py-2 text-[#4A6B55] font-semibold">Société</th>
                            <th className="text-right px-3 py-2 text-[#4A6B55] font-semibold">Recettes</th>
                            <th className="text-right px-3 py-2 text-[#4A6B55] font-semibold">Résultats</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r, i) => (
                            <tr key={i} className="border-t border-[#E2EAE5]">
                              <td className="px-3 py-2 text-[#374151]">{r.gare_label}</td>
                              <td className="px-3 py-2 font-mono text-xs text-[#0B7439]">{r.societe_code}</td>
                              <td className="px-3 py-2 text-right font-medium">{formatCFA(r.recettes_totales)}</td>
                              <td className="px-3 py-2 text-right font-semibold text-[#0B7439]">{formatCFA(r.resultats)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {/* Bordereaux source */}
                      <div>
                        <p className="text-xs text-[#6B7280] mb-1">Bordereaux source ({dayBords.length})</p>
                        <div className="flex flex-wrap gap-2">
                          {dayBords.map(b => (
                            <span key={b.id} className="inline-flex items-center gap-1 px-2 py-1 bg-white border border-[#E2EAE5] rounded-lg text-xs">
                              <span className="font-mono font-semibold text-[#0B7439]">{b.societe_code}</span>
                              <span className="text-[#6B7280]">·</span>
                              <span className="text-[#374151]">{b.gare_label}</span>
                              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                                b.status === 'verifie' ? 'bg-green-100 text-green-700' :
                                b.status === 'ecart' ? 'bg-orange-100 text-orange-700' :
                                'bg-blue-100 text-blue-700'
                              }`}>
                                {b.status === 'verifie' ? 'Vérifié' : b.status === 'ecart' ? 'Écart' : 'Reçu'}
                              </span>
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function TotalCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${highlight ? 'bg-[#0B7439]/5 border-[#0B7439]/20' : 'bg-white border-[#E2EAE5]'}`}>
      <p className="text-xs text-[#6B7280] mb-0.5">{label}</p>
      <p className={`text-xl font-bold ${highlight ? 'text-[#0B7439]' : 'text-[#1a2a22]'}`}>{value}</p>
    </div>
  )
}
