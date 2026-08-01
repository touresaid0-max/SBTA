import POSLayout from '@/components/pos/POSLayout';
import Placeholder from '@/components/pos/Placeholder';
import { PlusCircle } from 'lucide-react';

export default function POSDepartNouveau() {
  return (
    <POSLayout showBack stationName="Gare d'Abidjan — Adjamé" activeRoute="Nouveau départ">
      <Placeholder
        title="Nouveau départ"
        subtitle="Création d'un nouveau départ de bus — ligne, bus, chauffeur et horaire."
        icon={<PlusCircle className="w-10 h-10" />}
      />
    </POSLayout>
  );
}
