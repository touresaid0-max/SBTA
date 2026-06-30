import { useEffect, useState } from 'react';
import { Monitor } from 'lucide-react';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../store/authStore';
import StationDisplay from '../display/StationDisplay';

export default function StationDisplayWrapper() {
  const { user } = useAuthStore();
  const [stationId, setStationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .rpc('get_my_station_id')
      .then(({ data, error: err }) => {
        if (err || !data) {
          setError("Aucune gare n'est associée à votre compte.");
        } else {
          setStationId(data as string);
        }
        setLoading(false);
      });
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#040810' }}>
        <div className="text-center">
          <div className="w-16 h-16 border-4 rounded-full animate-spin mx-auto mb-4"
            style={{ borderColor: '#0B7439', borderTopColor: 'transparent' }} />
          <p className="text-lg font-semibold text-white">Chargement de votre gare...</p>
        </div>
      </div>
    );
  }

  if (error || !stationId) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#040810' }}>
        <div className="text-center p-10 rounded-2xl" style={{ backgroundColor: '#0D1424', border: '1px solid #1E2D45' }}>
          <Monitor className="w-16 h-16 mx-auto mb-4" style={{ color: '#4B6280' }} />
          <p className="text-2xl font-bold text-white mb-2">Écran d'affichage</p>
          <p className="text-base" style={{ color: '#94A3B8' }}>
            {error || "Aucune gare n'est associée à votre compte."}
          </p>
          <p className="text-sm mt-3" style={{ color: '#4B6280' }}>
            Contactez votre administrateur pour configurer votre gare.
          </p>
        </div>
      </div>
    );
  }

  return <StationDisplay stationId={stationId} />;
}
