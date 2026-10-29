import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import POSLayout from '@/components/pos/POSLayout';
import { usePOSSession } from '@/services/pos/POSSessionContext';
import {
  createDepart,
  getLignes, getVehicules, getChauffeurs, getGares,
  getAssignedRouteIds,
  nextDepartureNumber,
  nextRouteNumber,
  validateSeatAllocations,
  type LigneRef, type VehiculeRef, type ChauffeurRef, type GareRef,
  type SeatAllocation,
  type DepartRecord,
} from '@/services/pos/departService';
import { checkAndApplyPendingTransfers } from '@/services/pos/transferService';
import { AlertCircle, CheckCircle, Loader2, X, Plus, Trash2, Armchair, Lock, Info } from 'lucide-react';
import AutocompleteSelect from '@/components/pos/AutocompleteSelect';

export default function POSDepartNouveau({ forceRamassage = false }: { forceRamassage?: boolean }) {
  const navigate = useNavigate();
  const { session } = usePOSSession();

  const [lignes, setLignes] = useState<LigneRef[]>([]);
  const [vehicules, setVehicules] = useState<VehiculeRef[]>([]);
  const [chauffeurs, setChauffeurs] = useState<ChauffeurRef[]>([]);
  const [gares, setGares] = useState<GareRef[]>([]);
  const [loadingRefs, setLoadingRefs] = useState(true);
  const [noLinesAssigned, setNoLinesAssigned] = useState(false);

  const [departureDate, setDepartureDate] = useState('');
  const [departureTime, setDepartureTime] = useState('');
  const [ligneId, setLigneId] = useState('');

  const [busId, setBusId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [isRamassage, setIsRamassage] = useState(false);
  const [enableOtherStation, setEnableOtherStation] = useState(false);
  const [otherStationId, setOtherStationId] = useState('');
  const [seatAllocations, setSeatAllocations] = useState<SeatAllocation[]>([]);
  const [newAllocStationId, setNewAllocStationId] = useState('');
  const [newAllocSeatCount, setNewAllocSeatCount] = useState('');
  const [newAllocSeatFrom, setNewAllocSeatFrom] = useState('');
  const [newAllocSeatTo, setNewAllocSeatTo] = useState('');
  const [allocError, setAllocError] = useState('');
  const [convoyeurId, setConvoyeurId] = useState('');

  const [seatsTotal, setSeatsTotal] = useState(0);
  const [seatsFrom, setSeatsFrom] = useState(1);
  const [departureNo, setDepartureNo] = useState(0);
  const [linkedParent, setLinkedParent] = useState<DepartRecord | null>(null);
  const [seatRangeInfo, setSeatRangeInfo] = useState<{ from: number; to: number; stationName: string } | null>(null);

  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const loadRefs = useCallback(async () => {
    try {
      const [l, v, c, g] = await Promise.all([getLignes(), getVehicules(), getChauffeurs(), getGares()]);

      let routeIds = session?.assigned_route_ids ?? [];
      if (navigator.onLine && session?.counter_id) {
        const fresh = await getAssignedRouteIds(session.counter_id);
        if (fresh.length > 0) routeIds = fresh;
      }

      if (routeIds.length > 0) {
        const allowed = new Set(routeIds);
        setLignes(l.filter(ligne => allowed.has(ligne.id)));
        setNoLinesAssigned(false);
      } else {
        setLignes([]);
        setNoLinesAssigned(true);
      }

      setVehicules(v);
      setChauffeurs(c);
      setGares(g);
    } catch (err) {
      // refs may not be cached yet
    } finally {
      setLoadingRefs(false);
    }
  }, [session?.counter_id, session?.assigned_route_ids]);

  useEffect(() => {
    loadRefs();
  }, [loadRefs]);

  useEffect(() => {
    if (forceRamassage) setIsRamassage(true);
  }, [forceRamassage]);

  useEffect(() => {
    if (session?.station_id && ligneId) {
      nextRouteNumber(session.station_id, ligneId, session?.counter_id, departureDate).then(setDepartureNo);
    } else if (session?.station_id) {
      nextDepartureNumber(session.station_id, session?.counter_id, departureDate).then(setDepartureNo);
    }
  }, [session?.station_id, session?.counter_id, ligneId, departureDate]);

  const selectedBus = vehicules.find(v => v.id === busId);

  const handleBusChange = (id: string) => {
    setBusId(id);
    const bus = vehicules.find(v => v.id === id);
    if (bus) {
      setSeatsTotal(bus.capacity);
      setSeatsFrom(bus.seats_sold_from ?? 1);
    }
    setLinkedParent(null);
    setSeatRangeInfo(null);
  };

  const isLinked = !!linkedParent;

  const missingFields = [
    !departureDate && 'Date de départ',
    !ligneId && 'Ligne',
    !busId && 'Car',
    !driverId && 'Chauffeur',
    !(seatsTotal > 0) && 'Nbre de sièges',
  ].filter(Boolean) as string[];

  const canSubmit = missingFields.length === 0;

  const handleSubmit = () => {
    setError('');
    if (noLinesAssigned) {
      setError('Aucune ligne n\'est affectée à votre compte. Veuillez contacter votre Chef de Gare ou l\'Administrateur.');
      return;
    }
    if (!canSubmit) {
      setError(`Veuillez renseigner : ${missingFields.join(', ')}.`);
      return;
    }
    if (departureDate && departureDate < todayStr) {
      setError('La date de départ ne peut pas être antérieure à la date du jour.');
      return;
    }
    setShowConfirm(true);
  };

  const handleConfirm = async () => {
    setSaving(true);
    setError('');
    try {
      const stationId = session?.station_id ?? '';
      const ligne = lignes.find(l => l.id === ligneId);
      const bus = vehicules.find(v => v.id === busId);
      const driver = chauffeurs.find(c => c.id === driverId);
      const convoyeur = chauffeurs.find(c => c.id === convoyeurId);
      const firstAllocStationId = seatAllocations.length > 0 ? seatAllocations[0].station_id : '';
      const otherStation = firstAllocStationId ? gares.find(g => g.id === firstAllocStationId) : undefined;

      // Resolve arrival station: prefer route.destination_station_id, fallback to station matching destination city
      let arrivalStationId = ligne?.destination_station_id ?? '';
      if (!arrivalStationId && ligne?.destination_city_id) {
        const destStation = gares.find(g => g.city_id === ligne.destination_city_id);
        if (destStation) arrivalStationId = destStation.id;
      }

      const allAllocations: SeatAllocation[] = [];
      const primaryStationName = session?.station_name ?? 'Gare principale';

      if (isLinked && linkedParent) {
        allAllocations.push(...(linkedParent.seat_allocations ?? []));
      }

      if (seatAllocations.length > 0) {
        const sortedAllocs = [...seatAllocations].sort((a, b) => a.seat_from - b.seat_from);
        const primaryFrom = sortedAllocs[0].seat_from > seatsFrom ? seatsFrom : seatsFrom;
        const primaryTo = sortedAllocs[0].seat_from - 1;
        if (primaryTo >= primaryFrom) {
          allAllocations.push({ station_id: stationId, station_name: primaryStationName, seat_from: primaryFrom, seat_to: primaryTo });
        }
        allAllocations.push(...sortedAllocs);
      }

      const newDepart = await createDepart({
        route_id: ligneId,
        route_name: ligne?.name ?? '',
        bus_id: busId,
        bus_plate: bus?.plate_number ?? '',
        bus_name: bus?.plate_number ?? '',
        driver_id: driverId,
        driver_name: driver?.full_name ?? '',
        convoyeur_id: convoyeurId || undefined,
        convoyeur_name: convoyeur?.full_name || undefined,
        departure_datetime: `${departureDate}T${departureTime || '00:00'}:00`,
        departure_date: departureDate,
        departure_time: departureTime || '',
        status: isRamassage ? 'ramassage' : 'planned',
        is_ramassage: isRamassage,
        is_ac: false,
        seats_total: seatsTotal,
        seats_from: seatsFrom,
        seat_allocations: allAllocations.length > 0 ? allAllocations : undefined,
        station_id: stationId,
        station_name: session?.station_name ?? '',
        arrival_station_id: arrivalStationId || undefined,
        counter_id: session?.counter_id,
        other_station_id: (seatAllocations.length > 0 ? seatAllocations[0].station_id : '') || undefined,
        other_station_name: otherStation?.name,
      });

      // Auto-apply pending ticket transfers from bus changes on previous departs
      try {
        const result = await checkAndApplyPendingTransfers(newDepart, stationId);
        if (result.totalTransferred > 0) {
          setSuccess(true);
          setTimeout(() => navigate('/guichet/departs'), 1200);
          return;
        }
      } catch (transferErr) {
        console.error('[transfer] auto-apply failed:', transferErr);
      }

      setSuccess(true);
      setTimeout(() => navigate('/guichet/departs'), 800);
    } catch (err: any) {
      setError(err?.message ?? 'Erreur lors de la création du départ');
      setSaving(false);
      setShowConfirm(false);
    }
  };

  const todayStr = new Date().toISOString().split('T')[0];

  const fieldLabel = 'block text-xs font-bold mb-1.5';
  const fieldInput = 'w-full px-3 py-3 rounded-xl border-2 text-base outline-none transition-colors';
  const fieldStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)' as const };

  return (
    <POSLayout showBack stationName={session?.station_name} activeRoute={forceRamassage ? 'Nouveau ramassage' : 'Nouveau départ'}>
      {loadingRefs ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--primary)' }} />
        </div>
      ) : (
        <div className="max-w-2xl mx-auto">
          {/* Auto departure number */}
          <div className="rounded-xl p-3 mb-5 flex items-center justify-between" style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
            <span className="text-sm font-bold">N° Départ {ligneId ? `(${lignes.find(l => l.id === ligneId)?.name ?? ''})` : ''}</span>
            <span className="text-lg font-bold">#{departureNo}</span>
          </div>

          {error && (
            <div className="rounded-xl px-3 py-2.5 mb-4 flex items-start gap-2 text-sm" style={{ backgroundColor: 'var(--danger-light)', color: 'var(--danger)' }}>
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="rounded-xl px-3 py-2.5 mb-4 flex items-center gap-2 text-sm font-medium" style={{ backgroundColor: 'var(--success-light)', color: 'var(--success)' }}>
              <CheckCircle className="w-4 h-4" /> Départ créé avec succès
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            {/* Date départ */}
            <div>
              <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>
                Date départ * {isLinked && <Lock className="w-3 h-3 inline ml-1" style={{ color: 'var(--text-muted)' }} />}
              </label>
              <input type="date" value={departureDate} min={!isLinked ? todayStr : undefined} disabled={isLinked} onChange={e => setDepartureDate(e.target.value)} className={fieldInput} style={{ ...fieldStyle, cursor: isLinked ? 'not-allowed' : 'text', opacity: isLinked ? 0.7 : 1 }} onFocus={e => e.currentTarget.style.borderColor = 'var(--primary)'} onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'} />
            </div>

            {/* Heure */}
            <div>
              <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>
                Heure {isLinked && <Lock className="w-3 h-3 inline ml-1" style={{ color: 'var(--text-muted)' }} />}
              </label>
              <input type="time" value={departureTime} disabled={isLinked} onChange={e => setDepartureTime(e.target.value)} className={fieldInput} style={{ ...fieldStyle, cursor: isLinked ? 'not-allowed' : 'text', opacity: isLinked ? 0.7 : 1 }} onFocus={e => e.currentTarget.style.borderColor = 'var(--primary)'} onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'} />
            </div>

            {/* Ligne */}
            <div>
              <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>
                Ligne * {isLinked && <Lock className="w-3 h-3 inline ml-1" style={{ color: 'var(--text-muted)' }} />}
              </label>
              {noLinesAssigned ? (
                <div
                  className="rounded-xl px-4 py-3 text-sm flex items-start gap-2"
                  style={{ backgroundColor: 'var(--warning-light)', color: '#92400E' }}
                >
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>Aucune ligne n'est affectée à votre compte. Veuillez contacter votre Chef de Gare ou l'Administrateur.</span>
                </div>
              ) : (
                <select value={ligneId} disabled={isLinked} onChange={e => setLigneId(e.target.value)} className={fieldInput} style={{ ...fieldStyle, cursor: isLinked ? 'not-allowed' : 'pointer', opacity: isLinked ? 0.7 : 1 }}>
                  <option value="">Sélectionner...</option>
                  {lignes.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              )}
            </div>

            {/* Car */}
            <div>
              <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Car *</label>
              <AutocompleteSelect
                options={vehicules.map(v => ({
                  id: v.id,
                  label: v.plate_number,
                  sublabel: [v.brand, v.model, `${v.capacity} places`].filter(Boolean).join(' · '),
                  keywords: `${v.plate_number} ${v.brand ?? ''} ${v.model ?? ''} ${v.capacity}`,
                }))}
                value={busId}
                onChange={handleBusChange}
                placeholder="Rechercher par immatriculation, marque, modèle..."
                required
                emptyText="Aucun bus trouvé"
              />
            </div>

            {/* Chauffeur */}
            <div>
              <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>
                Chauffeur * {isLinked && <Lock className="w-3 h-3 inline ml-1" style={{ color: 'var(--text-muted)' }} />}
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
                disabled={isLinked}
              />
            </div>

            {/* Charger dans une autre gare */}
            {!isLinked && (
            <div>
              <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Charger dans une autre gare</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setEnableOtherStation(false); setOtherStationId(''); setSeatAllocations([]); setAllocError(''); }}
                  className="flex-1 py-3 rounded-xl border-2 text-sm font-bold transition-colors"
                  style={{
                    borderColor: !enableOtherStation ? 'var(--primary)' : 'var(--border)',
                    color: !enableOtherStation ? 'var(--primary)' : 'var(--text-secondary)',
                    backgroundColor: !enableOtherStation ? 'var(--primary-light)' : 'var(--surface)',
                  }}
                >
                  Non
                </button>
                <button
                  type="button"
                  onClick={() => setEnableOtherStation(true)}
                  className="flex-1 py-3 rounded-xl border-2 text-sm font-bold transition-colors"
                  style={{
                    borderColor: enableOtherStation ? 'var(--primary)' : 'var(--border)',
                    color: enableOtherStation ? 'var(--primary)' : 'var(--text-secondary)',
                    backgroundColor: enableOtherStation ? 'var(--primary-light)' : 'var(--surface)',
                  }}
                >
                  Oui
                </button>
              </div>
            </div>
            )}

            {/* Nbre siège */}
            <div>
              <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>
                Nbre siège * {isLinked && <Lock className="w-3 h-3 inline ml-1" style={{ color: 'var(--text-muted)' }} />}
              </label>
              <input type="number" min={1} readOnly value={seatsTotal || ''} className={fieldInput} style={{ ...fieldStyle, cursor: 'not-allowed', opacity: 0.7 }} placeholder={selectedBus ? `${selectedBus.capacity}` : '0'} />
            </div>

            {/* Siège à partir de */}
            <div>
              <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>
                Siège vendu à partir de <Lock className="w-3 h-3 inline ml-1" style={{ color: 'var(--text-muted)' }} />
              </label>
              <input type="number" min={1} readOnly value={seatsFrom} className={fieldInput} style={{ ...fieldStyle, cursor: 'not-allowed', opacity: 0.7 }} />
              <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>Valeur définie par l'Admin, non modifiable</p>
            </div>
          </div>

          {/* Seat range info banner for linked secondary station */}
          {isLinked && seatRangeInfo && (
            <div className="mt-4 rounded-xl p-4 flex items-start gap-3" style={{ backgroundColor: 'var(--info-light, #E0F2FE)', border: '2px solid var(--info, #0284C7)' }}>
              <Info className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: 'var(--info, #0284C7)' }} />
              <div>
                <p className="text-sm font-bold" style={{ color: 'var(--info, #0284C7)' }}>
                  Départ lié à la gare principale {linkedParent?.station_name ?? ''}
                </p>
                <p className="text-sm mt-1" style={{ color: 'var(--text-primary)' }}>
                  Vous êtes autorisé à vendre uniquement les sièges n°{seatRangeInfo.from} à n°{seatRangeInfo.to}.
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  Gare : {seatRangeInfo.stationName} · Plage attribuée : {seatRangeInfo.from} à {seatRangeInfo.to} · {seatRangeInfo.to - seatRangeInfo.from + 1} siège(s)
                </p>
              </div>
            </div>
          )}

          {/* Seat allocation section */}
          {enableOtherStation && seatsTotal > 0 && !isLinked && (
            <div className="mt-5 rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '2px solid var(--primary)' }}>
              <h3 className="text-sm font-bold mb-1 flex items-center gap-2" style={{ color: 'var(--primary)' }}>
                <Armchair className="w-4 h-4" /> Répartition des sièges
              </h3>
              <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
                Capacité du bus : {seatsTotal} places · Gare primaire : <strong>{session?.station_name ?? 'Gare principale'}</strong>
              </p>

              {/* Existing allocations table */}
              {seatAllocations.length > 0 && (
                <div className="rounded-lg overflow-hidden mb-3" style={{ border: '1px solid var(--border)' }}>
                  <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ backgroundColor: 'var(--surface-raised)', color: 'var(--text-secondary)' }}>
                        <th className="px-3 py-2 text-xs font-bold text-left">Gare</th>
                        <th className="px-3 py-2 text-xs font-bold text-center">Sièges attribués</th>
                        <th className="px-3 py-2 text-xs font-bold text-right">Nbre</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Primary station row */}
                      {(() => {
                        const sorted = [...seatAllocations].sort((a, b) => a.seat_from - b.seat_from);
                        const primaryTo = sorted[0].seat_from - 1;
                        const primaryFrom = seatsFrom;
                        if (primaryTo >= primaryFrom) {
                          return (
                            <tr style={{ borderTop: '1px solid var(--border)', backgroundColor: 'var(--primary-light)' }}>
                              <td className="px-3 py-2 text-xs font-bold" style={{ color: 'var(--primary)' }}>{session?.station_name ?? 'Gare primaire'}</td>
                              <td className="px-3 py-2 text-xs text-center" style={{ color: 'var(--primary)' }}>{primaryFrom} à {primaryTo}</td>
                              <td className="px-3 py-2 text-xs text-center font-bold" style={{ color: 'var(--primary)' }}>{primaryTo - primaryFrom + 1}</td>
                              <td className="px-3 py-2"></td>
                            </tr>
                          );
                        }
                        return null;
                      })()}
                      {seatAllocations.map((a, i) => (
                        <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                          <td className="px-3 py-2 text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{a.station_name}</td>
                          <td className="px-3 py-2 text-xs text-center" style={{ color: 'var(--text-primary)' }}>{a.seat_from} à {a.seat_to}</td>
                          <td className="px-3 py-2 text-xs text-center font-bold" style={{ color: 'var(--text-primary)' }}>{a.seat_to - a.seat_from + 1}</td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => setSeatAllocations(seatAllocations.filter((_, idx) => idx !== i))}
                              className="p-1 rounded-lg"
                              style={{ color: 'var(--danger)' }}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '2px solid var(--border)' }}>
                        <td className="px-3 py-2 text-xs font-bold" style={{ color: 'var(--text-primary)' }}>Total attribué</td>
                        <td className="px-3 py-2"></td>
                        <td className="px-3 py-2 text-xs text-center font-bold" style={{ color: seatAllocations.reduce((s, a) => s + (a.seat_to - a.seat_from + 1), 0) + (seatAllocations.length > 0 ? seatAllocations[0].seat_from - seatsFrom : 0) > seatsTotal ? 'var(--danger)' : 'var(--success)' }}>
                          {seatAllocations.reduce((s, a) => s + (a.seat_to - a.seat_from + 1), 0) + (seatAllocations.length > 0 ? seatAllocations[0].seat_from - seatsFrom : 0)} / {seatsTotal}
                        </td>
                        <td className="px-3 py-2"></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {allocError && (
                <div className="rounded-lg px-3 py-2 mb-3 flex items-start gap-2 text-xs" style={{ backgroundColor: 'var(--danger-light)', color: 'var(--danger)' }}>
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /><span>{allocError}</span>
                </div>
              )}

              {/* Add allocation form */}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="col-span-2">
                  <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Gare de vente secondaire</label>
                  <AutocompleteSelect
                    options={gares.filter(g => g.id !== session?.station_id && !seatAllocations.some(a => a.station_id === g.id)).map(g => ({
                      id: g.id,
                      label: g.name,
                      sublabel: [g.city, g.agency_code].filter(Boolean).join(' · '),
                      keywords: `${g.name} ${g.city ?? ''} ${g.agency_code ?? ''}`,
                    }))}
                    value={newAllocStationId}
                    onChange={setNewAllocStationId}
                    placeholder="Rechercher une gare..."
                    emptyText="Aucune gare disponible"
                  />
                </div>
                <div>
                  <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>
                    Nombre de sièges <Lock className="w-3 h-3 inline ml-1" style={{ color: 'var(--text-muted)' }} />
                  </label>
                  <input
                    type="number"
                    readOnly
                    value={(() => {
                      const from = parseInt(newAllocSeatFrom);
                      const to = parseInt(newAllocSeatTo);
                      if (!isNaN(from) && !isNaN(to) && to >= from) return to - from + 1;
                      return newAllocSeatCount || '';
                    })()}
                    className={fieldInput}
                    style={{ ...fieldStyle, cursor: 'not-allowed', opacity: 0.7 }}
                    placeholder={selectedBus ? `${selectedBus.capacity}` : '0'}
                  />
                  <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>Calculé automatiquement depuis le bus</p>
                </div>
                <div>
                  <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Premier numéro de siège</label>
                  <input
                    type="number"
                    min={seatsFrom}
                    max={seatsTotal}
                    value={newAllocSeatFrom}
                    onChange={e => {
                      setNewAllocSeatFrom(e.target.value);
                      const from = parseInt(e.target.value) || 0;
                      const count = parseInt(newAllocSeatCount) || 0;
                      if (from > 0 && count > 0) {
                        setNewAllocSeatTo(String(Math.min(from + count - 1, seatsTotal)));
                      }
                    }}
                    className={fieldInput}
                    style={fieldStyle}
                    placeholder="Ex: 32"
                  />
                </div>
                <div>
                  <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Dernier numéro de siège</label>
                  <input
                    type="number"
                    min={seatsFrom}
                    max={seatsTotal}
                    value={newAllocSeatTo}
                    onChange={e => setNewAllocSeatTo(e.target.value)}
                    className={fieldInput}
                    style={fieldStyle}
                    placeholder="Ex: 62"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (!newAllocStationId) { setAllocError('Veuillez sélectionner une gare secondaire'); return; }
                  const from = parseInt(newAllocSeatFrom);
                  const to = parseInt(newAllocSeatTo);
                  if (isNaN(from) || isNaN(to) || from < 1 || to > seatsTotal || from > to) {
                    setAllocError(`Plage invalide — les sièges doivent être entre 1 et ${seatsTotal}`); return;
                  }
                  const gare = gares.find(g => g.id === newAllocStationId);
                  const newAlloc: SeatAllocation = {
                    station_id: newAllocStationId,
                    station_name: gare?.name ?? newAllocStationId,
                    seat_from: from,
                    seat_to: to,
                  };
                  const updated = [...seatAllocations, newAlloc];
                  const err = validateSeatAllocations(updated, seatsTotal);
                  if (err) { setAllocError(err); return; }
                  setSeatAllocations(updated);
                  setNewAllocStationId(''); setNewAllocSeatCount(''); setNewAllocSeatFrom(''); setNewAllocSeatTo('');
                  setAllocError('');
                }}
                disabled={!newAllocStationId || !newAllocSeatFrom || !newAllocSeatTo}
                className="w-full py-2.5 rounded-xl font-bold text-sm text-white disabled:opacity-60 flex items-center justify-center gap-2"
                style={{ backgroundColor: 'var(--primary)' }}
              >
                <Plus className="w-4 h-4" /> Valider la répartition
              </button>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 mt-6">
            <button
              onClick={() => navigate('/guichet/departs')}
              className="flex-1 py-3.5 rounded-xl font-bold text-base border-2 transition-colors"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            >
              Annuler
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || saving}
              className="flex-1 py-3.5 rounded-xl font-bold text-base transition-all"
              style={{
                backgroundColor: canSubmit ? 'var(--primary)' : 'var(--border)',
                color: canSubmit ? 'var(--text-on-primary, white)' : 'var(--text-muted)',
                cursor: canSubmit ? 'pointer' : 'not-allowed',
              }}
            >
              {saving ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : forceRamassage ? 'Créer le ramassage' : 'Créer le départ'}
            </button>
            {!canSubmit && missingFields.length > 0 && (
              <p className="text-xs mt-1.5 flex items-center gap-1" style={{ color: 'var(--danger)' }}>
                <AlertCircle className="w-3.5 h-3.5" />
                Champs manquants : {missingFields.join(', ')}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Confirmation dialog */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="rounded-2xl shadow-2xl max-w-sm w-full p-6" style={{ backgroundColor: 'var(--surface)' }}>
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Confirmation</h3>
              <button onClick={() => setShowConfirm(false)} className="p-1 rounded-lg" style={{ color: 'var(--text-muted)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
              Voulez-vous créer un nouveau départ ? Veuillez bien vérifier la date, le nom du chauffeur et le numéro de la plaque d'immatriculation avant de confirmer.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-3 rounded-xl font-bold border-2"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              >
                Non
              </button>
              <button
                onClick={handleConfirm}
                disabled={saving}
                className="flex-1 py-3 rounded-xl font-bold text-white disabled:opacity-60"
                style={{ backgroundColor: 'var(--primary)' }}
              >
                {saving ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Oui'}
              </button>
            </div>
          </div>
        </div>
      )}
    </POSLayout>
  );
}
