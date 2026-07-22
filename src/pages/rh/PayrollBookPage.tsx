import { useState, useEffect, useCallback } from 'react'
import { BookOpen, Download, Search, Filter, Printer } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/services/supabase'
import { fetchEmployees } from '@/services/hr.service'
import type { PaySlip } from '@/types/hr.types'
import { payrollFromSlip } from '@/utils/ivorianPayroll'
import { fetchLiveDeductions, enrichSlip, EMPTY_DEDUCTION_MAPS, type LiveDeductionMaps } from '@/utils/payrollDeductions'
import { fetchPrimeMaps, applyPrimesToSlip, EMPTY_PRIME_MAP, type PrimeMap } from '@/utils/employeePrimes'
import { resolveCompanyIds, buildCompanyGroups } from '@/utils/companyGroups'

const fmt = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n))
const MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']

interface CompanyOption { id: string; name: string; code: string; parent_id?: string | null; is_group?: boolean }

export default function PayrollBookPage() {
  const [slips, setSlips] = useState<PaySlip[]>([])
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [liveMaps, setLiveMaps] = useState<LiveDeductionMaps>(EMPTY_DEDUCTION_MAPS)
  const [livePrimes, setLivePrimes] = useState<PrimeMap>(EMPTY_PRIME_MAP)
  const [loading, setLoading] = useState(true)
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear())
  const [monthFilter, setMonthFilter] = useState(new Date().getMonth() + 1)
  const [companyFilter, setCompanyFilter] = useState('')
  const [contractFilter, setContractFilter] = useState('')
  const [search, setSearch] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [slipsRes, compsRes, maps, emps] = await Promise.all([
        supabase.from('pay_slips')
          .select('*, company:companies(id, name, code)')
          .eq('period_year', yearFilter)
          .eq('period_month', monthFilter)
          .order('employee_name'),
        supabase.from('companies').select('id, name, code, parent_id, is_group').order('name'),
        fetchLiveDeductions(yearFilter, monthFilter),
        fetchEmployees({ company_id: null, station_id: null, role: null, contract_type: null, contract_nature: null, status: null, search: '' }),
      ])
      const loadedSlips = (slipsRes.data as PaySlip[] | null) ?? []
      if (slipsRes.data) setSlips(loadedSlips)
      if (compsRes.data) setCompanies(compsRes.data as CompanyOption[])
      setLiveMaps(maps)

      const hireDateByKey: Record<string, string | null> = {}
      for (const e of emps) hireDateByKey[`${e.id}_${e.source_table ?? 'employees'}`] = e.hire_date
      const baseByKey: Record<string, number> = {}
      for (const s of loadedSlips) {
        baseByKey[`${s.employee_id}_${s.employee_source}`] = Number(s.base_salary) || 0
      }
      setLivePrimes(await fetchPrimeMaps(yearFilter, monthFilter, baseByKey, hireDateByKey))
    } catch { toast.error('Erreur de chargement') }
    finally { setLoading(false) }
  }, [yearFilter, monthFilter])

  useEffect(() => { loadData() }, [loadData])

  const filterCompanyIds = companyFilter ? resolveCompanyIds(companyFilter, companies) : []

  const filtered = slips.filter(s => {
    if (companyFilter && !filterCompanyIds.includes(s.company_id)) return false
    if (contractFilter && s.contract_type !== contractFilter) return false
    if (search) {
      const q = search.toLowerCase()
      if (!s.employee_name.toLowerCase().includes(q) && !(s.employee_matricule ?? '').toLowerCase().includes(q)) return false
    }
    return true
  })

  const rowsData = filtered.map((s) => {
    const enriched = enrichSlip(applyPrimesToSlip(s, livePrimes), liveMaps)
    return { slip: enriched, pr: payrollFromSlip(enriched) }
  })

  const totals = rowsData.reduce((acc, { pr }) => ({
    gross: acc.gross + pr.taxableGross,
    retenues: acc.retenues + pr.totalRetenues,
    charges: acc.charges + pr.totalChargesPatronales,
    net: acc.net + pr.salaireNet,
    netAPayer: acc.netAPayer + pr.netAPayer,
  }), { gross: 0, retenues: 0, charges: 0, net: 0, netAPayer: 0 })

  const exportCSV = () => {
    const headers = ['N', 'Nom & Prenom', 'Matricule', 'Societe', 'Contrat',
      'Salaire brut', 'Retenues salariales', 'Charges patronales', 'Salaire net', 'Net a payer']
    const rows = rowsData.map(({ slip: s, pr }, i) => [
      String(i + 1), s.employee_name, s.employee_matricule ?? '', s.company?.code ?? '', s.contract_type ?? '',
      String(Math.round(pr.taxableGross)), String(Math.round(pr.totalRetenues)), String(Math.round(pr.totalChargesPatronales)),
      String(Math.round(pr.salaireNet)), String(Math.round(pr.netAPayer)),
    ])
    rows.push(['', 'TOTAL', '', '', '', String(Math.round(totals.gross)), String(Math.round(totals.retenues)),
      String(Math.round(totals.charges)), String(Math.round(totals.net)), String(Math.round(totals.netAPayer))])
    const content = [headers, ...rows].map(r => r.join(';')).join('\n')
    const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `livre_paie_${yearFilter}_${String(monthFilter).padStart(2, '0')}.csv`
    a.click(); URL.revokeObjectURL(url)
    toast.success('Export genere')
  }

  const handlePrint = () => window.print()

  if (loading) {
    return <div className="flex items-center justify-center h-[60vh]"><div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[90rem] mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#0B743915' }}>
            <BookOpen className="w-5 h-5" style={{ color: '#0B7439' }} />
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Livre de paie</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{MONTHS[monthFilter - 1]} {yearFilter} - {filtered.length} employe(s)</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={handlePrint} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium"
            style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            <Printer className="w-3.5 h-3.5" />Imprimer
          </button>
          <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium"
            style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            <Download className="w-3.5 h-3.5" />CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 print:hidden">
        <select value={monthFilter} onChange={e => setMonthFilter(Number(e.target.value))}
          className="px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
          {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <select value={yearFilter} onChange={e => setYearFilter(Number(e.target.value))}
          className="px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
          {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={companyFilter} onChange={e => setCompanyFilter(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
          <option value="">Toutes societes</option>
          {(() => {
            const { groups, standalone } = buildCompanyGroups(companies)
            return (
              <>
                {groups.map(g => (
                  <optgroup key={g.group.id} label={g.group.name}>
                    <option value={g.group.id}>{g.group.name} (groupe + sous-groupes)</option>
                    {g.subsidiaries.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </optgroup>
                ))}
                {standalone.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </>
            )
          })()}
        </select>
        <select value={contractFilter} onChange={e => setContractFilter(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
          <option value="">Tous contrats</option>
          <option value="titulaire">Titulaires</option>
          <option value="contractuel">Contractuels</option>
        </select>
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher..."
            className="w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-green-500"
            style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
        </div>
      </div>

      {/* Print header */}
      <div className="hidden print:block text-center mb-4">
        <h2 className="text-xl font-bold">LIVRE DE PAIE</h2>
        <p className="text-sm">{MONTHS[monthFilter - 1]} {yearFilter}{companyFilter ? ` - ${companies.find(c => c.id === companyFilter)?.name ?? ''}` : ' - Toutes societes'}</p>
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                <th className="text-center px-2 py-2.5 font-semibold" style={{ color: 'var(--text-secondary)' }}>N</th>
                <th className="text-left px-3 py-2.5 font-semibold" style={{ color: 'var(--text-secondary)' }}>Nom & Prenom</th>
                <th className="text-left px-2 py-2.5 font-semibold" style={{ color: 'var(--text-secondary)' }}>Mat.</th>
                <th className="text-left px-2 py-2.5 font-semibold" style={{ color: 'var(--text-secondary)' }}>Soc.</th>
                <th className="text-right px-2 py-2.5 font-semibold" style={{ color: '#0B7439' }}>Salaire brut</th>
                <th className="text-right px-2 py-2.5 font-semibold" style={{ color: 'var(--text-secondary)' }}>Retenues sal.</th>
                <th className="text-right px-2 py-2.5 font-semibold" style={{ color: 'var(--text-secondary)' }}>Charges patr.</th>
                <th className="text-right px-2 py-2.5 font-semibold" style={{ color: 'var(--text-secondary)' }}>Salaire net</th>
                <th className="text-right px-2 py-2.5 font-semibold" style={{ color: '#0B7439' }}>Net à payer</th>
              </tr>
            </thead>
            <tbody>
              {rowsData.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Aucun bulletin</td></tr>
              ) : rowsData.map(({ slip: s, pr }, i) => (
                <tr key={s.id} className="border-t hover:bg-gray-50/50 transition-colors" style={{ borderColor: 'var(--border)' }}>
                  <td className="px-2 py-2 text-center" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                  <td className="px-3 py-2 font-medium whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{s.employee_name}</td>
                  <td className="px-2 py-2" style={{ color: 'var(--text-muted)' }}>{s.employee_matricule ?? '-'}</td>
                  <td className="px-2 py-2" style={{ color: 'var(--text-secondary)' }}>{s.company?.code ?? '-'}</td>
                  <td className="px-2 py-2 text-right font-medium" style={{ color: '#0B7439' }}>{fmt(pr.taxableGross)}</td>
                  <td className="px-2 py-2 text-right" style={{ color: '#DC2626' }}>{fmt(pr.totalRetenues)}</td>
                  <td className="px-2 py-2 text-right" style={{ color: '#1D6FA4' }}>{fmt(pr.totalChargesPatronales)}</td>
                  <td className="px-2 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>{fmt(pr.salaireNet)}</td>
                  <td className="px-2 py-2 text-right font-bold" style={{ color: '#0B7439' }}>{fmt(pr.netAPayer)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2" style={{ borderColor: '#0B7439', backgroundColor: 'var(--bg-subtle)' }}>
                <td colSpan={4} className="px-3 py-2.5 font-bold" style={{ color: 'var(--text-primary)' }}>TOTAL ({filtered.length} employes)</td>
                <td className="px-2 py-2.5 text-right font-bold" style={{ color: '#0B7439' }}>{fmt(totals.gross)}</td>
                <td className="px-2 py-2.5 text-right font-bold" style={{ color: '#DC2626' }}>{fmt(totals.retenues)}</td>
                <td className="px-2 py-2.5 text-right font-bold" style={{ color: '#1D6FA4' }}>{fmt(totals.charges)}</td>
                <td className="px-2 py-2.5 text-right font-bold">{fmt(totals.net)}</td>
                <td className="px-2 py-2.5 text-right font-bold" style={{ color: '#0B7439' }}>{fmt(totals.netAPayer)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}
