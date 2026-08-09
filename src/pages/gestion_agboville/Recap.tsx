import { ClipboardList } from 'lucide-react'
import { ModulePlaceholder } from './_shared'

export default function Recap() {
  return (
    <ModulePlaceholder
      title="Récap"
      subtitle="Récapitulatif de la ligne Agboville"
      icon={<ClipboardList className="w-8 h-8" />}
    />
  )
}
