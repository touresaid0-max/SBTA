import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import { CheckCircle, XCircle, Eye, FileText, Clock, RefreshCw, Filter, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency } from '../../utils/formatCurrency';
import { useAuthStore } from '../../store/authStore';
import { useComptableCompanies } from '../../hooks/useComptableCompanies';
import { CompanyFilterBar } from '../../components/shared/CompanyFilterBar';

interface Expense {
  id: string;
  expense_type: string;
  amount: number;
  description: string | null;
  expense_date: string;
  receipt_url: string | null;
  status: string;
  created_at: string;
  bus: {
    registration_number: string;
    model: string;
    brand: string | null;
  } | null;
  creator: {
    full_name: string;
  } | null;
}

type FilterType = 'pending' | 'validated' | 'rejected' | 'all';

const EXPENSE_TYPES: Record<string, string> = {
  assurance:         'Assurance',
  peage:             'Péage',
  vignette:          'Vignette',
  visite_technique:  'Visite technique',
  lavage:            'Lavage',
  parking:           'Parking',
  amende:            'Amende',
  taxe_route:        'Taxe route',
  carburant:         'Carburant',
  reparation:        'Réparation',
  autre:             'Autre',
};

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  pending:   { label: 'En attente', color: 'var(--warning)', bg: 'var(--warning-light)' },
  validated: { label: 'Validé',     color: 'var(--success)', bg: 'var(--success-light)' },
  rejected:  { label: 'Rejeté',     color: 'var(--danger)',  bg: 'var(--danger-light)' },
};

