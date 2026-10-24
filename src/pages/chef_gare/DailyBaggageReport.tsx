import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../store/authStore';
import { loadChefGareScope } from '../../utils/chefGareScope';
import { formatCurrency } from '../../utils/formatCurrency';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Calendar, Plus, Trash2, Lock, FileText, Printer, AlertCircle,
  TrendingUp, TrendingDown, Scale, Package, CheckCircle2, Info
} from 'lucide-react';
import toast from 'react-hot-toast';

interface BaggageRow {
  id: string;
  baggage_number: string;
  destination: string;
  price: number;
  owner_name: string;
  has_ticket: boolean;
}

interface ExpenseRow {
  id: string;
  category: string;
  detail: string | null;
  amount: number;
}

interface ReportData {
  id: string;
  station_id: string;
  report_date: string;
  baggage_revenue: number;
  baggage_count: number;
  total_expenses: number;
  balance: number;
  validated: boolean;
  validated_at: string | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  ration: 'Ration',
  cie: 'CIE',
  sodeci_eau: 'SODECI / Eau',
  wifi_internet: 'Wi-Fi / Internet',
  carburant: 'Carburant',
  autre: 'Autre dépense',
};

const CATEGORY_ICONS: Record<string, string> = {
  ration: ' Utensils',
  cie: ' Zap',
  sodeci_eau: ' Droplet',
  wifi_internet: ' Wifi',
  carburant: ' Fuel',
  autre: ' MoreHorizontal',
};

