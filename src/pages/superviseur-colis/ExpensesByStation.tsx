import { useState, useEffect, useCallback } from 'react'
import { Wallet, Loader2, FileText, FileSpreadsheet } from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '@/services/supabase'
import jsPDF from 'jspdf'
import toast from 'react-hot-toast'

function fmtNum(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

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
  nbDepenses: number
  totalDepenses: number
  totalRatios: number
  totalDeductions: number
  revenue: number
  soldeNet: number
}

function getDateRange(period: PeriodType, refDate: string, customFrom: string, customTo: string) {
  const d = new Date(refDate)
  if (period === 'custom') {
    return { from: customFrom, to: customTo }
  }
  switch (period) {
    case 'daily': return { from: refDate, to: refDate }
    case 'monthly': {
      const start = new Date(d.getFullYear(), d.getMonth(), 1)
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0)
      return { from: format(start, 'yyyy-MM-dd'), to: format(end, 'yyyy-MM-dd') }
    }
    case 'quarterly': {
      const q = Math.floor(d.getMonth() / 3)
      const start = new Date(d.getFullYear(), q * 3, 1)
      const end = new Date(d.getFullYear(), q * 3 + 3, 0)
      return { from: format(start, 'yyyy-MM-dd'), to: format(end, 'yyyy-MM-dd') }
    }
    case 'yearly': return { from: `${d.getFullYear()}-01-01`, to: `${d.getFullYear()}-12-31` }
  }
}

