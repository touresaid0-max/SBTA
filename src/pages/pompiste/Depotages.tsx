import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import { Plus, Search, X, ArrowDownCircle, Droplets as DropletsIcon, Timer, Printer, Ruler, AlertTriangle } from 'lucide-react';
import { formatCurrency } from '../../utils/formatCurrency';
import { format } from 'date-fns';
import { usePompisteTanks } from '../../hooks/usePompisteTanks';
import { printDepotageBordereau, type DepotageBordereauData } from '../../utils/printDepotageBordereau';

/*
 * Dépotage en deux étapes (demande du responsable carburant et du DG, 17/11/2026) :
 *  1. arrivée de la citerne : quantité annoncée (bon du fournisseur), stock de départ, écart
 *     constaté sur la citerne au contrôle « contre-plein » ; la cuve reçoit provisoirement
 *     l'annoncé ;
 *  2. une heure après, mesure à la règle : la base calcule le dépotage réel et les écarts, et met
 *     la cuve au niveau mesuré (record_depotage_measure).
 * L'écart, en plus ou en moins, figure sur le bordereau.
 */

// Rest of the fuel in the tank before measuring
const REST_MINUTES = 60;
// Above this share of the announced quantity, an observation is required with the measurement
const NOTE_THRESHOLD_PCT = 0.5;

interface Depotage {
  id: string; depot_date: string; tank_id: string; quantity_liters: number; stock_before: number;
  stock_after: number; unit_price: number; total_amount: number;
  observation: string | null; created_at: string;
  delivery_note_number: string | null; arrival_at: string | null;
  announced_quantity: number | null; citerne_variance: number | null;
  measured_level_after: number | null; withdrawn_during_rest: number | null;
  measured_at: string | null; measured_by: string | null; measure_observation: string | null;
  measure_status: 'en_attente_mesure' | 'mesure' | 'sans_mesure' | null;
  variance_total: number | null; variance_unloading: number | null;
  pompiste_id: string | null;
  tanks?: { name: string; capacity_liters: number } | null;
  fuel_suppliers?: { name: string } | null;
  fuel_products?: { designation: string } | null;
  fuel_purchase_orders?: { order_number: string } | null;
}

type CiterneState = 'conforme' | 'manque' | 'surplus';

const pad = (x: number) => String(x).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const localDateTime = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

const EMPTY = {
  depot_date: todayStr(), arrival_time: nowTime(),
  tank_id: '', supplier_id: '', purchase_order_id: '', product_id: '',
  delivery_note_number: '', announced_quantity: '', stock_before: '',
  citerne_state: 'conforme' as CiterneState, citerne_liters: '',
  unit_price: '', observation: '',
};

