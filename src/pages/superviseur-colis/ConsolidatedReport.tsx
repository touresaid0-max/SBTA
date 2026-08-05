import { useState, useEffect, useCallback } from 'react'
import { BarChart3, Loader2, FileText, FileSpreadsheet, Building2, Hash, Banknote, MessageSquare, Wallet, TrendingDown, Calculator } from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '@/services/supabase'
import jsPDF from 'jspdf'
import toast from 'react-hot-toast'

const SMS_UNIT_COST = 100

type PeriodType = 'daily' | 'monthly' | 'quarterly' | 'yearly' | 'custom'

const PERIOD_OPTIONS: { value: PeriodType; label: string }[] = [
  { value: 'daily', label: 'Journalier' },
  { value: 'monthly', label: 'Mensuel' },
  { value: 'quarterly', label: 'Trimestriel' },
  { value: 'yearly', label: 'Annuel' },
  { value: 'custom', label: 'Periode personnalisee' },
]

interface StationDetail {
  stationId: string
  stationName: string
  operations: number
  revenue: number
  smsFees: number
  depenses: number
  ratios: number
  deductions: number
  soldeNet: number
}

function getDateRange(period: PeriodType, refDate: string, customFrom: string, customTo: string) {
  const d = new Date(refDate)
  if (period === 'custom') {
    return { from: customFrom, to: customTo, isoFrom: new Date(customFrom).toISOString(), isoTo: new Date(customTo + 'T23:59:59').toISOString() }
  }
  let from: string, to: string
  switch (period) {
    case 'daily': from = refDate; to = refDate; break
    case 'monthly': {
      const start = new Date(d.getFullYear(), d.getMonth(), 1)
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0)
      from = format(start, 'yyyy-MM-dd'); to = format(end, 'yyyy-MM-dd'); break
    }
    case 'quarterly': {
      const q = Math.floor(d.getMonth() / 3)
      const start = new Date(d.getFullYear(), q * 3, 1)
      const end = new Date(d.getFullYear(), q * 3 + 3, 0)
      from = format(start, 'yyyy-MM-dd'); to = format(end, 'yyyy-MM-dd'); break
    }
    case 'yearly': from = `${d.getFullYear()}-01-01`; to = `${d.getFullYear()}-12-31`; break
  }
  return { from: from!, to: to!, isoFrom: new Date(from!).toISOString(), isoTo: new Date(to! + 'T23:59:59').toISOString() }
}

