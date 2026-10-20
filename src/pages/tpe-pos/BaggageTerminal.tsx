import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Luggage, Search, Printer, Plus, CheckCircle, AlertCircle,
  Loader2, Wifi, WifiOff, RefreshCw, LogOut, ArrowLeft,
  Ticket as TicketIcon, Link2, History, Package, X,
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

type View = 'home' | 'register' | 'search' | 'link' | 'history';

export default function BaggageTerminal() {
  const navigate = useNavigate();
  const { session, logout, refresh, loading: sessionLoading } = usePOSSession();
  const { status, syncing, pendingCount, bannerLabel } = useConnection();
  useAutoSync(session?.station_id);

  const [view, setView] = useState<View>('home');
  const [linkResult, setLinkResult] = useState<TicketSearchResult | null>(null);
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
        className="px-4 py-3 sticky top-0 z-30 flex items-center justify-between"
        style={{ backgroundColor: '#0B7439', color: 'white' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {view !== 'home' && (
            <button
              onClick={() => setView('home')}
              className="flex items-center justify-center w-10 h-10 rounded-lg flex-shrink-0 transition-colors hover:bg-white/15"
              aria-label="Retour"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div className="min-w-0">
            <p className="text-sm font-bold leading-tight truncate">SBTA · TPE Bagage</p>
            <p className="text-xs opacity-80 leading-tight truncate">
              {session?.station_name ?? 'Gare'} — {session?.full_name ?? 'Agent'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold"
            style={{ backgroundColor: connColor }}
          >
            <connIcon className={`w-3.5 h-3.5 ${connAnimate ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">
              {pendingCount > 0 ? `${pendingCount} en attente` : status === 'offline' ? 'Hors ligne' : 'En ligne'}
            </span>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center justify-center w-10 h-10 rounded-lg transition-colors hover:bg-white/15"
            aria-label="Déconnexion"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Connection banner */}
      <div
        className="flex items-center gap-2 px-4 py-1.5 text-xs font-medium text-white"
        style={{ backgroundColor: connColor }}
      >
        <connIcon className={`w-3.5 h-3.5 flex-shrink-0 ${connAnimate ? 'animate-spin' : ''}`} />
        <span className="truncate">{bannerLabel}</span>
      </div>

      {/* Main content */}
      <main className="flex-1 px-4 py-4 sm:px-6 max-w-2xl mx-auto w-full">
        {sessionLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: '#0B7439' }} />
          </div>
        ) : !session || session.role !== 'bagagiste' ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <AlertCircle className="w-10 h-10 mb-3" style={{ color: '#DC2626' }} />
            <p className="text-sm font-medium" style={{ color: '#6B7280' }}>
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
              <HistoryView session={session} />
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
    <div className="space-y-6">
      {/* SBTA brand block */}
      <div
        className="rounded-2xl p-5 text-center"
        style={{ background: 'linear-gradient(135deg, #0B7439 0%, #0E8D44 100%)', color: 'white' }}
      >
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-2" style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}>
          <Luggage className="w-8 h-8" strokeWidth={2.5} />
        </div>
        <h1 className="text-xl font-bold leading-tight">Terminal Bagage TPE</h1>
        <p className="text-sm font-semibold opacity-95 mt-1">{bagagisteName}</p>
        <p className="text-xs opacity-85 mt-0.5">
          {stationName}{companyName ? ` · ${companyName}` : ''}
        </p>
      </div>

      {/* Departure count indicator */}
      <div className="rounded-xl p-3 flex items-center justify-between" style={{ backgroundColor: 'white', border: '1px solid #E2EAE5' }}>
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4" style={{ color: '#0B7439' }} />
          <span className="text-xs font-bold" style={{ color: '#6B7280' }}>Départs actifs aujourd'hui</span>
        </div>
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#0B7439' }} />
        ) : (
          <span className="text-sm font-bold" style={{ color: '#0B7439' }}>{departs.length}</span>
        )}
      </div>

      {/* Action tiles — large, TPE-friendly */}
      <div className="grid grid-cols-1 gap-4">
        {tiles.map(tile => {
          const Icon = tile.icon;
          return (
            <button
              key={tile.view}
              onClick={() => onSelectView(tile.view)}
              className="flex items-center gap-4 p-5 rounded-2xl border-2 transition-all active:scale-[0.98] hover:shadow-md min-h-[88px]"
              style={{ backgroundColor: 'white', borderColor: '#E2EAE5' }}
            >
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: tile.bg, color: tile.color }}
              >
                <Icon className="w-7 h-7" strokeWidth={2.2} />
              </div>
              <div className="text-left min-w-0">
                <p className="text-base font-bold leading-tight" style={{ color: '#1A2E22' }}>{tile.label}</p>
                <p className="text-xs mt-0.5" style={{ color: '#6B7280' }}>
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
      const bagage = await registerBagage({
        departId: selectedDepart.id,
        withTicket,
        withTicketReport: false,
        ticketNumber: linkedTicket?.ticket_number,
        busPlate: ticketBusPlate || selectedDepart.bus_plate,
        price,
        destination: destName,
        description: declaredValue > 0
          ? `${description}${description ? ' · ' : ''}Valeur déclarée : ${formatCurrency(declaredValue)}`
          : description,
        ownerName,
        ownerPhone,
        printBagage: true,
      });

      PrintService.printBagage({
        bagage,
        depart: selectedDepart,
        stationName: session?.station_name,
      });

      setSuccess(`Bagage enregistré — ${bagage.bagage_number}`);

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

  const fieldLabel = 'block text-xs font-bold mb-1';
  const fieldInput = 'w-full px-3 py-2.5 rounded-lg border-2 text-sm outline-none transition-colors';
  const fieldStyle = { borderColor: '#E2EAE5', backgroundColor: 'white' };

  // Step 1: select depart
  if (!selectedDepart) {
    return (
      <div className="space-y-3">
        <h2 className="text-lg font-bold" style={{ color: '#1A2E22' }}>Sélectionner un départ</h2>
        {departs.length === 0 ? (
          <div className="text-center py-12 rounded-xl" style={{ backgroundColor: 'white', border: '1px solid #E2EAE5' }}>
            <Package className="w-10 h-10 mx-auto mb-2" style={{ color: '#9CA3AF' }} />
            <p className="text-sm" style={{ color: '#6B7280' }}>Aucun départ actif aujourd'hui</p>
          </div>
        ) : (
          <div className="space-y-2">
            {departs.map(d => (
              <button
                key={d.id}
                onClick={() => setSelectedDepart(d)}
                className="w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all active:scale-[0.98] hover:shadow-sm text-left"
                style={{ backgroundColor: 'white', borderColor: '#E2EAE5' }}
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold truncate" style={{ color: '#1A2E22' }}>
                    Départ #{d.route_number} — {d.route_name}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: '#6B7280' }}>
                    {d.bus_plate} · {d.departure_time}
                  </p>
                </div>
                <ArrowLeft className="w-5 h-5 rotate-180 flex-shrink-0" style={{ color: '#0B7439' }} />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Step 2: baggage form
  return (
    <div className="space-y-4">
      {/* Depart summary */}
      <div
        className="rounded-xl p-3 flex items-center justify-between"
        style={{ backgroundColor: '#0B7439', color: 'white' }}
      >
        <div className="min-w-0">
          <p className="text-sm font-bold truncate">Départ #{selectedDepart.route_number}</p>
          <p className="text-xs opacity-85 truncate">{selectedDepart.route_name} · {selectedDepart.bus_plate}</p>
        </div>
        <button
          onClick={() => setSelectedDepart(null)}
          className="flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0 transition-colors hover:bg-white/15"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="rounded-xl px-3 py-2.5 flex items-start gap-2 text-sm" style={{ backgroundColor: '#FEF2F2', color: '#DC2626' }}>
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="rounded-xl px-3 py-2.5 flex items-center gap-2 text-sm font-medium" style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>
          <CheckCircle className="w-4 h-4 flex-shrink-0" /> {success}
        </div>
      )}

      {/* Ticket linking */}
      <div className="rounded-xl p-4" style={{ backgroundColor: 'white', border: '1px solid #E2EAE5' }}>
        <label className="flex items-center gap-2 cursor-pointer mb-3">
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
            className="w-5 h-5"
            style={{ accentColor: '#0B7439' }}
          />
          <span className="text-sm font-bold" style={{ color: '#1A2E22' }}>Avec ticket (lier à un passager)</span>
        </label>

        {withTicket && (
          <div>
            <label className={fieldLabel} style={{ color: '#6B7280' }}>
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
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#9CA3AF' }} />
            </div>
            {ticketSearching && (
              <p className="text-xs mt-2" style={{ color: '#6B7280' }}>Recherche en cours...</p>
            )}
            {ticketResults.length > 0 && (
              <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
                {ticketResults.map(t => (
                  <button
                    key={t.id}
                    onClick={() => handleSelectTicket(t)}
                    className="w-full flex items-center gap-2 p-2.5 rounded-lg border text-left transition-colors hover:bg-[#F4F7F5]"
                    style={{ borderColor: '#E2EAE5', backgroundColor: '#FAFBFA' }}
                  >
                    <TicketIcon className="w-4 h-4 flex-shrink-0" style={{ color: '#7C3AED' }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold truncate" style={{ color: '#1A2E22' }}>
                        {t.ticket_number} — Siège {t.seat_number}
                      </p>
                      <p className="text-xs truncate" style={{ color: '#6B7280' }}>
                        {t.destination} · {t.passenger_name}
                      </p>
                    </div>
                    <span className="text-xs font-bold flex-shrink-0" style={{ color: '#0B7439' }}>
                      {formatCurrency(t.price)}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {ticketSearch.trim().length === 4 && ticketResults.length === 0 && !linkedTicket && !ticketSearching && (
              <p className="text-xs mt-2" style={{ color: '#9CA3AF' }}>Aucun ticket trouvé pour ce départ</p>
            )}
            {linkedTicket && (
              <div className="mt-3 rounded-xl p-3 space-y-2" style={{ backgroundColor: '#F3F0FF', border: '1px solid #C4B5FD' }}>
                <div className="flex items-start gap-2">
                  <Link2 className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#7C3AED' }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold truncate" style={{ color: '#5B21B6' }}>
                      Ticket sélectionné : {linkedTicket.ticket_number}
                    </p>
                    <p className="text-xs mt-1" style={{ color: '#6D28D9' }}>
                      Siège {linkedTicket.seat_number || '—'} · Destination {linkedTicket.destination || '—'}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: '#6D28D9' }}>
                      Passager : {linkedTicket.passenger_name || 'Non renseigné'} · Car {selectedDepart.bus_plate || '—'}
                    </p>
                  </div>
                  <button
                    onClick={() => { setLinkedTicket(null); setTicketBusPlate(''); setTicketSearch(''); }}
                    className="flex-shrink-0"
                    aria-label="Désélectionner le ticket"
                  >
                    <X className="w-4 h-4" style={{ color: '#7C3AED' }} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bagage form */}
      <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'white', border: '1px solid #E2EAE5' }}>
        <div className="grid grid-cols-2 gap-3">
          {/* Destination */}
          <div className="col-span-2">
            <label className={fieldLabel} style={{ color: '#6B7280' }}>Destination</label>
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
            <label className={fieldLabel} style={{ color: '#6B7280' }}>Valeur déclarée (FCFA)</label>
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
            <label className={fieldLabel} style={{ color: '#6B7280' }}>Immatriculation</label>
            <input
              type="text"
              value={ticketBusPlate || selectedDepart.bus_plate || ''}
              disabled
              className={fieldInput}
              style={{ ...fieldStyle, opacity: 0.7 }}
            />
          </div>
          <div>
            <label className={fieldLabel} style={{ color: '#6B7280' }}>Siège</label>
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
            <label className={fieldLabel} style={{ color: '#6B7280' }}>Montant à payer (FCFA)</label>
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
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold" style={{ color: '#9CA3AF' }}>F</span>
            </div>
          </div>

          {/* Description */}
          <div className="col-span-2">
            <label className={fieldLabel} style={{ color: '#6B7280' }}>Description</label>
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
            <label className={fieldLabel} style={{ color: '#6B7280' }}>Nom et prénoms</label>
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
            <label className={fieldLabel} style={{ color: '#6B7280' }}>Contact</label>
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
        className="w-full py-4 rounded-xl font-bold text-white text-base disabled:opacity-60 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
        style={{ backgroundColor: '#0B7439' }}
      >
        {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
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

  const handleReprint = async (ticket: TicketRecord, depart: DepartRecord | undefined) => {
    if (!depart) return;
    const bagages = await getBagagesForDepart(depart.id);
    const linked = bagages.find(b => b.ticket_number === ticket.ticket_number);
    if (linked) {
      PrintService.printBagage({ bagage: linked, depart, stationName: depart.station_name });
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold" style={{ color: '#1A2E22' }}>Rechercher un ticket</h2>
      <p className="text-sm" style={{ color: '#6B7280' }}>
        Saisissez les 4 derniers caractères du numéro de ticket.
      </p>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
            className="w-full px-4 py-3 rounded-xl border-2 text-base outline-none transition-colors"
            style={{ borderColor: '#E2EAE5', backgroundColor: 'white' }}
            placeholder="Ex: 4A89"
            maxLength={4}
          />
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: '#9CA3AF' }} />
        </div>
        <button
          onClick={handleSearch}
          disabled={query.trim().length !== 4 || searching}
          className="px-5 rounded-xl font-bold text-white text-sm disabled:opacity-60 flex items-center gap-2"
          style={{ backgroundColor: '#7C3AED' }}
        >
          {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          OK
        </button>
      </div>

      {searched && results.length === 0 && (
        <div className="text-center py-12 rounded-xl" style={{ backgroundColor: 'white', border: '1px solid #E2EAE5' }}>
          <Search className="w-10 h-10 mx-auto mb-2" style={{ color: '#9CA3AF' }} />
          <p className="text-sm" style={{ color: '#6B7280' }}>Aucun ticket trouvé</p>
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-2">
          {results.map(({ ticket, depart, departureNumber, busPlate }) => (
            <div
              key={ticket.id}
              className="rounded-xl p-3 flex items-center justify-between"
              style={{ backgroundColor: 'white', border: '1px solid #E2EAE5' }}
            >
              <button
                onClick={() => onLink(results.find(r => r.ticket.id === ticket.id)!)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="text-sm font-bold truncate" style={{ color: '#1A2E22' }}>
                  {ticket.ticket_number} — Siège {ticket.seat_number}
                </p>
                <p className="text-xs truncate" style={{ color: '#6B7280' }}>
                  {ticket.destination || 'Destination non renseignée'} · {ticket.passenger_name || 'Passager non renseigné'}
                </p>
                <p className="text-xs mt-0.5 truncate" style={{ color: '#6B7280' }}>
                  Départ #{departureNumber ?? resultDepartureNumber(depart, results, ticket.id)} · Siège {ticket.seat_number || '—'} · Car {busPlate ?? resultBusPlate(depart, results, ticket.id)}
                </p>
              </button>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-sm font-bold" style={{ color: '#0B7439' }}>
                  {formatCurrency(ticket.price)}
                </span>
                <button
                  onClick={() => onLink(results.find(r => r.ticket.id === ticket.id)!)}
                  className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors hover:bg-[#D1FAE5]"
                  style={{ backgroundColor: '#D1FAE5', color: '#0B7439' }}
                  aria-label="Enregistrer bagage"
                >
                  <Luggage className="w-4 h-4" />
                </button>
                {depart && (
                  <button
                    onClick={() => handleReprint(ticket, depart)}
                    className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors hover:bg-[#F4F7F5]"
                    style={{ backgroundColor: '#E2EAE5', color: '#0B7439' }}
                    aria-label="Réimprimer"
                  >
                    <Printer className="w-4 h-4" />
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

      const bagage = await registerBagage({
        departId: localDepart.id,
        withTicket: true,
        withTicketReport: false,
        ticketNumber: ticket.ticket_number,
        price,
        destination: destName,
        description: declaredValue > 0
          ? `${description}${description ? ' · ' : ''}Valeur déclarée : ${formatCurrency(declaredValue)}`
          : description,
        ownerName,
        ownerPhone,
        printBagage: true,
      });

      PrintService.printBagage({
        bagage,
        depart: localDepart,
        stationName: session?.station_name,
      });

      setSuccess(`Bagage enregistré — ${bagage.bagage_number}`);
      setTimeout(() => onDone(), 2000);
    } catch (err: any) {
      setError(err?.message ?? 'Erreur lors de l\'enregistrement');
    } finally {
      setSaving(false);
    }
  };

  const fieldLabel = 'block text-xs font-bold mb-1';
  const fieldInput = 'w-full px-3 py-2.5 rounded-lg border-2 text-sm outline-none transition-colors';
  const fieldStyle = { borderColor: '#E2EAE5', backgroundColor: 'white' };

  return (
    <div className="space-y-4">
      {/* Trip info from the found ticket */}
      <div className="rounded-xl p-4" style={{ backgroundColor: '#EDE9FE', border: '1px solid #C4B5FD' }}>
        <div className="flex items-center gap-2 mb-2">
          <TicketIcon className="w-4 h-4" style={{ color: '#7C3AED' }} />
          <span className="text-sm font-bold" style={{ color: '#5B21B6' }}>Ticket BUS</span>
        </div>
        <p className="text-base font-bold" style={{ color: '#1A2E22' }}>{ticket.ticket_number}</p>
        <div className="grid grid-cols-2 gap-2 mt-2 text-xs" style={{ color: '#4C1D95' }}>
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
        <div className="rounded-xl px-3 py-2.5 flex items-start gap-2 text-sm" style={{ backgroundColor: '#FEF2F2', color: '#DC2626' }}>
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="rounded-xl px-3 py-2.5 flex items-center gap-2 text-sm font-medium" style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>
          <CheckCircle className="w-4 h-4 flex-shrink-0" /> {success}
        </div>
      )}

      {/* Baggage form */}
      <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'white', border: '1px solid #E2EAE5' }}>
        <div className="grid grid-cols-2 gap-3">
          {/* Destination */}
          <div className="col-span-2">
            <label className={fieldLabel} style={{ color: '#6B7280' }}>Destination</label>
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
            <label className={fieldLabel} style={{ color: '#6B7280' }}>Montant à payer (FCFA)</label>
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
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold" style={{ color: '#9CA3AF' }}>F</span>
            </div>
          </div>

          {/* Declared value */}
          <div>
            <label className={fieldLabel} style={{ color: '#6B7280' }}>Valeur déclarée (FCFA)</label>
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
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold" style={{ color: '#9CA3AF' }}>F</span>
            </div>
          </div>

          {/* Description */}
          <div className="col-span-2">
            <label className={fieldLabel} style={{ color: '#6B7280' }}>Description du bagage</label>
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
            <label className={fieldLabel} style={{ color: '#6B7280' }}>Nom et prénoms du client</label>
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
            <label className={fieldLabel} style={{ color: '#6B7280' }}>Contact</label>
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
      <div className="flex gap-3">
        <button
          onClick={onBack}
          disabled={saving}
          className="flex-1 py-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-60"
          style={{ backgroundColor: '#F4F7F5', color: '#6B7280', border: '1px solid #E2EAE5' }}
        >
          <ArrowLeft className="w-5 h-5" />
          Retour
        </button>
        <button
          onClick={handleSubmit}
          disabled={saving || price <= 0 || (!destinationId && !destinationName)}
          className="flex-[2] py-4 rounded-xl font-bold text-white text-base disabled:opacity-60 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
          style={{ backgroundColor: '#0B7439' }}
        >
          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
          Valider
        </button>
        <button
          onClick={handleSubmit}
          disabled={saving || price <= 0 || (!destinationId && !destinationName)}
          className="flex-1 py-4 rounded-xl font-bold text-white text-sm disabled:opacity-60 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
          style={{ backgroundColor: '#1D6FA4' }}
        >
          <Printer className="w-5 h-5" />
          Imprimer
        </button>
      </div>
    </div>
  );
}

// ── HISTORY ───────────────────────────────────────────────────────────────────

interface HistoryViewProps {
  session: ReturnType<typeof usePOSSession>['session'];
}

function HistoryView({ session }: HistoryViewProps) {
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
    bagages.reduce((sum, b) => sum + b.price, 0), [bagages]);

  const handleReprint = (bagage: BagageRecord) => {
    const depart = departs.get(bagage.depart_id);
    if (!depart) return;
    PrintService.printBagage({ bagage, depart, stationName: session?.station_name });
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold" style={{ color: '#1A2E22' }}>Historique bagages</h2>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl p-4" style={{ backgroundColor: 'white', border: '1px solid #E2EAE5' }}>
          <div className="flex items-center gap-2 mb-1">
            <Package className="w-4 h-4" style={{ color: '#0B7439' }} />
            <span className="text-xs font-bold" style={{ color: '#6B7280' }}>Bagages</span>
          </div>
          <p className="text-2xl font-bold" style={{ color: '#1A2E22' }}>{bagages.length}</p>
        </div>
        <div className="rounded-xl p-4" style={{ backgroundColor: 'white', border: '1px solid #E2EAE5' }}>
          <div className="flex items-center gap-2 mb-1">
            <Luggage className="w-4 h-4" style={{ color: '#7C3AED' }} />
            <span className="text-xs font-bold" style={{ color: '#6B7280' }}>Recettes</span>
          </div>
          <p className="text-2xl font-bold" style={{ color: '#0B7439' }}>{formatCurrency(totalRevenue)}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#0B7439' }} />
        </div>
      ) : bagages.length === 0 ? (
        <div className="text-center py-12 rounded-xl" style={{ backgroundColor: 'white', border: '1px solid #E2EAE5' }}>
          <Luggage className="w-10 h-10 mx-auto mb-2" style={{ color: '#9CA3AF' }} />
          <p className="text-sm" style={{ color: '#6B7280' }}>Aucun bagage enregistré aujourd'hui</p>
        </div>
      ) : (
        <div className="space-y-2">
          {bagages.map(b => {
            const depart = departs.get(b.depart_id);
            return (
              <div
                key={b.id}
                className="rounded-xl p-3 flex items-center justify-between"
                style={{ backgroundColor: 'white', border: '1px solid #E2EAE5' }}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold truncate" style={{ color: '#1A2E22' }}>
                    {b.bagage_number}
                  </p>
                  <p className="text-xs truncate" style={{ color: '#6B7280' }}>
                    {b.destination} · {b.owner_name || '—'}
                  </p>
                  {depart && (
                    <p className="text-xs mt-0.5 truncate" style={{ color: '#9CA3AF' }}>
                      Départ #{depart.route_number} · {depart.bus_plate}
                    </p>
                  )}
                  {b.with_ticket && (
                    <span className="inline-flex items-center gap-1 mt-1 text-xs font-bold" style={{ color: '#7C3AED' }}>
                      <Link2 className="w-3 h-3" /> {b.ticket_number}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-sm font-bold" style={{ color: '#0B7439' }}>
                    {formatCurrency(b.price)}
                  </span>
                  {depart && (
                    <button
                      onClick={() => handleReprint(b)}
                      className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors hover:bg-[#F4F7F5]"
                      style={{ backgroundColor: '#D1FAE5', color: '#0B7439' }}
                      aria-label="Réimprimer"
                    >
                      <Printer className="w-4 h-4" />
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
