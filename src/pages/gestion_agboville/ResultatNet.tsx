import { TrendingUp } from 'lucide-react'
import { ModulePlaceholder } from './_shared'

export default function ResultatNet() {
  return (
    <ModulePlaceholder
      title="Résultat net & dispatch"
      subtitle="Résultat net et répartition par société / segment"
      icon={<TrendingUp className="w-8 h-8" />}
    />
  )
}
