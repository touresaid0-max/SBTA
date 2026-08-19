import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { useComptableCompanies } from '../../hooks/useComptableCompanies';
import toast from 'react-hot-toast';
import {
  FileText, CheckCircle, Clock, DollarSign, ArrowRight,
  Fuel, Wrench, RefreshCw, TrendingUp, Building2
} from 'lucide-react';
import { formatCurrency } from '../../utils/formatCurrency';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface DashboardStats {
  pendingFuelVouchers: number;
  pendingExpenses: number;
  pendingWorkOrders: number;
  validatedFuelThisMonth: number;
  validatedExpensesThisMonth: number;
  validatedWorkOrdersThisMonth: number;
  totalValidatedAmount: number;
}

interface CompanyInfo { id: string; name: string; code: string }

export default function ComptableDashboard() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { allowedCompanyIds } = useComptableCompanies();
  const companyIds = allowedCompanyIds ?? (user?.company_id ? [user.company_id] : []);
  const [companies, setCompanies] = useState<CompanyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats>({
    pendingFuelVouchers: 0,
    pendingExpenses: 0,
    pendingWorkOrders: 0,
    validatedFuelThisMonth: 0,
    validatedExpensesThisMonth: 0,
    validatedWorkOrdersThisMonth: 0,
    totalValidatedAmount: 0,
  });

  useEffect(() => {
    if (companyIds.length > 0) {
      supabase.from('companies').select('id, name, code').in('id', companyIds)
        .then(({ data }) => { setCompanies((data ?? []) as CompanyInfo[]) });
    }
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      setLoading(true);
      const monthStart = startOfMonth(new Date());
      const monthEnd = endOfMonth(new Date());

      // Récupérer les IDs de buses de la société du comptable
      let busIds: string[] | null = null;
      if (companyIds.length > 0) {
        const { data: busData } = await supabase
          .from('buses')
          .select('id')
          .in('company_id', companyIds);
        busIds = (busData ?? []).map(b => b.id);
      }

      const applyBusFilter = (q: any) => busIds ? q.in('bus_id', busIds) : q;

      const [
        fuelPending,
        expensesPending,
        workOrdersPending,
        fuelValidated,
        expensesValidated,
        workOrdersValidated,
        expensesAmountRes,
        workOrdersAmountRes,
      ] = await Promise.all([
        applyBusFilter(supabase.from('fuel_vouchers').select('id', { count: 'exact', head: true }).eq('status', 'genere')),
        applyBusFilter(supabase.from('bus_expenses').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
        applyBusFilter(supabase.from('maintenance_work_orders').select('id', { count: 'exact', head: true }).eq('status', 'submitted')),
        applyBusFilter(supabase.from('fuel_vouchers').select('id', { count: 'exact', head: true })
          .eq('status', 'validated')
          .gte('created_at', monthStart.toISOString())
          .lte('created_at', monthEnd.toISOString())),
        applyBusFilter(supabase.from('bus_expenses').select('id', { count: 'exact', head: true })
          .eq('status', 'validated')
          .gte('created_at', monthStart.toISOString())
          .lte('created_at', monthEnd.toISOString())),
        applyBusFilter(supabase.from('maintenance_work_orders').select('id', { count: 'exact', head: true })
          .eq('status', 'validated')
          .gte('created_at', monthStart.toISOString())
          .lte('created_at', monthEnd.toISOString())),
        applyBusFilter(supabase.from('bus_expenses').select('amount')
          .eq('status', 'validated')
          .gte('created_at', monthStart.toISOString())
          .lte('created_at', monthEnd.toISOString())),
        applyBusFilter(supabase.from('maintenance_work_orders').select('actual_cost, estimated_cost')
          .eq('status', 'validated')
          .gte('created_at', monthStart.toISOString())
          .lte('created_at', monthEnd.toISOString())),
      ]);

      const expenseTotal = (expensesAmountRes.data ?? []).reduce((s, e) => s + Number(e.amount || 0), 0);
      const workOrderTotal = (workOrdersAmountRes.data ?? []).reduce(
        (s, w) => s + Number(w.actual_cost || w.estimated_cost || 0), 0
      );

      setStats({
        pendingFuelVouchers: fuelPending.count ?? 0,
        pendingExpenses: expensesPending.count ?? 0,
        pendingWorkOrders: workOrdersPending.count ?? 0,
        validatedFuelThisMonth: fuelValidated.count ?? 0,
        validatedExpensesThisMonth: expensesValidated.count ?? 0,
        validatedWorkOrdersThisMonth: workOrdersValidated.count ?? 0,
        totalValidatedAmount: expenseTotal + workOrderTotal,
      });
    } catch (error: any) {
      toast.error('Erreur de chargement');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const totalPending = stats.pendingFuelVouchers + stats.pendingExpenses + stats.pendingWorkOrders;
  const totalValidated = stats.validatedFuelThisMonth + stats.validatedExpensesThisMonth + stats.validatedWorkOrdersThisMonth;

  const pendingItems = [
    {
      label: 'Bons de carburant',
      count: stats.pendingFuelVouchers,
      icon: <Fuel className="w-5 h-5" />,
      path: '/comptable/fuel-vouchers',
      color: 'var(--warning)',
      bg: 'var(--warning-light)',
    },
    {
      label: 'Charges bus',
      count: stats.pendingExpenses,
      icon: <FileText className="w-5 h-5" />,
      path: '/comptable/expense-validation',
      color: 'var(--primary)',
      bg: 'var(--primary-light)',
    },
    {
      label: 'Ordres de travail',
      count: stats.pendingWorkOrders,
      icon: <Wrench className="w-5 h-5" />,
      path: '/comptable/work-orders',
      color: 'var(--danger)',
      bg: 'var(--danger-light)',
    },
  ];

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
            Comptabilité
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            {format(new Date(), 'EEEE d MMMM yyyy', { locale: fr })} — Validation des dépenses
          </p>
          {companies.length > 0 && (
            <div className="flex items-center gap-2 mt-2 flex-wrap" aria-label="Sociétés affectées">
              <Building2 className="w-4 h-4" style={{ color: '#1D4ED8' }} />
              {companies.map(currentCompany => (
                <div key={currentCompany.id} className="flex items-center gap-1 px-3 py-1.5 rounded-lg"
                  style={{ backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE' }}>
                  <span className="text-sm font-semibold" style={{ color: '#1E3A5F' }}>{currentCompany.name}</span>
                  <span className="text-xs font-mono px-1.5 py-0.5 rounded font-bold" style={{ backgroundColor: '#DBEAFE', color: '#1D4ED8' }}>{currentCompany.code}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={loadStats}
          disabled={loading}
          className="px-4 py-2 rounded-lg border flex items-center gap-2 text-sm hover:bg-gray-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Actualiser
        </button>
      </div>

      {loading ? (
        <div className="text-center py-16">
          <div className="w-10 h-10 border-4 rounded-full animate-spin mx-auto mb-4"
            style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Chargement...</p>
        </div>
      ) : (
        <>
          {/* Summary KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--warning-light)' }}>
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4" style={{ color: 'var(--warning)' }} />
                <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>En attente</span>
              </div>
              <p className="text-2xl font-black" style={{ color: 'var(--warning)' }}>{totalPending}</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>dossiers</p>
            </div>
            <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--success-light)' }}>
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="w-4 h-4" style={{ color: 'var(--success)' }} />
                <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Validés ce mois</span>
              </div>
              <p className="text-2xl font-black" style={{ color: 'var(--success)' }}>{totalValidated}</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>dossiers</p>
            </div>
            <div className="rounded-xl p-5 md:col-span-2" style={{ backgroundColor: 'var(--primary-light)' }}>
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Montant validé ce mois</span>
              </div>
              <p className="text-2xl font-black" style={{ color: 'var(--primary)' }}>{formatCurrency(stats.totalValidatedAmount)}</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>charges + OT</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            {/* Pending Validations */}
            <div className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: 'var(--neutral-200)' }}>
              <div className="p-5 border-b" style={{ borderColor: 'var(--neutral-200)' }}>
                <h2 className="font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <Clock className="w-4 h-4" style={{ color: 'var(--warning)' }} />
                  En attente de validation
                </h2>
              </div>
              <div className="p-5 space-y-3">
                {pendingItems.map(item => (
                  <div
                    key={item.path}
                    className="flex items-center justify-between p-4 rounded-xl border-2 transition-all"
                    style={{ borderColor: item.count > 0 ? item.color : 'var(--neutral-200)' }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: item.bg }}>
                        <span style={{ color: item.color }}>{item.icon}</span>
                      </div>
                      <div>
                        <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{item.label}</p>
                        <p className="text-xl font-black" style={{ color: item.count > 0 ? item.color : 'var(--text-secondary)' }}>
                          {item.count} en attente
                        </p>
                      </div>
                    </div>
                    {item.count > 0 && (
                      <button
                        onClick={() => navigate(item.path)}
                        className="px-3 py-2 rounded-lg font-medium flex items-center gap-1 text-sm"
                        style={{ backgroundColor: item.color, color: 'white' }}
                      >
                        Traiter <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Monthly Summary */}
            <div className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: 'var(--neutral-200)' }}>
              <div className="p-5 border-b" style={{ borderColor: 'var(--neutral-200)' }}>
                <h2 className="font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <TrendingUp className="w-4 h-4" style={{ color: 'var(--success)' }} />
                  Validations ce mois
                </h2>
              </div>
              <div className="p-5 space-y-3">
                {[
                  { label: 'Bons carburant', count: stats.validatedFuelThisMonth, icon: <Fuel className="w-4 h-4" />, color: 'var(--warning)', bg: 'var(--warning-light)' },
                  { label: 'Charges bus', count: stats.validatedExpensesThisMonth, icon: <FileText className="w-4 h-4" />, color: 'var(--primary)', bg: 'var(--primary-light)' },
                  { label: 'Ordres de travail', count: stats.validatedWorkOrdersThisMonth, icon: <Wrench className="w-4 h-4" />, color: 'var(--success)', bg: 'var(--success-light)' },
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between p-3 rounded-lg"
                    style={{ backgroundColor: item.bg }}>
                    <div className="flex items-center gap-2">
                      <span style={{ color: item.color }}>{item.icon}</span>
                      <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{item.label}</span>
                    </div>
                    <span className="font-bold" style={{ color: item.color }}>{item.count} validés</span>
                  </div>
                ))}
                <div className="pt-3 border-t" style={{ borderColor: 'var(--neutral-200)' }}>
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-sm" style={{ color: 'var(--text-secondary)' }}>Total montant</span>
                    <span className="font-black text-lg" style={{ color: 'var(--primary)' }}>
                      {formatCurrency(stats.totalValidatedAmount)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Access */}
          <div className="bg-white rounded-xl border p-6" style={{ borderColor: 'var(--neutral-200)' }}>
            <h3 className="font-bold mb-4 text-sm uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              Accès rapide
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { label: 'Bons de carburant', desc: 'Valider les bons carburant', icon: <Fuel className="w-5 h-5" />, path: '/comptable/fuel-vouchers', count: stats.pendingFuelVouchers, color: 'var(--warning)', bg: 'var(--warning-light)' },
                { label: 'Charges bus', desc: 'Valider les charges des bus', icon: <FileText className="w-5 h-5" />, path: '/comptable/expense-validation', count: stats.pendingExpenses, color: 'var(--primary)', bg: 'var(--primary-light)' },
                { label: 'Ordres de travail', desc: 'Approuver les OT maintenance', icon: <Wrench className="w-5 h-5" />, path: '/comptable/work-orders', count: stats.pendingWorkOrders, color: 'var(--success)', bg: 'var(--success-light)' },
              ].map(item => (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className="p-5 rounded-xl border-2 hover:shadow-md transition-all text-left group flex items-center gap-4"
                  style={{ borderColor: 'var(--neutral-200)' }}
                >
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: item.bg }}>
                    <span style={{ color: item.color }}>{item.icon}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{item.label}</h4>
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{item.desc}</p>
                    {item.count > 0 && (
                      <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-bold"
                        style={{ backgroundColor: item.bg, color: item.color }}>
                        {item.count} en attente
                      </span>
                    )}
                  </div>
                  <ArrowRight className="w-4 h-4 opacity-40 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>

          {totalPending === 0 && (
            <div className="bg-white rounded-xl border p-8 text-center mt-6" style={{ borderColor: 'var(--neutral-200)' }}>
              <div className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center"
                style={{ backgroundColor: 'var(--success-light)' }}>
                <CheckCircle className="w-7 h-7" style={{ color: 'var(--success)' }} />
              </div>
              <h3 className="font-bold text-lg mb-2">Aucune validation en attente</h3>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Tous les documents ont été traités.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
