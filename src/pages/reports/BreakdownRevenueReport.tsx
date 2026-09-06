import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../store/authStore';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Wrench, FileDown, Printer, RefreshCw, Filter, Loader2, FileText } from 'lucide-react';
import toast from 'react-hot-toast';

const fmt = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n)).replace(/\s/g, ' ') + ' FCFA';

const STATUS_STYLE: Record<string, { label: string; bg: string; color: string }> = {
  signalee:  { label: 'Signalée', bg: '#FEF2F2', color: '#991B1B' },
  remplace:  { label: 'Remplacé', bg: '#EFF6FF', color: '#1D4ED8' },
  cloture:   { label: 'Clôturé', bg: '#ECFDF5', color: '#065F46' },
  annule:    { label: 'Annulé', bg: '#F3F4F6', color: '#374151' },
};

interface Row {
  id: string;
  schedule_id: string;
  breakdown_at: string;
  replacement_at: string | null;
  passengers_count: number;
  revenue_amount: number;
  charges_amount: number | null;
  net_balance: number | null;
  net_balance_adjusted: number | null;
  amount_original_company: number | null;
  amount_replacement_company: number | null;
  split_reason: string | null;
  reason: string | null;
  observations: string | null;
  status: string;
  original_company_id: string | null;
  beneficiary_company_id: string | null;
  replacement_company_id: string | null;
  station_id: string | null;
  original_bus_id: string | null;
  replacement_bus_id: string | null;
  original_bus?: { registration_number: string } | null;
  replacement_bus?: { registration_number: string } | null;
  original_company?: { name: string } | null;
  beneficiary_company?: { name: string } | null;
  replacement_company?: { name: string } | null;
  station?: { name: string } | null;
  schedule?: { routes?: { name: string } | null } | null;
  replaced_by: string | null;
  gestionnaire?: { first_name: string | null; last_name: string | null } | null;
}

interface Opt { id: string; name: string; }

