import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Route as RouteIcon, Plus, CreditCard as Edit2, Trash2, MapPin, Search, X, ArrowDown, GripVertical } from 'lucide-react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';

interface City {
  id: string;
  name: string;
}

interface IntermediateStop {
  id?: string;
  city_id: string;
  city_name?: string;
  price: number;
}

interface RouteData {
  id: string;
  name: string;
  origin_city_id: string;
  destination_city_id: string;
  distance_km: number;
  estimated_duration_minutes: number;
  base_price: number;
  is_active: boolean;
  origin_city?: { name: string };
  destination_city?: { name: string };
  route_city_stops?: IntermediateStop[];
}

export default function Routes() {
  const [routes, setRoutes] = useState<RouteData[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    origin_city_id: '',
    destination_city_id: '',
    distance_km: 0,
    estimated_duration_minutes: 0,
    base_price: 0,
    is_active: true
  });

  const [intermediateStops, setIntermediateStops] = useState<IntermediateStop[]>([]);
  const [calculating, setCalculating] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [routesRes, citiesRes] = await Promise.all([
        supabase
          .from('routes')
          .select('*, origin_city:cities!origin_city_id(name), destination_city:cities!destination_city_id(name)')
          .order('name'),
        supabase.from('cities').select('id, name').order('name')
      ]);

      if (routesRes.error) throw routesRes.error;
      if (citiesRes.error) throw citiesRes.error;

      setRoutes(routesRes.data || []);
      setCities(citiesRes.data || []);
    } catch (error: any) {
      toast.error('Erreur de chargement');
    } finally {
      setLoading(false);
    }
  };

  const calculateDistance = async () => {
    if (!formData.origin_city_id || !formData.destination_city_id) {
      toast.error('Veuillez sélectionner les villes d\'origine et de destination');
      return;
    }

    if (formData.origin_city_id === formData.destination_city_id) {
      toast.error('Les villes d\'origine et de destination doivent être différentes');
      return;
    }

    setCalculating(true);

    try {
      const originCity = cities.find(c => c.id === formData.origin_city_id);
      const destinationCity = cities.find(c => c.id === formData.destination_city_id);

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/calculate-route-distance`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          origin: originCity?.name,
          destination: destinationCity?.name,
        }),
      });

      const data = await response.json();

      if (data.error) {
        toast.error(data.error);
        return;
      }

      setFormData({
        ...formData,
        distance_km: data.distance_km,
        estimated_duration_minutes: data.duration_minutes,
      });

      toast.success(`Distance: ${data.distance_text}, Durée: ${data.duration_text}`);
    } catch (error: any) {
      toast.error('Erreur lors du calcul de la distance');
      console.error(error);
    } finally {
      setCalculating(false);
    }
  };

  const loadRouteStops = async (routeId: string): Promise<IntermediateStop[]> => {
    const { data, error } = await supabase
      .from('route_city_stops')
      .select('id, city_id, price, cities!inner(name)')
      .eq('route_id', routeId)
      .order('position');

    if (error) throw error;

    return (data || []).map((s: any) => ({
      id: s.id,
      city_id: s.city_id,
      city_name: s.cities?.name,
      price: Number(s.price) || 0,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.origin_city_id === formData.destination_city_id) {
      toast.error('Les villes d\'origine et de destination doivent être différentes');
      return;
    }

    if (saving) return;
    setSaving(true);

    try {
      let routeId = editingId;

      if (editingId) {
        const { error } = await supabase
          .from('routes')
          .update(formData)
          .eq('id', editingId);

        if (error) throw error;
        toast.success('Itinéraire mis à jour');
      } else {
        const { data, error } = await supabase
          .from('routes')
          .insert([formData])
          .select('id')
          .single();

        if (error) throw error;
        routeId = data.id;
        toast.success('Itinéraire créé');
      }

      // Sync intermediate stops
      if (routeId) {
        await syncIntermediateStops(routeId, intermediateStops);
      }

      setShowForm(false);
      setEditingId(null);
      resetForm();
      loadData();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const syncIntermediateStops = async (routeId: string, stops: IntermediateStop[]) => {
    // Delete existing stops that are no longer in the list
    const existingIds = stops.filter(s => s.id).map(s => s.id);
    if (editingId) {
      const { data: current } = await supabase
        .from('route_city_stops')
        .select('id')
        .eq('route_id', routeId);

      if (current && current.length > 0) {
        const toDelete = current.filter((c: any) => !existingIds.includes(c.id)).map((c: any) => c.id);
        if (toDelete.length > 0) {
          await supabase.from('route_city_stops').delete().in('id', toDelete);
        }
      }
    } else {
      // New route - delete all existing (shouldn't be any, but be safe)
      await supabase.from('route_city_stops').delete().eq('route_id', routeId);
    }

    // Upsert stops with correct positions
    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i];
      const payload = {
        route_id: routeId,
        city_id: stop.city_id,
        position: i + 1,
        price: stop.price,
      };

      if (stop.id) {
        const { error } = await supabase
          .from('route_city_stops')
          .update(payload)
          .eq('id', stop.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('route_city_stops')
          .insert([payload])
          .select('id')
          .single();
        if (error) throw error;
        stop.id = data.id;
      }
    }
  };

  const handleEdit = async (route: RouteData) => {
    setFormData({
      name: route.name,
      origin_city_id: route.origin_city_id,
      destination_city_id: route.destination_city_id,
      distance_km: route.distance_km,
      estimated_duration_minutes: route.estimated_duration_minutes,
      base_price: route.base_price,
      is_active: route.is_active
    });
    setEditingId(route.id);

    try {
      const stops = await loadRouteStops(route.id);
      setIntermediateStops(stops);
    } catch {
      setIntermediateStops([]);
    }

    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Voulez-vous vraiment supprimer cet itinéraire?')) return;

    try {
      const { error } = await supabase
        .from('routes')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast.success('Itinéraire supprimé');
      loadData();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      origin_city_id: '',
      destination_city_id: '',
      distance_km: 0,
      estimated_duration_minutes: 0,
      base_price: 0,
      is_active: true
    });
    setIntermediateStops([]);
  };

  // --- Intermediate stops management ---

  const addIntermediateStop = (cityId: string, cityName: string) => {
    if (intermediateStops.some(s => s.city_id === cityId)) {
      toast.error('Cette ville est déjà dans les destinations intermédiaires');
      return;
    }
    if (cityId === formData.origin_city_id) {
      toast.error('La ville d\'origine ne peut pas être une destination intermédiaire');
      return;
    }
    if (cityId === formData.destination_city_id) {
      toast.error('La ville de destination ne peut pas être une destination intermédiaire');
      return;
    }
    setIntermediateStops([...intermediateStops, { city_id: cityId, city_name: cityName, price: 0 }]);
  };

  const removeIntermediateStop = (index: number) => {
    setIntermediateStops(intermediateStops.filter((_, i) => i !== index));
  };

  const updateStopPrice = (index: number, price: number) => {
    setIntermediateStops(intermediateStops.map((s, i) => i === index ? { ...s, price } : s));
  };

  const moveStop = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === intermediateStops.length - 1) return;
    const newStops = [...intermediateStops];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    [newStops[index], newStops[swapIndex]] = [newStops[swapIndex], newStops[index]];
    setIntermediateStops(newStops);
  };

  if (loading) {
    return <div className="p-8">Chargement...</div>;
  }

  const query = search.trim().toLowerCase();
  const filteredRoutes = query
    ? routes.filter((route) =>
        [route.name, route.origin_city?.name, route.destination_city?.name]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(query))
      )
    : routes;

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            Itinéraires
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            {query ? `${filteredRoutes.length} / ${routes.length} itinéraires` : `${routes.length} itinéraires au total`}
          </p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="px-6 py-3 rounded-lg flex items-center gap-2 text-white font-medium"
          style={{ backgroundColor: 'var(--primary)' }}
        >
          <Plus className="w-5 h-5" />
          Nouvel itinéraire
        </button>
      </div>

      <div className="mb-6 relative max-w-md">
        <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--neutral-400)' }} />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher par nom, origine ou destination..."
          className="w-full pl-10 pr-10 py-3 border rounded-lg"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 rounded"
            title="Effacer"
          >
            <X className="w-4 h-4" style={{ color: 'var(--neutral-500)' }} />
          </button>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl w-full max-w-2xl my-8">
            <div className="p-6 border-b sticky top-0 bg-white rounded-t-xl z-10">
              <h2 className="text-2xl font-bold">
                {editingId ? 'Modifier' : 'Nouvel'} itinéraire
              </h2>
            </div>

            <form onSubmit={handleSubmit} className="p-6">
              <div className="space-y-4">
                <div>
                  <label className="block mb-2 font-medium">Nom de l'itinéraire *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full p-3 border rounded-lg"
                    placeholder="Ex: Dakar - Saint-Louis"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block mb-2 font-medium">Ville d'origine *</label>
                    <select
                      value={formData.origin_city_id}
                      onChange={(e) => setFormData({ ...formData, origin_city_id: e.target.value })}
                      className="w-full p-3 border rounded-lg"
                      required
                    >
                      <option value="">Sélectionner une ville</option>
                      {cities.map(city => (
                        <option key={city.id} value={city.id}>{city.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block mb-2 font-medium">Ville de destination *</label>
                    <select
                      value={formData.destination_city_id}
                      onChange={(e) => setFormData({ ...formData, destination_city_id: e.target.value })}
                      className="w-full p-3 border rounded-lg"
                      required
                    >
                      <option value="">Sélectionner une ville</option>
                      {cities.map(city => (
                        <option key={city.id} value={city.id}>{city.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Intermediate Destinations Section */}
                <div className="border-2 border-dashed rounded-lg p-4" style={{ borderColor: 'var(--neutral-300)' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <MapPin className="w-5 h-5" style={{ color: 'var(--primary)' }} />
                    <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                      Destinations intermédiaires
                    </h3>
                  </div>
                  <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
                    Ajoutez les villes intermédiaires entre l'origine et la destination, dans l'ordre du trajet.
                  </p>

                  {/* Ordered list of stops */}
                  {intermediateStops.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {intermediateStops.map((stop, index) => (
                        <div
                          key={stop.city_id}
                          className="flex items-center gap-2 bg-white rounded-lg border p-2"
                          style={{ borderColor: 'var(--neutral-200)' }}
                        >
                          <GripVertical className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />

                          <div className="flex items-center gap-1 flex-shrink-0">
                            <span
                              className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                              style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}
                            >
                              {index + 1}
                            </span>
                          </div>

                          <div className="flex-1 flex items-center gap-1.5 min-w-0">
                            <MapPin className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                            <span className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                              {stop.city_name || cities.find(c => c.id === stop.city_id)?.name}
                            </span>
                          </div>

                          <div className="flex items-center gap-1 flex-shrink-0">
                            <input
                              type="number"
                              value={stop.price}
                              onChange={(e) => updateStopPrice(index, parseFloat(e.target.value) || 0)}
                              className="w-24 p-1.5 text-sm border rounded text-right"
                              min="0"
                              step="100"
                              placeholder="Tarif"
                            />
                            <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>FCFA</span>
                          </div>

                          <div className="flex flex-col flex-shrink-0">
                            <button
                              type="button"
                              onClick={() => moveStop(index, 'up')}
                              disabled={index === 0}
                              className="p-0.5 hover:bg-gray-100 rounded disabled:opacity-30"
                              title="Monter"
                            >
                              <ArrowDown className="w-3 h-3 rotate-180" style={{ color: 'var(--text-secondary)' }} />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveStop(index, 'down')}
                              disabled={index === intermediateStops.length - 1}
                              className="p-0.5 hover:bg-gray-100 rounded disabled:opacity-30"
                              title="Descendre"
                            >
                              <ArrowDown className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() => removeIntermediateStop(index)}
                            className="p-1.5 hover:bg-red-50 rounded-lg flex-shrink-0"
                            title="Supprimer"
                          >
                            <Trash2 className="w-4 h-4" style={{ color: 'var(--danger)' }} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {intermediateStops.length === 0 && (
                    <div className="text-center py-4 mb-2">
                      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                        Aucune destination intermédiaire. Ajoutez-en ci-dessous.
                      </p>
                    </div>
                  )}

                  <CityAutocomplete
                    cities={cities}
                    excludedIds={[
                      formData.origin_city_id,
                      formData.destination_city_id,
                      ...intermediateStops.map(s => s.city_id),
                    ]}
                    onSelect={addIntermediateStop}
                    onCityCreated={(city) => {
                      setCities([...cities, city]);
                      addIntermediateStop(city.id, city.name);
                    }}
                  />
                </div>

                <div>
                  <button
                    type="button"
                    onClick={calculateDistance}
                    disabled={!formData.origin_city_id || !formData.destination_city_id || calculating}
                    className="w-full px-4 py-3 rounded-lg border-2 border-dashed font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}
                  >
                    {calculating ? 'Calcul en cours...' : '🗺️ Calculer automatiquement la distance et la durée'}
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block mb-2 font-medium">Distance (km) *</label>
                    <input
                      type="number"
                      value={formData.distance_km}
                      onChange={(e) => setFormData({ ...formData, distance_km: parseFloat(e.target.value) })}
                      className="w-full p-3 border rounded-lg bg-gray-50"
                      min="0"
                      step="0.1"
                      required
                      readOnly
                    />
                  </div>

                  <div>
                    <label className="block mb-2 font-medium">Durée estimée (min) *</label>
                    <input
                      type="number"
                      value={formData.estimated_duration_minutes}
                      onChange={(e) => setFormData({ ...formData, estimated_duration_minutes: parseInt(e.target.value) })}
                      className="w-full p-3 border rounded-lg bg-gray-50"
                      min="0"
                      step="15"
                      required
                      readOnly
                    />
                  </div>

                  <div>
                    <label className="block mb-2 font-medium">Prix de base (FCFA) *</label>
                    <input
                      type="number"
                      value={formData.base_price}
                      onChange={(e) => setFormData({ ...formData, base_price: parseFloat(e.target.value) })}
                      className="w-full p-3 border rounded-lg"
                      min="0"
                      step="100"
                      required
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="is_active"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <label htmlFor="is_active" className="font-medium">Itinéraire actif</label>
                </div>
              </div>

              <div className="flex gap-4 mt-6">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-3 rounded-lg text-white font-medium disabled:opacity-50"
                  style={{ backgroundColor: 'var(--primary)' }}
                >
                  {saving ? 'Enregistrement...' : (editingId ? 'Mettre à jour' : 'Créer')}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setEditingId(null); resetForm(); }}
                  className="px-6 py-3 rounded-lg border"
                  disabled={saving}
                >
                  Annuler
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border overflow-hidden">
        <table className="w-full">
          <thead style={{ backgroundColor: 'var(--neutral-100)' }}>
            <tr>
              <th className="text-left p-4 font-semibold">Nom</th>
              <th className="text-left p-4 font-semibold">Origine</th>
              <th className="text-left p-4 font-semibold">Destination</th>
              <th className="text-left p-4 font-semibold">Distance</th>
              <th className="text-left p-4 font-semibold">Durée</th>
              <th className="text-left p-4 font-semibold">Prix de base</th>
              <th className="text-left p-4 font-semibold">Statut</th>
              <th className="text-left p-4 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredRoutes.map((route) => (
              <React.Fragment key={route.id}>
                <tr className="border-t hover:bg-gray-50">
                  <td className="p-4">
                    <span className="font-bold">{route.name}</span>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4" style={{ color: 'var(--success)' }} />
                      {route.origin_city?.name}
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4" style={{ color: 'var(--danger)' }} />
                      {route.destination_city?.name}
                    </div>
                  </td>
                  <td className="p-4">{route.distance_km} km</td>
                  <td className="p-4">{Math.floor(route.estimated_duration_minutes / 60)}h{route.estimated_duration_minutes % 60 > 0 ? ` ${route.estimated_duration_minutes % 60}min` : ''}</td>
                  <td className="p-4">{route.base_price.toLocaleString()} FCFA</td>
                  <td className="p-4">
                    <span
                      className="px-3 py-1 rounded-full text-xs font-medium"
                      style={{
                        backgroundColor: route.is_active ? 'var(--success-light)' : 'var(--neutral-200)',
                        color: route.is_active ? 'var(--success)' : 'var(--neutral-600)'
                      }}
                    >
                      {route.is_active ? 'Actif' : 'Inactif'}
                    </span>
                  </td>
                  <td className="p-4">
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEdit(route)}
                        className="p-2 hover:bg-gray-100 rounded-lg"
                        title="Modifier"
                      >
                        <Edit2 className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                      </button>
                      <button
                        onClick={() => handleDelete(route.id)}
                        className="p-2 hover:bg-gray-100 rounded-lg"
                        title="Supprimer"
                      >
                        <Trash2 className="w-4 h-4" style={{ color: 'var(--danger)' }} />
                      </button>
                    </div>
                  </td>
                </tr>
              </React.Fragment>
            ))}
          </tbody>
        </table>

        {filteredRoutes.length === 0 && (
          <div className="text-center py-12">
            <RouteIcon className="w-16 h-16 mx-auto mb-4" style={{ color: 'var(--neutral-400)' }} />
            <p style={{ color: 'var(--text-secondary)' }}>
              {query ? 'Aucun itinéraire ne correspond à votre recherche' : 'Aucun itinéraire trouvé'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// CityAutocomplete — search existing cities, or create a new one
// ============================================================

interface CityAutocompleteProps {
  cities: City[];
  excludedIds: string[];
  onSelect: (cityId: string, cityName: string) => void;
  onCityCreated: (city: City) => void;
}

function CityAutocomplete({ cities, excludedIds, onSelect, onCityCreated }: CityAutocompleteProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const availableCities = useMemo(
    () => cities.filter(c => !excludedIds.includes(c.id)),
    [cities, excludedIds]
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return availableCities;
    const q = query.toLowerCase().trim();
    return availableCities.filter(c => c.name.toLowerCase().includes(q));
  }, [availableCities, query]);

  const exactMatch = useMemo(
    () => cities.some(c => c.name.toLowerCase() === query.trim().toLowerCase()),
    [cities, query]
  );

  const canCreate = query.trim().length > 0 && !exactMatch && !creating;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (cityId: string, cityName: string) => {
    onSelect(cityId, cityName);
    setQuery('');
    setOpen(false);
  };

  const handleCreateCity = async () => {
    const name = query.trim();
    if (!name) return;

    setCreating(true);
    try {
      const { data, error } = await supabase
        .from('cities')
        .insert([{ name, is_active: true }])
        .select('id, name')
        .single();

      if (error) throw error;
      onCityCreated(data);
      toast.success(`Ville "${name}" créée et ajoutée à l'itinéraire`);
      setQuery('');
      setOpen(false);
    } catch (error: any) {
      toast.error(error.message || 'Erreur lors de la création de la ville');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Rechercher une ville à ajouter..."
          className="w-full pl-10 pr-3 py-2.5 border rounded-lg text-sm"
        />
      </div>

      {open && (query.trim() || availableCities.length > 0) && (
        <div
          className="absolute z-50 mt-1 w-full rounded-lg border max-h-56 overflow-y-auto shadow-xl bg-white"
          style={{ borderColor: 'var(--border)' }}
        >
          {filtered.length > 0 && (
            <div className="py-1">
              {filtered.map(city => (
                <button
                  key={city.id}
                  type="button"
                  onClick={() => handleSelect(city.id, city.name)}
                  className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-gray-50 transition-colors"
                >
                  <MapPin className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {city.name}
                  </span>
                </button>
              ))}
            </div>
          )}

          {filtered.length === 0 && query.trim() && (
            <div className="px-3 py-2 text-sm text-center" style={{ color: 'var(--text-muted)' }}>
              Aucune ville trouvée
            </div>
          )}

          {canCreate && (
            <>
              {filtered.length > 0 && <div className="border-t" style={{ borderColor: 'var(--border)' }} />}
              <button
                type="button"
                onClick={handleCreateCity}
                disabled={creating}
                className="w-full text-left px-3 py-2.5 flex items-center gap-2 transition-colors"
                style={{ backgroundColor: 'var(--primary-light)' }}
              >
                <Plus className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--primary)' }} />
                <span className="text-sm font-medium" style={{ color: 'var(--primary)' }}>
                  {creating ? 'Création...' : `Créer cette ville : "${query.trim()}"`}
                </span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
