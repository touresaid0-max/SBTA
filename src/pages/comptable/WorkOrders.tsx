import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../store/authStore';
import { useComptableCompanies } from '../../hooks/useComptableCompanies';
import toast from 'react-hot-toast';
import { Wrench, Eye, RefreshCw, Filter } from 'lucide-react';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { formatCurrency } from '../../utils/formatCurrency';

interface WorkOrder {
  id: string;
  work_order_number: string;
  estimated_cost: number | null;
  actual_cost: number | null;
  status: string;
  priority: string | null;
  work_description: string | null;
  created_at: string;
  bus: {
    registration_number: string;
    brand: string | null;
    model: string;
  } | null;
  assignee: {
    full_name: string;
  } | null;
}

type FilterType = 'all' | 'submitted' | 'validated' | 'completed' | 'in_progress';

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  submitted:   { label: 'En attente',   color: 'var(--warning)', bg: 'var(--warning-light)' },
  validated:   { label: 'Validé',       color: 'var(--info)',    bg: 'var(--info-light)' },
  in_progress: { label: 'En cours',     color: 'var(--primary)', bg: 'var(--primary-light)' },
  completed:   { label: 'Terminé',      color: 'var(--success)', bg: 'var(--success-light)' },
  cancelled:   { label: 'Annulé',       color: 'var(--danger)',  bg: 'var(--danger-light)' },
};

const PRIORITY_META: Record<string, { label: string; color: string }> = {
  low:      { label: 'Basse',   color: 'var(--success)' },
  medium:   { label: 'Moyenne', color: 'var(--warning)' },
  high:     { label: 'Haute',   color: 'var(--danger)' },
  critical: { label: 'Critique',color: 'var(--danger)' },
};

