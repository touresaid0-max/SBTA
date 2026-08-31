import { Wifi, WifiOff, RefreshCw, UploadCloud, CheckCircle } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import type { ConnectionStatus } from '@/services/courrier/ConnectionContext';

interface OfflineBannerProps {
  status: ConnectionStatus;
  syncing: boolean;
  pendingCount: number;
  lastSyncError: string | null;
  onShowQueue: () => void;
  onSyncNow: () => void;
}

export function CourrierOfflineBanner({
  status,
  syncing,
  pendingCount,
  lastSyncError,
  onShowQueue,
  onSyncNow,
}: OfflineBannerProps) {
  const { isOnline: browserOnline, wasOffline } = useOnlineStatus();

  // Offline mode — amber banner
  if (status === 'offline') {
    return (
      <div
        className="flex items-center gap-3 px-4 py-2.5 text-sm"
        style={{ backgroundColor: '#FEF3C7', borderBottom: '1px solid #FCD34D' }}
      >
        <WifiOff className="w-4 h-4 flex-shrink-0" style={{ color: '#92400E' }} />
        <span className="font-medium flex-1" style={{ color: '#92400E' }}>
          Mode hors-ligne actif — vos opérations sont enregistrées localement
          {pendingCount > 0 && ` (${pendingCount} en attente)`}
        </span>
        {pendingCount > 0 && (
          <button
            onClick={onShowQueue}
            className="text-xs font-semibold px-2.5 py-1 rounded-lg"
            style={{ backgroundColor: '#FDE68A', color: '#92400E' }}
          >
            File d'attente
          </button>
        )}
      </div>
    );
  }

  // Reconnected and all synced — green banner (shows for 5s via wasOffline)
  if (wasOffline && browserOnline && pendingCount === 0 && !lastSyncError) {
    return (
      <div
        className="flex items-center gap-3 px-4 py-2.5 text-sm"
        style={{ backgroundColor: '#D1FAE5', borderBottom: '1px solid #6EE7B7' }}
      >
        <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: '#065F46' }} />
        <span className="font-medium flex-1" style={{ color: '#065F46' }}>
          Connexion rétablie — toutes les opérations ont été synchronisées
        </span>
      </div>
    );
  }

  // Online with pending items or syncing
  if (status === 'online' && (pendingCount > 0 || syncing || lastSyncError)) {
    return (
      <div
        className="flex items-center gap-3 px-4 py-2.5 text-sm"
        style={{ backgroundColor: '#EFF6FF', borderBottom: '1px solid #BFDBFE' }}
      >
        {syncing ? (
          <RefreshCw className="w-4 h-4 flex-shrink-0 animate-spin" style={{ color: '#1E40AF' }} />
        ) : (
          <UploadCloud className="w-4 h-4 flex-shrink-0" style={{ color: '#1E40AF' }} />
        )}
        <span className="font-medium flex-1" style={{ color: '#1E40AF' }}>
          {syncing
            ? 'Synchronisation en cours…'
            : lastSyncError
              ? `Synchronisation à reprendre : ${lastSyncError}`
              : `${pendingCount} opération${pendingCount > 1 ? 's' : ''} en attente de synchronisation`}
        </span>
        {!syncing && (
          <>
            {pendingCount > 0 && (
              <button
                onClick={onShowQueue}
                className="text-xs font-semibold px-2.5 py-1 rounded-lg"
                style={{ backgroundColor: '#DBEAFE', color: '#1E40AF' }}
              >
                Voir
              </button>
            )}
            <button
              onClick={onSyncNow}
              className="text-xs font-semibold px-2.5 py-1 rounded-lg"
              style={{ backgroundColor: '#2563EB', color: '#fff' }}
            >
              Synchroniser
            </button>
          </>
        )}
      </div>
    );
  }

  // Online and synced — subtle green indicator
  if (status === 'online') {
    return (
      <div
        className="flex items-center gap-2 px-4 py-1.5 text-xs"
        style={{ backgroundColor: '#F0FDF4', borderBottom: '1px solid #BBF7D0' }}
      >
        <Wifi className="w-3.5 h-3.5" style={{ color: '#16A34A' }} />
        <span className="font-medium" style={{ color: '#15803D' }}>
          En ligne — Synchronisé
        </span>
      </div>
    );
  }

  return null;
}
