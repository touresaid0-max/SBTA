import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import ChangeRequestModal from './ChangeRequestModal';
import { checkExistingChangeRequest } from '../../services/changeRequest.service';
import { STATUS_LABELS } from '../../services/changeRequest.service';
import type { OperationType } from '../../services/changeRequest.service';
import toast from 'react-hot-toast';

interface ChangeRequestButtonProps {
  operationType: OperationType | string;
  operationId: string;
  operationTable: string;
  operationReference: string;
  operationSnapshot?: Record<string, unknown> | null;
  stationId?: string | null;
  stationName?: string | null;
  label?: string;
  compact?: boolean;
}

export default function ChangeRequestButton({
  operationType,
  operationId,
  operationTable,
  operationReference,
  operationSnapshot,
  stationId,
  stationName,
  label = 'Demander modification/suppression',
  compact = false,
}: ChangeRequestButtonProps) {
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);

  const handleClick = async () => {
    setChecking(true);
    try {
      const result = await checkExistingChangeRequest(operationTable, operationId);
      if (result.status === 'pending') {
        const statusLabel = result.existingStatus
          ? STATUS_LABELS[result.existingStatus]
          : 'en cours de traitement';
        toast(`Une demande est déjà en cours de traitement pour cette opération (${statusLabel}).`, {
          icon: '⚠️',
          duration: 5000,
        });
        return;
      }
      if (result.status === 'executed') {
        toast('Cette opération a déjà fait l\'objet d\'une demande exécutée. Aucune nouvelle demande n\'est possible.', {
          icon: 'ℹ️',
          duration: 5000,
        });
        return;
      }
      setOpen(true);
    } catch {
      setOpen(true);
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <button
        onClick={handleClick}
        disabled={checking}
        className={`flex items-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-60 ${
          compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'
        }`}
        style={{
          border: '1px solid #F59E0B',
          color: '#F59E0B',
          background: '#FFFBEB',
        }}
        title="Demander une modification ou une suppression de cette opération"
      >
        {checking ? (
          <Loader2 className={`${compact ? 'w-3 h-3' : 'w-4 h-4'} animate-spin`} />
        ) : (
          <AlertTriangle className={compact ? 'w-3 h-3' : 'w-4 h-4'} />
        )}
        {compact ? 'Demander' : label}
      </button>
      <ChangeRequestModal
        open={open}
        onClose={() => setOpen(false)}
        operationType={operationType}
        operationId={operationId}
        operationTable={operationTable}
        operationReference={operationReference}
        operationSnapshot={operationSnapshot}
        stationId={stationId}
        stationName={stationName}
      />
    </>
  );
}
