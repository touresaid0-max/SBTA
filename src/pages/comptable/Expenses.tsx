import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import {
  Plus, Pencil, Trash2, Search, DollarSign, RefreshCw,
  CheckCircle, XCircle, Eye, ExternalLink, X, Upload
} from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency } from '../../utils/formatCurrency';
import { useAuthStore } from '../../store/authStore';
import { useComptableCompanies } from '../../hooks/useComptableCompanies';
import { CompanyFilterBar } from '../../components/shared/CompanyFilterBar';

interface Bus {
  id: string;
  registration_number: string;
  model: string;
  manufacturer: string | null;
}

interface Expense {
  id: string;
  bus_id: string;
  expense_type: string;
  amount: number;
  description: string | null;
  expense_date: string;
  receipt_url: string | null;
  status: string;
  created_at: string;
  validated_by: string | null;
  bus: Bus | null;
  creator: { full_name: string } | null;
  validator: { full_name: string } | null;
}

const EXPENSE_TYPES = [
  { value: 'assurance',        label: 'Assurance' },
  { value: 'taxes',            label: 'Taxes' },
  { value: 'peage',            label: 'Péage' },
  { value: 'lavage',           label: 'Lavage' },
  { value: 'vignette',         label: 'Vignette' },
  { value: 'visite_technique', label: 'Visite technique' },
  { value: 'parking',          label: 'Parking' },
  { value: 'amende',           label: 'Amende' },
  { value: 'taxe_route',       label: 'Taxe route' },
  { value: 'carburant',        label: 'Carburant' },
  { value: 'reparation',       label: 'Réparation' },
  { value: 'autres',           label: 'Autres' },
  { value: 'autre',            label: 'Autre' },
];

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  pending:   { label: 'En attente', color: 'var(--warning)', bg: 'var(--warning-light)' },
  validated: { label: 'Validée',    color: 'var(--success)', bg: 'var(--success-light)' },
  rejected:  { label: 'Rejetée',    color: 'var(--danger)',  bg: 'var(--danger-light)' },
};

const EMPTY_FORM = {
  bus_id: '',
  expense_type: '',
  amount: 0,
  description: '',
  expense_date: format(new Date(), 'yyyy-MM-dd'),
  receipt_url: '',
};

