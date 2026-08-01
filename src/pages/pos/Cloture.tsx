import POSLayout from '@/components/pos/POSLayout';
import Placeholder from '@/components/pos/Placeholder';
import { Lock } from 'lucide-react';

export default function POSCloture() {
  return (
    <POSLayout showBack stationName="Gare d'Abidjan — Adjamé" activeRoute="Clôture">
      <Placeholder
        title="Clôture"
        subtitle="Clôture journalière de la caisse et récapitulatif des ventes."
        icon={<Lock className="w-10 h-10" />}
      />
    </POSLayout>
  );
}
