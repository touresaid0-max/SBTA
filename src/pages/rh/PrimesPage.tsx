import { useState, useEffect, useCallback } from 'react'
import { Gift, Plus, Search, X, Power, Pencil } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/services/supabase'
import { fetchEmployees } from '@/services/hr.service'
import type { PrimeRubric, EmployeePrime, Employee, PrimePeriodicity, PrimeCalcType, PrimeBucket } from '@/types/hr.types'

const fmt = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n))
const MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']

const PERIODICITY_LABELS: Record<PrimePeriodicity, string> = {
  mensuelle: 'Mensuelle', ponctuelle: 'Ponctuelle', annuelle: 'Annuelle',
}
const BUCKET_LABELS: Record<PrimeBucket, string> = {
  sursalaire: 'Sursalaire', transport: 'Prime de transport', primes: 'Primes',
  indemnites: 'Indemnités', avantages: 'Avantages en nature',
}

interface RubricForm {
  id: string | null
  code: string
  label: string
  is_taxable: boolean
  periodicity: PrimePeriodicity
  calc_type: PrimeCalcType
  default_amount: string
  percent_rate: string
  target_bucket: PrimeBucket
  is_active: boolean
}

const emptyRubricForm: RubricForm = {
  id: null, code: '', label: '', is_taxable: true, periodicity: 'mensuelle',
  calc_type: 'fixed', default_amount: '', percent_rate: '', target_bucket: 'primes', is_active: true,
}

