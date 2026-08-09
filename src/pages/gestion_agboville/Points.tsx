import { Calendar } from 'lucide-react'
import { ModulePlaceholder } from './_shared'

export default function Points() {
  return (
    <ModulePlaceholder
      title="Points"
      subtitle="Points hebdomadaire / mensuel / annuel"
      icon={<Calendar className="w-8 h-8" />}
    />
  )
}
