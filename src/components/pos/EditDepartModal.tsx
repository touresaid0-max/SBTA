import { useState, useMemo } from 'react';
import { X, Loader2, AlertTriangle, ArrowRightLeft, Printer, CheckCircle, Clock, Info } from 'lucide-react';
import AutocompleteSelect from '@/components/pos/AutocompleteSelect';
import type { DepartRecord, TicketRecord } from '@/services/pos/db';
import { seatsCommercialisables, type VehiculeRef, type ChauffeurRef } from '@/services/pos/departService';
import { PrintService } from '@/services/pos/printService';

/** Ticket of the departure as the server knows it (all counters and stations, not only this device) */
export interface ServerSeatTicket {
  id: string;
  seats: number[];
  ticket?: string | null;
  passenger?: string | null;
}

/** Tickets put back on a free seat of the bus after the change (server answer) */
export interface ReseatResult {
  moved: { reservation_id: string; ticket?: string | null; passenger?: string | null; from: number; to: number }[];
  unplaced: { reservation_id: string; ticket?: string | null; passenger?: string | null; seat: number }[];
}

export interface TransferResult {
  transferredTickets: TicketRecord[];
  nextDepart: DepartRecord | null;
  newCapacity: number;
  oldCapacity: number;
  surplus: number;
  pendingSaved: boolean;
}

interface EditDepartModalProps {
  depart: DepartRecord;
  vehicules: VehiculeRef[];
  chauffeurs: ChauffeurRef[];
  soldTickets: TicketRecord[];
  nextDepart: DepartRecord | null;
  onSave: (busId: string, busPlate: string, driverId: string, driverName: string, newCapacity: number) => Promise<void>;
  onTransfer: (surplusTickets: TicketRecord[], nextDepart: DepartRecord) => Promise<void>;
  onPendingTransfer?: (surplusTickets: TicketRecord[], newBusId: string, newBusPlate: string, newCapacity: number) => Promise<void>;
  /** The tickets of the departure read from the server when the window opened (null: offline) */
  serverTickets?: ServerSeatTicket[] | null;
  /** Puts the tickets of the seats the new bus does not have on its free seats (server) */
  onReseat?: (busId: string) => Promise<ReseatResult>;
  /** Whether the device is online (the passengers are put back on the server) */
  online?: boolean;
  onClose: () => void;
}

type Phase = 'edit' | 'transferring' | 'transferred' | 'pending_saved' | 'reseated';