export default function PrimesPage() {
  const [tab, setTab] = useState<'rubriques' | 'rattachements'>('rubriques')
  const [rubrics, setRubrics] = useState<PrimeRubric[]>([])
  const [assignments, setAssignments] = useState<EmployeePrime[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)

  // Rubric modal
  const [showRubric, setShowRubric] = useState(false)
  const [rubricForm, setRubricForm] = useState<RubricForm>(emptyRubricForm)

  // Assignment modal
  const [showAssign, setShowAssign] = useState(false)
  const [empSearch, setEmpSearch] = useState('')
  const [empOpen, setEmpOpen] = useState(false)
  const [assignForm, setAssignForm] = useState({
    id: null as string | null, employee_id: '', rubric_id: '', amount: '', notes: '',
    period_year: new Date().getFullYear(), period_month: new Date().getMonth() + 1,
  })
  const [search, setSearch] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [rubRes, assRes, emps] = await Promise.all([
        supabase.from('prime_rubrics').select('*').order('sort_order'),
        supabase.from('employee_primes')
          .select('*, rubric:prime_rubrics(*), company:companies(id, name, code)')
          .order('created_at', { ascending: false }),
        fetchEmployees({ company_id: null, station_id: null, role: null, contract_type: null, contract_nature: null, status: null, search: '' }),
      ])
      setRubrics((rubRes.data as PrimeRubric[]) ?? [])
      setAssignments((assRes.data as EmployeePrime[]) ?? [])
      setEmployees(emps)
    } catch { toast.error('Erreur de chargement') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const activeRubrics = rubrics.filter(r => r.is_active)

  // ---------- Rubric CRUD ----------
  const openNewRubric = () => { setRubricForm(emptyRubricForm); setShowRubric(true) }
  const openEditRubric = (r: PrimeRubric) => {
    setRubricForm({
      id: r.id, code: r.code, label: r.label, is_taxable: r.is_taxable, periodicity: r.periodicity,
      calc_type: r.calc_type, default_amount: r.default_amount ? String(r.default_amount) : '',
      percent_rate: r.percent_rate ? String(r.percent_rate) : '', target_bucket: r.target_bucket, is_active: r.is_active,
    })
    setShowRubric(true)
  }

  const saveRubric = async () => {
    if (!rubricForm.label.trim()) { toast.error('Libellé requis'); return }
    const code = (rubricForm.code.trim() || rubricForm.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')).replace(/^_+|_+$/g, '')
    const payload = {
      code,
      label: rubricForm.label.trim(),
      is_taxable: rubricForm.is_taxable,
      periodicity: rubricForm.periodicity,
      calc_type: rubricForm.calc_type,
      default_amount: rubricForm.calc_type === 'fixed' ? (parseFloat(rubricForm.default_amount) || 0) : 0,
      percent_rate: rubricForm.calc_type === 'percent_base' ? (parseFloat(rubricForm.percent_rate) || 0) : 0,
      target_bucket: rubricForm.target_bucket,
      is_active: rubricForm.is_active,
      updated_at: new Date().toISOString(),
    }
    const res = rubricForm.id
      ? await supabase.from('prime_rubrics').update(payload).eq('id', rubricForm.id)
      : await supabase.from('prime_rubrics').insert({ ...payload, sort_order: rubrics.length + 1 })
    if (res.error) { toast.error(res.error.message); return }
    toast.success(rubricForm.id ? 'Rubrique mise à jour' : 'Rubrique créée')
    setShowRubric(false)
    loadData()
  }

  const toggleRubric = async (r: PrimeRubric) => {
    const { error } = await supabase.from('prime_rubrics')
      .update({ is_active: !r.is_active, updated_at: new Date().toISOString() }).eq('id', r.id)
    if (error) { toast.error(error.message); return }
    toast.success(r.is_active ? 'Rubrique désactivée' : 'Rubrique activée')
    loadData()
  }

  // ---------- Assignment CRUD ----------
  const selectedEmployee = employees.find(e => e.id === assignForm.employee_id)
  const selectedRubric = rubrics.find(r => r.id === assignForm.rubric_id)
  const empMatches = (() => {
    const q = empSearch.trim().toLowerCase()
    const base = q
      ? employees.filter(e =>
          e.full_name.toLowerCase().includes(q) ||
          (e.employee_id ?? '').toLowerCase().includes(q) ||
          (e.company_code ?? '').toLowerCase().includes(q))
      : employees
    return base.slice(0, 50)
  })()

  const openNewAssign = () => {
    setAssignForm({
      id: null, employee_id: '', rubric_id: activeRubrics[0]?.id ?? '', amount: '', notes: '',
      period_year: new Date().getFullYear(), period_month: new Date().getMonth() + 1,
    })
    setEmpSearch(''); setEmpOpen(false); setShowAssign(true)
  }
  const openEditAssign = (a: EmployeePrime) => {
    setAssignForm({
      id: a.id, employee_id: a.employee_id, rubric_id: a.rubric_id,
      amount: a.amount != null ? String(a.amount) : '', notes: a.notes ?? '',
      period_year: a.period_year ?? new Date().getFullYear(),
      period_month: a.period_month ?? new Date().getMonth() + 1,
    })
    setEmpSearch(''); setEmpOpen(false); setShowAssign(true)
  }

  const saveAssign = async () => {
    const emp = employees.find(e => e.id === assignForm.employee_id)
    const rubric = rubrics.find(r => r.id === assignForm.rubric_id)
    if (!emp || !rubric) { toast.error('Employé et rubrique requis'); return }
    const recurring = rubric.periodicity === 'mensuelle'
    const payload = {
      employee_id: emp.id,
      employee_source: emp.source_table ?? 'employees',
      company_id: emp.company_id,
      employee_name: emp.full_name,
      rubric_id: rubric.id,
      amount: assignForm.amount.trim() ? parseFloat(assignForm.amount) : null,
      period_year: recurring ? null : assignForm.period_year,
      period_month: recurring ? null : assignForm.period_month,
      notes: assignForm.notes.trim() || null,
      updated_at: new Date().toISOString(),
    }
    const res = assignForm.id
      ? await supabase.from('employee_primes').update(payload).eq('id', assignForm.id)
      : await supabase.from('employee_primes').insert({ ...payload, is_active: true })
    if (res.error) { toast.error(res.error.message); return }
    toast.success(assignForm.id ? 'Prime mise à jour' : 'Prime rattachée')
    setShowAssign(false)
    loadData()
  }

  const toggleAssign = async (a: EmployeePrime) => {
    const { error } = await supabase.from('employee_primes')
      .update({ is_active: !a.is_active, updated_at: new Date().toISOString() }).eq('id', a.id)
    if (error) { toast.error(error.message); return }
    toast.success(a.is_active ? 'Prime désactivée' : 'Prime activée')
    loadData()
  }

  const amountLabel = (a: EmployeePrime): string => {
    if (a.amount != null && Number(a.amount) > 0) return `${fmt(Number(a.amount))} F`
    const r = a.rubric
    if (!r) return '-'
    if (r.calc_type === 'seniority') return 'Auto ancienneté'
    if (r.calc_type === 'percent_base') return `${r.percent_rate}% du salaire`
    return r.default_amount ? `${fmt(Number(r.default_amount))} F` : 'Auto'
  }

  const filteredAssignments = assignments.filter(a =>
    !search || a.employee_name.toLowerCase().includes(search.toLowerCase()) ||
    (a.rubric?.label ?? '').toLowerCase().includes(search.toLowerCase()))

  if (loading) {
    return <div className="flex items-center justify-center h-[60vh]"><div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#0B743915' }}>
            <Gift className="w-5 h-5" style={{ color: '#0B7439' }} />
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Primes & rubriques</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Gestion des rubriques de primes et de leur rattachement aux employés</p>
          </div>
        </div>
        {tab === 'rubriques' ? (
          <button onClick={openNewRubric} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ backgroundColor: '#0B7439' }}>
            <Plus className="w-4 h-4" />Nouvelle rubrique
          </button>
        ) : (
          <button onClick={openNewAssign} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ backgroundColor: '#0B7439' }}>
            <Plus className="w-4 h-4" />Rattacher une prime
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {([['rubriques', 'Rubriques de primes'], ['rattachements', 'Primes des employés']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{
              backgroundColor: tab === k ? '#0B7439' : 'var(--bg-subtle)',
              color: tab === k ? '#fff' : 'var(--text-secondary)',
              border: `1px solid ${tab === k ? '#0B7439' : 'var(--border)'}`,
            }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'rubriques' && (
        <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                  <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Rubrique</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Imposable</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Périodicité</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Rubrique de paie</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Montant / Calcul</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Statut</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rubrics.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Aucune rubrique</td></tr>
                ) : rubrics.map(r => (
                  <tr key={r.id} className="border-t hover:bg-gray-50/50 transition-colors" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{r.label}</td>
                    <td className="px-4 py-3 text-xs">
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold" style={{ backgroundColor: r.is_taxable ? '#FEF3C7' : '#D4EDDA', color: r.is_taxable ? '#D97706' : '#0B7439' }}>
                        {r.is_taxable ? 'Imposable' : 'Non imposable'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{PERIODICITY_LABELS[r.periodicity]}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{BUCKET_LABELS[r.target_bucket]}</td>
                    <td className="px-4 py-3 text-right text-xs" style={{ color: 'var(--text-primary)' }}>
                      {r.calc_type === 'seniority' ? 'Auto ancienneté' : r.calc_type === 'percent_base' ? `${r.percent_rate}% du salaire` : (r.default_amount ? `${fmt(Number(r.default_amount))} F` : 'Variable')}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold" style={{ backgroundColor: r.is_active ? '#D4EDDA' : '#F3F4F6', color: r.is_active ? '#0B7439' : '#6B7280' }}>
                        {r.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openEditRubric(r)} className="p-1.5 rounded-lg hover:bg-blue-50 transition-colors" title="Modifier">
                          <Pencil className="w-3.5 h-3.5" style={{ color: '#1D6FA4' }} />
                        </button>
                        <button onClick={() => toggleRubric(r)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors" title={r.is_active ? 'Désactiver' : 'Activer'}>
                          <Power className="w-3.5 h-3.5" style={{ color: r.is_active ? '#DC2626' : '#0B7439' }} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'rattachements' && (
        <>
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher par employé ou rubrique..."
              className="w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-green-500"
              style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
          </div>
          <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                    <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Employé</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Société</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Rubrique</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Périodicité</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Montant</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Période</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Statut</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAssignments.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Aucune prime rattachée</td></tr>
                  ) : filteredAssignments.map(a => (
                    <tr key={a.id} className="border-t hover:bg-gray-50/50 transition-colors" style={{ borderColor: 'var(--border)' }}>
                      <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{a.employee_name}</td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{a.company?.code ?? '-'}</td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {a.rubric?.label ?? '-'}
                        {a.rubric && !a.rubric.is_taxable && <span className="ml-1 text-[10px]" style={{ color: '#0B7439' }}>(non imp.)</span>}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{a.rubric ? PERIODICITY_LABELS[a.rubric.periodicity] : '-'}</td>
                      <td className="px-4 py-3 text-right text-xs font-bold" style={{ color: '#0B7439' }}>{amountLabel(a)}</td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                        {a.period_year ? `${MONTHS[(a.period_month ?? 1) - 1]} ${a.period_year}` : 'Récurrente'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold" style={{ backgroundColor: a.is_active ? '#D4EDDA' : '#F3F4F6', color: a.is_active ? '#0B7439' : '#6B7280' }}>
                          {a.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => openEditAssign(a)} className="p-1.5 rounded-lg hover:bg-blue-50 transition-colors" title="Modifier">
                            <Pencil className="w-3.5 h-3.5" style={{ color: '#1D6FA4' }} />
                          </button>
                          <button onClick={() => toggleAssign(a)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors" title={a.is_active ? 'Désactiver' : 'Activer'}>
                            <Power className="w-3.5 h-3.5" style={{ color: a.is_active ? '#DC2626' : '#0B7439' }} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Rubric modal */}
      {showRubric && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 space-y-4 my-8">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{rubricForm.id ? 'Modifier la rubrique' : 'Nouvelle rubrique'}</h3>
              <button onClick={() => setShowRubric(false)}><X className="w-5 h-5" style={{ color: 'var(--text-muted)' }} /></button>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Libellé *</label>
              <input value={rubricForm.label} onChange={e => setRubricForm(f => ({ ...f, label: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Imposition</label>
                <select value={rubricForm.is_taxable ? '1' : '0'} onChange={e => setRubricForm(f => ({ ...f, is_taxable: e.target.value === '1' }))}
                  className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                  <option value="1">Imposable</option>
                  <option value="0">Non imposable</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Périodicité</label>
                <select value={rubricForm.periodicity} onChange={e => setRubricForm(f => ({ ...f, periodicity: e.target.value as PrimePeriodicity }))}
                  className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                  {Object.entries(PERIODICITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Rubrique de paie</label>
                <select value={rubricForm.target_bucket} onChange={e => setRubricForm(f => ({ ...f, target_bucket: e.target.value as PrimeBucket }))}
                  className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                  {Object.entries(BUCKET_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Mode de calcul</label>
                <select value={rubricForm.calc_type} onChange={e => setRubricForm(f => ({ ...f, calc_type: e.target.value as PrimeCalcType }))}
                  className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                  <option value="fixed">Montant fixe</option>
                  <option value="percent_base">% du salaire de base</option>
                  <option value="seniority">Ancienneté (auto selon date d'entrée)</option>
                </select>
              </div>
            </div>
            {rubricForm.calc_type === 'fixed' && (
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Montant par défaut (F)</label>
                <input type="number" value={rubricForm.default_amount} onChange={e => setRubricForm(f => ({ ...f, default_amount: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>Laissez vide si le montant est défini lors du rattachement.</p>
              </div>
            )}
            {rubricForm.calc_type === 'percent_base' && (
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Taux (% du salaire de base)</label>
                <input type="number" value={rubricForm.percent_rate} onChange={e => setRubricForm(f => ({ ...f, percent_rate: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
              </div>
            )}
            {rubricForm.calc_type === 'seniority' && (
              <div className="rounded-lg p-3 text-[11px]" style={{ backgroundColor: '#D4EDDA', color: '#0B7439' }}>
                Calcul automatique : taux = nombre d'années d'ancienneté (selon la date d'entrée de l'employé), à partir de 2 ans, plafonné à 25 %. Prime = salaire de base × taux. Aucune saisie requise.
              </div>
            )}
            <div className="flex gap-3 pt-1">
              <button onClick={() => setShowRubric(false)} className="flex-1 py-2.5 rounded-xl font-medium"
                style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>Annuler</button>
              <button onClick={saveRubric} className="flex-1 py-2.5 rounded-xl font-bold text-white" style={{ backgroundColor: '#0B7439' }}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}

      {/* Assignment modal */}
      {showAssign && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 space-y-4 my-8">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{assignForm.id ? 'Modifier la prime' : 'Rattacher une prime'}</h3>
              <button onClick={() => setShowAssign(false)}><X className="w-5 h-5" style={{ color: 'var(--text-muted)' }} /></button>
            </div>
            <div className="relative">
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Employé *</label>
              {selectedEmployee ? (
                <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm"
                  style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                  <span className="truncate font-medium">{selectedEmployee.full_name}
                    <span className="ml-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {selectedEmployee.employee_id ?? ''} {selectedEmployee.company_code ? `· ${selectedEmployee.company_code}` : ''}
                    </span>
                  </span>
                  {!assignForm.id && (
                    <button type="button" onClick={() => { setAssignForm(f => ({ ...f, employee_id: '' })); setEmpSearch(''); setEmpOpen(true) }}>
                      <X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                    </button>
                  )}
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                  <input value={empSearch} onChange={e => { setEmpSearch(e.target.value); setEmpOpen(true) }}
                    onFocus={() => setEmpOpen(true)} onBlur={() => setTimeout(() => setEmpOpen(false), 150)}
                    placeholder="Rechercher un employé (nom, matricule, société)..."
                    className="w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-green-500"
                    style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
                </div>
              )}
              {empOpen && !selectedEmployee && (
                <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-lg shadow-lg" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
                  {empMatches.length === 0 ? (
                    <div className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>Aucun employé trouvé</div>
                  ) : empMatches.map(e => (
                    <button key={e.id} type="button"
                      onMouseDown={() => { setAssignForm(f => ({ ...f, employee_id: e.id })); setEmpOpen(false) }}
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
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Rubrique de prime *</label>
              <select value={assignForm.rubric_id} onChange={e => setAssignForm(f => ({ ...f, rubric_id: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                <option value="">Sélectionner...</option>
                {activeRubrics.map(r => <option key={r.id} value={r.id}>{r.label} ({PERIODICITY_LABELS[r.periodicity]})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Montant (F)</label>
              <input type="number" value={assignForm.amount} onChange={e => setAssignForm(f => ({ ...f, amount: e.target.value }))}
                placeholder={selectedRubric?.calc_type === 'seniority' ? "Auto : selon l'ancienneté" : selectedRubric?.calc_type === 'percent_base' ? `Auto : ${selectedRubric.percent_rate}% du salaire` : (selectedRubric?.default_amount ? `Défaut : ${fmt(Number(selectedRubric.default_amount))} F` : '')}
                className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>Laissez vide pour utiliser le calcul automatique de la rubrique.</p>
            </div>
            {selectedRubric && selectedRubric.periodicity !== 'mensuelle' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Mois</label>
                  <select value={assignForm.period_month} onChange={e => setAssignForm(f => ({ ...f, period_month: Number(e.target.value) }))}
                    className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                    {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Année</label>
                  <select value={assignForm.period_year} onChange={e => setAssignForm(f => ({ ...f, period_year: Number(e.target.value) }))}
                    className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                    {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Notes</label>
              <textarea value={assignForm.notes} onChange={e => setAssignForm(f => ({ ...f, notes: e.target.value }))} rows={2}
                className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowAssign(false)} className="flex-1 py-2.5 rounded-xl font-medium"
                style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>Annuler</button>
              <button onClick={saveAssign} className="flex-1 py-2.5 rounded-xl font-bold text-white" style={{ backgroundColor: '#0B7439' }}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
