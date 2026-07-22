import { useState, useEffect, useCallback } from 'react'
import { FileText, Plus, Search, Filter, Download, Check, Eye, Trash2, Building2, Printer } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/services/supabase'
import { fetchEmployees } from '@/services/hr.service'
import BulletinPrint from '@/components/rh/BulletinPrint'
import { resolveCompanyIds, buildCompanyGroups } from '@/utils/companyGroups'
import { computePayroll, payrollFromSlip } from '@/utils/ivorianPayroll'
import { fetchPrimeMaps, applyPrimesToSlip, seniorityLabel, EMPTY_PRIME_MAP, type PrimeMap } from '@/utils/employeePrimes'
import type { PaySlip, Employee, DeductionDetail } from '@/types/hr.types'

const fmt = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n))
const MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']

interface CompanyOption { id: string; name: string; code: string; parent_id?: string | null; is_group?: boolean }

const DEDUCTION_LABELS: Record<string, string> = {
  contravention: 'Contravention', emprunt: 'Remb. emprunt', avance: 'Remb. avance',
  acompte: 'Remb. acompte', absence_non_justifiee: 'Absence non justifiee',
  sanction_financiere: 'Sanction financiere', autre: 'Autre retenue',
}
const LOAN_LABELS: Record<string, string> = {
  emprunt: 'Remb. emprunt social', avance: 'Remb. avance sur salaire', acompte: 'Remb. acompte',
}

type DeductionRow = { id: string; employee_id: string; employee_source: string; deduction_type: string; amount: number | string }
type LoanRow = { id: string; employee_id: string; employee_source: string; loan_type: string; installment_amount: number | string }

function buildDeductionMap(rows: DeductionRow[] | null): Record<string, DeductionDetail[]> {
  const map: Record<string, DeductionDetail[]> = {}
  for (const d of rows ?? []) {
    const key = `${d.employee_id}_${d.employee_source}`
    if (!map[key]) map[key] = []
    map[key].push({
      type: d.deduction_type,
      label: DEDUCTION_LABELS[d.deduction_type] || d.deduction_type,
      amount: Number(d.amount),
      ref_id: d.id,
    })
  }
  return map
}

function buildLoanMap(rows: LoanRow[] | null): Record<string, DeductionDetail[]> {
  const map: Record<string, DeductionDetail[]> = {}
  for (const l of rows ?? []) {
    const key = `${l.employee_id}_${l.employee_source}`
    if (!map[key]) map[key] = []
    map[key].push({
      type: l.loan_type,
      label: LOAN_LABELS[l.loan_type] || `Remb. ${l.loan_type}`,
      amount: Number(l.installment_amount),
      ref_id: l.id,
    })
  }
  return map
}

