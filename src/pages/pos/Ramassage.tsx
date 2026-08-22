import { useEffect, useMemo, useRef, useState } from 'react';
import POSLayout from '@/components/pos/POSLayout';
import { usePOSSession } from '@/services/pos/POSSessionContext';
import { supabase } from '@/services/supabase';
import { Bus, Search, MapPin, Hash, Loader2, CheckCircle, Clock, Lock, Printer, AlertCircle, FileText } from 'lucide-react';
import { printRamassageBordereau } from '@/services/pos/printService';
import RamassageReportView from '@/components/shared/RamassageReportView';
import ChangeRequestButton from '@/components/shared/ChangeRequestButton';

type RamassageNotif = {
  id: string;
  route_name: string | null;
  departure_number: number | null;
  bus_registration: string | null;
  driver_name: string | null;
  departure_datetime: string | null;
  seats_total: number | null;
  seats_sold: number | null;
  company_id: string | null;
  collected_by_name: string | null;
  collected_at: string | null;
  origin_station_id: string | null;
  origin_station_name: string | null;
  destination_station_id: string;
  destination_station_name: string | null;
  status: string;
  created_at: string;
  consulted_at: string | null;
  collected_places?: number | null;
  collected_amount?: number | null;
};

export default function POSRamassage() {
  const { session } = usePOSSession();
  const stationId = session?.station_id;

  const [notifs, setNotifs] = useState<RamassageNotif[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<RamassageNotif | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [marking, setMarking] = useState(false);
  const [places, setPlaces] = useState('');
  const [montant, setMontant] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'collect' | 'report'>('collect');
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const load = async () => {
    if (!stationId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('ramassage_notifications')
      .select('*')
      .eq('destination_station_id', stationId)
      .order('created_at', { ascending: false });
    if (!error) setNotifs((data as RamassageNotif[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    if (!stationId) return;
    const ch = supabase
      .channel('ramassage_page_' + stationId)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'ramassage_notifications',
        filter: `destination_station_id=eq.${stationId}`,
      }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationId]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = notifs.filter(n => n.status === 'pending' || n.status === 'consulted');
    if (!q) return pool.slice(0, 8);
    return pool
      .filter(n => (n.bus_registration ?? '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, notifs]);

  const pendingList = notifs.filter(n => n.status === 'pending' || n.status === 'consulted');

  const seatsFree = selected
    ? Math.max(0, (selected.seats_total ?? 0) - (selected.seats_sold ?? 0))
    : 0;

  const openNotif = async (n: RamassageNotif) => {
    setSelected(n);
    setQuery(n.bus_registration ?? '');
    setShowSuggestions(false);
    setPlaces('');
    setMontant('');
    setDone(false);
    setError('');
    if (n.status === 'pending') {
      setMarking(true);
      const { error } = await supabase
        .from('ramassage_notifications')
        .update({ status: 'consulted', consulted_at: new Date().toISOString() })
        .eq('id', n.id);
      if (!error) {
        setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, status: 'consulted', consulted_at: new Date().toISOString() } : x));
      }
      setMarking(false);
    }
  };

  const validate = (): string | null => {
    const p = parseInt(places, 10);
    if (isNaN(p) || p < 0) return 'Veuillez saisir un nombre de places valide.';
    if (p > seatsFree) return `Nombre de places supérieur au quota disponible (${seatsFree} place${seatsFree > 1 ? 's' : ''} libre${seatsFree > 1 ? 's' : ''}).`;
    const m = parseFloat(montant);
    if (isNaN(m) || m < 0) return 'Veuillez saisir un montant collecté valide.';
    if (p > 0 && m <= 0) return 'Le montant collecté doit être supérieur à 0 si des places sont vendues.';
    return null;
  };

  const handleValidate = async () => {
    if (!selected) return;
    const err = validate();
    if (err) { setError(err); return; }
    setError('');
    setSubmitting(true);
    const p = parseInt(places, 10) || 0;
    const m = parseFloat(montant) || 0;
    const { error } = await supabase
      .from('ramassage_notifications')
      .update({
        status: 'done',
        collected_places: p,
        collected_amount: m,
        collected_by_name: session?.full_name ?? null,
        collected_at: new Date().toISOString(),
      })
      .eq('id', selected.id);
    setSubmitting(false);
    if (error) {
      setError("Erreur lors de l'enregistrement du ramassage.");
      return;
    }
    setNotifs(prev => prev.map(x => x.id === selected.id ? { ...x, status: 'done', collected_places: p, collected_amount: m } : x));
    setDone(true);
    // Auto-print bordereau
    try {
      await printRamassageBordereau({
        notif: { ...selected, collected_places: p, collected_amount: m },
        stationName: session?.station_name,
      });
    } catch { /* best-effort print */ }
  };

  const fmtDate = (iso: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  };
  const fmtTime = (iso: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };

  return (
    <POSLayout stationName={session?.station_name} activeRoute="Ramassage" showBack>
      {/* Tabs */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-4">
        <div className="flex gap-1 rounded-xl border-2 p-1" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
          <button
            onClick={() => setTab('collect')}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-colors"
            style={tab === 'collect'
              ? { backgroundColor: 'var(--primary)', color: '#fff' }
              : { color: 'var(--text-secondary)' }}
          >
            <Bus className="w-4 h-4" /> Collecte
          </button>
          <button
            onClick={() => setTab('report')}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-colors"
            style={tab === 'report'
              ? { backgroundColor: 'var(--primary)', color: '#fff' }
              : { color: 'var(--text-secondary)' }}
          >
            <FileText className="w-4 h-4" /> Rapport ramassage
          </button>
        </div>
      </div>

      {tab === 'report' ? (
        <RamassageReportView
          stationId={session?.station_id ?? null}
          stationName={session?.station_name}
          title="Rapport des ventes de ramassage"
        />
      ) : (
      <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
        {/* Header stats */}
        <div className="rounded-2xl p-4 sm:p-5 border-2 flex items-center gap-4"
          style={{ backgroundColor: '#E0F2FE', borderColor: '#0EA5E9' }}>
          <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#0EA5E9', color: 'white' }}>
            <Bus className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium" style={{ color: '#0369A1' }}>Ramassages en attente pour cette gare</div>
            <div className="text-2xl font-bold" style={{ color: '#0C4A6E' }}>{pendingList.length}</div>
          </div>
        </div>

        {/* Autocomplete search */}
        <div ref={wrapRef} className="relative">
          <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
            Immatriculation du véhicule
          </label>
          <div className="relative">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <input
              type="text"
              value={query}
              onFocus={() => setShowSuggestions(true)}
              onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true); setSelected(null); setDone(false); }}
              placeholder="Ex: 0349WWCI01"
              className="w-full pl-10 pr-4 py-3 rounded-xl border-2 text-base font-medium"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            />
          </div>
          {showSuggestions && (
            <div className="absolute z-20 left-0 right-0 mt-1 rounded-xl border-2 overflow-hidden shadow-lg"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              {suggestions.length === 0 ? (
                <div className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                  Aucun ramassage en attente pour cette immatriculation.
                </div>
              ) : suggestions.map(n => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => openNotif(n)}
                  className="w-full text-left px-4 py-3 border-b hover:bg-black/5 transition-colors"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>
                      {n.bus_registration ?? '—'}
                    </div>
                    <div className="text-xs px-2 py-0.5 rounded-full"
                      style={n.status === 'pending' ? { backgroundColor: '#FEE2E2', color: '#B91C1C' } : { backgroundColor: '#FEF3C7', color: '#B45309' }}>
                      {n.status === 'pending' ? 'En attente' : 'Consulté'}
                    </div>
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                    {n.route_name ?? '—'} · Départ N°{n.departure_number ?? '—'}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Selected details — locked */}
        {selected && (
          <div className="rounded-2xl border-2 p-5 space-y-3" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <Lock className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                Informations du ramassage
              </h3>
              {marking ? (
                <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--primary)' }} />
              ) : selected.status === 'done' ? (
                <CheckCircle className="w-5 h-5" style={{ color: '#16A34A' }} />
              ) : null}
            </div>
            <InfoRow icon={<MapPin className="w-4 h-4" />} label="Ligne" value={selected.route_name ?? '—'} />
            <InfoRow icon={<Bus className="w-4 h-4" />} label="Immatriculation" value={selected.bus_registration ?? '—'} />
            <InfoRow icon={<MapPin className="w-4 h-4" />} label="Chauffeur" value={selected.driver_name ?? '—'} />
            <InfoRow icon={<Clock className="w-4 h-4" />} label="Date" value={fmtDate(selected.departure_datetime)} />
            <InfoRow icon={<Clock className="w-4 h-4" />} label="Heure" value={fmtTime(selected.departure_datetime)} />
            <InfoRow icon={<Hash className="w-4 h-4" />} label="Numéro de départ" value={selected.departure_number != null ? String(selected.departure_number) : '—'} />
            <InfoRow icon={<MapPin className="w-4 h-4" />} label="Gare de départ" value={selected.origin_station_name ?? '—'} />
            <InfoRow icon={<MapPin className="w-4 h-4" />} label="Gare de destination" value={selected.destination_station_name ?? '—'} />
            <div className="flex items-center justify-between gap-3 py-1 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <span style={{ color: 'var(--text-muted)' }}><Bus className="w-4 h-4" /></span>
                Places libres restantes
              </div>
              <div className="text-sm font-bold" style={{ color: seatsFree > 0 ? '#16A34A' : '#DC2626' }}>
                {seatsFree}
              </div>
            </div>

            {/* Sales form */}
            {selected.status !== 'done' ? (
              <div className="pt-2 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                      Nombre de places vendues
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={seatsFree}
                      value={places}
                      onChange={(e) => { setPlaces(e.target.value); setError(''); }}
                      placeholder="0"
                      className="w-full px-3 py-2.5 rounded-xl border-2 text-base font-bold"
                      style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                      Montant collecté (FCFA)
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      value={montant}
                      onChange={(e) => { setMontant(e.target.value); setError(''); }}
                      placeholder="0"
                      className="w-full px-3 py-2.5 rounded-xl border-2 text-base font-bold"
                      style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                    />
                  </div>
                </div>
                {error && (
                  <div className="flex items-start gap-2 rounded-xl p-3 text-sm" style={{ backgroundColor: '#FEE2E2', color: '#B91C1C' }}>
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleValidate}
                  disabled={submitting}
                  className="w-full py-3 rounded-xl font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50 transition-opacity"
                  style={{ backgroundColor: 'var(--primary)' }}
                >
                  {submitting ? (
                    <><Loader2 className="w-5 h-5 animate-spin" /> Validation…</>
                  ) : (
                    <><Printer className="w-5 h-5" /> Valider et imprimer le bordereau</>
                  )}
                </button>
              </div>
            ) : (
              <div className="pt-2 space-y-3">
                <div className="rounded-xl p-3 flex items-center gap-2 text-sm font-medium" style={{ backgroundColor: '#DCFCE7', color: '#15803D' }}>
                  <CheckCircle className="w-5 h-5" /> Ramassage validé
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <InfoRow icon={<Hash className="w-4 h-4" />} label="Places vendues" value={String(selected.collected_places ?? 0)} />
                  <InfoRow icon={<Hash className="w-4 h-4" />} label="Montant collecté" value={`${(selected.collected_amount ?? 0).toLocaleString('fr-FR')} FCFA`} />
                </div>
                <button
                  type="button"
                  onClick={() => printRamassageBordereau({ notif: selected, stationName: session?.station_name })}
                  className="w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 border-2"
                  style={{ borderColor: 'var(--primary)', color: 'var(--primary)', backgroundColor: 'var(--surface)' }}
                >
                  <Printer className="w-5 h-5" /> Réimprimer le bordereau
                </button>
                <div className="flex justify-end">
                  <ChangeRequestButton
                    compact
                    operationType="paiement_recette"
                    operationId={selected.id}
                    operationTable="ramassage_notifications"
                    operationReference={`Ramassage ${selected.bus_registration ?? ''} — Départ N°${selected.departure_number ?? ''}`}
                    operationSnapshot={selected as unknown as Record<string, unknown>}
                    stationId={session?.station_id}
                    stationName={session?.station_name}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Pending list */}
        <div className="rounded-2xl border-2 overflow-hidden" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="px-4 py-3 border-b font-bold text-sm" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
            En attente
          </div>
          {loading ? (
            <div className="p-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Chargement…</div>
          ) : pendingList.length === 0 ? (
            <div className="p-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              Aucun ramassage en attente.
            </div>
          ) : pendingList.map(n => (
            <button
              key={n.id}
              type="button"
              onClick={() => openNotif(n)}
              className="w-full text-left px-4 py-3 border-b hover:bg-black/5 transition-colors flex items-center justify-between gap-3"
              style={{ borderColor: 'var(--border)' }}
            >
              <div>
                <div className="font-bold" style={{ color: 'var(--text-primary)' }}>{n.bus_registration ?? '—'}</div>
                <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {n.route_name ?? '—'} · N°{n.departure_number ?? '—'} · {n.origin_station_name ?? '—'}
                </div>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap"
                style={n.status === 'pending' ? { backgroundColor: '#FEE2E2', color: '#B91C1C' } : { backgroundColor: '#FEF3C7', color: '#B45309' }}>
                {n.status === 'pending' ? 'En attente' : 'Consulté'}
              </span>
            </button>
          ))}
        </div>
      </div>
      )}

    </POSLayout>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
        <span style={{ color: 'var(--text-muted)' }}>{icon}</span>
        {label}
      </div>
      <div className="text-sm font-bold text-right" style={{ color: 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}
