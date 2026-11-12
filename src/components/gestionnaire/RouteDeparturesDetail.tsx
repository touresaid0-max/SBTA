import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { AlertTriangle, CheckCircle2, Download, Loader2, Search, X } from 'lucide-react';
import { usePagination } from '@/hooks/usePagination';
import Pagination from '@/components/pos/Pagination';
import { type Depart, DeparturesUnavailableError, STATUS_LABELS, departSheetRow, fetchDepartures, fileSafe, fill, fmtF, fmtN, totalsOf } from './departures';

const HEADERS = ['Date', 'Heure', 'N° dép.', 'Ligne', 'Gare', 'Guichet', 'Car', 'Société', 'Statut', 'Places', 'Vendus', 'Rempl.', 'Tickets', 'Bagages', 'Ramassage', 'Caisse', 'Dépenses', 'Solde'];
const FIRST_NUMERIC = 9;
const cells = (d: Depart): string[] => {
  const dt = d.datetime ? new Date(d.datetime) : null;
  return [
    dt ? format(dt, 'dd/MM/yyyy') : '—', dt ? format(dt, 'HH:mm') : '—', d.number != null ? String(d.number) : '—',
    d.route, d.station, d.counter, d.bus, d.company, STATUS_LABELS[d.status] ?? d.status,
    d.isDeparture ? fmtN(d.capacity) : '—', fmtN(d.seats), d.isDeparture ? fill(d.seats, d.capacity) : '—',
    fmtF(d.tickets), d.baggageCount > 0 ? `${fmtF(d.baggage)} (${d.baggageCount})` : fmtF(d.baggage),
    fmtF(d.ramassage), fmtF(d.caisse), fmtF(d.expenses), fmtF(d.solde),
  ];
};

interface Props {
  routeId: string;
  routeName: string;
  dateFrom: string;
  dateTo: string;
  /** Figures of the report line, to show that the detail adds up to them */
  expectedTrips: number;
  expectedRevenue: number;
  expectedExpenses: number;
  onClose: () => void;
}

