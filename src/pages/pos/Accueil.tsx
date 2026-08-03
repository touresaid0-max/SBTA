import { useNavigate } from 'react-router-dom';
import {
  PlusCircle, Ticket, Package, Building2, Receipt, Lock, FileText,
  Settings as SettingsIcon, LogOut,
} from 'lucide-react';
import { PWAUpdateBanner } from '@/components/pos/PWAUpdateBanner';
import { usePOSSession } from '@/services/pos/POSSessionContext';

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
  { label: 'Gestion des bagages', icon: Package, path: '/guichet/departs', color: '#D97706', bgColor: '#FEF3C7' },
  { label: 'Gestion autres gares', icon: Building2, path: '/guichet/autres-gares', color: '#7C3AED', bgColor: '#EDE9FE' },
  { label: 'Nouvelles dépenses', icon: Receipt, path: '/guichet/depenses', color: '#AF3029', bgColor: '#f8d7d5' },
  { label: 'Clôture', icon: Lock, path: '/guichet/cloture', color: '#4A6B55', bgColor: '#E2EAE5' },
  { label: 'États & exports', icon: FileText, path: '/guichet/departs', color: '#2563EB', bgColor: '#DBEAFE' },
];

export default function POSAccueil() {
  const navigate = useNavigate();
  const { session, logout } = usePOSSession();

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
          {tiles.map(tile => {
            const Icon = tile.icon;
            return (
              <button
                key={tile.path + tile.label}
                onClick={() => navigate(tile.path)}
                className="flex flex-col items-center justify-center gap-3 p-4 sm:p-6 rounded-2xl border-2 transition-all active:scale-95 hover:shadow-md min-h-[140px] sm:min-h-[160px]"
                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
              >
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
