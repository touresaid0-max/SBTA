import { useState, useEffect, useCallback } from 'react'
import { MinusCircle, Plus, Search, Download, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/services/supabase'
import { fetchEmployees } from '@/services/hr.service'
import type { SalaryDeduction, Employee } from '@/types/hr.types'

const fmt = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n))
const MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']

const DEDUCTION_TYPES: Record<string, string> = {
  contravention: 'Contravention',
  emprunt: 'Remboursement emprunt',
  avance: 'Remboursement avance',
  acompte: 'Remboursement acompte',
  absence_non_justifiee: 'Absence non justifiee',
  sanction_financiere: 'Sanction financiere',
  autre: 'Autre retenue',
}

const STATUS_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  active: { bg: '#FEF3C7', color: '#D97706', label: 'Active' },
  applied: { bg: '#D4EDDA', color: '#0B7439', label: 'Appliquee' },
  cancelled: { bg: '#F3F4F6', color: '#6B7280', label: 'Annulee' },
}

interface CompanyOption { id: string; name: string; code: string }

export default function DeductionsPage() {
  const [deductions, setDeductions] = useState<SalaryDeduction[]>([])
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear())
  const [monthFilter, setMonthFilter] = useState(new Date().getMonth() + 1)
  const [showForm, setShowForm] = useState(false)
  const [empSearch, setEmpSearch] = useState('')
  const [empOpen, setEmpOpen] = useState(false)

  const [form, setForm] = useState({
    employee_id: '', deduction_type: 'autre' as const,
    amount: '', motif: '',
  })

  const selectedEmployee = employees.find(e => e.id === form.employee_id)
  const empMatches = (() => {
    const q = empSearch.trim().toLowerCase()
    if (!q) return employees.slice(0, 50)
    return employees.filter(e =>
      e.full_name.toLowerCase().includes(q) ||
      (e.employee_id ?? '').toLowerCase().includes(q) ||
      (e.company_code ?? '').toLowerCase().includes(q)
    ).slice(0, 50)
  })()

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [dedRes, compsRes, empsData] = await Promise.all([
        supabase.from('salary_deductions')
          .select('*, company:companies(id, name, code)')
          .eq('period_year', yearFilter)
          .eq('period_month', monthFilter)
          .order('created_at', { ascending: false }),
        supabase.from('companies').select('id, name, code').order('name'),
        fetchEmployees({ company_id: null, station_id: null, role: null, contract_type: null, contract_nature: null, status: null, search: '' }),
      ])
      if (dedRes.data) setDeductions(dedRes.data as SalaryDeduction[])
      if (compsRes.data) setCompanies(compsRes.data as CompanyOption[])
      setEmployees(empsData)
    } catch { toast.error('Erreur de chargement') }
    finally { setLoading(false) }
  }, [yearFilter, monthFilter])

  useEffect(() => { loadData() }, [loadData])

  const filtered = deductions.filter(d => {
    if (typeFilter && d.deduction_type !== typeFilter) return false
    if (search && !d.employee_name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const totalActive = filtered.filter(d => d.status === 'active').reduce((s, d) => s + Number(d.amount), 0)

  const saveDeduction = async () => {
    if (!form.employee_id || !form.amount) { toast.error('Employe et montant requis'); return }
    const emp = employees.find(e => e.id === form.employee_id)
    if (!emp) return

    const { error } = await supabase.from('salary_deductions').insert({
      employee_id: emp.id,
      employee_source: emp.source_table ?? 'employees',
      company_id: emp.company_id,
      employee_name: emp.full_name,
      deduction_type: form.deduction_type,
      period_year: yearFilter,
      period_month: monthFilter,
      amount: parseFloat(form.amount),
      motif: form.motif || null,
      status: 'active',
    })
    if (error) { toast.error(error.message); return }
    toast.success('Retenue ajoutee')
    setShowForm(false)
    loadData()
  }

  const cancelDeduction = async (id: string) => {
    const { error } = await supabase.from('salary_deductions').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', id)
    if (error) { toast.error(error.message); return }
    toast.success('Retenue annulee')
    loadData()
  }

  const exportCSV = () => {
    const headers = ['Employe', 'Societe', 'Type', 'Montant', 'Motif', 'Statut']
    const rows = filtered.map(d => [
      d.employee_name, d.company?.name ?? '', DEDUCTION_TYPES[d.deduction_type],
      String(d.amount), d.motif ?? '', d.status,
    ])
    const content = [headers, ...rows].map(r => r.join(';')).join('\n')
    const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `retenues_${yearFilter}_${String(monthFilter).padStart(2, '0')}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  if (loading) {
    return <div className="flex items-center justify-center h-[60vh]"><div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#DC262615' }}>
            <MinusCircle className="w-5 h-5" style={{ color: '#DC2626' }} />
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Retenues sur salaire</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{MONTHS[monthFilter - 1]} {yearFilter}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium"
            style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            <Download className="w-3.5 h-3.5" />CSV
          </button>
          <button onClick={() => { setForm({ employee_id: '', deduction_type: 'autre', amount: '', motif: '' }); setEmpSearch(''); setEmpOpen(false); setShowForm(true) }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ backgroundColor: '#0B7439' }}>
            <Plus className="w-4 h-4" />Nouvelle retenue
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Total retenues</p>
          <p className="text-lg font-bold" style={{ color: '#DC2626' }}>{fmt(totalActive)} F</p>
        </div>
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Nb retenues actives</p>
          <p className="text-lg font-bold" style={{ color: '#D97706' }}>{filtered.filter(d => d.status === 'active').length}</p>
        </div>
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Employes concernes</p>
          <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{new Set(filtered.map(d => d.employee_id)).size}</p>
        </div>
      </div>

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
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher..."
            className="w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-green-500"
            style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
          <option value="">Tous types</option>
          {Object.entries(DEDUCTION_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Employe</th>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Societe</th>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Type</th>
                <th className="text-right px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Montant</th>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Motif</th>
                <th className="text-center px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Statut</th>
                <th className="text-center px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Aucune retenue</td></tr>
              ) : filtered.map(d => {
                const sc = STATUS_COLORS[d.status] ?? STATUS_COLORS.active
                return (
                  <tr key={d.id} className="border-t hover:bg-gray-50/50 transition-colors" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{d.employee_name}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{d.company?.code ?? '-'}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{DEDUCTION_TYPES[d.deduction_type]}</td>
                    <td className="px-4 py-3 text-right text-xs font-bold" style={{ color: '#DC2626' }}>{fmt(Number(d.amount))} F</td>
                    <td className="px-4 py-3 text-xs truncate max-w-[200px]" style={{ color: 'var(--text-muted)' }}>{d.motif ?? '-'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold" style={{ backgroundColor: sc.bg, color: sc.color }}>{sc.label}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {d.status === 'active' && (
                        <button onClick={() => cancelDeduction(d.id)} className="text-xs px-2 py-1 rounded-lg font-medium"
                          style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>Annuler</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Nouvelle retenue</h3>
              <button onClick={() => setShowForm(false)}><X className="w-5 h-5" style={{ color: 'var(--text-muted)' }} /></button>
            </div>
            <div className="relative">
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Employe *</label>
              {selectedEmployee ? (
                <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm"
                  style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                  <span className="truncate font-medium">
                    {selectedEmployee.full_name}
                    <span className="ml-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {selectedEmployee.employee_id ?? ''} {selectedEmployee.company_code ? `· ${selectedEmployee.company_code}` : ''}
                    </span>
                  </span>
                  <button type="button" onClick={() => { setForm(f => ({ ...f, employee_id: '' })); setEmpSearch(''); setEmpOpen(true) }}>
                    <X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                  <input
                    value={empSearch}
                    onChange={e => { setEmpSearch(e.target.value); setEmpOpen(true) }}
                    onFocus={() => setEmpOpen(true)}
                    onBlur={() => setTimeout(() => setEmpOpen(false), 150)}
                    placeholder="Rechercher un employe (nom, matricule, societe)..."
                    className="w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-green-500"
                    style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
                </div>
              )}
              {empOpen && !selectedEmployee && (
                <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-lg shadow-lg"
                  style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
                  {empMatches.length === 0 ? (
                    <div className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>Aucun employe trouve</div>
                  ) : empMatches.map(e => (
                    <button key={e.id} type="button"
                      onMouseDown={() => { setForm(f => ({ ...f, employee_id: e.id })); setEmpOpen(false) }}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors flex items-center justify-between gap-2"
                      style={{ borderBottom: '1px solid var(--border)' }}>
                      <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{e.full_name}</span>
                      <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                        {e.employee_id ?? ''} {e.company_code ? `· ${e.company_code}` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Type *</label>
                <select value={form.deduction_type} onChange={e => setForm(f => ({ ...f, deduction_type: e.target.value as any }))}
                  className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                  {Object.entries(DEDUCTION_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Montant *</label>
                <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Motif</label>
              <textarea value={form.motif} onChange={e => setForm(f => ({ ...f, motif: e.target.value }))} rows={2}
                className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 rounded-xl font-medium"
                style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>Annuler</button>
              <button onClick={saveDeduction} className="flex-1 py-2.5 rounded-xl font-bold text-white" style={{ backgroundColor: '#0B7439' }}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
