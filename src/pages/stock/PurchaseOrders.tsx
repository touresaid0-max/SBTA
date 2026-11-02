import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import { Plus, Eye, Trash2, Package, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { formatCurrency } from '../../utils/formatCurrency';
import { PURCHASE_ORDER_STATUS, statusInfo } from '../../services/purchaseOrders';

interface PurchaseOrder {
  id: string;
  order_number: string;
  supplier_id: string;
  total_amount: number;
  status: string;
  order_date: string | null;
  expected_delivery_date: string | null;
  created_at: string;
  items: unknown[] | null;
  spare_parts_suppliers: {
    name: string;
  } | null;
}

export default function PurchaseOrders() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [filterStatus, setFilterStatus] = useState('');

  useEffect(() => {
    loadPurchaseOrders();
  }, []);

  const loadPurchaseOrders = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('spare_parts_purchase_orders')
        .select(`
          id, order_number, supplier_id, total_amount, status,
          order_date, expected_delivery_date, created_at, items,
          spare_parts_suppliers:supplier_id (
            name
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPurchaseOrders((data || []) as unknown as PurchaseOrder[]);
    } catch (error: any) {
      toast.error('Erreur de chargement');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer ce bon de commande ?')) return;

    try {
      const { data, error } = await supabase
        .from('spare_parts_purchase_orders')
        .delete()
        .eq('id', id)
        .select('id');

      if (error) throw error;
      // RLS refuses silently: no row comes back
      if (!data?.length) throw new Error('Droits insuffisants pour supprimer ce bon de commande');
      toast.success('Bon de commande supprimé');
      loadPurchaseOrders();
    } catch (error: any) {
      toast.error(error?.message?.startsWith('Droits') ? error.message : 'Erreur lors de la suppression');
      console.error(error);
    }
  };

  const getStatusBadge = (status: string) => {
    const style = statusInfo(status);

    return (
      <span
        className="px-3 py-1 rounded-full text-xs font-medium"
        style={{ backgroundColor: style.bg, color: style.color }}
      >
        {style.label}
      </span>
    );
  };

  const filteredOrders = filterStatus
    ? purchaseOrders.filter(po => po.status === filterStatus)
    : purchaseOrders;

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            Bons de commande
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>Gestion des commandes de pièces</p>
        </div>
        <button
          onClick={() => navigate('/stock/purchase-orders/new')}
          className="px-6 py-3 rounded-lg text-white font-bold flex items-center gap-2"
          style={{ backgroundColor: 'var(--primary)' }}
        >
          <Plus className="w-5 h-5" />
          Nouveau bon de commande
        </button>
      </div>

      <div className="bg-white rounded-xl p-6 border mb-6">
        <div className="flex gap-4">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-4 py-2 border rounded-lg"
          >
            <option value="">Tous les statuts</option>
            {Object.entries(PURCHASE_ORDER_STATUS).map(([value, info]) => (
              <option key={value} value={value}>{info.label}</option>
            ))}
          </select>
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
                  <th className="text-left p-4 font-semibold">N° Bon</th>
                  <th className="text-left p-4 font-semibold">Fournisseur</th>
                  <th className="text-left p-4 font-semibold">Articles</th>
                  <th className="text-left p-4 font-semibold">Montant total</th>
                  <th className="text-left p-4 font-semibold">Date création</th>
                  <th className="text-left p-4 font-semibold">Livraison prévue</th>
                  <th className="text-left p-4 font-semibold">Statut</th>
                  <th className="text-left p-4 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map(po => (
                  <tr key={po.id} className="border-t hover:bg-gray-50">
                    <td className="p-4">
                      <p className="font-mono font-bold">{po.order_number}</p>
                    </td>
                    <td className="p-4">
                      <p className="font-semibold">{po.spare_parts_suppliers?.name ?? '-'}</p>
                    </td>
                    <td className="p-4">
                      <p className="font-semibold">{(po.items ?? []).length} article(s)</p>
                    </td>
                    <td className="p-4">
                      <p className="font-bold text-lg" style={{ color: 'var(--primary)' }}>
                        {formatCurrency(po.total_amount)}
                      </p>
                    </td>
                    <td className="p-4">
                      <p className="text-sm">{format(new Date(po.created_at), 'dd/MM/yyyy')}</p>
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {format(new Date(po.created_at), 'HH:mm')}
                      </p>
                    </td>
                    <td className="p-4">
                      {po.expected_delivery_date ? (
                        <p className="text-sm">{format(new Date(po.expected_delivery_date), 'dd/MM/yyyy')}</p>
                      ) : (
                        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>-</span>
                      )}
                    </td>
                    <td className="p-4">
                      {getStatusBadge(po.status)}
                    </td>
                    <td className="p-4">
                      <div className="flex gap-2">
                        <button
                          onClick={() => navigate(`/stock/purchase-orders/${po.id}`)}
                          className="p-2 rounded-lg border hover:bg-gray-50"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {po.status === 'en_attente' && (
                          <button
                            onClick={() => handleDelete(po.id)}
                            className="p-2 rounded-lg border hover:bg-red-50"
                            style={{ color: 'var(--danger)' }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {filteredOrders.length === 0 && (
              <div className="p-12 text-center">
                <Package className="w-16 h-16 mx-auto mb-4" style={{ color: 'var(--text-secondary)' }} />
                <p className="font-semibold mb-1">Aucun bon de commande</p>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {purchaseOrders.length === 0
                    ? 'Créez votre premier bon de commande'
                    : 'Aucun résultat ne correspond aux filtres'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
