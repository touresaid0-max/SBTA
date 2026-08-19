import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Plus, TrendingUp, Car, BarChart2,
  RefreshCw, ChevronRight, Calendar, Wallet, Package,
  Building2,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from 'recharts'
import { format, startOfWeek, endOfWeek, subWeeks, startOfMonth, endOfMonth, subMonths, startOfQuarter, endOfQuarter, subQuarters, startOfYear, endOfYear } from 'date-fns'
import { fr } from 'date-fns/locale'
import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/store/authStore'
import { useComptableCompanies } from '@/hooks/useComptableCompanies'
import type { VehicleExpense } from '@/types/chargeAchat.types'

type Period = 'week' | 'month' | 'quarter' | 'year'

const PERIODS: { key: Period; label: string }[] = [
  { key: 'week', label: 'Semaine' },
  { key: 'month', label: 'Mois' },
  { key: 'quarter', label: 'Trimestre' },
  { key: 'year', label: 'Année' },
]

const fmt = (n: number) => new Intl.NumberFormat('fr-FR').format(n) + ' XOF'

function getDateRange(period: Period): { start: Date; end: Date; startStr: string; endStr: string } {
  const now = new Date()
  let start: Date, end: Date

  switch (period) {
    case 'week':
      start = startOfWeek(now, { weekStartsOn: 1 })
      end = endOfWeek(now, { weekStartsOn: 1 })
      break
    case 'month':
      start = startOfMonth(now)
      end = endOfMonth(now)
      break
    case 'quarter':
      start = startOfQuarter(now)
      end = endOfQuarter(now)
      break
    case 'year':
      start = startOfYear(now)
      end = endOfYear(now)
      break
  }

  return { start, end, startStr: format(start, 'yyyy-MM-dd'), endStr: format(end, 'yyyy-MM-dd') }
}

function getPeriodLabel(period: Period, start: Date, end: Date): string {
  switch (period) {
    case 'week':
      return `Semaine du ${format(start, 'dd/MM', { locale: fr })} au ${format(end, 'dd/MM/yyyy', { locale: fr })}`
    case 'month':
      return format(start, 'MMMM yyyy', { locale: fr })
    case 'quarter': {
      const q = Math.ceil((start.getMonth() + 1) / 3)
      return `${q}e trimestre ${start.getFullYear()}`
    }
    case 'year':
      return `Année ${start.getFullYear()}`
  }
}

function getTrendSegments(period: Period): { label: string; startStr: string; endStr: string }[] {
  const now = new Date()

  switch (period) {
    case 'week': {
      return Array.from({ length: 8 }, (_, i) => {
        const base = subWeeks(now, 7 - i)
        const s = startOfWeek(base, { weekStartsOn: 1 })
        const e = endOfWeek(base, { weekStartsOn: 1 })
        return { label: `S${format(s, 'dd/MM', { locale: fr })}`, startStr: format(s, 'yyyy-MM-dd'), endStr: format(e, 'yyyy-MM-dd') }
      })
    }
    case 'month': {
      return Array.from({ length: 6 }, (_, i) => {
        const base = subMonths(now, 5 - i)
        const s = startOfMonth(base)
        const e = endOfMonth(base)
        return { label: format(s, 'MMM yy', { locale: fr }), startStr: format(s, 'yyyy-MM-dd'), endStr: format(e, 'yyyy-MM-dd') }
      })
    }
    case 'quarter': {
      return Array.from({ length: 4 }, (_, i) => {
        const base = subQuarters(now, 3 - i)
        const s = startOfQuarter(base)
        const e = endOfQuarter(base)
        const q = Math.ceil((s.getMonth() + 1) / 3)
        return { label: `T${q} ${s.getFullYear()}`, startStr: format(s, 'yyyy-MM-dd'), endStr: format(e, 'yyyy-MM-dd') }
      })
    }
    case 'year': {
      return Array.from({ length: 12 }, (_, i) => {
        const base = new Date(now.getFullYear(), i, 1)
        const s = startOfMonth(base)
        const e = endOfMonth(base)
        return { label: format(s, 'MMM', { locale: fr }), startStr: format(s, 'yyyy-MM-dd'), endStr: format(e, 'yyyy-MM-dd') }
      })
    }
  }
}

interface CompanyInfo { id: string; name: string; code: string }

