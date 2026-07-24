import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import { Plus, Search, X, ArrowUpCircle, AlertTriangle, Droplets as DropletsIcon } from 'lucide-react';
import { formatCurrency } from '../../utils/formatCurrency';
import { format } from 'date-fns';
import { usePompisteTanks } from '../../hooks/usePompisteTanks';

interface Enlevement {
  id: string; enlevement_date: string; license_plate: string | null;
  quantity_liters: number; unit_price: number; total_amount: number;
  stock_before: number; stock_after: number; observation: string | null; created_at: string;
  companies?: { name: string };
  buses?: { registration_number: string; license_plate: string };
  tanks?: { name: string };
  fuel_products?: { designation: string };
  driver?: { full_name: string } | null;
}

const EMPTY = {
  enlevement_date: new Date().toISOString().split('T')[0],
  bus_search: '', bus_id: '', company_id: '', company_name: '', license_plate: '',
  driver_search: '', driver_id: '', driver_name: '',
  tank_id: '', product_id: '', quantity_liters: '', unit_price: '', observation: '',
};

export default function Enlevements() {
  const { tanks: myTanks, tankIds, loading: tanksLoading, isPompiste } = usePompisteTanks();
  const [enlevements, setEnlevements] = useState<Enlevement[]>([]);
  const [tanks, setTanks] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  // bus search
  const [busResults, setBusResults] = useState<any[]>([]);
  const [busSearchLoading, setBusSearchLoading] = useState(false);
  // driver search
  const [driverResults, setDriverResults] = useState<any[]>([]);
  const [driverSearchLoading, setDriverSearchLoading] = useState(false);

  const [selectedTankLevel, setSelectedTankLevel] = useState<number | null>(null);

  useEffect(() => { if (!tanksLoading) { load(); loadRefs(); } }, [tanksLoading, tankIds.join(',')]);

  const load = async () => {
    setLoading(true);
    let q = supabase.from('fuel_enlevements')
      .select('*, companies:company_id(name), tanks:tank_id(name), fuel_products:product_id(designation), driver:driver_id(full_name)')
      .order('created_at', { ascending: false });
    if (isPompiste && tankIds.length > 0) q = q.in('tank_id', tankIds);
    else if (isPompiste) q = q.eq('tank_id', '00000000-0000-0000-0000-000000000000');
    const { data, error } = await q;
    if (error) toast.error('Erreur de chargement');
    else setEnlevements((data as Enlevement[]) || []);
    setLoading(false);
  };

  const loadRefs = async () => {
    const [t, p] = await Promise.all([
      (async () => {
        let tq = supabase.from('fuel_tanks').select('id, name, current_level_liters, capacity_liters').eq('is_active', true).order('name');
        if (isPompiste && tankIds.length > 0) tq = tq.in('id', tankIds);
        else if (isPompiste) tq = tq.eq('id', '00000000-0000-0000-0000-000000000000');
        return tq;
      })(),
      supabase.from('fuel_products').select('id, designation, unit_price').eq('is_active', true).order('designation'),
    ]);
    setTanks(t.data || []);
    setProducts(p.data || []);
  };

  // dynamic bus search
  useEffect(() => {
    if (!form.bus_search || form.bus_id) return;
    const timer = setTimeout(async () => {
      setBusSearchLoading(true);
      const { data } = await supabase.from('buses')
        .select('id, registration_number, company_id, companies:company_id(id, name)')
        .ilike('registration_number', `%${form.bus_search}%`)
        .eq('is_active', true)
        .limit(8);
      setBusResults(data || []);
      setBusSearchLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [form.bus_search]);

  // dynamic driver search
  useEffect(() => {
    if (!form.driver_search || form.driver_id) return;
    const timer = setTimeout(async () => {
      setDriverSearchLoading(true);
      const { data } = await supabase.from('users')
        .select('id, full_name')
        .ilike('full_name', `%${form.driver_search}%`)
        .eq('role', 'chauffeur')
        .eq('is_active', true)
        .limit(8);
      setDriverResults(data || []);
      setDriverSearchLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [form.driver_search]);

  const selectBus = (bus: any) => {
    setForm(f => ({
      ...f,
      bus_id: bus.id,
      license_plate: bus.registration_number,
      bus_search: bus.registration_number,
      company_id: (bus.companies as any)?.id || bus.company_id || '',
      company_name: (bus.companies as any)?.name || '',
    }));
    setBusResults([]);
  };

  const selectDriver = (d: any) => {
    setForm(f => ({ ...f, driver_id: d.id, driver_name: d.full_name, driver_search: d.full_name }));
    setDriverResults([]);
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
    if (!form.bus_id || !form.tank_id || !form.product_id || !form.quantity_liters) {
      toast.error('Bus, cuve, produit et quantité obligatoires'); return;
    }
    const qty = parseFloat(form.quantity_liters);
    if (isNaN(qty) || qty <= 0) { toast.error('Quantité invalide'); return; }
    const tank = tanks.find(t => t.id === form.tank_id);
    if (tank && qty > Number(tank.current_level_liters)) {
      toast.error(`Stock insuffisant ! Disponible : ${Number(tank.current_level_liters).toLocaleString()} L`); return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const stockBefore = selectedTankLevel ?? 0;
      const { error } = await supabase.from('fuel_enlevements').insert({
        enlevement_date: form.enlevement_date,
        company_id: form.company_id || null,
        bus_id: form.bus_id,
        license_plate: form.license_plate,
        driver_id: form.driver_id || null,
        tank_id: form.tank_id,
        product_id: form.product_id,
        quantity_liters: qty,
        unit_price: parseFloat(form.unit_price) || 0,
        stock_before: stockBefore,
        pompiste_id: user?.id,
        observation: form.observation.trim() || null,
      });
      if (error) throw error;
      toast.success('Enlèvement enregistré — stock cuve mis à jour');
      setShowForm(false); load(); loadRefs();
    } catch (e: any) { toast.error(e.message || 'Erreur'); }
    finally { setSaving(false); }
  };

  const qty = parseFloat(form.quantity_liters) || 0;
  const up = parseFloat(form.unit_price) || 0;
  const totalCalc = qty * up;
  const stockAfterCalc = selectedTankLevel !== null ? selectedTankLevel - qty : null;
  const stockInsufficient = selectedTankLevel !== null && qty > selectedTankLevel;

  const filtered = enlevements.filter(e => {
    const q = search.toLowerCase();
    return !q || (e.license_plate || '').toLowerCase().includes(q) || ((e.companies as any)?.name || '').toLowerCase().includes(q);
  });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-1 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <ArrowUpCircle className="w-7 h-7" style={{ color: '#DC2626' }} /> Enlèvements
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Sorties carburant pour les bus</p>
        </div>
        <button onClick={() => { setForm({ ...EMPTY }); setSelectedTankLevel(null); setBusResults([]); setDriverResults([]); setShowForm(true); }}
          disabled={isPompiste && myTanks.length === 0}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: '#DC2626' }}>
          <Plus className="w-4 h-4" /> Nouvel enlèvement
        </button>
      </div>

      {isPompiste && !tanksLoading && myTanks.length === 0 && (
        <div className="rounded-xl border-2 p-6 mb-6 flex items-center gap-4" style={{ borderColor: '#F59E0B', backgroundColor: '#FFFBEB' }}>
          <DropletsIcon className="w-8 h-8 flex-shrink-0" style={{ color: '#F59E0B' }} />
          <div>
            <p className="font-bold text-sm" style={{ color: '#92400E' }}>Aucune cuve ne vous est affectée</p>
            <p className="text-xs mt-1" style={{ color: '#92400E' }}>
              Contactez votre administrateur pour qu'il vous assigne une cuve. Vous pourrez ensuite enregistrer vos enlèvements.
            </p>
          </div>
        </div>
      )}

      <div className="relative mb-6 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Plaque, société…"
          className="w-full pl-9 py-2.5 border rounded-xl text-sm outline-none"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 rounded-full animate-spin" style={{ borderColor: '#DC2626', borderTopColor: 'transparent' }} /></div>
      ) : (
        <div className="rounded-xl border overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle, #F9FAFB)' }}>
                {['Date', 'Société', 'Plaque', 'Produit', 'Cuve', 'Qté (L)', 'Stock avant', 'Stock après', 'Montant'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id} className="border-t hover:bg-gray-50" style={{ borderColor: 'var(--border)' }}>
                  <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{format(new Date(e.enlevement_date), 'dd/MM/yyyy')}</td>
                  <td className="px-4 py-3 font-semibold" style={{ color: 'var(--text-primary)' }}>{(e.companies as any)?.name || '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{e.license_plate || '—'}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{(e.fuel_products as any)?.designation || '—'}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{(e.tanks as any)?.name || '—'}</td>
                  <td className="px-4 py-3 font-bold" style={{ color: '#DC2626' }}>{Number(e.quantity_liters).toLocaleString()} L</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text-muted)' }}>{Number(e.stock_before).toLocaleString()} L</td>
                  <td className="px-4 py-3 font-semibold" style={{ color: '#DC2626' }}>{Number(e.stock_after).toLocaleString()} L</td>
                  <td className="px-4 py-3 font-bold" style={{ color: 'var(--primary)' }}>{formatCurrency(e.total_amount)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-12 text-center" style={{ color: 'var(--text-muted)' }}>Aucun enlèvement enregistré</td></tr>
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
                <ArrowUpCircle className="w-5 h-5" style={{ color: '#DC2626' }} /> Nouvel enlèvement
              </h3>
              <button onClick={() => setShowForm(false)} className="p-2 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} /></button>
            </div>
            <div className="px-7 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Date</label>
                <input type="date" value={form.enlevement_date} onChange={e => setForm(f => ({ ...f, enlevement_date: e.target.value }))}
                  className="w-full px-3 py-2.5 border rounded-xl text-sm outline-none"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
              </div>

              {/* bus search */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Rechercher un bus (plaque) *
                </label>
                <div className="relative">
                  <input type="text" value={form.bus_search}
                    onChange={e => setForm(f => ({ ...f, bus_search: e.target.value, bus_id: '', company_id: '', company_name: '', license_plate: '' }))}
                    placeholder="AB-1234-CI…"
                    className="w-full px-3 py-2.5 border rounded-xl text-sm outline-none"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
                  {busSearchLoading && <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />}
                </div>
                {busResults.length > 0 && !form.bus_id && (
                  <div className="mt-1 border rounded-xl overflow-hidden shadow-md" style={{ borderColor: 'var(--border)' }}>
                    {busResults.map(bus => (
                      <button key={bus.id} onClick={() => selectBus(bus)}
                        className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 border-b last:border-0 flex items-center justify-between"
                        style={{ borderColor: 'var(--border)' }}>
                        <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{bus.registration_number}</span>
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{(bus.companies as any)?.name || '—'}</span>
                      </button>
                    ))}
                  </div>
                )}
                {form.company_name && (
                  <p className="text-xs mt-1 font-semibold" style={{ color: '#16A34A' }}>Société : {form.company_name}</p>
                )}
              </div>

              {/* driver search */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Chauffeur (optionnel)</label>
                <div className="relative">
                  <input type="text" value={form.driver_search}
                    onChange={e => setForm(f => ({ ...f, driver_search: e.target.value, driver_id: '', driver_name: '' }))}
                    placeholder="Rechercher par nom…"
                    className="w-full px-3 py-2.5 border rounded-xl text-sm outline-none"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
                  {driverSearchLoading && <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />}
                </div>
                {driverResults.length > 0 && !form.driver_id && (
                  <div className="mt-1 border rounded-xl overflow-hidden shadow-md" style={{ borderColor: 'var(--border)' }}>
                    {driverResults.map(d => (
                      <button key={d.id} onClick={() => selectDriver(d)}
                        className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 border-b last:border-0"
                        style={{ color: 'var(--text-primary)', borderColor: 'var(--border)' }}>
                        {d.full_name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* tank */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Cuve *</label>
                <select value={form.tank_id} onChange={e => handleTankChange(e.target.value)}
                  className="w-full px-3 py-2.5 border rounded-xl text-sm"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}>
                  <option value="">— Sélectionner —</option>
                  {tanks.map(t => <option key={t.id} value={t.id}>{t.name} (dispo : {Number(t.current_level_liters).toLocaleString()} L)</option>)}
                </select>
              </div>

              {/* product */}
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
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Quantité (L) *</label>
                  <input type="number" min={0} value={form.quantity_liters} onChange={e => setForm(f => ({ ...f, quantity_liters: e.target.value }))}
                    className="w-full px-3 py-2.5 border rounded-xl text-sm outline-none"
                    style={{ borderColor: stockInsufficient ? '#EF4444' : 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Prix unitaire (FCFA)</label>
                  <input type="number" min={0} value={form.unit_price} onChange={e => setForm(f => ({ ...f, unit_price: e.target.value }))}
                    className="w-full px-3 py-2.5 border rounded-xl text-sm outline-none"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
                </div>
              </div>

              {stockInsufficient && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm" style={{ backgroundColor: '#FEF2F2', color: '#DC2626' }}>
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  Stock insuffisant — disponible : {selectedTankLevel?.toLocaleString()} L
                </div>
              )}

              {selectedTankLevel !== null && qty > 0 && !stockInsufficient && (
                <div className="px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: '#FEF2F2' }}>
                  <span style={{ color: '#DC2626' }}>Stock après enlèvement : <strong>{stockAfterCalc?.toLocaleString()} L</strong></span>
                </div>
              )}

              {totalCalc > 0 && (
                <div className="px-4 py-3 rounded-xl" style={{ backgroundColor: '#FEF2F2' }}>
                  <p className="text-xs font-semibold" style={{ color: '#DC2626' }}>Montant total</p>
                  <p className="text-xl font-black" style={{ color: '#DC2626' }}>{formatCurrency(totalCalc)}</p>
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
              <button onClick={handleSave} disabled={saving || stockInsufficient}
                className="flex-1 px-4 py-2.5 rounded-xl text-white font-semibold text-sm disabled:opacity-50"
                style={{ backgroundColor: '#DC2626' }}>{saving ? 'Enregistrement…' : 'Valider l\'enlèvement'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
