import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import { Filter, Download, TrendingUp, PieChart as PieChartIcon } from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency } from '../../utils/formatCurrency';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';

interface Expense {
  id: string;
  bus_id: string;
  expense_type: string;
  amount: number;
  description: string;
  expense_date: string;
  expiry_date: string | null;
  status: string;
  validated_by: string | null;
  validated_at: string | null;
  buses: {
    license_plate: string;
    model: string;
    company_id: string | null;
  };
  validator?: {
    full_name: string;
  };
}

interface Company {
  id: string;
  name: string;
}

interface Bus {
  id: string;
  license_plate: string;
  model: string;
}

const EXPENSE_TYPES: Record<string, string> = {
  assurance: 'Assurance',
  peage: 'Péage',
  vignette: 'Vignette',
  visite_technique: 'Visite technique',
  lavage: 'Lavage',
  parking: 'Parking',
  amende: 'Amende',
  taxe_route: 'Taxe route',
  autre: 'Autre'
};

const COLORS = ['#0B7439', '#AF3029', '#F59E0B', '#3B82F6', '#8B5CF6', '#EC4899', '#10B981', '#F97316', '#6366F1'];

export default function ExpensesReport() {
  const [loading, setLoading] = useState(true);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [filteredExpenses, setFilteredExpenses] = useState<Expense[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [buses, setBuses] = useState<Bus[]>([]);

  const [filterCompany, setFilterCompany] = useState('');
  const [filterBus, setFilterBus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [expenses, filterCompany, filterBus, filterType, dateFrom, dateTo]);

  const loadData = async () => {
    try {
      setLoading(true);

      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const [expensesRes, companiesRes, busesRes] = await Promise.all([
        supabase
          .from('bus_expenses')
          .select(`
            *,
            buses:bus_id (
              license_plate,
              model,
              company_id
            ),
            validator:validated_by (
              full_name
            )
          `)
          .eq('status', 'validee')
          .gte('expense_date', startOfMonth.toISOString())
          .order('expense_date', { ascending: false }),
        supabase
          .from('companies')
          .select('id, name')
          .eq('is_active', true)
          .order('name', { ascending: true }),
        supabase
          .from('buses')
          .select('id, license_plate, model')
          .eq('is_active', true)
          .order('license_plate', { ascending: true })
      ]);

      if (expensesRes.error) throw expensesRes.error;
      if (companiesRes.error) throw companiesRes.error;
      if (busesRes.error) throw busesRes.error;

      setExpenses(expensesRes.data || []);
      setCompanies(companiesRes.data || []);
      setBuses(busesRes.data || []);

      setDateFrom(format(startOfMonth, 'yyyy-MM-dd'));
      setDateTo(format(new Date(), 'yyyy-MM-dd'));
    } catch (error: any) {
      toast.error('Erreur de chargement');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...expenses];

    if (filterCompany) {
      filtered = filtered.filter(exp => exp.buses.company_id === filterCompany);
    }

    if (filterBus) {
      filtered = filtered.filter(exp => exp.bus_id === filterBus);
    }

    if (filterType) {
      filtered = filtered.filter(exp => exp.expense_type === filterType);
    }

    if (dateFrom) {
      filtered = filtered.filter(
        exp => new Date(exp.expense_date) >= new Date(dateFrom)
      );
    }

    if (dateTo) {
      const endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);
      filtered = filtered.filter(
        exp => new Date(exp.expense_date) <= endDate
      );
    }

    setFilteredExpenses(filtered);
  };

  const totalAmount = filteredExpenses.reduce((sum, exp) => sum + exp.amount, 0);

  const expensesByType = Object.keys(EXPENSE_TYPES).map(type => {
    const typeExpenses = filteredExpenses.filter(exp => exp.expense_type === type);
    const total = typeExpenses.reduce((sum, exp) => sum + exp.amount, 0);
    return {
      name: EXPENSE_TYPES[type],
      value: total,
      count: typeExpenses.length
    };
  }).filter(item => item.value > 0);

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            Charges validées
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>Vue consolidée des charges par bus</p>
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 border mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <select
            value={filterCompany}
            onChange={(e) => setFilterCompany(e.target.value)}
            className="px-4 py-2 border rounded-lg"
          >
            <option value="">Toutes sociétés</option>
            {companies.map(company => (
              <option key={company.id} value={company.id}>{company.name}</option>
            ))}
          </select>

          <select
            value={filterBus}
            onChange={(e) => setFilterBus(e.target.value)}
            className="px-4 py-2 border rounded-lg"
          >
            <option value="">Tous bus</option>
            {buses.map(bus => (
              <option key={bus.id} value={bus.id}>
                {bus.license_plate} - {bus.model}
              </option>
            ))}
          </select>

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-4 py-2 border rounded-lg"
          >
            <option value="">Tous types</option>
            {Object.entries(EXPENSE_TYPES).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>

          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-4 py-2 border rounded-lg"
          />

          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-4 py-2 border rounded-lg"
          />
        </div>

        {(filterCompany || filterBus || filterType || dateFrom || dateTo) && (
          <div className="mt-4 flex justify-end">
            <button
              onClick={() => {
                setFilterCompany('');
                setFilterBus('');
                setFilterType('');
                const startOfMonth = new Date();
                startOfMonth.setDate(1);
                setDateFrom(format(startOfMonth, 'yyyy-MM-dd'));
                setDateTo(format(new Date(), 'yyyy-MM-dd'));
              }}
              className="px-4 py-2 rounded-lg border font-medium text-sm hover:bg-gray-50"
            >
              Réinitialiser
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="w-12 h-12 border-4 rounded-full animate-spin mx-auto mb-4"
               style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Chargement...</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            <div className="bg-white rounded-xl p-6 border">
              <div className="flex items-center gap-3 mb-2">
                <TrendingUp className="w-6 h-6" style={{ color: 'var(--primary)' }} />
                <h3 className="font-semibold">Total charges validées</h3>
              </div>
              <p className="text-3xl font-bold mb-2" style={{ color: 'var(--primary)' }}>
                {formatCurrency(totalAmount)}
              </p>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {filteredExpenses.length} charge(s)
              </p>
            </div>

            <div className="bg-white rounded-xl p-6 border lg:col-span-2">
              <div className="flex items-center gap-3 mb-4">
                <PieChartIcon className="w-6 h-6" style={{ color: 'var(--primary)' }} />
                <h3 className="font-semibold">Répartition par type</h3>
              </div>

              {expensesByType.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={expensesByType}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {expensesByType.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number) => formatCurrency(value)}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-center py-8">
                  <p style={{ color: 'var(--text-secondary)' }}>Aucune donnée</p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl border mb-6">
            <div className="p-6 border-b">
              <h3 className="font-bold">Détail par type</h3>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {expensesByType.map((item, index) => (
                  <div key={item.name} className="p-4 rounded-lg border">
                    <div className="flex items-center gap-2 mb-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: COLORS[index % COLORS.length] }}
                      />
                      <p className="font-semibold">{item.name}</p>
                    </div>
                    <p className="text-2xl font-bold mb-1" style={{ color: 'var(--primary)' }}>
                      {formatCurrency(item.value)}
                    </p>
                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {item.count} charge(s)
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead style={{ backgroundColor: 'var(--neutral-100)' }}>
                  <tr>
                    <th className="text-left p-4 font-semibold">Date</th>
                    <th className="text-left p-4 font-semibold">Bus</th>
                    <th className="text-left p-4 font-semibold">Type</th>
                    <th className="text-left p-4 font-semibold">Description</th>
                    <th className="text-left p-4 font-semibold">Montant</th>
                    <th className="text-left p-4 font-semibold">Expiration</th>
                    <th className="text-left p-4 font-semibold">Validé par</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredExpenses.map(expense => (
                    <tr key={expense.id} className="border-t hover:bg-gray-50">
                      <td className="p-4">
                        <p className="text-sm">{format(new Date(expense.expense_date), 'dd/MM/yyyy')}</p>
                      </td>
                      <td className="p-4">
                        <p className="font-semibold">{expense.buses.license_plate}</p>
                        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          {expense.buses.model}
                        </p>
                      </td>
                      <td className="p-4">
                        <span className="px-2 py-1 rounded text-xs font-medium bg-gray-100">
                          {EXPENSE_TYPES[expense.expense_type] || expense.expense_type}
                        </span>
                      </td>
                      <td className="p-4">
                        <p className="text-sm max-w-xs truncate">{expense.description}</p>
                      </td>
                      <td className="p-4">
                        <p className="font-bold" style={{ color: 'var(--primary)' }}>
                          {formatCurrency(expense.amount)}
                        </p>
                      </td>
                      <td className="p-4">
                        {expense.expiry_date ? (
                          <p className="text-sm">{format(new Date(expense.expiry_date), 'dd/MM/yyyy')}</p>
                        ) : (
                          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>-</span>
                        )}
                      </td>
                      <td className="p-4">
                        <p className="text-sm">{expense.validator?.full_name || 'N/A'}</p>
                        {expense.validated_at && (
                          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                            {format(new Date(expense.validated_at), 'dd/MM/yyyy')}
                          </p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {filteredExpenses.length === 0 && (
                <div className="p-12 text-center">
                  <Filter className="w-16 h-16 mx-auto mb-4" style={{ color: 'var(--text-secondary)' }} />
                  <p className="font-semibold mb-1">Aucune charge trouvée</p>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    {expenses.length === 0
                      ? 'Aucune charge validée'
                      : 'Aucun résultat ne correspond aux filtres'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
