import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import { Search, MapPin, Calendar, Users, Bus, Clock, Filter, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency } from '../../utils/formatCurrency';

interface Station {
  id: string;
  name: string;
  city: string;
}

interface Schedule {
  id: string;
  departure_datetime: string;
  arrival_datetime: string;
  fill_rate: number;
  available_seats: number;
  routes: {
    base_price: number;
    distance_km: number;
    origin_station: Station;
    destination_station: Station;
  };
  buses: {
    registration_number: string;
    capacity: number;
    seat_configs: {
      class_type: string;
      total_seats: number;
    };
  };
}

export default function SearchTrips() {
  const navigate = useNavigate();
  const [stations, setStations] = useState<Station[]>([]);
  const [searchParams, setSearchParams] = useState({
    origin_city: '',
    destination_city: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    passengers: 1
  });

  const [results, setResults] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);

  const [filters, setFilters] = useState({
    classType: '',
    minPrice: 0,
    maxPrice: 100000,
    timeRange: ''
  });

  useEffect(() => {
    loadStations();
  }, []);

  const loadStations = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('stations')
        .select('id, name, city')
        .eq('is_active', true)
        .order('city');

      if (error) throw error;
      setStations(data || []);
    } catch (error: any) {
      toast.error('Erreur de chargement des gares');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchParams.origin_city || !searchParams.destination_city) {
      toast.error('Veuillez sélectionner les villes de départ et d\'arrivée');
      return;
    }

    if (searchParams.origin_city === searchParams.destination_city) {
      toast.error('Les villes de départ et d\'arrivée doivent être différentes');
      return;
    }

    try {
      setSearching(true);

      const startDate = new Date(searchParams.date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(searchParams.date);
      endDate.setHours(23, 59, 59, 999);

      const { data, error } = await supabase
        .from('schedules')
        .select(`
          id,
          departure_datetime,
          arrival_datetime,
          fill_rate,
          routes:route_id (
            base_price,
            distance_km,
            origin_station:stations!origin_station_id(id, name, city),
            destination_station:stations!destination_station_id(id, name, city)
          ),
          buses:bus_id (
            registration_number,
            capacity,
            seat_configs:seat_config_id(class_type, total_seats)
          )
        `)
        .in('status', ['planifie', 'retard'])
        .gte('departure_datetime', startDate.toISOString())
        .lte('departure_datetime', endDate.toISOString());

      if (error) throw error;

      const filtered = (data || []).filter((schedule: any) => {
        const originCity = schedule.routes?.origin_station?.city;
        const destCity = schedule.routes?.destination_station?.city;
        return originCity === searchParams.origin_city && destCity === searchParams.destination_city;
      });

      const schedulesWithSeats = await Promise.all(
        filtered.map(async (schedule: any) => {
          const { count } = await supabase
            .from('reservations')
            .select('*', { count: 'exact', head: true })
            .eq('schedule_id', schedule.id)
            .in('status', ['en_attente', 'confirmee', 'terminee']);

          const availableSeats = schedule.buses.capacity - (count || 0);

          return {
            ...schedule,
            available_seats: availableSeats
          };
        })
      );

      setResults(schedulesWithSeats as Schedule[]);
    } catch (error: any) {
      toast.error('Erreur lors de la recherche');
    } finally {
      setSearching(false);
    }
  };

  const applyFilters = (schedules: Schedule[]) => {
    return schedules.filter(schedule => {
      if (filters.classType && schedule.buses.seat_configs.class_type !== filters.classType) {
        return false;
      }

      if (schedule.routes.base_price < filters.minPrice || schedule.routes.base_price > filters.maxPrice) {
        return false;
      }

      if (filters.timeRange) {
        const hour = new Date(schedule.departure_datetime).getHours();
        if (filters.timeRange === 'morning' && (hour < 6 || hour >= 12)) return false;
        if (filters.timeRange === 'afternoon' && (hour < 12 || hour >= 18)) return false;
        if (filters.timeRange === 'evening' && (hour < 18 || hour >= 24)) return false;
      }

      return true;
    });
  };

  const filteredResults = applyFilters(results);

  const cities = Array.from(new Set(stations.map(s => s.city))).sort();

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
          Rechercher un voyage
        </h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Trouvez et réservez votre prochain voyage en toute simplicité
        </p>
      </div>

      <div className="bg-white rounded-xl p-6 mb-8 border">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
              Ville de départ
            </label>
            <select
              value={searchParams.origin_city}
              onChange={(e) => setSearchParams({ ...searchParams, origin_city: e.target.value })}
              className="w-full px-4 py-3 rounded-lg border focus:outline-none focus:ring-2"
              style={{ borderColor: 'var(--border)' }}
            >
              <option value="">Sélectionner...</option>
              {cities.map(city => (
                <option key={city} value={city}>{city}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
              Ville d'arrivée
            </label>
            <select
              value={searchParams.destination_city}
              onChange={(e) => setSearchParams({ ...searchParams, destination_city: e.target.value })}
              className="w-full px-4 py-3 rounded-lg border focus:outline-none focus:ring-2"
              style={{ borderColor: 'var(--border)' }}
            >
              <option value="">Sélectionner...</option>
              {cities.filter(c => c !== searchParams.origin_city).map(city => (
                <option key={city} value={city}>{city}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
              Date de départ
            </label>
            <input
              type="date"
              value={searchParams.date}
              onChange={(e) => setSearchParams({ ...searchParams, date: e.target.value })}
              min={format(new Date(), 'yyyy-MM-dd')}
              className="w-full px-4 py-3 rounded-lg border focus:outline-none focus:ring-2"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
              Passagers
            </label>
            <input
              type="number"
              min="1"
              max="10"
              value={searchParams.passengers}
              onChange={(e) => setSearchParams({ ...searchParams, passengers: parseInt(e.target.value) })}
              className="w-full px-4 py-3 rounded-lg border focus:outline-none focus:ring-2"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>

          <div className="flex items-end">
            <button
              onClick={handleSearch}
              disabled={searching}
              className="w-full px-6 py-3 rounded-lg text-white font-medium flex items-center justify-center gap-2 disabled:opacity-50"
              style={{ backgroundColor: 'var(--primary)' }}
            >
              <Search className="w-5 h-5" />
              Rechercher
            </button>
          </div>
        </div>
      </div>

      {results.length > 0 && (
        <div className="bg-white rounded-xl p-6 mb-6 border">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
            <h3 className="font-semibold">Filtres</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>Classe</label>
              <select
                value={filters.classType}
                onChange={(e) => setFilters({ ...filters, classType: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg"
              >
                <option value="">Toutes les classes</option>
                <option value="Standard">Standard</option>
                <option value="VIP">VIP</option>
                <option value="Executive">Executive</option>
              </select>
            </div>

            <div>
              <label className="block text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>Horaire</label>
              <select
                value={filters.timeRange}
                onChange={(e) => setFilters({ ...filters, timeRange: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg"
              >
                <option value="">Tous les horaires</option>
                <option value="morning">Matin (6h-12h)</option>
                <option value="afternoon">Après-midi (12h-18h)</option>
                <option value="evening">Soir (18h-24h)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
                Prix max: {formatCurrency(filters.maxPrice)}
              </label>
              <input
                type="range"
                min="0"
                max="100000"
                step="5000"
                value={filters.maxPrice}
                onChange={(e) => setFilters({ ...filters, maxPrice: parseInt(e.target.value) })}
                className="w-full"
              />
            </div>
          </div>
        </div>
      )}

      {searching ? (
        <div className="text-center py-12">
          <div className="w-12 h-12 border-4 rounded-full animate-spin mx-auto mb-4"
               style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Recherche en cours...</p>
        </div>
      ) : results.length > 0 ? (
        <div>
          <div className="mb-4">
            <p style={{ color: 'var(--text-secondary)' }}>
              {filteredResults.length} voyage{filteredResults.length > 1 ? 's' : ''} trouvé{filteredResults.length > 1 ? 's' : ''}
            </p>
          </div>

          <div className="space-y-4">
            {filteredResults.map(schedule => (
              <div key={schedule.id} className="bg-white rounded-xl p-6 border hover:shadow-lg transition-shadow">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="flex items-center gap-2">
                        <MapPin className="w-5 h-5" style={{ color: 'var(--primary)' }} />
                        <div>
                          <p className="font-bold text-lg">{schedule.routes.origin_station.name}</p>
                          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                            {format(new Date(schedule.departure_datetime), 'HH:mm')}
                          </p>
                        </div>
                      </div>

                      <ChevronRight className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />

                      <div className="flex items-center gap-2">
                        <MapPin className="w-5 h-5" style={{ color: 'var(--primary)' }} />
                        <div>
                          <p className="font-bold text-lg">{schedule.routes.destination_station.name}</p>
                          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                            {format(new Date(schedule.arrival_datetime), 'HH:mm')}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-6 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      <div className="flex items-center gap-2">
                        <Bus className="w-4 h-4" />
                        <span>{schedule.buses.registration_number}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4" />
                        <span>{schedule.available_seats} place{schedule.available_seats > 1 ? 's' : ''} disponible{schedule.available_seats > 1 ? 's' : ''}</span>
                      </div>
                      <div className="px-3 py-1 rounded-full text-xs font-medium"
                           style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
                        {schedule.buses.seat_configs.class_type}
                      </div>
                    </div>
                  </div>

                  <div className="text-right ml-6">
                    <p className="text-2xl font-bold mb-2" style={{ color: 'var(--primary)' }}>
                      {formatCurrency(schedule.routes.base_price)}
                    </p>
                    <button
                      onClick={() => navigate(`/client/booking/${schedule.id}`)}
                      className="px-6 py-2 rounded-lg text-white font-medium"
                      style={{ backgroundColor: 'var(--primary)' }}
                      disabled={schedule.available_seats < searchParams.passengers}
                    >
                      Réserver
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
