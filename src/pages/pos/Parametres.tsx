import POSLayout from '@/components/pos/POSLayout';
import Placeholder from '@/components/pos/Placeholder';
import { Settings as SettingsIcon } from 'lucide-react';

export default function POSParametres() {
  return (
    <POSLayout showBack stationName="Gare d'Abidjan — Adjamé" activeRoute="Paramètres">
      <Placeholder
        title="Paramètres"
        subtitle="Configuration du terminal de vente : gare, imprimante, réseau, compte."
        icon={<SettingsIcon className="w-10 h-10" />}
      />
    </POSLayout>
  );
}