export default function RouteDeparturesDetail({ routeId, routeName, dateFrom, dateTo, expectedTrips, expectedRevenue, expectedExpenses, onClose }: Props) {
  const [rows, setRows] = useState<Depart[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [station, setStation] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    setRows(null); setError(null); setStation(null); setSearch('');
    fetchDepartures(routeId, dateFrom, dateTo)
      .then(list => { if (!cancelled) setRows(list); })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof DeparturesUnavailableError
          ? 'Le détail des départs n’est pas encore disponible sur le serveur.'
          : 'Impossible de charger le détail des départs. Réessayez.');
      });
    return () => { cancelled = true; };
  }, [routeId, dateFrom, dateTo]);

  const all = useMemo(() => rows ?? [], [rows]);

  const stations = useMemo(() => {
    const m = new Map<string, { id: string; name: string; rows: Depart[] }>();
    for (const r of all) {
      const g = m.get(r.stationId) ?? { id: r.stationId, name: r.station, rows: [] };
      g.rows.push(r);
      m.set(r.stationId, g);
    }
    return [...m.values()]
      .map(g => ({ ...g, t: totalsOf(g.rows) }))
      .sort((a, b) => b.t.voyages - a.t.voyages || a.name.localeCompare(b.name, 'fr'));
  }, [all]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter(r => (!station || r.stationId === station)
      && (!q || [r.bus, r.counter, r.number != null ? String(r.number) : '', STATUS_LABELS[r.status] ?? r.status]
        .some(v => v.toLowerCase().includes(q))));
  }, [all, station, search]);

  const total = useMemo(() => totalsOf(all), [all]);
  const ft = useMemo(() => totalsOf(filtered), [filtered]);
  const pager = usePagination(filtered, 'gestionnaire-route-departs-page-size', `${routeId}|${dateFrom}|${dateTo}|${station}|${search}`);

  const matches = rows != null
    && total.voyages === expectedTrips
    && Math.round(total.recette) === Math.round(expectedRevenue)
    && Math.round(total.expenses) === Math.round(expectedExpenses);

  const stationName = station ? stations.find(s => s.id === station)?.name ?? '' : '';

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(stations.map(s => ({
      'Gare': s.name, 'Voyages': s.t.voyages, 'Vendus': s.t.seats, 'Tickets': s.t.tickets, 'Bagages': s.t.baggage,
      'Ramassage': s.t.ramassage, 'Caisse': s.t.caisse, 'Dépenses': s.t.expenses, 'Solde': s.t.solde, 'Recettes (rapport)': s.t.recette,
    }))), 'Par gare');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filtered.map(departSheetRow)), 'Départs');
    XLSX.writeFile(wb, `departs_${fileSafe(routeName)}${stationName ? '_' + fileSafe(stationName) : ''}_${dateFrom}_${dateTo}.xlsx`);
  };

  const chip = (active: boolean) => ({
    borderColor: active ? '#10B981' : 'var(--border)',
    backgroundColor: active ? 'rgba(16,185,129,0.12)' : 'var(--surface)',
    color: active ? '#047857' : 'var(--text-secondary)',
  });

  return (
    <div className="space-y-3 p-3 sm:p-4" style={{ backgroundColor: 'var(--bg-subtle)' }} data-testid="route-departures-detail">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Détail des {expectedTrips} voyages · {routeName}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Du {format(new Date(dateFrom + 'T00:00'), 'dd/MM/yyyy')} au {format(new Date(dateTo + 'T00:00'), 'dd/MM/yyyy')} · votre société uniquement
          </p>
        </div>
        <div className="flex items-center gap-2">
          {rows && rows.length > 0 && (
            <button type="button" onClick={exportExcel}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-secondary)' }}>
              <Download className="h-3.5 w-3.5" /> Excel
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Fermer le détail" title="Fermer le détail"
            className="flex h-8 w-8 items-center justify-center rounded-lg border"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-secondary)' }}>
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {rows == null && !error && (
        <div className="flex items-center gap-2 py-6 text-xs" style={{ color: 'var(--text-muted)' }}>
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement des départs…
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: '#FCA5A5', color: '#B91C1C', backgroundColor: 'rgba(239,68,68,0.06)' }}>
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {rows && rows.length === 0 && (
        <p className="py-4 text-xs" style={{ color: 'var(--text-muted)' }}>Aucun départ trouvé pour cette ligne sur la période.</p>
      )}

      {rows && rows.length > 0 && (
        <>
          {/* Where the voyages come from */}
          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
            <span className="font-bold">{total.voyages} voyages</span>
            {' = '}
            {stations.map((s, i) => (
              <span key={s.id}>
                {i > 0 && ' + '}
                <span className="font-bold">{s.t.voyages}</span> de {s.name}
              </span>
            ))}
          </p>

          <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${matches ? '' : 'font-semibold'}`}
            style={matches
              ? { borderColor: '#A7F3D0', color: '#047857', backgroundColor: 'rgba(16,185,129,0.06)' }
              : { borderColor: '#FCD34D', color: '#92400E', backgroundColor: 'rgba(245,158,11,0.08)' }}>
            {matches ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
            <span>
              {matches
                ? `${total.voyages} voyages · ${fmtF(total.recette)} de recettes · ${fmtF(total.expenses)} de charges : identique à la ligne du rapport.`
                : `Le détail (${total.voyages} voyages, ${fmtF(total.recette)}, ${fmtF(total.expenses)} de charges) ne correspond pas à la ligne du rapport (${expectedTrips} voyages, ${fmtF(expectedRevenue)}, ${fmtF(expectedExpenses)}). Actualisez la page ; si l’écart reste, signalez-le.`}
            </span>
          </div>

          {/* By gare */}
          <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                  {['Gare', 'Voyages', 'Vendus', 'Rempl.', 'Tickets', 'Bagages', 'Ramassage', 'Caisse', 'Dépenses', 'Solde'].map((h, i) => (
                    <th key={h} className={`px-3 py-2 font-semibold whitespace-nowrap ${i > 0 ? 'text-right' : 'text-left'}`} style={{ color: 'var(--text-secondary)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stations.map(s => {
                  const active = station === s.id;
                  return (
                    <tr key={s.id} className="cursor-pointer border-t" onClick={() => setStation(active ? null : s.id)}
                      style={{ borderColor: 'var(--border)', backgroundColor: active ? 'rgba(16,185,129,0.08)' : undefined }}
                      title={active ? 'Afficher toutes les gares' : `Afficher les départs de ${s.name}`}>
                      <td className="px-3 py-2 font-semibold whitespace-nowrap" style={{ color: active ? '#047857' : 'var(--text-primary)' }}>
                        <span className="underline decoration-dotted underline-offset-2">{s.name}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-bold" style={{ color: 'var(--text-primary)' }}>{fmtN(s.t.voyages)}</td>
                      <td className="px-3 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>{fmtN(s.t.seats)}</td>
                      <td className="px-3 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>{fill(s.t.seats, s.t.capacity)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{fmtF(s.t.tickets)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{fmtF(s.t.baggage)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{fmtF(s.t.ramassage)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap font-semibold" style={{ color: 'var(--text-primary)' }}>{fmtF(s.t.caisse)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap" style={{ color: '#DC2626' }}>{fmtF(s.t.expenses)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap font-bold" style={{ color: s.t.solde >= 0 ? '#15803D' : '#DC2626' }}>{fmtF(s.t.solde)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setStation(null)} className="rounded-full border px-3 py-1 text-xs font-semibold" style={chip(station == null)}>
              Toutes les gares · {total.voyages}
            </button>
            {stations.map(s => (
              <button key={s.id} type="button" onClick={() => setStation(station === s.id ? null : s.id)}
                className="rounded-full border px-3 py-1 text-xs font-semibold" style={chip(station === s.id)}>
                {s.name} · {s.t.voyages}
              </button>
            ))}
            <label className="relative ml-auto">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Car, guichet, N°…" aria-label="Rechercher un départ"
                className="w-44 rounded-lg border py-1.5 pl-8 pr-2 text-xs"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
            </label>
          </div>

          {/* Departures */}
          <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                    {HEADERS.map((h, i) => (
                      <th key={h} className={`px-3 py-2 font-semibold whitespace-nowrap ${i >= FIRST_NUMERIC ? 'text-right' : 'text-left'}`} style={{ color: 'var(--text-secondary)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pager.pageItems.map(d => (
                    <tr key={d.key} className="border-t" style={{ borderColor: 'var(--border)', opacity: d.status === 'annule' ? 0.55 : 1 }}>
                      {cells(d).map((c, i) => (
                        <td key={i} className={`px-3 py-2 whitespace-nowrap ${i >= FIRST_NUMERIC ? 'text-right' : ''}`}
                          style={{
                            color: i === 17 ? (d.solde >= 0 ? '#15803D' : '#DC2626') : i === 16 ? '#DC2626' : i === 6 || i === 15 ? 'var(--text-primary)' : 'var(--text-secondary)',
                            fontWeight: i === 6 || i === 15 || i === 17 ? 700 : 400,
                          }}>
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={HEADERS.length} className="px-3 py-6 text-center" style={{ color: 'var(--text-muted)' }}>Aucun départ ne correspond à la recherche.</td></tr>
                  )}
                </tbody>
                {filtered.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 font-bold" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)' }}>
                      <td colSpan={FIRST_NUMERIC} className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                        Total {station ? stationName : 'toutes gares'} · {ft.voyages} voyage{ft.voyages > 1 ? 's' : ''}
                      </td>
                      {[fmtN(ft.capacity), fmtN(ft.seats), fill(ft.seats, ft.capacity), fmtF(ft.tickets), fmtF(ft.baggage), fmtF(ft.ramassage), fmtF(ft.caisse), fmtF(ft.expenses), fmtF(ft.solde)].map((c, i) => (
                        <td key={i} className="px-3 py-2 text-right whitespace-nowrap"
                          style={{ color: i === 8 ? (ft.solde >= 0 ? '#15803D' : '#DC2626') : i === 7 ? '#DC2626' : 'var(--text-primary)' }}>{c}</td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {filtered.length > 0 && (
              <div className="border-t px-3 py-1" style={{ borderColor: 'var(--border)' }}>
                <Pagination page={pager.page} pageCount={pager.pageCount} pageSize={pager.pageSize} total={pager.total}
                  onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize} itemLabel="départs" />
              </div>
            )}
          </div>

          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            Caisse = Tickets + Bagages + Ramassage, comme au bordereau du guichet. Les recettes du rapport ne comptent pas les bagages
            {total.transferred > 0 ? ` et déduisent la part reversée à une autre société après panne (${fmtF(total.transferred)})` : ''}.
            Un ramassage direct (encaissé sans départ programmé) compte pour un voyage, comme dans le rapport.
          </p>
        </>
      )}
    </div>
  );
}
