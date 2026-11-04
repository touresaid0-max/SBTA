import { useState, useEffect } from 'react';
import { X, RefreshCw, AlertCircle, Clock, Package } from 'lucide-react';
import { getQueueItems, abandonQueueItem, retryQueueItem, type StoreName } from '@/services/courrier/syncEngine';
import type { SyncQueueItem } from '@/services/courrier/db';
import { useConnection } from '@/services/courrier/ConnectionContext';
import { useCourrierUser } from '@/services/courrier/useCourrierUser';
import { AbandonOperation } from '@/components/shared/AbandonOperation';
import { byQueueOrder } from '@/services/offline/queueRules';

interface CourrierSyncQueueModalProps {
  open: boolean;
  onClose: () => void;
  onSyncNow: () => void;
}

const ENTITY_LABELS: Record<string, string> = {
  parcels: 'Courrier',
  tracking_events: 'Événement de suivi',
  sms: 'SMS au destinataire',
  photos: 'Photo du courrier',
};

const OP_LABELS: Record<string, string> = {
  insert: 'Création',
  update: 'Modification',
  delete: 'Suppression',
};

function describePayload(item: SyncQueueItem): string {
  const p = item.payload;
  if (item.entity === 'parcels') {
    if (item.op === 'insert') {
      return `Nouveau courrier — ${p.recipient_name ?? 'N/A'} → ${p.recipient_city ?? 'N/A'}`;
    }
    if (item.op === 'update') {
      if (p.status) return `Changement de statut : ${p.status}`;
      if (p.sender_name || p.recipient_name) return `Modification des infos`;
      return `Mise à jour`;
    }
    if (item.op === 'delete') return `Suppression du courrier`;
  }
  if (item.entity === 'tracking_events') {
    return `Suivi — ${p.description ?? p.event_type ?? ''}`;
  }
  if (item.entity === 'photos') {
    return 'Photo du courrier (envoi vers l\'espace privé)';
  }
  if (item.entity === 'sms') {
    return p.kind === 'arrived' ? 'SMS « courrier arrivé »' : `SMS « courrier enregistré » — ${p.parcel_code ?? ''}`;
  }
  return `${ENTITY_LABELS[item.entity] ?? item.entity} — ${OP_LABELS[item.op] ?? item.op}`;
}

export function CourrierSyncQueueModal({ open, onClose, onSyncNow }: CourrierSyncQueueModalProps) {
  const [items, setItems] = useState<SyncQueueItem[]>([]);
  const { status } = useConnection();
  const user = useCourrierUser();
  // Abandoned operations stay listed as a trace, after the ones still to send
  const toSend = items.filter(i => i.status !== 'abandoned');
  const canRetry = (item: SyncQueueItem) => item.status === 'error' || item.status === 'failed';

  useEffect(() => {
    if (!open) return;
    void refreshItems();
    const interval = setInterval(() => void refreshItems(), 3000);
    return () => clearInterval(interval);
  }, [open]);

  async function refreshItems() {
    const queueItems = await getQueueItems();
    queueItems.sort((a, b) => Number(a.status === 'abandoned') - Number(b.status === 'abandoned') || byQueueOrder(a, b));
    setItems(queueItems);
  }

  // An operation used to be deletable here without a trace, whatever its state: a failed one is
  // now given up with a written reason, kept with it on the device
  async function handleAbandon(id: number, reason: string) {
    await abandonQueueItem(id, reason, user.full_name || 'agent');
    await refreshItems();
  }

  async function handleRetry(id: number) {
    await retryQueueItem(id);
    await refreshItems();
  }

  if (!open) return null;

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
            File de synchronisation
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        <div className="p-5 space-y-2 max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <div className="text-center py-8">
              <Package className="w-10 h-10 mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Aucune opération en attente.
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
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--surface)', color: 'var(--text-secondary)' }}>
                      {ENTITY_LABELS[item.entity] ?? item.entity}
                    </span>
                    <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--surface)', color: 'var(--text-secondary)' }}>
                      {OP_LABELS[item.op] ?? item.op}
                    </span>
                    {item.status === 'error' && (
                      <span className="text-xs font-semibold px-1.5 py-0.5 rounded flex items-center gap-1" style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>
                        <AlertCircle className="w-3 h-3" /> Erreur
                      </span>
                    )}
                    {item.status === 'failed' && (
                      <span className="text-xs font-semibold px-1.5 py-0.5 rounded flex items-center gap-1" style={{ backgroundColor: '#DC2626', color: '#fff' }}>
                        <AlertCircle className="w-3 h-3" /> Refusée par le serveur
                      </span>
                    )}
                    {item.status === 'abandoned' && (
                      <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--surface)', color: 'var(--text-muted)' }}>
                        Abandonnée
                      </span>
                    )}
                    {item.status === 'pending' && (
                      <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
                        En attente
                      </span>
                    )}
                  </div>
                  <p className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>
                    {describePayload(item)}
                  </p>
                  {canRetry(item) && item.last_error && (
                    <p className="text-xs mt-1" style={{ color: '#DC2626' }}>{item.last_error}</p>
                  )}
                  {item.status === 'failed' && (
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      Plus renvoyée automatiquement : « Réessayer » après correction, ou abandonner avec une justification.
                    </p>
                  )}
                  {item.status === 'abandoned' && (
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                      Abandonnée{item.abandoned_by ? ` par ${item.abandoned_by}` : ''} : {item.abandon_reason}
                    </p>
                  )}
                  {canRetry(item) && item.id && (
                    <AbandonOperation onAbandon={reason => handleAbandon(item.id!, reason)} />
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {canRetry(item) && (
                    <button
                      onClick={() => item.id && void handleRetry(item.id)}
                      className="p-1.5 rounded-lg hover:bg-gray-100"
                      title="Réessayer"
                    >
                      <RefreshCw className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="px-5 py-4 flex items-center justify-between gap-3" style={{ borderTop: '1px solid var(--border)' }}>
          {status === 'offline' ? (
            <p className="text-xs flex-1" style={{ color: 'var(--text-muted)' }}>
              La synchronisation reprendra automatiquement au retour de la connexion.
            </p>
          ) : (
            <p className="text-xs flex-1" style={{ color: 'var(--text-muted)' }}>
              {toSend.length} opération{toSend.length > 1 ? 's' : ''} en attente
            </p>
          )}
          {status === 'online' && toSend.length > 0 && (
            <button
              onClick={() => { onSyncNow(); onClose(); }}
              className="px-4 py-2 rounded-lg text-sm font-semibold"
              style={{ backgroundColor: '#2563EB', color: '#fff' }}
            >
              Tout synchroniser
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export type { StoreName };
