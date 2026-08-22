import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import ChangeRequestModal from './ChangeRequestModal';
import type { OperationType } from '../../services/changeRequest.service';

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

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`flex items-center gap-1.5 rounded-lg font-medium transition-colors ${
          compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'
        }`}
        style={{
          border: '1px solid #F59E0B',
          color: '#F59E0B',
          background: '#FFFBEB',
        }}
        title="Demander une modification ou une suppression de cette opération"
      >
        <AlertTriangle className={compact ? 'w-3 h-3' : 'w-4 h-4'} />
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
