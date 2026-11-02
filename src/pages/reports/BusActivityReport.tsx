import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import { Bus, Download, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import PeriodFilter from '../../components/shared/PeriodFilter';
import { getDateRangeFromPeriod, PeriodFilter as PeriodType, exportToCSV } from '../../utils/reportHelpers';
import { format } from 'date-fns';

export default function BusActivityReport() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodType>('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [busActivity, setBusActivity] = useState<any[]>([]);

  useEffect(() => {
    loadReportData();
  }, [period, customStart, customEnd]);

  const loadReportData = async () => {
    try {
      setLoading(true);

      const dateRange = getDateRangeFromPeriod(
        period,
        customStart ? new Date(customStart) : undefined,
        customEnd ? new Date(customEnd) : undefined
      );

      const [busesRes, schedulesRes, reservationsRes, fuelRes] = await Promise.all([
        supabase.from('buses').select('id, registration_number, total_seats, capacity'),
        supabase
          .from('schedules')
          .select('id, bus_id, seats_reserved, seats_available')
          .gte('departure_datetime', dateRange.start.toISOString())
          .lte('departure_datetime', dateRange.end.toISOString()),
        Promise.resolve({ data: [] }),
        supabase
          .from('fuel_vouchers')
          .select('*')
          .in('status', ['validated', 'valide_comptable', 'utilise'])
          .gte('created_at', dateRange.start.toISOString())
          .lte('created_at', dateRange.end.toISOString())
      ]);

      const busData = (busesRes.data || []).map(bus => {
        const busSchedules = (schedulesRes.data || []).filter(s => s.bus_id === bus.id);
        const trips = busSchedules.length;

        const totalSeatsAll = busSchedules.reduce((sum, s) => sum + (s.seats_reserved + s.seats_available), 0);
        const reservedAll = busSchedules.reduce((sum, s) => sum + s.seats_reserved, 0);
        const occupancy = totalSeatsAll > 0 ? (reservedAll / totalSeatsAll) * 100 : 0;

        const busFuel = (fuelRes.data || []).filter((f: any) => f.bus_id === bus.id);
        const fuelConsumed = busFuel.reduce((sum: number, f: any) => sum + (f.actual_liters || 0), 0);

        const kmPerTrip = 250;
        const kmTraveled = trips * kmPerTrip;

        return {
          licensePlate: bus.registration_number,
          kmTraveled,
          trips,
          hoursService: trips * 4,
          occupancy,
          fuelConsumed
        };
      });

      setBusActivity(busData);
    } catch (error: any) {
      console.error('Erreur chargement rapport:', error);
      toast.error('Erreur de chargement');
    } finally {
      setLoading(false);
    }
  };

  const exportExcel = () => {
    exportToCSV(busActivity, `activite-bus-${format(new Date(), 'yyyy-MM-dd')}`);
    toast.success('Export Excel réussi');
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <button
          onClick={() => navigate('/reports')}
          className="mb-4 flex items-center gap-2 text-sm font-semibold"
          style={{ color: 'var(--primary)' }}
        >
          <ArrowLeft className="w-4 h-4" />
          Retour aux rapports
        </button>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2 flex items-center gap-3">
              <Bus className="w-8 h-8" style={{ color: '#14b8a6' }} />
              Rapport Activité Bus
            </h1>
            <p style={{ color: 'var(--text-secondary)' }}>
              Kilomètres, voyages, occupation et consommation par bus
            </p>
          </div>

          <button
            onClick={exportExcel}
            className="px-6 py-3 rounded-lg font-bold flex items-center gap-2 shadow-md"
            style={{ backgroundColor: 'var(--success)', color: 'white' }}
          >
            <Download className="w-5 h-5" />
            Export Excel
          </button>
        </div>
      </div>

      <div className="mb-6">
        <PeriodFilter
          value={period}
          onChange={setPeriod}
          customStart={customStart}
          customEnd={customEnd}
          onCustomStartChange={setCustomStart}
          onCustomEndChange={setCustomEnd}
        />
      </div>

      <div className="bg-white rounded-xl border p-6 mb-6">
        <h3 className="font-bold text-lg mb-4">Taux d'occupation par bus</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={busActivity}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="licensePlate" />
            <YAxis />
            <Tooltip formatter={(value: number) => `${value.toFixed(1)}%`} />
            <Legend />
            <Bar dataKey="occupancy" fill="#14b8a6" name="Taux d'occupation (%)" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="p-6 border-b">
          <h3 className="font-bold text-lg">Détail par bus</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead style={{ backgroundColor: 'var(--neutral-100)' }}>
              <tr>
                <th className="text-left p-4 font-semibold">Bus</th>
                <th className="text-center p-4 font-semibold">Km parcourus</th>
                <th className="text-center p-4 font-semibold">Voyages</th>
                <th className="text-center p-4 font-semibold">Heures service</th>
                <th className="text-center p-4 font-semibold">Taux occupation</th>
                <th className="text-center p-4 font-semibold">Carburant (L)</th>
              </tr>
            </thead>
            <tbody>
              {busActivity.map((bus, index) => (
                <tr key={index} className="border-t hover:bg-gray-50">
                  <td className="p-4 font-mono font-bold">{bus.licensePlate}</td>
                  <td className="p-4 text-center font-semibold">
                    {bus.kmTraveled.toLocaleString()} km
                  </td>
                  <td className="p-4 text-center">{bus.trips}</td>
                  <td className="p-4 text-center">{bus.hoursService}h</td>
                  <td className="p-4 text-center">
                    <span
                      className="px-3 py-1 rounded-full text-sm font-bold"
                      style={{
                        backgroundColor: bus.occupancy >= 70 ? 'var(--success-light)' : bus.occupancy >= 50 ? 'var(--warning-light)' : 'var(--danger-light)',
                        color: bus.occupancy >= 70 ? 'var(--success)' : bus.occupancy >= 50 ? 'var(--warning)' : 'var(--danger)'
                      }}
                    >
                      {bus.occupancy.toFixed(1)}%
                    </span>
                  </td>
                  <td className="p-4 text-center font-semibold">
                    {bus.fuelConsumed.toFixed(0)} L
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
