import { useEffect, useState, useCallback } from 'react'
import toast from 'react-hot-toast'
import { fetchGroupes, fetchSettings } from '@/services/garageSbta.service'
import type { GarageGroupe, GarageSetting } from '@/types/garage.types'
import { useAuthStore } from '@/store/authStore'
import GarageReports from '@/pages/gerant_principal/Reports'

export default function GestionnaireGarageReports() {
  const { user } = useAuthStore()
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

  const forcedGroupeId = user?.company_id ?? null

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1A2E22]">Rapports Pièces</h1>
        <p className="text-sm text-[#6B7280] mt-1">
          Rapports de sorties de pièces de rechange pour votre société
        </p>
      </div>
      {forcedGroupeId ? (
        <GarageReports groupes={groupes} settings={settings} onReload={load} forcedGroupeId={forcedGroupeId} />
      ) : (
        <div className="bg-white rounded-2xl border border-[#E2EAE5] p-8 text-center">
          <p className="text-[#6B7280]">Aucune société rattachée à votre compte. Contactez votre administrateur.</p>
        </div>
      )}
    </div>
  )
}
