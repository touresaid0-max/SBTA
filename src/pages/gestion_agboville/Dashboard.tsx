import { useState, useEffect, useCallback } from 'react'
import {
  fetchBordereaux, fetchDailyConsolidation, formatCFA,
  type Bordereau, type DailyConsolidation,
} from '@/services/abg.service'
import { LayoutDashboard, FileText, CheckCircle2, AlertTriangle, TrendingUp } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function Dashboard() {
  const [bordereaux, setBordereaux] = useState<Bordereau[]>([])
  const [daily, setDaily] = useState<DailyConsolidation[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [b, d] = await Promise.all([
        fetchBordereaux(),
        fetchDailyConsolidation(),
      ])
      setBordereaux(b)
      setDaily(d)
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const recus = bordereaux.filter(b => b.status === 'recu').length
  const verifies = bordereaux.filter(b => b.status === 'verifie').length
  const ecarts = bordereaux.filter(b => b.status === 'ecart').length
  const totalRecettes = bordereaux.reduce((a, b) => a + Number(b.total_mt_ticket), 0)
  const totalResultats = bordereaux.reduce((a, b) => a + Number(b.total_solde), 0)
  const recent = bordereaux.slice(0, 5)

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1a2a22]">Tableau de bord</h1>
        <p className="text-sm mt-0.5 text-[#6B7280]">Vue d'ensemble de la ligne Agboville</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPICard icon={<FileText className="w-5 h-5" />} label="Bordereaux reçus" value={bordereaux.length.toString()} color="bg-blue-500" />
            <KPICard icon={<CheckCircle2 className="w-5 h-5" />} label="Vérifiés" value={verifies.toString()} color="bg-green-500" />
            <KPICard icon={<AlertTriangle className="w-5 h-5" />} label="En écart" value={ecarts.toString()} color="bg-orange-500" />
            <KPICard icon={<TrendingUp className="w-5 h-5" />} label="Recettes totales" value={formatCFA(totalRecettes)} color="bg-[#0B7439]" />
          </div>

          {/* Secondary KPIs */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
              <p className="text-xs text-[#6B7280] mb-1">Résultat net (solde)</p>
              <p className="text-2xl font-bold text-[#0B7439]">{formatCFA(totalResultats)}</p>
            </div>
            <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
              <p className="text-xs text-[#6B7280] mb-1">En attente de vérification</p>
              <p className="text-2xl font-bold text-blue-600">{recus}</p>
            </div>
            <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
              <p className="text-xs text-[#6B7280] mb-1">Jours avec données</p>
              <p className="text-2xl font-bold text-[#1a2a22]">{new Set(daily.map(d => d.date)).size}</p>
            </div>
          </div>

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
            <QuickLink to="/gestion-agboville/resultat-net" label="Résultat net" icon={<TrendingUp className="w-5 h-5" />} />
          </div>
        </>
      )}
    </div>
  )
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
