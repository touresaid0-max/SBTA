import { useEffect, useMemo, useState } from 'react'
import { Fuel, Wrench, Calendar, Search, X, TrendingUp, Bus, Car } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import toast from 'react-hot-toast'
import { supabase } from '@/services/supabase'
import ExportButton from '@/components/shared/ExportButton'

type Period = 'day' | 'month' | 'quarter' | 'year'
type Tab = 'fuel' | 'garage'

interface BusInfo {
  id: string
  registration_number: string
  company_name?: string
}

interface FuelEntry {
  bus_id: string
  liters: number
  amount: number
  date: string
}

interface GarageExpense {
  bus_id: string | null
  registration_number: string
  company_name: string
  amount: number
  category_name: string
  category_icon: string
  category_color: string
  date: string
}

interface BusRanking {
  bus_id: string
  registration_number: string
  company_name: string
  total_liters: number
  total_amount: number
  count: number
}

interface GarageRanking {
  bus_id: string
  registration_number: string
  company_name: string
  total_cost: number
  intervention_count: number
}

interface CategoryRanking {
  name: string
  icon: string
  color: string
  count: number
  total_amount: number
}

const COLORS = [
  '#DC2626', '#B45309', '#EA580C', '#D97706', '#E11D48',
  '#0891B2', '#1D4ED8', '#7C3AED', '#4F46E5', '#9333EA',
  '#16A34A', '#059669', '#0B7439', '#2563EB', '#6366F1',
]

const PERIODS: { key: Period; label: string }[] = [
  { key: 'day', label: 'Jour' },
  { key: 'month', label: 'Mois' },
  { key: 'quarter', label: 'Trimestre' },
  { key: 'year', label: 'Année' },
]

function getDateRange(period: Period): { start: string; end: string } {
  const now = new Date()
  const end = now.toISOString().slice(0, 10)
  let start: string

  switch (period) {
    case 'day':
      start = end
      break
    case 'month':
      start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
      break
    case 'quarter': {
      const qMonth = Math.floor(now.getMonth() / 3) * 3
      start = new Date(now.getFullYear(), qMonth, 1).toISOString().slice(0, 10)
      break
    }
    case 'year':
      start = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10)
      break
  }

  return { start, end }
}

