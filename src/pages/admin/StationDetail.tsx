import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import { Building2, ArrowLeft, MapPin, Phone, Mail, Monitor, Users, BarChart3, Plus, CreditCard as Edit2, Trash2, UserCheck, Luggage } from 'lucide-react';

interface Station {
  id: string;
  name: string;
  city_id: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  latitude: number | null;
  longitude: number | null;
  facilities: {
    parking?: boolean;
    wifi?: boolean;
    restaurant?: boolean;
    toilettes?: boolean;
    salle_attente?: boolean;
  };
  display_screen_enabled: boolean;
  is_active: boolean;
  station_manager_id?: string | null;
  cities?: { name: string; region: string };
  manager?: { id: string; full_name: string; email: string } | null;
}

interface Counter {
  id: string;
  counter_number: string;
  station_id: string;
  assigned_user_id: string | null;
  is_active: boolean;
  assigned_user?: {
    full_name: string;
    email: string;
  };
}

interface User {
  id: string;
  full_name: string;
  email: string;
}

interface StationManagerRow {
  id: string;
  manager_id: string;
  is_primary: boolean;
  manager?: { full_name: string | null; first_name: string | null; last_name: string | null; email: string | null };
}

interface StationBaggageRow {
  id: string;
  handler_id: string;
  handler?: { full_name: string | null; first_name: string | null; last_name: string | null; email: string | null };
}

const FACILITIES = [
  { key: 'parking', label: 'Parking' },
  { key: 'wifi', label: 'WiFi' },
  { key: 'restaurant', label: 'Restaurant' },
  { key: 'toilettes', label: 'Toilettes' },
  { key: 'salle_attente', label: "Salle d'attente" }
];

