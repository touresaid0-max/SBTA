import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import { Search, Filter, Eye, XCircle, Download, Printer, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency } from '../../utils/formatCurrency';
import StatusBadge from '../../components/shared/StatusBadge';
import { QRCodeSVG } from 'qrcode.react';
import jsPDF from 'jspdf';

interface Reservation {
  id: string;
  booking_reference: string;
  passenger_name: string;
  passenger_phone: string;
  passenger_email: string;
  seat_number: string;
  ticket_class: string;
  price: number;
  payment_method: string;
  payment_status: string;
  status: string;
  created_at: string;
  schedules: {
    departure_datetime: string;
    routes: {
      origin_station: { name: string };
      destination_station: { name: string };
    };
    buses: {
      registration_number: string;
    };
  };
}

export default function Reservations() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState({
    status: '',
    payment_status: '',
    date_from: '',
    date_to: ''
  });

  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    loadReservations();
  }, []);

  const loadReservations = async () => {
    try {
      setLoading(true);

      let query = supabase
        .from('reservations')
        .select(`
          *,
          schedules:schedule_id (
            departure_datetime,
            routes:route_id (
              origin_station:stations!origin_station_id(name),
              destination_station:stations!destination_station_id(name)
            ),
            buses:bus_id (registration_number)
          )
        `)
        .order('created_at', { ascending: false });

      if (filters.status) {
        query = query.eq('status', filters.status);
      }

      if (filters.payment_status) {
        query = query.eq('payment_status', filters.payment_status);
      }

      if (filters.date_from) {
        query = query.gte('created_at', new Date(filters.date_from).toISOString());
      }

      if (filters.date_to) {
        const dateTo = new Date(filters.date_to);
        dateTo.setHours(23, 59, 59, 999);
        query = query.lte('created_at', dateTo.toISOString());
      }

      const { data, error } = await query;

      if (error) throw error;
      setReservations(data as Reservation[]);
    } catch (error: any) {
      toast.error('Erreur de chargement des réservations');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelReservation = async (id: string) => {
    if (!confirm('Voulez-vous vraiment annuler cette réservation ?')) return;

    try {
      const { error } = await supabase
        .from('reservations')
        .update({ status: 'cancelled' })
        .eq('id', id);

      if (error) throw error;

      toast.success('Réservation annulée');
      loadReservations();
    } catch (error: any) {
      toast.error('Erreur lors de l\'annulation');
    }
  };

  const handleRefund = async (id: string) => {
    if (!confirm('Voulez-vous vraiment rembourser cette réservation ?')) return;

    try {
      const { error } = await supabase
        .from('reservations')
        .update({
          status: 'refunded',
          payment_status: 'remboursee'
        })
        .eq('id', id);

      if (error) throw error;

      toast.success('Réservation remboursée');
      loadReservations();
    } catch (error: any) {
      toast.error('Erreur lors du remboursement');
    }
  };

  const generateTicketPDF = (reservation: Reservation) => {
    const doc = new jsPDF();

    doc.setFontSize(20);
    doc.setTextColor(11, 116, 57);
    doc.text('SBTA', 105, 20, { align: 'center' });

    doc.setFontSize(16);
    doc.setTextColor(0, 0, 0);
    doc.text('BILLET DE VOYAGE', 105, 35, { align: 'center' });

    doc.setFontSize(12);
    doc.text(`Référence: ${reservation.booking_reference}`, 20, 55);

    doc.setFontSize(11);
    doc.text('INFORMATIONS PASSAGER', 20, 70);
    doc.setFontSize(10);
    doc.text(`Nom: ${reservation.passenger_name}`, 20, 80);
    doc.text(`Téléphone: ${reservation.passenger_phone}`, 20, 87);

    doc.setFontSize(11);
    doc.text('DÉTAILS DU VOYAGE', 20, 105);
    doc.setFontSize(10);
    doc.text(`De: ${reservation.schedules.routes.origin_station.name}`, 20, 115);
    doc.text(`À: ${reservation.schedules.routes.destination_station.name}`, 20, 122);
    doc.text(`Date: ${format(new Date(reservation.schedules.departure_datetime), 'dd/MM/yyyy à HH:mm')}`, 20, 129);
    doc.text(`Bus: ${reservation.schedules.buses.registration_number}`, 20, 136);
    doc.text(`Siège: ${reservation.seat_number}`, 20, 143);
    doc.text(`Classe: ${reservation.ticket_class}`, 20, 150);

    doc.setFontSize(14);
    doc.setTextColor(11, 116, 57);
    doc.text(`Prix: ${formatCurrency(reservation.price)}`, 20, 170);

    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text('Présentez ce billet et votre pièce d\'identité lors de l\'embarquement', 105, 270, { align: 'center' });
    doc.text('Merci d\'avoir choisi SBTA', 105, 280, { align: 'center' });

    doc.save(`billet-${reservation.booking_reference}.pdf`);
  };

  const filteredReservations = reservations.filter(r =>
    r.booking_reference.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.passenger_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.passenger_phone.includes(searchTerm)
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed': return 'var(--primary)';
      case 'paid': return 'var(--success)';
      case 'embarked': return 'var(--info)';
      case 'cancelled': return 'var(--danger)';
      case 'refunded': return 'var(--warning)';
      default: return 'var(--neutral-500)';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'confirmed': return 'Confirmé';
      case 'paid': return 'Payé';
      case 'embarked': return 'Embarqué';
      case 'cancelled': return 'Annulé';
      case 'refunded': return 'Remboursé';
      default: return status;
    }
  };

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            Gestion des réservations
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            {filteredReservations.length} réservation{filteredReservations.length > 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={loadReservations}
          className="px-4 py-2 rounded-lg border flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Actualiser
        </button>
      </div>

      <div className="bg-white rounded-xl p-6 mb-6 border">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="md:col-span-2">
            <div className="relative">
              <Search className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2"
                      style={{ color: 'var(--text-secondary)' }} />
              <input
                type="text"
                placeholder="Rechercher par référence, nom, téléphone..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border rounded-lg"
              />
            </div>
          </div>

          <select
            value={filters.status}
            onChange={(e) => {
              setFilters({ ...filters, status: e.target.value });
              loadReservations();
            }}
            className="px-4 py-2 border rounded-lg"
          >
            <option value="">Tous les statuts</option>
            <option value="confirmed">Confirmé</option>
            <option value="paid">Payé</option>
            <option value="embarked">Embarqué</option>
            <option value="cancelled">Annulé</option>
            <option value="refunded">Remboursé</option>
          </select>

          <input
            type="date"
            value={filters.date_from}
            onChange={(e) => {
              setFilters({ ...filters, date_from: e.target.value });
              loadReservations();
            }}
            className="px-4 py-2 border rounded-lg"
            placeholder="Date début"
          />

          <input
            type="date"
            value={filters.date_to}
            onChange={(e) => {
              setFilters({ ...filters, date_to: e.target.value });
              loadReservations();
            }}
            className="px-4 py-2 border rounded-lg"
            placeholder="Date fin"
          />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="w-12 h-12 border-4 rounded-full animate-spin mx-auto mb-4"
               style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Chargement...</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead style={{ backgroundColor: 'var(--neutral-100)' }}>
                <tr>
                  <th className="text-left p-4 font-semibold">Référence</th>
                  <th className="text-left p-4 font-semibold">Passager</th>
                  <th className="text-left p-4 font-semibold">Voyage</th>
                  <th className="text-left p-4 font-semibold">Siège</th>
                  <th className="text-left p-4 font-semibold">Prix</th>
                  <th className="text-left p-4 font-semibold">Statut</th>
                  <th className="text-left p-4 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredReservations.map(reservation => (
                  <tr key={reservation.id} className="border-t hover:bg-gray-50">
                    <td className="p-4">
                      <p className="font-mono text-sm font-semibold">{reservation.booking_reference}</p>
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {format(new Date(reservation.created_at), 'dd/MM/yyyy HH:mm')}
                      </p>
                    </td>
                    <td className="p-4">
                      <p className="font-medium">{reservation.passenger_name}</p>
                      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {reservation.passenger_phone}
                      </p>
                    </td>
                    <td className="p-4">
                      <p className="text-sm">
                        {reservation.schedules.routes.origin_station.name} → {reservation.schedules.routes.destination_station.name}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {format(new Date(reservation.schedules.departure_datetime), 'dd/MM/yyyy à HH:mm')}
                      </p>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{reservation.seat_number}</span>
                        <span className="text-xs px-2 py-1 rounded" style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
                          {reservation.ticket_class}
                        </span>
                      </div>
                    </td>
                    <td className="p-4">
                      <p className="font-semibold">{formatCurrency(reservation.price)}</p>
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {reservation.payment_method}
                      </p>
                    </td>
                    <td className="p-4">
                      <span
                        className="px-3 py-1 rounded-full text-xs font-medium"
                        style={{ backgroundColor: `${getStatusColor(reservation.status)}20`, color: getStatusColor(reservation.status) }}
                      >
                        {getStatusText(reservation.status)}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setSelectedReservation(reservation);
                            setShowModal(true);
                          }}
                          className="p-2 rounded hover:bg-gray-100"
                          title="Voir détails"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => generateTicketPDF(reservation)}
                          className="p-2 rounded hover:bg-gray-100"
                          title="Télécharger billet"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                        {reservation.status === 'confirmed' && (
                          <button
                            onClick={() => handleCancelReservation(reservation.id)}
                            className="p-2 rounded hover:bg-gray-100"
                            title="Annuler"
                          >
                            <XCircle className="w-4 h-4" style={{ color: 'var(--danger)' }} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredReservations.length === 0 && (
            <div className="text-center py-12">
              <p style={{ color: 'var(--text-secondary)' }}>Aucune réservation trouvée</p>
            </div>
          )}
        </div>
      )}

      {showModal && selectedReservation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b flex justify-between items-center">
              <h2 className="text-xl font-bold">Détails de la réservation</h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="text-center">
                <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>Référence</p>
                <p className="text-2xl font-mono font-bold" style={{ color: 'var(--primary)' }}>
                  {selectedReservation.booking_reference}
                </p>
              </div>

              <div className="flex justify-center">
                <QRCodeSVG
                  value={selectedReservation.booking_reference}
                  size={200}
                  level="H"
                  includeMargin
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>Passager</p>
                  <p className="font-semibold">{selectedReservation.passenger_name}</p>
                </div>
                <div>
                  <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>Téléphone</p>
                  <p className="font-semibold">{selectedReservation.passenger_phone}</p>
                </div>
                <div>
                  <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>Départ</p>
                  <p className="font-semibold">{selectedReservation.schedules.routes.origin_station.name}</p>
                </div>
                <div>
                  <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>Arrivée</p>
                  <p className="font-semibold">{selectedReservation.schedules.routes.destination_station.name}</p>
                </div>
                <div>
                  <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>Date & Heure</p>
                  <p className="font-semibold">
                    {format(new Date(selectedReservation.schedules.departure_datetime), 'dd/MM/yyyy à HH:mm')}
                  </p>
                </div>
                <div>
                  <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>Bus</p>
                  <p className="font-semibold">{selectedReservation.schedules.buses.registration_number}</p>
                </div>
                <div>
                  <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>Siège</p>
                  <p className="font-semibold">{selectedReservation.seat_number}</p>
                </div>
                <div>
                  <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>Classe</p>
                  <p className="font-semibold">{selectedReservation.ticket_class}</p>
                </div>
                <div>
                  <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>Prix</p>
                  <p className="font-semibold text-lg" style={{ color: 'var(--primary)' }}>
                    {formatCurrency(selectedReservation.price)}
                  </p>
                </div>
                <div>
                  <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>Statut</p>
                  <span
                    className="px-3 py-1 rounded-full text-xs font-medium inline-block"
                    style={{
                      backgroundColor: `${getStatusColor(selectedReservation.status)}20`,
                      color: getStatusColor(selectedReservation.status)
                    }}
                  >
                    {getStatusText(selectedReservation.status)}
                  </span>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => generateTicketPDF(selectedReservation)}
                  className="flex-1 px-4 py-3 rounded-lg border flex items-center justify-center gap-2 font-medium"
                >
                  <Printer className="w-5 h-5" />
                  Imprimer le billet
                </button>
                <button
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-3 rounded-lg text-white font-medium"
                  style={{ backgroundColor: 'var(--primary)' }}
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
