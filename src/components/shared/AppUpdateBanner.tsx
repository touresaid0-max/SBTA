import { useEffect, useState, useSyncExternalStore } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { applyAppUpdate, getAppUpdateState, subscribeAppUpdate } from '../../utils/appUpdate';

// « Plus tard »: shown again after this delay, so that no counter stays on an old version for good
const SNOOZE_MS = 30 * 60 * 1000;

/**
 * « Nouvelle version disponible »: shown on every page when a new version of the app has been
 * downloaded, with a button that loads it. The user chooses the moment (not in the middle of a
 * sale); unsent operations are kept on the device across the reload.
 */
export function AppUpdateBanner() {
  const state = useSyncExternalStore(subscribeAppUpdate, getAppUpdateState, getAppUpdateState);
  const [snoozedUntil, setSnoozedUntil] = useState(0);
  const [loading, setLoading] = useState(false);
  const [, setTick] = useState(0);

  // Shown again when the snooze ends
  useEffect(() => {
    if (!snoozedUntil) return;
    const t = window.setTimeout(() => setTick(n => n + 1), Math.max(0, snoozedUntil - Date.now()));
    return () => window.clearTimeout(t);
  }, [snoozedUntil]);

  if (state === 'none' || Date.now() < snoozedUntil) return null;

  const elsewhere = state === 'loaded-elsewhere';
  const load = () => {
    setLoading(true);
    void applyAppUpdate();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed z-[9999] bottom-3 left-3 right-3 sm:left-auto sm:right-4 sm:bottom-4 sm:w-[360px] rounded-xl shadow-2xl p-4"
      style={{ background: '#FFFFFF', border: '1px solid #B7D7C2', color: '#1F2933' }}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 rounded-full p-2" style={{ background: '#E6F2EA' }}>
          <RefreshCw className="w-5 h-5" style={{ color: '#0B7439' }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm" style={{ color: '#0B7439' }}>
            {elsewhere ? 'Nouvelle version chargée' : 'Nouvelle version disponible'}
          </p>
          <p className="text-xs mt-1" style={{ color: '#5B6670' }}>
            {elsewhere
              ? 'Elle a été chargée dans un autre onglet. Rechargez cette page pour l’utiliser.'
              : 'Une mise à jour de l’application est prête. Chargez-la quand aucune opération n’est en cours.'}
          </p>
          <p className="text-xs mt-1" style={{ color: '#5B6670' }}>
            Les opérations pas encore envoyées sont gardées.
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white whitespace-nowrap disabled:opacity-70"
              style={{ background: '#0B7439' }}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              {loading ? 'Chargement…' : elsewhere ? 'Recharger' : 'Charger la nouvelle version'}
            </button>
            {!loading && (
              <button
                type="button"
                onClick={() => setSnoozedUntil(Date.now() + SNOOZE_MS)}
                className="rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap hover:bg-gray-100"
                style={{ color: '#5B6670' }}
              >
                Plus tard
              </button>
            )}
          </div>
        </div>
        {!loading && (
          <button
            type="button"
            aria-label="Fermer (rappel dans 30 minutes)"
            onClick={() => setSnoozedUntil(Date.now() + SNOOZE_MS)}
            className="flex-shrink-0 rounded p-1 hover:bg-gray-100"
            style={{ color: '#5B6670' }}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
