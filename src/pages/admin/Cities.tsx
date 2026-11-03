import React, { useState, useEffect } from 'react';
import { MapPin, Plus, CreditCard as Edit2, Trash2 } from 'lucide-react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import Pagination from '../../components/pos/Pagination';
import { usePagination } from '../../hooks/usePagination';

interface City {
  id: string;
  name: string;
  region: string;
  country: string;
  latitude?: number;
  longitude?: number;
  is_active: boolean;
}

export default function Cities() {
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    region: '',
    country: 'Sénégal',
    latitude: 0,
    longitude: 0,
    is_active: true
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const { data, error } = await supabase
        .from('cities')
        .select('*')
        .order('name');

      if (error) throw error;
      setCities(data || []);
    } catch (error: any) {
      toast.error('Erreur de chargement');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      if (editingId) {
        const { error } = await supabase
          .from('cities')
          .update(formData)
          .eq('id', editingId);

        if (error) throw error;
        toast.success('Ville mise à jour');
      } else {
        const { error } = await supabase
          .from('cities')
          .insert([formData]);

        if (error) throw error;
        toast.success('Ville créée');
      }

      setShowForm(false);
      setEditingId(null);
      resetForm();
      loadData();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const handleEdit = (city: City) => {
    setFormData({
      name: city.name,
      region: city.region,
      country: city.country,
      latitude: city.latitude || 0,
      longitude: city.longitude || 0,
      is_active: city.is_active
    });
    setEditingId(city.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Voulez-vous vraiment supprimer cette ville?')) return;

    try {
      const { error } = await supabase
        .from('cities')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast.success('Ville supprimée');
      loadData();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      region: '',
      country: 'Sénégal',
      latitude: 0,
      longitude: 0,
      is_active: true
    });
  };

  // Same pagination as the guichet departures list
  const pagination = usePagination(cities, 'sbta_admin_cities_page_size', '');

  if (loading) {
    return <div className="p-8">Chargement...</div>;
  }

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            Villes
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            {cities.length} villes au total
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="px-6 py-3 rounded-lg flex items-center gap-2 text-white font-medium"
          style={{ backgroundColor: 'var(--primary)' }}
        >
          <Plus className="w-5 h-5" />
          Nouvelle ville
        </button>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl">
            <div className="p-6 border-b">
              <h2 className="text-2xl font-bold">
                {editingId ? 'Modifier' : 'Nouvelle'} ville
              </h2>
            </div>

            <form onSubmit={handleSubmit} className="p-6">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block mb-2 font-medium">Nom de la ville *</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full p-3 border rounded-lg"
                      required
                    />
                  </div>

                  <div>
                    <label className="block mb-2 font-medium">Région *</label>
                    <input
                      type="text"
                      value={formData.region}
                      onChange={(e) => setFormData({ ...formData, region: e.target.value })}
                      className="w-full p-3 border rounded-lg"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block mb-2 font-medium">Pays *</label>
                  <input
                    type="text"
                    value={formData.country}
                    onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                    className="w-full p-3 border rounded-lg"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block mb-2 font-medium">Latitude</label>
                    <input
                      type="number"
                      value={formData.latitude}
                      onChange={(e) => setFormData({ ...formData, latitude: parseFloat(e.target.value) })}
                      className="w-full p-3 border rounded-lg"
                      step="0.000001"
                    />
                  </div>

                  <div>
                    <label className="block mb-2 font-medium">Longitude</label>
                    <input
                      type="number"
                      value={formData.longitude}
                      onChange={(e) => setFormData({ ...formData, longitude: parseFloat(e.target.value) })}
                      className="w-full p-3 border rounded-lg"
                      step="0.000001"
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
                  <label htmlFor="is_active" className="font-medium">Ville active</label>
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
              <th className="text-left p-4 font-semibold">Ville</th>
              <th className="text-left p-4 font-semibold">Région</th>
              <th className="text-left p-4 font-semibold">Pays</th>
              <th className="text-left p-4 font-semibold">Coordonnées</th>
              <th className="text-left p-4 font-semibold">Statut</th>
              <th className="text-left p-4 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pagination.pageItems.map((city) => (
              <tr key={city.id} className="border-t hover:bg-gray-50">
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                    <span className="font-bold">{city.name}</span>
                  </div>
                </td>
                <td className="p-4">{city.region}</td>
                <td className="p-4">{city.country}</td>
                <td className="p-4">
                  {city.latitude && city.longitude ? (
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {city.latitude.toFixed(4)}, {city.longitude.toFixed(4)}
                    </span>
                  ) : (
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Non renseigné</span>
                  )}
                </td>
                <td className="p-4">
                  <span
                    className="px-3 py-1 rounded-full text-xs font-medium"
                    style={{
                      backgroundColor: city.is_active ? 'var(--success-light)' : 'var(--neutral-200)',
                      color: city.is_active ? 'var(--success)' : 'var(--neutral-600)'
                    }}
                  >
                    {city.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="p-4">
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(city)}
                      className="p-2 hover:bg-gray-100 rounded-lg"
                      title="Modifier"
                    >
                      <Edit2 className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                    </button>
                    <button
                      onClick={() => handleDelete(city.id)}
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

        {cities.length === 0 && (
          <div className="text-center py-12">
            <MapPin className="w-16 h-16 mx-auto mb-4" style={{ color: 'var(--neutral-400)' }} />
            <p style={{ color: 'var(--text-secondary)' }}>Aucune ville trouvée</p>
          </div>
        )}

        {cities.length > 0 && (
          <div className="border-t px-4 py-2">
            <Pagination
              page={pagination.page}
              pageCount={pagination.pageCount}
              pageSize={pagination.pageSize}
              total={pagination.total}
              onPageChange={pagination.setPage}
              onPageSizeChange={pagination.setPageSize}
              itemLabel="villes"
            />
          </div>
        )}
      </div>
    </div>
  );
}
