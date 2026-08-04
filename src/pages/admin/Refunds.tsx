import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import { DollarSign, CheckCircle, XCircle, Eye, RefreshCw, Filter } from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency } from '../../utils/formatCurrency';

interface Refund {
  id: string;
  booking_reference: string;
  passenger_name: string;
  passenger_phone: string;
  price: number;
  payment_method: string;
  status: string;
  refund_reason: string;
  created_at: string;
  schedules: {
    departure_datetime: string;
    routes: {
      origin_station: { name: string };
      destination_station: { name: string };
    };
  };
}

export default function Refunds() {
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [selectedRefund, setSelectedRefund] = useState<Refund | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    loadRefunds();
  }, [filter]);

  const loadRefunds = async () => {
    try {
      setLoading(true);

      let query = supabase
        .from('reservations')
        .select(`
          id,
          booking_reference,
          passenger_name,
          passenger_phone,
          price,
          payment_method,
          status,
          refund_reason,
          created_at,
          schedules:schedule_id (
            departure_datetime,
            routes:route_id (
              origin_station:stations!origin_station_id(name),
              destination_station:stations!destination_station_id(name)
            )
          )
        `)
        .in('status', ['cancelled', 'refunded'])
        .order('created_at', { ascending: false });

      if (filter !== 'all') {
        if (filter === 'pending') {
          query = query.eq('status', 'cancelled');
        } else if (filter === 'approved') {
          query = query.eq('status', 'refunded');
        }
      }

      const { data, error } = await query;

      if (error) throw error;
      setRefunds(data as Refund[]);
    } catch (error: any) {
      toast.error('Erreur de chargement des remboursements');
    } finally {
      setLoading(false);
    }
  };

  const handleApproveRefund = async (refund: Refund) => {
    if (!confirm(`Voulez-vous approuver le remboursement de ${formatCurrency(refund.price)} ?`)) return;

    try {
      setProcessing(true);

      const { error } = await supabase
        .from('reservations')
        .update({
          status: 'refunded',
          payment_status: 'remboursee'
        })
        .eq('id', refund.id);

      if (error) throw error;

      toast.success('Remboursement approuvé');
      loadRefunds();
      setShowModal(false);
    } catch (error: any) {
      toast.error('Erreur lors de l\'approbation');
    } finally {
      setProcessing(false);
    }
  };

  const handleRejectRefund = async (refund: Refund) => {
    if (!confirm('Voulez-vous rejeter cette demande de remboursement ?')) return;

    try {
      setProcessing(true);

      const { error } = await supabase
        .from('reservations')
        .update({
          status: 'confirmed'
        })
        .eq('id', refund.id);

      if (error) throw error;

      toast.success('Demande de remboursement rejetée');
      loadRefunds();
      setShowModal(false);
    } catch (error: any) {
      toast.error('Erreur lors du rejet');
    } finally {
      setProcessing(false);
    }
  };

  const getPaymentMethodLabel = (method: string) => {
    switch (method) {
      case 'cash': return 'Espèces';
      case 'mobile_money': return 'Mobile Money';
      case 'card': return 'Carte bancaire';
      case 'transfer': return 'Virement';
      default: return method;
    }
  };

  const pendingRefunds = refunds.filter(r => r.status === 'cancelled');
  const approvedRefunds = refunds.filter(r => r.status === 'refunded');
  const totalPendingAmount = pendingRefunds.reduce((sum, r) => sum + r.price, 0);
  const totalApprovedAmount = approvedRefunds.reduce((sum, r) => sum + r.price, 0);

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            Gestion des remboursements
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            {refunds.length} demande{refunds.length > 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={loadRefunds}
          className="px-4 py-2 rounded-lg border flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Actualiser
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-xl p-6 border">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-full flex items-center justify-center"
                 style={{ backgroundColor: 'var(--warning-light)' }}>
              <DollarSign className="w-5 h-5" style={{ color: 'var(--warning)' }} />
            </div>
            <div>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>En attente</p>
              <p className="text-2xl font-bold">{pendingRefunds.length}</p>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t">
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Montant total</p>
            <p className="text-lg font-bold" style={{ color: 'var(--warning)' }}>
              {formatCurrency(totalPendingAmount)}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-xl p-6 border">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-full flex items-center justify-center"
                 style={{ backgroundColor: 'var(--success-light)' }}>
              <CheckCircle className="w-5 h-5" style={{ color: 'var(--success)' }} />
            </div>
            <div>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Approuvés</p>
              <p className="text-2xl font-bold">{approvedRefunds.length}</p>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t">
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Montant total</p>
            <p className="text-lg font-bold" style={{ color: 'var(--success)' }}>
              {formatCurrency(totalApprovedAmount)}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-xl p-6 border">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-full flex items-center justify-center"
                 style={{ backgroundColor: 'var(--primary-light)' }}>
              <DollarSign className="w-5 h-5" style={{ color: 'var(--primary)' }} />
            </div>
            <div>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Total</p>
              <p className="text-2xl font-bold">{refunds.length}</p>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t">
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Montant total</p>
            <p className="text-lg font-bold" style={{ color: 'var(--primary)' }}>
              {formatCurrency(totalPendingAmount + totalApprovedAmount)}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 mb-6 border">
        <div className="flex items-center gap-4">
          <Filter className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
          <div className="flex gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 rounded-lg font-medium ${
                filter === 'all'
                  ? 'text-white'
                  : 'border'
              }`}
              style={{ backgroundColor: filter === 'all' ? 'var(--primary)' : 'transparent' }}
            >
              Tous
            </button>
            <button
              onClick={() => setFilter('pending')}
              className={`px-4 py-2 rounded-lg font-medium ${
                filter === 'pending'
                  ? 'text-white'
                  : 'border'
              }`}
              style={{ backgroundColor: filter === 'pending' ? 'var(--warning)' : 'transparent' }}
            >
              En attente
            </button>
            <button
              onClick={() => setFilter('approved')}
              className={`px-4 py-2 rounded-lg font-medium ${
                filter === 'approved'
                  ? 'text-white'
                  : 'border'
              }`}
              style={{ backgroundColor: filter === 'approved' ? 'var(--success)' : 'transparent' }}
            >
              Approuvés
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="w-12 h-12 border-4 rounded-full animate-spin mx-auto mb-4"
               style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Chargement...</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead style={{ backgroundColor: 'var(--neutral-100)' }}>
                <tr>
                  <th className="text-left p-4 font-semibold">Date</th>
                  <th className="text-left p-4 font-semibold">Référence</th>
                  <th className="text-left p-4 font-semibold">Passager</th>
                  <th className="text-left p-4 font-semibold">Voyage</th>
                  <th className="text-left p-4 font-semibold">Montant</th>
                  <th className="text-left p-4 font-semibold">Mode paiement</th>
                  <th className="text-left p-4 font-semibold">Statut</th>
                  <th className="text-left p-4 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {refunds.map(refund => (
                  <tr key={refund.id} className="border-t hover:bg-gray-50">
                    <td className="p-4">
                      <p className="text-sm">
                        {format(new Date(refund.created_at), 'dd/MM/yyyy')}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {format(new Date(refund.created_at), 'HH:mm')}
                      </p>
                    </td>
                    <td className="p-4">
                      <p className="font-mono text-sm font-semibold">{refund.booking_reference}</p>
                    </td>
                    <td className="p-4">
                      <p className="font-medium">{refund.passenger_name}</p>
                      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {refund.passenger_phone}
                      </p>
                    </td>
                    <td className="p-4">
                      <p className="text-sm">
                        {refund.schedules.routes.origin_station.name} → {refund.schedules.routes.destination_station.name}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {format(new Date(refund.schedules.departure_datetime), 'dd/MM/yyyy')}
                      </p>
                    </td>
                    <td className="p-4">
                      <p className="font-bold text-lg">{formatCurrency(refund.price)}</p>
                    </td>
                    <td className="p-4">
                      <p className="text-sm">{getPaymentMethodLabel(refund.payment_method)}</p>
                    </td>
                    <td className="p-4">
                      <span
                        className="px-3 py-1 rounded-full text-xs font-medium"
                        style={{
                          backgroundColor: refund.status === 'refunded'
                            ? 'var(--success-light)'
                            : 'var(--warning-light)',
                          color: refund.status === 'refunded'
                            ? 'var(--success)'
                            : 'var(--warning)'
                        }}
                      >
                        {refund.status === 'refunded' ? 'Remboursé' : 'En attente'}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setSelectedRefund(refund);
                            setShowModal(true);
                          }}
                          className="p-2 rounded hover:bg-gray-100"
                          title="Voir détails"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {refund.status === 'cancelled' && (
                          <>
                            <button
                              onClick={() => handleApproveRefund(refund)}
                              className="p-2 rounded hover:bg-gray-100"
                              title="Approuver"
                            >
                              <CheckCircle className="w-4 h-4" style={{ color: 'var(--success)' }} />
                            </button>
                            <button
                              onClick={() => handleRejectRefund(refund)}
                              className="p-2 rounded hover:bg-gray-100"
                              title="Rejeter"
                            >
                              <XCircle className="w-4 h-4" style={{ color: 'var(--danger)' }} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {refunds.length === 0 && (
              <div className="text-center py-12">
                <p style={{ color: 'var(--text-secondary)' }}>Aucune demande de remboursement</p>
              </div>
            )}
          </div>
        </div>
      )}

      {showModal && selectedRefund && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full">
            <div className="p-6 border-b flex justify-between items-center">
              <h2 className="text-xl font-bold">Détails du remboursement</h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>Référence</p>
                  <p className="font-mono font-bold">{selectedRefund.booking_reference}</p>
                </div>
                <div>
                  <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>Statut</p>
                  <span
                    className="px-3 py-1 rounded-full text-xs font-medium inline-block"
                    style={{
                      backgroundColor: selectedRefund.status === 'refunded'
                        ? 'var(--success-light)'
                        : 'var(--warning-light)',
                      color: selectedRefund.status === 'refunded'
                        ? 'var(--success)'
                        : 'var(--warning)'
                    }}
                  >
                    {selectedRefund.status === 'refunded' ? 'Remboursé' : 'En attente'}
                  </span>
                </div>
                <div>
                  <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>Passager</p>
                  <p className="font-semibold">{selectedRefund.passenger_name}</p>
                  <p className="text-sm">{selectedRefund.passenger_phone}</p>
                </div>
                <div>
                  <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>Date de réservation</p>
                  <p className="font-semibold">
                    {format(new Date(selectedRefund.created_at), 'dd/MM/yyyy à HH:mm')}
                  </p>
                </div>
                <div>
                  <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>Trajet</p>
                  <p className="font-semibold">
                    {selectedRefund.schedules.routes.origin_station.name} → {selectedRefund.schedules.routes.destination_station.name}
                  </p>
                </div>
                <div>
                  <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>Date de voyage</p>
                  <p className="font-semibold">
                    {format(new Date(selectedRefund.schedules.departure_datetime), 'dd/MM/yyyy')}
                  </p>
                </div>
                <div>
                  <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>Montant</p>
                  <p className="text-2xl font-bold" style={{ color: 'var(--primary)' }}>
                    {formatCurrency(selectedRefund.price)}
                  </p>
                </div>
                <div>
                  <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>Mode de paiement initial</p>
                  <p className="font-semibold">{getPaymentMethodLabel(selectedRefund.payment_method)}</p>
                </div>
              </div>

              {selectedRefund.refund_reason && (
                <div className="p-4 rounded-lg border">
                  <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>Motif d'annulation</p>
                  <p>{selectedRefund.refund_reason}</p>
                </div>
              )}

              {selectedRefund.status === 'cancelled' && (
                <div className="flex gap-3">
                  <button
                    onClick={() => handleRejectRefund(selectedRefund)}
                    disabled={processing}
                    className="flex-1 px-4 py-3 rounded-lg border font-medium disabled:opacity-50"
                  >
                    Rejeter
                  </button>
                  <button
                    onClick={() => handleApproveRefund(selectedRefund)}
                    disabled={processing}
                    className="flex-1 px-4 py-3 rounded-lg text-white font-medium disabled:opacity-50"
                    style={{ backgroundColor: 'var(--success)' }}
                  >
                    {processing ? 'Traitement...' : 'Approuver le remboursement'}
                  </button>
                </div>
              )}

              {selectedRefund.status === 'refunded' && (
                <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--success-light)' }}>
                  <p className="text-center font-semibold" style={{ color: 'var(--success)' }}>
                    Remboursement effectué
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
