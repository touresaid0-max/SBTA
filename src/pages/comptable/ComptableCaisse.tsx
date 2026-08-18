import { useState, useEffect, useCallback } from 'react'
import { Plus, ChevronLeft, ChevronRight, Calendar, Wallet, TrendingUp, TrendingDown, DollarSign, Trash2 } from 'lucide-react'
import { format, startOfWeek, endOfWeek, subWeeks } from 'date-fns'
import { fr } from 'date-fns/locale'
import toast from 'react-hot-toast'
import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/store/authStore'
import { useComptableCompanies } from '@/hooks/useComptableCompanies'

const fmt = (n: number) => new Intl.NumberFormat('fr-FR').format(n) + ' XOF'

interface CaisseEntry {
  id: string
  entry_type: 'entree' | 'depense'
  amount: number
  label: string
  entry_date: string
  notes: string | null
  registration_number: string | null
}

interface EntryForm {
  entry_type: 'entree' | 'depense'
  amount: string
  label: string
  entry_date: string
  registration_number: string
  notes: string
}

const EMPTY_FORM: EntryForm = {
  entry_type: 'entree',
  amount: '',
  label: '',
  entry_date: format(new Date(), 'yyyy-MM-dd'),
  registration_number: '',
  notes: '',
}

export default function ComptableCaisse() {
  const { user }  = useAuthStore()
  const { allowedCompanyIds } = useComptableCompanies()
  const companyIds = allowedCompanyIds ?? (user?.company_id ? [user.company_id] : [])
  const companyId = companyIds[0] ?? null

  const [weekOffset, setWeekOffset] = useState(0)
  const [loading,    setLoading]    = useState(true)
  const [entries,    setEntries]    = useState<CaisseEntry[]>([])
  const [buses,      setBuses]      = useState<string[]>([])
  const [showForm,   setShowForm]   = useState(false)
  const [form,       setForm]       = useState<EntryForm>(EMPTY_FORM)
  const [saving,     setSaving]     = useState(false)

  const base      = subWeeks(new Date(), weekOffset < 0 ? -weekOffset : weekOffset)
  const weekStart = startOfWeek(base, { weekStartsOn: 1 })
  const weekEnd   = endOfWeek(base,   { weekStartsOn: 1 })
  const startStr  = format(weekStart, 'yyyy-MM-dd')
  const endStr    = format(weekEnd,   'yyyy-MM-dd')
  const weekLabel = `Semaine du ${format(weekStart, 'dd/MM', { locale: fr })} au ${format(weekEnd, 'dd/MM/yyyy', { locale: fr })}`

  useEffect(() => {
    if (companyIds.length === 0) return
    supabase.from('fleet_vehicles').select('registration_number').in('company_id', companyIds).eq('is_active', true)
      .then(({ data }) => setBuses((data ?? []).map((v: { registration_number: string }) => v.registration_number).sort()))
  }, [companyIds])

  const load = useCallback(async () => {
    if (companyIds.length === 0) return
    setLoading(true)
    try {
      const { data } = await supabase
        .from('comptable_caisse_entries')
        .select('id, entry_type, amount, label, entry_date, notes, registration_number')
        .in('company_id', companyIds)
        .gte('entry_date', startStr)
        .lte('entry_date', endStr)
        .order('entry_date', { ascending: false })
      setEntries((data ?? []) as CaisseEntry[])
    } finally {
      setLoading(false)
    }
  }, [companyIds, startStr, endStr])

  useEffect(() => { load() }, [load])

  const totalEntrees  = entries.filter(e => e.entry_type === 'entree').reduce((a, b) => a + Number(b.amount), 0)
  const totalDepenses = entries.filter(e => e.entry_type === 'depense').reduce((a, b) => a + Number(b.amount), 0)
  const reste = totalEntrees - totalDepenses

  const setF = (field: keyof EntryForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }))

  const save = async () => {
    if (!form.label.trim()) { toast.error('Le libellé est obligatoire'); return }
    if (!form.amount || isNaN(Number(form.amount)) || Number(form.amount) <= 0) { toast.error('Montant invalide'); return }
    if (companyIds.length === 0) return
    setSaving(true)
    try {
      const weekStartStr = format(startOfWeek(new Date(form.entry_date), { weekStartsOn: 1 }), 'yyyy-MM-dd')
      const { error } = await supabase.from('comptable_caisse_entries').insert({
        company_id: companyId,
        entry_type: form.entry_type,
        amount: Math.round(Number(form.amount)),
        label: form.label.trim(),
        entry_date: form.entry_date,
        week_start: weekStartStr,
        registration_number: form.registration_number.trim() || null,
        notes: form.notes.trim() || null,
        created_by: user?.id ?? null,
      })
      if (error) throw error
      toast.success('Entrée enregistrée')
      setForm(EMPTY_FORM)
      setShowForm(false)
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setSaving(false)
    }
  }

  const deleteEntry = async (id: string) => {
    if (!confirm('Supprimer cette entrée ?')) return
    const { error } = await supabase.from('comptable_caisse_entries').delete().eq('id', id)
    if (error) { toast.error('Erreur'); return }
    toast.success('Supprimée')
    load()
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500'
  const inputStyle = { backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }

  const depenses = entries.filter(e => e.entry_type === 'depense')

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-4xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Gestion de la caisse</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Suivi des entrées et sorties de caisse</p>
        </div>
        <button onClick={() => { setShowForm(f => !f); setForm(EMPTY_FORM) }} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold" style={{ backgroundColor: '#0B7439', color: '#fff' }}>
          <Plus className="w-4 h-4" /> Nouvelle entrée
        </button>
      </div>

      {/* Week navigation */}
      <div className="flex items-center justify-center gap-4">
        <button onClick={() => setWeekOffset(w => w + 1)} className="p-2 rounded-lg hover:bg-gray-100">
          <ChevronLeft className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
        </button>
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <Calendar className="w-4 h-4" style={{ color: '#0B7439' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{weekLabel}</span>
        </div>
        <button onClick={() => setWeekOffset(w => Math.max(0, w - 1))} disabled={weekOffset === 0} className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30">
          <ChevronRight className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
        </button>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl p-4 flex items-center gap-3" style={{ backgroundColor: '#f0fdf4', border: '1px solid #86efac' }}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#0B7439' }}>
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-xs font-medium" style={{ color: '#166534' }}>ENTREE CAISSE</p>
            <p className="text-base font-bold" style={{ color: '#166534' }}>{new Intl.NumberFormat('fr-FR').format(totalEntrees)}</p>
          </div>
        </div>
        <div className="rounded-xl p-4 flex items-center gap-3" style={{ backgroundColor: '#FEF9C3', border: '1px solid #FDE047' }}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#CA8A04' }}>
            <TrendingDown className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-xs font-medium" style={{ color: '#713F12' }}>TOTAL PAR SEMAINE</p>
            <p className="text-base font-bold" style={{ color: '#713F12' }}>{new Intl.NumberFormat('fr-FR').format(totalDepenses)}</p>
          </div>
        </div>
        <div className="rounded-xl p-4 flex items-center gap-3" style={{ backgroundColor: reste >= 0 ? '#EFF6FF' : '#FEF2F2', border: `1px solid ${reste >= 0 ? '#BFDBFE' : '#FECACA'}` }}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: reste >= 0 ? '#1D4ED8' : '#DC2626' }}>
            <DollarSign className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-xs font-medium" style={{ color: reste >= 0 ? '#1E3A5F' : '#7F1D1D' }}>RESTE CAISSE</p>
            <p className="text-base font-bold" style={{ color: reste >= 0 ? '#1E40AF' : '#DC2626' }}>{new Intl.NumberFormat('fr-FR').format(Math.abs(reste))}{reste < 0 ? ' (déficit)' : ''}</p>
          </div>
        </div>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="rounded-xl p-5 space-y-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <h2 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Nouvelle entrée de caisse</h2>
          <div className="grid grid-cols-2 gap-3">
            {/* Type */}
            <div className="col-span-2">
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Type</label>
              <div className="flex gap-2">
                {(['entree', 'depense'] as const).map(t => (
                  <button key={t} type="button" onClick={() => setForm(f => ({ ...f, entry_type: t }))} className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all"
                    style={{
                      backgroundColor: form.entry_type === t ? (t === 'entree' ? '#0B7439' : '#DC2626') : 'var(--bg-subtle)',
                      color: form.entry_type === t ? '#fff' : 'var(--text-secondary)',
                      border: `1px solid ${form.entry_type === t ? (t === 'entree' ? '#0B7439' : '#DC2626') : 'var(--border)'}`,
                    }}>
                    {t === 'entree' ? 'Entrée caisse' : 'Dépense'}
                  </button>
                ))}
              </div>
            </div>
            {/* Libellé */}
            <div className="col-span-2">
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Libellé <span style={{ color: '#DC2626' }}>*</span></label>
              <input value={form.label} onChange={setF('label')} placeholder="ex: Recette guichet, Carburant bus…" className={inputCls} style={inputStyle} />
            </div>
            {/* Montant */}
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Montant (XOF) <span style={{ color: '#DC2626' }}>*</span></label>
              <div className="relative">
                <input type="number" min="0" step="500" value={form.amount} onChange={setF('amount')} placeholder="0" className={inputCls + ' pr-14'} style={inputStyle} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>XOF</span>
              </div>
            </div>
            {/* Date */}
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Date</label>
              <input type="date" value={form.entry_date} onChange={setF('entry_date')} className={inputCls} style={inputStyle} />
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Notes</label>
              <input value={form.notes} onChange={setF('notes')} placeholder="Optionnel…" className={inputCls} style={inputStyle} />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={save} disabled={saving} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: '#0B7439', color: '#fff' }}>
              <Wallet className="w-4 h-4" />
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2.5 rounded-xl text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Annuler</button>
          </div>
        </div>
      )}

      {/* Expense grid */}
      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="px-4 py-3 flex items-center justify-between" style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
            Dépenses — {weekLabel}
          </h2>
          <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{depenses.length} opération{depenses.length > 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <div className="py-8 flex justify-center">
            <div className="w-6 h-6 border-4 rounded-full animate-spin" style={{ borderColor: '#0B7439', borderTopColor: 'transparent' }} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[500px]">
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                  {['Date', 'Immatriculation', 'Libellé', 'Type', 'Montant', ''].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {entries.length === 0 ? (
                  <tr><td colSpan={6} className="py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Aucune entrée cette semaine</td></tr>
                ) : entries.map(e => (
                  <tr key={e.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {format(new Date(e.entry_date), 'dd/MM/yy', { locale: fr })}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                      {e.registration_number ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 text-xs max-w-[200px]">
                      <p className="truncate" style={{ color: 'var(--text-primary)' }}>{e.label}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="px-1.5 py-0.5 rounded text-xs font-semibold" style={{
                        backgroundColor: e.entry_type === 'entree' ? '#d4edda' : '#fee2e2',
                        color: e.entry_type === 'entree' ? '#0B7439' : '#DC2626',
                      }}>
                        {e.entry_type === 'entree' ? 'Entrée' : 'Dépense'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs font-bold" style={{ color: e.entry_type === 'entree' ? '#0B7439' : '#DC2626' }}>
                      {e.entry_type === 'depense' ? '−' : '+'}{fmt(Number(e.amount))}
                    </td>
                    <td className="px-3 py-2.5">
                      <button onClick={() => deleteEntry(e.id)} className="p-1.5 rounded hover:bg-red-50" title="Supprimer">
                        <Trash2 className="w-3.5 h-3.5" style={{ color: '#DC2626' }} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              {entries.length > 0 && (
                <tfoot>
                  <tr style={{ backgroundColor: '#0B7439' }}>
                    <td colSpan={3} className="px-3 py-2.5 text-xs font-bold text-right text-white">TOTAL SEMAINE</td>
                    <td className="px-3 py-2.5 text-xs text-white opacity-70">Dépenses</td>
                    <td className="px-3 py-2.5 text-xs font-bold text-white">{fmt(totalDepenses)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

    </div>
  )
}