const L = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(Number(v)).toLocaleString('fr-FR')} L`);
const signedL = (v: number | null | undefined) => {
  if (v === null || v === undefined) return '—';
  const x = Math.round(Number(v));
  return `${x > 0 ? '+ ' : x < 0 ? '− ' : ''}${Math.abs(x).toLocaleString('fr-FR')} L`;
};
const varianceColor = (v: number | null | undefined) =>
  v === null || v === undefined ? 'var(--text-muted)' : v < 0 ? '#AF3029' : v > 0 ? '#1D6FA4' : 'var(--text-secondary)';
const field = 'w-full px-3 py-2.5 border rounded-xl text-sm outline-none';
const fieldStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' } as const;
const lbl = 'block text-xs font-semibold mb-1.5';

export default function Depotages() {
  const { tanks: myTanks, tankIds, loading: tanksLoading, isPompiste } = usePompisteTanks();
  const [depotages, setDepotages] = useState<Depotage[]>([]);
  const [tanks, setTanks] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [measuring, setMeasuring] = useState<Depotage | null>(null);

  useEffect(() => { if (!tanksLoading) { load(); loadRefs(); } }, [tanksLoading, tankIds.join(',')]);

  const load = async () => {
    setLoading(true);
    let q = supabase.from('fuel_depotages')
      .select('*, tanks:tank_id(name, capacity_liters), fuel_suppliers:supplier_id(name), fuel_products:product_id(designation), fuel_purchase_orders:purchase_order_id(order_number)')
      .order('created_at', { ascending: false });
    if (isPompiste && tankIds.length > 0) q = q.in('tank_id', tankIds);
    else if (isPompiste) q = q.eq('tank_id', '00000000-0000-0000-0000-000000000000');
    const { data, error } = await q;
    if (error) { toast.error('Erreur de chargement'); setLoading(false); return; }
    const rows = (data as Depotage[]) || [];
    setDepotages(rows);
    // Names of the pompistes who recorded or measured, for the bordereau
    const ids = Array.from(new Set(rows.flatMap(r => [r.pompiste_id, r.measured_by]).filter(Boolean))) as string[];
    if (ids.length > 0) {
      const { data: users } = await supabase.from('users').select('id, full_name').in('id', ids);
      setNames(Object.fromEntries(((users ?? []) as { id: string; full_name: string | null }[]).map(u => [u.id, u.full_name ?? ''])));
    }
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

  const pending = useMemo(() => depotages.filter(d => d.measure_status === 'en_attente_mesure'), [depotages]);
  const pendingTankIds = useMemo(() => new Set(pending.map(d => d.tank_id)), [pending]);

  // Totals of the month, for the measured deliveries
  const monthTotals = useMemo(() => {
    const now = new Date();
    const inMonth = depotages.filter(d => {
      const at = new Date(d.arrival_at || d.created_at);
      return d.measure_status === 'mesure' && at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth();
    });
    return inMonth.reduce((acc, d) => ({
      announced: acc.announced + Number(d.announced_quantity ?? 0),
      received: acc.received + Number(d.quantity_liters ?? 0),
      variance: acc.variance + Number(d.variance_total ?? 0),
      value: acc.value + Number(d.variance_total ?? 0) * Number(d.unit_price ?? 0),
    }), { announced: 0, received: 0, variance: 0, value: 0 });
  }, [depotages]);

  const handleTankChange = (tankId: string) => {
    const tank = tanks.find(t => t.id === tankId);
    setForm(f => ({ ...f, tank_id: tankId, stock_before: tank ? String(Number(tank.current_level_liters)) : '' }));
  };

  const handleProductChange = (productId: string) => {
    const prod = products.find(p => p.id === productId);
    setForm(f => ({ ...f, product_id: productId, unit_price: prod ? String(prod.unit_price) : '' }));
  };

  const announced = parseFloat(form.announced_quantity) || 0;
  const stockBefore = parseFloat(form.stock_before);
  const citerneLiters = Math.abs(parseFloat(form.citerne_liters) || 0);
  const citerneVariance = form.citerne_state === 'manque' ? -citerneLiters : form.citerne_state === 'surplus' ? citerneLiters : 0;
  const selectedTank = tanks.find(t => t.id === form.tank_id);
  const expected = (isNaN(stockBefore) ? 0 : stockBefore) + announced;

  const handleSave = async () => {
    if (!form.tank_id || !form.supplier_id || !form.product_id || !form.announced_quantity) {
      toast.error('Cuve, fournisseur, produit et quantité annoncée obligatoires'); return;
    }
    if (announced <= 0) { toast.error('Quantité annoncée invalide'); return; }
    if (isNaN(stockBefore) || stockBefore < 0) { toast.error('Stock de départ invalide'); return; }
    if (form.citerne_state !== 'conforme' && citerneLiters <= 0) { toast.error('Indiquez l\'écart constaté sur la citerne, ou choisissez « Conforme »'); return; }
    if (citerneLiters >= announced) { toast.error('Écart citerne supérieur à la quantité annoncée'); return; }
    if (selectedTank && Number(selectedTank.capacity_liters) > 0 && expected > Number(selectedTank.capacity_liters)) {
      toast.error(`Dépassement de capacité : ${expected.toLocaleString('fr-FR')} L attendus pour ${Number(selectedTank.capacity_liters).toLocaleString('fr-FR')} L`); return;
    }
    if (pendingTankIds.has(form.tank_id)) { toast.error('Un dépotage de cette cuve attend encore sa mesure : saisissez-la d\'abord'); return; }
    const arrival = new Date(`${form.depot_date}T${form.arrival_time || '00:00'}:00`);
    if (isNaN(arrival.getTime()) || arrival.getTime() > Date.now() + 5 * 60_000) { toast.error('Heure d\'arrivée invalide (dans le futur)'); return; }

    setSaving(true);
    try {
      const { error } = await supabase.from('fuel_depotages').insert({
        depot_date: form.depot_date,
        arrival_at: arrival.toISOString(),
        tank_id: form.tank_id,
        supplier_id: form.supplier_id,
        purchase_order_id: form.purchase_order_id || null,
        product_id: form.product_id,
        delivery_note_number: form.delivery_note_number.trim() || null,
        announced_quantity: announced,
        // Until the measurement the tank holds the announced quantity (set again by the database)
        quantity_liters: announced,
        stock_before: stockBefore,
        citerne_variance: citerneVariance,
        unit_price: parseFloat(form.unit_price) || 0,
        observation: form.observation.trim() || null,
      });
      if (error) throw error;
      const measureAt = new Date(arrival.getTime() + REST_MINUTES * 60_000);
      toast.success(`Arrivée enregistrée — mesure à la règle à faire à partir de ${pad(measureAt.getHours())}:${pad(measureAt.getMinutes())}`);
      setShowForm(false); load(); loadRefs();
    } catch (e: any) { toast.error(e.message || 'Erreur'); }
    finally { setSaving(false); }
  };

  const bordereauData = (d: Depotage): DepotageBordereauData => ({
    tankName: d.tanks?.name ?? '—',
    supplierName: d.fuel_suppliers?.name ?? '—',
    productName: d.fuel_products?.designation ?? '—',
    deliveryNote: d.delivery_note_number,
    arrivalAt: d.arrival_at || d.created_at,
    measuredAt: d.measured_at,
    stockBefore: Number(d.stock_before),
    announced: Number(d.announced_quantity ?? d.quantity_liters),
    measuredLevel: d.measure_status === 'mesure' ? Number(d.measured_level_after) : null,
    received: d.measure_status === 'mesure' ? Number(d.quantity_liters) : null,
    withdrawnDuringRest: Number(d.withdrawn_during_rest ?? 0),
    varianceTotal: d.measure_status === 'mesure' ? Number(d.variance_total) : null,
    varianceLoading: Number(d.citerne_variance ?? 0),
    varianceUnloading: d.measure_status === 'mesure' ? Number(d.variance_unloading) : null,
    unitPrice: Number(d.unit_price ?? 0),
    observation: [d.observation, d.measure_observation].filter(Boolean).join(' — ') || null,
    pompisteName: (d.measured_by && names[d.measured_by]) || (d.pompiste_id && names[d.pompiste_id]) || null,
  });

  const filtered = depotages.filter(d => {
    const q = search.toLowerCase();
    return !q || (d.tanks?.name || '').toLowerCase().includes(q) || (d.fuel_suppliers?.name || '').toLowerCase().includes(q)
      || (d.delivery_note_number || '').toLowerCase().includes(q);
  });

  const statusBadge = (d: Depotage) => {
    if (d.measure_status === 'en_attente_mesure') return { label: 'En attente de mesure', bg: '#FEF3C7', color: '#92400E' };
    if (d.measure_status === 'sans_mesure') return { label: 'Sans mesure', bg: 'var(--surface-raised)', color: 'var(--text-muted)' };
    const v = Number(d.variance_total ?? 0);
    if (v < 0) return { label: 'Mesuré · manque', bg: '#f8d7d5', color: '#AF3029' };
    if (v > 0) return { label: 'Mesuré · surplus', bg: '#DBEAFE', color: '#1D6FA4' };
    return { label: 'Mesuré', bg: '#d4edda', color: '#0B7439' };
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold mb-1 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <ArrowDownCircle className="w-7 h-7" style={{ color: '#16A34A' }} /> Dépotages
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Entrées carburant dans les cuves — quantité annoncée, puis mesure à la règle une heure après</p>
        </div>
        <button onClick={() => { setForm({ ...EMPTY, depot_date: todayStr(), arrival_time: nowTime() }); setShowForm(true); }}
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

      {/* Measurements to make */}
      {pending.map(d => {
        const due = new Date(new Date(d.arrival_at || d.created_at).getTime() + REST_MINUTES * 60_000);
        return (
          <div key={d.id} className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3" style={{ borderColor: '#FCD34D', backgroundColor: '#FEF3C7' }}>
            <p className="text-sm" style={{ color: '#92400E' }}>
              <Timer className="mr-1.5 inline h-4 w-4" />
              <b>Mesure en attente</b> — {d.tanks?.name ?? 'Cuve'}, {d.fuel_suppliers?.name ?? ''} : {L(d.announced_quantity)} annoncés, arrivée à {format(new Date(d.arrival_at || d.created_at), 'HH:mm')}.
              {' '}{due.getTime() > Date.now() ? `Mesure possible à partir de ${format(due, 'HH:mm')}.` : 'Mesure à faire maintenant.'}
            </p>
            <button onClick={() => setMeasuring(d)} className="flex items-center gap-1.5 rounded-xl border-2 bg-white px-4 py-2 text-sm font-bold" style={{ borderColor: '#FCD34D', color: '#92400E' }}>
              <Ruler className="h-4 w-4" /> Saisir la mesure
            </button>
          </div>
        );
      })}

      <div className="my-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Annoncé ce mois (mesurés)', value: L(monthTotals.announced), color: 'var(--text-primary)' },
          { label: 'Réellement reçu', value: L(monthTotals.received), color: 'var(--text-primary)' },
          { label: 'Écart du mois', value: signedL(monthTotals.variance), color: varianceColor(monthTotals.variance) },
          { label: 'Valeur de l\'écart', value: `${monthTotals.value > 0 ? '+ ' : monthTotals.value < 0 ? '− ' : ''}${formatCurrency(Math.abs(monthTotals.value))}`, color: varianceColor(monthTotals.value) },
        ].map(k => (
          <div key={k.label} className="rounded-xl border px-4 py-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{k.label}</p>
            <p className="text-xl font-bold" style={{ color: k.color }}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Cuve, fournisseur, bon de livraison…"
          className="w-full pl-9 py-2.5 border rounded-xl text-sm outline-none" style={fieldStyle} />
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 rounded-full animate-spin" style={{ borderColor: '#16A34A', borderTopColor: 'transparent' }} /></div>
      ) : (
        <div className="rounded-xl border overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle, #F9FAFB)' }}>
                {['Arrivée', 'Cuve', 'Fournisseur', 'Annoncé', 'Réel', 'Écart chargement', 'Écart dépotage', 'Écart total', 'Montant', 'Statut', ''].map((h, i) => (
                  <th key={h || i} className={`px-3 py-3 text-xs font-semibold uppercase tracking-wide ${i >= 3 && i <= 8 ? 'text-right' : 'text-left'}`} style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => {
                const b = statusBadge(d);
                const measured = d.measure_status === 'mesure';
                return (
                  <tr key={d.id} className="border-t hover:bg-gray-50" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-3 py-3 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{format(new Date(d.arrival_at || d.created_at), 'dd/MM/yyyy HH:mm')}</td>
                    <td className="px-3 py-3 font-semibold" style={{ color: 'var(--text-primary)' }}>{d.tanks?.name || '—'}</td>
                    <td className="px-3 py-3" style={{ color: 'var(--text-secondary)' }}>
                      {d.fuel_suppliers?.name || '—'}
                      {d.delivery_note_number && <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>BL {d.delivery_note_number}</span>}
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{L(d.announced_quantity ?? d.quantity_liters)}</td>
                    <td className="px-3 py-3 text-right whitespace-nowrap font-bold" style={{ color: '#16A34A' }}>{measured || d.measure_status === 'sans_mesure' ? L(d.quantity_liters) : '—'}</td>
                    <td className="px-3 py-3 text-right whitespace-nowrap" style={{ color: varianceColor(d.measure_status === 'sans_mesure' ? null : d.citerne_variance) }}>{d.measure_status === 'sans_mesure' ? '—' : signedL(d.citerne_variance)}</td>
                    <td className="px-3 py-3 text-right whitespace-nowrap" style={{ color: varianceColor(d.variance_unloading) }}>{signedL(d.variance_unloading)}</td>
                    <td className="px-3 py-3 text-right whitespace-nowrap font-bold" style={{ color: varianceColor(d.variance_total) }}>{signedL(d.variance_total)}</td>
                    <td className="px-3 py-3 text-right whitespace-nowrap font-bold" style={{ color: 'var(--primary)' }}>{formatCurrency(d.total_amount)}</td>
                    <td className="px-3 py-3"><span className="inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold" style={{ backgroundColor: b.bg, color: b.color }}>{b.label}</span></td>
                    <td className="px-3 py-3 whitespace-nowrap text-right">
                      {d.measure_status === 'en_attente_mesure' && (
                        <button onClick={() => setMeasuring(d)} className="mr-3 inline-flex items-center gap-1 text-xs font-bold" style={{ color: 'var(--primary)' }}>
                          <Ruler className="h-3.5 w-3.5" /> Mesurer
                        </button>
                      )}
                      <button onClick={() => printDepotageBordereau(bordereauData(d))} className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }} title="Imprimer le bordereau de dépotage">
                        <Printer className="h-3.5 w-3.5" /> Bordereau
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={11} className="px-4 py-12 text-center" style={{ color: 'var(--text-muted)' }}>Aucun dépotage enregistré</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>Rouge : manque · Bleu : surplus · Après la mesure, la cuve prend le niveau mesuré, pas la quantité annoncée.</p>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setShowForm(false)}>
          <div className="rounded-2xl w-full max-w-2xl mx-4 shadow-2xl overflow-hidden" style={{ backgroundColor: 'var(--surface)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-7 pt-6 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <div>
                <h3 className="font-bold text-lg flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <ArrowDownCircle className="w-5 h-5" style={{ color: '#16A34A' }} /> Nouveau dépotage
                </h3>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Étape 1 : arrivée de la citerne · Étape 2 : mesure à la règle, {REST_MINUTES} min après</p>
              </div>
              <button onClick={() => setShowForm(false)} className="p-2 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} /></button>
            </div>
            <div className="px-7 py-5 grid grid-cols-2 gap-4 max-h-[65vh] overflow-y-auto">
              <div>
                <label className={lbl} style={{ color: 'var(--text-secondary)' }}>Date d'arrivée</label>
                <input type="date" value={form.depot_date} max={todayStr()} onChange={e => setForm(f => ({ ...f, depot_date: e.target.value }))} className={field} style={fieldStyle} />
              </div>
              <div>
                <label className={lbl} style={{ color: 'var(--text-secondary)' }}>Heure d'arrivée</label>
                <input type="time" value={form.arrival_time} onChange={e => setForm(f => ({ ...f, arrival_time: e.target.value }))} className={field} style={fieldStyle} />
              </div>
              <div className="col-span-2">
                <label className={lbl} style={{ color: 'var(--text-secondary)' }}>Cuve *</label>
                <select value={form.tank_id} onChange={e => handleTankChange(e.target.value)} className={field} style={fieldStyle}>
                  <option value="">— Sélectionner —</option>
                  {tanks.map(t => (
                    <option key={t.id} value={t.id} disabled={pendingTankIds.has(t.id)}>
                      {t.name} (niveau : {Number(t.current_level_liters).toLocaleString('fr-FR')} L / {Number(t.capacity_liters).toLocaleString('fr-FR')} L){pendingTankIds.has(t.id) ? ' — mesure en attente' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={lbl} style={{ color: 'var(--text-secondary)' }}>Fournisseur *</label>
                <select value={form.supplier_id} onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value }))} className={field} style={fieldStyle}>
                  <option value="">— Sélectionner —</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className={lbl} style={{ color: 'var(--text-secondary)' }}>Produit *</label>
                <select value={form.product_id} onChange={e => handleProductChange(e.target.value)} className={field} style={fieldStyle}>
                  <option value="">— Sélectionner —</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.designation}</option>)}
                </select>
              </div>
              <div>
                <label className={lbl} style={{ color: 'var(--text-secondary)' }}>N° du bon de livraison</label>
                <input value={form.delivery_note_number} maxLength={60} onChange={e => setForm(f => ({ ...f, delivery_note_number: e.target.value }))} className={field} style={fieldStyle} />
              </div>
              <div>
                <label className={lbl} style={{ color: 'var(--text-secondary)' }}>Bon de commande lié (facultatif)</label>
                <select value={form.purchase_order_id} onChange={e => setForm(f => ({ ...f, purchase_order_id: e.target.value }))} className={field} style={fieldStyle}>
                  <option value="">Aucun</option>
                  {purchaseOrders.map(po => <option key={po.id} value={po.id}>{po.order_number}</option>)}
                </select>
              </div>
              <div>
                <label className={lbl} style={{ color: 'var(--text-secondary)' }}>Quantité annoncée (bon du fournisseur, L) *</label>
                <input type="number" min={0} value={form.announced_quantity} onChange={e => setForm(f => ({ ...f, announced_quantity: e.target.value }))} className={field} style={{ ...fieldStyle, borderColor: 'var(--primary)' }} />
              </div>
              <div>
                <label className={lbl} style={{ color: 'var(--text-secondary)' }}>Stock de départ de la cuve (L) *</label>
                <input type="number" min={0} value={form.stock_before} onChange={e => setForm(f => ({ ...f, stock_before: e.target.value }))} className={field} style={{ ...fieldStyle, borderColor: 'var(--primary)' }} />
                {selectedTank && <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>Proposé : niveau théorique {Number(selectedTank.current_level_liters).toLocaleString('fr-FR')} L — modifiable</p>}
              </div>
              <div className="col-span-2">
                <label className={lbl} style={{ color: 'var(--text-secondary)' }}>Écart constaté sur la citerne avant dépotage (contrôle contre-plein)</label>
                <div className="flex flex-wrap items-center gap-2">
                  {([['conforme', 'Conforme'], ['manque', 'Manque (−)'], ['surplus', 'Surplus (+)']] as [CiterneState, string][]).map(([k, label]) => (
                    <button key={k} type="button" onClick={() => setForm(f => ({ ...f, citerne_state: k, citerne_liters: k === 'conforme' ? '' : f.citerne_liters }))}
                      className="rounded-xl border-2 px-3 py-2 text-sm font-semibold"
                      style={form.citerne_state === k ? { borderColor: 'var(--primary)', backgroundColor: 'var(--primary-light)', color: 'var(--primary)' } : { borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                      {label}
                    </button>
                  ))}
                  {form.citerne_state !== 'conforme' && (
                    <input type="number" min={0} placeholder="Litres" value={form.citerne_liters} onChange={e => setForm(f => ({ ...f, citerne_liters: e.target.value }))}
                      className="w-32 px-3 py-2 border rounded-xl text-sm outline-none" style={fieldStyle} />
                  )}
                </div>
              </div>
              <div>
                <label className={lbl} style={{ color: 'var(--text-secondary)' }}>Prix du litre (FCFA)</label>
                <input type="number" min={0} value={form.unit_price} onChange={e => setForm(f => ({ ...f, unit_price: e.target.value }))} className={field} style={fieldStyle} />
              </div>
              <div>
                <label className={lbl} style={{ color: 'var(--text-secondary)' }}>Observation</label>
                <input value={form.observation} maxLength={300} onChange={e => setForm(f => ({ ...f, observation: e.target.value }))} className={field} style={fieldStyle} />
              </div>
              {announced > 0 && !isNaN(stockBefore) && (
                <div className="col-span-2 rounded-xl px-4 py-3 text-sm" style={{ backgroundColor: 'var(--surface-raised)' }}>
                  <div className="flex justify-between"><span>Stock de départ</span><b>{L(stockBefore)}</b></div>
                  <div className="flex justify-between"><span>+ Quantité annoncée</span><b>{L(announced)}</b></div>
                  {citerneVariance !== 0 && <div className="flex justify-between" style={{ color: varianceColor(citerneVariance) }}><span>Écart citerne (contre-plein)</span><b>{signedL(citerneVariance)}</b></div>}
                  <div className="mt-1 flex justify-between border-t pt-1.5" style={{ borderColor: 'var(--border)' }}><b>Total attendu en cuve</b><b>{L(expected)}</b></div>
                  <div className="flex justify-between" style={{ color: '#D97706' }}><span>Mesure à la règle à faire à partir de</span><b>{(() => { const a = new Date(`${form.depot_date}T${form.arrival_time || '00:00'}:00`); const m = new Date(a.getTime() + REST_MINUTES * 60_000); return isNaN(m.getTime()) ? '—' : `${pad(m.getHours())}:${pad(m.getMinutes())}`; })()}</b></div>
                </div>
              )}
            </div>
            <div className="flex gap-3 px-7 pb-6">
              <button onClick={() => setShowForm(false)} className="flex-1 px-4 py-2.5 rounded-xl border font-semibold text-sm" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Annuler</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 px-4 py-2.5 rounded-xl text-white font-semibold text-sm disabled:opacity-50" style={{ backgroundColor: '#16A34A' }}>
                {saving ? 'Enregistrement…' : 'Enregistrer l\'arrivée'}
              </button>
            </div>
          </div>
        </div>
      )}

      {measuring && (
        <MeasureModal
          depotage={measuring}
          onClose={() => setMeasuring(null)}
          onDone={() => { load(); loadRefs(); }}
          onPrint={async () => {
            const { data } = await supabase.from('fuel_depotages')
              .select('*, tanks:tank_id(name, capacity_liters), fuel_suppliers:supplier_id(name), fuel_products:product_id(designation), fuel_purchase_orders:purchase_order_id(order_number)')
              .eq('id', measuring.id).maybeSingle();
            if (data) printDepotageBordereau(bordereauData(data as Depotage));
          }}
        />
      )}
    </div>
  );
}

function MeasureModal({ depotage: d, onClose, onDone, onPrint }: { depotage: Depotage; onClose: () => void; onDone: () => void; onPrint: () => void }) {
  const [measuredAt, setMeasuredAt] = useState(localDateTime(new Date()));
  const [level, setLevel] = useState('');
  const [note, setNote] = useState('');
  const [withdrawn, setWithdrawn] = useState(0);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  // Fills made from this tank since the delivery was recorded (the fuel was settling)
  useEffect(() => {
    let cancelled = false;
    supabase.from('fuel_enlevements').select('quantity_liters').eq('tank_id', d.tank_id).gt('created_at', d.created_at)
      .then(({ data }) => {
        if (!cancelled) setWithdrawn(((data ?? []) as { quantity_liters: number }[]).reduce((s, e) => s + Number(e.quantity_liters), 0));
      });
    return () => { cancelled = true; };
  }, [d.tank_id, d.created_at]);

  const announced = Number(d.announced_quantity ?? d.quantity_liters);
  const stockBefore = Number(d.stock_before);
  const loading = Number(d.citerne_variance ?? 0);
  const measured = parseFloat(level);
  const hasLevel = !isNaN(measured) && level !== '';
  const received = hasLevel ? measured - stockBefore + withdrawn : null;
  const total = received !== null ? received - announced : null;
  const unloading = total !== null ? total - loading : null;
  const price = Number(d.unit_price ?? 0);
  const arrival = new Date(d.arrival_at || d.created_at);
  const at = new Date(measuredAt);
  const tooEarly = !isNaN(at.getTime()) && at.getTime() - arrival.getTime() < REST_MINUTES * 60_000;
  const noteRequired = total !== null && Math.abs(total) > (announced * NOTE_THRESHOLD_PCT) / 100;
  const capacity = Number(d.tanks?.capacity_liters ?? 0);

  const save = async () => {
    if (!hasLevel || measured < 0) { toast.error('Saisissez le niveau mesuré à la règle'); return; }
    if (capacity > 0 && measured > capacity) { toast.error(`Le niveau mesuré dépasse la capacité de la cuve (${capacity.toLocaleString('fr-FR')} L)`); return; }
    if (received !== null && received < 0) { toast.error('Mesure inférieure au stock de départ : vérifiez la valeur'); return; }
    if (isNaN(at.getTime()) || at.getTime() < arrival.getTime() || at.getTime() > Date.now() + 5 * 60_000) { toast.error('Heure de mesure invalide'); return; }
    if (noteRequired && !note.trim()) { toast.error(`Écart de plus de ${NOTE_THRESHOLD_PCT} % : indiquez une observation`); return; }
    if (tooEarly && !window.confirm(`La mesure est prise moins de ${REST_MINUTES} minutes après l'arrivée de la citerne. Le carburant n'est peut-être pas encore stabilisé. Enregistrer quand même ?`)) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc('record_depotage_measure', {
        p_depotage_id: d.id, p_measured_level: measured, p_measured_at: at.toISOString(), p_observation: note.trim() || null,
      });
      if (error) throw error;
      toast.success('Mesure enregistrée — la cuve est au niveau mesuré');
      setDone(true);
      onDone();
    } catch (e: any) { toast.error(e.message || 'Erreur'); }
    finally { setSaving(false); }
  };

  const line = (label: React.ReactNode, value: string, color?: string, strong = false) => (
    <div className="flex justify-between py-0.5" style={color ? { color } : undefined}><span>{strong ? <b>{label}</b> : label}</span><b>{value}</b></div>
  );
  const totalBg = total === null ? 'var(--surface-raised)' : total < 0 ? '#f8d7d5' : total > 0 ? '#DBEAFE' : '#d4edda';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="rounded-2xl w-full max-w-2xl mx-4 shadow-2xl overflow-hidden" style={{ backgroundColor: 'var(--surface)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-7 pt-6 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h3 className="font-bold text-lg flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <Ruler className="w-5 h-5" style={{ color: '#16A34A' }} /> Saisir la mesure — {d.tanks?.name ?? 'Cuve'}{d.delivery_note_number ? ` · BL ${d.delivery_note_number}` : ''}
            </h3>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{d.fuel_suppliers?.name ?? ''} · arrivée le {format(arrival, 'dd/MM/yyyy à HH:mm')}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} /></button>
        </div>
        <div className="px-7 py-5 space-y-4 max-h-[65vh] overflow-y-auto">
          {!done && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={lbl} style={{ color: 'var(--text-secondary)' }}>Heure de la mesure</label>
                <input type="datetime-local" value={measuredAt} onChange={e => setMeasuredAt(e.target.value)} className={field} style={fieldStyle} />
              </div>
              <div>
                <label className={lbl} style={{ color: 'var(--text-secondary)' }}>Niveau mesuré à la règle après dépotage (L) *</label>
                <input type="number" min={0} autoFocus value={level} onChange={e => setLevel(e.target.value)} className={field} style={{ ...fieldStyle, borderColor: 'var(--primary)' }} />
              </div>
            </div>
          )}
          {tooEarly && !done && (
            <p className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
              <AlertTriangle className="h-4 w-4" /> Moins de {REST_MINUTES} minutes depuis l'arrivée : attendez que le carburant se stabilise avant de mesurer.
            </p>
          )}
          <div className="rounded-xl px-4 py-3 text-sm" style={{ backgroundColor: 'var(--surface-raised)' }}>
            {line(`Total attendu (${Math.round(stockBefore).toLocaleString('fr-FR')} + ${Math.round(announced).toLocaleString('fr-FR')})`, L(stockBefore + announced))}
            {line('Mesuré en cuve', hasLevel ? L(measured) : '—')}
            {withdrawn > 0 && line('+ Pleins faits sur cette cuve pendant l\'attente', L(withdrawn))}
            {line(<><b>Dépotage réel</b>{hasLevel ? ` (${Math.round(measured).toLocaleString('fr-FR')} − ${Math.round(stockBefore).toLocaleString('fr-FR')}${withdrawn > 0 ? ` + ${Math.round(withdrawn).toLocaleString('fr-FR')}` : ''})` : ''}</>, L(received))}
          </div>
          <div className="rounded-xl px-4 py-3 text-sm" style={{ backgroundColor: totalBg, color: total === null ? 'var(--text-secondary)' : varianceColor(total) }}>
            {line('Écart total', total === null ? '—' : `${signedL(total)} · ${total < 0 ? '− ' : total > 0 ? '+ ' : ''}${formatCurrency(Math.abs(total * price))}`, undefined, true)}
            {line('dont écart au chargement (citerne, contre-plein)', `${signedL(loading)} · ${loading < 0 ? '− ' : loading > 0 ? '+ ' : ''}${formatCurrency(Math.abs(loading * price))}`)}
            {line('dont écart réel au dépotage', unloading === null ? '—' : `${signedL(unloading)} · ${unloading < 0 ? '− ' : unloading > 0 ? '+ ' : ''}${formatCurrency(Math.abs(unloading * price))}`)}
          </div>
          {!done && (
            <div>
              <label className={lbl} style={{ color: 'var(--text-secondary)' }}>Observation{noteRequired ? ' * (écart de plus de ' + NOTE_THRESHOLD_PCT + ' %)' : ''}</label>
              <textarea value={note} maxLength={300} onChange={e => setNote(e.target.value)} rows={2} placeholder="Ex. : manque constaté au contre-plein sur le compartiment 2…"
                className="w-full px-3 py-2.5 border rounded-xl text-sm resize-none outline-none" style={{ ...fieldStyle, borderColor: noteRequired && !note.trim() ? '#AF3029' : 'var(--border)' }} />
            </div>
          )}
        </div>
        <div className="flex gap-3 px-7 pb-6">
          {done ? (
            <>
              <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border font-semibold text-sm" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Fermer</button>
              <button onClick={onPrint} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-white font-semibold text-sm" style={{ backgroundColor: '#16A34A' }}>
                <Printer className="h-4 w-4" /> Imprimer le bordereau
              </button>
            </>
          ) : (
            <>
              <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border font-semibold text-sm" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Plus tard</button>
              <button onClick={save} disabled={saving} className="flex-1 px-4 py-2.5 rounded-xl text-white font-semibold text-sm disabled:opacity-50" style={{ backgroundColor: '#16A34A' }}>
                {saving ? 'Enregistrement…' : 'Valider la mesure et mettre la cuve à jour'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
