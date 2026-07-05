import React, { useState, useEffect } from 'react';
import { Users, Plus, CreditCard as Edit2, Trash2, Building2, Search, X } from 'lucide-react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';

interface Counter {
  id: string;
  counter_number: string;
  station_id: string;
  assigned_user_id: string | null;
  manager_id: string | null;
  is_active: boolean;
  stations?: {
    name: string;
    cities?: {
      name: string;
    };
  };
  assigned_user?: {
    full_name: string;
    email: string;
  };
  manager?: {
    full_name: string;
  } | null;
}

interface StationChef {
  manager_id: string;
  full_name: string;
}

interface Station {
  id: string;
  name: string;
  cities?: {
    name: string;
  };
}

interface User {
  id: string;
  full_name: string;
  email: string;
}

export default function Counters() {
  const [counters, setCounters] = useState<Counter[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [guichetiers, setGuichetiers] = useState<User[]>([]);
  const [stationChefs, setStationChefs] = useState<StationChef[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    counter_number: '',
    station_id: '',
    assigned_user_id: '',
    manager_id: '',
    is_active: true
  });

  useEffect(() => {
    loadData();
    loadStations();
    loadGuichetiers();
  }, []);

  const loadStations = async () => {
    try {
      const { data, error } = await supabase
        .from('stations')
        .select('id, name, cities(name)')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setStations(data || []);
    } catch (error: any) {
      toast.error('Erreur de chargement des gares');
    }
  };

  const loadGuichetiers = async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, full_name, email')
        .eq('role', 'guichetier')
        .eq('is_active', true)
        .order('full_name');

      if (error) throw error;
      setGuichetiers(data || []);
    } catch (error: any) {
      toast.error('Erreur de chargement des guichetiers');
    }
  };

  const loadStationChefs = async (stationId: string) => {
    if (!stationId) {
      setStationChefs([]);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('station_managers')
        .select('manager_id, manager:manager_id(full_name)')
        .eq('station_id', stationId)
        .order('is_primary', { ascending: false });

      if (error) throw error;
      setStationChefs(
        (data || []).map((row: any) => ({
          manager_id: row.manager_id,
          full_name: row.manager?.full_name || '—',
        }))
      );
    } catch (error: any) {
      setStationChefs([]);
    }
  };

  const handleStationChange = (stationId: string) => {
    setFormData((prev) => ({ ...prev, station_id: stationId, manager_id: '' }));
    loadStationChefs(stationId);
  };

  const loadData = async () => {
    try {
      const { data, error } = await supabase
        .from('counters')
        .select('*, stations(name, cities(name)), assigned_user:assigned_user_id(full_name, email), manager:manager_id(full_name)')
        .order('station_id')
        .order('counter_number');

      if (error) throw error;
      setCounters(data || []);
    } catch (error: any) {
      toast.error('Erreur de chargement');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const dataToSubmit = {
        ...formData,
        assigned_user_id: formData.assigned_user_id || null,
        manager_id: stationChefs.length > 1 ? (formData.manager_id || null) : null
      };

      if (editingId) {
        const { error } = await supabase
          .from('counters')
          .update(dataToSubmit)
          .eq('id', editingId);

        if (error) throw error;
        toast.success('Guichet mis à jour');
      } else {
        const { error } = await supabase
          .from('counters')
          .insert([dataToSubmit]);

        if (error) throw error;
        toast.success('Guichet créé');
      }

      setShowForm(false);
      setEditingId(null);
      resetForm();
      loadData();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const handleEdit = (counter: Counter) => {
    setFormData({
      counter_number: counter.counter_number,
      station_id: counter.station_id,
      assigned_user_id: counter.assigned_user_id || '',
      manager_id: counter.manager_id || '',
      is_active: counter.is_active
    });
    loadStationChefs(counter.station_id);
    setEditingId(counter.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Voulez-vous vraiment supprimer ce guichet?')) return;

    try {
      const { error } = await supabase
        .from('counters')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast.success('Guichet supprimé');
      loadData();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const resetForm = () => {
    setFormData({
      counter_number: '',
      station_id: '',
      assigned_user_id: '',
      manager_id: '',
      is_active: true
    });
    setStationChefs([]);
  };

  if (loading) {
    return <div className="p-8">Chargement...</div>;
  }

  const filtered = counters.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [
      c.counter_number,
      c.stations?.name,
      c.stations?.cities?.name,
      c.assigned_user?.full_name,
      c.assigned_user?.email,
      c.manager?.full_name,
    ].some((x) => (x ?? '').toLowerCase().includes(q));
  });

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            Guichets
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            {search.trim() ? `${filtered.length} sur ${counters.length} guichets` : `${counters.length} guichets au total`}
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="px-6 py-3 rounded-lg flex items-center gap-2 text-white font-medium"
          style={{ backgroundColor: 'var(--primary)' }}
        >
          <Plus className="w-5 h-5" />
          Nouveau guichet
        </button>
      </div>

      <div className="relative mb-6 max-w-md">
        <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un guichet, gare, guichetier, chef..."
          className="w-full pl-10 pr-10 py-3 border rounded-lg focus:outline-none focus:ring-2"
          style={{ borderColor: 'var(--border)' }}
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-100"
            aria-label="Effacer la recherche"
          >
            <X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          </button>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md">
            <div className="p-6 border-b">
              <h2 className="text-2xl font-bold">
                {editingId ? 'Modifier' : 'Nouveau'} guichet
              </h2>
            </div>

            <form onSubmit={handleSubmit} className="p-6">
              <div className="space-y-4">
                <div>
                  <label className="block mb-2 font-medium">Gare *</label>
                  <select
                    value={formData.station_id}
                    onChange={(e) => handleStationChange(e.target.value)}
                    className="w-full p-3 border rounded-lg"
                    required
                  >
                    <option value="">Sélectionner une gare</option>
                    {stations.map((station) => (
                      <option key={station.id} value={station.id}>
                        {station.name} {station.cities?.name && `- ${station.cities.name}`}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block mb-2 font-medium">Numéro de guichet *</label>
                  <input
                    type="text"
                    value={formData.counter_number}
                    onChange={(e) => setFormData({ ...formData, counter_number: e.target.value })}
                    className="w-full p-3 border rounded-lg"
                    placeholder="Ex: G1, Guichet 1"
                    required
                  />
                </div>

                <div>
                  <label className="block mb-2 font-medium">Guichetier assigné</label>
                  <select
                    value={formData.assigned_user_id}
                    onChange={(e) => setFormData({ ...formData, assigned_user_id: e.target.value })}
                    className="w-full p-3 border rounded-lg"
                  >
                    <option value="">Aucun (non assigné)</option>
                    {guichetiers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.full_name} ({user.email})
                      </option>
                    ))}
                  </select>
                </div>

                {stationChefs.length > 1 && (
                  <div>
                    <label className="block mb-2 font-medium">Chef de gare responsable</label>
                    <select
                      value={formData.manager_id}
                      onChange={(e) => setFormData({ ...formData, manager_id: e.target.value })}
                      className="w-full p-3 border rounded-lg"
                    >
                      <option value="">Aucun (visible par tous les chefs)</option>
                      {stationChefs.map((chef) => (
                        <option key={chef.manager_id} value={chef.manager_id}>
                          {chef.full_name}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                      Cette gare a plusieurs chefs de gare. Le chef sélectionné sera le seul à voir et gérer ce guichet et son guichetier.
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="is_active"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <label htmlFor="is_active" className="font-medium">Guichet actif</label>
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
              <th className="text-left p-4 font-semibold">Numéro</th>
              <th className="text-left p-4 font-semibold">Gare</th>
              <th className="text-left p-4 font-semibold">Guichetier assigné</th>
              <th className="text-left p-4 font-semibold">Chef responsable</th>
              <th className="text-left p-4 font-semibold">Statut</th>
              <th className="text-left p-4 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((counter) => (
              <tr key={counter.id} className="border-t hover:bg-gray-50">
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                    <span className="font-bold">{counter.counter_number}</span>
                  </div>
                </td>
                <td className="p-4">
                  {counter.stations ? (
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                      <div>
                        <div className="font-medium">{counter.stations.name}</div>
                        {counter.stations.cities && (
                          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {counter.stations.cities.name}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Non assignée</span>
                  )}
                </td>
                <td className="p-4">
                  {counter.assigned_user ? (
                    <div>
                      <div className="font-medium">{counter.assigned_user.full_name}</div>
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {counter.assigned_user.email}
                      </div>
                    </div>
                  ) : (
                    <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      Non assigné
                    </span>
                  )}
                </td>
                <td className="p-4">
                  {counter.manager ? (
                    <span className="font-medium">{counter.manager.full_name}</span>
                  ) : (
                    <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      —
                    </span>
                  )}
                </td>
                <td className="p-4">
                  <span
                    className="px-3 py-1 rounded-full text-xs font-medium"
                    style={{
                      backgroundColor: counter.is_active ? 'var(--success-light)' : 'var(--neutral-200)',
                      color: counter.is_active ? 'var(--success)' : 'var(--neutral-600)'
                    }}
                  >
                    {counter.is_active ? 'Actif' : 'Inactif'}
                  </span>
                </td>
                <td className="p-4">
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(counter)}
                      className="p-2 hover:bg-gray-100 rounded-lg"
                      title="Modifier"
                    >
                      <Edit2 className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                    </button>
                    <button
                      onClick={() => handleDelete(counter.id)}
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

        {filtered.length === 0 && (
          <div className="text-center py-12">
            <Users className="w-16 h-16 mx-auto mb-4" style={{ color: 'var(--neutral-400)' }} />
            <p style={{ color: 'var(--text-secondary)' }}>
              {search.trim() ? 'Aucun guichet ne correspond à votre recherche' : 'Aucun guichet trouvé'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
