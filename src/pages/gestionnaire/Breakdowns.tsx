import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../store/authStore';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Wrench, RefreshCw, AlertTriangle, Bus, MapPin, User, Banknote,
  Users, X, Loader2, ArrowRight, CheckCircle2, History, Building2,
  Calculator, Search
} from 'lucide-react';
import toast from 'react-hot-toast';

interface BreakdownRow {
  id: string;
  schedule_id: string;
  original_bus_id: string | null;
  original_driver_id: string | null;
  original_company_id: string | null;
  station_id: string | null;
  route_id: string | null;
  passengers_count: number;
  fill_rate: number;
  revenue_amount: number;
  charges_amount: number | null;
  net_balance: number | null;
  net_balance_adjusted: number | null;
  breakdown_at: string;
  reason: string | null;
  observations: string | null;
  replacement_bus_id: string | null;
  replacement_driver_id: string | null;
  replacement_company_id: string | null;
  beneficiary_company_id: string | null;
  replacement_route_label: string | null;
  replacement_at: string | null;
  amount_original_company: number | null;
  amount_replacement_company: number | null;
  split_reason: string | null;
  status: string;
  schedule?: { id: string; departure_datetime: string; route_id: string | null; routes?: { name: string } | null };
  original_bus?: { registration_number: string; model: string | null; total_seats: number; company_id: string; companies?: { name: string } | null } | null;
  original_driver?: { first_name: string; last_name: string } | null;
  original_company?: { id: string; name: string } | null;
  replacement_bus?: { registration_number: string; model: string | null; company_id: string; companies?: { name: string } | null } | null;
  replacement_company?: { id: string; name: string } | null;
  beneficiary_company?: { id: string; name: string } | null;
  station?: { name: string } | null;
}

interface BusOption {
  id: string;
  registration_number: string;
  model: string | null;
  total_seats: number;
  company_id: string;
  company_name: string;
}

interface DriverOption { id: string; first_name: string; last_name: string; }
interface CompanyOption { id: string; name: string; }

interface AuditRow {
  id: string;
  action: string;
  performed_at: string;
  performed_by: string | null;
  revenue_amount: number;
  charges_amount: number;
  net_balance_before: number;
  amount_to_beneficiary: number;
  net_balance_after: number;
  reason: string | null;
  observation: string | null;
  original_company?: { name: string } | null;
  beneficiary_company?: { name: string } | null;
  original_bus?: { registration_number: string } | null;
  replacement_bus?: { registration_number: string } | null;
  performer?: { first_name: string; last_name: string } | null;
}

const fmt = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n)).replace(/\s/g, ' ') + ' FCFA';

const STATUS_STYLE: Record<string, { label: string; bg: string; color: string; border: string }> = {
  signalee:  { label: 'Signalée',  bg: '#FEF2F2', color: '#991B1B', border: '#FCA5A5' },
  remplace:  { label: 'Remplacé',  bg: '#EFF6FF', color: '#1D4ED8', border: '#BFDBFE' },
  cloture:   { label: 'Clôturé',   bg: '#ECFDF5', color: '#065F46', border: '#A7F3D0' },
  annule:    { label: 'Annulé',    bg: '#F3F4F6', color: '#374151', border: '#D1D5DB' },
};

