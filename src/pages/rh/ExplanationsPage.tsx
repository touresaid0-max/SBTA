import { useState, useEffect, useCallback } from 'react'
import { MessageSquareWarning, Plus, Search, Download, X, Eye } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/services/supabase'
import { fetchEmployees } from '@/services/hr.service'
import type { ExplanationRequest, Employee } from '@/types/hr.types'

const STATUS_MAP: Record<string, { bg: string; color: string; label: string }> = {
  en_attente: { bg: '#FEF3C7', color: '#D97706', label: 'En attente' },
  repondu: { bg: '#DBEAFE', color: '#1D6FA4', label: 'Repondu' },
  sanction_appliquee: { bg: '#FEE2E2', color: '#DC2626', label: 'Sanction' },
  classe: { bg: '#F3F4F6', color: '#6B7280', label: 'Classe' },
}

interface CompanyOption { id: string; name: string; code: string }

export default function ExplanationsPage() {
  const [requests, setRequests] = useState<ExplanationRequest[]>([])
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [showDetail, setShowDetail] = useState<ExplanationRequest | null>(null)
  const [empSearch, setEmpSearch] = useState('')
  const [empOpen, setEmpOpen] = useState(false)
  const [form, setForm] = useState({
    employee_id: '', motif: '', description: '',
    proposed_sanction: '', responsible_name: '',
    request_date: new Date().toISOString().slice(0, 10),
  })

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [reqRes, compsRes, empsData] = await Promise.all([
        supabase.from('explanation_requests')
          .select('*, company:companies(id, name, code)')
          .order('request_date', { ascending: false }),
        supabase.from('companies').select('id, name, code').order('name'),
        fetchEmployees({ company_id: null, station_id: null, role: null, contract_type: null, contract_nature: null, status: null, search: '' }),
      ])
      if (reqRes.data) setRequests(reqRes.data as ExplanationRequest[])
      if (compsRes.data) setCompanies(compsRes.data as CompanyOption[])
      setEmployees(empsData)
    } catch { toast.error('Erreur de chargement') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const filtered = requests.filter(r => {
    if (statusFilter && r.status !== statusFilter) return false
    if (companyFilter && r.company_id !== companyFilter) return false
    if (search && !r.employee_name.toLowerCase().includes(search.toLowerCase()) && !r.motif.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const empAlertCounts: Record<string, number> = {}
  for (const r of requests) {
    empAlertCounts[r.employee_id] = (empAlertCounts[r.employee_id] ?? 0) + 1
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

  const getAlertColor = (count: number) => {
    if (count >= 3) return { bg: '#FEE2E2', color: '#DC2626' }
    if (count >= 1) return { bg: '#FEF3C7', color: '#D97706' }
    return { bg: '#D4EDDA', color: '#0B7439' }
  }

  const saveRequest = async () => {
    if (!form.employee_id || !form.motif) { toast.error('Employe et motif requis'); return }
    const emp = employees.find(e => e.id === form.employee_id)
    if (!emp) return

    const { error } = await supabase.from('explanation_requests').insert({
      employee_id: emp.id,
      employee_source: emp.source_table ?? 'employees',
      company_id: emp.company_id,
      employee_name: emp.full_name,
      request_date: form.request_date,
      motif: form.motif,
      description: form.description || null,
      proposed_sanction: form.proposed_sanction || null,
      responsible_name: form.responsible_name || null,
      status: 'en_attente',
    })
    if (error) { toast.error(error.message); return }
    toast.success('Demande enregistree')
    setShowForm(false)
    loadData()
  }

  const updateStatus = async (id: string, status: string, appliedSanction?: string) => {
    const payload: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
    if (appliedSanction) payload.applied_sanction = appliedSanction
    if (status === 'repondu') payload.response_date = new Date().toISOString().slice(0, 10)
    const { error } = await supabase.from('explanation_requests').update(payload).eq('id', id)
    if (error) { toast.error(error.message); return }
    toast.success('Statut mis a jour')
    loadData()
    setShowDetail(null)
  }

  const exportCSV = () => {
    const headers = ['Employe', 'Societe', 'Date', 'Motif', 'Sanction proposee', 'Sanction appliquee', 'Statut']
    const rows = filtered.map(r => [
      r.employee_name, r.company?.name ?? '', r.request_date, r.motif,
      r.proposed_sanction ?? '', r.applied_sanction ?? '', r.status,
    ])
    const content = [headers, ...rows].map(r => r.join(';')).join('\n')
    const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `demandes_explication_${new Date().toISOString().slice(0, 10)}.csv`
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
            <MessageSquareWarning className="w-5 h-5" style={{ color: '#D97706' }} />
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Demandes d'explication</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Suivi disciplinaire des employes</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium"
            style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            <Download className="w-3.5 h-3.5" />CSV
          </button>
          <button onClick={() => { setForm({ employee_id: '', motif: '', description: '', proposed_sanction: '', responsible_name: '', request_date: new Date().toISOString().slice(0, 10) }); setEmpSearch(''); setEmpOpen(false); setShowForm(true) }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ backgroundColor: '#0B7439' }}>
            <Plus className="w-4 h-4" />Nouvelle demande
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Total demandes</p>
          <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{filtered.length}</p>
        </div>
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>En attente</p>
          <p className="text-lg font-bold" style={{ color: '#D97706' }}>{filtered.filter(r => r.status === 'en_attente').length}</p>
        </div>
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Sanctions appliquees</p>
          <p className="text-lg font-bold" style={{ color: '#DC2626' }}>{filtered.filter(r => r.status === 'sanction_appliquee').length}</p>
        </div>
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Employes en alerte (3+)</p>
          <p className="text-lg font-bold" style={{ color: '#DC2626' }}>
            {Object.values(empAlertCounts).filter(c => c >= 3).length}
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher par nom ou motif..."
            className="w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-green-500"
            style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
          <option value="">Tous statuts</option>
          {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={companyFilter} onChange={e => setCompanyFilter(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
          <option value="">Toutes societes</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                <th className="text-center px-3 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Alerte</th>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Employe</th>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Societe</th>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Date</th>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Motif</th>
                <th className="text-center px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Statut</th>
                <th className="text-center px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Aucune demande</td></tr>
              ) : filtered.map(r => {
                const cnt = empAlertCounts[r.employee_id] ?? 0
                const ac = getAlertColor(cnt)
                const sm = STATUS_MAP[r.status] ?? STATUS_MAP.en_attente
                return (
                  <tr key={r.id} className="border-t hover:bg-gray-50/50 transition-colors" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-3 py-3 text-center">
                      <span className="w-7 h-7 rounded-full text-xs font-bold inline-flex items-center justify-center"
                        style={{ backgroundColor: ac.bg, color: ac.color }}>{cnt}</span>
                    </td>
                    <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{r.employee_name}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{r.company?.code ?? '-'}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-primary)' }}>{new Date(r.request_date).toLocaleDateString('fr-FR')}</td>
                    <td className="px-4 py-3 text-xs truncate max-w-[200px]" style={{ color: 'var(--text-secondary)' }}>{r.motif}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold" style={{ backgroundColor: sm.bg, color: sm.color }}>{sm.label}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => setShowDetail(r)} className="p-1.5 rounded-lg hover:bg-blue-50 transition-colors">
                        <Eye className="w-3.5 h-3.5" style={{ color: '#1D6FA4' }} />
                      </button>
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
              <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Nouvelle demande d'explication</h3>
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
                  <input value={empSearch} onChange={e => { setEmpSearch(e.target.value); setEmpOpen(true) }}
                    onFocus={() => setEmpOpen(true)} onBlur={() => setTimeout(() => setEmpOpen(false), 150)}
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
                  ) : empMatches.map(e => {
                    const cnt = empAlertCounts[e.id] ?? 0
                    return (
                      <button key={e.id} type="button"
                        onMouseDown={() => { setForm(f => ({ ...f, employee_id: e.id })); setEmpOpen(false) }}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors flex items-center justify-between gap-2"
                        style={{ borderBottom: '1px solid var(--border)' }}>
                        <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{e.full_name}</span>
                        <span className="flex items-center gap-2 whitespace-nowrap">
                          {cnt > 0 && (
                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                              style={{ backgroundColor: getAlertColor(cnt).bg, color: getAlertColor(cnt).color }}>
                              {cnt} demande{cnt > 1 ? 's' : ''}
                            </span>
                          )}
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {e.employee_id ?? ''} {e.company_code ? `· ${e.company_code}` : ''}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Date *</label>
                <input type="date" value={form.request_date} onChange={e => setForm(f => ({ ...f, request_date: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Responsable</label>
                <input value={form.responsible_name} onChange={e => setForm(f => ({ ...f, responsible_name: e.target.value }))} placeholder="Nom du responsable"
                  className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Motif *</label>
              <input value={form.motif} onChange={e => setForm(f => ({ ...f, motif: e.target.value }))} placeholder="Motif de la demande"
                className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Description detaillee</label>
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3}
                className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Sanction proposee</label>
              <input value={form.proposed_sanction} onChange={e => setForm(f => ({ ...f, proposed_sanction: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 rounded-xl font-medium"
                style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>Annuler</button>
              <button onClick={saveRequest} className="flex-1 py-2.5 rounded-xl font-bold text-white" style={{ backgroundColor: '#0B7439' }}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {showDetail && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 space-y-4 my-8">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Detail de la demande</h3>
              <button onClick={() => setShowDetail(null)}><X className="w-5 h-5" style={{ color: 'var(--text-muted)' }} /></button>
            </div>
            <div className="rounded-xl p-4 space-y-2" style={{ backgroundColor: 'var(--bg-subtle)' }}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{showDetail.employee_name}</p>
                {(() => {
                  const cnt = empAlertCounts[showDetail.employee_id] ?? 0
                  const ac = getAlertColor(cnt)
                  return <span className="px-2 py-0.5 rounded-full text-xs font-bold" style={{ backgroundColor: ac.bg, color: ac.color }}>{cnt} demande{cnt > 1 ? 's' : ''}</span>
                })()}
              </div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {showDetail.company?.name ?? '-'} | {new Date(showDetail.request_date).toLocaleDateString('fr-FR')}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Motif</p>
              <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{showDetail.motif}</p>
            </div>
            {showDetail.description && (
              <div>
                <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Description</p>
                <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{showDetail.description}</p>
              </div>
            )}
            {showDetail.proposed_sanction && (
              <div>
                <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Sanction proposee</p>
                <p className="text-sm" style={{ color: '#D97706' }}>{showDetail.proposed_sanction}</p>
              </div>
            )}
            {showDetail.applied_sanction && (
              <div>
                <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Sanction appliquee</p>
                <p className="text-sm font-bold" style={{ color: '#DC2626' }}>{showDetail.applied_sanction}</p>
              </div>
            )}
            {showDetail.responsible_name && (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Responsable: {showDetail.responsible_name}</p>
            )}
            <div className="flex gap-2 flex-wrap">
              {showDetail.status === 'en_attente' && (
                <button onClick={() => updateStatus(showDetail.id, 'repondu')}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium" style={{ backgroundColor: '#DBEAFE', color: '#1D6FA4' }}>
                  Marquer repondu
                </button>
              )}
              {(showDetail.status === 'en_attente' || showDetail.status === 'repondu') && (
                <button onClick={() => {
                  const sanction = prompt('Sanction appliquee :')
                  if (sanction) updateStatus(showDetail.id, 'sanction_appliquee', sanction)
                }}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium" style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>
                  Appliquer sanction
                </button>
              )}
              {showDetail.status !== 'classe' && (
                <button onClick={() => updateStatus(showDetail.id, 'classe')}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium" style={{ backgroundColor: '#F3F4F6', color: '#6B7280' }}>
                  Classer
                </button>
              )}
            </div>
            <button onClick={() => setShowDetail(null)} className="w-full py-2.5 rounded-xl font-medium"
              style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>Fermer</button>
          </div>
        </div>
      )}
    </div>
  )
}
