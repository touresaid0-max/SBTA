import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import POSLayout from '@/components/pos/POSLayout';
import { usePOSSession } from '@/services/pos/POSSessionContext';
import {
  getDepartById,
  getSeatRangeForStation,
  type DepartRecord,
} from '@/services/pos/departService';
import {
  getStations,
  getTicketsForDepart,
  getTarifs,
  getRouteCityStops,
  sellTicket,
  cancelTicket,
  type StationRef,
  type TicketRecord,
  type TarifRef,
  type RouteCityStopRef,
} from '@/services/pos/ticketService';
import { PrintService } from '@/services/pos/printService';
import { formatCurrency } from '@/utils/formatCurrency';
import {
  AlertCircle,
  CheckCircle,
  Loader2,
  Plus,
  Lock,
  Ticket as TicketIcon,
  User,
  Phone,
  Trash2,
} from 'lucide-react';
import ChangeRequestButton from '@/components/shared/ChangeRequestButton';

export default function POSVente() {
  const { id: departId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { session } = usePOSSession();

  const [depart, setDepart] = useState<DepartRecord | null>(null);
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [stations, setStations] = useState<StationRef[]>([]);
  const [tarifs, setTarifs] = useState<TarifRef[]>([]);
  const [cityStops, setCityStops] = useState<RouteCityStopRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [seatNumber, setSeatNumber] = useState<number | ''>('');
  const [destinationId, setDestinationId] = useState('');
  const [passengerName, setPassengerName] = useState('');
  const [passengerPhone, setPassengerPhone] = useState('');
  const [isReduced, setIsReduced] = useState(false);
  const [isReported, setIsReported] = useState(false);
  const [isAc, setIsAc] = useState(false);
  const [printTicket, setPrintTicket] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    if (!departId) return;
    try {
      const d = await getDepartById(departId);
      if (!d) {
        setError('Départ introuvable');
        setLoading(false);
        return;
      }
      if (session?.counter_id && d.counter_id && d.counter_id !== session.counter_id) {
        setError("Ce départ n'est pas affecté à votre guichet.");
        setLoading(false);
        return;
      }
      setDepart(d);
      const [t, s, tf, cs] = await Promise.all([
        getTicketsForDepart(departId),
        getStations(),
        getTarifs(),
        getRouteCityStops(),
      ]);
      setTickets(t);
      setStations(s);
      setTarifs(tf);
      setCityStops(cs);
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }, [departId, session?.counter_id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const hasAllocations = !!(depart?.seat_allocations && depart.seat_allocations.length > 0);
  const stationRange =
    hasAllocations && session?.station_id ? getSeatRangeForStation(depart!, session.station_id) : null;

  const activeTickets = useMemo(
    () => tickets.filter(t => t.status !== 'cancelled'),
    [tickets],
  );

  const scopedTickets = useMemo(() => {
    if (!hasAllocations || !stationRange) return activeTickets;
    return activeTickets.filter(
      t => t.seat_number >= stationRange.from && t.seat_number <= stationRange.to,
    );
  }, [activeTickets, hasAllocations, stationRange]);

  const ticketTotal = useMemo(
    () => scopedTickets.reduce((sum, t) => sum + t.price, 0),
    [scopedTickets],
  );

  const soldSeats = useMemo(() => new Set(activeTickets.map(t => t.seat_number)), [activeTickets]);

  const seatMin = stationRange?.from ?? depart?.seats_from ?? 1;
  const seatMax = stationRange?.to ?? depart?.seats_total ?? 1;

  const destinationOptions = useMemo(() => {
    if (!depart) return [];
    const options: { id: string; name: string; price: number }[] = [];
    const routeTarifs = tarifs.filter(t => t.route_id === depart.route_id);
    for (const t of routeTarifs) {
      const st = stations.find(s => s.id === t.station_id);
      if (st) options.push({ id: st.id, name: st.name, price: t.price });
    }
    const routeCities = cityStops.filter(c => c.route_id === depart.route_id);
    for (const c of routeCities) {
      if (!options.some(o => o.id === c.city_id)) {
        options.push({ id: c.city_id, name: c.city_name, price: c.price });
      }
    }
    if (options.length === 0 && depart.route_name) {
      options.push({ id: depart.route_id, name: depart.route_name, price: depart.base_price ?? 0 });
    }
    return options;
  }, [depart, stations, tarifs, cityStops]);

  const selectedDestination = useMemo(
    () => destinationOptions.find(o => o.id === destinationId) ?? null,
    [destinationOptions, destinationId],
  );

  const finalPrice = useMemo(() => {
    if (!selectedDestination) return 0;
    let p = selectedDestination.price;
    if (isAc) p = Math.round(p * 1.1);
    if (isReduced) p = Math.round(p * 0.9);
    return p;
  }, [selectedDestination, isAc, isReduced]);

  const handleSubmit = async () => {
    if (!depart || !departId) return;
    if (depart.cloture) {
      setError('Ce départ est clôturé — vente impossible');
      return;
    }
    setError('');
    setSuccess('');

    if (typeof seatNumber !== 'number' || seatNumber < seatMin || seatNumber > seatMax) {
      setError(`Le siège doit être entre ${seatMin} et ${seatMax}`);
      return;
    }
    if (soldSeats.has(seatNumber)) {
      setError(`Le siège ${seatNumber} est déjà vendu`);
      return;
    }
    if (!destinationId || !selectedDestination) {
      setError('Veuillez sélectionner une destination');
      return;
    }
    if (finalPrice <= 0) {
      setError('Prix invalide pour cette destination');
      return;
    }

    setSaving(true);
    try {
      const ticket = await sellTicket({
        departId,
        seatNumber,
        destination: selectedDestination.name,
        destinationId: selectedDestination.id,
        price: finalPrice,
        originalPrice: selectedDestination.price,
        isReduced,
        isReported,
        isAc,
        printTicket,
        passengerName,
        passengerPhone,
      });

      if (printTicket && depart) {
        try {
          PrintService.printTicket({ ticket, depart, stationName: session?.station_name });
        } catch {
          // printing errors are non-blocking
        }
      }

      const [t, updatedDepart] = await Promise.all([
        getTicketsForDepart(departId),
        getDepartById(departId),
      ]);
      setTickets(t);
      if (updatedDepart) setDepart(updatedDepart);

      setSuccess(`Ticket vendu — ${ticket.ticket_number}`);

      setSeatNumber('');
      setDestinationId('');
      setPassengerName('');
      setPassengerPhone('');
      setIsReduced(false);
      setIsReported(false);
      setIsAc(false);

      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err?.message ?? 'Erreur lors de la vente du ticket');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (ticketId: string) => {
    if (!departId) return;
    if (!confirm('Annuler ce ticket ?')) return;
    try {
      await cancelTicket(ticketId);
      const [t, updatedDepart] = await Promise.all([
        getTicketsForDepart(departId),
        getDepartById(departId),
      ]);
      setTickets(t);
      if (updatedDepart) setDepart(updatedDepart);
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de l'annulation");
    }
  };

  const fieldLabel = 'block text-xs font-bold mb-1';
  const fieldInput = 'w-full px-3 py-2.5 rounded-lg border-2 text-sm outline-none transition-colors';
  const fieldStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)' as const };

  if (loading) {
    return (
      <POSLayout showBack stationName={session?.station_name} activeRoute="Vente">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--primary)' }} />
        </div>
      </POSLayout>
    );
  }

  if (!depart) {
    return (
      <POSLayout showBack stationName={session?.station_name} activeRoute="Vente">
        <div className="text-center py-20">
          <AlertCircle className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--danger)' }} />
          <p style={{ color: 'var(--text-secondary)' }}>{error || 'Départ introuvable'}</p>
          <button
            onClick={() => navigate('/guichet/departs')}
            className="mt-4 px-4 py-2 rounded-lg font-bold text-white"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            Retour aux départs
          </button>
        </div>
      </POSLayout>
    );
  }

  return (
    <POSLayout
      showBack
      stationName={session?.station_name}
      activeRoute={`Vente — Départ #${depart.route_number} (${depart.route_name ?? ''})`}
    >
      <div className="max-w-5xl mx-auto">
        {depart.cloture && (
          <div
            className="rounded-xl px-3 py-2.5 mb-4 flex items-center gap-2 text-sm font-bold"
            style={{ backgroundColor: 'var(--danger-light)', color: 'var(--danger)' }}
          >
            <Lock className="w-4 h-4" /> Ce départ est clôturé — vente verrouillée
          </div>
        )}

        <div
          className="rounded-xl p-3 mb-4 flex items-center justify-between"
          style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-4 text-sm">
            <span style={{ color: 'var(--text-muted)' }}>Départ #{depart.route_number}</span>
            <span style={{ color: 'var(--text-secondary)' }}>·</span>
            <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{depart.route_name}</span>
            <span style={{ color: 'var(--text-secondary)' }}>·</span>
            <span style={{ color: 'var(--text-secondary)' }}>{depart.bus_plate}</span>
          </div>
          <div className="text-sm">
            <span className="font-bold" style={{ color: 'var(--text-muted)' }}>MT Ticket: </span>
            <span className="font-bold" style={{ color: 'var(--success)' }}>{formatCurrency(ticketTotal)}</span>
          </div>
        </div>

        {error && (
          <div
            className="rounded-xl px-3 py-2.5 mb-4 flex items-start gap-2 text-sm"
            style={{ backgroundColor: 'var(--danger-light)', color: 'var(--danger)' }}
          >
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div
            className="rounded-xl px-3 py-2.5 mb-4 flex items-center gap-2 text-sm font-medium"
            style={{ backgroundColor: 'var(--success-light)', color: 'var(--success)' }}
          >
            <CheckCircle className="w-4 h-4" /> {success}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-1 order-2 lg:order-1">
            <div
              className="rounded-xl overflow-hidden"
              style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <div className="px-3 py-2.5" style={{ backgroundColor: 'var(--surface-raised)' }}>
                <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <TicketIcon className="w-4 h-4" /> Tickets vendus
                </h3>
              </div>
              <div className="max-h-96 overflow-y-auto">
                {scopedTickets.length === 0 ? (
                  <p className="text-center text-xs py-8" style={{ color: 'var(--text-muted)' }}>
                    Aucun ticket vendu
                  </p>
                ) : (
                  <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ color: 'var(--text-muted)' }}>
                        <th className="px-2 py-1.5 text-xs font-bold text-left">N° Ticket</th>
                        <th className="px-2 py-1.5 text-xs font-bold text-center">Siège</th>
                        <th className="px-2 py-1.5 text-xs font-bold text-left">Destination</th>
                        <th className="px-2 py-1.5 text-xs font-bold text-right">Prix</th>
                        <th className="px-2 py-1.5 text-xs font-bold text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scopedTickets.map(t => (
                        <tr key={t.id} style={{ borderTop: '1px solid var(--border)' }}>
                          <td className="px-2 py-2 text-xs font-mono" style={{ color: 'var(--text-primary)' }}>
                            {t.ticket_number}
                          </td>
                          <td className="px-2 py-2 text-xs text-center" style={{ color: 'var(--text-secondary)' }}>
                            {t.seat_number}
                          </td>
                          <td className="px-2 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                            {t.destination}
                          </td>
                          <td className="px-2 py-2 text-xs text-right" style={{ color: 'var(--text-primary)' }}>
                            {formatCurrency(t.price)}
                          </td>
                          <td className="px-2 py-2 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => handleCancel(t.id)}
                                disabled={depart.cloture}
                                title="Annuler"
                                className="p-1 rounded disabled:opacity-40"
                                style={{ color: 'var(--danger)' }}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                              <ChangeRequestButton
                                compact
                                operationType="ticket"
                                operationId={t.id}
                                operationTable="tickets"
                                operationReference={`Ticket ${t.ticket_number}`}
                                operationSnapshot={t as unknown as Record<string, unknown>}
                                stationId={session?.station_id}
                                stationName={session?.station_name}
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '2px solid var(--border)' }}>
                        <td className="px-2 py-2 text-xs font-bold" colSpan={3} style={{ color: 'var(--text-primary)' }}>
                          Somme
                        </td>
                        <td className="px-2 py-2 text-xs text-right font-bold" style={{ color: 'var(--success)' }}>
                          {formatCurrency(ticketTotal)}
                        </td>
                        <td className="px-2 py-2"></td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            </div>
          </div>

          <div className="lg:col-span-2 order-1 lg:order-2">
            <div
              className="rounded-xl p-4"
              style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>
                Nouveau Ticket
              </h3>

              <div className="flex flex-wrap gap-4 mb-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isAc}
                    onChange={e => setIsAc(e.target.checked)}
                    className="w-4 h-4"
                    style={{ accentColor: 'var(--primary)' }}
                  />
                  <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                    Climatisé (+10%)
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isReduced}
                    onChange={e => setIsReduced(e.target.checked)}
                    className="w-4 h-4"
                    style={{ accentColor: 'var(--primary)' }}
                  />
                  <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                    Tarif réduit (-10%)
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isReported}
                    onChange={e => setIsReported(e.target.checked)}
                    className="w-4 h-4"
                    style={{ accentColor: 'var(--primary)' }}
                  />
                  <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                    Ticket report
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={printTicket}
                    onChange={e => setPrintTicket(e.target.checked)}
                    className="w-4 h-4"
                    style={{ accentColor: 'var(--primary)' }}
                  />
                  <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                    Imprimer ticket
                  </span>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>
                    Siège ({seatMin} — {seatMax})
                  </label>
                  <input
                    type="number"
                    min={seatMin}
                    max={seatMax}
                    value={seatNumber}
                    onChange={e => {
                      const v = e.target.value;
                      setSeatNumber(v === '' ? '' : parseInt(v, 10));
                    }}
                    className={fieldInput}
                    style={fieldStyle}
                    placeholder="N° du siège"
                  />
                </div>

                <div>
                  <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>
                    Destination
                  </label>
                  <select
                    value={destinationId}
                    onChange={e => setDestinationId(e.target.value)}
                    className={fieldInput}
                    style={fieldStyle}
                  >
                    <option value="">Sélectionner...</option>
                    {destinationOptions.map(o => (
                      <option key={o.id} value={o.id}>
                        {o.name} — {formatCurrency(o.price)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>
                    Nom et prénoms
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={passengerName}
                      onChange={e => setPassengerName(e.target.value)}
                      className={fieldInput}
                      style={fieldStyle}
                      placeholder="Nom du passager"
                    />
                    <User
                      className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4"
                      style={{ color: 'var(--text-muted)' }}
                    />
                  </div>
                </div>

                <div>
                  <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>
                    Contact
                  </label>
                  <div className="relative">
                    <input
                      type="tel"
                      value={passengerPhone}
                      onChange={e => setPassengerPhone(e.target.value)}
                      className={fieldInput}
                      style={fieldStyle}
                      placeholder="Téléphone"
                    />
                    <Phone
                      className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4"
                      style={{ color: 'var(--text-muted)' }}
                    />
                  </div>
                </div>

                <div className="col-span-2">
                  <div
                    className="rounded-lg px-3 py-2 flex items-center justify-between"
                    style={{ backgroundColor: 'var(--surface-raised)', border: '1px dashed var(--border)' }}
                  >
                    <span className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>
                      Prix final
                    </span>
                    <span className="text-lg font-bold" style={{ color: 'var(--success)' }}>
                      {formatCurrency(finalPrice)}
                    </span>
                  </div>
                </div>
              </div>

              <button
                onClick={handleSubmit}
                disabled={
                  saving ||
                  seatNumber === '' ||
                  !destinationId ||
                  finalPrice <= 0 ||
                  depart.cloture
                }
                className="w-full mt-4 py-3.5 rounded-xl font-bold text-white text-base disabled:opacity-60 flex items-center justify-center gap-2 transition-opacity"
                style={{ backgroundColor: 'var(--primary)' }}
              >
                {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                Vendre le ticket
              </button>
            </div>
          </div>
        </div>
      </div>
    </POSLayout>
  );
}
