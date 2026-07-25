import { useEffect, useMemo, useState } from 'react'
import { Bell, Clock, UserCheck, AlertTriangle, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  fetchBusesWithDrivers, treatProbation,
} from '@/services/logistiqueDrivers.service'
import type {
  LogistiqueBusWithDrivers, LogistiqueDriver,
} from '@/services/logistiqueDrivers.service'

const PROBATION_ALERT_DAYS = 10

interface ProbationAlert {
  driver: LogistiqueDriver
  busRegistration: string | null
  daysRemaining: number
  endDate: string
}

function buildProbationAlerts(
  buses: LogistiqueBusWithDrivers[],
  unassigned: LogistiqueDriver[],
): ProbationAlert[] {
  const now = new Date()
  now.setHours(0, 0, 0, 0)

  const driverToBus = new Map<string, string>()
  for (const b of buses) {
    for (const d of b.drivers) {
      driverToBus.set(`${d.source_table}:${d.id}`, b.registration_number)
    }
  }

  const allDrivers: LogistiqueDriver[] = [
    ...buses.flatMap(b => b.drivers),
    ...unassigned,
  ]

  const alerts: ProbationAlert[] = []
  for (const d of allDrivers) {
    if (!d.probation_end_date || d.probation_treated_at) continue
    const end = new Date(d.probation_end_date)
    end.setHours(0, 0, 0, 0)
    const diffMs = end.getTime() - now.getTime()
    const daysRemaining = Math.round(diffMs / 86_400_000)
    // Afficher l'alerte 10 jours avant la fin, jusqu'à la fin de la période.
    // Après la fin, le chauffeur n'apparaît plus dans les alertes.
    if (daysRemaining > PROBATION_ALERT_DAYS) continue
    if (daysRemaining < 0) continue
    alerts.push({
      driver: d,
      busRegistration: driverToBus.get(`${d.source_table}:${d.id}`) ?? null,
      daysRemaining,
      endDate: d.probation_end_date,
    })
  }

  return alerts.sort((a, b) => a.daysRemaining - b.daysRemaining)
}

export default function ProbationAlerts() {
  const [buses, setBuses] = useState<LogistiqueBusWithDrivers[]>([])
  const [unassigned, setUnassigned] = useState<LogistiqueDriver[]>([])
  const [loading, setLoading] = useState(true)
  const [treatingId, setTreatingId] = useState<string | null>(null)

  const loadData = () => {
    setLoading(true)
    fetchBusesWithDrivers()
      .then(data => {
        setBuses(data.buses)
        setUnassigned(data.unassignedDrivers)
      })
      .catch(err => {
        console.error(err)
        toast.error('Erreur lors du chargement des alertes période d\'essai')
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadData() }, [])

  const alerts = useMemo(
    () => buildProbationAlerts(buses, unassigned),
    [buses, unassigned],
  )

  const handleTreat = async (driver: LogistiqueDriver) => {
    setTreatingId(driver.id)
    try {
      await treatProbation({ id: driver.id, source_table: driver.source_table })
      toast.success('Période d\'essai traitée')
      loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur lors du traitement')
    } finally {
      setTreatingId(null)
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-5 h-5 text-[#0B7439]" />
          <h2 className="font-semibold text-[#1A2E22]">Périodes d'essai à traiter</h2>
        </div>
        <div className="flex items-center justify-center h-24">
          <div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2EAE5]">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-[#0B7439]" />
          <h2 className="font-semibold text-[#1A2E22]">Périodes d'essai à traiter</h2>
          {alerts.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-[#FEF3C7] text-[#B45309] font-semibold animate-pulse">
              {alerts.length}
            </span>
          )}
        </div>
      </div>

      <div className="divide-y divide-[#F0F4F1] max-h-[420px] overflow-y-auto">
        {alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-[#6B7280]">
            <CheckCircle2 className="w-10 h-10 text-[#16A34A] mb-2" />
            <p className="text-sm">Aucune période d'essai à traiter.</p>
          </div>
        ) : (
          alerts.map(a => {
            const urgent = a.daysRemaining <= 3
            const color = urgent
              ? { bg: '#FEE2E2', text: '#B91C1C', dot: '#DC2626' }
              : { bg: '#FEF3C7', text: '#B45309', dot: '#F59E0B' }
            return (
              <div key={`${a.driver.source_table}:${a.driver.id}`} className="px-5 py-3">
                <div className="flex items-start gap-3">
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5 animate-pulse"
                    style={{ backgroundColor: color.dot }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#1A2E22] truncate">
                      {a.driver.full_name}
                    </p>
                    <div className="text-xs text-[#8AA898] mt-1 space-y-0.5">
                      <p>Matricule : {a.driver.employee_id ?? '—'}</p>
                      <p>Société : {a.driver.company_name ?? '—'}</p>
                      <p>Bus affecté : {a.busRegistration ?? 'Non affecté'}</p>
                      <p>
                        Fin période d'essai :{' '}
                        {new Date(a.endDate).toLocaleDateString('fr-FR')}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <span
                      className="text-xs font-semibold px-2 py-1 rounded-lg"
                      style={{ backgroundColor: color.bg, color: color.text }}
                    >
                      {a.daysRemaining === 0 ? 'Dernier jour' : 'J-' + a.daysRemaining}
                    </span>
                    <button
                      onClick={() => handleTreat(a.driver)}
                      disabled={treatingId === a.driver.id}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#0B7439] text-white text-xs font-medium hover:bg-[#095e2f] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      {treatingId === a.driver.id ? 'Traitement…' : 'Traiter'}
                    </button>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
