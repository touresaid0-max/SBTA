import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ArrowLeft, FileText, Download, Filter, ArrowDownCircle, Droplets, Fuel,
  Building2, Package, Container, ChevronDown, Calendar, Percent, TrendingUp,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../services/supabase'
import {
  format, startOfMonth, endOfMonth,
  startOfYear, endOfYear, subDays,
} from 'date-fns'
import { fr } from 'date-fns/locale'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'

/* ─── types ──────────────────────────────────────────────── */

interface DepotageRow {
  id: string
  depot_date: string
  created_at: string
  tank_id: string | null
  tank_name: string
  tank_capacity: number
  supplier_id: string | null
  supplier_name: string
  product_id: string | null
  product_name: string
  purchase_order_id: string | null
  order_number: string | null
  quantity_liters: number
  stock_before: number
  stock_after: number
  unit_price: number
  total_amount: number
}

interface RefItem { id: string; name: string }

/* ─── constants ──────────────────────────────────────────── */

type PeriodKey = 'day' | 'month' | 'year' | 'custom'
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'day',    label: 'Journalier' },
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
function fmtPct(n: number | null) {
  if (n == null || !isFinite(n)) return '—'
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(n).replace(/\u202f|\u00a0/g, ' ') + ' %'
}
function fmtEvol(n: number | null) {
  if (n == null || !isFinite(n)) return '—'
  const sign = n > 0 ? '+' : ''
  return sign + new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(n).replace(/\u202f|\u00a0/g, ' ') + ' %'
}

function evolutionRate(before: number, after: number): number | null {
  if (before <= 0) return null
  return ((after - before) / before) * 100
}
function fillRate(after: number, capacity: number): number | null {
  if (capacity <= 0) return null
  return (after / capacity) * 100
}

function getRange(period: PeriodKey, customFrom: string, customTo: string) {
  const today = new Date()
  switch (period) {
    case 'day':
      return { from: format(today, 'yyyy-MM-dd'), to: format(today, 'yyyy-MM-dd') }
    case 'month':
      return { from: format(startOfMonth(today), 'yyyy-MM-dd'), to: format(endOfMonth(today), 'yyyy-MM-dd') }
    case 'year':
      return { from: format(startOfYear(today), 'yyyy-MM-dd'), to: format(endOfYear(today), 'yyyy-MM-dd') }
    case 'custom':
      return {
        from: customFrom || format(subDays(today, 30), 'yyyy-MM-dd'),
        to:   customTo || format(today, 'yyyy-MM-dd'),
      }
  }
}

/* ─── component ──────────────────────────────────────────── */

