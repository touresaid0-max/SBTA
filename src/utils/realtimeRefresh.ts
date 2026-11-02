// Realtime events arrive for every sale in every station: reloading a screen on each event
// sends hundreds of identical requests to the database during rush hours.

/** Delay used to group realtime events into one reload. */
export const REALTIME_REFRESH_MS = 10_000;

/**
 * Groups realtime events into at most one `refresh` every `delayMs`.
 * While the tab is hidden nothing is reloaded; one reload runs when it is shown again.
 * Call `cancel` in the effect cleanup.
 */
export function createRefreshScheduler(refresh: () => void, delayMs = REALTIME_REFRESH_MS) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingWhileHidden = false;

  const onVisibility = () => {
    if (!document.hidden && pendingWhileHidden) {
      pendingWhileHidden = false;
      refresh();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    schedule() {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (document.hidden) pendingWhileHidden = true;
        else refresh();
      }, delayMs);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}

const lastRuns = new Map<string, number>();

/**
 * Runs `task` only if it has not run for `key` in the last `intervalMs` (shared by every screen
 * of the tab). Returns undefined when skipped.
 */
export function runAtMostEvery<T>(key: string, intervalMs: number, task: () => Promise<T>): Promise<T> | undefined {
  const now = Date.now();
  if (now - (lastRuns.get(key) ?? 0) < intervalMs) return undefined;
  lastRuns.set(key, now);
  return task();
}
