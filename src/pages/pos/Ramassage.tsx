import { useEffect, useMemo, useRef, useState } from 'react';
import POSLayout from '@/components/pos/POSLayout';
import { usePOSSession } from '@/services/pos/POSSessionContext';
import { supabase } from '@/services/supabase';
import { Bus, Search, MapPin, Hash, Loader2, CheckCircle, Clock } from 'lucide-react';

type RamassageNotif = {
  id: string;
  route_name: string | null;
  departure_number: number | null;
  bus_registration: string | null;
  origin_station_id: string | null;
  origin_station_name: string | null;
  destination_station_id: string;
  destination_station_name: string | null;
  status: string;
  created_at: string;
  consulted_at: string | null;
};

export default function POSRamassage() {
  const { session } = usePOSSession();
  const stationId = session?.station_id;

  const [notifs, setNotifs] = useState<RamassageNotif[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<RamassageNotif | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [marking, setMarking] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const load = async () => {
    if (!stationId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('ramassage_notifications')
      .select('*')
      .eq('destination_station_id', stationId)
      .in('status', ['pending', 'consulted'])
      .order('created_at', { ascending: false });
    if (!error) setNotifs((data as RamassageNotif[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    if (!stationId) return;
    const ch = supabase
      .channel('ramassage_page_' + stationId)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'ramassage_notifications',
        filter: `destination_station_id=eq.${stationId}`,
      }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationId]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = notifs.filter(n => n.status === 'pending');
    if (!q) return pool.slice(0, 8);
    return pool
      .filter(n => (n.bus_registration ?? '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, notifs]);

  const pendingList = notifs.filter(n => n.status === 'pending');

  const openNotif = async (n: RamassageNotif) => {
    setSelected(n);
    setQuery(n.bus_registration ?? '');
    setShowSuggestions(false);
    if (n.status === 'pending') {
      setMarking(true);
      const { error } = await supabase
        .from('ramassage_notifications')
        .update({ status: 'consulted', consulted_at: new Date().toISOString() })
        .eq('id', n.id);
      if (!error) {
        setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, status: 'consulted', consulted_at: new Date().toISOString() } : x));
      }
      setMarking(false);
    }
  };

  return (
    <POSLayout stationName={session?.station_name} activeRoute="Ramassage" showBack>
      <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
        {/* Header stats */}
        <div className="rounded-2xl p-4 sm:p-5 border-2 flex items-center gap-4"
          style={{ backgroundColor: '#E0F2FE', borderColor: '#0EA5E9' }}>
          <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#0EA5E9', color: 'white' }}>
            <Bus className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium" style={{ color: '#0369A1' }}>Ramassages en attente pour cette gare</div>
            <div className="text-2xl font-bold" style={{ color: '#0C4A6E' }}>{pendingList.length}</div>
          </div>
        </div>

        {/* Autocomplete search */}
        <div ref={wrapRef} className="relative">
          <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
            Immatriculation du véhicule
          </label>
          <div className="relative">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <input
              type="text"
              value={query}
              onFocus={() => setShowSuggestions(true)}
              onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true); setSelected(null); }}
              placeholder="Ex: 0349WWCI01"
              className="w-full pl-10 pr-4 py-3 rounded-xl border-2 text-base font-medium"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            />
          </div>
          {showSuggestions && (
            <div className="absolute z-20 left-0 right-0 mt-1 rounded-xl border-2 overflow-hidden shadow-lg"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              {suggestions.length === 0 ? (
                <div className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                  Aucun ramassage en attente pour cette immatriculation.
                </div>
              ) : suggestions.map(n => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => openNotif(n)}
                  className="w-full text-left px-4 py-3 border-b hover:bg-black/5 transition-colors"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>
                      {n.bus_registration ?? '—'}
                    </div>
                    <div className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#FEE2E2', color: '#B91C1C' }}>
                      En attente
                    </div>
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                    {n.route_name ?? '—'} · Départ N°{n.departure_number ?? '—'}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Selected details */}
        {selected && (
          <div className="rounded-2xl border-2 p-5 space-y-3" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Nouveau ramassage en attente</h3>
              {marking ? (
                <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--primary)' }} />
              ) : (
                <CheckCircle className="w-5 h-5" style={{ color: '#16A34A' }} />
              )}
            </div>
            <InfoRow icon={<MapPin className="w-4 h-4" />} label="Ligne" value={selected.route_name ?? '—'} />
            <InfoRow icon={<Hash className="w-4 h-4" />} label="Numéro de départ" value={selected.departure_number != null ? String(selected.departure_number) : '—'} />
            <InfoRow icon={<Bus className="w-4 h-4" />} label="Immatriculation" value={selected.bus_registration ?? '—'} />
            <InfoRow icon={<MapPin className="w-4 h-4" />} label="Gare de départ" value={selected.origin_station_name ?? '—'} />
            <InfoRow icon={<MapPin className="w-4 h-4" />} label="Gare de destination" value={selected.destination_station_name ?? '—'} />
            <InfoRow icon={<Clock className="w-4 h-4" />} label="Reçu le" value={new Date(selected.created_at).toLocaleString('fr-FR')} />
          </div>
        )}

        {/* Pending list */}
        <div className="rounded-2xl border-2 overflow-hidden" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="px-4 py-3 border-b font-bold text-sm" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
            En attente
          </div>
          {loading ? (
            <div className="p-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Chargement…</div>
          ) : pendingList.length === 0 ? (
            <div className="p-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              Aucun ramassage en attente.
            </div>
          ) : pendingList.map(n => (
            <button
              key={n.id}
              type="button"
              onClick={() => openNotif(n)}
              className="w-full text-left px-4 py-3 border-b hover:bg-black/5 transition-colors flex items-center justify-between gap-3"
              style={{ borderColor: 'var(--border)' }}
            >
              <div>
                <div className="font-bold" style={{ color: 'var(--text-primary)' }}>{n.bus_registration ?? '—'}</div>
                <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {n.route_name ?? '—'} · N°{n.departure_number ?? '—'} · {n.origin_station_name ?? '—'}
                </div>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: '#FEE2E2', color: '#B91C1C' }}>
                En attente
              </span>
            </button>
          ))}
        </div>
      </div>
    </POSLayout>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
        <span style={{ color: 'var(--text-muted)' }}>{icon}</span>
        {label}
      </div>
      <div className="text-sm font-bold text-right" style={{ color: 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}
