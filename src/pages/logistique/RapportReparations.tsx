import { useEffect, useState, useMemo, useCallback } from 'react'
import { FileText, FileSpreadsheet, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import { fetchReparations } from '@/services/garageSbta.service'
import { ReparationStatusBadge } from '@/pages/gerant_principal/Reparations'
import type { GarageReparation, ReparationStatut } from '@/types/garage.types'
import { formatDate } from '@/components/garage/reportHelpers'
import { exportTableExcel, exportPDF } from '@/utils/abgExports'

type Period = 'day' | 'week' | 'month' | 'year'

const PERIOD_LABELS: Record<Period, string> = {
  day: "Aujourd'hui",
  week: "Cette semaine",
  month: "Ce mois",
  year: "Cette année",
}

function periodStart(period: Period): Date {
  const now = new Date()
  const start = new Date(now)
  if (period === 'day') start.setHours(0, 0, 0, 0)
  else if (period === 'week') {
    const day = now.getDay() || 7
    start.setDate(now.getDate() - day + 1)
    start.setHours(0, 0, 0, 0)
  } else if (period === 'month') {
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
  } else if (period === 'year') {
    start.setMonth(0, 1)
    start.setHours(0, 0, 0, 0)
  }
  return start
}

function daysBetween(from: string, to: Date): number {
  const diff = to.getTime() - new Date(from).getTime()
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)))
}

export default function RapportReparations() {
  const [reparations, setReparations] = useState<GarageReparation[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<Period>('month')

  const load = useCallback(() => {
    setLoading(true)
    fetchReparations()
      .then(setReparations)
      .catch(() => toast.error('Erreur de chargement'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const start = periodStart(period)
    return reparations.filter(r => new Date(r.date) >= start)
  }, [reparations, period])

  const stats = useMemo(() => {
    const counts: Record<ReparationStatut, number> = { BROUILLON: 0, 'EN RÉPARATION': 0, LIBÉRÉ: 0 }
    for (const r of filtered) counts[r.statut] = (counts[r.statut] ?? 0) + 1
    return counts
  }, [filtered])

  const now = new Date()

  const handleExportPDF = async () => {
    if (filtered.length === 0) { toast.error('Aucune donnée à exporter'); return }
    const headers = ['N° Car', "Date d'entrée", 'Statut', 'Technicien', 'Type technicien', 'Durée (jours)', 'Description']
    const rows = filtered.map(r => [
      r.bus?.registration_number ?? r.car?.immatriculation ?? 'N/A',
      formatDate(r.date),
      r.statut,
      r.technicien?.full_name ?? '—',
      r.type_technicien?.nom ?? '—',
      String(daysBetween(r.date, r.statut === 'LIBÉRÉ' ? new Date(r.updated_at) : now)),
      r.description || '—',
    ])
    await exportPDF(
      'Rapport des réparations',
      `${PERIOD_LABELS[period]} — ${filtered.length} réparation(s)`,
      headers,
      rows,
      undefined,
      `rapport_reparations_${period}_${new Date().toISOString().slice(0, 10)}`,
    )
  }

  const handleExportExcel = () => {
    if (filtered.length === 0) { toast.error('Aucune donnée à exporter'); return }
    const headers = ['N° Car', "Date d'entrée", 'Statut', 'Technicien', 'Type technicien', 'Durée (jours)', 'Description']
    const dataRows = filtered.map(r => [
      r.bus?.registration_number ?? r.car?.immatriculation ?? 'N/A',
      formatDate(r.date),
      r.statut,
      r.technicien?.full_name ?? '—',
      r.type_technicien?.nom ?? '—',
      daysBetween(r.date, r.statut === 'LIBÉRÉ' ? new Date(r.updated_at) : now),
      r.description || '—',
    ])
    exportTableExcel(
      'Rapport réparations',
      headers,
      dataRows,
      undefined,
      `rapport_reparations_${period}_${new Date().toISOString().slice(0, 10)}`,
    )
  }

  const inputCls = 'px-3 py-2 rounded-xl border border-[#E2EAE5] text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439] bg-white'

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1A2E22]">Rapport détaillé des réparations</h1>
          <p className="text-sm text-[#6B7280] mt-1">{filtered.length} réparation(s) — {PERIOD_LABELS[period]}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExportPDF} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0B7439] text-white text-sm font-semibold hover:bg-[#095e2e] transition-colors">
            <FileText className="w-4 h-4" /> Export PDF
          </button>
          <button onClick={handleExportExcel} className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#0B7439] text-[#0B7439] text-sm font-semibold hover:bg-[#E8F5EC] transition-colors">
            <FileSpreadsheet className="w-4 h-4" /> Export Excel
          </button>
        </div>
      </div>

      {/* Period filters */}
      <div className="flex gap-2 flex-wrap">
        {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              period === p
                ? 'bg-[#0B7439] text-white'
                : 'bg-white border border-[#E2EAE5] text-[#4A6B55] hover:bg-[#F8FAF8]'
            }`}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#E5E7EB] flex items-center justify-center">
              <FileText className="w-5 h-5 text-[#6B7280]" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[#1A2E22]">{stats.BROUILLON}</p>
              <p className="text-xs text-[#6B7280]">En brouillon</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#FEE2E2] flex items-center justify-center">
              <Download className="w-5 h-5 text-[#DC2626]" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[#DC2626]">{stats['EN RÉPARATION']}</p>
              <p className="text-xs text-[#6B7280]">En réparation</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#E8F5EC] flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5 text-[#0B7439]" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[#0B7439]">{stats.LIBÉRÉ}</p>
              <p className="text-xs text-[#6B7280]">Libérés</p>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#F8FAF8] border-b border-[#E2EAE5]">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-[#4A6B55]">N° Car</th>
                  <th className="text-left px-4 py-3 font-semibold text-[#4A6B55]">{"Date d'entrée"}</th>
                  <th className="text-left px-4 py-3 font-semibold text-[#4A6B55]">Statut</th>
                  <th className="text-left px-4 py-3 font-semibold text-[#4A6B55]">Technicien</th>
                  <th className="text-left px-4 py-3 font-semibold text-[#4A6B55]">Type technicien</th>
                  <th className="text-left px-4 py-3 font-semibold text-[#4A6B55]">Durée (jours)</th>
                  <th className="text-left px-4 py-3 font-semibold text-[#4A6B55]">Description</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-12 text-[#8AA898]">Aucune réparation sur cette période</td></tr>
                ) : filtered.map(r => (
                  <tr key={r.id} className="border-t border-[#E2EAE5] hover:bg-[#F8FAF8] transition-colors">
                    <td className="px-4 py-3 font-mono font-medium text-[#0B7439]">
                      {r.bus?.registration_number ?? r.car?.immatriculation ?? 'N/A'}
                    </td>
                    <td className="px-4 py-3 text-[#1A2E22]">{formatDate(r.date)}</td>
                    <td className="px-4 py-3"><ReparationStatusBadge statut={r.statut} /></td>
                    <td className="px-4 py-3 text-[#1A2E22]">{r.technicien?.full_name ?? '—'}</td>
                    <td className="px-4 py-3 text-[#1A2E22]">{r.type_technicien?.nom ?? '—'}</td>
                    <td className="px-4 py-3 text-[#1A2E22] font-medium">
                      {daysBetween(r.date, r.statut === 'LIBÉRÉ' ? new Date(r.updated_at) : now)}
                    </td>
                    <td className="px-4 py-3 text-[#4A6B55] line-clamp-1 max-w-xs">{r.description || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
