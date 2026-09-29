import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { MapPin, Building2, Calendar, Clock, ArrowRight, ArrowLeft, RotateCcw, Printer, Check, X, Loader2, Ticket, Info, Wallet, QrCode } from 'lucide-react';
import { supabase } from '@/services/supabase';
import {
  fetchKiosk, fetchKioskBySlug, updateKioskTicketPayment, createKioskTicket,
  type DigitalKiosk,
} from '@/services/kiosk.service';
import {
  fetchRouteOrigins, fetchRouteDestinations, fetchStationForCity,
  fetchStations, searchTrips, fetchRouteServiceFee,
  type City, type RouteDestination, type Station, type TripOption,
} from '@/sbtamobile/api';
import { tryLockSeat, releaseSeatLock, fetchScheduleSeatMap } from '@/services/seatMap.service';
import { formatCurrency } from '@/utils/formatCurrency';

type Step = 'welcome' | 'services' | 'cities' | 'trips' | 'seats' | 'recap' | 'payment' | 'success' | 'info';

const SESSION_ID = `kiosk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export default function KioskTerminal() {
  const navigate = useNavigate();
  const { slug } = useParams();
  const [params] = useSearchParams();
  const kioskId = params.get('id') ?? '';

  const [kiosk, setKiosk] = useState<DigitalKiosk | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>('welcome');
  const [originCities, setOriginCities] = useState<City[]>([]);
  const [destinations, setDestinations] = useState<RouteDestination[]>([]);
  const [origin, setOrigin] = useState('');
  const [dest, setDest] = useState('');
  const [originStation, setOriginStation] = useState<Station | null>(null);
  const [trips, setTrips] = useState<TripOption[]>([]);
  const [selectedTrip, setSelectedTrip] = useState<TripOption | null>(null);
  const [seatMap, setSeatMap] = useState<any>(null);
  const [selectedSeats, setSelectedSeats] = useState<string[]>([]);
  const [lockedSeats, setLockedSeats] = useState<string[]>([]);
  const [serviceFee, setServiceFee] = useState(300);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [ticketRef, setTicketRef] = useState<string>('');
  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'pending' | 'paid' | 'failed'>('idle');
  const [waveUrl, setWaveUrl] = useState<string>('');
  const [error, setError] = useState('');
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const primary = kiosk?.primary_color ?? '#0B7439';
  const secondary = kiosk?.secondary_color ?? '#E7F6EC';

  // Load kiosk config — by slug from URL path, or by id from query param
  useEffect(() => {
    const loader = slug ? fetchKioskBySlug(slug) : (kioskId ? fetchKiosk(kioskId) : Promise.resolve(null));
    if (!slug && !kioskId) { setError('Borne non identifiée'); setLoading(false); return; }
    loader
      .then((k) => {
        if (!k) { setError('Borne introuvable'); setLoading(false); return; }
        setKiosk(k);
        if (k.status !== 'active') { setError('Borne hors service'); setLoading(false); return; }
        fetchRouteOrigins().then(setOriginCities).catch(() => {});
        if (k.station_id) {
          fetchStationForCity(k.station_id).catch(() => {});
        }
        setLoading(false);
      })
      .catch(() => { setError('Erreur de chargement'); setLoading(false); });
  }, [kioskId, slug]);

  // Idle timeout — return to welcome screen
  const resetIdle = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    const timeout = (kiosk?.idle_timeout_seconds ?? 60) * 1000;
    idleTimer.current = setTimeout(() => {
      handleCancel();
    }, timeout);
  }, [kiosk?.idle_timeout_seconds]);

  useEffect(() => {
    if (step !== 'welcome' && step !== 'success') resetIdle();
    return () => { if (idleTimer.current) clearTimeout(idleTimer.current); };
  }, [step, resetIdle]);

  // Release locked seats on unmount
  useEffect(() => {
    return () => {
      if (selectedTrip?.scheduleId) {
        lockedSeats.forEach((s) => releaseSeatLock(selectedTrip.scheduleId!, s).catch(() => {}));
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleCancel() {
    // Release seats
    if (selectedTrip?.scheduleId) {
      lockedSeats.forEach((s) => releaseSeatLock(selectedTrip.scheduleId!, s).catch(() => {}));
    }
    setStep('welcome');
    setOrigin(''); setDest(''); setDestinations([]);
    setSelectedTrip(null); setSeatMap(null); setSelectedSeats([]); setLockedSeats([]);
    setTicketId(null); setTicketRef(''); setPaymentStatus('idle'); setWaveUrl('');
    setError('');
  }

  // Load destinations when origin changes
  useEffect(() => {
    if (!origin) { setDestinations([]); return; }
    setDest(''); setDestinations([]);
    fetchRouteDestinations(origin).then(setDestinations).catch(() => setDestinations([]));
    fetchStations(origin).then((stations) => setOriginStation(stations[0] ?? null)).catch(() => {});
  }, [origin]);

  // Auto-select origin if kiosk has a station
  useEffect(() => {
    if (kiosk?.station_id && originCities.length > 0 && !origin) {
      // Try to find the city matching the station
      supabase.from('stations').select('city_id').eq('id', kiosk.station_id).maybeSingle()
        .then(({ data }) => {
          if (data?.city_id) setOrigin(data.city_id);
        }).catch(() => {});
    }
  }, [kiosk?.station_id, originCities, origin]);

  async function searchForTrips() {
    if (!origin || !dest) return;
    setError('');
    setLoading(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const slot = { id: 'all', label: 'Toute la journée', startHour: 0, endHour: 23 };
      // Filter by the kiosk's station_id so only POS-planned departures for this station appear
      const stationFilter = kiosk?.station_id ?? undefined;
      const result = await searchTrips(origin, dest, slot as any, today, stationFilter);
      const fee = await fetchRouteServiceFee(origin, dest);
      setServiceFee(fee);
      // Only show planned departures (from POS). Exclude provisional (no scheduleId).
      setTrips(result.planned);
      if (result.planned.length === 0 && result.provisional) {
        // Don't show provisional trips on the kiosk — only real POS-planned departures
        setTrips([]);
      }
      setStep('trips');
    } catch {
      setError('Erreur lors de la recherche');
    } finally {
      setLoading(false);
    }
  }

  async function selectTrip(trip: TripOption) {
    setSelectedTrip(trip);
    setSelectedSeats([]); setLockedSeats([]);
    setError('');
    if (!trip.scheduleId) { setStep('recap'); return; }
    setLoading(true);
    try {
      const sm = await fetchScheduleSeatMap(trip.scheduleId, 'simple');
      setSeatMap(sm);
      setStep('seats');
    } catch {
      setError('Impossible de charger le plan du bus');
    } finally {
      setLoading(false);
    }
  }

  async function toggleSeat(seatNumber: string) {
    if (!selectedTrip?.scheduleId) return;
    const seat = seatMap?.seats?.find((s: any) => s.seatNumber === seatNumber);
    if (!seat || seat.status !== 'available') return;

    if (selectedSeats.includes(seatNumber)) {
      // Deselect
      setSelectedSeats((prev) => prev.filter((s) => s !== seatNumber));
      setLockedSeats((prev) => prev.filter((s) => s !== seatNumber));
      releaseSeatLock(selectedTrip.scheduleId, seatNumber).catch(() => {});
      return;
    }

    // Lock the seat
    try {
      const lock = await tryLockSeat(selectedTrip.scheduleId, seatNumber, SESSION_ID);
      if (!lock) {
        setError('Siège indisponible. Choisissez un autre siège.');
        return;
      }
      setSelectedSeats((prev) => [...prev, seatNumber]);
      setLockedSeats((prev) => [...prev, seatNumber]);
      setError('');
    } catch {
      setError('Erreur lors de la sélection du siège');
    }
  }

  async function goToRecap() {
    if (selectedSeats.length === 0) { setError('Sélectionnez au moins un siège'); return; }
    setStep('recap');
  }

  async function startPayment() {
    if (!selectedTrip || !origin || !dest || !kiosk) return;
    setError('');
    setPaymentStatus('pending');
    setStep('payment');

    try {
      const total = (selectedTrip.price + serviceFee) * selectedSeats.length;
      const channel = (kiosk.kiosk_type === 'virtual_qr' || kiosk.kiosk_channel === 'borne_virtuelle') ? 'borne_virtuelle' : 'borne';
      const ticket = await createKioskTicket({
        kiosk_id: kiosk.id,
        schedule_id: selectedTrip.scheduleId ?? null,
        route_id: selectedTrip.route.id,
        origin_city_id: origin,
        destination_city_id: dest,
        passenger_name: 'Voyageur Borne',
        seat_numbers: selectedSeats,
        unit_price: selectedTrip.price,
        service_fee: serviceFee,
        total_amount: total,
        payment_method: 'wave',
        channel,
        station_id: kiosk.station_id,
      });
      setTicketId(ticket.id);
      setTicketRef(ticket.ticket_ref);

      // Try Wave checkout via edge function
      try {
        const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wave-create-checkout`;
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            bookingId: ticket.id,
            origin: window.location.origin,
            kiosk: true,
          }),
        });
        if (response.ok) {
          const data = await response.json();
          setWaveUrl(data.launchUrl ?? '');
          // Poll for payment status
          pollPayment(ticket.id);
          return;
        }
      } catch {
        // Fall through to manual mode
      }

      // Fallback: manual confirmation
      if (kiosk.payment_confirmation_mode === 'manual') {
        setWaveUrl('');
        pollPayment(ticket.id);
      } else {
        // Show QR code for Wave merchant payment
        setWaveUrl(`https://pay.wave.com/m/M_sbta/c/ticket_${ticket.ticket_ref}`);
        pollPayment(ticket.id);
      }
    } catch {
      setPaymentStatus('failed');
      setError('Erreur lors de la création du ticket');
    }
  }

  async function pollPayment(tId: string) {
    let attempts = 0;
    const maxAttempts = 120; // 2 minutes at 1s intervals
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(interval);
        setPaymentStatus('failed');
        return;
      }
      try {
        const { data } = await supabase
          .from('kiosk_tickets')
          .select('payment_status')
          .eq('id', tId)
          .maybeSingle();
        if (data?.payment_status === 'paid') {
          clearInterval(interval);
          setPaymentStatus('paid');
          setStep('success');
          // Release seats (they're now confirmed)
          setLockedSeats([]);
        } else if (data?.payment_status === 'failed') {
          clearInterval(interval);
          setPaymentStatus('failed');
        }
      } catch {
        // Continue polling
      }
    }, 1000);
  }

  function confirmManualPayment() {
    if (!ticketId) return;
    updateKioskTicketPayment(ticketId, 'paid').then(() => {
      setPaymentStatus('paid');
      setStep('success');
      setLockedSeats([]);
    }).catch(() => setError('Erreur de confirmation'));
  }

  function printTicket() {
    window.print();
  }

  // ─── Render ──────────────────────────────────────────

  if (loading && step === 'welcome') {
    return (
      <div className="fixed inset-0 flex items-center justify-center" style={{ background: primary }}>
        <Loader2 className="w-16 h-16 animate-spin text-white" />
      </div>
    );
  }

  if (error && !kiosk) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4" style={{ background: '#f3f4f6' }}>
        <X className="w-16 h-16 text-red-500" />
        <p className="text-2xl font-bold text-gray-800">{error}</p>
        <button onClick={() => navigate('/')} className="px-6 py-3 rounded-xl text-white font-bold" style={{ background: primary }}>
          Retour
        </button>
      </div>
    );
  }

  const bgStyle = kiosk?.background_image_url
    ? { backgroundImage: `url(${kiosk.background_image_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: `linear-gradient(135deg, ${primary} 0%, ${primary}dd 50%, ${primary}aa 100%)` };

  // ─── Welcome Screen ──────────────────────────────────
  if (step === 'welcome') {
    return (
      <div
        className="fixed inset-0 flex flex-col items-center justify-center cursor-pointer select-none"
        style={bgStyle}
        onClick={() => { setStep('services'); resetIdle(); }}
      >
        {kiosk?.logo_url && <img src={kiosk.logo_url} alt="Logo" className="w-32 h-32 object-contain mb-8 drop-shadow-2xl" />}
        <div className="text-center px-8">
          <h1 className="text-5xl font-extrabold text-white drop-shadow-lg mb-4" style={{ textShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
            {kiosk?.welcome_text ?? 'Touchez l\'écran pour commencer'}
          </h1>
          <div className="mt-8 animate-pulse">
            <div className="w-24 h-24 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center mx-auto">
              <Ticket className="w-12 h-12 text-white" />
            </div>
          </div>
          {kiosk?.station_name && (
            <p className="mt-6 text-xl text-white/90 font-semibold">{kiosk.station_name}</p>
          )}
        </div>
      </div>
    );
  }

  // ─── Services Screen ─────────────────────────────────
  if (step === 'services') {
    const services = kiosk?.services ?? { ticket_sale: true, info: true };
    return (
      <div className="fixed inset-0 flex flex-col" style={{ background: '#f8faf8' }} onClick={resetIdle}>
        <div className="flex items-center justify-between p-6" style={{ background: primary }}>
          {kiosk?.logo_url && <img src={kiosk.logo_url} alt="" className="w-10 h-10 object-contain" />}
          <h2 className="text-2xl font-bold text-white">Choisissez un service</h2>
          <button onClick={handleCancel} className="text-white/80 hover:text-white">
            <RotateCcw className="w-6 h-6" />
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="grid grid-cols-2 gap-8 max-w-2xl">
            {services.ticket_sale && (
              <button
                onClick={() => { setStep('cities'); resetIdle(); }}
                className="flex flex-col items-center justify-center gap-4 p-10 rounded-3xl border-4 transition-all hover:scale-105 active:scale-95"
                style={{ background: secondary, borderColor: primary }}
              >
                <Ticket className="w-16 h-16" style={{ color: primary }} />
                <span className="text-2xl font-bold" style={{ color: primary }}>Achat de billet</span>
              </button>
            )}
            {services.info && (
              <button
                onClick={() => { setStep('info'); resetIdle(); }}
                className="flex flex-col items-center justify-center gap-4 p-10 rounded-3xl border-4 transition-all hover:scale-105 active:scale-95"
                style={{ background: '#e6f8ff', borderColor: '#0B86B8' }}
              >
                <Info className="w-16 h-16 text-[#0B86B8]" />
                <span className="text-2xl font-bold text-[#0B86B8]">Informations</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── Info Screen ─────────────────────────────────────
  if (step === 'info') {
    return (
      <div className="fixed inset-0 flex flex-col" style={{ background: '#f8faf8' }} onClick={resetIdle}>
        <div className="flex items-center justify-between p-6" style={{ background: '#0B86B8' }}>
          <ArrowLeft className="w-6 h-6 text-white cursor-pointer" onClick={() => { setStep('services'); resetIdle(); }} />
          <h2 className="text-2xl font-bold text-white">Informations</h2>
          <button onClick={handleCancel}><RotateCcw className="w-6 h-6 text-white" /></button>
        </div>
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-lg space-y-4 text-center">
            <Building2 className="w-20 h-20 mx-auto" style={{ color: primary }} />
            <h3 className="text-3xl font-bold" style={{ color: primary }}>{kiosk?.station_name ?? 'Gare SBTA'}</h3>
            <p className="text-lg text-gray-600">Pour toute assistance, veuillez vous adresser au guichet ou contacter le service client.</p>
            <button
              onClick={() => { setStep('services'); resetIdle(); }}
              className="mt-6 px-8 py-4 rounded-2xl text-white text-xl font-bold transition hover:scale-105"
              style={{ background: primary }}
            >
              Retour aux services
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Cities Selection ────────────────────────────────
  if (step === 'cities') {
    const destCities: City[] = destinations.map((d) => ({ id: d.cityId, name: d.cityName }));
    return (
      <div className="fixed inset-0 flex flex-col" style={{ background: '#f8faf8' }} onClick={resetIdle}>
        <div className="flex items-center justify-between p-6" style={{ background: primary }}>
          <ArrowLeft className="w-6 h-6 text-white cursor-pointer" onClick={() => { setStep('services'); resetIdle(); }} />
          <h2 className="text-2xl font-bold text-white">Votre trajet</h2>
          <button onClick={handleCancel}><RotateCcw className="w-6 h-6 text-white" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-2xl mx-auto space-y-6">
            {/* Origin */}
            <div className="bg-white rounded-2xl border-2 p-6" style={{ borderColor: origin ? primary : '#e2eae5' }}>
              <div className="flex items-center gap-3 mb-3">
                <MapPin className="w-6 h-6" style={{ color: primary }} />
                <span className="text-lg font-bold" style={{ color: primary }}>Ville de départ</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {originCities.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { setOrigin(c.id); resetIdle(); }}
                    className="p-4 rounded-xl text-lg font-semibold border-2 transition-all hover:scale-105 active:scale-95"
                    style={{
                      background: origin === c.id ? primary : '#f8faf8',
                      color: origin === c.id ? '#fff' : '#1a2e22',
                      borderColor: origin === c.id ? primary : '#e2eae5',
                    }}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Destination */}
            {origin && (
              <div className="bg-white rounded-2xl border-2 p-6" style={{ borderColor: dest ? primary : '#e2eae5' }}>
                <div className="flex items-center gap-3 mb-3">
                  <MapPin className="w-6 h-6 text-red-500" />
                  <span className="text-lg font-bold" style={{ color: primary }}>Ville d'arrivée</span>
                </div>
                {destCities.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {destCities.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => { setDest(c.id); resetIdle(); }}
                        className="p-4 rounded-xl text-lg font-semibold border-2 transition-all hover:scale-105 active:scale-95"
                        style={{
                          background: dest === c.id ? primary : '#f8faf8',
                          color: dest === c.id ? '#fff' : '#1a2e22',
                          borderColor: dest === c.id ? primary : '#e2eae5',
                        }}
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-400 text-lg">Sélectionnez d'abord une ville de départ</p>
                )}
              </div>
            )}

            {origin && dest && (
              <button
                onClick={() => { searchForTrips(); resetIdle(); }}
                disabled={loading}
                className="w-full py-5 rounded-2xl text-white text-2xl font-bold transition hover:scale-[1.02] flex items-center justify-center gap-3"
                style={{ background: primary }}
              >
                {loading ? <Loader2 className="w-7 h-7 animate-spin" /> : <>Rechercher <ArrowRight className="w-7 h-7" /></>}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── Trips List ──────────────────────────────────────
  if (step === 'trips') {
    return (
      <div className="fixed inset-0 flex flex-col" style={{ background: '#f8faf8' }} onClick={resetIdle}>
        <div className="flex items-center justify-between p-6" style={{ background: primary }}>
          <ArrowLeft className="w-6 h-6 text-white cursor-pointer" onClick={() => { setStep('cities'); resetIdle(); }} />
          <h2 className="text-2xl font-bold text-white">Bus disponibles</h2>
          <button onClick={handleCancel}><RotateCcw className="w-6 h-6 text-white" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-2xl mx-auto space-y-4">
            {trips.length === 0 && !loading && (
              <div className="text-center py-16">
                <p className="text-2xl text-gray-500 mb-4">Aucun bus disponible pour ce trajet</p>
                <button onClick={() => { setStep('cities'); resetIdle(); }} className="px-6 py-3 rounded-xl text-white font-bold" style={{ background: primary }}>
                  Modifier la recherche
                </button>
              </div>
            )}
            {trips.map((trip) => (
              <button
                key={trip.key}
                onClick={() => { selectTrip(trip); resetIdle(); }}
                className="w-full bg-white rounded-2xl border-2 p-6 text-left transition-all hover:scale-[1.02] active:scale-[0.98]"
                style={{ borderColor: '#e2eae5' }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="text-center">
                      <div className="text-3xl font-extrabold" style={{ color: primary }}>{trip.departureTime}</div>
                      <div className="text-sm text-gray-500">{trip.route.origin}</div>
                    </div>
                    <ArrowRight className="w-6 h-6 text-gray-400" />
                    <div className="text-center">
                      <div className="text-3xl font-extrabold" style={{ color: primary }}>{trip.arrivalTime}</div>
                      <div className="text-sm text-gray-500">{trip.route.destination}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold" style={{ color: primary }}>{formatCurrency(trip.price)}</div>
                    <div className="text-sm text-gray-500">{trip.busType}</div>
                    {trip.seatsAvailable != null && <div className="text-xs text-green-600 font-semibold">{trip.seatsAvailable} places</div>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ─── Seat Selection ──────────────────────────────────
  if (step === 'seats' && seatMap) {
    const seats = seatMap?.seats ?? [];
    const config = seatMap?.config;
    return (
      <div className="fixed inset-0 flex flex-col" style={{ background: '#f8faf8' }} onClick={resetIdle}>
        <div className="flex items-center justify-between p-6" style={{ background: primary }}>
          <ArrowLeft className="w-6 h-6 text-white cursor-pointer" onClick={() => { setStep('trips'); resetIdle(); }} />
          <h2 className="text-2xl font-bold text-white">Choisissez vos sièges</h2>
          <button onClick={handleCancel}><RotateCcw className="w-6 h-6 text-white" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-8 flex flex-col items-center">
          <div className="bg-white rounded-3xl border-2 p-8 mb-6" style={{ borderColor: '#e2eae5', maxWidth: '500px', width: '100%' }}>
            {/* Bus header */}
            <div className="text-center mb-6">
              <div className="text-xl font-bold" style={{ color: primary }}>{selectedTrip?.busType}</div>
              <div className="text-sm text-gray-500">{selectedTrip?.departureTime} — {selectedTrip?.route.origin} → {selectedTrip?.route.destination}</div>
            </div>
            {/* Seat layout */}
            <div className="space-y-2">
              {/* Driver row */}
              <div className="flex justify-end mb-4">
                <div className="w-12 h-12 rounded-lg flex items-center justify-center text-xs font-bold" style={{ background: '#d1d5db', color: '#4b5563' }}>
                  Conducteur
                </div>
              </div>
              {seats.map((seat: any) => {
                const isSelected = selectedSeats.includes(seat.seatNumber);
                const isAvailable = seat.status === 'available';
                const isOccupied = seat.status === 'occupied' || seat.status === 'locked';
                const isOutOfService = seat.status === 'out_of_service';
                return (
                  <button
                    key={seat.seatNumber}
                    onClick={() => isAvailable && toggleSeat(seat.seatNumber)}
                    disabled={!isAvailable}
                    className="w-14 h-14 rounded-xl text-lg font-bold transition-all"
                    style={{
                      background: isSelected ? primary : isOccupied ? '#d1d5db' : isOutOfService ? '#fee2e2' : '#f0fdf4',
                      color: isSelected ? '#fff' : isOccupied ? '#9ca3af' : isOutOfService ? '#ef4444' : primary,
                      border: `2px solid ${isSelected ? primary : isAvailable ? '#bbf7d0' : '#e5e7eb'}`,
                      cursor: isAvailable ? 'pointer' : 'not-allowed',
                      opacity: isAvailable ? 1 : 0.6,
                    }}
                  >
                    {seat.seatNumber}
                  </button>
                );
              })}
            </div>
          </div>
          {/* Legend */}
          <div className="flex gap-6 mb-6 text-sm">
            <div className="flex items-center gap-2"><div className="w-5 h-5 rounded" style={{ background: '#f0fdf4', border: '2px solid #bbf7d0' }} /><span className="text-gray-600">Libre</span></div>
            <div className="flex items-center gap-2"><div className="w-5 h-5 rounded" style={{ background: primary }} /><span className="text-gray-600">Sélectionné</span></div>
            <div className="flex items-center gap-2"><div className="w-5 h-5 rounded bg-gray-300" /><span className="text-gray-600">Occupé</span></div>
          </div>
          {error && <p className="text-red-600 font-semibold mb-4">{error}</p>}
          {selectedSeats.length > 0 && (
            <button
              onClick={() => { goToRecap(); resetIdle(); }}
              className="px-12 py-5 rounded-2xl text-white text-2xl font-bold transition hover:scale-105"
              style={{ background: primary }}
            >
              Continuer ({selectedSeats.length} siège{selectedSeats.length > 1 ? 's' : ''})
            </button>
          )}
        </div>
      </div>
    );
  }

  // ─── Recap ───────────────────────────────────────────
  if (step === 'recap' && selectedTrip) {
    const subtotal = selectedTrip.price * Math.max(selectedSeats.length, 1);
    const feeTotal = serviceFee * Math.max(selectedSeats.length, 1);
    const total = subtotal + feeTotal;
    return (
      <div className="fixed inset-0 flex flex-col" style={{ background: '#f8faf8' }} onClick={resetIdle}>
        <div className="flex items-center justify-between p-6" style={{ background: primary }}>
          <ArrowLeft className="w-6 h-6 text-white cursor-pointer" onClick={() => { setStep('seats'); resetIdle(); }} />
          <h2 className="text-2xl font-bold text-white">Récapitulatif</h2>
          <button onClick={handleCancel}><RotateCcw className="w-6 h-6 text-white" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-8 flex flex-col items-center">
          <div className="bg-white rounded-3xl border-2 p-8 max-w-lg w-full space-y-4" style={{ borderColor: '#e2eae5' }}>
            <div className="text-center pb-4 border-b" style={{ borderColor: '#e2eae5' }}>
              <div className="text-3xl font-extrabold" style={{ color: primary }}>{selectedTrip.route.origin} → {selectedTrip.route.destination}</div>
              <div className="text-lg text-gray-500 mt-1">{selectedTrip.departureTime} • {selectedTrip.busType}</div>
            </div>
            <div className="space-y-2">
              <Row label="Sièges" value={selectedSeats.length > 0 ? selectedSeats.join(', ') : 'Non assigné'} />
              <Row label={`Prix unitaire × ${Math.max(selectedSeats.length, 1)}`} value={formatCurrency(subtotal)} />
              <Row label={`Frais de service × ${Math.max(selectedSeats.length, 1)}`} value={formatCurrency(feeTotal)} />
              <div className="border-t pt-2 flex items-center justify-between" style={{ borderColor: '#e2eae5' }}>
                <span className="text-xl font-bold" style={{ color: primary }}>Total à payer</span>
                <span className="text-3xl font-extrabold" style={{ color: primary }}>{formatCurrency(total)}</span>
              </div>
            </div>
          </div>
          <button
            onClick={() => { startPayment(); resetIdle(); }}
            className="mt-8 px-12 py-5 rounded-2xl text-white text-2xl font-bold transition hover:scale-105 flex items-center gap-3"
            style={{ background: primary }}
          >
            <Wallet className="w-7 h-7" /> Payer avec Wave
          </button>
        </div>
      </div>
    );
  }

  // ─── Payment ─────────────────────────────────────────
  if (step === 'payment') {
    return (
      <div className="fixed inset-0 flex flex-col" style={{ background: '#f8faf8' }} onClick={resetIdle}>
        <div className="flex items-center justify-between p-6" style={{ background: primary }}>
          <ArrowLeft className="w-6 h-6 text-white cursor-pointer" onClick={handleCancel} />
          <h2 className="text-2xl font-bold text-white">Paiement Wave</h2>
          <button onClick={handleCancel}><X className="w-6 h-6 text-white" /></button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          {paymentStatus === 'pending' && (
            <div className="text-center space-y-6">
              <div className="w-48 h-48 bg-white rounded-3xl border-4 flex items-center justify-center" style={{ borderColor: primary }}>
                {waveUrl ? (
                  <QrCode className="w-32 h-32" style={{ color: primary }} />
                ) : (
                  <Loader2 className="w-16 h-16 animate-spin" style={{ color: primary }} />
                )}
              </div>
              <div>
                <p className="text-2xl font-bold" style={{ color: primary }}>Scannez le QR code avec Wave</p>
                <p className="text-lg text-gray-500 mt-2">Référence: {ticketRef}</p>
              </div>
              <div className="flex items-center gap-2 text-gray-500">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-lg">En attente de paiement...</span>
              </div>
              {kiosk?.payment_confirmation_mode === 'manual' && (
                <button
                  onClick={confirmManualPayment}
                  className="mt-4 px-8 py-4 rounded-xl text-white text-xl font-bold"
                  style={{ background: primary }}
                >
                  Confirmer le paiement reçu
                </button>
              )}
            </div>
          )}
          {paymentStatus === 'failed' && (
            <div className="text-center space-y-6">
              <X className="w-20 h-20 text-red-500" />
              <p className="text-3xl font-bold text-red-600">Paiement échoué</p>
              <p className="text-lg text-gray-500">Le paiement n'a pas été confirmé à temps.</p>
              <div className="flex gap-4">
                <button onClick={handleCancel} className="px-8 py-4 rounded-xl border-2 font-bold text-lg" style={{ borderColor: primary, color: primary }}>
                  Annuler
                </button>
                <button onClick={startPayment} className="px-8 py-4 rounded-xl text-white font-bold text-lg" style={{ background: primary }}>
                  Réessayer
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Success ─────────────────────────────────────────
  if (step === 'success') {
    const total = selectedTrip ? (selectedTrip.price + serviceFee) * Math.max(selectedSeats.length, 1) : 0;
    return (
      <div className="fixed inset-0 flex flex-col" style={{ background: '#f0fdf4' }}>
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <div className="text-center space-y-6">
            <div className="w-32 h-32 rounded-full flex items-center justify-center mx-auto" style={{ background: primary }}>
              <Check className="w-20 h-20 text-white" />
            </div>
            <h1 className="text-4xl font-extrabold" style={{ color: primary }}>Paiement confirmé !</h1>
            <div className="bg-white rounded-2xl border-2 p-8 max-w-md w-full space-y-3" style={{ borderColor: secondary }}>
              <Row label="Référence" value={ticketRef} />
              {selectedTrip && <Row label="Trajet" value={`${selectedTrip.route.origin} → ${selectedTrip.route.destination}`} />}
              {selectedTrip && <Row label="Départ" value={selectedTrip.departureTime} />}
              {selectedSeats.length > 0 && <Row label="Sièges" value={selectedSeats.join(', ')} />}
              <Row label="Montant" value={formatCurrency(total)} />
            </div>
            <button
              onClick={printTicket}
              className="px-10 py-5 rounded-2xl text-white text-2xl font-bold transition hover:scale-105 flex items-center gap-3 mx-auto"
              style={{ background: primary }}
            >
              <Printer className="w-7 h-7" /> Imprimer le ticket
            </button>
            <button
              onClick={handleCancel}
              className="block mx-auto text-lg text-gray-500 hover:text-gray-700 font-semibold"
            >
              Terminer — Retour à l'accueil
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-600">{label}</span>
      <span className="font-bold" style={{ color: '#1a2e22' }}>{value}</span>
    </div>
  );
}
