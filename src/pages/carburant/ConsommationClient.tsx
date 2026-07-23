import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ArrowLeft, FileText, Download, Filter, Fuel, Users, Droplets, Calculator,
  ChevronDown, Calendar,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../services/supabase'
import { useAuthStore } from '../../store/authStore'
import { buildCompanyGroups, resolveCompanyIds, type CompanyWithHierarchy } from '../../utils/companyGroups'
import {
  format, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  startOfYear, endOfYear, subDays,
} from 'date-fns'
import { fr } from 'date-fns/locale'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'

interface Company extends CompanyWithHierarchy {}

interface Withdrawal {
  id: string
  company_id: string | null
  registration_number: string
  station_name: string
  city: string | null
  fuel_type: string
  liters: number
  unit_price: number | null
  total_amount: number
  withdrawal_date: string
}

const MARGE_RATE = 0.10
const FUEL_LABELS: Record<string, string> = { essence: 'Essence', gasoil: 'Gasoil' }
const FUEL_COLORS: Record<string, string> = { essence: '#F59E0B', gasoil: '#3B82F6' }

type PeriodKey = 'day' | 'week' | 'month' | 'year' | 'custom'
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'day',    label: 'Journalier' },
  { key: 'week',   label: 'Hebdomadaire' },
  { key: 'month',  label: 'Mensuel' },
  { key: 'year',   label: 'Annuel' },
  { key: 'custom', label: 'Personnalisé' },
]

function fmt(n: number) {
  return new Intl.NumberFormat('fr-FR').format(Math.round(n)) + ' FCFA'
}
function fmtL(n: number) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(n) + ' L'
}

