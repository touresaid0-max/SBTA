import { useEffect, useState, useCallback } from 'react'
import toast from 'react-hot-toast'
import { fetchGroupes, fetchSettings } from '@/services/garageSbta.service'
import type { GarageGroupe, GarageSetting } from '@/types/garage.types'
import GarageReports from '@/pages/gerant_principal/Reports'

export default function DAFGarageReports() {
  const [groupes, setGroupes] = useState<GarageGroupe[]>([])
  const [settings, setSettings] = useState<GarageSetting[]>([])

  const load = useCallback(async () => {
    try {
      const [g, s] = await Promise.all([fetchGroupes(), fetchSettings()])
      setGroupes(g)
      setSettings(s)
    } catch {
      toast.error('Erreur de chargement des rapports pièces')
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1A2E22]">Rapports Pièces</h1>
        <p className="text-sm text-[#6B7280] mt-1">
          Rapports de sorties de pièces de rechange — configurés depuis Gérant Principal → Paramètres → Rapport
        </p>
      </div>
      <GarageReports groupes={groupes} settings={settings} onReload={load} />
    </div>
  )
}
