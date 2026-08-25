import { useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import {
  PlusCircle, Ticket, Package, Receipt, Lock, FileText,
  Settings as SettingsIcon, LogOut, Bus, Truck,
} from 'lucide-react';
import { supabase } from '@/services/supabase';
import { usePOSSession } from '@/services/pos/POSSessionContext';
import { PWAUpdateBanner } from '@/components/pos/PWAUpdateBanner';
import { formatCurrency } from '@/utils/formatCurrency';

interface TileConfig {
  label: string;
  icon: typeof PlusCircle;
  path: string;
  color: string;
  bgColor: string;
}

const tiles: TileConfig[] = [
  { label: 'Nouveau départ', icon: PlusCircle, path: '/guichet/depart/nouveau', color: '#0B7439', bgColor: '#d4edda' },
  { label: 'Vente des tickets', icon: Ticket, path: '/guichet/departs', color: '#1D6FA4', bgColor: '#DBEAFE' },
  { label: 'Nouvelles dépenses', icon: Receipt, path: '/guichet/depenses', color: '#AF3029', bgColor: '#f8d7d5' },
  { label: 'Ramassage', icon: Bus, path: '/guichet/ramassage', color: '#0EA5E9', bgColor: '#E0F2FE' },
  { label: 'Convoi', icon: Truck, path: '/guichet/convois', color: '#D97706', bgColor: '#FEF3C7' },
  { label: 'Clôture', icon: Lock, path: '/guichet/cloture', color: '#4A6B55', bgColor: '#E2EAE5' },
  { label: 'États & exports', icon: FileText, path: '/guichet/departs', color: '#2563EB', bgColor: '#DBEAFE' },
];

type BagagePeriod = 'day' | 'week' | 'month' | 'year';

const PERIOD_LABELS: Record<BagagePeriod, string> = {
  day: 'Jour',
  week: 'Semaine',
  month: 'Mois',
  year: 'Année',
};

function periodStart(period: BagagePeriod): Date {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'day') return d;
  if (period === 'week') {
    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diff);
    return d;
  }
  if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
  return new Date(now.getFullYear(), 0, 1);
}

