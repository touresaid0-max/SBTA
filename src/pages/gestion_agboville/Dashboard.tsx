import { LayoutDashboard } from 'lucide-react'
import { ModulePlaceholder } from './_shared'

export default function Dashboard() {
  return (
    <ModulePlaceholder
      title="Tableau de bord"
      subtitle="Vue d'ensemble de la ligne Agboville"
      icon={<LayoutDashboard className="w-8 h-8" />}
    />
  )
}