export default function ComptableExpenses() {
  const { user } = useAuthStore();
  const { allowedCompanyIds, companyInfos } = useComptableCompanies();
  const allCompanyIds = allowedCompanyIds ?? (user?.company_id ? [user.company_id] : []);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const companyIds = selectedCompanies.length > 0 ? selectedCompanies : allCompanyIds;
  const [loading, setLoading] = useState(true);
  const [buses, setBuses] = useState<Bus[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<Expense | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    loadData();
  }, [companyIds]);

  const loadData = async () => {
    try {
      setLoading(true);

      let busQuery = supabase
        .from('buses')
        .select('id, registration_number, model, manufacturer')
        .order('registration_number');

      if (companyIds.length > 0) busQuery = busQuery.in('company_id', companyIds);

      const busRes = await busQuery;
      if (busRes.error) throw busRes.error;
      setBuses((busRes.data ?? []) as any[]);

      const busIds = (busRes.data ?? []).map(b => b.id);

      let expQuery = supabase
        .from('bus_expenses')
        .select(`
          id, bus_id, expense_type, amount, description,
          expense_date, receipt_url, status, created_at, validated_by, created_by,
          bus:buses!bus_id ( id, registration_number, model, manufacturer ),
          creator:users!created_by ( full_name ),
          validator:users!validated_by ( full_name )
        `)
        .order('expense_date', { ascending: false });

      if (companyIds.length > 0 && busIds.length > 0) expQuery = expQuery.in('bus_id', busIds);
      else if (companyIds.length > 0 && busIds.length === 0) {
        setExpenses([]);
        setLoading(false);
        return;
      }

      const expRes = await expQuery;
      if (expRes.error) throw expRes.error;
      setExpenses((expRes.data ?? []) as any[]);
    } catch (err: any) {
      toast.error('Erreur de chargement');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const openAdd = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setShowModal(true);
  };

  const openEdit = (exp: Expense) => {
    setEditing(exp);
    setForm({
      bus_id: exp.bus_id,
      expense_type: exp.expense_type,
      amount: exp.amount,
      description: exp.description ?? '',
      expense_date: exp.expense_date,
      receipt_url: exp.receipt_url ?? '',
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.bus_id || !form.expense_type || form.amount <= 0) {
      toast.error('Veuillez remplir tous les champs obligatoires');
      return;
    }
    try {
      setSubmitting(true);
      const payload = {
        bus_id: form.bus_id,
        expense_type: form.expense_type,
        amount: form.amount,
        description: form.description || null,
        expense_date: form.expense_date,
        receipt_url: form.receipt_url || null,
        status: 'en_attente',
      };

      if (editing) {
        const { error } = await supabase
          .from('bus_expenses')
          .update(payload)
          .eq('id', editing.id);
        if (error) throw error;
        toast.success('Charge modifiée');
      } else {
        const { error } = await supabase
          .from('bus_expenses')
          .insert({ ...payload, created_by: user?.id });
        if (error) throw error;
        toast.success('Charge ajoutée et envoyée en validation');
      }
      setShowModal(false);
      loadData();
    } catch (err: any) {
      toast.error("Erreur lors de l'enregistrement");
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer cette charge ?')) return;
    try {
      const { error } = await supabase.from('bus_expenses').delete().eq('id', id);
      if (error) throw error;
      toast.success('Charge supprimée');
      loadData();
    } catch (err: any) {
      toast.error('Erreur lors de la suppression');
    }
  };

  const handleValidate = async (exp: Expense) => {
    if (!confirm(`Valider la charge de ${formatCurrency(exp.amount)} ?`)) return;
    try {
      setProcessing(true);
      const { error } = await supabase
        .from('bus_expenses')
        .update({ status: 'validated', validated_by: user?.id })
        .eq('id', exp.id);
      if (error) throw error;
      toast.success('Charge validée');
      loadData();
    } catch (err: any) {
      toast.error('Erreur lors de la validation');
    } finally {
      setProcessing(false);
    }
  };

  const openReject = (exp: Expense) => {
    setRejectTarget(exp);
    setRejectionReason('');
    setShowRejectModal(true);
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    if (!rejectionReason.trim()) { toast.error('Veuillez indiquer le motif'); return; }
    try {
      setProcessing(true);
      const { error } = await supabase
        .from('bus_expenses')
        .update({ status: 'rejected', validated_by: user?.id })
        .eq('id', rejectTarget.id);
      if (error) throw error;
      toast.success('Charge rejetée');
      setShowRejectModal(false);
      setRejectTarget(null);
      loadData();
    } catch (err: any) {
      toast.error('Erreur lors du rejet');
    } finally {
      setProcessing(false);
    }
  };

  const filtered = expenses.filter(e => {
    const busLabel = e.bus?.registration_number?.toLowerCase() ?? '';
    const desc = e.description?.toLowerCase() ?? '';
    const q = search.toLowerCase();
    if (search && !busLabel.includes(q) && !desc.includes(q)) return false;
    if (filterType && e.expense_type !== filterType) return false;
    if (filterStatus && e.status !== filterStatus) return false;
    return true;
  });

  const pendingCount = expenses.filter(e => e.status === 'pending').length;
  const pendingTotal = expenses.filter(e => e.status === 'pending').reduce((s, e) => s + Number(e.amount), 0);
  const validatedTotal = expenses.filter(e => e.status === 'validated').reduce((s, e) => s + Number(e.amount), 0);

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
            Charges bus
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>Gestion des charges et dépenses des bus</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={loadData}
            disabled={loading}
            className="px-4 py-2.5 rounded-lg border flex items-center gap-2 text-sm hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Actualiser
          </button>
          <button
            onClick={openAdd}
            className="px-5 py-2.5 rounded-lg text-white font-bold flex items-center gap-2"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            <Plus className="w-5 h-5" />
            Nouvelle charge
          </button>
        </div>
      </div>

      <CompanyFilterBar filter={{ allCompanyIds, selectedCompanyIds: companyIds, companyInfos, hasMultiple: allCompanyIds.length > 1 }} onChange={setSelectedCompanies} />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total charges', value: expenses.length, isCount: true, color: 'var(--primary)', bg: 'var(--primary-light)' },
          { label: 'En attente', value: pendingCount, isCount: true, color: 'var(--warning)', bg: 'var(--warning-light)' },
          { label: 'Montant en attente', value: pendingTotal, isCount: false, color: 'var(--warning)', bg: 'var(--warning-light)' },
          { label: 'Montant validé', value: validatedTotal, isCount: false, color: 'var(--success)', bg: 'var(--success-light)' },
        ].map(k => (
          <div key={k.label} className="rounded-xl p-5" style={{ backgroundColor: k.bg }}>
            <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>{k.label}</p>
            <p className="text-xl font-black" style={{ color: k.color }}>
              {k.isCount ? k.value : formatCurrency(k.value as number)}
            </p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl p-4 mb-6 border" style={{ borderColor: 'var(--neutral-200)' }}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher..."
              className="w-full pl-9 pr-4 py-2 border rounded-lg text-sm"
              style={{ borderColor: 'var(--neutral-300)' }}
            />
          </div>
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="px-3 py-2 border rounded-lg text-sm"
            style={{ borderColor: 'var(--neutral-300)' }}
          >
            <option value="">Tous types</option>
            {EXPENSE_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="px-3 py-2 border rounded-lg text-sm"
            style={{ borderColor: 'var(--neutral-300)' }}
          >
            <option value="">Tous statuts</option>
            <option value="pending">En attente</option>
            <option value="validated">Validée</option>
            <option value="rejected">Rejetée</option>
          </select>
        </div>
      </div>

      {/* Table */}
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
                  <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Justif.</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Statut</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(exp => {
                  const st = STATUS_META[exp.status] ?? STATUS_META.pending;
                  const typeLabel = EXPENSE_TYPES.find(t => t.value === exp.expense_type)?.label ?? exp.expense_type;
                  return (
                    <tr key={exp.id} className="border-t hover:bg-gray-50 transition-colors" style={{ borderColor: 'var(--neutral-100)' }}>
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium">{format(new Date(exp.expense_date), 'dd/MM/yyyy')}</p>
                        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          {format(new Date(exp.created_at), 'dd/MM HH:mm')}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-bold text-sm">{exp.bus?.registration_number ?? '—'}</p>
                        {exp.bus?.model && (
                          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                            {exp.bus.manufacturer} {exp.bus.model}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 rounded text-xs font-medium"
                          style={{ backgroundColor: 'var(--neutral-100)', color: 'var(--text-primary)' }}>
                          {typeLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <p className="text-sm truncate" title={exp.description ?? ''}>
                          {exp.description ? exp.description.substring(0, 55) + (exp.description.length > 55 ? '…' : '') : '—'}
                        </p>
                        {exp.creator && (
                          <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                            par {exp.creator.full_name}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <p className="font-black" style={{ color: 'var(--primary)' }}>{formatCurrency(exp.amount)}</p>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {exp.receipt_url ? (
                          <button
                            onClick={() => window.open(exp.receipt_url!, '_blank')}
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
                        {exp.validator && exp.status !== 'pending' && (
                          <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                            {exp.validator.full_name}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5 items-center justify-center flex-wrap">
                          <button
                            onClick={() => setSelectedExpense(exp)}
                            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                            title="Détails"
                          >
                            <Eye className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                          </button>
                          {exp.status === 'pending' && (
                            <>
                              <button
                                onClick={() => openEdit(exp)}
                                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                                title="Modifier"
                              >
                                <Pencil className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                              </button>
                              <button
                                onClick={() => handleValidate(exp)}
                                disabled={processing}
                                className="p-1.5 rounded-lg hover:bg-green-50 transition-colors"
                                title="Valider"
                              >
                                <CheckCircle className="w-4 h-4" style={{ color: 'var(--success)' }} />
                              </button>
                              <button
                                onClick={() => openReject(exp)}
                                disabled={processing}
                                className="p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                                title="Rejeter"
                              >
                                <XCircle className="w-4 h-4" style={{ color: 'var(--danger)' }} />
                              </button>
                              <button
                                onClick={() => handleDelete(exp.id)}
                                className="p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                                title="Supprimer"
                              >
                                <Trash2 className="w-4 h-4" style={{ color: 'var(--danger)' }} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="py-14 text-center">
                <DollarSign className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p className="font-semibold mb-1">
                  {expenses.length === 0 ? 'Aucune charge trouvée' : 'Aucun résultat'}
                </p>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {expenses.length === 0 ? 'Ajoutez votre première charge' : 'Modifiez les filtres'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-bold text-xl">
                {editing ? 'Modifier la charge' : 'Nouvelle charge'}
              </h3>
              <button onClick={() => setShowModal(false)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1.5 text-sm font-medium">Bus *</label>
                  <select
                    value={form.bus_id}
                    onChange={e => setForm({ ...form, bus_id: e.target.value })}
                    className="w-full p-3 border rounded-lg text-sm"
                    style={{ borderColor: 'var(--neutral-300)' }}
                    required
                  >
                    <option value="">Sélectionner un bus</option>
                    {buses.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.registration_number} — {b.model}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block mb-1.5 text-sm font-medium">Type de charge *</label>
                  <select
                    value={form.expense_type}
                    onChange={e => setForm({ ...form, expense_type: e.target.value })}
                    className="w-full p-3 border rounded-lg text-sm"
                    style={{ borderColor: 'var(--neutral-300)' }}
                    required
                  >
                    <option value="">Sélectionner un type</option>
                    {EXPENSE_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block mb-1.5 text-sm font-medium">Montant (FCFA) *</label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={form.amount}
                    onChange={e => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })}
                    className="w-full p-3 border rounded-lg text-sm"
                    style={{ borderColor: 'var(--neutral-300)' }}
                    required
                  />
                </div>

                <div>
                  <label className="block mb-1.5 text-sm font-medium">Date de la charge *</label>
                  <input
                    type="date"
                    value={form.expense_date}
                    onChange={e => setForm({ ...form, expense_date: e.target.value })}
                    className="w-full p-3 border rounded-lg text-sm"
                    style={{ borderColor: 'var(--neutral-300)' }}
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block mb-1.5 text-sm font-medium">Description *</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  className="w-full p-3 border rounded-lg text-sm"
                  style={{ borderColor: 'var(--neutral-300)' }}
                  rows={3}
                  required
                  placeholder="Détails de la charge..."
                />
              </div>

              <div>
                <label className="block mb-1.5 text-sm font-medium">
                  <div className="flex items-center gap-2">
                    <Upload className="w-4 h-4" />
                    Lien justificatif (URL)
                  </div>
                </label>
                <input
                  type="url"
                  value={form.receipt_url}
                  onChange={e => setForm({ ...form, receipt_url: e.target.value })}
                  className="w-full p-3 border rounded-lg text-sm"
                  style={{ borderColor: 'var(--neutral-300)' }}
                  placeholder="https://..."
                />
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-6 py-2.5 rounded-lg border font-medium text-sm"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2.5 rounded-lg text-white font-bold text-sm flex items-center gap-2 disabled:opacity-60"
                  style={{ backgroundColor: 'var(--primary)' }}
                >
                  {submitting && (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  )}
                  {editing ? 'Modifier' : 'Ajouter'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {selectedExpense && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-lg w-full">
            <div className="p-5 border-b flex justify-between items-center" style={{ borderColor: 'var(--neutral-200)' }}>
              <h3 className="font-bold text-lg">Détail de la charge</h3>
              <button onClick={() => setSelectedExpense(null)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Bus</p>
                  <p className="font-bold">{selectedExpense.bus?.registration_number ?? '—'}</p>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {selectedExpense.bus?.manufacturer} {selectedExpense.bus?.model}
                  </p>
                </div>
                <div>
                  <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Type</p>
                  <p className="font-semibold">
                    {EXPENSE_TYPES.find(t => t.value === selectedExpense.expense_type)?.label ?? selectedExpense.expense_type}
                  </p>
                </div>
                <div>
                  <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Date de la charge</p>
                  <p className="font-semibold">{format(new Date(selectedExpense.expense_date), 'dd/MM/yyyy')}</p>
                </div>
                <div>
                  <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Montant</p>
                  <p className="font-black text-lg" style={{ color: 'var(--primary)' }}>
                    {formatCurrency(selectedExpense.amount)}
                  </p>
                </div>
                {selectedExpense.creator && (
                  <div>
                    <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Créé par</p>
                    <p className="font-medium">{selectedExpense.creator.full_name}</p>
                  </div>
                )}
                {selectedExpense.validator && (
                  <div>
                    <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Traité par</p>
                    <p className="font-medium">{selectedExpense.validator.full_name}</p>
                  </div>
                )}
              </div>
              {selectedExpense.description && (
                <div>
                  <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Description</p>
                  <p className="text-sm p-3 rounded-lg" style={{ backgroundColor: 'var(--neutral-50)' }}>
                    {selectedExpense.description}
                  </p>
                </div>
              )}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Statut</p>
                  <span className="px-3 py-1 rounded-full text-sm font-medium"
                    style={{
                      backgroundColor: STATUS_META[selectedExpense.status]?.bg,
                      color: STATUS_META[selectedExpense.status]?.color,
                    }}>
                    {STATUS_META[selectedExpense.status]?.label ?? selectedExpense.status}
                  </span>
                </div>
                {selectedExpense.receipt_url && (
                  <button
                    onClick={() => window.open(selectedExpense.receipt_url!, '_blank')}
                    className="px-4 py-2 rounded-lg border flex items-center gap-2 text-sm hover:bg-gray-50"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Voir justificatif
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {showRejectModal && rejectTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full">
            <h3 className="font-bold text-xl mb-4">Rejeter la charge</h3>
            <div className="p-4 rounded-xl mb-5" style={{ backgroundColor: 'var(--neutral-50)' }}>
              <div className="flex justify-between items-center">
                <span className="font-semibold text-sm">{rejectTarget.bus?.registration_number ?? '—'}</span>
                <span className="font-black" style={{ color: 'var(--primary)' }}>{formatCurrency(rejectTarget.amount)}</span>
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                {EXPENSE_TYPES.find(t => t.value === rejectTarget.expense_type)?.label}
              </p>
            </div>
            <div className="mb-5">
              <label className="block mb-2 text-sm font-medium">Motif du rejet *</label>
              <textarea
                value={rejectionReason}
                onChange={e => setRejectionReason(e.target.value)}
                className="w-full p-3 border rounded-lg text-sm"
                rows={4}
                placeholder="Indiquez la raison..."
                style={{ borderColor: 'var(--neutral-300)' }}
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setShowRejectModal(false); setRejectTarget(null); }}
                disabled={processing}
                className="px-5 py-2.5 rounded-lg border font-medium text-sm"
              >
                Annuler
              </button>
              <button
                onClick={handleReject}
                disabled={processing || !rejectionReason.trim()}
                className="px-5 py-2.5 rounded-lg text-white font-bold text-sm flex items-center gap-2 disabled:opacity-50"
                style={{ backgroundColor: 'var(--danger)' }}
              >
                {processing && (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                Rejeter
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
