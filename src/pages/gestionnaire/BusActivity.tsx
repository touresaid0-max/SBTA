import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../services/supabase';
import { Bus, ChevronRight, Download, X } from 'lucide-react';
import { format, subDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import * as XLSX from 'xlsx';

const fmt = (n: number) => new Intl.NumberFormat('fr-CI', { maximumFractionDigits: 0 }).format(n);
const fmtCFA = (n: number) => fmt(n) + ' FCFA';

interface BusRow {
  bus_id: string; registration_number: string; model: string; trip_count: number; revenue: number;
  cc_carburant: number; cc_ration: number; cc_peage: number; cc_autres: number;
  fuel_enlev: number; expense_reparation: number; vehicle_exp: number;
  total_expense: number; margin: number;
}

interface ScheduleRow {
  id: string; departure_datetime: string; arrival_datetime: string;
  route_name: string; status: string; seats_reserved: number; seats_available: number; price: number;
  driver?: { first_name: string; last_name: string };
}

interface BusExpRow {
  id: string; expense_date: string; expense_type: string; amount: number; description: string; status: string;
}

interface EnlevementRow {
  id: string; enlevement_date: string; quantity_liters: number; total_amount: number; observation: string;
}

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  planifie:   { label: 'Planifié',   color: '#2563EB', bg: '#DBEAFE' },
  en_cours:   { label: 'En cours',   color: '#D97706', bg: '#FEF3C7' },
  termine:    { label: 'Terminé',    color: '#16A34A', bg: '#DCFCE7' },
  annule:     { label: 'Annulé',     color: '#EF4444', bg: '#FEE2E2' },
  confirme:   { label: 'Confirmé',   color: '#2563EB', bg: '#DBEAFE' },
};

