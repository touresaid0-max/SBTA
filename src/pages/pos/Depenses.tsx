import POSLayout from '@/components/pos/POSLayout';
import Placeholder from '@/components/pos/Placeholder';
import { Receipt } from 'lucide-react';

export default function POSDepenses() {
  return (
    <POSLayout showBack stationName="Gare d'Abidjan — Adjamé" activeRoute="Dépenses">
      <Placeholder
        title="Nouvelles dépenses"
        subtitle="Enregistrement des dépenses de la gare."
        icon={<Receipt className="w-10 h-10" />}
      />
    </POSLayout>
  );
}
