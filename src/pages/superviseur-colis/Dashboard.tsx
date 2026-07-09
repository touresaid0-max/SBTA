import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Package, TrendingUp, Truck, MapPin, Banknote, RefreshCw, Eye, BarChart2, Calendar, ChevronDown, ChevronUp, X } from 'lucide-react'
import { format, startOfDay, startOfMonth, startOfQuarter, startOfYear } from 'date-fns'
import { fr } from 'date-fns/locale'
import toast from 'react-hot-toast'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { fetchParcelKPIs, fetchAllParcels } from '@/services/parcel.service'
import type { Parcel, ParcelKPIs, ParcelAgencyStat, ParcelStatus } from '@/types/parcel.types'

type Period = 'today' | 'month' | 'quarter' | 'year'

const PERIOD_LABELS: Record<Period, string> = {
  today: 'Journalier',
  month: 'Mensuel',
  quarter: 'Trimestriel',
  year: 'Annuel',
}

const STATUS_CONFIG: Record<ParcelStatus, { label: string; color: string; bg: string }> = {
  enregistre:    { label: 'Enregistr\u00e9',    color: '#0B7439', bg: '#d4edda' },
  mis_en_paquet: { label: 'Mis en paquet', color: '#1D6FA4', bg: '#DBEAFE' },
  expedie:       { label: 'Exp\u00e9di\u00e9',       color: '#D97706', bg: '#FEF3C7' },
  arrive:        { label: 'Arriv\u00e9',        color: '#1D6FA4', bg: '#DBEAFE' },
  livre:         { label: 'Retir\u00e9',        color: '#0B7439', bg: '#d4edda' },
  retourne:      { label: 'Retourn\u00e9',      color: '#92400E', bg: '#FEF3C7' },
  perdu:         { label: 'Perdu',         color: '#AF3029', bg: '#f8d7d5' },
}

