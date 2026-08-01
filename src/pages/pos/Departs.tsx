import POSLayout from '@/components/pos/POSLayout';
import Placeholder from '@/components/pos/Placeholder';
import { List } from 'lucide-react';

export default function POSDeparts() {
  return (
    <POSLayout showBack stationName="Gare d'Abidjan — Adjamé" activeRoute="Départs du jour">
      <Placeholder
        title="Départs"
        subtitle="Liste des départs du jour. Sélectionnez un départ pour vendre des tickets ou gérer les bagages."
        icon={<List className="w-10 h-10" />}
      />
    </POSLayout>
  );
}