export default function ExpensesByStation() {
  const [period, setPeriod] = useState<PeriodType>('daily')
  const [refDate, setRefDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [customFrom, setCustomFrom] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [customTo, setCustomTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<StationRow[]>([])
  const [stationFilter, setStationFilter] = useState('')
  const [agentFilter, setAgentFilter] = useState('')
  const [stations, setStations] = useState<{ id: string; name: string }[]>([])
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    supabase.from('stations').select('id, name').eq('is_active', true).order('name').then(({ data }) => {
      if (data) setStations(data)
    })
    supabase.from('users').select('id, full_name').eq('role', 'agent_colis').order('full_name').then(({ data }) => {
      if (data) setAgents(data.map(u => ({ id: u.id, name: u.full_name || u.id })))
    })
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    const range = getDateRange(period, refDate, customFrom, customTo)
    if (!range) { setLoading(false); return }

    // Fetch expenses
    let expQ = supabase
      .from('parcel_service_expenses')
      .select('station_id, expense_type, amount, station:stations!station_id(id, name)')
      .gte('expense_date', range.from)
      .lte('expense_date', range.to)

    if (stationFilter) expQ = expQ.eq('station_id', stationFilter)
    if (agentFilter) expQ = expQ.eq('agent_id', agentFilter)

    // Fetch revenue (parcels)
    let revQ = supabase
      .from('parcels')
      .select('origin_station_id, delivery_fee')
      .gte('created_at', new Date(range.from).toISOString())
      .lte('created_at', new Date(range.to + 'T23:59:59').toISOString())

    if (stationFilter) revQ = revQ.eq('origin_station_id', stationFilter)

    const [expRes, revRes] = await Promise.all([expQ, revQ])

    const map = new Map<string, StationRow>()

    // Process expenses
    for (const e of expRes.data || []) {
      const st = (e as any).station
      const sid = e.station_id || 'unknown'
      const sname = st?.name || 'Inconnue'
      if (!map.has(sid)) map.set(sid, { stationId: sid, stationName: sname, nbDepenses: 0, totalDepenses: 0, totalRatios: 0, totalDeductions: 0, revenue: 0, soldeNet: 0 })
      const row = map.get(sid)!
      row.nbDepenses++
      if (e.expense_type === 'depense') row.totalDepenses += (e.amount || 0)
      else row.totalRatios += (e.amount || 0)
    }

    // Process revenue
    for (const p of revRes.data || []) {
      const sid = p.origin_station_id || 'unknown'
      if (!map.has(sid)) {
        const st = stations.find(s => s.id === sid)
        map.set(sid, { stationId: sid, stationName: st?.name || 'Inconnue', nbDepenses: 0, totalDepenses: 0, totalRatios: 0, totalDeductions: 0, revenue: 0, soldeNet: 0 })
      }
      map.get(sid)!.revenue += (p.delivery_fee || 0)
    }

    // Calculate derived fields
    for (const row of map.values()) {
      row.totalDeductions = row.totalDepenses + row.totalRatios
      row.soldeNet = row.revenue - row.totalDeductions
    }

    setRows(Array.from(map.values()).sort((a, b) => b.revenue - a.revenue))
    setLoading(false)
  }, [period, refDate, customFrom, customTo, stationFilter, agentFilter, stations])

  useEffect(() => { fetchData() }, [fetchData])

  const totals = rows.reduce((acc, r) => ({
    nbDepenses: acc.nbDepenses + r.nbDepenses,
    totalDepenses: acc.totalDepenses + r.totalDepenses,
    totalRatios: acc.totalRatios + r.totalRatios,
    totalDeductions: acc.totalDeductions + r.totalDeductions,
    revenue: acc.revenue + r.revenue,
    soldeNet: acc.soldeNet + r.soldeNet,
  }), { nbDepenses: 0, totalDepenses: 0, totalRatios: 0, totalDeductions: 0, revenue: 0, soldeNet: 0 })

  const exportPdf = () => {
    const doc = new jsPDF('landscape')
    doc.setFontSize(14)
    doc.text('Rapport Depenses & Ratios par Gare', 14, 16)
    doc.setFontSize(9)
    doc.text(`Periode: ${period} | Date: ${refDate}`, 14, 23)

    let y = 32
    const cols = [14, 22, 72, 102, 132, 162, 192, 232]
    doc.setFont('helvetica', 'bold')
    doc.text('N', cols[0], y)
    doc.text('Gare', cols[1], y)
    doc.text('Nb Dep.', cols[2], y)
    doc.text('Depenses', cols[3], y)
    doc.text('Ratios', cols[4], y)
    doc.text('Deductions', cols[5], y)
    doc.text('Recettes', cols[6], y)
    doc.text('Solde Net', cols[7], y)
    y += 7
    doc.setFont('helvetica', 'normal')

    rows.forEach((r, i) => {
      if (y > 190) { doc.addPage(); y = 20 }
      doc.text(String(i + 1), cols[0], y)
      doc.text(r.stationName.substring(0, 24), cols[1], y)
      doc.text(String(r.nbDepenses), cols[2], y)
      doc.text(fmtNum(r.totalDepenses), cols[3], y)
      doc.text(fmtNum(r.totalRatios), cols[4], y)
      doc.text(fmtNum(r.totalDeductions), cols[5], y)
      doc.text(fmtNum(r.revenue), cols[6], y)
      doc.text(fmtNum(r.soldeNet), cols[7], y)
      y += 6
    })

    y += 4
    doc.setFont('helvetica', 'bold')
    doc.text('TOTAL', cols[1], y)
    doc.text(String(totals.nbDepenses), cols[2], y)
    doc.text(fmtNum(totals.totalDepenses), cols[3], y)
    doc.text(fmtNum(totals.totalRatios), cols[4], y)
    doc.text(fmtNum(totals.totalDeductions), cols[5], y)
    doc.text(fmtNum(totals.revenue), cols[6], y)
    doc.text(fmtNum(totals.soldeNet), cols[7], y)

    doc.save(`depenses_ratios_par_gare_${refDate}.pdf`)
    toast.success('PDF exporte')
  }

  const exportExcel = async () => {
    const XLSX = await import('xlsx')
    const data = rows.map((r, i) => ({
      'N°': i + 1,
      'Gare': r.stationName,
      'Nb Depenses': r.nbDepenses,
      'Total Depenses (FCFA)': r.totalDepenses,
      'Total Ratios (FCFA)': r.totalRatios,
      'Total Deductions (FCFA)': r.totalDeductions,
      'Recettes (FCFA)': r.revenue,
      'Solde Net (FCFA)': r.soldeNet,
    }))
    data.push({
      'N°': '' as any, 'Gare': 'TOTAL',
      'Nb Depenses': totals.nbDepenses,
      'Total Depenses (FCFA)': totals.totalDepenses,
      'Total Ratios (FCFA)': totals.totalRatios,
      'Total Deductions (FCFA)': totals.totalDeductions,
      'Recettes (FCFA)': totals.revenue,
      'Solde Net (FCFA)': totals.soldeNet,
    })
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Depenses Ratios')
    XLSX.writeFile(wb, `depenses_ratios_par_gare_${refDate}.xlsx`)
    toast.success('Excel exporte')
  }

  const fmt = (n: number) => fmtNum(n)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-100 rounded-lg"><Wallet className="w-6 h-6 text-amber-600" /></div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Depenses & Ratios par Gare</h1>
            <p className="text-sm text-gray-500">Vue consolidee des depenses operationnelles courrier</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={exportPdf} className="flex items-center gap-1 px-3 py-2 text-sm bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition"><FileText className="w-4 h-4" />PDF</button>
          <button onClick={exportExcel} className="flex items-center gap-1 px-3 py-2 text-sm bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition"><FileSpreadsheet className="w-4 h-4" />Excel</button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border p-4 shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Periode</label>
            <select value={period} onChange={e => setPeriod(e.target.value as PeriodType)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-amber-500">
              {PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {period !== 'custom' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Date de reference</label>
              <input type="date" value={refDate} onChange={e => setRefDate(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-amber-500" />
            </div>
          )}
          {period === 'custom' && (
            <>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Du</label>
                <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-amber-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Au</label>
                <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-amber-500" />
              </div>
            </>
          )}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Gare</label>
            <select value={stationFilter} onChange={e => setStationFilter(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-amber-500">
              <option value="">Toutes les gares</option>
              {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Agent</label>
            <select value={agentFilter} onChange={e => setAgentFilter(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-amber-500">
              <option value="">Tous les agents</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-amber-500" /></div>
      ) : (
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="px-3 py-3 text-left font-semibold text-gray-600 w-10">N°</th>
                  <th className="px-3 py-3 text-left font-semibold text-gray-600">Gare</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-600">Nb Dep.</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-600">Depenses</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-600">Ratios</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-600">Deductions</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-600">Recettes</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-600">Solde Net</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r, i) => (
                  <tr key={r.stationId} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-3 text-gray-500 font-medium">{i + 1}</td>
                    <td className="px-3 py-3 font-medium text-gray-900">{r.stationName}</td>
                    <td className="px-3 py-3 text-right text-gray-700">{r.nbDepenses}</td>
                    <td className="px-3 py-3 text-right text-red-600">{fmt(r.totalDepenses)}</td>
                    <td className="px-3 py-3 text-right text-orange-600">{fmt(r.totalRatios)}</td>
                    <td className="px-3 py-3 text-right font-medium text-red-700">{fmt(r.totalDeductions)}</td>
                    <td className="px-3 py-3 text-right text-green-700">{fmt(r.revenue)}</td>
                    <td className={`px-3 py-3 text-right font-semibold ${r.soldeNet >= 0 ? 'text-green-700' : 'text-red-700'}`}>{fmt(r.soldeNet)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Aucune donnee pour cette periode</td></tr>
                )}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr className="bg-amber-50 border-t-2 border-amber-200">
                    <td className="px-3 py-3" />
                    <td className="px-3 py-3 font-bold text-amber-800">TOTAL</td>
                    <td className="px-3 py-3 text-right font-bold text-amber-800">{totals.nbDepenses}</td>
                    <td className="px-3 py-3 text-right font-bold text-red-700">{fmt(totals.totalDepenses)}</td>
                    <td className="px-3 py-3 text-right font-bold text-orange-700">{fmt(totals.totalRatios)}</td>
                    <td className="px-3 py-3 text-right font-bold text-red-800">{fmt(totals.totalDeductions)}</td>
                    <td className="px-3 py-3 text-right font-bold text-green-700">{fmt(totals.revenue)}</td>
                    <td className={`px-3 py-3 text-right font-bold ${totals.soldeNet >= 0 ? 'text-green-800' : 'text-red-800'}`}>{fmt(totals.soldeNet)}</td>
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
