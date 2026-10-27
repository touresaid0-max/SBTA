import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Luggage, Search, Printer, Plus, CheckCircle, AlertCircle,
  Loader2, Wifi, WifiOff, RefreshCw, LogOut, ArrowLeft,
  Ticket as TicketIcon, Link2, History, Package, X,
  MapPin, Calendar, Phone, User, FileText, Tag,
} from 'lucide-react';
import { usePOSSession } from '@/services/pos/POSSessionContext';
import { useConnection } from '@/services/pos/ConnectionContext';
import { useAutoSync } from '@/services/pos/useAutoSync';
import {
  getAllDeparts, getDepartById, type DepartRecord,
} from '@/services/pos/departService';
import {
  getStations, getTicketsForDepart, searchTicketsBySuffix,
  type StationRef, type TicketRecord, type TicketSearchResult,
} from '@/services/pos/ticketService';
import {
  registerBagage, getBagagesForDepart, findTicketByNumber,
  type BagageRecord,
} from '@/services/pos/bagageService';
import { PrintService } from '@/services/pos/printService';
import { getAll } from '@/services/pos/offlineStore';
import { formatCurrency } from '@/utils/formatCurrency';
import { getTarifForDestination } from '@/services/pos/ticketService';
import { supabase } from '@/services/supabase';

type View = 'home' | 'register' | 'search' | 'link' | 'history' | 'detail';