export default function GestionnaireBreakdowns({ mode = 'gestionnaire' }: { mode?: 'gestionnaire' | 'daf' } = {}) {
  const { user } = useAuthStore();
  const isDaf = mode === 'daf';
  const [rows, setRows] = useState<BreakdownRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selected, setSelected] = useState<BreakdownRow | null>(null);

  const [buses, setBuses] = useState<BusOption[]>([]);
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);

  const [replacementBusId, setReplacementBusId] = useState<string>('');
  const [replacementDriverId, setReplacementDriverId] = useState<string>('');
  const [beneficiaryCompanyId, setBeneficiaryCompanyId] = useState<string>('');
  const [routeLabel, setRouteLabel] = useState<string>('');
  const [netAdjusted, setNetAdjusted] = useState<string>('');
  const [amountBeneficiary, setAmountBeneficiary] = useState<string>('0');
  const [splitReason, setSplitReason] = useState<string>('');
  const [splitObservation, setSplitObservation] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const myCompanyId = user?.company_id;

  const load = async () => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase
        .from('schedule_breakdowns')
        .select(`
          *,
          schedule:schedules!schedule_breakdowns_schedule_id_fkey(id, departure_datetime, route_id, routes(name)),
          original_bus:buses!schedule_breakdowns_original_bus_id_fkey(registration_number, model, total_seats, company_id, companies(name)),
          original_driver:users!schedule_breakdowns_original_driver_id_fkey(first_name, last_name),
          original_company:companies!schedule_breakdowns_original_company_id_fkey(id, name),
          replacement_bus:buses!schedule_breakdowns_replacement_bus_id_fkey(registration_number, model, company_id, companies(name)),
          replacement_company:companies!schedule_breakdowns_replacement_company_id_fkey(id, name),
          beneficiary_company:companies!schedule_breakdowns_beneficiary_company_id_fkey(id, name),
          station:stations!schedule_breakdowns_station_id_fkey(name)
        `)
        .order('breakdown_at', { ascending: false });

      if (error) throw error;

      const allRows = (data ?? []) as BreakdownRow[];
      const visible = isDaf
        ? allRows
        : allRows.filter((r: any) =>
            !myCompanyId ||
            r.original_company_id === myCompanyId ||
            r.beneficiary_company_id === myCompanyId ||
            r.replacement_company_id === myCompanyId
          );

      setRows(visible);
    } catch (e: any) {
      console.error(e);
      toast.error(e.message ?? 'Erreur de chargement');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel('breakdowns-gestionnaire')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_breakdowns' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [myCompanyId]);

  const loadAudit = async (breakdownId: string) => {
    const { data } = await supabase
      .from('schedule_breakdown_audit')
      .select(`
        *,
        original_company:companies!schedule_breakdown_audit_original_company_id_fkey(name),
        beneficiary_company:companies!schedule_breakdown_audit_beneficiary_company_id_fkey(name),
        original_bus:buses!schedule_breakdown_audit_original_bus_id_fkey(registration_number),
        replacement_bus:buses!schedule_breakdown_audit_replacement_bus_id_fkey(registration_number),
        performer:users!schedule_breakdown_audit_performed_by_fkey(first_name, last_name)
      `)
      .eq('breakdown_id', breakdownId)
      .order('performed_at', { ascending: false });
    setAudit((data ?? []) as AuditRow[]);
  };

  const openHandle = async (row: BreakdownRow) => {
    setSelected(row);
    setShowHistory(false);
    setReplacementBusId(row.replacement_bus_id ?? '');
    setReplacementDriverId(row.replacement_driver_id ?? '');
    setBeneficiaryCompanyId(row.beneficiary_company_id ?? '');
    setRouteLabel(row.replacement_route_label ?? '');
    const initialNet = row.net_balance_adjusted ?? row.net_balance ?? row.revenue_amount;
    setNetAdjusted(String(initialNet ?? 0));
    setAmountBeneficiary(String(row.amount_replacement_company ?? 0));
    setSplitReason(row.split_reason ?? '');
    setSplitObservation('');

    const [{ data: busData }, { data: driverData }, { data: compData }] = await Promise.all([
      supabase
        .from('buses')
        .select('id, registration_number, model, total_seats, company_id, companies(name)')
        .in('status', ['disponible', 'en_service'])
        .eq('is_active', true)
        .order('registration_number'),
      supabase
        .from('users')
        .select('id, first_name, last_name')
        .eq('role', 'chauffeur')
        .eq('status', 'active')
        .order('last_name'),
      supabase
        .from('companies')
        .select('id, name')
        .order('name'),
    ]);

    setBuses(((busData ?? []) as any[]).map(b => ({
      id: b.id,
      registration_number: b.registration_number,
      model: b.model,
      total_seats: b.total_seats,
      company_id: b.company_id,
      company_name: b.companies?.name ?? '—',
    })));
    setDrivers((driverData ?? []) as DriverOption[]);
    setCompanies((compData ?? []) as CompanyOption[]);

    await loadAudit(row.id);
  };

  const replacementBus = useMemo(
    () => buses.find(b => b.id === replacementBusId),
    [buses, replacementBusId]
  );

  // Once a bus is chosen, beneficiary defaults to that bus's company
  useEffect(() => {
    if (replacementBus && !beneficiaryCompanyId) {
      setBeneficiaryCompanyId(replacementBus.company_id);
    }
  }, [replacementBus]);

  const sameCompany = useMemo(() => {
    if (!selected) return false;
    const benefCo = beneficiaryCompanyId || replacementBus?.company_id;
    if (!benefCo) return true;
    return benefCo === selected.original_company_id;
  }, [selected, beneficiaryCompanyId, replacementBus]);

  const netNum = parseFloat(netAdjusted) || 0;
  const benefNum = parseFloat(amountBeneficiary) || 0;
  const remainingOriginal = Math.max(0, netNum - benefNum);
  const overLimit = benefNum > netNum;

  useEffect(() => {
    if (sameCompany) setAmountBeneficiary('0');
  }, [sameCompany]);

  const submitReplacement = async () => {
    if (!selected) return;
    if (!replacementBusId) { toast.error('Sélectionnez un bus de remplacement'); return; }
    if (!replacementDriverId) { toast.error('Sélectionnez un chauffeur de remplacement'); return; }
    if (!replacementBus) return;
    if (netNum < 0) { toast.error('Le solde net doit être positif'); return; }
    if (overLimit) {
      toast.error('Le montant attribué dépasse le solde net disponible');
      return;
    }
    if (!sameCompany && (!beneficiaryCompanyId || benefNum <= 0)) {
      toast.error('Renseignez la société bénéficiaire et le montant attribué');
      return;
    }
    if (!sameCompany && !splitReason.trim()) {
      toast.error('Renseignez le motif de la répartition');
      return;
    }

    setSubmitting(true);
    try {
      const finalAmountBenef = sameCompany ? 0 : benefNum;
      const finalAmountOrig = netNum - finalAmountBenef;
      const finalBenefCompanyId = sameCompany ? null : beneficiaryCompanyId;

      const { error: bErr } = await supabase
        .from('schedule_breakdowns')
        .update({
          replacement_bus_id: replacementBusId,
          replacement_driver_id: replacementDriverId,
          replacement_company_id: replacementBus.company_id,
          beneficiary_company_id: finalBenefCompanyId,
          replacement_route_label: routeLabel || null,
          replacement_at: new Date().toISOString(),
          replaced_by: user?.id ?? null,
          net_balance_adjusted: netNum,
          amount_original_company: finalAmountOrig,
          amount_replacement_company: finalAmountBenef,
          split_reason: splitReason.trim() || null,
          status: 'cloture',
        })
        .eq('id', selected.id);
      if (bErr) throw bErr;

      const { error: sErr } = await supabase
        .from('schedules')
        .update({
          bus_id: replacementBusId,
          driver_id: replacementDriverId,
          status: 'en_cours',
        })
        .eq('id', selected.schedule_id);
      if (sErr) throw sErr;

      await supabase.from('schedule_breakdown_audit').insert({
        breakdown_id: selected.id,
        action: 'split',
        performed_by: user?.id ?? null,
        original_company_id: selected.original_company_id,
        beneficiary_company_id: finalBenefCompanyId,
        original_bus_id: selected.original_bus_id,
        replacement_bus_id: replacementBusId,
        revenue_amount: Number(selected.revenue_amount || 0),
        charges_amount: Number(selected.charges_amount || 0),
        net_balance_before: Number(selected.net_balance ?? selected.revenue_amount ?? 0),
        amount_to_beneficiary: finalAmountBenef,
        net_balance_after: finalAmountOrig,
        reason: splitReason.trim() || null,
        observation: splitObservation.trim() || null,
        payload: { route_label: routeLabel || null, net_balance_adjusted: netNum }
      });

      toast.success('Répartition enregistrée');
      setSelected(null);
      load();
    } catch (e: any) {
      console.error(e);
      toast.error(e.message ?? 'Erreur lors de l\'enregistrement');
    } finally {
      setSubmitting(false);
    }
  };

  const statusFiltered = statusFilter === 'all' ? rows : rows.filter(r => r.status === statusFilter);
  const searchMatch = (r: BreakdownRow, query: string) => {
    const ql = query.toLowerCase();
    return [
      r.original_bus?.registration_number,
      r.original_bus?.model,
      r.replacement_bus?.registration_number,
      r.original_company?.name,
      r.replacement_company?.name,
      r.beneficiary_company?.name,
      r.schedule?.routes?.name,
      r.station?.name,
    ].some(v => v != null && v.toLowerCase().includes(ql));
  };
  const q = searchQuery.trim();
  const filtered = q ? statusFiltered.filter(r => searchMatch(r, q)) : statusFiltered;
  const suggestions = q.length >= 2 ? statusFiltered.filter(r => searchMatch(r, q)).slice(0, 8) : [];

  const stats = useMemo(() => {
    const signalees = rows.filter(r => r.status === 'signalee').length;
    const cloturees = rows.filter(r => r.status === 'cloture').length;
    const totalNet = rows.reduce((s, r) => s + Number(r.net_balance ?? r.revenue_amount ?? 0), 0);
    const myAmount = isDaf
      ? rows.reduce((s, r) => s + Number(r.amount_replacement_company ?? 0), 0)
      : rows.reduce((s, r) => {
          if (r.original_company_id === myCompanyId) return s + Number(r.amount_original_company ?? 0);
          if (r.beneficiary_company_id === myCompanyId || r.replacement_company_id === myCompanyId) {
            return s + Number(r.amount_replacement_company ?? 0);
          }
          return s;
        }, 0);
    return { signalees, cloturees, totalNet, myAmount };
  }, [rows, myCompanyId, isDaf]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--primary)' }} />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Wrench className="w-6 h-6" style={{ color: '#DC2626' }} />
            Gestion des pannes
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {isDaf ? 'Toutes sociétés — traitement et répartition des recettes' : 'Répartition du solde net (recette − charges) entre sociétés'}
          </p>
        </div>
        <button
          onClick={load}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium"
          style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Actualiser
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Signalées" value={stats.signalees} icon={<AlertTriangle className="w-5 h-5" />} color="#DC2626" />
        <KpiCard label="Clôturées" value={stats.cloturees} icon={<CheckCircle2 className="w-5 h-5" />} color="#10B981" />
        <KpiCard label="Solde net total" value={fmt(stats.totalNet)} icon={<Banknote className="w-5 h-5" />} color="#1D4ED8" />
        <KpiCard label={isDaf ? 'Transféré inter-soc.' : 'Ma part'} value={fmt(stats.myAmount)} icon={<Banknote className="w-5 h-5" />} color="#065F46" />
      </div>

      <div className="flex gap-2 flex-wrap">
        {[
          { v: 'all', l: 'Tous' },
          { v: 'signalee', l: 'À traiter' },
          { v: 'cloture', l: 'Clôturées' },
        ].map(opt => (
          <button
            key={opt.v}
            onClick={() => setStatusFilter(opt.v)}
            className="px-3 py-1.5 rounded-lg text-sm font-medium border"
            style={{
              backgroundColor: statusFilter === opt.v ? 'var(--primary)' : 'var(--surface)',
              color: statusFilter === opt.v ? 'var(--text-on-primary)' : 'var(--text-primary)',
              borderColor: 'var(--border)',
            }}
          >
            {opt.l}
          </button>
        ))}
      </div>

      {isDaf && (
        <div className="relative">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
            <input
              type="text"
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setShowSuggestions(true); }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              placeholder="Rechercher : immatriculation, société, ligne, gare, destination…"
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border text-sm"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
            />
          </div>
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute z-20 mt-1 w-full rounded-lg border shadow-lg max-h-72 overflow-y-auto" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
              {suggestions.map(r => (
                <button
                  key={r.id}
                  onMouseDown={(e) => { e.preventDefault(); openHandle(r); setSearchQuery(''); setShowSuggestions(false); }}
                  className="w-full px-4 py-2.5 text-left text-sm border-b last:border-0 hover:opacity-80"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div className="font-medium" style={{ color: 'var(--text-primary)' }}>
                    {r.original_bus?.registration_number ?? '—'} — {r.original_company?.name ?? '—'}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {r.station?.name ?? '—'} · {r.schedule?.routes?.name ?? '—'}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead style={{ backgroundColor: 'var(--bg-subtle)' }}>
              <tr>
                <Th>Date</Th><Th>Bus / Société</Th><Th>Gare / Itinéraire</Th>
                <Th>Passagers</Th><Th>Recette</Th><Th>Charges</Th><Th>Solde net</Th>
                <Th>Statut</Th><Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-10" style={{ color: 'var(--text-secondary)' }}>Aucune panne</td></tr>
              ) : filtered.map(r => {
                const style = STATUS_STYLE[r.status] ?? STATUS_STYLE.signalee;
                const net = r.net_balance ?? (Number(r.revenue_amount || 0) - Number(r.charges_amount || 0));
                return (
                  <tr key={r.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <Td>
                      <div className="font-medium">{format(new Date(r.breakdown_at), 'dd/MM/yyyy', { locale: fr })}</div>
                      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{format(new Date(r.breakdown_at), 'HH:mm')}</div>
                    </Td>
                    <Td>
                      <div className="font-medium">{r.original_bus?.registration_number ?? '—'}</div>
                      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{r.original_company?.name ?? '—'}</div>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1"><MapPin className="w-3 h-3" />{r.station?.name ?? '—'}</div>
                      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{r.schedule?.routes?.name ?? '—'}</div>
                    </Td>
                    <Td>{r.passengers_count} ({Math.round(Number(r.fill_rate))}%)</Td>
                    <Td>{fmt(Number(r.revenue_amount || 0))}</Td>
                    <Td>{fmt(Number(r.charges_amount || 0))}</Td>
                    <Td className="font-semibold">{fmt(Number(net))}</Td>
                    <Td>
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium border" style={{
                        backgroundColor: style.bg, color: style.color, borderColor: style.border
                      }}>{style.label}</span>
                    </Td>
                    <Td>
                      {r.status === 'signalee' && (isDaf || r.original_company_id === myCompanyId) ? (
                        <button
                          onClick={() => openHandle(r)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
                          style={{ backgroundColor: '#DC2626' }}
                        >
                          Traiter
                        </button>
                      ) : (
                        <button
                          onClick={() => openHandle(r)}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium border"
                          style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                        >
                          Détails
                        </button>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="rounded-2xl shadow-2xl max-w-4xl w-full max-h-[94vh] overflow-y-auto" style={{ backgroundColor: 'var(--surface)' }}>
            <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 z-10" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: '#FEF2F2' }}>
                  <Wrench className="w-5 h-5" style={{ color: '#DC2626' }} />
                </div>
                <div>
                  <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Panne — {selected.original_bus?.registration_number}</h2>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    Signalée le {format(new Date(selected.breakdown_at), 'dd/MM/yyyy à HH:mm', { locale: fr })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowHistory(!showHistory)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                >
                  <History className="w-3.5 h-3.5" />
                  {showHistory ? 'Masquer' : 'Historique'} ({audit.length})
                </button>
                <button onClick={() => setSelected(null)} className="p-2 rounded-lg hover:bg-gray-100">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              <Section title="Voyage initial">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                  <Info icon={<MapPin className="w-4 h-4" />} label="Gare" value={selected.station?.name ?? '—'} />
                  <Info icon={<MapPin className="w-4 h-4" />} label="Itinéraire" value={selected.schedule?.routes?.name ?? '—'} />
                  <Info icon={<Bus className="w-4 h-4" />} label="Bus" value={`${selected.original_bus?.registration_number ?? '—'} (${selected.original_bus?.total_seats ?? 0} pl.)`} />
                  <Info icon={<User className="w-4 h-4" />} label="Chauffeur" value={selected.original_driver ? `${selected.original_driver.first_name} ${selected.original_driver.last_name}` : '—'} />
                  <Info icon={<Users className="w-4 h-4" />} label="Occupation" value={`${selected.passengers_count}/${selected.original_bus?.total_seats ?? 0}`} />
                  <Info icon={<Users className="w-4 h-4" />} label="Taux remplissage" value={`${Math.round(Number(selected.fill_rate))} %`} />
                  <Info icon={<Banknote className="w-4 h-4" />} label="Recette guichet" value={fmt(Number(selected.revenue_amount || 0))} />
                  <Info icon={<Calculator className="w-4 h-4" />} label="Charges déduites" value={fmt(Number(selected.charges_amount || 0))} />
                  <Info icon={<Banknote className="w-4 h-4" />} label="Solde net" value={fmt(Number(selected.net_balance ?? (Number(selected.revenue_amount || 0) - Number(selected.charges_amount || 0))))} highlight />
                </div>
                {selected.reason && (
                  <div className="mt-3 p-3 rounded-lg border" style={{ backgroundColor: '#FFF7ED', borderColor: '#FDBA74' }}>
                    <div className="text-xs font-semibold mb-1" style={{ color: '#7C2D12' }}>Motif de la panne</div>
                    <div className="text-sm" style={{ color: '#7C2D12' }}>{selected.reason}</div>
                    {selected.observations && <div className="text-xs mt-2" style={{ color: '#7C2D12' }}>{selected.observations}</div>}
                  </div>
                )}
              </Section>

              {showHistory && (
                <Section title="Historique des opérations">
                  {audit.length === 0 ? (
                    <div className="text-sm text-center py-4" style={{ color: 'var(--text-secondary)' }}>Aucune opération</div>
                  ) : (
                    <div className="space-y-2">
                      {audit.map(a => (
                        <div key={a.id} className="p-3 rounded-lg border text-xs" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)' }}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-semibold uppercase" style={{ color: 'var(--text-primary)' }}>{a.action}</span>
                            <span style={{ color: 'var(--text-secondary)' }}>{format(new Date(a.performed_at), 'dd/MM/yyyy HH:mm', { locale: fr })}</span>
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2" style={{ color: 'var(--text-secondary)' }}>
                            <div><strong>Par:</strong> {a.performer ? `${a.performer.first_name} ${a.performer.last_name}` : '—'}</div>
                            <div><strong>Société origine:</strong> {a.original_company?.name ?? '—'}</div>
                            <div><strong>Société bénéf.:</strong> {a.beneficiary_company?.name ?? '—'}</div>
                            <div><strong>Bus init.:</strong> {a.original_bus?.registration_number ?? '—'}</div>
                            <div><strong>Bus rempl.:</strong> {a.replacement_bus?.registration_number ?? '—'}</div>
                            <div><strong>Recette:</strong> {fmt(Number(a.revenue_amount || 0))}</div>
                            <div><strong>Charges:</strong> {fmt(Number(a.charges_amount || 0))}</div>
                            <div><strong>Solde avant:</strong> {fmt(Number(a.net_balance_before || 0))}</div>
                            <div><strong>Vers bénéf.:</strong> {fmt(Number(a.amount_to_beneficiary || 0))}</div>
                            <div><strong>Solde après:</strong> {fmt(Number(a.net_balance_after || 0))}</div>
                          </div>
                          {a.reason && <div className="mt-1"><strong>Motif:</strong> {a.reason}</div>}
                          {a.observation && <div><strong>Observation:</strong> {a.observation}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              )}

              {selected.status === 'signalee' && (isDaf || selected.original_company_id === myCompanyId) ? (
                <>
                  <Section title="Bus de remplacement">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Field label="Bus *">
                        <AutocompleteSelect
                          options={buses}
                          value={replacementBusId}
                          onChange={setReplacementBusId}
                          getLabel={b => `${b.registration_number} — ${b.company_name}`}
                          getSecondary={b => [b.model, `${b.total_seats} places`].filter(Boolean).join(' · ')}
                          getSearchText={b => `${b.registration_number} ${b.company_name} ${b.model ?? ''}`}
                          excludeId={selected.original_bus_id ?? undefined}
                          placeholder="Rechercher un bus (immatriculation, société…)"
                        />
                      </Field>
                      <Field label="Chauffeur *">
                        <AutocompleteSelect
                          options={drivers}
                          value={replacementDriverId}
                          onChange={setReplacementDriverId}
                          getLabel={d => `${d.first_name} ${d.last_name}`}
                          getSearchText={d => `${d.first_name} ${d.last_name}`}
                          placeholder="Rechercher un chauffeur par nom…"
                        />
                      </Field>
                      <div className="md:col-span-2">
                        <Field label="Modification du trajet (optionnel)">
                          <input
                            type="text"
                            value={routeLabel}
                            onChange={e => setRouteLabel(e.target.value)}
                            placeholder="Ex: Détour via Yamoussoukro"
                            className="w-full px-3 py-2 rounded-lg border text-sm"
                            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
                          />
                        </Field>
                      </div>
                    </div>
                  </Section>

                  <Section title="Répartition du solde net">
                    {replacementBus && (
                      <div className="mb-3 p-3 rounded-lg border flex items-center gap-2 text-sm" style={{
                        backgroundColor: sameCompany ? '#ECFDF5' : '#FFF7ED',
                        borderColor: sameCompany ? '#A7F3D0' : '#FDBA74',
                        color: sameCompany ? '#065F46' : '#7C2D12',
                      }}>
                        {sameCompany ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                        {sameCompany
                          ? 'Même société: aucune répartition inter-sociétés. Le solde net reste interne.'
                          : 'Société différente: répartition obligatoire. Saisissez le montant attribué — le solde restant est recalculé automatiquement.'}
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Field label="Solde net (modifiable)">
                        <div className="relative">
                          <input
                            type="number"
                            min="0"
                            value={netAdjusted}
                            onChange={e => setNetAdjusted(e.target.value)}
                            className="w-full px-3 py-2 pr-14 rounded-lg border text-sm font-semibold"
                            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>FCFA</span>
                        </div>
                      </Field>

                      {!sameCompany && (
                        <Field label="Société bénéficiaire *">
                          <select
                            value={beneficiaryCompanyId}
                            onChange={e => setBeneficiaryCompanyId(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border text-sm"
                            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
                          >
                            <option value="">— Choisir —</option>
                            {companies.filter(c => c.id !== selected.original_company_id).map(c => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        </Field>
                      )}

                      {!sameCompany && (
                        <Field label="Montant attribué à la société bénéficiaire *">
                          <div className="relative">
                            <input
                              type="number"
                              min="0"
                              max={netNum}
                              value={amountBeneficiary}
                              onChange={e => setAmountBeneficiary(e.target.value)}
                              className="w-full px-3 py-2 pr-14 rounded-lg border text-sm"
                              style={{
                                borderColor: overLimit ? '#DC2626' : 'var(--border)',
                                backgroundColor: 'var(--surface)'
                              }}
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>FCFA</span>
                          </div>
                        </Field>
                      )}

                      <Field label={`Solde conservé — ${selected.original_company?.name ?? 'Société origine'}`}>
                        <div className="px-3 py-2 rounded-lg border text-sm font-semibold" style={{
                          backgroundColor: 'var(--bg-subtle)',
                          borderColor: 'var(--border)',
                          color: 'var(--text-primary)'
                        }}>
                          {fmt(remainingOriginal)}
                        </div>
                      </Field>
                    </div>

                    {!sameCompany && (
                      <div className="mt-4">
                        <Field label="Motif de la répartition *">
                          <input
                            type="text"
                            value={splitReason}
                            onChange={e => setSplitReason(e.target.value)}
                            placeholder="Ex: Transfert passagers sur bus partenaire suite à panne moteur"
                            className="w-full px-3 py-2 rounded-lg border text-sm"
                            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
                          />
                        </Field>
                      </div>
                    )}

                    <div className="mt-3">
                      <Field label="Observation (optionnel)">
                        <textarea
                          value={splitObservation}
                          onChange={e => setSplitObservation(e.target.value)}
                          rows={2}
                          className="w-full px-3 py-2 rounded-lg border text-sm resize-none"
                          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
                        />
                      </Field>
                    </div>

                    {overLimit && (
                      <div className="mt-3 px-3 py-2 rounded-lg border flex items-center gap-2 text-sm" style={{
                        backgroundColor: '#FEF2F2', borderColor: '#FCA5A5', color: '#991B1B'
                      }}>
                        <AlertTriangle className="w-4 h-4" />
                        Le montant attribué dépasse le solde net disponible ({fmt(netNum)}).
                      </div>
                    )}

                    {!sameCompany && !overLimit && benefNum > 0 && (
                      <div className="mt-3 px-3 py-2 rounded-lg border flex items-center justify-between text-sm" style={{
                        backgroundColor: '#ECFDF5', borderColor: '#A7F3D0', color: '#065F46'
                      }}>
                        <span><Building2 className="inline w-4 h-4 mr-1" />Répartition</span>
                        <span className="font-semibold">
                          {fmt(remainingOriginal)} <ArrowRight className="inline w-3 h-3" /> origine, {fmt(benefNum)} <ArrowRight className="inline w-3 h-3" /> bénéficiaire
                        </span>
                      </div>
                    )}
                  </Section>

                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => setSelected(null)}
                      className="flex-1 px-4 py-2.5 rounded-lg font-medium border"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                    >
                      Annuler
                    </button>
                    <button
                      onClick={submitReplacement}
                      disabled={submitting || !replacementBusId || !replacementDriverId || overLimit || (!sameCompany && (!beneficiaryCompanyId || benefNum <= 0 || !splitReason.trim()))}
                      className="flex-1 px-4 py-2.5 rounded-lg font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50"
                      style={{ backgroundColor: '#DC2626' }}
                    >
                      {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      Valider la répartition
                    </button>
                  </div>
                </>
              ) : selected.replacement_bus_id && (
                <Section title="Remplacement effectué">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                    <Info icon={<Bus className="w-4 h-4" />} label="Bus remplaçant" value={selected.replacement_bus?.registration_number ?? '—'} />
                    <Info icon={<Building2 className="w-4 h-4" />} label="Société bénéficiaire" value={selected.beneficiary_company?.name ?? selected.replacement_company?.name ?? '—'} />
                    <Info icon={<Banknote className="w-4 h-4" />} label={`Part ${selected.original_company?.name ?? 'origine'}`} value={fmt(Number(selected.amount_original_company || 0))} />
                    <Info icon={<Banknote className="w-4 h-4" />} label={`Part ${selected.beneficiary_company?.name ?? selected.replacement_company?.name ?? 'bénéficiaire'}`} value={fmt(Number(selected.amount_replacement_company || 0))} />
                    <Info icon={<Calculator className="w-4 h-4" />} label="Solde net réparti" value={fmt(Number(selected.net_balance_adjusted ?? selected.net_balance ?? 0))} />
                  </div>
                  {selected.split_reason && (
                    <div className="mt-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      <strong>Motif :</strong> {selected.split_reason}
                    </div>
                  )}
                  {selected.replacement_route_label && (
                    <div className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      <strong>Trajet modifié :</strong> {selected.replacement_route_label}
                    </div>
                  )}
                </Section>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, icon, color }: { label: string; value: string | number; icon: React.ReactNode; color: string }) {
  return (
    <div className="rounded-xl border p-4" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${color}15`, color }}>
          {icon}
        </div>
      </div>
      <div className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-secondary)' }}>{title}</h3>
      {children}
    </div>
  );
}

function Info({ icon, label, value, highlight }: { icon: React.ReactNode; label: string; value: string; highlight?: boolean }) {
  return (
    <div className={highlight ? 'p-2 rounded-lg' : ''} style={highlight ? { backgroundColor: '#ECFDF5', border: '1px solid #A7F3D0' } : {}}>
      <div className="flex items-center gap-1 text-xs mb-0.5" style={{ color: highlight ? '#065F46' : 'var(--text-secondary)' }}>
        {icon}{label}
      </div>
      <div className="font-medium" style={{ color: highlight ? '#065F46' : 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>{label}</label>
      {children}
    </div>
  );
}

function AutocompleteSelect<T extends { id: string }>({
  options,
  value,
  onChange,
  getLabel,
  getSecondary,
  getSearchText,
  placeholder,
  excludeId,
}: {
  options: T[];
  value: string;
  onChange: (id: string) => void;
  getLabel: (opt: T) => string;
  getSecondary?: (opt: T) => string;
  getSearchText: (opt: T) => string;
  placeholder: string;
  excludeId?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selectedOpt = options.find(o => o.id === value) ?? null;
  const ql = query.toLowerCase().trim();
  const filtered = options
    .filter(o => o.id !== excludeId)
    .filter(o => !ql || getSearchText(o).toLowerCase().includes(ql))
    .slice(0, 20);

  if (selectedOpt) {
    return (
      <div
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-sm"
        style={{ borderColor: '#A7F3D0', backgroundColor: '#ECFDF5', color: '#065F46' }}
      >
        <span className="flex items-center gap-2 truncate">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span className="truncate font-medium">{getLabel(selectedOpt)}</span>
          {getSecondary && <span className="text-xs opacity-70">· {getSecondary(selectedOpt)}</span>}
        </span>
        <button
          type="button"
          onClick={() => { onChange(''); setQuery(''); }}
          className="p-1 rounded hover:bg-black/5 shrink-0"
          style={{ color: '#065F46' }}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
      <input
        type="text"
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder={placeholder}
        className="w-full pl-10 pr-4 py-2 rounded-lg border text-sm"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
      />
      {open && filtered.length > 0 && (
        <div
          className="absolute z-30 mt-1 w-full rounded-lg border shadow-lg max-h-60 overflow-y-auto"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
        >
          {filtered.map(o => (
            <button
              key={o.id}
              type="button"
              onMouseDown={e => { e.preventDefault(); onChange(o.id); setQuery(''); setOpen(false); }}
              className="w-full px-4 py-2.5 text-left text-sm border-b last:border-0 hover:opacity-80"
              style={{ borderColor: 'var(--border)' }}
            >
              <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{getLabel(o)}</div>
              {getSecondary && (
                <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{getSecondary(o)}</div>
              )}
            </button>
          ))}
        </div>
      )}
      {open && filtered.length === 0 && ql && (
        <div
          className="absolute z-30 mt-1 w-full rounded-lg border shadow-lg px-4 py-3 text-sm"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-secondary)' }}
        >
          Aucun résultat pour « {query} »
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>{children}</th>;
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-top ${className}`} style={{ color: 'var(--text-primary)' }}>{children}</td>;
}
