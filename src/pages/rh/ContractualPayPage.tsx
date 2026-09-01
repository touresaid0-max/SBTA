import { useEffect, useState } from 'react'
import { Search, CheckCircle, Clock, DollarSign, X, Printer } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/services/supabase'
import {
  fetchDriverMonthlyLogs,
  calculateContractualMonthlyPay,
  payContractualDays,
} from '@/services/hr.service'
import { useAuthStore } from '@/store/authStore'
import { resolveCompanyIds } from '@/utils/companyGroups'
import { CompanyGroupSelect } from '@/components/shared/CompanyGroupSelect'
import type { DriverDailyLog } from '@/types/hr.types'

interface ContractualDriver {
  id:                     string
  full_name:              string
  employee_id:            string | null
  company_name:           string | null
  company_code:           string | null
  daily_rate:             number | null
  days_worked_this_month: number
  current_month_earnings: number
}

interface DetailModal {
  driver: ContractualDriver
  logs:   DriverDailyLog[]
  paying: boolean
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
}
function fmt(n: number) { return n.toLocaleString('fr-CI') }

const currentMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const MONTH_LABEL = () => {
  return new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}

export default function ContractualPayPage() {
  const { user } = useAuthStore()
  const [drivers,     setDrivers]     = useState<ContractualDriver[]>([])
  const [loading,     setLoading]     = useState(true)
  const [search,      setSearch]      = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [payFilter,   setPayFilter]   = useState<'all' | 'paid' | 'pending'>('all')
  const [detail,      setDetail]      = useState<DetailModal | null>(null)
  const [companies,   setCompanies]   = useState<{ id: string; name: string; code: string; parent_id?: string | null; is_group?: boolean }[]>([])
  const [month] = useState(currentMonth())

  const loadDrivers = async () => {
    const { data, error } = await supabase
      .from('users')
      .select('id, first_name, last_name, employee_id, daily_rate, days_worked_this_month, current_month_earnings, companies(name, code)')
      .eq('role', 'chauffeur')
      .eq('contract_type', 'contractuel')
      .eq('status', 'active')
      .not('daily_rate', 'is', null)
      .order('last_name')

    if (error) { toast.error('Erreur de chargement'); return }

    setDrivers((data ?? []).map(d => ({
      id:                     d.id,
      full_name:              `${d.first_name ?? ''} ${d.last_name ?? ''}`.trim(),
      employee_id:            d.employee_id ?? null,
      company_name:           (d.companies as any)?.name ?? null,
      company_code:           (d.companies as any)?.code ?? null,
      daily_rate:             d.daily_rate ?? null,
      days_worked_this_month: d.days_worked_this_month ?? 0,
      current_month_earnings: d.current_month_earnings ?? 0,
    })))
  }

  useEffect(() => {
    Promise.all([
      loadDrivers(),
      supabase.from('companies').select('id, name, code, parent_id, is_group').order('name').then(({ data }) => setCompanies(data ?? [])),
    ]).finally(() => setLoading(false))
  }, [])

  const openDetail = async (driver: ContractualDriver) => {
    const logs = await fetchDriverMonthlyLogs(driver.id, month)
    setDetail({ driver, logs, paying: false })
  }

  const handlePayAll = async () => {
    if (!detail || !user) return
    const dueLogs = detail.logs.filter(l => l.payment_status === 'du')
    if (dueLogs.length === 0) { toast('Aucun jour en attente'); return }
    setDetail(d => d ? { ...d, paying: true } : null)
    try {
      await payContractualDays(detail.driver.id, dueLogs.map(l => l.id), user.id)
      toast.success('Paiement enregistré')
      const updated = await fetchDriverMonthlyLogs(detail.driver.id, month)
      setDetail(d => d ? { ...d, logs: updated, paying: false } : null)
      await loadDrivers()
    } catch {
      toast.error('Erreur lors du paiement')
      setDetail(d => d ? { ...d, paying: false } : null)
    }
  }

  const filteredDrivers = drivers.filter(d => {
    const matchSearch = !search || d.full_name.toLowerCase().includes(search.toLowerCase()) ||
      (d.employee_id ?? '').toLowerCase().includes(search.toLowerCase())
    const matchCompany = !companyFilter || resolveCompanyIds(companyFilter, companies).some(id => {
      const comp = companies.find(c => c.id === id)
      return comp?.name === d.company_name
    })
    const matchPay = payFilter === 'all' ||
      (payFilter === 'paid'    && d.current_month_earnings > 0 && d.days_worked_this_month === 0) ||
      (payFilter === 'pending' && d.current_month_earnings > 0)
    return matchSearch && matchCompany && matchPay
  })

  const totalDue = drivers.reduce((s, d) => s + Number(d.current_month_earnings), 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1A2E22]">Rémunération des contractuels</h1>
        <p className="text-sm text-[#6B7280] mt-1">{MONTH_LABEL()} — Chauffeurs contractuels actifs</p>
      </div>

      {/* Total KPI */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5 flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-[#1D6FA418] flex items-center justify-center flex-shrink-0">
          <DollarSign className="w-6 h-6 text-[#1D6FA4]" />
        </div>
        <div>
          <p className="text-xs text-[#6B7280] font-medium uppercase tracking-wide">Total dû ce mois</p>
          <p className="text-2xl font-bold text-[#1D6FA4]">{fmt(totalDue)} FCFA</p>
          <p className="text-xs text-[#8AA898]">{drivers.filter(d => d.current_month_earnings > 0).length} chauffeurs concernés</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] p-4">
        <div className="flex gap-3 flex-wrap">
          <div className="flex-1 min-w-48 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8AA898]" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher un chauffeur..."
              className="w-full pl-9 pr-4 py-2 border border-[#E2EAE5] rounded-xl text-sm focus:outline-none focus:border-[#0B7439]" />
          </div>
          <CompanyGroupSelect
            companies={companies}
            value={companyFilter}
            onChange={setCompanyFilter}
            placeholder="Toutes les sociétés"
            className="border border-[#E2EAE5] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#0B7439]"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#F8FAF8]">
              <tr>
                <th className="text-left px-6 py-3 text-[#4A6B55] font-semibold">Chauffeur</th>
                <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Société</th>
                <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Taux/jour</th>
                <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Jours trav.</th>
                <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Total à payer</th>
                <th className="text-center px-4 py-3 text-[#4A6B55] font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredDrivers.length === 0 && (
                <tr><td colSpan={6} className="text-center py-10 text-[#6B7280]">Aucun chauffeur contractuel trouvé</td></tr>
              )}
              {filteredDrivers.map(driver => (
                <tr key={driver.id} className="border-t border-[#E2EAE5] hover:bg-[#F8FAF8] transition-colors">
                  <td className="px-6 py-3">
                    <div className="font-semibold text-[#1A2E22]">{driver.full_name}</div>
                    {driver.employee_id && <div className="text-xs text-[#8AA898] font-mono">{driver.employee_id}</div>}
                  </td>
                  <td className="px-4 py-3 text-[#4A6B55]">{driver.company_code ?? driver.company_name ?? '—'}</td>
                  <td className="px-4 py-3 text-right font-medium text-[#1D6FA4]">
                    {driver.daily_rate != null ? `${fmt(Number(driver.daily_rate))} F` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-[#1A2E22]">{driver.days_worked_this_month}</td>
                  <td className="px-4 py-3 text-right font-bold text-[#0B7439]">
                    {fmt(Number(driver.current_month_earnings))} F
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-2">
                      <button onClick={() => openDetail(driver)}
                        className="text-xs font-medium text-[#1D6FA4] hover:text-[#0B7439] border border-[#DBEAFE] hover:border-[#D4EDDA] px-3 py-1.5 rounded-lg transition-colors">
                        Voir détail
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail modal */}
      {detail && (() => {
        const calc = calculateContractualMonthlyPay(detail.logs)
        const dueLogs = detail.logs.filter(l => l.payment_status === 'du')
        return (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
              {/* Header */}
              <div className="flex items-start justify-between p-6 border-b border-[#E2EAE5]">
                <div>
                  <h3 className="text-lg font-bold text-[#1A2E22]">{detail.driver.full_name}</h3>
                  <p className="text-sm text-[#4A6B55]">
                    Contractuel · {detail.driver.company_name} · {MONTH_LABEL()}
                  </p>
                  {detail.driver.daily_rate != null && (
                    <p className="text-sm font-medium text-[#1D6FA4] mt-0.5">
                      Taux journalier : {fmt(Number(detail.driver.daily_rate))} FCFA/jour
                    </p>
                  )}
                </div>
                <button onClick={() => setDetail(null)} className="text-[#6B7280] hover:text-[#1A2E22] p-1">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Logs table */}
              <div className="overflow-y-auto flex-1 px-6">
                {detail.logs.length === 0 ? (
                  <div className="text-center py-10 text-[#6B7280]">Aucun jour enregistré ce mois</div>
                ) : (
                  <table className="w-full text-sm mt-4">
                    <thead>
                      <tr className="bg-[#F8FAF8]">
                        <th className="text-left px-4 py-2 text-[#4A6B55] font-semibold rounded-l-xl">Date</th>
                        <th className="text-left px-4 py-2 text-[#4A6B55] font-semibold">Trajet effectué</th>
                        <th className="text-right px-4 py-2 text-[#4A6B55] font-semibold">Montant</th>
                        <th className="text-center px-4 py-2 text-[#4A6B55] font-semibold rounded-r-xl">Paiement</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.logs.map(log => (
                        <tr key={log.id} className="border-t border-[#F4F7F5]">
                          <td className="px-4 py-2 text-[#374151]">{fmtDate(log.work_date)}</td>
                          <td className="px-4 py-2 text-[#4A6B55]">{log.route_name ?? '—'}</td>
                          <td className="px-4 py-2 text-right font-medium text-[#1A2E22]">{fmt(Number(log.daily_rate))} F</td>
                          <td className="px-4 py-2 text-center">
                            {log.payment_status === 'paye'
                              ? <span className="inline-flex items-center gap-1 text-xs text-[#0B7439] font-medium"><CheckCircle className="w-3.5 h-3.5" /> Payé</span>
                              : log.payment_status === 'du'
                                ? <span className="inline-flex items-center gap-1 text-xs text-[#D97706] font-medium"><Clock className="w-3.5 h-3.5" /> Dû</span>
                                : <span className="text-xs text-[#6B7280]">Annulé</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Summary + actions */}
              <div className="p-6 border-t border-[#E2EAE5] space-y-4">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="bg-[#D4EDDA] rounded-xl p-3">
                    <div className="text-lg font-bold text-[#0B7439]">{fmt(calc.amountPaid)} F</div>
                    <div className="text-xs text-[#4A6B55]">Payé ({calc.paidDays}j)</div>
                  </div>
                  <div className="bg-[#FEF3C7] rounded-xl p-3">
                    <div className="text-lg font-bold text-[#D97706]">{fmt(calc.amountPending)} F</div>
                    <div className="text-xs text-[#92400E]">En attente ({calc.pendingDays}j)</div>
                  </div>
                  <div className="bg-[#F8FAF8] rounded-xl p-3">
                    <div className="text-lg font-bold text-[#1A2E22]">{fmt(calc.totalEarned)} F</div>
                    <div className="text-xs text-[#6B7280]">Total ({calc.totalDays}j)</div>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => window.print()}
                    className="flex items-center gap-2 px-4 py-2 border border-[#E2EAE5] rounded-xl text-sm text-[#4A6B55] hover:bg-[#F8FAF8] transition-colors">
                    <Printer className="w-4 h-4" />
                    Imprimer
                  </button>
                  {dueLogs.length > 0 && (
                    <button onClick={handlePayAll} disabled={detail.paying}
                      className="flex-1 flex items-center justify-center gap-2 py-2 bg-[#0B7439] text-white rounded-xl font-bold hover:bg-[#085c2d] disabled:opacity-50 transition-colors">
                      <CheckCircle className="w-4 h-4" />
                      {detail.paying ? 'Enregistrement...' : `Payer les jours en attente (${fmt(calc.amountPending)} F)`}
                    </button>
                  )}
                  {dueLogs.length === 0 && (
                    <div className="flex-1 text-center text-sm text-[#0B7439] font-medium py-2">
                      Tout est payé
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
