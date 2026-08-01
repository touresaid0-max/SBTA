import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wifi, WifiOff, MapPin } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

interface POSLayoutProps {
  children: ReactNode;
  stationName?: string;
  activeRoute?: string;
  showBack?: boolean;
}

export default function POSLayout({ children, stationName, activeRoute, showBack }: POSLayoutProps) {
  const navigate = useNavigate();
  const { isOnline } = useOnlineStatus();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        navigate(-1);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--bg-subtle)' }}>
      <header
        className="flex items-center justify-between px-4 py-3 sticky top-0 z-30"
        style={{ backgroundColor: 'var(--primary)', color: 'white' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          {showBack && (
            <button
              onClick={() => navigate(-1)}
              className="flex items-center justify-center w-10 h-10 rounded-lg flex-shrink-0 transition-opacity hover:bg-white/15"
              aria-label="Retour"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <div className="min-w-0">
            <p className="text-sm font-bold truncate leading-tight">
              {stationName || 'Guichet Eafribus'}
            </p>
            {activeRoute && (
              <p className="text-xs opacity-80 truncate leading-tight flex items-center gap-1">
                <MapPin className="w-3 h-3 flex-shrink-0" /> {activeRoute}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isOnline ? (
            <span className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full bg-white/20">
              <Wifi className="w-3.5 h-3.5" /> En ligne
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full bg-white/20">
              <WifiOff className="w-3.5 h-3.5" /> Hors ligne
            </span>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
        {children}
      </main>
    </div>
  );
}