export default function ComptableWorkOrders() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { allowedCompanyIds } = useComptableCompanies();
  const companyIds = allowedCompanyIds ?? (user?.company_id ? [user.company_id] : []);
  const [loading, setLoading] = useState(true);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [filter, setFilter] = useState<FilterType>('all');

  useEffect(() => {
    loadWorkOrders();
  }, [filter]);

  const loadWorkOrders = async () => {
    try {
      setLoading(true);

      let busIds: string[] | null = null;
      if (companyIds.length > 0) {
        const { data: busData } = await supabase.from('buses').select('id').in('company_id', companyIds);
        busIds = (busData ?? []).map(b => b.id);
        if (busIds.length === 0) { setWorkOrders([]); setLoading(false); return; }
      }

      let query = supabase
        .from('maintenance_work_orders')
        .select(`
          id,
          work_order_number,
          estimated_cost,
          actual_cost,
          status,
          priority,
          work_description,
          created_at,
          bus:bus_id (
            registration_number,
            brand,
            model
          ),
          assignee:assigned_to (
            full_name
          )
        `)
        .order('created_at', { ascending: false });

      if (filter !== 'all') query = query.eq('status', filter);
      if (busIds) query = query.in('bus_id', busIds);

      const { data, error } = await query;
      if (error) throw error;
      setWorkOrders((data ?? []) as any[]);
    } catch (error: any) {
      toast.error('Erreur de chargement');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const filterButtons: { key: FilterType; label: string }[] = [
    { key: 'all',        label: 'Tous' },
    { key: 'submitted',  label: 'En attente' },
    { key: 'validated',  label: 'Validés' },
    { key: 'in_progress',label: 'En cours' },
    { key: 'completed',  label: 'Terminés' },
  ];

  const filterActiveColor: Record<FilterType, string> = {
    all:         'var(--primary)',
    submitted:   'var(--warning)',
    validated:   'var(--info)',
    in_progress: 'var(--primary)',
    completed:   'var(--success)',
  };

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
            Ordres de travail
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>Validation et suivi des OT maintenance</p>
        </div>
        <button
          onClick={loadWorkOrders}
          disabled={loading}
          className="px-4 py-2 rounded-lg border flex items-center gap-2 text-sm hover:bg-gray-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Actualiser
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total',      value: workOrders.length,                                              color: 'var(--primary)', bg: 'var(--primary-light)' },
          { label: 'En attente', value: workOrders.filter(w => w.status === 'submitted').length,        color: 'var(--warning)', bg: 'var(--warning-light)' },
          { label: 'En cours',   value: workOrders.filter(w => w.status === 'in_progress').length,      color: 'var(--info)',    bg: 'var(--info-light)' },
          { label: 'Terminés',   value: workOrders.filter(w => w.status === 'completed').length,        color: 'var(--success)', bg: 'var(--success-light)' },
        ].map(s => (
          <div key={s.label} className="rounded-xl p-4" style={{ backgroundColor: s.bg }}>
            <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>{s.label}</p>
            <p className="text-2xl font-black" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-xl p-4 mb-6 border flex items-center gap-3" style={{ borderColor: 'var(--neutral-200)' }}>
        <Filter className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-secondary)' }} />
        <div className="flex gap-2 flex-wrap">
          {filterButtons.map(btn => (
            <button
              key={btn.key}
              onClick={() => setFilter(btn.key)}
              className="px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
              style={{
                backgroundColor: filter === btn.key ? filterActiveColor[btn.key] : 'transparent',
                color: filter === btn.key ? 'white' : 'var(--text-secondary)',
                border: filter !== btn.key ? '1px solid var(--neutral-300)' : 'none',
              }}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="w-10 h-10 border-4 rounded-full animate-spin mx-auto mb-4"
            style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Chargement...</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border" style={{ borderColor: 'var(--neutral-200)' }}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead style={{ backgroundColor: 'var(--neutral-50)' }}>
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>N° OT</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Bus</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Assigné à</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Description</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Coût est.</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Coût réel</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Date</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Priorité</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Statut</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {workOrders.map(wo => {
                  const st = STATUS_META[wo.status] ?? STATUS_META.submitted;
                  const pr = wo.priority ? (PRIORITY_META[wo.priority] ?? null) : null;
                  return (
                    <tr key={wo.id} className="border-t hover:bg-gray-50 transition-colors" style={{ borderColor: 'var(--neutral-100)' }}>
                      <td className="px-4 py-3">
                        <p className="font-mono font-bold text-sm">{wo.work_order_number}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-sm">{wo.bus?.registration_number ?? '—'}</p>
                        {wo.bus?.model && (
                          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                            {wo.bus.brand} {wo.bus.model}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium">{wo.assignee?.full_name ?? '—'}</p>
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <p className="text-sm truncate" title={wo.work_description ?? ''}>
                          {wo.work_description ? wo.work_description.substring(0, 60) + (wo.work_description.length > 60 ? '…' : '') : '—'}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <p className="text-sm font-semibold">
                          {wo.estimated_cost != null ? formatCurrency(wo.estimated_cost) : '—'}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <p className="text-sm font-semibold" style={{ color: wo.actual_cost != null ? 'var(--primary)' : 'var(--text-secondary)' }}>
                          {wo.actual_cost != null ? formatCurrency(wo.actual_cost) : '—'}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm">{format(new Date(wo.created_at), 'dd/MM/yyyy')}</p>
                        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          {format(new Date(wo.created_at), 'HH:mm')}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {pr ? (
                          <span className="text-xs font-bold" style={{ color: pr.color }}>{pr.label}</span>
                        ) : <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>—</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="px-2 py-1 rounded-full text-xs font-medium"
                          style={{ backgroundColor: st.bg, color: st.color }}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => navigate(`/comptable/work-orders/${wo.id}`)}
                          className="px-3 py-1.5 rounded-lg border font-medium flex items-center gap-1.5 hover:bg-gray-50 text-sm transition-colors mx-auto"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          {wo.status === 'submitted' ? 'Valider' : 'Voir'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {workOrders.length === 0 && (
              <div className="py-12 text-center">
                <Wrench className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Aucun ordre de travail</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
