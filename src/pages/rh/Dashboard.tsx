import { useEffect, useState, Fragment } from 'react'
import { Users, Bus, Banknote, UserCheck, TrendingUp, AlertTriangle, ArrowRight, FileText, Wallet, MinusCircle, UserX, MessageSquareWarning, ChevronRight, CalendarClock } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  PieChart, Pie, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, Legend,
} from 'recharts'
import { fetchPayrollByCompany, fetchSeniorityAlerts, fetchRetirementAlerts, convertToSalaried } from '@/services/hr.service'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/services/supabase'
import type { CompanyPayroll, EmployeeExtended } from '@/types/hr.types'
import { computeAge, monthsUntilRetirement, isRetirementReached, RETIREMENT_AGE } from '@/utils/retirement'
import toast from 'react-hot-toast'

const COMPANY_COLORS = ['#0B7439', '#1D6FA4', '#D97706', '#475569', '#AF3029']

function StatCard({
  icon: Icon, label, value, sub, color = '#0B7439',
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  label: string
  value: string | number
  sub?: string
  color?: string
}) {
  return (
    <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5 flex items-center gap-4">
      <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: color + '18' }}>
        <Icon className="w-6 h-6" style={{ color }} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-[#6B7280] font-medium uppercase tracking-wide truncate">{label}</p>
        <p className="text-2xl font-bold text-[#1A2E22] leading-tight">{value}</p>
        {sub && <p className="text-xs text-[#8AA898] mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

function fmt(n: number) { return n.toLocaleString('fr-CI') }
function fmtM(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} M`
  return `${(n / 1_000).toFixed(0)} K`
}

export default function RHDashboard() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [payroll,  setPayroll]  = useState<CompanyPayroll[]>([])
  const [alerts,   setAlerts]   = useState<EmployeeExtended[]>([])
  const [retirementAlerts, setRetirementAlerts] = useState<EmployeeExtended[]>([])
  const [loading,  setLoading]  = useState(true)
  const [showConversionModal, setShowConversionModal] = useState(false)
  const [selectedDriver, setSelectedDriver] = useState<EmployeeExtended | null>(null)
  const [newSalary, setNewSalary] = useState('')
  const [isConverting, setIsConverting] = useState(false)

  const [payrollKPIs, setPayrollKPIs] = useState({ bulletins: 0, loansActive: 0, deductions: 0, suspensions: 0, explanations: 0, explanationAlerts: 0 })
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggleExpand = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  const load = () => {
    const now = new Date()
    const curYear = now.getFullYear()
    const curMonth = now.getMonth() + 1

    Promise.all([
      fetchPayrollByCompany(),
      fetchSeniorityAlerts(),
      fetchRetirementAlerts(),
      supabase.from('pay_slips').select('id', { count: 'exact', head: true }).eq('period_year', curYear).eq('period_month', curMonth),
      supabase.from('employee_loans').select('id', { count: 'exact', head: true }).eq('status', 'en_cours'),
      supabase.from('salary_deductions').select('id', { count: 'exact', head: true }).eq('period_year', curYear).eq('period_month', curMonth).eq('status', 'active'),
      supabase.from('employee_suspensions').select('id', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('explanation_requests').select('employee_id').in('status', ['en_attente', 'repondu']),
    ]).then(([p, a, ra, bRes, lRes, dRes, sRes, eRes]) => {
      setPayroll(p); setAlerts(a); setRetirementAlerts(ra)
      const explData = eRes.data ?? []
      const counts: Record<string, number> = {}
      for (const e of explData) counts[e.employee_id] = (counts[e.employee_id] ?? 0) + 1
      setPayrollKPIs({
        bulletins: bRes.count ?? 0,
        loansActive: lRes.count ?? 0,
        deductions: dRes.count ?? 0,
        suspensions: sRes.count ?? 0,
        explanations: explData.length,
        explanationAlerts: Object.values(counts).filter(c => c >= 3).length,
      })
    })
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const totalEmployees    = payroll.reduce((s, c) => s + Number(c.total_employees), 0)
  const totalDrivers      = payroll.reduce((s, c) => s + Number(c.nb_chauffeurs), 0)
  const totalMasse        = payroll.reduce((s, c) => s + Number((c as any).masse_salariale_totale ?? c.masse_salariale), 0)
  const totalMasseFix     = payroll.reduce((s, c) => s + Number((c as any).masse_salariale_fixe ?? 0), 0)
  const totalMasseVar     = payroll.reduce((s, c) => s + Number((c as any).masse_salariale_variable ?? 0), 0)
  const totalActifs       = payroll.reduce((s, c) => s + Number(c.employes_actifs), 0)
  const totalTitulaires   = payroll.reduce((s, c) => s + Number(c.titulaires), 0)
  const totalContractuels = payroll.reduce((s, c) => s + Number(c.contractuels), 0)
  const totalChaufSal     = payroll.reduce((s, c) => s + Number((c as any).chauffeurs_salaries ?? 0), 0)
  const totalChaufCon     = payroll.reduce((s, c) => s + Number((c as any).chauffeurs_contractuels ?? 0), 0)
  const totalEligibles    = payroll.reduce((s, c) => s + Number((c as any).eligibles_passage_salarial ?? 0), 0)

  const contractPieData = [
    { name: 'Titulaires',   value: totalTitulaires },
    { name: 'Contractuels', value: totalContractuels },
  ]

  const num = (c: CompanyPayroll, k: string) => Number((c as any)[k] ?? 0)
  const aggregate = (rows: CompanyPayroll[]): CompanyPayroll => {
    const base = rows[0]
    const sum = (k: string) => rows.reduce((s, r) => s + num(r, k), 0)
    return {
      ...base,
      total_employees: sum('total_employees'),
      titulaires: sum('titulaires'),
      contractuels: sum('contractuels'),
      masse_salariale: sum('masse_salariale_totale') || sum('masse_salariale'),
      masse_salariale_totale: sum('masse_salariale_totale') || sum('masse_salariale'),
      masse_salariale_fixe: sum('masse_salariale_fixe'),
      masse_salariale_variable: sum('masse_salariale_variable'),
      chauffeurs_salaries: sum('chauffeurs_salaries'),
      chauffeurs_contractuels: sum('chauffeurs_contractuels'),
      eligibles_passage_salarial: sum('eligibles_passage_salarial'),
    } as CompanyPayroll
  }

  type GroupedRow = { row: CompanyPayroll; children: CompanyPayroll[] }
  const groupedRows: GroupedRow[] = (() => {
    const groups = payroll.filter(c => c.is_group)
    const usedIds = new Set<string>()
    const out: GroupedRow[] = []
    for (const g of groups) {
      const subs = payroll.filter(c => c.parent_id === g.company_id)
      usedIds.add(g.company_id)
      subs.forEach(s => usedIds.add(s.company_id))
      const members = [g, ...subs]
      const children = members.filter(c => Number(c.total_employees) > 0)
      out.push({ row: aggregate(members), children: children.length > 1 ? children : [] })
    }
    for (const c of payroll) {
      if (usedIds.has(c.company_id)) continue
      out.push({ row: c, children: [] })
    }
    return out
  })()

  const openConversionModal = (driver: EmployeeExtended) => {
    setSelectedDriver(driver)
    setNewSalary('')
    setShowConversionModal(true)
  }

  const handleConvert = async () => {
    if (!selectedDriver || !user || !newSalary || parseFloat(newSalary) <= 0) return
    setIsConverting(true)
    try {
      await convertToSalaried({ driverId: selectedDriver.id, newSalary: parseFloat(newSalary), approvedBy: user.id })
      toast.success(`${selectedDriver.full_name} converti en salarié`)
      setShowConversionModal(false)
      load()
    } catch {
      toast.error('Erreur lors de la conversion')
    } finally {
      setIsConverting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#1A2E22]">Ressources Humaines</h1>
        <p className="text-sm text-[#6B7280] mt-1">Vue consolidée — SBTA Holding</p>
      </div>

      {/* Seniority alerts */}
      {alerts.length > 0 && (
        <div className="bg-[#FEF3C7] border border-[#D97706] rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-[#D97706]" />
            <h3 className="font-bold text-[#92400E]">
              {alerts.length} chauffeur{alerts.length > 1 ? 's' : ''} éligible{alerts.length > 1 ? 's' : ''} au passage salarial
            </h3>
          </div>
          <div className="space-y-2">
            {alerts.map(driver => (
              <div key={driver.id}
                className="flex items-center justify-between bg-white rounded-xl p-3 border border-[#FEF3C7]">
                <div>
                  <div className="font-medium text-[#1A2E22] text-sm">{driver.full_name}</div>
                  <div className="text-xs text-[#8AA898]">
                    {driver.company_name}{driver.seniority_eligibility_date && ` · Éligible depuis le ${new Date(driver.seniority_eligibility_date).toLocaleDateString('fr-FR')}`}
                  </div>
                </div>
                <button onClick={() => openConversionModal(driver)}
                  className="text-xs font-bold bg-[#D97706] hover:bg-[#92400E] text-white px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1">
                  Convertir <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Retirement alerts — employés proches de 60 ans */}
      {retirementAlerts.length > 0 && (
        <div className="bg-[#FEF2F2] border border-[#DC2626] rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <CalendarClock className="w-5 h-5 text-[#DC2626]" />
            <h3 className="font-bold text-[#991B1B]">
              {retirementAlerts.length} employé{retirementAlerts.length > 1 ? 's' : ''} proche{retirementAlerts.length > 1 ? 's' : ''} de la retraite
              <span className="font-normal text-[#B91C1C]"> — âge légal : {RETIREMENT_AGE} ans</span>
            </h3>
          </div>
          <div className="space-y-2">
            {retirementAlerts.map(emp => {
              const age = computeAge(emp.date_naissance)
              const months = monthsUntilRetirement(emp.date_naissance)
              const reached = isRetirementReached(emp.date_naissance)
              return (
                <div key={emp.id}
                  className="flex items-center justify-between bg-white rounded-xl p-3 border border-[#FECACA]">
                  <div className="min-w-0">
                    <div className="font-medium text-[#1A2E22] text-sm">{emp.full_name}</div>
                    <div className="text-xs text-[#8AA898]">
                      {emp.company_name ?? 'HOLDING'}{age !== null && ` · ${age} ans`}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-lg ${
                      reached ? 'bg-[#FEE2E2] text-[#991B1B]' : 'bg-[#FEF3C7] text-[#92400E]'
                    }`}>
                      {reached
                        ? 'Retraite atteinte'
                        : `Dans ${months} mois`}
                    </span>
                    <button onClick={() => navigate(`/rh/employees/${emp.id}`)}
                      className="text-xs font-bold bg-[#DC2626] hover:bg-[#991B1B] text-white px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1">
                      Voir <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users}     label="Total employés"  value={totalEmployees} color="#0B7439" />
        <StatCard icon={Bus}       label="Chauffeurs"       value={`${totalChaufSal}S / ${totalChaufCon}C`} sub="Salariés / Contractuels" color="#1D6FA4" />
        <StatCard icon={Banknote}  label="Masse salariale"
          value={fmtM(totalMasse)}
          sub={`Fixe: ${fmtM(totalMasseFix)} + Var: ${fmtM(totalMasseVar)}`}
          color="#D97706" />
        <StatCard icon={UserCheck} label="Employés actifs" value={totalActifs}    color="#059669" />
      </div>

      {/* Enriched payroll table */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E2EAE5] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-[#0B7439]" />
            <h2 className="font-bold text-[#1A2E22]">Masse salariale par société</h2>
          </div>
          <button onClick={() => navigate('/rh/payroll')}
            className="text-xs text-[#4A6B55] hover:text-[#0B7439] flex items-center gap-1 transition-colors">
            Détail complet <ArrowRight className="w-3 h-3" />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#F8FAF8]">
              <tr>
                <th className="text-left px-6 py-3 text-[#4A6B55] font-semibold">Société</th>
                <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Emp.</th>
                <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Chauf. S/C</th>
                <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Fixe (sal.)</th>
                <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Variable (contrac.)</th>
                <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">TOTAL</th>
                <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Éligibles</th>
              </tr>
            </thead>
            <tbody>
              {groupedRows.map(({ row: company, children }, i) => {
                const fixe = Number((company as any).masse_salariale_fixe ?? 0)
                const variable = Number((company as any).masse_salariale_variable ?? 0)
                const total = Number((company as any).masse_salariale_totale ?? company.masse_salariale)
                const chaufSal = Number((company as any).chauffeurs_salaries ?? 0)
                const chaufCon = Number((company as any).chauffeurs_contractuels ?? 0)
                const eligible = Number((company as any).eligibles_passage_salarial ?? 0)
                const hasChildren = children.length > 0
                const isOpen = expanded.has(company.company_id)
                return (
                  <Fragment key={company.company_id}>
                    <tr
                      className="border-t border-[#E2EAE5] hover:bg-[#F8FAF8] transition-colors"
                      style={{ cursor: hasChildren ? 'pointer' : 'default' }}
                      onClick={hasChildren ? () => toggleExpand(company.company_id) : undefined}>
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          {hasChildren ? (
                            <ChevronRight className="w-4 h-4 flex-shrink-0 text-[#8AA898] transition-transform"
                              style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }} />
                          ) : (
                            <span className="w-4 flex-shrink-0" />
                          )}
                          <span className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{ backgroundColor: COMPANY_COLORS[i % COMPANY_COLORS.length] }} />
                          <span className="font-semibold text-[#1A2E22]">{company.company_name}</span>
                          <span className="text-xs text-[#8AA898]">({company.company_code})</span>
                          {hasChildren && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#F4F7F5] text-[#8AA898]">
                              {children.length} entités
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">{company.total_employees}</td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-[#0B7439] font-medium">{chaufSal}</span>
                        <span className="text-[#8AA898]">/</span>
                        <span className="text-[#1D6FA4] font-medium">{chaufCon}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-[#374151]">{fmt(fixe)} F</td>
                      <td className="px-4 py-3 text-right text-[#1D6FA4]">{fmt(variable)} F</td>
                      <td className="px-4 py-3 text-right font-bold text-[#0B7439]">{fmt(total)} F</td>
                      <td className="px-4 py-3 text-right">
                        {eligible > 0
                          ? <span className="px-2 py-0.5 bg-[#FEF3C7] text-[#D97706] rounded-lg text-xs font-bold">{eligible}</span>
                          : <span className="text-[#D1D5DB]">—</span>}
                      </td>
                    </tr>
                    {hasChildren && isOpen && children.map(child => {
                      const cFixe = Number((child as any).masse_salariale_fixe ?? 0)
                      const cVar = Number((child as any).masse_salariale_variable ?? 0)
                      const cTotal = Number((child as any).masse_salariale_totale ?? child.masse_salariale)
                      const cSal = Number((child as any).chauffeurs_salaries ?? 0)
                      const cCon = Number((child as any).chauffeurs_contractuels ?? 0)
                      const cElig = Number((child as any).eligibles_passage_salarial ?? 0)
                      return (
                        <tr key={child.company_id} className="border-t border-[#E2EAE5] bg-[#F8FAF8]">
                          <td className="px-6 py-2.5">
                            <div className="flex items-center gap-2 pl-9">
                              <span className="text-xs text-[#8AA898]">↳</span>
                              <span className="text-sm font-medium text-[#4A6B55]">{child.company_name}</span>
                              <span className="text-[11px] text-[#8AA898]">({child.company_code})</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs">{child.total_employees}</td>
                          <td className="px-4 py-2.5 text-right text-xs">
                            <span className="text-[#0B7439]">{cSal}</span>
                            <span className="text-[#8AA898]">/</span>
                            <span className="text-[#1D6FA4]">{cCon}</span>
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs text-[#374151]">{fmt(cFixe)} F</td>
                          <td className="px-4 py-2.5 text-right text-xs text-[#1D6FA4]">{fmt(cVar)} F</td>
                          <td className="px-4 py-2.5 text-right text-xs font-semibold text-[#0B7439]">{fmt(cTotal)} F</td>
                          <td className="px-4 py-2.5 text-right">
                            {cElig > 0
                              ? <span className="px-2 py-0.5 bg-[#FEF3C7] text-[#D97706] rounded-lg text-xs font-bold">{cElig}</span>
                              : <span className="text-[#D1D5DB] text-xs">—</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </Fragment>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-[#F4F7F5] border-t-2 border-[#D1E8D8]">
                <td className="px-6 py-3 font-bold text-[#1A2E22]">TOTAL</td>
                <td className="px-4 py-3 text-right font-bold">{totalEmployees}</td>
                <td className="px-4 py-3 text-right font-bold">
                  <span className="text-[#0B7439]">{totalChaufSal}</span>
                  <span className="text-[#8AA898]">/</span>
                  <span className="text-[#1D6FA4]">{totalChaufCon}</span>
                </td>
                <td className="px-4 py-3 text-right font-bold">{fmt(totalMasseFix)} F</td>
                <td className="px-4 py-3 text-right font-bold text-[#1D6FA4]">{fmt(totalMasseVar)} F</td>
                <td className="px-4 py-3 text-right font-bold text-[#0B7439]">{fmt(totalMasse)} F</td>
                <td className="px-4 py-3 text-right font-bold text-[#D97706]">{totalEligibles > 0 ? totalEligibles : '—'}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="px-6 py-2 text-xs text-[#8AA898] border-t border-[#E2EAE5]">
          S = Salariés (fixe) · C = Contractuels (variable) · Variable = rémunération journalière mois en cours
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-[#E2EAE5] p-6">
          <h3 className="font-bold text-[#1A2E22] mb-4">Répartition par type de contrat</h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={contractPieData} dataKey="value" nameKey="name"
                cx="50%" cy="50%" outerRadius={90}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                <Cell fill="#0B7439" />
                <Cell fill="#1D6FA4" />
              </Pie>
              <Tooltip formatter={(v: number) => [v, 'Employés']} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-2xl border border-[#E2EAE5] p-6">
          <h3 className="font-bold text-[#1A2E22] mb-4">Masse salariale Fixe vs Variable</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={payroll} margin={{ top: 0, right: 10, left: 10, bottom: 0 }}>
              <XAxis dataKey="company_code" tick={{ fontSize: 12, fill: '#6B7280' }} />
              <YAxis tickFormatter={v => `${(v / 1_000_000).toFixed(1)}M`} tick={{ fontSize: 11, fill: '#6B7280' }} />
              <Tooltip formatter={(v: number, name: string) => [`${fmt(v)} FCFA`, name]} />
              <Bar dataKey="masse_salariale_fixe"     name="Fixe (titulaires)"     fill="#0B7439" radius={[4, 4, 0, 0]} stackId="a" />
              <Bar dataKey="masse_salariale_variable" name="Variable (contractuels)" fill="#1D6FA4" radius={[4, 4, 0, 0]} stackId="a" />
              <Legend />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Payroll module KPIs */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-[#1A2E22]">Module Paie & Discipline</h3>
          <button onClick={() => navigate('/rh/pay-slips')} className="text-xs text-[#4A6B55] hover:text-[#0B7439] flex items-center gap-1 transition-colors">
            Bulletins <ArrowRight className="w-3 h-3" />
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { icon: FileText, label: 'Bulletins du mois', value: payrollKPIs.bulletins, color: '#0B7439', path: '/rh/pay-slips' },
            { icon: Wallet, label: 'Emprunts en cours', value: payrollKPIs.loansActive, color: '#1D6FA4', path: '/rh/loans' },
            { icon: MinusCircle, label: 'Retenues du mois', value: payrollKPIs.deductions, color: '#DC2626', path: '/rh/deductions' },
            { icon: UserX, label: 'Suspensions actives', value: payrollKPIs.suspensions, color: '#D97706', path: '/rh/suspensions' },
            { icon: MessageSquareWarning, label: 'Demandes expl.', value: payrollKPIs.explanations, color: '#D97706', path: '/rh/explanations' },
            { icon: AlertTriangle, label: 'Alertes (3+ dem.)', value: payrollKPIs.explanationAlerts, color: '#DC2626', path: '/rh/explanations' },
          ].map(k => (
            <button key={k.label} onClick={() => navigate(k.path)}
              className="rounded-xl p-3 text-left hover:shadow-md transition-all border border-[#E2EAE5]"
              style={{ backgroundColor: k.value > 0 ? k.color + '08' : '#fff' }}>
              <k.icon className="w-4 h-4 mb-1.5" style={{ color: k.color }} />
              <p className="text-lg font-bold" style={{ color: k.value > 0 ? k.color : '#1A2E22' }}>{k.value}</p>
              <p className="text-[10px] text-[#6B7280] leading-tight">{k.label}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Conversion modal */}
      {showConversionModal && selectedDriver && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-[#1A2E22]">Conversion en salarié</h3>
            <div className="bg-[#F8FAF8] rounded-xl p-4 space-y-1">
              <div className="font-bold text-[#1A2E22]">{selectedDriver.full_name}</div>
              <div className="text-sm text-[#4A6B55]">{selectedDriver.company_name}</div>
              {selectedDriver.hire_date && (
                <div className="text-sm text-[#4A6B55]">
                  En poste depuis le {new Date(selectedDriver.hire_date).toLocaleDateString('fr-FR')}
                  {selectedDriver.years_of_service != null ? ` — ${selectedDriver.years_of_service} an${selectedDriver.years_of_service > 1 ? 's' : ''}` : ''}
                </div>
              )}
              {selectedDriver.daily_rate != null && (
                <div className="text-sm text-[#4A6B55]">Taux contractuel : {Number(selectedDriver.daily_rate).toLocaleString('fr-CI')} FCFA/jour</div>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-[#1A2E22]">Nouveau salaire mensuel (FCFA) *</label>
              <input type="number" min="1" value={newSalary} onChange={e => setNewSalary(e.target.value)}
                placeholder="Ex : 350000"
                className="w-full border border-[#E2EAE5] rounded-xl px-4 py-3 mt-1 text-lg font-bold focus:outline-none focus:border-[#0B7439]" />
              <p className="text-xs text-[#8AA898] mt-1">Effectif à partir du 1er du mois prochain</p>
            </div>
            <div className="bg-[#D4EDDA] rounded-xl p-3 text-sm text-[#0B7439]">
              Cette action change le statut en Titulaire, supprime le taux journalier et enregistre l'action dans le journal d'activité.
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowConversionModal(false)}
                className="flex-1 py-3 border border-[#E2EAE5] rounded-xl text-[#4A6B55] font-medium hover:bg-[#F8FAF8]">
                Annuler
              </button>
              <button onClick={handleConvert}
                disabled={!newSalary || parseFloat(newSalary) <= 0 || isConverting}
                className="flex-1 py-3 bg-[#0B7439] text-white rounded-xl font-bold disabled:opacity-50 hover:bg-[#085c2d] transition-colors">
                {isConverting ? 'Conversion...' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