export default function FleetBilan() {
  const [tab, setTab] = useState<Tab>('fuel')
  const [period, setPeriod] = useState<Period>('year')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [buses, setBuses] = useState<BusInfo[]>([])
  const [fuelData, setFuelData] = useState<FuelEntry[]>([])
  const [garageData, setGarageData] = useState<GarageExpense[]>([])

  useEffect(() => {
    loadBuses()
  }, [])

  useEffect(() => {
    loadData()
  }, [period, buses.length])

  async function loadBuses() {
    const { data, error } = await supabase
      .from('buses')
      .select('id, registration_number, company_id, companies(name)')

    if (error) { toast.error('Erreur chargement bus'); return }

    const mapped: BusInfo[] = (data ?? []).map((b: any) => ({
      id: b.id,
      registration_number: b.registration_number,
      company_name: b.companies?.name ?? '',
    }))
    setBuses(mapped)
  }

  async function loadData() {
    setLoading(true)
    const { start, end } = getDateRange(period)

    await Promise.all([loadFuel(start, end), loadGarage(start, end)])
    setLoading(false)
  }

  async function loadFuel(start: string, end: string) {
    const entries: FuelEntry[] = []

    const { data: logs } = await supabase
      .from('fuel_logs')
      .select('bus_id, liters, amount, created_at')
      .gte('created_at', start)
      .lte('created_at', end + 'T23:59:59')

    logs?.forEach(l => {
      if (l.bus_id) entries.push({ bus_id: l.bus_id, liters: Number(l.liters) || 0, amount: Number(l.amount) || 0, date: l.created_at })
    })

    const { data: enlev } = await supabase
      .from('fuel_enlevements')
      .select('bus_id, quantity_liters, total_amount, enlevement_date')
      .gte('enlevement_date', start)
      .lte('enlevement_date', end)

    enlev?.forEach(e => {
      if (e.bus_id) entries.push({ bus_id: e.bus_id, liters: Number(e.quantity_liters) || 0, amount: Number(e.total_amount) || 0, date: e.enlevement_date })
    })

    const { data: cfw } = await supabase
      .from('comptable_fuel_withdrawals')
      .select('bus_id, liters, total_amount, withdrawal_date')
      .gte('withdrawal_date', start)
      .lte('withdrawal_date', end)

    cfw?.forEach(w => {
      if (w.bus_id) entries.push({ bus_id: w.bus_id, liters: Number(w.liters) || 0, amount: Number(w.total_amount) || 0, date: w.withdrawal_date })
    })

    const { data: vouchers } = await supabase
      .from('fuel_vouchers')
      .select('bus_id, actual_liters, actual_amount, used_at')
      .not('used_at', 'is', null)
      .gte('used_at', start)
      .lte('used_at', end + 'T23:59:59')

    vouchers?.forEach(v => {
      if (v.bus_id && v.actual_liters) entries.push({ bus_id: v.bus_id, liters: Number(v.actual_liters) || 0, amount: Number(v.actual_amount) || 0, date: v.used_at })
    })

    setFuelData(entries)
  }

  async function loadGarage(start: string, end: string) {
    // Consolidated from vehicle_expenses (charge_achat + comptable sources)
    const { data: expenses } = await supabase
      .from('vehicle_expenses')
      .select('vehicle_id, registration_number, amount, expense_date, company_id, source, category:expense_categories(name, icon, color), company:companies(name)')
      .gte('expense_date', start)
      .lte('expense_date', end)
      .in('source', ['charge_achat', 'comptable', 'stock_gerant'])

    const entries: GarageExpense[] = (expenses ?? []).map((e: any) => ({
      bus_id: e.vehicle_id,
      registration_number: e.registration_number ?? '',
      company_name: e.company?.name ?? '',
      amount: Number(e.amount) || 0,
      category_name: e.category?.name ?? 'Divers',
      category_icon: e.category?.icon ?? '',
      category_color: e.category?.color ?? '#6B7280',
      date: e.expense_date,
    }))

    setGarageData(entries)
  }

  const busMap = useMemo(() => {
    const m = new Map<string, BusInfo>()
    buses.forEach(b => m.set(b.id, b))
    return m
  }, [buses])

  const fuelRanking: BusRanking[] = useMemo(() => {
    const map = new Map<string, { liters: number; amount: number; count: number }>()
    fuelData.forEach(e => {
      const cur = map.get(e.bus_id) ?? { liters: 0, amount: 0, count: 0 }
      cur.liters += e.liters
      cur.amount += e.amount
      cur.count += 1
      map.set(e.bus_id, cur)
    })

    return Array.from(map.entries())
      .map(([bus_id, d]) => {
        const bus = busMap.get(bus_id)
        return {
          bus_id,
          registration_number: bus?.registration_number ?? 'Inconnu',
          company_name: bus?.company_name ?? '',
          total_liters: Math.round(d.liters * 100) / 100,
          total_amount: Math.round(d.amount * 100) / 100,
          count: d.count,
        }
      })
      .sort((a, b) => b.total_liters - a.total_liters)
  }, [fuelData, busMap])

  const garageRanking: GarageRanking[] = useMemo(() => {
    const map = new Map<string, { cost: number; count: number; reg: string; company: string }>()
    garageData.forEach(e => {
      const key = e.registration_number || e.bus_id || 'unknown'
      const cur = map.get(key) ?? { cost: 0, count: 0, reg: '', company: '' }
      cur.cost += e.amount
      cur.count += 1
      if (!cur.reg && e.registration_number) cur.reg = e.registration_number
      if (!cur.company && e.company_name) cur.company = e.company_name
      map.set(key, cur)
    })

    return Array.from(map.entries())
      .map(([key, d]) => ({
        bus_id: key,
        registration_number: d.reg || key,
        company_name: d.company,
        total_cost: Math.round(d.cost * 100) / 100,
        intervention_count: d.count,
      }))
      .sort((a, b) => b.intervention_count - a.intervention_count)
  }, [garageData])

  const categoryRanking: CategoryRanking[] = useMemo(() => {
    const map = new Map<string, { icon: string; color: string; count: number; amount: number }>()
    garageData.forEach(e => {
      const cur = map.get(e.category_name) ?? { icon: e.category_icon, color: e.category_color, count: 0, amount: 0 }
      cur.count += 1
      cur.amount += e.amount
      map.set(e.category_name, cur)
    })

    return Array.from(map.entries())
      .map(([name, d]) => ({ name, icon: d.icon, color: d.color, count: d.count, total_amount: d.amount }))
      .sort((a, b) => b.count - a.count)
  }, [garageData])

  const filteredFuel = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return fuelRanking
    return fuelRanking.filter(r =>
      r.registration_number.toLowerCase().includes(q) ||
      r.company_name.toLowerCase().includes(q)
    )
  }, [fuelRanking, search])

  const filteredGarage = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return garageRanking
    return garageRanking.filter(r =>
      r.registration_number.toLowerCase().includes(q) ||
      r.company_name.toLowerCase().includes(q)
    )
  }, [garageRanking, search])

  const fuelChartData = useMemo(() =>
    filteredFuel.slice(0, 15).map(r => ({ name: r.registration_number, value: r.total_liters })),
  [filteredFuel])

  const garageChartData = useMemo(() =>
    filteredGarage.slice(0, 15).map(r => ({ name: r.registration_number, value: r.intervention_count })),
  [filteredGarage])

  const totalFuelLiters = useMemo(() => fuelRanking.reduce((s, r) => s + r.total_liters, 0), [fuelRanking])
  const totalFuelAmount = useMemo(() => fuelRanking.reduce((s, r) => s + r.total_amount, 0), [fuelRanking])
  const totalGarageInterventions = useMemo(() => garageRanking.reduce((s, r) => s + r.intervention_count, 0), [garageRanking])
  const totalGarageCost = useMemo(() => garageRanking.reduce((s, r) => s + r.total_cost, 0), [garageRanking])

  async function exportExcel() {
    const { utils, writeFile } = await import('xlsx')
    const periodLabel = PERIODS.find(p => p.key === period)?.label ?? ''

    if (tab === 'fuel') {
      const aoa: unknown[][] = [
        [`Bilan Carburant - ${periodLabel}`],
        [],
        ['Immatriculation', 'Société', 'Litres', 'Montant (FCFA)', 'Nb retraits'],
        ...fuelRanking.map(r => [r.registration_number, r.company_name, r.total_liters, r.total_amount, r.count]),
        [],
        ['TOTAL', '', totalFuelLiters.toFixed(1), totalFuelAmount.toFixed(0), fuelRanking.reduce((s, r) => s + r.count, 0)],
      ]
      const ws = utils.aoa_to_sheet(aoa)
      ws['!cols'] = [{ wch: 20 }, { wch: 25 }, { wch: 12 }, { wch: 16 }, { wch: 12 }]
      const wb = utils.book_new()
      utils.book_append_sheet(wb, ws, 'Carburant')
      writeFile(wb, `bilan_carburant_${period}.xlsx`)
    } else {
      const aoa: unknown[][] = [
        [`Bilan Garage - ${periodLabel}`],
        [],
        ['Immatriculation', 'Société', 'Nb interventions', 'Coût total (FCFA)'],
        ...garageRanking.map(r => [r.registration_number, r.company_name, r.intervention_count, r.total_cost]),
        [],
        ['TOTAL', '', totalGarageInterventions, totalGarageCost.toFixed(0)],
        [],
        [],
        ['Top catégories de dépenses'],
        ['Catégorie', 'Nb interventions', 'Montant total (FCFA)'],
        ...categoryRanking.map(c => [c.name, c.count, c.total_amount.toFixed(0)]),
      ]
      const ws = utils.aoa_to_sheet(aoa)
      ws['!cols'] = [{ wch: 25 }, { wch: 25 }, { wch: 18 }, { wch: 18 }]
      const wb = utils.book_new()
      utils.book_append_sheet(wb, ws, 'Garage')
      writeFile(wb, `bilan_garage_${period}.xlsx`)
    }
  }

  async function exportPdf() {
    const { default: jsPDF } = await import('jspdf')
    const periodLabel = PERIODS.find(p => p.key === period)?.label ?? ''
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

    pdf.setFontSize(16)
    pdf.setTextColor(11, 116, 57)
    const title = tab === 'fuel' ? `Bilan Carburant - ${periodLabel}` : `Bilan Garage - ${periodLabel}`
    pdf.text(title, 14, 20)

    let y = 34
    pdf.setFontSize(9)
    pdf.setTextColor(255, 255, 255)
    pdf.setFillColor(11, 116, 57)
    pdf.rect(14, y - 4, 182, 7, 'F')

    if (tab === 'fuel') {
      pdf.text('Immatriculation', 16, y)
      pdf.text('Société', 60, y)
      pdf.text('Litres', 120, y)
      pdf.text('Montant', 145, y)
      pdf.text('Retraits', 175, y)
      y += 10

      pdf.setTextColor(30, 30, 30)
      fuelRanking.forEach((r, i) => {
        if (y > 270) { pdf.addPage(); y = 20 }
        if (i % 2 === 0) { pdf.setFillColor(247, 250, 248); pdf.rect(14, y - 4, 182, 7, 'F') }
        pdf.text(r.registration_number, 16, y)
        pdf.text(r.company_name.slice(0, 25), 60, y)
        pdf.text(r.total_liters.toFixed(1), 120, y)
        pdf.text(r.total_amount.toFixed(0), 145, y)
        pdf.text(String(r.count), 178, y)
        y += 7
      })
    } else {
      pdf.text('Immatriculation', 16, y)
      pdf.text('Société', 60, y)
      pdf.text('Interventions', 125, y)
      pdf.text('Coût total', 160, y)
      y += 10

      pdf.setTextColor(30, 30, 30)
      garageRanking.forEach((r, i) => {
        if (y > 270) { pdf.addPage(); y = 20 }
        if (i % 2 === 0) { pdf.setFillColor(247, 250, 248); pdf.rect(14, y - 4, 182, 7, 'F') }
        pdf.text(r.registration_number, 16, y)
        pdf.text(r.company_name.slice(0, 25), 60, y)
        pdf.text(String(r.intervention_count), 135, y)
        pdf.text(r.total_cost.toFixed(0), 160, y)
        y += 7
      })
    }

    pdf.save(`bilan_${tab}_${period}.pdf`)
  }

  if (loading && buses.length === 0) {
    return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1A2E22]">Bilan</h1>
          <p className="text-sm text-[#6B7280] mt-1">Consommation carburant et interventions garage par vehicule</p>
        </div>
        <ExportButton onExportPDF={exportPdf} onExportExcel={exportExcel} />
      </div>

      {/* Tabs + Period */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex bg-[#F0F4F1] rounded-xl p-1">
          <button
            onClick={() => { setTab('fuel'); setSearch('') }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === 'fuel' ? 'bg-white text-[#0B7439] shadow-sm' : 'text-[#6B7280] hover:text-[#1A2E22]'
            }`}
          >
            <Fuel className="w-4 h-4" />
            Carburant
          </button>
          <button
            onClick={() => { setTab('garage'); setSearch('') }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === 'garage' ? 'bg-white text-[#0B7439] shadow-sm' : 'text-[#6B7280] hover:text-[#1A2E22]'
            }`}
          >
            <Wrench className="w-4 h-4" />
            Garage
          </button>
        </div>

        <div className="flex items-center gap-1 bg-[#F0F4F1] rounded-xl p-1">
          <Calendar className="w-4 h-4 text-[#6B7280] ml-2" />
          {PERIODS.map(p => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                period === p.key ? 'bg-white text-[#0B7439] shadow-sm' : 'text-[#6B7280] hover:text-[#1A2E22]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI cards */}
      {tab === 'fuel' ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-[#FEF3C7] flex items-center justify-center">
                <Fuel className="w-5 h-5 text-[#B45309]" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[#1A2E22]">{totalFuelLiters.toFixed(0)} L</p>
                <p className="text-xs text-[#6B7280]">Total litres consommes</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-[#DBEAFE] flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-[#1D4ED8]" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[#1A2E22]">{totalFuelAmount.toLocaleString('fr-FR')} FCFA</p>
                <p className="text-xs text-[#6B7280]">Cout total carburant</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-[#E7F6EC] flex items-center justify-center">
                <Bus className="w-5 h-5 text-[#0B7439]" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[#1A2E22]">{fuelRanking.length}</p>
                <p className="text-xs text-[#6B7280]">Vehicules concernes</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-[#FEE2E2] flex items-center justify-center">
                <Wrench className="w-5 h-5 text-[#DC2626]" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[#1A2E22]">{totalGarageInterventions}</p>
                <p className="text-xs text-[#6B7280]">Total interventions</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-[#DBEAFE] flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-[#1D4ED8]" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[#1A2E22]">{totalGarageCost.toLocaleString('fr-FR')} FCFA</p>
                <p className="text-xs text-[#6B7280]">Cout total interventions</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-[#E7F6EC] flex items-center justify-center">
                <Bus className="w-5 h-5 text-[#0B7439]" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[#1A2E22]">{garageRanking.length}</p>
                <p className="text-xs text-[#6B7280]">Vehicules concernes</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Chart */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
        <h2 className="font-semibold text-[#1A2E22] mb-4">
          {tab === 'fuel' ? 'Top 15 - Consommation carburant (litres)' : 'Top 15 - Interventions garage'}
        </h2>
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={tab === 'fuel' ? fuelChartData : garageChartData}
                margin={{ top: 10, right: 30, left: 0, bottom: 60 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#E2EAE5" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 10, fill: '#4A6B55' }}
                  angle={-40}
                  textAnchor="end"
                  interval={0}
                  height={70}
                />
                <YAxis tick={{ fontSize: 11, fill: '#4A6B55' }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: '1px solid #E2EAE5', boxShadow: '0 4px 12px rgba(0,0,0,.08)' }}
                  formatter={(value: number) => [
                    tab === 'fuel' ? `${value.toFixed(1)} L` : `${value} interventions`,
                    tab === 'fuel' ? 'Litres' : 'Interventions'
                  ]}
                />
                <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={45}>
                  {(tab === 'fuel' ? fuelChartData : garageChartData).map((_, idx) => (
                    <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Garage: Top 5 + Top categories */}
      {tab === 'garage' && !loading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Top 5 véhicules coûteux */}
          <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-[#1A2E22]">Top 5 véhicules coûteux</h2>
            </div>
            {garageRanking.length === 0 ? (
              <p className="text-sm text-center py-6 text-[#9CA3AF]">Aucune donnée pour cette période</p>
            ) : (
              <div className="space-y-3">
                {[...garageRanking].sort((a, b) => b.total_cost - a.total_cost).slice(0, 5).map((v, i) => (
                  <div key={v.bus_id} className="flex items-center gap-3">
                    <span className="w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: i === 0 ? '#FEF3C7' : '#F0F4F1', color: i === 0 ? '#D97706' : '#6B7280' }}>
                      {i + 1}
                    </span>
                    <Car className="w-4 h-4 flex-shrink-0 text-[#6B7280]" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-mono font-bold text-[#1A2E22] truncate">{v.registration_number}</p>
                      {v.company_name && <p className="text-xs text-[#6B7280] truncate">{v.company_name}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className="text-sm font-bold" style={{ color: v.total_cost >= 200000 ? '#DC2626' : v.total_cost >= 100000 ? '#D97706' : '#0B7439' }}>
                        {v.total_cost.toLocaleString('fr-FR')} XOF
                      </span>
                      <p className="text-xs text-[#6B7280]">{v.intervention_count} intervention{v.intervention_count > 1 ? 's' : ''}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top catégories de dépenses */}
          <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
            <h2 className="font-semibold text-[#1A2E22] mb-4">Top catégories de dépenses</h2>
            {categoryRanking.length === 0 ? (
              <p className="text-sm text-center py-6 text-[#9CA3AF]">Aucune donnée pour cette période</p>
            ) : (
              <div className="space-y-3">
                {categoryRanking.slice(0, 7).map(cat => (
                  <div key={cat.name} className="flex items-center gap-3">
                    <span className="text-lg w-7 text-center flex-shrink-0">{cat.icon}</span>
                    <p className="text-sm font-medium text-[#1A2E22] flex-1 truncate">{cat.name}</p>
                    <span className="text-sm font-bold tabular-nums" style={{ color: cat.color }}>
                      {cat.count} fois
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E2EAE5] flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-semibold text-[#1A2E22]">
            {tab === 'fuel' ? 'Classement consommation carburant' : 'Classement interventions garage'}
          </h2>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher par immatriculation..."
              className="w-full pl-9 pr-9 py-2 text-sm rounded-xl border border-[#E2EAE5] bg-[#F8FAF8] text-[#1A2E22] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439] transition-all"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#1A2E22]">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          {tab === 'fuel' ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#0B7439] text-left text-xs font-semibold text-white uppercase tracking-wide">
                  <th className="px-5 py-3 w-12">#</th>
                  <th className="px-5 py-3">Immatriculation</th>
                  <th className="px-5 py-3">Societe</th>
                  <th className="px-5 py-3 text-right">Litres</th>
                  <th className="px-5 py-3 text-right">Montant (FCFA)</th>
                  <th className="px-5 py-3 text-right">Nb retraits</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F4F1]">
                {filteredFuel.length === 0 ? (
                  <tr><td colSpan={6} className="px-5 py-8 text-center text-[#9CA3AF]">Aucune donnee pour cette periode</td></tr>
                ) : filteredFuel.map((r, idx) => (
                  <tr key={r.bus_id} className="even:bg-[#F7FAF8] hover:bg-[#EEF6F1] transition-colors">
                    <td className="px-5 py-3 text-[#6B7280] font-medium">{idx + 1}</td>
                    <td className="px-5 py-3 font-medium text-[#1A2E22]">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                        {r.registration_number}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-[#6B7280]">{r.company_name}</td>
                    <td className="px-5 py-3 text-right font-bold text-[#1A2E22] tabular-nums">{r.total_liters.toFixed(1)}</td>
                    <td className="px-5 py-3 text-right text-[#1A2E22] tabular-nums">{r.total_amount.toLocaleString('fr-FR')}</td>
                    <td className="px-5 py-3 text-right text-[#6B7280] tabular-nums">{r.count}</td>
                  </tr>
                ))}
              </tbody>
              {filteredFuel.length > 0 && (
                <tfoot>
                  <tr className="bg-[#1A2E22]">
                    <td className="px-5 py-3 text-white font-bold" colSpan={3}>TOTAL</td>
                    <td className="px-5 py-3 text-right text-white font-bold tabular-nums">{filteredFuel.reduce((s, r) => s + r.total_liters, 0).toFixed(1)}</td>
                    <td className="px-5 py-3 text-right text-white font-bold tabular-nums">{filteredFuel.reduce((s, r) => s + r.total_amount, 0).toLocaleString('fr-FR')}</td>
                    <td className="px-5 py-3 text-right text-white font-bold tabular-nums">{filteredFuel.reduce((s, r) => s + r.count, 0)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#0B7439] text-left text-xs font-semibold text-white uppercase tracking-wide">
                  <th className="px-5 py-3 w-12">#</th>
                  <th className="px-5 py-3">Immatriculation</th>
                  <th className="px-5 py-3">Societe</th>
                  <th className="px-5 py-3 text-right">Interventions</th>
                  <th className="px-5 py-3 text-right">Cout total (FCFA)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F4F1]">
                {filteredGarage.length === 0 ? (
                  <tr><td colSpan={5} className="px-5 py-8 text-center text-[#9CA3AF]">Aucune donnee pour cette periode</td></tr>
                ) : filteredGarage.map((r, idx) => (
                  <tr key={r.bus_id} className="even:bg-[#F7FAF8] hover:bg-[#EEF6F1] transition-colors">
                    <td className="px-5 py-3 text-[#6B7280] font-medium">{idx + 1}</td>
                    <td className="px-5 py-3 font-medium text-[#1A2E22]">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                        {r.registration_number}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-[#6B7280]">{r.company_name}</td>
                    <td className="px-5 py-3 text-right font-bold text-[#1A2E22] tabular-nums">{r.intervention_count}</td>
                    <td className="px-5 py-3 text-right text-[#1A2E22] tabular-nums">{r.total_cost.toLocaleString('fr-FR')}</td>
                  </tr>
                ))}
              </tbody>
              {filteredGarage.length > 0 && (
                <tfoot>
                  <tr className="bg-[#1A2E22]">
                    <td className="px-5 py-3 text-white font-bold" colSpan={3}>TOTAL</td>
                    <td className="px-5 py-3 text-right text-white font-bold tabular-nums">{filteredGarage.reduce((s, r) => s + r.intervention_count, 0)}</td>
                    <td className="px-5 py-3 text-right text-white font-bold tabular-nums">{filteredGarage.reduce((s, r) => s + r.total_cost, 0).toLocaleString('fr-FR')}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
