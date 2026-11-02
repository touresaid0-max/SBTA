import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import { Send, Package, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';
import { useParams, useNavigate } from 'react-router-dom';
import { formatCurrency } from '../../utils/formatCurrency';
import { useAuthStore } from '../../store/authStore';
import { receivedOf, statusInfo, type PurchaseOrderItem } from '../../services/purchaseOrders';

interface PurchaseOrder {
  id: string;
  order_number: string;
  supplier_id: string;
  order_date: string | null;
  expected_delivery_date: string | null;
  total_amount: number;
  status: string;
  items: PurchaseOrderItem[] | null;
  created_at: string;
  spare_parts_suppliers: {
    name: string;
    contact_person: string | null;
    phone: string | null;
    email: string | null;
  } | null;
}

export default function PurchaseOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.user?.id);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [purchaseOrder, setPurchaseOrder] = useState<PurchaseOrder | null>(null);
  // Quantity to receive now, per line index
  const [receivedQuantities, setReceivedQuantities] = useState<Record<number, number>>({});

  useEffect(() => {
    loadPurchaseOrder();
  }, [id]);

  const items = purchaseOrder?.items ?? [];

  const loadPurchaseOrder = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('spare_parts_purchase_orders')
        .select(`
          id, order_number, supplier_id, order_date, expected_delivery_date,
          total_amount, status, items, created_at,
          spare_parts_suppliers:supplier_id (
            name,
            contact_person,
            phone,
            email
          )
        `)
        .eq('id', id)
        .single();

      if (error) throw error;
      const order = data as unknown as PurchaseOrder;
      setPurchaseOrder(order);

      const quantities: Record<number, number> = {};
      (order.items ?? []).forEach((item, index) => {
        quantities[index] = Math.max(0, Number(item.quantity) - receivedOf(item));
      });
      setReceivedQuantities(quantities);
    } catch (error: any) {
      toast.error('Erreur de chargement');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkOrdered = async () => {
    try {
      setSubmitting(true);

      const { data, error } = await supabase
        .from('spare_parts_purchase_orders')
        .update({ status: 'validee', validated_by: userId ?? null })
        .eq('id', id)
        .select('id');

      if (error) throw error;
      // RLS refuses silently: no row comes back
      if (!data?.length) throw new Error('Droits insuffisants pour modifier ce bon de commande');

      toast.success('Bon de commande marqué comme commandé');
      loadPurchaseOrder();
    } catch (error: any) {
      toast.error(error?.message?.startsWith('Droits') ? error.message : 'Erreur lors de la mise à jour');
      console.error(error);
    } finally {
      setSubmitting(false);
    }
  };

  // Movements, stock and received quantities are saved in one database transaction
  // (receive_purchase_order, migration 20261102140000): nothing is saved if a step fails.
  const handleReceive = async () => {
    if (!purchaseOrder) return;
    try {
      setSubmitting(true);

      const lines = Object.entries(receivedQuantities)
        .map(([index, quantity]) => ({ index: Number(index), quantity }))
        .filter(line => line.quantity > 0);

      const { data: newStatus, error } = await supabase.rpc('receive_purchase_order', {
        p_order_id: purchaseOrder.id,
        p_lines: lines
      });

      if (error) throw error;

      toast.success(
        newStatus === 'livree' ? 'Réception complète effectuée' : 'Réception partielle effectuée'
      );
      navigate('/stock/purchase-orders');
    } catch (error: any) {
      // Messages raised by the database function are already in French
      toast.error(error?.code === 'P0001' ? error.message : 'Erreur lors de la réception');
      console.error(error);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="text-center py-12">
          <div className="w-12 h-12 border-4 rounded-full animate-spin mx-auto mb-4"
               style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Chargement...</p>
        </div>
      </div>
    );
  }

  if (!purchaseOrder) {
    return (
      <div className="p-8">
        <div className="text-center py-12">
          <p>Bon de commande introuvable</p>
        </div>
      </div>
    );
  }

  const canOrder = purchaseOrder.status === 'en_attente';
  const canReceive = purchaseOrder.status === 'validee';
  const status = statusInfo(purchaseOrder.status);
  const supplier = purchaseOrder.spare_parts_suppliers;

  return (
    <div className="p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-3" style={{ color: 'var(--text-primary)' }}>
            {purchaseOrder.order_number}
            <span
              className="px-3 py-1 rounded-full text-sm font-semibold"
              style={{ backgroundColor: status.bg, color: status.color }}
            >
              {status.label}
            </span>
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Créé le {format(new Date(purchaseOrder.created_at), 'dd/MM/yyyy à HH:mm')}
            {purchaseOrder.expected_delivery_date &&
              ` · Livraison prévue le ${format(new Date(purchaseOrder.expected_delivery_date), 'dd/MM/yyyy')}`}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-xl p-6 border">
              <h3 className="font-bold mb-4">Fournisseur</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p style={{ color: 'var(--text-secondary)' }}>Nom</p>
                  <p className="font-bold">{supplier?.name ?? '-'}</p>
                </div>
                <div>
                  <p style={{ color: 'var(--text-secondary)' }}>Email</p>
                  <p className="font-semibold">{supplier?.email || '-'}</p>
                </div>
                <div>
                  <p style={{ color: 'var(--text-secondary)' }}>Contact</p>
                  <p className="font-semibold">{supplier?.contact_person || '-'}</p>
                </div>
                <div>
                  <p style={{ color: 'var(--text-secondary)' }}>Téléphone</p>
                  <p className="font-semibold">{supplier?.phone || '-'}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl p-6 border">
              <h3 className="font-bold mb-4">Articles commandés</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead style={{ backgroundColor: 'var(--neutral-100)' }}>
                    <tr>
                      <th className="text-left p-2">Réf</th>
                      <th className="text-left p-2">Désignation</th>
                      <th className="text-left p-2">Qté cmd</th>
                      <th className="text-left p-2">Qté reçue</th>
                      {canReceive && <th className="text-left p-2">À recevoir</th>}
                      <th className="text-left p-2">Prix/U</th>
                      <th className="text-left p-2">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, index) => {
                      const received = receivedOf(item);
                      return (
                        <tr key={index} className="border-t">
                          <td className="p-2 font-mono">{item.part_number}</td>
                          <td className="p-2 font-semibold">{item.name}</td>
                          <td className="p-2">{item.quantity}</td>
                          <td className="p-2">
                            <span className="font-semibold">{received}</span>
                            {received >= Number(item.quantity) && (
                              <CheckCircle className="inline w-4 h-4 ml-1 text-green-600" />
                            )}
                          </td>
                          {canReceive && (
                            <td className="p-2">
                              <input
                                type="number"
                                min="0"
                                max={Math.max(0, Number(item.quantity) - received)}
                                value={receivedQuantities[index] || 0}
                                onChange={(e) =>
                                  setReceivedQuantities({
                                    ...receivedQuantities,
                                    [index]: parseInt(e.target.value) || 0
                                  })
                                }
                                className="w-20 p-1 border rounded"
                              />
                            </td>
                          )}
                          <td className="p-2">{formatCurrency(item.unit_price)}</td>
                          <td className="p-2 font-bold">{formatCurrency(item.total)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot style={{ backgroundColor: 'var(--neutral-100)' }}>
                    <tr>
                      <td colSpan={canReceive ? 6 : 5} className="p-2 font-semibold text-right">
                        TOTAL
                      </td>
                      <td className="p-2 font-bold text-lg" style={{ color: 'var(--primary)' }}>
                        {formatCurrency(purchaseOrder.total_amount)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-xl p-6 border sticky top-8">
              <h3 className="font-bold mb-4">Actions</h3>

              {canOrder && (
                <button
                  onClick={handleMarkOrdered}
                  disabled={submitting}
                  className="w-full px-6 py-3 rounded-lg text-white font-bold flex items-center justify-center gap-2 mb-3 disabled:opacity-50"
                  style={{ backgroundColor: 'var(--primary)' }}
                >
                  <Send className="w-5 h-5" />
                  {submitting ? 'Envoi...' : 'Marquer comme commandé'}
                </button>
              )}

              {canReceive && (
                <button
                  onClick={handleReceive}
                  disabled={
                    submitting ||
                    Object.values(receivedQuantities).every(qty => qty === 0)
                  }
                  className="w-full px-6 py-3 rounded-lg text-white font-bold flex items-center justify-center gap-2 mb-3 disabled:opacity-50"
                  style={{ backgroundColor: 'var(--success)' }}
                >
                  <Package className="w-5 h-5" />
                  {submitting ? 'Réception...' : 'Enregistrer la réception'}
                </button>
              )}

              <button
                onClick={() => navigate('/stock/purchase-orders')}
                className="w-full px-6 py-3 rounded-lg border font-medium"
              >
                Retour à la liste
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
