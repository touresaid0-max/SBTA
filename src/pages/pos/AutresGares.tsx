import POSLayout from '@/components/pos/POSLayout';
import Placeholder from '@/components/pos/Placeholder';
import { Building2 } from 'lucide-react';

export default function POSAutresGares() {
  return (
    <POSLayout showBack stationName="Gare d'Abidjan — Adjamé" activeRoute="Autres gares">
      <Placeholder
        title="Gestion autres gares"
        subtitle="Vente et gestion pour les départs vers d'autres gares du réseau."
        icon={<Building2 className="w-10 h-10" />}
      />
    </POSLayout>
  );
}
