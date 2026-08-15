import { useEffect, useState, useMemo } from 'react'
import { Wrench, AlertCircle, Package, ArrowDownToLine, ArrowUpCircle, Calendar } from 'lucide-react'
import {
  fetchReparations, fetchSorties, fetchEntrees, fetchPneus, fetchCommandes, fetchCars, fetchGroupes,
} from '@/services/garageSbta.service'
import type { GarageReparation, GarageSortiePiece, GarageEntreeStock, GarageGroupe, GarageCar } from '@/types/garage.types'
import { currentMonthName, formatDate } from '@/components/garage/reportHelpers'

export default function GarageDashboard() {
  const [reparations, setReparations] = useState<GarageReparation[]>([])
  const [sorties, setSorties] = useState<GarageSortiePiece[]>([])
  const [entrees, setEntrees] = useState<GarageEntreeStock[]>([])
  const [groupes, setGroupes] = useState<GarageGroupe[]>([])
  const [cars, setCars] = useState<GarageCar[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([fetchReparations(), fetchSorties(), fetchEntrees(), fetchGroupes(), fetchCars()])
      .then(([r, s, e, g, c]) => { setReparations(r); setSorties(s); setEntrees(e); setGroupes(g); setCars(c) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const inMonth = (d: string) => new Date(d) >= monthStart && new Date(d) <= now

  const reparationsThisMonth = useMemo(() => reparations.filter(r => inMonth(r.date)), [reparations])
  const reparationsEnCours = useMemo(() => reparations.filter(r => r.statut === 'en cours'), [reparations])
  const sortiesThisMonth = useMemo(() => sorties.filter(s => inMonth(s.date)), [sorties])
  const entreesThisMonth = useMemo(() => entrees.filter(e => inMonth(e.date)), [entrees])

  const totalPiecesSorties = sortiesThisMonth.reduce((sum, s) => sum + s.quantite, 0)

  const last5Sorties = useMemo(() =>
    [...sorties].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 5),
    [sorties])

  const pointsParGroupe = useMemo(() => {
    return groupes.map(g => {
      const carsVenus = new Set(
        reparationsThisMonth.filter(r => r.car?.groupe_id === g.id).map(r => r.car_id)
      ).size
      const sortiesGroupe = sortiesThisMonth.filter(s => s.groupe_id === g.id)
      const piecesUniques = new Set(sortiesGroupe.map(s => s.piece_id)).size
      const piecesTotal = sortiesGroupe.reduce((sum, s) => sum + s.quantite, 0)
      return { groupe: g.nom, carsVenus, piecesUniques, piecesTotal }
    }).filter(r => r.carsVenus > 0 || r.piecesTotal > 0)
  }, [groupes, reparationsThisMonth, sortiesThisMonth])

  const cards = [
    { label: 'Réparations total', value: reparationsThisMonth.length, icon: Wrench, color: '#0B7439', bg: '#E8F5EC' },
    { label: 'Réparations en cours', value: reparationsEnCours.length, icon: AlertCircle, color: '#D97706', bg: '#FEF3C7' },
    { label: 'Demande de sortie de pièce', value: sortiesThisMonth.length, icon: ArrowUpCircle, color: '#1D6FA4', bg: '#E3F0F9' },
    { label: 'Pièce total sortie', value: totalPiecesSorties, icon: Package, color: '#7C3AED', bg: '#EDE9FE' },
    { label: 'Entrées de stocks', value: entreesThisMonth.length, icon: ArrowDownToLine, color: '#0E7490', bg: '#CFFAFE' },
  ]

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1A2E22]">Tableau de bord</h1>
          <p className="text-sm text-[#6B7280] mt-1">
            NB : LES CHIFFRES SUR CE TABLEAU DE BORD SONT LES CHIFFRES DU MOIS EN COURS ({currentMonthName()})
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-[#6B7280]">
          <Calendar className="w-4 h-4" />
          {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {cards.map(c => {
          const Icon = c.icon
          return (
            <div key={c.label} className="bg-white rounded-2xl border border-[#E2EAE5] p-5 hover:shadow-md transition-shadow">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ backgroundColor: c.bg }}>
                <Icon className="w-5 h-5" style={{ color: c.color }} />
              </div>
              <p className="text-2xl font-bold text-[#1A2E22]">{c.value}</p>
              <p className="text-xs font-medium text-[#6B7280] mt-1">{c.label}</p>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Last 5 sorties */}
        <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E2EAE5] bg-[#F8FAF8]">
            <h2 className="font-bold text-[#1A2E22]">Les 5 dernières sorties de pièces</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E2EAE5]">
                  <th className="text-left px-4 py-2.5 font-semibold text-[#4A6B55]">Date</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-[#4A6B55]">Demandeur</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-[#4A6B55]">Nombre de pièce</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-[#4A6B55]">Effectué par</th>
                </tr>
              </thead>
              <tbody>
                {last5Sorties.length === 0 ? (
                  <tr><td colSpan={4} className="text-center py-8 text-[#8AA898]">Aucune sortie</td></tr>
                ) : last5Sorties.map(s => (
                  <tr key={s.id} className="border-t border-[#E2EAE5] hover:bg-[#F8FAF8]">
                    <td className="px-4 py-2.5 text-[#4A6B55]">{formatDate(s.date)}</td>
                    <td className="px-4 py-2.5 text-[#1A2E22] font-medium">{s.demandeur || '—'}</td>
                    <td className="px-4 py-2.5 text-right text-[#1A2E22] font-bold">{s.quantite}</td>
                    <td className="px-4 py-2.5 text-[#4A6B55]">{s.effectue_par || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Points par groupe */}
        <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E2EAE5] bg-[#F8FAF8]">
            <h2 className="font-bold text-[#1A2E22]">Points par groupe</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E2EAE5]">
                  <th className="text-left px-4 py-2.5 font-semibold text-[#4A6B55]">Groupe</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-[#4A6B55]">Cars venus au garage</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-[#4A6B55]">Pièces sorties unique</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-[#4A6B55]">Pièces sorties total</th>
                </tr>
              </thead>
              <tbody>
                {pointsParGroupe.length === 0 ? (
                  <tr><td colSpan={4} className="text-center py-8 text-[#8AA898]">Aucune donnée ce mois</td></tr>
                ) : pointsParGroupe.map(r => (
                  <tr key={r.groupe} className="border-t border-[#E2EAE5] hover:bg-[#F8FAF8]">
                    <td className="px-4 py-2.5 font-medium text-[#1A2E22]">{r.groupe}</td>
                    <td className="px-4 py-2.5 text-right text-[#4A6B55]">{r.carsVenus}</td>
                    <td className="px-4 py-2.5 text-right text-[#4A6B55]">{r.piecesUniques}</td>
                    <td className="px-4 py-2.5 text-right font-bold text-[#1A2E22]">{r.piecesTotal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
