import { useEffect, useMemo, useState } from 'react';
import POSLayout from '@/components/pos/POSLayout';
import { usePOSSession } from '@/services/pos/POSSessionContext';
import { supabase } from '@/services/supabase';
import { formatCurrency } from '@/utils/formatCurrency';
import { Package, Loader2, AlertCircle, Calendar as CalendarIcon, Wallet } from 'lucide-react';

type Period = 'day' | 'week' | 'month' | 'year';

interface BaggageRow {
  id: string;
  baggage_number: string;
  destination: string;
  price: number;
  created_at: string;
  bus_registration: string | null;
  departure_number: number | null;
  owner_name: string | null;
  has_ticket: boolean;
}

function getPeriodRange(period: Period): { from: Date; to: Date; label: string } {
  const now = new Date();
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  const from = new Date(now);

  if (period === 'day') {
    from.setHours(0, 0, 0, 0);
    return { from, to, label: from.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }) };
  }
  if (period === 'week') {
    const day = from.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    from.setDate(from.getDate() + diff);
    from.setHours(0, 0, 0, 0);
    const weekEnd = new Date(from);
    weekEnd.setDate(from.getDate() + 6);
    return {
      from,
      to,
      label: `Du ${from.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} au ${weekEnd.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}`,
    };
  }
  if (period === 'month') {
    from.setDate(1);
    from.setHours(0, 0, 0, 0);
    return { from, to, label: from.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) };
  }
  from.setMonth(0, 1);
  from.setHours(0, 0, 0, 0);
  return { from, to, label: String(from.getFullYear()) };
}

export default function POSRecetteBagage() {
  const { session } = usePOSSession();
  const [period, setPeriod] = useState<Period>('day');
  const [rows, setRows] = useState<BaggageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  const range = useMemo(() => getPeriodRange(period), [period]);

  useEffect(() => {
    if (!session?.user_id) return;
    let cancelled = false;
    setLoading(true);
    setError('');

    (async () => {
      try {
        const { data, error: err } = await supabase
          .from('baggage_tickets')
          .select('id, baggage_number, destination, price, created_at, bus_registration, departure_number, owner_name, has_ticket')
          .eq('sold_by', session.user_id)
          .gte('created_at', range.from.toISOString())
          .lte('created_at', range.to.toISOString())
          .order('created_at', { ascending: false });
        if (cancelled) return;
        if (err) {
          setError(err.message);
          setRows([]);
        } else {
          setRows((data ?? []) as BaggageRow[]);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Erreur inattendue');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.user_id, range.from, range.to]);

  const totalRevenue = useMemo(() => rows.reduce((sum, r) => sum + (Number(r.price) || 0), 0), [rows]);
  const totalCount = rows.length;

  const periodButtons: { key: Period; label: string }[] = [
    { key: 'day', label: 'Jour' },
    { key: 'week', label: 'Semaine' },
    { key: 'month', label: 'Mois' },
    { key: 'year', label: 'Année' },
  ];

  return (
    <POSLayout showBack stationName={session?.station_name} activeRoute="Recette bagage">
      <div className="max-w-5xl mx-auto">
        {/* Filter buttons */}
        <div
          className="rounded-xl p-3 mb-4"
          style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <CalendarIcon className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            <span className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>
              Période
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {periodButtons.map((p) => {
              const active = period === p.key;
              return (
                <button
                  key={p.key}
                  onClick={() => setPeriod(p.key)}
                  className="py-2 rounded-lg font-bold text-sm transition-all active:scale-95"
                  style={{
                    backgroundColor: active ? 'var(--primary)' : 'var(--surface-raised)',
                    color: active ? 'white' : 'var(--text-secondary)',
                    border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <p className="text-xs mt-3 capitalize" style={{ color: 'var(--text-muted)' }}>
            {range.label}
          </p>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div
            className="rounded-xl p-4"
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-center gap-2 mb-1">
              <Package className="w-4 h-4" style={{ color: '#D97706' }} />
              <span className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>
                Opérations
              </span>
            </div>
            <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {totalCount}
            </p>
          </div>
          <div
            className="rounded-xl p-4"
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-center gap-2 mb-1">
              <Wallet className="w-4 h-4" style={{ color: 'var(--success)' }} />
              <span className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>
                Total recettes
              </span>
            </div>
            <p className="text-2xl font-bold" style={{ color: 'var(--success)' }}>
              {formatCurrency(totalRevenue)}
            </p>
          </div>
        </div>

        {error && (
          <div
            className="rounded-xl px-3 py-2.5 mb-4 flex items-start gap-2 text-sm"
            style={{ backgroundColor: 'var(--danger-light)', color: 'var(--danger)' }}
          >
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>Erreur de chargement : {error}</span>
          </div>
        )}

        {/* Details table */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div
            className="px-3 py-2.5 flex items-center justify-between"
            style={{ backgroundColor: 'var(--surface-raised)' }}
          >
            <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <Package className="w-4 h-4" /> Détails des opérations bagages
            </h3>
            <span className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>
              {totalCount} ligne{totalCount > 1 ? 's' : ''}
            </span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--primary)' }} />
            </div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center">
              <Package className="w-10 h-10 mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Aucune opération bagage sur cette période
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
              <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
                <thead className="sticky top-0" style={{ backgroundColor: 'var(--surface-raised)' }}>
                  <tr style={{ color: 'var(--text-muted)' }}>
                    <th className="px-3 py-2 text-xs font-bold text-left">Date & heure</th>
                    <th className="px-3 py-2 text-xs font-bold text-left">Référence</th>
                    <th className="px-3 py-2 text-xs font-bold text-left">Destination / Ligne</th>
                    <th className="px-3 py-2 text-xs font-bold text-center">Qté</th>
                    <th className="px-3 py-2 text-xs font-bold text-right">Montant unitaire</th>
                    <th className="px-3 py-2 text-xs font-bold text-right">Montant total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const d = new Date(r.created_at);
                    const dateStr = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                    const timeStr = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                    return (
                      <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                          <div className="text-xs font-medium">{dateStr}</div>
                          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{timeStr}</div>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs" style={{ color: 'var(--text-primary)' }}>
                          {r.baggage_number}
                        </td>
                        <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                          <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{r.destination}</div>
                          {r.departure_number != null && (
                            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                              Départ #{r.departure_number}{r.bus_registration ? ` · ${r.bus_registration}` : ''}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-center font-bold" style={{ color: 'var(--text-primary)' }}>
                          1
                        </td>
                        <td className="px-3 py-2 text-xs text-right" style={{ color: 'var(--text-primary)' }}>
                          {formatCurrency(r.price)}
                        </td>
                        <td className="px-3 py-2 text-xs text-right font-bold" style={{ color: 'var(--success)' }}>
                          {formatCurrency(r.price)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="sticky bottom-0" style={{ backgroundColor: 'var(--surface-raised)' }}>
                  <tr style={{ borderTop: '2px solid var(--border)' }}>
                    <td className="px-3 py-2.5 text-xs font-bold" colSpan={3} style={{ color: 'var(--text-primary)' }}>
                      Total réel des recettes bagages
                    </td>
                    <td className="px-3 py-2.5 text-xs text-center font-bold" style={{ color: 'var(--text-primary)' }}>
                      {totalCount}
                    </td>
                    <td className="px-3 py-2.5"></td>
                    <td className="px-3 py-2.5 text-sm text-right font-bold" style={{ color: 'var(--success)' }}>
                      {formatCurrency(totalRevenue)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>
    </POSLayout>
  );
}


export default POSRecetteBagage