import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import POSLayout from '@/components/pos/POSLayout';
import { usePOSSession } from '@/services/pos/POSSessionContext';
import {
  getAllDeparts, updateDepart, type DepartRecord,
  seatsLibres, computeSolde,
} from '@/services/pos/departService';
import {
  departToSummary, exportToExcel, exportToPDF, printDeparturesList,
} from '@/services/pos/posReportService';
import { formatCurrency } from '@/utils/formatCurrency';
import {
  Plus, Pencil, Printer, Ticket, CheckCircle, XCircle, Lock,
  ChevronUp, ChevronDown, Eye, Loader2, X,
  FileText, FileSpreadsheet, Copy,
} from 'lucide-react';

type SortKey = 'departure_datetime' | 'departure_number' | 'route_number' | 'route_name' | 'bus_plate' | 'bus_name' | 'driver_name' | 'seats_total' | 'seats_libres' | 'seats_sold' | 'cloture' | 'mt_ticket' | 'mt_bagage' | 'tot_depense' | 'solde' | 'caisse';
type SortDir = 'asc' | 'desc';

interface DepartRow extends DepartRecord {
  seats_libres: number;
  solde_calc: number;
}

function toRow(d: DepartRecord): DepartRow {
  return { ...d, seats_libres: seatsLibres(d), solde_calc: computeSolde(d) };
}

function getSortValue(row: DepartRow, key: SortKey): string | number | boolean {
  switch (key) {
    case 'departure_datetime': return row.departure_datetime;
    case 'departure_number': return row.departure_number;
    case 'route_number': return row.route_number;
    case 'route_name': return row.route_name ?? '';
    case 'bus_plate': return row.bus_plate ?? '';
    case 'bus_name': return row.bus_name ?? '';
    case 'driver_name': return row.driver_name ?? '';
    case 'seats_total': return row.seats_total;
    case 'seats_libres': return row.seats_libres;
    case 'seats_sold': return row.seats_sold;
    case 'cloture': return row.cloture;
    case 'mt_ticket': return row.mt_ticket;
    case 'mt_bagage': return row.mt_bagage;
    case 'tot_depense': return row.tot_depense;
    case 'solde': return row.solde_calc;
    case 'caisse': return row.caisse;
  }
}

