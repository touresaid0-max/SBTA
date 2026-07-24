import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ArrowLeft, FileText, Download, Filter, Fuel, Droplets, Bus,
  ChevronDown, Calendar, Building2, Container,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../services/supabase'
import { buildCompanyGroups, resolveCompanyIds, type CompanyWithHierarchy } from '../../utils/companyGroups'
import {
  format, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  startOfYear, endOfYear, subDays,
} from 'date-fns'
import { fr } from 'date-fns/locale'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'

/* ─── types ──────────────────────────────────────────────── */

interface Company extends CompanyWithHierarchy {}

interface EnlevementRow {
  id: string
  enlevement_date: string
  created_at: string
  company_id: string | null
  license_plate: string | null
  quantity_liters: number
  unit_price: number
  total_amount: number
  tank_id: string | null
  product_id: string | null
  tank_name: string
  tank_fuel_type: string
  tank_city: string | null
  company_name: string
}

/* ─── constants ──────────────────────────────────────────── */

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

/* ─── helpers ────────────────────────────────────────────── */

function fmt(n: number) {
  return new Intl.NumberFormat('fr-FR').format(Math.round(n)).replace(/\u202f|\u00a0/g, ' ') + ' FCFA'
}
function fmtL(n: number) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(n).replace(/\u202f|\u00a0/g, ' ') + ' L'
}
function fmtPrice(n: number) {
  return new Intl.NumberFormat('fr-FR').format(Math.round(n)).replace(/\u202f|\u00a0/g, ' ') + ' F/L'
}
function fmtDateTime(iso: string) {
  const d = new Date(iso)
  return format(d, 'dd/MM/yyyy HH:mm')
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

/* ─── component ──────────────────────────────────────────── */

export default function TankReport() {
  const navigate = useNavigate()
  const today = new Date()

  const [period, setPeriod]           = useState<PeriodKey>('month')
  const [customFrom, setCustomFrom]   = useState(format(subDays(today, 30), 'yyyy-MM-dd'))
  const [customTo, setCustomTo]       = useState(format(today, 'yyyy-MM-dd'))
  const [filterCompany, setFilterCompany] = useState('')
  const [filterTank, setFilterTank]       = useState('')
  const [filterFuel, setFilterFuel]       = useState('')

  const [rows, setRows]               = useState<EnlevementRow[]>([])
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

  /* ─── load enlevements with joins ─── */

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('fuel_enlevements')
      .select(`
        id,enlevement_date,created_at,company_id,license_plate,quantity_liters,unit_price,total_amount,
        tank_id,product_id,
        tanks:tank_id(name,fuel_type,city),
        companies:company_id(name)
      `)
      .gte('enlevement_date', from)
      .lte('enlevement_date', to)
      .order('enlevement_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) { toast.error('Erreur lors du chargement'); setLoading(false); return }

    const mapped = ((data || []) as any[]).map(r => ({
      id: r.id,
      enlevement_date: r.enlevement_date,
      created_at: r.created_at,
      company_id: r.company_id,
      license_plate: r.license_plate,
      quantity_liters: Number(r.quantity_liters),
      unit_price: Number(r.unit_price),
      total_amount: Number(r.total_amount),
      tank_id: r.tank_id,
      product_id: r.product_id,
      tank_name: r.tanks?.name ?? '—',
      tank_fuel_type: r.tanks?.fuel_type ?? '',
      tank_city: r.tanks?.city ?? null,
      company_name: r.companies?.name ?? '—',
    }))
    setRows(mapped)
    setLoading(false)
  }, [from, to])

  useEffect(() => { load() }, [load])

  /* ─── filter dropdowns ─── */

  const tanks    = useMemo(() => [...new Set(rows.map(r => r.tank_name))].sort(), [rows])
  const fuelTypes = useMemo(() => [...new Set(rows.map(r => r.tank_fuel_type).filter(Boolean))].sort(), [rows])

  /* ─── filtering ─── */

  const companyIds = useMemo(() =>
    filterCompany ? new Set(resolveCompanyIds(filterCompany, companies)) : null
  , [filterCompany, companies])

  const filtered = useMemo(() => {
    return rows.filter(r => {
      const matchCompany = !companyIds || (r.company_id != null && companyIds.has(r.company_id))
      const matchTank    = !filterTank    || r.tank_name === filterTank
      const matchFuel    = !filterFuel    || r.tank_fuel_type === filterFuel
      return matchCompany && matchTank && matchFuel
    })
  }, [rows, companyIds, filterTank, filterFuel])

  /* ─── aggregations ─── */

  const totalLiters  = filtered.reduce((s, r) => s + r.quantity_liters, 0)
  const totalAmount  = filtered.reduce((s, r) => s + r.total_amount, 0)
  const totalCount   = filtered.length

  // avg unit price (weighted by quantity)
  const avgUnitPrice = totalLiters > 0
    ? filtered.reduce((s, r) => s + r.unit_price * r.quantity_liters, 0) / totalLiters
    : 0

  // summary by company
  const byCompany = useMemo(() => {
    const map = new Map<string, { liters: number; amount: number; count: number }>()
    for (const r of filtered) {
      const name = r.company_name
      const e = map.get(name) ?? { liters: 0, amount: 0, count: 0 }
      e.liters += r.quantity_liters
      e.amount += r.total_amount
      e.count += 1
      map.set(name, e)
    }
    return Array.from(map.entries()).map(([name, e]) => ({ name, ...e }))
      .sort((a, b) => b.amount - a.amount)
  }, [filtered])

  const periodLabel = useMemo(() => {
    if (period === 'day')    return `le ${format(today, 'dd MMMM yyyy', { locale: fr })}`
    if (period === 'week')   return `sem. du ${format(new Date(from + 'T00:00:00'), 'dd MMM', { locale: fr })} au ${format(new Date(to + 'T00:00:00'), 'dd MMM yyyy', { locale: fr })}`
    if (period === 'month')  return format(today, 'MMMM yyyy', { locale: fr })
    if (period === 'year')   return format(today, 'yyyy')
    return `du ${format(new Date(from + 'T00:00:00'), 'dd MMM', { locale: fr })} au ${format(new Date(to + 'T00:00:00'), 'dd MMM yyyy', { locale: fr })}`
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, from, to])

  const hasFilters = filterCompany || filterTank || filterFuel
  const resetFilters = () => {
    setFilterCompany(''); setFilterTank(''); setFilterFuel('')
  }

  /* ─── Excel export ─────────────────────────────────────────────────────────── */

  const exportExcel = () => {
    if (filtered.length === 0) { toast.error('Aucune donnée à exporter'); return }
    const wsData: (string | number)[][] = [
      ['RAPPORT CONSOMMATION DES CUVES'],
      [`Période: ${periodLabel}`],
      [],
      ['Date', 'Société', 'Cuve', 'Type carburant', 'Immatriculation', 'Qté (L)', 'Prix unit. moy.', 'Montant TTC', 'Date/heure'],
      ...filtered.map(r => [
        format(new Date(r.enlevement_date + 'T00:00:00'), 'dd/MM/yyyy'),
        r.company_name,
        r.tank_name,
        FUEL_LABELS[r.tank_fuel_type] ?? r.tank_fuel_type,
        r.license_plate ?? '—',
        Number(r.quantity_liters.toFixed(2)),
        Math.round(r.unit_price),
        Math.round(r.total_amount),
        fmtDateTime(r.created_at),
      ]),
      [],
      ['', '', '', '', '', 'TOTAL', '', Math.round(totalAmount), ''],
      [],
      ['RÉCAPITULATIF PAR SOCIÉTÉ'],
      ['Client (Société)', 'Qté (L)', 'Montant TTC'],
      ...byCompany.map(c => [c.name, Number(c.liters.toFixed(2)), Math.round(c.amount)]),
      [],
      ['TOTAL GÉNÉRAL', Number(totalLiters.toFixed(2)), Math.round(totalAmount)],
      [],
      ['Nombre total de prélèvements', totalCount],
      ['Consommation totale (L)', Number(totalLiters.toFixed(2))],
      ['Montant total TTC', Math.round(totalAmount)],
    ]
    const ws = XLSX.utils.aoa_to_sheet(wsData)
    ws['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 18 }, { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 18 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Rapport Cuves')
    XLSX.writeFile(wb, `rapport_cuves_${from}_${to}.xlsx`)
    toast.success('Export Excel téléchargé')
  }

  /* ─── PDF export ───────────────────────────────────────────────────────────── */

  const exportPDF = async () => {
    if (filtered.length === 0) { toast.error('Aucune donnée à exporter'); return }
    const { default: jsPDF } = await import('jspdf')
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

    const colWidths = [20, 32, 22, 20, 24, 16, 22, 24]
    const headers = ['Date', 'Société', 'Cuve', 'Type', 'Immatric.', 'Qté (L)', 'Prix/L', 'Montant TTC']
    const startX = 8
    const pageW = 297
    let y = 14
    const rowH = 6

    // Title
    doc.setFontSize(14)
    doc.setTextColor(11, 116, 57)
    doc.text('Rapport Consommation des Cuves', startX, y)
    y += 6

    doc.setFontSize(8)
    doc.setTextColor(90, 90, 90)
    doc.text(`Période : ${periodLabel}`, startX, y)
    y += 4
    const filterParts: string[] = []
    if (filterCompany)  filterParts.push(`Société: ${companies.find(c => c.id === filterCompany)?.name ?? filterCompany}`)
    if (filterTank)     filterParts.push(`Cuve: ${filterTank}`)
    if (filterFuel)     filterParts.push(`Carburant: ${FUEL_LABELS[filterFuel] ?? filterFuel}`)
    if (filterParts.length > 0) {
      doc.text(`Filtres : ${filterParts.join('  |  ')}`, startX, y)
      y += 4
    }
    y += 2

    // Header row
    doc.setFillColor(11, 116, 57)
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(7.5)
    let x = startX
    headers.forEach((h, i) => {
      doc.rect(x, y, colWidths[i], rowH, 'F')
      doc.text(h, x + 1.5, y + 4.2)
      x += colWidths[i]
    })
    y += rowH

    // Data rows
    doc.setTextColor(30, 30, 30)
    filtered.forEach((r, idx) => {
      if (y > 195) { doc.addPage(); y = 14 }
      const cells = [
        format(new Date(r.enlevement_date + 'T00:00:00'), 'dd/MM/yy'),
        r.company_name,
        r.tank_name,
        FUEL_LABELS[r.tank_fuel_type] ?? r.tank_fuel_type,
        r.license_plate ?? '—',
        fmtL(r.quantity_liters),
        fmtPrice(r.unit_price),
        fmt(r.total_amount),
      ]
      if (idx % 2 === 0) {
        doc.setFillColor(248, 250, 248)
        x = startX
        colWidths.forEach(w => { doc.rect(x, y, w, rowH, 'F'); x += w })
      }
      x = startX
      doc.setFontSize(6.5)
      cells.forEach((c, i) => {
        const txt = doc.splitTextToSize(String(c), colWidths[i] - 2.5)
        doc.text(txt[0] ?? '', x + 1.5, y + 4.2)
        x += colWidths[i]
      })
      y += rowH
    })

    // Footer totals
    doc.setFillColor(240, 253, 244)
    doc.setTextColor(11, 116, 57)
    doc.setFontSize(7.5)
    x = startX
    colWidths.forEach(w => { doc.rect(x, y, w, rowH, 'F'); x += w })
    const footCells = ['', '', '', '', 'TOTAL', fmtL(totalLiters), '', fmt(totalAmount)]
    x = startX
    footCells.forEach((c, i) => { doc.text(c, x + 1.5, y + 4.2); x += colWidths[i] })
    y += rowH + 4

    // ── Summary by company section ──
    if (y > 195) { doc.addPage(); y = 14 }
    doc.setFontSize(11)
    doc.setTextColor(11, 116, 57)
    doc.text('Récapitulatif par Société', startX, y)
    y += 6

    const sumCols = [60, 30, 40]
    const sumHeaders = ['Client (Société)', 'Qté (L)', 'Montant TTC']
    doc.setFillColor(11, 116, 57)
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(8)
    x = startX
    sumHeaders.forEach((h, i) => {
      doc.rect(x, y, sumCols[i], rowH, 'F')
      doc.text(h, x + 1.5, y + 4.2)
      x += sumCols[i]
    })
    y += rowH

    doc.setTextColor(30, 30, 30)
    byCompany.forEach((c, idx) => {
      if (y > 200) { doc.addPage(); y = 14 }
      const cells = [c.name, fmtL(c.liters), fmt(c.amount)]
      if (idx % 2 === 0) {
        doc.setFillColor(248, 250, 248)
        x = startX
        sumCols.forEach(w => { doc.rect(x, y, w, rowH, 'F'); x += w })
      }
      x = startX
      doc.setFontSize(7)
      cells.forEach((cc, i) => {
        const txt = doc.splitTextToSize(String(cc), sumCols[i] - 2.5)
        doc.text(txt[0] ?? '', x + 1.5, y + 4.2)
        x += sumCols[i]
      })
      y += rowH
    })

    // Grand total row
    doc.setFillColor(240, 253, 244)
    doc.setTextColor(11, 116, 57)
    doc.setFontSize(8)
    x = startX
    sumCols.forEach(w => { doc.rect(x, y, w, rowH, 'F'); x += w })
    const gtCells = ['TOTAL GÉNÉRAL', fmtL(totalLiters), fmt(totalAmount)]
    x = startX
    gtCells.forEach((c, i) => { doc.text(c, x + 1.5, y + 4.2); x += sumCols[i] })
    y += rowH + 3

    // Stats footer
    if (y > 205) { doc.addPage(); y = 14 }
    doc.setFontSize(8)
    doc.setTextColor(60, 60, 60)
    doc.text(`Nombre total de prélèvements : ${totalCount}`, startX, y)
    y += 5
    doc.text(`Consommation totale : ${fmtL(totalLiters)}`, startX, y)
    y += 5
    doc.text(`Montant total TTC : ${fmt(totalAmount)}`, startX, y)

    // Page numbers
    const pageCount = doc.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i)
      doc.setFontSize(7)
      doc.setTextColor(150, 150, 150)
      doc.text(`Page ${i}/${pageCount}`, pageW - 25, 205)
    }

    doc.save(`rapport_cuves_${from}_${to}.pdf`)
    toast.success('Export PDF téléchargé')
  }

  /* ─── render ──────────────────────────────────────────── */

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
            Rapport Cuves
          </h1>
          <p className="text-sm capitalize" style={{ color: 'var(--text-secondary)' }}>
            Suivi des consommations de cuves — {periodLabel}
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
          {/* Cuve */}
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Cuve</label>
            <select value={filterTank} onChange={e => setFilterTank(e.target.value)}
              className="w-full px-2 py-1.5 border rounded-lg text-xs"
              style={{ borderColor: 'var(--border)' }}>
              <option value="">Toutes</option>
              {tanks.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {/* Type carburant */}
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Type carburant</label>
            <select value={filterFuel} onChange={e => setFilterFuel(e.target.value)}
              className="w-full px-2 py-1.5 border rounded-lg text-xs"
              style={{ borderColor: 'var(--border)' }}>
              <option value="">Tous</option>
              {fuelTypes.map(ft => <option key={ft} value={ft}>{FUEL_LABELS[ft] ?? ft}</option>)}
            </select>
          </div>
        </div>
        {hasFilters && (
          <button onClick={resetFilters}
            className="text-xs underline mt-1" style={{ color: 'var(--text-muted)' }}>
            Réinitialiser
          </button>
        )}
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { icon: <Droplets className="w-4 h-4" />, label: 'Consommation totale', value: fmtL(totalLiters), color: '#3B82F6' },
          { icon: <Fuel className="w-4 h-4" />, label: 'Montant total TTC', value: fmt(totalAmount), color: '#F59E0B' },
          { icon: <FileText className="w-4 h-4" />, label: 'Nb. prélèvements', value: totalCount.toString(), color: '#1D6FA4' },
          { icon: <Container className="w-4 h-4" />, label: 'Cuves distinctes', value: new Set(filtered.map(r => r.tank_name)).size.toString(), color: '#0B7439' },
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

      {/* Detail table */}
      <div className="rounded-2xl border overflow-hidden mb-6"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 rounded-full animate-spin"
              style={{ borderColor: '#0B7439', borderTopColor: 'transparent' }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16" style={{ color: 'var(--text-muted)' }}>
            <Container className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Aucun prélèvement trouvé</p>
            <p className="text-xs mt-1">Modifiez les filtres ou la période</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)' }}>
                  {['Date', 'Société', 'Cuve', 'Type', 'Immatriculation', 'Qté (L)', 'Prix/L', 'Montant TTC', 'Date/Heure'].map(h => (
                    <th key={h}
                      className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide whitespace-nowrap"
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
                      {format(new Date(r.enlevement_date + 'T00:00:00'), 'dd MMM yyyy', { locale: fr })}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#1D6FA4' }} />
                        <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{r.company_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <Container className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#0B7439' }} />
                        <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{r.tank_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                        style={{ backgroundColor: `${FUEL_COLORS[r.tank_fuel_type] ?? '#6B7280'}18`, color: FUEL_COLORS[r.tank_fuel_type] ?? '#6B7280' }}>
                        {FUEL_LABELS[r.tank_fuel_type] ?? r.tank_fuel_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <Bus className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#0B7439' }} />
                        <span className="font-mono text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{r.license_plate ?? '—'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-semibold text-xs" style={{ color: '#3B82F6' }}>
                      {fmtL(r.quantity_liters)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: 'var(--text-muted)' }}>
                      {r.unit_price > 0 ? fmtPrice(r.unit_price) : '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-bold text-xs" style={{ color: '#F59E0B' }}>
                      {fmt(r.total_amount)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: 'var(--text-muted)' }}>
                      {fmtDateTime(r.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ backgroundColor: '#F0FDF4', borderTop: '2px solid #BBF7D0' }}>
                  <td colSpan={5} className="px-4 py-3 text-xs font-bold text-right" style={{ color: '#0B7439' }}>
                    TOTAUX ({totalCount} prélèvement{totalCount > 1 ? 's' : ''})
                  </td>
                  <td className="px-4 py-3 text-xs font-bold" style={{ color: '#3B82F6' }}>{fmtL(totalLiters)}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {avgUnitPrice > 0 ? fmtPrice(avgUnitPrice) : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs font-bold" style={{ color: '#F59E0B' }}>{fmt(totalAmount)}</td>
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Summary by company */}
      {!loading && byCompany.length > 0 && (
        <div className="rounded-2xl border overflow-hidden"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <h2 className="font-bold text-sm uppercase tracking-wide" style={{ color: 'var(--text-primary)' }}>
              <Building2 className="w-4 h-4 inline mr-2" style={{ color: '#1D6FA4' }} />
              Récapitulatif par Société
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)' }}>
                  {['Client (Société)', 'Qté (L)', 'Montant TTC', 'Nb. prélèvements'].map(h => (
                    <th key={h}
                      className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide whitespace-nowrap"
                      style={{ color: 'var(--text-muted)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byCompany.map((c, i) => (
                  <tr key={c.name}
                    className="border-b last:border-0 hover:bg-gray-50 transition-colors"
                    style={{ borderColor: 'var(--border)', backgroundColor: i % 2 === 0 ? 'transparent' : 'var(--bg-subtle)' }}>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#1D6FA4' }} />
                        <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{c.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-semibold text-xs" style={{ color: '#3B82F6' }}>
                      {fmtL(c.liters)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-bold text-xs" style={{ color: '#F59E0B' }}>
                      {fmt(c.amount)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: 'var(--text-muted)' }}>
                      {c.count}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ backgroundColor: '#F0FDF4', borderTop: '2px solid #BBF7D0' }}>
                  <td className="px-4 py-3 text-xs font-bold" style={{ color: '#0B7439' }}>
                    TOTAL GÉNÉRAL ({byCompany.length} société{byCompany.length > 1 ? 's' : ''})
                  </td>
                  <td className="px-4 py-3 text-xs font-bold" style={{ color: '#3B82F6' }}>{fmtL(totalLiters)}</td>
                  <td className="px-4 py-3 text-xs font-bold" style={{ color: '#F59E0B' }}>{fmt(totalAmount)}</td>
                  <td className="px-4 py-3 text-xs font-bold" style={{ color: '#0B7439' }}>{totalCount}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