export default function BreakdownRevenueReport() {
  const { user } = useAuthStore();
  const isGestionnaire = user?.role === 'gestionnaire';

  const today = new Date();
  const [from, setFrom] = useState(format(startOfMonth(today), 'yyyy-MM-dd'));
  const [to, setTo] = useState(format(endOfMonth(today), 'yyyy-MM-dd'));
  const [companyId, setCompanyId] = useState<string>('');
  const [originCompanyId, setOriginCompanyId] = useState<string>('');
  const [beneficiaryCompanyId, setBeneficiaryCompanyId] = useState<string>('');
  const [stationId, setStationId] = useState<string>('');
  const [busId, setBusId] = useState<string>('');
  const [gestionnaireId, setGestionnaireId] = useState<string>('');

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<Opt[]>([]);
  const [stations, setStations] = useState<Opt[]>([]);
  const [buses, setBuses] = useState<Opt[]>([]);
  const [gestionnaires, setGestionnaires] = useState<Opt[]>([]);

  const setPreset = (p: 'today' | 'week' | 'month') => {
    const n = new Date();
    if (p === 'today') {
      const d = format(n, 'yyyy-MM-dd');
      setFrom(d); setTo(d);
    } else if (p === 'week') {
      setFrom(format(startOfWeek(n, { locale: fr }), 'yyyy-MM-dd'));
      setTo(format(endOfWeek(n, { locale: fr }), 'yyyy-MM-dd'));
    } else {
      setFrom(format(startOfMonth(n), 'yyyy-MM-dd'));
      setTo(format(endOfMonth(n), 'yyyy-MM-dd'));
    }
  };

  useEffect(() => {
    (async () => {
      const [{ data: c }, { data: s }, { data: b }, { data: g }] = await Promise.all([
        supabase.from('companies').select('id, name').order('name'),
        supabase.from('stations').select('id, name').order('name'),
        supabase.from('buses').select('id, registration_number').order('registration_number'),
        supabase.from('users').select('id, first_name, last_name').eq('role', 'gestionnaire').order('last_name'),
      ]);
      setCompanies((c ?? []) as Opt[]);
      setStations((s ?? []) as Opt[]);
      setBuses(((b ?? []) as any[]).map(x => ({ id: x.id, name: x.registration_number })));
      setGestionnaires(((g ?? []) as any[]).map(x => ({ id: x.id, name: `${x.first_name ?? ''} ${x.last_name ?? ''}`.trim() })));
    })();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const fromIso = new Date(`${from}T00:00:00`).toISOString();
      const toIso = new Date(`${to}T23:59:59`).toISOString();
      let q = supabase
        .from('schedule_breakdowns')
        .select(`
          *,
          original_bus:buses!schedule_breakdowns_original_bus_id_fkey(registration_number),
          replacement_bus:buses!schedule_breakdowns_replacement_bus_id_fkey(registration_number),
          original_company:companies!schedule_breakdowns_original_company_id_fkey(name),
          beneficiary_company:companies!schedule_breakdowns_beneficiary_company_id_fkey(name),
          replacement_company:companies!schedule_breakdowns_replacement_company_id_fkey(name),
          station:stations!schedule_breakdowns_station_id_fkey(name),
          schedule:schedules!schedule_breakdowns_schedule_id_fkey(routes(name)),
          gestionnaire:users!schedule_breakdowns_replaced_by_fkey(first_name,last_name)
        `)
        .gte('breakdown_at', fromIso)
        .lte('breakdown_at', toIso)
        .order('breakdown_at', { ascending: false });

      if (companyId) q = q.or(`original_company_id.eq.${companyId},beneficiary_company_id.eq.${companyId},replacement_company_id.eq.${companyId}`);
      if (originCompanyId) q = q.eq('original_company_id', originCompanyId);
      if (beneficiaryCompanyId) q = q.eq('beneficiary_company_id', beneficiaryCompanyId);
      if (stationId) q = q.eq('station_id', stationId);
      if (busId) q = q.or(`original_bus_id.eq.${busId},replacement_bus_id.eq.${busId}`);
      if (gestionnaireId) q = q.eq('replaced_by', gestionnaireId);

      const { data, error } = await q;
      if (error) throw error;

      let result = (data ?? []) as Row[];
      if (isGestionnaire && user?.company_id) {
        result = result.filter(r =>
          r.original_company_id === user.company_id ||
          r.beneficiary_company_id === user.company_id ||
          r.replacement_company_id === user.company_id
        );
      }
      setRows(result);
    } catch (e: any) {
      console.error(e);
      toast.error(e.message ?? 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [from, to, companyId, originCompanyId, beneficiaryCompanyId, stationId, busId, gestionnaireId]);

  const totals = useMemo(() => {
    return rows.reduce((acc, r) => {
      acc.passengers += Number(r.passengers_count || 0);
      acc.revenue += Number(r.revenue_amount || 0);
      acc.charges += Number(r.charges_amount || 0);
      acc.netBalance += Number(r.net_balance ?? (Number(r.revenue_amount || 0) - Number(r.charges_amount || 0)));
      acc.amountOrig += Number(r.amount_original_company || 0);
      acc.amountBenef += Number(r.amount_replacement_company || 0);
      return acc;
    }, { passengers: 0, revenue: 0, charges: 0, netBalance: 0, amountOrig: 0, amountBenef: 0 });
  }, [rows]);

  const exportExcel = async () => {
    const XLSX = await import('xlsx');
    const data = rows.map(r => ({
      'Date panne': format(new Date(r.breakdown_at), 'dd/MM/yyyy HH:mm', { locale: fr }),
      'Date répartition': r.replacement_at ? format(new Date(r.replacement_at), 'dd/MM/yyyy HH:mm', { locale: fr }) : '',
      Trajet: r.schedule?.routes?.name ?? '',
      'Bus initial': r.original_bus?.registration_number ?? '',
      'Bus remplaçant': r.replacement_bus?.registration_number ?? '',
      'Société origine': r.original_company?.name ?? '',
      'Société bénéficiaire': r.beneficiary_company?.name ?? r.replacement_company?.name ?? '',
      Gare: r.station?.name ?? '',
      Passagers: r.passengers_count,
      'Recette guichet': Number(r.revenue_amount || 0),
      'Charges déduites': Number(r.charges_amount || 0),
      'Solde net': Number(r.net_balance ?? 0),
      'Part origine': Number(r.amount_original_company || 0),
      'Part bénéficiaire': Number(r.amount_replacement_company || 0),
      Motif: r.split_reason ?? r.reason ?? '',
      Observation: r.observations ?? '',
      Statut: STATUS_STYLE[r.status]?.label ?? r.status,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Pannes');
    XLSX.writeFile(wb, `rapport_pannes_${from}_${to}.xlsx`);
  };

  const exportCsv = () => {
    const headers = ['Date panne', 'Date répartition', 'Trajet', 'Bus initial', 'Bus remplaçant', 'Société origine', 'Société bénéficiaire', 'Gare', 'Gestionnaire', 'Passagers', 'Recette guichet', 'Charges déduites', 'Solde net', 'Part origine', 'Part bénéficiaire', 'Motif', 'Statut'];
    const lines = [headers.join(';')];
    rows.forEach(r => {
      const gn = `${r.gestionnaire?.first_name ?? ''} ${r.gestionnaire?.last_name ?? ''}`.trim();
      lines.push([
        format(new Date(r.breakdown_at), 'dd/MM/yyyy HH:mm'),
        r.replacement_at ? format(new Date(r.replacement_at), 'dd/MM/yyyy HH:mm') : '',
        r.schedule?.routes?.name ?? '',
        r.original_bus?.registration_number ?? '',
        r.replacement_bus?.registration_number ?? '',
        r.original_company?.name ?? '',
        r.beneficiary_company?.name ?? r.replacement_company?.name ?? '',
        r.station?.name ?? '',
        gn,
        r.passengers_count,
        Number(r.revenue_amount || 0),
        Number(r.charges_amount || 0),
        Number(r.net_balance ?? 0),
        Number(r.amount_original_company || 0),
        Number(r.amount_replacement_company || 0),
        (r.split_reason ?? r.reason ?? '').replace(/[;\n]/g, ' '),
        STATUS_STYLE[r.status]?.label ?? r.status,
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'));
    });
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rapport_pannes_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = async () => {
    const { default: jsPDF } = await import('jspdf');
    const doc = new jsPDF('l', 'mm', 'a4');
    doc.setFontSize(14);
    doc.text('Répartition des recettes suite à panne', 14, 14);
    doc.setFontSize(10);
    doc.text(`Période: ${format(new Date(from), 'dd/MM/yyyy')} — ${format(new Date(to), 'dd/MM/yyyy')}`, 14, 21);
    doc.text(`Total pannes: ${rows.length}   Recettes totales: ${fmt(totals.revenue)}`, 14, 27);

    let y = 35;
    doc.setFontSize(8);
    const headers = ['Date', 'Trajet', 'Bus init.', 'Bus rempl.', 'Société init.', 'Société rempl.', 'Pass.', 'Recette', 'Part init.', 'Part rempl.', 'Statut'];
    const xs = [14, 38, 70, 90, 110, 140, 170, 182, 205, 230, 260];
    headers.forEach((h, i) => doc.text(h, xs[i], y));
    y += 5;

    rows.forEach(r => {
      if (y > 195) { doc.addPage(); y = 20; }
      const vals = [
        format(new Date(r.breakdown_at), 'dd/MM HH:mm'),
        (r.schedule?.routes?.name ?? '').slice(0, 16),
        r.original_bus?.registration_number ?? '',
        r.replacement_bus?.registration_number ?? '',
        (r.original_company?.name ?? '').slice(0, 14),
        (r.replacement_company?.name ?? '').slice(0, 14),
        String(r.passengers_count),
        fmt(Number(r.revenue_amount || 0)).replace(' FCFA', ''),
        fmt(Number(r.amount_original_company || 0)).replace(' FCFA', ''),
        fmt(Number(r.amount_replacement_company || 0)).replace(' FCFA', ''),
        STATUS_STYLE[r.status]?.label ?? r.status,
      ];
      vals.forEach((v, i) => doc.text(String(v), xs[i], y));
      y += 5;
    });

    doc.save(`rapport_pannes_${from}_${to}.pdf`);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Wrench className="w-6 h-6" style={{ color: '#DC2626' }} />
            Répartition des recettes — Pannes
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Suivi des pannes et répartition inter-sociétés
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={load} className="flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium" style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
            <RefreshCw className="w-4 h-4" />Actualiser
          </button>
          <button onClick={exportCsv} className="flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium" style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
            <FileText className="w-4 h-4" />CSV
          </button>
          <button onClick={exportExcel} className="flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium" style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
            <FileDown className="w-4 h-4" />Excel
          </button>
          <button onClick={exportPdf} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-white" style={{ backgroundColor: '#DC2626' }}>
            <Printer className="w-4 h-4" />PDF
          </button>
        </div>
      </div>

      <div className="rounded-xl border p-4 space-y-3" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
          <Filter className="w-4 h-4" />Filtres
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setPreset('today')} className="px-3 py-1.5 rounded-lg border text-xs font-medium" style={{ borderColor: 'var(--border)' }}>Aujourd'hui</button>
          <button onClick={() => setPreset('week')} className="px-3 py-1.5 rounded-lg border text-xs font-medium" style={{ borderColor: 'var(--border)' }}>Cette semaine</button>
          <button onClick={() => setPreset('month')} className="px-3 py-1.5 rounded-lg border text-xs font-medium" style={{ borderColor: 'var(--border)' }}>Ce mois</button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <Field label="Du">
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border)' }} />
          </Field>
          <Field label="Au">
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border)' }} />
          </Field>
          {!isGestionnaire && (
            <Field label="Société">
              <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border)' }}>
                <option value="">Toutes</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Gare">
            <select value={stationId} onChange={e => setStationId(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border)' }}>
              <option value="">Toutes</option>
              {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Bus">
            <select value={busId} onChange={e => setBusId(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border)' }}>
              <option value="">Tous</option>
              {buses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          {!isGestionnaire && (
            <Field label="Société origine">
              <select value={originCompanyId} onChange={e => setOriginCompanyId(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border)' }}>
                <option value="">Toutes</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          )}
          {!isGestionnaire && (
            <Field label="Société bénéficiaire">
              <select value={beneficiaryCompanyId} onChange={e => setBeneficiaryCompanyId(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border)' }}>
                <option value="">Toutes</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Gestionnaire">
            <select value={gestionnaireId} onChange={e => setGestionnaireId(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border)' }}>
              <option value="">Tous</option>
              {gestionnaires.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Field>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Kpi label="Pannes" value={String(rows.length)} />
        <Kpi label="Recettes guichet" value={fmt(totals.revenue)} />
        <Kpi label="Charges déduites" value={fmt(totals.charges)} />
        <Kpi label="Solde net" value={fmt(totals.netBalance)} />
        <Kpi label="Réparti (origine / bénéf.)" value={`${fmt(totals.amountOrig)} / ${fmt(totals.amountBenef)}`} />
      </div>

      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--primary)' }} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead style={{ backgroundColor: 'var(--bg-subtle)' }}>
                <tr>
                  {['Date', 'Trajet', 'Bus init.', 'Bus rempl.', 'Société origine', 'Société bénéf.', 'Pass.', 'Recette', 'Charges', 'Solde net', 'Part origine', 'Part bénéf.', 'Motif', 'Statut'].map(h => (
                    <th key={h} className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={14} className="text-center py-10" style={{ color: 'var(--text-secondary)' }}>Aucune panne sur la période</td></tr>
                ) : rows.map(r => {
                  const style = STATUS_STYLE[r.status] ?? STATUS_STYLE.signalee;
                  const net = r.net_balance ?? (Number(r.revenue_amount || 0) - Number(r.charges_amount || 0));
                  return (
                    <tr key={r.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                      <td className="px-3 py-2.5 whitespace-nowrap">{format(new Date(r.breakdown_at), 'dd/MM/yy HH:mm', { locale: fr })}</td>
                      <td className="px-3 py-2.5">{r.schedule?.routes?.name ?? '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{r.original_bus?.registration_number ?? '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{r.replacement_bus?.registration_number ?? '—'}</td>
                      <td className="px-3 py-2.5">{r.original_company?.name ?? '—'}</td>
                      <td className="px-3 py-2.5">{r.beneficiary_company?.name ?? r.replacement_company?.name ?? '—'}</td>
                      <td className="px-3 py-2.5">{r.passengers_count}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{fmt(Number(r.revenue_amount || 0))}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{fmt(Number(r.charges_amount || 0))}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap font-semibold">{fmt(Number(net))}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{fmt(Number(r.amount_original_company || 0))}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{fmt(Number(r.amount_replacement_company || 0))}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{r.split_reason ?? '—'}</td>
                      <td className="px-3 py-2.5">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap" style={{ backgroundColor: style.bg, color: style.color }}>{style.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>{label}</label>
      {children}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-4" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
      <div className="text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      <div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}
