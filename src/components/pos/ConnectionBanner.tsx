import { Wifi, WifiOff, RefreshCw, CheckCircle, ChevronRight, Clock } from 'lucide-react';
import { useConnection } from '@/services/pos/ConnectionContext';
import { SyncQueueModal } from '@/components/pos/SyncQueueModal';
import { clockWarning } from '@/services/offline/deviceClock';

export function ConnectionBanner() {
  const { status, sessionExpired, syncing, pendingCount, lastSyncError, bannerLabel, queueOpen, setQueueOpen } = useConnection();

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
    // A warning (session of another guichetier, refused operation…) is never shown in green
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
        onClick={canOpenQueue ? () => setQueueOpen(true) : undefined}
        onKeyDown={canOpenQueue ? (e) => { if (e.key === 'Enter' || e.key === ' ') setQueueOpen(true); } : undefined}
        title={canOpenQueue ? 'Voir les opérations en attente' : undefined}
      >
        <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${animate ? 'animate-spin' : ''}`} />
        <span className="truncate flex-1">{bannerLabel}</span>
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
      <SyncQueueModal open={queueOpen} onClose={() => setQueueOpen(false)} />
    </>
  );
}
