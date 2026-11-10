import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../services/supabase';
import { createRefreshScheduler } from '../../utils/realtimeRefresh';
import toast from 'react-hot-toast';
import {
  Building2, MapPin, Monitor, Bus, Route, Calendar, TicketCheck,
  DollarSign, Fuel, Droplets, Wrench, Users, TrendingUp, Receipt,
  Briefcase, Activity, RefreshCw, ArrowUpRight, ArrowDownRight,
  BarChart3, CircleDot, Layers
} from 'lucide-react';
import PeriodFilter from '../../components/shared/PeriodFilter';
import { PeriodFilter as PeriodType, getDateRangeFromPeriod } from '../../utils/reportHelpers';
import { formatCurrency, formatNumber } from '../../utils/formatCurrency';
import { format } from 'date-fns';
import {
  AreaChart, Area, PieChart, Pie, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';

interface KPIs {
  cities: number;
  stations: number;
  counters: number;
  companies: number;
  users: number;
  buses: number;
  routes: number;
  schedules: number;
  reservations: number;
  ticketsSold: number;
  revenue: number;
  payments: number;
  expenses: number;
  fuelConsumed: number;
  fuelStations: number;
  fuelTanks: number;
  garages: number;
}

interface BusStatusData {
  disponible: number;
  'en-service': number;
  maintenance: number;
  'panne-garage': number;
  'panne-route': number;
  'en-attente-pieces': number;
}

// Result of the get_admin_dashboard_stats database function
interface AdminDashboardStats {
  reservations: number;
  tickets_sold: number;
  revenue: number;
  schedules: number;
  payments: number;
  expenses: number;
  fuel_liters: number;
  buses_active: number;
  bus_status: Record<string, number>;
  revenue_by_day: { day: string; revenue: number; tickets: number }[];
  revenue_by_company: { name: string; value: number }[];
  revenue_by_route: { name: string; revenue: number; tickets: number }[];
}

const CHART_COLORS =['#0B7439', '#2E8B57', '#3B82F6', '#F59E0B', '#EF4444', '#06B6D4', '#10B981'];

const INITIAL_KPIS: KPIs = {
  cities: 0, stations: 0, counters: 0, companies: 0, users: 0,
  buses: 0, routes: 0, schedules: 0, reservations: 0, ticketsSold: 0,
  revenue: 0, payments: 0, expenses: 0, fuelConsumed: 0,
  fuelStations: 0, fuelTanks: 0, garages: 0,
};

export default function AdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<PeriodType>('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [kpis, setKpis] = useState<KPIs>(INITIAL_KPIS);
  const [busStatus, setBusStatus] = useState<BusStatusData>({
    disponible: 0, 'en-service': 0, maintenance: 0,
    'panne-garage': 0, 'panne-route': 0, 'en-attente-pieces': 0,
  });
  const [revenueChart, setRevenueChart] = useState<{ date: string; revenue: number; tickets: number }[]>([]);
  const [companyChart, setCompanyChart] = useState<{ name: string; value: number }[]>([]);
  const [routeChart, setRouteChart] = useState<{ name: string; revenue: number; tickets: number }[]>([]);
  const [recentReservations, setRecentReservations] = useState<any[]>([]);

  const getRange = useCallback(() => {
    return getDateRangeFromPeriod(
      period,
      customStart ? new Date(customStart) : undefined,
      customEnd ? new Date(customEnd) : undefined,
    );
  }, [period, customStart, customEnd]);

  const loadData = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      else setRefreshing(true);

      const range = getRange();
      const startISO = range.start.toISOString();
      const endISO = range.end.toISOString();

      // Totals and charts are computed by the database (get_admin_dashboard_stats):
      // summing rows here was capped at 1 000 rows per request and undercounted.
      const [
        citiesRes, stationsRes, countersRes, companiesRes, usersRes,
        routesRes, fuelStationsRes, fuelTanksRes, garagesRes, recentRes, statsRes,
      ] = await Promise.all([
        supabase.from('cities').select('id', { count: 'exact', head: true }),
        supabase.from('stations').select('id', { count: 'exact', head: true }),
        supabase.from('counters').select('id', { count: 'exact', head: true }),
        supabase.from('companies').select('id', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('users').select('id', { count: 'exact', head: true }),
        supabase.from('routes').select('id', { count: 'exact', head: true }),
        supabase.from('fuel_stations').select('id', { count: 'exact', head: true }),
        supabase.from('fuel_tanks').select('id', { count: 'exact', head: true }),
        supabase.from('garages').select('id', { count: 'exact', head: true }),
        supabase.from('reservations')
          .select('id, passenger_name, total_price, payment_status, created_at, seat_numbers, status')
          .order('created_at', { ascending: false })
          .limit(8),
        supabase.rpc('get_admin_dashboard_stats', { p_start: startISO, p_end: endISO }),
      ]);
      // The totals failing (database too slow, timeout) must not hide the counts read above:
      // they are shown, the totals stay at 0 and the admin is told which part is missing.
      if (statsRes.error) {
        console.error(statsRes.error);
        toast.error('Les totaux de la période (ventes, paiements, dépenses) n\'ont pas pu être chargés');
      }
      const stats = (statsRes.data ?? {
        reservations: 0, tickets_sold: 0, revenue: 0, schedules: 0, payments: 0, expenses: 0,
        fuel_liters: 0, buses_active: 0, bus_status: {}, revenue_by_day: [], revenue_by_company: [], revenue_by_route: [],
      }) as AdminDashboardStats;

      // Database statuses use underscores (en_service), the cards use hyphens (en-service)
      const statusCounts: BusStatusData = {
        disponible: 0, 'en-service': 0, maintenance: 0,
        'panne-garage': 0, 'panne-route': 0, 'en-attente-pieces': 0,
      };
      Object.entries(stats.bus_status ?? {}).forEach(([status, n]) => {
        const key = status.replace(/_/g, '-');
        if (key in statusCounts) statusCounts[key as keyof BusStatusData] += Number(n);
      });
      setBusStatus(statusCounts);

      setKpis({
        cities: citiesRes.count || 0,
        stations: stationsRes.count || 0,
        counters: countersRes.count || 0,
        companies: companiesRes.count || 0,
        users: usersRes.count || 0,
        buses: Number(stats.buses_active),
        routes: routesRes.count || 0,
        schedules: Number(stats.schedules),
        reservations: Number(stats.reservations),
        ticketsSold: Number(stats.tickets_sold),
        revenue: Number(stats.revenue),
        payments: Number(stats.payments),
        expenses: Number(stats.expenses),
        fuelConsumed: Number(stats.fuel_liters),
        fuelStations: fuelStationsRes.count || 0,
        fuelTanks: fuelTanksRes.count || 0,
        garages: garagesRes.count || 0,
      });

      setRecentReservations(recentRes.data || []);

      setRevenueChart((stats.revenue_by_day ?? []).map(d => ({
        date: d.day,
        revenue: Math.round(Number(d.revenue) / 1000),
        tickets: Number(d.tickets),
      })));
      setCompanyChart((stats.revenue_by_company ?? []).map(c => ({ name: c.name, value: Number(c.value) })));
      setRouteChart((stats.revenue_by_route ?? []).slice(0, 7).map(r => ({
        name: r.name,
        revenue: Math.round(Number(r.revenue) / 1000),
        tickets: Number(r.tickets),
      })));
    } catch (err: any) {
      console.error(err);
      toast.error('Erreur de chargement du dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getRange]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    // Sales arrive continuously: refresh at most once every 10 s instead of on every change
    const refresh = createRefreshScheduler(() => loadData(true));
    const channel = supabase
      .channel('admin-dashboard-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, refresh.schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules' }, refresh.schedule)
      .subscribe();
    return () => {
      refresh.cancel();
      channel.unsubscribe();
    };
  }, [loadData]);

  const kpiCards: {
    label: string; value: string | number; icon: any;
    color: string; bg: string; category: string;
  }[] = [
    { label: 'Villes', value: kpis.cities, icon: MapPin, color: '#0B7439', bg: '#E8F5E9', category: 'infra' },
    { label: 'Gares', value: kpis.stations, icon: Building2, color: '#2E7D32', bg: '#E8F5E9', category: 'infra' },
    { label: 'Guichets', value: kpis.counters, icon: Monitor, color: '#1B5E20', bg: '#E8F5E9', category: 'infra' },
    { label: 'Societes', value: kpis.companies, icon: Briefcase, color: '#00695C', bg: '#E0F2F1', category: 'infra' },
    { label: 'Utilisateurs', value: kpis.users, icon: Users, color: '#3B82F6', bg: '#EFF6FF', category: 'infra' },
    { label: 'Bus', value: kpis.buses, icon: Bus, color: '#0B7439', bg: '#E8F5E9', category: 'fleet' },
    { label: 'Itineraires', value: kpis.routes, icon: Route, color: '#0D9488', bg: '#F0FDFA', category: 'fleet' },
    { label: 'Voyages planifies', value: formatNumber(kpis.schedules), icon: Calendar, color: '#0284C7', bg: '#F0F9FF', category: 'ops' },
    { label: 'Reservations', value: formatNumber(kpis.reservations), icon: TicketCheck, color: '#0B7439', bg: '#E8F5E9', category: 'ops' },
    { label: 'Tickets vendus', value: formatNumber(kpis.ticketsSold), icon: Layers, color: '#16A34A', bg: '#F0FDF4', category: 'ops' },
    { label: 'Chiffre d\'affaires', value: formatCurrency(kpis.revenue), icon: DollarSign, color: '#0B7439', bg: '#E8F5E9', category: 'finance' },
    { label: 'Paiements recus', value: formatCurrency(kpis.payments), icon: TrendingUp, color: '#059669', bg: '#ECFDF5', category: 'finance' },
    { label: 'Total charges', value: formatCurrency(kpis.expenses), icon: Receipt, color: '#DC2626', bg: '#FEF2F2', category: 'finance' },
    { label: 'Carburant consomme', value: `${formatNumber(Math.round(kpis.fuelConsumed))} L`, icon: Fuel, color: '#D97706', bg: '#FFFBEB', category: 'fuel' },
    { label: 'Stations carburant', value: kpis.fuelStations, icon: Fuel, color: '#B45309', bg: '#FEF3C7', category: 'fuel' },
    { label: 'Cuves', value: kpis.fuelTanks, icon: Droplets, color: '#0369A1', bg: '#E0F2FE', category: 'fuel' },
    { label: 'Garages', value: kpis.garages, icon: Wrench, color: '#7C3AED', bg: '#F5F3FF', category: 'maint' },
  ];

  const busStatusItems = [
    { label: 'Disponible', key: 'disponible' as const, color: '#16A34A' },
    { label: 'En service', key: 'en-service' as const, color: '#0B7439' },
    { label: 'Maintenance', key: 'maintenance' as const, color: '#F59E0B' },
    { label: 'Panne garage', key: 'panne-garage' as const, color: '#EF4444' },
    { label: 'Panne route', key: 'panne-route' as const, color: '#DC2626' },
    { label: 'Attente pieces', key: 'en-attente-pieces' as const, color: '#9CA3AF' },
  ];

  const totalBuses = Object.values(busStatus).reduce((s, v) => s + v, 0);
  const busDonutData = busStatusItems
    .filter(item => busStatus[item.key] > 0)
    .map(item => ({ name: item.label, value: busStatus[item.key], fill: item.color }));

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-14 h-14 border-4 rounded-full animate-spin mx-auto mb-4"
               style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            Chargement du dashboard...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Dashboard Administrateur
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Vue consolidee de la plateforme SBTA
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-full"
               style={{ backgroundColor: 'var(--success-light)', color: 'var(--success)' }}>
            <CircleDot className="w-3 h-3" />
            Temps reel
          </div>
          <button
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:shadow-md"
            style={{ backgroundColor: 'var(--primary)', color: 'white' }}
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Actualiser
          </button>
        </div>
      </div>

      {/* Period Filter */}
      <div className="mb-6">
        <PeriodFilter
          value={period}
          onChange={setPeriod}
          customStart={customStart}
          customEnd={customEnd}
          onCustomStartChange={setCustomStart}
          onCustomEndChange={setCustomEnd}
        />
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4 mb-8">
        {kpiCards.map((card) => (
          <KPITile key={card.label} {...card} />
        ))}
      </div>

      {/* Charts Row 1: Revenue trend + Bus status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="lg:col-span-2 bg-white rounded-xl border p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>
              Evolution du chiffre d'affaires (k FCFA)
            </h3>
            <BarChart3 className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
          </div>
          {revenueChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={revenueChart}>
                <defs>
                  <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0B7439" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#0B7439" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: 13 }}
                  formatter={(value: number, name: string) =>
                    name === 'revenue' ? [`${value}k FCFA`, 'Revenus'] : [value, 'Tickets']
                  }
                />
                <Area type="monotone" dataKey="revenue" stroke="#0B7439" strokeWidth={2.5}
                      fill="url(#revenueGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart />
          )}
        </div>

        <div className="bg-white rounded-xl border p-6">
          <h3 className="font-bold text-base mb-4" style={{ color: 'var(--text-primary)' }}>
            Statut de la flotte
          </h3>
          {totalBuses > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={busDonutData} cx="50%" cy="50%" innerRadius={50} outerRadius={75}
                       paddingAngle={3} dataKey="value">
                    {busDonutData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: 13 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 space-y-2">
                {busStatusItems.map(item => (
                  <div key={item.key} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                      <span style={{ color: 'var(--text-secondary)' }}>{item.label}</span>
                    </div>
                    <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {busStatus[item.key]}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <EmptyChart />
          )}
        </div>
      </div>

      {/* Charts Row 2: Company breakdown + Top routes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl border p-6">
          <h3 className="font-bold text-base mb-4" style={{ color: 'var(--text-primary)' }}>
            Revenus par societe
          </h3>
          {companyChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={companyChart} cx="50%" cy="50%" outerRadius={100}
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  dataKey="value"
                >
                  {companyChart.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: 13 }}
                  formatter={(value: number) => [formatCurrency(value), 'Revenus']}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart />
          )}
        </div>

        <div className="bg-white rounded-xl border p-6">
          <h3 className="font-bold text-base mb-4" style={{ color: 'var(--text-primary)' }}>
            Top itineraires (k FCFA)
          </h3>
          {routeChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={routeChart} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={120} />
                <Tooltip
                  contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: 13 }}
                  formatter={(value: number) => [`${value}k FCFA`, 'Revenus']}
                />
                <Bar dataKey="revenue" fill="#0B7439" radius={[0, 6, 6, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart />
          )}
        </div>
      </div>

      {/* Financial Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <FinanceCard
          title="Chiffre d'affaires"
          amount={kpis.revenue}
          icon={<DollarSign className="w-5 h-5" />}
          color="#0B7439"
          bg="#E8F5E9"
        />
        <FinanceCard
          title="Paiements recus"
          amount={kpis.payments}
          icon={<TrendingUp className="w-5 h-5" />}
          color="#059669"
          bg="#ECFDF5"
        />
        <FinanceCard
          title="Total charges"
          amount={kpis.expenses}
          icon={<Receipt className="w-5 h-5" />}
          color="#DC2626"
          bg="#FEF2F2"
          negative
        />
      </div>

      {/* Recent Reservations */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5" style={{ color: 'var(--primary)' }} />
            <h3 className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>
              Dernieres reservations
            </h3>
          </div>
          <span className="text-xs px-2 py-1 rounded-full"
                style={{ backgroundColor: 'var(--success-light)', color: 'var(--success)' }}>
            Temps reel
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: '#f9fafb' }}>
                <th className="text-left px-6 py-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Passager</th>
                <th className="text-left px-6 py-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Montant</th>
                <th className="text-left px-6 py-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Statut</th>
                <th className="text-left px-6 py-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Paiement</th>
                <th className="text-left px-6 py-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {recentReservations.map(r => (
                <tr key={r.id} className="border-t transition-colors hover:bg-gray-50/50">
                  <td className="px-6 py-3.5 font-medium" style={{ color: 'var(--text-primary)' }}>
                    {r.passenger_name}
                  </td>
                  <td className="px-6 py-3.5 font-semibold" style={{ color: 'var(--primary)' }}>
                    {formatCurrency(r.total_price)}
                  </td>
                  <td className="px-6 py-3.5">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-6 py-3.5">
                    <PaymentPill status={r.payment_status} />
                  </td>
                  <td className="px-6 py-3.5" style={{ color: 'var(--text-secondary)' }}>
                    {format(new Date(r.created_at), 'dd/MM/yyyy HH:mm')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {recentReservations.length === 0 && (
            <div className="py-12 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
              Aucune reservation recente
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function KPITile({ label, value, icon: Icon, color, bg }: {
  label: string; value: string | number; icon: any; color: string; bg: string; category?: string;
}) {
  return (
    <div className="bg-white rounded-xl border p-4 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 group">
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center transition-transform group-hover:scale-110"
             style={{ backgroundColor: bg }}>
          <Icon className="w-5 h-5" style={{ color }} />
        </div>
      </div>
      <p className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
        {value}
      </p>
      <p className="text-xs mt-1 font-medium" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </p>
    </div>
  );
}

function FinanceCard({ title, amount, icon, color, bg, negative }: {
  title: string; amount: number; icon: React.ReactNode; color: string; bg: string; negative?: boolean;
}) {
  return (
    <div className="rounded-xl border p-5" style={{ backgroundColor: bg }}>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-white/80" style={{ color }}>
          {icon}
        </div>
        <p className="text-sm font-semibold" style={{ color }}>{title}</p>
      </div>
      <p className="text-xl md:text-2xl font-bold" style={{ color }}>
        {negative && amount > 0 ? '- ' : ''}{formatCurrency(amount)}
      </p>
      <div className="flex items-center gap-1 mt-2">
        {negative ? (
          <ArrowDownRight className="w-3.5 h-3.5" style={{ color }} />
        ) : (
          <ArrowUpRight className="w-3.5 h-3.5" style={{ color }} />
        )}
        <span className="text-xs font-medium" style={{ color }}>
          Periode selectionnee
        </span>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; color: string }> = {
    confirmed: { label: 'Confirmee', bg: 'var(--success-light)', color: 'var(--success)' },
    confirmee: { label: 'Confirmee', bg: 'var(--success-light)', color: 'var(--success)' },
    pending: { label: 'En attente', bg: 'var(--warning-light)', color: 'var(--warning)' },
    cancelled: { label: 'Annulee', bg: 'var(--danger-light)', color: 'var(--danger)' },
    embarquee: { label: 'Embarquee', bg: '#EFF6FF', color: '#3B82F6' },
  };
  const s = map[status] || { label: status, bg: '#f3f4f6', color: '#6b7280' };
  return (
    <span className="px-2.5 py-1 rounded-full text-xs font-semibold" style={{ backgroundColor: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

function PaymentPill({ status }: { status: string }) {
  const isPaid = status === 'paid';
  return (
    <span className="px-2.5 py-1 rounded-full text-xs font-semibold"
          style={{
            backgroundColor: isPaid ? 'var(--success-light)' : 'var(--warning-light)',
            color: isPaid ? 'var(--success)' : 'var(--warning)',
          }}>
      {isPaid ? 'Paye' : 'En attente'}
    </span>
  );
}

function EmptyChart() {
  return (
    <div className="flex items-center justify-center h-[200px] text-sm"
         style={{ color: 'var(--text-secondary)' }}>
      Aucune donnee pour cette periode
    </div>
  );
}
