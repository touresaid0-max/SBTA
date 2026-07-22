import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Fuel, Plus, TrendingUp, Droplets, DollarSign, Bus,
  MapPin, ChevronRight, FileText, Calendar, ChevronDown,
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

/* ─── types ──────────────────────────────────────────────── */

interface Withdrawal {
  id: string
  company_id: string | null
  registration_number: string
  driver_name: string | null
  station_name: string
  city: string | null
  fuel_type: string
  liters: number
  total_amount: number
  withdrawal_date: string
}

interface Company extends CompanyWithHierarchy {}
interface BusStat { registration_number: string; liters: number; amount: number }
interface StationStat { station_name: string; liters: number; amount: number }
interface FuelTypeStat { fuel_type: string; liters: number; amount: number }

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
      return { from: customFrom || format(subDays(today, 30), 'yyyy-MM-dd'), to: customTo || format(today, 'yyyy-MM-dd') }
  }
}

/* ─── component ──────────────────────────────────────────── */

export default function CarburantDashboard() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  const today = new Date()

  // filter state
  const [period, setPeriod]           = useState<PeriodKey>('month')
  const [customFrom, setCustomFrom]   = useState(format(subDays(today, 30), 'yyyy-MM-dd'))
  const [customTo, setCustomTo]       = useState(format(today, 'yyyy-MM-dd'))
  const [selectedCompany, setSelectedCompany] = useState<string>('all')

  // data
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([])
  const [companies, setCompanies]     = useState<Company[]>([])
  const [loading, setLoading]         = useState(true)

  const { from, to } = useMemo(
    () => getRange(period, customFrom, customTo),
    [period, customFrom, customTo],
  )

  /* ─── load ─── */

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('comptable_fuel_withdrawals')
      .select('id,company_id,registration_number,driver_name,station_name,city,fuel_type,liters,total_amount,withdrawal_date')
      .eq('created_by', user?.id ?? '')
      .gte('withdrawal_date', from)
      .lte('withdrawal_date', to)
      .order('withdrawal_date', { ascending: false })
    setWithdrawals((data as Withdrawal[]) || [])
    setLoading(false)
  }, [user?.id, from, to])

  useEffect(() => { load() }, [load])

  const { groups, standalone } = useMemo(() => buildCompanyGroups(companies), [companies])

  useEffect(() => {
    supabase.from('companies').select('id,name,code,parent_id,is_group').eq('is_active', true).order('name')
      .then(({ data }) => setCompanies((data as Company[]) || []))
  }, [])

  /* ─── filtered by company ─── */

  const filtered = useMemo(() => {
    if (selectedCompany === 'all') return withdrawals
    const ids = new Set(resolveCompanyIds(selectedCompany, companies))
    return withdrawals.filter(w => w.company_id && ids.has(w.company_id))
  }, [withdrawals, selectedCompany, companies])

  /* ─── aggregations ─── */

  const totalStats = useMemo(() => ({
    liters: filtered.reduce((s, w) => s + Number(w.liters), 0),
    amount: filtered.reduce((s, w) => s + Number(w.total_amount), 0),
    count: filtered.length,
  }), [filtered])

  const busStat: BusStat[] = useMemo(() =>
    Object.values(
      filtered.reduce<Record<string, BusStat>>((acc, w) => {
        if (!acc[w.registration_number])
          acc[w.registration_number] = { registration_number: w.registration_number, liters: 0, amount: 0 }
        acc[w.registration_number].liters += Number(w.liters)
        acc[w.registration_number].amount += Number(w.total_amount)
        return acc
      }, {}),
    ).sort((a, b) => b.liters - a.liters).slice(0, 8),
  [filtered])

  const stationStat: StationStat[] = useMemo(() =>
    Object.values(
      filtered.reduce<Record<string, StationStat>>((acc, w) => {
        if (!acc[w.station_name])
          acc[w.station_name] = { station_name: w.station_name, liters: 0, amount: 0 }
        acc[w.station_name].liters += Number(w.liters)
        acc[w.station_name].amount += Number(w.total_amount)
        return acc
      }, {}),
    ).sort((a, b) => b.liters - a.liters).slice(0, 6),
  [filtered])

  const fuelTypeStat: FuelTypeStat[] = useMemo(() =>
    Object.values(
      filtered.reduce<Record<string, FuelTypeStat>>((acc, w) => {
        if (!acc[w.fuel_type])
          acc[w.fuel_type] = { fuel_type: w.fuel_type, liters: 0, amount: 0 }
        acc[w.fuel_type].liters += Number(w.liters)
        acc[w.fuel_type].amount += Number(w.total_amount)
        return acc
      }, {}),
    ),
  [filtered])

  const maxBusLiters     = Math.max(...busStat.map(b => b.liters), 1)
  const maxStationLiters = Math.max(...stationStat.map(s => s.liters), 1)
  const recent           = filtered.slice(0, 5)

  /* ─── period label for heading ─── */

  const periodLabel = useMemo(() => {
    if (period === 'day')    return `le ${format(today, 'dd MMMM yyyy', { locale: fr })}`
    if (period === 'week')   return `sem. du ${format(new Date(from + 'T00:00:00'), 'dd MMM', { locale: fr })} au ${format(new Date(to + 'T00:00:00'), 'dd MMM yyyy', { locale: fr })}`
    if (period === 'month')  return format(today, 'MMMM yyyy', { locale: fr })
    if (period === 'year')   return format(today, 'yyyy')
    return `du ${format(new Date(from + 'T00:00:00'), 'dd MMM', { locale: fr })} au ${format(new Date(to + 'T00:00:00'), 'dd MMM yyyy', { locale: fr })}`
  }, [period, from, to])

  /* ─── render ──────────────────────────────────────────── */

  return (
    <div className="p-6 lg:p-8">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
            Carburant
          </h1>
          <p className="text-sm capitalize" style={{ color: 'var(--text-secondary)' }}>
            Tableau de bord — {periodLabel}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/carburant/report')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-colors hover:bg-gray-50"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            <FileText className="w-4 h-4" />
            Rapports
          </button>
          <button
            onClick={() => navigate('/carburant/new')}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white font-semibold text-sm transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#0B7439' }}
          >
            <Plus className="w-4 h-4" />
            Nouveau prélèvement
          </button>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6 px-4 py-3 rounded-2xl border"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>

        {/* Period tabs */}
        <div className="flex items-center gap-1">
          {PERIODS.map(p => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className="px-4 py-2 rounded-xl text-sm font-semibold transition-all"
              style={{
                backgroundColor: period === p.key ? '#0B7439' : 'transparent',
                color: period === p.key ? '#fff' : 'var(--text-secondary)',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Company select — grouped by sous-groupe */}
        <div className="relative">
          <select
            value={selectedCompany}
            onChange={e => setSelectedCompany(e.target.value)}
            className="appearance-none pl-3 pr-8 py-2 rounded-xl border text-sm font-semibold transition-colors max-w-[280px]"
            style={{
              borderColor: 'var(--border)',
              backgroundColor: 'var(--surface)',
              color: 'var(--text-primary)',
            }}
          >
            <option value="all">Toutes les sociétés</option>
            {groups.map(({ group, subsidiaries }) => (
              <optgroup key={group.id} label={`${group.name} — Groupe (${subsidiaries.length} filiales)`}>
                <option value={group.id}>{group.name} (toutes les filiales)</option>
                {subsidiaries.map(sub => (
                  <option key={sub.id} value={sub.id}>↳ {sub.name} ({sub.code})</option>
                ))}
              </optgroup>
            ))}
            {standalone.length > 0 && (
              <optgroup label="Sociétés autonomes">
                {standalone.map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                ))}
              </optgroup>
            )}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
            style={{ color: 'var(--text-muted)' }} />
        </div>
      </div>

      {/* ── Custom date range ── */}
      {period === 'custom' && (
        <div className="flex items-center gap-3 mb-6 p-4 rounded-2xl border"
          style={{ backgroundColor: 'var(--surface)', borderColor: '#0B743930' }}>
          <Calendar className="w-4 h-4 flex-shrink-0" style={{ color: '#0B7439' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Période :</span>
          <input
            type="date"
            value={customFrom}
            max={customTo}
            onChange={e => setCustomFrom(e.target.value)}
            className="px-3 py-2 border rounded-xl text-sm"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
          />
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>au</span>
          <input
            type="date"
            value={customTo}
            min={customFrom}
            onChange={e => setCustomTo(e.target.value)}
            className="px-3 py-2 border rounded-xl text-sm"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
          />
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-10 h-10 border-4 rounded-full animate-spin"
            style={{ borderColor: '#0B7439', borderTopColor: 'transparent' }} />
        </div>
      ) : (
        <>
          {/* ── KPI summary ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
            {[
              { label: 'Total litres',    value: fmtL(totalStats.liters), sub: `${totalStats.count} prélèvement${totalStats.count > 1 ? 's' : ''}`, color: '#3B82F6', icon: <Droplets className="w-6 h-6" /> },
              { label: 'Montant total',   value: fmt(totalStats.amount),  sub: 'sur la période',                                                    color: '#0B7439', icon: <DollarSign className="w-6 h-6" /> },
              { label: 'Types de carburant', value: fuelTypeStat.map(ft => `${FUEL_LABELS[ft.fuel_type] ?? ft.fuel_type} ${fmtL(ft.liters)}`).join(' · ') || '—', sub: 'répartition', color: '#F59E0B', icon: <Fuel className="w-6 h-6" /> },
            ].map(kpi => (
              <div key={kpi.label} className="rounded-2xl border p-6 flex items-start gap-4"
                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
                <div className="p-3 rounded-xl flex-shrink-0"
                  style={{ backgroundColor: `${kpi.color}15` }}>
                  <span style={{ color: kpi.color }}>{kpi.icon}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>
                    {kpi.label}
                  </p>
                  <p className="text-xl font-black truncate" style={{ color: kpi.color }}>{kpi.value}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{kpi.sub}</p>
                </div>
              </div>
            ))}
          </div>

          {/* ── Charts ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">

            {/* By bus */}
            <div className="lg:col-span-2 rounded-2xl border p-6"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2 mb-5">
                <Bus className="w-5 h-5" style={{ color: '#0B7439' }} />
                <h2 className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>Consommation par bus</h2>
              </div>
              {busStat.length === 0 ? (
                <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>Aucune donnée sur cette période</p>
              ) : (
                <div className="space-y-3">
                  {busStat.map(b => (
                    <div key={b.registration_number}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-semibold font-mono" style={{ color: 'var(--text-primary)' }}>
                          {b.registration_number}
                        </span>
                        <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                          <span>{fmtL(b.liters)}</span>
                          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{fmt(b.amount)}</span>
                        </div>
                      </div>
                      <div className="w-full h-2 rounded-full" style={{ backgroundColor: 'var(--bg-subtle)' }}>
                        <div className="h-full rounded-full transition-all"
                          style={{ width: `${(b.liters / maxBusLiters) * 100}%`, backgroundColor: '#0B7439' }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* By fuel type */}
            <div className="rounded-2xl border p-6"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2 mb-5">
                <Fuel className="w-5 h-5" style={{ color: '#F59E0B' }} />
                <h2 className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>Par type</h2>
              </div>
              {fuelTypeStat.length === 0 ? (
                <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>Aucune donnée</p>
              ) : (
                <div className="space-y-4">
                  {fuelTypeStat.map(ft => (
                    <div key={ft.fuel_type} className="p-4 rounded-xl border" style={{ borderColor: 'var(--border)' }}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: FUEL_COLORS[ft.fuel_type] || '#6B7280' }} />
                        <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                          {FUEL_LABELS[ft.fuel_type] || ft.fuel_type}
                        </span>
                      </div>
                      <p className="text-xl font-black" style={{ color: FUEL_COLORS[ft.fuel_type] || '#6B7280' }}>
                        {fmtL(ft.liters)}
                      </p>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{fmt(ft.amount)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── By station + recents ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            <div className="rounded-2xl border p-6"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2 mb-5">
                <MapPin className="w-5 h-5" style={{ color: '#16A34A' }} />
                <h2 className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>Consommation par station</h2>
              </div>
              {stationStat.length === 0 ? (
                <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>Aucune donnée</p>
              ) : (
                <div className="space-y-3">
                  {stationStat.map(s => (
                    <div key={s.station_name}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{s.station_name}</span>
                        <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                          <span>{fmtL(s.liters)}</span>
                          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{fmt(s.amount)}</span>
                        </div>
                      </div>
                      <div className="w-full h-2 rounded-full" style={{ backgroundColor: 'var(--bg-subtle)' }}>
                        <div className="h-full rounded-full"
                          style={{ width: `${(s.liters / maxStationLiters) * 100}%`, backgroundColor: '#16A34A' }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent */}
            <div className="rounded-2xl border p-6"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5" style={{ color: '#0B7439' }} />
                  <h2 className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>Derniers prélèvements</h2>
                </div>
                <button onClick={() => navigate('/carburant/report')}
                  className="flex items-center gap-1 text-xs font-medium" style={{ color: '#0B7439' }}>
                  Tout voir <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
              {recent.length === 0 ? (
                <div className="text-center py-8">
                  <Fuel className="w-10 h-10 mx-auto mb-2" style={{ color: '#D1D5DB' }} />
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Aucun prélèvement sur cette période</p>
                  <button onClick={() => navigate('/carburant/new')}
                    className="mt-3 text-sm font-semibold" style={{ color: '#0B7439' }}>
                    + Enregistrer un prélèvement
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {recent.map(w => (
                    <div key={w.id} className="flex items-center justify-between py-2 border-b last:border-0"
                      style={{ borderColor: 'var(--border)' }}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                            {w.registration_number}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-xs font-semibold"
                            style={{
                              backgroundColor: `${FUEL_COLORS[w.fuel_type]}20`,
                              color: FUEL_COLORS[w.fuel_type],
                            }}>
                            {FUEL_LABELS[w.fuel_type] || w.fuel_type}
                          </span>
                        </div>
                        <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                          {w.station_name}{w.city ? ` · ${w.city}` : ''}
                          {w.driver_name ? ` · ${w.driver_name}` : ''}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0 ml-4">
                        <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{fmtL(w.liters)}</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {format(new Date(w.withdrawal_date + 'T00:00:00'), 'dd MMM', { locale: fr })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
