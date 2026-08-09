import { useState, useEffect, useCallback } from 'react'
import {
  fetchWeeklyConsolidation, fetchMonthlyConsolidation, fetchAnnualConsolidation,
  formatCFA,
  type WeeklyConsolidation, type MonthlyConsolidation, type AnnualConsolidation,
} from '@/services/abg.service'
import { Calendar, ChevronDown, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'

type Tab = 'hebdo' | 'mensuel' | 'annuel'

export default function Points() {
  const [tab, setTab] = useState<Tab>('hebdo')

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1a2a22]">Points</h1>
        <p className="text-sm mt-0.5 text-[#6B7280]">Points hebdomadaire / mensuel / annuel — ligne Agboville</p>
      </div>

      <div className="flex gap-2">
        {([
          { key: 'hebdo' as Tab, label: 'Point hebdo' },
          { key: 'mensuel' as Tab, label: 'Point mensuel' },
          { key: 'annuel' as Tab, label: 'Point annuel' },
        ]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-[#0B7439] text-white' : 'bg-white border border-[#E2EAE5] text-[#4A6B55] hover:bg-[#F8FAF8]'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'hebdo' && <HebdoTab />}
      {tab === 'mensuel' && <MensuelTab />}
      {tab === 'annuel' && <AnnuelTab />}
    </div>
  )
}

function HebdoTab() {
  const [data, setData] = useState<WeeklyConsolidation[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await fetchWeeklyConsolidation()
      setData(rows)
    } catch { toast.error('Erreur lors du chargement') }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const grouped = data.reduce((acc, r) => {
    const key = r.semaine
    if (!acc[key]) acc[key] = []
    acc[key].push(r)
    return acc
  }, {} as Record<string, WeeklyConsolidation[]>)

  const weeks = Object.keys(grouped).sort().reverse()

  return (
    <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : weeks.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="divide-y divide-[#E2EAE5]">
          {weeks.map(week => {
            const rows = grouped[week]
            const totals = rows.reduce((a, r) => ({
              recettes: a.recettes + Number(r.recettes),
              depense: a.depense + Number(r.depense_pr),
              resultats: a.resultats + Number(r.resultats),
              bagage: a.bagage + Number(r.bagage_total),
              seats: a.seats + r.total_seats,
            }), { recettes: 0, depense: 0, resultats: 0, bagage: 0, seats: 0 })
            const isOpen = expanded === week
            return (
              <div key={week}>
                <button onClick={() => setExpanded(isOpen ? null : week)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#F8FAF8] transition-colors">
                  <div className="flex items-center gap-2">
                    {isOpen ? <ChevronDown className="w-4 h-4 text-[#6B7280]" /> : <ChevronRight className="w-4 h-4 text-[#6B7280]" />}
                    <span className="font-semibold text-[#1a2a22]">Semaine {week}</span>
                    <span className="text-xs text-[#6B7280]">{rows.length} car(s)</span>
                  </div>
                  <div className="flex gap-4 text-sm">
                    <span className="text-[#374151]">Recettes: <strong>{formatCFA(totals.recettes)}</strong></span>
                    <span className="text-[#0B7439]">Résultat: <strong>{formatCFA(totals.resultats)}</strong></span>
                  </div>
                </button>
                {isOpen && (
                  <div className="overflow-x-auto bg-[#F8FAF8]">
                    <table className="w-full text-sm">
                      <thead className="bg-white border-y border-[#E2EAE5]">
                        <tr>
                          <th className="text-left px-4 py-2 text-[#4A6B55] font-semibold">Libellé (matricule)</th>
                          <th className="text-left px-4 py-2 text-[#4A6B55] font-semibold">Société</th>
                          <th className="text-right px-4 py-2 text-[#4A6B55] font-semibold">Sièges</th>
                          <th className="text-right px-4 py-2 text-[#4A6B55] font-semibold">Recettes</th>
                          <th className="text-right px-4 py-2 text-[#4A6B55] font-semibold">Dép. P/R</th>
                          <th className="text-right px-4 py-2 text-[#4A6B55] font-semibold">Résultats</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={i} className="border-t border-[#E2EAE5]">
                            <td className="px-4 py-2 font-mono text-xs font-semibold text-[#0B7439]">{r.libelle}</td>
                            <td className="px-4 py-2 text-[#6B7280]">{r.societe_code}</td>
                            <td className="px-4 py-2 text-right text-[#374151]">{r.total_seats}</td>
                            <td className="px-4 py-2 text-right text-[#374151] font-medium">{formatCFA(r.recettes)}</td>
                            <td className="px-4 py-2 text-right text-[#6B7280]">{formatCFA(r.depense_pr)}</td>
                            <td className="px-4 py-2 text-right font-semibold text-[#0B7439]">{formatCFA(r.resultats)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-white border-t-2 border-[#E2EAE5]">
                        <tr>
                          <td className="px-4 py-2 font-semibold text-[#4A6B55]" colSpan={2}>Total</td>
                          <td className="px-4 py-2 text-right font-semibold text-[#374151]">{totals.seats}</td>
                          <td className="px-4 py-2 text-right font-semibold text-[#374151]">{formatCFA(totals.recettes)}</td>
                          <td className="px-4 py-2 text-right font-semibold text-[#374151]">{formatCFA(totals.depense)}</td>
                          <td className="px-4 py-2 text-right font-semibold text-[#0B7439]">{formatCFA(totals.resultats)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function MensuelTab() {
  const [data, setData] = useState<MonthlyConsolidation[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await fetchMonthlyConsolidation()
      setData(rows)
    } catch { toast.error('Erreur lors du chargement') }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const grouped = data.reduce((acc, r) => {
    if (!acc[r.mois]) acc[r.mois] = []
    acc[r.mois].push(r)
    return acc
  }, {} as Record<string, MonthlyConsolidation[]>)

  const months = Object.keys(grouped).sort().reverse()

  return (
    <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : months.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="divide-y divide-[#E2EAE5]">
          {months.map(mois => {
            const rows = grouped[mois]
            const bySociete = rows.reduce((a, r) => {
              if (!a[r.societe_code]) a[r.societe_code] = { recettes: 0, depenses: 0, resultats: 0, seats: 0 }
              a[r.societe_code].recettes += Number(r.recettes)
              a[r.societe_code].depenses += Number(r.depenses)
              a[r.societe_code].resultats += Number(r.resultats)
              a[r.societe_code].seats += r.total_seats
              return a
            }, {} as Record<string, { recettes: number; depenses: number; resultats: number; seats: number }>)
            const totals = Object.values(bySociete).reduce((a, v) => ({
              recettes: a.recettes + v.recettes, depenses: a.depenses + v.depenses,
              resultats: a.resultats + v.resultats, seats: a.seats + v.seats,
            }), { recettes: 0, depenses: 0, resultats: 0, seats: 0 })
            const isOpen = expanded === mois
            return (
              <div key={mois}>
                <button onClick={() => setExpanded(isOpen ? null : mois)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#F8FAF8] transition-colors">
                  <div className="flex items-center gap-2">
                    {isOpen ? <ChevronDown className="w-4 h-4 text-[#6B7280]" /> : <ChevronRight className="w-4 h-4 text-[#6B7280]" />}
                    <span className="font-semibold text-[#1a2a22]">{mois}</span>
                  </div>
                  <div className="flex gap-4 text-sm">
                    <span className="text-[#374151]">Recettes: <strong>{formatCFA(totals.recettes)}</strong></span>
                    <span className="text-[#0B7439]">Résultat: <strong>{formatCFA(totals.resultats)}</strong></span>
                  </div>
                </button>
                {isOpen && (
                  <div className="overflow-x-auto bg-[#F8FAF8]">
                    <table className="w-full text-sm">
                      <thead className="bg-white border-y border-[#E2EAE5]">
                        <tr>
                          <th className="text-left px-4 py-2 text-[#4A6B55] font-semibold">Société</th>
                          <th className="text-left px-4 py-2 text-[#4A6B55] font-semibold">Segment</th>
                          <th className="text-center px-4 py-2 text-[#4A6B55] font-semibold">Semaine</th>
                          <th className="text-right px-4 py-2 text-[#4A6B55] font-semibold">Recettes</th>
                          <th className="text-right px-4 py-2 text-[#4A6B55] font-semibold">Dépenses</th>
                          <th className="text-right px-4 py-2 text-[#4A6B55] font-semibold">Résultats</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={i} className="border-t border-[#E2EAE5]">
                            <td className="px-4 py-2 font-mono text-xs font-semibold text-[#0B7439]">{r.societe_code}</td>
                            <td className="px-4 py-2 text-[#6B7280]">{r.segment_code ?? '—'}</td>
                            <td className="px-4 py-2 text-center text-[#374151]">{r.semaine_mois}</td>
                            <td className="px-4 py-2 text-right text-[#374151] font-medium">{formatCFA(r.recettes)}</td>
                            <td className="px-4 py-2 text-right text-[#6B7280]">{formatCFA(r.depenses)}</td>
                            <td className="px-4 py-2 text-right font-semibold text-[#0B7439]">{formatCFA(r.resultats)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-white border-t-2 border-[#E2EAE5]">
                        <tr>
                          <td className="px-4 py-2 font-semibold text-[#4A6B55]" colSpan={3}>Total</td>
                          <td className="px-4 py-2 text-right font-semibold text-[#374151]">{formatCFA(totals.recettes)}</td>
                          <td className="px-4 py-2 text-right font-semibold text-[#374151]">{formatCFA(totals.depenses)}</td>
                          <td className="px-4 py-2 text-right font-semibold text-[#0B7439]">{formatCFA(totals.resultats)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function AnnuelTab() {
  const [data, setData] = useState<AnnualConsolidation[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await fetchAnnualConsolidation()
      setData(rows)
    } catch { toast.error('Erreur lors du chargement') }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const grouped = data.reduce((acc, r) => {
    if (!acc[r.annee]) acc[r.annee] = []
    acc[r.annee].push(r)
    return acc
  }, {} as Record<string, AnnualConsolidation[]>)

  const years = Object.keys(grouped).sort().reverse()

  return (
    <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : years.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="divide-y divide-[#E2EAE5]">
          {years.map(year => {
            const rows = grouped[year]
            const totals = rows.reduce((a, r) => ({
              recettes: a.recettes + Number(r.recettes),
              depenses: a.depenses + Number(r.depenses),
              resultats: a.resultats + Number(r.resultats),
              seats: a.seats + r.total_seats,
            }), { recettes: 0, depenses: 0, resultats: 0, seats: 0 })
            const isOpen = expanded === year
            return (
              <div key={year}>
                <button onClick={() => setExpanded(isOpen ? null : year)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#F8FAF8] transition-colors">
                  <div className="flex items-center gap-2">
                    {isOpen ? <ChevronDown className="w-4 h-4 text-[#6B7280]" /> : <ChevronRight className="w-4 h-4 text-[#6B7280]" />}
                    <span className="font-semibold text-[#1a2a22]">Année {year}</span>
                  </div>
                  <div className="flex gap-4 text-sm">
                    <span className="text-[#374151]">Recettes: <strong>{formatCFA(totals.recettes)}</strong></span>
                    <span className="text-[#0B7439]">Résultat: <strong>{formatCFA(totals.resultats)}</strong></span>
                  </div>
                </button>
                {isOpen && (
                  <div className="overflow-x-auto bg-[#F8FAF8]">
                    <table className="w-full text-sm">
                      <thead className="bg-white border-y border-[#E2EAE5]">
                        <tr>
                          <th className="text-left px-4 py-2 text-[#4A6B55] font-semibold">Mois</th>
                          <th className="text-left px-4 py-2 text-[#4A6B55] font-semibold">Société</th>
                          <th className="text-left px-4 py-2 text-[#4A6B55] font-semibold">Segment</th>
                          <th className="text-right px-4 py-2 text-[#4A6B55] font-semibold">Recettes</th>
                          <th className="text-right px-4 py-2 text-[#4A6B55] font-semibold">Dépenses</th>
                          <th className="text-right px-4 py-2 text-[#4A6B55] font-semibold">Résultats</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={i} className="border-t border-[#E2EAE5]">
                            <td className="px-4 py-2 text-[#374151]">{r.mois_label.trim()}</td>
                            <td className="px-4 py-2 font-mono text-xs font-semibold text-[#0B7439]">{r.societe_code}</td>
                            <td className="px-4 py-2 text-[#6B7280]">{r.segment_code ?? '—'}</td>
                            <td className="px-4 py-2 text-right text-[#374151] font-medium">{formatCFA(r.recettes)}</td>
                            <td className="px-4 py-2 text-right text-[#6B7280]">{formatCFA(r.depenses)}</td>
                            <td className="px-4 py-2 text-right font-semibold text-[#0B7439]">{formatCFA(r.resultats)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-white border-t-2 border-[#E2EAE5]">
                        <tr>
                          <td className="px-4 py-2 font-semibold text-[#4A6B55]" colSpan={3}>Total annuel</td>
                          <td className="px-4 py-2 text-right font-semibold text-[#374151]">{formatCFA(totals.recettes)}</td>
                          <td className="px-4 py-2 text-right font-semibold text-[#374151]">{formatCFA(totals.depenses)}</td>
                          <td className="px-4 py-2 text-right font-semibold text-[#0B7439]">{formatCFA(totals.resultats)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-40">
      <Calendar className="w-10 h-10 text-gray-300 mb-2" />
      <p className="text-sm text-[#9CA3AF]">Aucune donnée disponible</p>
    </div>
  )
}
