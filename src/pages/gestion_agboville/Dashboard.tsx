import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  fetchBordereaux, fetchDepenses, fetchGuichetSrcs, formatCFA,
  type Bordereau, type AbgDepense, type AbgGuichetSrc,
} from '@/services/abg.service'
import {
  LayoutDashboard, FileText, CheckCircle2, AlertTriangle, TrendingUp,
  Calendar, Send, Wallet, ChevronRight,
} from 'lucide-react'
import { Link } from 'react-router-dom'

type Period = 'jour' | 'semaine' | 'mois' | 'annee'

export default function Dashboard() {
  const [bordereaux, setBordereaux] = useState<Bordereau[]>([])
  const [depenses, setDepenses] = useState<AbgDepense[]>([])
  const [guichets, setGuichets] = useState<AbgGuichetSrc[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<Period>('jour')
  const [periodDate, setPeriodDate] = useState(new Date().toISOString().split('T')[0])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [b, d, g] = await Promise.all([
        fetchBordereaux(),
        fetchDepenses(),
        fetchGuichetSrcs(),
      ])
      setBordereaux(b)
      setDepenses(d)
      setGuichets(g)
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filteredBords = useMemo(() => {
    const ref = new Date(periodDate)
    return bordereaux.filter(b => matchPeriod(b.bordereau_date, period, ref))
  }, [bordereaux, period, periodDate])

  const filteredDepenses = useMemo(() => {
    const ref = new Date(periodDate)
    return depenses.filter(d => matchPeriod(d.date_depense, period, ref))
  }, [depenses, period, periodDate])

  const recus = filteredBords.filter(b => b.status === 'recu').length
  const verifies = filteredBords.filter(b => b.status === 'verifie').length
  const ecarts = filteredBords.filter(b => b.status === 'ecart').length
  const totalRecettes = filteredBords.reduce((a, b) => a + Number(b.total_mt_ticket), 0)
  const totalDepPR = filteredBords.reduce((a, b) => a + Number(b.total_depense_pr), 0)
  const totalAO = filteredDepenses.filter(d => d.type_depense === 'AO').reduce((a, d) => a + Number(d.montant), 0)
  const totalHAO = filteredDepenses.filter(d => d.type_depense === 'HAO').reduce((a, d) => a + Number(d.montant), 0)
  const totalResultat = filteredBords.reduce((a, b) => a + Number(b.total_solde), 0) - totalAO - totalHAO

  // Alertes
  const bordsNonVerifies = filteredBords.filter(b => b.status === 'recu').length
  const bordsEnEcart = filteredBords.filter(b => b.status === 'ecart').length
  const today = new Date().toISOString().split('T')[0]
  const guichetsSansRemontee = guichets.filter(g =>
    !bordereaux.some(b => b.guichet_src_id === g.id && b.bordereau_date === today)
  )
  const recent = bordereaux.slice(0, 5)

  const alerts = [
    ...(bordsNonVerifies > 0 ? [{ icon: AlertTriangle, color: 'text-orange-600', bg: 'bg-orange-50', msg: `${bordsNonVerifies} bordereau(x) non vérifié(s)`, link: '/gestion-agboville/bordereaux' }] : []),
    ...(bordsEnEcart > 0 ? [{ icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50', msg: `${bordsEnEcart} bordereau(x) en écart`, link: '/gestion-agboville/bordereaux' }] : []),
    ...(guichetsSansRemontee.length > 0 ? [{ icon: Calendar, color: 'text-blue-600', bg: 'bg-blue-50', msg: `${guichetsSansRemontee.length} guichet(s) sans remontée aujourd'hui`, link: '/gestion-agboville/bordereaux' }] : []),
  ]

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1a2a22]">Tableau de bord</h1>
          <p className="text-sm mt-0.5 text-[#6B7280]">Cockpit de pilotage — ligne Agboville</p>
        </div>
        <div className="flex gap-2 items-end">
          <div>
            <label className="text-xs text-[#6B7280] mb-1 block">Période</label>
            <select value={period} onChange={e => setPeriod(e.target.value as Period)}
              className="border border-[#E2EAE5] rounded-lg px-3 py-2 text-sm text-[#374151] focus:outline-none focus:border-[#0B7439]">
              <option value="jour">Jour</option>
              <option value="semaine">Semaine</option>
              <option value="mois">Mois</option>
              <option value="annee">Année</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-[#6B7280] mb-1 block">Date</label>
            <input type="date" value={periodDate} onChange={e => setPeriodDate(e.target.value)}
              className="border border-[#E2EAE5] rounded-lg px-3 py-2 text-sm text-[#374151] focus:outline-none focus:border-[#0B7439]" />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPICard icon={<FileText className="w-5 h-5" />} label="Bordereaux" value={filteredBords.length.toString()} color="bg-blue-500" />
            <KPICard icon={<CheckCircle2 className="w-5 h-5" />} label="Vérifiés" value={verifies.toString()} color="bg-green-500" />
            <KPICard icon={<AlertTriangle className="w-5 h-5" />} label="En écart" value={ecarts.toString()} color="bg-orange-500" />
            <KPICard icon={<TrendingUp className="w-5 h-5" />} label="Recettes" value={formatCFA(totalRecettes)} color="bg-[#0B7439]" />
          </div>

          {/* Synthesis */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
              <div className="flex items-center gap-2 mb-2">
                <Wallet className="w-4 h-4 text-[#6B7280]" />
                <p className="text-xs text-[#6B7280]">Dépenses P/R</p>
              </div>
              <p className="text-xl font-bold text-[#1a2a22]">{formatCFA(totalDepPR)}</p>
            </div>
            <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
              <div className="flex items-center gap-2 mb-2">
                <Wallet className="w-4 h-4 text-blue-600" />
                <p className="text-xs text-[#6B7280]">Dépenses AO + HAO</p>
              </div>
              <p className="text-xl font-bold text-blue-600">{formatCFA(totalAO + totalHAO)}</p>
            </div>
            <div className="bg-[#0B7439]/5 rounded-2xl border border-[#0B7439]/20 p-5">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-[#0B7439]" />
                <p className="text-xs text-[#6B7280]">Résultat net</p>
              </div>
              <p className="text-xl font-bold text-[#0B7439]">{formatCFA(totalResultat)}</p>
            </div>
          </div>

          {/* Alerts */}
          {alerts.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-[#4A6B55]">Alertes</h3>
              {alerts.map((a, i) => {
                const Icon = a.icon
                return (
                  <Link key={i} to={a.link}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${a.bg} border-transparent hover:opacity-80 transition-opacity`}>
                    <Icon className={`w-5 h-5 ${a.color}`} />
                    <span className={`text-sm font-medium ${a.color}`}>{a.msg}</span>
                    <ChevronRight className="w-4 h-4 ml-auto text-gray-400" />
                  </Link>
                )
              })}
            </div>
          )}

          {/* Recent bordereaux */}
          <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E2EAE5] flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#4A6B55]">Bordereaux récents</h3>
              <Link to="/gestion-agboville/bordereaux" className="text-xs text-[#0B7439] hover:underline">Voir tout →</Link>
            </div>
            {recent.length === 0 ? (
              <div className="p-8 text-center">
                <FileText className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-[#9CA3AF]">Aucun bordereau pour le moment</p>
              </div>
            ) : (
              <div className="divide-y divide-[#E2EAE5]">
                {recent.map(b => (
                  <Link key={b.id} to="/gestion-agboville/bordereaux"
                    className="flex items-center justify-between px-4 py-3 hover:bg-[#F8FAF8] transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${b.status === 'verifie' ? 'bg-green-500' : b.status === 'ecart' ? 'bg-orange-500' : 'bg-blue-500'}`} />
                      <div>
                        <p className="text-sm font-medium text-[#374151]">{b.gare_label} · {b.societe_code}</p>
                        <p className="text-xs text-[#6B7280]">{new Date(b.bordereau_date).toLocaleDateString('fr-FR')}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-[#1a2a22]">{formatCFA(b.total_mt_ticket)}</p>
                      <p className="text-xs text-[#6B7280]">{b.source === 'auto' ? 'Auto' : 'Import'}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Quick links */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <QuickLink to="/gestion-agboville/bordereaux" label="Bordereaux" icon={<FileText className="w-5 h-5" />} />
            <QuickLink to="/gestion-agboville/comptes-journaliers" label="Comptes journaliers" icon={<LayoutDashboard className="w-5 h-5" />} />
            <QuickLink to="/gestion-agboville/points" label="Points" icon={<TrendingUp className="w-5 h-5" />} />
            <QuickLink to="/gestion-agboville/resultat-net" label="Résultat net & dispatch" icon={<Send className="w-5 h-5" />} />
          </div>
        </>
      )}
    </div>
  )
}

function matchPeriod(dateStr: string, period: Period, ref: Date): boolean {
  const d = new Date(dateStr)
  if (period === 'jour') {
    return d.toISOString().split('T')[0] === ref.toISOString().split('T')[0]
  } else if (period === 'semaine') {
    const getWeek = (dt: Date) => {
      const onejan = new Date(dt.getFullYear(), 0, 1)
      return Math.ceil(((dt.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7)
    }
    return d.getFullYear() === ref.getFullYear() && getWeek(d) === getWeek(ref)
  } else if (period === 'mois') {
    return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth()
  } else {
    return d.getFullYear() === ref.getFullYear()
  }
}

function KPICard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="bg-white rounded-2xl border border-[#E2EAE5] p-4">
      <div className={`w-10 h-10 rounded-xl ${color} text-white flex items-center justify-center mb-3`}>
        {icon}
      </div>
      <p className="text-xs text-[#6B7280]">{label}</p>
      <p className="text-xl font-bold text-[#1a2a22] mt-0.5">{value}</p>
    </div>
  )
}

function QuickLink({ to, label, icon }: { to: string; label: string; icon: React.ReactNode }) {
  return (
    <Link to={to} className="bg-white rounded-xl border border-[#E2EAE5] p-3 flex items-center gap-2 hover:border-[#0B7439] hover:bg-[#F8FAF8] transition-colors">
      <span className="text-[#0B7439]">{icon}</span>
      <span className="text-sm font-medium text-[#374151]">{label}</span>
    </Link>
  )
}
