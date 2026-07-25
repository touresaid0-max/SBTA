import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bus, FileCheck, FileWarning, FileX, Wallet, Bell, Plus, FileText,
  Tag, CreditCard, RefreshCw, ArrowRight,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { formatCurrency } from '@/utils/formatCurrency'
import {
  fetchDocuments, fetchVehicles, buildAlerts, effectiveStatus,
} from '@/services/logistics.service'
import type { VehicleDocument, Vehicle, DocumentAlert } from '@/types/logistics.types'
import ProbationAlerts from './ProbationAlerts'

const LEVEL_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  green:  { bg: '#E7F6EC', text: '#0B7439', dot: '#16A34A' },
  orange: { bg: '#FEF3C7', text: '#B45309', dot: '#F59E0B' },
  red:    { bg: '#FEE2E2', text: '#B91C1C', dot: '#DC2626' },
  blue:   { bg: '#DBEAFE', text: '#1D4ED8', dot: '#2563EB' },
  gray:   { bg: '#F3F4F6', text: '#6B7280', dot: '#9CA3AF' },
}

export default function LogistiqueDashboard() {
  const navigate = useNavigate()
  const [documents, setDocuments] = useState<VehicleDocument[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([fetchDocuments(), fetchVehicles()])
      .then(([docs, vs]) => { setDocuments(docs); setVehicles(vs) })
      .catch((err) => { console.error(err); toast.error('Erreur lors du chargement') })
      .finally(() => setLoading(false))
  }, [])

  const stats = useMemo(() => {
    const current = documents.filter(d => d.is_current)
    const valides = current.filter(d => effectiveStatus(d) === 'valide')
    const proches = current.filter(d => effectiveStatus(d) === 'proche_echeance')
    const expires = current.filter(d => effectiveStatus(d) === 'expire')
    const montantTotal = current.reduce((s, d) => s + Number(d.amount ?? 0), 0)

    const busProvisoire = vehicles.filter(v => v.plate_status === 'provisoire' || v.plate_status === 'attente_carte_grise')
    const busCarteGrise = vehicles.filter(v => v.plate_status === 'carte_grise_disponible' || v.plate_status === 'definitive')

    const now = new Date()
    const renouvellements = proches.length + expires.length

    return {
      totalBus: vehicles.length,
      busProvisoire: busProvisoire.length,
      busCarteGrise: busCarteGrise.length,
      valides: valides.length,
      proches: proches.length,
      expires: expires.length,
      montantTotal,
      renouvellements,
      mois: now.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
    }
  }, [documents, vehicles])

  const alerts: DocumentAlert[] = useMemo(() => buildAlerts(documents), [documents])

  const kpis = [
    { label: 'Total bus', value: stats.totalBus, icon: Bus, color: '#0B7439', bg: '#E7F6EC' },
    { label: 'Bus plaque provisoire', value: stats.busProvisoire, icon: Tag, color: '#B45309', bg: '#FEF3C7' },
    { label: 'Bus carte grise', value: stats.busCarteGrise, icon: CreditCard, color: '#1D4ED8', bg: '#DBEAFE' },
    { label: 'Documents valides', value: stats.valides, icon: FileCheck, color: '#0B7439', bg: '#E7F6EC' },
    { label: 'Proches échéance', value: stats.proches, icon: FileWarning, color: '#B45309', bg: '#FEF3C7' },
    { label: 'Documents expirés', value: stats.expires, icon: FileX, color: '#B91C1C', bg: '#FEE2E2' },
    { label: 'Montant total services', value: formatCurrency(stats.montantTotal), icon: Wallet, color: '#1D4ED8', bg: '#DBEAFE' },
    { label: 'Renouvellements à prévoir', value: stats.renouvellements, icon: RefreshCw, color: '#6B7280', bg: '#F3F4F6' },
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-10 h-10 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1A2E22]">Tableau de bord Logistique</h1>
          <p className="text-sm text-[#6B7280] mt-1">Gestion logistique & documents véhicules</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigate('/logistique/documents?new=1')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0B7439] text-white text-sm font-medium hover:bg-[#095e2f] transition-colors"
          >
            <Plus className="w-4 h-4" /> Nouveau document
          </button>
          <button
            onClick={() => navigate('/logistique/reports')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-[#E2EAE5] text-[#4A6B55] text-sm font-medium hover:bg-[#F8FAF8] transition-colors"
          >
            <FileText className="w-4 h-4" /> Rapports
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(kpi => {
          const Icon = kpi.icon
          return (
            <div key={kpi.label} className="bg-white rounded-2xl border border-[#E2EAE5] p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: kpi.bg }}>
                <Icon className="w-6 h-6" style={{ color: kpi.color }} />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-[#6B7280] font-medium">{kpi.label}</p>
                <p className="text-xl font-bold text-[#1A2E22] truncate">{kpi.value}</p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Périodes d'essai à traiter */}
      <ProbationAlerts />

      <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2EAE5]">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-[#0B7439]" />
            <h2 className="font-semibold text-[#1A2E22]">Alertes du mois — {stats.mois}</h2>
            {alerts.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-[#FEE2E2] text-[#B91C1C] font-semibold animate-pulse">
                {alerts.length}
              </span>
            )}
          </div>
        </div>
        <div className="divide-y divide-[#F0F4F1] max-h-[460px] overflow-y-auto">
          {alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-[#6B7280]">
              <FileCheck className="w-10 h-10 text-[#16A34A] mb-2" />
              <p className="text-sm">Aucune alerte. Tous les documents sont à jour.</p>
            </div>
          ) : (
            alerts.map(a => {
              const c = LEVEL_COLORS[a.level]
              return (
                <button
                  key={a.document.id}
                  onClick={() => a.document.vehicle_id && navigate(`/logistique/vehicles/${a.document.vehicle_id}`)}
                  className="w-full flex items-center gap-3 px-5 py-3 hover:bg-[#F8FAF8] transition-colors text-left"
                >
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 animate-pulse" style={{ backgroundColor: c.dot }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#1A2E22] truncate">{a.message}</p>
                    <p className="text-xs text-[#8AA898]">
                      {a.document.provider_name || '—'} · échéance {a.document.expiry_date ? new Date(a.document.expiry_date).toLocaleDateString('fr-FR') : '—'}
                    </p>
                  </div>
                  <span className="text-xs font-semibold px-2 py-1 rounded-lg" style={{ backgroundColor: c.bg, color: c.text }}>
                    {a.threshold === 0 ? 'Échéance' : 'J-' + a.threshold}
                  </span>
                  <ArrowRight className="w-4 h-4 text-[#9CA3AF] flex-shrink-0" />
                </button>
              )
            })
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
        <h3 className="text-sm font-semibold text-[#1A2E22] mb-3">Légende des alertes</h3>
        <div className="flex flex-wrap gap-5">
          {[
            { c: 'green',  l: 'Document valide' },
            { c: 'orange', l: 'Échéance proche' },
            { c: 'red',    l: 'Document expiré' },
            { c: 'blue',   l: 'Renouvelé' },
            { c: 'gray',   l: 'Inactif / remplacé' },
          ].map(item => (
            <div key={item.c} className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: LEVEL_COLORS[item.c].dot }} />
              <span className="text-sm text-[#4A6B55]">{item.l}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
