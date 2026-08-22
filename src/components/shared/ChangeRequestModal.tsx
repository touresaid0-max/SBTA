import React, { useState } from 'react';
import { X, AlertTriangle, Upload, FileText, Zap } from 'lucide-react';
import { submitChangeRequest, type ChangeRequestType, type OperationType } from '../../services/changeRequest.service';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';

interface ChangeRequestModalProps {
  open: boolean;
  onClose: () => void;
  operationType: OperationType | string;
  operationId: string;
  operationTable: string;
  operationReference: string;
  operationSnapshot?: Record<string, unknown> | null;
  stationId?: string | null;
  stationName?: string | null;
  onSubmitted?: () => void;
}

export default function ChangeRequestModal({
  open,
  onClose,
  operationType,
  operationId,
  operationTable,
  operationReference,
  operationSnapshot,
  stationId,
  stationName,
  onSubmitted,
}: ChangeRequestModalProps) {
  const { user } = useAuthStore();
  const [requestType, setRequestType] = useState<ChangeRequestType>('modification');
  const [reason, setReason] = useState('');
  const [errorDescription, setErrorDescription] = useState('');
  const [modificationDetails, setModificationDetails] = useState('');
  const [additionalComment, setAdditionalComment] = useState('');
  const [justificationDocUrl, setJustificationDocUrl] = useState('');
  const [isEmergency, setIsEmergency] = useState(false);
  const [emergencyJustification, setEmergencyJustification] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const canUseEmergency = user?.role === 'chef_gare' || user?.role === 'admin' || user?.role === 'dg';

  const handleSubmit = async () => {
    if (!reason.trim()) {
      toast.error('Le motif est obligatoire');
      return;
    }
    if (!errorDescription.trim()) {
      toast.error('La description de l\'erreur est obligatoire');
      return;
    }
    if (requestType === 'modification' && !modificationDetails.trim()) {
      toast.error('Veuillez indiquer les informations à modifier');
      return;
    }
    if (isEmergency && !emergencyJustification.trim()) {
      toast.error('La justification de l\'urgence est obligatoire');
      return;
    }

    setSubmitting(true);
    const result = await submitChangeRequest({
      request_type: requestType,
      operation_type: operationType,
      operation_id: operationId,
      operation_table: operationTable,
      operation_reference: operationReference,
      operation_snapshot: operationSnapshot ?? null,
      reason: reason.trim(),
      error_description: errorDescription.trim(),
      modification_details: requestType === 'modification' ? modificationDetails.trim() : null,
      new_values: null,
      justification_doc_url: justificationDocUrl.trim() || null,
      additional_comment: additionalComment.trim() || null,
      station_id: stationId ?? null,
      station_name: stationName ?? null,
      is_emergency: isEmergency,
      emergency_justification: isEmergency ? emergencyJustification.trim() : null,
    });
    setSubmitting(false);

    if ('error' in result) {
      toast.error(result.error);
    } else {
      toast.success('Demande enregistrée avec le statut « En attente d\'autorisation »');
      onSubmitted?.();
      handleClose();
    }
  };

  const handleClose = () => {
    setRequestType('modification');
    setReason('');
    setErrorDescription('');
    setModificationDetails('');
    setAdditionalComment('');
    setJustificationDocUrl('');
    setIsEmergency(false);
    setEmergencyJustification('');
    onClose();
  };

  const labelClass = 'block text-sm font-medium mb-1.5';
  const inputClass = 'w-full px-3 py-2 rounded-lg border text-sm outline-none transition-colors';
  const inputStyle = { borderColor: 'var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-xl"
        style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)' }}
      >
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between px-6 py-4 border-b z-10"
             style={{ borderColor: 'var(--border)', background: 'var(--bg-primary)' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'var(--bg-tertiary)' }}>
              <AlertTriangle className="w-5 h-5" style={{ color: '#F59E0B' }} />
            </div>
            <div>
              <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                Demande de modification / suppression
              </h2>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Opération : {operationReference}
              </p>
            </div>
          </div>
          <button onClick={handleClose} className="p-1.5 rounded-lg transition-colors hover:bg-black/5">
            <X className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* Info banner */}
          <div className="rounded-lg px-4 py-3 text-sm" style={{ background: '#FEF3C7', border: '1px solid #FCD34D' }}>
            <p style={{ color: '#92400E' }}>
              Aucune modification ou suppression directe n'est autorisée. Votre demande sera
              transmise au DG pour autorisation avant exécution par l'équipe technique.
            </p>
          </div>

          {/* Request type */}
          <div>
            <label className={labelClass} style={{ color: 'var(--text-primary)' }}>
              Type de demande <span style={{ color: '#EF4444' }}>*</span>
            </label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setRequestType('modification')}
                className="flex-1 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all"
                style={{
                  borderColor: requestType === 'modification' ? '#3B82F6' : 'var(--border)',
                  background: requestType === 'modification' ? '#EFF6FF' : 'var(--bg-secondary)',
                  color: requestType === 'modification' ? '#3B82F6' : 'var(--text-secondary)',
                }}
              >
                Demander une modification
              </button>
              <button
                type="button"
                onClick={() => setRequestType('suppression')}
                className="flex-1 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all"
                style={{
                  borderColor: requestType === 'suppression' ? '#EF4444' : 'var(--border)',
                  background: requestType === 'suppression' ? '#FEF2F2' : 'var(--bg-secondary)',
                  color: requestType === 'suppression' ? '#EF4444' : 'var(--text-secondary)',
                }}
              >
                Demander une suppression
              </button>
            </div>
          </div>

          {/* Operation number (read-only) */}
          <div>
            <label className={labelClass} style={{ color: 'var(--text-primary)' }}>
              Numéro de l'opération
            </label>
            <input
              type="text"
              value={operationReference}
              readOnly
              className={inputClass}
              style={inputStyle}
            />
          </div>

          {/* Reason */}
          <div>
            <label className={labelClass} style={{ color: 'var(--text-primary)' }}>
              Motif <span style={{ color: '#EF4444' }}>*</span>
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Motif de la demande"
              className={inputClass}
              style={inputStyle}
            />
          </div>

          {/* Error description */}
          <div>
            <label className={labelClass} style={{ color: 'var(--text-primary)' }}>
              Description de l'erreur <span style={{ color: '#EF4444' }}>*</span>
            </label>
            <textarea
              value={errorDescription}
              onChange={(e) => setErrorDescription(e.target.value)}
              placeholder="Décrivez l'erreur constatée..."
              rows={3}
              className={inputClass}
              style={inputStyle}
            />
          </div>

          {/* Modification details (only for modification) */}
          {requestType === 'modification' && (
            <div>
              <label className={labelClass} style={{ color: 'var(--text-primary)' }}>
                Informations à modifier <span style={{ color: '#EF4444' }}>*</span>
              </label>
              <textarea
                value={modificationDetails}
                onChange={(e) => setModificationDetails(e.target.value)}
                placeholder="Indiquez les informations à modifier et les nouvelles valeurs..."
                rows={3}
                className={inputClass}
                style={inputStyle}
              />
            </div>
          )}

          {/* Justification document */}
          <div>
            <label className={labelClass} style={{ color: 'var(--text-primary)' }}>
              Pièce justificative / document (URL si disponible)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={justificationDocUrl}
                onChange={(e) => setJustificationDocUrl(e.target.value)}
                placeholder="URL du document justificatif..."
                className={inputClass}
                style={inputStyle}
              />
              <button
                type="button"
                className="px-3 py-2 rounded-lg border flex items-center gap-1.5 text-sm transition-colors hover:bg-black/5"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              >
                <Upload className="w-4 h-4" />
                Parcourir
              </button>
            </div>
          </div>

          {/* Additional comment */}
          <div>
            <label className={labelClass} style={{ color: 'var(--text-primary)' }}>
              Commentaire complémentaire
            </label>
            <textarea
              value={additionalComment}
              onChange={(e) => setAdditionalComment(e.target.value)}
              placeholder="Tout commentaire utile..."
              rows={2}
              className={inputClass}
              style={inputStyle}
            />
          </div>

          {/* Emergency procedure */}
          {canUseEmergency && (
            <div className="rounded-lg border-2 p-4" style={{ borderColor: isEmergency ? '#F59E0B' : 'var(--border)' }}>
              <button
                type="button"
                onClick={() => setIsEmergency(!isEmergency)}
                className="flex items-center gap-2 w-full"
              >
                <Zap className="w-5 h-5" style={{ color: '#F59E0B' }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Procédure d'urgence
                </span>
                <input
                  type="checkbox"
                  checked={isEmergency}
                  onChange={(e) => setIsEmergency(e.target.checked)}
                  className="ml-auto"
                />
              </button>
              {isEmergency && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs" style={{ color: '#92400E' }}>
                    En cas d'urgence réelle et lorsque le DG est injoignable, le Chef de Gare peut
                    exceptionnellement autoriser l'intervention. Le dossier complet sera transmis au
                    DG pour contrôle dès qu'il sera joignable.
                  </p>
                  <div>
                    <label className={labelClass} style={{ color: 'var(--text-primary)' }}>
                      Justification de l'urgence <span style={{ color: '#EF4444' }}>*</span>
                    </label>
                    <textarea
                      value={emergencyJustification}
                      onChange={(e) => setEmergencyJustification(e.target.value)}
                      placeholder="Expliquez pourquoi la procédure d'urgence est nécessaire..."
                      rows={2}
                      className={inputClass}
                      style={inputStyle}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex items-center justify-end gap-3 px-6 py-4 border-t"
             style={{ borderColor: 'var(--border)', background: 'var(--bg-primary)' }}>
          <button
            onClick={handleClose}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-black/5"
            style={{ color: 'var(--text-secondary)' }}
          >
            Annuler
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-5 py-2 rounded-lg text-sm font-semibold text-white transition-opacity disabled:opacity-50"
            style={{ background: requestType === 'suppression' ? '#EF4444' : '#3B82F6' }}
          >
            {submitting ? 'Envoi...' : 'Enregistrer la demande'}
          </button>
        </div>
      </div>
    </div>
  );
}
