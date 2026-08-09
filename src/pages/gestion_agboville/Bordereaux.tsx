import { FileText } from 'lucide-react'
import { ModulePlaceholder } from './_shared'

export default function Bordereaux() {
  return (
    <ModulePlaceholder
      title="Bordereaux"
      subtitle="Bordereaux de départ — ligne Agboville"
      icon={<FileText className="w-8 h-8" />}
    />
  )
}