export default function ComptableNewDashboard() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { allowedCompanyIds } = useComptableCompanies()
  const companyIds = allowedCompanyIds ?? (user?.company_id ? [user.company_id] : [])
  const companyId = companyIds[0] ?? null

  const [period, setPeriod] = useState<Period>('week')
  const [loading, setLoading] = useState(true)
  const [companies, setCompanies] = useState<CompanyInfo[]>([])
  const [periodTotal, setPeriodTotal] = useState(0)
  const [topVehicles, setTopVehicles] = useState<{ reg: string; total: number }[]>([])
  const [trendData, setTrendData] = useState<Record<string, unknown>[]>([])
  const [barData, setBarData] = useState<Record<string, unknown>[]>([])
  const [caisseBalance, setCaisseBalance] = useState<{ entrees: number; depenses: number } | null>(null)
  const [stockAlerts, setStockAlerts] = useState(0)

  const { start, end, startStr, endStr } = getDateRange(period)
  const periodLabel = getPeriodLabel(period, start, end)

  const load = useCallback(async () => {
    if (companyIds.length === 0) { setLoading(false); return }
    setLoading(true)
    try {
      const { data: coData } = await supabase
        .from('companies').select('id, name, code').in('id', companyIds)
      setCompanies((coData ?? []) as CompanyInfo[])

      const { data: busData } = await supabase.from('buses').select('id').in('company_id', companyIds)
      const busIds = (busData ?? []).map(b => b.id)

      // Period expenses
      let exps: VehicleExpense[] = []
      if (busIds.length > 0) {
        const { data } = await supabase
          .from('vehicle_expenses')
          .select('*, category:expense_categories(name,icon,color)')
          .in('company_id', companyIds)
          .gte('expense_date', startStr)
          .lte('expense_date', endStr)
          .eq('source', 'comptable')
        exps = (data ?? []) as VehicleExpense[]
      }

      const total = exps.reduce((a, b) => a + Number(b.amount), 0)
      setPeriodTotal(total)

      // Bar data by category
      const byCat: Record<string, number> = {}
      for (const e of exps) {
        const k = (e as any).category?.name ?? 'Divers'
        byCat[k] = (byCat[k] ?? 0) + Number(e.amount)
      }
      setBarData(
        Object.entries(byCat)
          .map(([name, total]) => ({ name, total }))
          .sort((a, b) => b.total - a.total)
          .slice(0, 6)
      )

      // Top 5 vehicles
      const byVeh: Record<string, number> = {}
      for (const e of exps) {
        byVeh[e.registration_number] = (byVeh[e.registration_number] ?? 0) + Number(e.amount)
      }
      setTopVehicles(
        Object.entries(byVeh).map(([reg, total]) => ({ reg, total })).sort((a, b) => b.total - a.total).slice(0, 5)
      )

      // Trend
      const segments = getTrendSegments(period)
      const trendStart = segments[0].startStr
      const trendEnd = segments[segments.length - 1].endStr

      const { data: trendExps } = await supabase
        .from('vehicle_expenses')
        .select('expense_date, amount')
        .eq('source', 'comptable')
        .in('company_id', companyIds)
        .gte('expense_date', trendStart)
        .lte('expense_date', trendEnd)

      const trend = segments.map(seg => ({
        label: seg.label,
        total: (trendExps ?? [])
          .filter(e => e.expense_date >= seg.startStr && e.expense_date <= seg.endStr)
          .reduce((a, b) => a + Number(b.amount), 0),
      }))
      setTrendData(trend)

      // Caisse for current period
      const { data: caisseData } = await supabase
        .from('comptable_caisse_entries')
        .select('entry_type, amount')
        .in('company_id', companyIds)
        .gte('entry_date', startStr)
        .lte('entry_date', endStr)

      const entrees = (caisseData ?? []).filter(c => c.entry_type === 'entree').reduce((a, b) => a + Number(b.amount), 0)
      const depenses = (caisseData ?? []).filter(c => c.entry_type === 'depense').reduce((a, b) => a + Number(b.amount), 0)
      setCaisseBalance({ entrees, depenses })

      // Stock alerts
      const { data: stockItems } = await supabase
        .from('comptable_stock_items')
        .select('id, stock_initial, stock_min')
        .in('company_id', companyIds)

      if (stockItems && stockItems.length > 0) {
        const itemIds = stockItems.map(s => s.id)
        const { data: mvts } = await supabase
          .from('comptable_stock_movements')
          .select('stock_item_id, movement_type, quantity')
          .in('stock_item_id', itemIds)

        let alerts = 0
        for (const item of stockItems) {
          const itemMvts = (mvts ?? []).filter(m => m.stock_item_id === item.id)
          const ent = itemMvts.filter(m => m.movement_type === 'entree').reduce((a, b) => a + Number(b.quantity), 0)
          const sor = itemMvts.filter(m => m.movement_type === 'sortie').reduce((a, b) => a + Number(b.quantity), 0)
          const stockFinal = Number(item.stock_initial) + ent - sor
          if (stockFinal < Number(item.stock_min)) alerts++
        }
        setStockAlerts(alerts)
      }
    } finally {
      setLoading(false)
    }
  }, [companyIds, startStr, endStr, period])

  useEffect(() => { load() }, [load])

  const caisseReste = caisseBalance ? caisseBalance.entrees - caisseBalance.depenses : 0

  const trendTitle = period === 'week' ? 'Évolution sur 8 semaines'
    : period === 'month' ? 'Évolution sur 6 mois'
    : period === 'quarter' ? 'Évolution sur 4 trimestres'
    : 'Évolution mensuelle de l\'année'

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Tableau de bord
          </h1>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <Calendar className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{periodLabel}</p>
            {companies.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap" aria-label="Sociétés affectées">
                <Building2 className="w-3.5 h-3.5" style={{ color: '#1D4ED8' }} />
                {companies.map(currentCompany => (
                  <div key={currentCompany.id} className="flex items-center gap-1 px-2 py-0.5 rounded-lg" style={{ backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE' }}>
                    <span className="text-xs font-bold" style={{ color: '#1E3A5F' }}>{currentCompany.name}</span>
                    <span className="text-xs font-mono font-bold px-1 py-0.5 rounded" style={{ backgroundColor: '#DBEAFE', color: '#1D4ED8' }}>{currentCompany.code}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg hover:bg-gray-100 transition-colors" title="Actualiser">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} style={{ color: 'var(--text-muted)' }} />
          </button>
          <button
            onClick={() => navigate('/comptable/expenses/new')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold shadow-sm"
            style={{ backgroundColor: '#0B7439', color: '#fff' }}
          >
            <Plus className="w-4 h-4" />
            Nouvelle dépense
          </button>
        </div>
      </div>

      {/* Period selector */}
      <div className="flex items-center gap-1 bg-[#F0F4F1] rounded-xl p-1 w-fit">
        <Calendar className="w-4 h-4 text-[#6B7280] ml-2" />
        {PERIODS.map(p => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              period === p.key ? 'bg-white text-[#0B7439] shadow-sm' : 'text-[#6B7280] hover:text-[#1A2E22]'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 rounded-xl animate-pulse" style={{ backgroundColor: 'var(--border)' }} />
          ))}
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total dépenses période */}
            <div className="rounded-2xl p-4 flex flex-col justify-between col-span-2 lg:col-span-1"
              style={{ background: 'linear-gradient(135deg,#0B7439,#085c2d)', color: '#fff' }}>
              <div className="flex items-center justify-between">
                <p className="text-xs opacity-80">Dépenses — {PERIODS.find(p => p.key === period)?.label.toLowerCase()}</p>
                <BarChart2 className="w-5 h-5 opacity-40" />
              </div>
              <p className="text-2xl font-bold mt-2">{fmt(periodTotal)}</p>
            </div>

            {/* Nb transactions */}
            <div className="rounded-2xl p-4 flex flex-col justify-between"
              style={{ backgroundColor: '#DBEAFE', border: '1px solid #93C5FD' }}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium" style={{ color: '#1E3A5F' }}>Nb véhicules</p>
                <TrendingUp className="w-4 h-4" style={{ color: '#1D4ED8' }} />
              </div>
              <p className="text-xl font-bold mt-1" style={{ color: '#1D4ED8' }}>
                {topVehicles.length}
              </p>
              <p className="text-xs mt-1" style={{ color: '#1E3A5F' }}>avec dépenses</p>
            </div>

            {/* Caisse — Reste */}
            <div className="rounded-2xl p-4 flex flex-col justify-between"
              style={{
                backgroundColor: caisseReste >= 0 ? '#d4edda' : '#fee2e2',
                border: `1px solid ${caisseReste >= 0 ? '#86efac' : '#fca5a5'}`,
              }}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium" style={{ color: caisseReste >= 0 ? '#065f46' : '#991B1B' }}>Reste caisse</p>
                <Wallet className="w-4 h-4" style={{ color: caisseReste >= 0 ? '#0B7439' : '#DC2626' }} />
              </div>
              <p className="text-xl font-bold mt-1" style={{ color: caisseReste >= 0 ? '#0B7439' : '#DC2626' }}>
                {caisseBalance ? fmt(caisseReste) : '—'}
              </p>
              <p className="text-xs mt-1" style={{ color: caisseReste >= 0 ? '#065f46' : '#991B1B' }}>
                {caisseBalance ? fmt(caisseBalance.depenses) + ' dépensés' : ''}
              </p>
            </div>

            {/* Alertes stock */}
            <div className="rounded-2xl p-4 flex flex-col justify-between"
              style={{
                backgroundColor: stockAlerts > 0 ? '#FEF3C7' : '#EFF6FF',
                border: `1px solid ${stockAlerts > 0 ? '#FCD34D' : '#BFDBFE'}`,
              }}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium" style={{ color: stockAlerts > 0 ? '#92400E' : '#1E3A5F' }}>Alertes stock</p>
                <Package className="w-4 h-4" style={{ color: stockAlerts > 0 ? '#D97706' : '#1D4ED8' }} />
              </div>
              <p className="text-xl font-bold mt-1" style={{ color: stockAlerts > 0 ? '#D97706' : '#1D4ED8' }}>
                {stockAlerts} article{stockAlerts !== 1 ? 's' : ''}
              </p>
              <p className="text-xs mt-1" style={{ color: stockAlerts > 0 ? '#92400E' : '#1E3A5F' }}>
                {stockAlerts > 0 ? 'sous le seuil min' : 'stocks OK'}
              </p>
            </div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Bar by category */}
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
              <h2 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>
                Dépenses par catégorie
              </h2>
              {barData.length === 0 ? (
                <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>Aucune dépense cette période</p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={barData} barSize={28}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tickFormatter={v => (v / 1000) + 'k'} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Bar dataKey="total" fill="#0B7439" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Trend */}
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
              <h2 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>
                {trendTitle}
              </h2>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tickFormatter={v => (v / 1000) + 'k'} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="total" stroke="#0B7439" strokeWidth={2} dot={false} name="Dépenses" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Top 5 vehicles */}
          <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Top 5 véhicules coûteux</h2>
              <button onClick={() => navigate('/comptable/fleet')} className="text-xs flex items-center gap-1" style={{ color: '#0B7439' }}>
                Voir flotte <ChevronRight className="w-3 h-3" />
              </button>
            </div>
            {topVehicles.length === 0 ? (
              <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>Aucune donnée pour cette période</p>
            ) : (
              <div className="space-y-2">
                {topVehicles.map((v, i) => (
                  <div key={v.reg} className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: i === 0 ? '#FEF3C7' : 'var(--bg-subtle)', color: i === 0 ? '#D97706' : 'var(--text-muted)' }}>
                      {i + 1}
                    </span>
                    <Car className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                    <p className="text-sm font-mono font-bold flex-1" style={{ color: 'var(--text-primary)' }}>{v.reg}</p>
                    <span className="text-sm font-bold" style={{ color: v.total >= 200000 ? '#DC2626' : v.total >= 50000 ? '#D97706' : '#0B7439' }}>
                      {fmt(v.total)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick actions */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Saisir dépense', path: '/comptable/expenses/new', icon: <Plus className="w-5 h-5" />, color: '#0B7439', bg: '#d4edda' },
              { label: 'Liste dépenses', path: '/comptable/expenses', icon: <LayoutDashboard className="w-5 h-5" />, color: '#1D6FA4', bg: '#DBEAFE' },
              { label: 'Flotte', path: '/comptable/fleet', icon: <Car className="w-5 h-5" />, color: '#D97706', bg: '#FEF3C7' },
              { label: 'Stock', path: '/comptable/stock', icon: <Package className="w-5 h-5" />, color: '#6B7280', bg: '#F3F4F6' },
            ].map(a => (
              <button key={a.path} onClick={() => navigate(a.path)}
                className="rounded-xl p-3 flex items-center gap-3 hover:shadow-md transition-all text-left"
                style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: a.bg, color: a.color }}>
                  {a.icon}
                </div>
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{a.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
