import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import { BarChart2, ArrowDownCircle, ArrowUpCircle, Building2, Bus, Droplets, Calendar, Filter, X } from 'lucide-react';
import { formatCurrency } from '../../utils/formatCurrency';
import { format, startOfWeek, endOfWeek, startOfDay, endOfDay } from 'date-fns';
import { fr } from 'date-fns/locale';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { usePompisteTanks } from '../../hooks/usePompisteTanks';
import { Droplets as DropletsIcon } from 'lucide-react';

type ReportTab = 'daily' | 'weekly' | 'by_company' | 'by_bus' | 'by_supplier' | 'by_tank';
const NIL_TANK = '00000000-0000-0000-0000-000000000000';

interface TankStat {
  tank_id: string; tank_name: string;
  total_in: number; total_out: number; stock_start: number; stock_current: number;
}
interface CompanyStat { company_name: string; total_liters: number; total_amount: number; bus_count: number; }
interface BusStat { license_plate: string; company_name: string; total_liters: number; total_amount: number; count: number; }
interface SupplierStat { supplier_name: string; total_liters: number; total_amount: number; depotage_count: number; }

export default function Reports() {
  const { tanks: myTanks, tankIds, loading: tanksLoading, isPompiste } = usePompisteTanks();
  const [tab, setTab] = useState<ReportTab>('daily');
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().split('T')[0]);
  const [weekFilter, setWeekFilter] = useState(new Date().toISOString().split('T')[0]);

  const [dailyData, setDailyData] = useState<any>(null);
  const [weeklyData, setWeeklyData] = useState<any[]>([]);
  const [companyStats, setCompanyStats] = useState<CompanyStat[]>([]);
  const [busStats, setBusStats] = useState<BusStat[]>([]);
  const [supplierStats, setSupplierStats] = useState<SupplierStat[]>([]);
  const [tankStats, setTankStats] = useState<TankStat[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (!tanksLoading) loadReport(); }, [tab, dateFilter, weekFilter, tanksLoading, tankIds.join(',')]);

  const loadReport = async () => {
    setLoading(true);
    try {
      if (tab === 'daily') await loadDailyReport();
      else if (tab === 'weekly') await loadWeeklyReport();
      else if (tab === 'by_company') await loadCompanyReport();
      else if (tab === 'by_bus') await loadBusReport();
      else if (tab === 'by_supplier') await loadSupplierReport();
      else if (tab === 'by_tank') await loadTankReport();
    } catch { toast.error('Erreur de chargement'); }
    finally { setLoading(false); }
  };

  const loadDailyReport = async () => {
    const dayStart = startOfDay(new Date(dateFilter)).toISOString();
    const dayEnd = endOfDay(new Date(dateFilter)).toISOString();

    const noTankFilter = isPompiste && tankIds.length === 0;
    const depSel = 'quantity_liters, total_amount, supplier_id, tanks:tank_id(name), fuel_suppliers:supplier_id(name)';
    const enlSel = 'quantity_liters, total_amount, license_plate, companies:company_id(name), tanks:tank_id(name)';
    let depQ = supabase.from('fuel_depotages').select(depSel).gte('created_at', dayStart).lte('created_at', dayEnd);
    let enlQ = supabase.from('fuel_enlevements').select(enlSel).gte('created_at', dayStart).lte('created_at', dayEnd);
    if (isPompiste && tankIds.length > 0) { depQ = depQ.in('tank_id', tankIds); enlQ = enlQ.in('tank_id', tankIds); }
    else if (noTankFilter) { depQ = depQ.eq('tank_id', NIL_TANK); enlQ = enlQ.eq('tank_id', NIL_TANK); }

    const [depRes, enlRes] = await Promise.all([depQ, enlQ]);

    const deps = depRes.data || [];
    const enls = enlRes.data || [];
    const totalIn = deps.reduce((s: number, d: any) => s + Number(d.quantity_liters), 0);
    const totalOut = enls.reduce((s: number, e: any) => s + Number(e.quantity_liters), 0);
    const totalInAmount = deps.reduce((s: number, d: any) => s + Number(d.total_amount), 0);
    const totalOutAmount = enls.reduce((s: number, e: any) => s + Number(e.total_amount), 0);

    // by company
    const byCompany: Record<string, { liters: number; amount: number }> = {};
    enls.forEach((e: any) => {
      const cn = (e.companies as any)?.name || 'Inconnu';
      if (!byCompany[cn]) byCompany[cn] = { liters: 0, amount: 0 };
      byCompany[cn].liters += Number(e.quantity_liters);
      byCompany[cn].amount += Number(e.total_amount);
    });

    setDailyData({ totalIn, totalOut, totalInAmount, totalOutAmount, byCompany, deps: deps.length, enls: enls.length });
  };

  const loadWeeklyReport = async () => {
    const ws = startOfWeek(new Date(weekFilter), { weekStartsOn: 1 });
    const we = endOfWeek(new Date(weekFilter), { weekStartsOn: 1 });

    const noTankFilter = isPompiste && tankIds.length === 0;
    let depQ = supabase.from('fuel_depotages').select('depot_date, quantity_liters, total_amount')
      .gte('depot_date', ws.toISOString().split('T')[0]).lte('depot_date', we.toISOString().split('T')[0]);
    let enlQ = supabase.from('fuel_enlevements').select('enlevement_date, quantity_liters, total_amount, companies:company_id(name)')
      .gte('enlevement_date', ws.toISOString().split('T')[0]).lte('enlevement_date', we.toISOString().split('T')[0]);
    if (isPompiste && tankIds.length > 0) { depQ = depQ.in('tank_id', tankIds); enlQ = enlQ.in('tank_id', tankIds); }
    else if (noTankFilter) { depQ = depQ.eq('tank_id', NIL_TANK); enlQ = enlQ.eq('tank_id', NIL_TANK); }

    const [depRes, enlRes] = await Promise.all([depQ, enlQ]);

    const days: Record<string, { in: number; out: number }> = {};
    for (let d = new Date(ws); d <= we; d.setDate(d.getDate() + 1)) {
      days[d.toISOString().split('T')[0]] = { in: 0, out: 0 };
    }
    (depRes.data || []).forEach((d: any) => { if (days[d.depot_date]) days[d.depot_date].in += Number(d.quantity_liters); });
    (enlRes.data || []).forEach((e: any) => { if (days[e.enlevement_date]) days[e.enlevement_date].out += Number(e.quantity_liters); });

    setWeeklyData(Object.entries(days).map(([date, v]) => ({ date: format(new Date(date), 'EEE dd/MM', { locale: fr }), Entrées: v.in, Sorties: v.out })));
  };

  const loadCompanyReport = async () => {
    if (isPompiste && tankIds.length === 0) { setCompanyStats([]); return; }
    let q = supabase.from('fuel_enlevements')
      .select('quantity_liters, total_amount, bus_id, companies:company_id(name)');
    if (isPompiste) q = q.in('tank_id', tankIds);
    const { data } = await q;
    const map: Record<string, { liters: number; amount: number; buses: Set<string> }> = {};
    (data || []).forEach((e: any) => {
      const cn = (e.companies as any)?.name || 'Inconnu';
      if (!map[cn]) map[cn] = { liters: 0, amount: 0, buses: new Set() };
      map[cn].liters += Number(e.quantity_liters);
      map[cn].amount += Number(e.total_amount);
      if (e.bus_id) map[cn].buses.add(e.bus_id);
    });
    setCompanyStats(Object.entries(map).map(([name, v]) => ({ company_name: name, total_liters: v.liters, total_amount: v.amount, bus_count: v.buses.size }))
      .sort((a, b) => b.total_liters - a.total_liters));
  };

  const loadBusReport = async () => {
    if (isPompiste && tankIds.length === 0) { setBusStats([]); return; }
    let q = supabase.from('fuel_enlevements')
      .select('quantity_liters, total_amount, license_plate, companies:company_id(name)');
    if (isPompiste) q = q.in('tank_id', tankIds);
    const { data } = await q;
    const map: Record<string, { liters: number; amount: number; count: number; company: string }> = {};
    (data || []).forEach((e: any) => {
      const plate = e.license_plate || '—';
      if (!map[plate]) map[plate] = { liters: 0, amount: 0, count: 0, company: (e.companies as any)?.name || '—' };
      map[plate].liters += Number(e.quantity_liters);
      map[plate].amount += Number(e.total_amount);
      map[plate].count += 1;
    });
    setBusStats(Object.entries(map).map(([plate, v]) => ({ license_plate: plate, company_name: v.company, total_liters: v.liters, total_amount: v.amount, count: v.count }))
      .sort((a, b) => b.total_liters - a.total_liters));
  };

  const loadSupplierReport = async () => {
    if (isPompiste && tankIds.length === 0) { setSupplierStats([]); return; }
    let q = supabase.from('fuel_depotages')
      .select('quantity_liters, total_amount, fuel_suppliers:supplier_id(name)');
    if (isPompiste) q = q.in('tank_id', tankIds);
    const { data } = await q;
    const map: Record<string, { liters: number; amount: number; count: number }> = {};
    (data || []).forEach((d: any) => {
      const sn = (d.fuel_suppliers as any)?.name || 'Inconnu';
      if (!map[sn]) map[sn] = { liters: 0, amount: 0, count: 0 };
      map[sn].liters += Number(d.quantity_liters);
      map[sn].amount += Number(d.total_amount);
      map[sn].count += 1;
    });
    setSupplierStats(Object.entries(map).map(([name, v]) => ({ supplier_name: name, total_liters: v.liters, total_amount: v.amount, depotage_count: v.count }))
      .sort((a, b) => b.total_liters - a.total_liters));
  };

  const loadTankReport = async () => {
    if (isPompiste && tankIds.length === 0) { setTankStats([]); return; }
    let tq = supabase.from('fuel_tanks').select('id, name, current_level_liters').order('name');
    if (isPompiste) tq = tq.in('id', tankIds);
    let depQ = supabase.from('fuel_depotages').select('tank_id, quantity_liters');
    let enlQ = supabase.from('fuel_enlevements').select('tank_id, quantity_liters');
    if (isPompiste) { depQ = depQ.in('tank_id', tankIds); enlQ = enlQ.in('tank_id', tankIds); }
    const [tanksRes, depRes, enlRes] = await Promise.all([tq, depQ, enlQ]);
    const depMap: Record<string, number> = {};
    (depRes.data || []).forEach((d: any) => { depMap[d.tank_id] = (depMap[d.tank_id] || 0) + Number(d.quantity_liters); });
    const enlMap: Record<string, number> = {};
    (enlRes.data || []).forEach((e: any) => { enlMap[e.tank_id] = (enlMap[e.tank_id] || 0) + Number(e.quantity_liters); });
    setTankStats((tanksRes.data || []).map((t: any) => ({
      tank_id: t.id, tank_name: t.name,
      total_in: depMap[t.id] || 0, total_out: enlMap[t.id] || 0,
      stock_start: 0, stock_current: Number(t.current_level_liters),
    })));
  };

  const TABS: { id: ReportTab; label: string; icon: React.ReactNode }[] = [
    { id: 'daily', label: 'Récap. Journalier', icon: <Calendar className="w-4 h-4" /> },
    { id: 'weekly', label: 'Récap. Hebdo', icon: <BarChart2 className="w-4 h-4" /> },
    { id: 'by_company', label: 'Par société', icon: <Building2 className="w-4 h-4" /> },
    { id: 'by_bus', label: 'Par bus', icon: <Bus className="w-4 h-4" /> },
    { id: 'by_supplier', label: 'Par fournisseur', icon: <ArrowDownCircle className="w-4 h-4" /> },
    { id: 'by_tank', label: 'Par cuve', icon: <Droplets className="w-4 h-4" /> },
  ];

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Rapports Carburant</h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Analyses et récapitulatifs</p>
      </div>

      {isPompiste && !tanksLoading && myTanks.length === 0 && (
        <div className="rounded-xl border-2 p-6 mb-6 flex items-center gap-4" style={{ borderColor: '#F59E0B', backgroundColor: '#FFFBEB' }}>
          <DropletsIcon className="w-8 h-8 flex-shrink-0" style={{ color: '#F59E0B' }} />
          <div>
            <p className="font-bold text-sm" style={{ color: '#92400E' }}>Aucune cuve ne vous est affectée</p>
            <p className="text-xs mt-1" style={{ color: '#92400E' }}>
              Contactez votre administrateur pour qu'il vous assigne une cuve. Les rapports ne contiendront que les données de votre cuve une fois affectée.
            </p>
          </div>
        </div>
      )}

      {/* tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
            style={{ backgroundColor: tab === t.id ? 'var(--primary)' : 'var(--surface)', color: tab === t.id ? 'white' : 'var(--text-secondary)', border: `1px solid ${tab === t.id ? 'var(--primary)' : 'var(--border)'}` }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* date filter */}
      {(tab === 'daily' || tab === 'weekly') && (
        <div className="mb-6">
          <input type="date"
            value={tab === 'daily' ? dateFilter : weekFilter}
            onChange={e => tab === 'daily' ? setDateFilter(e.target.value) : setWeekFilter(e.target.value)}
            className="px-3 py-2.5 border rounded-xl text-sm outline-none"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
          {tab === 'weekly' && (
            <span className="ml-3 text-sm" style={{ color: 'var(--text-muted)' }}>
              Semaine du {format(startOfWeek(new Date(weekFilter), { weekStartsOn: 1 }), 'dd/MM')} au {format(endOfWeek(new Date(weekFilter), { weekStartsOn: 1 }), 'dd/MM/yyyy')}
            </span>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-10 h-10 border-4 rounded-full animate-spin" style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} /></div>
      ) : (
        <>
          {/* daily */}
          {tab === 'daily' && dailyData && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Entrées (L)', value: dailyData.totalIn.toLocaleString(), color: '#16A34A' },
                  { label: 'Sorties (L)', value: dailyData.totalOut.toLocaleString(), color: '#DC2626' },
                  { label: 'Montant entré', value: formatCurrency(dailyData.totalInAmount), color: '#16A34A' },
                  { label: 'Montant sorti', value: formatCurrency(dailyData.totalOutAmount), color: '#DC2626' },
                ].map(k => (
                  <div key={k.label} className="rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{k.label}</p>
                    <p className="text-2xl font-black mt-1" style={{ color: k.color }}>{k.value}</p>
                  </div>
                ))}
              </div>
              {Object.keys(dailyData.byCompany).length > 0 && (
                <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                  <div className="px-5 py-3 border-b font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                    Consommation par société
                  </div>
                  <table className="w-full text-sm">
                    <thead><tr style={{ backgroundColor: 'var(--bg-subtle, #F9FAFB)' }}>
                      {['Société', 'Quantité (L)', 'Montant'].map(h => <th key={h} className="px-4 py-2 text-left text-xs font-semibold uppercase" style={{ color: 'var(--text-muted)' }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {Object.entries(dailyData.byCompany).map(([name, v]: any) => (
                        <tr key={name} className="border-t" style={{ borderColor: 'var(--border)' }}>
                          <td className="px-4 py-2 font-semibold" style={{ color: 'var(--text-primary)' }}>{name}</td>
                          <td className="px-4 py-2" style={{ color: 'var(--text-secondary)' }}>{v.liters.toLocaleString()}</td>
                          <td className="px-4 py-2 font-bold" style={{ color: 'var(--primary)' }}>{formatCurrency(v.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* weekly chart */}
          {tab === 'weekly' && (
            <div className="rounded-xl border p-6" style={{ borderColor: 'var(--border)' }}>
              <h3 className="font-bold mb-4" style={{ color: 'var(--text-primary)' }}>Entrées / Sorties de la semaine (L)</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={weeklyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => `${v.toLocaleString()} L`} />
                  <Legend />
                  <Bar dataKey="Entrées" fill="#16A34A" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Sorties" fill="#DC2626" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* by company */}
          {tab === 'by_company' && (
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
              <table className="w-full text-sm">
                <thead><tr style={{ backgroundColor: 'var(--bg-subtle, #F9FAFB)' }}>
                  {['Société', 'Quantité totale (L)', 'Montant total', 'Bus servis', 'Moyenne / bus'].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase" style={{ color: 'var(--text-muted)' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {companyStats.map(c => (
                    <tr key={c.company_name} className="border-t hover:bg-gray-50" style={{ borderColor: 'var(--border)' }}>
                      <td className="px-4 py-3 font-semibold" style={{ color: 'var(--text-primary)' }}>{c.company_name}</td>
                      <td className="px-4 py-3 font-bold" style={{ color: '#DC2626' }}>{c.total_liters.toLocaleString()}</td>
                      <td className="px-4 py-3 font-bold" style={{ color: 'var(--primary)' }}>{formatCurrency(c.total_amount)}</td>
                      <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{c.bus_count}</td>
                      <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{c.bus_count > 0 ? (c.total_liters / c.bus_count).toFixed(0) : 0} L</td>
                    </tr>
                  ))}
                  {companyStats.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center" style={{ color: 'var(--text-muted)' }}>Aucune donnée</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {/* by bus */}
          {tab === 'by_bus' && (
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
              <table className="w-full text-sm">
                <thead><tr style={{ backgroundColor: 'var(--bg-subtle, #F9FAFB)' }}>
                  {['Plaque', 'Société', 'Quantité totale (L)', 'Montant total', 'Nb enlèvements'].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase" style={{ color: 'var(--text-muted)' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {busStats.map(b => (
                    <tr key={b.license_plate} className="border-t hover:bg-gray-50" style={{ borderColor: 'var(--border)' }}>
                      <td className="px-4 py-3 font-mono font-bold" style={{ color: 'var(--text-primary)' }}>{b.license_plate}</td>
                      <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{b.company_name}</td>
                      <td className="px-4 py-3 font-bold" style={{ color: '#DC2626' }}>{b.total_liters.toLocaleString()}</td>
                      <td className="px-4 py-3 font-bold" style={{ color: 'var(--primary)' }}>{formatCurrency(b.total_amount)}</td>
                      <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{b.count}</td>
                    </tr>
                  ))}
                  {busStats.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center" style={{ color: 'var(--text-muted)' }}>Aucune donnée</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {/* by supplier */}
          {tab === 'by_supplier' && (
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
              <table className="w-full text-sm">
                <thead><tr style={{ backgroundColor: 'var(--bg-subtle, #F9FAFB)' }}>
                  {['Fournisseur', 'Quantité livrée (L)', 'Montant total', 'Nb dépotages'].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase" style={{ color: 'var(--text-muted)' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {supplierStats.map(s => (
                    <tr key={s.supplier_name} className="border-t hover:bg-gray-50" style={{ borderColor: 'var(--border)' }}>
                      <td className="px-4 py-3 font-semibold" style={{ color: 'var(--text-primary)' }}>{s.supplier_name}</td>
                      <td className="px-4 py-3 font-bold" style={{ color: '#16A34A' }}>{s.total_liters.toLocaleString()}</td>
                      <td className="px-4 py-3 font-bold" style={{ color: 'var(--primary)' }}>{formatCurrency(s.total_amount)}</td>
                      <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{s.depotage_count}</td>
                    </tr>
                  ))}
                  {supplierStats.length === 0 && <tr><td colSpan={4} className="px-4 py-10 text-center" style={{ color: 'var(--text-muted)' }}>Aucune donnée</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {/* by tank */}
          {tab === 'by_tank' && (
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
              <table className="w-full text-sm">
                <thead><tr style={{ backgroundColor: 'var(--bg-subtle, #F9FAFB)' }}>
                  {['Cuve', 'Total entrées (L)', 'Total sorties (L)', 'Stock actuel (L)', 'Écart (L)'].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase" style={{ color: 'var(--text-muted)' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {tankStats.map(t => {
                    const ecart = t.total_in - t.total_out - t.stock_current;
                    return (
                      <tr key={t.tank_id} className="border-t hover:bg-gray-50" style={{ borderColor: 'var(--border)' }}>
                        <td className="px-4 py-3 font-semibold" style={{ color: 'var(--text-primary)' }}>{t.tank_name}</td>
                        <td className="px-4 py-3 font-bold" style={{ color: '#16A34A' }}>{t.total_in.toLocaleString()}</td>
                        <td className="px-4 py-3 font-bold" style={{ color: '#DC2626' }}>{t.total_out.toLocaleString()}</td>
                        <td className="px-4 py-3 font-bold" style={{ color: 'var(--primary)' }}>{t.stock_current.toLocaleString()}</td>
                        <td className="px-4 py-3 font-semibold" style={{ color: Math.abs(ecart) < 1 ? '#16A34A' : '#F59E0B' }}>{ecart.toLocaleString()}</td>
                      </tr>
                    );
                  })}
                  {tankStats.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center" style={{ color: 'var(--text-muted)' }}>Aucune donnée</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