export default function BusActivity() {
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [buses, setBuses] = useState<BusRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<BusRow | null>(null);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [busExpenses, setBusExpenses] = useState<BusExpRow[]>([]);
  const [enlevements, setEnlevements] = useState<EnlevementRow[]>([]);
  const [detailTab, setDetailTab] = useState<'voyages' | 'depenses' | 'carburant'>('voyages');
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc('get_gestionnaire_revenue_by_bus', { p_date_from: dateFrom, p_date_to: dateTo });
    if (data) setBuses(data as BusRow[]);
    setLoading(false);
  }, [dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const loadDetail = useCallback(async (bus: BusRow) => {
    setSelected(bus);
    setDetailLoading(true);

    const [schRes, expRes, enlRes] = await Promise.all([
      supabase.from('schedules').select('id,departure_datetime,arrival_datetime,route_name,status,seats_reserved,seats_available,price')
        .eq('bus_id', bus.bus_id)
        .gte('departure_datetime', dateFrom + 'T00:00:00')
        .lte('departure_datetime', dateTo + 'T23:59:59')
        .order('departure_datetime', { ascending: false })
        .limit(50),
      supabase.from('bus_expenses').select('id,expense_date,expense_type,amount,description,status')
        .eq('bus_id', bus.bus_id)
        .gte('expense_date', dateFrom)
        .lte('expense_date', dateTo)
        .order('expense_date', { ascending: false })
        .limit(50),
      supabase.from('fuel_enlevements').select('id,enlevement_date,quantity_liters,total_amount,observation')
        .eq('bus_id', bus.bus_id)
        .gte('enlevement_date', dateFrom)
        .lte('enlevement_date', dateTo)
        .order('enlevement_date', { ascending: false })
        .limit(50),
    ]);

    if (schRes.data) setSchedules(schRes.data as ScheduleRow[]);
    if (expRes.data) setBusExpenses(expRes.data as BusExpRow[]);
    if (enlRes.data) setEnlevements(enlRes.data as EnlevementRow[]);
    setDetailLoading(false);
  }, [dateFrom, dateTo]);

  const exportExcel = () => {
    const data = buses.map(b => ({
      'Immatriculation': b.registration_number, 'Modèle': b.model,
      'Voyages': b.trip_count, 'Recettes': b.revenue,
      'Carburant compl. (guichet)': b.cc_carburant, 'Rations (guichet)': b.cc_ration,
      'Péages (guichet)': b.cc_peage, 'Autr. dép. (GCH)': b.cc_autres ?? 0, 'Carburant cuve': b.fuel_enlev,
      'Réparations (comptable)': b.expense_reparation, 'Total charges': b.total_expense, 'Marge': b.margin,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Activités Bus');
    XLSX.writeFile(wb, `activites_bus_${dateFrom}_${dateTo}.xlsx`);
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Activités des bus</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Voyages, charges et carburant par véhicule</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="px-3 py-2 border rounded-lg text-sm"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
          <span style={{ color: 'var(--text-muted)' }}>→</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="px-3 py-2 border rounded-lg text-sm"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
          <button onClick={exportExcel} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
            style={{ backgroundColor: '#16A34A', color: '#fff' }}>
            <Download className="w-4 h-4" /> Excel
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 rounded-full animate-spin" style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
        </div>
      ) : (
        <div className="rounded-2xl border overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                {['Plaque', 'Modèle', 'Voyages', 'Recettes', 'Carb. compl.', 'Rations', 'Péages', 'Autr. dép. (GCH)', 'Carb. cuve', 'Réparat. (comptable)', 'Total charges', 'Marge', 'Détail'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {buses.map(b => (
                <tr key={b.bus_id} className="border-t hover:bg-gray-50 cursor-pointer" style={{ borderColor: 'var(--border)' }}
                  onClick={() => loadDetail(b)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
                        <Bus className="w-3.5 h-3.5" />
                      </div>
                      <span className="font-medium text-xs" style={{ color: 'var(--text-primary)' }}>{b.registration_number}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{b.model}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{b.trip_count}</td>
                  <td className="px-4 py-3 text-xs font-semibold" style={{ color: '#10B981' }}>{fmt(b.revenue)}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: '#3B82F6' }}>{fmt(b.cc_carburant)}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: '#F59E0B' }}>{fmt(b.cc_ration)}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: '#10B981' }}>{fmt(b.cc_peage)}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: '#6366F1' }}>{fmt(b.cc_autres ?? 0)}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: '#F97316' }}>{fmt(b.fuel_enlev)}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: '#EF4444' }}>{fmt(b.expense_reparation)}</td>
                  <td className="px-4 py-3 text-xs font-semibold" style={{ color: '#EF4444' }}>{fmt(b.total_expense)}</td>
                  <td className="px-4 py-3 text-xs font-bold" style={{ color: b.margin >= 0 ? '#10B981' : '#EF4444' }}>{fmt(b.margin)}</td>
                  <td className="px-4 py-3">
                    <button className="p-1.5 rounded-lg transition-colors hover:opacity-80"
                      style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {buses.length === 0 && (
                <tr><td colSpan={13} className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>Aucune donnée</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail panel */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
          onClick={() => setSelected(null)}>
          <div className="w-full max-w-2xl h-full overflow-y-auto shadow-2xl" style={{ backgroundColor: 'var(--surface)' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 z-10"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
                  <Bus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>{selected.registration_number}</h3>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{selected.model}</p>
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="p-2 rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
              </button>
            </div>

            {/* Summary KPIs */}
            <div className="grid grid-cols-3 gap-3 p-6 border-b" style={{ borderColor: 'var(--border)' }}>
              {[
                { label: 'Recettes', val: fmtCFA(selected.revenue), color: '#10B981' },
                { label: 'Total charges', val: fmtCFA(selected.total_expense), color: '#EF4444' },
                { label: 'Marge', val: fmtCFA(selected.margin), color: selected.margin >= 0 ? '#10B981' : '#EF4444' },
              ].map(k => (
                <div key={k.label} className="rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
                  <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>{k.label}</p>
                  <p className="font-bold text-sm" style={{ color: k.color }}>{k.val}</p>
                </div>
              ))}
            </div>

            {/* Detail tabs */}
            <div className="flex border-b px-6" style={{ borderColor: 'var(--border)' }}>
              {(['voyages', 'depenses', 'carburant'] as const).map(t => (
                <button key={t} onClick={() => setDetailTab(t)}
                  className="px-4 py-3 text-sm font-medium border-b-2 -mb-px capitalize"
                  style={{
                    borderBottomColor: detailTab === t ? 'var(--primary)' : 'transparent',
                    color: detailTab === t ? 'var(--primary)' : 'var(--text-secondary)',
                  }}>
                  {t === 'voyages' ? 'Voyages' : t === 'depenses' ? 'Dépenses' : 'Carburant'}
                </button>
              ))}
            </div>

            <div className="p-6">
              {detailLoading ? (
                <div className="flex justify-center py-8">
                  <div className="w-6 h-6 border-4 rounded-full animate-spin" style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
                </div>
              ) : detailTab === 'voyages' ? (
                <div className="space-y-2">
                  {schedules.map(s => {
                    const st = STATUS_LABELS[s.status] ?? { label: s.status, color: '#6B7280', bg: '#F3F4F6' };
                    return (
                      <div key={s.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
                        <div className="flex items-center justify-between mb-1">
                          <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                            {format(new Date(s.departure_datetime), 'dd/MM/yyyy HH:mm', { locale: fr })}
                          </p>
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                            style={{ backgroundColor: st.bg, color: st.color }}>{st.label}</span>
                        </div>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.route_name}</p>
                        <div className="flex gap-4 mt-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                          <span>{s.seats_reserved} réservations</span>
                          <span>{fmtCFA(s.price * s.seats_reserved)}</span>
                        </div>
                      </div>
                    );
                  })}
                  {schedules.length === 0 && <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>Aucun voyage</p>}
                </div>
              ) : detailTab === 'depenses' ? (
                <div className="space-y-2">
                  {busExpenses.map(e => (
                    <div key={e.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
                      <div className="flex items-center justify-between mb-1">
                        <p className="font-medium text-sm capitalize" style={{ color: 'var(--text-primary)' }}>
                          {e.expense_type.replace('_', ' ')}
                        </p>
                        <p className="font-bold text-sm" style={{ color: '#EF4444' }}>{fmtCFA(e.amount)}</p>
                      </div>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{e.expense_date} · {e.description}</p>
                    </div>
                  ))}
                  {busExpenses.length === 0 && <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>Aucune dépense</p>}
                </div>
              ) : (
                <div className="space-y-2">
                  {enlevements.map(e => (
                    <div key={e.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
                      <div className="flex items-center justify-between mb-1">
                        <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                          {e.quantity_liters} L
                        </p>
                        <p className="font-bold text-sm" style={{ color: '#F97316' }}>{fmtCFA(e.total_amount)}</p>
                      </div>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{e.enlevement_date}{e.observation ? ' · ' + e.observation : ''}</p>
                    </div>
                  ))}
                  {enlevements.length === 0 && <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>Aucun enlèvement</p>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
