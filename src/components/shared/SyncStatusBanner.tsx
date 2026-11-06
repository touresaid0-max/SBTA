import { Wifi, WifiOff, RefreshCw, CheckCircle, ChevronRight, Clock } from 'lucide-react';
import { clockWarning } from '@/services/offline/deviceClock';

// The sending state shown the same way at the guichet's sale and in the courrier (same strip, same
// colours, same words): the courrier had a banner of its own, worded otherwise, with a
// « Synchroniser » button the guichet does not need (operations leave by themselves).

export interface SyncState {
  status: 'online' | 'offline' | 'checking';
  /** Online but the login session can no longer be renewed (guichet) */
  sessionExpired?: boolean;
  syncing: boolean;
  pendingCount: number;
  lastSyncError: string | null;
  lastSyncedAt: string | null;
  /** The app is kept on the device for working offline (false while it downloads) */
  offlineReady?: boolean;
}

/** Words of the strip. */
export function syncBannerLabel(s: SyncState): string {
  const n = s.pendingCount;
  const ops = `${n} opération${n > 1 ? 's' : ''}`;
  if (s.status === 'checking') return 'Vérification de la connexion…';
  // Shown before « Synchronisation en cours » : nothing can be sent until the user logs in again
  if (s.status === 'online' && s.sessionExpired) {
    return n > 0
      ? `En ligne — session expirée : ${ops} en attente, déconnectez-vous puis reconnectez-vous`
      : 'En ligne — session expirée : déconnectez-vous puis reconnectez-vous';
  }
  if (s.syncing) return 'Synchronisation en cours…';
  if (s.status === 'offline') {
    if (n > 0) return `Hors ligne — ${ops} en attente de synchronisation`;
    return 'Hors ligne — fonctionnement local';
  }
  if (s.lastSyncError) return `En ligne — synchronisation à reprendre : ${s.lastSyncError}`;
  if (n > 0) return `En ligne — ${ops} en attente`;
  if (s.offlineReady === false) return 'En ligne — préparation du mode hors ligne, gardez la connexion';
  if (s.lastSyncedAt) return 'En ligne — Synchronisé';
  return 'En ligne';
}

interface Props {
  state: SyncState;
  /** Opens the list of the operations not yet on the server */
  onOpenQueue: () => void;
}

export function SyncStatusBanner({ state, onOpenQueue }: Props) {
  const { status, sessionExpired, syncing, pendingCount, lastSyncError } = state;

  let bgColor = '#16a34a';
  let Icon = Wifi;
  let animate = false;

  if (status === 'offline') {
    bgColor = '#dc2626';
    Icon = WifiOff;
  } else if (sessionExpired) {
    bgColor = '#f59e0b';
    Icon = WifiOff;
  } else if (syncing) {
    bgColor = '#2563eb';
    Icon = RefreshCw;
    animate = true;
  } else if (pendingCount > 0 || lastSyncError) {
    // A warning (session of another user, refused operation…) is never shown in green
    bgColor = '#f59e0b';
    Icon = RefreshCw;
  } else {
    bgColor = '#16a34a';
    Icon = CheckCircle;
  }

  // Device's clock off by more than 5 min (measured at the last sync): read again at each render of the banner
  const clockAlert = clockWarning();

  // With operations waiting, the banner opens the list of what is not yet on the server
  const canOpenQueue = pendingCount > 0;

  return (
    <>
      <div
        className={`flex items-center gap-2 px-4 py-1.5 text-xs font-medium text-white transition-colors ${canOpenQueue ? 'cursor-pointer hover:brightness-110' : ''}`}
        style={{ backgroundColor: bgColor }}
        role={canOpenQueue ? 'button' : 'status'}
        aria-live="polite"
        tabIndex={canOpenQueue ? 0 : undefined}
        onClick={canOpenQueue ? onOpenQueue : undefined}
        onKeyDown={canOpenQueue ? (e) => { if (e.key === 'Enter' || e.key === ' ') onOpenQueue(); } : undefined}
        title={canOpenQueue ? 'Voir les opérations en attente' : undefined}
      >
        <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${animate ? 'animate-spin' : ''}`} />
        <span className="truncate flex-1">{syncBannerLabel(state)}</span>
        {canOpenQueue && (
          <span className="flex items-center gap-0.5 flex-shrink-0 underline">
            Voir <ChevronRight className="w-3.5 h-3.5" />
          </span>
        )}
      </div>
      {clockAlert && (
        <div className="flex items-center gap-2 px-4 py-1.5 text-xs font-medium" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }} role="alert">
          <Clock className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="flex-1">{clockAlert}</span>
        </div>
      )}
    </>
  );
}
