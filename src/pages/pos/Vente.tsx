import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import POSLayout from '@/components/pos/POSLayout';
import { usePOSSession } from '@/services/pos/POSSessionContext';
import { getDepartById } from '@/services/pos/departService';
import { syncDepartsAndTicketsFromServer } from '@/services/pos/offlineStore';
import {
  sellTicket, sellTickets, getTicketsForDepart, getSoldSeats,
  calculatePrice, getStations, generateTicketNumber, getTarifs, getRouteCityStops,
  type TicketRecord, type StationRef, type TarifRef, type RouteCityStopRef,
} from '@/services/pos/ticketService';
import { getLignes } from '@/services/pos/departService';
import type { LigneRef } from '@/services/pos/departService';
import { getSeatRangeForStation, isSeatAllowedForStation, getStationNameForSeat, seatsAllocatedForStation, seatsVendusForStation, seatsLibresForStation, getAvailableSeatsForTransfer, isSeatTransferredLocked, getTransferredSeatsForStation, getReceivedTransferSeatsForStation, transferSeatsBetweenStations } from '@/services/pos/departService';
import { PrintService } from '@/services/pos/printService';
import { registerBagage, getBagagesForDepart, type BagageRecord } from '@/services/pos/bagageService';
import { getDepensesForDepart, type DepenseRecord } from '@/services/pos/depenseService';
import { printBaggageTicket } from '@/utils/printBaggageTicket';
import { formatCurrency } from '@/utils/formatCurrency';
import type { DepartRecord } from '@/services/pos/departService';
import {
  AlertCircle, CheckCircle, Loader2, Plus, Printer, Lock, RotateCw,
  Ticket as TicketIcon, Users, Armchair, TrendingDown, Calendar,
  Package, Banknote, XCircle, ArrowRightLeft, Unlock, X,
} from 'lucide-react';
import ChangeRequestButton from '@/components/shared/ChangeRequestButton';
import { fetchScheduleSeatMap } from '@/services/seatMap.service';
import type { ScheduleSeatMap, EnrichedSeat as StructSeat } from '@/types/seatMap.types';

