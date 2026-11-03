import { useEffect, useState } from 'react';
import { X, RefreshCw, AlertCircle, Clock, CheckCircle } from 'lucide-react';
import { getQueueItems, retryQueueItem, nextRetryAt } from '@/services/pos/syncEngine';
import type { SyncQueueItem } from '@/services/pos/db';

interface SyncQueueModalProps {
  open: boolean;
  onClose: () => void;
}

const ENTITY_LABELS: Record<string, string> = {
  departs: 'Départ',
  tickets: 'Ticket',
  bagages: 'Bagage',
  depenses: 'Dépense',
};

const OP_LABELS: Record<string, string> = {
  insert: 'Création',
  update: 'Modification',
  delete: 'Suppression',
};

const money = (v: unknown) => `${Number(v ?? 0).toLocaleString('fr-FR')} FCFA`;

function describe(item: SyncQueueItem): string {
  const p = item.payload;
  if (item.op === 'delete') return `${ENTITY_LABELS[item.entity] ?? item.entity} supprimé`;
  if (item.op === 'update') {
    if (p.cancelled === true || p.status === 'cancelled') return 'Annulation';
    if (p.cloture === true) return 'Clôture du départ';
    if (p.confirmed === true) return 'Confirmation du départ';
    return 'Mise à jour';
  }
  switch (item.entity) {
    case 'tickets': {
      const seats = Array.isArray(p.seat_numbers) && p.seat_numbers.length > 0 ? (p.seat_numbers as unknown[]).join(', ') : p.seat_number;
      return `N° ${p.ticket_number ?? '—'} · siège ${seats ?? '—'} · ${money(p.price)}`;
    }
    case 'departs':
      return `Départ n° ${p.departure_number ?? '—'} · ${p.route_name ?? ''} · ${p.bus_plate ?? ''}`;
    case 'bagages':
      return `N° ${p.bagage_number ?? '—'} · ${p.destination ?? ''} · ${money(p.price)}`;
    case 'depenses':
      return `${p.label ?? p.type ?? 'Dépense'} · ${money(p.amount)}`;
    default:
      return OP_LABELS[item.op] ?? item.op;
  }
}

function formatTime(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function nextTry(item: SyncQueueItem): string {
  const at = nextRetryAt(item);
  if (!at) return '';
  const s = Math.round((at - Date.now()) / 1000);
  if (s <= 0) return 'nouvel essai imminent';
  return s < 60 ? `nouvel essai dans ${s} s` : `nouvel essai dans ${Math.ceil(s / 60)} min`;
}

/**
 * Operations recorded on this device and not yet confirmed by the server. Nothing can be deleted
 * here: a sale not yet sent is money already collected.
 */
export function SyncQueueModal({ open, onClose }: SyncQueueModalProps) {
  const [items, setItems] = useState<SyncQueueItem[]>([]);

  const refresh = async () => setItems(await getQueueItems());

  useEffect(() => {
    if (!open) return;
    void refresh();
    const interval = setInterval(() => void refresh(), 3000);
    return () => clearInterval(interval);
  }, [open]);

  if (!open) return null;

  const failed = items.filter(i => i.status === 'error').length;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--surface)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
          <h3 className="font-bold text-base flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Clock className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
            Opérations en attente d'envoi
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100" aria-label="Fermer">
            <X className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        <div className="p-5 space-y-2 max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle className="w-10 h-10 mx-auto mb-2" style={{ color: 'var(--success, #16a34a)' }} />
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Tout est envoyé au serveur.
              </p>
            </div>
          ) : (
            items.map(item => (
              <div
                key={item.id}
                className="flex items-start gap-3 rounded-lg px-3 py-2.5"
                style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)' }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--surface)', color: 'var(--text-secondary)' }}>
                      {ENTITY_LABELS[item.entity] ?? item.entity}
                    </span>
                    <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--surface)', color: 'var(--text-secondary)' }}>
                      {OP_LABELS[item.op] ?? item.op}
                    </span>
                    {item.status === 'error' && (
                      <span className="text-xs font-semibold px-1.5 py-0.5 rounded flex items-center gap-1" style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>
                        <AlertCircle className="w-3 h-3" /> Échec
                      </span>
                    )}
                    {item.status === 'pending' && (
                      <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
                        En attente
                      </span>
                    )}
                    {item.status === 'syncing' && (
                      <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: '#DBEAFE', color: '#1D4ED8' }}>
                        Envoi en cours
                      </span>
                    )}
                  </div>
                  <p className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>{describe(item)}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    Enregistrée le {formatTime(item.created_at)}
                    {item.tries > 0 && ` · ${item.tries} essai${item.tries > 1 ? 's' : ''}`}
                    {item.status === 'error' && nextTry(item) && ` · ${nextTry(item)}`}
                  </p>
                  {item.status === 'error' && item.last_error && (
                    <p className="text-xs mt-1" style={{ color: '#DC2626' }}>{item.last_error}</p>
                  )}
                </div>
                {item.status === 'error' && (
                  <button
                    onClick={async () => { if (item.id) { await retryQueueItem(item.id); await refresh(); } }}
                    className="p-1.5 rounded-lg hover:bg-gray-100 flex-shrink-0"
                    title="Réessayer maintenant"
                    aria-label="Réessayer maintenant"
                  >
                    <RefreshCw className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        <div className="px-5 py-3 text-xs" style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          {failed > 0
            ? 'Les opérations en échec sont renvoyées automatiquement, de plus en plus espacées (jusqu\'à 10 min). « Réessayer » les renvoie tout de suite.'
            : 'Les opérations partent automatiquement dès que la connexion le permet.'}
        </div>
      </div>
    </div>
  );
}