export default function ConsolidatedReport() {
  const [period, setPeriod] = useState<PeriodType>('monthly')
  const [refDate, setRefDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [customFrom, setCustomFrom] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [customTo, setCustomTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [loading, setLoading] = useState(true)
  const [details, setDetails] = useState<StationDetail[]>([])
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

    let parcelsQ = supabase
      .from('parcels')
      .select('origin_station_id, total_amount, delivery_fee, origin_station:stations!origin_station_id(id, name)')
      .gte('created_at', range.isoFrom)
      .lte('created_at', range.isoTo)

    let expQ = supabase
      .from('parcel_service_expenses')
      .select('station_id, expense_type, amount, station:stations!station_id(id, name)')
      .gte('expense_date', range.from)
      .lte('expense_date', range.to)

    if (stationFilter) {
      parcelsQ = parcelsQ.eq('origin_station_id', stationFilter)
      expQ = expQ.eq('station_id', stationFilter)
    }

    const [parcelsRes, expRes] = await Promise.all([parcelsQ, expQ])

    const map = new Map<string, StationDetail>()
    const ensure = (sid: string, sname: string) => {
      if (!map.has(sid)) map.set(sid, { stationId: sid, stationName: sname, operations: 0, revenue: 0, smsFees: 0, depenses: 0, ratios: 0, deductions: 0, soldeNet: 0 })
      return map.get(sid)!
    }

    for (const p of parcelsRes.data || []) {
      const st = (p as any).origin_station
      const row = ensure(p.origin_station_id || 'x', st?.name || 'Inconnue')
      row.operations++
      row.revenue += (p.total_amount || 0)
    }

    for (const e of expRes.data || []) {
      const st = (e as any).station
      const row = ensure(e.station_id || 'x', st?.name || 'Inconnue')
      if (e.expense_type === 'depense') row.depenses += (e.amount || 0)
      else row.ratios += (e.amount || 0)
    }

    for (const row of map.values()) {
      row.smsFees = row.operations * SMS_UNIT_COST
      row.deductions = row.depenses + row.ratios
      row.soldeNet = row.revenue - row.deductions
    }

    setDetails(Array.from(map.values()).sort((a, b) => b.revenue - a.revenue))
    setLoading(false)
  }, [period, refDate, customFrom, customTo, stationFilter])

  useEffect(() => { fetchData() }, [fetchData])

  const totals = details.reduce((acc, r) => ({
    stations: acc.stations + 1,
    operations: acc.operations + r.operations,
    revenue: acc.revenue + r.revenue,
    smsFees: acc.smsFees + r.smsFees,
    depenses: acc.depenses + r.depenses,
    ratios: acc.ratios + r.ratios,
    deductions: acc.deductions + r.deductions,
    soldeNet: acc.soldeNet + r.soldeNet,
  }), { stations: 0, operations: 0, revenue: 0, smsFees: 0, depenses: 0, ratios: 0, deductions: 0, soldeNet: 0 })

  const fmt = (n: number) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

  const exportPdf = () => {
    const doc = new jsPDF('landscape')
    doc.setFontSize(14)
    doc.text('Rapport Global Consolide - Service Courrier', 14, 16)
    doc.setFontSize(9)
    doc.text(`Periode: ${period} | Date: ${refDate}`, 14, 23)

    let y = 32
    doc.setFont('helvetica', 'bold')
    doc.text(`Gares: ${totals.stations} | Operations: ${totals.operations} | Recettes: ${fmt(totals.revenue)} FCFA`, 14, y)
    doc.text(`SMS: ${fmt(totals.smsFees)} | Depenses: ${fmt(totals.depenses)} | Ratios: ${fmt(totals.ratios)} | Solde: ${fmt(totals.soldeNet)} FCFA`, 14, y + 6)
    y += 16

    const cols = [14, 22, 68, 88, 113, 138, 158, 183, 208, 243]
    doc.setFontSize(8)
    doc.text('N', cols[0], y)
    doc.text('Gare', cols[1], y)
    doc.text('Ops', cols[2], y)
    doc.text('Recettes', cols[3], y)
    doc.text('SMS', cols[4], y)
    doc.text('Depenses', cols[5], y)
    doc.text('Ratios', cols[6], y)
    doc.text('Deductions', cols[7], y)
    doc.text('Solde Net', cols[8], y)
    y += 6
    doc.setFont('helvetica', 'normal')

    details.forEach((r, i) => {
      if (y > 190) { doc.addPage(); y = 20 }
      doc.text(String(i + 1), cols[0], y)
      doc.text(r.stationName.substring(0, 22), cols[1], y)
      doc.text(String(r.operations), cols[2], y)
      doc.text(fmt(r.revenue), cols[3], y)
      doc.text(fmt(r.smsFees), cols[4], y)
      doc.text(fmt(r.depenses), cols[5], y)
      doc.text(fmt(r.ratios), cols[6], y)
      doc.text(fmt(r.deductions), cols[7], y)
      doc.text(fmt(r.soldeNet), cols[8], y)
      y += 5.5
    })

    doc.save(`rapport_consolide_courrier_${refDate}.pdf`)
    toast.success('PDF exporte')
  }

  const exportExcel = async () => {
    const XLSX = await import('xlsx')
    const data = details.map((r, i) => ({
      'N°': i + 1,
      'Gare': r.stationName,
      'Operations': r.operations,
      'Recettes (FCFA)': r.revenue,
      'Frais SMS (FCFA)': r.smsFees,
      'Depenses (FCFA)': r.depenses,
      'Ratios (FCFA)': r.ratios,
      'Deductions (FCFA)': r.deductions,
      'Solde Net (FCFA)': r.soldeNet,
    }))
    data.push({
      'N°': '' as any, 'Gare': 'TOTAL',
      'Operations': totals.operations,
      'Recettes (FCFA)': totals.revenue,
      'Frais SMS (FCFA)': totals.smsFees,
      'Depenses (FCFA)': totals.depenses,
      'Ratios (FCFA)': totals.ratios,
      'Deductions (FCFA)': totals.deductions,
      'Solde Net (FCFA)': totals.soldeNet,
    })
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Consolide')
    XLSX.writeFile(wb, `rapport_consolide_courrier_${refDate}.xlsx`)
    toast.success('Excel exporte')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-100 rounded-lg"><BarChart3 className="w-6 h-6 text-indigo-600" /></div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Rapport Global Consolide</h1>
            <p className="text-sm text-gray-500">Synthese de toutes les gares - Service courrier</p>
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
            <select value={period} onChange={e => setPeriod(e.target.value as PeriodType)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500">
              {PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {period !== 'custom' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Date de reference</label>
              <input type="date" value={refDate} onChange={e => setRefDate(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500" />
            </div>
          )}
          {period === 'custom' && (
            <>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Du</label>
                <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Au</label>
                <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500" />
              </div>
            </>
          )}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Gare</label>
            <select value={stationFilter} onChange={e => setStationFilter(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500">
              <option value="">Toutes les gares</option>
              {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /></div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            <KpiMini icon={<Building2 className="w-4 h-4 text-gray-600" />} label="Gares" value={String(totals.stations)} />
            <KpiMini icon={<Hash className="w-4 h-4 text-blue-600" />} label="Operations" value={fmt(totals.operations)} />
            <KpiMini icon={<Banknote className="w-4 h-4 text-green-600" />} label="Recettes" value={`${fmt(totals.revenue)}`} />
            <KpiMini icon={<MessageSquare className="w-4 h-4 text-sky-600" />} label="Frais SMS" value={`${fmt(totals.smsFees)}`} />
            <KpiMini icon={<Wallet className="w-4 h-4 text-red-600" />} label="Depenses" value={`${fmt(totals.depenses)}`} />
            <KpiMini icon={<TrendingDown className="w-4 h-4 text-orange-600" />} label="Ratios" value={`${fmt(totals.ratios)}`} />
            <KpiMini icon={<Calculator className="w-4 h-4 text-red-700" />} label="Deductions" value={`${fmt(totals.deductions)}`} />
            <KpiMini icon={<Banknote className="w-4 h-4 text-emerald-600" />} label="Solde" value={`${fmt(totals.soldeNet)}`} highlight={totals.soldeNet >= 0} />
          </div>

          {/* Detail table */}
          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b bg-gray-50">
              <h2 className="font-semibold text-gray-800">Detail par gare</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="px-3 py-3 text-left font-semibold text-gray-600 w-10">N°</th>
                    <th className="px-3 py-3 text-left font-semibold text-gray-600">Gare</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-600">Ops</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-600">Recettes</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-600">SMS</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-600">Depenses</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-600">Ratios</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-600">Deductions</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-600">Solde Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {details.map((r, i) => (
                    <tr key={r.stationId} className="hover:bg-gray-50 transition-colors">
                      <td className="px-3 py-2.5 text-gray-500">{i + 1}</td>
                      <td className="px-3 py-2.5 font-medium text-gray-900">{r.stationName}</td>
                      <td className="px-3 py-2.5 text-right">{r.operations}</td>
                      <td className="px-3 py-2.5 text-right text-green-700 font-medium">{fmt(r.revenue)}</td>
                      <td className="px-3 py-2.5 text-right text-sky-600">{fmt(r.smsFees)}</td>
                      <td className="px-3 py-2.5 text-right text-red-600">{fmt(r.depenses)}</td>
                      <td className="px-3 py-2.5 text-right text-orange-600">{fmt(r.ratios)}</td>
                      <td className="px-3 py-2.5 text-right text-red-700 font-medium">{fmt(r.deductions)}</td>
                      <td className={`px-3 py-2.5 text-right font-semibold ${r.soldeNet >= 0 ? 'text-green-700' : 'text-red-700'}`}>{fmt(r.soldeNet)}</td>
                    </tr>
                  ))}
                  {details.length === 0 && (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Aucune donnée pour cette période</td></tr>
                  )}
                </tbody>
                {details.length > 0 && (
                  <tfoot>
                    <tr className="bg-indigo-50 border-t-2 border-indigo-200">
                      <td className="px-3 py-3" />
                      <td className="px-3 py-3 font-bold text-indigo-800">TOTAL GENERAL</td>
                      <td className="px-3 py-3 text-right font-bold text-indigo-800">{fmt(totals.operations)}</td>
                      <td className="px-3 py-3 text-right font-bold text-green-700">{fmt(totals.revenue)}</td>
                      <td className="px-3 py-3 text-right font-bold text-sky-700">{fmt(totals.smsFees)}</td>
                      <td className="px-3 py-3 text-right font-bold text-red-700">{fmt(totals.depenses)}</td>
                      <td className="px-3 py-3 text-right font-bold text-orange-700">{fmt(totals.ratios)}</td>
                      <td className="px-3 py-3 text-right font-bold text-red-800">{fmt(totals.deductions)}</td>
                      <td className={`px-3 py-3 text-right font-bold ${totals.soldeNet >= 0 ? 'text-green-800' : 'text-red-800'}`}>{fmt(totals.soldeNet)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function KpiMini({ icon, label, value, highlight }: { icon: React.ReactNode; label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`bg-white rounded-lg border p-3 shadow-sm ${highlight === false ? 'border-red-200' : ''}`}>
      <div className="flex items-center gap-1.5 mb-1">{icon}<span className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</span></div>
      <p className="text-sm font-bold text-gray-900 truncate">{value}</p>
    </div>
  )
}
