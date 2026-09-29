import { useEffect, useState, useMemo } from 'react';
import { Ticket as TicketIcon, Download, Filter, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { formatCurrency } from '@/utils/formatCurrency';
import { fetchKioskTickets, type KioskTicket, type DigitalKiosk, fetchKiosks } from '@/services/kiosk.service';
import { useRealtimeSync } from '@/pages/agent-reservation/shared';

export default function KioskTransactions() {
  const [tickets, setTickets] = useState<KioskTicket[]>([]);
  const [kiosks, setKiosks] = useState<DigitalKiosk[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterKiosk, setFilterKiosk] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'paid' | 'failed'>('all');

  const load = () => {
    Promise.all([fetchKioskTickets(), fetchKiosks()])
      .then(([t, k]) => { setTickets(t); setKiosks(k); })
      .catch(() => toast.error('Erreur de chargement'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);
  useRealtimeSync(['kiosk_tickets'], load);

  const filtered = useMemo(() => {
    return tickets.filter((t) => {
      if (filterKiosk && t.kiosk_id !== filterKiosk) return false;
      if (filterStatus !== 'all' && t.payment_status !== filterStatus) return false;
      return true;
    });
  }, [tickets, filterKiosk, filterStatus]);

  const totalAmount = filtered.filter((t) => t.payment_status === 'paid').reduce((s, t) => s + t.total_amount, 0);

  function exportCSV() {
    const headers = ['Référence', 'Borne', 'Canal', 'Sièges', 'Montant', 'Moyen', 'Statut', 'Date'];
    const rows = filtered.map((t) => [t.ticket_ref, t.kiosk_name ?? '', t.channel, t.seat_numbers.join('; '), t.total_amount, t.payment_method, t.payment_status, new Date(t.created_at).toLocaleString('fr-FR')]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `transactions_bornes.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success('Export téléchargé');
  }

  if (loading) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="w-8 h-8 animate-spin text-[#0B7439]" /></div>;
  }

  const inputCls = 'border border-[#E2EAE5] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/30 bg-white';

  return (
    <div className="space-y-6 p-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1A2E22]">Transactions</h1>
          <p className="text-sm text-[#6B7280] mt-1">Détail des paiements Wave par borne</p>
        </div>
        <button onClick={exportCSV} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium border border-[#E2EAE5] text-[#1A2E22] hover:bg-[#F8FAF8]">
          <Download className="w-4 h-4" /> Exporter
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
          <p className="text-sm text-[#6B7280]">Transactions filtrées</p>
          <p className="text-2xl font-bold text-[#1A2E22]">{filtered.length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
          <p className="text-sm text-[#6B7280]">Payées</p>
          <p className="text-2xl font-bold text-[#0B7439]">{filtered.filter((t) => t.payment_status === 'paid').length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
          <p className="text-sm text-[#6B7280]">Montant encaissé</p>
          <p className="text-2xl font-bold text-[#0B7439]">{formatCurrency(totalAmount)}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5 flex items-center gap-3">
        <Filter className="w-4 h-4 text-[#6B7280]" />
        <select value={filterKiosk} onChange={(e) => setFilterKiosk(e.target.value)} className={inputCls}>
          <option value="">Toutes les bornes</option>
          {kiosks.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as any)} className={inputCls}>
          <option value="all">Tous les statuts</option>
          <option value="paid">Payé</option>
          <option value="pending">En attente</option>
          <option value="failed">Échoué</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-[#6B7280]">
            <TicketIcon className="w-10 h-10 mx-auto mb-2 text-gray-300" />
            <p>Aucune transaction.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#F8FAF8] border-b border-[#E2EAE5]">
                <tr className="text-left text-[#6B7280]">
                  <th className="py-3 px-4 font-medium">Référence</th>
                  <th className="py-3 px-4 font-medium">Borne</th>
                  <th className="py-3 px-4 font-medium">Canal</th>
                  <th className="py-3 px-4 font-medium">Sièges</th>
                  <th className="py-3 px-4 font-medium">Montant</th>
                  <th className="py-3 px-4 font-medium">Paiement</th>
                  <th className="py-3 px-4 font-medium">Statut</th>
                  <th className="py-3 px-4 font-medium">Date/heure</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F4F1]">
                {filtered.map((t) => (
                  <tr key={t.id} className="hover:bg-[#F8FAF8]">
                    <td className="py-2.5 px-4 font-mono font-semibold text-[#1A2E22]">{t.ticket_ref}</td>
                    <td className="py-2.5 px-4 text-[#6B7280]">{t.kiosk_name ?? '—'}</td>
                    <td className="py-2.5 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${t.channel === 'borne' ? 'bg-[#E7F6EC] text-[#0B7439]' : 'bg-[#E6F8FF] text-[#0B86B8]'}`}>
                        {t.channel === 'borne' ? 'Physique' : 'Virtuelle'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-[#6B7280]">{t.seat_numbers.join(', ') || '—'}</td>
                    <td className="py-2.5 px-4 font-bold text-[#1A2E22]">{formatCurrency(t.total_amount)}</td>
                    <td className="py-2.5 px-4 text-[#6B7280] uppercase text-xs">{t.payment_method}</td>
                    <td className="py-2.5 px-4">
                      {t.payment_status === 'paid' && <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-[#E7F6EC] text-[#0B7439]">Payé</span>}
                      {t.payment_status === 'pending' && <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-[#FEF3C7] text-[#B45309]">En attente</span>}
                      {t.payment_status === 'failed' && <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-[#FEE2E2] text-[#DC2626]">Échoué</span>}
                    </td>
                    <td className="py-2.5 px-4 text-[#6B7280] text-xs">{new Date(t.created_at).toLocaleString('fr-FR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