export default function DailyBaggageReport() {
  const { user } = useAuthStore();
  const [stationId, setStationId] = useState<string | null>(null);
  const [stationName, setStationName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [report, setReport] = useState<ReportData | null>(null);
  const [baggageRows, setBaggageRows] = useState<BaggageRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [addingExpense, setAddingExpense] = useState(false);
  const [newExpense, setNewExpense] = useState({ category: 'ration', detail: '', amount: 0 });
  const [validating, setValidating] = useState(false);

  const isLocked = report?.validated === true;

  const loadStation = useCallback(async () => {
    if (!user?.id) return;
    const scope = await loadChefGareScope(user.id);
    if (!scope.stationId) {
      toast.error('Aucune gare assignée à votre profil');
      setLoading(false);
      return;
    }
    setStationId(scope.stationId);
    const { data: st } = await supabase
      .from('stations')
      .select('name')
      .eq('id', scope.stationId)
      .maybeSingle();
    setStationName(st?.name ?? '');
  }, [user?.id]);

  const loadReport = useCallback(async () => {
    if (!stationId) return;
    setLoading(true);
    try {
      // Fetch or create report for this date
      const { data: existing } = await supabase
        .from('station_daily_reports')
        .select('*')
        .eq('station_id', stationId)
        .eq('report_date', selectedDate)
        .maybeSingle();

      let reportId = existing?.id;

      // Fetch baggage revenue for the day
      const dayStart = new Date(`${selectedDate}T00:00:00`);
      const dayEnd = new Date(`${selectedDate}T23:59:59`);
      const { data: baggages } = await supabase
        .from('baggage_tickets')
        .select('id, baggage_number, destination, price, owner_name, has_ticket, payment_status')
        .eq('station_id', stationId)
        .eq('payment_status', 'paye')
        .gte('created_at', dayStart.toISOString())
        .lte('created_at', dayEnd.toISOString())
        .order('created_at', { ascending: false });

      const baggageRevenue = (baggages ?? []).reduce((s, b) => s + (b.price || 0), 0);
      const baggageCount = baggages?.length ?? 0;

      if (!existing) {
        // Create new report
        const { data: created, error } = await supabase
          .from('station_daily_reports')
          .insert({
            station_id: stationId,
            report_date: selectedDate,
            baggage_revenue: baggageRevenue,
            baggage_count: baggageCount,
            total_expenses: 0,
            balance: baggageRevenue,
            created_by: user!.id,
          })
          .select()
          .single();
        if (error) throw error;
        reportId = created.id;
        setReport(created);
      } else {
        // Update revenue from live data
        const { data: updated } = await supabase
          .from('station_daily_reports')
          .update({
            baggage_revenue: baggageRevenue,
            baggage_count: baggageCount,
            balance: baggageRevenue - (existing.total_expenses || 0),
          })
          .eq('id', existing.id)
          .select()
          .maybeSingle();
        setReport(updated ?? existing);
      }

      setBaggageRows(baggages ?? []);

      // Fetch expenses
      if (reportId) {
        const { data: exp } = await supabase
          .from('station_daily_expenses')
          .select('*')
          .eq('report_id', reportId)
          .order('created_at', { ascending: true });
        setExpenses(exp ?? []);
      }
    } catch (err: any) {
      toast.error(err?.message ?? 'Erreur lors du chargement du rapport');
    } finally {
      setLoading(false);
    }
  }, [stationId, selectedDate, user?.id]);

  useEffect(() => { loadStation(); }, [loadStation]);
  useEffect(() => { if (stationId) loadReport(); }, [loadReport, stationId]);

  const handleAddExpense = async () => {
    if (!report) return;
    if (newExpense.category === 'autre' && !newExpense.detail.trim()) {
      toast.error('Le détail est obligatoire pour « Autre dépense »');
      return;
    }
    if (newExpense.amount <= 0) {
      toast.error('Le montant doit être supérieur à 0');
      return;
    }
    try {
      const { data, error } = await supabase
        .from('station_daily_expenses')
        .insert({
          report_id: report.id,
          category: newExpense.category,
          detail: newExpense.detail.trim() || null,
          amount: newExpense.amount,
        })
        .select()
        .single();
      if (error) throw error;
      setExpenses(prev => [...prev, data]);
      setNewExpense({ category: 'ration', detail: '', amount: 0 });
      setAddingExpense(false);
      toast.success('Dépense ajoutée');
      loadReport();
    } catch (err: any) {
      toast.error(err?.message ?? 'Erreur lors de l\'ajout');
    }
  };

  const handleDeleteExpense = async (expenseId: string) => {
    if (isLocked) return;
    try {
      const { error } = await supabase
        .from('station_daily_expenses')
        .delete()
        .eq('id', expenseId);
      if (error) throw error;
      setExpenses(prev => prev.filter(e => e.id !== expenseId));
      toast.success('Dépense supprimée');
      loadReport();
    } catch (err: any) {
      toast.error(err?.message ?? 'Erreur lors de la suppression');
    }
  };

  const handleValidate = async () => {
    if (!report) return;
    setValidating(true);
    try {
      // Recompute final revenue from live data
      const dayStart = new Date(`${selectedDate}T00:00:00`);
      const dayEnd = new Date(`${selectedDate}T23:59:59`);
      const { data: baggages } = await supabase
        .from('baggage_tickets')
        .select('price, payment_status')
        .eq('station_id', stationId)
        .eq('payment_status', 'paye')
        .gte('created_at', dayStart.toISOString())
        .lte('created_at', dayEnd.toISOString());
      const finalRevenue = (baggages ?? []).reduce((s, b) => s + (b.price || 0), 0);
      const finalCount = baggages?.length ?? 0;

      const { error } = await supabase
        .from('station_daily_reports')
        .update({
          validated: true,
          validated_by: user!.id,
          validated_at: new Date().toISOString(),
          baggage_revenue: finalRevenue,
          baggage_count: finalCount,
          balance: finalRevenue - (report.total_expenses || 0),
        })
        .eq('id', report.id);
      if (error) throw error;
      toast.success('Journée validée — les données sont désormais verrouillées');
      loadReport();
    } catch (err: any) {
      toast.error(err?.message ?? 'Erreur lors de la validation');
    } finally {
      setValidating(false);
    }
  };

  const handlePrint = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    const totalRevenue = report?.baggage_revenue ?? 0;
    const totalExp = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    const balance = totalRevenue - totalExp;
    const expByCat: Record<string, number> = {};
    expenses.forEach(e => {
      expByCat[e.category] = (expByCat[e.category] || 0) + (e.amount || 0);
    });

    win.document.write(`
      <!DOCTYPE html><html><head><meta charset="utf-8">
      <title>Rapport Bagage — ${stationName} — ${format(new Date(selectedDate), 'dd/MM/yyyy', { locale: fr })}</title>
      <style>
        * { font-family: Arial, sans-serif; font-size: 12px; color: #000; }
        body { margin: 20px; }
        h1 { font-size: 18px; text-align: center; }
        h2 { font-size: 14px; border-bottom: 2px solid #000; padding-bottom: 4px; margin-top: 20px; }
        table { width: 100%; border-collapse: collapse; margin: 8px 0; }
        th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
        th { background: #f5f5f5; font-weight: bold; }
        .right { text-align: right; }
        .total-row td { font-weight: bold; background: #f0f0f0; }
        .header { text-align: center; margin-bottom: 10px; }
        .header .station { font-size: 16px; font-weight: bold; }
        .header .date { font-size: 13px; }
        .status { text-align: center; font-weight: bold; padding: 6px; border: 2px solid; margin: 10px 0; }
        .status.validated { border-color: #16a34a; color: #16a34a; }
        .status.pending { border-color: #f59e0b; color: #f59e0b; }
        .summary { display: flex; justify-content: space-between; margin: 15px 0; }
        .summary div { flex: 1; text-align: center; border: 1px solid #ccc; padding: 10px; margin: 0 5px; }
        .summary .label { font-size: 11px; color: #666; }
        .summary .value { font-size: 16px; font-weight: bold; margin-top: 4px; }
        @media print { body { margin: 10px; } }
      </style></head><body>
        <div class="header">
          <div class="station">SBTA — ${stationName}</div>
          <div class="date">Rapport Bagage du ${format(new Date(selectedDate), 'dd/MM/yyyy', { locale: fr })}</div>
        </div>
        <div class="status ${isLocked ? 'validated' : 'pending'}">
          ${isLocked ? 'JOURNÉE VALIDÉE' : 'JOURNÉE NON VALIDÉE'}
        </div>

        <h2>Recettes Bagages du Jour</h2>
        <table>
          <thead><tr><th>N° Bagage</th><th>Destination</th><th>Propriétaire</th><th>Type</th><th class="right">Prix</th></tr></thead>
          <tbody>
            ${baggageRows.length === 0 ? '<tr><td colspan="5" style="text-align:center;">Aucune recette bagage pour cette date</td></tr>' : ''}
            ${baggageRows.map(b => `
              <tr>
                <td>${b.baggage_number}</td>
                <td>${b.destination}</td>
                <td>${b.owner_name}</td>
                <td>${b.has_ticket ? 'Avec ticket' : 'Sans siège'}</td>
                <td class="right">${formatCurrency(b.price)}</td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr class="total-row">
              <td colspan="4">Total recettes (${baggageRows.length} bagage${baggageRows.length > 1 ? 's' : ''})</td>
              <td class="right">${formatCurrency(totalRevenue)}</td>
            </tr>
          </tfoot>
        </table>

        <h2>Dépenses du Jour</h2>
        <table>
          <thead><tr><th>Catégorie</th><th>Détail</th><th class="right">Montant</th></tr></thead>
          <tbody>
            ${expenses.length === 0 ? '<tr><td colspan="3" style="text-align:center;">Aucune dépense enregistrée</td></tr>' : ''}
            ${expenses.map(e => `
              <tr>
                <td>${CATEGORY_LABELS[e.category] || e.category}</td>
                <td>${e.detail || '—'}</td>
                <td class="right">${formatCurrency(e.amount)}</td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr class="total-row">
              <td colspan="2">Total dépenses</td>
              <td class="right">${formatCurrency(totalExp)}</td>
            </tr>
          </tfoot>
        </table>

        <h2>Synthèse</h2>
        <div class="summary">
          <div>
            <div class="label">Recette du jour</div>
            <div class="value">${formatCurrency(totalRevenue)}</div>
          </div>
          <div>
            <div class="label">Total dépenses</div>
            <div class="value">${formatCurrency(totalExp)}</div>
          </div>
          <div>
            <div class="label">Solde du jour</div>
            <div class="value">${formatCurrency(balance)}</div>
          </div>
        </div>

        <p style="text-align:center; margin-top:30px; font-size:10px; color:#999;">
          SBTA — Rapport généré le ${format(new Date(), 'dd/MM/yyyy à HH:mm', { locale: fr })}
        </p>
      </body></html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 500);
  };

  const totalRevenue = report?.baggage_revenue ?? 0;
  const totalExp = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const balance = totalRevenue - totalExp;

  const cardClass = 'rounded-xl p-4 flex items-center gap-3';
  const cardIconClass = 'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0';

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Rapport Bagage Journalier
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {stationName} — Recettes et dépenses bagages
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              disabled={isLocked}
              className="px-3 py-2 rounded-lg border-2 text-sm outline-none"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
            />
          </div>
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm text-white transition-colors"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            <Printer className="w-4 h-4" /> Imprimer
          </button>
        </div>
      </div>

      {/* Validation status banner */}
      {isLocked && (
        <div className="rounded-xl p-3 flex items-center gap-2 text-sm font-bold" style={{ backgroundColor: 'var(--success-light, #dcfce7)', color: 'var(--success, #16a34a)', border: '1px solid var(--success, #16a34a)' }}>
          <Lock className="w-4 h-4" /> Journée validée — données verrouillées. Pour toute modification, utilisez la procédure de Demande de modification.
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8" style={{ borderTop: '3px solid var(--primary)' }} />
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className={cardClass} style={{ backgroundColor: 'var(--success-light, #dcfce7)', border: '1px solid var(--success, #16a34a)' }}>
              <div className={cardIconClass} style={{ backgroundColor: 'var(--success, #16a34a)' }}>
                <TrendingUp className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Recette du jour</p>
                <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(totalRevenue)}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{baggageRows.length} bagage{baggageRows.length > 1 ? 's' : ''}</p>
              </div>
            </div>

            <div className={cardClass} style={{ backgroundColor: 'var(--danger-light, #fef2f2)', border: '1px solid var(--danger, #ef4444)' }}>
              <div className={cardIconClass} style={{ backgroundColor: 'var(--danger, #ef4444)' }}>
                <TrendingDown className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Total dépenses</p>
                <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(totalExp)}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{expenses.length} dépense{expenses.length > 1 ? 's' : ''}</p>
              </div>
            </div>

            <div className={cardClass} style={{ backgroundColor: balance >= 0 ? 'var(--primary-light, #e0e7ff)' : 'var(--danger-light, #fef2f2)', border: '1px solid ' + (balance >= 0 ? 'var(--primary)' : 'var(--danger, #ef4444)') }}>
              <div className={cardIconClass} style={{ backgroundColor: balance >= 0 ? 'var(--primary)' : 'var(--danger, #ef4444)' }}>
                <Scale className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Solde du jour</p>
                <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(balance)}</p>
              </div>
            </div>
          </div>

          {/* Baggage recettes */}
          <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border)' }}>
              <Package className="w-5 h-5" style={{ color: 'var(--success, #16a34a)' }} />
              <h2 className="font-bold" style={{ color: 'var(--text-primary)' }}>Recettes bagages — {format(new Date(selectedDate), 'dd/MM/yyyy', { locale: fr })}</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)' }}>
                    <th className="px-4 py-2 text-left text-xs font-bold" style={{ color: 'var(--text-muted)' }}>N° Bagage</th>
                    <th className="px-4 py-2 text-left text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Destination</th>
                    <th className="px-4 py-2 text-left text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Propriétaire</th>
                    <th className="px-4 py-2 text-left text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Type</th>
                    <th className="px-4 py-2 text-right text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Prix</th>
                  </tr>
                </thead>
                <tbody>
                  {baggageRows.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Aucune recette bagage pour cette date</td></tr>
                  ) : (
                    baggageRows.map(b => (
                      <tr key={b.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td className="px-4 py-2 text-sm font-mono" style={{ color: 'var(--text-primary)' }}>{b.baggage_number}</td>
                        <td className="px-4 py-2 text-sm" style={{ color: 'var(--text-primary)' }}>{b.destination}</td>
                        <td className="px-4 py-2 text-sm" style={{ color: 'var(--text-primary)' }}>{b.owner_name}</td>
                        <td className="px-4 py-2 text-sm">
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold" style={{
                            backgroundColor: b.has_ticket ? 'var(--success-light, #dcfce7)' : 'var(--warning-light, #fef3c7)',
                            color: b.has_ticket ? 'var(--success, #16a34a)' : 'var(--warning, #d97706)',
                          }}>
                            {b.has_ticket ? 'Avec ticket' : 'Sans siège'}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-sm font-bold text-right" style={{ color: 'var(--text-primary)' }}>{formatCurrency(b.price)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {baggageRows.length > 0 && (
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--border)' }}>
                      <td colSpan={4} className="px-4 py-3 text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>Total recettes</td>
                      <td className="px-4 py-3 text-sm font-bold text-right" style={{ color: 'var(--success, #16a34a)' }}>{formatCurrency(totalRevenue)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* Dépenses */}
          <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="flex items-center gap-2">
                <TrendingDown className="w-5 h-5" style={{ color: 'var(--danger, #ef4444)' }} />
                <h2 className="font-bold" style={{ color: 'var(--text-primary)' }}>Dépenses du jour</h2>
              </div>
              {!isLocked && (
                <button
                  onClick={() => setAddingExpense(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors"
                  style={{ backgroundColor: 'var(--primary-light, #e0e7ff)', color: 'var(--primary)', border: '1px solid var(--primary)' }}
                >
                  <Plus className="w-4 h-4" /> Ajouter
                </button>
              )}
            </div>

            {/* Add expense form */}
            {addingExpense && !isLocked && (
              <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-12 gap-3" style={{ borderBottom: '1px solid var(--border)', backgroundColor: 'var(--surface-2, #f9fafb)' }}>
                <div className="sm:col-span-3">
                  <label className="block text-xs font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>Catégorie</label>
                  <select
                    value={newExpense.category}
                    onChange={e => setNewExpense(prev => ({ ...prev, category: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border-2 text-sm outline-none"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
                  >
                    {Object.entries(CATEGORY_LABELS).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-5">
                  <label className="block text-xs font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>
                    Détail {newExpense.category === 'autre' && <span style={{ color: 'var(--danger, #ef4444)' }}>* obligatoire</span>}
                  </label>
                  <input
                    type="text"
                    value={newExpense.detail}
                    onChange={e => setNewExpense(prev => ({ ...prev, detail: e.target.value }))}
                    placeholder={newExpense.category === 'autre' ? 'Achat ampoules, réparation serrure...' : 'Détail (optionnel)'}
                    className="w-full px-3 py-2 rounded-lg border-2 text-sm outline-none"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>Montant (FCFA)</label>
                  <input
                    type="number"
                    min={0}
                    value={newExpense.amount || ''}
                    onChange={e => setNewExpense(prev => ({ ...prev, amount: parseInt(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 rounded-lg border-2 text-sm outline-none"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div className="sm:col-span-2 flex items-end gap-2">
                  <button
                    onClick={handleAddExpense}
                    className="flex-1 py-2 rounded-lg font-bold text-sm text-white"
                    style={{ backgroundColor: 'var(--success, #16a34a)' }}
                  >
                    Enregistrer
                  </button>
                  <button
                    onClick={() => { setAddingExpense(false); setNewExpense({ category: 'ration', detail: '', amount: 0 }); }}
                    className="px-3 py-2 rounded-lg font-bold text-sm"
                    style={{ backgroundColor: 'var(--surface-2, #f5f5f5)', color: 'var(--text-muted)' }}
                  >
                    Annuler
                  </button>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)' }}>
                    <th className="px-4 py-2 text-left text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Catégorie</th>
                    <th className="px-4 py-2 text-left text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Détail</th>
                    <th className="px-4 py-2 text-right text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Montant</th>
                    {!isLocked && <th className="px-4 py-2"></th>}
                  </tr>
                </thead>
                <tbody>
                  {expenses.length === 0 ? (
                    <tr><td colSpan={isLocked ? 3 : 4} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Aucune dépense enregistrée</td></tr>
                  ) : (
                    expenses.map(e => (
                      <tr key={e.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td className="px-4 py-2 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{CATEGORY_LABELS[e.category] || e.category}</td>
                        <td className="px-4 py-2 text-sm" style={{ color: 'var(--text-secondary)' }}>{e.detail || '—'}</td>
                        <td className="px-4 py-2 text-sm font-bold text-right" style={{ color: 'var(--text-primary)' }}>{formatCurrency(e.amount)}</td>
                        {!isLocked && (
                          <td className="px-4 py-2 text-right">
                            <button
                              onClick={() => handleDeleteExpense(e.id)}
                              className="p-1.5 rounded-lg transition-colors hover:bg-red-50"
                              style={{ color: 'var(--danger, #ef4444)' }}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
                {expenses.length > 0 && (
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--border)' }}>
                      <td colSpan={isLocked ? 2 : 3} className="px-4 py-3 text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>Total dépenses</td>
                      <td className="px-4 py-3 text-sm font-bold text-right" style={{ color: 'var(--danger, #ef4444)' }}>{formatCurrency(totalExp)}</td>
                      {!isLocked && <td></td>}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* Validation section */}
          {!isLocked ? (
            <div className="rounded-xl p-5 flex items-center justify-between flex-wrap gap-4" style={{ backgroundColor: 'var(--surface)', border: '2px solid var(--primary)' }}>
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: 'var(--primary)' }} />
                <div>
                  <p className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Valider la journée</p>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    Après validation, toutes les données seront verrouillées. Pour toute modification, utilisez la procédure de Demande de modification.
                  </p>
                </div>
              </div>
              <button
                onClick={handleValidate}
                disabled={validating}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: 'var(--success, #16a34a)' }}
              >
                {validating ? <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" /> : <Lock className="w-4 h-4" />}
                Valider la journée
              </button>
            </div>
          ) : (
            <div className="rounded-xl p-5 flex items-center justify-between flex-wrap gap-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: 'var(--success, #16a34a)' }} />
                <div>
                  <p className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Journée validée</p>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    Validée le {report?.validated_at ? format(new Date(report.validated_at), 'dd/MM/yyyy à HH:mm', { locale: fr }) : '—'}
                  </p>
                </div>
              </div>
              <button
                onClick={handlePrint}
                className="flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm text-white"
                style={{ backgroundColor: 'var(--primary)' }}
              >
                <FileText className="w-4 h-4" /> Imprimer le rapport
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
