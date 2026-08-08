import React from 'react';
import { Monitor, RefreshCw, Users } from 'lucide-react';
import type { CounterStatsResult } from '../hooks/useStationCounterStats';

interface Props {
  stats: CounterStatsResult;
  title?: string;
  subtitle?: string;
  compact?: boolean;
}

export default function StationCounterResultsTable({
  stats,
  title = 'Synthèse par guichet',
  subtitle = 'Aujourd\'hui',
  compact = false,
}: Props) {
  const { rows, totals, loading, refresh } = stats;

  const fmt = (v: number) => v.toLocaleString('fr-FR');

  if (loading && rows.length === 0) {
    return (
      <div className="rounded-2xl border shadow-sm" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="px-6 py-4 border-b flex items-center gap-2" style={{ borderColor: 'var(--border)' }}>
          <Monitor className="w-5 h-5" style={{ color: 'var(--primary)' }} />
          <h3 className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>{title}</h3>
        </div>
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 rounded-full animate-spin"
            style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border shadow-sm overflow-hidden"
      style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          <Monitor className="w-5 h-5" style={{ color: 'var(--primary)' }} />
          <h3 className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>{title}</h3>
          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
            {subtitle}
          </span>
          <span className="ml-2 flex items-center gap-1 text-xs font-medium"
            style={{ color: '#16A34A' }}>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            Temps réel
          </span>
        </div>
        <button onClick={refresh}
          className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
          style={{ color: 'var(--primary)' }}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Actualiser
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
          <Monitor className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p>Aucun guichet configuré pour cette gare</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                {['Guichet', 'Guichetier', 'Départs', 'Billets vendus', 'Sièges restants', 'Montant tickets', 'Charges', 'Solde'].map(h => (
                  <th key={h} className={`px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide ${compact ? 'px-3 py-2' : ''}`}
                    style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.counter_id ?? i}
                  className="border-t transition-colors hover:bg-gray-50"
                  style={{ borderColor: 'var(--border)' }}>
                  <td className={compact ? 'px-3 py-3' : 'px-5 py-4'}>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm text-white flex-shrink-0"
                        style={{ backgroundColor: 'var(--primary)' }}>
                        {row.counter_number ?? '?'}
                      </div>
                      <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                        Guichet {row.counter_number ?? '—'}
                      </span>
                    </div>
                  </td>
                  <td className={compact ? 'px-3 py-3' : 'px-5 py-4'} style={{ color: 'var(--text-secondary)' }}>
                    {row.guichetier_name ? (
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-green-500" />
                        <span>{row.guichetier_name}</span>
                      </div>
                    ) : (
                      <span className="italic" style={{ color: 'var(--text-muted)' }}>Non assigné</span>
                    )}
                  </td>
                  <td className={`${compact ? 'px-3 py-3' : 'px-5 py-4'} font-semibold text-center`} style={{ color: 'var(--text-primary)' }}>
                    {row.departures}
                  </td>
                  <td className={`${compact ? 'px-3 py-3' : 'px-5 py-4'} font-semibold text-center`} style={{ color: '#0369A1' }}>
                    {row.tickets}
                  </td>
                  <td className={`${compact ? 'px-3 py-3' : 'px-5 py-4'} font-semibold text-center`}
                    style={{ color: row.seats_remaining === 0 && row.departures > 0 ? '#DC2626' : '#16A34A' }}>
                    {row.seats_remaining}
                  </td>
                  <td className={`${compact ? 'px-3 py-3' : 'px-5 py-4'} font-semibold`} style={{ color: '#16A34A' }}>
                    {fmt(row.ticket_amount)}
                  </td>
                  <td className={`${compact ? 'px-3 py-3' : 'px-5 py-4'}`} style={{ color: '#D97706' }}>
                    {fmt(row.charges)}
                  </td>
                  <td className={`${compact ? 'px-3 py-3' : 'px-5 py-4'} font-bold`}
                    style={{ color: row.solde >= 0 ? '#16A34A' : '#DC2626' }}>
                    {fmt(row.solde)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2" style={{ borderColor: 'var(--primary)', backgroundColor: 'var(--primary-light)' }}>
                <td colSpan={2} className={`${compact ? 'px-3 py-3' : 'px-5 py-3'} font-bold text-sm`} style={{ color: 'var(--primary)' }}>
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    TOTAL
                  </div>
                </td>
                <td className={`${compact ? 'px-3 py-3' : 'px-5 py-3'} font-bold text-center`} style={{ color: 'var(--primary)' }}>
                  {totals.departures}
                </td>
                <td className={`${compact ? 'px-3 py-3' : 'px-5 py-3'} font-bold text-center`} style={{ color: 'var(--primary)' }}>
                  {totals.tickets}
                </td>
                <td className={`${compact ? 'px-3 py-3' : 'px-5 py-3'} font-bold text-center`} style={{ color: 'var(--primary)' }}>
                  {totals.seats_remaining}
                </td>
                <td className={`${compact ? 'px-3 py-3' : 'px-5 py-3'} font-bold`} style={{ color: 'var(--primary)' }}>
                  {fmt(totals.ticket_amount)}
                </td>
                <td className={`${compact ? 'px-3 py-3' : 'px-5 py-3'} font-bold`} style={{ color: 'var(--primary)' }}>
                  {fmt(totals.charges)}
                </td>
                <td className={`${compact ? 'px-3 py-3' : 'px-5 py-3'} font-bold`}
                  style={{ color: totals.solde >= 0 ? '#16A34A' : '#DC2626' }}>
                  {fmt(totals.solde)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
