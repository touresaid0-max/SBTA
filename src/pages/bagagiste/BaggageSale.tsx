import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import {
  Luggage, Printer, RefreshCw, Bus, Clock, MapPin, Loader2, CheckCircle2,
} from 'lucide-react';
import {
  printBaggageTicket, generateBaggageNumber, type BaggageTicketData,
} from '../../utils/printBaggageTicket';

interface StationOption {
  id: string;
  name: string;
}

interface DepartureRow {
  id: string;
  route_name: string;
  destination: string;
  departure_datetime: string;
  status: string;
  bus_registration: string;
  departure_order: number | null;
  source: string;
}

interface RecentSale {
  id: string;
  baggage_number: string;
  destination: string;
  price: number;
  owner_name: string;
  created_at: string;
}

type BaggageMode = 'none' | 'avec_ticket' | 'avec_ticket_reporte' | 'sans_ticket';

interface BaggageForm {
  mode: BaggageMode;
  destination: string;
  price: number;
  seat_number: string;
  departure_number: string;
  bus_registration: string;
  description: string;
  owner_name: string;
  owner_phone: string;
}

const EMPTY_FORM: BaggageForm = {
  mode: 'none',
  destination: '',
  price: 0,
  seat_number: '',
  departure_number: '',
  bus_registration: '',
  description: '',
  owner_name: '',
  owner_phone: '',
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  planifie: { label: 'Planifié', color: 'var(--primary)' },
  en_cours: { label: 'En cours', color: 'var(--warning)' },
  embarquement: { label: 'Embarquement', color: 'var(--warning)' },
  retard: { label: 'Retard', color: 'var(--error)' },
  parti: { label: 'Parti', color: 'var(--text-muted)' },
  termine: { label: 'Terminé', color: 'var(--text-muted)' },
  annule: { label: 'Annulé', color: 'var(--error)' },
};

