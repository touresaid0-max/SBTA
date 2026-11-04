import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HardDrive, ChevronRight } from 'lucide-react';
import { getStorageStatus, storageLevel, type StorageLevel } from '@/services/pos/persistentStorage';

// How often an open guichet checks the storage space of the device
const CHECK_INTERVAL_MS = 10 * 60_000;

/**
 * Banner shown on the guichet's screens when the device's storage is nearly full (audit m7):
 * from 80 % of the quota, then in red from 95 %, with a link to free space in Paramètres.
 */
export function StorageAlert() {
  const [state, setState] = useState<{ level: StorageLevel; ratio: number | null }>({ level: 'unknown', ratio: null });

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const result = storageLevel(await getStorageStatus());
      if (!cancelled) setState(result);
    };
    void check();
    const timer = window.setInterval(() => { void check(); }, CHECK_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (state.level !== 'warning' && state.level !== 'critical') return null;
  const percent = Math.round((state.ratio ?? 0) * 100);
  const critical = state.level === 'critical';

  return (
    <Link
      to="/guichet/parametres"
      className="flex items-center gap-2 px-4 py-1.5 text-xs font-medium text-white hover:brightness-110"
      style={{ backgroundColor: critical ? 'var(--danger, #AF3029)' : '#B45309' }}
      role="alert"
    >
      <HardDrive className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="flex-1">
        {critical
          ? `Stockage du poste presque saturé (${percent} %) : les prochaines ventes risquent de ne plus être enregistrées. Libérez de l'espace maintenant.`
          : `Stockage du poste rempli à ${percent} % : pensez à libérer de l'espace.`}
      </span>
      <span className="flex items-center gap-0.5 flex-shrink-0 underline">
        Libérer de l'espace <ChevronRight className="w-3.5 h-3.5" />
      </span>
    </Link>
  );
}