function getRange(period: PeriodKey, customFrom: string, customTo: string) {
  const today = new Date()
  switch (period) {
    case 'day':
      return { from: format(today, 'yyyy-MM-dd'), to: format(today, 'yyyy-MM-dd') }
    case 'week':
      return {
        from: format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
        to:   format(endOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
      }
    case 'month':
      return {
        from: format(startOfMonth(today), 'yyyy-MM-dd'),
        to:   format(endOfMonth(today), 'yyyy-MM-dd'),
      }
    case 'year':
      return {
        from: format(startOfYear(today), 'yyyy-MM-dd'),
        to:   format(endOfYear(today), 'yyyy-MM-dd'),
      }
    case 'custom':
      return {
        from: customFrom || format(subDays(today, 30), 'yyyy-MM-dd'),
        to:   customTo || format(today, 'yyyy-MM-dd'),
      }
  }
}

interface ClientRow {
  companyName: string
  liters: number
  avgUnitPrice: number
  totalAmount: number
  margin: number
}

export default function ConsommationClient() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const today = new Date()

  const [period, setPeriod]           = useState<PeriodKey>('month')
  const [customFrom, setCustomFrom]   = useState(format(subDays(today, 30), 'yyyy-MM-dd'))
  const [customTo, setCustomTo]       = useState(format(today, 'yyyy-MM-dd'))
  const [filterCompany, setFilterCompany] = useState('')
  const [filterStation, setFilterStation] = useState('')
  const [filterCity, setFilterCity]       = useState('')
  const [filterFuel, setFilterFuel]       = useState('')
  const [filterClient, setFilterClient]   = useState('')

  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([])
  const [companies, setCompanies]     = useState<Company[]>([])
  const [loading, setLoading]         = useState(false)

  const { from, to } = useMemo(
    () => getRange(period, customFrom, customTo),
    [period, customFrom, customTo],
  )

  const { groups, standalone } = useMemo(() => buildCompanyGroups(companies), [companies])

  useEffect(() => {
    supabase.from('companies').select('id,name,code,parent_id,is_group').eq('is_active', true).order('name')
      .then(({ data }) => setCompanies((data as Company[]) || []))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('comptable_fuel_withdrawals')
      .select('id,company_id,registration_number,station_name,city,fuel_type,liters,unit_price,total_amount,withdrawal_date')
      .eq('created_by', user?.id ?? '')
      .gte('withdrawal_date', from)
      .lte('withdrawal_date', to)
      .order('withdrawal_date', { ascending: false })
    if (error) { toast.error('Erreur lors du chargement des données'); setLoading(false); return }
    setWithdrawals((data as Withdrawal[]) || [])
    setLoading(false)
  }, [user?.id, from, to])

  useEffect(() => { load() }, [load])

  const companyIds = useMemo(() =>
    filterCompany ? new Set(resolveCompanyIds(filterCompany, companies)) : null
  , [filterCompany, companies])

  const filtered = useMemo(() => {
    return withdrawals.filter(w => {
      const matchCompany = !companyIds || (w.company_id != null && companyIds.has(w.company_id))
      const matchStation = !filterStation || w.station_name === filterStation
      const matchCity    = !filterCity || w.city === filterCity
      const matchFuel    = !filterFuel || w.fuel_type === filterFuel
      return matchCompany && matchStation && matchCity && matchFuel
    })
  }, [withdrawals, companyIds, filterStation, filterCity, filterFuel])

  // ── Aggregate by client (company) ──────────────────────────────────────────
  const clientRows: ClientRow[] = useMemo(() => {
    const map = new Map<string, { liters: number; totalAmount: number; priceSum: number; priceCount: number }>()
    for (const w of filtered) {
      const cName = companies.find(c => c.id === w.company_id)?.name ?? '— Inconnu —'
      const entry = map.get(cName) ?? { liters: 0, totalAmount: 0, priceSum: 0, priceCount: 0 }
      entry.liters += Number(w.liters)
      entry.totalAmount += Number(w.total_amount)
      if (w.unit_price != null && w.unit_price > 0) {
        entry.priceSum += Number(w.unit_price)
        entry.priceCount += 1
      }
      map.set(cName, entry)
    }
    return Array.from(map.entries()).map(([companyName, e]) => ({
      companyName,
      liters: e.liters,
      avgUnitPrice: e.priceCount > 0 ? e.priceSum / e.priceCount : 0,
      totalAmount: e.totalAmount,
      margin: e.totalAmount * MARGE_RATE,
    })).sort((a, b) => b.totalAmount - a.totalAmount)
  }, [filtered, companies])

  // Apply client name text filter
  const displayedRows = useMemo(() => {
    const q = filterClient.toLowerCase().trim()
    if (!q) return clientRows
    return clientRows.filter(r => r.companyName.toLowerCase().includes(q))
  }, [clientRows, filterClient])

  const totalLiters  = displayedRows.reduce((s, r) => s + r.liters, 0)
  const totalAmount  = displayedRows.reduce((s, r) => s + r.totalAmount, 0)
  const totalMargin  = displayedRows.reduce((s, r) => s + r.margin, 0)

  const stations = useMemo(() => [...new Set(withdrawals.map(w => w.station_name))].sort(), [withdrawals])
  const cities   = useMemo(() => [...new Set(withdrawals.map(w => w.city).filter(Boolean) as string[])].sort(), [withdrawals])

  const periodLabel = useMemo(() => {
    if (period === 'day')    return `le ${format(today, 'dd MMMM yyyy', { locale: fr })}`
    if (period === 'week')   return `sem. du ${format(new Date(from + 'T00:00:00'), 'dd MMM', { locale: fr })} au ${format(new Date(to + 'T00:00:00'), 'dd MMM yyyy', { locale: fr })}`
    if (period === 'month')  return format(today, 'MMMM yyyy', { locale: fr })
    if (period === 'year')   return format(today, 'yyyy')
    return `du ${format(new Date(from + 'T00:00:00'), 'dd MMM', { locale: fr })} au ${format(new Date(to + 'T00:00:00'), 'dd MMM yyyy', { locale: fr })}`
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, from, to])

  // ── Excel export ───────────────────────────────────────────────────────────
  const exportExcel = () => {
    if (displayedRows.length === 0) { toast.error('Aucune donnée à exporter'); return }
    const wsData: (string | number)[][] = [
      ['RAPPORT CONSOMMATION PAR CLIENT'],
      [`Période: ${periodLabel}`],
      [],
      ['Client', 'Qté (L)', 'Prix unitaire moyen', 'Montant TTC', 'Marge (10%)'],
      ...displayedRows.map(r => [
        r.companyName,
        Number(r.liters.toFixed(2)),
        r.avgUnitPrice > 0 ? Math.round(r.avgUnitPrice) : '',
        Math.round(r.totalAmount),
        Math.round(r.margin),
      ]),
      [],
      ['CONSOMMATION TOTALE', Number(totalLiters.toFixed(2)), '', Math.round(totalAmount), Math.round(totalMargin)],
    ]
    const ws = XLSX.utils.aoa_to_sheet(wsData)
    ws['!cols'] = [{ wch: 32 }, { wch: 14 }, { wch: 20 }, { wch: 18 }, { wch: 16 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Consommation Client')
    XLSX.writeFile(wb, `consommation_client_${from}_${to}.xlsx`)
    toast.success('Export Excel téléchargé')
  }

  // ── PDF export ─────────────────────────────────────────────────────────────
  const exportPDF = async () => {
    if (displayedRows.length === 0) { toast.error('Aucune donnée à exporter'); return }
    const { default: jsPDF } = await import('jspdf')
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

    const colWidths = [60, 28, 34, 36, 28]
    const headers = ['Client', 'Qté (L)', 'Prix unit. moy.', 'Montant TTC', 'Marge (10%)']
    const startX = 12
    const pageW = 210
    let y = 16
    const rowH = 8

    // Title
    doc.setFontSize(15)
    doc.setTextColor(11, 116, 57)
    doc.text('Rapport Consommation par Client', startX, y)
    y += 7

    doc.setFontSize(9)
    doc.setTextColor(90, 90, 90)
    doc.text(`Période : ${periodLabel}`, startX, y)
    y += 5
    const filterParts: string[] = []
    if (filterCompany) filterParts.push(`Société: ${companies.find(c => c.id === filterCompany)?.name ?? filterCompany}`)
    if (filterStation) filterParts.push(`Station: ${filterStation}`)
    if (filterCity) filterParts.push(`Ville: ${filterCity}`)
    if (filterFuel) filterParts.push(`Carburant: ${FUEL_LABELS[filterFuel] ?? filterFuel}`)
    if (filterParts.length > 0) {
      doc.text(`Filtres : ${filterParts.join('  |  ')}`, startX, y)
      y += 5
    }
    y += 3

    // Header row
    doc.setFillColor(11, 116, 57)
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(8.5)
    let x = startX
    headers.forEach((h, i) => {
      doc.rect(x, y, colWidths[i], rowH, 'F')
      doc.text(h, x + 2, y + 5.5)
      x += colWidths[i]
    })
    y += rowH

    // Data rows
    doc.setTextColor(30, 30, 30)
    displayedRows.forEach((r, idx) => {
      if (y > 270) { doc.addPage(); y = 16 }
      const cells = [
        r.companyName,
        fmtL(r.liters),
        r.avgUnitPrice > 0 ? `${Math.round(r.avgUnitPrice).toLocaleString('fr-FR')} F/L` : '—',
        fmt(r.totalAmount),
        fmt(r.margin),
      ]
      if (idx % 2 === 0) {
        doc.setFillColor(248, 250, 248)
        x = startX
        colWidths.forEach(w => { doc.rect(x, y, w, rowH, 'F'); x += w })
      }
      x = startX
      doc.setFontSize(7.5)
      cells.forEach((c, i) => {
        const txt = doc.splitTextToSize(String(c), colWidths[i] - 3)
        doc.text(txt[0] ?? '', x + 2, y + 5.5)
        x += colWidths[i]
      })
      y += rowH
    })

    // Footer totals
    y += 2
    doc.setFillColor(240, 253, 244)
    doc.setTextColor(11, 116, 57)
    doc.setFontSize(8.5)
    x = startX
    colWidths.forEach(w => { doc.rect(x, y, w, rowH, 'F'); x += w })
    const footCells = ['CONSOMMATION TOTALE', fmtL(totalLiters), '', fmt(totalAmount), fmt(totalMargin)]
    x = startX
    footCells.forEach((c, i) => { doc.text(c, x + 2, y + 5.5); x += colWidths[i] })

    // Page number footer
    const pageCount = doc.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i)
      doc.setFontSize(7)
      doc.setTextColor(150, 150, 150)
      doc.text(`Page ${i}/${pageCount}`, pageW - 30, 290)
    }

    doc.save(`consommation_client_${from}_${to}.pdf`)
    toast.success('Export PDF téléchargé')
  }

  return (
    <div className="p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-wrap items-start gap-4 mb-8">
        <button onClick={() => navigate('/carburant/dashboard')}
          className="p-2 rounded-xl hover:bg-gray-100 transition-colors mt-1"
          style={{ color: 'var(--text-secondary)' }}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Consommation par Client
          </h1>
          <p className="text-sm capitalize" style={{ color: 'var(--text-secondary)' }}>
            Rapport de consommation carburant — {periodLabel}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportExcel} disabled={displayedRows.length === 0}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold disabled:opacity-40 transition-colors hover:bg-gray-50"
            style={{ borderColor: 'var(--border)', color: '#0B7439' }}>
            <Download className="w-4 h-4" />Excel
          </button>
          <button onClick={exportPDF} disabled={displayedRows.length === 0}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold disabled:opacity-40 transition-colors hover:bg-gray-50"
            style={{ borderColor: 'var(--border)', color: '#DC2626' }}>
            <FileText className="w-4 h-4" />PDF
          </button>
        </div>
      </div>

      {/* Period tabs */}
      <div className="flex flex-wrap items-center gap-3 mb-4 px-4 py-3 rounded-2xl border"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-1 flex-wrap">
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              className="px-4 py-2 rounded-xl text-sm font-semibold transition-all"
              style={{
                backgroundColor: period === p.key ? '#0B7439' : 'transparent',
                color: period === p.key ? '#fff' : 'var(--text-secondary)',
              }}>
              {p.label}
            </button>
          ))}
        </div>
        {period === 'custom' && (
          <div className="flex items-center gap-2 ml-auto">
            <Calendar className="w-4 h-4 flex-shrink-0" style={{ color: '#0B7439' }} />
            <input type="date" value={customFrom} max={customTo}
              onChange={e => setCustomFrom(e.target.value)}
              className="px-3 py-2 border rounded-xl text-sm"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>au</span>
            <input type="date" value={customTo} min={customFrom}
              onChange={e => setCustomTo(e.target.value)}
              className="px-3 py-2 border rounded-xl text-sm"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="rounded-xl p-4 border mb-6 space-y-3"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2 mb-1">
          <Filter className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Filtres</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {/* Société */}
          <div className="relative">
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Société</label>
            <select value={filterCompany} onChange={e => setFilterCompany(e.target.value)}
              className="w-full appearance-none pl-2 pr-6 py-1.5 border rounded-lg text-xs"
              style={{ borderColor: 'var(--border)' }}>
              <option value="">Toutes</option>
              {groups.map(({ group, subsidiaries }) => (
                <optgroup key={group.id} label={`${group.name} — Groupe (${subsidiaries.length})`}>
                  <option value={group.id}>{group.name} (toutes)</option>
                  {subsidiaries.map(sub => (
                    <option key={sub.id} value={sub.id}>↳ {sub.name} ({sub.code})</option>
                  ))}
                </optgroup>
              ))}
              {standalone.length > 0 && (
                <optgroup label="Autonomes">
                  {standalone.map(c => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
                </optgroup>
              )}
            </select>
            <ChevronDown className="absolute right-1 top-[22px] w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
          </div>
          {/* Station */}
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Station</label>
            <select value={filterStation} onChange={e => setFilterStation(e.target.value)}
              className="w-full px-2 py-1.5 border rounded-lg text-xs"
              style={{ borderColor: 'var(--border)' }}>
              <option value="">Toutes</option>
              {stations.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {/* Ville */}
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Ville</label>
            <select value={filterCity} onChange={e => setFilterCity(e.target.value)}
              className="w-full px-2 py-1.5 border rounded-lg text-xs"
              style={{ borderColor: 'var(--border)' }}>
              <option value="">Toutes</option>
              {cities.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {/* Type carburant */}
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Type carburant</label>
            <select value={filterFuel} onChange={e => setFilterFuel(e.target.value)}
              className="w-full px-2 py-1.5 border rounded-lg text-xs"
              style={{ borderColor: 'var(--border)' }}>
              <option value="">Tous</option>
              <option value="essence">Essence</option>
              <option value="gasoil">Gasoil</option>
            </select>
          </div>
          {/* Client search */}
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Client</label>
            <input type="text" value={filterClient} onChange={e => setFilterClient(e.target.value)}
              placeholder="Nom du client…"
              className="w-full px-2 py-1.5 border rounded-lg text-xs"
              style={{ borderColor: 'var(--border)' }} />
          </div>
        </div>
        {(filterCompany || filterStation || filterCity || filterFuel || filterClient) && (
          <button onClick={() => { setFilterCompany(''); setFilterStation(''); setFilterCity(''); setFilterFuel(''); setFilterClient('') }}
            className="text-xs underline mt-1" style={{ color: 'var(--text-muted)' }}>
            Réinitialiser
          </button>
        )}
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { icon: <Users className="w-4 h-4" />, label: 'Clients', value: displayedRows.length.toString(), color: '#1D6FA4' },
          { icon: <Droplets className="w-4 h-4" />, label: 'Consommation totale', value: fmtL(totalLiters), color: '#3B82F6' },
          { icon: <Fuel className="w-4 h-4" />, label: 'Montant total TTC', value: fmt(totalAmount), color: '#F59E0B' },
          { icon: <Calculator className="w-4 h-4" />, label: 'Marge totale (10%)', value: fmt(totalMargin), color: '#0B7439' },
        ].map(k => (
          <div key={k.label} className="rounded-xl p-4 border"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2 mb-1">
              <span style={{ color: k.color }}>{k.icon}</span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{k.label}</span>
            </div>
            <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-2xl border overflow-hidden"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 rounded-full animate-spin"
              style={{ borderColor: '#0B7439', borderTopColor: 'transparent' }} />
          </div>
        ) : displayedRows.length === 0 ? (
          <div className="text-center py-16" style={{ color: 'var(--text-muted)' }}>
            <Fuel className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Aucune consommation trouvée</p>
            <p className="text-xs mt-1">Modifiez les filtres ou la période</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)' }}>
                  {['Client', 'Qté (L)', 'Prix unit. moyen', 'Montant TTC', 'Marge (10%)'].map(h => (
                    <th key={h}
                      className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide whitespace-nowrap"
                      style={{ color: 'var(--text-muted)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayedRows.map((r, i) => (
                  <tr key={r.companyName}
                    className="border-b last:border-0 hover:bg-gray-50 transition-colors"
                    style={{ borderColor: 'var(--border)', backgroundColor: i % 2 === 0 ? 'transparent' : 'var(--bg-subtle)' }}>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <Users className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#1D6FA4' }} />
                        <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{r.companyName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-semibold text-xs" style={{ color: '#3B82F6' }}>
                      {fmtL(r.liters)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: 'var(--text-muted)' }}>
                      {r.avgUnitPrice > 0 ? `${Math.round(r.avgUnitPrice).toLocaleString('fr-FR')} F/L` : '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-bold text-xs" style={{ color: '#F59E0B' }}>
                      {fmt(r.totalAmount)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-bold text-xs" style={{ color: '#0B7439' }}>
                      {fmt(r.margin)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ backgroundColor: '#F0FDF4', borderTop: '2px solid #BBF7D0' }}>
                  <td className="px-4 py-3 text-xs font-bold" style={{ color: '#0B7439' }}>
                    CONSOMMATION TOTALE ({displayedRows.length} client{displayedRows.length > 1 ? 's' : ''})
                  </td>
                  <td className="px-4 py-3 text-xs font-bold" style={{ color: '#3B82F6' }}>{fmtL(totalLiters)}</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-xs font-bold" style={{ color: '#F59E0B' }}>{fmt(totalAmount)}</td>
                  <td className="px-4 py-3 text-xs font-bold" style={{ color: '#0B7439' }}>{fmt(totalMargin)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
