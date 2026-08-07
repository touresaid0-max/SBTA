import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import POSLayout from '@/components/pos/POSLayout';
import { usePOSSession } from '@/services/pos/POSSessionContext';
import {
  getAllDeparts, computeSolde,
  getDepartsForOtherStations, type DepartRecord,
} from '@/services/pos/departService';
import { getTicketsForDepart, type TicketRecord } from '@/services/pos/ticketService';
import { getBagagesForDepart, type BagageRecord } from '@/services/pos/bagageService';
import { getDepensesForDepart, type DepenseRecord } from '@/services/pos/depenseService';
import { formatCurrency } from '@/utils/formatCurrency';
import {
  Building2, Loader2, ArrowLeft, Ticket as TicketIcon,
  Package, Receipt, Wallet, MapPin,
} from 'lucide-react';

interface OtherGareSummary {
  depart: DepartRecord;
  tickets: TicketRecord[];
  bagages: BagageRecord[];
  depenses: DepenseRecord[];
  solde: number;
}

export default function POSAutresGares() {
  const navigate = useNavigate();
  const { session } = usePOSSession();
  const [summaries, setSummaries] = useState<OtherGareSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const otherDeparts = await getDepartsForOtherStations(session?.station_id ?? '', session?.counter_id);
      const allDeparts = otherDeparts.length > 0 ? otherDeparts : await getAllDeparts(session?.station_id, session?.counter_id);
      const filtered = allDeparts.filter(d => d.station_id !== (session?.station_id ?? ''));

      const results: OtherGareSummary[] = [];
      for (const depart of filtered.slice(0, 20)) {
        const [tickets, bagages, depenses] = await Promise.all([
          getTicketsForDepart(depart.id),
          getBagagesForDepart(depart.id),
          getDepensesForDepart(depart.id),
        ]);
        const visibleDepenses = depenses.filter(d => d.description !== '__deleted__');
        const totDepense = visibleDepenses.reduce((sum, x) => sum + x.amount, 0);
        results.push({
          depart,
          tickets: tickets.filter(t => t.status !== 'cancelled'),
          bagages,
          depenses: visibleDepenses,
          solde: depart.mt_ticket + depart.mt_bagage - totDepense,
        });
      }
      setSummaries(results);
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }, [session?.station_id]);

  useEffect(() => { loadData(); }, [loadData]);

  const totals = useMemo(() => {
    return summaries.reduce(
      (acc, s) => {
        acc.tickets += s.tickets.length;
        acc.bagages += s.bagages.length;
        acc.mtTicket += s.depart.mt_ticket;
        acc.mtBagage += s.depart.mt_bagage;
        acc.totDepense += s.depenses.reduce((sum, x) => sum + x.amount, 0);
        acc.solde += s.solde;
        return acc;
      },
      { tickets: 0, bagages: 0, mtTicket: 0, mtBagage: 0, totDepense: 0, solde: 0 },
    );
  }, [summaries]);

  if (loading) {
    return (
      <POSLayout showBack stationName={session?.station_name} activeRoute="Autres gares">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--primary)' }} />
        </div>
      </POSLayout>
    );
  }

  return (
    <POSLayout showBack stationName={session?.station_name} activeRoute="Autres gares">
      <div className="max-w-3xl mx-auto">
        <div className="rounded-xl p-4 mb-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <h3 className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Building2 className="w-4 h-4" /> Suivi autres gares
          </h3>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            <div className="text-center">
              <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Tickets</p>
              <p className="text-lg font-bold" style={{ color: 'var(--info)' }}>{totals.tickets}</p>
            </div>
            <div className="text-center">
              <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Bagages</p>
              <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{totals.bagages}</p>
            </div>
            <div className="text-center">
              <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>MT Ticket</p>
              <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(totals.mtTicket)}</p>
            </div>
            <div className="text-center">
              <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>MT Bagage</p>
              <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(totals.mtBagage)}</p>
            </div>
            <div className="text-center">
              <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Dépenses</p>
              <p className="text-xs font-bold" style={{ color: 'var(--danger)' }}>{formatCurrency(totals.totDepense)}</p>
            </div>
            <div className="text-center">
              <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Solde</p>
              <p className="text-xs font-bold" style={{ color: totals.solde >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatCurrency(totals.solde)}</p>
            </div>
          </div>
        </div>

        {summaries.length === 0 ? (
          <div className="text-center py-12">
            <MapPin className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Aucun départ d'autres gares trouvé</p>
          </div>
        ) : (
          <div className="space-y-2">
            {summaries.map(s => (
              <div key={s.depart.id} className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
                <button
                  onClick={() => setExpandedId(expandedId === s.depart.id ? null : s.depart.id)}
                  className="w-full flex items-center justify-between p-3 text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--primary-light)' }}>
                      <MapPin className="w-5 h-5" style={{ color: 'var(--primary)' }} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                        {s.depart.station_name ?? 'Gare'} — #{s.depart.route_number}
                      </p>
                      <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                        {s.depart.route_name} · {s.depart.departure_date} {s.depart.departure_time}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="text-right">
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Solde</p>
                      <p className="text-sm font-bold" style={{ color: s.solde >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatCurrency(s.solde)}</p>
                    </div>
                  </div>
                </button>

                {expandedId === s.depart.id && (
                  <div className="px-3 pb-3 space-y-2" style={{ borderTop: '1px solid var(--border)' }}>
                    <div className="grid grid-cols-4 gap-2 pt-2">
                      <div className="rounded-lg p-2 text-center" style={{ backgroundColor: 'var(--surface-raised)' }}>
                        <TicketIcon className="w-4 h-4 mx-auto mb-1" style={{ color: 'var(--info)' }} />
                        <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{s.tickets.length}</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Tickets</p>
                      </div>
                      <div className="rounded-lg p-2 text-center" style={{ backgroundColor: 'var(--surface-raised)' }}>
                        <Package className="w-4 h-4 mx-auto mb-1" style={{ color: 'var(--text-secondary)' }} />
                        <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{s.bagages.length}</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Bagages</p>
                      </div>
                      <div className="rounded-lg p-2 text-center" style={{ backgroundColor: 'var(--surface-raised)' }}>
                        <Receipt className="w-4 h-4 mx-auto mb-1" style={{ color: 'var(--danger)' }} />
                        <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(s.depenses.reduce((sum, x) => sum + x.amount, 0))}</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Dépenses</p>
                      </div>
                      <div className="rounded-lg p-2 text-center" style={{ backgroundColor: 'var(--surface-raised)' }}>
                        <Wallet className="w-4 h-4 mx-auto mb-1" style={{ color: 'var(--success)' }} />
                        <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(s.solde)}</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Solde</p>
                      </div>
                    </div>

                    {s.tickets.length > 0 && (
                      <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                        <p className="px-2 py-1.5 text-xs font-bold" style={{ backgroundColor: 'var(--surface-raised)', color: 'var(--text-secondary)' }}>Tickets vendus</p>
                        <div className="max-h-32 overflow-y-auto">
                          {s.tickets.map(t => (
                            <div key={t.id} className="flex justify-between px-2 py-1 text-xs" style={{ borderTop: '1px solid var(--border)' }}>
                              <span style={{ color: 'var(--text-primary)' }}>Siège {t.seat_number} — {t.destination}</span>
                              <span style={{ color: 'var(--text-secondary)' }}>{formatCurrency(t.price)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {s.bagages.length > 0 && (
                      <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                        <p className="px-2 py-1.5 text-xs font-bold" style={{ backgroundColor: 'var(--surface-raised)', color: 'var(--text-secondary)' }}>Bagages</p>
                        <div className="max-h-32 overflow-y-auto">
                          {s.bagages.map(b => (
                            <div key={b.id} className="flex justify-between px-2 py-1 text-xs" style={{ borderTop: '1px solid var(--border)' }}>
                              <span style={{ color: 'var(--text-primary)' }}>{b.bagage_number} — {b.destination}</span>
                              <span style={{ color: 'var(--text-secondary)' }}>{formatCurrency(b.price)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-4">
          <button
            onClick={() => navigate('/guichet/accueil')}
            className="flex items-center gap-2 text-sm font-bold"
            style={{ color: 'var(--text-secondary)' }}
          >
            <ArrowLeft className="w-4 h-4" /> Retour à l'accueil
          </button>
        </div>
      </div>
    </POSLayout>
  );
}
