import POSLayout from '@/components/pos/POSLayout';
import Placeholder from '@/components/pos/Placeholder';
import { Ticket } from 'lucide-react';

export default function POSVente() {
  return (
    <POSLayout showBack stationName="Gare d'Abidjan — Adjamé" activeRoute="Vente de tickets">
      <Placeholder
        title="Vente des tickets"
        subtitle="Sélection des sièges et vente de tickets pour ce départ."
        icon={<Ticket className="w-10 h-10" />}
      />
    </POSLayout>
  );
}
