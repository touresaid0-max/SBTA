import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PlusCircle, Ticket, Package, Building2, Receipt, Lock, FileText,
  Settings as SettingsIcon, Wifi, WifiOff, UploadCloud, RefreshCw, LogOut,
  AlertTriangle, CheckCircle, XCircle, X, RotateCw, Trash2, Zap, Eraser,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { PWAUpdateBanner } from '@/components/pos/PWAUpdateBanner';
import { usePOSSession } from '@/services/pos/POSSessionContext';
import { useSyncStatus } from '@/services/pos/useSyncStatus';
import {
  retryAllErrors, forceSyncItem, discardErrorItem, type SyncErrorDetail,
} from '@/services/pos/syncService';
import { resetOperationalData } from '@/services/pos/db';

interface TileConfig {
  label: string;
  icon: typeof PlusCircle;
  path: string;
  color: string;
  bgColor: string;
}

const tiles: TileConfig[] = [
  { label: 'Nouveau départ', icon: PlusCircle, path: '/guichet/depart/nouveau', color: '#0B7439', bgColor: '#d4edda' },
  { label: 'Vente des tickets', icon: Ticket, path: '/guichet/departs', color: '#1D6FA4', bgColor: '#DBEAFE' },
  { label: 'Gestion des bagages', icon: Package, path: '/guichet/departs', color: '#D97706', bgColor: '#FEF3C7' },
  { label: 'Gestion autres gares', icon: Building2, path: '/guichet/autres-gares', color: '#7C3AED', bgColor: '#EDE9FE' },
  { label: 'Nouvelles dépenses', icon: Receipt, path: '/guichet/depenses', color: '#AF3029', bgColor: '#f8d7d5' },
  { label: 'Clôture', icon: Lock, path: '/guichet/cloture', color: '#4A6B55', bgColor: '#E2EAE5' },
  { label: 'États & exports', icon: FileText, path: '/guichet/departs', color: '#2563EB', bgColor: '#DBEAFE' },
];

const ENTITY_LABELS: Record<string, string> = {
  departs: 'Départ',
  tickets: 'Ticket',
  bagages: 'Bagage',
  depenses: 'Dépense',
};

const ERROR_LABELS: Record<string, string> = {
  duplicate: 'Doublon',
  rls: 'Sécurité (RLS)',
  missing_column: 'Colonne manquante',
  constraint: 'Contrainte DB',
  network: 'Réseau',
  unknown: 'Inconnu',
};

function errorBadgeColor(type: string): string {
  switch (type) {
    case 'duplicate': return '#D97706';
    case 'rls': return '#DC2626';
    case 'missing_column': return '#7C3AED';
    case 'constraint': return '#DC2626';
    case 'network': return '#2563EB';
    default: return '#6B7280';
  }
}

