import { Wifi, WifiOff, RefreshCw, CheckCircle } from 'lucide-react';
import { useConnection } from '@/services/pos/ConnectionContext';

export function ConnectionBanner() {
  const { status, syncing, pendingCount, bannerLabel } = useConnection();

  let bgColor = '#16a34a';
  let Icon = Wifi;
  let animate = false;

  if (status === 'offline') {
    bgColor = '#dc2626';
    Icon = WifiOff;
  } else if (syncing) {
    bgColor = '#2563eb';
    Icon = RefreshCw;
    animate = true;
  } else if (pendingCount > 0) {
    bgColor = '#f59e0b';
    Icon = RefreshCw;
  } else {
    bgColor = '#16a34a';
    Icon = CheckCircle;
  }

  return (
    <div
      className="flex items-center gap-2 px-4 py-1.5 text-xs font-medium text-white transition-colors"
      style={{ backgroundColor: bgColor }}
      role="status"
      aria-live="polite"
    >
      <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${animate ? 'animate-spin' : ''}`} />
      <span className="truncate">{bannerLabel}</span>
    </div>
  );
}