export default function POSVente() {
  const { id: departId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { session } = usePOSSession();

  const [depart, setDepart] = useState<DepartRecord | null>(null);
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [bagages, setBagages] = useState<BagageRecord[]>([]);
  const [depenses, setDepenses] = useState<DepenseRecord[]>([]);
  const [soldSeats, setSoldSeats] = useState<number[]>([]);
  const [stations, setStations] = useState<StationRef[]>([]);
  const [tarifs, setTarifs] = useState<TarifRef[]>([]);
  const [lignes, setLignes] = useState<LigneRef[]>([]);
  const [routeCityStops, setRouteCityStops] = useState<RouteCityStopRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Ticket form state
  const [destination, setDestination] = useState('');
  const [selectedSeats, setSelectedSeats] = useState<number[]>([]);
  const [seatDropdownOpen, setSeatDropdownOpen] = useState(false);
  const seatDropdownRef = useRef<HTMLDivElement>(null);
  const [tarif, setTarif] = useState(0);
  const [isReduced, setIsReduced] = useState(false);
  const [isReported, setIsReported] = useState(false);
  const [sameDestination, setSameDestination] = useState(false);
  const [printTicket, setPrintTicket] = useState(true);
  const [selling, setSelling] = useState(false);
  const [ticketPreview, setTicketPreview] = useState('');
  const [printError, setPrintError] = useState('');
  const [pendingReprint, setPendingReprint] = useState<TicketRecord[]>([]);
  const [printing, setPrinting] = useState(false);

  // Vente avec structure — shows the real bus seat layout
  const [structureMode, setStructureMode] = useState(false);
  const [seatMap, setSeatMap] = useState<ScheduleSeatMap | null>(null);
  const [seatMapLoading, setSeatMapLoading] = useState(false);
  const [seatMapError, setSeatMapError] = useState('');
  const [structSelectedSeats, setStructSelectedSeats] = useState<StructSeat[]>([]);

  // Loyalty state
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(false);
  const [loyaltyNewCard, setLoyaltyNewCard] = useState(false);
  const [loyaltyCardNumber, setLoyaltyCardNumber] = useState('');
  const [loyaltyName, setLoyaltyName] = useState('');
  const [loyaltyPhone, setLoyaltyPhone] = useState('');
  const [loyaltyTrips, setLoyaltyTrips] = useState(0);

  // Bagage form state
  type BagMode = 'avec' | 'sans' | null;
  const [bagMode, setBagMode] = useState<BagMode>(null);
  const [bagPrice, setBagPrice] = useState(0);
  const [bagDescription, setBagDescription] = useState('');
  const [bagOwnerName, setBagOwnerName] = useState('');
  const [bagOwnerPhone, setBagOwnerPhone] = useState('');
  const [bagSelling, setBagSelling] = useState(false);
  const [bagError, setBagError] = useState('');
  const [bagSuccess, setBagSuccess] = useState('');

  // Seat transfer state (between stations)
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferTargetStation, setTransferTargetStation] = useState('');
  const [transferSeatCount, setTransferSeatCount] = useState(1);
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState('');

  const loadData = useCallback(async () => {
    if (!departId) return;
    try {
      await syncDepartsAndTicketsFromServer(session?.station_id);
      const d = await getDepartById(departId);
      if (!d) {
        setError('Départ introuvable');
        setLoading(false);
        return;
      }
      if (session?.counter_id && d.counter_id && d.counter_id !== session.counter_id) {
        setError('Ce départ n\'est pas affecté à votre guichet.');
        setLoading(false);
        return;
      }
      setDepart(d);

      const [t, s, st, ta, li, bg, rcs, dp] = await Promise.all([
        getTicketsForDepart(departId),
        getSoldSeats(departId),
        getStations(),
        getTarifs(),
        getLignes(),
        getBagagesForDepart(departId),
        getRouteCityStops(),
        getDepensesForDepart(departId),
      ]);
      setTickets(t);
      setSoldSeats(s);
      setStations(st);
      setTarifs(ta);
      setLignes(li);
      setBagages(bg);
      setRouteCityStops(rcs);
      setDepenses(dp.filter(d => d.description !== '__deleted__'));
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }, [departId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Fetch seat map when structure mode is enabled
  useEffect(() => {
    if (!structureMode || !departId) { setSeatMap(null); setSeatMapError(''); return; }
    let cancelled = false;
    setSeatMapLoading(true);
    setSeatMapError('');
    fetchScheduleSeatMap(departId)
      .then(data => { if (!cancelled) setSeatMap(data); })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Erreur';
        if (msg === '__NO_BUS__') {
          setSeatMapError('Aucun bus assigné à ce départ — structure indisponible');
        } else {
          setSeatMapError(msg);
        }
        setSeatMap(null);
      })
      .finally(() => { if (!cancelled) setSeatMapLoading(false); });
    return () => { cancelled = true; };
  }, [structureMode, departId]);

  // Sync structure-selected seats → existing selectedSeats (number[])
  useEffect(() => {
    if (!structureMode) { setStructSelectedSeats([]); return; }
    if (!depart) return;
    const range = session?.station_id ? getSeatRangeForStation(depart, session.station_id) : null;
    const valid = structSelectedSeats.filter(s => {
      const n = parseInt(s.label, 10);
      if (Number.isNaN(n)) return false;
      if (n < depart.seats_from || n > depart.seats_total) return false;
      if (range && (n < range.from || n > range.to)) return false;
      if (soldSeats.includes(n)) return false;
      return true;
    });
    const nums = valid.map(s => parseInt(s.label, 10)).sort((a, b) => a - b);
    setSelectedSeats(nums);
  }, [structSelectedSeats, structureMode, depart, session?.station_id, soldSeats]);

  // Clear structure selection when structure mode is turned off
  useEffect(() => {
    if (!structureMode) setStructSelectedSeats([]);
  }, [structureMode]);

  const toggleStructSeat = (seat: StructSeat) => {
    const n = parseInt(seat.label, 10);
    if (Number.isNaN(n)) return;
    setStructSelectedSeats(prev =>
      prev.some(s => s.id === seat.id)
        ? prev.filter(s => s.id !== seat.id)
        : [...prev, seat]
    );
  };

  // Auto-select destination and compute tarif when depart/stations/lignes load
  useEffect(() => {
    if (!depart || stations.length === 0) return;
    const ligne = lignes.find(l => l.id === depart.route_id);
    let destStationId = '';
    if (ligne?.destination_station_id) {
      destStationId = ligne.destination_station_id;
    } else if (ligne?.origin_station_id && depart.station_id) {
      destStationId = ligne.origin_station_id === depart.station_id
        ? ligne.destination_station_id
        : ligne.origin_station_id;
    }
    if (!destStationId) {
      const routeCities = (depart.route_name ?? '')
        .split(/\s*[\-–——]\s*/)
        .map(p => p.trim().toLowerCase())
        .filter(Boolean);
      const guichetStation = stations.find(s => s.id === depart.station_id);
      const guichetCity = (guichetStation?.city ?? '').toLowerCase().trim();
      const destCityName = [...routeCities].reverse().find(c => c !== guichetCity);
      if (destCityName) {
        const match = stations.find(s =>
          (s.city ?? '').toLowerCase().trim() === destCityName ||
          (s.name ?? '').toLowerCase().includes(destCityName)
        );
        if (match) destStationId = match.id;
      }
    }
    if (destStationId && destStationId !== depart.station_id) {
      setDestination(destStationId);
    }
  }, [depart, stations, lignes]);

  // Intermediate city stops for the current route
  const currentRouteStops = useMemo(
    () => routeCityStops.filter(s => s.route_id === depart?.route_id).sort((a, b) => a.position - b.position),
    [routeCityStops, depart?.route_id]
  );

  // Auto-calculate tarif when destination changes
  // Destination can be a station ID (final destination) or `city:{id}` (intermediate city)
  useEffect(() => {
    if (!depart || !destination) { setTarif(0); return; }
    const ligne = lignes.find(l => l.id === depart.route_id);

    let basePrice = 0;
    if (destination.startsWith('city:')) {
      const cityId = destination.slice(5);
      const stop = currentRouteStops.find(s => s.city_id === cityId);
      basePrice = stop?.price ?? 0;
    } else {
      const tarifRef = tarifs.find(t => t.route_id === depart.route_id && t.station_id === destination);
      basePrice = tarifRef?.price ?? ligne?.base_price ?? 0;
    }

    setTarif(calculatePrice(basePrice, depart.is_ac, isReduced));
  }, [destination, depart, tarifs, lignes, currentRouteStops, isReduced]);

  // Preview ticket number
  useEffect(() => {
    if (!depart) return;
    setTicketPreview(generateTicketNumber());
  }, [depart, session, tickets.length]);

  // Reset bagage form when mode is cleared
  useEffect(() => {
    if (bagMode === null) {
      setBagPrice(0);
      setBagDescription('');
      setBagOwnerName('');
      setBagOwnerPhone('');
      setBagError('');
      setBagSuccess('');
    }
  }, [bagMode]);

  const allowedSeatRange = useMemo(() => {
    if (!depart || !session?.station_id) return null;
    return getSeatRangeForStation(depart, session.station_id);
  }, [depart, session?.station_id]);

  const lockedSeats = useMemo(() => {
    if (!depart || !session?.station_id) return [];
    return getTransferredSeatsForStation(depart, session.station_id);
  }, [depart, session?.station_id]);

  const receivedTransferSeats = useMemo(() => {
    if (!depart || !session?.station_id) return [];
    return getReceivedTransferSeatsForStation(depart, session.station_id);
  }, [depart, session?.station_id]);

  const sellableSeatNumbers = useMemo(() => {
    if (!depart) return [];
    const base: number[] = [];
    const from = allowedSeatRange?.from ?? depart.seats_from;
    const to = allowedSeatRange?.to ?? depart.seats_total;
    for (let n = from; n <= to; n++) base.push(n);
    for (const n of receivedTransferSeats) {
      if (!base.includes(n)) base.push(n);
    }
    return base.sort((a, b) => a - b);
  }, [depart, allowedSeatRange, receivedTransferSeats]);

  const seatsRemaining = useMemo(() => {
    if (!depart) return 0;
    if (allowedSeatRange && session?.station_id) {
      const libres = seatsLibresForStation(tickets, depart, session.station_id);
      return Math.max(0, libres - lockedSeats.length);
    }
    return depart.seats_total - depart.seats_sold;
  }, [depart, tickets, allowedSeatRange, session?.station_id, lockedSeats]);

  const stationSeatsAllocated = useMemo(() => {
    if (!depart || !session?.station_id) return depart?.seats_total ?? 0;
    return seatsAllocatedForStation(depart, session.station_id);
  }, [depart, session?.station_id]);

  const stationSeatsSold = useMemo(() => {
    if (!depart || !session?.station_id) return depart?.seats_sold ?? 0;
    return seatsVendusForStation(tickets, depart, session.station_id);
  }, [depart, tickets, session?.station_id]);

  const isSecondaryStation = depart && session?.station_id && depart.station_id !== session.station_id;

  const hasAllocations = !!(depart?.seat_allocations && depart.seat_allocations.length > 0);
  const stationRange = hasAllocations && session?.station_id ? getSeatRangeForStation(depart!, session.station_id) : null;

  const scopedTickets = useMemo(() => {
    if (!hasAllocations || !stationRange) return tickets;
    const received = receivedTransferSeats;
    return tickets.filter(t => {
      if (t.status === 'cancelled') return false;
      return (t.seat_number >= stationRange.from && t.seat_number <= stationRange.to) || received.includes(t.seat_number);
    });
  }, [tickets, hasAllocations, stationRange, receivedTransferSeats]);

  const scopedBagages = useMemo(() => {
    if (!hasAllocations) return bagages.filter(b => b.description !== '__deleted__');
    const scopedTicketIds = new Set(scopedTickets.map(t => t.id));
    return bagages.filter(b => {
      if (b.description === '__deleted__') return false;
      if (b.ticket_id && scopedTicketIds.has(b.ticket_id)) return true;
      if (b.ticket_id) return false;
      return session?.station_id === depart?.station_id;
    });
  }, [bagages, hasAllocations, scopedTickets, session?.station_id, depart?.station_id]);

  const ticketTotal = useMemo(() => scopedTickets.reduce((sum, t) => sum + t.price, 0), [scopedTickets]);
  const bagageTotal = useMemo(() => scopedBagages.reduce((sum, b) => sum + b.price, 0), [scopedBagages]);
  const depenseTotal = useMemo(() => depenses.reduce((sum, d) => sum + d.amount, 0), [depenses]);
  const solde = useMemo(() => ticketTotal + bagageTotal - depenseTotal, [ticketTotal, bagageTotal, depenseTotal]);

  // Destination name for display
  const destStationName = useMemo(() => {
    if (destination.startsWith('city:')) {
      const cityId = destination.slice(5);
      const stop = currentRouteStops.find(s => s.city_id === cityId);
      return stop?.city_name ?? '';
    }
    const s = stations.find(st => st.id === destination);
    return (s?.city || s?.name) ?? depart?.route_name ?? '';
  }, [stations, destination, depart, currentRouteStops]);

  // Derived single seat string for baggage compatibility
  const seatNumber = selectedSeats.length > 0 ? String(selectedSeats[0]) : '';

  // Close seat dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (seatDropdownRef.current && !seatDropdownRef.current.contains(e.target as Node)) {
        setSeatDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggleSeat = (n: number) => {
    setSelectedSeats(prev =>
      prev.includes(n) ? prev.filter(s => s !== n) : [...prev, n].sort((a, b) => a - b)
    );
  };

  const handleSell = async () => {
    if (!depart || !departId) return;
    if (depart.cancelled) { setError('Ce départ est annulé — vente impossible'); return; }
    if (depart.cloture) { setError('Ce départ est clôturé — vente impossible'); return; }
    if (depart.status === 'panne') { setError('Ce départ est en panne — vente impossible'); return; }
    setError(''); setSuccess('');
    if (selectedSeats.length === 0) { setError('Veuillez sélectionner au moins un siège'); return; }
    for (const seat of selectedSeats) {
      if (seat < depart.seats_from || seat > depart.seats_total) {
        setError(`Le siège n°${seat} est hors de la plage autorisée (${depart.seats_from}–${depart.seats_total})`); return;
      }
      if (allowedSeatRange && (seat < allowedSeatRange.from || seat > allowedSeatRange.to) && !receivedTransferSeats.includes(seat)) {
        const ownerStation = getStationNameForSeat(depart, seat);
        setError(ownerStation && ownerStation !== session?.station_name
          ? `Le siège n°${seat} est réservé à la gare de ${ownerStation}.`
          : `Siège n°${seat} indisponible : attribué à une autre gare.`);
        return;
      }
      if (soldSeats.includes(seat)) { setError(`Le siège n°${seat} est déjà vendu`); return; }
      if (depart && session?.station_id && isSeatTransferredLocked(depart, session.station_id, seat)) {
        setError(`Le siège n°${seat} a été transféré à une autre gare — verrouillé`); return;
      }
    }
    if (!destination) { setError('Veuillez sélectionner une destination'); return; }
    if (tarif <= 0) { setError('Tarif invalide — vérifiez la destination'); return; }

    setSelling(true);
    try {
      let destName = '';
      let destId = destination;
      if (destination.startsWith('city:')) {
        const cityId = destination.slice(5);
        const stop = currentRouteStops.find(s => s.city_id === cityId);
        destName = stop?.city_name ?? '';
        destId = cityId;
      } else {
        const station = stations.find(s => s.id === destination);
        destName = (station?.city || station?.name) ?? destination;
      }

      const soldTickets = await sellTickets(selectedSeats, {
        departId,
        destination: destName,
        destinationId: destId,
        price: tarif, originalPrice: tarif,
        isReduced, isReported, isAc: depart.is_ac, printTicket,
        loyaltyCardNumber: loyaltyEnabled ? loyaltyCardNumber : undefined,
        loyaltyName: loyaltyEnabled ? loyaltyName : undefined,
        stationAgencyCode: session?.station_name,
      });

      const [t, s] = await Promise.all([getTicketsForDepart(departId), getSoldSeats(departId)]);
      setTickets(t); setSoldSeats(s);
      const updatedDepart = await getDepartById(departId);
      if (updatedDepart) setDepart(updatedDepart);

      const seatsLabel = soldTickets.map(tk => tk.seat_number).join(', ');
      setSuccess(soldTickets.length === 1
        ? `Siège ${seatsLabel} vendu — Ticket ${soldTickets[0].ticket_number}`
        : `${soldTickets.length} tickets vendus — Sièges : ${seatsLabel}`);
      setSelectedSeats([]); setIsReduced(false); setIsReported(false);
      if (!sameDestination) { setDestination(''); setTarif(0); }
      setLoyaltyEnabled(false); setLoyaltyNewCard(false);
      setLoyaltyCardNumber(''); setLoyaltyName(''); setLoyaltyPhone(''); setLoyaltyTrips(0);
      setTimeout(() => setSuccess(''), 4000);

      if (printTicket) {
        await printTicketsSequentially(soldTickets, depart, session?.station_name);
      }
    } catch (err: any) {
      setError(err?.message ?? 'Erreur lors de la vente');
    } finally {
      setSelling(false);
    }
  };

  const printTicketsSequentially = async (ticketsToPrint: TicketRecord[], dep: DepartRecord, stName?: string) => {
    setPrinting(true);
    setPrintError('');
    const failed: TicketRecord[] = [];
    for (const ticket of ticketsToPrint) {
      try {
        const ok = await PrintService.printTicket({ ticket, depart: dep, stationName: stName });
        if (!ok) { failed.push(ticket); }
      } catch {
        failed.push(ticket);
      }
    }
    setPrinting(false);
    if (failed.length > 0) {
      setPendingReprint(failed);
      setPrintError(`${failed.length} ticket(s) non imprimé(s) — cliquez sur « Reprendre l'impression » pour réessayer.`);
    }
  };

  const handleReprintResume = async () => {
    if (pendingReprint.length === 0 || !depart) return;
    setPrintError('');
    await printTicketsSequentially(pendingReprint, depart, session?.station_name);
  };

  const handlePrintTicket = (ticket: TicketRecord) => {
    if (depart) PrintService.printTicket({ ticket, depart, stationName: session?.station_name });
  };
  void handlePrintTicket;

  const handleTransferSeats = async () => {
    if (!depart || !departId || !session?.station_id) return;
    setTransferError('');
    if (!transferTargetStation) { setTransferError('Veuillez sélectionner une gare destinataire'); return; }
    if (transferSeatCount <= 0) { setTransferError('Veuillez saisir un nombre de sièges valide'); return; }
    setTransferring(true);
    try {
      await transferSeatsBetweenStations({
        departId,
        fromStationId: session.station_id,
        toStationId: transferTargetStation,
        seatCount: transferSeatCount,
        transferredBy: session?.full_name,
      });
      const updatedDepart = await getDepartById(departId);
      if (updatedDepart) setDepart(updatedDepart);
      const targetName = depart.seat_allocations?.find(a => a.station_id === transferTargetStation)?.station_name ?? 'gare destinataire';
      setSuccess(`${transferSeatCount} siège(s) transféré(s) vers ${targetName} — disponibles à la vente`);
      setShowTransferModal(false);
      setTransferTargetStation('');
      setTransferSeatCount(1);
      setTimeout(() => setSuccess(''), 5000);
    } catch (err: any) {
      setTransferError(err?.message ?? 'Erreur lors du transfert');
    } finally {
      setTransferring(false);
    }
  };

  const handleSellBagage = async () => {
    if (!depart || !departId || !bagMode) return;
    if (depart.cancelled) { setBagError('Ce départ est annulé — opération impossible'); return; }
    if (depart.cloture) { setBagError('Ce départ est clôturé — opération impossible'); return; }
    if (depart.status === 'panne') { setBagError('Ce départ est en panne — opération impossible'); return; }
    setBagError(''); setBagSuccess('');

    if (bagPrice <= 0) { setBagError('Veuillez saisir un prix de bagage valide'); return; }
    if (bagMode === 'avec' && !seatNumber) {
      setBagError('Veuillez sélectionner un siège dans le formulaire de ticket ci-dessus'); return;
    }
    if (bagMode === 'sans') {
      if (!bagOwnerName.trim()) { setBagError('Veuillez saisir le nom du propriétaire'); return; }
      if (!bagOwnerPhone.trim()) { setBagError('Veuillez saisir le contact du propriétaire'); return; }
    }

    setBagSelling(true);
    try {
      const resolvedSeat = bagMode === 'avec' ? seatNumber : '';

      const bagage = await registerBagage({
        departId,
        withTicket: bagMode === 'avec',
        withTicketReport: false,
        ticketNumber: bagMode === 'avec' ? ticketPreview : undefined,
        price: bagPrice,
        destination: destStationName,
        description: bagDescription,
        ownerName: bagOwnerName || 'N/A',
        ownerPhone: bagOwnerPhone || '',
        printBagage: true,
      });

      // Reload bagages + depart totals
      const [bg, updatedDepart] = await Promise.all([
        getBagagesForDepart(departId),
        getDepartById(departId),
      ]);
      setBagages(bg);
      if (updatedDepart) setDepart(updatedDepart);

      // Print bagage ticket
      printBaggageTicket({
        baggage_number: bagage.bagage_number,
        destination: bagage.destination,
        price: bagage.price,
        seat_number: resolvedSeat || null,
        departure_number: depart.route_number,
        bus_registration: bagage.car_plate || depart.bus_plate || null,
        description: bagage.description,
        owner_name: bagage.owner_name,
        owner_phone: bagage.owner_phone,
        station_name: session?.station_name ?? 'Gare SBTA',
        mode_label: bagMode === 'avec' ? 'Avec Ticket' : 'Sans Ticket',
      });

      setBagSuccess(`Bagage enregistré — N° ${bagage.bagage_number}`);
      setBagPrice(0); setBagDescription('');
      setBagOwnerName(''); setBagOwnerPhone('');
      setTimeout(() => setBagSuccess(''), 4000);
    } catch (err: any) {
      setBagError(err?.message ?? 'Erreur lors de l\'enregistrement du bagage');
    } finally {
      setBagSelling(false);
    }
  };

  const fieldLabel = 'block text-xs font-bold mb-1';
  const fieldInput = 'w-full px-3 py-2.5 rounded-lg border-2 text-sm outline-none transition-colors';
  const fieldStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)' as const };

  if (loading) {
    return (
      <POSLayout showBack backTo="/guichet/departs" stationName={session?.station_name} activeRoute="Vente de tickets">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--primary)' }} />
        </div>
      </POSLayout>
    );
  }

  if (!depart) {
    return (
      <POSLayout showBack backTo="/guichet/departs" stationName={session?.station_name} activeRoute="Vente de tickets">
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
    <POSLayout showBack backTo="/guichet/departs" stationName={session?.station_name} activeRoute={`Vente — Départ #${depart.route_number} (${depart.route_name ?? ''})`}>
      <div className="max-w-5xl mx-auto">
        {/* Status warning banners */}
        {depart.cancelled && (
          <div className="rounded-xl px-3 py-2.5 mb-4 flex items-center gap-2 text-sm font-bold" style={{ backgroundColor: 'var(--danger-light)', color: 'var(--danger)' }}>
            <XCircle className="w-4 h-4" /> Ce départ est annulé — vente verrouillée
          </div>
        )}
        {!depart.cancelled && depart.cloture && (
          <div className="rounded-xl px-3 py-2.5 mb-4 flex items-center gap-2 text-sm font-bold" style={{ backgroundColor: 'var(--danger-light)', color: 'var(--danger)' }}>
            <Lock className="w-4 h-4" /> Ce départ est clôturé — vente verrouillée
          </div>
        )}
        {!depart.cancelled && !depart.cloture && depart.status === 'panne' && (
          <div className="rounded-xl px-3 py-2.5 mb-4 flex items-center gap-2 text-sm font-bold" style={{ backgroundColor: 'var(--warning-light)', color: 'var(--warning)' }}>
            <AlertCircle className="w-4 h-4" /> Ce départ est en panne — vente verrouillée
          </div>
        )}

        {/* Secondary station seat allocation banner */}
        {isSecondaryStation && allowedSeatRange && (
          <div className="rounded-xl px-3 py-2.5 mb-4 flex items-center gap-2 text-sm" style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)', border: '1px solid var(--primary)' }}>
            <Armchair className="w-4 h-4 flex-shrink-0" />
            <span>
              Vous êtes autorisé à vendre uniquement les sièges n°{allowedSeatRange.from} à n°{allowedSeatRange.to}.
            </span>
          </div>
        )}

        {/* Seat allocation recap table */}
        {depart.seat_allocations && depart.seat_allocations.length > 0 && (
          <div className="rounded-xl p-3 mb-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <p className="font-bold flex items-center gap-2" style={{ color: 'var(--text-secondary)', fontSize: '24px', lineHeight: 1.2 }}>
                <Armchair className="w-6 h-6" /> Répartition des sièges par gare
              </p>
              {session?.station_id && (() => {
                const myFreeSeats = getAvailableSeatsForTransfer(depart, tickets, session.station_id);
                const otherStations = depart.seat_allocations!.filter(a => a.station_id !== session.station_id);
                return otherStations.length > 0 && myFreeSeats.length > 0 && !depart.cloture && !depart.cancelled ? (
                  <button
                    onClick={() => { setTransferError(''); setShowTransferModal(true); }}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold transition-colors"
                    style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)', border: '1px solid var(--primary)' }}
                  >
                    <ArrowRightLeft className="w-4 h-4" /> Charger dans une autre gare
                  </button>
                ) : null;
              })()}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)' }}>
                    <th className="px-2 py-2 text-sm font-bold text-left">Gare</th>
                    <th className="px-2 py-2 text-sm font-bold text-center">Attribués</th>
                    <th className="px-2 py-2 text-sm font-bold text-center">Vendus</th>
                    <th className="px-2 py-2 text-sm font-bold text-center">Libres</th>
                    <th className="px-2 py-2 text-sm font-bold text-center">Transférés</th>
                  </tr>
                </thead>
                <tbody>
                  {depart.seat_allocations.map((a, i) => {
                    const sold = seatsVendusForStation(tickets, depart, a.station_id);
                    const allocated = a.seat_to - a.seat_from + 1;
                    const libres = allocated - sold;
                    const transferredOut = getTransferredSeatsForStation(depart, a.station_id).length;
                    const receivedTransfers = (depart.seat_transfers ?? []).filter(tr => tr.to_station_id === a.station_id).reduce((sum, tr) => sum + (tr.seats?.length ?? (tr.seat_to - tr.seat_from + 1)), 0);
                    return (
                      <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                        <td className="px-2 py-2 text-sm font-bold" style={{ color: a.station_id === session?.station_id ? 'var(--primary)' : 'var(--text-primary)' }}>
                          {a.station_name}{a.station_id === session?.station_id ? ' (vous)' : ''}
                        </td>
                        <td className="px-2 py-2 text-sm text-center font-bold" style={{ color: 'var(--text-secondary)' }}>{a.seat_from}–{a.seat_to}</td>
                        <td className="px-2 py-2 text-sm text-center font-bold" style={{ color: 'var(--danger)' }}>{sold}</td>
                        <td className="px-2 py-2 text-sm text-center font-bold" style={{ color: libres > 0 ? 'var(--success)' : 'var(--text-muted)' }}>{libres}</td>
                        <td className="px-2 py-2 text-sm text-center font-bold" style={{ color: 'var(--warning)' }}>
                          {transferredOut > 0 ? `−${transferredOut}` : receivedTransfers > 0 ? `+${receivedTransfers}` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {depart.seat_transfers && depart.seat_transfers.length > 0 && (
              <div className="mt-2 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
                <p className="text-xs font-bold flex items-center gap-1.5 mb-1" style={{ color: 'var(--text-muted)' }}>
                  <Unlock className="w-3.5 h-3.5" /> Historique des transferts
                </p>
                {depart.seat_transfers.map((tr, i) => {
                  const fromName = depart.seat_allocations?.find(a => a.station_id === tr.from_station_id)?.station_name ?? tr.from_station_id;
                  const toName = depart.seat_allocations?.find(a => a.station_id === tr.to_station_id)?.station_name ?? tr.to_station_id;
                  return (
                    <p key={i} className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {fromName} → {toName} : sièges {tr.seat_from}–{tr.seat_to} ({tr.seats?.length ?? (tr.seat_to - tr.seat_from + 1)} siège(s))
                    </p>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Seat transfer modal */}
        {showTransferModal && depart && session?.station_id && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => !transferring && setShowTransferModal(false)}>
            <div className="rounded-2xl p-5 w-full max-w-md" style={{ backgroundColor: 'var(--surface)', border: '2px solid var(--primary)' }} onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <ArrowRightLeft className="w-5 h-5" style={{ color: 'var(--primary)' }} /> Transfert de sièges
                </h3>
                <button onClick={() => !transferring && setShowTransferModal(false)} disabled={transferring} className="p-1 rounded-lg" style={{ color: 'var(--text-muted)' }}>
                  <X className="w-5 h-5" />
                </button>
              </div>
              {transferError && (
                <div className="rounded-lg px-3 py-2 mb-3 flex items-start gap-2 text-xs" style={{ backgroundColor: 'var(--danger-light)', color: 'var(--danger)' }}>
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /><span>{transferError}</span>
                </div>
              )}
              <div className="space-y-3">
                <div>
                  <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Gare source</label>
                  <input
                    type="text"
                    disabled
                    value={session.station_name ?? 'Votre gare'}
                    className={fieldInput}
                    style={{ ...fieldStyle, opacity: 0.6 }}
                  />
                </div>
                <div>
                  <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Gare destinataire</label>
                  <select
                    value={transferTargetStation}
                    onChange={e => setTransferTargetStation(e.target.value)}
                    disabled={transferring}
                    className={fieldInput}
                    style={fieldStyle}
                  >
                    <option value="">— Sélectionner —</option>
                    {depart.seat_allocations!.filter(a => a.station_id !== session.station_id).map(a => (
                      <option key={a.station_id} value={a.station_id}>{a.station_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>
                    Nombre de sièges à transférer
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={getAvailableSeatsForTransfer(depart, tickets, session.station_id).length}
                    value={transferSeatCount || ''}
                    onChange={e => setTransferSeatCount(parseInt(e.target.value) || 0)}
                    disabled={transferring}
                    className={fieldInput}
                    style={fieldStyle}
                  />
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    {getAvailableSeatsForTransfer(depart, tickets, session.station_id).length} siège(s) libre(s) disponible(s) au transfert
                  </p>
                </div>
                <div className="rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: 'var(--warning-light)', color: 'var(--warning)' }}>
                  Les sièges transférés seront <strong>verrouillés</strong> dans votre gare et <strong>disponibles à la vente</strong> dans la gare destinataire.
                </div>
              </div>
              <button
                onClick={handleTransferSeats}
                disabled={transferring || !transferTargetStation || transferSeatCount <= 0}
                className="w-full mt-4 py-3 rounded-xl font-bold text-white text-sm disabled:opacity-60 flex items-center justify-center gap-2"
                style={{ backgroundColor: 'var(--primary)' }}
              >
                {transferring ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />}
                {transferring ? 'Transfert en cours…' : 'Confirmer le transfert'}
              </button>
            </div>
          </div>
        )}

        {/* Departure header */}
        <div className="rounded-xl p-4 mb-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
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
              <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>#{depart.route_number}</p>
            </div>
            <div>
              <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Tarif Climatisé</p>
              <p className="text-sm font-bold" style={{ color: depart.is_ac ? 'var(--info)' : 'var(--text-muted)' }}>{depart.is_ac ? 'Oui (+10%)' : 'Non'}</p>
            </div>
            <div>
              <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Ligne</p>
              <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{depart.route_name}</p>
            </div>
            <div>
              <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Statut</p>
              <p className="text-sm font-bold" style={{ color: depart.cancelled ? 'var(--danger)' : depart.cloture ? 'var(--danger)' : depart.status === 'panne' ? 'var(--warning)' : depart.status === 'convoi' ? 'var(--info)' : depart.status === 'retard' ? 'var(--warning)' : depart.confirmed ? 'var(--success)' : 'var(--text-muted)' }}>
                {depart.cancelled ? 'Annulé' : depart.cloture ? 'Clôturé' : depart.status === 'panne' ? 'Panne' : depart.status === 'convoi' ? 'Convoi' : depart.status === 'retard' ? 'Retard' : depart.confirmed ? 'Confirmé' : 'En attente'}
              </p>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-xl px-3 py-2.5 mb-4 flex items-start gap-2 text-sm" style={{ backgroundColor: 'var(--danger-light)', color: 'var(--danger)' }}>
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /><span>{error}</span>
          </div>
        )}
        {success && (
          <div className="rounded-xl px-3 py-2.5 mb-4 flex items-center gap-2 text-sm font-medium" style={{ backgroundColor: 'var(--success-light)', color: 'var(--success)' }}>
            <CheckCircle className="w-4 h-4" /> {success}
          </div>
        )}
        {printError && (
          <div className="rounded-xl px-3 py-2.5 mb-4 flex items-center justify-between gap-3 text-sm" style={{ backgroundColor: 'var(--warning-light)', color: 'var(--warning)' }}>
            <div className="flex items-start gap-2 flex-1">
              <Printer className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{printError}</span>
            </div>
            <button
              onClick={handleReprintResume}
              disabled={printing || pendingReprint.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap disabled:opacity-50"
              style={{ backgroundColor: 'var(--warning)', color: 'white' }}
            >
              {printing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
              Reprendre l'impression
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left: Ticket + Bagage list */}
          <div className="lg:col-span-1 order-2 lg:order-1">
            <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="px-3 py-2.5" style={{ backgroundColor: 'var(--surface-raised)' }}>
                <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <TicketIcon className="w-4 h-4" /> Tickets / Bagages
                </h3>
              </div>
              <div className="max-h-96 overflow-y-auto">
                {scopedTickets.length === 0 ? (
                  <p className="text-center text-xs py-8" style={{ color: 'var(--text-muted)' }}>Aucun ticket vendu</p>
                ) : (
                  <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ color: 'var(--text-muted)' }}>
                        <th className="px-2 py-1.5 text-xs font-bold text-left">Destination</th>
                        <th className="px-2 py-1.5 text-xs font-bold text-right">Tarif</th>
                        <th className="px-2 py-1.5 text-xs font-bold text-center">N°Siège</th>
                        <th className="px-2 py-1.5 text-xs font-bold text-center">Report</th>
                        <th className="px-2 py-1.5 text-xs font-bold text-right">Date</th>
                        <th className="px-2 py-1.5 text-xs font-bold text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scopedTickets.map(t => (
                        <tr key={t.id} style={{ borderTop: '1px solid var(--border)' }}>
                          <td className="px-2 py-2 text-xs" style={{ color: 'var(--text-primary)' }}>{t.destination}</td>
                          <td className="px-2 py-2 text-xs text-right" style={{ color: 'var(--text-primary)' }}>{formatCurrency(t.price)}</td>
                          <td className="px-2 py-2 text-xs text-center" style={{ fontWeight: 700, color: 'var(--info)' }}>{t.seat_number}</td>
                          <td className="px-2 py-2 text-xs text-center">{t.is_reported ? 'R' : ''}</td>
                          <td className="px-2 py-2 text-xs text-right" style={{ color: 'var(--text-muted)' }}>{t.created_at.slice(5, 10)}</td>
                          <td className="px-2 py-2 text-center">
                            <ChangeRequestButton
                              compact
                              operationType="ticket_sale"
                              operationId={t.id}
                              operationTable="tickets"
                              operationReference={`Ticket ${t.ticket_number ?? ''} — Siège ${t.seat_number}`}
                              operationSnapshot={t as unknown as Record<string, unknown>}
                              stationId={session?.station_id}
                              stationName={session?.station_name}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '2px solid var(--border)' }}>
                        <td className="px-2 py-2 text-xs font-bold" style={{ color: 'var(--text-primary)' }}>Somme tickets</td>
                        <td className="px-2 py-2 text-xs text-right font-bold" style={{ color: 'var(--success)' }}>{formatCurrency(ticketTotal)}</td>
                        <td colSpan={4} className="px-2 py-2"></td>
                      </tr>
                    </tfoot>
                  </table>
                )}
                {/* Bagages summary */}
                {scopedBagages.length > 0 && (
                  <>
                    <div className="px-3 py-1.5" style={{ backgroundColor: 'var(--surface-raised)', borderTop: '1px solid var(--border)' }}>
                      <p className="text-xs font-bold flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
                        <Package className="w-3 h-3" /> Bagages ({scopedBagages.length})
                      </p>
                    </div>
                    <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                      <tbody>
                        {scopedBagages.map(b => (
                          <tr key={b.id} style={{ borderTop: '1px solid var(--border)' }}>
                            <td className="px-2 py-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                              <span className="font-bold" style={{ color: b.with_ticket ? 'var(--info)' : 'var(--warning)' }}>
                                {b.with_ticket ? 'Avec ticket' : 'Sans ticket'}
                              </span>
                              {b.ticket_number && <span className="ml-1 text-xs" style={{ color: 'var(--text-muted)' }}>#{b.ticket_number}</span>}
                            </td>
                            <td className="px-2 py-1.5 text-xs text-right font-bold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(b.price)}</td>
                            <td className="px-2 py-1.5 text-center">
                              <ChangeRequestButton
                                compact
                                operationType="baggage"
                                operationId={b.id}
                                operationTable="bagage_tickets"
                                operationReference={`Bagage ${b.bagage_number ?? ''}`}
                                operationSnapshot={b as unknown as Record<string, unknown>}
                                stationId={session?.station_id}
                                stationName={session?.station_name}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ borderTop: '2px solid var(--border)' }}>
                          <td className="px-2 py-2 text-xs font-bold" style={{ color: 'var(--text-primary)' }}>Somme bagages</td>
                          <td className="px-2 py-2 text-xs text-right font-bold" style={{ color: 'var(--warning)' }}>{formatCurrency(bagageTotal)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Right: Ticket form + Bagage + Loyalty */}
          <div className="lg:col-span-2 order-1 lg:order-2 space-y-4">
            {/* ── Ticket block ── */}
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Nouveau Ticket</h3>
                <label className="flex items-center gap-2 cursor-pointer px-3 py-1.5 rounded-lg" style={{ backgroundColor: structureMode ? 'var(--primary-light)' : 'var(--surface-raised)', border: '1px solid', borderColor: structureMode ? 'var(--primary)' : 'var(--border)' }}>
                  <input type="checkbox" checked={structureMode} onChange={e => { setStructureMode(e.target.checked); if (!e.target.checked) { setStructSelectedSeats([]); setSelectedSeats([]); } }} className="w-4 h-4" style={{ accentColor: 'var(--primary)' }} />
                  <span className="text-xs font-bold flex items-center gap-1" style={{ color: structureMode ? 'var(--primary)' : 'var(--text-secondary)' }}>
                    <Armchair className="w-3.5 h-3.5" /> Vente avec structure
                  </span>
                </label>
              </div>
              <div className="flex flex-wrap gap-4 mb-3">
                <label className="flex items-center gap-2 cursor-not-allowed opacity-60">
                  <input type="checkbox" checked={isReduced} onChange={e => setIsReduced(e.target.checked)} disabled className="w-4 h-4" style={{ accentColor: 'var(--primary)' }} />
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

              {/* ── Structure du bus (affichée si Vente avec structure est activé) ── */}
              {structureMode && (
                <div className="mb-4">
                  {seatMapLoading ? (
                    <div className="flex items-center justify-center py-12 rounded-xl" style={{ backgroundColor: 'var(--surface-raised)', border: '1px solid var(--border)' }}>
                      <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--primary)' }} />
                      <span className="ml-2 text-sm" style={{ color: 'var(--text-secondary)' }}>Chargement de la structure du bus…</span>
                    </div>
                  ) : seatMapError ? (
                    <div className="rounded-xl px-3 py-3 flex items-center gap-2 text-sm" style={{ backgroundColor: 'var(--danger-light)', color: 'var(--danger)', border: '1px solid var(--danger)' }}>
                      <AlertCircle className="w-4 h-4 flex-shrink-0" /> {seatMapError}
                    </div>
                  ) : seatMap ? (
                    <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface-raised)', border: '1px solid var(--border)' }}>
                      <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
                        <div className="flex items-center gap-2">
                          <Armchair className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                          <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Structure — {seatMap.bus_registration}</span>
                        </div>
                        <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>{seatMap.available_count} libres / {seatMap.total_seats}</span>
                      </div>
                      <div className="p-3 sm:p-4 overflow-x-auto max-h-[340px] overflow-y-auto">
                        <div className="flex flex-col gap-1.5">
                          {seatMap.enriched_layout.filter(r => r.seats.some(s => s.side !== 'back')).map((row) => {
                            const leftSeats = row.seats.filter(s => s.side === 'left');
                            const rightSeats = row.seats.filter(s => s.side === 'right');
                            const renderSeat = (seat: StructSeat) => {
                              const n = parseInt(seat.label, 10);
                              const isSelected = structSelectedSeats.some(s => s.id === seat.id);
                              const isSold = !Number.isNaN(n) && soldSeats.includes(n);
                              const isOutAllowed = allowedSeatRange && !Number.isNaN(n) && (n < allowedSeatRange.from || n > allowedSeatRange.to) && !receivedTransferSeats.includes(n);
                              const disabledSeat = isSold || isOutAllowed || seat.status === 'occupied' || seat.status === 'out_of_service' || seat.status === 'online_reserved' || seat.status === 'boarding' || seat.status === 'locked';
                              const seatColor = isSelected
                                ? 'bg-[#0B7439] border-[#085c2d] text-white'
                                : isSold || seat.status === 'occupied'
                                  ? 'bg-red-500 border-red-600 text-white cursor-not-allowed'
                                  : seat.status === 'online_reserved'
                                    ? 'bg-[#FCD34D] border-[#D97706] text-[#78350F] cursor-not-allowed'
                                    : isOutAllowed
                                      ? 'bg-slate-100 border-slate-200 text-slate-300 cursor-not-allowed'
                                      : seat.type === 'vip'
                                        ? 'bg-[#FFFBEB] border-[#FCD34D] text-[#92400E] hover:bg-amber-100 cursor-pointer'
                                        : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-[#0B7439] hover:text-[#0B7439] cursor-pointer';
                              return (
                                <button
                                  key={seat.id}
                                  type="button"
                                  disabled={disabledSeat}
                                  onClick={() => !disabledSeat && toggleStructSeat(seat)}
                                  title={`Siège ${seat.label}${isSold ? ' — Vendu' : isOutAllowed ? ' — Autre gare' : ''}`}
                                  className={`flex flex-col items-center justify-center rounded-lg border-2 select-none transition-all w-[34px] h-[36px] flex-shrink-0 ${seatColor}`}
                                >
                                  <span className="text-[11px] font-bold leading-none">{seat.label}</span>
                                </button>
                              );
                            };
                            const leftCols = seatMap.config.columns_left ?? 2;
                            const rightCols = seatMap.config.columns_right ?? 2;
                            const leftW = leftCols * 34 + Math.max(0, leftCols - 1) * 6;
                            return (
                              <div key={`row-${row.row}`} className="flex items-center gap-2">
                                <span className="text-[10px] text-slate-400 font-medium text-right flex-shrink-0" style={{ width: 18 }}>{row.row}</span>
                                <div className="flex items-center gap-[6px]" style={{ width: leftW }}>
                                  {leftSeats.map(renderSeat)}
                                  {leftSeats.length < leftCols && Array.from({ length: leftCols - leftSeats.length }).map((_, i) => <div key={`el-${i}`} className="flex-shrink-0" style={{ width: 34, height: 36 }} />)}
                                </div>
                                <div className="flex items-center justify-center flex-shrink-0" style={{ width: 20 }}><div className="w-px h-6 bg-slate-200" /></div>
                                <div className="flex items-center gap-[6px]">
                                  {rightSeats.map(renderSeat)}
                                  {rightSeats.length < rightCols && Array.from({ length: rightCols - rightSeats.length }).map((_, i) => <div key={`er-${i}`} className="flex-shrink-0" style={{ width: 34, height: 36 }} />)}
                                </div>
                              </div>
                            );
                          })}
                          {seatMap.enriched_layout.some(r => r.seats.every(s => s.side === 'back')) && (
                            <>
                              <div className="flex items-center gap-2 my-0.5"><div className="flex-1 border-t border-dashed border-slate-200" /></div>
                              {seatMap.enriched_layout.filter(r => r.seats.every(s => s.side === 'back')).map((row) => (
                                <div key={`back-${row.row}`} className="flex items-center gap-2">
                                  <span className="text-[10px] text-slate-400 flex-shrink-0" style={{ width: 18 }}>—</span>
                                  <div className="flex gap-[6px]">
                                    {row.seats.filter(s => s.side === 'back').map(seat => {
                                      const n = parseInt(seat.label, 10);
                                      const isSelected = structSelectedSeats.some(s => s.id === seat.id);
                                      const isSold = !Number.isNaN(n) && soldSeats.includes(n);
                                      const isOutAllowed = allowedSeatRange && !Number.isNaN(n) && (n < allowedSeatRange.from || n > allowedSeatRange.to) && !receivedTransferSeats.includes(n);
                                      const disabledSeat = isSold || isOutAllowed || seat.status === 'occupied' || seat.status === 'out_of_service' || seat.status === 'online_reserved' || seat.status === 'boarding' || seat.status === 'locked';
                                      const seatColor = isSelected ? 'bg-[#0B7439] border-[#085c2d] text-white' : isSold ? 'bg-red-500 border-red-600 text-white cursor-not-allowed' : isOutAllowed ? 'bg-slate-100 border-slate-200 text-slate-300 cursor-not-allowed' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-[#0B7439] hover:text-[#0B7439] cursor-pointer';
                                      return (
                                        <button key={seat.id} type="button" disabled={disabledSeat} onClick={() => !disabledSeat && toggleStructSeat(seat)} title={`Siège ${seat.label}`} className={`flex flex-col items-center justify-center rounded-lg border-2 select-none transition-all w-[34px] h-[36px] flex-shrink-0 ${seatColor}`}>
                                          <span className="text-[11px] font-bold leading-none">{seat.label}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </>
                          )}
                        </div>
                      </div>
                      {selectedSeats.length > 0 && (
                        <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderTop: '1px solid var(--border)' }}>
                          <span className="text-xs font-bold" style={{ color: 'var(--primary)' }}>{selectedSeats.length} siège(s) : {selectedSeats.join(', ')}</span>
                          <button type="button" onClick={() => { setStructSelectedSeats([]); setSelectedSeats([]); }} className="text-xs font-bold" style={{ color: 'var(--danger)' }}>Effacer</button>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              )}

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
                    {currentRouteStops.map(stop => (
                      <option key={stop.city_id} value={`city:${stop.city_id}`}>
                        {stop.city_name}
                      </option>
                    ))}
                    {(() => {
                      const destStation = stations.find(s => s.id === lignes.find(l => l.id === depart.route_id)?.destination_station_id);
                      if (destStation) {
                        return <option value={destStation.id}>{destStation.city || destStation.name}</option>;
                      }
                      return null;
                    })()}
                  </select>
                </div>

                {/* N° Siège — multi-select dropdown (disabled in structure mode) */}
                <div ref={seatDropdownRef} className="relative" style={{ opacity: structureMode ? 0.5 : 1, pointerEvents: structureMode ? 'none' : 'auto' }}>
                  <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>
                    N° Siège {allowedSeatRange ? `(${allowedSeatRange.from}–${allowedSeatRange.to})` : `(${depart.seats_from}–${depart.seats_total})`}{structureMode ? ' — via structure' : ''}
                  </label>
                  {/* Trigger button */}
                  <button
                    type="button"
                    onClick={() => setSeatDropdownOpen(o => !o)}
                    className={fieldInput + ' text-left flex items-center justify-between'}
                    style={{
                      ...fieldStyle,
                      borderColor: selectedSeats.length > 0 ? 'var(--primary)' : 'var(--border)',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ color: selectedSeats.length === 0 ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                      {selectedSeats.length === 0
                        ? 'Sélectionner...'
                        : selectedSeats.length <= 4
                          ? `Sièges : ${selectedSeats.join(', ')}`
                          : `${selectedSeats.length} siège(s) sélectionné(s)`}
                    </span>
                    <svg className={`w-4 h-4 flex-shrink-0 transition-transform ${seatDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--text-muted)' }}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>

                  {/* Dropdown panel */}
                  {seatDropdownOpen && (
                    <div
                      className="absolute z-50 mt-1 rounded-xl shadow-lg overflow-hidden"
                      style={{ backgroundColor: 'var(--surface)', border: '2px solid var(--primary)', width: '220px', maxHeight: '280px', overflowY: 'auto' }}
                    >
                      {/* Header */}
                      <div className="px-3 py-2 flex items-center justify-between sticky top-0" style={{ backgroundColor: 'var(--surface-raised)', borderBottom: '1px solid var(--border)' }}>
                        <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
                          {selectedSeats.length} sélectionné(s)
                        </span>
                        {selectedSeats.length > 0 && (
                          <button type="button" onClick={() => setSelectedSeats([])} className="text-xs font-bold" style={{ color: 'var(--danger)' }}>Effacer</button>
                        )}
                      </div>
                      {/* Seat list */}
                      {sellableSeatNumbers.map(n => {
                        const sold = soldSeats.includes(n);
                        const locked = lockedSeats.includes(n);
                        const isReceived = receivedTransferSeats.includes(n);
                        const checked = selectedSeats.includes(n);
                        return (
                          <label
                            key={n}
                            className="flex items-center gap-2.5 px-3 py-2 cursor-pointer select-none"
                            style={{
                              backgroundColor: checked ? 'var(--primary-light)' : 'transparent',
                              opacity: (sold || locked) ? 0.45 : 1,
                              cursor: (sold || locked) ? 'not-allowed' : 'pointer',
                              borderBottom: '1px solid var(--border)',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={sold || locked}
                              onChange={() => !sold && !locked && toggleSeat(n)}
                              className="w-4 h-4 flex-shrink-0"
                              style={{ accentColor: 'var(--primary)' }}
                            />
                            <span className="text-sm font-bold" style={{ color: (sold || locked) ? 'var(--text-muted)' : checked ? 'var(--primary)' : 'var(--text-primary)' }}>
                              {n}
                            </span>
                            {sold && <span className="ml-auto text-xs font-bold" style={{ color: 'var(--danger)' }}>Vendu</span>}
                            {locked && !sold && <span className="ml-auto text-xs font-bold" style={{ color: 'var(--warning)' }}>Transféré</span>}
                            {isReceived && !sold && !locked && <span className="ml-auto text-xs font-bold" style={{ color: 'var(--success)' }}>Reçu</span>}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Tarif */}
                <div>
                  <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>
                    Tarif{selectedSeats.length > 1 ? ` × ${selectedSeats.length} = ${(tarif * selectedSeats.length).toLocaleString('fr-FR')} FCFA` : ''}
                  </label>
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

                {/* N° Ticket preview */}
                <div>
                  <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>
                    {selectedSeats.length > 1 ? `N° Tickets (auto — ${selectedSeats.length} tickets)` : 'N° Ticket (auto)'}
                  </label>
                  <input
                    type="text"
                    value={ticketPreview || '...'}
                    disabled
                    className={fieldInput}
                    style={{ ...fieldStyle, opacity: 0.6 }}
                  />
                </div>
              </div>

              {selectedSeats.length > 1 && tarif > 0 && (
                <div className="mt-3 px-3 py-2 rounded-lg flex items-center justify-between text-sm font-bold" style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
                  <span>{selectedSeats.length} tickets</span>
                  <span>{(tarif * selectedSeats.length).toLocaleString('fr-FR')} FCFA</span>
                </div>
              )}
              <button
                onClick={handleSell}
                disabled={selling || selectedSeats.length === 0 || !destination || tarif <= 0 || depart.cloture || depart.cancelled || depart.status === 'panne'}
                className="w-full mt-4 py-3.5 rounded-xl font-bold text-white text-base disabled:opacity-60 flex items-center justify-center gap-2 transition-opacity"
                style={{ backgroundColor: 'var(--primary)' }}
              >
                {selling ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                {selectedSeats.length > 1 ? `Vendre ${selectedSeats.length} tickets` : 'Vendre le ticket'}
              </button>
            </div>

            {/* ── Bagage block ── */}
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
              {/* Header + mode selectors */}
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <Package className="w-4 h-4" /> Bagage
                </h3>
                <div className="flex gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={bagMode === 'avec'}
                      onChange={e => setBagMode(e.target.checked ? 'avec' : null)}
                      className="w-4 h-4"
                      style={{ accentColor: 'var(--info)' }}
                    />
                    <span className="text-xs font-bold" style={{ color: bagMode === 'avec' ? 'var(--info)' : 'var(--text-secondary)' }}>Avec ticket</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={bagMode === 'sans'}
                      onChange={e => setBagMode(e.target.checked ? 'sans' : null)}
                      className="w-4 h-4"
                      style={{ accentColor: 'var(--warning)' }}
                    />
                    <span className="text-xs font-bold" style={{ color: bagMode === 'sans' ? 'var(--warning)' : 'var(--text-secondary)' }}>Sans ticket</span>
                  </label>
                </div>
              </div>

              {/* Mode badge */}
              {bagMode && (
                <div className="rounded-lg px-3 py-1.5 mb-3 text-xs font-bold inline-flex items-center gap-2"
                  style={{
                    backgroundColor: bagMode === 'avec' ? 'var(--info-light)' : 'var(--warning-light)',
                    color: bagMode === 'avec' ? 'var(--info)' : 'var(--warning)',
                  }}>
                  <Package className="w-3 h-3" />
                  {bagMode === 'avec' ? 'AVEC TICKET — bagage lié à un billet passager' : 'SANS TICKET — aucun siège réservé'}
                </div>
              )}

              {bagError && (
                <div className="rounded-lg px-3 py-2 mb-3 flex items-start gap-2 text-xs" style={{ backgroundColor: 'var(--danger-light)', color: 'var(--danger)' }}>
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /><span>{bagError}</span>
                </div>
              )}
              {bagSuccess && (
                <div className="rounded-lg px-3 py-2 mb-3 flex items-center gap-2 text-xs font-medium" style={{ backgroundColor: 'var(--success-light)', color: 'var(--success)' }}>
                  <CheckCircle className="w-3.5 h-3.5" /> {bagSuccess}
                </div>
              )}

              {/* ── AVEC TICKET form ── */}
              {bagMode === 'avec' && (
                <div className="space-y-3">
                  {/* Auto-filled ticket info */}
                  <div className="rounded-lg p-3 space-y-2" style={{ backgroundColor: 'var(--surface-raised)', border: '1px solid var(--border)' }}>
                    <p className="text-xs font-bold mb-2" style={{ color: 'var(--text-muted)' }}>Informations du billet lié</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>N° Ticket (auto)</label>
                        <input
                          type="text"
                          value={ticketPreview || '...'}
                          disabled
                          className={fieldInput}
                          style={{ ...fieldStyle, opacity: 0.6 }}
                        />
                      </div>
                      <div>
                        <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>N° Siège</label>
                        <input
                          type="text"
                          value={seatNumber || '—'}
                          disabled
                          className={fieldInput}
                          style={{ ...fieldStyle, opacity: 0.6 }}
                        />
                      </div>
                      <div>
                        <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Destination</label>
                        <input
                          type="text"
                          value={destStationName}
                          disabled
                          className={fieldInput}
                          style={{ ...fieldStyle, opacity: 0.6 }}
                        />
                      </div>
                      <div>
                        <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Car / Immatriculation</label>
                        <input
                          type="text"
                          value={depart.bus_plate ?? '—'}
                          disabled
                          className={fieldInput}
                          style={{ ...fieldStyle, opacity: 0.6 }}
                        />
                      </div>
                      <div>
                        <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>N° Départ</label>
                        <input
                          type="text"
                          value={`#${depart.route_number}`}
                          disabled
                          className={fieldInput}
                          style={{ ...fieldStyle, opacity: 0.6 }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Editable fields */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Prix bagage</label>
                      <div className="relative">
                        <input
                          type="number"
                          value={bagPrice || ''}
                          onChange={e => setBagPrice(parseInt(e.target.value) || 0)}
                          className={fieldInput}
                          style={fieldStyle}
                          placeholder="0"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'var(--text-muted)' }}>FCFA</span>
                      </div>
                    </div>
                    <div>
                      <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Propriétaire (optionnel)</label>
                      <input
                        type="text"
                        value={bagOwnerName}
                        onChange={e => setBagOwnerName(e.target.value)}
                        className={fieldInput}
                        style={fieldStyle}
                        placeholder="Nom du client"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Description du bagage</label>
                      <input
                        type="text"
                        value={bagDescription}
                        onChange={e => setBagDescription(e.target.value)}
                        className={fieldInput}
                        style={fieldStyle}
                        placeholder="Ex: 2 valises, sac de riz..."
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* ── SANS TICKET form ── */}
              {bagMode === 'sans' && (
                <div className="space-y-3">
                  {/* Auto-filled depart info */}
                  <div className="rounded-lg p-3 space-y-2" style={{ backgroundColor: 'var(--surface-raised)', border: '1px solid var(--border)' }}>
                    <p className="text-xs font-bold mb-2" style={{ color: 'var(--text-muted)' }}>Informations du voyage</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Destination</label>
                        <input
                          type="text"
                          value={destStationName}
                          disabled
                          className={fieldInput}
                          style={{ ...fieldStyle, opacity: 0.6 }}
                        />
                      </div>
                      <div>
                        <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>N° Départ</label>
                        <input
                          type="text"
                          value={`#${depart.route_number}`}
                          disabled
                          className={fieldInput}
                          style={{ ...fieldStyle, opacity: 0.6 }}
                        />
                      </div>
                      <div>
                        <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Car / Immatriculation</label>
                        <input
                          type="text"
                          value={depart.bus_plate ?? '—'}
                          disabled
                          className={fieldInput}
                          style={{ ...fieldStyle, opacity: 0.6 }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Editable fields */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Prix bagage *</label>
                      <div className="relative">
                        <input
                          type="number"
                          value={bagPrice || ''}
                          onChange={e => setBagPrice(parseInt(e.target.value) || 0)}
                          className={fieldInput}
                          style={fieldStyle}
                          placeholder="0"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'var(--text-muted)' }}>FCFA</span>
                      </div>
                    </div>
                    <div>
                      <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Propriétaire *</label>
                      <input
                        type="text"
                        value={bagOwnerName}
                        onChange={e => setBagOwnerName(e.target.value)}
                        className={fieldInput}
                        style={fieldStyle}
                        placeholder="Nom et prénoms"
                      />
                    </div>
                    <div>
                      <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Contact *</label>
                      <input
                        type="tel"
                        value={bagOwnerPhone}
                        onChange={e => setBagOwnerPhone(e.target.value)}
                        className={fieldInput}
                        style={fieldStyle}
                        placeholder="Numéro de téléphone"
                      />
                    </div>
                    <div>
                      <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Description du bagage</label>
                      <input
                        type="text"
                        value={bagDescription}
                        onChange={e => setBagDescription(e.target.value)}
                        className={fieldInput}
                        style={fieldStyle}
                        placeholder="Ex: 3 valises..."
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Print button — only shown when a mode is active */}
              {bagMode && (
                <button
                  onClick={handleSellBagage}
                  disabled={bagSelling || bagPrice <= 0 || depart.cloture || depart.cancelled || depart.status === 'panne' || (bagMode === 'sans' && (!bagOwnerName.trim() || !bagOwnerPhone.trim())) || (bagMode === 'avec' && !seatNumber)}
                  className="w-full mt-4 py-3 rounded-xl font-bold text-white text-sm disabled:opacity-60 flex items-center justify-center gap-2 transition-opacity"
                  style={{ backgroundColor: bagMode === 'avec' ? 'var(--info)' : 'var(--warning)' }}
                >
                  {bagSelling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                  Imprimer ticket bagage — {bagMode === 'avec' ? 'Avec ticket' : 'Sans ticket'}
                </button>
              )}
            </div>

            {/* ── Loyalty block ── */}
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface-raised)', border: '1px solid var(--border)', opacity: 0.55, filter: 'grayscale(1)' }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
                  <Users className="w-4 h-4" /> Fidélité <Lock className="w-3 h-3 inline ml-1" style={{ color: 'var(--text-muted)' }} />
                </h3>
                <label className="flex items-center gap-2 cursor-not-allowed">
                  <input type="checkbox" checked={loyaltyEnabled} disabled onChange={e => { setLoyaltyEnabled(e.target.checked); if (!e.target.checked) setLoyaltyNewCard(false); }} className="w-4 h-4" style={{ accentColor: 'var(--text-muted)' }} />
                  <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Activer</span>
                </label>
              </div>

              {loyaltyEnabled && (
                <div className="space-y-3" style={{ pointerEvents: 'none' }}>
                  <label className="flex items-center gap-2 cursor-not-allowed">
                    <input type="checkbox" checked={loyaltyNewCard} disabled onChange={e => setLoyaltyNewCard(e.target.checked)} className="w-4 h-4" style={{ accentColor: 'var(--text-muted)' }} />
                    <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Nouvelle carte</span>
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>N° Fidélité</label>
                      <input type="text" value={loyaltyCardNumber} onChange={e => setLoyaltyCardNumber(e.target.value)} className={fieldInput} style={fieldStyle} placeholder={loyaltyNewCard ? 'Auto-généré' : 'Ex: SBTA-00123'} disabled={loyaltyNewCard} />
                    </div>
                    <div>
                      <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Nbre voyages</label>
                      <input type="number" value={loyaltyTrips} onChange={e => setLoyaltyTrips(parseInt(e.target.value) || 0)} className={fieldInput} style={fieldStyle} disabled />
                    </div>
                    <div>
                      <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Nom et prénoms</label>
                      <input type="text" value={loyaltyName} onChange={e => setLoyaltyName(e.target.value)} className={fieldInput} style={fieldStyle} placeholder="Nom du client" />
                    </div>
                    <div>
                      <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Contact</label>
                      <input type="tel" value={loyaltyPhone} onChange={e => setLoyaltyPhone(e.target.value)} className={fieldInput} style={fieldStyle} placeholder="Téléphone" />
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

        {/* Financial summary — recettes / dépenses / solde / caisse */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'var(--success-light)', border: '2px solid var(--success)' }}>
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <TicketIcon className="w-4 h-4" style={{ color: 'var(--success)' }} />
              <p className="text-xs font-bold" style={{ color: 'var(--success)' }}>Recettes tickets</p>
            </div>
            <p className="text-xl font-bold" style={{ color: 'var(--success)' }}>{formatCurrency(ticketTotal)}</p>
          </div>
          <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'var(--warning-light)', border: '2px solid var(--warning)' }}>
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <Package className="w-4 h-4" style={{ color: 'var(--warning)' }} />
              <p className="text-xs font-bold" style={{ color: 'var(--warning)' }}>Recettes bagages</p>
            </div>
            <p className="text-xl font-bold" style={{ color: 'var(--warning)' }}>{formatCurrency(bagageTotal)}</p>
          </div>
          <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'var(--danger-light)', border: '2px solid var(--danger)' }}>
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <TrendingDown className="w-4 h-4" style={{ color: 'var(--danger)' }} />
              <p className="text-xs font-bold" style={{ color: 'var(--danger)' }}>Total dépenses</p>
            </div>
            <p className="text-xl font-bold" style={{ color: 'var(--danger)' }}>{formatCurrency(depenseTotal)}</p>
          </div>
          <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'var(--surface-raised)', border: '2px solid var(--primary)' }}>
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <Banknote className="w-4 h-4" style={{ color: 'var(--primary)' }} />
              <p className="text-xs font-bold" style={{ color: 'var(--primary)' }}>Solde / Caisse</p>
            </div>
            <p className="text-xl font-bold" style={{ color: solde >= 0 ? 'var(--primary)' : 'var(--danger)' }}>{formatCurrency(solde)}</p>
          </div>
        </div>

        {/* Bottom counters */}
        <div className="grid grid-cols-3 gap-3 mt-4 sticky bottom-0 z-20">
          <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'var(--surface-raised)', border: '2px solid var(--border)' }}>
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <Armchair className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
              <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>{allowedSeatRange ? 'Sièges attribués' : 'Total sièges'}</p>
            </div>
            <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{stationSeatsAllocated}</p>
          </div>
          <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'var(--info-light)', border: '2px solid var(--info)' }}>
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <TicketIcon className="w-4 h-4" style={{ color: 'var(--info)' }} />
              <p className="text-xs font-bold" style={{ color: 'var(--info)' }}>Sièges vendus</p>
            </div>
            <p className="text-2xl font-bold" style={{ color: 'var(--info)' }}>{stationSeatsSold}</p>
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