export default function POSAccueil() {
  const navigate = useNavigate();
  const { session, logout } = usePOSSession();
  const { isOnline, pendingCount, errorCount, syncErrors, syncing, triggerSync } = useSyncStatus();
  const [showErrors, setShowErrors] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetting, setResetting] = useState(false);

  const canSync = isOnline && pendingCount > 0 && !syncing;
  const hasErrors = errorCount > 0;

  const handleReset = async () => {
    setResetting(true);
    try {
      await resetOperationalData();
      await triggerSync();
      toast.success('Données opérationnelles remises à zéro');
      setShowResetModal(false);
    } catch {
      toast.error('Erreur lors de la remise à zéro');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--bg-subtle)' }}>
      <header
        className="px-4 py-4 sticky top-0 z-30"
        style={{ backgroundColor: 'var(--primary)', color: 'white' }}
      >
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-sm font-bold leading-tight truncate">
              {session?.station_name ?? 'Gare'}
            </p>
            <p className="text-xs opacity-80 leading-tight truncate">
              {session?.full_name ?? 'Terminal de vente'}
              {session?.offline && ' · Hors ligne'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Sync button / badge */}
            {pendingCount > 0 && (
              <button
                onClick={() => triggerSync()}
                disabled={!canSync}
                className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: hasErrors ? 'rgba(220,38,38,0.9)' : 'rgba(255,255,255,0.25)',
                }}
                title={
                  !isOnline
                    ? 'Hors ligne — synchronisation impossible'
                    : hasErrors
                      ? `${errorCount} erreur(s) — cliquez pour voir`
                      : `${pendingCount} opération(s) en attente — cliquez pour synchroniser`
                }
              >
                {syncing ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : hasErrors ? (
                  <AlertTriangle className="w-3.5 h-3.5" />
                ) : (
                  <UploadCloud className="w-3.5 h-3.5" />
                )}
                {pendingCount}
              </button>
            )}

            {/* Error indicator button */}
            {hasErrors && (
              <button
                onClick={() => setShowErrors(true)}
                className="flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full"
                style={{ backgroundColor: 'rgba(220,38,38,0.9)' }}
                title="Voir les erreurs de synchronisation"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                {errorCount}
              </button>
            )}

            {/* Online/offline indicator */}
            <span
              className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full"
              style={{
                backgroundColor: isOnline ? 'rgba(255,255,255,0.2)' : 'rgba(220,38,38,0.4)',
              }}
            >
              {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
              {isOnline ? 'En ligne' : 'Hors ligne'}
            </span>

            <button
              onClick={() => navigate('/guichet/parametres')}
              className="flex items-center justify-center w-11 h-11 rounded-xl transition-colors hover:bg-white/15"
              aria-label="Paramètres"
            >
              <SettingsIcon className="w-5 h-5" />
            </button>
            <button
              onClick={() => { logout(); navigate('/guichet/connexion'); }}
              className="flex items-center justify-center w-11 h-11 rounded-xl transition-colors hover:bg-white/15"
              aria-label="Déconnexion"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Sync status banner */}
      {(pendingCount > 0 || !isOnline) && (
        <div
          className="px-4 py-2.5 text-sm flex items-center justify-between gap-2"
          style={{
            backgroundColor: !isOnline ? '#FEF3C7' : hasErrors ? '#FEE2E2' : '#DBEAFE',
            color: !isOnline ? '#92400E' : hasErrors ? '#991B1B' : '#1E40AF',
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            {!isOnline ? (
              <>
                <WifiOff className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">
                  Hors ligne — {pendingCount} opération(s) en attente seront synchronisées automatiquement au retour du réseau
                </span>
              </>
            ) : hasErrors ? (
              <>
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">
                  {errorCount} erreur(s) de synchronisation sur {pendingCount} opération(s)
                </span>
              </>
            ) : (
              <>
                <UploadCloud className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">
                  {syncing
                    ? 'Synchronisation en cours…'
                    : `${pendingCount} opération(s) en attente — synchronisation automatique en cours`}
                </span>
              </>
            )}
          </div>
          {hasErrors && isOnline && (
            <button
              onClick={() => setShowErrors(true)}
              className="text-xs font-bold underline flex-shrink-0"
              style={{ color: '#991B1B' }}
            >
              Voir détails
            </button>
          )}
        </div>
      )}

      <main className="flex-1 px-4 py-6 sm:px-6">
        <h2 className="text-lg font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
          Menu principal
        </h2>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
          {tiles.map(tile => {
            const Icon = tile.icon;
            return (
              <button
                key={tile.path + tile.label}
                onClick={() => navigate(tile.path)}
                className="flex flex-col items-center justify-center gap-3 p-4 sm:p-6 rounded-2xl border-2 transition-all active:scale-95 hover:shadow-md min-h-[140px] sm:min-h-[160px]"
                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
              >
                <div
                  className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center transition-transform"
                  style={{ backgroundColor: tile.bgColor, color: tile.color }}
                >
                  <Icon className="w-7 h-7 sm:w-8 sm:h-8" strokeWidth={2} />
                </div>
                <span className="text-sm sm:text-base font-bold text-center leading-tight" style={{ color: 'var(--text-primary)' }}>
                  {tile.label}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-8 flex flex-col items-center gap-3">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Sélectionnez une action pour commencer
          </p>
          <button
            onClick={() => setShowResetModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all hover:shadow-md"
            style={{
              backgroundColor: 'transparent',
              color: '#DC2626',
              border: '1px solid #FECACA',
            }}
          >
            <Eraser className="w-4 h-4" />
            Remise à zéro des données
          </button>
        </div>
      </main>

      <PWAUpdateBanner />

      {/* Reset confirmation modal */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div
            className="w-full max-w-md rounded-2xl shadow-xl p-6"
            style={{ backgroundColor: 'var(--surface)' }}
          >
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: '#FEE2E2' }}
              >
                <AlertTriangle className="w-6 h-6" style={{ color: '#DC2626' }} />
              </div>
              <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                Remise à zéro des données
              </h3>
            </div>
            <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
              Cette action supprimera tous les départs, tickets, bagages, dépenses et la file de synchronisation de ce terminal.
            </p>
            <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
              La configuration (gares, lignes, bus, chauffeurs, utilisateurs, paramètres) est conservée.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowResetModal(false)}
                disabled={resetting}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold transition-colors"
                style={{
                  backgroundColor: 'var(--bg-subtle)',
                  color: 'var(--text-secondary)',
                }}
              >
                Annuler
              </button>
              <button
                onClick={handleReset}
                disabled={resetting}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-colors disabled:opacity-60"
                style={{ backgroundColor: '#DC2626' }}
              >
                {resetting ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Eraser className="w-4 h-4" />
                )}
                {resetting ? 'Remise à zéro…' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error diagnostic modal */}
      {showErrors && (
        <ErrorDiagnosticModal
          errors={syncErrors}
          onClose={() => setShowErrors(false)}
          onRetryAll={async () => {
            await retryAllErrors();
            await triggerSync();
          }}
          onForceItem={async (id: number) => {
            await forceSyncItem(id);
            await triggerSync();
          }}
          onDiscardItem={async (id: number) => {
            await discardErrorItem(id);
          }}
        />
      )}
    </div>
  );
}

function ErrorDiagnosticModal({
  errors,
  onClose,
  onRetryAll,
  onForceItem,
  onDiscardItem,
}: {
  errors: SyncErrorDetail[];
  onClose: () => void;
  onRetryAll: () => void;
  onForceItem: (id: number) => void;
  onDiscardItem: (id: number) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div
        className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl shadow-xl"
        style={{ backgroundColor: 'var(--surface)' }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            <h3 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
              Erreurs de synchronisation ({errors.length})
            </h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {errors.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <CheckCircle className="w-10 h-10 text-green-500" />
              <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                Aucune erreur — toutes les opérations sont synchronisées
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {errors.map((err) => (
                <ErrorRow
                  key={err.queueId}
                  error={err}
                  onForce={() => onForceItem(err.queueId)}
                  onDiscard={() => onDiscardItem(err.queueId)}
                />
              ))}
            </div>
          )}
        </div>

        {errors.length > 0 && (
          <div className="flex items-center justify-between px-5 py-4 border-t" style={{ borderColor: 'var(--border)' }}>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              « Réessayer » remet toutes les erreurs en file et relance la sync
            </p>
            <button
              onClick={onRetryAll}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold text-white transition-colors"
              style={{ backgroundColor: 'var(--primary)' }}
            >
              <RotateCw className="w-4 h-4" />
              Tout réessayer
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ErrorRow({
  error,
  onForce,
  onDiscard,
}: {
  error: SyncErrorDetail;
  onForce: () => void;
  onDiscard: () => void;
}) {
  return (
    <div
      className="rounded-xl border p-3"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)' }}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <XCircle className="w-4 h-4 flex-shrink-0" style={{ color: errorBadgeColor(error.errorType) }} />
          <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
            {ENTITY_LABELS[error.entity] ?? error.entity} · {error.op}
          </span>
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white flex-shrink-0"
            style={{ backgroundColor: errorBadgeColor(error.errorType) }}
          >
            {ERROR_LABELS[error.errorType] ?? 'Erreur'}
          </span>
        </div>
        <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
          {error.tries} essai(s)
        </span>
      </div>

      <p className="text-xs mb-1 font-mono break-all" style={{ color: 'var(--text-secondary)' }}>
        ID: {error.payloadId}
      </p>
      <p className="text-xs mb-3 break-words" style={{ color: 'var(--text-secondary)' }}>
        {error.error}
      </p>

      <div className="flex items-center gap-2">
        <button
          onClick={onForce}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white transition-colors"
          style={{ backgroundColor: 'var(--primary)' }}
        >
          <Zap className="w-3.5 h-3.5" />
          Forcer
        </button>
        <button
          onClick={onDiscard}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
          style={{ backgroundColor: 'transparent', color: '#DC2626', border: '1px solid #FECACA' }}
        >
          <Trash2 className="w-3.5 h-3.5" />
          Supprimer
        </button>
      </div>
    </div>
  );
}