export default function BagagisteBaggageSale() {
  const { user } = useAuthStore();

  const [loading, setLoading] = useState(true);
  const [stations, setStations] = useState<StationOption[]>([]);
  const [stationId, setStationId] = useState<string>('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [departures, setDepartures] = useState<DepartureRow[]>([]);
  const [loadingDepartures, setLoadingDepartures] = useState(false);
  const [selected, setSelected] = useState<DepartureRow | null>(null);
  const [form, setForm] = useState<BaggageForm>(EMPTY_FORM);
  const [processing, setProcessing] = useState(false);
  const [recentSales, setRecentSales] = useState<RecentSale[]>([]);

  const stationName = stations.find(s => s.id === stationId)?.name || 'SBTA';

  const loadStations = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('station_baggage_handlers')
        .select('station_id, stations:station_id(id, name)')
        .eq('handler_id', user.id);
      if (error) throw error;
      const opts: StationOption[] = (data || [])
        .map((r: any) => r.stations)
        .filter(Boolean)
        .map((s: any) => ({ id: s.id, name: s.name }));
      setStations(opts);
      if (opts.length > 0) setStationId(prev => prev || opts[0].id);
    } catch (err: any) {
      toast.error(err.message || 'Erreur de chargement des gares');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { loadStations(); }, [loadStations]);

  const loadDepartures = useCallback(async () => {
    if (!stationId) { setDepartures([]); return; }
    setLoadingDepartures(true);
    try {
      const dayStart = new Date(date + 'T00:00:00');
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const { data, error } = await supabase
        .from('schedules')
        .select(`
          id, route_name, departure_datetime, status, source, departure_number,
          bus:bus_id(registration_number),
          arrival_station:arrival_station_id(name)
        `)
        .eq('departure_station_id', stationId)
        .gte('departure_datetime', dayStart.toISOString())
        .lt('departure_datetime', dayEnd.toISOString())
        .order('departure_datetime', { ascending: true });
      if (error) throw error;

      const scheduleIds = (data || []).map((s: any) => s.id);
      const orderMap: Record<string, number> = {};
      if (scheduleIds.length > 0) {
        const { data: depSeq } = await supabase
          .from('departure_sequence')
          .select('schedule_id, departure_order, departure_number')
          .in('schedule_id', scheduleIds);
        (depSeq || []).forEach((d: any) => {
          const num = d.departure_order ?? d.departure_number ?? null;
          if (num != null) orderMap[d.schedule_id] = num;
        });
      }

      setDepartures((data || []).map((s: any) => ({
        id: s.id,
        route_name: s.route_name || '—',
        destination: s.arrival_station?.name || s.route_name || '—',
        departure_datetime: s.departure_datetime,
        status: s.status || 'planifie',
        bus_registration: s.bus?.registration_number || '',
        departure_order: orderMap[s.id] ?? (s.source === 'guichet' ? (s.departure_number ?? null) : null),
        source: s.source || 'chef_gare',
      })));
    } catch (err: any) {
      toast.error(err.message || 'Erreur de chargement des départs');
      setDepartures([]);
    } finally {
      setLoadingDepartures(false);
    }
  }, [stationId, date]);

  useEffect(() => { loadDepartures(); }, [loadDepartures]);

  const loadRecentSales = useCallback(async () => {
    if (!user?.id) return;
    const dayStart = new Date(date + 'T00:00:00');
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const { data } = await supabase
      .from('baggage_tickets')
      .select('id, baggage_number, destination, price, owner_name, created_at')
      .eq('sold_by', user.id)
      .gte('created_at', dayStart.toISOString())
      .lt('created_at', dayEnd.toISOString())
      .order('created_at', { ascending: false });
    setRecentSales((data as any) || []);
  }, [user?.id, date]);

  useEffect(() => { loadRecentSales(); }, [loadRecentSales]);

  const selectDeparture = (dep: DepartureRow) => {
    setSelected(dep);
    setForm({
      ...EMPTY_FORM,
      bus_registration: dep.bus_registration,
      departure_number: dep.departure_order != null ? String(dep.departure_order) : '',
      destination: dep.destination,
    });
  };

  const switchMode = (mode: BaggageMode) => {
    if (mode === 'none' || !selected) {
      setForm(prev => ({
        ...prev,
        mode: 'none',
        destination: '',
        seat_number: '',
        bus_registration: '',
        departure_number: '',
      }));
      return;
    }
    setForm(prev => ({
      ...prev,
      mode,
      destination: selected.destination,
      bus_registration: selected.bus_registration,
      departure_number: selected.departure_order != null ? String(selected.departure_order) : prev.departure_number,
      seat_number: mode === 'sans_ticket' ? '' : prev.seat_number,
    }));
  };

  const depLabel = (dep: DepartureRow) =>
    dep.departure_order != null ? `Départ ${dep.departure_order}` : 'Départ';

  const resetForm = () => {
    setForm(EMPTY_FORM);
  };

  const handleSave = async () => {
    if (!selected) {
      toast.error('Sélectionnez un départ planifié');
      return;
    }
    if (form.mode === 'none') {
      toast.error('Choisissez le type de bagage (avec ticket, reporté ou sans siège)');
      return;
    }
    if (!form.owner_name.trim() || !form.owner_phone.trim() || !form.destination.trim()) {
      toast.error('Remplissez au minimum : propriétaire, contact et destination');
      return;
    }
    if (form.price <= 0) {
      toast.error('Le prix du bagage doit être supérieur à 0');
      return;
    }
    if ((form.mode === 'avec_ticket' || form.mode === 'avec_ticket_reporte') && !form.seat_number.trim()) {
      toast.error('Saisissez le numéro de siège pour un bagage avec ticket');
      return;
    }

    setProcessing(true);
    try {
      const baggageNumber = generateBaggageNumber();
      const departureNumber = form.departure_number ? parseInt(form.departure_number) : null;
      const modeLabel = form.mode === 'avec_ticket' ? 'Avec ticket'
        : form.mode === 'avec_ticket_reporte' ? 'Avec ticket reporte'
        : 'Sans siege';

      const { error } = await supabase
        .from('baggage_tickets')
        .insert({
          baggage_number: baggageNumber,
          schedule_id: selected.id,
          reservation_id: null,
          destination: form.destination.trim(),
          price: form.price,
          seat_number: form.mode === 'sans_ticket' ? null : (form.seat_number.trim() || null),
          departure_number: departureNumber,
          bus_registration: form.bus_registration.trim() || null,
          description: form.description.trim() || null,
          owner_name: form.owner_name.trim(),
          owner_phone: form.owner_phone.trim(),
          has_ticket: form.mode === 'avec_ticket' || form.mode === 'avec_ticket_reporte',
          counter_id: null,
          station_id: stationId,
          sold_by: user!.id,
        });
      if (error) throw error;

      const ticketData: BaggageTicketData = {
        baggage_number: baggageNumber,
        destination: form.destination,
        price: form.price,
        seat_number: form.mode === 'sans_ticket' ? null : (form.seat_number || null),
        departure_number: departureNumber,
        bus_registration: form.bus_registration || null,
        description: form.description || null,
        owner_name: form.owner_name,
        owner_phone: form.owner_phone,
        station_name: stationName,
        mode_label: modeLabel,
      };

      printBaggageTicket(ticketData);
      toast.success('Ticket bagage imprimé');
      resetForm();
      loadRecentSales();
    } catch (err: any) {
      console.error('Erreur sauvegarde bagage:', err);
      toast.error(err.message || 'Erreur lors de la sauvegarde du bagage');
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <div
          className="w-8 h-8 border-4 rounded-full animate-spin"
          style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }}
        />
      </div>
    );
  }

  if (stations.length === 0) {
    return (
      <div className="p-8">
        <div
          className="rounded-2xl border shadow-sm px-6 py-12 text-center max-w-xl mx-auto"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <Luggage className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
            Aucune gare affectée
          </h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Vous n'êtes affecté à aucune gare pour le moment. Demandez à votre chef de gare de vous
            affecter afin de vendre des tickets bagages.
          </p>
        </div>
      </div>
    );
  }

  const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' };
  const lockedBg = 'var(--neutral-50)';

  return (
    <div className="p-6 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Luggage className="w-7 h-7" style={{ color: 'var(--primary)' }} /> Vente de bagages
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Sélectionnez un départ planifié puis enregistrez le ticket bagage
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {stations.length > 1 && (
            <select
              value={stationId}
              onChange={e => { setStationId(e.target.value); setSelected(null); }}
              className="px-4 py-2.5 rounded-lg border text-sm font-medium"
              style={inputStyle}
            >
              {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <input
            type="date"
            value={date}
            onChange={e => { setDate(e.target.value); setSelected(null); }}
            className="px-4 py-2.5 rounded-lg border text-sm font-medium"
            style={inputStyle}
          />
          <button
            onClick={() => { loadDepartures(); loadRecentSales(); }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            <RefreshCw className="w-4 h-4" /> Rafraîchir
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Departures list */}
        <div className="lg:col-span-2">
          <div
            className="rounded-2xl border shadow-sm overflow-hidden"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <Bus className="w-5 h-5" style={{ color: 'var(--primary)' }} />
              <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                Départs planifiés ({departures.length})
              </h2>
            </div>

            {loadingDepartures ? (
              <div className="py-12 flex justify-center">
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--primary)' }} />
              </div>
            ) : departures.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <Clock className="w-9 h-9 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Aucun départ planifié pour cette date.
                </p>
              </div>
            ) : (
              <ul className="divide-y max-h-[70vh] overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
                {departures.map(dep => {
                  const isSel = selected?.id === dep.id;
                  const st = STATUS_LABELS[dep.status] || { label: dep.status, color: 'var(--text-muted)' };
                  return (
                    <li key={dep.id}>
                      <button
                        onClick={() => selectDeparture(dep)}
                        className="w-full text-left px-5 py-4 transition-colors"
                        style={{ backgroundColor: isSel ? 'var(--primary)12' : 'transparent' }}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="flex-shrink-0 inline-flex items-center justify-center px-2.5 py-1 rounded-lg text-sm font-black"
                              style={{
                                backgroundColor: isSel ? 'var(--primary)' : 'var(--primary)1A',
                                color: isSel ? '#fff' : 'var(--primary)',
                              }}
                            >
                              {depLabel(dep)}
                            </span>
                            <span className="font-semibold text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                              {dep.route_name}
                            </span>
                          </div>
                          <span
                            className="flex-shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full"
                            style={{ backgroundColor: `${st.color}1A`, color: st.color }}
                          >
                            {st.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 mt-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            {format(new Date(dep.departure_datetime), 'HH:mm')}
                          </span>
                          {dep.bus_registration && (
                            <span className="flex items-center gap-1">
                              <Bus className="w-3.5 h-3.5" /> {dep.bus_registration}
                            </span>
                          )}
                          <span className="truncate">→ {dep.destination}</span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {recentSales.length > 0 && (
            <div
              className="rounded-2xl border shadow-sm overflow-hidden mt-6"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
                <CheckCircle2 className="w-5 h-5" style={{ color: 'var(--success)' }} />
                <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Mes ventes du jour ({recentSales.length})
                </h2>
              </div>
              <ul className="divide-y max-h-64 overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
                {recentSales.map(s => (
                  <li key={s.id} className="flex items-center justify-between px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                        {s.owner_name} — {s.destination}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {format(new Date(s.created_at), 'HH:mm')} · {s.baggage_number}
                      </p>
                    </div>
                    <span className="text-sm font-semibold whitespace-nowrap" style={{ color: 'var(--primary)' }}>
                      {s.price.toLocaleString('fr-FR')} F
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Baggage form */}
        <div className="lg:col-span-3">
          <div
            className="rounded-2xl border shadow-sm p-6"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            {!selected ? (
              <div className="py-16 text-center">
                <MapPin className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Sélectionnez un départ planifié dans la liste pour vendre un ticket bagage.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-5 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Départ sélectionné</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className="inline-flex items-center justify-center px-3 py-1 rounded-lg text-base font-black"
                        style={{ backgroundColor: 'var(--primary)', color: '#fff' }}
                      >
                        {depLabel(selected)}
                      </span>
                      <span className="text-lg font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                        {selected.route_name}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {format(new Date(selected.departure_datetime), 'HH:mm')}
                      </span>
                      {selected.bus_registration && (
                        <span className="flex items-center gap-1">
                          <Bus className="w-3.5 h-3.5" /> {selected.bus_registration}
                        </span>
                      )}
                      <span>→ {selected.destination}</span>
                    </div>
                  </div>
                  <Luggage className="w-9 h-9 flex-shrink-0" style={{ color: 'var(--primary)' }} />
                </div>

                {/* Mode selection */}
                <div className="flex flex-wrap gap-4 mb-5">
                  {([
                    { value: 'avec_ticket' as BaggageMode, label: 'Avec ticket' },
                    { value: 'avec_ticket_reporte' as BaggageMode, label: 'Avec ticket reporté' },
                    { value: 'sans_ticket' as BaggageMode, label: 'Sans siège' },
                  ]).map(opt => (
                    <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        checked={form.mode === opt.value}
                        onChange={() => switchMode(form.mode === opt.value ? 'none' : opt.value)}
                        className="w-4 h-4"
                        style={{ accentColor: 'var(--primary)' }}
                      />
                      <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{opt.label}</span>
                    </label>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Destination *</label>
                    <input
                      type="text"
                      value={form.destination}
                      onChange={e => setForm({ ...form, destination: e.target.value.toUpperCase() })}
                      readOnly={form.mode !== 'none'}
                      className="w-full px-3 py-2 rounded-lg border text-sm"
                      style={{ ...inputStyle, backgroundColor: form.mode !== 'none' ? lockedBg : 'var(--surface)' }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Prix (F) *</label>
                    <input
                      type="number"
                      min={0}
                      value={form.price || ''}
                      onChange={e => setForm({ ...form, price: parseInt(e.target.value) || 0 })}
                      className="w-full px-3 py-2 rounded-lg border text-sm"
                      style={inputStyle}
                    />
                  </div>

                  {form.mode === 'sans_ticket' ? (
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>N° départ</label>
                      <input
                        type="text"
                        value={form.departure_number}
                        onChange={e => setForm({ ...form, departure_number: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border text-sm"
                        style={inputStyle}
                      />
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Siège</label>
                        <input
                          type="text"
                          value={form.seat_number}
                          onChange={e => setForm({ ...form, seat_number: e.target.value.toUpperCase() })}
                          placeholder="Ex: 12 ou 12, 13"
                          className="w-full px-3 py-2 rounded-lg border text-sm"
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>N° départ</label>
                        <input
                          type="text"
                          value={form.departure_number}
                          onChange={e => setForm({ ...form, departure_number: e.target.value })}
                          className="w-full px-3 py-2 rounded-lg border text-sm"
                          style={inputStyle}
                        />
                      </div>
                    </>
                  )}

                  <div className={form.mode === 'sans_ticket' ? '' : 'sm:col-span-2'}>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Car / Immatriculation</label>
                    <input
                      type="text"
                      value={form.bus_registration}
                      readOnly
                      className="w-full px-3 py-2 rounded-lg border text-sm font-medium"
                      style={{ ...inputStyle, backgroundColor: lockedBg }}
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Description du bagage</label>
                    <input
                      type="text"
                      value={form.description}
                      onChange={e => setForm({ ...form, description: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border text-sm"
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Propriétaire *</label>
                    <input
                      type="text"
                      value={form.owner_name}
                      onChange={e => setForm({ ...form, owner_name: e.target.value.toUpperCase() })}
                      className="w-full px-3 py-2 rounded-lg border text-sm"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Contact *</label>
                    <input
                      type="text"
                      value={form.owner_phone}
                      onChange={e => setForm({ ...form, owner_phone: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border text-sm"
                      style={inputStyle}
                    />
                  </div>
                </div>

                <button
                  onClick={handleSave}
                  disabled={processing || form.mode === 'none'}
                  className="mt-6 w-full flex items-center justify-center gap-2 py-3 rounded-lg font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: 'var(--primary)' }}
                >
                  {processing ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Traitement…</>
                  ) : (
                    <><Printer className="w-4 h-4" /> Imprimer ticket bagage</>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
