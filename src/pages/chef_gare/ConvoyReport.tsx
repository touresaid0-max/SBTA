import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import { Truck, RefreshCw, TrendingUp, Banknote, Bus, MapPin, User, FileText, X, ChevronDown } from 'lucide-react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, parseISO } from 'date-fns';
import { formatCurrency, formatNumber } from '../../utils/formatCurrency';
import ExportButton from '../../components/shared/ExportButton';

interface ConvoyRow {
  id: string;
  amount: number;
  trip_type: string;
  passengers_count: number;
  ratio_amount: number;
  carburant_amount: number;
  peage_amount: number;
  autres_amount: number;
  observation: string | null;
  created_at: string;
  created_by_name: string;
  schedule_id: string;
  departure_datetime: string;
  route_name: string;
  route_id: string;
  origin_city: string;
  destination_city: string;
  registration_number: string;
  bus_id: string;
  bus_capacity: number;
  company_id: string | null;
  company_name: string;
  driver_name: string;
  driver_id: string;
}

type PeriodPreset = 'today' | 'week' | 'month' | 'year' | 'custom';

interface FilterOption { id: string; name: string }

export default function ConvoyReport() {
  const [convoys, setConvoys] = useState<ConvoyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [stationName, setStationName] = useState('');
  const [preset, setPreset] = useState<PeriodPreset>('today');
  const [dateFrom, setDateFrom] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));

  const [filterRoute, setFilterRoute] = useState('');
  const [filterBus, setFilterBus] = useState('');
  const [filterDriver, setFilterDriver] = useState('');
  const [filterCompany, setFilterCompany] = useState('');

  const [routes, setRoutes] = useState<FilterOption[]>([]);
  const [buses, setBuses] = useState<FilterOption[]>([]);
  const [drivers, setDrivers] = useState<FilterOption[]>([]);
  const [companies, setCompanies] = useState<FilterOption[]>([]);

  const applyPreset = useCallback((p: PeriodPreset) => {
    setPreset(p);
    const now = new Date();
    if (p === 'today') {
      const d = format(now, 'yyyy-MM-dd'); setDateFrom(d); setDateTo(d);
    } else if (p === 'week') {
      setDateFrom(format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
      setDateTo(format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
    } else if (p === 'month') {
      setDateFrom(format(startOfMonth(now), 'yyyy-MM-dd'));
      setDateTo(format(endOfMonth(now), 'yyyy-MM-dd'));
    } else if (p === 'year') {
      setDateFrom(`${now.getFullYear()}-01-01`);
      setDateTo(`${now.getFullYear()}-12-31`);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: stationId } = await supabase.rpc('get_my_station_id');
      if (!stationId) { toast.error('Impossible de recuperer votre gare'); return; }

      const { data: stRow } = await supabase.from('stations').select('name').eq('id', stationId).maybeSingle();
      setStationName((stRow as any)?.name || 'Gare');

      const { data, error } = await supabase
        .from('convoys')
        .select(`
          id, amount, trip_type, passengers_count,
          ratio_amount, carburant_amount, peage_amount, autres_amount,
          observation, created_at, created_by,
          schedule:schedule_id (
            id, departure_datetime, departure_station_id, route_id, bus_id, driver_id,
            route:route_id ( id, name,
              origin_city:origin_city_id ( name ),
              destination_city:destination_city_id ( name )
            ),
            bus:bus_id ( id, registration_number, capacity, company:company_id ( id, name ) ),
            driver:driver_id ( id, first_name, last_name )
          )
        `)
        .gte('created_at', `${dateFrom}T00:00:00`)
        .lte('created_at', `${dateTo}T23:59:59`)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const { data: creatorIds } = await supabase
        .from('users')
        .select('id, first_name, last_name')
        .in('id', (data ?? []).map((c: any) => c.created_by).filter(Boolean));
      const creatorMap: Record<string, string> = {};
      (creatorIds ?? []).forEach((u: any) => { creatorMap[u.id] = `${u.first_name || ''} ${u.last_name || ''}`.trim(); });

      const rows: ConvoyRow[] = (data ?? [])
        .filter((c: any) => c.schedule?.departure_station_id === stationId)
        .map((c: any) => {
          const sched = c.schedule;
          const route = sched?.route;
          const bus = sched?.bus;
          const driver = sched?.driver;
          const company = bus?.company;
          return {
            id: c.id,
            amount: Number(c.amount),
            trip_type: c.trip_type || 'aller_simple',
            passengers_count: c.passengers_count ?? 0,
            ratio_amount: Number(c.ratio_amount ?? 0),
            carburant_amount: Number(c.carburant_amount ?? 0),
            peage_amount: Number(c.peage_amount ?? 0),
            autres_amount: Number(c.autres_amount ?? 0),
            observation: c.observation,
            created_at: c.created_at,
            created_by_name: creatorMap[c.created_by] || '—',
            schedule_id: sched?.id,
            departure_datetime: sched?.departure_datetime,
            route_name: route?.name || '—',
            route_id: sched?.route_id,
            origin_city: route?.origin_city?.name || '—',
            destination_city: route?.destination_city?.name || '—',
            registration_number: bus?.registration_number || '—',
            bus_id: sched?.bus_id,
            bus_capacity: bus?.capacity || 0,
            company_id: company?.id ?? null,
            company_name: company?.name || '—',
            driver_name: driver ? `${driver.first_name || ''} ${driver.last_name || ''}`.trim() : '—',
            driver_id: sched?.driver_id,
          };
        });

      setConvoys(rows);

      // Build filter option lists from the loaded data
      const rMap = new Map<string, string>();
      const bMap = new Map<string, string>();
      const dMap = new Map<string, string>();
      const cMap = new Map<string, string>();
      rows.forEach(r => {
        if (r.route_id) rMap.set(r.route_id, r.route_name);
        if (r.bus_id) bMap.set(r.bus_id, r.registration_number);
        if (r.driver_id) dMap.set(r.driver_id, r.driver_name);
        if (r.company_id) cMap.set(r.company_id, r.company_name);
      });
      setRoutes(Array.from(rMap, ([id, name]) => ({ id, name })));
      setBuses(Array.from(bMap, ([id, name]) => ({ id, name })));
      setDrivers(Array.from(dMap, ([id, name]) => ({ id, name })));
      setCompanies(Array.from(cMap, ([id, name]) => ({ id, name })));
    } catch (err: any) {
      toast.error('Erreur de chargement des convois');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  // ─── Client-side filter ─────────────────────────────────────────────────────
  const filteredConvoys = useMemo(() => convoys.filter(c => {
    if (filterRoute && c.route_id !== filterRoute) return false;
    if (filterBus && c.bus_id !== filterBus) return false;
    if (filterDriver && c.driver_id !== filterDriver) return false;
    if (filterCompany && c.company_id !== filterCompany) return false;
    return true;
  }), [convoys, filterRoute, filterBus, filterDriver, filterCompany]);

  const totalAmount = filteredConvoys.reduce((s, c) => s + c.amount, 0);
  const totalConvoys = filteredConvoys.length;
  const avgAmount = totalConvoys > 0 ? totalAmount / totalConvoys : 0;

  const totalRatio = filteredConvoys.reduce((s, c) => s + c.ratio_amount, 0);
  const totalCarburant = filteredConvoys.reduce((s, c) => s + c.carburant_amount, 0);
  const totalPeage = filteredConvoys.reduce((s, c) => s + c.peage_amount, 0);
  const totalAutres = filteredConvoys.reduce((s, c) => s + c.autres_amount, 0);
  const totalCharges = totalRatio + totalCarburant + totalPeage + totalAutres;
  const totalSolde = totalAmount - totalCharges;
  const totalPassengers = filteredConvoys.reduce((s, c) => s + c.passengers_count, 0);

  const routeBreakdown: Record<string, { count: number; amount: number }> = {};
  filteredConvoys.forEach(c => {
    const key = `${c.origin_city} - ${c.destination_city}`;
    if (!routeBreakdown[key]) routeBreakdown[key] = { count: 0, amount: 0 };
    routeBreakdown[key].count += 1;
    routeBreakdown[key].amount += c.amount;
  });
  const routeStats = Object.entries(routeBreakdown).sort((a, b) => b[1].amount - a[1].amount);

  const busBreakdown: Record<string, { count: number; amount: number }> = {};
  filteredConvoys.forEach(c => {
    const key = c.registration_number;
    if (!busBreakdown[key]) busBreakdown[key] = { count: 0, amount: 0 };
    busBreakdown[key].count += 1;
    busBreakdown[key].amount += c.amount;
  });
  const busStats = Object.entries(busBreakdown).sort((a, b) => b[1].amount - a[1].amount);

  const driverBreakdown: Record<string, { count: number; amount: number }> = {};
  filteredConvoys.forEach(c => {
    const key = c.driver_name;
    if (!driverBreakdown[key]) driverBreakdown[key] = { count: 0, amount: 0 };
    driverBreakdown[key].count += 1;
    driverBreakdown[key].amount += c.amount;
  });
  const driverStats = Object.entries(driverBreakdown).sort((a, b) => b[1].amount - a[1].amount);

  const handlePrint = () => window.print();

  const exportExcel = async () => {
    const { utils, writeFile } = await import('xlsx');
    const rows = filteredConvoys.map(c => {
      const charges = c.ratio_amount + c.carburant_amount + c.peage_amount + c.autres_amount;
      return {
        'Date': format(parseISO(c.departure_datetime || c.created_at), 'dd/MM/yyyy'),
        'Heure': format(parseISO(c.departure_datetime || c.created_at), 'HH:mm'),
        'Ligne': `${c.origin_city} → ${c.destination_city}`,
        'Bus': c.registration_number,
        'Société': c.company_name,
        'Chauffeur': c.driver_name,
        'Gare': stationName,
        'Type': c.trip_type === 'aller_retour' ? 'Aller-Retour' : 'Aller simple',
        'Passagers': c.passengers_count,
        'Montant': c.amount,
        'Ratio': c.ratio_amount,
        'Carburant': c.carburant_amount,
        'Péage': c.peage_amount,
        'Autres': c.autres_amount,
        'Total charges': charges,
        'Solde': c.amount - charges,
        'Enregistré par': c.created_by_name,
        'Observation': c.observation || '',
      };
    });
    const ws = utils.json_to_sheet(rows);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, 'Convois');
    writeFile(wb, `rapport_convois_${dateFrom}_${dateTo}.xlsx`);
  };

  // ─── Filter dropdown (reused pattern) ───────────────────────────────────────
  const FilterSelect = ({ label, options, value, onChange }: {
    label: string; options: FilterOption[]; value: string; onChange: (v: string) => void;
  }) => (
    <div className="flex items-center gap-2">
      <label className="text-xs font-medium whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{label}</label>
      <div className="relative">
        <select value={value} onChange={e => onChange(e.target.value)}
          className="appearance-none pl-3 pr-8 py-1.5 border rounded-lg text-sm cursor-pointer"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}>
          <option value="">Tous</option>
          {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
      </div>
    </div>
  );

  if (loading) return (
    <div className="p-8 flex items-center justify-center min-h-64">
      <div className="w-8 h-8 border-4 rounded-full animate-spin"
        style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
    </div>
  );

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Rapport Convois
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {stationName} — Suivi des départs en convoi
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ExportButton onExportPDF={handlePrint} onExportExcel={exportExcel} />
          <button onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
            <RefreshCw className="w-4 h-4" /> Actualiser
          </button>
        </div>
      </div>

      {/* Period presets */}
      <div className="flex items-center gap-2 flex-wrap">
        {(['today', 'week', 'month', 'year', 'custom'] as PeriodPreset[]).map(p => (
          <button key={p} onClick={() => applyPreset(p)}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg transition-all"
            style={{
              backgroundColor: preset === p ? 'var(--primary)' : 'var(--surface)',
              color: preset === p ? '#fff' : 'var(--text-secondary)',
              border: `1px solid ${preset === p ? 'var(--primary)' : 'var(--border)'}`,
            }}>
            {p === 'today' ? "Aujourd'hui" : p === 'week' ? 'Semaine' : p === 'month' ? 'Mois' : p === 'year' ? 'Année' : 'Personnalisé'}
          </button>
        ))}
      </div>

      {/* Date range + secondary filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Du</label>
          <input type="date" value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPreset('custom'); }}
            className="px-3 py-1.5 border rounded-lg text-sm"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Au</label>
          <input type="date" value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPreset('custom'); }}
            className="px-3 py-1.5 border rounded-lg text-sm"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
        </div>
        <div className="h-5 w-px" style={{ backgroundColor: 'var(--border)' }} />
        <FilterSelect label="Ligne" options={routes} value={filterRoute} onChange={setFilterRoute} />
        <FilterSelect label="Bus" options={buses} value={filterBus} onChange={setFilterBus} />
        <FilterSelect label="Chauffeur" options={drivers} value={filterDriver} onChange={setFilterDriver} />
        <FilterSelect label="Société" options={companies} value={filterCompany} onChange={setFilterCompany} />
        {(filterRoute || filterBus || filterDriver || filterCompany) && (
          <button onClick={() => { setFilterRoute(''); setFilterBus(''); setFilterDriver(''); setFilterCompany(''); }}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium hover:bg-gray-100"
            style={{ color: 'var(--text-muted)' }}>
            <X className="w-3 h-3" /> Réinitialiser
          </button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {[
          { label: 'Total convois', value: formatNumber(totalConvoys), icon: <Truck className="w-5 h-5" />, color: '#0369A1' },
          { label: 'Montant total', value: formatCurrency(totalAmount), icon: <Banknote className="w-5 h-5" />, color: '#16A34A' },
          { label: 'Total charges', value: formatCurrency(totalCharges), icon: <Banknote className="w-5 h-5" />, color: '#D97706' },
          { label: 'Solde', value: formatCurrency(totalSolde), icon: <TrendingUp className="w-5 h-5" />, color: totalSolde >= 0 ? '#16A34A' : '#DC2626' },
          { label: 'Montant moyen', value: formatCurrency(Math.round(avgAmount)), icon: <TrendingUp className="w-5 h-5" />, color: '#7C3AED' },
        ].map((kpi, i) => (
          <div key={i} className="rounded-xl border p-5 flex items-center gap-4"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${kpi.color}15`, color: kpi.color }}>
              {kpi.icon}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium truncate" style={{ color: 'var(--text-muted)' }}>{kpi.label}</p>
              <p className="text-lg font-bold truncate" style={{ color: kpi.color }}>{kpi.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Charge breakdown */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Ratio', value: totalRatio, color: '#0369A1' },
          { label: 'Carburant', value: totalCarburant, color: '#EA580C' },
          { label: 'Péage', value: totalPeage, color: '#9333EA' },
          { label: 'Autres', value: totalAutres, color: '#64748B' },
        ].map((c, i) => (
          <div key={i} className="rounded-lg border px-4 py-2.5"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
            <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
            <p className="text-sm font-bold" style={{ color: c.color }}>{formatCurrency(c.value)}</p>
          </div>
        ))}
      </div>

      {filteredConvoys.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border-2 border-dashed" style={{ borderColor: 'var(--border)' }}>
          <Truck className="w-12 h-12 mx-auto mb-3" style={{ color: '#D1D5DB' }} />
          <p className="font-medium" style={{ color: 'var(--text-secondary)' }}>Aucun convoi sur cette période</p>
        </div>
      ) : (
        <>
          {/* Breakdowns: Route, Bus, Driver */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* By route */}
            <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)' }}>
                <MapPin className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Par ligne</span>
              </div>
              <div className="divide-y max-h-64 overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
                {routeStats.map(([route, stat]) => (
                  <div key={route} className="px-5 py-3 flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{route}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{stat.count} convoi{stat.count > 1 ? 's' : ''}</p>
                    </div>
                    <p className="text-sm font-bold whitespace-nowrap ml-2" style={{ color: '#16A34A' }}>{formatCurrency(stat.amount)}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* By bus */}
            <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)' }}>
                <Bus className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Par bus</span>
              </div>
              <div className="divide-y max-h-64 overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
                {busStats.map(([reg, stat]) => (
                  <div key={reg} className="px-5 py-3 flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{reg}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{stat.count} convoi{stat.count > 1 ? 's' : ''}</p>
                    </div>
                    <p className="text-sm font-bold whitespace-nowrap ml-2" style={{ color: '#16A34A' }}>{formatCurrency(stat.amount)}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* By driver */}
            <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)' }}>
                <User className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Par chauffeur</span>
              </div>
              <div className="divide-y max-h-64 overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
                {driverStats.map(([drv, stat]) => (
                  <div key={drv} className="px-5 py-3 flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{drv}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{stat.count} convoi{stat.count > 1 ? 's' : ''}</p>
                    </div>
                    <p className="text-sm font-bold whitespace-nowrap ml-2" style={{ color: '#16A34A' }}>{formatCurrency(stat.amount)}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Detailed table */}
          <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)' }}>
              <FileText className="w-4 h-4" style={{ color: 'var(--primary)' }} />
              <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Détail des convois</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                    {['Date', 'Heure', 'Ligne', 'Bus', 'Société', 'Chauffeur', 'Type', 'Pass.', 'Montant', 'Ratio', 'Carburant', 'Péage', 'Autres', 'Charges', 'Solde', 'Enregistré par', 'Observation'].map(h => (
                      <th key={h} className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap"
                        style={{ color: 'var(--text-muted)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                  {filteredConvoys.map(c => {
                    const charges = c.ratio_amount + c.carburant_amount + c.peage_amount + c.autres_amount;
                    const solde = c.amount - charges;
                    return (
                      <tr key={c.id} className="hover:opacity-80 transition-opacity">
                        <td className="px-3 py-3 whitespace-nowrap font-medium" style={{ color: 'var(--text-primary)' }}>
                          {format(parseISO(c.departure_datetime || c.created_at), 'dd/MM/yyyy')}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                          {format(parseISO(c.departure_datetime || c.created_at), 'HH:mm')}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                          {c.origin_city} → {c.destination_city}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap font-medium" style={{ color: 'var(--text-primary)' }}>
                          {c.registration_number}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                          {c.company_name}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                          {c.driver_name}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <span className="text-xs px-1.5 py-0.5 rounded-full"
                            style={{ backgroundColor: c.trip_type === 'aller_retour' ? '#EEF2FF' : 'var(--bg-subtle)', color: c.trip_type === 'aller_retour' ? '#4338CA' : 'var(--text-secondary)' }}>
                            {c.trip_type === 'aller_retour' ? 'A-R' : 'Aller'}
                          </span>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{c.passengers_count}</td>
                        <td className="px-3 py-3 whitespace-nowrap font-bold" style={{ color: '#16A34A' }}>
                          {formatCurrency(c.amount)}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{formatCurrency(c.ratio_amount)}</td>
                        <td className="px-3 py-3 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{formatCurrency(c.carburant_amount)}</td>
                        <td className="px-3 py-3 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{formatCurrency(c.peage_amount)}</td>
                        <td className="px-3 py-3 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{formatCurrency(c.autres_amount)}</td>
                        <td className="px-3 py-3 whitespace-nowrap font-semibold" style={{ color: '#D97706' }}>{formatCurrency(charges)}</td>
                        <td className="px-3 py-3 whitespace-nowrap font-bold" style={{ color: solde >= 0 ? '#16A34A' : '#DC2626' }}>{formatCurrency(solde)}</td>
                        <td className="px-3 py-3 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                          {c.created_by_name}
                        </td>
                        <td className="px-3 py-3 max-w-[200px] truncate" style={{ color: 'var(--text-muted)' }}
                          title={c.observation || ''}>
                          {c.observation || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ backgroundColor: 'var(--primary-light)' }}>
                    <td colSpan={7} className="px-3 py-3 text-sm font-bold" style={{ color: 'var(--primary)' }}>
                      TOTAL ({totalConvoys} convoi{totalConvoys > 1 ? 's' : ''} · {totalPassengers} passagers)
                    </td>
                    <td className="px-3 py-3 text-sm font-bold" style={{ color: 'var(--primary)' }}>{totalPassengers}</td>
                    <td className="px-3 py-3 text-sm font-bold" style={{ color: '#16A34A' }}>{formatCurrency(totalAmount)}</td>
                    <td className="px-3 py-3 text-sm font-bold" style={{ color: '#0369A1' }}>{formatCurrency(totalRatio)}</td>
                    <td className="px-3 py-3 text-sm font-bold" style={{ color: '#EA580C' }}>{formatCurrency(totalCarburant)}</td>
                    <td className="px-3 py-3 text-sm font-bold" style={{ color: '#9333EA' }}>{formatCurrency(totalPeage)}</td>
                    <td className="px-3 py-3 text-sm font-bold" style={{ color: '#64748B' }}>{formatCurrency(totalAutres)}</td>
                    <td className="px-3 py-3 text-sm font-bold" style={{ color: '#D97706' }}>{formatCurrency(totalCharges)}</td>
                    <td className="px-3 py-3 text-sm font-bold" style={{ color: totalSolde >= 0 ? '#16A34A' : '#DC2626' }}>{formatCurrency(totalSolde)}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
