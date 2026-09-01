import { useState, useEffect, useCallback } from 'react'
import { Wallet, Plus, Search, Filter, Download, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/services/supabase'
import { fetchEmployees } from '@/services/hr.service'
import { resolveCompanyIds } from '@/utils/companyGroups'
import { CompanyGroupSelect } from '@/components/shared/CompanyGroupSelect'
import type { EmployeeLoan, Employee } from '@/types/hr.types'

const fmt = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n))

const LOAN_TYPES: Record<string, string> = { emprunt: 'Emprunt social', avance: 'Avance', acompte: 'Acompte' }
const STATUS_MAP: Record<string, { bg: string; color: string; label: string }> = {
  en_cours: { bg: '#DBEAFE', color: '#1D6FA4', label: 'En cours' },
  solde: { bg: '#D4EDDA', color: '#0B7439', label: 'Solde' },
  annule: { bg: '#F3F4F6', color: '#6B7280', label: 'Annule' },
}

interface CompanyOption { id: string; name: string; code: string; parent_id?: string | null; is_group?: boolean }

export default function LoansPage() {
  const [loans, setLoans] = useState<EmployeeLoan[]>([])
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [empSearch, setEmpSearch] = useState('')
  const [empOpen, setEmpOpen] = useState(false)

  const [form, setForm] = useState({
    employee_id: '', employee_source: 'employees' as const, loan_type: 'avance' as const,
    amount_granted: '', installment_count: '1', request_date: new Date().toISOString().slice(0, 10),
    repayment_start: '', notes: '',
  })

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [loansRes, compsRes, empsData] = await Promise.all([
        supabase.from('employee_loans')
          .select('*, company:companies(id, name, code)')
          .order('created_at', { ascending: false }),
        supabase.from('companies').select('id, name, code, parent_id, is_group').order('name'),
        fetchEmployees({ company_id: null, station_id: null, role: null, contract_type: null, contract_nature: null, status: null, search: '' }),
      ])
      if (loansRes.data) setLoans(loansRes.data as EmployeeLoan[])
      if (compsRes.data) setCompanies(compsRes.data as CompanyOption[])
      setEmployees(empsData)
    } catch { toast.error('Erreur de chargement') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const filtered = loans.filter(l => {
    if (typeFilter && l.loan_type !== typeFilter) return false
    if (statusFilter && l.status !== statusFilter) return false
    if (companyFilter) {
      const matchIds = resolveCompanyIds(companyFilter, companies)
      if (!matchIds.includes(l.company_id)) return false
    }
    if (search) {
      const q = search.toLowerCase()
      if (!l.employee_name.toLowerCase().includes(q)) return false
    }
    return true
  })

  const totalActive = filtered.filter(l => l.status === 'en_cours').reduce((s, l) => s + Number(l.remaining_balance), 0)

  const openNew = () => {
    setEditId(null)
    setForm({
      employee_id: '', employee_source: 'employees', loan_type: 'avance',
      amount_granted: '', installment_count: '1', request_date: new Date().toISOString().slice(0, 10),
      repayment_start: '', notes: '',
    })
    setEmpSearch('')
    setEmpOpen(false)
    setShowForm(true)
  }

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

  const saveLoan = async () => {
    if (!form.employee_id || !form.amount_granted) { toast.error('Employe et montant requis'); return }
    const emp = employees.find(e => e.id === form.employee_id)
    if (!emp) { toast.error('Employe introuvable'); return }

    const amount = parseFloat(form.amount_granted)
    const count = parseInt(form.installment_count) || 1
    const installment = Math.ceil(amount / count)

    const payload = {
      employee_id: emp.id,
      employee_source: emp.source_table ?? 'employees',
      company_id: emp.company_id,
      employee_name: emp.full_name,
      loan_type: form.loan_type,
      amount_granted: amount,
      request_date: form.request_date,
      installment_count: count,
      installment_amount: installment,
      repayment_start: form.repayment_start || null,
      remaining_balance: amount,
      status: 'en_cours',
      notes: form.notes || null,
      updated_at: new Date().toISOString(),
    }

    if (editId) {
      const { error } = await supabase.from('employee_loans').update(payload).eq('id', editId)
      if (error) { toast.error(error.message); return }
      toast.success('Emprunt mis a jour')
    } else {
      const { error } = await supabase.from('employee_loans').insert(payload)
      if (error) { toast.error(error.message); return }
      toast.success('Emprunt cree')
    }
    setShowForm(false)
    loadData()
  }

  const markSolde = async (id: string) => {
    const { error } = await supabase.from('employee_loans').update({
      status: 'solde', remaining_balance: 0, updated_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) { toast.error(error.message); return }
    toast.success('Emprunt solde')
    loadData()
  }

  const cancelLoan = async (id: string) => {
    if (!confirm('Annuler cet emprunt ?')) return
    const { error } = await supabase.from('employee_loans').update({
      status: 'annule', updated_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) { toast.error(error.message); return }
    toast.success('Emprunt annule')
    loadData()
  }

  const exportCSV = () => {
    const headers = ['Employe', 'Societe', 'Type', 'Montant', 'Echeances', 'Mensualite', 'Solde restant', 'Statut', 'Date demande']
    const rows = filtered.map(l => [
      l.employee_name, l.company?.name ?? '', LOAN_TYPES[l.loan_type],
      String(l.amount_granted), String(l.installment_count), String(l.installment_amount),
      String(l.remaining_balance), l.status, l.request_date,
    ])
    const content = [headers, ...rows].map(r => r.join(';')).join('\n')
    const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `emprunts_avances_${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  if (loading) {
    return <div className="flex items-center justify-center h-[60vh]"><div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#1D6FA415' }}>
            <Wallet className="w-5 h-5" style={{ color: '#1D6FA4' }} />
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Emprunts, Avances & Acomptes</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Gestion des emprunts sociaux et avances sur salaire</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium"
            style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            <Download className="w-3.5 h-3.5" />CSV
          </button>
          <button onClick={openNew} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ backgroundColor: '#0B7439' }}>
            <Plus className="w-4 h-4" />Nouvel emprunt
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total emprunts', value: filtered.length, color: '#1D6FA4' },
          { label: 'En cours', value: filtered.filter(l => l.status === 'en_cours').length, color: '#D97706' },
          { label: 'Solde restant', value: `${fmt(totalActive)} F`, color: '#DC2626' },
          { label: 'Soldes', value: filtered.filter(l => l.status === 'solde').length, color: '#0B7439' },
        ].map(k => (
          <div key={k.label} className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{k.label}</p>
            <p className="text-lg font-bold" style={{ color: k.color }}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher par nom..."
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
        <div className="grid grid-cols-3 gap-3 rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Type</label>
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
              className="w-full px-2 py-1.5 rounded-lg text-xs" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
              <option value="">Tous</option>
              {Object.entries(LOAN_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Statut</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="w-full px-2 py-1.5 rounded-lg text-xs" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
              <option value="">Tous</option>
              {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Societe</label>
            <CompanyGroupSelect
              companies={companies}
              value={companyFilter}
              onChange={setCompanyFilter}
              placeholder="Toutes"
              className="w-full px-2 py-1.5 rounded-lg text-xs"
              style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            />
          </div>
        </div>
      )}

      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Employe</th>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Societe</th>
                <th className="text-right px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Montant</th>
                <th className="text-right px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Echeances</th>
                <th className="text-right px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Mensualite</th>
                <th className="text-right px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Restant</th>
                <th className="text-center px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Statut</th>
                <th className="text-center px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Aucun emprunt</td></tr>
              ) : filtered.map(l => {
                const sm = STATUS_MAP[l.status] ?? STATUS_MAP.en_cours
                return (
                  <tr key={l.id} className="border-t hover:bg-gray-50/50 transition-colors" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{l.employee_name}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{LOAN_TYPES[l.loan_type]}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{l.company?.code ?? '-'}</td>
                    <td className="px-4 py-3 text-right text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{fmt(Number(l.amount_granted))} F</td>
                    <td className="px-4 py-3 text-right text-xs" style={{ color: 'var(--text-secondary)' }}>{l.installment_count}</td>
                    <td className="px-4 py-3 text-right text-xs" style={{ color: 'var(--text-secondary)' }}>{fmt(Number(l.installment_amount))} F</td>
                    <td className="px-4 py-3 text-right text-xs font-bold" style={{ color: Number(l.remaining_balance) > 0 ? '#DC2626' : '#0B7439' }}>
                      {fmt(Number(l.remaining_balance))} F
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold" style={{ backgroundColor: sm.bg, color: sm.color }}>{sm.label}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        {l.status === 'en_cours' && (
                          <>
                            <button onClick={() => markSolde(l.id)} className="text-xs px-2 py-1 rounded-lg font-medium"
                              style={{ backgroundColor: '#D4EDDA', color: '#0B7439' }}>Solder</button>
                            <button onClick={() => cancelLoan(l.id)} className="text-xs px-2 py-1 rounded-lg font-medium"
                              style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>Annuler</button>
                          </>
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

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                {editId ? 'Modifier' : 'Nouvel emprunt / avance'}
              </h3>
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
                <select value={form.loan_type} onChange={e => setForm(f => ({ ...f, loan_type: e.target.value as any }))}
                  className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                  {Object.entries(LOAN_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Montant accorde *</label>
                <input type="number" value={form.amount_granted} onChange={e => setForm(f => ({ ...f, amount_granted: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Nb echeances</label>
                <input type="number" min="1" value={form.installment_count} onChange={e => setForm(f => ({ ...f, installment_count: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Date demande</label>
                <input type="date" value={form.request_date} onChange={e => setForm(f => ({ ...f, request_date: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Debut remboursement</label>
              <input type="date" value={form.repayment_start} onChange={e => setForm(f => ({ ...f, repayment_start: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Notes</label>
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
                className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            </div>

            {form.amount_granted && form.installment_count && (
              <div className="rounded-lg p-3 text-sm" style={{ backgroundColor: '#DBEAFE', color: '#1D6FA4' }}>
                Mensualite : {fmt(Math.ceil(parseFloat(form.amount_granted) / (parseInt(form.installment_count) || 1)))} F
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 rounded-xl font-medium"
                style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>Annuler</button>
              <button onClick={saveLoan} className="flex-1 py-2.5 rounded-xl font-bold text-white"
                style={{ backgroundColor: '#0B7439' }}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
