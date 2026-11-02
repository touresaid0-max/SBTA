import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import { AlertTriangle, ShoppingCart, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { provisionalOrderNumber } from '../../services/purchaseOrders';

interface LowStockPart {
  id: string;
  part_number: string;
  name: string;
  category: string;
  stock_quantity: number;
  min_stock_level: number;
  unit_price: number;
  supplier_id: string | null;
}

interface StockAlertsProps {
  showInDashboard?: boolean;
  maxItems?: number;
}

export default function StockAlerts({ showInDashboard = false, maxItems = 10 }: StockAlertsProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [lowStockParts, setLowStockParts] = useState<LowStockPart[]>([]);
  const [creatingPO, setCreatingPO] = useState<string | null>(null);
  const userId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    loadLowStockParts();
  }, []);

  const loadLowStockParts = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('spare_parts')
        .select('*')
        .order('stock_quantity', { ascending: true });

      if (error) throw error;

      const lowStock = (data || []).filter(
        (part: LowStockPart) => part.stock_quantity < part.min_stock_level
      );

      setLowStockParts(lowStock.slice(0, maxItems));
    } catch (error: any) {
      console.error('Erreur de chargement des alertes stock:', error);
    } finally {
      setLoading(false);
    }
  };

  const createPurchaseOrder = async (part: LowStockPart) => {
    try {
      setCreatingPO(part.id);

      // The part's own supplier, otherwise the first active supplier
      let supplierId = part.supplier_id;
      if (!supplierId) {
        const { data: suppliers, error: suppliersError } = await supabase
          .from('spare_parts_suppliers')
          .select('id')
          .eq('is_active', true)
          .order('name', { ascending: true })
          .limit(1);

        if (suppliersError) throw suppliersError;
        supplierId = suppliers?.[0]?.id ?? null;
      }

      if (!supplierId) {
        toast.error('Aucun fournisseur actif configuré');
        navigate('/stock/suppliers');
        return;
      }

      const quantityToOrder = Math.max(
        part.min_stock_level * 2 - part.stock_quantity,
        10
      );

      const unitPrice = Number(part.unit_price ?? 0);
      const totalPrice = quantityToOrder * unitPrice;

      const { data: poData, error: poError } = await supabase
        .from('spare_parts_purchase_orders')
        .insert({
          order_number: provisionalOrderNumber(),
          supplier_id: supplierId,
          order_date: new Date().toISOString().slice(0, 10),
          total_amount: totalPrice,
          status: 'en_attente',
          items: [{
            part_id: part.id,
            part_number: part.part_number,
            name: part.name,
            quantity: quantityToOrder,
            unit_price: unitPrice,
            total: totalPrice,
            received_quantity: 0
          }],
          created_by: userId ?? null
        })
        .select('id')
        .single();

      if (poError) throw poError;

      toast.success('Bon de commande créé');
      navigate(`/stock/purchase-orders/${poData.id}`);
    } catch (error: any) {
      toast.error('Erreur lors de la création du bon de commande');
      console.error(error);
    } finally {
      setCreatingPO(null);
    }
  };

  const getAlertLevel = (part: LowStockPart) => {
    const percentage = (part.stock_quantity / part.min_stock_level) * 100;
    if (percentage === 0) {
      return { color: '#DC2626', bg: '#FEE2E2', label: 'Stock épuisé' };
    }
    if (percentage < 50) {
      return { color: '#DC2626', bg: '#FEE2E2', label: 'Critique' };
    }
    return { color: '#F59E0B', bg: '#FEF3C7', label: 'Bas' };
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl p-6 border">
        <div className="text-center py-4">
          <div className="w-8 h-8 border-4 rounded-full animate-spin mx-auto"
               style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
        </div>
      </div>
    );
  }

  if (lowStockParts.length === 0) {
    return showInDashboard ? (
      <div className="bg-white rounded-xl p-6 border">
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle className="w-6 h-6" style={{ color: 'var(--success)' }} />
          <h3 className="font-bold">Alertes stock</h3>
        </div>
        <div className="text-center py-4">
          <p className="text-sm" style={{ color: 'var(--success)' }}>
            ✓ Tous les stocks sont au-dessus du minimum
          </p>
        </div>
      </div>
    ) : null;
  }

  return (
    <div className="bg-white rounded-xl p-6 border">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-6 h-6" style={{ color: 'var(--danger)' }} />
          <h3 className="font-bold">Alertes stock minimum</h3>
        </div>
        <span
          className="px-3 py-1 rounded-full text-sm font-bold"
          style={{ backgroundColor: 'var(--danger-light)', color: 'var(--danger)' }}
        >
          {lowStockParts.length}
        </span>
      </div>

      <div className="space-y-3">
        {lowStockParts.map(part => {
          const alert = getAlertLevel(part);
          return (
            <div key={part.id} className="p-4 rounded-lg border-l-4" style={{ borderColor: alert.color, backgroundColor: alert.bg + '40' }}>
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-bold">{part.name}</p>
                    <span
                      className="px-2 py-0.5 rounded text-xs font-bold"
                      style={{ backgroundColor: alert.bg, color: alert.color }}
                    >
                      {alert.label}
                    </span>
                  </div>
                  <p className="font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>
                    {part.part_number}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-3 text-sm">
                <div>
                  <p style={{ color: 'var(--text-secondary)' }}>Stock actuel</p>
                  <p className="font-bold" style={{ color: alert.color }}>
                    {part.stock_quantity}
                  </p>
                </div>
                <div>
                  <p style={{ color: 'var(--text-secondary)' }}>Minimum requis</p>
                  <p className="font-semibold">
                    {part.min_stock_level}
                  </p>
                </div>
              </div>

              <button
                onClick={() => createPurchaseOrder(part)}
                disabled={creatingPO === part.id}
                className="w-full px-4 py-2 rounded-lg text-white font-medium flex items-center justify-center gap-2 disabled:opacity-50"
                style={{ backgroundColor: 'var(--primary)' }}
              >
                <ShoppingCart className="w-4 h-4" />
                {creatingPO === part.id ? 'Création...' : 'Commander'}
              </button>
            </div>
          );
        })}
      </div>

      {!showInDashboard && (
        <div className="mt-4 pt-4 border-t">
          <button
            onClick={() => navigate('/stock/parts')}
            className="w-full px-4 py-2 rounded-lg border font-medium hover:bg-gray-50"
          >
            Voir toutes les pièces
          </button>
        </div>
      )}
    </div>
  );
}
