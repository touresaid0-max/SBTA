import { Receipt } from 'lucide-react'
import { ModulePlaceholder } from './_shared'

export default function Depenses() {
  return (
    <ModulePlaceholder
      title="Dépenses AO / HAO"
      subtitle="Dépenses Acquisition d'Ordinaire et Hors Acquisition d'Ordinaire"
      icon={<Receipt className="w-8 h-8" />}
    />
  )
}
