import { useState, useEffect, useCallback } from 'react';
import {
  X, Search, Loader2, AlertCircle, CheckCircle,
  Luggage, User, Phone, MapPin, Tag, Calendar, FileText,
} from 'lucide-react';
import { supabase } from '@/services/supabase';
import { PrintService } from '@/services/pos/printService';
import { formatCurrency } from '@/utils/formatCurrency';
import { getDepartById } from '@/services/pos/departService';
import { getAll, localUpdate } from '@/services/pos/offlineStore';
import type { BagageRecord, DepartRecord } from '@/services/pos/db';
import toast from 'react-hot-toast';

interface PendingBaggage {
  id: string;
  baggage_number: string;
  schedule_id: string | null;
  reservation_id: string | null;
  destination: string;
  price: number;
  seat_number: string | null;
  departure_number: number | null;
  bus_registration: string | null;
  description: string | null;
  owner_name: string;
  owner_phone: string;
  has_ticket: boolean;
  declared_value: number;
  station_id: string | null;
  counter_id: string | null;
  sold_by: string;
  created_at: string;
  payment_status: string;
  ticket_number?: string;
  station_name?: string;
  agent_name?: string;
}

interface Props {
  stationId?: string;
  onClose: () => void;
}

export default function TpePosPendingBaggage({ stationId, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<PendingBaggage[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<PendingBaggage | null>(null);
  const [confirming, setConfirming] = useState(false);

  const doSearch = useCallback(async () => {
    const q = search.trim();
    setLoading(true);
    setSearched(true);
    try {
      let query = supabase
        .from('baggage_tickets')
        .select(`
          id, baggage_number, schedule_id, reservation_id, destination, price,
          seat_number, departure_number, bus_registration, description,
          owner_name, owner_phone, has_ticket, declared_value,
          station_id, counter_id, sold_by, created_at, payment_status,
          stations!inner(name),
          users!baggage_tickets_sold_by_fkey(full_name)
        `)
        .eq('payment_status', 'en_attente');

      if (stationId) {
        query = query.eq('station_id', stationId);
      }

      const { data, error } = await query.order('created_at', { ascending: false }).limit(50);

      if (error) throw error;

      const normalized: PendingBaggage[] = (data ?? []).map((row: any) => ({
        id: row.id,
        baggage_number: row.baggage_number,
        schedule_id: row.schedule_id,
        reservation_id: row.reservation_id,
        destination: row.destination,
        price: row.price,
        seat_number: row.seat_number,
        departure_number: row.departure_number,
        bus_registration: row.bus_registration,
        description: row.description,
        owner_name: row.owner_name,
        owner_phone: row.owner_phone,
        has_ticket: row.has_ticket,
        declared_value: row.declared_value,
        station_id: row.station_id,
        counter_id: row.counter_id,
        sold_by: row.sold_by,
        created_at: row.created_at,
        payment_status: row.payment_status,
        station_name: row.stations?.name ?? '—',
        agent_name: row.users?.full_name ?? '—',
      }));

      // Fetch ticket numbers for linked baggage
      const reservationIds = normalized
        .filter(r => r.reservation_id)
        .map(r => r.reservation_id as string);

      if (reservationIds.length > 0) {
        const { data: reservations } = await supabase
          .from('reservations')
          .select('id, booking_reference')
          .in('id', reservationIds);
        if (reservations) {
          const refMap = new Map(reservations.map((r: any) => [r.id, r.booking_reference as string]));
          normalized.forEach(r => {
            if (r.reservation_id && refMap.has(r.reservation_id)) {
              r.ticket_number = refMap.get(r.reservation_id);
            }
          });
        }
      }

      // Filter by suffix or text
      const filtered = q.length < 1
        ? normalized
        : q.match(/^\d/)
          ? normalized.filter(r =>
              r.baggage_number.endsWith(q) ||
              (r.ticket_number && r.ticket_number.endsWith(q)) ||
              r.baggage_number.includes(q) ||
              (r.ticket_number && r.ticket_number.includes(q))
            )
          : normalized.filter(r =>
              r.owner_name.toLowerCase().includes(q.toLowerCase()) ||
              r.destination.toLowerCase().includes(q.toLowerCase())
            );

      setResults(filtered);
    } catch (err: any) {
      toast.error(err?.message ?? 'Erreur lors de la recherche');
    } finally {
      setLoading(false);
    }
  }, [search, stationId]);

  useEffect(() => {
    doSearch();
  }, []);

  const buildDepartFromServer = async (scheduleId: string, fallback: PendingBaggage): Promise<DepartRecord | null> => {
    const { data: sched } = await supabase
      .from('schedules')
      .select('id, route_name, route_number, bus_id, departure_datetime, departure_station_id, status, seats_total, seats_available, seats_reserved, departure_number')
      .eq('id', scheduleId)
      .maybeSingle();

    if (!sched) return null;

    const depIso = sched.departure_datetime as string ?? new Date().toISOString();
    return {
      id: sched.id,
      departure_number: sched.departure_number ?? 1,
      route_id: '',
      route_name: sched.route_name ?? '',
      route_number: sched.route_number ?? 1,
      bus_id: sched.bus_id ?? '',
      bus_plate: fallback.bus_registration ?? '',
      driver_id: '',
      departure_datetime: depIso,
      departure_date: depIso.slice(0, 10),
      departure_time: depIso.slice(11, 16) || '00:00',
      is_ac: false,
      status: sched.status ?? 'planifie',
      seats_total: sched.seats_total ?? 0,
      seats_from: 1,
      seats_sold: sched.seats_reserved ?? 0,
      station_id: sched.departure_station_id ?? fallback.station_id ?? '',
      station_name: fallback.station_name,
      cloture: sched.status === 'termine',
      mt_ticket: 0,
      mt_bagage: 0,
      tot_depense: 0,
      solde: 0,
      caisse: 0,
      breakdown_transfer: 0,
      confirmed: sched.status === 'en_cours',
      cancelled: sched.status === 'annule',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  };

  const handleConfirmPayment = async () => {
    if (!selected) return;
    setConfirming(true);
    try {
      const { data, error } = await supabase.rpc('confirm_baggage_payment', {
        p_baggage_id: selected.id,
      });

      if (error) throw error;

      // Update local IndexedDB if the baggage exists locally
      try {
        const localBagages = await getAll<BagageRecord>('bagages');
        const localBag = localBagages.find(b => b.id === selected.id);
        if (localBag) {
          await localUpdate<BagageRecord>('bagages', selected.id, {
            payment_status: 'paye',
            paid_at: new Date().toISOString(),
            paid_by: data?.paid_by,
          });
        }
      } catch {
        // non-critical — local DB may not have this baggage
      }

      // Build depart record for printing
      let depart: DepartRecord | null = null;
      if (selected.schedule_id) {
        const localDepart = await getDepartById(selected.schedule_id);
        if (localDepart) {
          depart = localDepart;
        } else {
          depart = await buildDepartFromServer(selected.schedule_id, selected);
        }
      }

      if (!depart) {
        // Fallback: minimal depart record
        const depIso = new Date().toISOString();
        depart = {
          id: selected.schedule_id ?? '',
          departure_number: selected.departure_number ?? 1,
          route_id: '',
          route_name: '',
          route_number: selected.departure_number ?? 1,
          bus_id: '',
          bus_plate: selected.bus_registration ?? '',
          driver_id: '',
          departure_datetime: depIso,
          departure_date: depIso.slice(0, 10),
          departure_time: '00:00',
          is_ac: false,
          status: 'planifie',
          seats_total: 0,
          seats_from: 1,
          seats_sold: 0,
          station_id: selected.station_id ?? '',
          station_name: selected.station_name,
          cloture: false,
          mt_ticket: 0,
          mt_bagage: 0,
          tot_depense: 0,
          solde: 0,
          caisse: 0,
          breakdown_transfer: 0,
          confirmed: false,
          cancelled: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      }

      const bagageRecord: BagageRecord = {
        id: data.id,
        depart_id: data.schedule_id ?? '',
        bagage_number: data.baggage_number,
        ticket_id: data.reservation_id ?? undefined,
        ticket_number: selected.ticket_number,
        linked_seat_number: data.seat_number ?? undefined,
        with_ticket: data.has_ticket,
        with_ticket_report: false,
        price: data.price,
        destination: data.destination,
        description: data.description ?? '',
        car_plate: data.bus_registration ?? '',
        owner_name: data.owner_name,
        owner_phone: data.owner_phone,
        print_bagage: true,
        declared_value: data.declared_value,
        station_id: data.station_id ?? undefined,
        counter_id: data.counter_id ?? undefined,
        payment_status: 'paye',
        paid_at: data.paid_at,
        paid_by: data.paid_by,
        created_at: data.created_at,
        updated_at: new Date().toISOString(),
      };

      await PrintService.printTpeBagage({
        bagage: bagageRecord,
        depart,
        stationName: selected.station_name,
      }, false);

      toast.success(`Paiement confirmé — ${data.baggage_number}`);
      setSelected(null);
      setSearch('');
      setSearched(false);
      doSearch();
    } catch (err: any) {
      const msg = err?.message ?? 'Erreur';
      if (msg.includes('déjà') || msg.includes('already')) {
        toast.error('Ce bagage a déjà été payé');
      } else if (msg.includes('introuvable') || msg.includes('not found')) {
        toast.error('Bagage introuvable');
      } else if (msg.includes('autorisé') || msg.includes('authorized')) {
        toast.error('Vous n\'êtes pas autorisé à confirmer ce paiement');
      } else {
        toast.error(msg);
      }
    } finally {
      setConfirming(false);
    }
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

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0" style={{ borderColor: '#E2EAE5' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#D1FAE5' }}>
              <Luggage className="w-5 h-5" style={{ color: '#0B7439' }} />
            </div>
            <div>
              <h2 className="text-lg font-bold" style={{ color: '#1A2E22' }}>TPE-POS — Bagages en attente de paiement</h2>
              <p className="text-xs" style={{ color: '#6B7280' }}>Recherchez et confirmez le paiement des bagages enregistrés par les bagagistes</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="w-5 h-5" style={{ color: '#8AA898' }} />
          </button>
        </div>

        {/* Search bar */}
        <div className="px-6 py-4 border-b flex-shrink-0" style={{ borderColor: '#E2EAE5' }}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: '#9CA3AF' }} />
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setSearched(false); }}
              onKeyDown={e => { if (e.key === 'Enter') doSearch(); }}
              placeholder="Derniers chiffres du N° ticket BUS ou N° bagage, nom client, destination..."
              className="w-full pl-11 pr-4 py-3 rounded-xl border-2 text-sm outline-none transition-colors"
              style={{ borderColor: '#E2EAE5' }}
            />
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={doSearch}
              disabled={loading}
              className="px-5 py-2 rounded-lg font-bold text-white text-sm disabled:opacity-60 flex items-center gap-2"
              style={{ backgroundColor: '#0B7439' }}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Rechercher
            </button>
            <button
              onClick={() => { setSearch(''); setSearched(false); doSearch(); }}
              className="px-5 py-2 rounded-lg font-medium text-sm border"
              style={{ borderColor: '#E2EAE5', color: '#6B7280' }}
            >
              Tout afficher
            </button>
          </div>
        </div>

        {/* Results list */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-14">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: '#0B7439' }} />
            </div>
          ) : results.length === 0 ? (
            <div className="text-center py-14">
              {searched ? (
                <>
                  <AlertCircle className="w-12 h-12 mx-auto mb-3" style={{ color: '#9CA3AF' }} />
                  <p className="text-sm" style={{ color: '#6B7280' }}>Aucun bagage en attente trouvé</p>
                </>
              ) : (
                <>
                  <Luggage className="w-12 h-12 mx-auto mb-3" style={{ color: '#9CA3AF' }} />
                  <p className="text-sm" style={{ color: '#6B7280' }}>Aucun bagage en attente de paiement</p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {results.map(b => (
                <button
                  key={b.id}
                  onClick={() => setSelected(b)}
                  className="w-full text-left p-4 rounded-xl border transition-all hover:shadow-sm"
                  style={{ backgroundColor: '#FAFBFA', borderColor: '#E2EAE5' }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold" style={{ color: '#1A2E22' }}>{b.baggage_number}</span>
                    <span className="px-2.5 py-1 rounded-full text-xs font-bold" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
                      EN ATTENTE
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 text-xs" style={{ color: '#6B7280' }}>
                    <span><span className="font-medium">Client:</span> {b.owner_name || '—'}</span>
                    <span><span className="font-medium">Contact:</span> {b.owner_phone || '—'}</span>
                    <span><span className="font-medium">Destination:</span> {b.destination || '—'}</span>
                    <span><span className="font-medium">Montant:</span> <span className="font-bold" style={{ color: '#0B7439' }}>{formatCurrency(b.price)}</span></span>
                    {b.ticket_number && <span><span className="font-medium">Ticket BUS:</span> {b.ticket_number}</span>}
                    <span><span className="font-medium">Gare:</span> {b.station_name}</span>
                    <span><span className="font-medium">Agent:</span> {b.agent_name}</span>
                    <span><span className="font-medium">Date:</span> {formatDateTime(b.created_at)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Payment confirmation modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0" style={{ borderColor: '#E2EAE5' }}>
              <h3 className="text-base font-bold" style={{ color: '#1A2E22' }}>Confirmer le paiement</h3>
              <button onClick={() => setSelected(null)} className="p-1 rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5" style={{ color: '#8AA898' }} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              <div className="rounded-xl p-4" style={{ backgroundColor: '#FEF3C7', border: '1px solid #FCD34D' }}>
                <p className="text-xs font-bold" style={{ color: '#92400E' }}>EN ATTENTE DE PAIEMENT</p>
                <p className="text-sm font-bold mt-1" style={{ color: '#1A2E22' }}>{selected.baggage_number}</p>
              </div>

              <div className="space-y-2.5">
                <Row icon={FileText} label="N° ticket BUS" value={selected.ticket_number ?? (selected.has_ticket ? 'Oui' : 'Sans ticket')} />
                <Row icon={MapPin} label="Destination" value={selected.destination || '—'} />
                <Row icon={Tag} label="Montant" value={formatCurrency(selected.price)} highlight />
                {selected.declared_value > 0 && <Row icon={Tag} label="Valeur déclarée" value={formatCurrency(selected.declared_value)} />}
                <Row icon={Luggage} label="Description" value={selected.description || '—'} />
                <Row icon={User} label="Client" value={selected.owner_name || '—'} />
                <Row icon={Phone} label="Contact" value={selected.owner_phone || '—'} />
                {selected.bus_registration && <Row icon={FileText} label="Car" value={selected.bus_registration} />}
                {selected.seat_number && <Row icon={FileText} label="Siège" value={selected.seat_number} />}
                <Row icon={MapPin} label="Gare" value={selected.station_name || '—'} />
                <Row icon={User} label="Agent bagagiste" value={selected.agent_name || '—'} />
                <Row icon={Calendar} label="Enregistré le" value={formatDateTime(selected.created_at)} />
              </div>

              <div className="rounded-xl p-3" style={{ backgroundColor: '#F0FAF4', border: '1px solid #0B7439' }}>
                <p className="text-xs" style={{ color: '#0B7439' }}>
                  Vérifiez les informations ci-dessus. Après confirmation, le statut passera à « Payé », le ticket définitif sera imprimé et l'opération ne pourra plus être annulée.
                </p>
              </div>
            </div>

            <div className="flex gap-3 p-5 border-t flex-shrink-0" style={{ borderColor: '#E2EAE5' }}>
              <button
                onClick={() => setSelected(null)}
                disabled={confirming}
                className="flex-1 py-3 rounded-xl font-bold border"
                style={{ borderColor: '#E2EAE5', color: '#6B7280' }}
              >
                Annuler
              </button>
              <button
                onClick={handleConfirmPayment}
                disabled={confirming}
                className="flex-[2] py-3 rounded-xl font-bold text-white disabled:opacity-60 flex items-center justify-center gap-2"
                style={{ backgroundColor: '#0B7439' }}
              >
                {confirming ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                Confirmer et imprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ icon: Icon, label, value, highlight }: { icon: typeof User; label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex items-center gap-2 flex-shrink-0">
        <Icon className="w-4 h-4" style={{ color: '#6B7280' }} />
        <span className="text-xs font-medium" style={{ color: '#6B7280' }}>{label}</span>
      </div>
      <span className={`text-sm text-right break-words ${highlight ? 'font-bold' : 'font-medium'}`} style={{ color: highlight ? '#0B7439' : '#1A2E22' }}>
        {value}
      </span>
    </div>
  );
}
