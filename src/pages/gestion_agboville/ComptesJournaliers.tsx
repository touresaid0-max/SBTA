import { BookOpen } from 'lucide-react'
import { ModulePlaceholder } from './_shared'

export default function ComptesJournaliers() {
  return (
    <ModulePlaceholder
      title="Comptes journaliers"
      subtitle="Comptabilité journalière de la ligne Agboville"
      icon={<BookOpen className="w-8 h-8" />}
    />
  )
}
