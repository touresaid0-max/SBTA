import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import { TrendingUp, Download, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import PeriodFilter from '../../components/shared/PeriodFilter';
import { getDateRangeFromPeriod, PeriodFilter as PeriodType } from '../../utils/reportHelpers';
import { formatCurrency } from '../../utils/formatCurrency';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { fr } from 'date-fns/locale';
import jsPDF from 'jspdf';

export default function FinancialReport() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodType>('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const [kpis, setKpis] = useState({
    revenue: 0,
    expenses: 0,
    profit: 0,
    margin: 0
  });

  const [companyData, setCompanyData] = useState<any[]>([]);
  const [evolutionData, setEvolutionData] = useState<any[]>([]);

  useEffect(() => {
    loadReportData();
  }, [period, customStart, customEnd]);

  const loadReportData = async () => {
    try {
      setLoading(true);

      const dateRange = getDateRangeFromPeriod(
        period,
        customStart ? new Date(customStart) : undefined,
        customEnd ? new Date(customEnd) : undefined
      );

      // Totals computed by the database: summing rows here was capped at 1 000 rows per request
      const { data: stats, error } = await supabase.rpc('get_financial_report_stats', {
        p_start: dateRange.start.toISOString(),
        p_end: dateRange.end.toISOString(),
      });
      if (error) throw error;

      const revenue = Number(stats.revenue);
      const expenses = Number(stats.expenses);
      const profit = revenue - expenses;
      const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

      setKpis({ revenue, expenses, profit, margin });

      const companyStats = (stats.by_company as { name: string; revenue: number; expenses: number }[]).map(company => {
        const companyRevenue = Number(company.revenue);
        const companyExpenses = Number(company.expenses);

        const companyProfit = companyRevenue - companyExpenses;
        const companyMargin = companyRevenue > 0 ? (companyProfit / companyRevenue) * 100 : 0;

        return {
          name: company.name,
          revenus: companyRevenue,
          charges: companyExpenses,
          benefice: companyProfit,
          marge: companyMargin
        };
      });

      setCompanyData(companyStats);

      // Real figures of the last 3 calendar months up to the end of the period
      // (this chart used to show invented values: 80 % and 90 % of the current month)
      const months = [2, 1, 0].map(back => {
        const start = startOfMonth(subMonths(dateRange.end, back));
        return { start, end: endOfMonth(start) };
      });
      const monthlyData = await Promise.all(months.map(async ({ start, end }) => {
        const { data: m, error: monthError } = await supabase.rpc('get_financial_report_stats', {
          p_start: start.toISOString(),
          p_end: end.toISOString(),
        });
        if (monthError) throw monthError;
        return {
          mois: format(start, 'MMM yyyy', { locale: fr }),
          revenus: Number(m.revenue),
          charges: Number(m.expenses),
        };
      }));

      setEvolutionData(monthlyData);
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
      doc.text('Rapport Financier Consolidé', 20, 20);
      doc.setFontSize(12);
      doc.text(`Revenus: ${formatCurrency(kpis.revenue)}`, 20, 40);
      doc.text(`Charges: ${formatCurrency(kpis.expenses)}`, 20, 47);
      doc.text(`Bénéfice: ${formatCurrency(kpis.profit)}`, 20, 54);
      doc.text(`Marge: ${kpis.margin.toFixed(1)}%`, 20, 61);
      doc.save(`rapport-financier-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
      toast.success('Export PDF réussi');
    } catch (error: any) {
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
              <TrendingUp className="w-8 h-8" style={{ color: '#2563eb' }} />
              Rapport Financier Consolidé
            </h1>
            <p style={{ color: 'var(--text-secondary)' }}>
              Vue globale de la santé financière
            </p>
          </div>

          <button
            onClick={exportPDF}
            className="px-6 py-3 rounded-lg font-bold flex items-center gap-2 shadow-md"
            style={{ backgroundColor: 'var(--danger)', color: 'white' }}
          >
            <Download className="w-5 h-5" />
            Export PDF
          </button>
        </div>
      </div>

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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl p-6 border">
          <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>Revenus</p>
          <p className="text-3xl font-black" style={{ color: 'var(--success)' }}>
            {formatCurrency(kpis.revenue)}
          </p>
        </div>

        <div className="bg-white rounded-xl p-6 border">
          <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>Charges</p>
          <p className="text-3xl font-black" style={{ color: 'var(--danger)' }}>
            {formatCurrency(kpis.expenses)}
          </p>
        </div>

        <div className="bg-white rounded-xl p-6 border">
          <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>Bénéfice</p>
          <p className="text-3xl font-black" style={{ color: kpis.profit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
            {formatCurrency(kpis.profit)}
          </p>
        </div>

        <div className="bg-white rounded-xl p-6 border">
          <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>Marge</p>
          <p className="text-3xl font-black" style={{ color: kpis.margin >= 0 ? 'var(--success)' : 'var(--danger)' }}>
            {kpis.margin.toFixed(1)}%
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border p-6 mb-6">
        <h3 className="font-bold text-lg mb-4">Évolution mensuelle</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={evolutionData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="mois" />
            <YAxis />
            <Tooltip formatter={(value: number) => formatCurrency(value)} />
            <Legend />
            <Line type="monotone" dataKey="revenus" stroke="#0B7439" strokeWidth={2} name="Revenus" />
            <Line type="monotone" dataKey="charges" stroke="#AF3029" strokeWidth={2} name="Charges" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="p-6 border-b">
          <h3 className="font-bold text-lg">Détail par société</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead style={{ backgroundColor: 'var(--neutral-100)' }}>
              <tr>
                <th className="text-left p-4 font-semibold">Société</th>
                <th className="text-right p-4 font-semibold">Revenus</th>
                <th className="text-right p-4 font-semibold">Charges</th>
                <th className="text-right p-4 font-semibold">Bénéfice</th>
                <th className="text-right p-4 font-semibold">Marge</th>
              </tr>
            </thead>
            <tbody>
              {companyData.map((company, index) => (
                <tr key={index} className="border-t hover:bg-gray-50">
                  <td className="p-4 font-semibold">{company.name}</td>
                  <td className="p-4 text-right font-bold" style={{ color: 'var(--success)' }}>
                    {formatCurrency(company.revenus)}
                  </td>
                  <td className="p-4 text-right font-bold" style={{ color: 'var(--danger)' }}>
                    {formatCurrency(company.charges)}
                  </td>
                  <td className="p-4 text-right font-bold" style={{ color: company.benefice >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {formatCurrency(company.benefice)}
                  </td>
                  <td className="p-4 text-right font-bold">
                    {company.marge.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
