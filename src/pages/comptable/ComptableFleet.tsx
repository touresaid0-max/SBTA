import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Car, Search, ChevronRight, ChevronUp } from 'lucide-react'
import { format, startOfWeek, endOfWeek } from 'date-fns'
import { fr } from 'date-fns/locale'
import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/store/authStore'
import { useComptableCompanies } from '@/hooks/useComptableCompanies'
import { CompanyFilterBar } from '@/components/shared/CompanyFilterBar'
import type { VehicleExpense } from '@/types/chargeAchat.types'

const fmt = (n: number) => new Intl.NumberFormat('fr-FR').format(n) + ' XOF'

interface VehicleRow {
  registration_number: string
  total_week: number
  total_all: number
  incident_count: number
  last_intervention: string | null
  week_expenses: VehicleExpense[]
  all_expenses: VehicleExpense[]
}

function statusColor(totalWeek: number) {
  if (totalWeek === 0) return { dot: '#10B981', label: 'Aucune dépense', bg: '#D1FAE5', text: '#065F46' }
  if (totalWeek >= 50000) return { dot: '#DC2626', label: 'Dépense importante', bg: '#fee2e2', text: '#991B1B' }
  return { dot: '#F59E0B', label: 'Dépense mineure', bg: '#FEF3C7', text: '#92400E' }
}

