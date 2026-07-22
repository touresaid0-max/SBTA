import React, { useState, useEffect } from 'react';
import { Building2, Plus, CreditCard as Edit2, Trash2, Eye, Monitor, UserCheck, X, Package, MapPin, Luggage, Search } from 'lucide-react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

interface StationAgent {
  id: string;
  agent_id: string;
  is_primary: boolean;
  agent?: { full_name: string; phone: string | null };
}

interface StationManager {
  id: string;
  manager_id: string;
  is_primary: boolean;
  manager?: { full_name: string };
}

interface StationBaggageHandler {
  id: string;
  handler_id: string;
  handler?: { full_name: string; phone: string | null };
}

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
  agency_code?: string | null;
  cities?: { name: string; region: string };
  manager?: { id: string; full_name: string } | null;
}

interface Manager {
  id: string;
  full_name: string;
  station_id?: string | null;
}

interface AgentColis {
  id: string;
  full_name: string;
  phone: string | null;
}

interface BaggageHandler {
  id: string;
  full_name: string;
  phone: string | null;
}

interface City {
  id: string;
  name: string;
  region: string;
}

const FACILITIES = [
  { key: 'parking', label: 'Parking' },
  { key: 'wifi', label: 'WiFi' },
  { key: 'restaurant', label: 'Restaurant' },
  { key: 'toilettes', label: 'Toilettes' },
  { key: 'salle_attente', label: "Salle d'attente" }
];

