import { useState, useEffect, useCallback } from 'react'
import { UserX, Plus, Search, Download, X, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/services/supabase'
import { fetchEmployees } from '@/services/hr.service'
import type { EmployeeSuspension, Employee } from '@/types/hr.types'

const SUSPENSION_TYPES: Record<string, string> = {
  absence_prolongee: 'Absence prolongee',
  suspension_disciplinaire: 'Suspension disciplinaire',
  depart: 'Depart',
  contrat_expire: 'Contrat expire',
  autre: 'Autre motif',
}

interface CompanyOption { id: string; name: string; code: string }

export default function SuspensionsPage() {
  const [suspensions, setSuspensions] = useState<EmployeeSuspension[]>([])
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeOnly, setActiveOnly] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [empSearch, setEmpSearch] = useState('')
  const [empOpen, setEmpOpen] = useState(false)
  const [form, setForm] = useState({
    employee_id: '', suspension_type: 'autre' as const,
    start_date: new Date().toISOString().slice(0, 10), end_date: '',
    motif: '', is_salary_suspended: true,
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
      let query = supabase.from('employee_suspensions')
        .select('*, company:companies(id, name, code)')
        .order('created_at', { ascending: false })
      if (activeOnly) query = query.eq('is_active', true)

      const [susRes, compsRes, empsData] = await Promise.all([
        query,
        supabase.from('companies').select('id, name, code').order('name'),
        fetchEmployees({ company_id: null, station_id: null, role: null, contract_type: null, contract_nature: null, status: null, search: '' }),
      ])
      if (susRes.data) setSuspensions(susRes.data as EmployeeSuspension[])
      if (compsRes.data) setCompanies(compsRes.data as CompanyOption[])
      setEmployees(empsData)
    } catch { toast.error('Erreur de chargement') }
    finally { setLoading(false) }
  }, [activeOnly])

  useEffect(() => { loadData() }, [loadData])

  const filtered = suspensions.filter(s => {
    if (search && !s.employee_name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const saveSuspension = async () => {
    if (!form.employee_id || !form.start_date) { toast.error('Employe et date requis'); return }
    const emp = employees.find(e => e.id === form.employee_id)
    if (!emp) return

    const { error } = await supabase.from('employee_suspensions').insert({
      employee_id: emp.id,
      employee_source: emp.source_table ?? 'employees',
      company_id: emp.company_id,
      employee_name: emp.full_name,
      suspension_type: form.suspension_type,
      start_date: form.start_date,
      end_date: form.end_date || null,
      motif: form.motif || null,
      is_salary_suspended: form.is_salary_suspended,
      is_active: true,
    })
    if (error) { toast.error(error.message); return }
    toast.success('Suspension enregistree')
    setShowForm(false)
    loadData()
  }

  const liftSuspension = async (id: string) => {
    if (!confirm('Lever cette suspension ?')) return
    const { error } = await supabase.from('employee_suspensions').update({
      is_active: false, lifted_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) { toast.error(error.message); return }
    toast.success('Suspension levee')
    loadData()
  }

  const exportCSV = () => {
    const headers = ['Employe', 'Societe', 'Type', 'Debut', 'Fin', 'Salaire suspendu', 'Motif', 'Actif']
    const rows = filtered.map(s => [
      s.employee_name, s.company?.name ?? '', SUSPENSION_TYPES[s.suspension_type],
      s.start_date, s.end_date ?? '-', s.is_salary_suspended ? 'Oui' : 'Non',
      s.motif ?? '', s.is_active ? 'Oui' : 'Non',
    ])
    const content = [headers, ...rows].map(r => r.join(';')).join('\n')
    const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `suspensions_${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  if (loading) {
    return <div className="flex items-center justify-center h-[60vh]"><div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#D9770615' }}>
            <UserX className="w-5 h-5" style={{ color: '#D97706' }} />
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Suspensions</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Employes et salaires a suspendre</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium"
            style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            <Download className="w-3.5 h-3.5" />CSV
          </button>
          <button onClick={() => { setForm({ employee_id: '', suspension_type: 'autre', start_date: new Date().toISOString().slice(0, 10), end_date: '', motif: '', is_salary_suspended: true }); setEmpSearch(''); setEmpOpen(false); setShowForm(true) }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ backgroundColor: '#0B7439' }}>
            <Plus className="w-4 h-4" />Nouvelle suspension
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Suspensions actives</p>
          <p className="text-lg font-bold" style={{ color: '#DC2626' }}>{filtered.filter(s => s.is_active).length}</p>
        </div>
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Salaires suspendus</p>
          <p className="text-lg font-bold" style={{ color: '#D97706' }}>{filtered.filter(s => s.is_active && s.is_salary_suspended).length}</p>
        </div>
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Total enregistrees</p>
          <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{filtered.length}</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher..."
            className="w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-green-500"
            style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
        </div>
        <label className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer"
          style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={activeOnly} onChange={e => setActiveOnly(e.target.checked)} className="rounded" />
          Actives uniquement
        </label>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Employe</th>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Societe</th>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Debut</th>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Fin</th>
                <th className="text-center px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Salaire</th>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Motif</th>
                <th className="text-center px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Aucune suspension</td></tr>
              ) : filtered.map(s => (
                <tr key={s.id} className={`border-t hover:bg-gray-50/50 transition-colors ${!s.is_active ? 'opacity-50' : ''}`} style={{ borderColor: 'var(--border)' }}>
                  <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{s.employee_name}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{s.company?.code ?? '-'}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{SUSPENSION_TYPES[s.suspension_type]}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-primary)' }}>{new Date(s.start_date).toLocaleDateString('fr-FR')}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>{s.end_date ? new Date(s.end_date).toLocaleDateString('fr-FR') : 'Indefini'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold"
                      style={{ backgroundColor: s.is_salary_suspended ? '#FEE2E2' : '#D4EDDA', color: s.is_salary_suspended ? '#DC2626' : '#0B7439' }}>
                      {s.is_salary_suspended ? 'Suspendu' : 'Maintenu'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs truncate max-w-[150px]" style={{ color: 'var(--text-muted)' }}>{s.motif ?? '-'}</td>
                  <td className="px-4 py-3 text-center">
                    {s.is_active && (
                      <button onClick={() => liftSuspension(s.id)} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg font-medium mx-auto"
                        style={{ backgroundColor: '#D4EDDA', color: '#0B7439' }}>
                        <Check className="w-3 h-3" />Lever
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Nouvelle suspension</h3>
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
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Type de suspension *</label>
              <select value={form.suspension_type} onChange={e => setForm(f => ({ ...f, suspension_type: e.target.value as any }))}
                className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                {Object.entries(SUSPENSION_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Date debut *</label>
                <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Date fin</label>
                <input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Motif</label>
              <textarea value={form.motif} onChange={e => setForm(f => ({ ...f, motif: e.target.value }))} rows={2}
                className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-primary)' }}>
              <input type="checkbox" checked={form.is_salary_suspended} onChange={e => setForm(f => ({ ...f, is_salary_suspended: e.target.checked }))} className="rounded" />
              Suspendre egalement le salaire
            </label>
            <div className="flex gap-3">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 rounded-xl font-medium"
                style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>Annuler</button>
              <button onClick={saveSuspension} className="flex-1 py-2.5 rounded-xl font-bold text-white" style={{ backgroundColor: '#0B7439' }}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
