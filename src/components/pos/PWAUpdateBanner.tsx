import { useState, useEffect, useCallback } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Download, X, RefreshCw } from 'lucide-react';

export default function usePWAUpdatePrompt() {
  const [showPrompt, setShowPrompt] = useState(false);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW() {
      // SW registered
    },
    onRegisterError(error) {
      console.error('SW registration failed', error);
    },
  });

  const close = useCallback(() => {
    setShowPrompt(false);
    setNeedRefresh(false);
    setOfflineReady(false);
  }, [setNeedRefresh, setOfflineReady]);

  useEffect(() => {
    setShowPrompt(needRefresh || offlineReady);
  }, [needRefresh, offlineReady]);

  const update = useCallback(() => {
    updateServiceWorker(true);
  }, [updateServiceWorker]);

  return { showPrompt, needRefresh, close, update };
}

export function PWAUpdateBanner() {
  const { showPrompt, needRefresh, close, update } = usePWAUpdatePrompt();
  if (!showPrompt) return null;

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3 max-w-sm w-[calc(100%-2rem)]"
      style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}
      >
        {needRefresh ? <RefreshCw className="w-5 h-5" /> : <Download className="w-5 h-5" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
          {needRefresh ? 'Mise à jour disponible' : 'Application prête'}
        </p>
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {needRefresh ? 'Une nouvelle version du guichet est disponible.' : "L'app fonctionne hors ligne."}
        </p>
      </div>
      {needRefresh && (
        <button
          onClick={update}
          className="px-3 py-2 rounded-lg text-xs font-bold text-white flex-shrink-0 transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--primary)' }}
        >
          Mettre à jour
        </button>
      )}
      <button
        onClick={close}
        className="p-1.5 rounded-lg flex-shrink-0 transition-colors"
        style={{ color: 'var(--text-muted)' }}
        aria-label="Fermer"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