export default function POSAccueil() {
  const navigate = useNavigate();
  const { session, logout } = usePOSSession();
  const [pendingRamassage, setPendingRamassage] = useState(0);
  const [bagagePeriod, setBagagePeriod] = useState<BagagePeriod>('day');
  const [bagageAmount, setBagageAmount] = useState(0);
  const [bagageCount, setBagageCount] = useState(0);
  const [bagageLoading, setBagageLoading] = useState(false);

  useEffect(() => {
    if (!session?.station_id) return;
    let cancelled = false;
    const load = async () => {
      const { count } = await supabase
        .from('ramassage_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('destination_station_id', session.station_id)
        .eq('status', 'pending');
      if (!cancelled) setPendingRamassage(count ?? 0);
    };
    load();
    const ch = supabase
      .channel('ramassage_notifs_' + session.station_id)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'ramassage_notifications',
        filter: `destination_station_id=eq.${session.station_id}`,
      }, load)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [session?.station_id]);

  const startIso = useMemo(() => periodStart(bagagePeriod).toISOString(), [bagagePeriod]);

  useEffect(() => {
    if (!session?.user_id) return;
    let cancelled = false;
    const load = async () => {
      setBagageLoading(true);
      let q = supabase
        .from('baggage_tickets')
        .select('price', { count: 'exact' })
        .gte('created_at', startIso);
      if (session.counter_id) {
        q = q.eq('counter_id', session.counter_id);
      } else {
        q = q.eq('sold_by', session.user_id);
      }
      const { data, count, error } = await q;
      if (cancelled) return;
      if (error || !data) {
        setBagageAmount(0);
        setBagageCount(0);
      } else {
        const total = data.reduce((sum, r: { price: number | null }) => sum + (r.price ?? 0), 0);
        setBagageAmount(total);
        setBagageCount(count ?? data.length);
      }
      setBagageLoading(false);
    };
    load();

    const filterCol = session.counter_id ? 'counter_id' : 'sold_by';
    const filterVal = session.counter_id ?? session.user_id;
    const ch = supabase
      .channel(`baggage_kpi_${filterVal}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'baggage_tickets',
        filter: `${filterCol}=eq.${filterVal}`,
      }, load)
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [session?.user_id, session?.counter_id, startIso]);

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--bg-subtle)' }}>
      <header
        className="px-4 py-4 sticky top-0 z-30"
        style={{ backgroundColor: 'var(--primary)', color: 'white' }}
      >
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-sm font-bold leading-tight truncate">
              {session?.station_name ?? 'Gare'}
            </p>
            <p className="text-xs opacity-80 leading-tight truncate">
              {session?.full_name ?? 'Terminal de vente'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => navigate('/guichet/parametres')}
              className="flex items-center justify-center w-11 h-11 rounded-xl transition-colors hover:bg-white/15"
              aria-label="Paramètres"
            >
              <SettingsIcon className="w-5 h-5" />
            </button>
            <button
              onClick={() => { logout(); navigate('/guichet/connexion'); }}
              className="flex items-center justify-center w-11 h-11 rounded-xl transition-colors hover:bg-white/15"
              aria-label="Déconnexion"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 sm:px-6">
        <h2 className="text-lg font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
          Menu principal
        </h2>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
          <button
            onClick={() => navigate('/guichet/depart/nouveau')}
            className="relative flex flex-col items-center justify-center gap-3 p-4 sm:p-6 rounded-2xl border-2 transition-all active:scale-95 hover:shadow-md min-h-[140px] sm:min-h-[160px]"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center" style={{ backgroundColor: '#d4edda', color: '#0B7439' }}>
              <PlusCircle className="w-7 h-7 sm:w-8 sm:h-8" strokeWidth={2} />
            </div>
            <span className="text-sm sm:text-base font-bold text-center leading-tight" style={{ color: 'var(--text-primary)' }}>
              Nouveau départ
            </span>
          </button>

          <button
            onClick={() => navigate('/guichet/departs')}
            className="relative flex flex-col items-center justify-center gap-3 p-4 sm:p-6 rounded-2xl border-2 transition-all active:scale-95 hover:shadow-md min-h-[140px] sm:min-h-[160px]"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center" style={{ backgroundColor: '#DBEAFE', color: '#1D6FA4' }}>
              <Ticket className="w-7 h-7 sm:w-8 sm:h-8" strokeWidth={2} />
            </div>
            <span className="text-sm sm:text-base font-bold text-center leading-tight" style={{ color: 'var(--text-primary)' }}>
              Vente des tickets
            </span>
          </button>

          {/* Gestion des bagages — real revenue KPI + period filters */}
          <div
            className="relative col-span-2 sm:col-span-1 sm:row-span-2 flex flex-col rounded-2xl border-2 overflow-hidden min-h-[140px] sm:min-h-[160px]"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            <button
              onClick={() => navigate('/guichet/departs')}
              className="flex items-center gap-3 px-4 pt-4 pb-2 text-left transition-colors hover:bg-black/5 active:scale-[0.99]"
            >
              <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#FEF3C7', color: '#D97706' }}>
                <Package className="w-6 h-6 sm:w-7 sm:h-7" strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm sm:text-base font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>
                  Gestion des bagages
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  Recettes du guichet — {PERIOD_LABELS[bagagePeriod].toLowerCase()}
                </p>
              </div>
            </button>

            <div className="px-4 pb-3">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl sm:text-3xl font-bold tabular-nums" style={{ color: '#D97706' }}>
                  {bagageLoading ? '…' : formatCurrency(bagageAmount)}
                </span>
              </div>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {bagageLoading ? 'Chargement…' : `${bagageCount} bagage${bagageCount > 1 ? 's' : ''} enregistré${bagageCount > 1 ? 's' : ''}`}
              </p>
            </div>

            <div className="mt-auto grid grid-cols-4 border-t" style={{ borderColor: 'var(--border)' }}>
              {(Object.keys(PERIOD_LABELS) as BagagePeriod[]).map(p => {
                const active = p === bagagePeriod;
                return (
                  <button
                    key={p}
                    onClick={() => setBagagePeriod(p)}
                    className="py-2 text-[11px] sm:text-xs font-bold transition-colors"
                    style={{
                      backgroundColor: active ? '#FEF3C7' : 'transparent',
                      color: active ? '#B45309' : 'var(--text-secondary)',
                      borderLeft: p === 'day' ? 'none' : '1px solid var(--border)',
                    }}
                  >
                    {PERIOD_LABELS[p]}
                  </button>
                );
              })}
            </div>
          </div>

          {tiles.slice(2).map(tile => {
            const Icon = tile.icon;
            return (
              <button
                key={tile.path + tile.label}
                onClick={() => navigate(tile.path)}
                className="relative flex flex-col items-center justify-center gap-3 p-4 sm:p-6 rounded-2xl border-2 transition-all active:scale-95 hover:shadow-md min-h-[140px] sm:min-h-[160px]"
                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
              >
                {tile.label === 'Ramassage' && pendingRamassage > 0 && (
                  <span className="absolute top-2 right-2 min-w-[24px] h-6 px-1.5 rounded-full text-white text-xs font-bold flex items-center justify-center animate-pulse" style={{ backgroundColor: '#DC2626' }}>
                    {pendingRamassage}
                  </span>
                )}
                <div
                  className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center transition-transform"
                  style={{ backgroundColor: tile.bgColor, color: tile.color }}
                >
                  <Icon className="w-7 h-7 sm:w-8 sm:h-8" strokeWidth={2} />
                </div>
                <span className="text-sm sm:text-base font-bold text-center leading-tight" style={{ color: 'var(--text-primary)' }}>
                  {tile.label}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-8 text-center">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Sélectionnez une action pour commencer
          </p>
        </div>
      </main>

      <PWAUpdateBanner />
    </div>
  );
}
