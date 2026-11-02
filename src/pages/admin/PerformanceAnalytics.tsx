import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import {
  TrendingUp, TrendingDown, Bus, AlertTriangle, DollarSign,
  Activity, RefreshCw, Wifi
} from 'lucide-react';
import { formatCurrency } from '../../utils/formatCurrency';
import { fetchAllPages } from '../../utils/fetchAllPages';
import { format, subDays, startOfDay, endOfDay, eachWeekOfInterval, startOfWeek, endOfWeek } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  LineChart, Line, PieChart, Pie, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

interface KPI {
  totalRevenue: number;
  totalExpenses: number;
  netResult: number;
  profitMargin: number;
  activeBuses: number;
  totalBuses: number;
  revenueChange: number;
  expensesChange: number;
}

interface BusPerf {
  bus_id: string;
  registration: string;
  revenue: number;
  expenses: number;
  result: number;
  margin: number;
  fill_rate: number;
  status: string;
  trips: number;
}

interface ChartPoint {
  label: string;
  revenue: number;
  expenses: number;
  result: number;
}

interface ExpensePart {
  category: string;
  amount: number;
  percentage: number;
  color: string;
}

interface AlertItem {
  id: string;
  type: 'danger' | 'warning' | 'info';
  message: string;
}

const CHART_COLORS = ['#0B7439', '#E8523A', '#F59E0B', '#3B82F6', '#10B981', '#64748B'];

const EXPENSE_LABEL: Record<string, string> = {
  assurance: 'Assurance', taxes: 'Taxes', peage: 'Péages', lavage: 'Lavage',
  vignette: 'Vignette', visite_technique: 'Visite tech.', parking: 'Parking',
  amende: 'Amende', taxe_route: 'Taxe route', carburant: 'Carburant',
  reparation: 'Réparation', autres: 'Autres', autre: 'Autre'
};

