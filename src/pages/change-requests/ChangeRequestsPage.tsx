import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, XCircle, Clock, AlertTriangle, Zap, FileText, ChevronDown, ChevronUp, RefreshCw, Filter, Shield, Wrench, Trash2, CreditCard as Edit3 } from 'lucide-react';
import {
  fetchChangeRequests, fetchChangeRequestEvents,
  reviewChangeRequest, cancelChangeRequest,
  type ChangeRequest, type ChangeRequestEvent, type ChangeRequestStatus,
  STATUS_LABELS, STATUS_COLORS, OPERATION_LABELS,
} from '../../services/changeRequest.service';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';

interface ChangeRequestsPageProps {
  mode: 'approval' | 'execution' | 'my_requests' | 'audit';
}

export default function ChangeRequestsPage({ mode }: ChangeRequestsPageProps) {
  const { user } = useAuthStore();
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ChangeRequestStatus | 'all'>(
    mode === 'approval' ? 'en_attente' :
    mode === 'execution' ? 'all' :
    'all'
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [events, setEvents] = useState<Record<string, ChangeRequestEvent[]>>({});
  const [reviewModal, setReviewModal] = useState<{ request: ChangeRequest; decision: 'autoriser_modification' | 'autoriser_suppression' | 'refuser' } | null>(null);
  const [executeModal, setExecuteModal] = useState<ChangeRequest | null>(null);
  const [cancelModal, setCancelModal] = useState<ChangeRequest | null>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [executionNotes, setExecutionNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);

    const filters: { status?: ChangeRequestStatus | 'all'; requestedBy?: string } = {};
    if (statusFilter !== 'all') filters.status = statusFilter;
    if (mode === 'my_requests' && user?.id) filters.requestedBy = user.id;

    const data = await fetchChangeRequests(filters);
    setRequests(data);
    setLoading(false);
    setRefreshing(false);
  }, [statusFilter, mode, user?.id]);

  useEffect(() => { load(); }, [load]);

  const loadEvents = async (requestId: string) => {
    const evts = await fetchChangeRequestEvents(requestId);
    setEvents(prev => ({ ...prev, [requestId]: evts }));
  };

  const toggleExpand = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      if (!events[id]) loadEvents(id);
    }
  };

  const handleReview = async () => {
    if (!reviewModal) return;
    if (!reviewComment.trim()) {
      toast.error('Veuillez ajouter un commentaire de décision');
      return;
    }
    setSubmitting(true);
    const isEmergencyOverride = reviewModal.request.is_emergency && user?.role === 'chef_gare';
    const result = await reviewChangeRequest(
      reviewModal.request.id,
      reviewModal.decision,
      reviewComment.trim(),
      isEmergencyOverride
    );
    setSubmitting(false);
    if ('error' in result) {
      toast.error(result.error);
    } else {
      const actionLabel = reviewModal.decision === 'autoriser_modification' ? 'Modification autorisée'
        : reviewModal.decision === 'autoriser_suppression' ? 'Suppression autorisée'
        : 'Demande refusée';
      toast.success(actionLabel);
      setReviewModal(null);
      setReviewComment('');
      load(true);
    }
  };

  const handleExecuteConfirm = async () => {
    if (!executeModal) return;
    setSubmitting(true);
    const oldValues = executeModal.operation_snapshot;
    const isSuppression = executeModal.status === 'autorisee_suppression';
    const result = await executeChangeRequest(
      executeModal.id,
      executionNotes.trim() || 'Exécuté par l\'équipe technique',
      isSuppression ? oldValues : oldValues,
      isSuppression ? null : null,
      isSuppression ? oldValues : null,
    );
    setSubmitting(false);
    if ('error' in result) {
      toast.error(result.error);
    } else {
      toast.success('Action exécutée et enregistrée dans le journal d\'audit');
      setExecuteModal(null);
      setExecutionNotes('');
      load(true);
    }
  };

  const handleCancel = async () => {
    if (!cancelModal) return;
    setSubmitting(true);
    const result = await cancelChangeRequest(cancelModal.id, 'Annulée par l\'utilisateur');
    setSubmitting(false);
    if ('error' in result) {
      toast.error(result.error);
    } else {
      toast.success('Demande annulée');
      setCancelModal(null);
      load(true);
    }
  };

  const canReview = (req: ChangeRequest) =>
    req.status === 'en_attente' && (user?.role === 'dg' || user?.role === 'admin' || (req.is_emergency && user?.role === 'chef_gare'));

  const canExecute = (req: ChangeRequest) =>
    (req.status === 'autorisee_modification' || req.status === 'autorisee_suppression') &&
    (user?.role === 'admin' || user?.role === 'dg');

  const canCancel = (req: ChangeRequest) =>
    req.status === 'en_attente' && (req.requested_by === user?.id || user?.role === 'admin' || user?.role === 'dg');

  const pageTitle =
    mode === 'approval' ? 'Autorisation des demandes' :
    mode === 'execution' ? 'Exécution technique des demandes' :
    mode === 'audit' ? 'Journal d\'audit des demandes' :
    'Mes demandes de modification/suppression';

  const pageIcon =
    mode === 'approval' ? <Shield className="w-5 h-5" /> :
    mode === 'execution' ? <Wrench className="w-5 h-5" /> :
    mode === 'audit' ? <FileText className="w-5 h-5" /> :
    <Clock className="w-5 h-5" />;

  const statusOptions: { value: ChangeRequestStatus | 'all'; label: string }[] = [
    { value: 'all', label: 'Toutes' },
    { value: 'en_attente', label: 'En attente' },
    { value: 'autorisee_modification', label: 'Modification autorisée' },
    { value: 'autorisee_suppression', label: 'Suppression autorisée' },
    { value: 'refusee', label: 'Refusées' },
    { value: 'executee', label: 'Exécutées' },
    { value: 'annulee', label: 'Annulées' },
  ];

  const labelClass = 'block text-sm font-medium mb-1.5';
  const inputClass = 'w-full px-3 py-2 rounded-lg border text-sm outline-none';
  const inputStyle = { borderColor: 'var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <RefreshCw className="w-6 h-6 animate-spin" style={{ color: 'var(--text-muted)' }} />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'var(--bg-tertiary)' }}>
            {pageIcon}
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{pageTitle}</h1>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {requests.length} demande{requests.length > 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ChangeRequestStatus | 'all')}
              className="px-3 py-1.5 rounded-lg text-sm border outline-none"
              style={inputStyle}
            >
              {statusOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="p-2 rounded-lg border transition-colors hover:bg-black/5"
            style={{ borderColor: 'var(--border)' }}
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>
      </div>

      {/* Empty state */}
      {requests.length === 0 && (
        <div className="text-center py-16">
          <Clock className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Aucune demande à afficher
          </p>
        </div>
      )}

      {/* Request cards */}
      <div className="space-y-3">
        {requests.map((req) => {
          const isExpanded = expandedId === req.id;
          const reqEvents = events[req.id] || [];
          const statusColor = STATUS_COLORS[req.status];
          return (
            <div
              key={req.id}
              className="rounded-xl border overflow-hidden transition-shadow hover:shadow-md"
              style={{ borderColor: 'var(--border)', background: 'var(--bg-primary)' }}
            >
              {/* Card header */}
              <div className="flex items-start gap-3 px-5 py-4">
                <button
                  onClick={() => toggleExpand(req.id)}
                  className="mt-1 p-1 rounded transition-colors hover:bg-black/5"
                >
                  {isExpanded ? <ChevronUp className="w-4 h-4" style={{ color: 'var(--text-muted)' }} /> : <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />}
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                      {req.request_number}
                    </span>
                    <span
                      className="px-2 py-0.5 rounded-full text-xs font-medium text-white"
                      style={{ background: statusColor }}
                    >
                      {STATUS_LABELS[req.status]}
                    </span>
                    {req.is_emergency && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium flex items-center gap-1" style={{ background: '#FEF3C7', color: '#92400E' }}>
                        <Zap className="w-3 h-3" /> Urgence
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                      {req.request_type === 'modification' ? 'Modification' : 'Suppression'}
                    </span>
                  </div>
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                    {OPERATION_LABELS[req.operation_type] || req.operation_type} — {req.operation_reference}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    Par {req.requester_name} ({req.requester_role})
                    {req.station_name ? ` • ${req.station_name}` : ''}
                    {' • '} {new Date(req.created_at).toLocaleString('fr-FR')}
                  </p>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {canReview(req) && (
                    <>
                      {req.request_type === 'modification' && (
                        <button
                          onClick={() => { setReviewModal({ request: req, decision: 'autoriser_modification' }); setReviewComment(''); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-opacity hover:opacity-90"
                          style={{ background: '#3B82F6' }}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Autoriser modification
                        </button>
                      )}
                      {req.request_type === 'suppression' && (
                        <button
                          onClick={() => { setReviewModal({ request: req, decision: 'autoriser_suppression' }); setReviewComment(''); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-opacity hover:opacity-90"
                          style={{ background: '#EF4444' }}
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Autoriser suppression
                        </button>
                      )}
                      <button
                        onClick={() => { setReviewModal({ request: req, decision: 'refuser' }); setReviewComment(''); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-black/5"
                        style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                      >
                        <XCircle className="w-3.5 h-3.5" /> Refuser
                      </button>
                    </>
                  )}
                  {canExecute(req) && (
                    <button
                      onClick={() => { setExecuteModal(req); setExecutionNotes(''); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-opacity hover:opacity-90"
                      style={{ background: req.status === 'autorisee_suppression' ? '#EF4444' : '#10B981' }}
                    >
                      <Wrench className="w-3.5 h-3.5" /> Exécuter
                    </button>
                  )}
                  {canCancel(req) && (
                    <button
                      onClick={() => setCancelModal(req)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-black/5"
                      style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
                    >
                      Annuler
                    </button>
                  )}
                </div>
              </div>

              {/* Expanded section */}
              {isExpanded && (
                <div className="px-5 pb-5 border-t pt-4 space-y-4" style={{ borderColor: 'var(--border)' }}>
                  {/* Details grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Motif</p>
                      <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{req.reason}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Description de l'erreur</p>
                      <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{req.error_description}</p>
                    </div>
                    {req.modification_details && (
                      <div>
                        <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Informations à modifier</p>
                        <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{req.modification_details}</p>
                      </div>
                    )}
                    {req.additional_comment && (
                      <div>
                        <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Commentaire</p>
                        <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{req.additional_comment}</p>
                      </div>
                    )}
                    {req.emergency_justification && (
                      <div className="md:col-span-2">
                        <p className="text-xs font-semibold mb-1" style={{ color: '#92400E' }}>Justification d'urgence</p>
                        <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{req.emergency_justification}</p>
                      </div>
                    )}
                  </div>

                  {/* Review info */}
                  {req.reviewed_by && (
                    <div className="rounded-lg p-3" style={{ background: 'var(--bg-secondary)' }}>
                      <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Décision</p>
                      <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                        {req.reviewer_name} — {STATUS_LABELS[req.status]}
                        {' • '} {req.reviewed_at ? new Date(req.reviewed_at).toLocaleString('fr-FR') : ''}
                      </p>
                      {req.review_comment && (
                        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{req.review_comment}</p>
                      )}
                    </div>
                  )}

                  {/* Execution info */}
                  {req.executed_by && (
                    <div className="rounded-lg p-3" style={{ background: 'var(--bg-secondary)' }}>
                      <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Exécution technique</p>
                      <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                        {req.executor_name} — {req.executed_at ? new Date(req.executed_at).toLocaleString('fr-FR') : ''}
                      </p>
                      {req.execution_notes && (
                        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{req.execution_notes}</p>
                      )}
                    </div>
                  )}

                  {/* Snapshots */}
                  {req.old_values_snapshot && (
                    <div>
                      <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Anciennes valeurs</p>
                      <pre className="text-xs p-3 rounded-lg overflow-x-auto" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                        {JSON.stringify(req.old_values_snapshot, null, 2)}
                      </pre>
                    </div>
                  )}
                  {req.new_values_applied && (
                    <div>
                      <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Nouvelles valeurs appliquées</p>
                      <pre className="text-xs p-3 rounded-lg overflow-x-auto" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                        {JSON.stringify(req.new_values_applied, null, 2)}
                      </pre>
                    </div>
                  )}
                  {req.deleted_record_snapshot && (
                    <div>
                      <p className="text-xs font-semibold mb-1" style={{ color: '#EF4444' }}>Valeur supprimée (sauvegarde)</p>
                      <pre className="text-xs p-3 rounded-lg overflow-x-auto" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                        {JSON.stringify(req.deleted_record_snapshot, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* Timeline */}
                  {reqEvents.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>Traçabilité complète</p>
                      <div className="space-y-2">
                        {reqEvents.map((evt, i) => (
                          <div key={evt.id} className="flex items-start gap-3">
                            <div className="flex flex-col items-center">
                              <div className="w-2 h-2 rounded-full" style={{
                                background: evt.event_type === 'created' ? '#3B82F6'
                                  : evt.event_type === 'executed' ? '#10B981'
                                  : evt.event_type === 'refused' ? '#6B7280'
                                  : evt.event_type === 'emergency_override' ? '#F59E0B'
                                  : 'var(--text-muted)'
                              }} />
                              {i < reqEvents.length - 1 && <div className="w-0.5 h-6" style={{ background: 'var(--border)' }} />}
                            </div>
                            <div className="flex-1 pb-1">
                              <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                                {evt.event_type === 'created' ? 'Demande créée'
                                  : evt.event_type === 'reviewed' ? 'Demande examinée'
                                  : evt.event_type === 'executed' ? 'Action exécutée'
                                  : evt.event_type === 'refused' ? 'Demande refusée'
                                  : evt.event_type === 'cancelled' ? 'Demande annulée'
                                  : evt.event_type === 'emergency_override' ? 'Procédure d\'urgence (Chef de Gare)'
                                  : evt.event_type}
                              </p>
                              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                {evt.performer_name} ({evt.performer_role}) • {new Date(evt.created_at).toLocaleString('fr-FR')}
                              </p>
                              {evt.comment && (
                                <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{evt.comment}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Review modal */}
      {reviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-md rounded-2xl shadow-xl" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)' }}>
            <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                {reviewModal.decision === 'autoriser_modification' ? 'Autoriser la modification'
                  : reviewModal.decision === 'autoriser_suppression' ? 'Autoriser la suppression'
                  : 'Refuser la demande'}
              </h3>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                {reviewModal.request.request_number} — {reviewModal.request.operation_reference}
              </p>
            </div>
            <div className="px-6 py-4 space-y-4">
              {(reviewModal.decision === 'autoriser_suppression' || reviewModal.decision === 'autoriser_modification') && (
                <div className="rounded-lg px-3 py-2 text-xs" style={{ background: '#FEF3C7', border: '1px solid #FCD34D', color: '#92400E' }}>
                  {reviewModal.decision === 'autoriser_suppression'
                    ? 'La suppression sera exécutée par l\'équipe technique après votre autorisation.'
                    : 'La modification sera exécutée par l\'équipe technique après votre autorisation.'}
                </div>
              )}
              <div>
                <label className={labelClass} style={{ color: 'var(--text-primary)' }}>Commentaire de décision</label>
                <textarea
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  placeholder="Expliquez votre décision..."
                  rows={3}
                  className={inputClass}
                  style={inputStyle}
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t" style={{ borderColor: 'var(--border)' }}>
              <button
                onClick={() => { setReviewModal(null); setReviewComment(''); }}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-black/5"
                style={{ color: 'var(--text-secondary)' }}
              >
                Fermer
              </button>
              <button
                onClick={handleReview}
                disabled={submitting}
                className="px-5 py-2 rounded-lg text-sm font-semibold text-white transition-opacity disabled:opacity-50"
                style={{ background: reviewModal.decision === 'refuser' ? '#6B7280' : reviewModal.decision === 'autoriser_suppression' ? '#EF4444' : '#3B82F6' }}
              >
                {submitting ? 'Traitement...' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Execute modal */}
      {executeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-md rounded-2xl shadow-xl" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)' }}>
            <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2">
                <Wrench className="w-5 h-5" style={{ color: executeModal.status === 'autorisee_suppression' ? '#EF4444' : '#10B981' }} />
                <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                  {executeModal.status === 'autorisee_suppression' ? 'Exécuter la suppression' : 'Exécuter la modification'}
                </h3>
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                {executeModal.request_number} — {executeModal.operation_reference}
              </p>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="rounded-lg px-3 py-2 text-xs" style={{ background: '#FEE2E2', border: '1px solid #FECACA', color: '#991B1B' }}>
                {executeModal.status === 'autorisee_suppression'
                  ? 'Vous allez supprimer cette opération. L\'action sera journalisée avec sauvegarde des valeurs supprimées.'
                  : 'Vous allez modifier cette opération. Les anciennes et nouvelles valeurs seront journalisées.'}
                <br />Vous ne pouvez exécuter que l'action autorisée par le DG.
              </div>
              <div>
                <label className={labelClass} style={{ color: 'var(--text-primary)' }}>Notes d'exécution</label>
                <textarea
                  value={executionNotes}
                  onChange={(e) => setExecutionNotes(e.target.value)}
                  placeholder="Décrivez l'action effectuée..."
                  rows={3}
                  className={inputClass}
                  style={inputStyle}
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t" style={{ borderColor: 'var(--border)' }}>
              <button
                onClick={() => { setExecuteModal(null); setExecutionNotes(''); }}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-black/5"
                style={{ color: 'var(--text-secondary)' }}
              >
                Fermer
              </button>
              <button
                onClick={handleExecuteConfirm}
                disabled={submitting}
                className="px-5 py-2 rounded-lg text-sm font-semibold text-white transition-opacity disabled:opacity-50"
                style={{ background: executeModal.status === 'autorisee_suppression' ? '#EF4444' : '#10B981' }}
              >
                {submitting ? 'Exécution...' : 'Confirmer l\'exécution'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel modal */}
      {cancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-sm rounded-2xl shadow-xl" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)' }}>
            <div className="px-6 py-4">
              <h3 className="text-lg font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Annuler la demande ?</h3>
              <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                {cancelModal.request_number} — Cette action est irréversible.
              </p>
              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => setCancelModal(null)}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-black/5"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Non
                </button>
                <button
                  onClick={handleCancel}
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-opacity disabled:opacity-50"
                  style={{ background: '#6B7280' }}
                >
                  {submitting ? '...' : 'Oui, annuler'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