export default function ExpenseValidation() {
  const { user } = useAuthStore();
  const { allowedCompanyIds, companyInfos } = useComptableCompanies();
  const allCompanyIds = allowedCompanyIds ?? (user?.company_id ? [user.company_id] : []);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const companyIds = selectedCompanies.length > 0 ? selectedCompanies : allCompanyIds;
  const [loading, setLoading] = useState(true);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [filter, setFilter] = useState<FilterType>('pending');
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionTarget, setRejectionTarget] = useState<Expense | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    loadExpenses();
  }, [filter, companyIds]);

  const loadExpenses = async () => {
    try {
      setLoading(true);

      let busIds: string[] | null = null;
      if (companyIds.length > 0) {
        const { data: busData } = await supabase.from('buses').select('id').in('company_id', companyIds);
        busIds = (busData ?? []).map(b => b.id);
        if (busIds.length === 0) { setExpenses([]); setLoading(false); return; }
      }

      let query = supabase
        .from('bus_expenses')
        .select(`
          id,
          expense_type,
          amount,
          description,
          expense_date,
          receipt_url,
          status,
          created_at,
          bus:bus_id (
            registration_number,
            model,
            brand
          ),
          creator:created_by (
            full_name
          )
        `)
        .order('expense_date', { ascending: false });

      if (filter !== 'all') query = query.eq('status', filter);
      if (busIds) query = query.in('bus_id', busIds);

      const { data, error } = await query;
      if (error) throw error;
      setExpenses((data ?? []) as any[]);
    } catch (error: any) {
      toast.error('Erreur de chargement');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleValidate = async (expense: Expense) => {
    if (!confirm(`Valider la charge de ${formatCurrency(expense.amount)} ?`)) return;
    try {
      setProcessing(true);
      const { error } = await supabase
        .from('bus_expenses')
        .update({
          status: 'validated',
          validated_by: user?.id,
        })
        .eq('id', expense.id);
      if (error) throw error;
      toast.success('Charge validée');
      loadExpenses();
    } catch (error: any) {
      toast.error('Erreur lors de la validation');
      console.error(error);
    } finally {
      setProcessing(false);
    }
  };

  const openRejectModal = (expense: Expense) => {
    setRejectionTarget(expense);
    setRejectionReason('');
    setShowRejectModal(true);
  };

  const handleReject = async () => {
    if (!rejectionTarget) return;
    if (!rejectionReason.trim()) { toast.error('Veuillez indiquer le motif de rejet'); return; }
    try {
      setProcessing(true);
      const { error } = await supabase
        .from('bus_expenses')
        .update({
          status: 'rejected',
          validated_by: user?.id,
        })
        .eq('id', rejectionTarget.id);
      if (error) throw error;
      toast.success('Charge rejetée');
      setShowRejectModal(false);
      setRejectionTarget(null);
      loadExpenses();
    } catch (error: any) {
      toast.error('Erreur lors du rejet');
      console.error(error);
    } finally {
      setProcessing(false);
    }
  };

  const pendingTotal = expenses.filter(e => e.status === 'pending').reduce((s, e) => s + Number(e.amount || 0), 0);
  const filterButtons: { key: FilterType; label: string }[] = [
    { key: 'pending',   label: 'En attente' },
    { key: 'validated', label: 'Validées' },
    { key: 'rejected',  label: 'Rejetées' },
    { key: 'all',       label: 'Toutes' },
  ];
  const filterColors: Record<FilterType, string> = {
    pending:   'var(--warning)',
    validated: 'var(--success)',
    rejected:  'var(--danger)',
    all:       'var(--primary)',
  };

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
            Validation des charges
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>Charges des bus en attente de validation</p>
        </div>
        <button
          onClick={loadExpenses}
          disabled={loading}
          className="px-4 py-2 rounded-lg border flex items-center gap-2 text-sm hover:bg-gray-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Actualiser
        </button>
      </div>

      <CompanyFilterBar filter={{ allCompanyIds, selectedCompanyIds: companyIds, companyInfos, hasMultiple: allCompanyIds.length > 1 }} onChange={setSelectedCompanies} />

      {/* Summary KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--warning-light)' }}>
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4" style={{ color: 'var(--warning)' }} />
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>En attente</span>
          </div>
          <p className="text-3xl font-black" style={{ color: 'var(--warning)' }}>
            {expenses.filter(e => e.status === 'pending').length}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>charges</p>
        </div>
        <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--primary-light)' }}>
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-4 h-4" style={{ color: 'var(--primary)' }} />
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Montant à valider</span>
          </div>
          <p className="text-2xl font-black" style={{ color: 'var(--primary)' }}>{formatCurrency(pendingTotal)}</p>
        </div>
        <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--success-light)' }}>
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-4 h-4" style={{ color: 'var(--success)' }} />
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Validées</span>
          </div>
          <p className="text-3xl font-black" style={{ color: 'var(--success)' }}>
            {expenses.filter(e => e.status === 'validated').length}
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-xl p-4 mb-6 border flex items-center gap-3" style={{ borderColor: 'var(--neutral-200)' }}>
        <Filter className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-secondary)' }} />
        <div className="flex gap-2 flex-wrap">
          {filterButtons.map(btn => (
            <button
              key={btn.key}
              onClick={() => setFilter(btn.key)}
              className="px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
              style={{
                backgroundColor: filter === btn.key ? filterColors[btn.key] : 'transparent',
                color: filter === btn.key ? 'white' : 'var(--text-secondary)',
                border: filter !== btn.key ? '1px solid var(--neutral-300)' : 'none',
              }}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="w-10 h-10 border-4 rounded-full animate-spin mx-auto mb-4"
            style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Chargement...</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border" style={{ borderColor: 'var(--neutral-200)' }}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead style={{ backgroundColor: 'var(--neutral-50)' }}>
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Date</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Bus</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Type</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Description</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Montant</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Créé par</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Justif.</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Statut</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map(expense => {
                  const st = STATUS_META[expense.status] ?? STATUS_META.pending;
                  return (
                    <tr key={expense.id} className="border-t hover:bg-gray-50 transition-colors" style={{ borderColor: 'var(--neutral-100)' }}>
                      <td className="px-4 py-3">
                        <p className="text-sm">{format(new Date(expense.expense_date), 'dd/MM/yyyy')}</p>
                        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          Saisi {format(new Date(expense.created_at), 'dd/MM')}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-sm">{expense.bus?.registration_number ?? '—'}</p>
                        {expense.bus?.model && (
                          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                            {expense.bus.brand} {expense.bus.model}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 rounded text-xs font-medium"
                          style={{ backgroundColor: 'var(--neutral-100)', color: 'var(--text-primary)' }}>
                          {EXPENSE_TYPES[expense.expense_type] ?? expense.expense_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <p className="text-sm truncate" title={expense.description ?? ''}>
                          {expense.description
                            ? expense.description.substring(0, 50) + (expense.description.length > 50 ? '…' : '')
                            : '—'}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <p className="font-bold" style={{ color: 'var(--primary)' }}>
                          {formatCurrency(expense.amount)}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium">{expense.creator?.full_name ?? '—'}</p>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {expense.receipt_url ? (
                          <button
                            onClick={() => window.open(expense.receipt_url!, '_blank')}
                            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                            title="Voir justificatif"
                          >
                            <ExternalLink className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                          </button>
                        ) : (
                          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="px-2 py-1 rounded-full text-xs font-medium"
                          style={{ backgroundColor: st.bg, color: st.color }}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {expense.status === 'pending' ? (
                          <div className="flex gap-1.5 justify-center">
                            <button
                              onClick={() => handleValidate(expense)}
                              disabled={processing}
                              className="px-3 py-1.5 rounded-lg text-white font-medium flex items-center gap-1 text-xs disabled:opacity-50"
                              style={{ backgroundColor: 'var(--success)' }}
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                              Valider
                            </button>
                            <button
                              onClick={() => openRejectModal(expense)}
                              disabled={processing}
                              className="px-3 py-1.5 rounded-lg text-white font-medium flex items-center gap-1 text-xs disabled:opacity-50"
                              style={{ backgroundColor: 'var(--danger)' }}
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              Rejeter
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setSelectedExpense(expense)}
                            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                          >
                            <Eye className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {expenses.length === 0 && (
              <div className="py-12 text-center">
                <CheckCircle className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Aucune charge</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {showRejectModal && rejectionTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-lg w-full">
            <h3 className="font-bold text-xl mb-4">Rejeter la charge</h3>
            <div className="mb-4 p-4 rounded-xl" style={{ backgroundColor: 'var(--neutral-50)' }}>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-semibold">{rejectionTarget.bus?.registration_number ?? '—'}</span>
                <span className="font-black text-lg" style={{ color: 'var(--primary)' }}>
                  {formatCurrency(rejectionTarget.amount)}
                </span>
              </div>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {EXPENSE_TYPES[rejectionTarget.expense_type] ?? rejectionTarget.expense_type}
              </p>
            </div>
            <div className="mb-6">
              <label className="block mb-2 text-sm font-medium">Motif du rejet *</label>
              <textarea
                value={rejectionReason}
                onChange={e => setRejectionReason(e.target.value)}
                className="w-full p-3 border rounded-lg text-sm"
                rows={4}
                placeholder="Indiquez la raison du rejet..."
                style={{ borderColor: 'var(--neutral-300)' }}
                required
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setShowRejectModal(false); setRejectionTarget(null); }}
                disabled={processing}
                className="px-6 py-2.5 rounded-lg border font-medium text-sm"
              >
                Annuler
              </button>
              <button
                onClick={handleReject}
                disabled={processing || !rejectionReason.trim()}
                className="px-6 py-2.5 rounded-lg text-white font-bold text-sm disabled:opacity-50 flex items-center gap-2"
                style={{ backgroundColor: 'var(--danger)' }}
              >
                {processing ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : <XCircle className="w-4 h-4" />}
                Rejeter la charge
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