export default function SuperviseurColisDashboard() {
  const navigate = useNavigate()
  const [kpis, setKpis] = useState<ParcelKPIs | null>(null)
  const [parcels, setParcels] = useState<Parcel[]>([])
  const [agencyStats, setAgencyStats] = useState<ParcelAgencyStat[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<Period>('today')
  const [expandedAgency, setExpandedAgency] = useState<string | null>(null)
  const today = format(new Date(), 'dd/MM/yyyy', { locale: fr })

  function getCutoff(selectedPeriod: Period): Date {
    const now = new Date()
    switch (selectedPeriod) {
      case 'today':   return startOfDay(now)
      case 'month':   return startOfMonth(now)
      case 'quarter': return startOfQuarter(now)
      case 'year':    return startOfYear(now)
    }
  }

  const computeAgencyStats = useCallback((allParcels: Parcel[], selectedPeriod: Period) => {
    const cutoff = getCutoff(selectedPeriod)
    const filtered = allParcels.filter(p => new Date(p.registered_at) >= cutoff)

    const map: Record<string, ParcelAgencyStat> = {}
    for (const p of filtered) {
      const sid = p.origin_station_id
      if (!map[sid]) {
        map[sid] = {
          station_id:       sid,
          station_name:     (p as any).origin_station?.name ?? p.origin_station_name ?? '\u2014',
          company_name:     (p as any).companies?.name ?? p.company_name ?? '\u2014',
          total_registered: 0,
          total_packaged:   0,
          total_shipped:    0,
          total_arrived:    0,
          total_delivered:  0,
          total_revenue:    0,
          period_revenue:   0,
        }
      }
      map[sid].total_registered++
      if (['mis_en_paquet','expedie','arrive','livre'].includes(p.status)) map[sid].total_packaged++
      if (['expedie','arrive','livre'].includes(p.status)) map[sid].total_shipped++
      if (['arrive','livre'].includes(p.status)) map[sid].total_arrived++
      if (p.status === 'livre') map[sid].total_delivered++
      map[sid].period_revenue += Number(p.total_amount ?? 0)
    }

    for (const p of allParcels) {
      if (map[p.origin_station_id]) {
        map[p.origin_station_id].total_revenue += Number(p.total_amount ?? 0)
      }
    }

    return Object.values(map).sort((a, b) => b.period_revenue - a.period_revenue)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [k, all] = await Promise.all([fetchParcelKPIs(), fetchAllParcels()])
      setKpis(k)
      setParcels(all)
      setAgencyStats(computeAgencyStats(all, period))
    } catch (e: any) {
      toast.error('Erreur chargement donn\u00e9es')
    } finally {
      setLoading(false)
    }
  }, [period, computeAgencyStats])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (parcels.length > 0) {
      setAgencyStats(computeAgencyStats(parcels, period))
    }
  }, [period, parcels, computeAgencyStats])

  const barData = agencyStats.slice(0, 8).map(s => ({
    name: s.station_name.length > 12 ? s.station_name.slice(0, 12) + '\u2026' : s.station_name,
    CA: Math.round(s.period_revenue / 1000),
    enreg: s.total_registered,
  }))

  function getAgencyParcels(stationId: string): Parcel[] {
    const cutoff = getCutoff(period)
    return parcels.filter(p => p.origin_station_id === stationId && new Date(p.registered_at) >= cutoff)
  }

  return (
    <div className="p-6 space-y-6" style={{ backgroundColor: 'var(--bg-subtle)', minHeight: '100vh' }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Supervision Courrier</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>SBTA Holding — {today}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
            {(['today', 'month', 'quarter', 'year'] as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className="px-3 py-2 text-xs font-medium transition-colors"
                style={{
                  backgroundColor: period === p ? '#0B7439' : 'var(--surface)',
                  color: period === p ? '#fff' : 'var(--text-secondary)',
                }}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
          <button
            onClick={load}
            className="p-2 rounded-lg border"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      {kpis && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            { label: "Enregistrés aujourd'hui", value: kpis.total_today, icon: <Package className="w-5 h-5" />, color: '#0B7439', bg: '#d4edda' },
            { label: 'En transit', value: kpis.total_en_transit, icon: <Truck className="w-5 h-5" />, color: '#D97706', bg: '#FEF3C7' },
            { label: 'Arrivés', value: kpis.total_arrived, icon: <MapPin className="w-5 h-5" />, color: '#1D6FA4', bg: '#DBEAFE' },
            { label: 'Retirés', value: kpis.total_delivered, icon: <TrendingUp className="w-5 h-5" />, color: '#0B7439', bg: '#d4edda' },
            { label: `CA ${PERIOD_LABELS[period].toLowerCase()}`, value: agencyStats.reduce((s, a) => s + a.period_revenue, 0).toLocaleString('fr-CI') + ' F', icon: <Banknote className="w-5 h-5" />, color: '#0B7439', bg: '#f0faf4' },
          ].map(card => (
            <div key={card.label} className="rounded-xl p-4 flex items-center gap-3" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: card.bg, color: card.color }}>
                {card.icon}
              </div>
              <div>
                <p className="text-xs leading-tight" style={{ color: 'var(--text-muted)' }}>{card.label}</p>
                <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{card.value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Charts */}
      {barData.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h3 className="font-semibold text-sm mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <BarChart2 className="w-4 h-4" style={{ color: '#0B7439' }} />
              CA par agence (milliers FCFA)
            </h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => [v + 'k FCFA', 'CA']} />
                <Bar dataKey="CA" fill="#0B7439" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h3 className="font-semibold text-sm mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <Calendar className="w-4 h-4" style={{ color: '#1D6FA4' }} />
              Enregistrements par agence
            </h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => [v, 'Courriers']} />
                <Bar dataKey="enreg" fill="#1D6FA4" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Agency Table — Détail par agence */}
      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
          <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>D\u00e9tail par agence</h2>
          <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: '#d4edda', color: '#0B7439' }}>
            {agencyStats.length} agence{agencyStats.length > 1 ? 's' : ''}
          </span>
        </div>
        {loading ? (
          <div className="py-12 flex justify-center">
            <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#0B7439', borderTopColor: 'transparent' }} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                  {['AGENCE', 'ENREGISTR\u00c9S', 'EN PAQUET', 'EXP\u00c9DI\u00c9S', 'ARRIV\u00c9S', 'RETIR\u00c9S', 'CA P\u00c9RIODE', 'D\u00c9TAIL'].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-semibold text-xs" style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {agencyStats.map(stat => (
                  <React.Fragment key={stat.station_id}>
                    <tr className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>
                        {stat.station_name}
                        <p className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>{stat.company_name}</p>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: '#d4edda', color: '#0B7439' }}>
                          {stat.total_registered}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: '#DBEAFE', color: '#1D6FA4' }}>
                          {stat.total_packaged}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: '#FEF3C7', color: '#D97706' }}>
                          {stat.total_shipped}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: '#DBEAFE', color: '#1D6FA4' }}>
                          {stat.total_arrived}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: '#d4edda', color: '#0B7439' }}>
                          {stat.total_delivered}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-semibold" style={{ color: '#0B7439' }}>
                        {stat.period_revenue.toLocaleString('fr-CI')} F
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setExpandedAgency(expandedAgency === stat.station_id ? null : stat.station_id)}
                          className="p-1.5 rounded hover:bg-gray-100 transition-colors"
                          title="Voir d\u00e9tail"
                        >
                          {expandedAgency === stat.station_id ? (
                            <ChevronUp className="w-4 h-4" style={{ color: '#0B7439' }} />
                          ) : (
                            <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                          )}
                        </button>
                      </td>
                    </tr>
                    {/* Expanded detail rows */}
                    {expandedAgency === stat.station_id && (
                      <tr>
                        <td colSpan={8} className="px-0 py-0">
                          <div className="border-t" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)' }}>
                            <div className="px-4 py-3 flex items-center justify-between">
                              <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                                Courriers de {stat.station_name} — {PERIOD_LABELS[period]}
                              </span>
                              <button
                                onClick={() => setExpandedAgency(null)}
                                className="p-1 rounded hover:bg-gray-200"
                              >
                                <X className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                              </button>
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr style={{ backgroundColor: 'var(--surface)' }}>
                                    <th className="px-4 py-2 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>CODE</th>
                                    <th className="px-4 py-2 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>EXP\u00c9DITEUR</th>
                                    <th className="px-4 py-2 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>DESTINATAIRE</th>
                                    <th className="px-4 py-2 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>DESTINATION</th>
                                    <th className="px-4 py-2 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>MONTANT</th>
                                    <th className="px-4 py-2 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>STATUT</th>
                                    <th className="px-4 py-2 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>DATE</th>
                                    <th className="px-4 py-2 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>VOIR</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                                  {getAgencyParcels(stat.station_id).slice(0, 20).map(p => {
                                    const psc = STATUS_CONFIG[p.status]
                                    return (
                                      <tr key={p.id} className="hover:bg-white transition-colors">
                                        <td className="px-4 py-2 font-mono font-bold" style={{ color: '#0B7439' }}>{p.parcel_code}</td>
                                        <td className="px-4 py-2" style={{ color: 'var(--text-primary)' }}>{p.sender_name}</td>
                                        <td className="px-4 py-2" style={{ color: 'var(--text-primary)' }}>{p.recipient_name}</td>
                                        <td className="px-4 py-2" style={{ color: 'var(--text-secondary)' }}>{p.destination_station_name}</td>
                                        <td className="px-4 py-2 font-semibold" style={{ color: '#0B7439' }}>{Number(p.total_amount ?? 0).toLocaleString('fr-CI')} F</td>
                                        <td className="px-4 py-2">
                                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: psc.bg, color: psc.color }}>{psc.label}</span>
                                        </td>
                                        <td className="px-4 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{format(new Date(p.registered_at), 'dd/MM/yy HH:mm', { locale: fr })}</td>
                                        <td className="px-4 py-2">
                                          <button
                                            onClick={() => navigate(`/superviseur-colis/parcels/${p.id}`)}
                                            className="p-1 rounded hover:bg-gray-200"
                                            title="Voir d\u00e9tail"
                                          >
                                            <Eye className="w-3.5 h-3.5" style={{ color: '#0B7439' }} />
                                          </button>
                                        </td>
                                      </tr>
                                    )
                                  })}
                                  {getAgencyParcels(stat.station_id).length === 0 && (
                                    <tr>
                                      <td colSpan={8} className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                                        Aucun courrier pour cette p\u00e9riode
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                            {getAgencyParcels(stat.station_id).length > 20 && (
                              <div className="px-4 py-2 text-center border-t" style={{ borderColor: 'var(--border)' }}>
                                <button
                                  onClick={() => navigate('/superviseur-colis/parcels')}
                                  className="text-xs font-medium underline"
                                  style={{ color: '#0B7439' }}
                                >
                                  Voir tous les {getAgencyParcels(stat.station_id).length} courriers
                                </button>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
                {agencyStats.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                      Aucune donn\u00e9e pour cette p\u00e9riode
                    </td>
                  </tr>
                )}
              </tbody>
              {agencyStats.length > 0 && (
                <tfoot>
                  <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                    <td className="px-4 py-3 font-bold text-xs" style={{ color: 'var(--text-primary)' }}>TOTAL</td>
                    <td className="px-4 py-3 text-center font-bold text-xs" style={{ color: '#0B7439' }}>
                      {agencyStats.reduce((s, a) => s + a.total_registered, 0)}
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-xs" style={{ color: '#1D6FA4' }}>
                      {agencyStats.reduce((s, a) => s + a.total_packaged, 0)}
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-xs" style={{ color: '#D97706' }}>
                      {agencyStats.reduce((s, a) => s + a.total_shipped, 0)}
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-xs" style={{ color: '#1D6FA4' }}>
                      {agencyStats.reduce((s, a) => s + a.total_arrived, 0)}
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-xs" style={{ color: '#0B7439' }}>
                      {agencyStats.reduce((s, a) => s + a.total_delivered, 0)}
                    </td>
                    <td className="px-4 py-3 font-bold text-xs" style={{ color: '#0B7439' }}>
                      {agencyStats.reduce((s, a) => s + a.period_revenue, 0).toLocaleString('fr-CI')} F
                    </td>
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
