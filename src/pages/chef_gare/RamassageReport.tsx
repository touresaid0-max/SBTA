import { useEffect, useState } from 'react';
import { supabase } from '@/services/supabase';
import RamassageReportView from '@/components/shared/RamassageReportView';
import { MapPin } from 'lucide-react';

export default function ChefGareRamassageReport() {
  const [stationId, setStationId] = useState<string | null>(null);
  const [stationName, setStationName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data: sid } = await supabase.rpc('get_my_station_id');
        if (!sid) { setLoading(false); return; }
        setStationId(sid as string);
        const { data: st } = await supabase
          .from('stations')
          .select('name')
          .eq('id', sid as string)
          .maybeSingle();
        setStationName(st?.name ?? null);
      } catch { /* ignore */ } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return (
    <div className="p-8 flex items-center justify-center min-h-64">
      <div className="w-10 h-10 border-4 rounded-full animate-spin" style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
    </div>
  );

  if (!stationId) return (
    <div className="p-8">
      <div className="max-w-lg mx-auto text-center py-20">
        <MapPin className="w-16 h-16 mx-auto mb-4" style={{ color: '#D1D5DB' }} />
        <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Aucune gare assignée</h2>
        <p style={{ color: 'var(--text-secondary)' }}>Contactez l'administrateur pour être rattaché à votre gare.</p>
      </div>
    </div>
  );

  return <RamassageReportView stationId={stationId} stationName={stationName} />;
}