export default function EditDepartModal({
  depart,
  vehicules,
  chauffeurs,
  soldTickets,
  nextDepart,
  onSave,
  onTransfer,
  onPendingTransfer,
  serverTickets,
  onReseat,
  online = true,
  onClose,
}: EditDepartModalProps) {
  const [busId, setBusId] = useState(depart.bus_id);
  const [driverId, setDriverId] = useState(depart.driver_id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<Phase>('edit');
  const [transferResult, setTransferResult] = useState<TransferResult | null>(null);
  const [reseatResult, setReseatResult] = useState<ReseatResult | null>(null);

  const selectedBus = vehicules.find(v => v.id === busId) ?? null;
  const selectedDriver = chauffeurs.find(c => c.id === driverId) ?? null;
  // Numbers of seats (seats_total is the last seat number: 2 to 64 is 63 seats)
  const oldCapacity = seatsCommercialisables(depart);
  const newCapacity = selectedBus?.capacity ?? oldCapacity;
  // Seats of the new bus: its numbering (« vendu à partir de ») and its number of seats
  const newFirst = Math.max(1, (busId !== depart.bus_id ? selectedBus?.seats_sold_from : depart.seats_from) ?? depart.seats_from ?? 1);
  const newLast = newFirst + newCapacity - 1;
  // Seats taken: every ticket of the departure, as the server knows it (all counters and the
  // partner station), and the ones of this device not sent yet. This device alone gave 1 ticket
  // for a departure of 53 (DALOA #6, 20/11/2026): nothing was moved.
  const occupied = useMemo(() => {
    const seats = new Map<number, { ticket?: string | null; passenger?: string | null }>();
    for (const t of serverTickets ?? []) for (const n of t.seats) seats.set(n, { ticket: t.ticket, passenger: t.passenger });
    for (const t of soldTickets) if (!seats.has(t.seat_number)) seats.set(t.seat_number, { ticket: t.ticket_number, passenger: t.passenger_name });
    return seats;
  }, [serverTickets, soldTickets]);
  const soldCount = Math.max(soldTickets.length, occupied.size);
  const surplus = Math.max(0, soldCount - newCapacity);
  // Tickets on a seat the new bus does not have (62 and 63 of a 63-seat bus replaced by a 61-seat one)
  const outOfBus = useMemo(
    () => [...occupied.entries()].filter(([n]) => n > newLast || n < newFirst).sort((a, b) => a[0] - b[0]),
    [occupied, newFirst, newLast],
  );
  const freeInNewBus = useMemo(() => {
    let free = 0;
    for (let n = newFirst; n <= newLast; n++) if (!occupied.has(n)) free++;
    return free;
  }, [occupied, newFirst, newLast]);
  const toReseat = busId !== depart.bus_id ? Math.max(0, Math.min(outOfBus.length - surplus, freeInNewBus)) : 0;
  const sharedNeedsCut = busId !== depart.bus_id && (depart.seat_allocations ?? []).some(a => a.seat_to > newLast);
  const capacityReduced = newCapacity < oldCapacity;
  const hasSurplus = surplus > 0;
  const hasNextDepart = !!nextDepart;

  const busChanged = busId !== depart.bus_id;
  const driverChanged = driverId !== depart.driver_id;
  const canSave = (busChanged || driverChanged) && !saving;

  const surplusTickets = useMemo(() => {
    if (!hasSurplus) return [];
    // The tickets on a seat the new bus does not have first, then the last sold
    return [...soldTickets]
      .sort((a, b) => {
        const outA = a.seat_number > newLast || a.seat_number < newFirst ? 1 : 0;
        const outB = b.seat_number > newLast || b.seat_number < newFirst ? 1 : 0;
        return outB - outA || new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      })
      .slice(0, surplus);
  }, [soldTickets, hasSurplus, surplus, newFirst, newLast]);

  const handleSave = async () => {
    setError('');
    if (!busId) { setError('Veuillez sélectionner un car.'); return; }
    if (!driverId) { setError('Veuillez sélectionner un chauffeur.'); return; }
    // The passengers are put back on the server: all the tickets of the departure are there
    if ((toReseat > 0 || sharedNeedsCut) && !online) {
      setError('Connexion Internet requise : des passagers sont sur des sièges que le nouveau car n\'a pas. Reconnectez-vous pour les replacer.');
      return;
    }

    setSaving(true);
    try {
      // Step 1: Transfer surplus tickets BEFORE changing the bus capacity.
      // The database trigger auto_calculate_fill_rate computes fill_rate from
      // the new bus capacity and the current reservation count. If we reduce
      // seats_total first while tickets are still on this depart, fill_rate
      // exceeds 100% and the CHECK constraint rejects the update.
      if (hasSurplus && nextDepart) {
        setPhase('transferring');
        await onTransfer(surplusTickets, nextDepart);
      } else if (hasSurplus && !nextDepart && onPendingTransfer) {
        setPhase('transferring');
        await onPendingTransfer(surplusTickets, busId, selectedBus?.plate_number ?? '', newCapacity);
      }

      // Step 2: Now save the bus/driver change (safe — reservation count is reduced)
      await onSave(busId, selectedBus?.plate_number ?? '', driverId, selectedDriver?.full_name ?? '', newCapacity);

      // Step 3: the tickets on a seat the new bus does not have go to its free seats (a seat of the
      // station that sold them first), and the seat ranges of the stations are cut to the bus
      let reseat: ReseatResult | null = null;
      if ((toReseat > 0 || sharedNeedsCut) && onReseat && busChanged) {
        reseat = await onReseat(busId);
        setReseatResult(reseat);
      }

      if (hasSurplus && nextDepart) {
        setTransferResult({
          transferredTickets: surplusTickets,
          nextDepart,
          newCapacity,
          oldCapacity,
          surplus,
          pendingSaved: false,
        });
        setPhase('transferred');
      } else if (hasSurplus && !nextDepart && onPendingTransfer) {
        setTransferResult({
          transferredTickets: surplusTickets,
          nextDepart: null,
          newCapacity,
          oldCapacity,
          surplus,
          pendingSaved: true,
        });
        setPhase('pending_saved');
      } else if (reseat && (reseat.moved.length > 0 || reseat.unplaced.length > 0)) {
        setPhase('reseated');
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
              {phase === 'transferred' ? 'Transfert effectué' : phase === 'pending_saved' ? 'Transfert en attente' : phase === 'reseated' ? 'Passagers replacés' : 'Modifier le départ'}
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
          {phase === 'reseated' && reseatResult ? (
            <ReseatConfirmation result={reseatResult} soldTickets={soldTickets} depart={depart} onClose={onClose} />
          ) : phase === 'transferred' && transferResult ? (
            <TransferConfirmation result={transferResult} onPrint={handlePrintTransferred} onClose={onClose} />
          ) : phase === 'pending_saved' && transferResult ? (
            <PendingTransferConfirmation result={transferResult} onClose={onClose} />
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

              {/* Seats the new bus does not have */}
              {busChanged && selectedBus && outOfBus.length > 0 && (
                <div className="rounded-xl p-4 space-y-2" style={{ backgroundColor: 'var(--warning-light, #FEF3C7)', border: '1px solid var(--warning, #D97706)' }}>
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: 'var(--warning, #D97706)' }} />
                    <div className="flex-1">
                      <p className="text-sm font-bold" style={{ color: 'var(--warning, #D97706)' }}>
                        {outOfBus.length} passager{outOfBus.length > 1 ? 's' : ''} sur des sièges que ce car n'a pas (n° {outOfBus.map(([n]) => n).join(', ')})
                      </p>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                        Le car {selectedBus.plate_number} a les sièges {newFirst} à {newLast} ({freeInNewBus} libre{freeInNewBus > 1 ? 's' : ''}).
                        {toReseat > 0 && <> {toReseat === outOfBus.length ? 'Ils seront replacés' : `${toReseat} seront replacés`} sur des places libres de ce car, d'abord celles de la gare qui a vendu le ticket. Le passager garde son départ ; réimprimez son ticket.</>}
                        {hasSurplus && <> {Math.min(surplus, outOfBus.length)} iront au départ suivant (voir ci-dessous).</>}
                      </p>
                      <ul className="text-xs mt-2 space-y-0.5" style={{ color: 'var(--text-primary)' }}>
                        {outOfBus.map(([n, t]) => (
                          <li key={n}>Siège <b>{n}</b>{t.ticket ? ` · ${t.ticket}` : ''}{t.passenger ? ` · ${t.passenger}` : ''}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
              {busChanged && selectedBus && sharedNeedsCut && (
                <p className="text-xs flex items-start gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                  <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  Départ partagé : la répartition des sièges entre les gares sera ramenée aux sièges {newFirst} à {newLast} de ce car.
                </p>
              )}

              {/* Surplus warning */}
              {hasSurplus && (
                <div className="rounded-xl p-4 space-y-3" style={{
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
                    <div className="pl-7 space-y-1">
                      <div className="flex items-start gap-1.5 text-xs font-semibold" style={{ color: 'var(--danger)' }}>
                        <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                        <span>Aucun prochain départ disponible pour ce trajet.</span>
                      </div>
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        Les {surplus} tickets en surplus seront mis en attente. Créez le prochain départ pour ce trajet afin de transférer automatiquement ces tickets.
                      </p>
                    </div>
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
                  <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    {hasNextDepart ? 'Transfert des tickets en cours...' : 'Enregistrement du transfert en attente...'}
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {phase !== 'transferred' && phase !== 'transferring' && phase !== 'pending_saved' && phase !== 'reseated' && (
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
              disabled={!canSave}
              className="flex-1 py-3 rounded-xl font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ backgroundColor: 'var(--primary)' }}
            >
              {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : hasSurplus ? (hasNextDepart ? `Modifier et transférer vers le départ #${nextDepart?.route_number}` : 'Modifier et mettre en attente') : toReseat > 0 ? `Enregistrer et replacer ${toReseat} passager${toReseat > 1 ? 's' : ''}` : 'Enregistrer'}
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

function PendingTransferConfirmation({
  result,
  onClose,
}: {
  result: TransferResult;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--warning-light, #FEF3C7)' }}>
          <Clock className="w-7 h-7" style={{ color: 'var(--warning, #D97706)' }} />
        </div>
        <div>
          <p className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>
            {result.surplus} ticket{result.surplus > 1 ? 's' : ''} en attente de transfert
          </p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Capacité ajustée de {result.oldCapacity} à {result.newCapacity} places
          </p>
        </div>
      </div>

      <div className="rounded-xl p-4 space-y-2" style={{
        backgroundColor: 'var(--warning-light, #FEF3C7)',
        border: '1px solid var(--warning, #D97706)',
      }}>
        <div className="flex items-start gap-2">
          <Info className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: 'var(--warning, #D97706)' }} />
          <div className="flex-1">
            <p className="text-sm font-bold" style={{ color: 'var(--warning, #D97706)' }}>
              Action requise : créer le prochain départ
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              Les {result.surplus} tickets en surplus seront automatiquement transférés vers le prochain départ créé pour ce trajet. Les tickets seront réaffectés avec de nouveaux sièges et la recette sera intégrée au nouveau départ.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl p-3 text-sm" style={{ backgroundColor: 'var(--surface-raised)' }}>
        <p style={{ color: 'var(--text-muted)' }} className="text-xs mb-1">Tickets en attente</p>
        <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
          {result.transferredTickets.length} ticket{result.transferredTickets.length > 1 ? 's' : ''} de {result.oldCapacity} places → {result.newCapacity} places
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
          Les tickets seront réimprimables avec les nouvelles informations (nouveau départ, siège, bus, date, heure) dès que le transfert sera effectué.
        </p>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onClose}
          className="flex-1 py-3 rounded-xl font-bold text-white"
          style={{ backgroundColor: 'var(--primary)' }}
        >
          Compris, créer le prochain départ
        </button>
      </div>
    </div>
  );
}

function ReseatConfirmation({
  result,
  soldTickets,
  depart,
  onClose,
}: {
  result: ReseatResult;
  soldTickets: TicketRecord[];
  depart: DepartRecord;
  onClose: () => void;
}) {
  // Tickets of this device: reprinted here with their new seat; the others by their station
  const local = result.moved
    .map(m => ({ m, t: soldTickets.find(t => t.id === m.reservation_id) }))
    .filter((x): x is { m: ReseatResult['moved'][number]; t: TicketRecord } => !!x.t);
  const handlePrint = () => {
    for (const { m, t } of local) {
      PrintService.printTicket({
        ticket: { ...t, seat_number: m.to, seat_numbers: [String(m.to)] },
        depart,
        stationName: depart.station_name,
      });
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--success-light)' }}>
          <CheckCircle className="w-7 h-7" style={{ color: 'var(--success)' }} />
        </div>
        <div>
          <p className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>
            {result.moved.length} passager{result.moved.length > 1 ? 's' : ''} replacé{result.moved.length > 1 ? 's' : ''} dans le car
          </p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Même départ, nouveau numéro de siège : réimprimez le ticket.</p>
        </div>
      </div>
      <div className="rounded-xl p-3 text-sm space-y-1" style={{ backgroundColor: 'var(--surface-raised)' }}>
        {result.moved.map(m => (
          <p key={m.reservation_id} style={{ color: 'var(--text-primary)' }}>
            {m.ticket ?? 'Ticket'}{m.passenger ? ` · ${m.passenger}` : ''} : siège <b>{m.from}</b> → <b>{m.to}</b>
          </p>
        ))}
      </div>
      {result.unplaced.length > 0 && (
        <div className="rounded-xl p-3 text-sm" style={{ backgroundColor: 'var(--danger-light)', color: 'var(--danger)' }}>
          {result.unplaced.length} passager{result.unplaced.length > 1 ? 's' : ''} sans place libre dans ce car (siège{result.unplaced.length > 1 ? 's' : ''} {result.unplaced.map(u => u.seat).join(', ')}) : transférez-les vers le départ suivant.
        </div>
      )}
      {result.moved.length > local.length && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {result.moved.length - local.length} ticket{result.moved.length - local.length > 1 ? 's' : ''} vendu{result.moved.length - local.length > 1 ? 's' : ''} sur un autre poste : à réimprimer par le guichet qui l'a vendu (le nouveau siège y apparaît à la synchronisation).
        </p>
      )}
      <div className="flex gap-3">
        {local.length > 0 && (
          <button onClick={handlePrint} className="flex-1 py-3 rounded-xl font-bold border-2 flex items-center justify-center gap-2" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
            <Printer className="w-4 h-4" /> Réimprimer {local.length} ticket{local.length > 1 ? 's' : ''}
          </button>
        )}
        <button onClick={onClose} className="flex-1 py-3 rounded-xl font-bold text-white" style={{ backgroundColor: 'var(--primary)' }}>Terminer</button>
      </div>
    </div>
  );
}