export default function POSDeparts() {
  const navigate = useNavigate();
  const { session } = usePOSSession();
  const [departs, setDeparts] = useState<DepartRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('departure_datetime');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState<DepartRow | null>(null);

  const loadDeparts = useCallback(async () => {
    const all = await getAllDeparts(session?.station_id);
    setDeparts(all.map(toRow));
    setLoading(false);
  }, [session?.station_id]);

  useEffect(() => {
    loadDeparts();
  }, [loadDeparts]);

  const todayStr = new Date().toISOString().split('T')[0];

  const visibleDeparts = useMemo(() => {
    let list = showAll ? departs : departs.filter(d => d.departure_date === todayStr);
    list = [...list].sort((a, b) => {
      let cmp = 0;
      const av = getSortValue(a, sortKey); const bv = getSortValue(b, sortKey);
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else if (typeof av === 'boolean' && typeof bv === 'boolean') cmp = av === bv ? 0 : av ? 1 : -1;
      else cmp = String(av ?? '').localeCompare(String(bv ?? ''));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [departs, showAll, sortKey, sortDir, todayStr]);

  const totals = useMemo(() => {
    return visibleDeparts.reduce((acc, d) => ({
      seats_total: acc.seats_total + d.seats_total,
      seats_sold: acc.seats_sold + d.seats_sold,
      seats_libres: acc.seats_libres + d.seats_libres,
      mt_ticket: acc.mt_ticket + d.mt_ticket,
      mt_bagage: acc.mt_bagage + d.mt_bagage,
      tot_depense: acc.tot_depense + d.tot_depense,
      solde: acc.solde + d.solde_calc,
      caisse: acc.caisse + d.caisse,
    }), { seats_total: 0, seats_sold: 0, seats_libres: 0, mt_ticket: 0, mt_bagage: 0, tot_depense: 0, solde: 0, caisse: 0 });
  }, [visibleDeparts]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const selectedRow = visibleDeparts.find(d => d.id === selectedId) ?? null;

  const handleAction = async (action: string, depart: DepartRow) => {
    setActionLoading(true);
    try {
      if (action === 'vente') {
        navigate(`/guichet/depart/${depart.id}/vente`);
        return;
      }
      if (action === 'confirmer') {
        await updateDepart(depart.id, { confirmed: true, status: 'confirmed' });
      }
      if (action === 'annuler') {
        setShowCancelConfirm(depart);
        setActionLoading(false);
        return;
      }
      if (action === 'fermer') {
        await updateDepart(depart.id, { cloture: true, status: 'closed' });
      }
      if (action === 'modifier') {
        // Future: navigate to edit screen
        return;
      }
      if (action === 'imprimer') {
        const summaries = visibleDeparts.map(departToSummary);
        printDeparturesList(summaries, session?.station_name);
        return;
      }
      await loadDeparts();
    } catch {
      // non-critical
    } finally {
      setActionLoading(false);
    }
  };

  const confirmCancel = async () => {
    if (!showCancelConfirm) return;
    setActionLoading(true);
    try {
      await updateDepart(showCancelConfirm.id, { cancelled: true, status: 'cancelled' });
      await loadDeparts();
    } catch {
      // non-critical
    } finally {
      setActionLoading(false);
      setShowCancelConfirm(null);
    }
  };

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ChevronUp className="w-3 h-3 opacity-30" />;
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  const th = 'px-2 py-2 text-xs font-bold whitespace-nowrap cursor-pointer select-none';
  const td = 'px-2 py-2.5 text-sm whitespace-nowrap';

  if (loading) {
    return (
      <POSLayout showBack stationName={session?.station_name} activeRoute="Départs">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--primary)' }} />
        </div>
      </POSLayout>
    );
  }

  return (
    <POSLayout showBack stationName={session?.station_name} activeRoute="Départs">
      {/* Action bar */}
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => navigate('/guichet/depart/nouveau')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            <Plus className="w-4 h-4" /> Nouveau
          </button>
          <button
            onClick={() => printDeparturesList(visibleDeparts.map(departToSummary), session?.station_name)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold border-2"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            <Copy className="w-4 h-4" /> Imprimer liste
          </button>
          <button
            onClick={() => exportToPDF(visibleDeparts.map(departToSummary), `recap-departs-${todayStr}.pdf`, 'Récapitulatif des départs')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold border-2"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            <FileText className="w-4 h-4" /> Export PDF
          </button>
          <button
            onClick={() => exportToExcel(visibleDeparts.map(departToSummary), `recap-departs-${todayStr}.xlsx`)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold border-2"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            <FileSpreadsheet className="w-4 h-4" /> Export Excel
          </button>
          {selectedRow && (
            <>
              <button onClick={() => handleAction('modifier', selectedRow)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold border-2" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                <Pencil className="w-4 h-4" /> Modifier
              </button>
              <button onClick={() => handleAction('imprimer', selectedRow)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold border-2" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                <Printer className="w-4 h-4" /> Imprimer sélection
              </button>
              <button onClick={() => handleAction('vente', selectedRow)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white" style={{ backgroundColor: 'var(--info)' }}>
                <Ticket className="w-4 h-4" /> Vente tickets
              </button>
              {!selectedRow.confirmed && !selectedRow.cancelled && (
                <button onClick={() => handleAction('confirmer', selectedRow)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white" style={{ backgroundColor: 'var(--success)' }}>
                  <CheckCircle className="w-4 h-4" /> Confirmer
                </button>
              )}
              {!selectedRow.cancelled && !selectedRow.cloture && (
                <button onClick={() => handleAction('annuler', selectedRow)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white" style={{ backgroundColor: 'var(--danger)' }}>
                  <XCircle className="w-4 h-4" /> Annuler
                </button>
              )}
              {!selectedRow.cloture && !selectedRow.cancelled && (
                <button onClick={() => handleAction('fermer', selectedRow)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white" style={{ backgroundColor: 'var(--text-secondary)' }}>
                  <Lock className="w-4 h-4" /> Fermer
                </button>
              )}
            </>
          )}
        </div>
        <button
          onClick={() => setShowAll(v => !v)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold border-2"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
        >
          <Eye className="w-4 h-4" /> {showAll ? "Aujourd'hui" : 'Voir tout'}
        </button>
      </div>

      {departs.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Aucun départ. Cliquez sur « Nouveau » pour en créer un.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
            <table className="w-full" style={{ borderCollapse: 'collapse' }}>
              <thead style={{ backgroundColor: 'var(--surface-raised)' }}>
                <tr style={{ color: 'var(--text-secondary)' }}>
                  <th className={th} onClick={() => handleSort('departure_number')}>N°Départ {sortIcon('departure_number')}</th>
                  <th className={th} onClick={() => handleSort('departure_datetime')}>Date {sortIcon('departure_datetime')}</th>
                  <th className={th} onClick={() => handleSort('route_number')}>N°/Ligne {sortIcon('route_number')}</th>
                  <th className={th} onClick={() => handleSort('route_name')}>Ligne {sortIcon('route_name')}</th>
                  <th className={th} onClick={() => handleSort('bus_plate')}>Matricule {sortIcon('bus_plate')}</th>
                  <th className={th} onClick={() => handleSort('bus_name')}>Nom Car {sortIcon('bus_name')}</th>
                  <th className={th} onClick={() => handleSort('driver_name')}>Chauffeur {sortIcon('driver_name')}</th>
                  <th className={th + ' text-right'} onClick={() => handleSort('seats_total')}>Nbre Siège {sortIcon('seats_total')}</th>
                  <th className={th + ' text-right'}>Siège à vendre</th>
                  <th className={th + ' text-right'} onClick={() => handleSort('seats_sold')}>Siège vendu {sortIcon('seats_sold')}</th>
                  <th className={th + ' text-right'} onClick={() => handleSort('seats_libres')}>Siège libre {sortIcon('seats_libres')}</th>
                  <th className={th} onClick={() => handleSort('cloture')}>Clôture {sortIcon('cloture')}</th>
                  <th className={th + ' text-right'} onClick={() => handleSort('mt_ticket')}>MT Ticket {sortIcon('mt_ticket')}</th>
                  <th className={th + ' text-right'} onClick={() => handleSort('mt_bagage')}>MT Bagage {sortIcon('mt_bagage')}</th>
                  <th className={th + ' text-right'} onClick={() => handleSort('tot_depense')}>Tot Dépense {sortIcon('tot_depense')}</th>
                  <th className={th + ' text-right'} onClick={() => handleSort('solde')}>Solde {sortIcon('solde')}</th>
                  <th className={th + ' text-right'} onClick={() => handleSort('caisse')}>Caisse {sortIcon('caisse')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleDeparts.map(d => {
                  const isSelected = d.id === selectedId;
                  return (
                    <tr
                      key={d.id}
                      onClick={() => setSelectedId(isSelected ? null : d.id)}
                      className="cursor-pointer transition-colors"
                      style={{
                        borderTop: '1px solid var(--border)',
                        backgroundColor: isSelected ? 'var(--primary-light)' : d.cancelled ? 'var(--danger-light)' : 'transparent',
                        opacity: d.cancelled ? 0.6 : 1,
                      }}
                    >
                      <td className={td} style={{ fontWeight: 700, color: 'var(--text-primary)' }}>#{d.departure_number}</td>
                      <td className={td} style={{ color: 'var(--text-secondary)' }}>{d.departure_date} {d.departure_time}</td>
                      <td className={td} style={{ color: 'var(--text-secondary)' }}>{d.route_number}</td>
                      <td className={td} style={{ color: 'var(--text-primary)' }}>{d.route_name}</td>
                      <td className={td} style={{ color: 'var(--text-secondary)' }}>{d.bus_plate}</td>
                      <td className={td} style={{ color: 'var(--text-secondary)' }}>{d.bus_name}</td>
                      <td className={td} style={{ color: 'var(--text-secondary)' }}>{d.driver_name}</td>
                      <td className={td + ' text-right'} style={{ fontWeight: 600 }}>{d.seats_total}</td>
                      <td className={td + ' text-right'} style={{ color: 'var(--text-muted)' }}>{d.seats_from}</td>
                      <td className={td + ' text-right'} style={{ color: 'var(--info)', fontWeight: 600 }}>{d.seats_sold}</td>
                      <td className={td + ' text-right'} style={{ color: 'var(--success)', fontWeight: 700 }}>{d.seats_libres}</td>
                      <td className={td}>
                        {d.cloture ? <span style={{ color: 'var(--danger)' }}>Clôturé</span> : d.confirmed ? <span style={{ color: 'var(--success)' }}>Confirmé</span> : <span style={{ color: 'var(--text-muted)' }}>En attente</span>}
                      </td>
                      <td className={td + ' text-right'}>{formatCurrency(d.mt_ticket)}</td>
                      <td className={td + ' text-right'}>{formatCurrency(d.mt_bagage)}</td>
                      <td className={td + ' text-right'}>{formatCurrency(d.tot_depense)}</td>
                      <td className={td + ' text-right'} style={{ fontWeight: 700, color: d.solde_calc >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatCurrency(d.solde_calc)}</td>
                      <td className={td + ' text-right'}>{formatCurrency(d.caisse)}</td>
                    </tr>
                  );
                })}
              </tbody>
              {/* Totals row */}
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border-strong)', backgroundColor: 'var(--surface-raised)' }}>
                  <td className={td} style={{ fontWeight: 800, color: 'var(--text-primary)' }} colSpan={7}>Somme</td>
                  <td className={td + ' text-right'} style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{totals.seats_total}</td>
                  <td className={td}></td>
                  <td className={td + ' text-right'} style={{ fontWeight: 800, color: 'var(--info)' }}>{totals.seats_sold}</td>
                  <td className={td + ' text-right'} style={{ fontWeight: 800, color: 'var(--success)' }}>{totals.seats_libres}</td>
                  <td className={td}></td>
                  <td className={td + ' text-right'} style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{formatCurrency(totals.mt_ticket)}</td>
                  <td className={td + ' text-right'} style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{formatCurrency(totals.mt_bagage)}</td>
                  <td className={td + ' text-right'} style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{formatCurrency(totals.tot_depense)}</td>
                  <td className={td + ' text-right'} style={{ fontWeight: 800, color: totals.solde >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatCurrency(totals.solde)}</td>
                  <td className={td + ' text-right'} style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{formatCurrency(totals.caisse)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
            {visibleDeparts.length} départ(s) {showAll ? '(toutes dates)' : "(aujourd'hui)"} · Cliquez sur une ligne pour la sélectionner et voir les actions
          </p>
        </>
      )}

      {/* Cancel confirmation */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="rounded-2xl shadow-2xl max-w-sm w-full p-6" style={{ backgroundColor: 'var(--surface)' }}>
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Annuler le départ</h3>
              <button onClick={() => setShowCancelConfirm(null)} className="p-1 rounded-lg" style={{ color: 'var(--text-muted)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
              Confirmer l'annulation du départ #{showCancelConfirm.departure_number} ({showCancelConfirm.route_name}) ?
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowCancelConfirm(null)} className="flex-1 py-3 rounded-xl font-bold border-2" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                Non
              </button>
              <button onClick={confirmCancel} disabled={actionLoading} className="flex-1 py-3 rounded-xl font-bold text-white disabled:opacity-60" style={{ backgroundColor: 'var(--danger)' }}>
                {actionLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Oui, annuler'}
              </button>
            </div>
          </div>
        </div>
      )}
    </POSLayout>
  );
}