export default function PaySlipsPage() {
  const [slips, setSlips] = useState<PaySlip[]>([])
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear())
  const [monthFilter, setMonthFilter] = useState(new Date().getMonth() + 1)
  const [statusFilter, setStatusFilter] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [showGenerate, setShowGenerate] = useState(false)
  const [genCompany, setGenCompany] = useState('')
  const [generating, setGenerating] = useState(false)
  const [showDetail, setShowDetail] = useState<PaySlip | null>(null)
  const [printSlip, setPrintSlip] = useState<PaySlip | null>(null)
  const [liveDeductions, setLiveDeductions] = useState<Record<string, DeductionDetail[]>>({})
  const [liveLoans, setLiveLoans] = useState<Record<string, DeductionDetail[]>>({})
  const [livePrimes, setLivePrimes] = useState<PrimeMap>(EMPTY_PRIME_MAP)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [slipsRes, compsRes, deductionsRes, loansRes, emps] = await Promise.all([
        supabase.from('pay_slips')
          .select('*, company:companies(id, name, code)')
          .eq('period_year', yearFilter)
          .eq('period_month', monthFilter)
          .order('employee_name'),
        supabase.from('companies').select('id, name, code, parent_id, is_group').order('name'),
        supabase.from('salary_deductions')
          .select('id, employee_id, employee_source, deduction_type, amount')
          .eq('period_year', yearFilter)
          .eq('period_month', monthFilter)
          .eq('status', 'active'),
        supabase.from('employee_loans')
          .select('id, employee_id, employee_source, loan_type, installment_amount')
          .eq('status', 'en_cours'),
        fetchEmployees({ company_id: null, station_id: null, role: null, contract_type: null, contract_nature: null, status: null, search: '' }),
      ])
      const loadedSlips = (slipsRes.data as PaySlip[] | null) ?? []
      if (slipsRes.data) setSlips(loadedSlips)
      if (compsRes.data) setCompanies(compsRes.data as CompanyOption[])
      setEmployees(emps)
      setLiveDeductions(buildDeductionMap(deductionsRes.data as DeductionRow[] | null))
      setLiveLoans(buildLoanMap(loansRes.data as LoanRow[] | null))

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

  const hireDateByKey = employees.reduce<Record<string, string | null>>((acc, e) => {
    acc[`${e.id}_${e.source_table ?? 'employees'}`] = e.hire_date
    return acc
  }, {})

  const nationalityByKey = employees.reduce<Record<string, string | null>>((acc, e) => {
    acc[`${e.id}_${e.source_table ?? 'employees'}`] = e.nationality
    return acc
  }, {})

  const enrichSlip = useCallback((slip: PaySlip): PaySlip => {
    const key = `${slip.employee_id}_${slip.employee_source}`
    const hireDate = slip.employee_hire_date ?? hireDateByKey[key] ?? null
    const nationality = slip.employee_nationality ?? nationalityByKey[key] ?? null
    const withPrimes = { ...applyPrimesToSlip(slip, livePrimes), employee_hire_date: hireDate, employee_nationality: nationality }
    const deds = liveDeductions[key]
    const loans = liveLoans[key]
    if (!deds && !loans) return withPrimes
    const detDeds = deds ?? []
    const detLoans = loans ?? []
    const otherAmt = detDeds.reduce((s, d) => s + d.amount, 0)
    const loanAmt = detLoans.reduce((s, d) => s + d.amount, 0)
    return {
      ...withPrimes,
      retenues: otherAmt,
      loan_deductions: loanAmt,
      deduction_details: [...detDeds, ...detLoans],
    }
  }, [liveDeductions, liveLoans, livePrimes, hireDateByKey, nationalityByKey])

  const filterCompanyIds = companyFilter ? resolveCompanyIds(companyFilter, companies) : []
  const filtered = slips.filter(s => {
    if (companyFilter && !filterCompanyIds.includes(s.company_id)) return false
    if (statusFilter && s.status !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      if (!s.employee_name.toLowerCase().includes(q) && !(s.employee_matricule ?? '').toLowerCase().includes(q)) return false
    }
    return true
  })

  const totals = filtered.reduce((acc, s) => {
    const pr = payrollFromSlip(enrichSlip(s))
    return {
      gross: acc.gross + pr.taxableGross,
      net: acc.net + pr.netAPayer,
      cnps: acc.cnps + pr.cnpsEmployee + pr.cnpsEmployer,
      its: acc.its + pr.is,
    }
  }, { gross: 0, net: 0, cnps: 0, its: 0 })

  const detailSlip = showDetail ? enrichSlip(showDetail) : null
  const detailPr = detailSlip ? payrollFromSlip(detailSlip) : null

  const { groups: companyGroups, standalone: standaloneCompanies } = buildCompanyGroups(companies)
  const renderCompanyOptions = () => (
    <>
      {companyGroups.map(g => (
        <optgroup key={g.group.id} label={g.group.name}>
          <option value={g.group.id}>{g.group.name} (groupe + sous-groupes)</option>
          {g.subsidiaries.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </optgroup>
      ))}
      {standaloneCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
    </>
  )

  const generateBulletins = async () => {
    setGenerating(true)
    try {
      const targetIds = genCompany ? resolveCompanyIds(genCompany, companies) : []
      let emps: Employee[] = []
      if (targetIds.length > 1) {
        const results = await Promise.all(targetIds.map(id => fetchEmployees({
          company_id: id, station_id: null, role: null, contract_type: null,
          contract_nature: null,
          status: null, search: '',
        })))
        const seen = new Set<string>()
        emps = results.flat().filter(e => {
          const key = `${e.id}_${e.source_table ?? 'employees'}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
      } else {
        emps = await fetchEmployees({
          company_id: genCompany || null,
          station_id: null, role: null, contract_type: null,
          contract_nature: null,
          status: null, search: '',
        })
      }
      const activeEmps = emps.filter(e => e.status !== 'inactive' && e.salary && Number(e.salary) > 0)
      if (activeEmps.length === 0) { toast.error('Aucun employe actif avec salaire'); setGenerating(false); return }

      const { data: existingSlips } = await supabase
        .from('pay_slips')
        .select('employee_id, employee_source')
        .eq('period_year', yearFilter)
        .eq('period_month', monthFilter)
      const existingKeys = new Set((existingSlips ?? []).map(s => `${s.employee_id}_${s.employee_source}`))

      const { data: deductions } = await supabase
        .from('salary_deductions')
        .select('id, employee_id, employee_source, deduction_type, amount')
        .eq('period_year', yearFilter)
        .eq('period_month', monthFilter)
        .eq('status', 'active')

      const { data: loans } = await supabase
        .from('employee_loans')
        .select('id, employee_id, employee_source, loan_type, installment_amount')
        .eq('status', 'en_cours')

      const deductionDetailsByEmp = buildDeductionMap(deductions as DeductionRow[] | null)
      const loanDetailsByEmp = buildLoanMap(loans as LoanRow[] | null)

      const baseByKey: Record<string, number> = {}
      const hireDateByKey: Record<string, string | null> = {}
      for (const emp of activeEmps) {
        const k = `${emp.id}_${emp.source_table ?? 'employees'}`
        baseByKey[k] = Number(emp.salary) || 0
        hireDateByKey[k] = emp.hire_date
      }
      const primeMap = await fetchPrimeMaps(yearFilter, monthFilter, baseByKey, hireDateByKey)

      const toInsert: Omit<PaySlip, 'id' | 'created_at' | 'updated_at' | 'company'>[] = []

      for (const emp of activeEmps) {
        const source = emp.source_table ?? 'employees'
        const key = `${emp.id}_${source}`
        if (existingKeys.has(key)) continue

        const baseSalary = Number(emp.salary) || 0

        const empDeductions = deductionDetailsByEmp[key] ?? []
        const empLoans = loanDetailsByEmp[key] ?? []
        const allDetails = [...empDeductions, ...empLoans]
        const deductionsAmt = empDeductions.reduce((s, d) => s + d.amount, 0)
        const loanAmt = empLoans.reduce((s, d) => s + d.amount, 0)

        const pb = primeMap[key]
        const primeBuckets = pb ?? { sursalaire: 0, transport: 0, primes: 0, indemnites: 0, avantages: 0, primesNonImposables: 0, details: [] }

        const pr = computePayroll({
          baseSalary,
          sursalaire: primeBuckets.sursalaire,
          primes: primeBuckets.primes,
          indemnites: primeBuckets.indemnites,
          avantages: primeBuckets.avantages,
          transport: primeBuckets.transport,
          primesNonImposables: primeBuckets.primesNonImposables,
          maritalStatus: emp.marital_status,
          childrenCount: emp.children_count,
          otherDeductions: deductionsAmt,
          loanDeductions: loanAmt,
        })

        toInsert.push({
          employee_id: emp.id,
          employee_source: source,
          company_id: emp.company_id,
          period_year: yearFilter,
          period_month: monthFilter,
          employee_name: emp.full_name,
          employee_matricule: emp.employee_id,
          employee_role: emp.role,
          employee_cnps: emp.cnps_number,
          employee_nationality: emp.nationality,
          employee_marital_status: emp.marital_status,
          employee_children_count: emp.children_count,
          employee_hire_date: emp.hire_date,
          contract_type: emp.contract_type,
          base_salary: baseSalary,
          sursalaire: primeBuckets.sursalaire,
          primes: primeBuckets.primes,
          indemnites: primeBuckets.indemnites,
          avantages: primeBuckets.avantages,
          primes_non_imposables: primeBuckets.primesNonImposables,
          prime_details: primeBuckets.details,
          gross_salary: pr.taxableGross,
          retenues: deductionsAmt,
          cnps_employee: pr.cnpsEmployee,
          cnps_employer: pr.cnpsEmployer,
          its: pr.is,
          cn: pr.cn,
          igr: pr.igr,
          cmu_employee: pr.cmuEmployee,
          cmu_employer: pr.cmuEmployer,
          transport_allowance: primeBuckets.transport,
          taxable_gross: pr.taxableGross,
          parts: pr.parts,
          loan_deductions: loanAmt,
          deduction_details: allDetails,
          net_salary: pr.netSalary,
          status: 'draft',
          validated_by: null,
          validated_at: null,
          paid_at: null,
          notes: null,
          created_by: null,
        })
      }

      if (toInsert.length === 0) {
        toast('Tous les bulletins existent deja pour cette periode')
        setGenerating(false)
        setShowGenerate(false)
        return
      }

      const { error } = await supabase.from('pay_slips').insert(toInsert)
      if (error) { toast.error(error.message); setGenerating(false); return }

      toast.success(`${toInsert.length} bulletin(s) genere(s)`)
      setShowGenerate(false)
      loadData()
    } catch (err) {
      toast.error('Erreur de generation')
    } finally { setGenerating(false) }
  }

  const validateSlip = async (id: string) => {
    const { error } = await supabase.from('pay_slips').update({
      status: 'validated', validated_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) { toast.error(error.message); return }
    toast.success('Bulletin valide')
    setSlips(prev => prev.map(s => s.id === id ? { ...s, status: 'validated' as const } : s))
  }

  const markPaid = async (id: string) => {
    const { error } = await supabase.from('pay_slips').update({
      status: 'paid', paid_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) { toast.error(error.message); return }
    toast.success('Bulletin marque comme paye')
    setSlips(prev => prev.map(s => s.id === id ? { ...s, status: 'paid' as const } : s))
  }

  const deleteSlip = async (id: string) => {
    if (!confirm('Supprimer ce bulletin ?')) return
    const { error } = await supabase.from('pay_slips').delete().eq('id', id)
    if (error) { toast.error(error.message); return }
    toast.success('Bulletin supprime')
    setSlips(prev => prev.filter(s => s.id !== id))
  }

  const validateAll = async () => {
    const drafts = filtered.filter(s => s.status === 'draft')
    if (drafts.length === 0) return
    if (!confirm(`Valider ${drafts.length} bulletin(s) ?`)) return
    const { error } = await supabase.from('pay_slips').update({
      status: 'validated', validated_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).in('id', drafts.map(s => s.id))
    if (error) { toast.error(error.message); return }
    toast.success(`${drafts.length} bulletin(s) valide(s)`)
    loadData()
  }

  const exportCSV = () => {
    const headers = ['Nom', 'Matricule', 'Societe', 'Contrat', 'Salaire Base', 'Brut', 'CNPS Emp.', 'IS', 'CN', 'IGR', 'CMU', 'Total Retenues', 'Net a payer', 'Statut']
    const rows = filtered.map(s => {
      const pr = payrollFromSlip(enrichSlip(s))
      return [
        s.employee_name, s.employee_matricule ?? '', s.company?.name ?? '', s.contract_type ?? '',
        String(s.base_salary), String(Math.round(pr.taxableGross)), String(Math.round(pr.cnpsEmployee)),
        String(Math.round(pr.is)), String(Math.round(pr.cn)), String(Math.round(pr.igr)), String(Math.round(pr.cmuEmployee)),
        String(Math.round(pr.totalRetenues)), String(Math.round(pr.netAPayer)), s.status,
      ]
    })
    const content = [headers, ...rows].map(r => r.join(';')).join('\n')
    const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `bulletins_${yearFilter}_${String(monthFilter).padStart(2,'0')}.csv`
    a.click(); URL.revokeObjectURL(url)
    toast.success('Export genere')
  }

  const statusBadge = (s: string) => {
    const map: Record<string, { bg: string; color: string; label: string }> = {
      draft: { bg: '#F3F4F6', color: '#6B7280', label: 'Brouillon' },
      validated: { bg: '#DBEAFE', color: '#1D6FA4', label: 'Valide' },
      paid: { bg: '#D4EDDA', color: '#0B7439', label: 'Paye' },
    }
    const m = map[s] ?? map.draft
    return <span className="px-2 py-0.5 rounded-full text-xs font-bold" style={{ backgroundColor: m.bg, color: m.color }}>{m.label}</span>
  }

  if (loading) {
    return <div className="flex items-center justify-center h-[60vh]"><div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#0B743915' }}>
            <FileText className="w-5 h-5" style={{ color: '#0B7439' }} />
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Bulletins de paie</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{MONTHS[monthFilter - 1]} {yearFilter}</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium"
            style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            <Download className="w-3.5 h-3.5" />CSV
          </button>
          <button onClick={validateAll} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium"
            style={{ backgroundColor: '#DBEAFE', color: '#1D6FA4' }}>
            <Check className="w-3.5 h-3.5" />Valider tout
          </button>
          <button onClick={() => setShowGenerate(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ backgroundColor: '#0B7439' }}>
            <Plus className="w-4 h-4" />Generer bulletins
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Bulletins', value: filtered.length, color: '#0B7439' },
          { label: 'Brut total', value: `${fmt(totals.gross)} F`, color: '#1D6FA4' },
          { label: 'CNPS + ITS', value: `${fmt(totals.cnps + totals.its)} F`, color: '#D97706' },
          { label: 'Net total', value: `${fmt(totals.net)} F`, color: '#059669' },
        ].map(k => (
          <div key={k.label} className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{k.label}</p>
            <p className="text-lg font-bold" style={{ color: k.color }}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Period + Search */}
      <div className="flex flex-col sm:flex-row gap-3">
        <select value={monthFilter} onChange={e => setMonthFilter(Number(e.target.value))}
          className="px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
          {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <select value={yearFilter} onChange={e => setYearFilter(Number(e.target.value))}
          className="px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
          {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher par nom, matricule..."
            className="w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-green-500"
            style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
        </div>
        <button onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium"
          style={{ backgroundColor: showFilters ? '#0B743910' : 'var(--bg-subtle)', border: '1px solid var(--border)', color: showFilters ? '#0B7439' : 'var(--text-secondary)' }}>
          <Filter className="w-3.5 h-3.5" />Filtres
        </button>
      </div>

      {showFilters && (
        <div className="grid grid-cols-2 gap-3 rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Societe</label>
            <select value={companyFilter} onChange={e => setCompanyFilter(e.target.value)}
              className="w-full px-2 py-1.5 rounded-lg text-xs" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
              <option value="">Toutes</option>
              {renderCompanyOptions()}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Statut</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="w-full px-2 py-1.5 rounded-lg text-xs" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
              <option value="">Tous</option>
              <option value="draft">Brouillon</option>
              <option value="validated">Valide</option>
              <option value="paid">Paye</option>
            </select>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Employe</th>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Societe</th>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Contrat</th>
                <th className="text-right px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Base</th>
                <th className="text-right px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Brut</th>
                <th className="text-right px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>CNPS</th>
                <th className="text-right px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>ITS</th>
                <th className="text-right px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Retenues</th>
                <th className="text-right px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Net</th>
                <th className="text-center px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Statut</th>
                <th className="text-center px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Aucun bulletin pour cette periode</td></tr>
              ) : filtered.map(s => {
                const pr = payrollFromSlip(enrichSlip(s))
                return (
                <tr key={s.id} className="border-t hover:bg-gray-50/50 transition-colors" style={{ borderColor: 'var(--border)' }}>
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{s.employee_name}</div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.employee_matricule ?? '-'}</div>
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{s.company?.code ?? '-'}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{s.contract_type === 'titulaire' ? 'Tit.' : 'Cont.'}</td>
                  <td className="px-4 py-3 text-right text-xs" style={{ color: 'var(--text-primary)' }}>{fmt(Number(s.base_salary))}</td>
                  <td className="px-4 py-3 text-right text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{fmt(pr.taxableGross)}</td>
                  <td className="px-4 py-3 text-right text-xs" style={{ color: '#D97706' }}>{fmt(pr.cnpsEmployee)}</td>
                  <td className="px-4 py-3 text-right text-xs" style={{ color: '#D97706' }}>{fmt(pr.is)}</td>
                  <td className="px-4 py-3 text-right text-xs" style={{ color: '#DC2626' }}>{fmt(pr.totalRetenues)}</td>
                  <td className="px-4 py-3 text-right text-xs font-bold" style={{ color: '#0B7439' }}>{fmt(pr.netAPayer)}</td>
                  <td className="px-4 py-3 text-center">{statusBadge(s.status)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => setShowDetail(s)} className="p-1.5 rounded-lg hover:bg-blue-50 transition-colors" title="Voir">
                        <Eye className="w-3.5 h-3.5" style={{ color: '#1D6FA4' }} />
                      </button>
                      <button onClick={() => setPrintSlip(enrichSlip(s))} className="p-1.5 rounded-lg hover:bg-green-50 transition-colors" title="Imprimer bulletin">
                        <Printer className="w-3.5 h-3.5" style={{ color: '#0B7439' }} />
                      </button>
                      {s.status === 'draft' && (
                        <button onClick={() => validateSlip(s.id)} className="p-1.5 rounded-lg hover:bg-green-50 transition-colors" title="Valider">
                          <Check className="w-3.5 h-3.5" style={{ color: '#0B7439' }} />
                        </button>
                      )}
                      {s.status === 'validated' && (
                        <button onClick={() => markPaid(s.id)} className="p-1.5 rounded-lg hover:bg-green-50 transition-colors" title="Marquer paye">
                          <Check className="w-3.5 h-3.5" style={{ color: '#059669' }} />
                        </button>
                      )}
                      {s.status === 'draft' && (
                        <button onClick={() => deleteSlip(s.id)} className="p-1.5 rounded-lg hover:bg-red-50 transition-colors" title="Supprimer">
                          <Trash2 className="w-3.5 h-3.5" style={{ color: '#DC2626' }} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Generate modal */}
      {showGenerate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Generer les bulletins</h3>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Periode : {MONTHS[monthFilter - 1]} {yearFilter}
            </p>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Societe (optionnel)</label>
              <select value={genCompany} onChange={e => setGenCompany(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                <option value="">Toutes les societes</option>
                {renderCompanyOptions()}
              </select>
            </div>
            <div className="rounded-lg p-3 text-xs" style={{ backgroundColor: '#D4EDDA', color: '#0B7439' }}>
              Seuls les bulletins deja existants pour cette periode seront exclus. Les employes suspendus restent inclus dans la generation.
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowGenerate(false)} className="flex-1 py-2.5 rounded-xl font-medium"
                style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>Annuler</button>
              <button onClick={generateBulletins} disabled={generating}
                className="flex-1 py-2.5 rounded-xl font-bold text-white disabled:opacity-50"
                style={{ backgroundColor: '#0B7439' }}>
                {generating ? 'Generation...' : 'Generer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {showDetail && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 space-y-4 my-8">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Bulletin de paie</h3>
              {statusBadge(showDetail.status)}
            </div>
            <div className="rounded-xl p-4 space-y-1" style={{ backgroundColor: 'var(--bg-subtle)' }}>
              <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{showDetail.employee_name}</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Matricule: {showDetail.employee_matricule ?? '-'} | Poste: {showDetail.employee_role ?? '-'}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Societe: {showDetail.company?.name ?? '-'} | CNPS: {showDetail.employee_cnps ?? '-'}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Nationalite: {showDetail.employee_nationality ?? 'Non renseignee'}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Date entree: {detailSlip!.employee_hire_date ? new Date(detailSlip!.employee_hire_date).toLocaleDateString('fr-FR') : 'Non renseignee'}
                {' | '}Anciennete: {seniorityLabel(detailSlip!.employee_hire_date, showDetail.period_year, showDetail.period_month)}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Periode: {MONTHS[showDetail.period_month - 1]} {showDetail.period_year}
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#0B7439' }}>Gains</p>
              {[
                { label: 'Salaire de base', val: detailSlip!.base_salary },
                { label: 'Sursalaire', val: detailSlip!.sursalaire },
                { label: 'Primes', val: detailSlip!.primes },
                { label: 'Indemnites', val: detailSlip!.indemnites },
                { label: 'Avantages', val: detailSlip!.avantages },
                { label: 'Transport', val: detailSlip!.transport_allowance },
              ].filter(r => Number(r.val) > 0 || r.label === 'Salaire de base').map(r => (
                <div key={r.label} className="flex justify-between text-sm">
                  <span style={{ color: 'var(--text-secondary)' }}>{r.label}</span>
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{fmt(Number(r.val))} F</span>
                </div>
              ))}
              <div className="flex justify-between text-sm font-bold pt-1 border-t" style={{ borderColor: 'var(--border)' }}>
                <span>Salaire brut imposable</span>
                <span style={{ color: '#0B7439' }}>{fmt(detailPr!.taxableGross)} F</span>
              </div>
              {detailPr!.primesNonImposables > 0 && (
                <div className="flex justify-between text-sm">
                  <span style={{ color: 'var(--text-secondary)' }}>Primes non imposables</span>
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{fmt(detailPr!.primesNonImposables)} F</span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#DC2626' }}>Retenues legales</p>
              {[
                { label: 'Impôt sur Salaires (IS)', val: detailPr!.is },
                { label: 'Contribution Nationale (CN)', val: detailPr!.cn },
                { label: 'Impôt Général sur Revenu (IGR)', val: detailPr!.igr },
                { label: 'CNPS retraite (6,3%)', val: detailPr!.cnpsEmployee },
                { label: 'CMU', val: detailPr!.cmuEmployee },
              ].filter(r => Number(r.val) > 0).map(r => (
                <div key={r.label} className="flex justify-between text-sm">
                  <span style={{ color: 'var(--text-secondary)' }}>{r.label}</span>
                  <span className="font-medium" style={{ color: '#DC2626' }}>-{fmt(Number(r.val))} F</span>
                </div>
              ))}
            </div>

            {((detailSlip!.deduction_details ?? []).length > 0 || Number(detailSlip!.retenues) > 0 || Number(detailSlip!.loan_deductions) > 0) && (
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#D97706' }}>Retenues / Emprunts / Avances</p>
                {(detailSlip!.deduction_details ?? []).length > 0 ? (
                  (detailSlip!.deduction_details ?? []).map((d, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span style={{ color: 'var(--text-secondary)' }}>{d.label}</span>
                      <span className="font-medium" style={{ color: '#D97706' }}>-{fmt(d.amount)} F</span>
                    </div>
                  ))
                ) : (
                  <>
                    {Number(detailSlip!.retenues) > 0 && (
                      <div className="flex justify-between text-sm">
                        <span style={{ color: 'var(--text-secondary)' }}>Retenues diverses</span>
                        <span className="font-medium" style={{ color: '#D97706' }}>-{fmt(Number(detailSlip!.retenues))} F</span>
                      </div>
                    )}
                    {Number(detailSlip!.loan_deductions) > 0 && (
                      <div className="flex justify-between text-sm">
                        <span style={{ color: 'var(--text-secondary)' }}>Remboursements emprunts/avances</span>
                        <span className="font-medium" style={{ color: '#D97706' }}>-{fmt(Number(detailSlip!.loan_deductions))} F</span>
                      </div>
                    )}
                  </>
                )}
                <div className="flex justify-between text-xs font-semibold pt-1 border-t" style={{ borderColor: 'var(--border)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Total retenues/emprunts</span>
                  <span style={{ color: '#D97706' }}>-{fmt(Number(detailSlip!.retenues) + Number(detailSlip!.loan_deductions))} F</span>
                </div>
              </div>
            )}

            <div className="flex justify-between text-lg font-bold pt-2 border-t-2" style={{ borderColor: '#0B7439' }}>
              <span style={{ color: 'var(--text-primary)' }}>Net a payer</span>
              <span style={{ color: '#0B7439' }}>{fmt(detailPr!.netAPayer)} F</span>
            </div>

            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Charges patronales : {fmt(detailPr!.totalChargesPatronales)} F
            </div>

            <div className="flex gap-3">
              <button onClick={() => setShowDetail(null)} className="flex-1 py-2.5 rounded-xl font-medium"
                style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>Fermer</button>
              <button onClick={() => { setPrintSlip(detailSlip); setShowDetail(null) }}
                className="flex-1 py-2.5 rounded-xl font-bold text-white flex items-center justify-center gap-2"
                style={{ backgroundColor: '#0B7439' }}>
                <Printer className="w-4 h-4" />Imprimer Bulletin
              </button>
            </div>
          </div>
        </div>
      )}

      {printSlip && <BulletinPrint slip={printSlip} onClose={() => setPrintSlip(null)} />}
    </div>
  )
}
