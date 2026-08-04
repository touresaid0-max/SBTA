import { useState, useEffect, useMemo } from 'react';
import { X, Loader2, AlertTriangle, ArrowRightLeft, Printer, CheckCircle } from 'lucide-react';
import AutocompleteSelect from '@/components/pos/AutocompleteSelect';
import type { DepartRecord, TicketRecord } from '@/services/pos/db';
import type { VehiculeRef, ChauffeurRef } from '@/services/pos/departService';
import { PrintService } from '@/services/pos/printService';

export interface TransferResult {
  transferredTickets: TicketRecord[];
  nextDepart: DepartRecord | null;
  newCapacity: number;
  oldCapacity: number;
  surplus: number;
}

interface EditDepartModalProps {
  depart: DepartRecord;
  vehicules: VehiculeRef[];
  chauffeurs: ChauffeurRef[];
  soldTickets: TicketRecord[];
  nextDepart: DepartRecord | null;
  onSave: (busId: string, busPlate: string, driverId: string, driverName: string, newCapacity: number) => Promise<void>;
  onTransfer: (surplusTickets: TicketRecord[], nextDepart: DepartRecord) => Promise<void>;
  onClose: () => void;
}

type Phase = 'edit' | 'transferring' | 'transferred';

export default function EditDepartModal({
  depart,
  vehicules,
  chauffeurs,
  soldTickets,
  nextDepart,
  onSave,
  onTransfer,
  onClose,
}: EditDepartModalProps) {
  const [busId, setBusId] = useState(depart.bus_id);
  const [driverId, setDriverId] = useState(depart.driver_id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<Phase>('edit');
  const [transferResult, setTransferResult] = useState<TransferResult | null>(null);

  const selectedBus = vehicules.find(v => v.id === busId) ?? null;
  const selectedDriver = chauffeurs.find(c => c.id === driverId) ?? null;
  const oldCapacity = depart.seats_total;
  const newCapacity = selectedBus?.capacity ?? depart.seats_total;
  const soldCount = soldTickets.length;
  const surplus = Math.max(0, soldCount - newCapacity);
  const capacityReduced = newCapacity < oldCapacity;
  const hasSurplus = surplus > 0;
  const hasNextDepart = !!nextDepart;

  const busChanged = busId !== depart.bus_id;
  const driverChanged = driverId !== depart.driver_id;
  const canSave = (busChanged || driverChanged) && !saving;

  const surplusTickets = useMemo(() => {
    if (!hasSurplus) return [];
    return [...soldTickets]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, surplus);
  }, [soldTickets, hasSurplus, surplus]);

  const handleSave = async () => {
    setError('');
    if (!busId) { setError('Veuillez sélectionner un car.'); return; }
    if (!driverId) { setError('Veuillez sélectionner un chauffeur.'); return; }

    setSaving(true);
    try {
      if (hasSurplus && !hasNextDepart) {
        setError('Surplus de tickets détecté mais aucun prochain départ disponible pour ce trajet. Créez un nouveau départ avant de modifier.');
        setSaving(false);
        return;
      }

      await onSave(busId, selectedBus?.plate_number ?? '', driverId, selectedDriver?.full_name ?? '', newCapacity);

      if (hasSurplus && nextDepart) {
        setPhase('transferring');
        await onTransfer(surplusTickets, nextDepart);
        setTransferResult({
          transferredTickets: surplusTickets,
          nextDepart,
          newCapacity,
          oldCapacity,
          surplus,
        });
        setPhase('transferred');
      } else {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue lors de la modification.');
      setPhase('edit');
    } finally {
      setSaving(false);
    }
  };

  const handlePrintTransferred = () => {
    if (!transferResult) return;
    for (const ticket of transferResult.transferredTickets) {
      PrintService.printTicket({
        ticket,
        depart: transferResult.nextDepart ?? depart,
        stationName: depart.station_name,
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" style={{ backgroundColor: 'var(--surface)' }}>
        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
              {phase === 'transferred' ? 'Transfert effectué' : 'Modifier le départ'}
            </h3>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              Départ #{depart.route_number} — {depart.route_name}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg" style={{ color: 'var(--text-muted)' }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {phase === 'transferred' && transferResult ? (
            <TransferConfirmation result={transferResult} onPrint={handlePrintTransferred} onClose={onClose} />
          ) : (
            <>
              {/* Current info */}
              <div className="rounded-xl p-3 text-sm" style={{ backgroundColor: 'var(--surface-raised)' }}>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Car actuel</span>
                    <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{depart.bus_plate ?? '—'}</p>
                  </div>
                  <div>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Capacité actuelle</span>
                    <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{oldCapacity} places</p>
                  </div>
                  <div>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Chauffeur actuel</span>
                    <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{depart.driver_name ?? '—'}</p>
                  </div>
                  <div>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Tickets vendus</span>
                    <p className="font-semibold" style={{ color: 'var(--info)' }}>{soldCount}</p>
                  </div>
                </div>
              </div>

              {/* Bus selection */}
              <div>
                <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Car (Matricule) *
                </label>
                <AutocompleteSelect
                  options={vehicules.map(v => ({
                    id: v.id,
                    label: v.plate_number,
                    sublabel: [v.brand, v.model, `${v.capacity} places`].filter(Boolean).join(' · '),
                    keywords: `${v.plate_number} ${v.brand ?? ''} ${v.model ?? ''} ${v.capacity}`,
                  }))}
                  value={busId}
                  onChange={setBusId}
                  placeholder="Rechercher par immatriculation, marque..."
                  required
                  emptyText="Aucun bus trouvé"
                />
              </div>

              {/* Capacity comparison */}
              {busChanged && selectedBus && (
                <div className="rounded-xl p-3 flex items-center gap-3" style={{
                  backgroundColor: capacityReduced ? 'var(--danger-light)' : 'var(--success-light)',
                  border: `1px solid ${capacityReduced ? 'var(--danger)' : 'var(--success)'}`,
                }}>
                  <div className="flex items-baseline gap-2 text-sm">
                    <span style={{ color: 'var(--text-secondary)' }}>{oldCapacity}</span>
                    <span style={{ color: 'var(--text-muted)' }}>→</span>
                    <span className="font-bold text-lg" style={{ color: capacityReduced ? 'var(--danger)' : 'var(--success)' }}>
                      {newCapacity}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>places</span>
                  </div>
                  {capacityReduced && (
                    <span className="text-xs font-bold ml-auto" style={{ color: 'var(--danger)' }}>
                      -{oldCapacity - newCapacity} places
                    </span>
                  )}
                </div>
              )}

              {/* Surplus warning */}
              {hasSurplus && (
                <div className="rounded-xl p-4 space-y-2" style={{
                  backgroundColor: 'var(--danger-light)',
                  border: '1px solid var(--danger)',
                }}>
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />
                    <div className="flex-1">
                      <p className="text-sm font-bold" style={{ color: 'var(--danger)' }}>
                        Attention : Réduction de {surplus} place{surplus > 1 ? 's' : ''} sur ce départ
                      </p>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                        {soldCount} ticket{soldCount > 1 ? 's' : ''} vendu{soldCount > 1 ? 's' : ''} pour {newCapacity} places. {surplus} ticket{surplus > 1 ? 's' : ''} en surplus {surplus > 1 ? 'seront' : 'sera'} transféré{surplus > 1 ? 's' : ''} vers le prochain départ.
                      </p>
                    </div>
                  </div>
                  {nextDepart ? (
                    <div className="flex items-center gap-2 text-xs pl-7" style={{ color: 'var(--text-secondary)' }}>
                      <ArrowRightLeft className="w-3.5 h-3.5" style={{ color: 'var(--info)' }} />
                      <span>
                        Prochain départ : #{nextDepart.route_number} — {nextDepart.departure_date} à {nextDepart.departure_time}
                        {' '}({nextDepart.seats_total - nextDepart.seats_sold} places libres)
                      </span>
                    </div>
                  ) : (
                    <p className="text-xs pl-7 font-semibold" style={{ color: 'var(--danger)' }}>
                      Aucun prochain départ disponible pour ce trajet. Veuillez en créer un.
                    </p>
                  )}
                </div>
              )}

              {/* Driver selection */}
              <div>
                <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Chauffeur *
                </label>
                <AutocompleteSelect
                  options={chauffeurs.map(c => ({
                    id: c.id,
                    label: c.full_name,
                    sublabel: [c.employee_id, c.phone].filter(Boolean).join(' · '),
                    keywords: `${c.full_name} ${c.employee_id ?? ''} ${c.phone ?? ''} ${c.email}`,
                  }))}
                  value={driverId}
                  onChange={setDriverId}
                  placeholder="Rechercher par nom, matricule, téléphone..."
                  required
                  emptyText="Aucun chauffeur trouvé"
                />
              </div>

              {/* Error */}
              {error && (
                <div className="rounded-xl p-3 text-sm" style={{ backgroundColor: 'var(--danger-light)', color: 'var(--danger)' }}>
                  {error}
                </div>
              )}

              {/* Transferring state */}
              {phase === 'transferring' && (
                <div className="flex items-center justify-center gap-2 py-4">
                  <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--primary)' }} />
                  <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Transfert des tickets en cours...</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {phase !== 'transferred' && phase !== 'transferring' && (
          <div className="flex gap-3 p-6 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-xl font-bold border-2"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            >
              Annuler
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave || (hasSurplus && !hasNextDepart)}
              className="flex-1 py-3 rounded-xl font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ backgroundColor: 'var(--primary)' }}
            >
              {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : hasSurplus ? 'Modifier et transférer' : 'Enregistrer'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function TransferConfirmation({
  result,
  onPrint,
  onClose,
}: {
  result: TransferResult;
  onPrint: () => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--success-light)' }}>
          <CheckCircle className="w-7 h-7" style={{ color: 'var(--success)' }} />
        </div>
        <div>
          <p className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>
            {result.transferredTickets.length} ticket{result.transferredTickets.length > 1 ? 's' : ''} transféré{result.transferredTickets.length > 1 ? 's' : ''}
          </p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Capacité ajustée de {result.oldCapacity} à {result.newCapacity} places
          </p>
        </div>
      </div>

      {result.nextDepart && (
        <div className="rounded-xl p-3 text-sm" style={{ backgroundColor: 'var(--surface-raised)' }}>
          <p style={{ color: 'var(--text-muted)' }} className="text-xs mb-1">Tickets transférés vers</p>
          <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            Départ #{result.nextDepart.route_number} — {result.nextDepart.route_name}
          </p>
          <p style={{ color: 'var(--text-secondary)' }}>
            {result.nextDepart.departure_date} à {result.nextDepart.departure_time}
          </p>
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={onPrint}
          className="flex-1 py-3 rounded-xl font-bold border-2 flex items-center justify-center gap-2"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
        >
          <Printer className="w-4 h-4" />
          Imprimer les {result.transferredTickets.length} ticket{result.transferredTickets.length > 1 ? 's' : ''} transféré{result.transferredTickets.length > 1 ? 's' : ''}
        </button>
        <button
          onClick={onClose}
          className="flex-1 py-3 rounded-xl font-bold text-white"
          style={{ backgroundColor: 'var(--primary)' }}
        >
          Terminer
        </button>
      </div>
    </div>
  );
}
