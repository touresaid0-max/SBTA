import POSLayout from '@/components/pos/POSLayout';
import Placeholder from '@/components/pos/Placeholder';
import { Package } from 'lucide-react';

export default function POSBagages() {
  return (
    <POSLayout showBack stationName="Gare d'Abidjan — Adjamé" activeRoute="Gestion des bagages">
      <Placeholder
        title="Gestion des bagages"
        subtitle="Enregistrement et suivi des bagages pour ce départ."
        icon={<Package className="w-10 h-10" />}
      />
    </POSLayout>
  );
}
