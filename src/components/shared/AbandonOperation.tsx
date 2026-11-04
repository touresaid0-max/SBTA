import { useState } from 'react';
import { MIN_ABANDON_REASON } from '@/services/offline/queueRules';

interface AbandonOperationProps {
  /** Gives up the operation with the written reason (throws when refused) */
  onAbandon: (reason: string) => Promise<void>;
}

/**
 * « Abandonner » for a failed operation of a sending queue: only with a written reason, which is
 * kept with the operation on the device.
 */
export function AbandonOperation({ onAbandon }: AbandonOperationProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const long = reason.trim().length >= MIN_ABANDON_REASON;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1.5 text-xs font-semibold underline"
        style={{ color: '#DC2626' }}
      >
        Abandonner…
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-1.5">
      <textarea
        value={reason}
        onChange={e => { setReason(e.target.value); setError(''); }}
        rows={2}
        placeholder="Pourquoi abandonner cette opération ? (obligatoire)"
        className="w-full rounded-lg border px-2 py-1.5 text-xs outline-none"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
      />
      {error && <p className="text-xs" style={{ color: '#DC2626' }}>{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!long || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onAbandon(reason);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Abandon impossible');
              setSaving(false);
            }
          }}
          className="rounded-lg px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
          style={{ backgroundColor: '#DC2626' }}
        >
          Confirmer l'abandon
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setReason(''); setError(''); }}
          className="text-xs"
          style={{ color: 'var(--text-muted)' }}
        >
          Annuler
        </button>
        {!long && (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {MIN_ABANDON_REASON} caractères au moins
          </span>
        )}
      </div>
    </div>
  );
}