export default function PerformanceAnalytics() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [selectedCompany, setSelectedCompany] = useState('all');
  const [dateRange, setDateRange] = useState({
    start: format(subDays(new Date(), 30), 'yyyy-MM-dd'),
    end: format(new Date(), 'yyyy-MM-dd')
  });

  const [kpi, setKpi] = useState<KPI>({
    totalRevenue: 0, totalExpenses: 0, netResult: 0,
    profitMargin: 0, activeBuses: 0, totalBuses: 0,
    revenueChange: 0, expensesChange: 0
  });
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [expenseParts, setExpenseParts] = useState<ExpensePart[]>([]);
  const [busPerfs, setBusPerfs] = useState<BusPerf[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const getBusIds = useCallback(async (): Promise<{ ids: string[]; activeCount: number; total: number }> => {
    let q = supabase.from('buses').select('id, status, is_active');
    if (selectedCompany !== 'all') q = q.eq('company_id', selectedCompany);
    const { data } = await q;
    const all = data || [];
    const active = all.filter(b => b.is_active);
    return {
      ids: active.map(b => b.id),
      activeCount: active.filter(b => ['disponible', 'en_service'].includes(b.status)).length,
      total: active.length
    };
  }, [selectedCompany]);

  const getScheduleIds = useCallback(async (busIds: string[], from: string, to: string): Promise<string[]> => {
    if (busIds.length === 0) return [];
    const { data } = await supabase
      .from('schedules').select('id')
      .in('bus_id', busIds)
      .gte('departure_datetime', from)
      .lte('departure_datetime', to);
    return (data || []).map(s => s.id);
  }, []);

  const getRevenue = useCallback(async (scheduleIds: string[]): Promise<number> => {
    if (scheduleIds.length === 0) return 0;
    // Read 1 000 rows at a time: a period has far more than 1 000 tickets
    const { data } = await fetchAllPages<{ total_price: number }>((from, to) => supabase
      .from('reservations').select('total_price')
      .in('schedule_id', scheduleIds).neq('status', 'annulee')
      .order('id').range(from, to));
    return (data || []).reduce((s, r) => s + (r.total_price || 0), 0);
  }, []);

  const getExpenses = useCallback(async (busIds: string[], from: string, to: string): Promise<number> => {
    if (busIds.length === 0) return 0;
    const [expRes, fuelRes] = await Promise.all([
      supabase.from('bus_expenses').select('amount')
        .in('bus_id', busIds).gte('expense_date', from).lte('expense_date', to).eq('status', 'validee'),
      supabase.from('fuel_vouchers').select('actual_amount')
        .in('bus_id', busIds).gte('created_at', from).lte('created_at', to).eq('status', 'utilise')
    ]);
    return (expRes.data || []).reduce((s, e) => s + (e.amount || 0), 0)
         + (fuelRes.data || []).reduce((s, f) => s + (f.actual_amount || 0), 0);
  }, []);

  const loadAll = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      else setRefreshing(true);

      const start = startOfDay(new Date(dateRange.start));
      const end = endOfDay(new Date(dateRange.end));
      const startIso = start.toISOString();
      const endIso = end.toISOString();

      const { ids: busIds, activeCount, total } = await getBusIds();

      if (busIds.length === 0) {
        setKpi({ totalRevenue: 0, totalExpenses: 0, netResult: 0, profitMargin: 0, activeBuses: 0, totalBuses: 0, revenueChange: 0, expensesChange: 0 });
        setChartData([]);
        setExpenseParts([]);
        setBusPerfs([]);
        setAlerts([]);
        return;
      }

      const days = Math.ceil((end.getTime() - start.getTime()) / 86400000);
      const useWeeks = days > 60;

      await Promise.all([
        loadKpi(busIds, startIso, endIso, activeCount, total, start, end),
        loadChart(busIds, start, end, useWeeks),
        loadExpenseParts(busIds, startIso, endIso),
        loadBusPerfs(busIds, startIso, endIso),
        loadAlerts(busIds)
      ]);

      setLastUpdated(new Date());
    } catch (err: any) {
      toast.error('Erreur de chargement des données');
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedCompany, dateRange]);

  const loadKpi = async (
    busIds: string[], startIso: string, endIso: string,
    activeCount: number, total: number,
    start: Date, end: Date
  ) => {
    const scheduleIds = await getScheduleIds(busIds, startIso, endIso);
    const [revenue, expenses] = await Promise.all([
      getRevenue(scheduleIds),
      getExpenses(busIds, startIso, endIso)
    ]);

    const spanMs = end.getTime() - start.getTime();
    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = new Date(start.getTime() - spanMs);
    const prevStartIso = prevStart.toISOString();
    const prevEndIso = prevEnd.toISOString();

    const prevScheduleIds = await getScheduleIds(busIds, prevStartIso, prevEndIso);
    const [prevRevenue, prevExpenses] = await Promise.all([
      getRevenue(prevScheduleIds),
      getExpenses(busIds, prevStartIso, prevEndIso)
    ]);

    const netResult = revenue - expenses;
    const profitMargin = revenue > 0 ? (netResult / revenue) * 100 : 0;
    const revenueChange = prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue) * 100 : 0;
    const expensesChange = prevExpenses > 0 ? ((expenses - prevExpenses) / prevExpenses) * 100 : 0;

    setKpi({ totalRevenue: revenue, totalExpenses: expenses, netResult, profitMargin, activeBuses: activeCount, totalBuses: total, revenueChange, expensesChange });
  };

  const loadChart = async (busIds: string[], start: Date, end: Date, useWeeks: boolean) => {
    const points: ChartPoint[] = [];

    if (useWeeks) {
      const weeks = eachWeekOfInterval({ start, end }, { weekStartsOn: 1 });
      for (const weekStart of weeks) {
        const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
        const from = weekStart < start ? start : weekStart;
        const to = weekEnd > end ? end : weekEnd;
        const schedIds = await getScheduleIds(busIds, from.toISOString(), to.toISOString());
        const [rev, exp] = await Promise.all([getRevenue(schedIds), getExpenses(busIds, from.toISOString(), to.toISOString())]);
        points.push({ label: format(from, 'dd/MM', { locale: fr }), revenue: Math.round(rev / 1000), expenses: Math.round(exp / 1000), result: Math.round((rev - exp) / 1000) });
      }
    } else {
      const days = Math.ceil((end.getTime() - start.getTime()) / 86400000);
      for (let i = 0; i < days; i++) {
        const day = new Date(start);
        day.setDate(day.getDate() + i);
        const next = new Date(day);
        next.setDate(next.getDate() + 1);
        const schedIds = await getScheduleIds(busIds, day.toISOString(), next.toISOString());
        const [rev, exp] = await Promise.all([getRevenue(schedIds), getExpenses(busIds, day.toISOString(), next.toISOString())]);
        points.push({ label: format(day, 'dd/MM', { locale: fr }), revenue: Math.round(rev / 1000), expenses: Math.round(exp / 1000), result: Math.round((rev - exp) / 1000) });
      }
    }

    setChartData(points);
  };

  const loadExpenseParts = async (busIds: string[], startIso: string, endIso: string) => {
    const [fuelRes, expRes, mainRes] = await Promise.all([
      supabase.from('fuel_vouchers').select('actual_amount')
        .in('bus_id', busIds).gte('created_at', startIso).lte('created_at', endIso).eq('status', 'utilise'),
      supabase.from('bus_expenses').select('amount, expense_type')
        .in('bus_id', busIds).gte('expense_date', startIso).lte('expense_date', endIso).eq('status', 'validee'),
      supabase.from('maintenance_work_orders').select('actual_cost')
        .in('bus_id', busIds).gte('created_at', startIso).lte('created_at', endIso)
        .in('status', ['termine', 'en_controle'])
    ]);

    const byType: Record<string, number> = {};

    const fuelTotal = (fuelRes.data || []).reduce((s, f) => s + (f.actual_amount || 0), 0);
    if (fuelTotal > 0) byType['Carburant'] = fuelTotal;

    const mainTotal = (mainRes.data || []).reduce((s, m) => s + (m.actual_cost || 0), 0);
    if (mainTotal > 0) byType['Maintenance'] = mainTotal;

    (expRes.data || []).forEach(e => {
      const label = EXPENSE_LABEL[e.expense_type] || 'Divers';
      byType[label] = (byType[label] || 0) + (e.amount || 0);
    });

    const total = Object.values(byType).reduce((s, v) => s + v, 0);
    const parts = Object.entries(byType)
      .map(([category, amount], i) => ({ category, amount, percentage: total > 0 ? (amount / total) * 100 : 0, color: CHART_COLORS[i % CHART_COLORS.length] }))
      .filter(p => p.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    setExpenseParts(parts);
  };

  const loadBusPerfs = async (busIds: string[], startIso: string, endIso: string) => {
    const { data: buses } = await (selectedCompany !== 'all'
      ? supabase.from('buses').select('id, registration_number, status, fill_rate_avg_30d').in('id', busIds)
      : supabase.from('buses').select('id, registration_number, status, fill_rate_avg_30d').in('id', busIds));

    if (!buses || buses.length === 0) { setBusPerfs([]); return; }

    const perfs = await Promise.all(buses.map(async bus => {
      const { data: scheds } = await supabase.from('schedules').select('id')
        .eq('bus_id', bus.id).gte('departure_datetime', startIso).lte('departure_datetime', endIso);
      const schedIds = (scheds || []).map(s => s.id);

      const [revRes, expRes, fuelRes] = await Promise.all([
        schedIds.length > 0
          ? fetchAllPages<any>((from, to) => supabase.from('reservations').select('total_price, total_seats')
              .in('schedule_id', schedIds).neq('status', 'annulee').order('id').range(from, to))
          : Promise.resolve({ data: [] }),
        supabase.from('bus_expenses').select('amount').eq('bus_id', bus.id)
          .gte('expense_date', startIso).lte('expense_date', endIso).eq('status', 'validee'),
        supabase.from('fuel_vouchers').select('actual_amount').eq('bus_id', bus.id)
          .gte('created_at', startIso).lte('created_at', endIso).eq('status', 'utilise')
      ]);

      const revenue = (revRes.data || []).reduce((s: number, r: any) => s + (r.total_price || 0), 0);
      const expenses = (expRes.data || []).reduce((s: number, e: any) => s + (e.amount || 0), 0)
                     + (fuelRes.data || []).reduce((s: number, f: any) => s + (f.actual_amount || 0), 0);
      const result = revenue - expenses;
      const margin = revenue > 0 ? (result / revenue) * 100 : 0;

      return {
        bus_id: bus.id,
        registration: bus.registration_number,
        revenue, expenses, result, margin,
        fill_rate: bus.fill_rate_avg_30d || 0,
        status: bus.status,
        trips: schedIds.length
      };
    }));

    setBusPerfs(perfs.sort((a, b) => b.revenue - a.revenue));
  };

  const loadAlerts = async (busIds: string[]) => {
    const items: AlertItem[] = [];

    const { data: buses } = await supabase
      .from('buses').select('id, registration_number, fill_rate_avg_30d, status')
      .in('id', busIds).eq('is_active', true);

    (buses || []).forEach(bus => {
      if ((bus.fill_rate_avg_30d || 0) < 40) {
        items.push({
          id: `low-fill-${bus.id}`,
          type: 'danger',
          message: `Bus ${bus.registration_number} — taux de remplissage critique (${(bus.fill_rate_avg_30d || 0).toFixed(0)}%)`
        });
      } else if ((bus.fill_rate_avg_30d || 0) < 60) {
        items.push({
          id: `mid-fill-${bus.id}`,
          type: 'warning',
          message: `Bus ${bus.registration_number} — taux de remplissage faible (${(bus.fill_rate_avg_30d || 0).toFixed(0)}%)`
        });
      }
    });

    const { data: pending } = await supabase
      .from('bus_expenses').select('id').eq('status', 'en_attente').limit(1);
    if (pending && pending.length > 0) {
      const { count } = await supabase.from('bus_expenses').select('id', { count: 'exact', head: true }).eq('status', 'en_attente');
      items.push({
        id: 'pending-expenses',
        type: 'warning',
        message: `${count || 0} charge(s) en attente de validation`
      });
    }

    const { data: immobilised } = await supabase
      .from('buses').select('registration_number').in('status', ['panne_route', 'reception_garage', 'diagnostic', 'attente_ot', 'maintenance', 'controle_qualite']).eq('is_active', true);
    if (immobilised && immobilised.length > 0) {
      items.push({
        id: 'immobilised-buses',
        type: 'danger',
        message: `${immobilised.length} bus immobilisé(s) en panne : ${immobilised.map(b => b.registration_number).join(', ')}`
      });
    }

    setAlerts(items.slice(0, 5));
  };

  useEffect(() => {
    supabase.from('companies').select('id, name').eq('is_active', true).order('name')
      .then(({ data }) => setCompanies(data || []));
  }, []);

  useEffect(() => {
    loadAll();

    if (channelRef.current) {
      channelRef.current.unsubscribe();
    }

    channelRef.current = supabase.channel(`perf-rt-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, () => loadAll(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bus_expenses' }, () => loadAll(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fuel_vouchers' }, () => loadAll(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'buses' }, () => loadAll(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules' }, () => loadAll(true))
      .subscribe();

    return () => { channelRef.current?.unsubscribe(); };
  }, [selectedCompany, dateRange]);

  const isPositive = (v: number) => v >= 0;

  const KPICard = ({ label, value, sub, subColor, icon: Icon, color, subLabel }: any) => (
    <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div className="p-2.5 rounded-xl" style={{ backgroundColor: `${color}15` }}>
          <Icon className="w-5 h-5" style={{ color }} />
        </div>
        {sub !== undefined && (
          <div className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${isPositive(sub) ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
            {isPositive(sub) ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {Math.abs(sub).toFixed(1)}%
          </div>
        )}
      </div>
      <div className="text-2xl font-bold mb-1" style={{ color }}>{value}</div>
      <div className="text-sm font-medium text-gray-500">{label}</div>
      {subLabel && <div className="text-xs text-gray-400 mt-1">{subLabel}</div>}
    </div>
  );

  if (loading) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-96 gap-4">
        <div className="w-12 h-12 border-4 border-gray-200 rounded-full animate-spin" style={{ borderTopColor: 'var(--primary)' }} />
        <p className="text-gray-500 font-medium">Chargement des données...</p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Analyse de Performance</h1>
          <div className="flex items-center gap-2 mt-1">
            <Wifi className="w-3.5 h-3.5 text-emerald-500" />
            <p className="text-sm text-gray-500">
              Temps réel · Mis à jour le {format(lastUpdated, 'HH:mm:ss', { locale: fr })}
            </p>
            {refreshing && <RefreshCw className="w-3.5 h-3.5 text-gray-400 animate-spin" />}
          </div>
        </div>
        <button
          onClick={() => loadAll(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-sm font-medium text-gray-600 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Actualiser
        </button>
      </div>

      <div className="flex flex-wrap gap-4 items-end p-4 bg-white rounded-2xl border border-gray-100 shadow-sm">
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Société</label>
          <select value={selectedCompany} onChange={e => setSelectedCompany(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent">
            <option value="all">Toutes les sociétés</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Du</label>
          <input type="date" value={dateRange.start}
            onChange={e => setDateRange(d => ({ ...d, start: e.target.value }))}
            className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Au</label>
          <input type="date" value={dateRange.end}
            onChange={e => setDateRange(d => ({ ...d, end: e.target.value }))}
            className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent" />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Recettes Totales"
          value={formatCurrency(kpi.totalRevenue)}
          sub={kpi.revenueChange}
          icon={TrendingUp}
          color="#0B7439"
          subLabel="vs période précédente"
        />
        <KPICard
          label="Dépenses Totales"
          value={formatCurrency(kpi.totalExpenses)}
          sub={kpi.expensesChange}
          icon={TrendingDown}
          color="#E8523A"
          subLabel="charges validées + carburant"
        />
        <KPICard
          label="Résultat Net"
          value={formatCurrency(kpi.netResult)}
          sub={kpi.profitMargin}
          icon={DollarSign}
          color={kpi.netResult >= 0 ? '#0B7439' : '#E8523A'}
          subLabel={`Marge : ${kpi.profitMargin.toFixed(1)}%`}
        />
        <KPICard
          label="Bus Actifs"
          value={`${kpi.activeBuses} / ${kpi.totalBuses}`}
          icon={Bus}
          color="#3B82F6"
          subLabel="disponibles ou en service"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="font-bold text-gray-900">Évolution Recettes vs Dépenses</h3>
              <p className="text-xs text-gray-400 mt-0.5">en milliers FCFA</p>
            </div>
            <Activity className="w-5 h-5 text-gray-300" />
          </div>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }}
                  formatter={(v: number) => [`${v}k FCFA`]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="revenue" stroke="#0B7439" strokeWidth={2.5} dot={false} name="Recettes" />
                <Line type="monotone" dataKey="expenses" stroke="#E8523A" strokeWidth={2.5} dot={false} name="Dépenses" />
                <Line type="monotone" dataKey="result" stroke="#3B82F6" strokeWidth={2} dot={false} name="Résultat" strokeDasharray="4 2" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-64 flex items-center justify-center text-gray-400 text-sm">Aucune donnée sur la période</div>
          )}
        </div>

        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h3 className="font-bold text-gray-900 mb-6">Répartition des Dépenses</h3>
          {expenseParts.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={expenseParts} cx="50%" cy="50%" innerRadius={50} outerRadius={80}
                    dataKey="amount" paddingAngle={2}>
                    {expenseParts.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }}
                    formatter={(v: number) => formatCurrency(v)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 mt-2">
                {expenseParts.slice(0, 5).map((p, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                      <span className="text-gray-600 truncate max-w-28">{p.category}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-gray-800">{p.percentage.toFixed(1)}%</span>
                      <span className="text-gray-400 text-xs w-24 text-right">{formatCurrency(p.amount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">Aucune dépense validée</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h3 className="font-bold text-gray-900">Performance par Bus</h3>
            <p className="text-xs text-gray-400 mt-0.5">{busPerfs.length} bus analysé(s)</p>
          </div>
          {busPerfs.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-5 py-3">Bus</th>
                    <th className="text-right px-4 py-3">Voyages</th>
                    <th className="text-right px-4 py-3">Recettes</th>
                    <th className="text-right px-4 py-3">Dépenses</th>
                    <th className="text-right px-4 py-3">Résultat</th>
                    <th className="text-right px-4 py-3">Marge</th>
                    <th className="px-4 py-3">Taux Rempli.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {busPerfs.map(p => (
                    <tr key={p.bus_id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="font-semibold text-gray-900">{p.registration}</div>
                        <div className="text-xs text-gray-400 capitalize">{p.status?.replace('_', ' ')}</div>
                      </td>
                      <td className="px-4 py-3.5 text-right font-medium text-gray-700">{p.trips}</td>
                      <td className="px-4 py-3.5 text-right font-medium text-emerald-700">{formatCurrency(p.revenue)}</td>
                      <td className="px-4 py-3.5 text-right font-medium text-red-600">{formatCurrency(p.expenses)}</td>
                      <td className="px-4 py-3.5 text-right font-bold" style={{ color: p.result >= 0 ? '#0B7439' : '#E8523A' }}>
                        {formatCurrency(p.result)}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                          p.margin >= 30 ? 'bg-emerald-100 text-emerald-700' :
                          p.margin >= 10 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {p.margin.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2 min-w-24">
                          <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                            <div className="h-1.5 rounded-full transition-all duration-500"
                              style={{
                                width: `${Math.min(p.fill_rate, 100)}%`,
                                backgroundColor: p.fill_rate >= 75 ? '#0B7439' : p.fill_rate >= 50 ? '#F59E0B' : '#E8523A'
                              }} />
                          </div>
                          <span className="text-xs font-semibold text-gray-600 w-8">{p.fill_rate.toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-12 text-center text-gray-400 text-sm">Aucune donnée disponible pour la période</div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-5">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <h3 className="font-bold text-gray-900">Alertes en temps réel</h3>
          </div>
          {alerts.length > 0 ? (
            <div className="space-y-3">
              {alerts.map(alert => (
                <div key={alert.id} className={`p-3.5 rounded-xl text-sm font-medium ${
                  alert.type === 'danger' ? 'bg-red-50 text-red-700 border border-red-100' :
                  alert.type === 'warning' ? 'bg-amber-50 text-amber-700 border border-amber-100' :
                  'bg-blue-50 text-blue-700 border border-blue-100'
                }`}>
                  <div className="flex items-start gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                      alert.type === 'danger' ? 'bg-red-500' :
                      alert.type === 'warning' ? 'bg-amber-500' : 'bg-blue-500'
                    }`} />
                    {alert.message}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center mb-3">
                <TrendingUp className="w-6 h-6 text-emerald-500" />
              </div>
              <p className="text-sm font-medium text-gray-600">Tout va bien</p>
              <p className="text-xs text-gray-400 mt-1">Aucune alerte en cours</p>
            </div>
          )}
        </div>
      </div>

      {busPerfs.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h3 className="font-bold text-gray-900 mb-5">Recettes par Bus</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={busPerfs.slice(0, 10).map(p => ({ name: p.registration, recettes: Math.round(p.revenue / 1000), depenses: Math.round(p.expenses / 1000) }))}
              margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} formatter={(v: number) => [`${v}k FCFA`]} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="recettes" fill="#0B7439" radius={[4, 4, 0, 0]} name="Recettes" />
              <Bar dataKey="depenses" fill="#E8523A" radius={[4, 4, 0, 0]} name="Dépenses" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
