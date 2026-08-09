import { useState, useEffect, useCallback } from 'react'
import {
  fetchDailyConsolidation, formatCFA,
  type DailyConsolidation,
} from '@/services/abg.service'
import { BookOpen, Calendar, FileDown, FileSpreadsheet } from 'lucide-react'
import toast from 'react-hot-toast'
import { exportPDF, exportTableExcel } from '@/utils/abgExports'

export default function ComptesJournaliers() {
  const [data, setData] = useState<DailyConsolidation[]>([])
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await fetchDailyConsolidation(dateFrom || undefined, dateTo || undefined)
      setData(rows)
    } catch {
      toast.error('Erreur lors du chargement')
    }
    setLoading(false)
  }, [dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  const handleExportPDF = async () => {
    const headers = ['Date', 'Gare', 'Société', 'Segment', 'N° Cars', 'Recettes', 'Dép. P/R', 'Résultats', 'Bagage']
    const rows = data.map(r => [
      new Date(r.date).toLocaleDateString('fr-FR'), r.gare_label, r.societe_code, r.segment_code ?? '—',
      String(r.nb_bordereaux), formatCFA(r.recettes_totales), formatCFA(r.depense_pr), formatCFA(r.resultats), formatCFA(r.bagage_total),
    ])
    const totalsRow = ['TOTAL', '', '', '', String(totals.bordereaux), formatCFA(totals.recettes), formatCFA(totals.depense), formatCFA(totals.resultats), formatCFA(totals.bagage)]
    const periodLabel = dateFrom || dateTo ? `${dateFrom || '…'} → ${dateTo || '…'}` : 'Toutes périodes'
    await exportPDF('Comptes journaliers', `Période: ${periodLabel}`, headers, rows, totalsRow, 'comptes_journaliers.pdf')
    toast.success('PDF exporté')
  }

  const handleExportExcel = () => {
    const headers = ['Date', 'Gare', 'Société', 'Segment', 'N° Cars', 'Recettes', 'Dép. P/R', 'Résultats', 'Bagage']
    const rows = data.map(r => [
      new Date(r.date).toLocaleDateString('fr-FR'), r.gare_label, r.societe_code, r.segment_code ?? '—',
      String(r.nb_bordereaux), formatCFA(r.recettes_totales), formatCFA(r.depense_pr), formatCFA(r.resultats), formatCFA(r.bagage_total),
    ])
    const totalsRow = ['TOTAL', '', '', '', String(totals.bordereaux), formatCFA(totals.recettes), formatCFA(totals.depense), formatCFA(totals.resultats), formatCFA(totals.bagage)]
    exportTableExcel('Comptes journaliers', headers, rows, totalsRow, 'comptes_journaliers.xlsx')
    toast.success('Excel exporté')
  }

  const totals = data.reduce((acc, r) => ({
    seats: acc.seats + r.total_seats,
    recettes: acc.recettes + Number(r.recettes_totales),
    depense: acc.depense + Number(r.depense_pr),
    resultats: acc.resultats + Number(r.resultats),
    bagage: acc.bagage + Number(r.bagage_total),
    bordereaux: acc.bordereaux + r.nb_bordereaux,
  }), { seats: 0, recettes: 0, depense: 0, resultats: 0, bagage: 0, bordereaux: 0 })

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1a2a22]">Comptes journaliers</h1>
          <p className="text-sm mt-0.5 text-[#6B7280]">Comptabilité journalière de la ligne Agboville — par gare / société / car</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExportPDF} disabled={data.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 disabled:opacity-50">
            <FileDown className="w-4 h-4" /> PDF
          </button>
          <button onClick={handleExportExcel} disabled={data.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 disabled:opacity-50">
            <FileSpreadsheet className="w-4 h-4" /> Excel
          </button>
        </div>
      </div>

      {/* Date filters */}
      <div className="flex gap-3 items-end">
        <div>
          <label className="text-xs text-[#6B7280] mb-1 block">Du</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="border border-[#E2EAE5] rounded-lg px-3 py-2 text-sm text-[#374151] focus:outline-none focus:border-[#0B7439]" />
        </div>
        <div>
          <label className="text-xs text-[#6B7280] mb-1 block">Au</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="border border-[#E2EAE5] rounded-lg px-3 py-2 text-sm text-[#374151] focus:outline-none focus:border-[#0B7439]" />
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryCard label="Bordereaux" value={totals.bordereaux.toString()} />
        <SummaryCard label="Sièges" value={totals.seats.toString()} />
        <SummaryCard label="Recettes" value={formatCFA(totals.recettes)} highlight />
        <SummaryCard label="Dépenses P/R" value={formatCFA(totals.depense)} />
        <SummaryCard label="Résultats" value={formatCFA(totals.resultats)} highlight />
        <SummaryCard label="Bagage" value={formatCFA(totals.bagage)} />
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : data.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40">
            <BookOpen className="w-10 h-10 text-gray-300 mb-2" />
            <p className="text-sm text-[#9CA3AF]">Aucune donnée pour cette période</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#F8FAF8]">
                <tr>
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Date</th>
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Gare</th>
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Société</th>
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Segment</th>
                  <th className="text-center px-4 py-3 text-[#4A6B55] font-semibold">N° Cars</th>
                  <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Recettes</th>
                  <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Dép. P/R</th>
                  <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Résultats</th>
                  <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Bagage</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r, i) => (
                  <tr key={i} className="border-t border-[#E2EAE5] hover:bg-[#F8FAF8] transition-colors">
                    <td className="px-4 py-3 text-[#374151] whitespace-nowrap">{new Date(r.date).toLocaleDateString('fr-FR')}</td>
                    <td className="px-4 py-3 text-[#374151] font-medium">{r.gare_label}</td>
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-[#0B7439]">{r.societe_code}</td>
                    <td className="px-4 py-3 text-[#6B7280]">{r.segment_code ?? '—'}</td>
                    <td className="px-4 py-3 text-center text-[#374151]">{r.nb_bordereaux}</td>
                    <td className="px-4 py-3 text-right text-[#374151] font-medium">{formatCFA(r.recettes_totales)}</td>
                    <td className="px-4 py-3 text-right text-[#6B7280]">{formatCFA(r.depense_pr)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-[#0B7439]">{formatCFA(r.resultats)}</td>
                    <td className="px-4 py-3 text-right text-[#6B7280]">{formatCFA(r.bagage_total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-[#F8FAF8] border-t-2 border-[#E2EAE5]">
                <tr>
                  <td className="px-4 py-3 font-semibold text-[#4A6B55]" colSpan={4}>Total</td>
                  <td className="px-4 py-3 text-center font-semibold text-[#374151]">{totals.bordereaux}</td>
                  <td className="px-4 py-3 text-right font-semibold text-[#374151]">{formatCFA(totals.recettes)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-[#374151]">{formatCFA(totals.depense)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-[#0B7439]">{formatCFA(totals.resultats)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-[#374151]">{formatCFA(totals.bagage)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${highlight ? 'bg-[#0B7439]/5 border-[#0B7439]/20' : 'bg-white border-[#E2EAE5]'}`}>
      <p className="text-xs text-[#6B7280] mb-0.5">{label}</p>
      <p className={`text-lg font-bold ${highlight ? 'text-[#0B7439]' : 'text-[#1a2a22]'}`}>{value}</p>
    </div>
  )
}
