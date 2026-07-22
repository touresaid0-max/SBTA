import { useState, useEffect, useCallback, Fragment } from 'react'
import { TrendingUp, Download, Building2, ChevronRight } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from 'recharts'
import toast from 'react-hot-toast'
import { supabase } from '@/services/supabase'
import { fetchEmployees } from '@/services/hr.service'
import { buildCompanyGroups } from '@/utils/companyGroups'
import { computePayroll } from '@/utils/ivorianPayroll'
import { fetchPrimeMaps, type PrimeBuckets } from '@/utils/employeePrimes'
import type { Employee } from '@/types/hr.types'

const fmt = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n))
const fmtM = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)} M` : `${(n / 1_000).toFixed(0)} K`

const MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']
const COMPANY_COLORS = ['#0B7439', '#1D6FA4', '#D97706', '#DC2626', '#06B6D4', '#8B5CF6', '#F59E0B', '#10B981', '#475569']

type PeriodKey = 'monthly' | 'semiannual' | 'annual' | 'custom'
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'monthly', label: 'Mensuel' },
  { key: 'semiannual', label: 'Semestriel' },
  { key: 'annual', label: 'Annuel' },
  { key: 'custom', label: 'Personnalise' },
]

interface CompanyOption { id: string; name: string; code: string; parent_id: string | null; is_group: boolean }

interface CompanySummary {
  company_id: string; name: string; code: string
  employees: number; titulaires: number; contractuels: number
  fixe: number; variable: number; total: number
  brut: number; chargesSalariales: number; chargesPatronales: number
  net: number; cout: number
  children?: CompanySummary[]
}

export default function MasseSalarialePage() {
  const [allEmployees, setAllEmployees] = useState<Employee[]>([])
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<PeriodKey>('monthly')
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear())
  const [monthFilter, setMonthFilter] = useState(new Date().getMonth() + 1)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [summaries, setSummaries] = useState<CompanySummary[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggleExpand = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [emps, compsRes] = await Promise.all([
        fetchEmployees({ company_id: null, station_id: null, role: null, contract_type: null, contract_nature: null, status: null, search: '' }),
        supabase.from('companies').select('id, name, code, parent_id, is_group').order('name'),
      ])
      const activeEmps = emps.filter(e => e.status !== 'inactive')
      setAllEmployees(activeEmps)
      const comps = (compsRes.data ?? []) as CompanyOption[]
      setCompanies(comps)

      const baseByKey: Record<string, number> = {}
      const hireDateByKey: Record<string, string | null> = {}
      for (const e of activeEmps) {
        const base = e.contract_type === 'contractuel'
          ? (Number(e.current_month_earnings) || 0)
          : (Number(e.salary) || 0)
        const k = `${e.id}_${e.source_table ?? 'employees'}`
        baseByKey[k] = base
        hireDateByKey[k] = e.hire_date
      }
      const primeMap = await fetchPrimeMaps(yearFilter, monthFilter, baseByKey, hireDateByKey)

      const { groups: companyGroups, standalone } = buildCompanyGroups(comps)

      const buildSummary = (id: string, name: string, code: string, empIds: Set<string>): CompanySummary => {
        const matched = activeEmps.filter(e => empIds.has(e.company_id ?? ''))
        const titulaires = matched.filter(e => e.contract_type === 'titulaire')
        const contractuels = matched.filter(e => e.contract_type === 'contractuel')

        const empPrimes = (e: Employee): PrimeBuckets | undefined =>
          primeMap[`${e.id}_${e.source_table ?? 'employees'}`]
        const primeTotal = (b?: PrimeBuckets): number =>
          b ? b.sursalaire + b.transport + b.primes + b.indemnites + b.avantages + b.primesNonImposables : 0

        const fixe = titulaires.reduce((s, e) => s + (Number(e.salary) || 0) + primeTotal(empPrimes(e)), 0)
        const variable = contractuels.reduce((s, e) => s + (Number(e.current_month_earnings) || 0) + primeTotal(empPrimes(e)), 0)

        let brut = 0, chargesSalariales = 0, chargesPatronales = 0, net = 0, cout = 0
        for (const e of matched) {
          const baseSalary = e.contract_type === 'contractuel'
            ? (Number(e.current_month_earnings) || 0)
            : (Number(e.salary) || 0)
          const pb = empPrimes(e)
          const pr = computePayroll({
            baseSalary,
            sursalaire: pb?.sursalaire ?? 0,
            primes: pb?.primes ?? 0,
            indemnites: pb?.indemnites ?? 0,
            avantages: pb?.avantages ?? 0,
            transport: pb?.transport ?? 0,
            primesNonImposables: pb?.primesNonImposables ?? 0,
            maritalStatus: e.marital_status,
            childrenCount: e.children_count,
          })
          brut += pr.taxableGross
          chargesSalariales += pr.totalRetenues
          chargesPatronales += pr.totalChargesPatronales
          net += pr.netAPayer
          cout += pr.coutGlobalEmployeur
        }

        return {
          company_id: id, name, code,
          employees: matched.length,
          titulaires: titulaires.length,
          contractuels: contractuels.length,
          fixe, variable, total: fixe + variable,
          brut, chargesSalariales, chargesPatronales, net, cout,
        }
      }

      const sums: CompanySummary[] = []
      for (const { group, subsidiaries } of companyGroups) {
        const ids = new Set([group.id, ...subsidiaries.map(s => s.id)])
        const groupSummary = buildSummary(group.id, group.name, group.code, ids)
        const children = [group, ...subsidiaries]
          .map(c => buildSummary(c.id, c.name, c.code, new Set([c.id])))
          .filter(c => c.employees > 0)
        const hasSubsidiaryDetail = children.some(c => c.company_id !== group.id)
        if (children.length > 1 || hasSubsidiaryDetail) groupSummary.children = children
        sums.push(groupSummary)
      }
      for (const c of standalone) {
        sums.push(buildSummary(c.id, c.name, c.code, new Set([c.id])))
      }
      setSummaries(sums.filter(s => s.employees > 0))
    } catch { toast.error('Erreur de chargement') }
    finally { setLoading(false) }
  }, [yearFilter, monthFilter])

  useEffect(() => { loadData() }, [loadData])

  const totals = summaries.reduce((acc, s) => ({
    employees: acc.employees + s.employees,
    titulaires: acc.titulaires + s.titulaires,
    contractuels: acc.contractuels + s.contractuels,
    fixe: acc.fixe + s.fixe,
    variable: acc.variable + s.variable,
    total: acc.total + s.total,
    brut: acc.brut + s.brut,
    chargesSalariales: acc.chargesSalariales + s.chargesSalariales,
    chargesPatronales: acc.chargesPatronales + s.chargesPatronales,
    net: acc.net + s.net,
    cout: acc.cout + s.cout,
  }), { employees: 0, titulaires: 0, contractuels: 0, fixe: 0, variable: 0, total: 0, brut: 0, chargesSalariales: 0, chargesPatronales: 0, net: 0, cout: 0 })

  const barData = summaries.map((s, i) => ({
    name: s.code, fixe: s.fixe, variable: s.variable, fill: COMPANY_COLORS[i % COMPANY_COLORS.length],
  }))

  const pieData = summaries.filter(s => s.total > 0).map((s, i) => ({
    name: s.code, value: s.total, color: COMPANY_COLORS[i % COMPANY_COLORS.length],
  }))

  const byRole: Record<string, number> = {}
  for (const e of allEmployees) {
    const sal = Number(e.salary) || 0
    byRole[e.role] = (byRole[e.role] ?? 0) + sal
  }
  const roleData = Object.entries(byRole).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([role, total]) => ({ role, total }))

  const byContract = [
    { name: 'Titulaires', value: totals.fixe, color: '#0B7439' },
    { name: 'Contractuels', value: totals.variable, color: '#1D6FA4' },
  ]

  const exportCSV = () => {
    const headers = ['Societe', 'Code', 'Effectif', 'Masse brute', 'Retenues salariales', 'Charges patronales', 'Masse nette (Net a payer)', 'Cout global employeur']
    const rows = summaries.map(s => [s.name, s.code, String(s.employees), String(Math.round(s.brut)), String(Math.round(s.chargesSalariales)), String(Math.round(s.chargesPatronales)), String(Math.round(s.net)), String(Math.round(s.cout))])
    rows.push(['TOTAL', '', String(totals.employees), String(Math.round(totals.brut)), String(Math.round(totals.chargesSalariales)), String(Math.round(totals.chargesPatronales)), String(Math.round(totals.net)), String(Math.round(totals.cout))])
    const content = [headers, ...rows].map(r => r.join(';')).join('\n')
    const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `masse_salariale_${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(url)
    toast.success('Export genere')
  }

  if (loading) {
    return <div className="flex items-center justify-center h-[60vh]"><div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#0B743915' }}>
            <TrendingUp className="w-5 h-5" style={{ color: '#0B7439' }} />
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Masse salariale</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Rapports consolides par societe, poste et type de contrat</p>
          </div>
        </div>
        <button onClick={exportCSV} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ backgroundColor: '#0B7439' }}>
          <Download className="w-4 h-4" />Exporter
        </button>
      </div>

      {/* Period selector */}
      <div className="flex flex-wrap gap-2">
        {PERIODS.map(p => (
          <button key={p.key} onClick={() => setPeriod(p.key)}
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{
              backgroundColor: period === p.key ? '#0B7439' : 'var(--bg-subtle)',
              color: period === p.key ? '#fff' : 'var(--text-secondary)',
              border: `1px solid ${period === p.key ? '#0B7439' : 'var(--border)'}`,
            }}>
            {p.label}
          </button>
        ))}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Masse brute</p>
          <p className="text-xl font-bold" style={{ color: '#0B7439' }}>{fmtM(totals.brut)} F</p>
        </div>
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Masse nette (Net à payer)</p>
          <p className="text-xl font-bold" style={{ color: '#1D6FA4' }}>{fmtM(totals.net)} F</p>
        </div>
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Charges patronales</p>
          <p className="text-xl font-bold" style={{ color: '#D97706' }}>{fmtM(totals.chargesPatronales)} F</p>
        </div>
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Coût global employeur</p>
          <p className="text-xl font-bold" style={{ color: '#DC2626' }}>{fmtM(totals.cout)} F</p>
        </div>
      </div>

      {/* Table by company */}
      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="px-4 py-3 flex items-center gap-2" style={{ backgroundColor: 'var(--bg-subtle)' }}>
          <Building2 className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Masse salariale par societe</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Societe</th>
                <th className="text-right px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Effectif</th>
                <th className="text-right px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Masse brute</th>
                <th className="text-right px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Ret. sal.</th>
                <th className="text-right px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Charges patr.</th>
                <th className="text-right px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Net à payer</th>
                <th className="text-right px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Coût global</th>
                <th className="text-right px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Part</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((s, i) => {
                const share = totals.brut > 0 ? (s.brut / totals.brut) * 100 : 0
                const color = COMPANY_COLORS[i % COMPANY_COLORS.length]
                const hasChildren = !!s.children && s.children.length > 0
                const isOpen = expanded.has(s.company_id)
                return (
                  <Fragment key={s.company_id}>
                    <tr
                      className="border-t hover:bg-gray-50/50 transition-colors"
                      style={{ borderColor: 'var(--border)', cursor: hasChildren ? 'pointer' : 'default' }}
                      onClick={hasChildren ? () => toggleExpand(s.company_id) : undefined}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {hasChildren ? (
                            <ChevronRight
                              className="w-4 h-4 flex-shrink-0 transition-transform"
                              style={{ color: 'var(--text-muted)', transform: isOpen ? 'rotate(90deg)' : 'none' }}
                            />
                          ) : (
                            <span className="w-4 flex-shrink-0" />
                          )}
                          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{s.name}</span>
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>({s.code})</span>
                          {hasChildren && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-muted)' }}>
                              {s.children!.length} entités
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-xs">{s.employees}</td>
                      <td className="px-4 py-3 text-right text-xs font-medium" style={{ color: '#0B7439' }}>{fmt(s.brut)} F</td>
                      <td className="px-4 py-3 text-right text-xs" style={{ color: '#DC2626' }}>{fmt(s.chargesSalariales)} F</td>
                      <td className="px-4 py-3 text-right text-xs" style={{ color: '#1D6FA4' }}>{fmt(s.chargesPatronales)} F</td>
                      <td className="px-4 py-3 text-right text-xs font-bold" style={{ color: '#0B7439' }}>{fmt(s.net)} F</td>
                      <td className="px-4 py-3 text-right text-xs" style={{ color: '#D97706' }}>{fmt(s.cout)} F</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center gap-2 justify-end">
                          <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${share}%`, backgroundColor: color }} />
                          </div>
                          <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{share.toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                    {hasChildren && isOpen && s.children!.map(child => {
                      const cShare = totals.brut > 0 ? (child.brut / totals.brut) * 100 : 0
                      return (
                        <tr key={child.company_id} className="border-t" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)' }}>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2 pl-9">
                              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>↳</span>
                              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{child.name}</span>
                              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>({child.code})</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs">{child.employees}</td>
                          <td className="px-4 py-2.5 text-right text-xs" style={{ color: '#0B7439' }}>{fmt(child.brut)} F</td>
                          <td className="px-4 py-2.5 text-right text-xs" style={{ color: '#DC2626' }}>{fmt(child.chargesSalariales)} F</td>
                          <td className="px-4 py-2.5 text-right text-xs" style={{ color: '#1D6FA4' }}>{fmt(child.chargesPatronales)} F</td>
                          <td className="px-4 py-2.5 text-right text-xs font-semibold" style={{ color: '#0B7439' }}>{fmt(child.net)} F</td>
                          <td className="px-4 py-2.5 text-right text-xs" style={{ color: '#D97706' }}>{fmt(child.cout)} F</td>
                          <td className="px-4 py-2.5 text-right">
                            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{cShare.toFixed(1)}%</span>
                          </td>
                        </tr>
                      )
                    })}
                  </Fragment>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2" style={{ borderColor: '#0B7439', backgroundColor: 'var(--bg-subtle)' }}>
                <td className="px-4 py-3 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>TOTAL</td>
                <td className="px-4 py-3 text-right text-sm font-bold">{totals.employees}</td>
                <td className="px-4 py-3 text-right text-sm font-bold" style={{ color: '#0B7439' }}>{fmt(totals.brut)} F</td>
                <td className="px-4 py-3 text-right text-sm font-bold" style={{ color: '#DC2626' }}>{fmt(totals.chargesSalariales)} F</td>
                <td className="px-4 py-3 text-right text-sm font-bold" style={{ color: '#1D6FA4' }}>{fmt(totals.chargesPatronales)} F</td>
                <td className="px-4 py-3 text-right text-sm font-bold" style={{ color: '#0B7439' }}>{fmt(totals.net)} F</td>
                <td className="px-4 py-3 text-right text-sm font-bold" style={{ color: '#D97706' }}>{fmt(totals.cout)} F</td>
                <td className="px-4 py-3 text-right text-sm font-bold">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>Masse salariale par societe</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={barData}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => `${(v / 1_000_000).toFixed(1)}M`} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => fmt(v) + ' F'} />
              <Bar dataKey="fixe" name="Fixe" fill="#0B7439" stackId="a" radius={[0, 0, 0, 0]} />
              <Bar dataKey="variable" name="Variable" fill="#1D6FA4" stackId="a" radius={[4, 4, 0, 0]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>Repartition par societe</h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2} stroke="none">
                {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              <Tooltip formatter={(v: number) => fmt(v) + ' F'} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* By role */}
      <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>Masse salariale par poste</h3>
        <div className="space-y-2">
          {roleData.map(r => {
            const pct = totals.total > 0 ? (r.total / totals.total) * 100 : 0
            return (
              <div key={r.role} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="font-medium capitalize" style={{ color: 'var(--text-primary)' }}>{r.role}</span>
                  <span className="font-bold" style={{ color: '#0B7439' }}>{fmt(r.total)} F ({pct.toFixed(1)}%)</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-subtle)' }}>
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: '#0B7439' }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Fixe vs Variable */}
      <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>Repartition Fixe vs Variable</h3>
        <div className="flex items-center gap-6">
          <div className="flex-1">
            {byContract.map(c => {
              const pct = totals.total > 0 ? (c.value / totals.total) * 100 : 0
              return (
                <div key={c.name} className="flex items-center gap-3 py-2">
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                  <span className="text-sm flex-1" style={{ color: 'var(--text-primary)' }}>{c.name}</span>
                  <span className="text-sm font-bold" style={{ color: c.color }}>{fmt(c.value)} F</span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>({pct.toFixed(1)}%)</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
