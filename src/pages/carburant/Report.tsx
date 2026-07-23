import { useState, useEffect, useCallback, useMemo } from 'react'
import { ArrowLeft, Search, FileText, Download, Filter, Fuel, Bus, MapPin, ChevronDown } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../services/supabase'
import { useAuthStore } from '../../store/authStore'
import { buildCompanyGroups, resolveCompanyIds, type CompanyWithHierarchy } from '../../utils/companyGroups'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'

interface Company extends CompanyWithHierarchy {}

interface Row {
  company_id: string | null
  id: string
  withdrawal_date: string
  registration_number: string
  driver_name: string | null
  station_name: string
  station_code: string
  city: string | null
  fuel_type: string
  liters: number
  unit_price: number | null
  total_amount: number
  observations: string | null
}

const FUEL_LABELS: Record<string, string> = { essence: 'Essence', gasoil: 'Gasoil' }
const FUEL_COLORS: Record<string, string> = { essence: '#F59E0B', gasoil: '#3B82F6' }

function fmt(n: number) {
  return new Intl.NumberFormat('fr-FR').format(Math.round(n)).replace(/\u202f|\u00a0/g, ' ') + ' FCFA'
}
function fmtL(n: number) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(n).replace(/\u202f|\u00a0/g, ' ') + ' L'
}