export default function BaggageTerminal() {
  const navigate = useNavigate();
  const { session, logout, refresh, loading: sessionLoading } = usePOSSession();
  const { status, syncing, pendingCount, bannerLabel } = useConnection();
  useAutoSync(session?.station_id);

  const [view, setView] = useState<View>('home');
  const [linkResult, setLinkResult] = useState<TicketSearchResult | null>(null);
  const [selectedBagage, setSelectedBagage] = useState<BagageRecord | null>(null);
  const [departs, setDeparts] = useState<DepartRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Role guard: only bagagiste may use the TPE. Any other role is kicked to the TPE login.
  useEffect(() => {
    if (sessionLoading) return;
    if (session && session.role !== 'bagagiste') {
      logout();
      navigate('/tpe-pos/connexion', { replace: true });
    }
  }, [session, sessionLoading, logout, navigate]);

  // Re-sync the bagagiste's station from the authoritative junction table
  // (station_baggage_handlers, managed in Administration). The cached session
  // may carry a stale users.station_id from before the fix. This ensures the
  // displayed gare and all station-scoped data match the official assignment.
  useEffect(() => {
    if (!session || session.role !== 'bagagiste') return;
    let cancelled = false;
    (async () => {
      try {
        const { data: sbh } = await supabase
          .from('station_baggage_handlers')
          .select('station_id, stations!inner(id, name)')
          .eq('handler_id', session.user_id)
          .limit(1)
          .maybeSingle();
        if (cancelled || !sbh) return;
        const st = sbh.stations as unknown as { id: string; name: string } | null;
        if (!st?.id) return;

        // If the authoritative station differs from the cached session, update it in place.
        if (st.id !== session.station_id || st.name !== session.station_name) {
          const { db: idb } = await import('@/services/pos/db');
          const updated = { ...session, station_id: st.id, station_name: st.name };
          await idb.session.put(updated);
          if (!cancelled) await refresh();
        }
      } catch {
        // non-critical — fall back to cached session values
      }
    })();
    return () => { cancelled = true; };
  }, [session?.user_id, session?.role]);

  const loadDeparts = useCallback(async () => {
    if (!session?.station_id) { setLoading(false); return; }
    try {
      const all = await getAllDeparts(session.station_id, session.counter_id);
      const today = new Date().toISOString().slice(0, 10);
      const todayDeparts = all.filter(d =>
        d.departure_date === today && !d.cancelled && !d.cloture,
      );
      setDeparts(todayDeparts);
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }, [session?.station_id, session?.counter_id]);

  useEffect(() => {
    loadDeparts();
  }, [loadDeparts]);

  const handleLogout = async () => {
    await logout();
    navigate('/tpe-pos/connexion', { replace: true });
  };

  // Connection indicator
  const connIcon = status === 'offline' ? WifiOff : syncing ? RefreshCw : Wifi;
  const connColor = status === 'offline' ? '#dc2626' : syncing ? '#2563eb' : '#16a34a';
  const connAnimate = syncing;

  return (
    <div className="min-h-screen flex flex-col bg-[#F4F7F5]">
      {/* Header — SBTA green, compact for TPE */}
      <header
        className="px-5 py-4 sticky top-0 z-30 flex items-center justify-between"
        style={{ backgroundColor: '#0B7439', color: 'white' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          {view !== 'home' && (
            <button
              onClick={() => setView('home')}
              className="flex items-center justify-center w-12 h-12 rounded-lg flex-shrink-0 transition-colors hover:bg-white/15"
              aria-label="Retour"
            >
              <ArrowLeft className="w-6 h-6" />
            </button>
          )}
          <div className="min-w-0">
            <p className="text-base font-bold leading-tight truncate">SBTA · TPE Bagage</p>
            <p className="text-sm opacity-85 leading-tight truncate">
              {session?.station_name ?? 'Gare'} — {session?.full_name ?? 'Agent'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold"
            style={{ backgroundColor: connColor }}
          >
            <connIcon className={`w-5 h-5 ${connAnimate ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">
              {pendingCount > 0 ? `${pendingCount} en attente` : status === 'offline' ? 'Hors ligne' : 'En ligne'}
            </span>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center justify-center w-12 h-12 rounded-lg transition-colors hover:bg-white/15"
            aria-label="Déconnexion"
          >
            <LogOut className="w-6 h-6" />
          </button>
        </div>
      </header>

      {/* Connection banner */}
      <div
        className="flex items-center gap-2.5 px-5 py-2 text-sm font-medium text-white"
        style={{ backgroundColor: connColor }}
      >
        <connIcon className={`w-4.5 h-4.5 flex-shrink-0 ${connAnimate ? 'animate-spin' : ''}`} />
        <span className="truncate">{bannerLabel}</span>
      </div>

      {/* Main content */}
      <main className="flex-1 px-5 py-5 sm:px-8 max-w-2xl mx-auto w-full">
        {sessionLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-10 h-10 animate-spin" style={{ color: '#0B7439' }} />
          </div>
        ) : !session || session.role !== 'bagagiste' ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <AlertCircle className="w-12 h-12 mb-4" style={{ color: '#DC2626' }} />
            <p className="text-base font-medium" style={{ color: '#6B7280' }}>
              Accès refusé — profil bagagiste requis.
            </p>
          </div>
        ) : (
          <>
            {view === 'home' && (
              <HomeView
                departs={departs}
                loading={loading}
                onSelectView={setView}
                stationName={session?.station_name ?? 'Gare'}
                bagagisteName={session?.full_name ?? 'Bagagiste'}
              />
            )}
            {view === 'register' && (
              <RegisterView
                departs={departs}
                session={session}
                onDone={loadDeparts}
              />
            )}
            {view === 'search' && (
              <SearchView
                stationId={session.station_id}
                onLink={(result) => { setLinkResult(result); setView('link'); }}
              />
            )}
            {view === 'link' && linkResult && (
              <LinkView
                result={linkResult}
                session={session}
                onDone={() => { setLinkResult(null); setView('home'); }}
                onBack={() => { setLinkResult(null); setView('search'); }}
              />
            )}
            {view === 'history' && (
              <HistoryView
                session={session}
                onOpenDetail={(b) => { setSelectedBagage(b); setView('detail'); }}
              />
            )}
            {view === 'detail' && selectedBagage && (
              <BagageDetailView
                bagage={selectedBagage}
                session={session}
                onBack={() => { setSelectedBagage(null); setView('history'); }}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

// ── HOME ─────────────────────────────────────────────────────────────────────

interface HomeViewProps {
  departs: DepartRecord[];
  loading: boolean;
  onSelectView: (v: View) => void;
  stationName: string;
  bagagisteName: string;
  companyName?: string;
}

function HomeView({ departs, loading, onSelectView, stationName, bagagisteName, companyName }: HomeViewProps) {
  const tiles: { label: string; icon: typeof Luggage; view: View; color: string; bg: string }[] = [
    { label: 'Enregistrer bagage', icon: Luggage, view: 'register', color: '#0B7439', bg: '#D1FAE5' },
    { label: 'Rechercher ticket', icon: Search, view: 'search', color: '#7C3AED', bg: '#EDE9FE' },
    { label: 'Historique', icon: History, view: 'history', color: '#1D6FA4', bg: '#DBEAFE' },
  ];

  return (
    <div className="space-y-7">
      {/* SBTA brand block */}
      <div
        className="rounded-2xl p-7 text-center"
        style={{ background: 'linear-gradient(135deg, #0B7439 0%, #0E8D44 100%)', color: 'white' }}
      >
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-3" style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}>
          <Luggage className="w-10 h-10" strokeWidth={2.5} />
        </div>
        <h1 className="text-2xl font-bold leading-tight">Terminal Bagage TPE</h1>
        <p className="text-base font-semibold opacity-95 mt-1.5">{bagagisteName}</p>
        <p className="text-sm opacity-85 mt-1">
          {stationName}{companyName ? ` · ${companyName}` : ''}
        </p>
      </div>

      {/* Departure count indicator */}
      <div className="rounded-xl p-4 flex items-center justify-between" style={{ backgroundColor: 'white', border: '1px solid #E2EAE5' }}>
        <div className="flex items-center gap-2.5">
          <Package className="w-5 h-5" style={{ color: '#0B7439' }} />
          <span className="text-sm font-bold" style={{ color: '#6B7280' }}>Départs actifs aujourd'hui</span>
        </div>
        {loading ? (
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: '#0B7439' }} />
        ) : (
          <span className="text-lg font-bold" style={{ color: '#0B7439' }}>{departs.length}</span>
        )}
      </div>

      {/* Action tiles — large, TPE-friendly */}
      <div className="grid grid-cols-1 gap-5">
        {tiles.map(tile => {
          const Icon = tile.icon;
          return (
            <button
              key={tile.view}
              onClick={() => onSelectView(tile.view)}
              className="flex items-center gap-5 p-6 rounded-2xl border-2 transition-all active:scale-[0.98] hover:shadow-md min-h-[96px]"
              style={{ backgroundColor: 'white', borderColor: '#E2EAE5' }}
            >
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: tile.bg, color: tile.color }}
              >
                <Icon className="w-8 h-8" strokeWidth={2.2} />
              </div>
              <div className="text-left min-w-0">
                <p className="text-lg font-bold leading-tight" style={{ color: '#1A2E22' }}>{tile.label}</p>
                <p className="text-sm mt-1" style={{ color: '#6B7280' }}>
                  {tile.view === 'register' && 'Nouveau bagage + impression reçu'}
                  {tile.view === 'search' && 'Recherche par 4 derniers caractères'}
                  {tile.view === 'history' && 'Bagages enregistrés aujourd\'hui'}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── REGISTER ──────────────────────────────────────────────────────────────────

interface RegisterViewProps {
  departs: DepartRecord[];
  session: ReturnType<typeof usePOSSession>['session'];
  onDone: () => void;
}

function RegisterView({ departs, session, onDone }: RegisterViewProps) {
  const [selectedDepart, setSelectedDepart] = useState<DepartRecord | null>(null);
  const [stations, setStations] = useState<StationRef[]>([]);
  const [withTicket, setWithTicket] = useState(false);
  const [ticketSearch, setTicketSearch] = useState('');
  const [ticketResults, setTicketResults] = useState<TicketRecord[]>([]);
  const [linkedTicket, setLinkedTicket] = useState<TicketRecord | null>(null);
  const [ticketBusPlate, setTicketBusPlate] = useState('');
  const [declaredValue, setDeclaredValue] = useState(0);
  const [price, setPrice] = useState(0);
  const [destinationId, setDestinationId] = useState('');
  const [destinationName, setDestinationName] = useState('');
  const [description, setDescription] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [departTickets, setDepartTickets] = useState<TicketRecord[]>([]);
  const [ticketSearching, setTicketSearching] = useState(false);

  useEffect(() => {
    getStations().then(setStations).catch(() => {});
  }, []);

  // Load cached tickets for the selected departure; online search supplements this list.
  useEffect(() => {
    if (!selectedDepart) { setDepartTickets([]); return; }
    getTicketsForDepart(selectedDepart.id).then(setDepartTickets).catch(() => {});
  }, [selectedDepart]);

  useEffect(() => {
    if (!linkedTicket || !stations.length) return;
    const matchingStation = stations.find(station =>
      linkedTicket.destination_id === station.id ||
      station.name.toLowerCase() === linkedTicket.destination.trim().toLowerCase() ||
      station.name.toLowerCase().includes(linkedTicket.destination.trim().toLowerCase()),
    );
    if (matchingStation) {
      setDestinationId(matchingStation.id);
      setDestinationName(matchingStation.name);
    }
  }, [linkedTicket, stations]);

  // Auto-calculate price when destination changes
  useEffect(() => {
    if (!selectedDepart || !destinationId) return;
    (async () => {
      const tarif = await getTarifForDestination(selectedDepart.route_id, destinationId);
      if (tarif && tarif.price > 0) {
        setPrice(tarif.price);
      }
    })();
  }, [selectedDepart, destinationId]);

  // Ticket search by last 4 characters, scoped to the selected departure.
  useEffect(() => {
    if (!withTicket || ticketSearch.trim().length !== 4 || !selectedDepart) {
      setTicketResults([]);
      setTicketSearching(false);
      return;
    }

    let active = true;
    const q = ticketSearch.trim().toLowerCase();
    setTicketSearching(true);
    searchTicketsBySuffix(q, selectedDepart.station_id, selectedDepart.id)
      .then(results => {
        if (!active) return;
        setTicketResults(results.map(result => ({ ...result.ticket, bus_plate: result.busPlate ?? result.depart?.bus_plate })));
      })
      .catch(() => {
        if (active) setTicketResults([]);
      })
      .finally(() => {
        if (active) setTicketSearching(false);
      });

    return () => { active = false; };
  }, [ticketSearch, selectedDepart, withTicket]);

  const handleSelectTicket = (ticket: TicketRecord) => {
    setLinkedTicket(ticket);
    setTicketBusPlate(ticket.bus_plate ?? selectedDepart?.bus_plate ?? '');
    setTicketSearch(ticket.ticket_number);
    setTicketResults([]);
    setOwnerName(ticket.passenger_name || ownerName);
    setOwnerPhone(ticket.passenger_phone || ownerPhone);
    const matchingStation = stations.find(station =>
      ticket.destination_id === station.id ||
      station.name.toLowerCase() === ticket.destination.trim().toLowerCase() ||
      station.name.toLowerCase().includes(ticket.destination.trim().toLowerCase()),
    );
    setDestinationId(ticket.destination_id ?? matchingStation?.id ?? '');
    setDestinationName(matchingStation?.name ?? ticket.destination);
  };

  const handleSubmit = async () => {
    if (!selectedDepart) { setError('Veuillez sélectionner un départ'); return; }
    if (withTicket && !linkedTicket) { setError('Veuillez lier un ticket valide'); return; }
    if (price <= 0) { setError('Veuillez saisir un prix valide'); return; }
    if (!destinationId && !destinationName) { setError('Veuillez sélectionner une destination'); return; }

    setError('');
    setSuccess('');
    setSaving(true);
    try {
      const station = stations.find(s => s.id === destinationId);
      const destName = station?.name ?? destinationName;
      const isDeferred = session?.tpe_mode === 'avec_guichet';
      const bagage = await registerBagage({
        departId: selectedDepart.id,
        withTicket,
        withTicketReport: false,
        ticketNumber: linkedTicket?.ticket_number,
        busPlate: ticketBusPlate || selectedDepart.bus_plate,
        linkedSeatNumber: linkedTicket?.seat_number,
        price,
        destination: destName,
        description: description,
        declaredValue,
        ownerName,
        ownerPhone,
        printBagage: true,
        paymentStatus: isDeferred ? 'en_attente' : 'paye',
      });

      PrintService.printTpeBagage({
        bagage,
        depart: selectedDepart,
        stationName: session?.station_name,
      });

      setSuccess(isDeferred
        ? `Bagage enregistré en attente — ${bagage.bagage_number}`
        : `Bagage enregistré — ${bagage.bagage_number}`);

      // Reset
      setWithTicket(false);
      setTicketSearch('');
      setLinkedTicket(null);
      setTicketBusPlate('');
      setTicketResults([]);
      setDeclaredValue(0);
      setPrice(0);
      setDestinationId('');
      setDestinationName('');
      setDescription('');
      setOwnerName('');
      setOwnerPhone('');
      onDone();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      setError(err?.message ?? 'Erreur lors de l\'enregistrement');
    } finally {
      setSaving(false);
    }
  };

  const fieldLabel = 'block text-sm font-bold mb-1.5';
  const fieldInput = 'w-full px-4 py-3.5 rounded-xl border-2 text-base outline-none transition-colors';
  const fieldStyle = { borderColor: '#E2EAE5', backgroundColor: 'white' };

  // Step 1: select depart
  if (!selectedDepart) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold" style={{ color: '#1A2E22' }}>Sélectionner un départ</h2>
        {departs.length === 0 ? (
          <div className="text-center py-14 rounded-xl" style={{ backgroundColor: 'white', border: '1px solid #E2EAE5' }}>
            <Package className="w-12 h-12 mx-auto mb-3" style={{ color: '#9CA3AF' }} />
            <p className="text-base" style={{ color: '#6B7280' }}>Aucun départ actif aujourd'hui</p>
          </div>
        ) : (
          <div className="space-y-3">
            {departs.map(d => (
              <button
                key={d.id}
                onClick={() => setSelectedDepart(d)}
                className="w-full flex items-center justify-between p-5 rounded-xl border-2 transition-all active:scale-[0.98] hover:shadow-sm text-left"
                style={{ backgroundColor: 'white', borderColor: '#E2EAE5' }}
              >
                <div className="min-w-0">
                  <p className="text-base font-bold truncate" style={{ color: '#1A2E22' }}>
                    Départ #{d.route_number} — {d.route_name}
                  </p>
                  <p className="text-sm mt-1" style={{ color: '#6B7280' }}>
                    {d.bus_plate} · {d.departure_time}
                  </p>
                </div>
                <ArrowLeft className="w-6 h-6 rotate-180 flex-shrink-0" style={{ color: '#0B7439' }} />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Step 2: baggage form
  return (
    <div className="space-y-5">
      {/* Depart summary */}
      <div
        className="rounded-xl p-4 flex items-center justify-between"
        style={{ backgroundColor: '#0B7439', color: 'white' }}
      >
        <div className="min-w-0">
          <p className="text-base font-bold truncate">Départ #{selectedDepart.route_number}</p>
          <p className="text-sm opacity-85 truncate">{selectedDepart.route_name} · {selectedDepart.bus_plate}</p>
        </div>
        <button
          onClick={() => setSelectedDepart(null)}
          className="flex items-center justify-center w-10 h-10 rounded-lg flex-shrink-0 transition-colors hover:bg-white/15"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {error && (
        <div className="rounded-xl px-4 py-3 flex items-start gap-2.5 text-base" style={{ backgroundColor: '#FEF2F2', color: '#DC2626' }}>
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="rounded-xl px-4 py-3 flex items-center gap-2.5 text-base font-medium" style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>
          <CheckCircle className="w-5 h-5 flex-shrink-0" /> {success}
        </div>
      )}

      {/* Ticket linking */}
      <div className="rounded-xl p-5" style={{ backgroundColor: 'white', border: '1px solid #E2EAE5' }}>
        <label className="flex items-center gap-3 cursor-pointer mb-4">
          <input
            type="checkbox"
            checked={withTicket}
            onChange={e => {
              setWithTicket(e.target.checked);
              if (!e.target.checked) {
                setTicketSearch('');
                setLinkedTicket(null);
                setTicketBusPlate('');
                setTicketResults([]);
              }
            }}
            className="w-6 h-6"
            style={{ accentColor: '#0B7439' }}
          />
          <span className="text-base font-bold" style={{ color: '#1A2E22' }}>Avec ticket (lier à un passager)</span>
        </label>

        {withTicket && (
          <div>
            <label className={fieldLabel} style={{ color: '#374151' }}>
              Rechercher ticket — 4 derniers caractères
            </label>
            <div className="relative">
              <input
                type="text"
                value={ticketSearch}
                onChange={e => { setTicketSearch(e.target.value); setLinkedTicket(null); }}
                className={fieldInput}
                style={fieldStyle}
                placeholder="Ex: 0001"
                maxLength={10}
              />
              <Search className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: '#9CA3AF' }} />
            </div>
            {ticketSearching && (
              <p className="text-sm mt-2" style={{ color: '#6B7280' }}>Recherche en cours...</p>
            )}
            {ticketResults.length > 0 && (
              <div className="mt-3 space-y-2 max-h-56 overflow-y-auto">
                {ticketResults.map(t => (
                  <button
                    key={t.id}
                    onClick={() => handleSelectTicket(t)}
                    className="w-full flex items-center gap-3 p-3.5 rounded-lg border text-left transition-colors hover:bg-[#F4F7F5]"
                    style={{ borderColor: '#E2EAE5', backgroundColor: '#FAFBFA' }}
                  >
                    <TicketIcon className="w-5 h-5 flex-shrink-0" style={{ color: '#7C3AED' }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold truncate" style={{ color: '#1A2E22' }}>
                        {t.ticket_number} — Siège {t.seat_number}
                      </p>
                      <p className="text-sm truncate" style={{ color: '#6B7280' }}>
                        {t.destination} · {t.passenger_name}
                      </p>
                    </div>
                    <span className="text-sm font-bold flex-shrink-0" style={{ color: '#0B7439' }}>
                      {formatCurrency(t.price)}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {ticketSearch.trim().length === 4 && ticketResults.length === 0 && !linkedTicket && !ticketSearching && (
              <p className="text-sm mt-2" style={{ color: '#9CA3AF' }}>Aucun ticket trouvé pour ce départ</p>
            )}
            {linkedTicket && (
              <div className="mt-4 rounded-xl p-4 space-y-2.5" style={{ backgroundColor: '#F3F0FF', border: '1px solid #C4B5FD' }}>
                <div className="flex items-start gap-2.5">
                  <Link2 className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: '#7C3AED' }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold truncate" style={{ color: '#5B21B6' }}>
                      Ticket sélectionné : {linkedTicket.ticket_number}
                    </p>
                    <p className="text-sm mt-1" style={{ color: '#6D28D9' }}>
                      Siège {linkedTicket.seat_number || '—'} · Destination {linkedTicket.destination || '—'}
                    </p>
                    <p className="text-sm mt-0.5" style={{ color: '#6D28D9' }}>
                      Passager : {linkedTicket.passenger_name || 'Non renseigné'} · Car {selectedDepart.bus_plate || '—'}
                    </p>
                  </div>
                  <button
                    onClick={() => { setLinkedTicket(null); setTicketBusPlate(''); setTicketSearch(''); }}
                    className="flex-shrink-0"
                    aria-label="Désélectionner le ticket"
                  >
                    <X className="w-5 h-5" style={{ color: '#7C3AED' }} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bagage form */}
      <div className="rounded-xl p-5 space-y-4" style={{ backgroundColor: 'white', border: '1px solid #E2EAE5' }}>
        <div className="grid grid-cols-2 gap-4">
          {/* Destination */}
          <div className="col-span-2">
            <label className={fieldLabel} style={{ color: '#374151' }}>Destination</label>
            <select
              value={destinationId}
              onChange={e => {
                setDestinationId(e.target.value);
                const st = stations.find(s => s.id === e.target.value);
                setDestinationName(st?.name ?? '');
              }}
              disabled={Boolean(linkedTicket)}
              className={fieldInput}
              style={{ ...fieldStyle, opacity: linkedTicket ? 0.7 : 1 }}
            >
              <option value="">{destinationName || 'Sélectionner...'}</option>
              {stations
                .filter(s => s.id !== selectedDepart.station_id)
                .map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          {/* Declared value */}
          <div>
            <label className={fieldLabel} style={{ color: '#374151' }}>Valeur déclarée (FCFA)</label>
            <input
              type="number"
              min={0}
              value={declaredValue || ''}
              onChange={e => setDeclaredValue(parseInt(e.target.value) || 0)}
              className={fieldInput}
              style={fieldStyle}
              placeholder="0"
            />
          </div>

          {/* Bus and seat from the selected ticket */}
          <div>
            <label className={fieldLabel} style={{ color: '#374151' }}>Immatriculation</label>
            <input
              type="text"
              value={ticketBusPlate || selectedDepart.bus_plate || ''}
              disabled
              className={fieldInput}
              style={{ ...fieldStyle, opacity: 0.7 }}
            />
          </div>
          <div>
            <label className={fieldLabel} style={{ color: '#374151' }}>Siège</label>
            <input
              type="text"
              value={linkedTicket?.seat_number ? String(linkedTicket.seat_number) : ''}
              disabled
              className={fieldInput}
              style={{ ...fieldStyle, opacity: 0.7 }}
              placeholder="—"
            />
          </div>

          {/* Price */}
          <div>
            <label className={fieldLabel} style={{ color: '#374151' }}>Montant à payer (FCFA)</label>
            <div className="relative">
              <input
                type="number"
                min={0}
                value={price || ''}
                onChange={e => setPrice(parseInt(e.target.value) || 0)}
                className={fieldInput}
                style={fieldStyle}
                placeholder="0"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold" style={{ color: '#9CA3AF' }}>F</span>
            </div>
          </div>

          {/* Description */}
          <div className="col-span-2">
            <label className={fieldLabel} style={{ color: '#374151' }}>Description</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              className={fieldInput}
              style={fieldStyle}
              placeholder="Description du bagage..."
            />
          </div>

          {/* Owner name */}
          <div>
            <label className={fieldLabel} style={{ color: '#374151' }}>Nom et prénoms</label>
            <input
              type="text"
              value={ownerName}
              onChange={e => setOwnerName(e.target.value)}
              className={fieldInput}
              style={fieldStyle}
              placeholder="Propriétaire"
            />
          </div>

          {/* Owner phone */}
          <div>
            <label className={fieldLabel} style={{ color: '#374151' }}>Contact</label>
            <input
              type="tel"
              value={ownerPhone}
              onChange={e => setOwnerPhone(e.target.value)}
              className={fieldInput}
              style={fieldStyle}
              placeholder="Téléphone"
            />
          </div>
        </div>
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={saving || price <= 0 || (!destinationId && !destinationName)}
        className="w-full py-5 rounded-xl font-bold text-white text-lg disabled:opacity-60 flex items-center justify-center gap-2.5 transition-all active:scale-[0.98]"
        style={{ backgroundColor: '#0B7439' }}
      >
        {saving ? <Loader2 className="w-6 h-6 animate-spin" /> : <Plus className="w-6 h-6" />}
        Enregistrer & Imprimer
      </button>
    </div>
  );
}

// ── SEARCH (ticket search by last 4 chars across all departs) ─────────────────

interface SearchViewProps {
  stationId: string;
  onLink: (result: TicketSearchResult) => void;
}

function resultDepartureNumber(
  depart: DepartRecord | undefined,
  results: TicketSearchResult[],
  ticketId: string,
): string {
  if (depart?.departure_number) return String(depart.departure_number);
  const result = results.find(item => item.ticket.id === ticketId);
  return result?.departureNumber ? String(result.departureNumber) : '—';
}

function resultBusPlate(
  depart: DepartRecord | undefined,
  results: TicketSearchResult[],
  ticketId: string,
): string {
  if (depart?.bus_plate) return depart.bus_plate;
  const result = results.find(item => item.ticket.id === ticketId);
  return result?.busPlate ?? '—';
}

function SearchView({ stationId, onLink }: SearchViewProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TicketSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    const q = query.trim().toLowerCase();
    if (q.length !== 4) return;
    setSearching(true);
    setSearched(false);
    try {
      setResults(await searchTicketsBySuffix(q, stationId));
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
      setSearched(true);
    }
  };

  const handleReprint = async (result: TicketSearchResult) => {
    const { ticket, depart, busPlate } = result;
    if (!depart) return;
    const bagages = await getBagagesForDepart(depart.id);
    const linked = bagages.find(b => b.ticket_number === ticket.ticket_number);
    if (linked) {
      const bagage = {
        ...linked,
        with_ticket: true,
        linked_seat_number: ticket.seat_number,
        car_plate: busPlate ?? ticket.bus_plate ?? depart.bus_plate ?? linked.car_plate,
      };
      PrintService.printTpeBagage({ bagage, depart, stationName: depart.station_name });
    }
  };

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-bold" style={{ color: '#1A2E22' }}>Rechercher un ticket</h2>
      <p className="text-base" style={{ color: '#6B7280' }}>
        Saisissez les 4 derniers caractères du numéro de ticket.
      </p>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
            className="w-full px-4 py-4 rounded-xl border-2 text-lg outline-none transition-colors"
            style={{ borderColor: '#E2EAE5', backgroundColor: 'white' }}
            placeholder="Ex: 4A89"
            maxLength={4}
          />
          <Search className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: '#9CA3AF' }} />
        </div>
        <button
          onClick={handleSearch}
          disabled={query.trim().length !== 4 || searching}
          className="px-6 rounded-xl font-bold text-white text-base disabled:opacity-60 flex items-center gap-2"
          style={{ backgroundColor: '#7C3AED' }}
        >
          {searching ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
          OK
        </button>
      </div>

      {searched && results.length === 0 && (
        <div className="text-center py-14 rounded-xl" style={{ backgroundColor: 'white', border: '1px solid #E2EAE5' }}>
          <Search className="w-12 h-12 mx-auto mb-3" style={{ color: '#9CA3AF' }} />
          <p className="text-base" style={{ color: '#6B7280' }}>Aucun ticket trouvé</p>
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          {results.map(({ ticket, depart, departureNumber, busPlate }) => (
            <div
              key={ticket.id}
              className="rounded-xl p-4 flex items-center justify-between"
              style={{ backgroundColor: 'white', border: '1px solid #E2EAE5' }}
            >
              <button
                onClick={() => onLink(results.find(r => r.ticket.id === ticket.id)!)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="text-base font-bold truncate" style={{ color: '#1A2E22' }}>
                  {ticket.ticket_number} — Siège {ticket.seat_number}
                </p>
                <p className="text-sm truncate" style={{ color: '#6B7280' }}>
                  {ticket.destination || 'Destination non renseignée'} · {ticket.passenger_name || 'Passager non renseigné'}
                </p>
                <p className="text-sm mt-1 truncate" style={{ color: '#6B7280' }}>
                  Départ #{departureNumber ?? resultDepartureNumber(depart, results, ticket.id)} · Siège {ticket.seat_number || '—'} · Car {busPlate ?? resultBusPlate(depart, results, ticket.id)}
                </p>
              </button>
              <div className="flex items-center gap-2.5 flex-shrink-0">
                <span className="text-base font-bold" style={{ color: '#0B7439' }}>
                  {formatCurrency(ticket.price)}
                </span>
                <button
                  onClick={() => onLink(results.find(r => r.ticket.id === ticket.id)!)}
                  className="flex items-center justify-center w-11 h-11 rounded-lg transition-colors hover:bg-[#D1FAE5]"
                  style={{ backgroundColor: '#D1FAE5', color: '#0B7439' }}
                  aria-label="Enregistrer bagage"
                >
                  <Luggage className="w-5 h-5" />
                </button>
                {depart && (
                  <button
                    onClick={() => handleReprint({ ticket, depart, departureNumber, busPlate })}
                    className="flex items-center justify-center w-11 h-11 rounded-lg transition-colors hover:bg-[#F4F7F5]"
                    style={{ backgroundColor: '#E2EAE5', color: '#0B7439' }}
                    aria-label="Réimprimer"
                  >
                    <Printer className="w-5 h-5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── LINK (register baggage from a found ticket) ──────────────────────────────

interface LinkViewProps {
  result: TicketSearchResult;
  session: ReturnType<typeof usePOSSession>['session'];
  onDone: () => void;
  onBack: () => void;
}

function LinkView({ result, session, onDone, onBack }: LinkViewProps) {
  const { ticket, depart, departureNumber, busPlate, routeId, routeName } = result;
  const [stations, setStations] = useState<StationRef[]>([]);
  const [destinationId, setDestinationId] = useState('');
  const [destinationName, setDestinationName] = useState(ticket.destination ?? '');
  const [price, setPrice] = useState(0);
  const [declaredValue, setDeclaredValue] = useState(0);
  const [description, setDescription] = useState('');
  const [ownerName, setOwnerName] = useState(ticket.passenger_name ?? '');
  const [ownerPhone, setOwnerPhone] = useState(ticket.passenger_phone ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    getStations().then(setStations).catch(() => {});
  }, []);

  // Try to pre-select destination matching the ticket destination text
  useEffect(() => {
    if (ticket.destination && stations.length > 0) {
      const match = stations.find(s =>
        s.name.toLowerCase().includes(ticket.destination.toLowerCase()) ||
        ticket.destination.toLowerCase().includes(s.name.toLowerCase()),
      );
      if (match) {
        setDestinationId(match.id);
        setDestinationName(match.name);
      }
    }
  }, [stations, ticket.destination]);

  // Auto-calculate baggage price from tarif when destination changes
  useEffect(() => {
    if (!routeId || !destinationId) return;
    (async () => {
      const tarif = await getTarifForDestination(routeId, destinationId);
      if (tarif && tarif.price > 0) {
        setPrice(tarif.price);
      }
    })();
  }, [routeId, destinationId]);

  const handleSubmit = async () => {
    if (price <= 0) { setError('Veuillez saisir un prix valide'); return; }
    if (!destinationId && !destinationName) { setError('Veuillez sélectionner une destination'); return; }

    setError('');
    setSuccess('');
    setSaving(true);
    try {
      const station = stations.find(s => s.id === destinationId);
      const destName = station?.name ?? destinationName;

      // Ensure a local depart record exists so registerBagage can proceed.
      // For online tickets the depart may not be cached locally.
      let localDepart = depart;
      if (!localDepart) {
        const { db: idb } = await import('@/services/pos/db');
        const today = new Date().toISOString().slice(0, 10);
        const stub: DepartRecord = {
          id: ticket.depart_id,
          departure_number: departureNumber ?? 1,
          route_id: routeId ?? '',
          route_name: routeName ?? ticket.destination ?? '',
          route_number: departureNumber ?? 1,
          bus_id: '',
          bus_plate: busPlate ?? '',
          driver_id: '',
          departure_datetime: `${today}T00:00:00`,
          departure_date: today,
          departure_time: '',
          is_ac: false,
          status: 'planifie',
          seats_total: 0,
          seats_from: 1,
          seats_sold: 0,
          station_id: session?.station_id ?? '',
          station_name: session?.station_name,
          cloture: false,
          mt_ticket: 0,
          mt_bagage: 0,
          tot_depense: 0,
          solde: 0,
          caisse: 0,
          breakdown_transfer: 0,
          confirmed: false,
          cancelled: false,
        };
        await idb.departs.put(stub);
        localDepart = stub;
      }

      const isDeferred = session?.tpe_mode === 'avec_guichet';
      const bagage = await registerBagage({
        departId: localDepart.id,
        withTicket: true,
        withTicketReport: false,
        ticketNumber: ticket.ticket_number,
        busPlate: busPlate ?? depart?.bus_plate,
        linkedSeatNumber: ticket.seat_number,
        price,
        destination: destName,
        description: description,
        declaredValue,
        ownerName,
        ownerPhone,
        printBagage: true,
        paymentStatus: isDeferred ? 'en_attente' : 'paye',
      });

      PrintService.printTpeBagage({
        bagage,
        depart: localDepart,
        stationName: session?.station_name,
      });

      setSuccess(isDeferred
        ? `Bagage enregistré en attente — ${bagage.bagage_number}`
        : `Bagage enregistré — ${bagage.bagage_number}`);
      setTimeout(() => onDone(), 2000);
    } catch (err: any) {
      setError(err?.message ?? 'Erreur lors de l\'enregistrement');
    } finally {
      setSaving(false);
    }
  };

  const fieldLabel = 'block text-sm font-bold mb-1.5';
  const fieldInput = 'w-full px-4 py-3.5 rounded-xl border-2 text-base outline-none transition-colors';
  const fieldStyle = { borderColor: '#E2EAE5', backgroundColor: 'white' };

  return (
    <div className="space-y-5">
      {/* Trip info from the found ticket */}
      <div className="rounded-xl p-5" style={{ backgroundColor: '#EDE9FE', border: '1px solid #C4B5FD' }}>
        <div className="flex items-center gap-2.5 mb-3">
          <TicketIcon className="w-5 h-5" style={{ color: '#7C3AED' }} />
          <span className="text-base font-bold" style={{ color: '#5B21B6' }}>Ticket BUS</span>
        </div>
        <p className="text-lg font-bold" style={{ color: '#1A2E22' }}>{ticket.ticket_number}</p>
        <div className="grid grid-cols-2 gap-2 mt-3 text-sm" style={{ color: '#4C1D95' }}>
          <p><span className="font-bold">Départ:</span> #{departureNumber ?? '—'}</p>
          <p><span className="font-bold">Siège:</span> {ticket.seat_number || '—'}</p>
          <p><span className="font-bold">Destination:</span> {ticket.destination || '—'}</p>
          <p><span className="font-bold">Car:</span> {busPlate ?? '—'}</p>
          <p className="col-span-2"><span className="font-bold">Passager:</span> {ticket.passenger_name || '—'}</p>
          {ticket.passenger_phone && (
            <p className="col-span-2"><span className="font-bold">Contact:</span> {ticket.passenger_phone}</p>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl px-4 py-3 flex items-start gap-2.5 text-base" style={{ backgroundColor: '#FEF2F2', color: '#DC2626' }}>
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="rounded-xl px-4 py-3 flex items-center gap-2.5 text-base font-medium" style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>
          <CheckCircle className="w-5 h-5 flex-shrink-0" /> {success}
        </div>
      )}

      {/* Baggage form */}
      <div className="rounded-xl p-5 space-y-4" style={{ backgroundColor: 'white', border: '1px solid #E2EAE5' }}>
        <div className="grid grid-cols-2 gap-4">
          {/* Destination */}
          <div className="col-span-2">
            <label className={fieldLabel} style={{ color: '#374151' }}>Destination</label>
            <select
              value={destinationId}
              onChange={e => {
                setDestinationId(e.target.value);
                const st = stations.find(s => s.id === e.target.value);
                setDestinationName(st?.name ?? '');
              }}
              className={fieldInput}
              style={fieldStyle}
            >
              <option value="">{ticket.destination || 'Sélectionner...'}</option>
              {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          {/* Price */}
          <div>
            <label className={fieldLabel} style={{ color: '#374151' }}>Montant à payer (FCFA)</label>
            <div className="relative">
              <input
                type="number"
                min={0}
                value={price || ''}
                onChange={e => setPrice(parseInt(e.target.value) || 0)}
                className={fieldInput}
                style={fieldStyle}
                placeholder="0"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold" style={{ color: '#9CA3AF' }}>F</span>
            </div>
          </div>

          {/* Declared value */}
          <div>
            <label className={fieldLabel} style={{ color: '#374151' }}>Valeur déclarée (FCFA)</label>
            <div className="relative">
              <input
                type="number"
                min={0}
                value={declaredValue || ''}
                onChange={e => setDeclaredValue(parseInt(e.target.value) || 0)}
                className={fieldInput}
                style={fieldStyle}
                placeholder="0"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold" style={{ color: '#9CA3AF' }}>F</span>
            </div>
          </div>

          {/* Description */}
          <div className="col-span-2">
            <label className={fieldLabel} style={{ color: '#374151' }}>Description du bagage</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              className={fieldInput}
              style={fieldStyle}
              placeholder="Ex: 1 sac, 1 valise..."
            />
          </div>

          {/* Owner name */}
          <div>
            <label className={fieldLabel} style={{ color: '#374151' }}>Nom et prénoms du client</label>
            <input
              type="text"
              value={ownerName}
              onChange={e => setOwnerName(e.target.value)}
              className={fieldInput}
              style={fieldStyle}
              placeholder="Propriétaire"
            />
          </div>

          {/* Owner phone */}
          <div>
            <label className={fieldLabel} style={{ color: '#374151' }}>Contact</label>
            <input
              type="tel"
              value={ownerPhone}
              onChange={e => setOwnerPhone(e.target.value)}
              className={fieldInput}
              style={fieldStyle}
              placeholder="Téléphone"
            />
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-4">
        <button
          onClick={onBack}
          disabled={saving}
          className="flex-1 py-5 rounded-xl font-bold text-base flex items-center justify-center gap-2.5 transition-all active:scale-[0.98] disabled:opacity-60"
          style={{ backgroundColor: '#F4F7F5', color: '#6B7280', border: '1px solid #E2EAE5' }}
        >
          <ArrowLeft className="w-6 h-6" />
          Retour
        </button>
        <button
          onClick={handleSubmit}
          disabled={saving || price <= 0 || (!destinationId && !destinationName)}
          className="flex-[2] py-5 rounded-xl font-bold text-white text-lg disabled:opacity-60 flex items-center justify-center gap-2.5 transition-all active:scale-[0.98]"
          style={{ backgroundColor: '#0B7439' }}
        >
          {saving ? <Loader2 className="w-6 h-6 animate-spin" /> : <CheckCircle className="w-6 h-6" />}
          Valider
        </button>
        <button
          onClick={handleSubmit}
          disabled={saving || price <= 0 || (!destinationId && !destinationName)}
          className="flex-1 py-5 rounded-xl font-bold text-white text-base disabled:opacity-60 flex items-center justify-center gap-2.5 transition-all active:scale-[0.98]"
          style={{ backgroundColor: '#1D6FA4' }}
        >
          <Printer className="w-6 h-6" />
          Imprimer
        </button>
      </div>
    </div>
  );
}

// ── HISTORY ───────────────────────────────────────────────────────────────────

interface HistoryViewProps {
  session: ReturnType<typeof usePOSSession>['session'];
  onOpenDetail: (b: BagageRecord) => void;
}

function HistoryView({ session, onOpenDetail }: HistoryViewProps) {
  const [bagages, setBagages] = useState<BagageRecord[]>([]);
  const [departs, setDeparts] = useState<Map<string, DepartRecord>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const allBagages = await getAll<BagageRecord>('bagages');
        const allDeparts = await getAll<DepartRecord>('departs');
        const departMap = new Map(allDeparts.map(d => [d.id, d]));
        setDeparts(departMap);

        // Filter: today + this station
        const today = new Date().toISOString().slice(0, 10);
        const todayBagages = allBagages
          .filter(b => b.description !== '__deleted__' && b.created_at.slice(0, 10) === today)
          .filter(b => {
            const dep = departMap.get(b.depart_id);
            return dep?.station_id === session?.station_id;
          })
          .sort((a, b) => b.created_at.localeCompare(a.created_at));
        setBagages(todayBagages);
      } catch {
        // non-critical
      } finally {
        setLoading(false);
      }
    })();
  }, [session?.station_id]);

  const totalRevenue = useMemo(() =>
    bagages.filter(b => b.payment_status !== 'en_attente').reduce((sum, b) => sum + b.price, 0), [bagages]);

  const handleReprint = (bagage: BagageRecord) => {
    const depart = departs.get(bagage.depart_id);
    if (!depart) return;
    PrintService.printTpeBagage({ bagage, depart, stationName: session?.station_name });
  };

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-bold" style={{ color: '#1A2E22' }}>Historique bagages</h2>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl p-5" style={{ backgroundColor: 'white', border: '1px solid #E2EAE5' }}>
          <div className="flex items-center gap-2.5 mb-1.5">
            <Package className="w-5 h-5" style={{ color: '#0B7439' }} />
            <span className="text-sm font-bold" style={{ color: '#6B7280' }}>Bagages</span>
          </div>
          <p className="text-3xl font-bold" style={{ color: '#1A2E22' }}>{bagages.length}</p>
        </div>
        <div className="rounded-xl p-5" style={{ backgroundColor: 'white', border: '1px solid #E2EAE5' }}>
          <div className="flex items-center gap-2.5 mb-1.5">
            <Luggage className="w-5 h-5" style={{ color: '#7C3AED' }} />
            <span className="text-sm font-bold" style={{ color: '#6B7280' }}>Recettes</span>
          </div>
          <p className="text-3xl font-bold" style={{ color: '#0B7439' }}>{formatCurrency(totalRevenue)}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-14">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: '#0B7439' }} />
        </div>
      ) : bagages.length === 0 ? (
        <div className="text-center py-14 rounded-xl" style={{ backgroundColor: 'white', border: '1px solid #E2EAE5' }}>
          <Luggage className="w-12 h-12 mx-auto mb-3" style={{ color: '#9CA3AF' }} />
          <p className="text-base" style={{ color: '#6B7280' }}>Aucun bagage enregistré aujourd'hui</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bagages.map(b => {
            const depart = departs.get(b.depart_id);
            return (
              <div
                key={b.id}
                className="rounded-xl p-4 flex items-center justify-between"
                style={{ backgroundColor: 'white', border: '1px solid #E2EAE5' }}
              >
                <button
                  onClick={() => onOpenDetail(b)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="text-base font-bold truncate" style={{ color: '#1A2E22' }}>
                    {b.bagage_number}
                  </p>
                  <p className="text-sm truncate" style={{ color: '#6B7280' }}>
                    {b.destination} · {b.owner_name || '—'}
                  </p>
                  {depart && (
                    <p className="text-sm mt-1 truncate" style={{ color: '#9CA3AF' }}>
                      Départ #{depart.route_number} · {depart.bus_plate}
                    </p>
                  )}
                  {b.with_ticket && (
                    <span className="inline-flex items-center gap-1 mt-1.5 text-sm font-bold" style={{ color: '#7C3AED' }}>
                      <Link2 className="w-4 h-4" /> {b.ticket_number}
                    </span>
                  )}
                </button>
                <div className="flex items-center gap-2.5 flex-shrink-0">
                  <span className="text-base font-bold" style={{ color: '#0B7439' }}>
                    {formatCurrency(b.price)}
                  </span>
                  {depart && (
                    <button
                      onClick={() => handleReprint(b)}
                      className="flex items-center justify-center w-11 h-11 rounded-lg transition-colors hover:bg-[#F4F7F5]"
                      style={{ backgroundColor: '#D1FAE5', color: '#0B7439' }}
                      aria-label="Réimprimer"
                    >
                      <Printer className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── BAGAGE DETAIL ─────────────────────────────────────────────────────────────

interface BagageDetailViewProps {
  bagage: BagageRecord;
  session: ReturnType<typeof usePOSSession>['session'];
  onBack: () => void;
}

function BagageDetailView({ bagage, session, onBack }: BagageDetailViewProps) {
  const [depart, setDepart] = useState<DepartRecord | null>(null);
  const [ticket, setTicket] = useState<TicketRecord | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const d = await getDepartById(bagage.depart_id);
        if (d) setDepart(d);
        if (bagage.with_ticket && bagage.ticket_number) {
          const tickets = await getTicketsForDepart(bagage.depart_id);
          const linked = tickets.find(t => t.ticket_number === bagage.ticket_number);
          if (linked) setTicket(linked);
        }
      } catch {
        // non-critical
      } finally {
        setLoading(false);
      }
    })();
  }, [bagage]);

  const handleReprint = () => {
    if (!depart) return;
    PrintService.printTpeBagage({ bagage, depart, stationName: session?.station_name });
  };

  const formatDateTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString('fr-FR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: '#0B7439' }} />
      </div>
    );
  }

  const departStatus = depart?.status || '—';
  const statusLabel: Record<string, string> = {
    planifie: 'Planifié',
    en_cours: 'En cours',
    termine: 'Terminé',
    annule: 'Annulé',
    convoi: 'Convoi',
    retard: 'Retard',
  };

  return (
    <div className="space-y-5">
      {/* Header card */}
      <div
        className="rounded-2xl p-5"
        style={{ background: 'linear-gradient(135deg, #0B7439 0%, #0E8D44 100%)', color: 'white' }}
      >
        <div className="flex items-center gap-3 mb-2">
          <Luggage className="w-7 h-7" strokeWidth={2.2} />
          <h2 className="text-xl font-bold">Fiche bagage</h2>
        </div>
        <p className="text-lg font-bold">{bagage.bagage_number}</p>
        {bagage.with_ticket && bagage.ticket_number && (
          <div className="flex items-center gap-2 mt-2">
            <Link2 className="w-4 h-4" />
            <span className="text-sm font-medium opacity-95">Ticket lié : {bagage.ticket_number}</span>
          </div>
        )}
      </div>

      {/* Ticket & reference info */}
      <DetailSection title="Ticket et référence" icon={TicketIcon}>
        <DetailRow label="N° bagage" value={bagage.bagage_number} />
        <DetailRow label="N° ticket" value={bagage.with_ticket ? (bagage.ticket_number || '—') : 'Sans ticket'} />
        {bagage.linked_seat_number != null && (
          <DetailRow label="Siège lié" value={String(bagage.linked_seat_number)} />
        )}
        {ticket && (
          <>
            <DetailRow label="Réf. ticket" value={ticket.ticket_number} />
            <DetailRow label="Prix ticket" value={formatCurrency(ticket.price)} />
          </>
        )}
      </DetailSection>

      {/* Sender & recipient */}
      <DetailSection title="Expéditeur et destinataire" icon={User}>
        <DetailRow label="Nom du propriétaire" value={bagage.owner_name || 'Non renseigné'} />
        <DetailRow label="Contact" value={bagage.owner_phone || 'Non renseigné'} />
        {ticket && (
          <>
            <DetailRow label="Passager (ticket)" value={ticket.passenger_name || 'Non renseigné'} />
            <DetailRow label="Contact passager" value={ticket.passenger_phone || 'Non renseigné'} />
          </>
        )}
      </DetailSection>

      {/* Trip info */}
      <DetailSection title="Voyage" icon={MapPin}>
        <DetailRow label="Gare de départ" value={depart?.station_name || session?.station_name || '—'} />
        <DetailRow label="Destination" value={bagage.destination || '—'} />
        {depart && (
          <>
            <DetailRow label="Itinéraire" value={depart.route_name || '—'} />
            <DetailRow label="N° départ" value={`#${depart.route_number}`} />
            <DetailRow label="Immatriculation" value={depart.bus_plate || bagage.car_plate || '—'} />
            <DetailRow label="Chauffeur" value={depart.driver_name || '—'} />
            <DetailRow label="Date/heure départ" value={depart.departure_datetime ? formatDateTime(depart.departure_datetime) : '—'} />
            <DetailRow label="Statut départ" value={statusLabel[departStatus] ?? departStatus} />
          </>
        )}
      </DetailSection>

      {/* Bagage description */}
      <DetailSection title="Description du bagage" icon={FileText}>
        <DetailRow label="Description" value={bagage.description || 'Non renseignée'} />
        <DetailRow label="Avec ticket" value={bagage.with_ticket ? 'Oui' : 'Non'} />
      </DetailSection>

      {/* Financial info */}
      <DetailSection title="Informations financières" icon={Tag}>
        <DetailRow label="Montant payé" value={formatCurrency(bagage.price)} />
        <DetailRow label="Valeur déclarée" value={bagage.declared_value ? formatCurrency(bagage.declared_value) : 'Non déclarée'} />
      </DetailSection>

      {/* Agent & timestamps */}
      <DetailSection title="Enregistrement" icon={Calendar}>
        <DetailRow label="Agent" value={session?.full_name || '—'} />
        <DetailRow label="Gare" value={session?.station_name || '—'} />
        <DetailRow label="Date/heure" value={formatDateTime(bagage.created_at)} />
      </DetailSection>

      {/* Action buttons */}
      <div className="flex gap-4">
        <button
          onClick={onBack}
          className="flex-1 py-5 rounded-xl font-bold text-base flex items-center justify-center gap-2.5 transition-all active:scale-[0.98]"
          style={{ backgroundColor: '#F4F7F5', color: '#6B7280', border: '1px solid #E2EAE5' }}
        >
          <ArrowLeft className="w-6 h-6" />
          Retour à l'historique
        </button>
        {depart && (
          <button
            onClick={handleReprint}
            className="flex-1 py-5 rounded-xl font-bold text-white text-base flex items-center justify-center gap-2.5 transition-all active:scale-[0.98]"
            style={{ backgroundColor: '#0B7439' }}
          >
            <Printer className="w-6 h-6" />
            Imprimer le reçu
          </button>
        )}
      </div>
    </div>
  );
}

function DetailSection({ title, icon: Icon, children }: { title: string; icon: typeof FileText; children: ReactNode }) {
  return (
    <div className="rounded-xl p-5" style={{ backgroundColor: 'white', border: '1px solid #E2EAE5' }}>
      <div className="flex items-center gap-2.5 mb-4">
        <Icon className="w-5 h-5" style={{ color: '#0B7439' }} />
        <h3 className="text-base font-bold" style={{ color: '#1A2E22' }}>{title}</h3>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-0.5 sm:gap-3">
      <span className="text-sm font-medium flex-shrink-0" style={{ color: '#6B7280' }}>{label}</span>
      <span className="text-sm font-bold text-right sm:text-right break-words min-w-0" style={{ color: '#1A2E22' }}>{value}</span>
    </div>
  );
}