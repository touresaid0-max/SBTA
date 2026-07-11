import { useState, useEffect, useCallback } from 'react'
import { Banknote, Loader2, Download, FileSpreadsheet, FileText } from 'lucide-react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { supabase } from '@/services/supabase'
import jsPDF from 'jspdf'
import toast from 'react-hot-toast'

type PeriodType = 'daily' | 'monthly' | 'quarterly' | 'yearly' | 'custom'

const PERIOD_OPTIONS: { value: PeriodType; label: string }[] = [
  { value: 'daily', label: 'Journalier' },
  { value: 'monthly', label: 'Mensuel' },
  { value: 'quarterly', label: 'Trimestriel' },
  { value: 'yearly', label: 'Annuel' },
  { value: 'custom', label: 'Periode personnalisee' },
]

interface StationRow {
  stationId: string
  stationName: string
  operationCount: number
  totalRevenue: number
}

function getDateRange(period: PeriodType, refDate: string, customFrom: string, customTo: string) {
  const d = new Date(refDate)
  if (period === 'custom') {
    return { from: new Date(customFrom).toISOString(), to: new Date(customTo + 'T23:59:59').toISOString() }
  }
  switch (period) {
    case 'daily': {
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate())
      const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
      return { from: start.toISOString(), to: end.toISOString() }
    }
    case 'monthly': {
      const start = new Date(d.getFullYear(), d.getMonth(), 1)
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
      return { from: start.toISOString(), to: end.toISOString() }
    }
    case 'quarterly': {
      const q = Math.floor(d.getMonth() / 3)
      const start = new Date(d.getFullYear(), q * 3, 1)
      const end = new Date(d.getFullYear(), q * 3 + 3, 0, 23, 59, 59, 999)
      return { from: start.toISOString(), to: end.toISOString() }
    }
    case 'yearly': {
      const start = new Date(d.getFullYear(), 0, 1)
      const end = new Date(d.getFullYear(), 11, 31, 23, 59, 59, 999)
      return { from: start.toISOString(), to: end.toISOString() }
    }
  }
}

export default function RevenueByStation() {
  const [period, setPeriod] = useState<PeriodType>('daily')
  const [refDate, setRefDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [customFrom, setCustomFrom] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [customTo, setCustomTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<StationRow[]>([])
  const [stationFilter, setStationFilter] = useState('')
  const [stations, setStations] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    supabase.from('stations').select('id, name').eq('is_active', true).order('name').then(({ data }) => {
      if (data) setStations(data)
    })
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    const range = getDateRange(period, refDate, customFrom, customTo)
    if (!range) { setLoading(false); return }

    let query = supabase
      .from('parcels')
      .select('origin_station_id, total_amount, origin_station:stations!origin_station_id(id, name)')
      .gte('created_at', range.from)
      .lte('created_at', range.to)

    if (stationFilter) query = query.eq('origin_station_id', stationFilter)

    const { data, error } = await query
    if (error) { toast.error('Erreur chargement'); setLoading(false); return }

    const map = new Map<string, StationRow>()
    for (const p of data || []) {
      const st = (p as any).origin_station
      const sid = p.origin_station_id || 'unknown'
      const sname = st?.name || 'Inconnue'
      if (!map.has(sid)) map.set(sid, { stationId: sid, stationName: sname, operationCount: 0, totalRevenue: 0 })
      const row = map.get(sid)!
      row.operationCount++
      row.totalRevenue += (p.total_amount || 0)
    }
    setRows(Array.from(map.values()).sort((a, b) => b.totalRevenue - a.totalRevenue))
    setLoading(false)
  }, [period, refDate, customFrom, customTo, stationFilter])

  useEffect(() => { fetchData() }, [fetchData])

  const totalOps = rows.reduce((s, r) => s + r.operationCount, 0)
  const totalRevenue = rows.reduce((s, r) => s + r.totalRevenue, 0)

  const exportPdf = () => {
    const doc = new jsPDF()
    doc.setFontSize(16)
    doc.text('Rapport des Recettes par Gare', 14, 18)
    doc.setFontSize(10)
    doc.text(`Periode: ${period} | Date ref: ${refDate}`, 14, 26)

    let y = 36
    const cols = [14, 24, 80, 130, 170]
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text('N', cols[0], y)
    doc.text('Gare', cols[1], y)
    doc.text('Operations', cols[2], y)
    doc.text('Recettes (FCFA)', cols[3], y)
    y += 8
    doc.setFont('helvetica', 'normal')

    rows.forEach((r, i) => {
      if (y > 275) { doc.addPage(); y = 20 }
      doc.text(String(i + 1), cols[0], y)
      doc.text(r.stationName.substring(0, 30), cols[1], y)
      doc.text(String(r.operationCount), cols[2], y)
      doc.text(r.totalRevenue.toLocaleString('fr-FR'), cols[3], y)
      y += 7
    })

    y += 4
    doc.setFont('helvetica', 'bold')
    doc.text('TOTAL', cols[1], y)
    doc.text(String(totalOps), cols[2], y)
    doc.text(totalRevenue.toLocaleString('fr-FR'), cols[3], y)

    doc.save(`recettes_par_gare_${refDate}.pdf`)
    toast.success('PDF exporte')
  }

  const exportExcel = async () => {
    const XLSX = await import('xlsx')
    const data = rows.map((r, i) => ({
      'N°': i + 1,
      'Gare': r.stationName,
      'Operations': r.operationCount,
      'Recettes (FCFA)': r.totalRevenue,
    }))
    data.push({ 'N°': '' as any, 'Gare': 'TOTAL', 'Operations': totalOps, 'Recettes (FCFA)': totalRevenue })
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Recettes')
    XLSX.writeFile(wb, `recettes_par_gare_${refDate}.xlsx`)
    toast.success('Excel exporte')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-green-100 rounded-lg"><Banknote className="w-6 h-6 text-green-600" /></div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Recettes par Gare</h1>
            <p className="text-sm text-gray-500">Rapport consolide des recettes courrier</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={exportPdf} className="flex items-center gap-1 px-3 py-2 text-sm bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition"><FileText className="w-4 h-4" />PDF</button>
          <button onClick={exportExcel} className="flex items-center gap-1 px-3 py-2 text-sm bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition"><FileSpreadsheet className="w-4 h-4" />Excel</button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border p-4 shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Periode</label>
            <select value={period} onChange={e => setPeriod(e.target.value as PeriodType)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-green-500">
              {PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {period !== 'custom' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Date de reference</label>
              <input type="date" value={refDate} onChange={e => setRefDate(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
            </div>
          )}
          {period === 'custom' && (
            <>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Du</label>
                <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Au</label>
                <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
              </div>
            </>
          )}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Gare</label>
            <select value={stationFilter} onChange={e => setStationFilter(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-green-500">
              <option value="">Toutes les gares</option>
              {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-green-500" /></div>
      ) : (
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 w-12">N°</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Nom de la gare</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-600">Nombre d'operations</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-600">Montant total recettes</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r, i) => (
                  <tr key={r.stationId} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-gray-500 font-medium">{i + 1}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{r.stationName}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{r.operationCount}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">{r.totalRevenue.toLocaleString('fr-FR')} FCFA</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">Aucune donnee pour cette periode</td></tr>
                )}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr className="bg-green-50 border-t-2 border-green-200">
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3 font-bold text-green-800">TOTAL GENERAL</td>
                    <td className="px-4 py-3 text-right font-bold text-green-800">{totalOps}</td>
                    <td className="px-4 py-3 text-right font-bold text-green-800">{totalRevenue.toLocaleString('fr-FR')} FCFA</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