export default function CarburantReport() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  const [rows, setRows]           = useState<Row[]>([])
  const [loading, setLoading]     = useState(false)
  const [companies, setCompanies] = useState<Company[]>([])

  // filters
  const today = format(new Date(), 'yyyy-MM-dd')
  const [dateFrom,       setDateFrom]       = useState(format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd'))
  const [dateTo,         setDateTo]         = useState(today)
  const [search,         setSearch]         = useState('')
  const [filterFuel,     setFilterFuel]     = useState('')
  const [filterStation,  setFilterStation]  = useState('')
  const [filterCity,     setFilterCity]     = useState('')
  const [filterBus,      setFilterBus]      = useState('')
  const [filterCompany,  setFilterCompany]  = useState('')

  const { groups, standalone } = useMemo(() => buildCompanyGroups(companies), [companies])

  useEffect(() => {
    supabase.from('companies').select('id,name,code,parent_id,is_group').eq('is_active', true).order('name')
      .then(({ data }) => setCompanies((data as Company[]) || []))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('comptable_fuel_withdrawals')
      .select('id,company_id,withdrawal_date,registration_number,driver_name,station_name,station_code,city,fuel_type,liters,unit_price,total_amount,observations')
      .eq('created_by', user?.id ?? '')
      .gte('withdrawal_date', dateFrom)
      .lte('withdrawal_date', dateTo)
      .order('withdrawal_date', { ascending: false })
    if (error) { toast.error('Erreur chargement'); setLoading(false); return }
    setRows((data as Row[]) || [])
    setLoading(false)
  }, [user?.id, dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  const companyIds = useMemo(() =>
    filterCompany ? new Set(resolveCompanyIds(filterCompany, companies)) : null
  , [filterCompany, companies])

  const filtered = rows.filter(r => {
    const q = search.toLowerCase()
    const matchSearch  = !q
      || r.registration_number.toLowerCase().includes(q)
      || (r.driver_name ?? '').toLowerCase().includes(q)
      || r.station_name.toLowerCase().includes(q)
      || (r.city ?? '').toLowerCase().includes(q)
    const matchFuel    = !filterFuel    || r.fuel_type    === filterFuel
    const matchStation = !filterStation || r.station_name === filterStation
    const matchCity    = !filterCity    || r.city         === filterCity
    const matchBus     = !filterBus     || r.registration_number === filterBus
    const matchCompany = !companyIds    || (r.company_id != null && companyIds.has(r.company_id))
    return matchSearch && matchFuel && matchStation && matchCity && matchBus && matchCompany
  })

  const totalLiters = filtered.reduce((s, r) => s + Number(r.liters), 0)
  const totalAmount = filtered.reduce((s, r) => s + Number(r.total_amount), 0)

  // unique values for filter dropdowns
  const stations = [...new Set(rows.map(r => r.station_name))].sort()
  const cities   = [...new Set(rows.map(r => r.city).filter(Boolean) as string[])].sort()
  const buses    = [...new Set(rows.map(r => r.registration_number))].sort()

  // ── Excel export ──────────────────────────────────────────────────────────

  const exportExcel = () => {
    const wsData = [
      ['Date', 'Immatriculation', 'Société', 'Station', 'Ville', 'Type', 'Litres', 'Prix unitaire', 'Montant total', 'Observations'],
      ...filtered.map(r => [
        format(new Date(r.withdrawal_date + 'T00:00:00'), 'dd/MM/yyyy'),
        r.registration_number,
        companies.find(c => c.id === r.company_id)?.name ?? '—',
        r.station_name,
        r.city ?? '',
        FUEL_LABELS[r.fuel_type] ?? r.fuel_type,
        r.liters,
        r.unit_price ?? '',
        r.total_amount,
        r.observations ?? '',
      ]),
      [],
      ['', '', '', '', '', 'TOTAL', totalLiters, '', totalAmount, ''],
    ]
    const ws = XLSX.utils.aoa_to_sheet(wsData)
    ws['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 24 }, { wch: 22 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 28 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Prélèvements Carburant')
    XLSX.writeFile(wb, `prelevements_carburant_${dateFrom}_${dateTo}.xlsx`)
    toast.success('Export Excel téléchargé')
  }

  // ── PDF export ────────────────────────────────────────────────────────────

  const exportPDF = async () => {
    const { default: jsPDF } = await import('jspdf')
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

    const colWidths = [22, 30, 40, 38, 26, 18, 20, 30]
    const headers = ['Date', 'Immatriculation', 'Société', 'Station', 'Ville', 'Type', 'Litres', 'Montant']
    const startX = 10
    let y = 10
    const rowH = 7

    // Title
    doc.setFontSize(14)
    doc.setTextColor(11, 116, 57)
    doc.text('Rapport Prélèvements Carburant', startX, y + 6)
    y += 12

    doc.setFontSize(8)
    doc.setTextColor(100, 100, 100)
    doc.text(
      `Période : ${format(new Date(dateFrom + 'T00:00:00'), 'dd/MM/yyyy')} — ${format(new Date(dateTo + 'T00:00:00'), 'dd/MM/yyyy')}  |  ${filtered.length} prélèvement(s)  |  ${fmtL(totalLiters)}  |  ${fmt(totalAmount)}`,
      startX, y
    )
    y += 8

    // Header row
    doc.setFillColor(11, 116, 57)
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(7.5)
    let x = startX
    headers.forEach((h, i) => {
      doc.rect(x, y, colWidths[i], rowH, 'F')
      doc.text(h, x + 2, y + 4.5)
      x += colWidths[i]
    })
    y += rowH

    // Data rows
    doc.setTextColor(30, 30, 30)
    filtered.forEach((r, idx) => {
      if (y > 190) { doc.addPage(); y = 10 }
      const cells = [
        format(new Date(r.withdrawal_date + 'T00:00:00'), 'dd/MM/yyyy'),
        r.registration_number,
        companies.find(c => c.id === r.company_id)?.name ?? '—',
        r.station_name,
        r.city ?? '—',
        FUEL_LABELS[r.fuel_type] ?? r.fuel_type,
        fmtL(r.liters),
        fmt(r.total_amount),
      ]
      if (idx % 2 === 0) {
        doc.setFillColor(248, 250, 248)
        x = startX
        colWidths.forEach(w => { doc.rect(x, y, w, rowH, 'F'); x += w })
      }
      x = startX
      doc.setFontSize(7)
      cells.forEach((c, i) => {
        const txt = doc.splitTextToSize(c, colWidths[i] - 3)
        doc.text(txt[0] ?? '', x + 2, y + 4.5)
        x += colWidths[i]
      })
      y += rowH
    })

    // Footer row
    doc.setFillColor(240, 253, 244)
    doc.setTextColor(11, 116, 57)
    x = startX
    colWidths.forEach(w => { doc.rect(x, y, w, rowH, 'F'); x += w })
    doc.setFontSize(7.5)
    const footCells = ['', '', '', '', '', 'TOTAL', fmtL(totalLiters), fmt(totalAmount)]
    x = startX
    footCells.forEach((c, i) => { doc.text(c, x + 2, y + 4.5); x += colWidths[i] })

    doc.save(`prelevements_carburant_${dateFrom}_${dateTo}.pdf`)
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
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Rapports carburant</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Historique de tous vos prélèvements
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportExcel} disabled={filtered.length === 0}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold disabled:opacity-40 transition-colors hover:bg-gray-50"
            style={{ borderColor: 'var(--border)', color: '#0B7439' }}>
            <Download className="w-4 h-4" />Excel
          </button>
          <button onClick={exportPDF} disabled={filtered.length === 0}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold disabled:opacity-40 transition-colors hover:bg-gray-50"
            style={{ borderColor: 'var(--border)', color: '#DC2626' }}>
            <FileText className="w-4 h-4" />PDF
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-xl p-4 border mb-6 space-y-3" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2 mb-1">
          <Filter className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Filtres</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Du</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="w-full px-2 py-1.5 border rounded-lg text-xs"
              style={{ borderColor: 'var(--border)' }} />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Au</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="w-full px-2 py-1.5 border rounded-lg text-xs"
              style={{ borderColor: 'var(--border)' }} />
          </div>
          <div className="relative">
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Recherche</label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Bus, chauffeur…"
                className="w-full pl-7 pr-2 py-1.5 border rounded-lg text-xs"
                style={{ borderColor: 'var(--border)' }} />
            </div>
          </div>
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
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Station</label>
            <select value={filterStation} onChange={e => setFilterStation(e.target.value)}
              className="w-full px-2 py-1.5 border rounded-lg text-xs"
              style={{ borderColor: 'var(--border)' }}>
              <option value="">Toutes</option>
              {stations.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Ville</label>
            <select value={filterCity} onChange={e => setFilterCity(e.target.value)}
              className="w-full px-2 py-1.5 border rounded-lg text-xs"
              style={{ borderColor: 'var(--border)' }}>
              <option value="">Toutes</option>
              {cities.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="relative">
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Société / Sous-groupe</label>
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
        </div>
        {(search || filterFuel || filterStation || filterCity || filterBus || filterCompany) && (
          <button onClick={() => { setSearch(''); setFilterFuel(''); setFilterStation(''); setFilterCity(''); setFilterBus(''); setFilterCompany('') }}
            className="text-xs underline mt-1" style={{ color: 'var(--text-muted)' }}>
            Réinitialiser
          </button>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { icon: <FileText className="w-4 h-4" />, label: 'Prélèvements', value: filtered.length.toString(), color: '#1D6FA4' },
          { icon: <Fuel className="w-4 h-4" />, label: 'Total litres', value: fmtL(totalLiters), color: '#3B82F6' },
          { icon: <Bus className="w-4 h-4" />, label: 'Bus distincts', value: new Set(filtered.map(r => r.registration_number)).size.toString(), color: '#0B7439' },
          { icon: <MapPin className="w-4 h-4" />, label: 'Total montant', value: fmt(totalAmount), color: '#F59E0B' },
        ].map(k => (
          <div key={k.label} className="rounded-xl p-4 border" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2 mb-1">
              <span style={{ color: k.color }}>{k.icon}</span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{k.label}</span>
            </div>
            <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 rounded-full animate-spin" style={{ borderColor: '#0B7439', borderTopColor: 'transparent' }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16" style={{ color: 'var(--text-muted)' }}>
            <Fuel className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Aucun prélèvement trouvé</p>
            <p className="text-xs mt-1">Modifiez les filtres ou ajoutez un prélèvement</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)' }}>
                  {['Date', 'Immatriculation', 'Société', 'Station', 'Ville', 'Type', 'Litres', 'Prix/L', 'Montant'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide whitespace-nowrap"
                      style={{ color: 'var(--text-muted)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={r.id}
                    className="border-b last:border-0 hover:bg-gray-50 transition-colors"
                    style={{ borderColor: 'var(--border)', backgroundColor: i % 2 === 0 ? 'transparent' : 'var(--bg-subtle)' }}>
                    <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {format(new Date(r.withdrawal_date + 'T00:00:00'), 'dd MMM yyyy', { locale: fr })}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <Bus className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#0B7439' }} />
                        <span className="font-mono text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{r.registration_number}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                        {companies.find(c => c.id === r.company_id)?.name ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: 'var(--text-primary)' }}>{r.station_name}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
                        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{r.city ?? '—'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                        style={{ backgroundColor: `${FUEL_COLORS[r.fuel_type] ?? '#6B7280'}18`, color: FUEL_COLORS[r.fuel_type] ?? '#6B7280' }}>
                        {FUEL_LABELS[r.fuel_type] ?? r.fuel_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-semibold text-xs" style={{ color: '#3B82F6' }}>
                      {fmtL(r.liters)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: 'var(--text-muted)' }}>
                      {r.unit_price != null ? `${r.unit_price.toLocaleString('fr-FR')} F/L` : '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-bold text-xs" style={{ color: '#0B7439' }}>
                      {fmt(r.total_amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ backgroundColor: '#F0FDF4', borderTop: '2px solid #BBF7D0' }}>
                  <td colSpan={6} className="px-4 py-3 text-xs font-bold text-right" style={{ color: '#0B7439' }}>
                    TOTAUX ({filtered.length} prélèvement{filtered.length > 1 ? 's' : ''})
                  </td>
                  <td className="px-4 py-3 text-xs font-bold" style={{ color: '#3B82F6' }}>{fmtL(totalLiters)}</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-xs font-bold" style={{ color: '#0B7439' }}>{fmt(totalAmount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
