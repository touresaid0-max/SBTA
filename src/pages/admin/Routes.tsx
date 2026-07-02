import React, { useState, useEffect } from 'react';
import { Route, Plus, CreditCard as Edit2, Trash2, MapPin, Search, X } from 'lucide-react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';

interface City {
  id: string;
  name: string;
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
}

export default function Routes() {
  const [routes, setRoutes] = useState<RouteData[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    origin_city_id: '',
    destination_city_id: '',
    distance_km: 0,
    estimated_duration_minutes: 0,
    base_price: 0,
    is_active: true
  });
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.origin_city_id === formData.destination_city_id) {
      toast.error('Les villes d\'origine et de destination doivent être différentes');
      return;
    }

    try {
      if (editingId) {
        const { error } = await supabase
          .from('routes')
          .update(formData)
          .eq('id', editingId);

        if (error) throw error;
        toast.success('Itinéraire mis à jour');
      } else {
        const { error } = await supabase
          .from('routes')
          .insert([formData]);

        if (error) throw error;
        toast.success('Itinéraire créé');
      }

      setShowForm(false);
      setEditingId(null);
      resetForm();
      loadData();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const handleEdit = (route: RouteData) => {
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
          onClick={() => setShowForm(true)}
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl">
            <div className="p-6 border-b">
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
                  className="px-6 py-3 rounded-lg text-white font-medium"
                  style={{ backgroundColor: 'var(--primary)' }}
                >
                  {editingId ? 'Mettre à jour' : 'Créer'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setEditingId(null); resetForm(); }}
                  className="px-6 py-3 rounded-lg border"
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
              <tr key={route.id} className="border-t hover:bg-gray-50">
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
            ))}
          </tbody>
        </table>

        {filteredRoutes.length === 0 && (
          <div className="text-center py-12">
            <Route className="w-16 h-16 mx-auto mb-4" style={{ color: 'var(--neutral-400)' }} />
            <p style={{ color: 'var(--text-secondary)' }}>
              {query ? 'Aucun itinéraire ne correspond à votre recherche' : 'Aucun itinéraire trouvé'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
