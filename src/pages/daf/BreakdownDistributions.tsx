import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../services/supabase';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Wrench, FileDown, Printer, RefreshCw, Filter, Loader2, FileText } from 'lucide-react';
import toast from 'react-hot-toast';

const fmt = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n)).replace(/\s/g, ' ') + ' FCFA';

const STATUS_STYLE: Record<string, { label: string; bg: string; color: string }> = {
  signalee: { label: 'Signalée', bg: '#FEF2F2', color: '#991B1B' },
  remplace: { label: 'Remplacé', bg: '#EFF6FF', color: '#1D4ED8' },
  cloture:  { label: 'Clôturé', bg: '#ECFDF5', color: '#065F46' },
  annule:   { label: 'Annulé', bg: '#F3F4F6', color: '#374151' },
};

interface Row {
  breakdown_id: string;
  schedule_id: string;
  breakdown_at: string;
  replacement_at: string | null;
  status: string;
  breakdown_reason: string | null;
  observations: string | null;
  split_reason: string | null;
  station_id: string | null;
  station_name: string | null;
  route_id: string | null;
  route_name: string | null;
  departure_datetime: string | null;
  original_bus_id: string | null;
  original_bus_plate: string | null;
  replacement_bus_id: string | null;
  replacement_bus_plate: string | null;
  original_company_id: string | null;
  original_company_name: string | null;
  beneficiary_company_id: string | null;
  beneficiary_company_name: string | null;
  passengers_count: number;
  revenue_amount: number;
  charges_amount: number;
  net_balance: number;
  net_balance_adjusted: number;
  amount_to_beneficiary: number;
  amount_retained: number;
  gestionnaire_id: string | null;
  gestionnaire_name: string | null;
}

interface Opt { id: string; name: string }

