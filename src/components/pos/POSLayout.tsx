import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Home, MapPin, Ticket } from 'lucide-react';
import { ConnectionBanner } from '@/components/pos/ConnectionBanner';

interface POSLayoutProps {
  children: ReactNode;
  stationName?: string;
  activeRoute?: string;
  showBack?: boolean;
  backTo?: string;
  showSalesNavigation?: boolean;
  salesPath?: string;
}

export default function POSLayout({ children, stationName, activeRoute, showBack, backTo, showSalesNavigation = false, salesPath }: POSLayoutProps) {
  const navigate = useNavigate();

  const goBack = () => {
    if (backTo) {
      navigate(backTo);
    } else if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/guichet/accueil');
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        goBack();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--bg-subtle)' }}>
      <header
        className="flex items-center justify-between px-4 py-3 sticky top-0 z-30"
        style={{ backgroundColor: 'var(--primary)', color: 'white' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          {showBack && (
            <button
              onClick={goBack}
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
          {showSalesNavigation && salesPath && (
            <nav className="flex items-center gap-1 rounded-xl p-1 flex-shrink-0" style={{ backgroundColor: 'rgba(0, 0, 0, 0.14)' }} aria-label="Navigation de vente">
              <button
                type="button"
                onClick={() => navigate('/guichet/accueil')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs sm:text-sm font-bold transition-colors hover:bg-white/15"
              >
                <Home className="w-4 h-4" />
                Accueil
              </button>
              <button
                type="button"
                onClick={() => navigate(salesPath)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs sm:text-sm font-bold transition-colors"
                style={{ backgroundColor: 'white', color: 'var(--primary)' }}
                aria-current="page"
              >
                <Ticket className="w-4 h-4" />
                Vente
              </button>
            </nav>
          )}
        </div>
      </header>

      <ConnectionBanner />

      <main className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
        {children}
      </main>
    </div>
  );
}
