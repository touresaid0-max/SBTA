import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Droplets, TrendingUp, TrendingDown, Package, AlertTriangle,
  RefreshCw, Calendar, ArrowDownCircle, ArrowUpCircle, Building2, Bus,
} from 'lucide-react';
import { formatCurrency } from '../../utils/formatCurrency';
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek } from 'date-fns';
import { fr } from 'date-fns/locale';
import { usePompisteTanks } from '../../hooks/usePompisteTanks';
import { Droplets as DropletsIcon } from 'lucide-react';

interface KPI {
  totalStock: number;
  todayIn: number;
  todayOut: number;
  weekIn: number;
  weekOut: number;
  lowTanks: { name: string; pct: number }[];
}

interface TankSummary {
  id: string; name: string; code: string; fuel_type: string;
  capacity_liters: number; current_level_liters: number;
}

interface RecentDepotage {
  id: string; depot_date: string; quantity_liters: number; total_amount: number;
  tanks?: { name: string }; fuel_suppliers?: { name: string };
}

interface RecentEnlevement {
  id: string; enlevement_date: string; quantity_liters: number; total_amount: number;
  license_plate: string | null;
  tanks?: { name: string }; companies?: { name: string };
}

function fillColor(pct: number) {
  if (pct >= 60) return '#16A34A';
  if (pct >= 30) return '#F59E0B';
  return '#EF4444';
}

