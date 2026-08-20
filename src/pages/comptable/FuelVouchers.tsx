import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../store/authStore';
import { useComptableCompanies } from '../../hooks/useComptableCompanies';
import { CompanyFilterBar } from '../../components/shared/CompanyFilterBar';
import toast from 'react-hot-toast';
import {
  Fuel, CheckCircle, XCircle, Eye, AlertTriangle,
  RefreshCw, Filter, X
} from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency } from '../../utils/formatCurrency';

interface FuelVoucher {
  id: string;
  voucher_number: string;
  status: string;
  estimated_liters: number;
  estimated_amount: number;
  actual_liters: number | null;
  actual_amount: number | null;
  fuel_price_per_liter: number;
  created_at: string;
  used_at: string | null;
  schedule: {
    departure_datetime: string;
    route_name: string | null;
  } | null;
  bus: {
    registration_number: string;
    brand: string | null;
    model: string;
    fuel_capacity: number | null;
  } | null;
  driver: {
    full_name: string;
  } | null;
}

type FilterType = 'all' | 'genere' | 'validated' | 'rejected';

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  genere:    { label: 'Généré',   color: 'var(--warning)', bg: 'var(--warning-light)' },
  utilise:   { label: 'Utilisé',  color: 'var(--info)',    bg: 'var(--info-light)' },
  validated: { label: 'Validé',   color: 'var(--success)', bg: 'var(--success-light)' },
  rejected:  { label: 'Rejeté',   color: 'var(--danger)',  bg: 'var(--danger-light)' },
};

