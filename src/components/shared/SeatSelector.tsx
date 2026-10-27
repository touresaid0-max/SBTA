import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import { formatCurrency } from '../../utils/formatCurrency';

interface Seat {
  row: number;
  column: number;
  number: string;
  type: 'standard' | 'vip' | 'driver' | 'disabled';
  price_multiplier: number;
}

interface SeatSelectorProps {
  scheduleId: string;
  basePrice: number;
  onSeatSelect: (seatNumber: string, price: number) => void;
  selectedSeat?: string;
}

export default function SeatSelector({ scheduleId, basePrice, onSeatSelect, selectedSeat }: SeatSelectorProps) {
  const [seatConfig, setSeatConfig] = useState<any>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [reservedSeats, setReservedSeats] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSeats();
  }, [scheduleId]);

  const loadSeats = async () => {
    try {
      setLoading(true);

      const { data: schedule, error: scheduleError } = await supabase
        .from('schedules')
        .select(`
          id,
          buses:bus_id (
            seat_config_id,
            seats_sold_from
          )
        `)
        .eq('id', scheduleId)
        .single();

      if (scheduleError) throw scheduleError;

      const seatConfigId = schedule.buses?.seat_config_id;
      const seatsSoldFrom = Math.max(1, Number(schedule.buses?.seats_sold_from ?? 1));
      if (!seatConfigId) throw new Error('Configuration de sièges non trouvée');

      const { data: config, error: configError } = await supabase
        .from('seat_configs')
        .select('*')
        .eq('id', seatConfigId)
        .single();

      if (configError) throw configError;

      setSeatConfig(config);
      setSeats(config.layout || []);

      const { data: reservations, error: reservationsError } = await supabase
        .from('reservations')
        .select('seat_number')
        .eq('schedule_id', scheduleId)
        .in('status', ['confirmed', 'paid', 'embarked']);

      if (reservationsError) throw reservationsError;

      setReservedSeats(reservations.map(r => r.seat_number));
    } catch (error: any) {
      toast.error('Erreur de chargement des sièges');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const getSeatStatus = (seat: Seat) => {
    if (seat.type === 'driver' || seat.type === 'disabled' || Number(seat.number) < seatsSoldFrom) return 'unavailable';
    if (reservedSeats.includes(seat.number)) return 'reserved';
    if (selectedSeat === seat.number) return 'selected';
    return 'available';
  };

  const getSeatColor = (status: string, seatType: string) => {
    if (status === 'selected') return '#FFC107';
    if (status === 'reserved') return '#AF3029';
    if (status === 'unavailable') return '#424242';
    if (seatType === 'vip') return '#0B7439';
    return '#4CAF50';
  };

  const getSeatIcon = (status: string, seatType: string) => {
    if (status === 'selected') return '🟡';
    if (status === 'reserved') return '🔴';
    if (status === 'unavailable') return '⬛';
    if (seatType === 'vip') return '💺';
    return '🟢';
  };

  const handleSeatClick = (seat: Seat) => {
    const status = getSeatStatus(seat);
    if (status === 'reserved' || status === 'unavailable') {
      toast.error('Ce siège n\'est pas disponible');
      return;
    }

    const price = basePrice * seat.price_multiplier;
    onSeatSelect(seat.number, price);
  };

  const maxRows = Math.max(...seats.map(s => s.row), 0);
  const maxCols = Math.max(...seats.map(s => s.column), 0);

  const grid = Array.from({ length: maxRows }, (_, rowIndex) => {
    return Array.from({ length: maxCols }, (_, colIndex) => {
      return seats.find(s => s.row === rowIndex + 1 && s.column === colIndex + 1);
    });
  });

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="w-12 h-12 border-4 rounded-full animate-spin mx-auto mb-4"
             style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
        <p style={{ color: 'var(--text-secondary)' }}>Chargement des sièges...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <div className="bg-gray-800 text-white text-center py-3 rounded-t-lg font-semibold">
          AVANT DU BUS
        </div>
      </div>

      <div className="flex justify-center mb-8">
        <div className="inline-block">
          {grid.map((row, rowIndex) => (
            <div key={rowIndex} className="flex gap-2 mb-2">
              {row.map((seat, colIndex) => {
                if (!seat) {
                  return <div key={colIndex} className="w-14 h-14" />;
                }

                const status = getSeatStatus(seat);
                const isClickable = status === 'available' || status === 'selected';

                return (
                  <button
                    key={`${seat.row}-${seat.column}`}
                    onClick={() => handleSeatClick(seat)}
                    disabled={!isClickable}
                    className={`w-14 h-14 rounded-lg border-2 flex flex-col items-center justify-center text-xs font-bold transition-all ${
                      isClickable ? 'cursor-pointer hover:scale-110' : 'cursor-not-allowed opacity-60'
                    }`}
                    style={{
                      backgroundColor: getSeatColor(status, seat.type),
                      borderColor: status === 'selected' ? '#FF9800' : 'transparent',
                      color: 'white'
                    }}
                    title={`Siège ${seat.number} - ${seat.type === 'vip' ? 'VIP' : 'Standard'} - ${formatCurrency(basePrice * seat.price_multiplier)}`}
                  >
                    <span className="text-lg">{getSeatIcon(status, seat.type)}</span>
                    <span>{seat.number}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 border">
        <h3 className="font-semibold mb-4">Légende</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded flex items-center justify-center" style={{ backgroundColor: '#4CAF50' }}>
              <span>🟢</span>
            </div>
            <span>Disponible</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded flex items-center justify-center" style={{ backgroundColor: '#AF3029' }}>
              <span>🔴</span>
            </div>
            <span>Réservé</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded flex items-center justify-center" style={{ backgroundColor: '#FFC107' }}>
              <span>🟡</span>
            </div>
            <span>Sélectionné</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded flex items-center justify-center" style={{ backgroundColor: '#424242' }}>
              <span>⬛</span>
            </div>
            <span>Hors service</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded flex items-center justify-center" style={{ backgroundColor: '#0B7439' }}>
              <span>💺</span>
            </div>
            <span>VIP</span>
          </div>
        </div>

        {selectedSeat && (
          <div className="mt-6 p-4 rounded-lg" style={{ backgroundColor: 'var(--primary-light)' }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">Siège sélectionné</p>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Siège {selectedSeat}
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold" style={{ color: 'var(--primary)' }}>
                  {formatCurrency(basePrice * (seats.find(s => s.number === selectedSeat)?.price_multiplier || 1))}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
