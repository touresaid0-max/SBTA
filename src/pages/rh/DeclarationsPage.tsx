import { useState, useEffect, useCallback } from 'react'
import { FileCheck, Download, Building2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/services/supabase'
import { resolveCompanyIds } from '@/utils/companyGroups'
import { CompanyGroupSelect } from '@/components/shared/CompanyGroupSelect'
import type { PaySlip } from '@/types/hr.types'

const fmt = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n))
const MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']

interface CompanyOption { id: string; name: string; code: string; parent_id?: string | null; is_group?: boolean }

type DeclarationType = 'cnps_monthly' | 'disa_annual' | 'dis_individual'
const DECL_TABS: { key: DeclarationType; label: string }[] = [
  { key: 'cnps_monthly', label: 'CNPS Mensuelle' },
  { key: 'disa_annual', label: 'DISA Annuelle' },
  { key: 'dis_individual', label: 'Individuelle' },
]

export default function DeclarationsPage() {
  const [slips, setSlips] = useState<PaySlip[]>([])
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<DeclarationType>('cnps_monthly')
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear())
  const [monthFilter, setMonthFilter] = useState(new Date().getMonth() + 1)
  const [companyFilter, setCompanyFilter] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      let query = supabase.from('pay_slips')
        .select('*, company:companies(id, name, code)')
        .eq('period_year', yearFilter)
        .order('employee_name')

      if (tab !== 'disa_annual') query = query.eq('period_month', monthFilter)

      const [slipsRes, compsRes] = await Promise.all([
        query,
        supabase.from('companies').select('id, name, code, parent_id, is_group').order('name'),
      ])
      if (slipsRes.data) setSlips(slipsRes.data as PaySlip[])
      if (compsRes.data) setCompanies(compsRes.data as CompanyOption[])
    } catch { toast.error('Erreur de chargement') }
    finally { setLoading(false) }
  }, [yearFilter, monthFilter, tab])

  useEffect(() => { loadData() }, [loadData])

  const filtered = slips.filter(s => {
    if (companyFilter) {
      const matchIds = resolveCompanyIds(companyFilter, companies)
      if (!matchIds.includes(s.company_id)) return false
    }
    return true
  })

  const totals = filtered.reduce((acc, s) => ({
    gross: acc.gross + Number(s.gross_salary),
    cnpsEmp: acc.cnpsEmp + Number(s.cnps_employee),
    cnpsEmpl: acc.cnpsEmpl + Number(s.cnps_employer),
    its: acc.its + Number(s.its),
    net: acc.net + Number(s.net_salary),
    base: acc.base + Number(s.base_salary),
  }), { gross: 0, cnpsEmp: 0, cnpsEmpl: 0, its: 0, net: 0, base: 0 })

  const byCompany = filtered.reduce<Record<string, { name: string; code: string; count: number; gross: number; cnpsEmp: number; cnpsEmpl: number; its: number }>>((acc, s) => {
    const key = s.company_id ?? 'none'
    if (!acc[key]) acc[key] = { name: s.company?.name ?? '-', code: s.company?.code ?? '-', count: 0, gross: 0, cnpsEmp: 0, cnpsEmpl: 0, its: 0 }
    acc[key].count++
    acc[key].gross += Number(s.gross_salary)
    acc[key].cnpsEmp += Number(s.cnps_employee)
    acc[key].cnpsEmpl += Number(s.cnps_employer)
    acc[key].its += Number(s.its)
    return acc
  }, {})

  const exportCNPS = () => {
    const headers = ['Societe', 'Matricule', 'Nom', 'N CNPS', 'Salaire Brut', 'CNPS Employe (6.3%)', 'CNPS Employeur (15.65%)', 'Total CNPS']
    const rows = filtered.map(s => [
      s.company?.name ?? '', s.employee_matricule ?? '', s.employee_name, s.employee_cnps ?? '',
      String(s.gross_salary), String(s.cnps_employee), String(s.cnps_employer),
      String(Number(s.cnps_employee) + Number(s.cnps_employer)),
    ])
    const content = [headers, ...rows].map(r => r.join(';')).join('\n')
    const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const period = tab === 'disa_annual' ? `${yearFilter}` : `${yearFilter}_${String(monthFilter).padStart(2, '0')}`
    a.href = url; a.download = `declaration_${tab}_${period}.csv`
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
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#1D6FA415' }}>
            <FileCheck className="w-5 h-5" style={{ color: '#1D6FA4' }} />
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Declarations sociales</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>CNPS mensuelle, DISA annuelle, declarations individuelles</p>
          </div>
        </div>
        <button onClick={exportCNPS} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ backgroundColor: '#0B7439' }}>
          <Download className="w-4 h-4" />Exporter
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {DECL_TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{
              backgroundColor: tab === t.key ? '#0B7439' : 'var(--bg-subtle)',
              color: tab === t.key ? '#fff' : 'var(--text-secondary)',
              border: `1px solid ${tab === t.key ? '#0B7439' : 'var(--border)'}`,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Period filters */}
      <div className="flex flex-wrap gap-3">
        {tab !== 'disa_annual' && (
          <select value={monthFilter} onChange={e => setMonthFilter(Number(e.target.value))}
            className="px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        )}
        <select value={yearFilter} onChange={e => setYearFilter(Number(e.target.value))}
          className="px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
          {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <CompanyGroupSelect
          companies={companies}
          value={companyFilter}
          onChange={setCompanyFilter}
          placeholder="Toutes societes"
          className="px-3 py-2 rounded-lg text-sm"
          style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
        />
      </div>

      {/* Summary by company */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Employes declares</p>
          <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{filtered.length}</p>
        </div>
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Masse salariale brute</p>
          <p className="text-lg font-bold" style={{ color: '#0B7439' }}>{fmt(totals.gross)} F</p>
        </div>
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>CNPS total (emp+empl)</p>
          <p className="text-lg font-bold" style={{ color: '#1D6FA4' }}>{fmt(totals.cnpsEmp + totals.cnpsEmpl)} F</p>
        </div>
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>ITS total</p>
          <p className="text-lg font-bold" style={{ color: '#D97706' }}>{fmt(totals.its)} F</p>
        </div>
      </div>

      {/* Company breakdown */}
      {Object.keys(byCompany).length > 1 && (
        <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="px-4 py-3 flex items-center gap-2" style={{ backgroundColor: 'var(--bg-subtle)' }}>
            <Building2 className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Resume par societe</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                  <th className="text-left px-4 py-2 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Societe</th>
                  <th className="text-right px-4 py-2 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Effectif</th>
                  <th className="text-right px-4 py-2 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Brut</th>
                  <th className="text-right px-4 py-2 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>CNPS Emp.</th>
                  <th className="text-right px-4 py-2 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>CNPS Empl.</th>
                  <th className="text-right px-4 py-2 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>ITS</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(byCompany).map(c => (
                  <tr key={c.code} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-4 py-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{c.name} ({c.code})</td>
                    <td className="px-4 py-2 text-right text-xs">{c.count}</td>
                    <td className="px-4 py-2 text-right text-xs font-medium">{fmt(c.gross)} F</td>
                    <td className="px-4 py-2 text-right text-xs" style={{ color: '#1D6FA4' }}>{fmt(c.cnpsEmp)} F</td>
                    <td className="px-4 py-2 text-right text-xs" style={{ color: '#1D6FA4' }}>{fmt(c.cnpsEmpl)} F</td>
                    <td className="px-4 py-2 text-right text-xs" style={{ color: '#D97706' }}>{fmt(c.its)} F</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Individual detail table */}
      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="px-4 py-3" style={{ backgroundColor: 'var(--bg-subtle)' }}>
          <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
            {tab === 'cnps_monthly' && `Declaration CNPS — ${MONTHS[monthFilter - 1]} ${yearFilter}`}
            {tab === 'disa_annual' && `DISA — Annee ${yearFilter}`}
            {tab === 'dis_individual' && `Declarations individuelles — ${MONTHS[monthFilter - 1]} ${yearFilter}`}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Matricule</th>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Nom</th>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>CNPS</th>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Societe</th>
                <th className="text-right px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Brut</th>
                <th className="text-right px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>CNPS Emp.</th>
                <th className="text-right px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>CNPS Empl.</th>
                <th className="text-right px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>ITS</th>
                {tab === 'disa_annual' && <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Mois</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={tab === 'disa_annual' ? 9 : 8} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Aucune donnee</td></tr>
              ) : filtered.map(s => (
                <tr key={s.id} className="border-t hover:bg-gray-50/50 transition-colors" style={{ borderColor: 'var(--border)' }}>
                  <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>{s.employee_matricule ?? '-'}</td>
                  <td className="px-4 py-2.5 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{s.employee_name}</td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{s.employee_cnps ?? '-'}</td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{s.company?.code ?? '-'}</td>
                  <td className="px-4 py-2.5 text-right text-xs font-medium">{fmt(Number(s.gross_salary))}</td>
                  <td className="px-4 py-2.5 text-right text-xs" style={{ color: '#1D6FA4' }}>{fmt(Number(s.cnps_employee))}</td>
                  <td className="px-4 py-2.5 text-right text-xs" style={{ color: '#1D6FA4' }}>{fmt(Number(s.cnps_employer))}</td>
                  <td className="px-4 py-2.5 text-right text-xs" style={{ color: '#D97706' }}>{fmt(Number(s.its))}</td>
                  {tab === 'disa_annual' && (
                    <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>{MONTHS[s.period_month - 1]}</td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2" style={{ borderColor: '#0B7439', backgroundColor: 'var(--bg-subtle)' }}>
                <td colSpan={4} className="px-4 py-2.5 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>TOTAL</td>
                <td className="px-4 py-2.5 text-right text-sm font-bold" style={{ color: '#0B7439' }}>{fmt(totals.gross)}</td>
                <td className="px-4 py-2.5 text-right text-sm font-bold" style={{ color: '#1D6FA4' }}>{fmt(totals.cnpsEmp)}</td>
                <td className="px-4 py-2.5 text-right text-sm font-bold" style={{ color: '#1D6FA4' }}>{fmt(totals.cnpsEmpl)}</td>
                <td className="px-4 py-2.5 text-right text-sm font-bold" style={{ color: '#D97706' }}>{fmt(totals.its)}</td>
                {tab === 'disa_annual' && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}