export default function PompisteDashboard() {
  const navigate = useNavigate();
  const { tanks: myTanks, tankIds, loading: tanksLoading, isPompiste } = usePompisteTanks();
  const [loading, setLoading] = useState(true);
  const [kpi, setKpi] = useState<KPI>({ totalStock: 0, todayIn: 0, todayOut: 0, weekIn: 0, weekOut: 0, lowTanks: [] });
  const [tanks, setTanks] = useState<TankSummary[]>([]);
  const [depotages, setDepotages] = useState<RecentDepotage[]>([]);
  const [enlevements, setEnlevements] = useState<RecentEnlevement[]>([]);

  useEffect(() => { if (!tanksLoading) load(); }, [tanksLoading, tankIds.join(',')]);

  const load = async () => {
    setLoading(true);
    try {
      const now = new Date();
      const todayStart = startOfDay(now).toISOString();
      const todayEnd = endOfDay(now).toISOString();
      const weekStart = startOfWeek(now, { weekStartsOn: 1 }).toISOString();
      const weekEnd = endOfWeek(now, { weekStartsOn: 1 }).toISOString();

      // pompiste: scope to assigned tanks; others: load all
      const tanksQuery = isPompiste && tankIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : isPompiste
          ? supabase.from('fuel_tanks').select('id,name,code,fuel_type,capacity_liters,current_level_liters').eq('is_active', true).in('id', tankIds).order('name')
          : supabase.from('fuel_tanks').select('id,name,code,fuel_type,capacity_liters,current_level_liters').eq('is_active', true).order('name');

      const scopedDepot = (select: string) => {
        let q = supabase.from('fuel_depotages').select(select);
        if (isPompiste && tankIds.length > 0) q = q.in('tank_id', tankIds);
        else if (isPompiste) q = q.eq('tank_id', '00000000-0000-0000-0000-000000000000');
        return q;
      };
      const scopedEnlev = (select: string) => {
        let q = supabase.from('fuel_enlevements').select(select);
        if (isPompiste && tankIds.length > 0) q = q.in('tank_id', tankIds);
        else if (isPompiste) q = q.eq('tank_id', '00000000-0000-0000-0000-000000000000');
        return q;
      };

      const [tanksRes, depotTodayRes, enlevTodayRes, depotWeekRes, enlevWeekRes, recentDep, recentEnl] = await Promise.all([
        tanksQuery as Promise<any>,
        scopedDepot('quantity_liters').gte('created_at', todayStart).lte('created_at', todayEnd),
        scopedEnlev('quantity_liters,total_amount').gte('created_at', todayStart).lte('created_at', todayEnd),
        scopedDepot('quantity_liters').gte('created_at', weekStart).lte('created_at', weekEnd),
        scopedEnlev('quantity_liters').gte('created_at', weekStart).lte('created_at', weekEnd),
        scopedDepot('id,depot_date,quantity_liters,total_amount,tanks:tank_id(name),fuel_suppliers:supplier_id(name)').order('created_at', { ascending: false }).limit(6),
        scopedEnlev('id,enlevement_date,quantity_liters,total_amount,license_plate,tanks:tank_id(name),companies:company_id(name)').order('created_at', { ascending: false }).limit(6),
      ]);
      const tanksResp = await tanksRes;

      const tankList = (tanksResp.data || []) as TankSummary[];
      const totalStock = tankList.reduce((s, t) => s + Number(t.current_level_liters), 0);
      const todayIn = (depotTodayRes.data || []).reduce((s: number, d: any) => s + Number(d.quantity_liters), 0);
      const todayOut = (enlevTodayRes.data || []).reduce((s: number, e: any) => s + Number(e.quantity_liters), 0);
      const weekIn = (depotWeekRes.data || []).reduce((s: number, d: any) => s + Number(d.quantity_liters), 0);
      const weekOut = (enlevWeekRes.data || []).reduce((s: number, e: any) => s + Number(e.quantity_liters), 0);
      const lowTanks = tankList.filter(t => t.capacity_liters > 0 && (t.current_level_liters / t.capacity_liters) < 0.2)
        .map(t => ({ name: t.name, pct: Math.round((t.current_level_liters / t.capacity_liters) * 100) }));

      setKpi({ totalStock, todayIn, todayOut, weekIn, weekOut, lowTanks });
      setTanks(tankList);
      setDepotages(((recentDep.data as unknown) || []) as RecentDepotage[]);
      setEnlevements(((recentEnl.data as unknown) || []) as RecentEnlevement[]);
    } catch {
      toast.error('Erreur de chargement');
    } finally { setLoading(false); }
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Tableau de bord Pompiste</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {format(new Date(), "EEEE d MMMM yyyy", { locale: fr })}
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
          <RefreshCw className="w-4 h-4" /> Actualiser
        </button>
      </div>

      {isPompiste && !tanksLoading && myTanks.length === 0 && (
        <div className="rounded-xl border-2 p-6 mb-6 flex items-center gap-4" style={{ borderColor: '#F59E0B', backgroundColor: '#FFFBEB' }}>
          <DropletsIcon className="w-8 h-8 flex-shrink-0" style={{ color: '#F59E0B' }} />
          <div>
            <p className="font-bold text-sm" style={{ color: '#92400E' }}>Aucune cuve ne vous est affectée</p>
            <p className="text-xs mt-1" style={{ color: '#92400E' }}>
              Contactez votre administrateur pour qu'il vous assigne une cuve. Vous pourrez ensuite consulter et gérer uniquement celle(s)-ci.
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-10 h-10 border-4 rounded-full animate-spin" style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
        </div>
      ) : (
        <div className="space-y-8">

          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { label: 'Stock total', value: `${kpi.totalStock.toLocaleString()} L`, icon: <Droplets className="w-5 h-5" />, color: '#3B82F6' },
              { label: 'Entrées aujourd\'hui', value: `${kpi.todayIn.toLocaleString()} L`, icon: <ArrowDownCircle className="w-5 h-5" />, color: '#16A34A' },
              { label: 'Sorties aujourd\'hui', value: `${kpi.todayOut.toLocaleString()} L`, icon: <ArrowUpCircle className="w-5 h-5" />, color: '#DC2626' },
              { label: 'Entrées semaine', value: `${kpi.weekIn.toLocaleString()} L`, icon: <TrendingUp className="w-5 h-5" />, color: '#0891B2' },
              { label: 'Sorties semaine', value: `${kpi.weekOut.toLocaleString()} L`, icon: <TrendingDown className="w-5 h-5" />, color: '#EA580C' },
            ].map(kpiItem => (
              <div key={kpiItem.label} className="rounded-xl border p-4 flex items-center gap-3"
                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: `${kpiItem.color}18`, color: kpiItem.color }}>
                  {kpiItem.icon}
                </div>
                <div className="min-w-0">
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{kpiItem.label}</p>
                  <p className="font-bold text-base truncate" style={{ color: 'var(--text-primary)' }}>{kpiItem.value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* low stock alerts */}
          {kpi.lowTanks.length > 0 && (
            <div className="rounded-xl border-2 p-4" style={{ borderColor: '#EF4444', backgroundColor: '#FEF2F2' }}>
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-5 h-5" style={{ color: '#DC2626' }} />
                <p className="font-bold text-sm" style={{ color: '#DC2626' }}>
                  {kpi.lowTanks.length} cuve{kpi.lowTanks.length > 1 ? 's' : ''} en stock critique (niveau &lt; 20%)
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {kpi.lowTanks.map(t => (
                  <span key={t.name} className="px-3 py-1 rounded-full text-xs font-bold"
                    style={{ backgroundColor: '#FCA5A5', color: '#7F1D1D' }}>
                    {t.name} — {t.pct}%
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* tanks overview */}
          <div>
            <h2 className="text-lg font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
              <Droplets className="w-5 h-5 inline mr-2" style={{ color: 'var(--primary)' }} />
              État des cuves
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {tanks.map(tank => {
                const pct = tank.capacity_liters > 0 ? Math.min(100, Math.round((tank.current_level_liters / tank.capacity_liters) * 100)) : 0;
                return (
                  <div key={tank.id} className="rounded-xl border p-4"
                    style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="font-bold" style={{ color: 'var(--text-primary)' }}>{tank.name}</p>
                        <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{tank.code}</p>
                      </div>
                      <span className="text-2xl font-black" style={{ color: fillColor(pct) }}>{pct}%</span>
                    </div>
                    <div className="w-full h-3 rounded-full bg-gray-200 overflow-hidden mb-2">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: fillColor(pct) }} />
                    </div>
                    <div className="flex justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
                      <span>{Number(tank.current_level_liters).toLocaleString()} L</span>
                      <span>/ {Number(tank.capacity_liters).toLocaleString()} L</span>
                    </div>
                    {pct < 20 && (
                      <p className="text-xs mt-1 font-semibold" style={{ color: '#DC2626' }}>Réapprovisionnement requis</p>
                    )}
                  </div>
                );
              })}
              {tanks.length === 0 && (
                <div className="col-span-3 text-center py-8 border-2 border-dashed rounded-xl" style={{ borderColor: 'var(--border)' }}>
                  <p style={{ color: 'var(--text-muted)' }}>Aucune cuve active</p>
                </div>
              )}
            </div>
          </div>

          {/* recent operations */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* depotages */}
            <div className="rounded-xl border" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
                <h3 className="font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <ArrowDownCircle className="w-4 h-4" style={{ color: '#16A34A' }} /> Derniers dépotages
                </h3>
                <button onClick={() => navigate('/pompiste/depotages')} className="text-xs underline" style={{ color: 'var(--primary)' }}>Voir tout</button>
              </div>
              <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {depotages.map(d => (
                  <div key={d.id} className="px-5 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {Number(d.quantity_liters).toLocaleString()} L
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {(d.tanks as any)?.name} · {(d.fuel_suppliers as any)?.name}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold" style={{ color: '#16A34A' }}>{formatCurrency(d.total_amount)}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {format(new Date(d.depot_date), 'dd/MM/yyyy')}
                      </p>
                    </div>
                  </div>
                ))}
                {depotages.length === 0 && <p className="text-sm text-center py-6" style={{ color: 'var(--text-muted)' }}>Aucun dépotage récent</p>}
              </div>
            </div>

            {/* enlevements */}
            <div className="rounded-xl border" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
                <h3 className="font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <ArrowUpCircle className="w-4 h-4" style={{ color: '#DC2626' }} /> Derniers enlèvements
                </h3>
                <button onClick={() => navigate('/pompiste/enlevements')} className="text-xs underline" style={{ color: 'var(--primary)' }}>Voir tout</button>
              </div>
              <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {enlevements.map(e => (
                  <div key={e.id} className="px-5 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {Number(e.quantity_liters).toLocaleString()} L — {e.license_plate || '—'}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {(e.tanks as any)?.name} · {(e.companies as any)?.name || '—'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold" style={{ color: '#DC2626' }}>{formatCurrency(e.total_amount)}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {format(new Date(e.enlevement_date), 'dd/MM/yyyy')}
                      </p>
                    </div>
                  </div>
                ))}
                {enlevements.length === 0 && <p className="text-sm text-center py-6" style={{ color: 'var(--text-muted)' }}>Aucun enlèvement récent</p>}
              </div>
            </div>
          </div>

          {/* quick actions */}
          <div>
            <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-muted)' }}>ACTIONS RAPIDES</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Nouveau dépotage', path: '/pompiste/depotages', color: '#16A34A', icon: <ArrowDownCircle className="w-5 h-5" /> },
                { label: 'Nouvel enlèvement', path: '/pompiste/enlevements', color: '#DC2626', icon: <ArrowUpCircle className="w-5 h-5" /> },
                { label: 'Bon de commande', path: '/pompiste/purchase-orders', color: '#0891B2', icon: <Package className="w-5 h-5" /> },
                { label: 'Rapports', path: '/pompiste/reports', color: '#7C3AED' === '' ? '#EA580C' : '#EA580C', icon: <Calendar className="w-5 h-5" /> },
              ].map(action => (
                <button key={action.label} onClick={() => navigate(action.path)}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl border font-semibold text-sm text-left transition-all hover:shadow-md"
                  style={{ borderColor: action.color, color: action.color, backgroundColor: `${action.color}08` }}>
                  {action.icon} {action.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