export default function Stations() {
  const navigate = useNavigate();
  const [stations, setStations] = useState<Station[]>([]);
  const [search, setSearch] = useState('');
  const [stationAgentsMap, setStationAgentsMap] = useState<Record<string, StationAgent[]>>({});
  const [stationManagersMap, setStationManagersMap] = useState<Record<string, StationManager[]>>({});
  const [stationBaggageMap, setStationBaggageMap] = useState<Record<string, StationBaggageHandler[]>>({});
  const [cities, setCities] = useState<City[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [agentsColis, setAgentsColis] = useState<AgentColis[]>([]);
  const [baggageHandlers, setBaggageHandlers] = useState<BaggageHandler[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [primaryAgentId, setPrimaryAgentId] = useState<string | null>(null);
  const [selectedManagerIds, setSelectedManagerIds] = useState<string[]>([]);
  const [primaryManagerId, setPrimaryManagerId] = useState<string | null>(null);
  const [selectedBaggageIds, setSelectedBaggageIds] = useState<string[]>([]);
  const [destCodes, setDestCodes] = useState<{ id?: string; destination_station_id: string; agency_code: string }[]>([]);
  const [selectedCityIds, setSelectedCityIds] = useState<string[]>([]);
  const [stationCitiesMap, setStationCitiesMap] = useState<Record<string, City[]>>({});
  const [citySearch, setCitySearch] = useState('');
  const [cityFilter, setCityFilter] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    city_id: '',
    address: '',
    phone: '',
    email: '',
    latitude: 0,
    longitude: 0,
    facilities: {
      parking: false,
      wifi: false,
      restaurant: false,
      toilettes: false,
      salle_attente: false
    },
    display_screen_enabled: false,
    is_active: true,
    station_manager_id: '',
    agency_code: '',
  });

  useEffect(() => {
    loadData();
    loadCities();
    loadManagers();
    loadAgentsColis();
    loadBaggageHandlers();
  }, []);

  const loadManagers = async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, first_name, last_name, full_name, station_id')
        .eq('role', 'chef_gare')
        .eq('is_active', true)
        .order('first_name');

      if (error) throw error;

      const list: Manager[] = (data ?? []).map(u => ({
        id: u.id,
        full_name: u.full_name || `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.id,
        station_id: u.station_id,
      }));

      setManagers(list);
    } catch (err) {
      console.error('Erreur chargement chefs de gare:', err);
    }
  };

  const loadAgentsColis = async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, first_name, last_name, full_name, phone')
        .eq('role', 'agent_colis')
        .eq('is_active', true)
        .order('first_name');

      if (error) throw error;

      const list: AgentColis[] = (data ?? []).map(u => ({
        id: u.id,
        full_name: u.full_name || `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.id,
        phone: u.phone,
      }));

      setAgentsColis(list);
    } catch (err) {
      console.error('Erreur chargement agents colis:', err);
    }
  };

  const loadBaggageHandlers = async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, first_name, last_name, full_name, phone')
        .eq('role', 'bagagiste')
        .eq('is_active', true)
        .order('first_name');

      if (error) throw error;

      const list: BaggageHandler[] = (data ?? []).map(u => ({
        id: u.id,
        full_name: u.full_name || `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.id,
        phone: u.phone,
      }));

      setBaggageHandlers(list);
    } catch (err) {
      console.error('Erreur chargement bagagistes:', err);
    }
  };

  const loadCities = async () => {
    try {
      const { data, error } = await supabase
        .from('cities')
        .select('id, name, region')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setCities(data || []);
    } catch (error: any) {
      toast.error('Erreur de chargement des villes');
    }
  };

  const loadData = async () => {
    try {
      const [stationsRes, agentsRes, managersRes, baggageRes, citiesRes] = await Promise.all([
        supabase
          .from('stations')
          .select('*, cities(name, region), manager:station_manager_id(id, full_name)')
          .order('name'),
        supabase
          .from('station_agents')
          .select('id, station_id, agent_id, is_primary, agent:agent_id(full_name, phone)')
          .order('is_primary', { ascending: false })
          .order('created_at', { ascending: true }),
        supabase
          .from('station_managers')
          .select('id, station_id, manager_id, is_primary, manager:manager_id(full_name)')
          .order('is_primary', { ascending: false })
          .order('created_at', { ascending: true }),
        supabase
          .from('station_baggage_handlers')
          .select('id, station_id, handler_id, handler:handler_id(full_name, phone)')
          .order('created_at', { ascending: true }),
        supabase
          .from('station_cities')
          .select('id, station_id, city_id, city:city_id(id, name, region)')
          .order('created_at', { ascending: true }),
      ]);

      if (stationsRes.error) throw stationsRes.error;
      setStations(stationsRes.data || []);

      const map: Record<string, StationAgent[]> = {};
      for (const row of agentsRes.data ?? []) {
        const sid = (row as any).station_id;
        if (!map[sid]) map[sid] = [];
        map[sid].push(row as any);
      }
      setStationAgentsMap(map);

      const mgrMap: Record<string, StationManager[]> = {};
      for (const row of managersRes.data ?? []) {
        const sid = (row as any).station_id;
        if (!mgrMap[sid]) mgrMap[sid] = [];
        mgrMap[sid].push(row as any);
      }
      setStationManagersMap(mgrMap);

      const bagMap: Record<string, StationBaggageHandler[]> = {};
      for (const row of baggageRes.data ?? []) {
        const sid = (row as any).station_id;
        if (!bagMap[sid]) bagMap[sid] = [];
        bagMap[sid].push(row as any);
      }
      setStationBaggageMap(bagMap);

      const cityMap: Record<string, City[]> = {};
      for (const row of citiesRes.data ?? []) {
        const sid = (row as any).station_id;
        if (!cityMap[sid]) cityMap[sid] = [];
        cityMap[sid].push((row as any).city);
      }
      setStationCitiesMap(cityMap);
    } catch (error: any) {
      toast.error('Erreur de chargement');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate per-destination agency codes before saving
    const filledRows = destCodes.filter(r => r.destination_station_id || r.agency_code.trim());
    if (filledRows.some(r => !r.destination_station_id || !r.agency_code.trim())) {
      toast.error('Chaque ligne de code agence doit avoir une destination ET un code');
      return;
    }
    const destSet = new Set<string>();
    const codeSet = new Set<string>();
    for (const r of filledRows) {
      if (destSet.has(r.destination_station_id)) {
        toast.error('Une même destination ne peut avoir deux codes agence');
        return;
      }
      const code = r.agency_code.trim();
      if (codeSet.has(code)) {
        toast.error(`Le code agence "${code}" est utilisé pour deux destinations`);
        return;
      }
      destSet.add(r.destination_station_id);
      codeSet.add(code);
    }

    try {
      const dataToSubmit = {
        name: formData.name,
        city_id: formData.city_id,
        address: formData.address || null,
        phone: formData.phone || null,
        email: formData.email || null,
        latitude: formData.latitude || null,
        longitude: formData.longitude || null,
        facilities: formData.facilities,
        display_screen_enabled: formData.display_screen_enabled,
        is_active: formData.is_active,
        station_manager_id: primaryManagerId || null,
        agency_code: formData.agency_code || null,
      };

      let savedStationId = editingId;

      if (editingId) {
        const { error } = await supabase
          .from('stations')
          .update(dataToSubmit)
          .eq('id', editingId);

        if (error) throw error;
        toast.success('Gare mise à jour avec succès');
      } else {
        const { data: inserted, error } = await supabase
          .from('stations')
          .insert([dataToSubmit])
          .select('id')
          .single();

        if (error) throw error;
        savedStationId = inserted.id;
        toast.success('Gare créée avec succès');
      }

      if (savedStationId) {
        await syncStationAgents(savedStationId, selectedAgentIds, primaryAgentId);
        await syncStationManagers(savedStationId, selectedManagerIds, primaryManagerId);
        await syncStationBaggage(savedStationId, selectedBaggageIds);
        await syncStationCities(savedStationId, selectedCityIds);
        await syncDestCodes(savedStationId, filledRows);
      }

      setShowForm(false);
      setEditingId(null);
      resetForm();
      loadData();
    } catch (error: any) {
      console.error('Erreur:', error);
      toast.error(error.message || 'Une erreur est survenue');
    }
  };

  const syncStationAgents = async (stationId: string, agentIds: string[], primaryId: string | null) => {
    const { data: existing } = await supabase
      .from('station_agents')
      .select('id, agent_id')
      .eq('station_id', stationId);

    const existingIds = new Set((existing ?? []).map(r => r.agent_id));
    const targetIds = new Set(agentIds);

    const toRemove = (existing ?? []).filter(r => !targetIds.has(r.agent_id));
    const toAdd = agentIds.filter(id => !existingIds.has(id));

    if (toRemove.length > 0) {
      await supabase
        .from('station_agents')
        .delete()
        .in('id', toRemove.map(r => r.id));
    }

    if (toAdd.length > 0) {
      await supabase
        .from('station_agents')
        .insert(toAdd.map(agentId => ({
          station_id: stationId,
          agent_id: agentId,
          is_primary: agentId === primaryId,
        })));
    }

    if (primaryId) {
      await supabase
        .from('station_agents')
        .update({ is_primary: false })
        .eq('station_id', stationId)
        .neq('agent_id', primaryId);

      await supabase
        .from('station_agents')
        .update({ is_primary: true })
        .eq('station_id', stationId)
        .eq('agent_id', primaryId);
    }
  };

  const syncStationManagers = async (stationId: string, managerIds: string[], primaryId: string | null) => {
    const { data: existing } = await supabase
      .from('station_managers')
      .select('id, manager_id')
      .eq('station_id', stationId);

    const existingIds = new Set((existing ?? []).map(r => r.manager_id));
    const targetIds = new Set(managerIds);

    const toRemove = (existing ?? []).filter(r => !targetIds.has(r.manager_id));
    const toAdd = managerIds.filter(id => !existingIds.has(id));

    if (toRemove.length > 0) {
      await supabase
        .from('station_managers')
        .delete()
        .in('id', toRemove.map(r => r.id));
    }

    if (toAdd.length > 0) {
      await supabase
        .from('station_managers')
        .insert(toAdd.map(managerId => ({
          station_id: stationId,
          manager_id: managerId,
          is_primary: managerId === primaryId,
        })));
    }

    if (primaryId) {
      await supabase
        .from('station_managers')
        .update({ is_primary: false })
        .eq('station_id', stationId)
        .neq('manager_id', primaryId);

      await supabase
        .from('station_managers')
        .update({ is_primary: true })
        .eq('station_id', stationId)
        .eq('manager_id', primaryId);
    }
  };

  const syncStationBaggage = async (stationId: string, handlerIds: string[]) => {
    const { data: existing } = await supabase
      .from('station_baggage_handlers')
      .select('id, handler_id')
      .eq('station_id', stationId);

    const existingIds = new Set((existing ?? []).map(r => r.handler_id));
    const targetIds = new Set(handlerIds);

    const toRemove = (existing ?? []).filter(r => !targetIds.has(r.handler_id));
    const toAdd = handlerIds.filter(id => !existingIds.has(id));

    if (toRemove.length > 0) {
      await supabase
        .from('station_baggage_handlers')
        .delete()
        .in('id', toRemove.map(r => r.id));
    }

    if (toAdd.length > 0) {
      await supabase
        .from('station_baggage_handlers')
        .insert(toAdd.map(handlerId => ({
          station_id: stationId,
          handler_id: handlerId,
        })));
    }
  };

  const syncStationCities = async (stationId: string, cityIds: string[]) => {
    const { data: existing } = await supabase
      .from('station_cities')
      .select('id, city_id')
      .eq('station_id', stationId);

    const existingIds = new Set((existing ?? []).map(r => r.city_id));
    const targetIds = new Set(cityIds);

    const toRemove = (existing ?? []).filter(r => !targetIds.has(r.city_id));
    const toAdd = cityIds.filter(id => !existingIds.has(id));

    if (toRemove.length > 0) {
      await supabase
        .from('station_cities')
        .delete()
        .in('id', toRemove.map(r => r.id));
    }

    if (toAdd.length > 0) {
      const { error } = await supabase
        .from('station_cities')
        .insert(toAdd.map(cityId => ({
          station_id: stationId,
          city_id: cityId,
        })));
      if (error) throw error;
    }
  };

  const syncDestCodes = async (
    stationId: string,
    rows: { destination_station_id: string; agency_code: string }[],
  ) => {
    await supabase
      .from('station_destination_agency_codes')
      .delete()
      .eq('origin_station_id', stationId);

    if (rows.length > 0) {
      const { error } = await supabase
        .from('station_destination_agency_codes')
        .insert(rows.map(r => ({
          origin_station_id: stationId,
          destination_station_id: r.destination_station_id,
          agency_code: r.agency_code.trim(),
        })));
      if (error) throw error;
    }
  };

  const loadDestCodes = async (stationId: string) => {
    const { data } = await supabase
      .from('station_destination_agency_codes')
      .select('id, destination_station_id, agency_code')
      .eq('origin_station_id', stationId);
    setDestCodes((data ?? []).map(d => ({
      id: d.id,
      destination_station_id: d.destination_station_id,
      agency_code: d.agency_code,
    })));
  };

  const handleEdit = (station: Station) => {
    const agents = stationAgentsMap[station.id] ?? [];
    const ids = agents.map(a => a.agent_id);
    const primary = agents.find(a => a.is_primary);
    const stationMgrs = stationManagersMap[station.id] ?? [];
    const mgrIds = stationMgrs.map(m => m.manager_id);
    const primaryMgr = stationMgrs.find(m => m.is_primary);
    const bagHandlers = stationBaggageMap[station.id] ?? [];
    const bagIds = bagHandlers.map(b => b.handler_id);
    loadDestCodes(station.id);

    const assocCityIds = (stationCitiesMap[station.id] ?? []).map(c => c.id);
    setSelectedCityIds(assocCityIds);

    setFormData({
      name: station.name,
      city_id: station.city_id,
      address: station.address || '',
      phone: station.phone || '',
      email: station.email || '',
      latitude: station.latitude || 0,
      longitude: station.longitude || 0,
      facilities: station.facilities || {
        parking: false,
        wifi: false,
        restaurant: false,
        toilettes: false,
        salle_attente: false
      },
      display_screen_enabled: station.display_screen_enabled || false,
      is_active: station.is_active,
      station_manager_id: station.station_manager_id || '',
      agency_code: station.agency_code || '',
    });
    setSelectedAgentIds(ids);
    setPrimaryAgentId(primary?.agent_id ?? (ids[0] || null));
    setSelectedManagerIds(mgrIds);
    setPrimaryManagerId(primaryMgr?.manager_id ?? (mgrIds[0] || null));
    setSelectedBaggageIds(bagIds);
    setEditingId(station.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Voulez-vous vraiment supprimer cette gare?')) return;

    try {
      const { error } = await supabase
        .from('stations')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast.success('Gare supprimée');
      loadData();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      city_id: '',
      address: '',
      phone: '',
      email: '',
      latitude: 0,
      longitude: 0,
      facilities: {
        parking: false,
        wifi: false,
        restaurant: false,
        toilettes: false,
        salle_attente: false
      },
      display_screen_enabled: false,
      is_active: true,
      station_manager_id: '',
      agency_code: '',
    });
    setSelectedAgentIds([]);
    setPrimaryAgentId(null);
    setSelectedManagerIds([]);
    setPrimaryManagerId(null);
    setSelectedBaggageIds([]);
    setSelectedCityIds([]);
    setCitySearch('');
    setDestCodes([]);
  };

  const handleFacilityChange = (key: string, checked: boolean) => {
    setFormData({
      ...formData,
      facilities: {
        ...formData.facilities,
        [key]: checked
      }
    });
  };

  const handleLocationSelect = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setFormData({
            ...formData,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
          toast.success('Position GPS récupérée');
        },
        () => {
          toast.error('Impossible de récupérer la position GPS');
        }
      );
    } else {
      toast.error('Géolocalisation non supportée');
    }
  };

  const toggleAgent = (agentId: string) => {
    setSelectedAgentIds(prev => {
      const next = prev.includes(agentId)
        ? prev.filter(id => id !== agentId)
        : [...prev, agentId];

      if (!next.includes(primaryAgentId ?? '')) {
        setPrimaryAgentId(next[0] || null);
      }
      return next;
    });
  };

  const availableAgents = agentsColis.filter(a => !selectedAgentIds.includes(a.id));

  const toggleManager = (managerId: string) => {
    setSelectedManagerIds(prev => {
      const next = prev.includes(managerId)
        ? prev.filter(id => id !== managerId)
        : [...prev, managerId];

      if (!next.includes(primaryManagerId ?? '')) {
        setPrimaryManagerId(next[0] || null);
      }
      return next;
    });
  };

  const availableManagers = managers.filter(m => !selectedManagerIds.includes(m.id));

  const toggleBaggage = (handlerId: string) => {
    setSelectedBaggageIds(prev =>
      prev.includes(handlerId)
        ? prev.filter(id => id !== handlerId)
        : [...prev, handlerId]
    );
  };

  const availableBaggage = baggageHandlers.filter(b => !selectedBaggageIds.includes(b.id));

  const addDestCode = () => setDestCodes(prev => [...prev, { destination_station_id: '', agency_code: '' }]);
  const updateDestCode = (idx: number, patch: Partial<{ destination_station_id: string; agency_code: string }>) =>
    setDestCodes(prev => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const removeDestCode = (idx: number) => setDestCodes(prev => prev.filter((_, i) => i !== idx));

  if (loading) {
    return <div className="p-8">Chargement...</div>;
  }

  const filtered = stations.filter((s) => {
    const q = search.trim().toLowerCase();
    const assocCities = stationCitiesMap[s.id] ?? [];
    const matchesSearch = !q || [s.name, s.address, s.agency_code, s.cities?.name, s.cities?.region, s.phone, s.email,
      ...assocCities.map(c => c.name), ...assocCities.map(c => c.region)]
      .some((x) => (x ?? '').toLowerCase().includes(q));
    const matchesCity = !cityFilter ||
      s.city_id === cityFilter ||
      assocCities.some(c => c.id === cityFilter);
    return matchesSearch && matchesCity;
  });

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            Gares
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            {(search.trim() || cityFilter) ? `${filtered.length} sur ${stations.length} gares` : `${stations.length} gares au total`}
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="px-6 py-3 rounded-lg flex items-center gap-2 text-white font-medium"
          style={{ backgroundColor: 'var(--primary)' }}
        >
          <Plus className="w-5 h-5" />
          Nouvelle gare
        </button>
      </div>

      <div className="flex gap-4 mb-6 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher une gare, ville, région, code..."
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

        <div className="min-w-[200px]">
          <select
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            className="w-full p-3 border rounded-lg focus:outline-none focus:ring-2"
            style={{ borderColor: 'var(--border)' }}
          >
            <option value="">Toutes les villes</option>
            {cities.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}{c.region ? ` (${c.region})` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b sticky top-0 bg-white z-10">
              <h2 className="text-2xl font-bold">
                {editingId ? 'Modifier' : 'Nouvelle'} gare
              </h2>
            </div>

            <form onSubmit={handleSubmit} className="p-6">
              <div className="space-y-4">
                <div>
                  <label className="block mb-2 font-medium">Nom de la gare *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full p-3 border rounded-lg"
                    required
                  />
                </div>

                <div>
                  <label className="block mb-2 font-medium">Ville *</label>
                  <select
                    value={formData.city_id}
                    onChange={(e) => setFormData({ ...formData, city_id: e.target.value })}
                    className="w-full p-3 border rounded-lg"
                    required
                  >
                    <option value="">Sélectionner une ville</option>
                    {cities.map((city) => (
                      <option key={city.id} value={city.id}>
                        {city.name} ({city.region})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block mb-2 font-medium">Ville(s) associée(s)</label>
                  <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                    Associez une ou plusieurs villes supplémentaires à cette gare. Recherchez et sélectionnez parmi les villes existantes.
                  </p>

                  {selectedCityIds.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {selectedCityIds.map(cityId => {
                        const city = cities.find(c => c.id === cityId);
                        if (!city) return null;
                        return (
                          <span
                            key={cityId}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium"
                            style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}
                          >
                            <MapPin className="w-3.5 h-3.5" />
                            {city.name}
                            {city.region ? ` (${city.region})` : ''}
                            <button
                              type="button"
                              onClick={() => setSelectedCityIds(prev => prev.filter(id => id !== cityId))}
                              className="hover:opacity-70 transition-opacity"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}

                  <div className="relative">
                    <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                    <input
                      type="text"
                      value={citySearch}
                      onChange={(e) => setCitySearch(e.target.value)}
                      placeholder="Rechercher une ville à associer..."
                      className="w-full pl-10 pr-4 py-3 border rounded-lg focus:outline-none focus:ring-2"
                      style={{ borderColor: 'var(--border)' }}
                    />
                    {citySearch.trim() && (
                      <div className="absolute z-20 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                        {cities
                          .filter(c => {
                            const q = citySearch.trim().toLowerCase();
                            return (
                              c.name.toLowerCase().includes(q) ||
                              (c.region ?? '').toLowerCase().includes(q)
                            ) && !selectedCityIds.includes(c.id) && c.id !== formData.city_id;
                          })
                          .map(c => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => {
                                setSelectedCityIds(prev => [...prev, c.id]);
                                setCitySearch('');
                              }}
                              className="w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors flex items-center gap-2"
                            >
                              <MapPin className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                              <span className="font-medium">{c.name}</span>
                              {c.region && (
                                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                  {c.region}
                                </span>
                              )}
                            </button>
                          ))
                        }
                        {cities.filter(c => {
                          const q = citySearch.trim().toLowerCase();
                          return (
                            c.name.toLowerCase().includes(q) ||
                            (c.region ?? '').toLowerCase().includes(q)
                          ) && !selectedCityIds.includes(c.id) && c.id !== formData.city_id;
                        }).length === 0 && (
                          <p className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                            Aucune ville trouvée. Créez d'abord la ville dans Admin &gt; Villes.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block mb-2 font-medium">Adresse</label>
                  <textarea
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="w-full p-3 border rounded-lg"
                    rows={3}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block mb-2 font-medium">Téléphone</label>
                    <input
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      className="w-full p-3 border rounded-lg"
                    />
                  </div>

                  <div>
                    <label className="block mb-2 font-medium">Email</label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full p-3 border rounded-lg"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="font-medium">Géolocalisation GPS</label>
                    <button
                      type="button"
                      onClick={handleLocationSelect}
                      className="text-sm px-3 py-1 rounded-lg border"
                      style={{ color: 'var(--primary)', borderColor: 'var(--primary)' }}
                    >
                      Utiliser ma position
                    </button>
                  </div>
                  <div className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                    Ou entrez manuellement les coordonnées GPS
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block mb-2 font-medium">Latitude</label>
                    <input
                      type="number"
                      value={formData.latitude || ''}
                      onChange={(e) => setFormData({ ...formData, latitude: e.target.value ? parseFloat(e.target.value) : 0 })}
                      className="w-full p-3 border rounded-lg"
                      step="0.000001"
                      placeholder="Ex: 5.304923"
                    />
                  </div>

                  <div>
                    <label className="block mb-2 font-medium">Longitude</label>
                    <input
                      type="number"
                      value={formData.longitude || ''}
                      onChange={(e) => setFormData({ ...formData, longitude: e.target.value ? parseFloat(e.target.value) : 0 })}
                      className="w-full p-3 border rounded-lg"
                      step="0.000001"
                      placeholder="Ex: -4.010662"
                    />
                  </div>
                </div>

                <div>
                  <label className="block mb-3 font-medium">Équipements disponibles</label>
                  <div className="grid grid-cols-2 gap-3">
                    {FACILITIES.map((facility) => (
                      <div key={facility.key} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id={facility.key}
                          checked={formData.facilities[facility.key as keyof typeof formData.facilities] || false}
                          onChange={(e) => handleFacilityChange(facility.key, e.target.checked)}
                          className="w-4 h-4"
                        />
                        <label htmlFor={facility.key} className="text-sm">{facility.label}</label>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── Agents courrier (multi-select) ── */}
                <div>
                  <label className="block mb-2 font-medium">Agents courrier affectes</label>

                  {selectedAgentIds.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {selectedAgentIds.map(agentId => {
                        const agent = agentsColis.find(a => a.id === agentId);
                        if (!agent) return null;
                        const isPrimary = primaryAgentId === agentId;
                        return (
                          <div
                            key={agentId}
                            className="flex items-center justify-between p-3 rounded-lg border"
                            style={{
                              backgroundColor: isPrimary ? 'var(--success-light)' : 'var(--neutral-50)',
                              borderColor: isPrimary ? 'var(--success)' : 'var(--neutral-200)',
                            }}
                          >
                            <div className="flex items-center gap-3">
                              <Package className="w-4 h-4" style={{ color: isPrimary ? 'var(--success)' : 'var(--neutral-400)' }} />
                              <div>
                                <span className="text-sm font-medium">{agent.full_name}</span>
                                {agent.phone && (
                                  <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>
                                    {agent.phone}
                                  </span>
                                )}
                              </div>
                              {isPrimary && (
                                <span
                                  className="px-2 py-0.5 rounded text-xs font-semibold"
                                  style={{ backgroundColor: 'var(--success)', color: 'white' }}
                                >
                                  Principal
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {!isPrimary && (
                                <button
                                  type="button"
                                  onClick={() => setPrimaryAgentId(agentId)}
                                  className="text-xs px-2 py-1 rounded border hover:bg-gray-100 transition-colors"
                                  style={{ color: 'var(--primary)', borderColor: 'var(--primary)' }}
                                >
                                  Rendre principal
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => toggleAgent(agentId)}
                                className="p-1 rounded hover:bg-red-50 transition-colors"
                              >
                                <X className="w-4 h-4" style={{ color: 'var(--danger)' }} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {agentsColis.length === 0 ? (
                    <div className="w-full p-3 border rounded-lg text-sm" style={{ color: 'var(--text-muted)', backgroundColor: 'var(--neutral-50)' }}>
                      Aucun agent courrier disponible — creez d'abord un utilisateur avec le role "agent_colis"
                    </div>
                  ) : availableAgents.length > 0 ? (
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) {
                          toggleAgent(e.target.value);
                          if (selectedAgentIds.length === 0) {
                            setPrimaryAgentId(e.target.value);
                          }
                        }
                      }}
                      className="w-full p-3 border rounded-lg"
                    >
                      <option value="">+ Ajouter un agent courrier...</option>
                      {availableAgents.map(a => (
                        <option key={a.id} value={a.id}>
                          {a.full_name}{a.phone ? ` (${a.phone})` : ''}
                        </option>
                      ))}
                    </select>
                  ) : selectedAgentIds.length > 0 ? (
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      Tous les agents courrier sont deja affectes
                    </p>
                  ) : null}

                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    L'agent principal est utilise sur les recus courrier (VILLE EXP / VILLE DES)
                  </p>
                </div>

                <div>
                  <label className="block mb-2 font-medium">Code agence</label>
                  <input
                    type="text"
                    value={formData.agency_code}
                    onChange={(e) => setFormData({ ...formData, agency_code: e.target.value })}
                    className="w-full p-3 border rounded-lg"
                    placeholder="Ex: 01, 02, 03..."
                    maxLength={10}
                  />
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    Identifiant unique de l'agence, utilise comme prefixe dans les codes courrier
                  </p>
                </div>

                {/* ── Codes agence par destination ── */}
                <div className="p-4 rounded-lg border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--neutral-50)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <label className="font-medium flex items-center gap-2">
                      <MapPin className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                      Codes agence par destination
                    </label>
                    <button
                      type="button"
                      onClick={addDestCode}
                      className="text-xs px-3 py-1.5 rounded-lg flex items-center gap-1 text-white font-medium"
                      style={{ backgroundColor: 'var(--primary)' }}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Ajouter
                    </button>
                  </div>
                  <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                    Associez un code agence a chaque destination. Lors de l'enregistrement d'un courrier,
                    le code de la destination choisie est integre automatiquement dans le code du ticket.
                  </p>

                  {destCodes.length === 0 ? (
                    <p className="text-xs italic" style={{ color: 'var(--text-muted)' }}>
                      Aucune destination configuree. Le code agence general de la gare sera utilise.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {destCodes.map((row, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <select
                            value={row.destination_station_id}
                            onChange={(e) => updateDestCode(idx, { destination_station_id: e.target.value })}
                            className="flex-1 p-2 border rounded-lg text-sm"
                          >
                            <option value="">Destination...</option>
                            {stations
                              .filter(s => s.id !== editingId)
                              .map(s => (
                                <option key={s.id} value={s.id}>
                                  {s.name}{s.cities ? ` (${s.cities.name})` : ''}
                                </option>
                              ))}
                          </select>
                          <input
                            type="text"
                            value={row.agency_code}
                            onChange={(e) => updateDestCode(idx, { agency_code: e.target.value })}
                            className="w-28 p-2 border rounded-lg text-sm"
                            placeholder="Code (01)"
                            maxLength={10}
                          />
                          <button
                            type="button"
                            onClick={() => removeDestCode(idx)}
                            className="p-2 rounded-lg hover:bg-red-50 transition-colors"
                            title="Supprimer"
                          >
                            <Trash2 className="w-4 h-4" style={{ color: 'var(--danger)' }} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block mb-2 font-medium">Chefs de gare affectés</label>

                  {selectedManagerIds.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {selectedManagerIds.map(managerId => {
                        const m = managers.find(mm => mm.id === managerId);
                        if (!m) return null;
                        const isPrimary = primaryManagerId === managerId;
                        return (
                          <div
                            key={managerId}
                            className="flex items-center justify-between p-3 rounded-lg border"
                            style={{
                              backgroundColor: isPrimary ? 'var(--success-light)' : 'var(--neutral-50)',
                              borderColor: isPrimary ? 'var(--success)' : 'var(--neutral-200)',
                            }}
                          >
                            <div className="flex items-center gap-3">
                              <UserCheck className="w-4 h-4" style={{ color: isPrimary ? 'var(--success)' : 'var(--neutral-400)' }} />
                              <span className="text-sm font-medium">{m.full_name}</span>
                              {isPrimary && (
                                <span
                                  className="px-2 py-0.5 rounded text-xs font-semibold"
                                  style={{ backgroundColor: 'var(--success)', color: 'white' }}
                                >
                                  Principal
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {!isPrimary && (
                                <button
                                  type="button"
                                  onClick={() => setPrimaryManagerId(managerId)}
                                  className="text-xs px-2 py-1 rounded border hover:bg-gray-100 transition-colors"
                                  style={{ color: 'var(--primary)', borderColor: 'var(--primary)' }}
                                >
                                  Rendre principal
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => toggleManager(managerId)}
                                className="p-1 rounded hover:bg-red-50 transition-colors"
                              >
                                <X className="w-4 h-4" style={{ color: 'var(--danger)' }} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {managers.length === 0 ? (
                    <div className="w-full p-3 border rounded-lg text-sm" style={{ color: 'var(--text-muted)', backgroundColor: 'var(--neutral-50)' }}>
                      Aucun chef de gare disponible — créez d'abord un utilisateur avec le rôle "chef_gare"
                    </div>
                  ) : availableManagers.length > 0 ? (
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) {
                          const wasEmpty = selectedManagerIds.length === 0;
                          toggleManager(e.target.value);
                          if (wasEmpty) setPrimaryManagerId(e.target.value);
                        }
                      }}
                      className="w-full p-3 border rounded-lg"
                    >
                      <option value="">+ Ajouter un chef de gare...</option>
                      {availableManagers.map(m => {
                        const alreadyAssigned = m.station_id && m.station_id !== editingId;
                        return (
                          <option key={m.id} value={m.id}>
                            {m.full_name}{alreadyAssigned ? ' (déjà assigné à une autre gare)' : ''}
                          </option>
                        );
                      })}
                    </select>
                  ) : (
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      Tous les chefs de gare sont déjà affectés
                    </p>
                  )}

                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    Une gare peut avoir plusieurs chefs de gare. Le chef principal reste utilisé pour la logique des rôles et permissions existante.
                  </p>
                </div>

                {/* ── Bagagistes (multi-select) ── */}
                <div>
                  <label className="block mb-2 font-medium">Bagagistes affectés</label>

                  {selectedBaggageIds.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {selectedBaggageIds.map(handlerId => {
                        const handler = baggageHandlers.find(b => b.id === handlerId);
                        if (!handler) return null;
                        return (
                          <div
                            key={handlerId}
                            className="flex items-center justify-between p-3 rounded-lg border"
                            style={{ backgroundColor: 'var(--neutral-50)', borderColor: 'var(--neutral-200)' }}
                          >
                            <div className="flex items-center gap-3">
                              <Luggage className="w-4 h-4" style={{ color: 'var(--neutral-400)' }} />
                              <div>
                                <span className="text-sm font-medium">{handler.full_name}</span>
                                {handler.phone && (
                                  <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>
                                    {handler.phone}
                                  </span>
                                )}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => toggleBaggage(handlerId)}
                              className="p-1 rounded hover:bg-red-50 transition-colors"
                            >
                              <X className="w-4 h-4" style={{ color: 'var(--danger)' }} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {baggageHandlers.length === 0 ? (
                    <div className="w-full p-3 border rounded-lg text-sm" style={{ color: 'var(--text-muted)', backgroundColor: 'var(--neutral-50)' }}>
                      Aucun bagagiste disponible — créez d'abord un employé avec le poste "Bagagiste"
                    </div>
                  ) : availableBaggage.length > 0 ? (
                    <select
                      value=""
                      onChange={(e) => { if (e.target.value) toggleBaggage(e.target.value); }}
                      className="w-full p-3 border rounded-lg"
                    >
                      <option value="">+ Ajouter un bagagiste...</option>
                      {availableBaggage.map(b => (
                        <option key={b.id} value={b.id}>
                          {b.full_name}{b.phone ? ` (${b.phone})` : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      Tous les bagagistes sont déjà affectés
                    </p>
                  )}

                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    Une gare peut avoir un ou plusieurs bagagistes affectés.
                  </p>
                </div>

                <div className="flex items-center gap-2 p-4 border rounded-lg" style={{ backgroundColor: 'var(--neutral-50)' }}>
                  <input
                    type="checkbox"
                    id="display_screen"
                    checked={formData.display_screen_enabled}
                    onChange={(e) => setFormData({ ...formData, display_screen_enabled: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <label htmlFor="display_screen" className="font-medium">
                    Activer l'écran d'affichage aéroport
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="is_active"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <label htmlFor="is_active" className="font-medium">Gare active</label>
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
              <th className="text-left p-4 font-semibold">Gare</th>
              <th className="text-left p-4 font-semibold">Ville</th>
              <th className="text-left p-4 font-semibold">Chef de gare</th>
              <th className="text-left p-4 font-semibold">Agents courrier</th>
              <th className="text-left p-4 font-semibold">Bagagistes</th>
              <th className="text-left p-4 font-semibold">Code agence</th>
              <th className="text-left p-4 font-semibold">Contact</th>
              <th className="text-left p-4 font-semibold">Équipements</th>
              <th className="text-left p-4 font-semibold">Affichage</th>
              <th className="text-left p-4 font-semibold">Statut</th>
              <th className="text-left p-4 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((station) => {
              const agents = stationAgentsMap[station.id] ?? [];
              return (
                <tr key={station.id} className="border-t hover:bg-gray-50">
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                      <div>
                        <div className="font-bold">{station.name}</div>
                        {station.address && (
                          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {station.address}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="p-4">
                    {station.cities ? (
                      <div>
                        <div className="font-medium">{station.cities.name}</div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {station.cities.region}
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Non assignée</span>
                    )}
                    {(stationCitiesMap[station.id] ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {(stationCitiesMap[station.id] ?? []).map(c => (
                          <span
                            key={c.id}
                            className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                            style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}
                          >
                            {c.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="p-4">
                    {(stationManagersMap[station.id] ?? []).length > 0 ? (
                      <div className="space-y-1">
                        {(stationManagersMap[station.id] ?? []).map(sm => (
                          <div key={sm.id} className="flex items-center gap-1.5">
                            <UserCheck className="w-3.5 h-3.5" style={{ color: sm.is_primary ? 'var(--success)' : 'var(--primary)' }} />
                            <span className="text-sm font-medium">{(sm.manager as any)?.full_name}</span>
                            {sm.is_primary && (
                              <span
                                className="px-1.5 py-0.5 rounded text-[10px] font-semibold leading-none"
                                style={{ backgroundColor: 'var(--success-light)', color: 'var(--success)' }}
                              >
                                P
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Non assigné</span>
                    )}
                  </td>
                  <td className="p-4">
                    {agents.length > 0 ? (
                      <div className="space-y-1">
                        {agents.map(sa => (
                          <div key={sa.id} className="flex items-center gap-1.5">
                            <Package className="w-3.5 h-3.5" style={{ color: sa.is_primary ? 'var(--success)' : 'var(--neutral-400)' }} />
                            <span className="text-sm font-medium">{(sa.agent as any)?.full_name}</span>
                            {sa.is_primary && (
                              <span
                                className="px-1.5 py-0.5 rounded text-[10px] font-semibold leading-none"
                                style={{ backgroundColor: 'var(--success-light)', color: 'var(--success)' }}
                              >
                                P
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Aucun agent</span>
                    )}
                  </td>
                  <td className="p-4">
                    {(stationBaggageMap[station.id] ?? []).length > 0 ? (
                      <div className="space-y-1">
                        {(stationBaggageMap[station.id] ?? []).map(sb => (
                          <div key={sb.id} className="flex items-center gap-1.5">
                            <Luggage className="w-3.5 h-3.5" style={{ color: 'var(--neutral-400)' }} />
                            <span className="text-sm font-medium">{(sb.handler as any)?.full_name}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Aucun</span>
                    )}
                  </td>
                  <td className="p-4">
                    {station.agency_code ? (
                      <span className="px-3 py-1 rounded-full text-xs font-bold" style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
                        {station.agency_code}
                      </span>
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Non defini</span>
                    )}
                  </td>
                  <td className="p-4">
                    <div className="text-sm">
                      {station.phone && <div>{station.phone}</div>}
                      {station.email && (
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {station.email}
                        </div>
                      )}
                      {!station.phone && !station.email && (
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>N/A</span>
                      )}
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="flex gap-1 flex-wrap">
                      {station.facilities?.parking && (
                        <span className="px-2 py-1 rounded text-xs" style={{ backgroundColor: 'var(--neutral-200)' }}>
                          Parking
                        </span>
                      )}
                      {station.facilities?.wifi && (
                        <span className="px-2 py-1 rounded text-xs" style={{ backgroundColor: 'var(--neutral-200)' }}>
                          WiFi
                        </span>
                      )}
                      {station.facilities?.restaurant && (
                        <span className="px-2 py-1 rounded text-xs" style={{ backgroundColor: 'var(--neutral-200)' }}>
                          Restaurant
                        </span>
                      )}
                      {station.facilities?.toilettes && (
                        <span className="px-2 py-1 rounded text-xs" style={{ backgroundColor: 'var(--neutral-200)' }}>
                          Toilettes
                        </span>
                      )}
                      {station.facilities?.salle_attente && (
                        <span className="px-2 py-1 rounded text-xs" style={{ backgroundColor: 'var(--neutral-200)' }}>
                          Salle d'attente
                        </span>
                      )}
                      {!station.facilities || Object.values(station.facilities).every(v => !v) && (
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Aucun</span>
                      )}
                    </div>
                  </td>
                  <td className="p-4">
                    <span
                      className="px-3 py-1 rounded-full text-xs font-medium"
                      style={{
                        backgroundColor: station.display_screen_enabled ? 'var(--primary-light)' : 'var(--neutral-200)',
                        color: station.display_screen_enabled ? 'var(--primary)' : 'var(--neutral-600)'
                      }}
                    >
                      {station.display_screen_enabled ? 'Activé' : 'Désactivé'}
                    </span>
                  </td>
                  <td className="p-4">
                    <span
                      className="px-3 py-1 rounded-full text-xs font-medium"
                      style={{
                        backgroundColor: station.is_active ? 'var(--success-light)' : 'var(--neutral-200)',
                        color: station.is_active ? 'var(--success)' : 'var(--neutral-600)'
                      }}
                    >
                      {station.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="p-4">
                    <div className="flex gap-2">
                      <button
                        onClick={() => navigate(`/admin/stations/${station.id}`)}
                        className="p-2 hover:bg-gray-100 rounded-lg"
                        title="Voir détails"
                      >
                        <Eye className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                      </button>
                      {station.display_screen_enabled && (
                        <button
                          onClick={() => window.open(`/display/station/${station.id}`, '_blank')}
                          className="p-2 hover:bg-gray-100 rounded-lg"
                          title="Ecran d'affichage"
                        >
                          <Monitor className="w-4 h-4" style={{ color: 'var(--success)' }} />
                        </button>
                      )}
                      <button
                        onClick={() => handleEdit(station)}
                        className="p-2 hover:bg-gray-100 rounded-lg"
                        title="Modifier"
                      >
                        <Edit2 className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                      </button>
                      <button
                        onClick={() => handleDelete(station.id)}
                        className="p-2 hover:bg-gray-100 rounded-lg"
                        title="Supprimer"
                      >
                        <Trash2 className="w-4 h-4" style={{ color: 'var(--danger)' }} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="text-center py-12">
            <Building2 className="w-16 h-16 mx-auto mb-4" style={{ color: 'var(--neutral-400)' }} />
            <p style={{ color: 'var(--text-secondary)' }}>
              {search.trim() ? 'Aucune gare ne correspond à votre recherche' : 'Aucune gare trouvée'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
