import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import POSLayout from '@/components/pos/POSLayout';
import { usePOSSession } from '@/services/pos/POSSessionContext';
import {
  getDepartById,
} from '@/services/pos/departService';
import {
  sellTicket, getTicketsForDepart, getSoldSeats,
  calculatePrice, getStations,
  type TicketRecord, type StationRef,
} from '@/services/pos/ticketService';
import { getTarifs, type TarifRef } from '@/services/pos/ticketService';
import { PrintService } from '@/services/pos/printService';
import { formatCurrency } from '@/utils/formatCurrency';
import type { DepartRecord } from '@/services/pos/departService';
import {
  AlertCircle, CheckCircle, Loader2, Plus, Printer, X,
  Ticket as TicketIcon, Users, Armchair, TrendingDown, Calendar,
} from 'lucide-react';

export default function POSVente() {
  const { id: departId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { session } = usePOSSession();

  const [depart, setDepart] = useState<DepartRecord | null>(null);
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [soldSeats, setSoldSeats] = useState<number[]>([]);
  const [stations, setStations] = useState<StationRef[]>([]);
  const [tarifs, setTarifs] = useState<TarifRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Ticket form state
  const [destination, setDestination] = useState('');
  const [seatNumber, setSeatNumber] = useState('');
  const [tarif, setTarif] = useState(0);
  const [isReduced, setIsReduced] = useState(false);
  const [isReported, setIsReported] = useState(false);
  const [sameDestination, setSameDestination] = useState(false);
  const [printTicket, setPrintTicket] = useState(true);
  const [selling, setSelling] = useState(false);

  // Loyalty state
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(false);
  const [loyaltyNewCard, setLoyaltyNewCard] = useState(false);
  const [loyaltyCardNumber, setLoyaltyCardNumber] = useState('');
  const [loyaltyName, setLoyaltyName] = useState('');
  const [loyaltyPhone, setLoyaltyPhone] = useState('');
  const [loyaltyTrips, setLoyaltyTrips] = useState(0);

  const loadData = useCallback(async () => {
    if (!departId) return;
    try {
      const d = await getDepartById(departId);
      if (!d) {
        setError('Départ introuvable');
        setLoading(false);
        return;
      }
      setDepart(d);

      const [t, s, st, ta] = await Promise.all([
        getTicketsForDepart(departId),
        getSoldSeats(departId),
        getStations(),
        getTarifs(),
      ]);
      setTickets(t);
      setSoldSeats(s);
      setStations(st);
      setTarifs(ta);
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }, [departId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-calculate tarif when destination changes
  useEffect(() => {
    if (!depart || !destination) {
      setTarif(0);
      return;
    }
    const station = stations.find(s => s.id === destination);
    if (!station) return;
    const tarifRef = tarifs.find(
      t => t.route_id === depart.route_id && t.station_id === destination,
    );
    const basePrice = tarifRef?.price ?? 0;
    const finalPrice = calculatePrice(basePrice, depart.is_ac, isReduced);
    setTarif(finalPrice);
  }, [destination, depart, stations, tarifs, isReduced]);

  const seatsRemaining = useMemo(() => {
    if (!depart) return 0;
    return depart.seats_total - depart.seats_sold;
  }, [depart]);

  const ticketTotal = useMemo(() => {
    return tickets.reduce((sum, t) => sum + t.price, 0);
  }, [tickets]);

  const handleSell = async () => {
    if (!depart || !departId) return;
    setError('');
    setSuccess('');

    const seat = parseInt(seatNumber);
    if (!seat || isNaN(seat)) {
      setError('Veuillez saisir un numéro de siège valide');
      return;
    }
    if (seat < depart.seats_from || seat > depart.seats_total) {
      setError(`Le siège doit être entre ${depart.seats_from} et ${depart.seats_total}`);
      return;
    }
    if (!destination) {
      setError('Veuillez sélectionner une destination');
      return;
    }
    if (tarif <= 0) {
      setError('Tarif invalide — vérifiez la destination');
      return;
    }

    setSelling(true);
    try {
      const station = stations.find(s => s.id === destination);
      const ticket = await sellTicket({
        departId,
        seatNumber: seat,
        destination: station?.name ?? destination,
        destinationId: destination,
        price: tarif,
        originalPrice: tarif,
        isReduced,
        isReported,
        isAc: depart.is_ac,
        printTicket,
        loyaltyCardNumber: loyaltyEnabled ? loyaltyCardNumber : undefined,
        loyaltyName: loyaltyEnabled ? loyaltyName : undefined,
        stationAgencyCode: session?.station_name,
      });

      if (printTicket) {
        PrintService.print({ ticket, depart, stationName: session?.station_name });
      }

      // Refresh data
      const [t, s] = await Promise.all([
        getTicketsForDepart(departId),
        getSoldSeats(departId),
      ]);
      setTickets(t);
      setSoldSeats(s);

      // Update depart locally for counter display
      const updatedDepart = await getDepartById(departId);
      if (updatedDepart) setDepart(updatedDepart);

      setSuccess(`Siège ${seat} vendu — Ticket ${ticket.ticket_number}`);

      // Reset form but keep destination if "Même destination" is checked
      setSeatNumber('');
      setIsReduced(false);
      setIsReported(false);
      if (!sameDestination) {
        setDestination('');
        setTarif(0);
      }
      setLoyaltyEnabled(false);
      setLoyaltyNewCard(false);
      setLoyaltyCardNumber('');
      setLoyaltyName('');
      setLoyaltyPhone('');
      setLoyaltyTrips(0);

      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err?.message ?? 'Erreur lors de la vente');
    } finally {
      setSelling(false);
    }
  };

  const handlePrintTicket = (ticket: TicketRecord) => {
    if (depart) {
      PrintService.print({ ticket, depart, stationName: session?.station_name });
    }
  };
  void handlePrintTicket;

  const fieldLabel = 'block text-xs font-bold mb-1';
  const fieldInput = 'w-full px-3 py-2.5 rounded-lg border-2 text-sm outline-none transition-colors';
  const fieldStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)' as const };

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
          <AlertCircle className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--danger)' }} />
          <p style={{ color: 'var(--text-secondary)' }}>{error || 'Départ introuvable'}</p>
          <button onClick={() => navigate('/guichet/departs')} className="mt-4 px-4 py-2 rounded-lg font-bold text-white" style={{ backgroundColor: 'var(--primary)' }}>
            Retour aux départs
          </button>
        </div>
      </POSLayout>
    );
  }

  return (
    <POSLayout showBack stationName={session?.station_name} activeRoute={`Vente — Départ #${depart.departure_number}`}>
      <div className="max-w-5xl mx-auto">
        {/* Departure header */}
        <div className="rounded-xl p-4 mb-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div>
              <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Matricule Car</p>
              <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{depart.bus_plate}</p>
            </div>
            <div>
              <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Date départ</p>
              <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{depart.departure_date} {depart.departure_time}</p>
            </div>
            <div>
              <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>N° Départ</p>
              <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>#{depart.departure_number}</p>
            </div>
            <div>
              <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Tarif Climatisé</p>
              <p className="text-sm font-bold" style={{ color: depart.is_ac ? 'var(--info)' : 'var(--text-muted)' }}>{depart.is_ac ? 'Oui (+10%)' : 'Non'}</p>
            </div>
            <div>
              <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Ligne</p>
              <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{depart.route_name}</p>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-xl px-3 py-2.5 mb-4 flex items-start gap-2 text-sm" style={{ backgroundColor: 'var(--danger-light)', color: 'var(--danger)' }}>
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="rounded-xl px-3 py-2.5 mb-4 flex items-center gap-2 text-sm font-medium" style={{ backgroundColor: 'var(--success-light)', color: 'var(--success)' }}>
            <CheckCircle className="w-4 h-4" /> {success}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left: Ticket list */}
          <div className="lg:col-span-1 order-2 lg:order-1">
            <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="px-3 py-2.5" style={{ backgroundColor: 'var(--surface-raised)' }}>
                <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <TicketIcon className="w-4 h-4" /> Tickets / Bagages
                </h3>
              </div>
              <div className="max-h-96 overflow-y-auto">
                {tickets.length === 0 ? (
                  <p className="text-center text-xs py-8" style={{ color: 'var(--text-muted)' }}>Aucun ticket vendu</p>
                ) : (
                  <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ color: 'var(--text-muted)' }}>
                        <th className="px-2 py-1.5 text-xs font-bold text-left">Destination</th>
                        <th className="px-2 py-1.5 text-xs font-bold text-right">Tarif</th>
                        <th className="px-2 py-1.5 text-xs font-bold text-center">N°Siège</th>
                        <th className="px-2 py-1.5 text-xs font-bold text-center">Report</th>
                        <th className="px-2 py-1.5 text-xs font-bold text-right">Date reçue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tickets.map(t => (
                        <tr key={t.id} style={{ borderTop: '1px solid var(--border)' }}>
                          <td className="px-2 py-2 text-xs" style={{ color: 'var(--text-primary)' }}>{t.destination}</td>
                          <td className="px-2 py-2 text-xs text-right" style={{ color: 'var(--text-primary)' }}>{formatCurrency(t.price)}</td>
                          <td className="px-2 py-2 text-xs text-center" style={{ fontWeight: 700, color: 'var(--info)' }}>{t.seat_number}</td>
                          <td className="px-2 py-2 text-xs text-center">{t.is_reported ? 'R' : ''}</td>
                          <td className="px-2 py-2 text-xs text-right" style={{ color: 'var(--text-muted)' }}>{t.created_at.slice(5, 10)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '2px solid var(--border)' }}>
                        <td className="px-2 py-2 text-xs font-bold" style={{ color: 'var(--text-primary)' }}>Somme</td>
                        <td className="px-2 py-2 text-xs text-right font-bold" style={{ color: 'var(--success)' }}>{formatCurrency(ticketTotal)}</td>
                        <td className="px-2 py-2"></td>
                        <td className="px-2 py-2"></td>
                        <td className="px-2 py-2"></td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            </div>
          </div>

          {/* Right: Ticket form + loyalty */}
          <div className="lg:col-span-2 order-1 lg:order-2 space-y-4">
            {/* Ticket block */}
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
              <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>Nouveau Ticket</h3>

              {/* Checkboxes row */}
              <div className="flex flex-wrap gap-4 mb-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={isReduced} onChange={e => setIsReduced(e.target.checked)} className="w-4 h-4" style={{ accentColor: 'var(--primary)' }} />
                  <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Réduction</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={isReported} onChange={e => setIsReported(e.target.checked)} className="w-4 h-4" style={{ accentColor: 'var(--primary)' }} />
                  <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Ticket reporté</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={sameDestination} onChange={e => setSameDestination(e.target.checked)} className="w-4 h-4" style={{ accentColor: 'var(--primary)' }} />
                  <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Même destination</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={printTicket} onChange={e => setPrintTicket(e.target.checked)} className="w-4 h-4" style={{ accentColor: 'var(--primary)' }} />
                  <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Imprimer ticket</span>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Destination */}
                <div>
                  <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Destination</label>
                  <select
                    value={destination}
                    onChange={e => setDestination(e.target.value)}
                    className={fieldInput}
                    style={fieldStyle}
                    disabled={sameDestination && destination !== ''}
                  >
                    <option value="">Sélectionner...</option>
                    {stations
                      .filter(s => s.id !== depart.station_id)
                      .map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>

                {/* N° Siège */}
                <div>
                  <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>
                    N° Siège ({depart.seats_from}–{depart.seats_total})
                  </label>
                  <input
                    type="number"
                    min={depart.seats_from}
                    max={depart.seats_total}
                    value={seatNumber}
                    onChange={e => setSeatNumber(e.target.value)}
                    className={fieldInput}
                    style={{
                      ...fieldStyle,
                      borderColor: seatNumber && soldSeats.includes(parseInt(seatNumber)) ? 'var(--danger)' : 'var(--border)',
                    }}
                    placeholder="Ex: 1"
                    list="available-seats"
                  />
                  <datalist id="available-seats">
                    {Array.from({ length: depart.seats_total - depart.seats_from + 1 }, (_, i) => i + depart.seats_from)
                      .filter(n => !soldSeats.includes(n))
                      .slice(0, 50)
                      .map(n => <option key={n} value={n} />)}
                  </datalist>
                  {seatNumber && soldSeats.includes(parseInt(seatNumber)) && (
                    <p className="text-xs mt-1 flex items-center gap-1" style={{ color: 'var(--danger)' }}>
                      <X className="w-3 h-3" /> Siège déjà vendu
                    </p>
                  )}
                </div>

                {/* Tarif */}
                <div>
                  <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Tarif</label>
                  <div className="relative">
                    <input
                      type="number"
                      value={tarif || ''}
                      onChange={e => setTarif(parseInt(e.target.value) || 0)}
                      className={fieldInput}
                      style={fieldStyle}
                      placeholder="Auto"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'var(--text-muted)' }}>FCFA</span>
                  </div>
                  {isReduced && (
                    <p className="text-xs mt-1 flex items-center gap-1" style={{ color: 'var(--info)' }}>
                      <TrendingDown className="w-3 h-3" /> Réduction -10% appliquée
                    </p>
                  )}
                </div>

                {/* N° Ticket (auto, read-only) */}
                <div>
                  <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>N° Ticket (auto)</label>
                  <input
                    type="text"
                    value="Auto-généré"
                    disabled
                    className={fieldInput}
                    style={{ ...fieldStyle, opacity: 0.6 }}
                  />
                </div>
              </div>

              {/* Sell button */}
              <button
                onClick={handleSell}
                disabled={selling || !seatNumber || !destination || tarif <= 0}
                className="w-full mt-4 py-3.5 rounded-xl font-bold text-white text-base disabled:opacity-60 flex items-center justify-center gap-2 transition-opacity"
                style={{ backgroundColor: 'var(--primary)' }}
              >
                {selling ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                Vendre le ticket
              </button>
            </div>

            {/* Loyalty block */}
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <Users className="w-4 h-4" /> Fidélité
                </h3>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={loyaltyEnabled} onChange={e => { setLoyaltyEnabled(e.target.checked); if (!e.target.checked) setLoyaltyNewCard(false); }} className="w-4 h-4" style={{ accentColor: 'var(--primary)' }} />
                  <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Activer</span>
                </label>
              </div>

              {loyaltyEnabled && (
                <div className="space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={loyaltyNewCard} onChange={e => setLoyaltyNewCard(e.target.checked)} className="w-4 h-4" style={{ accentColor: 'var(--primary)' }} />
                    <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Nouvelle carte</span>
                  </label>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>N° Fidélité</label>
                      <input
                        type="text"
                        value={loyaltyCardNumber}
                        onChange={e => setLoyaltyCardNumber(e.target.value)}
                        className={fieldInput}
                        style={fieldStyle}
                        placeholder={loyaltyNewCard ? 'Auto-généré' : 'Ex: SBTA-00123'}
                        disabled={loyaltyNewCard}
                      />
                    </div>
                    <div>
                      <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Nbre voyages</label>
                      <input
                        type="number"
                        value={loyaltyTrips}
                        onChange={e => setLoyaltyTrips(parseInt(e.target.value) || 0)}
                        className={fieldInput}
                        style={fieldStyle}
                        disabled
                      />
                    </div>
                    <div>
                      <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Nom et prénoms</label>
                      <input
                        type="text"
                        value={loyaltyName}
                        onChange={e => setLoyaltyName(e.target.value)}
                        className={fieldInput}
                        style={fieldStyle}
                        placeholder="Nom du client"
                      />
                    </div>
                    <div>
                      <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Contact</label>
                      <input
                        type="tel"
                        value={loyaltyPhone}
                        onChange={e => setLoyaltyPhone(e.target.value)}
                        className={fieldInput}
                        style={fieldStyle}
                        placeholder="Téléphone"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => { setLoyaltyEnabled(false); setLoyaltyNewCard(false); setLoyaltyCardNumber(''); setLoyaltyName(''); setLoyaltyPhone(''); setLoyaltyTrips(0); }}
                      className="flex-1 py-2.5 rounded-lg text-sm font-bold border-2"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                    >
                      Annuler
                    </button>
                    <button
                      onClick={() => { setLoyaltyTrips(loyaltyNewCard ? 1 : loyaltyTrips + 1); setSuccess('Client fidélité validé'); setTimeout(() => setSuccess(''), 2000); }}
                      className="flex-1 py-2.5 rounded-lg text-sm font-bold text-white"
                      style={{ backgroundColor: 'var(--primary)' }}
                    >
                      {loyaltyNewCard ? 'Créer' : 'Valider'}
                    </button>
                    <button
                      onClick={() => console.log('[PrintService] Print loyalty card stub')}
                      className="px-3 py-2.5 rounded-lg text-sm font-bold border-2"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                    >
                      <Printer className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom counters — real-time */}
        <div className="grid grid-cols-3 gap-3 mt-4 sticky bottom-0 z-20">
          <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'var(--surface-raised)', border: '2px solid var(--border)' }}>
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <Armchair className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
              <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Total sièges</p>
            </div>
            <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{depart.seats_total}</p>
          </div>
          <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'var(--info-light)', border: '2px solid var(--info)' }}>
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <TicketIcon className="w-4 h-4" style={{ color: 'var(--info)' }} />
              <p className="text-xs font-bold" style={{ color: 'var(--info)' }}>Sièges vendus</p>
            </div>
            <p className="text-2xl font-bold" style={{ color: 'var(--info)' }}>{depart.seats_sold}</p>
          </div>
          <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'var(--success-light)', border: '2px solid var(--success)' }}>
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <Calendar className="w-4 h-4" style={{ color: 'var(--success)' }} />
              <p className="text-xs font-bold" style={{ color: 'var(--success)' }}>Sièges restants</p>
            </div>
            <p className="text-2xl font-bold" style={{ color: 'var(--success)' }}>{seatsRemaining}</p>
          </div>
        </div>
      </div>
    </POSLayout>
  );
}


export default POSVente