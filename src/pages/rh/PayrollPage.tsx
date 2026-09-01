import { useEffect, useMemo, useState } from 'react'
import { Building2, Users, TrendingUp, DollarSign, ChevronDown, ChevronRight, Search } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts'
import { fetchPayrollByCompany } from '@/services/hr.service'
import { resolveCompanyIds, type CompanyWithHierarchy } from '@/utils/companyGroups'
import { CompanyGroupSelect } from '@/components/shared/CompanyGroupSelect'
import { supabase } from '@/services/supabase'
import type { CompanyPayroll } from '@/types/hr.types'

const COMPANY_COLORS = ['#0B7439', '#1D6FA4', '#D97706', '#475569', '#AF3029']

function fmt(n: number) {
  return n.toLocaleString('fr-CI')
}

function fmtM(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} M`
  return `${(n / 1_000).toFixed(0)} K`
}

interface ExpandedRows { [id: string]: boolean }

export default function PayrollPage() {
  const [payroll, setPayroll] = useState<CompanyPayroll[]>([])
  const [companies, setCompanies] = useState<CompanyWithHierarchy[]>([])
  const [companyFilter, setCompanyFilter] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<ExpandedRows>({})

  useEffect(() => {
    fetchPayrollByCompany()
      .then(setPayroll)
      .catch(console.error)
      .finally(() => setLoading(false))
    supabase.from('companies').select('id, name, code, parent_id, is_group').order('name')
      .then(({ data }) => { if (data) setCompanies(data as CompanyWithHierarchy[]) })
  }, [])

  const filteredPayroll = useMemo(() => {
    let result = payroll
    if (companyFilter) {
      const matchIds = resolveCompanyIds(companyFilter, companies)
      result = result.filter(c => matchIds.includes(c.company_id))
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(c =>
        c.company_name.toLowerCase().includes(q) ||
        c.company_code.toLowerCase().includes(q)
      )
    }
    return result
  }, [payroll, companyFilter, companies, search])

  const totalMasse     = filteredPayroll.reduce((s, c) => s + Number(c.masse_salariale), 0)
  const totalEmp       = filteredPayroll.reduce((s, c) => s + Number(c.total_employees), 0)
  const totalActifs    = filteredPayroll.reduce((s, c) => s + Number(c.employes_actifs), 0)
  const totalInactifs  = filteredPayroll.reduce((s, c) => s + Number(c.employes_inactifs), 0)
  const avgSalaire     = totalEmp > 0 ? totalMasse / totalEmp : 0

  const toggleExpand = (id: string) =>
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))

  const radarData = filteredPayroll.map((c, i) => ({
    subject: c.company_code,
    chauffeurs:   Number(c.nb_chauffeurs),
    guichetiers:  Number(c.nb_guichetiers),
    mecaniciens:  Number(c.nb_mecaniciens),
    fill: COMPANY_COLORS[i % COMPANY_COLORS.length],
  }))

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
        <h1 className="text-2xl font-bold text-[#1A2E22]">Masse salariale</h1>
        <p className="text-sm text-[#6B7280] mt-1">Consolidation SBTA Holding — tous salariés</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <CompanyGroupSelect
          companies={companies}
          value={companyFilter}
          onChange={setCompanyFilter}
          className="px-3 py-2 rounded-lg text-sm border border-[#E2EAE5] text-[#374151] bg-white"
        />
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher une société..."
            className="w-full pl-9 pr-3 py-2 rounded-lg text-sm border border-[#E2EAE5] text-[#374151] bg-white"
          />
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: DollarSign, label: 'Masse salariale totale', value: `${fmtM(totalMasse)} FCFA`, color: '#0B7439' },
          { icon: Users,      label: 'Total effectif',         value: totalEmp,                    color: '#1D6FA4' },
          { icon: TrendingUp, label: 'Salaire moyen',          value: `${fmt(Math.round(avgSalaire))} F`, color: '#D97706' },
          { icon: Building2,  label: 'Sociétés',               value: filteredPayroll.length,       color: '#475569' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white rounded-2xl border border-[#E2EAE5] p-5 flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: kpi.color + '18' }}>
              <kpi.icon className="w-5 h-5" style={{ color: kpi.color }} />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-[#6B7280] font-medium leading-tight">{kpi.label}</p>
              <p className="text-xl font-bold text-[#1A2E22]">{kpi.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Detailed table */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E2EAE5]">
          <h2 className="font-bold text-[#1A2E22]">Détail par société</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#F8FAF8]">
              <tr>
                <th className="text-left px-6 py-3 text-[#4A6B55] font-semibold w-8" />
                <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Société</th>
                <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Effectif</th>
                <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Actifs</th>
                <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Titulaires</th>
                <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Contractuels</th>
                <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Masse salariale</th>
                <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Sal. moyen</th>
                <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Sal. min</th>
                <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Sal. max</th>
              </tr>
            </thead>
            <tbody>
              {filteredPayroll.map((c, i) => {
                const isOpen = expanded[c.company_id]
                const share = totalMasse > 0 ? (Number(c.masse_salariale) / totalMasse) * 100 : 0
                return (
                  <>
                    <tr key={c.company_id}
                      className="border-t border-[#E2EAE5] hover:bg-[#F8FAF8] transition-colors cursor-pointer"
                      onClick={() => toggleExpand(c.company_id)}>
                      <td className="px-6 py-3">
                        {isOpen
                          ? <ChevronDown className="w-4 h-4 text-[#6B7280]" />
                          : <ChevronRight className="w-4 h-4 text-[#6B7280]" />}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{ backgroundColor: COMPANY_COLORS[i % COMPANY_COLORS.length] }} />
                          <span className="font-semibold text-[#1A2E22]">{c.company_name}</span>
                          <span className="text-xs text-[#8AA898]">({c.company_code})</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">{c.total_employees}</td>
                      <td className="px-4 py-3 text-right text-[#0B7439] font-medium">{c.employes_actifs}</td>
                      <td className="px-4 py-3 text-right">{c.titulaires}</td>
                      <td className="px-4 py-3 text-right">{c.contractuels}</td>
                      <td className="px-4 py-3 text-right font-bold text-[#0B7439]">
                        {fmt(Number(c.masse_salariale))} F
                      </td>
                      <td className="px-4 py-3 text-right">{fmt(Math.round(Number(c.salaire_moyen)))} F</td>
                      <td className="px-4 py-3 text-right text-[#6B7280]">{fmt(Number(c.salaire_min))} F</td>
                      <td className="px-4 py-3 text-right text-[#6B7280]">{fmt(Number(c.salaire_max))} F</td>
                    </tr>
                    {isOpen && (
                      <tr key={`${c.company_id}-detail`} className="bg-[#F8FAF8] border-t border-[#E2EAE5]">
                        <td colSpan={10} className="px-8 py-4">
                          <div className="grid grid-cols-3 gap-4 text-sm">
                            <div className="space-y-1">
                              <p className="font-semibold text-[#1A2E22] text-xs uppercase tracking-wide mb-2">Répartition postes</p>
                              <div className="flex justify-between"><span className="text-[#6B7280]">Chauffeurs</span><span className="font-medium">{c.nb_chauffeurs}</span></div>
                              <div className="flex justify-between"><span className="text-[#6B7280]">Guichetiers</span><span className="font-medium">{c.nb_guichetiers}</span></div>
                              <div className="flex justify-between"><span className="text-[#6B7280]">Mécaniciens</span><span className="font-medium">{c.nb_mecaniciens}</span></div>
                              <div className="flex justify-between"><span className="text-[#6B7280]">Inactifs</span><span className="font-medium text-[#6B7280]">{c.employes_inactifs}</span></div>
                            </div>
                            <div className="col-span-2">
                              <p className="font-semibold text-[#1A2E22] text-xs uppercase tracking-wide mb-2">Part du budget total</p>
                              <div className="flex items-center gap-3">
                                <div className="flex-1 h-3 bg-[#E2EAE5] rounded-full overflow-hidden">
                                  <div className="h-full rounded-full transition-all"
                                    style={{ width: `${share}%`, backgroundColor: COMPANY_COLORS[i % COMPANY_COLORS.length] }} />
                                </div>
                                <span className="text-sm font-bold text-[#1A2E22] w-14 text-right">{share.toFixed(1)}%</span>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-[#F4F7F5] border-t-2 border-[#D1E8D8]">
                <td className="px-6 py-3" />
                <td className="px-4 py-3 font-bold text-[#1A2E22]">TOTAL</td>
                <td className="px-4 py-3 text-right font-bold">{totalEmp}</td>
                <td className="px-4 py-3 text-right font-bold text-[#0B7439]">{totalActifs}</td>
                <td className="px-4 py-3 text-right font-bold">
                  {filteredPayroll.reduce((s, c) => s + Number(c.titulaires), 0)}
                </td>
                <td className="px-4 py-3 text-right font-bold">
                  {filteredPayroll.reduce((s, c) => s + Number(c.contractuels), 0)}
                </td>
                <td className="px-4 py-3 text-right font-bold text-[#0B7439]">{fmt(totalMasse)} F</td>
                <td className="px-4 py-3 text-right font-bold">{fmt(Math.round(avgSalaire))} F</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bar chart: payroll amount */}
        <div className="bg-white rounded-2xl border border-[#E2EAE5] p-6">
          <h3 className="font-bold text-[#1A2E22] mb-4">Masse salariale par société</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={filteredPayroll} margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
              <XAxis dataKey="company_code" tick={{ fontSize: 12, fill: '#6B7280' }} />
              <YAxis tickFormatter={v => `${(v / 1_000_000).toFixed(1)}M`} tick={{ fontSize: 11, fill: '#6B7280' }} />
              <Tooltip formatter={(v: number) => [`${fmt(v)} FCFA`, 'Masse salariale']} />
              <Bar dataKey="masse_salariale" radius={[6, 6, 0, 0]}>
                {filteredPayroll.map((_, i) => <Cell key={i} fill={COMPANY_COLORS[i % COMPANY_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Bar chart: headcount by role */}
        <div className="bg-white rounded-2xl border border-[#E2EAE5] p-6">
          <h3 className="font-bold text-[#1A2E22] mb-4">Répartition effectif par poste clé</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={filteredPayroll}
              margin={{ top: 0, right: 8, left: 8, bottom: 0 }}
            >
              <XAxis dataKey="company_code" tick={{ fontSize: 12, fill: '#6B7280' }} />
              <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} />
              <Tooltip />
              <Bar dataKey="nb_chauffeurs"  name="Chauffeurs"  fill="#0B7439" radius={[4, 4, 0, 0]} />
              <Bar dataKey="nb_guichetiers" name="Guichetiers" fill="#1D6FA4" radius={[4, 4, 0, 0]} />
              <Bar dataKey="nb_mecaniciens" name="Mécaniciens" fill="#D97706" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
