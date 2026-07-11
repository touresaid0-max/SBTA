import { useState, useEffect, useCallback } from 'react'
import { MessageSquare, Calendar, Hash, Banknote, TrendingUp, Loader2 } from 'lucide-react'
import { format, startOfDay, endOfDay, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear, endOfYear } from 'date-fns'
import { fr } from 'date-fns/locale'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/services/supabase'

const SMS_UNIT_COST = 100

type PeriodType = 'daily' | 'monthly' | 'quarterly' | 'yearly'

const PERIOD_OPTIONS: { value: PeriodType; label: string }[] = [
  { value: 'daily', label: 'Journalier' },
  { value: 'monthly', label: 'Mensuel' },
  { value: 'quarterly', label: 'Trimestriel' },
  { value: 'yearly', label: 'Annuel' },
]

function getDateRange(period: PeriodType, refDate: Date): { from: string; to: string } {
  switch (period) {
    case 'daily':
      return { from: startOfDay(refDate).toISOString(), to: endOfDay(refDate).toISOString() }
    case 'monthly':
      return { from: startOfMonth(refDate).toISOString(), to: endOfMonth(refDate).toISOString() }
    case 'quarterly':
      return { from: startOfQuarter(refDate).toISOString(), to: endOfQuarter(refDate).toISOString() }
    case 'yearly':
      return { from: startOfYear(refDate).toISOString(), to: endOfYear(refDate).toISOString() }
  }
}

function getPeriodLabel(period: PeriodType, refDate: Date): string {
  switch (period) {
    case 'daily':
      return format(refDate, 'EEEE dd MMMM yyyy', { locale: fr })
    case 'monthly':
      return format(refDate, 'MMMM yyyy', { locale: fr })
    case 'quarterly': {
      const q = Math.ceil((refDate.getMonth() + 1) / 3)
      return `${q}e trimestre ${refDate.getFullYear()}`
    }
    case 'yearly':
      return `Annee ${refDate.getFullYear()}`
  }
}

export default function SmsFeesReport() {
  const { user } = useAuthStore()
  const [period, setPeriod] = useState<PeriodType>('daily')
  const [refDate, setRefDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [loading, setLoading] = useState(true)
  const [operationCount, setOperationCount] = useState(0)
  const [totalRevenue, setTotalRevenue] = useState(0)

  const stationId = user?.station_id

  const fetchData = useCallback(async () => {
    if (!stationId) return
    setLoading(true)

    const ref = new Date(refDate)
    const { from, to } = getDateRange(period, ref)

    const { data, error } = await supabase
      .from('parcels')
      .select('id, total_amount')
      .eq('origin_station_id', stationId)
      .gte('created_at', from)
      .lte('created_at', to)

    if (!error && data) {
      setOperationCount(data.length)
      setTotalRevenue(data.reduce((sum, p) => sum + (p.total_amount || 0), 0))
    } else {
      setOperationCount(0)
      setTotalRevenue(0)
    }
    setLoading(false)
  }, [stationId, period, refDate])

  useEffect(() => { fetchData() }, [fetchData])

  const totalSmsFees = operationCount * SMS_UNIT_COST

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-blue-100 rounded-lg">
          <MessageSquare className="w-6 h-6 text-blue-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Rapport des Frais SMS</h1>
          <p className="text-sm text-gray-500">Suivi des frais SMS par operation courrier (100 FCFA / operation)</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border p-4 shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Periode</label>
            <select
              value={period}
              onChange={e => setPeriod(e.target.value as PeriodType)}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {PERIOD_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Date de reference</label>
            <input
              type="date"
              value={refDate}
              onChange={e => setRefDate(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>
        <div className="mt-3 text-sm text-gray-600 font-medium capitalize">
          {getPeriodLabel(period, new Date(refDate))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              icon={<Banknote className="w-5 h-5 text-green-600" />}
              iconBg="bg-green-100"
              label="Recettes"
              value={`${totalRevenue.toLocaleString('fr-FR')} FCFA`}
            />
            <KpiCard
              icon={<Hash className="w-5 h-5 text-blue-600" />}
              iconBg="bg-blue-100"
              label="Nombre d'operations"
              value={operationCount.toString()}
            />
            <KpiCard
              icon={<Calendar className="w-5 h-5 text-amber-600" />}
              iconBg="bg-amber-100"
              label="Cout unitaire SMS"
              value={`${SMS_UNIT_COST.toLocaleString('fr-FR')} FCFA`}
            />
            <KpiCard
              icon={<TrendingUp className="w-5 h-5 text-red-600" />}
              iconBg="bg-red-100"
              label="Total Frais SMS"
              value={`${totalSmsFees.toLocaleString('fr-FR')} FCFA`}
              subtitle={`${operationCount} x ${SMS_UNIT_COST} FCFA`}
            />
          </div>

          {/* Summary Table */}
          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b bg-gray-50">
              <h2 className="font-semibold text-gray-800">Resume</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-5 py-3 font-medium text-gray-600">Indicateur</th>
                    <th className="px-5 py-3 font-medium text-gray-600 text-right">Valeur</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <tr>
                    <td className="px-5 py-3 text-gray-700">Recettes totales</td>
                    <td className="px-5 py-3 text-right font-medium text-gray-900">{totalRevenue.toLocaleString('fr-FR')} FCFA</td>
                  </tr>
                  <tr>
                    <td className="px-5 py-3 text-gray-700">Nombre d'operations courrier</td>
                    <td className="px-5 py-3 text-right font-medium text-gray-900">{operationCount}</td>
                  </tr>
                  <tr>
                    <td className="px-5 py-3 text-gray-700">Cout unitaire SMS</td>
                    <td className="px-5 py-3 text-right font-medium text-gray-900">{SMS_UNIT_COST.toLocaleString('fr-FR')} FCFA</td>
                  </tr>
                  <tr className="bg-blue-50">
                    <td className="px-5 py-3 text-blue-800 font-semibold">Total Frais SMS</td>
                    <td className="px-5 py-3 text-right font-bold text-blue-800">
                      {totalSmsFees.toLocaleString('fr-FR')} FCFA
                      <span className="ml-2 text-xs font-normal text-blue-600">({operationCount} x {SMS_UNIT_COST} FCFA)</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function KpiCard({ icon, iconBg, label, value, subtitle }: {
  icon: React.ReactNode
  iconBg: string
  label: string
  value: string
  subtitle?: string
}) {
  return (
    <div className="bg-white rounded-xl border p-4 shadow-sm">
      <div className="flex items-center gap-3 mb-2">
        <div className={`p-2 rounded-lg ${iconBg}`}>{icon}</div>
        <span className="text-xs text-gray-500 font-medium">{label}</span>
      </div>
      <p className="text-xl font-bold text-gray-900">{value}</p>
      {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
    </div>
  )
}