export default function StationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'infos' | 'guichets' | 'stats'>('infos');
  const [station, setStation] = useState<Station | null>(null);
  const [stationManagers, setStationManagers] = useState<StationManagerRow[]>([]);
  const [stationBaggage, setStationBaggage] = useState<StationBaggageRow[]>([]);
  const [counters, setCounters] = useState<Counter[]>([]);
  const [guichetiers, setGuichetiers] = useState<User[]>([]);
  const [showCounterForm, setShowCounterForm] = useState(false);
  const [editingCounterId, setEditingCounterId] = useState<string | null>(null);

  const [counterFormData, setCounterFormData] = useState({
    counter_number: '',
    assigned_user_id: '',
    is_active: true
  });

  useEffect(() => {
    if (id) {
      loadStationData();
      loadStationManagers();
      loadStationBaggageHandlers();
      loadCounters();
      loadGuichetiers();
    }
  }, [id]);

  const loadStationData = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('stations')
        .select('*, cities(name, region), manager:station_manager_id(id, first_name, last_name, full_name, email)')
        .eq('id', id)
        .maybeSingle();

      if (error) throw error;

      // Normaliser le nom du manager (full_name peut être null)
      if (data?.manager) {
        const m = data.manager as any;
        if (!m.full_name && (m.first_name || m.last_name)) {
          m.full_name = `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim();
        }
      }

      setStation(data);
    } catch (error: any) {
      toast.error('Erreur de chargement de la gare');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const loadStationManagers = async () => {
    try {
      const { data, error } = await supabase
        .from('station_managers')
        .select('id, manager_id, is_primary, manager:manager_id(full_name, first_name, last_name, email)')
        .eq('station_id', id)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: true });

      if (error) throw error;
      setStationManagers((data as any) || []);
    } catch (error: any) {
      console.error('Erreur chargement chefs de gare:', error);
    }
  };

  const loadStationBaggageHandlers = async () => {
    try {
      const { data, error } = await supabase
        .from('station_baggage_handlers')
        .select('id, handler_id, handler:handler_id(full_name, first_name, last_name, email)')
        .eq('station_id', id)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setStationBaggage((data as any) || []);
    } catch (error: any) {
      console.error('Erreur chargement bagagistes:', error);
    }
  };

  const loadCounters = async () => {
    try {
      const { data, error } = await supabase
        .from('counters')
        .select('*, assigned_user:assigned_user_id(full_name, email)')
        .eq('station_id', id)
        .order('counter_number');

      if (error) throw error;
      setCounters(data || []);
    } catch (error: any) {
      console.error('Erreur chargement guichets:', error);
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
      console.error('Erreur chargement guichetiers:', error);
    }
  };

  const handleCounterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const dataToSubmit = {
        ...counterFormData,
        station_id: id,
        assigned_user_id: counterFormData.assigned_user_id || null
      };

      if (editingCounterId) {
        const { error } = await supabase
          .from('counters')
          .update(dataToSubmit)
          .eq('id', editingCounterId);

        if (error) throw error;
        toast.success('Guichet mis à jour');
      } else {
        const { error } = await supabase
          .from('counters')
          .insert([dataToSubmit]);

        if (error) throw error;
        toast.success('Guichet créé');
      }

      setShowCounterForm(false);
      setEditingCounterId(null);
      resetCounterForm();
      loadCounters();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const handleEditCounter = (counter: Counter) => {
    setCounterFormData({
      counter_number: counter.counter_number,
      assigned_user_id: counter.assigned_user_id || '',
      is_active: counter.is_active
    });
    setEditingCounterId(counter.id);
    setShowCounterForm(true);
  };

  const handleDeleteCounter = async (counterId: string) => {
    if (!confirm('Voulez-vous vraiment supprimer ce guichet?')) return;

    try {
      const { error } = await supabase
        .from('counters')
        .delete()
        .eq('id', counterId);

      if (error) throw error;
      toast.success('Guichet supprimé');
      loadCounters();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const resetCounterForm = () => {
    setCounterFormData({
      counter_number: '',
      assigned_user_id: '',
      is_active: true
    });
  };

  if (loading) {
    return <div className="p-8">Chargement...</div>;
  }

  if (!station) {
    return (
      <div className="p-8">
        <p>Gare non trouvée</p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <button
        onClick={() => navigate('/admin/stations')}
        className="flex items-center gap-2 mb-6 hover:opacity-70"
        style={{ color: 'var(--primary)' }}
      >
        <ArrowLeft className="w-4 h-4" />
        Retour aux gares
      </button>

      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Building2 className="w-8 h-8" style={{ color: 'var(--primary)' }} />
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {station.name}
          </h1>
        </div>
        <p style={{ color: 'var(--text-secondary)' }}>
          {station.cities?.name}, {station.cities?.region}
        </p>
      </div>

      <div className="flex gap-2 mb-6 border-b">
        <button
          onClick={() => setActiveTab('infos')}
          className={`px-6 py-3 font-medium transition-colors ${
            activeTab === 'infos'
              ? 'border-b-2'
              : ''
          }`}
          style={{
            color: activeTab === 'infos' ? 'var(--primary)' : 'var(--text-secondary)',
            borderColor: activeTab === 'infos' ? 'var(--primary)' : 'transparent'
          }}
        >
          Informations
        </button>
        <button
          onClick={() => setActiveTab('guichets')}
          className={`px-6 py-3 font-medium transition-colors ${
            activeTab === 'guichets'
              ? 'border-b-2'
              : ''
          }`}
          style={{
            color: activeTab === 'guichets' ? 'var(--primary)' : 'var(--text-secondary)',
            borderColor: activeTab === 'guichets' ? 'var(--primary)' : 'transparent'
          }}
        >
          Guichets ({counters.length})
        </button>
        <button
          onClick={() => setActiveTab('stats')}
          className={`px-6 py-3 font-medium transition-colors ${
            activeTab === 'stats'
              ? 'border-b-2'
              : ''
          }`}
          style={{
            color: activeTab === 'stats' ? 'var(--primary)' : 'var(--text-secondary)',
            borderColor: activeTab === 'stats' ? 'var(--primary)' : 'transparent'
          }}
        >
          Statistiques
        </button>
      </div>

      {activeTab === 'infos' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border p-6">
            <h2 className="text-xl font-bold mb-4">Informations de contact</h2>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <MapPin className="w-5 h-5 mt-1" style={{ color: 'var(--primary)' }} />
                <div>
                  <p className="font-medium">Adresse</p>
                  <p style={{ color: 'var(--text-secondary)' }}>
                    {station.address || 'Non renseignée'}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Phone className="w-5 h-5 mt-1" style={{ color: 'var(--primary)' }} />
                <div>
                  <p className="font-medium">Téléphone</p>
                  <p style={{ color: 'var(--text-secondary)' }}>
                    {station.phone || 'Non renseigné'}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Mail className="w-5 h-5 mt-1" style={{ color: 'var(--primary)' }} />
                <div>
                  <p className="font-medium">Email</p>
                  <p style={{ color: 'var(--text-secondary)' }}>
                    {station.email || 'Non renseigné'}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Monitor className="w-5 h-5 mt-1" style={{ color: 'var(--primary)' }} />
                <div>
                  <p className="font-medium">Écran d'affichage</p>
                  <span
                    className="inline-block px-3 py-1 rounded-full text-xs font-medium mt-1"
                    style={{
                      backgroundColor: station.display_screen_enabled ? 'var(--success-light)' : 'var(--neutral-200)',
                      color: station.display_screen_enabled ? 'var(--success)' : 'var(--neutral-600)'
                    }}
                  >
                    {station.display_screen_enabled ? 'Activé' : 'Désactivé'}
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <UserCheck className="w-5 h-5 mt-1" style={{ color: 'var(--primary)' }} />
                <div className="flex-1">
                  <p className="font-medium">Chefs de gare affectés</p>
                  {stationManagers.length > 0 ? (
                    <div className="mt-1 space-y-2">
                      {stationManagers.map(sm => {
                        const m = sm.manager as any;
                        const name = m?.full_name || `${m?.first_name ?? ''} ${m?.last_name ?? ''}`.trim() || m?.email || '—';
                        return (
                          <div key={sm.id} className="flex items-center gap-2">
                            <div>
                              <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                                {name}
                              </p>
                              {m?.email && (
                                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                  {m.email}
                                </p>
                              )}
                            </div>
                            {sm.is_primary && (
                              <span
                                className="px-2 py-0.5 rounded text-[10px] font-semibold"
                                style={{ backgroundColor: 'var(--success-light)', color: 'var(--success)' }}
                              >
                                Principal
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <span
                      className="inline-block px-3 py-1 rounded-full text-xs font-medium mt-1"
                      style={{ backgroundColor: 'var(--warning-light)', color: 'var(--warning)' }}
                    >
                      Non assigné
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Luggage className="w-5 h-5 mt-1" style={{ color: 'var(--primary)' }} />
                <div className="flex-1">
                  <p className="font-medium">Bagagistes affectés</p>
                  {stationBaggage.length > 0 ? (
                    <div className="mt-1 space-y-2">
                      {stationBaggage.map(sb => {
                        const h = sb.handler as any;
                        const name = h?.full_name || `${h?.first_name ?? ''} ${h?.last_name ?? ''}`.trim() || h?.email || '—';
                        return (
                          <div key={sb.id} className="flex items-center gap-2">
                            <div>
                              <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                                {name}
                              </p>
                              {h?.email && (
                                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                  {h.email}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <span
                      className="inline-block px-3 py-1 rounded-full text-xs font-medium mt-1"
                      style={{ backgroundColor: 'var(--warning-light)', color: 'var(--warning)' }}
                    >
                      Non assigné
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border p-6">
            <h2 className="text-xl font-bold mb-4">Équipements disponibles</h2>
            <div className="grid grid-cols-2 gap-3">
              {FACILITIES.map((facility) => (
                <div
                  key={facility.key}
                  className="flex items-center gap-2 p-3 rounded-lg"
                  style={{
                    backgroundColor: station.facilities?.[facility.key as keyof typeof station.facilities]
                      ? 'var(--success-light)'
                      : 'var(--neutral-100)'
                  }}
                >
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs"
                    style={{
                      backgroundColor: station.facilities?.[facility.key as keyof typeof station.facilities]
                        ? 'var(--success)'
                        : 'var(--neutral-400)'
                    }}
                  >
                    {station.facilities?.[facility.key as keyof typeof station.facilities] ? '✓' : '✕'}
                  </div>
                  <span className="text-sm font-medium">{facility.label}</span>
                </div>
              ))}
            </div>

            <div className="mt-6">
              <h3 className="font-medium mb-2">Géolocalisation</h3>
              {station.latitude && station.longitude ? (
                <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--neutral-100)' }}>
                  <p className="text-sm">
                    <span className="font-medium">Latitude:</span> {station.latitude.toFixed(6)}
                  </p>
                  <p className="text-sm">
                    <span className="font-medium">Longitude:</span> {station.longitude.toFixed(6)}
                  </p>
                  <a
                    href={`https://www.google.com/maps?q=${station.latitude},${station.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm mt-2 inline-block"
                    style={{ color: 'var(--primary)' }}
                  >
                    Ouvrir dans Google Maps →
                  </a>
                </div>
              ) : (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Coordonnées GPS non renseignées
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'guichets' && (
        <div>
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold">Guichets de la gare</h2>
            <button
              onClick={() => setShowCounterForm(true)}
              className="px-4 py-2 rounded-lg flex items-center gap-2 text-white"
              style={{ backgroundColor: 'var(--primary)' }}
            >
              <Plus className="w-4 h-4" />
              Nouveau guichet
            </button>
          </div>

          {showCounterForm && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-xl w-full max-w-md">
                <div className="p-6 border-b">
                  <h2 className="text-2xl font-bold">
                    {editingCounterId ? 'Modifier' : 'Nouveau'} guichet
                  </h2>
                </div>

                <form onSubmit={handleCounterSubmit} className="p-6">
                  <div className="space-y-4">
                    <div>
                      <label className="block mb-2 font-medium">Numéro de guichet *</label>
                      <input
                        type="text"
                        value={counterFormData.counter_number}
                        onChange={(e) => setCounterFormData({ ...counterFormData, counter_number: e.target.value })}
                        className="w-full p-3 border rounded-lg"
                        placeholder="Ex: G1, Guichet 1"
                        required
                      />
                    </div>

                    <div>
                      <label className="block mb-2 font-medium">Guichetier assigné</label>
                      <select
                        value={counterFormData.assigned_user_id}
                        onChange={(e) => setCounterFormData({ ...counterFormData, assigned_user_id: e.target.value })}
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

                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="counter_active"
                        checked={counterFormData.is_active}
                        onChange={(e) => setCounterFormData({ ...counterFormData, is_active: e.target.checked })}
                        className="w-4 h-4"
                      />
                      <label htmlFor="counter_active" className="font-medium">Guichet actif</label>
                    </div>
                  </div>

                  <div className="flex gap-4 mt-6">
                    <button
                      type="submit"
                      className="px-6 py-3 rounded-lg text-white font-medium"
                      style={{ backgroundColor: 'var(--primary)' }}
                    >
                      {editingCounterId ? 'Mettre à jour' : 'Créer'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowCounterForm(false); setEditingCounterId(null); resetCounterForm(); }}
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
                  <th className="text-left p-4 font-semibold">Guichetier assigné</th>
                  <th className="text-left p-4 font-semibold">Statut</th>
                  <th className="text-left p-4 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {counters.map((counter) => (
                  <tr key={counter.id} className="border-t hover:bg-gray-50">
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                        <span className="font-bold">{counter.counter_number}</span>
                      </div>
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
                          onClick={() => handleEditCounter(counter)}
                          className="p-2 hover:bg-gray-100 rounded-lg"
                          title="Modifier"
                        >
                          <Edit2 className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                        </button>
                        <button
                          onClick={() => handleDeleteCounter(counter.id)}
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

            {counters.length === 0 && (
              <div className="text-center py-12">
                <Users className="w-16 h-16 mx-auto mb-4" style={{ color: 'var(--neutral-400)' }} />
                <p style={{ color: 'var(--text-secondary)' }}>Aucun guichet créé</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'stats' && (
        <div className="bg-white rounded-xl border p-8">
          <div className="text-center">
            <BarChart3 className="w-16 h-16 mx-auto mb-4" style={{ color: 'var(--neutral-400)' }} />
            <h3 className="text-xl font-bold mb-2">Statistiques de passages</h3>
            <p style={{ color: 'var(--text-secondary)' }}>
              Les statistiques de passages seront disponibles prochainement
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
