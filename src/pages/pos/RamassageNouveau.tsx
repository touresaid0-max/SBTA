import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import POSLayout from '@/components/pos/POSLayout';
import { usePOSSession } from '@/services/pos/POSSessionContext';
import POSDepartNouveau from './DepartNouveau';
import POSRamassageDirect from './RamassageDirect';

export default function POSRamassageNouveau() {
  const [type, setType] = useState<'direct' | 'ligne' | null>(null);

  if (type === 'direct') {
    return <POSRamassageDirect />;
  }

  if (type === 'ligne') {
    return <POSDepartNouveau forceRamassage />;
  }

  return (
    <POSDepartNouveauSelection onSelect={setType} />
  );
}

function POSDepartNouveauSelection({ onSelect }: { onSelect: (type: 'direct' | 'ligne') => void }) {
  const { session } = usePOSSession();
  const navigate = useNavigate();
  const [selectedType, setSelectedType] = useState<'direct' | 'ligne' | ''>('');
  return (
    <POSLayout showBack stationName={session?.station_name} activeRoute="Nouveau ramassage">
      <div className="mx-auto max-w-xl rounded-2xl border p-6 shadow-sm" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Nouveau ramassage</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Choisissez la procédure à utiliser.</p>
        <label className="mt-6 block text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
          Type de ramassage
          <select value={selectedType} onChange={event => setSelectedType(event.target.value as 'direct' | 'ligne' | '')} className="mt-1.5 w-full rounded-xl border-2 px-3 py-3 text-base" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}>
            <option value="">Sélectionner...</option>
            <option value="direct">Ramassage Direct</option>
            <option value="ligne">Ramassage Ligne</option>
          </select>
        </label>
        <div className="mt-6 flex gap-3">
          <button type="button" onClick={() => navigate('/guichet/ramassage')} className="flex-1 rounded-xl border-2 py-3 font-bold" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Annuler</button>
          <button type="button" disabled={!selectedType} onClick={() => { if (selectedType) onSelect(selectedType); }} className="flex-1 rounded-xl py-3 font-bold text-white disabled:opacity-50" style={{ backgroundColor: 'var(--primary)' }}>Continuer</button>
        </div>
      </div>
    </POSLayout>
  );
}
