import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import {
  DollarSign, TrendingUp, CreditCard, Smartphone, Banknote,
  Download, RefreshCw, Users, Clock, CheckCircle, AlertCircle,
  Luggage, Printer, Ticket,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { formatCurrency } from '../../utils/formatCurrency';
import jsPDF from 'jspdf';
import { useAuthStore } from '../../store/authStore';
import { printBaggageTicket, type BaggageTicketData } from '../../utils/printBaggageTicket';

interface Transaction {
  id: string;
  booking_reference: string;
  passenger_name: string;
  passenger_phone: string | null;
  total_price: number;
  total_seats: number;
  seat_numbers: string[];
  payment_status: string;
  status: string;
  created_at: string;
  is_online?: boolean;
  schedule: {
    departure_datetime: string;
    price: number;
    route_name: string | null;
    route: {
      name: string;
      origin_city: { name: string } | null;
      destination_city: { name: string } | null;
    } | null;
  } | null;
}

interface BaggageRow {
  id: string;
  baggage_number: string;
  destination: string;
  price: number;
  seat_number: string | null;
  departure_number: number | null;
  bus_registration: string | null;
  description: string | null;
  owner_name: string;
  owner_phone: string;
  has_ticket: boolean;
  created_at: string;
}

interface Stats {
  total_tickets: number;
  total_reservations: number;
  total_amount: number;
  paid_amount: number;
  pending_amount: number;
}

interface BaggageStats {
  total_baggage: number;
  total_baggage_amount: number;
}

type TabId = 'tickets' | 'bagages';

export default function CashRegister() {
  const { user } = useAuthStore();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [baggageRows, setBaggageRows] = useState<BaggageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [activeTab, setActiveTab] = useState<TabId>('tickets');
  const [stats, setStats] = useState<Stats>({
    total_tickets: 0,
    total_reservations: 0,
    total_amount: 0,
    paid_amount: 0,
    pending_amount: 0,
  });
  const [baggageStats, setBaggageStats] = useState<BaggageStats>({
    total_baggage: 0,
    total_baggage_amount: 0,
  });

  const [myStationName, setMyStationName] = useState('SBTA');

  useEffect(() => {
    if (!user?.id) return;
    supabase.from('counters')
      .select('station_id, stations:station_id(name)')
      .eq('assigned_user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setMyStationName((data as any).stations?.name || 'SBTA');
      });
  }, [user?.id]);

  useEffect(() => {
    if (user?.id) loadData();
  }, [selectedDate, user?.id, myStationName]);

  const loadData = async () => {
    setLoading(true);
    await Promise.all([loadTransactions(), loadBaggage()]);
    setLoading(false);
  };

  const loadTransactions = async () => {
    try {
      const startDate = new Date(selectedDate);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(selectedDate);
      endDate.setHours(23, 59, 59, 999);

      let query = supabase
        .from('reservations')
        .select(`
          id,
          booking_reference,
          passenger_name,
          passenger_phone,
          total_price,
          total_seats,
          seat_numbers,
          payment_status,
          status,
          created_at,
          schedule:schedule_id (
            departure_datetime,
            price,
            route_name,
            route:route_id (
              name,
              origin_city:origin_city_id ( name ),
              destination_city:destination_city_id ( name )
            )
          )
        `)
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
        .in('payment_status', ['payee', 'en_attente'])
        .order('created_at', { ascending: false });

      if (user?.role === 'guichetier' && user?.id) {
        query = query.eq('booked_by', user.id);
      }

      const { data, error } = await query;
      if (error) throw error;

      const rows = (data ?? []) as unknown as Transaction[];

      const onlineRows = await loadOnlineBookings();
      const allRows = [...rows, ...onlineRows].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setTransactions(allRows);

      const totalAmount = allRows.reduce((sum, t) => sum + Number(t.total_price), 0);
      const paidAmount = allRows
        .filter(t => t.payment_status === 'payee')
        .reduce((sum, t) => sum + Number(t.total_price), 0);
      const pendingAmount = allRows
        .filter(t => t.payment_status === 'en_attente')
        .reduce((sum, t) => sum + Number(t.total_price), 0);
      const totalTickets = allRows.reduce((sum, t) => sum + (t.total_seats || 1), 0);

      setStats({
        total_tickets: totalTickets,
        total_reservations: allRows.length,
        total_amount: totalAmount,
        paid_amount: paidAmount,
        pending_amount: pendingAmount,
      });
    } catch (error: any) {
      toast.error('Erreur de chargement des transactions');
      console.error(error);
    }
  };

  const loadOnlineBookings = async (): Promise<Transaction[]> => {
    try {
      let query = supabase
        .from('mobile_bookings')
        .select(`
          id, booking_ref, passengers, payment_phone, seats_count, unit_price,
          assigned_seats, status, created_at, travel_date, departure_time,
          origin_city, destination_city, origin_station, destination_station,
          schedule:schedule_id ( departure_datetime, price )
        `)
        .eq('status', 'confirmed')
        .eq('travel_date', selectedDate);

      // Guichetiers see online sales for their own station; other roles see all
      if (user?.role === 'guichetier' && myStationName && myStationName !== 'SBTA') {
        query = query.eq('origin_station', myStationName);
      }

      const { data, error } = await query;
      if (error) throw error;

      return (data ?? []).map((mb: any): Transaction => {
        const pax = Array.isArray(mb.passengers) && mb.passengers.length > 0 ? mb.passengers[0] : null;
        const ticketAmount = Number(mb.unit_price || 0) * Number(mb.seats_count || 0);
        const depDatetime =
          mb.schedule?.departure_datetime ??
          (mb.travel_date && mb.departure_time ? `${mb.travel_date}T${mb.departure_time}` : mb.travel_date);
        return {
          id: mb.id,
          booking_reference: mb.booking_ref,
          passenger_name: pax?.name || pax?.full_name || pax?.firstName || 'Client en ligne',
          passenger_phone: mb.payment_phone || pax?.phone || null,
          total_price: ticketAmount,
          total_seats: mb.seats_count || (mb.assigned_seats?.length ?? 1),
          seat_numbers: (mb.assigned_seats || []).map((n: number) => String(n)),
          payment_status: 'payee',
          status: 'confirme',
          created_at: mb.created_at,
          is_online: true,
          schedule: {
            departure_datetime: depDatetime,
            price: Number(mb.unit_price || 0),
            route_name:
              mb.origin_city && mb.destination_city
                ? `${mb.origin_city} \u2192 ${mb.destination_city}`
                : null,
            route: null,
          },
        };
      });
    } catch (error: any) {
      console.error('Erreur chargement reservations en ligne:', error);
      return [];
    }
  };

  const loadBaggage = async () => {
    try {
      const startDate = new Date(selectedDate);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(selectedDate);
      endDate.setHours(23, 59, 59, 999);

      let query = supabase
        .from('baggage_tickets')
        .select('id, baggage_number, destination, price, seat_number, departure_number, bus_registration, description, owner_name, owner_phone, has_ticket, created_at')
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
        .order('created_at', { ascending: false });

      if (user?.role === 'guichetier' && user?.id) {
        query = query.eq('sold_by', user.id);
      }

      const { data, error } = await query;
      if (error) throw error;

      const rows = (data ?? []) as BaggageRow[];
      setBaggageRows(rows);
      setBaggageStats({
        total_baggage: rows.length,
        total_baggage_amount: rows.reduce((s, r) => s + Number(r.price), 0),
      });
    } catch (error: any) {
      console.error('Erreur chargement bagages:', error);
    }
  };

  const getRouteLabel = (t: Transaction) => {
    const route = t.schedule?.route;
    if (route?.origin_city && route?.destination_city) {
      return `${route.origin_city.name} \u2192 ${route.destination_city.name}`;
    }
    if (t.schedule?.route_name) return t.schedule.route_name;
    if (route?.name) return route.name;
    return '\u2014';
  };

  const closeCashRegister = () => {
    if (!confirm('Voulez-vous cloturer la caisse ? Cela generera un rapport PDF.')) return;
    generateCashRegisterReport();
    toast.success('Caisse cloturee - Rapport genere');
  };

  const reprintBaggage = (row: BaggageRow) => {
    const data: BaggageTicketData = {
      baggage_number: row.baggage_number,
      destination: row.destination,
      price: row.price,
      seat_number: row.seat_number,
      departure_number: row.departure_number,
      bus_registration: row.bus_registration,
      description: row.description,
      owner_name: row.owner_name,
      owner_phone: row.owner_phone,
      station_name: myStationName,
    };
    printBaggageTicket(data);
  };

  const generateCashRegisterReport = () => {
    const doc = new jsPDF();

    doc.setFontSize(20);
    doc.setTextColor(11, 116, 57);
    doc.text('SBTA', 105, 20, { align: 'center' });

    doc.setFontSize(16);
    doc.setTextColor(0, 0, 0);
    doc.text('RAPPORT DE CAISSE', 105, 32, { align: 'center' });

    doc.setFontSize(11);
    doc.setTextColor(80, 80, 80);
    doc.text(`Date : ${format(new Date(selectedDate), 'dd MMMM yyyy', { locale: fr })}`, 20, 48);
    doc.text(`Guichetier : ${user?.email ?? 'N/A'}`, 20, 56);
    doc.text(`Genere le : ${format(new Date(), 'dd/MM/yyyy a HH:mm')}`, 20, 64);

    doc.setFontSize(13);
    doc.setTextColor(11, 116, 57);
    doc.text('RESUME', 20, 78);

    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    doc.text(`Reservations : ${stats.total_reservations}`, 20, 90);
    doc.text(`Billets vendus : ${stats.total_tickets}`, 20, 98);
    doc.text(`Total encaisse : ${formatCurrency(stats.total_amount)}`, 20, 106);
    doc.text(`  dont paye : ${formatCurrency(stats.paid_amount)}`, 30, 114);
    doc.text(`  dont en attente : ${formatCurrency(stats.pending_amount)}`, 30, 122);
    doc.text(`Bagages vendus : ${baggageStats.total_baggage}`, 20, 134);
    doc.text(`Recettes bagages : ${formatCurrency(baggageStats.total_baggage_amount)}`, 20, 142);

    doc.setFontSize(13);
    doc.setTextColor(11, 116, 57);
    doc.text('DETAIL DES TRANSACTIONS', 20, 158);

    doc.setFontSize(8);
    doc.setTextColor(0, 0, 0);
    let yPos = 170;

    transactions.forEach(t => {
      if (yPos > 272) return;
      const route = getRouteLabel(t);
      const status = t.payment_status === 'payee' ? 'Paye' : 'En attente';
      doc.text(
        `${format(new Date(t.created_at), 'HH:mm')}  ${t.booking_reference}  ${t.passenger_name}  ${route}  ${formatCurrency(Number(t.total_price))}  [${status}]`,
        20,
        yPos
      );
      yPos += 7;
    });

    if (baggageRows.length > 0 && yPos < 250) {
      yPos += 6;
      doc.setFontSize(10);
      doc.setTextColor(11, 116, 57);
      doc.text('BAGAGES', 20, yPos);
      yPos += 8;
      doc.setFontSize(8);
      doc.setTextColor(0, 0, 0);
      baggageRows.forEach(b => {
        if (yPos > 272) return;
        doc.text(
          `${format(new Date(b.created_at), 'HH:mm')}  ${b.baggage_number}  ${b.owner_name}  ${b.destination}  ${formatCurrency(b.price)}`,
          20,
          yPos
        );
        yPos += 7;
      });
    }

    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(`Rapport de caisse SBTA - ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 105, 288, { align: 'center' });

    doc.save(`caisse-${selectedDate}.pdf`);
  };

  const ticketStatCards = [
    {
      label: 'Reservations',
      value: stats.total_reservations,
      icon: <Users className="w-6 h-6" />,
      color: 'var(--primary)',
      bg: 'var(--primary-light)',
      format: (v: number) => String(v),
    },
    {
      label: 'Billets vendus',
      value: stats.total_tickets,
      icon: <TrendingUp className="w-6 h-6" />,
      color: 'var(--primary)',
      bg: 'var(--primary-light)',
      format: (v: number) => String(v),
    },
    {
      label: 'Total encaisse',
      value: stats.total_amount,
      icon: <DollarSign className="w-6 h-6" />,
      color: 'var(--success)',
      bg: 'var(--success-light)',
      format: formatCurrency,
    },
    {
      label: 'Montant paye',
      value: stats.paid_amount,
      icon: <CheckCircle className="w-6 h-6" />,
      color: 'var(--success)',
      bg: 'var(--success-light)',
      format: formatCurrency,
    },
    {
      label: 'En attente',
      value: stats.pending_amount,
      icon: <AlertCircle className="w-6 h-6" />,
      color: 'var(--warning)',
      bg: 'var(--warning-light)',
      format: formatCurrency,
    },
  ];

  const baggageStatCards = [
    {
      label: 'Bagages vendus',
      value: baggageStats.total_baggage,
      icon: <Luggage className="w-6 h-6" />,
      color: 'var(--primary)',
      bg: 'var(--primary-light)',
      format: (v: number) => String(v),
    },
    {
      label: 'Recettes bagages',
      value: baggageStats.total_baggage_amount,
      icon: <DollarSign className="w-6 h-6" />,
      color: 'var(--success)',
      bg: 'var(--success-light)',
      format: formatCurrency,
    },
  ];

  const TABS: { id: TabId; label: string; icon: React.ReactNode; count: number }[] = [
    { id: 'tickets', label: 'Tickets', icon: <Ticket className="w-4 h-4" />, count: transactions.length },
    { id: 'bagages', label: 'Bagages', icon: <Luggage className="w-4 h-4" />, count: baggageRows.length },
  ];

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
            Caisse du jour
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Recapitulatif des ventes et cloture de caisse
          </p>
        </div>
        <div className="flex gap-3 items-center">
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            max={format(new Date(), 'yyyy-MM-dd')}
            className="px-4 py-2 border rounded-lg text-sm"
            style={{ borderColor: 'var(--neutral-200)' }}
          />
          <button
            onClick={loadData}
            className="px-4 py-2 rounded-lg border flex items-center gap-2 text-sm hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Actualiser
          </button>
          <button
            onClick={closeCashRegister}
            disabled={transactions.length === 0 && baggageRows.length === 0}
            className="px-5 py-2 rounded-lg text-white font-medium flex items-center gap-2 text-sm disabled:opacity-50 transition-colors"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            <Download className="w-4 h-4" />
            Cloturer la caisse
          </button>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {ticketStatCards.map(card => (
          <div key={card.label} className="rounded-xl p-5" style={{ backgroundColor: card.bg }}>
            <div className="flex items-center gap-2 mb-3">
              <span style={{ color: card.color }}>{card.icon}</span>
              <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{card.label}</span>
            </div>
            <p className="text-2xl font-bold" style={{ color: card.color }}>{card.format(card.value)}</p>
          </div>
        ))}
      </div>

      {baggageStats.total_baggage > 0 && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          {baggageStatCards.map(card => (
            <div key={card.label} className="rounded-xl p-5" style={{ backgroundColor: card.bg }}>
              <div className="flex items-center gap-2 mb-3">
                <span style={{ color: card.color }}>{card.icon}</span>
                <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{card.label}</span>
              </div>
              <p className="text-2xl font-bold" style={{ color: card.color }}>{card.format(card.value)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 p-1 rounded-xl" style={{ backgroundColor: 'var(--neutral-100)' }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all"
            style={{
              backgroundColor: activeTab === tab.id ? 'white' : 'transparent',
              color: activeTab === tab.id ? 'var(--primary)' : 'var(--text-muted)',
              boxShadow: activeTab === tab.id ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            {tab.icon}
            {tab.label}
            <span
              className="px-2 py-0.5 rounded-full text-xs font-bold"
              style={{
                backgroundColor: activeTab === tab.id ? 'var(--primary-light)' : 'var(--neutral-200)',
                color: activeTab === tab.id ? 'var(--primary)' : 'var(--text-muted)',
              }}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="bg-white rounded-xl border" style={{ borderColor: 'var(--neutral-200)' }}>
        <div className="p-6 border-b flex items-center justify-between" style={{ borderColor: 'var(--neutral-200)' }}>
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            {activeTab === 'tickets' ? 'Transactions' : 'Bagages'} — {format(new Date(selectedDate), 'dd MMMM yyyy', { locale: fr })}
          </h2>
          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {activeTab === 'tickets' ? transactions.length : baggageRows.length} {activeTab === 'tickets' ? 'transaction' : 'bagage'}{(activeTab === 'tickets' ? transactions.length : baggageRows.length) !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <div className="text-center py-16">
            <div
              className="w-10 h-10 border-4 rounded-full animate-spin mx-auto mb-4"
              style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }}
            />
            <p style={{ color: 'var(--text-secondary)' }}>Chargement...</p>
          </div>
        ) : activeTab === 'tickets' ? (
          transactions.length === 0 ? (
            <div className="text-center py-16">
              <DollarSign className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p style={{ color: 'var(--text-secondary)' }}>Aucune transaction pour cette date</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead style={{ backgroundColor: 'var(--neutral-50)' }}>
                  <tr>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Heure</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Reference</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Passager</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Telephone</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Trajet</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Depart</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Sieges</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Montant</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t) => (
                    <tr
                      key={t.id}
                      className="border-t transition-colors hover:bg-gray-50"
                      style={{ borderColor: 'var(--neutral-100)' }}
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
                          <Clock className="w-3.5 h-3.5" />
                          {format(new Date(t.created_at), 'HH:mm')}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className="font-mono text-xs px-2 py-1 rounded" style={{ backgroundColor: 'var(--neutral-100)', color: 'var(--text-primary)' }}>
                          {t.booking_reference}
                        </span>
                        {t.is_online && (
                          <span
                            className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
                            style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}
                          >
                            <Smartphone className="w-2.5 h-2.5" /> En ligne
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                          {t.passenger_name}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                          {t.passenger_phone ?? '\u2014'}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                          {getRouteLabel(t)}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                          {t.schedule?.departure_datetime
                            ? format(new Date(t.schedule.departure_datetime), 'dd/MM HH:mm')
                            : '\u2014'}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-sm font-medium">{t.total_seats}</span>
                        {t.seat_numbers?.length > 0 && (
                          <span className="text-xs ml-1" style={{ color: 'var(--text-secondary)' }}>
                            ({t.seat_numbers.join(', ')})
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <p className="font-bold text-sm" style={{ color: 'var(--primary)' }}>
                          {formatCurrency(Number(t.total_price))}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                          style={{
                            backgroundColor: t.payment_status === 'payee' ? 'var(--success-light)' : 'var(--warning-light)',
                            color: t.payment_status === 'payee' ? 'var(--success)' : 'var(--warning)',
                          }}
                        >
                          {t.payment_status === 'payee'
                            ? <><CheckCircle className="w-3 h-3" /> Paye</>
                            : <><AlertCircle className="w-3 h-3" /> En attente</>
                          }
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          baggageRows.length === 0 ? (
            <div className="text-center py-16">
              <Luggage className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p style={{ color: 'var(--text-secondary)' }}>Aucun bagage pour cette date</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead style={{ backgroundColor: 'var(--neutral-50)' }}>
                  <tr>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Heure</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>N Bagage</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Destination</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Siege</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Car</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Proprietaire</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Contact</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Prix</th>
                    <th className="text-center px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {baggageRows.map(b => (
                    <tr
                      key={b.id}
                      className="border-t transition-colors hover:bg-gray-50"
                      style={{ borderColor: 'var(--neutral-100)' }}
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
                          <Clock className="w-3.5 h-3.5" />
                          {format(new Date(b.created_at), 'HH:mm')}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className="font-mono text-xs px-2 py-1 rounded" style={{ backgroundColor: 'var(--neutral-100)', color: 'var(--text-primary)' }}>
                          {b.baggage_number}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{b.destination}</p>
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{b.seat_number || '\u2014'}</p>
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{b.bus_registration || '\u2014'}</p>
                      </td>
                      <td className="px-5 py-4">
                        <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{b.owner_name}</p>
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{b.owner_phone}</p>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <p className="font-bold text-sm" style={{ color: 'var(--primary)' }}>
                          {formatCurrency(b.price)}
                        </p>
                      </td>
                      <td className="px-5 py-4 text-center">
                        <button
                          onClick={() => reprintBaggage(b)}
                          className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                          title="Reimprimer"
                        >
                          <Printer className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
}
