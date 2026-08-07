import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/services/supabase';
import { useAuthStore } from '@/store/authStore';
import { printRamassageBordereau } from '@/services/pos/printService';
import {
  Bus, Search, MapPin, Hash, Loader2, CheckCircle, Clock, Lock, Printer,
  AlertCircle, Package, ArrowDownToLine, Calendar, User, Banknote,
} from 'lucide-react';
import toast from 'react-hot-toast';

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

const STATUS_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  pending:   { label: 'En attente', bg: '#FEE2E2', color: '#B91C1C' },
  consulted: { label: 'Consulté',    bg: '#FEF3C7', color: '#B45309' },
  done:      { label: 'Validé',      bg: '#DCFCE7', color: '#15803D' },
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return `${fmtDate(iso)} à ${fmtTime(iso)}`;
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

export default function ChefGareRamassage() {
  const { user } = useAuthStore();
  const [stationId, setStationId] = useState<string | null>(null);
  const [stationName, setStationName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notifs, setNotifs] = useState<RamassageNotif[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<RamassageNotif | null>(null);
  const [places, setPlaces] = useState('');
  const [montant, setMontant] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'pending' | 'done' | 'all'>('pending');

  // ── Load station ──
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data: sid } = await supabase.rpc('get_my_station_id');
        if (!sid) {
          setLoading(false);
          return;
        }
        setStationId(sid as string);
        const { data: st } = await supabase
          .from('stations')
          .select('name')
          .eq('id', sid as string)
          .maybeSingle();
        setStationName(st?.name ?? null);
      } catch {
        toast.error('Impossible de charger votre gare.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Load notifications + realtime ──
  const load = async () => {
    if (!stationId) return;
    const { data, error } = await supabase
      .from('ramassage_notifications')
      .select('*')
      .eq('destination_station_id', stationId)
      .order('created_at', { ascending: false });
    if (!error) setNotifs((data as RamassageNotif[]) ?? []);
  };

  useEffect(() => {
    load();
    if (!stationId) return;
    const ch = supabase
      .channel('chef_gare_ramassage_' + stationId)
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

  // ── Filtered list ──
  const filteredNotifs = useMemo(() => {
    if (filter === 'pending') return notifs.filter(n => n.status === 'pending' || n.status === 'consulted');
    if (filter === 'done') return notifs.filter(n => n.status === 'done');
    return notifs;
  }, [notifs, filter]);

  const pendingCount = notifs.filter(n => n.status === 'pending' || n.status === 'consulted').length;
  const doneCount = notifs.filter(n => n.status === 'done').length;

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = notifs.filter(n => n.status === 'pending' || n.status === 'consulted');
    if (!q) return pool.slice(0, 8);
    return pool.filter(n =>
      (n.bus_registration ?? '').toLowerCase().includes(q) ||
      (n.route_name ?? '').toLowerCase().includes(q) ||
      String(n.departure_number ?? '').includes(q),
    ).slice(0, 8);
  }, [query, notifs]);

  const seatsFree = selected
    ? Math.max(0, (selected.seats_total ?? 0) - (selected.seats_sold ?? 0))
    : 0;

  const openNotif = async (n: RamassageNotif) => {
    setSelected(n);
    setQuery(n.bus_registration ?? '');
    setPlaces(n.collected_places != null ? String(n.collected_places) : '');
    setMontant(n.collected_amount != null ? String(n.collected_amount) : '');
    setError('');
    if (n.status === 'pending') {
      const { error } = await supabase
        .from('ramassage_notifications')
        .update({ status: 'consulted', consulted_at: new Date().toISOString() })
        .eq('id', n.id);
      if (!error) {
        setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, status: 'consulted', consulted_at: new Date().toISOString() } : x));
        setSelected(prev => prev ? { ...prev, status: 'consulted', consulted_at: new Date().toISOString() } : prev);
      }
    }
  };

  const validate = (): string | null => {
    const p = parseInt(places, 10);
    if (isNaN(p) || p < 0) return 'Veuillez saisir un nombre de places valide.';
    if (p > seatsFree) return `Le nombre de places ne peut pas dépasser le quota disponible (${seatsFree} place${seatsFree > 1 ? 's' : ''} libre${seatsFree > 1 ? 's' : ''}).`;
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
    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from('ramassage_notifications')
      .update({
        status: 'done',
        collected_places: p,
        collected_amount: m,
        collected_by_name: user?.full_name ?? user?.email ?? null,
        collected_at: nowIso,
      })
      .eq('id', selected.id);
    setSubmitting(false);
    if (error) {
      setError("Erreur lors de l'enregistrement du ramassage.");
      return;
    }
    const updated = { ...selected, status: 'done', collected_places: p, collected_amount: m, collected_by_name: user?.full_name ?? null, collected_at: nowIso };
    setNotifs(prev => prev.map(x => x.id === selected.id ? updated : x));
    setSelected(updated);
    toast.success('Ramassage validé avec succès.');
    // Auto-print bordereau
    try {
      await printRamassageBordereau({
        notif: updated,
        stationName: stationName ?? undefined,
      });
    } catch { /* best-effort print */ }
  };

  // ── Loading state ──
  if (loading) return (
    <div className="p-8 flex items-center justify-center min-h-64">
      <div className="w-10 h-10 border-4 rounded-full animate-spin"
        style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
    </div>
  );

  if (!stationId) return (
    <div className="p-8">
      <div className="max-w-lg mx-auto text-center py-20">
        <MapPin className="w-16 h-16 mx-auto mb-4" style={{ color: '#D1D5DB' }} />
        <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
          Aucune gare assignée
        </h2>
        <p style={{ color: 'var(--text-secondary)' }}>
          Contactez l'administrateur pour être rattaché à votre gare.
        </p>
      </div>
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      {/* ── Page title ── */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <ArrowDownToLine className="w-7 h-7" style={{ color: 'var(--primary)' }} />
            Ramassage
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Gare de destination : <span className="font-semibold">{stationName ?? '—'}</span>
          </p>
        </div>
      </div>

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl p-4 border-2 flex items-center gap-4"
          style={{ backgroundColor: '#FEF3C7', borderColor: '#F59E0B' }}>
          <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#F59E0B', color: 'white' }}>
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs font-medium" style={{ color: '#92400E' }}>En attente</div>
            <div className="text-2xl font-bold" style={{ color: '#78350F' }}>{pendingCount}</div>
          </div>
        </div>
        <div className="rounded-2xl p-4 border-2 flex items-center gap-4"
          style={{ backgroundColor: '#DCFCE7', borderColor: '#16A34A' }}>
          <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#16A34A', color: 'white' }}>
            <CheckCircle className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs font-medium" style={{ color: '#166534' }}>Validés</div>
            <div className="text-2xl font-bold" style={{ color: '#14532D' }}>{doneCount}</div>
          </div>
        </div>
        <div className="rounded-2xl p-4 border-2 flex items-center gap-4"
          style={{ backgroundColor: 'var(--surface-raised)', borderColor: 'var(--border)' }}>
          <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'var(--primary)', color: 'white' }}>
            <Package className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Total</div>
            <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{notifs.length}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Left: search + list ── */}
        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
              Rechercher par immatriculation, ligne ou n° de départ
            </label>
            <div className="relative">
              <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value); }}
                placeholder="Ex: 0349WWCI01"
                className="w-full pl-10 pr-4 py-3 rounded-xl border-2 text-base font-medium"
                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              />
            </div>
            {query && suggestions.length > 0 && (
              <div className="absolute z-20 left-0 right-0 mt-1 rounded-xl border-2 overflow-hidden shadow-lg"
                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
                {suggestions.map(n => (
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
                      <span className="text-xs px-2 py-0.5 rounded-full"
                        style={STATUS_BADGE[n.status] ?? STATUS_BADGE.pending}>
                        {STATUS_BADGE[n.status]?.label ?? n.status}
                      </span>
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                      {n.route_name ?? '—'} · N°{n.departure_number ?? '—'}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Filter tabs */}
          <div className="flex gap-2">
            {([
              { key: 'pending' as const, label: 'En attente', count: pendingCount },
              { key: 'done' as const, label: 'Validés', count: doneCount },
              { key: 'all' as const, label: 'Tous', count: notifs.length },
            ]).map(tab => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilter(tab.key)}
                className="px-4 py-2 rounded-xl text-sm font-semibold transition-all"
                style={
                  filter === tab.key
                    ? { backgroundColor: 'var(--primary)', color: 'white' }
                    : { backgroundColor: 'var(--surface)', color: 'var(--text-secondary)', border: '2px solid var(--border)' }
                }
              >
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>

          {/* List */}
          <div className="rounded-2xl border-2 overflow-hidden" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
            {filteredNotifs.length === 0 ? (
              <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                Aucun ramassage dans cette catégorie.
              </div>
            ) : filteredNotifs.map(n => (
              <button
                key={n.id}
                type="button"
                onClick={() => openNotif(n)}
                className="w-full text-left px-4 py-3 border-b hover:bg-black/5 transition-colors flex items-center justify-between gap-3"
                style={{
                  borderColor: 'var(--border)',
                  backgroundColor: selected?.id === n.id ? 'var(--primary-light)' : undefined,
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                    {n.bus_registration ?? '—'}
                  </div>
                  <div className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                    {n.route_name ?? '—'} · N°{n.departure_number ?? '—'} · {n.origin_station_name ?? '—'}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {fmtDateTime(n.departure_datetime)}
                  </div>
                </div>
                <span className="text-xs px-2 py-1 rounded-full whitespace-nowrap flex-shrink-0"
                  style={STATUS_BADGE[n.status] ?? STATUS_BADGE.pending}>
                  {STATUS_BADGE[n.status]?.label ?? n.status}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Right: detail panel ── */}
        <div>
          {!selected ? (
            <div className="rounded-2xl border-2 p-8 text-center" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <ArrowDownToLine className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Sélectionnez un ramassage dans la liste pour consulter ou valider.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border-2 p-5 space-y-3 sticky top-6"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <Lock className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                  Informations du départ
                </h3>
                <span className="text-xs px-3 py-1 rounded-full font-semibold"
                  style={STATUS_BADGE[selected.status] ?? STATUS_BADGE.pending}>
                  {STATUS_BADGE[selected.status]?.label ?? selected.status}
                </span>
              </div>

              {/* Departure info — locked */}
              <div className="rounded-xl p-4 space-y-1"
                style={{ backgroundColor: 'var(--bg-subtle)' }}>
                <InfoRow icon={<Hash className="w-4 h-4" />} label="N° de départ" value={selected.departure_number != null ? String(selected.departure_number) : '—'} />
                <InfoRow icon={<Bus className="w-4 h-4" />} label="Matricule du car" value={selected.bus_registration ?? '—'} />
                <InfoRow icon={<MapPin className="w-4 h-4" />} label="Ligne" value={selected.route_name ?? '—'} />
                <InfoRow icon={<User className="w-4 h-4" />} label="Chauffeur" value={selected.driver_name ?? '—'} />
                <InfoRow icon={<MapPin className="w-4 h-4" />} label="Gare de départ" value={selected.origin_station_name ?? '—'} />
                <InfoRow icon={<MapPin className="w-4 h-4" />} label="Gare de destination" value={selected.destination_station_name ?? '—'} />
                <InfoRow icon={<Calendar className="w-4 h-4" />} label="Date du départ" value={fmtDate(selected.departure_datetime)} />
                <InfoRow icon={<Clock className="w-4 h-4" />} label="Heure du départ" value={fmtTime(selected.departure_datetime)} />
                <InfoRow icon={<Bus className="w-4 h-4" />} label="Sièges disponibles" value={String(seatsFree)} />
              </div>

              {/* Saisie date/time — auto-generated and locked */}
              <div className="rounded-xl p-3 flex items-center gap-2 text-xs"
                style={{ backgroundColor: '#EFF6FF', color: '#1E40AF' }}>
                <Lock className="w-3.5 h-3.5 flex-shrink-0" />
                <span>
                  Saisie verrouillée le{' '}
                  <strong>{fmtDateTime(selected.status === 'done' ? selected.collected_at : new Date().toISOString())}</strong>
                </span>
              </div>

              {/* Sales form or locked result */}
              {selected.status !== 'done' ? (
                <div className="pt-1 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                        Nombre de sièges vendus
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
                      <><CheckCircle className="w-5 h-5" /> Valider le ramassage</>
                    )}
                  </button>
                </div>
              ) : (
                <div className="pt-1 space-y-3">
                  <div className="rounded-xl p-3 flex items-center gap-2 text-sm font-medium" style={{ backgroundColor: '#DCFCE7', color: '#15803D' }}>
                    <CheckCircle className="w-5 h-5" /> Ramassage validé et verrouillé
                  </div>
                  <div className="rounded-xl p-4 space-y-1" style={{ backgroundColor: 'var(--bg-subtle)' }}>
                    <InfoRow icon={<Hash className="w-4 h-4" />} label="Sièges vendus" value={String(selected.collected_places ?? 0)} />
                    <InfoRow icon={<Banknote className="w-4 h-4" />} label="Montant collecté" value={`${(selected.collected_amount ?? 0).toLocaleString('fr-FR')} FCFA`} />
                    <InfoRow icon={<User className="w-4 h-4" />} label="Validé par" value={selected.collected_by_name ?? '—'} />
                    <InfoRow icon={<Clock className="w-4 h-4" />} label="Date/heure validation" value={fmtDateTime(selected.collected_at)} />
                  </div>
                  <button
                    type="button"
                    onClick={() => printRamassageBordereau({ notif: selected, stationName: stationName ?? undefined })}
                    className="w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 border-2"
                    style={{ borderColor: 'var(--primary)', color: 'var(--primary)', backgroundColor: 'var(--surface)' }}
                  >
                    <Printer className="w-5 h-5" /> Réimprimer le bordereau
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
