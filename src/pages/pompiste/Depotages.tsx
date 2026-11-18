import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import { Plus, Search, X, ArrowDownCircle, Droplets as DropletsIcon } from 'lucide-react';
import { formatCurrency } from '../../utils/formatCurrency';
import { format } from 'date-fns';
import { usePompisteTanks } from '../../hooks/usePompisteTanks';

interface Depotage {
  id: string; depot_date: string; quantity_liters: number; stock_before: number;
  stock_after: number; unit_price: number; total_amount: number;
  observation: string | null; created_at: string;
  tanks?: { name: string };
  fuel_suppliers?: { name: string };
  fuel_products?: { designation: string };
  fuel_purchase_orders?: { order_number: string } | null;
}

const EMPTY = {
  depot_date: new Date().toISOString().split('T')[0],
  tank_id: '', supplier_id: '', purchase_order_id: '', product_id: '',
  quantity_liters: '', unit_price: '', observation: '',
};

export default function Depotages() {
  const { tanks: myTanks, tankIds, loading: tanksLoading, isPompiste } = usePompisteTanks();
  const [depotages, setDepotages] = useState<Depotage[]>([]);
  const [tanks, setTanks] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedTankLevel, setSelectedTankLevel] = useState<number | null>(null);

  useEffect(() => { if (!tanksLoading) { load(); loadRefs(); } }, [tanksLoading, tankIds.join(',')]);

  const load = async () => {
    setLoading(true);
    let q = supabase.from('fuel_depotages')
      .select('*, tanks:tank_id(name), fuel_suppliers:supplier_id(name), fuel_products:product_id(designation), fuel_purchase_orders:purchase_order_id(order_number)')
      .order('created_at', { ascending: false });
    if (isPompiste && tankIds.length > 0) q = q.in('tank_id', tankIds);
    else if (isPompiste) q = q.eq('tank_id', '00000000-0000-0000-0000-000000000000');
    const { data, error } = await q;
    if (error) toast.error('Erreur de chargement');
    else setDepotages((data as Depotage[]) || []);
    setLoading(false);
  };

  const loadRefs = async () => {
    const [t, s, p, po] = await Promise.all([
      (async () => {
        let tq = supabase.from('fuel_tanks').select('id, name, current_level_liters, capacity_liters').eq('is_active', true).order('name');
        if (isPompiste && tankIds.length > 0) tq = tq.in('id', tankIds);
        else if (isPompiste) tq = tq.eq('id', '00000000-0000-0000-0000-000000000000');
        return tq;
      })(),
      supabase.from('fuel_suppliers').select('id, name').eq('is_active', true).order('name'),
      supabase.from('fuel_products').select('id, designation, unit_price').eq('is_active', true).order('designation'),
      supabase.from('fuel_purchase_orders').select('id, order_number').in('status', ['valide', 'livre_partiel']).order('order_number'),
    ]);
    setTanks(t.data || []);
    setSuppliers(s.data || []);
    setProducts(p.data || []);
    setPurchaseOrders(po.data || []);
  };

  const handleTankChange = (tankId: string) => {
    const tank = tanks.find(t => t.id === tankId);
    setSelectedTankLevel(tank ? Number(tank.current_level_liters) : null);
    setForm(f => ({ ...f, tank_id: tankId }));
  };

  const handleProductChange = (productId: string) => {
    const prod = products.find(p => p.id === productId);
    setForm(f => ({ ...f, product_id: productId, unit_price: prod ? String(prod.unit_price) : '' }));
  };

  const handleSave = async () => {
    if (!form.tank_id || !form.supplier_id || !form.product_id || !form.quantity_liters) {
      toast.error('Cuve, fournisseur, produit et quantité obligatoires'); return;
    }
    const qty = parseFloat(form.quantity_liters);
    if (isNaN(qty) || qty <= 0) { toast.error('Quantité invalide'); return; }

    const tank = tanks.find(t => t.id === form.tank_id);
    if (tank) {
      const afterLevel = Number(tank.current_level_liters) + qty;
      if (afterLevel > Number(tank.capacity_liters)) {
        toast.error(`Dépassement capacité cuve ! (capacité ${tank.capacity_liters} L, niveau actuel ${tank.current_level_liters} L)`); return;
      }
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const stockBefore = selectedTankLevel ?? 0;
      const { error } = await supabase.from('fuel_depotages').insert({
        depot_date: form.depot_date,
        tank_id: form.tank_id,
        supplier_id: form.supplier_id,
        purchase_order_id: form.purchase_order_id || null,
        product_id: form.product_id,
        quantity_liters: qty,
        stock_before: stockBefore,
        unit_price: parseFloat(form.unit_price) || 0,
        observation: form.observation.trim() || null,
        pompiste_id: user?.id,
      });
      if (error) throw error;
      toast.success('Dépotage enregistré — stock cuve mis à jour');
      setShowForm(false); load(); loadRefs();
    } catch (e: any) { toast.error(e.message || 'Erreur'); }
    finally { setSaving(false); }
  };

  const qty = parseFloat(form.quantity_liters) || 0;
  const up = parseFloat(form.unit_price) || 0;
  const totalCalc = qty * up;
  const stockAfterCalc = selectedTankLevel !== null ? selectedTankLevel + qty : null;

  const filtered = depotages.filter(d => {
    const q = search.toLowerCase();
    return !q || ((d.tanks as any)?.name || '').toLowerCase().includes(q) || ((d.fuel_suppliers as any)?.name || '').toLowerCase().includes(q);
  });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-1 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <ArrowDownCircle className="w-7 h-7" style={{ color: '#16A34A' }} /> Dépotages
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Entrées carburant dans les cuves</p>
        </div>
        <button onClick={() => { setForm({ ...EMPTY }); setSelectedTankLevel(null); setShowForm(true); }}
          disabled={isPompiste && myTanks.length === 0}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: '#16A34A' }}>
          <Plus className="w-4 h-4" /> Nouveau dépotage
        </button>
      </div>

      {isPompiste && !tanksLoading && myTanks.length === 0 && (
        <div className="rounded-xl border-2 p-6 mb-6 flex items-center gap-4" style={{ borderColor: '#F59E0B', backgroundColor: '#FFFBEB' }}>
          <DropletsIcon className="w-8 h-8 flex-shrink-0" style={{ color: '#F59E0B' }} />
          <div>
            <p className="font-bold text-sm" style={{ color: '#92400E' }}>Aucune cuve ne vous est affectée</p>
            <p className="text-xs mt-1" style={{ color: '#92400E' }}>
              Contactez votre administrateur pour qu'il vous assigne une cuve. Vous pourrez ensuite enregistrer vos dépotages.
            </p>
          </div>
        </div>
      )}

      <div className="relative mb-6 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Cuve, fournisseur…"
          className="w-full pl-9 py-2.5 border rounded-xl text-sm outline-none"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 rounded-full animate-spin" style={{ borderColor: '#16A34A', borderTopColor: 'transparent' }} /></div>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle, #F9FAFB)' }}>
                {['Date', 'Cuve', 'Fournisseur', 'Produit', 'Qté (L)', 'Stock avant', 'Stock après', 'Montant', 'BC lié'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => (
                <tr key={d.id} className="border-t hover:bg-gray-50" style={{ borderColor: 'var(--border)' }}>
                  <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{format(new Date(d.depot_date), 'dd/MM/yyyy')}</td>
                  <td className="px-4 py-3 font-semibold" style={{ color: 'var(--text-primary)' }}>{(d.tanks as any)?.name || '—'}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{(d.fuel_suppliers as any)?.name || '—'}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{(d.fuel_products as any)?.designation || '—'}</td>
                  <td className="px-4 py-3 font-bold" style={{ color: '#16A34A' }}>{Number(d.quantity_liters).toLocaleString()} L</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text-muted)' }}>{Number(d.stock_before).toLocaleString()} L</td>
                  <td className="px-4 py-3 font-semibold" style={{ color: '#16A34A' }}>{Number(d.stock_after).toLocaleString()} L</td>
                  <td className="px-4 py-3 font-bold" style={{ color: 'var(--primary)' }}>{formatCurrency(d.total_amount)}</td>
                  <td className="px-4 py-3 text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{(d.fuel_purchase_orders as any)?.order_number || '—'}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-12 text-center" style={{ color: 'var(--text-muted)' }}>Aucun dépotage enregistré</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setShowForm(false)}>
          <div className="rounded-2xl w-full max-w-lg mx-4 shadow-2xl overflow-hidden" style={{ backgroundColor: 'var(--surface)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-7 pt-7 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <h3 className="font-bold text-lg flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <ArrowDownCircle className="w-5 h-5" style={{ color: '#16A34A' }} /> Nouveau dépotage
              </h3>
              <button onClick={() => setShowForm(false)} className="p-2 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} /></button>
            </div>
            <div className="px-7 py-5 space-y-4 max-h-[65vh] overflow-y-auto">
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Date</label>
                <input type="date" value={form.depot_date} onChange={e => setForm(f => ({ ...f, depot_date: e.target.value }))}
                  className="w-full px-3 py-2.5 border rounded-xl text-sm outline-none"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Cuve *</label>
                <select value={form.tank_id} onChange={e => handleTankChange(e.target.value)}
                  className="w-full px-3 py-2.5 border rounded-xl text-sm"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}>
                  <option value="">— Sélectionner —</option>
                  {tanks.map(t => <option key={t.id} value={t.id}>{t.name} (niveau : {Number(t.current_level_liters).toLocaleString()} L / {Number(t.capacity_liters).toLocaleString()} L)</option>)}
                </select>
              </div>
              {selectedTankLevel !== null && (
                <div className="px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: '#F0FDF4' }}>
                  <span style={{ color: '#16A34A' }}>Stock actuel : <strong>{selectedTankLevel.toLocaleString()} L</strong></span>
                  {stockAfterCalc !== null && qty > 0 && <> → après dépotage : <strong>{stockAfterCalc.toLocaleString()} L</strong></>}
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Fournisseur *</label>
                <select value={form.supplier_id} onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value }))}
                  className="w-full px-3 py-2.5 border rounded-xl text-sm"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}>
                  <option value="">— Sélectionner —</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Bon de commande lié (optionnel)</label>
                <select value={form.purchase_order_id} onChange={e => setForm(f => ({ ...f, purchase_order_id: e.target.value }))}
                  className="w-full px-3 py-2.5 border rounded-xl text-sm"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}>
                  <option value="">Aucun</option>
                  {purchaseOrders.map(po => <option key={po.id} value={po.id}>{po.order_number}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Produit *</label>
                <select value={form.product_id} onChange={e => handleProductChange(e.target.value)}
                  className="w-full px-3 py-2.5 border rounded-xl text-sm"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}>
                  <option value="">— Sélectionner —</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.designation}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Quantité livrée (L) *</label>
                  <input type="number" min={0} value={form.quantity_liters} onChange={e => setForm(f => ({ ...f, quantity_liters: e.target.value }))}
                    className="w-full px-3 py-2.5 border rounded-xl text-sm outline-none"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Prix unitaire (FCFA)</label>
                  <input type="number" min={0} value={form.unit_price} onChange={e => setForm(f => ({ ...f, unit_price: e.target.value }))}
                    className="w-full px-3 py-2.5 border rounded-xl text-sm outline-none"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
                </div>
              </div>
              {totalCalc > 0 && (
                <div className="px-4 py-3 rounded-xl" style={{ backgroundColor: '#F0FDF4' }}>
                  <p className="text-xs font-semibold" style={{ color: '#16A34A' }}>Montant total</p>
                  <p className="text-xl font-black" style={{ color: '#16A34A' }}>{formatCurrency(totalCalc)}</p>
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Observation</label>
                <textarea value={form.observation} onChange={e => setForm(f => ({ ...f, observation: e.target.value }))}
                  rows={2} className="w-full px-3 py-2.5 border rounded-xl text-sm resize-none outline-none"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
              </div>
            </div>
            <div className="flex gap-3 px-7 pb-7">
              <button onClick={() => setShowForm(false)} className="flex-1 px-4 py-2.5 rounded-xl border font-semibold text-sm"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Annuler</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 px-4 py-2.5 rounded-xl text-white font-semibold text-sm disabled:opacity-50"
                style={{ backgroundColor: '#16A34A' }}>{saving ? 'Enregistrement…' : 'Valider le dépotage'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