export default function ComptableFleet() {
  const navigate  = useNavigate()
  const { user }  = useAuthStore()
  const { allowedCompanyIds, companyInfos } = useComptableCompanies()
  const allCompanyIds = allowedCompanyIds ?? (user?.company_id ? [user.company_id] : [])
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([])
  const companyIds = selectedCompanies.length > 0 ? selectedCompanies : allCompanyIds
  const companyId = companyIds[0] ?? null

  const now       = new Date()
  const weekStart = format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const weekEnd   = format(endOfWeek(now,   { weekStartsOn: 1 }), 'yyyy-MM-dd')

  const [vehicles, setVehicles] = useState<VehicleRow[]>([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (companyIds.length === 0) return
    setLoading(true)
    try {
      const [{ data: fleetData }, { data: allExpenses }] = await Promise.all([
        supabase.from('fleet_vehicles').select('registration_number, company_id').in('company_id', companyIds).eq('is_active', true),
        supabase.from('vehicle_expenses')
          .select('*, category:expense_categories(name,icon,color)')
          .in('company_id', companyIds)
          .eq('source', 'comptable')
          .order('expense_date', { ascending: false }),
      ])

      const expensesAll = (allExpenses ?? []) as VehicleExpense[]
      const rows: Record<string, VehicleRow> = {}

      for (const v of fleetData ?? []) {
        if (!rows[v.registration_number]) {
          rows[v.registration_number] = {
            registration_number: v.registration_number,
            total_week: 0, total_all: 0, incident_count: 0, last_intervention: null,
            week_expenses: [], all_expenses: [],
          }
        }
      }

      for (const e of expensesAll) {
        if (!rows[e.registration_number]) {
          rows[e.registration_number] = {
            registration_number: e.registration_number,
            total_week: 0, total_all: 0, incident_count: 0, last_intervention: null,
            week_expenses: [], all_expenses: [],
          }
        }
        const r = rows[e.registration_number]
        r.total_all += Number(e.amount)
        r.all_expenses.push(e)
        if (e.expense_date >= weekStart && e.expense_date <= weekEnd) {
          r.total_week += Number(e.amount)
          r.week_expenses.push(e)
        }
        r.incident_count++
        if (!r.last_intervention || e.expense_date > r.last_intervention) {
          r.last_intervention = e.expense_date
        }
      }

      setVehicles(Object.values(rows).sort((a, b) => b.total_week - a.total_week))
    } finally {
      setLoading(false)
    }
  }, [companyIds, weekStart, weekEnd])

  useEffect(() => { load() }, [load])

  const filtered = vehicles.filter(v =>
    !search || v.registration_number.toLowerCase().includes(search.toLowerCase())
  )

  const totalWeek = filtered.reduce((a, b) => a + b.total_week, 0)

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-5xl mx-auto">

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Parc de véhicules</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Semaine du {format(startOfWeek(now, { weekStartsOn: 1 }), 'dd/MM', { locale: fr })} au {format(endOfWeek(now, { weekStartsOn: 1 }), 'dd/MM/yyyy', { locale: fr })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {[
            { dot: '#10B981', label: 'Aucune dépense' },
            { dot: '#F59E0B', label: '< 50 000 XOF' },
            { dot: '#DC2626', label: '≥ 50 000 XOF' },
          ].map(l => (
            <div key={l.label} className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: l.dot }} />
              <span className="hidden sm:inline">{l.label}</span>
            </div>
          ))}
        </div>
      </div>

      <CompanyFilterBar filter={{ allCompanyIds, selectedCompanyIds: companyIds, companyInfos, hasMultiple: allCompanyIds.length > 1 }} onChange={setSelectedCompanies} />

      {/* Summary card */}
      <div className="rounded-xl p-4 flex items-center justify-between" style={{ backgroundColor: '#0B7439', color: '#fff' }}>
        <div>
          <p className="text-xs opacity-70">{filtered.length} véhicule{filtered.length > 1 ? 's' : ''} — dépenses semaine</p>
          <p className="text-2xl font-bold mt-0.5">{fmt(totalWeek)}</p>
        </div>
        <Car className="w-10 h-10 opacity-30" />
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher immatriculation…" className="w-full pl-9 pr-3 py-2 rounded-lg text-sm"
          style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
      </div>

      {loading ? (
        <div className="py-12 flex justify-center">
          <div className="w-7 h-7 border-4 rounded-full animate-spin" style={{ borderColor: '#0B7439', borderTopColor: 'transparent' }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Aucun véhicule trouvé</div>
      ) : (
        <div className="rounded-xl overflow-hidden divide-y" style={{ border: '1px solid var(--border)', borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
          {filtered.map(v => {
            const st = statusColor(v.total_week)
            const isOpen = expanded === v.registration_number
            return (
              <div key={v.registration_number}>
                <button onClick={() => setExpanded(isOpen ? null : v.registration_number)} className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: st.dot }} />
                  <Car className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                  <span className="font-mono font-bold text-sm flex-1" style={{ color: 'var(--text-primary)' }}>{v.registration_number}</span>
                  <div className="hidden sm:flex items-center gap-6 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span>{v.incident_count} intervention{v.incident_count > 1 ? 's' : ''}</span>
                    {v.last_intervention && <span>Dernière : {format(new Date(v.last_intervention), 'dd/MM/yy', { locale: fr })}</span>}
                    <span style={{ color: 'var(--text-secondary)' }}>Total : {fmt(v.total_all)}</span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold ml-2 flex-shrink-0" style={{ backgroundColor: st.bg, color: st.text }}>
                    {v.total_week > 0 ? fmt(v.total_week) : 'Aucune'}
                  </span>
                  {isOpen ? <ChevronUp className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} /> : <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />}
                </button>

                {isOpen && (
                  <div className="px-4 pb-3" style={{ backgroundColor: 'var(--bg-subtle)' }}>
                    <p className="text-xs font-semibold mb-2 pt-2" style={{ color: 'var(--text-muted)' }}>
                      Historique complet — {v.all_expenses.length} entrée{v.all_expenses.length > 1 ? 's' : ''}
                    </p>
                    <div className="space-y-1.5 max-h-64 overflow-y-auto">
                      {v.all_expenses.map(e => (
                        <div key={e.id} className="flex items-center gap-3 px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
                          <span className="text-xs w-16 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{format(new Date(e.expense_date), 'dd/MM/yy', { locale: fr })}</span>
                          <span className="text-lg flex-shrink-0">{(e as any).category?.icon ?? '📦'}</span>
                          <span className="text-xs flex-1 min-w-0 truncate" style={{ color: 'var(--text-primary)' }}>{e.description}</span>
                          {e.supplier && <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{e.supplier}</span>}
                          <span className="text-xs font-bold flex-shrink-0" style={{ color: Number(e.amount) >= 200000 ? '#DC2626' : '#0B7439' }}>
                            {fmt(Number(e.amount))}
                          </span>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => navigate(`/comptable/expenses?vehicle=${v.registration_number}`)} className="mt-2 text-xs flex items-center gap-1" style={{ color: '#0B7439' }}>
                      Voir toutes les dépenses <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