export default function FuelVouchersValidation() {
  const { user } = useAuthStore();
  const { allowedCompanyIds, companyInfos } = useComptableCompanies();
  const allCompanyIds = allowedCompanyIds ?? (user?.company_id ? [user.company_id] : []);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const companyIds = selectedCompanies.length > 0 ? selectedCompanies : allCompanyIds;
  const [vouchers, setVouchers] = useState<FuelVoucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('genere');
  const [selectedVoucher, setSelectedVoucher] = useState<FuelVoucher | null>(null);
  const [processing, setProcessing] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

  useEffect(() => {
    loadVouchers();
  }, [filter, companyIds]);

  const loadVouchers = async () => {
    try {
      setLoading(true);

      let busIds: string[] | null = null;
      if (companyIds.length > 0) {
        const { data: busData } = await supabase.from('buses').select('id').in('company_id', companyIds);
        busIds = (busData ?? []).map(b => b.id);
        if (busIds.length === 0) { setVouchers([]); setLoading(false); return; }
      }

      let query = supabase
        .from('fuel_vouchers')
        .select(`
          id,
          voucher_number,
          status,
          estimated_liters,
          estimated_amount,
          actual_liters,
          actual_amount,
          fuel_price_per_liter,
          created_at,
          used_at,
          schedule:schedule_id (
            departure_datetime,
            route_name
          ),
          bus:bus_id (
            registration_number,
            brand,
            model,
            fuel_capacity
          ),
          driver:driver_id (
            full_name
          )
        `)
        .order('created_at', { ascending: false });

      if (filter !== 'all') query = query.eq('status', filter);
      if (busIds) query = query.in('bus_id', busIds);

      const { data, error } = await query;
      if (error) throw error;
      setVouchers((data ?? []) as any[]);
    } catch (error: any) {
      toast.error('Erreur de chargement');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleValidate = async (voucher: FuelVoucher) => {
    if (!confirm(`Valider le bon ${voucher.voucher_number} pour ${formatCurrency(voucher.estimated_amount)} ?`)) return;
    try {
      setProcessing(true);
      const { error } = await supabase
        .from('fuel_vouchers')
        .update({ status: 'validated', validated_by: (await supabase.auth.getUser()).data.user?.id })
        .eq('id', voucher.id);
      if (error) throw error;
      toast.success('Bon de carburant validé');
      setSelectedVoucher(null);
      loadVouchers();
    } catch (error: any) {
      toast.error('Erreur lors de la validation');
      console.error(error);
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async (voucher: FuelVoucher) => {
    if (!rejectionReason.trim()) { toast.error('Veuillez indiquer le motif de rejet'); return; }
    try {
      setProcessing(true);
      const { error } = await supabase
        .from('fuel_vouchers')
        .update({ status: 'rejected', validated_by: (await supabase.auth.getUser()).data.user?.id })
        .eq('id', voucher.id);
      if (error) throw error;
      toast.success('Bon de carburant rejeté');
      setSelectedVoucher(null);
      setRejectionReason('');
      setShowRejectInput(false);
      loadVouchers();
    } catch (error: any) {
      toast.error('Erreur lors du rejet');
      console.error(error);
    } finally {
      setProcessing(false);
    }
  };

  const countByStatus = (status: string) => vouchers.filter(v => v.status === status).length;

  const getVariance = (v: FuelVoucher) => {
    if (!v.actual_amount || !v.estimated_amount) return null;
    return ((v.actual_amount - v.estimated_amount) / v.estimated_amount) * 100;
  };

  const filterButtons: { key: FilterType; label: string; color?: string }[] = [
    { key: 'genere',    label: 'En attente' },
    { key: 'validated', label: 'Validés' },
    { key: 'rejected',  label: 'Rejetés' },
    { key: 'all',       label: 'Tous' },
  ];

  const filterColors: Record<FilterType, string> = {
    genere:    'var(--warning)',
    validated: 'var(--success)',
    rejected:  'var(--danger)',
    all:       'var(--primary)',
  };

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
            Bons de carburant
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>Validation et suivi des bons de carburant</p>
        </div>
        <button
          onClick={loadVouchers}
          disabled={loading}
          className="px-4 py-2 rounded-lg border flex items-center gap-2 text-sm hover:bg-gray-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Actualiser
        </button>
      </div>

      <CompanyFilterBar filter={{ allCompanyIds, selectedCompanyIds: companyIds, companyInfos, hasMultiple: allCompanyIds.length > 1 }} onChange={setSelectedCompanies} />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total bons', value: vouchers.length, icon: <Fuel className="w-5 h-5" />, color: 'var(--primary)', bg: 'var(--primary-light)' },
          { label: 'En attente', value: vouchers.filter(v => v.status === 'genere').length, icon: <AlertTriangle className="w-5 h-5" />, color: 'var(--warning)', bg: 'var(--warning-light)' },
          { label: 'Validés', value: vouchers.filter(v => v.status === 'validated').length, icon: <CheckCircle className="w-5 h-5" />, color: 'var(--success)', bg: 'var(--success-light)' },
          { label: 'Rejetés', value: vouchers.filter(v => v.status === 'rejected').length, icon: <XCircle className="w-5 h-5" />, color: 'var(--danger)', bg: 'var(--danger-light)' },
        ].map(s => (
          <div key={s.label} className="rounded-xl p-4" style={{ backgroundColor: s.bg }}>
            <div className="flex items-center gap-2 mb-2">
              <span style={{ color: s.color }}>{s.icon}</span>
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{s.label}</span>
            </div>
            <p className="text-2xl font-black" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
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
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>N° Bon</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Date</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Bus</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Chauffeur</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Litres est.</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Montant est.</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Montant réel</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Écart</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Statut</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {vouchers.map(v => {
                  const variance = getVariance(v);
                  const st = STATUS_LABELS[v.status] ?? STATUS_LABELS.genere;
                  return (
                    <tr key={v.id} className="border-t hover:bg-gray-50 transition-colors" style={{ borderColor: 'var(--neutral-100)' }}>
                      <td className="px-4 py-3">
                        <p className="font-mono font-semibold text-sm">{v.voucher_number}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm">{format(new Date(v.created_at), 'dd/MM/yyyy')}</p>
                        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          {format(new Date(v.created_at), 'HH:mm')}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-sm">{v.bus?.registration_number ?? '—'}</p>
                        {v.bus?.model && (
                          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                            {v.bus.brand} {v.bus.model}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium">{v.driver?.full_name ?? '—'}</p>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <p className="text-sm font-semibold">{Number(v.estimated_liters).toFixed(1)} L</p>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <p className="text-sm font-semibold">{formatCurrency(v.estimated_amount)}</p>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <p className="text-sm font-semibold" style={{ color: v.actual_amount ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                          {v.actual_amount ? formatCurrency(v.actual_amount) : '—'}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {variance !== null ? (
                          <div className="flex items-center justify-center gap-1">
                            {Math.abs(variance) > 15 && (
                              <AlertTriangle className="w-3.5 h-3.5" style={{ color: 'var(--warning)' }} />
                            )}
                            <span className="text-sm font-bold"
                              style={{ color: variance > 0 ? 'var(--danger)' : 'var(--success)' }}>
                              {variance > 0 ? '+' : ''}{variance.toFixed(1)}%
                            </span>
                          </div>
                        ) : <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>—</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="px-2 py-1 rounded-full text-xs font-medium"
                          style={{ backgroundColor: st.bg, color: st.color }}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => { setSelectedVoucher(v); setShowRejectInput(false); setRejectionReason(''); }}
                          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                          title="Voir détails"
                        >
                          <Eye className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {vouchers.length === 0 && (
              <div className="py-12 text-center">
                <Fuel className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Aucun bon de carburant</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {selectedVoucher && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b flex justify-between items-center sticky top-0 bg-white"
              style={{ borderColor: 'var(--neutral-200)' }}>
              <div>
                <h2 className="font-bold text-lg">{selectedVoucher.voucher_number}</h2>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {format(new Date(selectedVoucher.created_at), 'dd/MM/yyyy à HH:mm')}
                </p>
              </div>
              <button
                onClick={() => setSelectedVoucher(null)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Info Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl" style={{ backgroundColor: 'var(--neutral-50)' }}>
                  <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Bus</p>
                  <p className="font-bold">{selectedVoucher.bus?.registration_number ?? '—'}</p>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {selectedVoucher.bus?.brand} {selectedVoucher.bus?.model}
                  </p>
                </div>
                <div className="p-4 rounded-xl" style={{ backgroundColor: 'var(--neutral-50)' }}>
                  <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Chauffeur</p>
                  <p className="font-bold">{selectedVoucher.driver?.full_name ?? '—'}</p>
                </div>
                {selectedVoucher.schedule && (
                  <div className="col-span-2 p-4 rounded-xl" style={{ backgroundColor: 'var(--neutral-50)' }}>
                    <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Voyage</p>
                    <p className="font-semibold">{selectedVoucher.schedule.route_name ?? '—'}</p>
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      Départ: {format(new Date(selectedVoucher.schedule.departure_datetime), 'dd/MM/yyyy HH:mm')}
                    </p>
                  </div>
                )}
              </div>

              {/* Amounts Comparison */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl border" style={{ borderColor: 'var(--neutral-200)' }}>
                  <p className="text-xs font-semibold mb-3 uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    Estimation
                  </p>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span style={{ color: 'var(--text-secondary)' }}>Litres</span>
                      <span className="font-semibold">{Number(selectedVoucher.estimated_liters).toFixed(1)} L</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: 'var(--text-secondary)' }}>Prix/L</span>
                      <span className="font-semibold">{formatCurrency(selectedVoucher.fuel_price_per_liter)}</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t font-bold" style={{ borderColor: 'var(--neutral-200)' }}>
                      <span>Total</span>
                      <span>{formatCurrency(selectedVoucher.estimated_amount)}</span>
                    </div>
                  </div>
                </div>
                <div className="p-4 rounded-xl border-2" style={{ borderColor: 'var(--primary)' }}>
                  <p className="text-xs font-semibold mb-3 uppercase tracking-wider" style={{ color: 'var(--primary)' }}>
                    Réel
                  </p>
                  {selectedVoucher.actual_amount ? (
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--text-secondary)' }}>Litres</span>
                        <span className="font-semibold">{selectedVoucher.actual_liters != null ? Number(selectedVoucher.actual_liters).toFixed(1) + ' L' : '—'}</span>
                      </div>
                      <div className="flex justify-between pt-2 border-t font-bold" style={{ borderColor: 'var(--neutral-200)' }}>
                        <span>Total</span>
                        <span style={{ color: 'var(--primary)' }}>{formatCurrency(selectedVoucher.actual_amount)}</span>
                      </div>
                      {(() => {
                        const v = getVariance(selectedVoucher);
                        if (v === null) return null;
                        return (
                          <div className="pt-2">
                            <span className="text-xs font-bold"
                              style={{ color: Math.abs(v) > 15 ? 'var(--danger)' : v > 0 ? 'var(--warning)' : 'var(--success)' }}>
                              Écart: {v > 0 ? '+' : ''}{v.toFixed(1)}%
                            </span>
                          </div>
                        );
                      })()}
                    </div>
                  ) : (
                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Pas encore utilisé</p>
                  )}
                </div>
              </div>

              {/* Status Badge */}
              <div className="flex items-center gap-2">
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Statut :</span>
                <span className="px-3 py-1 rounded-full text-sm font-medium"
                  style={{
                    backgroundColor: STATUS_LABELS[selectedVoucher.status]?.bg ?? 'var(--neutral-100)',
                    color: STATUS_LABELS[selectedVoucher.status]?.color ?? 'var(--text-secondary)',
                  }}>
                  {STATUS_LABELS[selectedVoucher.status]?.label ?? selectedVoucher.status}
                </span>
              </div>

              {/* Actions for pending vouchers */}
              {selectedVoucher.status === 'genere' && (
                <div className="space-y-3">
                  {showRejectInput && (
                    <div>
                      <label className="block mb-2 text-sm font-medium">Motif de rejet</label>
                      <textarea
                        value={rejectionReason}
                        onChange={e => setRejectionReason(e.target.value)}
                        className="w-full p-3 border rounded-lg text-sm"
                        rows={3}
                        placeholder="Indiquez le motif du rejet..."
                        style={{ borderColor: 'var(--neutral-300)' }}
                      />
                    </div>
                  )}
                  <div className="flex gap-3">
                    {!showRejectInput ? (
                      <button
                        onClick={() => setShowRejectInput(true)}
                        className="flex-1 py-2.5 rounded-lg border-2 font-medium text-sm flex items-center justify-center gap-2"
                        style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                      >
                        <XCircle className="w-4 h-4" />
                        Rejeter
                      </button>
                    ) : (
                      <button
                        onClick={() => handleReject(selectedVoucher)}
                        disabled={processing || !rejectionReason.trim()}
                        className="flex-1 py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                        style={{ backgroundColor: 'var(--danger)', color: 'white' }}
                      >
                        {processing ? 'Rejet...' : 'Confirmer le rejet'}
                      </button>
                    )}
                    <button
                      onClick={() => handleValidate(selectedVoucher)}
                      disabled={processing}
                      className="flex-1 py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                      style={{ backgroundColor: 'var(--success)', color: 'white' }}
                    >
                      {processing ? (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : <CheckCircle className="w-4 h-4" />}
                      Valider
                    </button>
                  </div>
                </div>
              )}

              {selectedVoucher.status === 'validated' && (
                <div className="p-4 rounded-xl text-center" style={{ backgroundColor: 'var(--success-light)' }}>
                  <p className="font-semibold text-sm" style={{ color: 'var(--success)' }}>Bon validé et comptabilisé</p>
                </div>
              )}

              {selectedVoucher.status === 'rejected' && (
                <div className="p-4 rounded-xl" style={{ backgroundColor: 'var(--danger-light)' }}>
                  <p className="font-semibold text-sm" style={{ color: 'var(--danger)' }}>Bon rejeté</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
