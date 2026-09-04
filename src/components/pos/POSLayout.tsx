import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import { ConnectionBanner } from '@/components/pos/ConnectionBanner';

interface POSLayoutProps {
  children: ReactNode;
  stationName?: string;
  activeRoute?: string;
  showBack?: boolean;
  backTo?: string;
}

export default function POSLayout({ children, stationName, activeRoute, showBack, backTo }: POSLayoutProps) {
  const navigate = useNavigate();

  const goBack = () => {
    if (backTo) {
      navigate(backTo, { replace: true });
      return;
    }
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate('/guichet/accueil', { replace: true });
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        goBack();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [backTo]);

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--bg-subtle)' }}>
      <header
        className="flex items-center justify-between px-4 py-3 sticky top-0 z-30"
        style={{ backgroundColor: 'var(--primary)', color: 'white' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          {showBack && (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                goBack();
              }}
              className="flex items-center justify-center w-10 h-10 rounded-lg flex-shrink-0 transition-opacity hover:bg-white/15"
              aria-label="Précédent"
              title="Précédent"
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
      </header>

      <ConnectionBanner />

      <main className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
        {children}
      </main>
    </div>
  );
}