export default function BreakdownDistributions() {
  const today = new Date();
  const [from, setFrom] = useState(format(startOfMonth(today), 'yyyy-MM-dd'));
  const [to, setTo] = useState(format(endOfMonth(today), 'yyyy-MM-dd'));

  const [companyId, setCompanyId] = useState('');
  const [originCompanyId, setOriginCompanyId] = useState('');
  const [beneficiaryCompanyId, setBeneficiaryCompanyId] = useState('');
  const [stationId, setStationId] = useState('');
  const [busId, setBusId] = useState('');
  const [gestionnaireId, setGestionnaireId] = useState('');
  const [scheduleId, setScheduleId] = useState('');
  const [breakdownId, setBreakdownId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const [companies, setCompanies] = useState<Opt[]>([]);
  const [stations, setStations] = useState<Opt[]>([]);
  const [buses, setBuses] = useState<Opt[]>([]);
  const [gestionnaires, setGestionnaires] = useState<Opt[]>([]);

  const setPreset = (p: 'today' | 'week' | 'month') => {
    const n = new Date();
    if (p === 'today') { const d = format(n, 'yyyy-MM-dd'); setFrom(d); setTo(d); }
    else if (p === 'week') { setFrom(format(startOfWeek(n, { locale: fr }), 'yyyy-MM-dd')); setTo(format(endOfWeek(n, { locale: fr }), 'yyyy-MM-dd')); }
    else { setFrom(format(startOfMonth(n), 'yyyy-MM-dd')); setTo(format(endOfMonth(n), 'yyyy-MM-dd')); }
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
        .from('breakdown_revenue_distributions')
        .select('*')
        .gte('breakdown_at', fromIso)
        .lte('breakdown_at', toIso)
        .order('breakdown_at', { ascending: false });

      if (companyId) q = q.or(`original_company_id.eq.${companyId},beneficiary_company_id.eq.${companyId}`);
      if (originCompanyId) q = q.eq('original_company_id', originCompanyId);
      if (beneficiaryCompanyId) q = q.eq('beneficiary_company_id', beneficiaryCompanyId);
      if (stationId) q = q.eq('station_id', stationId);
      if (busId) q = q.or(`original_bus_id.eq.${busId},replacement_bus_id.eq.${busId}`);
      if (gestionnaireId) q = q.eq('gestionnaire_id', gestionnaireId);
      if (scheduleId) q = q.eq('schedule_id', scheduleId);
      if (breakdownId) q = q.eq('breakdown_id', breakdownId);
      if (statusFilter) q = q.eq('status', statusFilter);

      const { data, error } = await q;
      if (error) throw error;
      setRows((data ?? []) as Row[]);
    } catch (e: any) {
      console.error(e);
      toast.error(e.message ?? 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [
    from, to, companyId, originCompanyId, beneficiaryCompanyId, stationId, busId,
    gestionnaireId, scheduleId, breakdownId, statusFilter,
  ]);

  const totals = useMemo(() => rows.reduce((acc, r) => {
    acc.revenue += Number(r.revenue_amount || 0);
    acc.transfer += Number(r.amount_to_beneficiary || 0);
    acc.retained += Number(r.amount_retained || 0);
    acc.net += Number(r.net_balance || 0);
    return acc;
  }, { revenue: 0, transfer: 0, retained: 0, net: 0 }), [rows]);

  const exportExcel = async () => {
    const XLSX = await import('xlsx');
    const data = rows.map(r => ({
      Date: format(new Date(r.breakdown_at), 'dd/MM/yyyy HH:mm', { locale: fr }),
      'Date répartition': r.replacement_at ? format(new Date(r.replacement_at), 'dd/MM/yyyy HH:mm', { locale: fr }) : '',
      Gare: r.station_name ?? '',
      Voyage: r.route_name ?? '',
      'Bus initial': r.original_bus_plate ?? '',
      'Bus remplacement': r.replacement_bus_plate ?? '',
      'Société origine': r.original_company_name ?? '',
      'Société bénéficiaire': r.beneficiary_company_name ?? '',
      'Recette initiale': Number(r.revenue_amount || 0),
      'Montant transféré': Number(r.amount_to_beneficiary || 0),
      'Solde conservé': Number(r.amount_retained || 0),
      Gestionnaire: r.gestionnaire_name ?? '',
      Motif: r.split_reason ?? r.breakdown_reason ?? '',
      Statut: STATUS_STYLE[r.status]?.label ?? r.status,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Répartitions pannes');
    XLSX.writeFile(wb, `repartitions_pannes_${from}_${to}.xlsx`);
  };

  const exportCsv = () => {
    const headers = ['Date', 'Gare', 'Voyage', 'Bus initial', 'Bus remplacement', 'Société origine', 'Société bénéficiaire', 'Recette initiale', 'Montant transféré', 'Solde conservé', 'Gestionnaire', 'Motif', 'Statut'];
    const lines = [headers.join(';')];
    rows.forEach(r => {
      lines.push([
        format(new Date(r.breakdown_at), 'dd/MM/yyyy HH:mm'),
        r.station_name ?? '',
        r.route_name ?? '',
        r.original_bus_plate ?? '',
        r.replacement_bus_plate ?? '',
        r.original_company_name ?? '',
        r.beneficiary_company_name ?? '',
        Number(r.revenue_amount || 0),
        Number(r.amount_to_beneficiary || 0),
        Number(r.amount_retained || 0),
        r.gestionnaire_name ?? '',
        (r.split_reason ?? r.breakdown_reason ?? '').replace(/[;\n]/g, ' '),
        STATUS_STYLE[r.status]?.label ?? r.status,
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'));
    });
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `repartitions_pannes_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = async () => {
    const { default: jsPDF } = await import('jspdf');
    const doc = new jsPDF('l', 'mm', 'a4');
    doc.setFontSize(14);
    doc.text('Répartitions de recettes suite à panne', 14, 14);
    doc.setFontSize(9);
    doc.text(`Période: ${format(new Date(from), 'dd/MM/yyyy')} — ${format(new Date(to), 'dd/MM/yyyy')}`, 14, 21);
    doc.text(`Total: ${rows.length}   Transféré: ${fmt(totals.transfer)}   Conservé: ${fmt(totals.retained)}`, 14, 27);

    let y = 36;
    doc.setFontSize(7.5);
    const headers = ['Date', 'Gare', 'Voyage', 'Bus init.', 'Bus rempl.', 'Soc. origine', 'Soc. bénéf.', 'Recette', 'Transféré', 'Conservé', 'Gestion.', 'Statut'];
    const xs = [14, 36, 56, 80, 100, 120, 145, 170, 195, 220, 245, 275];
    headers.forEach((h, i) => doc.text(h, xs[i], y));
    y += 5;
    rows.forEach(r => {
      if (y > 195) { doc.addPage(); y = 20; }
      const vals = [
        format(new Date(r.breakdown_at), 'dd/MM HH:mm'),
        (r.station_name ?? '').slice(0, 12),
        (r.route_name ?? '').slice(0, 14),
        r.original_bus_plate ?? '',
        r.replacement_bus_plate ?? '',
        (r.original_company_name ?? '').slice(0, 14),
        (r.beneficiary_company_name ?? '').slice(0, 14),
        fmt(Number(r.revenue_amount || 0)).replace(' FCFA', ''),
        fmt(Number(r.amount_to_beneficiary || 0)).replace(' FCFA', ''),
        fmt(Number(r.amount_retained || 0)).replace(' FCFA', ''),
        (r.gestionnaire_name ?? '').slice(0, 12),
        STATUS_STYLE[r.status]?.label ?? r.status,
      ];
      vals.forEach((v, i) => doc.text(String(v), xs[i], y));
      y += 5;
    });
    doc.save(`repartitions_pannes_${from}_${to}.pdf`);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Wrench className="w-6 h-6" style={{ color: '#DC2626' }} />
            Répartitions de recettes suite à panne
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Vue consolidée DAF — propagation automatique à toutes les sociétés
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="Du"><input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border)' }} /></Field>
          <Field label="Au"><input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border)' }} /></Field>
          <Field label="Société (origine ou bénéf.)">
            <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border)' }}>
              <option value="">Toutes</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Société origine">
            <select value={originCompanyId} onChange={e => setOriginCompanyId(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border)' }}>
              <option value="">Toutes</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Société bénéficiaire">
            <select value={beneficiaryCompanyId} onChange={e => setBeneficiaryCompanyId(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border)' }}>
              <option value="">Toutes</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
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
          <Field label="Gestionnaire">
            <select value={gestionnaireId} onChange={e => setGestionnaireId(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border)' }}>
              <option value="">Tous</option>
              {gestionnaires.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Field>
          <Field label="Panne (ID)">
            <input value={breakdownId} onChange={e => setBreakdownId(e.target.value)} placeholder="UUID" className="w-full px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border)' }} />
          </Field>
          <Field label="Voyage (ID)">
            <input value={scheduleId} onChange={e => setScheduleId(e.target.value)} placeholder="UUID" className="w-full px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border)' }} />
          </Field>
          <Field label="Statut">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border)' }}>
              <option value="">Tous</option>
              <option value="signalee">Signalée</option>
              <option value="remplace">Remplacé</option>
              <option value="cloture">Clôturé</option>
              <option value="annule">Annulé</option>
            </select>
          </Field>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Kpi label="Répartitions" value={String(rows.length)} />
        <Kpi label="Recette initiale" value={fmt(totals.revenue)} />
        <Kpi label="Solde net cumulé" value={fmt(totals.net)} />
        <Kpi label="Transféré bénéf." value={fmt(totals.transfer)} accent="#1D4ED8" />
        <Kpi label="Conservé origine" value={fmt(totals.retained)} accent="#065F46" />
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
                  {['Date', 'Gare', 'Voyage', 'Bus initial', 'Bus remplacement', 'Société origine', 'Société bénéficiaire', 'Recette initiale', 'Montant transféré', 'Solde conservé', 'Gestionnaire', 'Motif', 'Statut'].map(h => (
                    <th key={h} className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={13} className="text-center py-10" style={{ color: 'var(--text-secondary)' }}>Aucune répartition sur la période</td></tr>
                ) : rows.map(r => {
                  const style = STATUS_STYLE[r.status] ?? STATUS_STYLE.signalee;
                  return (
                    <tr key={r.breakdown_id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                      <td className="px-3 py-2.5 whitespace-nowrap">{format(new Date(r.breakdown_at), 'dd/MM/yy HH:mm', { locale: fr })}</td>
                      <td className="px-3 py-2.5">{r.station_name ?? '—'}</td>
                      <td className="px-3 py-2.5">{r.route_name ?? '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{r.original_bus_plate ?? '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{r.replacement_bus_plate ?? '—'}</td>
                      <td className="px-3 py-2.5">{r.original_company_name ?? '—'}</td>
                      <td className="px-3 py-2.5">{r.beneficiary_company_name ?? '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{fmt(Number(r.revenue_amount || 0))}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap font-semibold" style={{ color: '#1D4ED8' }}>{fmt(Number(r.amount_to_beneficiary || 0))}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap font-semibold" style={{ color: '#065F46' }}>{fmt(Number(r.amount_retained || 0))}</td>
                      <td className="px-3 py-2.5">{r.gestionnaire_name ?? '—'}</td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{r.split_reason ?? r.breakdown_reason ?? '—'}</td>
                      <td className="px-3 py-2.5"><span className="px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap" style={{ backgroundColor: style.bg, color: style.color }}>{style.label}</span></td>
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

function Kpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border p-4" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
      <div className="text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      <div className="text-lg font-semibold" style={{ color: accent ?? 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}
