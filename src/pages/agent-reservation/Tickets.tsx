import { useEffect, useMemo, useState } from 'react';
import { Search, Eye, XCircle, Ticket, X, MapPin, User, Phone, CreditCard, Waves } from 'lucide-react';
import toast from 'react-hot-toast';
import { formatCurrency } from '@/utils/formatCurrency';
import { fetchBookings, cancelBooking, type MobileBooking } from '@/services/agentReservation.service';
import { Badge, STATUS_LABELS, STATUS_COLORS, PAYMENT_LABELS, PAYMENT_COLORS, useRealtimeSync } from './shared';

export default function Tickets() {
  const [bookings, setBookings] = useState<MobileBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selected, setSelected] = useState<MobileBooking | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = () => {
    fetchBookings()
      .then(setBookings)
      .catch((e) => { console.error(e); toast.error('Erreur lors du chargement des billets'); })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);
  useRealtimeSync(['mobile_bookings'], load);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bookings.filter((b) => {
      if (statusFilter !== 'all' && b.status !== statusFilter) return false;
      if (!q) return true;
      return [b.booking_ref, b.customer_name, b.customer_email, b.customer_phone, b.origin_city, b.destination_city]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [bookings, search, statusFilter]);

  const handleCancel = async (b: MobileBooking) => {
    if (!window.confirm(`Annuler le billet ${b.booking_ref} ?`)) return;
    setCancelling(true);
    try {
      await cancelBooking(b.id);
      toast.success('Billet annulé');
      setSelected(null);
      load();
    } catch (e) {
      console.error(e);
      toast.error("Impossible d'annuler le billet");
    } finally {
      setCancelling(false);
    }
  };

  const tabs = [
    { key: 'all', label: 'Tous' },
    { key: 'provisional', label: 'Provisoires' },
    { key: 'confirmed', label: 'Définitifs' },
    { key: 'cancelled', label: 'Annulés' },
  ];

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1A2E22]">Liste des billets</h1>
        <p className="text-sm text-[#6B7280] mt-1">Réservations effectuées depuis l'application mobile</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#8AA898]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher (référence, client, ville...)"
            className="w-full border border-[#E2EAE5] rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/30"
          />
        </div>
        <div className="flex gap-1.5 bg-[#F1F5F2] rounded-xl p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setStatusFilter(t.key)}
              className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
              style={statusFilter === t.key ? { backgroundColor: '#fff', color: '#0B7439', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' } : { color: '#6B7280' }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-9 h-9 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-[#6B7280]">
            <Ticket className="w-10 h-10 mb-2 text-[#C5D6CC]" />
            <p className="text-sm">Aucun billet trouvé.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-[#8AA898] border-b border-[#E2EAE5]">
                  <th className="px-4 py-3 font-semibold">N° Billet</th>
                  <th className="px-4 py-3 font-semibold">Client</th>
                  <th className="px-4 py-3 font-semibold">Trajet</th>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold text-center">Places</th>
                  <th className="px-4 py-3 font-semibold text-right">Total</th>
                  <th className="px-4 py-3 font-semibold">Paiement</th>
                  <th className="px-4 py-3 font-semibold">Statut</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F4F1]">
                {filtered.map((b) => (
                  <tr key={b.id} className="hover:bg-[#F8FAF8]">
                    <td className="px-4 py-3 font-medium text-[#1A2E22] whitespace-nowrap">{b.booking_ref}</td>
                    <td className="px-4 py-3 text-[#4A6B55]">{b.customer_name ?? '—'}</td>
                    <td className="px-4 py-3 text-[#4A6B55] whitespace-nowrap">{b.origin_city} → {b.destination_city}</td>
                    <td className="px-4 py-3 text-[#4A6B55] whitespace-nowrap">{b.travel_date ?? '—'}</td>
                    <td className="px-4 py-3 text-center text-[#4A6B55]">{b.seats_count}</td>
                    <td className="px-4 py-3 text-right font-semibold text-[#1A2E22] whitespace-nowrap">{formatCurrency(b.total)}</td>
                    <td className="px-4 py-3"><Badge map={PAYMENT_LABELS} colors={PAYMENT_COLORS} value={b.payment_status} /></td>
                    <td className="px-4 py-3"><Badge map={STATUS_LABELS} colors={STATUS_COLORS} value={b.status} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setSelected(b)} title="Voir" className="p-1.5 rounded-lg hover:bg-[#E7F6EC] text-[#0B7439]">
                          <Eye className="w-4 h-4" />
                        </button>
                        {b.status !== 'cancelled' && (
                          <button onClick={() => handleCancel(b)} title="Annuler" className="p-1.5 rounded-lg hover:bg-[#FEE2E2] text-[#B91C1C]">
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E2EAE5] sticky top-0 bg-white">
              <h2 className="text-lg font-bold text-[#1A2E22]">Billet {selected.booking_ref}</h2>
              <button onClick={() => setSelected(null)} className="p-1 rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5 text-[#8AA898]" />
              </button>
            </div>
            <div className="p-6 space-y-5">
              <div className="flex flex-wrap gap-2">
                <Badge map={STATUS_LABELS} colors={STATUS_COLORS} value={selected.status} />
                <Badge map={PAYMENT_LABELS} colors={PAYMENT_COLORS} value={selected.payment_status} />
              </div>

              <div className="rounded-xl bg-[#F8FAF8] p-4 space-y-2">
                <div className="flex items-center gap-2 text-[#1A2E22] font-medium">
                  <MapPin className="w-4 h-4 text-[#0B7439]" /> {selected.origin_city} → {selected.destination_city}
                </div>
                <p className="text-sm text-[#4A6B55]">
                  {selected.travel_date} · {selected.departure_time} → {selected.arrival_time}
                </p>
                {selected.bus_label && <p className="text-sm text-[#4A6B55]">Bus : {selected.bus_label}</p>}
                {selected.assigned_seats?.length ? (
                  <p className="text-sm text-[#4A6B55]">Sièges attribués : {selected.assigned_seats.join(', ')}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-[#4A6B55]"><User className="w-4 h-4 text-[#8AA898]" /> {selected.customer_name ?? '—'}</div>
                <div className="flex items-center gap-2 text-sm text-[#4A6B55]"><Phone className="w-4 h-4 text-[#8AA898]" /> {selected.customer_phone ?? '—'}</div>
                <div className="flex items-center gap-2 text-sm text-[#4A6B55]"><CreditCard className="w-4 h-4 text-[#8AA898]" /> {selected.payment_method === 'wave' ? 'Wave' : (selected.payment_method ?? '—')}</div>
              </div>

              {selected.payment_method === 'wave' && (
                <div className="rounded-xl border p-4 space-y-1.5 text-sm" style={{ background: '#E6F8FF', borderColor: '#BEE9FB' }}>
                  <div className="flex items-center gap-2 font-semibold" style={{ color: '#0B6B92' }}>
                    <Waves className="w-4 h-4" /> Paiement Wave
                  </div>
                  <div className="flex justify-between"><span className="text-[#0B6B92]">Référence transaction</span><span className="font-medium text-[#0B6B92]">{selected.wave_transaction_ref ?? '—'}</span></div>
                  <div className="flex justify-between"><span className="text-[#0B6B92]">Statut Wave</span><span className="font-medium text-[#0B6B92]">{selected.wave_checkout_status ?? '—'}</span></div>
                  <div className="flex justify-between"><span className="text-[#0B6B92]">Date paiement</span><span className="font-medium text-[#0B6B92]">{selected.payment_date ? new Date(selected.payment_date).toLocaleString('fr-FR') : '—'}</span></div>
                </div>
              )}

              <div>
                <h3 className="text-sm font-semibold text-[#1A2E22] mb-2">Passagers ({selected.passengers.length})</h3>
                <div className="space-y-1.5">
                  {selected.passengers.map((p, i) => (
                    <div key={i} className="text-sm text-[#4A6B55] flex justify-between border-b border-[#F0F4F1] pb-1">
                      <span>{p.firstName} {p.lastName}</span>
                      <span className="text-[#8AA898]">{p.phone}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-[#E2EAE5] p-4 space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-[#6B7280]">Prix billet ({selected.seats_count} × {formatCurrency(selected.unit_price)})</span><span className="text-[#1A2E22]">{formatCurrency(selected.unit_price * selected.seats_count)}</span></div>
                <div className="flex justify-between"><span className="text-[#6B7280]">Frais de service</span><span className="text-[#1A2E22]">{formatCurrency(selected.service_fee)}</span></div>
                <div className="flex justify-between font-bold pt-1.5 border-t border-[#E2EAE5]"><span className="text-[#1A2E22]">Total payé</span><span className="text-[#0B7439]">{formatCurrency(selected.total)}</span></div>
              </div>

              {selected.status !== 'cancelled' && (
                <button
                  onClick={() => handleCancel(selected)}
                  disabled={cancelling}
                  className="w-full py-3 rounded-xl font-semibold text-white flex items-center justify-center gap-2 transition-colors"
                  style={{ backgroundColor: cancelling ? '#8AA898' : '#B91C1C' }}
                >
                  <XCircle className="w-4 h-4" /> {cancelling ? 'Annulation...' : 'Annuler le billet'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
