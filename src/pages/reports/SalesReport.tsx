import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import { DollarSign, Download, TrendingUp, TicketCheck, Percent, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import PeriodFilter from '../../components/shared/PeriodFilter';
import { getDateRangeFromPeriod, PeriodFilter as PeriodType, exportToCSV } from '../../utils/reportHelpers';
import { formatCurrency } from '../../utils/formatCurrency';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import jsPDF from 'jspdf';

// Number of sales listed in the detail table (the export contains all of them)
const DETAIL_ROWS = 500;

function toSaleRow(r: any) {
  return {
    date: format(new Date(r.created_at), 'dd/MM/yyyy HH:mm'),
    route: r.schedule?.route_name || 'N/A',
    bus: r.schedule?.bus?.registration_number || 'N/A',
    class: r.seat_class || 'Standard',
    tickets: r.seat_numbers?.length || 1,
    revenue: r.total_price || 0,
    occupancy: 0
  };
}

export default function SalesReport() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodType>('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const [companies, setCompanies] = useState<any[]>([]);
  const [routes, setRoutes] = useState<any[]>([]);
  const [buses, setBuses] = useState<any[]>([]);

  const [selectedCompany, setSelectedCompany] = useState('all');
  const [selectedRoute, setSelectedRoute] = useState('all');
  const [selectedBus, setSelectedBus] = useState('all');
  const [selectedClass, setSelectedClass] = useState('all');

  const [kpis, setKpis] = useState({
    ticketsSold: 0,
    grossRevenue: 0,
    discounts: 0,
    netRevenue: 0,
    avgOccupancy: 0
  });

  const [salesData, setSalesData] = useState<any[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);

  useEffect(() => {
    loadFiltersData();
  }, []);

  useEffect(() => {
    if (companies.length > 0) {
      loadReportData();
    }
  }, [period, customStart, customEnd, selectedCompany, selectedRoute, selectedBus, selectedClass, companies]);

  const loadFiltersData = async () => {
    try {
      const [companiesRes, routesRes, busesRes] = await Promise.all([
        supabase.from('companies').select('id, name').order('name'),
        supabase.from('routes').select('id, departure_city, arrival_city').order('departure_city'),
        supabase.from('buses').select('id, registration_number').order('registration_number')
      ]);

      if (companiesRes.data) setCompanies(companiesRes.data);
      if (routesRes.data) setRoutes(routesRes.data);
      if (busesRes.data) setBuses(busesRes.data);
    } catch (error: any) {
      console.error('Erreur chargement filtres:', error);
    }
  };

  // Paid sales of the period, filtered by the database (company, route, bus)
  const salesQuery = (dateRange: { start: Date; end: Date }) => {
    const company = selectedCompany !== 'all';
    const bus = company || selectedBus !== 'all';
    const filtered = bus || selectedRoute !== 'all';
    let query = supabase
      .from('reservations')
      .select(`
        created_at, total_price, seat_numbers,
        schedule:schedule_id${filtered ? '!inner' : ''} (
          route_name,
          bus_id,
          bus:bus_id${bus ? '!inner' : ''} (
            registration_number,
            company_id
          )
        )
      `)
      .eq('payment_status', 'payee')
      .gte('created_at', dateRange.start.toISOString())
      .lte('created_at', dateRange.end.toISOString());
    if (company) query = query.eq('schedule.bus.company_id', selectedCompany);
    if (selectedBus !== 'all') query = query.eq('schedule.bus_id', selectedBus);
    if (selectedRoute !== 'all') query = query.like('schedule.route_name', `%${selectedRoute}%`);
    return query;
  };

  const loadReportData = async () => {
    try {
      setLoading(true);

      const dateRange = getDateRangeFromPeriod(
        period,
        customStart ? new Date(customStart) : undefined,
        customEnd ? new Date(customEnd) : undefined
      );

      // Totals and chart computed by the database: summing rows here was capped at 1 000 rows
      const { data: stats, error } = await supabase.rpc('get_sales_report_stats', {
        p_start: dateRange.start.toISOString(),
        p_end: dateRange.end.toISOString(),
        p_company_id: selectedCompany !== 'all' ? selectedCompany : null,
        p_route: selectedRoute !== 'all' ? selectedRoute : null,
        p_bus_id: selectedBus !== 'all' ? selectedBus : null,
      });

      if (error) throw error;

      const grossRevenue = Number(stats.gross_revenue);
      const discounts = 0;
      const netRevenue = grossRevenue - discounts;

      setKpis({
        ticketsSold: Number(stats.tickets),
        grossRevenue,
        discounts,
        netRevenue,
        avgOccupancy: Number(stats.avg_occupancy)
      });

      const chartData = (stats.revenue_by_day as { date: string; revenue: number }[]).map(d => ({
        date: format(new Date(d.date), 'dd/MM', { locale: fr }),
        revenus: Number(d.revenue)
      }));

      setChartData(chartData);

      // Detail table: the most recent sales only (the totals above cover the whole period)
      const { data: recent, error: detailError } = await salesQuery(dateRange)
        .order('created_at', { ascending: false })
        .limit(DETAIL_ROWS);
      if (detailError) throw detailError;
      setSalesData((recent || []).map(toSaleRow));
    } catch (error: any) {
      console.error('Erreur chargement rapport:', error);
      toast.error('Erreur de chargement');
    } finally {
      setLoading(false);
    }
  };

  const exportPDF = () => {
    try {
      const doc = new jsPDF();

      doc.setFontSize(18);
      doc.text('Rapport des Ventes', 20, 20);

      doc.setFontSize(12);
      doc.text(`Période: ${period}`, 20, 30);
      doc.text(`Généré le: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 20, 37);

      doc.setFontSize(14);
      doc.text('KPIs', 20, 50);

      doc.setFontSize(10);
      doc.text(`Billets vendus: ${kpis.ticketsSold}`, 20, 60);
      doc.text(`Revenus bruts: ${formatCurrency(kpis.grossRevenue)}`, 20, 67);
      doc.text(`Remises: ${formatCurrency(kpis.discounts)}`, 20, 74);
      doc.text(`Revenus nets: ${formatCurrency(kpis.netRevenue)}`, 20, 81);
      doc.text(`Taux occupation moyen: ${kpis.avgOccupancy.toFixed(1)}%`, 20, 88);

      doc.save(`rapport-ventes-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
      toast.success('Export PDF réussi');
    } catch (error: any) {
      console.error('Erreur export PDF:', error);
      toast.error('Erreur lors de l\'export');
    }
  };

  // The export contains every sale of the period, read 1 000 rows at a time
  const exportExcel = async () => {
    try {
      const dateRange = getDateRangeFromPeriod(
        period,
        customStart ? new Date(customStart) : undefined,
        customEnd ? new Date(customEnd) : undefined
      );
      const rows: any[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await salesQuery(dateRange)
          .order('created_at', { ascending: false })
          .range(from, from + 999);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      exportToCSV(rows.map(toSaleRow), `ventes-${format(new Date(), 'yyyy-MM-dd')}`);
      toast.success('Export Excel réussi');
    } catch (error: any) {
      console.error('Erreur export Excel:', error);
      toast.error('Erreur lors de l\'export');
    }
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <button
          onClick={() => navigate('/reports')}
          className="mb-4 flex items-center gap-2 text-sm font-semibold"
          style={{ color: 'var(--primary)' }}
        >
          <ArrowLeft className="w-4 h-4" />
          Retour aux rapports
        </button>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2 flex items-center gap-3">
              <DollarSign className="w-8 h-8" style={{ color: 'var(--primary)' }} />
              Rapport des Ventes
            </h1>
            <p style={{ color: 'var(--text-secondary)' }}>
              Analyse détaillée des ventes et revenus
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={exportPDF}
              className="px-6 py-3 rounded-lg font-bold flex items-center gap-2 shadow-md"
              style={{ backgroundColor: 'var(--danger)', color: 'white' }}
            >
              <Download className="w-5 h-5" />
              Export PDF
            </button>
            <button
              onClick={exportExcel}
              className="px-6 py-3 rounded-lg font-bold flex items-center gap-2 shadow-md"
              style={{ backgroundColor: 'var(--success)', color: 'white' }}
            >
              <Download className="w-5 h-5" />
              Export Excel
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-6">
        <PeriodFilter
          value={period}
          onChange={setPeriod}
          customStart={customStart}
          customEnd={customEnd}
          onCustomStartChange={setCustomStart}
          onCustomEndChange={setCustomEnd}
        />

        <div className="bg-white rounded-xl p-4 border">
          <label className="block text-sm font-semibold mb-2">Société</label>
          <select
            value={selectedCompany}
            onChange={(e) => setSelectedCompany(e.target.value)}
            className="w-full p-2 border rounded-lg"
          >
            <option value="all">Toutes</option>
            {companies.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="bg-white rounded-xl p-4 border">
          <label className="block text-sm font-semibold mb-2">Route</label>
          <select
            value={selectedRoute}
            onChange={(e) => setSelectedRoute(e.target.value)}
            className="w-full p-2 border rounded-lg"
          >
            <option value="all">Toutes</option>
            {routes.map(r => (
              <option key={r.id} value={`${r.departure_city}-${r.arrival_city}`}>
                {r.departure_city} → {r.arrival_city}
              </option>
            ))}
          </select>
        </div>

        <div className="bg-white rounded-xl p-4 border">
          <label className="block text-sm font-semibold mb-2">Classe</label>
          <select
            value={selectedClass}
            onChange={(e) => setSelectedClass(e.target.value)}
            className="w-full p-2 border rounded-lg"
          >
            <option value="all">Toutes</option>
            <option value="standard">Standard</option>
            <option value="vip">VIP</option>
            <option value="executive">Executive</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-xl p-6 border">
          <div className="flex items-center justify-between mb-2">
            <TicketCheck className="w-8 h-8" style={{ color: 'var(--info)' }} />
          </div>
          <p className="text-3xl font-black mb-1" style={{ color: 'var(--info)' }}>
            {kpis.ticketsSold}
          </p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Billets vendus
          </p>
        </div>

        <div className="bg-white rounded-xl p-6 border">
          <div className="flex items-center justify-between mb-2">
            <DollarSign className="w-8 h-8" style={{ color: 'var(--success)' }} />
          </div>
          <p className="text-2xl font-black mb-1" style={{ color: 'var(--success)' }}>
            {formatCurrency(kpis.grossRevenue)}
          </p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Revenus bruts
          </p>
        </div>

        <div className="bg-white rounded-xl p-6 border">
          <div className="flex items-center justify-between mb-2">
            <Percent className="w-8 h-8" style={{ color: 'var(--warning)' }} />
          </div>
          <p className="text-2xl font-black mb-1" style={{ color: 'var(--warning)' }}>
            {formatCurrency(kpis.discounts)}
          </p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Remises
          </p>
        </div>

        <div className="bg-white rounded-xl p-6 border">
          <div className="flex items-center justify-between mb-2">
            <TrendingUp className="w-8 h-8" style={{ color: 'var(--primary)' }} />
          </div>
          <p className="text-2xl font-black mb-1" style={{ color: 'var(--primary)' }}>
            {formatCurrency(kpis.netRevenue)}
          </p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Revenus nets
          </p>
        </div>

        <div className="bg-white rounded-xl p-6 border">
          <div className="flex items-center justify-between mb-2">
            <Percent className="w-8 h-8" style={{ color: 'var(--info)' }} />
          </div>
          <p className="text-3xl font-black mb-1" style={{ color: 'var(--info)' }}>
            {kpis.avgOccupancy.toFixed(1)}%
          </p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Taux occupation
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border p-6 mb-6">
        <h3 className="font-bold text-lg mb-4">Évolution des revenus</h3>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorRevenus" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#0B7439" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#0B7439" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip formatter={(value: number) => formatCurrency(value)} />
            <Legend />
            <Area
              type="monotone"
              dataKey="revenus"
              stroke="#0B7439"
              fillOpacity={1}
              fill="url(#colorRevenus)"
              name="Revenus"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="p-6 border-b">
          <h3 className="font-bold text-lg">Détail des ventes</h3>
          {kpis.ticketsSold > salesData.length && (
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              {salesData.length} ventes les plus récentes sur {kpis.ticketsSold} — l'export Excel les contient toutes
            </p>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead style={{ backgroundColor: 'var(--neutral-100)' }}>
              <tr>
                <th className="text-left p-4 font-semibold">Date</th>
                <th className="text-left p-4 font-semibold">Route</th>
                <th className="text-left p-4 font-semibold">Bus</th>
                <th className="text-center p-4 font-semibold">Classe</th>
                <th className="text-center p-4 font-semibold">Billets</th>
                <th className="text-right p-4 font-semibold">Revenus</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-12 text-center">
                    <div className="w-12 h-12 border-4 rounded-full animate-spin mx-auto mb-4"
                         style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
                    <p style={{ color: 'var(--text-secondary)' }}>Chargement...</p>
                  </td>
                </tr>
              ) : salesData.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-12 text-center">
                    <p style={{ color: 'var(--text-secondary)' }}>Aucune donnée pour cette période</p>
                  </td>
                </tr>
              ) : (
                salesData.map((sale, index) => (
                  <tr key={index} className="border-t hover:bg-gray-50">
                    <td className="p-4" style={{ color: 'var(--text-secondary)' }}>
                      {sale.date}
                    </td>
                    <td className="p-4">{sale.route}</td>
                    <td className="p-4 font-mono">{sale.bus}</td>
                    <td className="p-4 text-center">
                      <span className="px-3 py-1 rounded-full text-xs font-bold capitalize"
                            style={{
                              backgroundColor: 'var(--primary-light)',
                              color: 'var(--primary)'
                            }}>
                        {sale.class}
                      </span>
                    </td>
                    <td className="p-4 text-center font-semibold">{sale.tickets}</td>
                    <td className="p-4 text-right font-bold" style={{ color: 'var(--success)' }}>
                      {formatCurrency(sale.revenue)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
