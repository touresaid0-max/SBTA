import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2, Ticket, X, CheckCircle, Printer, AlertCircle, ArrowLeft } from 'lucide-react';
import POSLayout from '@/components/pos/POSLayout';
import { usePOSSession } from '@/services/pos/POSSessionContext';
import {
  getDepartById, getSeatRangeForStation, isSeatAllowedForStation,
  seatsAllocatedForStation, seatsVendusForStation, seatsLibresForStation,
} from '@/services/pos/departService';
import {
  getTicketsForDepart, getSoldSeats, sellTickets, cancelTicket,
  getTarifs, getStations, getRouteCityStops,
  calculatePrice, getTarifForDestination,
  type SellTicketParams,
} from '@/services/pos/ticketService';
import { PrintService, type PrintTicketData } from '@/services/pos/printService';

import type { DepartRecord, TicketRecord } from '@/services/pos/db';
import { formatCurrency } from '@/utils/formatCurrency';

interface DestOption {
  id: string;
  name: string;
  price: number;
}

export default function POSVente() {
  const navigate = useNavigate();
  const { id: departId } = useParams<{ id: string }>();
  const { session } = usePOSSession();

  const [depart, setDepart] = useState<DepartRecord | null>(null);
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [soldSeats, setSoldSeats] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [selling, setSelling] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [destOptions, setDestOptions] = useState<DestOption[]>([]);
  const [selectedDestId, setSelectedDestId] = useState('');
  const [basePrice, setBasePrice] = useState(0);
  const [seatInput, setSeatInput] = useState('');
  const [passengerName, setPassengerName] = useState('');
  const [passengerPhone, setPassengerPhone] = useState('');
  const [isReduced, setIsReduced] = useState(false);
  const [isReported, setIsReported] = useState(false);
  const [printAfterSale, setPrintAfterSale] = useState(true);

  const loadData = useCallback(async () => {
    if (!departId) return;
    const d = await getDepartById(departId);
    if (!d) {
      setError('Départ introuvable');
      setLoading(false);
      return;
    }
    setDepart(d);

    const [allTickets, sold, tarifs, stations, cityStops] = await Promise.all([
      getTicketsForDepart(departId),
      getSoldSeats(departId),
      getTarifs(),
      getStations(),
      getRouteCityStops(),
    ]);
    setTickets(allTickets);
    setSoldSeats(sold);

    const options: DestOption[] = [];

    const routeTarifs = tarifs.filter(t => t.route_id === d.route_id);
    for (const t of routeTarifs) {
      const st = stations.find(s => s.id === t.station_id);
      if (st) {
        options.push({ id: st.id, name: st.name, price: t.price });
      }
    }

    for (const cs of cityStops.filter(c => c.route_id === d.route_id)) {
      const existing = options.find(o => o.name === cs.city_name);
      if (!existing) {
        options.push({ id: cs.id, name: cs.city_name, price: cs.price });
      }
    }

    if (options.length === 0 && d.route_name) {
      const destCity = d.route_name.split(/\s*[-–—]\s*/).pop() ?? d.route_name;
      options.push({ id: 'terminal', name: destCity, price: d.is_ac ? Math.round(5000 * 1.1) : 5000 });
    }

    setDestOptions(options);
    if (options.length > 0 && !selectedDestId) {
      setSelectedDestId(options[0].id);
      setBasePrice(options[0].price);
    }

    setLoading(false);
  }, [departId, selectedDestId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const seatRange = useMemo(() => {
    if (!depart || !session?.station_id) return null;
    return getSeatRangeForStation(depart, session.station_id);
  }, [depart, session?.station_id]);

  const seatsTotal = depart
    ? (seatRange ? seatRange.to - seatRange.from + 1 : seatsAllocatedForStation(depart, session?.station_id ?? ''))
    : 0;
  const seatsSold = depart && session?.station_id
    ? seatsVendusForStation(tickets, depart, session.station_id)
    : (depart?.seats_sold ?? 0);
  const seatsLibres = seatsTotal - seatsSold;

  const finalPrice = useMemo(() => {
    if (!depart) return 0;
    return calculatePrice(basePrice, depart.is_ac, isReduced);
  }, [basePrice, depart, isReduced]);

  const handleDestChange = (id: string) => {
    setSelectedDestId(id);
    const opt = destOptions.find(o => o.id === id);
    if (opt) setBasePrice(opt.price);
  };

  const parseSeats = (input: string): number[] => {
    return input
      .split(/[,\s]+/)
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !isNaN(n) && n > 0);
  };

  const handleSell = async () => {
    setError('');
    setSuccess('');
    if (!depart || !departId) return;
    if (!selectedDestId) {
      setError('Veuillez sélectionner une destination');
      return;
    }
    const seats = parseSeats(seatInput);
    if (seats.length === 0) {
      setError('Veuillez saisir au moins un numéro de siège');
      return;
    }

    for (const seat of seats) {
      if (seat < depart.seats_from || seat > depart.seats_total) {
        setError(`Le siège ${seat} est hors plage (${depart.seats_from}–${depart.seats_total})`);
        return;
      }
      if (session?.station_id && !isSeatAllowedForStation(depart, session.station_id, seat)) {
        setError(`Le siège ${seat} n'est pas attribué à votre gare`);
        return;
      }
      if (soldSeats.includes(seat)) {
        setError(`Le siège ${seat} est déjà vendu`);
        return;
      }
    }

    setSelling(true);
    try {
      const destOpt = destOptions.find(o => o.id === selectedDestId);
      const params: Omit<SellTicketParams, 'seatNumber'> = {
        departId,
        destination: destOpt?.name ?? '',
        destinationId: selectedDestId,
        price: finalPrice,
        originalPrice: basePrice,
        isReduced,
        isReported,
        isAc: depart.is_ac,
        printTicket: printAfterSale,
        passengerName,
        passengerPhone,
        stationAgencyCode: session?.station_id,
      };
      const soldTickets = await sellTickets(seats, params);

      const allTickets = await getTicketsForDepart(departId);
      setTickets(allTickets);
      setSoldSeats(await getSoldSeats(departId));

      if (printAfterSale && soldTickets.length > 0) {
        for (const ticket of soldTickets) {
          const printData: PrintTicketData = {
            ticket,
            depart,
            stationName: session?.station_name,
          };
          try { await PrintService.printTicket(printData); } catch { /* best-effort */ }
        }
      }

      setSuccess(`${soldTickets.length} ticket(s) vendu(s) avec succès`);
      setSeatInput('');
      setPassengerName('');
      setPassengerPhone('');
      setIsReduced(false);
      setIsReported(false);

      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la vente');
    } finally {
      setSelling(false);
    }
  };

  const handleCancelTicket = async (ticketId: string) => {
    setError('');
    try {
      await cancelTicket(ticketId);
      if (departId) {
        const allTickets = await getTicketsForDepart(departId);
        setTickets(allTickets);
        setSoldSeats(await getSoldSeats(departId));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de l\'annulation');
    }
  };

  const handleReprint = async (ticket: TicketRecord) => {
    if (!depart) return;
    try {
      await PrintService.printTicket({
        ticket,
        depart,
        stationName: session?.station_name,
      } as PrintTicketData);
    } catch {
      setError('Impression échouée');
    }
  };

  if (loading) {
    return (
      <POSLayout showBack stationName={session?.station_name} activeRoute="Vente de tickets">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--primary)' }} />
        </div>
      </POSLayout>
    );
  }

  if (!depart) {
    return (
      <POSLayout showBack stationName={session?.station_name} activeRoute="Vente de tickets">
        <div className="text-center py-20">
          <AlertCircle className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--danger)' }} />
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{error || 'Départ introuvable'}</p>
          <button
            onClick={() => navigate('/guichet/departs')}
            className="mt-4 px-4 py-2 rounded-lg text-sm font-bold text-white"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            Retour aux départs
          </button>
        </div>
      </POSLayout>
    );
  }

  const soldSet = new Set(soldSeats);

  return (
    <POSLayout showBack stationName={session?.station_name} activeRoute={`Vente — #${depart.route_number} ${depart.route_name ?? ''}`}>
      {/* Depart summary */}
      <div className="mb-4 rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              Départ #{depart.route_number} — {depart.route_name}
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              {depart.departure_date} à {depart.departure_time} · {depart.bus_plate} · {depart.driver_name}
            </p>
          </div>
          <div className="flex gap-4 text-center">
            <div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Total</p>
              <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{seatsTotal}</p>
            </div>
            <div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Vendus</p>
              <p className="text-lg font-bold" style={{ color: 'var(--info)' }}>{seatsSold}</p>
            </div>
            <div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Libres</p>
              <p className="text-lg font-bold" style={{ color: 'var(--success)' }}>{seatsLibres}</p>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl px-3 py-2.5 flex items-start gap-2 text-sm font-bold" style={{ backgroundColor: 'var(--danger-light)', color: 'var(--danger)' }}>
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /><span>{error}</span>
        </div>
      )}
      {success && (
        <div className="mb-4 rounded-xl px-3 py-2.5 flex items-start gap-2 text-sm font-bold" style={{ backgroundColor: 'var(--success-light, #D1FAE5)', color: 'var(--success)' }}>
          <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /><span>{success}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Sale form */}
        <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <h3 className="text-base font-bold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Ticket className="w-5 h-5" style={{ color: 'var(--primary)' }} /> Vendre un ticket
          </h3>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>Destination</label>
              <select
                value={selectedDestId}
                onChange={(e) => handleDestChange(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg text-sm border-2 outline-none"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
              >
                {destOptions.map(o => (
                  <option key={o.id} value={o.id}>{o.name} — {formatCurrency(o.price)}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>
                Numéro(s) de siège {seatRange && `(plage: ${seatRange.from}–${seatRange.to})`}
              </label>
              <input
                type="text"
                value={seatInput}
                onChange={(e) => setSeatInput(e.target.value)}
                placeholder="Ex: 5 ou 5,6,7"
                className="w-full px-3 py-2.5 rounded-lg text-sm border-2 outline-none"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
              />
              {seatInput && (
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  {parseSeats(seatInput).length} siège(s) — Total: {formatCurrency(finalPrice * parseSeats(seatInput).length)}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>Nom passager</label>
                <input
                  type="text"
                  value={passengerName}
                  onChange={(e) => setPassengerName(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg text-sm border-2 outline-none"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>Téléphone</label>
                <input
                  type="text"
                  value={passengerPhone}
                  onChange={(e) => setPassengerPhone(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg text-sm border-2 outline-none"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
                />
              </div>
            </div>

            <div className="flex items-center gap-4 flex-wrap">
              <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={isReduced} onChange={(e) => setIsReduced(e.target.checked)} className="w-4 h-4" />
                Tarif réduit (-10%)
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={isReported} onChange={(e) => setIsReported(e.target.checked)} className="w-4 h-4" />
                Ticket reporté
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={printAfterSale} onChange={(e) => setPrintAfterSale(e.target.checked)} className="w-4 h-4" />
                Imprimer après vente
              </label>
            </div>

            <div className="flex items-center justify-between pt-2" style={{ borderTop: '1px solid var(--border)' }}>
              <div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Prix unitaire</p>
                <p className="text-xl font-bold" style={{ color: 'var(--primary)' }}>{formatCurrency(finalPrice)}</p>
              </div>
              <button
                onClick={handleSell}
                disabled={selling || !selectedDestId}
                className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: 'var(--primary)' }}
              >
                {selling ? <Loader2 className="w-5 h-5 animate-spin" /> : <Ticket className="w-5 h-5" />}
                Vendre
              </button>
            </div>
          </div>
        </div>

        {/* Seat map */}
        <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <h3 className="text-base font-bold mb-3" style={{ color: 'var(--text-primary)' }}>Plan des sièges</h3>
          {seatRange && (
            <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
              Votre plage: {seatRange.from}–{seatRange.to}
            </p>
          )}
          <div className="grid grid-cols-5 sm:grid-cols-6 gap-1.5">
            {Array.from({ length: depart.seats_total }, (_, i) => {
              const seatNum = depart.seats_from + i;
              const isSold = soldSet.has(seatNum);
              const inRange = !seatRange || (seatNum >= seatRange.from && seatNum <= seatRange.to);
              return (
                <div
                  key={seatNum}
                  className="flex items-center justify-center rounded-lg text-xs font-bold h-9 transition-colors"
                  style={{
                    backgroundColor: isSold ? 'var(--danger)' : inRange ? 'var(--success-light, #D1FAE5)' : 'var(--surface-raised)',
                    color: isSold ? 'white' : inRange ? 'var(--success)' : 'var(--text-muted)',
                    border: `1px solid ${inRange ? 'var(--border)' : 'transparent'}`,
                  }}
                >
                  {seatNum}
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-4 mt-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded" style={{ backgroundColor: 'var(--success-light, #D1FAE5)' }} /> Libre
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded" style={{ backgroundColor: 'var(--danger)' }} /> Vendu
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded" style={{ backgroundColor: 'var(--surface-raised)' }} /> Autre gare
            </span>
          </div>
        </div>
      </div>

      {/* Tickets list */}
      {tickets.length > 0 && (
        <div className="mt-4 rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="px-4 py-3" style={{ backgroundColor: 'var(--surface-raised)', borderBottom: '1px solid var(--border)' }}>
            <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              Tickets vendus ({tickets.length})
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--text-secondary)' }}>
                  <th className="px-3 py-2 text-xs font-bold text-left">Siège</th>
                  <th className="px-3 py-2 text-xs font-bold text-left">Destination</th>
                  <th className="px-3 py-2 text-xs font-bold text-left">Passager</th>
                  <th className="px-3 py-2 text-xs font-bold text-right">Prix</th>
                  <th className="px-3 py-2 text-xs font-bold text-center">Statut</th>
                  <th className="px-3 py-2 text-xs font-bold text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map(t => (
                  <tr key={t.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-3 py-2 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{t.seat_number}</td>
                    <td className="px-3 py-2 text-sm" style={{ color: 'var(--text-secondary)' }}>{t.destination}</td>
                    <td className="px-3 py-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {t.passenger_name || '—'}{t.passenger_phone ? ` (${t.passenger_phone})` : ''}
                    </td>
                    <td className="px-3 py-2 text-sm text-right font-bold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(t.price)}</td>
                    <td className="px-3 py-2 text-sm text-center">
                      {t.status === 'cancelled'
                        ? <span style={{ color: 'var(--danger)' }}>Annulé</span>
                        : <span style={{ color: 'var(--success)' }}>Actif</span>}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => handleReprint(t)}
                          className="p-1.5 rounded-lg transition-colors hover:bg-black/5"
                          style={{ color: 'var(--text-secondary)' }}
                          title="Réimprimer"
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                        {t.status !== 'cancelled' && (
                          <button
                            onClick={() => handleCancelTicket(t.id)}
                            className="p-1.5 rounded-lg transition-colors hover:bg-black/5"
                            style={{ color: 'var(--danger)' }}
                            title="Annuler"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bottom nav */}
      <div className="mt-6 flex justify-between">
        <button
          onClick={() => navigate('/guichet/departs')}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold border-2"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
        >
          <ArrowLeft className="w-4 h-4" /> Retour aux départs
        </button>
      </div>
    </POSLayout>
  );
}