export default function DepotageReport() {
  const navigate = useNavigate()
  const today = new Date()

  const [period, setPeriod]           = useState<PeriodKey>('month')
  const [customFrom, setCustomFrom]   = useState(format(subDays(today, 30), 'yyyy-MM-dd'))
  const [customTo, setCustomTo]       = useState(format(today, 'yyyy-MM-dd'))
  const [filterTank, setFilterTank]       = useState('')
  const [filterSupplier, setFilterSupplier] = useState('')
  const [filterProduct, setFilterProduct]   = useState('')

  const [rows, setRows]               = useState<DepotageRow[]>([])
  const [tanks, setTanks]             = useState<RefItem[]>([])
  const [suppliers, setSuppliers]     = useState<RefItem[]>([])
  const [products, setProducts]       = useState<RefItem[]>([])
  const [loading, setLoading]         = useState(false)

  const { from, to } = useMemo(
    () => getRange(period, customFrom, customTo),
    [period, customFrom, customTo],
  )

  /* ─── load reference lists ─── */
  useEffect(() => {
    Promise.all([
      supabase.from('fuel_tanks').select('id,name').eq('is_active', true).order('name'),
      supabase.from('fuel_suppliers').select('id,name').eq('is_active', true).order('name'),
      supabase.from('fuel_products').select('id,designation').eq('is_active', true).order('designation'),
    ]).then(([t, s, p]) => {
      setTanks((t.data as RefItem[]) || [])
      setSuppliers((s.data as RefItem[]) || [])
      setProducts((p.data as RefItem[]) || [])
    })
  }, [])

  /* ─── load depotages with joins ─── */
  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('fuel_depotages')
      .select(`
        id,depot_date,created_at,quantity_liters,stock_before,stock_after,unit_price,total_amount,
        tank_id,supplier_id,product_id,purchase_order_id,
        tanks:tank_id(name,capacity_liters),
        fuel_suppliers:supplier_id(name),
        fuel_products:product_id(designation),
        fuel_purchase_orders:purchase_order_id(order_number)
      `)
      .gte('depot_date', from)
      .lte('depot_date', to)
      .order('depot_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) { toast.error('Erreur lors du chargement'); setLoading(false); return }

    const mapped = ((data || []) as any[]).map(r => ({
      id: r.id,
      depot_date: r.depot_date,
      created_at: r.created_at,
      tank_id: r.tank_id,
      tank_name: r.tanks?.name ?? '—',
      tank_capacity: Number(r.tanks?.capacity_liters ?? 0),
      supplier_id: r.supplier_id,
      supplier_name: r.fuel_suppliers?.name ?? '—',
      product_id: r.product_id,
      product_name: r.fuel_products?.designation ?? '—',
      purchase_order_id: r.purchase_order_id,
      order_number: r.fuel_purchase_orders?.order_number ?? null,
      quantity_liters: Number(r.quantity_liters),
      stock_before: Number(r.stock_before),
      stock_after: Number(r.stock_after),
      unit_price: Number(r.unit_price),
      total_amount: Number(r.total_amount),
    }))
    setRows(mapped)
    setLoading(false)
  }, [from, to])

  useEffect(() => { load() }, [load])

  /* ─── filtering ─── */
  const filtered = useMemo(() => {
    return rows.filter(r => {
      const matchTank     = !filterTank     || r.tank_id === filterTank
      const matchSupplier = !filterSupplier || r.supplier_id === filterSupplier
      const matchProduct  = !filterProduct  || r.product_id === filterProduct
      return matchTank && matchSupplier && matchProduct
    })
  }, [rows, filterTank, filterSupplier, filterProduct])

  /* ─── aggregations ─── */
  const totalQty        = filtered.reduce((s, r) => s + r.quantity_liters, 0)
  const totalAmount     = filtered.reduce((s, r) => s + r.total_amount, 0)
  const totalCount      = filtered.length
  const totalStockBefore = filtered.reduce((s, r) => s + r.stock_before, 0)
  const totalStockAfter  = filtered.reduce((s, r) => s + r.stock_after, 0)

  const avgUnitPrice = totalQty > 0
    ? filtered.reduce((s, r) => s + r.unit_price * r.quantity_liters, 0) / totalQty
    : 0

  const fillRates = filtered
    .map(r => fillRate(r.stock_after, r.tank_capacity))
    .filter((v): v is number => v != null && isFinite(v))
  const avgFillRate = fillRates.length > 0
    ? fillRates.reduce((s, v) => s + v, 0) / fillRates.length
    : null

  const periodLabel = useMemo(() => {
    if (period === 'day')    return `le ${format(today, 'dd MMMM yyyy', { locale: fr })}`
    if (period === 'month')  return format(today, 'MMMM yyyy', { locale: fr })
    if (period === 'year')   return format(today, 'yyyy')
    return `du ${format(new Date(from + 'T00:00:00'), 'dd MMM', { locale: fr })} au ${format(new Date(to + 'T00:00:00'), 'dd MMM yyyy', { locale: fr })}`
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, from, to])

  const hasFilters = filterTank || filterSupplier || filterProduct
  const resetFilters = () => { setFilterTank(''); setFilterSupplier(''); setFilterProduct('') }

  /* ─── Excel export ─── */
  const exportExcel = () => {
    if (filtered.length === 0) { toast.error('Aucune donnée à exporter'); return }
    const wsData: (string | number)[][] = [
      ['RAPPORT DÉPOTAGES DES CUVES'],
      [`Période: ${periodLabel}`],
      [],
      ['Date', 'Cuve', 'Fournisseur', 'Produit', 'Qté (L)', 'Stock avant', 'Stock après', 'Montant TTC', 'BC lié', 'Prix/L', 'Taux évolution (%)', 'Taux remplissage (%)'],
      ...filtered.map(r => [
        format(new Date(r.depot_date + 'T00:00:00'), 'dd/MM/yyyy'),
        r.tank_name,
        r.supplier_name,
        r.product_name,
        Number(r.quantity_liters.toFixed(2)),
        Number(r.stock_before.toFixed(2)),
        Number(r.stock_after.toFixed(2)),
        Math.round(r.total_amount),
        r.order_number ?? '—',
        Math.round(r.unit_price),
        Number((evolutionRate(r.stock_before, r.stock_after) ?? 0).toFixed(1)),
        Number((fillRate(r.stock_after, r.tank_capacity) ?? 0).toFixed(1)),
      ]),
      [],
      ['TOTAL', '', '', '', Number(totalQty.toFixed(2)), Number(totalStockBefore.toFixed(2)), Number(totalStockAfter.toFixed(2)), Math.round(totalAmount), totalCount, '', '', Number((avgFillRate ?? 0).toFixed(1))],
    ]
    const ws = XLSX.utils.aoa_to_sheet(wsData)
    ws['!cols'] = [
      { wch: 12 }, { wch: 18 }, { wch: 22 }, { wch: 20 }, { wch: 12 },
      { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 14 },
      { wch: 16 }, { wch: 18 },
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Rapport Dépotages')
    XLSX.writeFile(wb, `rapport_depotages_${from}_${to}.xlsx`)
    toast.success('Export Excel téléchargé')
  }

  /* ─── PDF export ─── */
  const exportPDF = async () => {
    if (filtered.length === 0) { toast.error('Aucune donnée à exporter'); return }
    const { default: jsPDF } = await import('jspdf')
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

    const colWidths = [18, 22, 28, 26, 16, 18, 18, 24, 20, 20, 18, 18]
    const headers = ['Date', 'Cuve', 'Fournisseur', 'Produit', 'Qté (L)', 'Stock avant', 'Stock après', 'Montant', 'BC lié', 'Prix/L', 'Taux évol.', 'Taux rempl.']
    const startX = 6
    const pageW = 297
    let y = 14
    const rowH = 6

    doc.setFontSize(14)
    doc.setTextColor(11, 116, 57)
    doc.text('Rapport Dépotages des Cuves', startX, y)
    y += 6

    doc.setFontSize(8)
    doc.setTextColor(90, 90, 90)
    doc.text(`Période : ${periodLabel}`, startX, y)
    y += 4
    const filterParts: string[] = []
    if (filterTank)     filterParts.push(`Cuve: ${tanks.find(t => t.id === filterTank)?.name ?? filterTank}`)
    if (filterSupplier) filterParts.push(`Fournisseur: ${suppliers.find(s => s.id === filterSupplier)?.name ?? filterSupplier}`)
    if (filterProduct)  filterParts.push(`Produit: ${products.find(p => p.id === filterProduct)?.name ?? filterProduct}`)
    if (filterParts.length > 0) {
      doc.text(`Filtres : ${filterParts.join('  |  ')}`, startX, y)
      y += 4
    }
    y += 2

    doc.setFillColor(11, 116, 57)
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(7)
    let x = startX
    headers.forEach((h, i) => { doc.rect(x, y, colWidths[i], rowH, 'F'); doc.text(h, x + 1.5, y + 4.2); x += colWidths[i] })
    y += rowH

    doc.setTextColor(30, 30, 30)
    filtered.forEach((r, idx) => {
      if (y > 195) { doc.addPage(); y = 14 }
      const cells = [
        format(new Date(r.depot_date + 'T00:00:00'), 'dd/MM/yy'),
        r.tank_name,
        r.supplier_name,
        r.product_name,
        fmtL(r.quantity_liters),
        fmtL(r.stock_before),
        fmtL(r.stock_after),
        fmt(r.total_amount),
        r.order_number ?? '—',
        r.unit_price > 0 ? fmtPrice(r.unit_price) : '—',
        fmtEvol(evolutionRate(r.stock_before, r.stock_after)),
        fmtPct(fillRate(r.stock_after, r.tank_capacity)),
      ]
      if (idx % 2 === 0) {
        doc.setFillColor(248, 250, 248)
        x = startX
        colWidths.forEach(w => { doc.rect(x, y, w, rowH, 'F'); x += w })
      }
      x = startX
      doc.setFontSize(6.2)
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
    doc.setFontSize(6.5)
    x = startX
    colWidths.forEach(w => { doc.rect(x, y, w, rowH, 'F'); x += w })
    const footCells = [
      `TOTAL (${totalCount})`, '', '', '', fmtL(totalQty), fmtL(totalStockBefore), fmtL(totalStockAfter), fmt(totalAmount), '', '', '', fmtPct(avgFillRate),
    ]
    x = startX
    footCells.forEach((c, i) => { doc.text(c, x + 1.5, y + 4.2); x += colWidths[i] })
    y += rowH + 4

    // Stats footer
    if (y > 205) { doc.addPage(); y = 14 }
    doc.setFontSize(8)
    doc.setTextColor(60, 60, 60)
    doc.text(`Nombre total de dépotages : ${totalCount}`, startX, y); y += 5
    doc.text(`Quantité totale dépotée : ${fmtL(totalQty)}`, startX, y); y += 5
    doc.text(`Stock total avant : ${fmtL(totalStockBefore)}`, startX, y); y += 5
    doc.text(`Stock total après : ${fmtL(totalStockAfter)}`, startX, y); y += 5
    doc.text(`Montant total : ${fmt(totalAmount)}`, startX, y); y += 5
    doc.text(`Taux moyen de remplissage : ${fmtPct(avgFillRate)}`, startX, y)

    const pageCount = doc.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i)
      doc.setFontSize(7)
      doc.setTextColor(150, 150, 150)
      doc.text(`Page ${i}/${pageCount}`, pageW - 25, 205)
    }

    doc.save(`rapport_depotages_${from}_${to}.pdf`)
    toast.success('Export PDF téléchargé')
  }

  /* ─── render ─── */

  const TABLE_HEADERS = ['Date', 'Cuve', 'Fournisseur', 'Produit', 'Qté (L)', 'Stock avant', 'Stock après', 'Montant', 'BC lié', 'Prix/L', 'Taux évolution', 'Taux remplissage']

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
            Rapport Dépotage
          </h1>
          <p className="text-sm capitalize" style={{ color: 'var(--text-secondary)' }}>
            Consolidation des dépotages de cuves — {periodLabel}
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
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Cuve</label>
            <select value={filterTank} onChange={e => setFilterTank(e.target.value)}
              className="w-full px-2 py-1.5 border rounded-lg text-xs"
              style={{ borderColor: 'var(--border)' }}>
              <option value="">Toutes</option>
              {tanks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Fournisseur</label>
            <select value={filterSupplier} onChange={e => setFilterSupplier(e.target.value)}
              className="w-full px-2 py-1.5 border rounded-lg text-xs"
              style={{ borderColor: 'var(--border)' }}>
              <option value="">Tous</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Produit</label>
            <select value={filterProduct} onChange={e => setFilterProduct(e.target.value)}
              className="w-full px-2 py-1.5 border rounded-lg text-xs"
              style={{ borderColor: 'var(--border)' }}>
              <option value="">Tous</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
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

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { icon: <ArrowDownCircle className="w-4 h-4" />, label: 'Quantité totale', value: fmtL(totalQty), color: '#16A34A' },
          { icon: <Fuel className="w-4 h-4" />, label: 'Montant total', value: fmt(totalAmount), color: '#F59E0B' },
          { icon: <FileText className="w-4 h-4" />, label: 'Nb. dépotages', value: totalCount.toString(), color: '#1D6FA4' },
          { icon: <Percent className="w-4 h-4" />, label: 'Taux moyen remplissage', value: fmtPct(avgFillRate), color: '#0B7439' },
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
            <ArrowDownCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Aucun dépotage trouvé</p>
            <p className="text-xs mt-1">Modifiez les filtres ou la période</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)' }}>
                  {TABLE_HEADERS.map(h => (
                    <th key={h}
                      className="text-left px-3 py-3 text-xs font-semibold uppercase tracking-wide whitespace-nowrap"
                      style={{ color: 'var(--text-muted)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const evol = evolutionRate(r.stock_before, r.stock_after)
                  const fr = fillRate(r.stock_after, r.tank_capacity)
                  const frColor = fr == null ? '#6B7280' : fr >= 80 ? '#DC2626' : fr >= 50 ? '#F59E0B' : '#16A34A'
                  return (
                    <tr key={r.id}
                      className="border-b last:border-0 hover:bg-gray-50 transition-colors"
                      style={{ borderColor: 'var(--border)', backgroundColor: i % 2 === 0 ? 'transparent' : 'var(--bg-subtle)' }}>
                      <td className="px-3 py-3 whitespace-nowrap text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {format(new Date(r.depot_date + 'T00:00:00'), 'dd MMM yyyy', { locale: fr })}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Container className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#0B7439' }} />
                          <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{r.tank_name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#1D6FA4' }} />
                          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{r.supplier_name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Package className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#6B7280' }} />
                          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{r.product_name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap font-semibold text-xs" style={{ color: '#16A34A' }}>
                        {fmtL(r.quantity_liters)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-xs" style={{ color: 'var(--text-muted)' }}>
                        {fmtL(r.stock_before)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap font-semibold text-xs" style={{ color: '#16A34A' }}>
                        {fmtL(r.stock_after)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap font-bold text-xs" style={{ color: '#F59E0B' }}>
                        {fmt(r.total_amount)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                        {r.order_number ?? '—'}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-xs" style={{ color: 'var(--text-muted)' }}>
                        {r.unit_price > 0 ? fmtPrice(r.unit_price) : '—'}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-xs font-semibold" style={{ color: '#16A34A' }}>
                        {fmtEvol(evol)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap"
                          style={{ backgroundColor: `${frColor}18`, color: frColor }}>
                          {fmtPct(fr)}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ backgroundColor: '#F0FDF4', borderTop: '2px solid #BBF7D0' }}>
                  <td colSpan={4} className="px-3 py-3 text-xs font-bold" style={{ color: '#0B7439' }}>
                    TOTAUX ({totalCount} dépotage{totalCount > 1 ? 's' : ''})
                  </td>
                  <td className="px-3 py-3 text-xs font-bold" style={{ color: '#16A34A' }}>{fmtL(totalQty)}</td>
                  <td className="px-3 py-3 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>{fmtL(totalStockBefore)}</td>
                  <td className="px-3 py-3 text-xs font-bold" style={{ color: '#16A34A' }}>{fmtL(totalStockAfter)}</td>
                  <td className="px-3 py-3 text-xs font-bold" style={{ color: '#F59E0B' }}>{fmt(totalAmount)}</td>
                  <td className="px-3 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {avgUnitPrice > 0 ? fmtPrice(avgUnitPrice) : '—'}
                  </td>
                  <td className="px-3 py-3" />
                  <td className="px-3 py-3 text-xs font-bold" style={{ color: '#0B7439' }}>{fmtPct(avgFillRate)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Summary stats */}
      {!loading && filtered.length > 0 && (
        <div className="rounded-2xl border overflow-hidden"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <h2 className="font-bold text-sm uppercase tracking-wide" style={{ color: 'var(--text-primary)' }}>
              <TrendingUp className="w-4 h-4 inline mr-2" style={{ color: '#0B7439' }} />
              Synthèse des Dépotages
            </h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px"
            style={{ backgroundColor: 'var(--border)' }}>
            {[
              { label: 'Quantité totale dépotée', value: fmtL(totalQty), color: '#16A34A', icon: <Droplets className="w-4 h-4" /> },
              { label: 'Montant total', value: fmt(totalAmount), color: '#F59E0B', icon: <Fuel className="w-4 h-4" /> },
              { label: 'Nombre total de dépotages', value: totalCount.toString(), color: '#1D6FA4', icon: <FileText className="w-4 h-4" /> },
              { label: 'Stock total avant', value: fmtL(totalStockBefore), color: '#6B7280', icon: <ArrowDownCircle className="w-4 h-4" /> },
              { label: 'Stock total après', value: fmtL(totalStockAfter), color: '#16A34A', icon: <ArrowDownCircle className="w-4 h-4" /> },
              { label: 'Taux moyen de remplissage', value: fmtPct(avgFillRate), color: '#0B7439', icon: <Percent className="w-4 h-4" /> },
            ].map(s => (
              <div key={s.label} className="p-4" style={{ backgroundColor: 'var(--surface)' }}>
                <div className="flex items-center gap-2 mb-1">
                  <span style={{ color: s.color }}>{s.icon}</span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.label}</span>
                </div>
                <p className="text-base font-bold" style={{ color: s.color }}>{s.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
