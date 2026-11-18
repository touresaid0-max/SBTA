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
  /** Tarif standard (climatisé, the stop's price, as before) */
  price: number;
  /** Tarif non climatisé (only when the route has « Non climatisé »; applied to a departure « Non climatisé ») */
  price_no_ac?: number | null;
}

interface StationLite {
  id: string;
  name: string;
}

interface RouteData {
  id: string;
  name: string;
  origin_station_id?: string | null;
  origin_city_id: string;
  destination_city_id: string;
  distance_km: number;
  estimated_duration_minutes: number;
  /** Tarif standard (climatisé, the route's price, as before) */
  base_price: number | null;
  /** Tarif non climatisé */
  base_price_no_ac?: number | null;
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
    // Tarif standard (the current prices) and tarif non climatisé
    base_price: null as number | null,
    base_price_no_ac: null as number | null,
    is_active: true
  });

  const [intermediateStops, setIntermediateStops] = useState<IntermediateStop[]>([]);
  const [calculating, setCalculating] = useState(false);

  // Secondary routes: their stations are the only ones the guichet can pick as « Gare de vente
  // secondaire » when a departure of this route is loaded in another station
  const [secondaryRouteIds, setSecondaryRouteIds] = useState<string[]>([]);
  // « Non climatisé » ticked: the tarif non climatisé fields show; unticked, none is saved
  const [noAcEnabled, setNoAcEnabled] = useState(false);
  const [stations, setStations] = useState<StationLite[]>([]);
  // Stations linked to each secondary route (guichets with that route, origin station): the
  // stations proposed, pre-ticked, as partner stations
  const [secondaryStations, setSecondaryStations] = useState<Record<string, string[]>>({});
  // Partner stations ticked by the admin for each secondary route: only these can receive seats
  // of a departure of this route at the guichet. Missing: not chosen yet (the linked stations).
  const [partnerStations, setPartnerStations] = useState<Record<string, string[]>>({});
  // Routes of which this route is a secondary route: sharing goes one way only, so they cannot be
  // its secondary routes
  const [mainRouteIds, setMainRouteIds] = useState<string[]>([]);
  const [addStationFor, setAddStationFor] = useState<Record<string, string>>({});

  useEffect(() => {
    const missing = secondaryRouteIds.filter(id => !(id in secondaryStations));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('counter_routes')
        .select('route_id, counters(station_id, is_active)')
        .in('route_id', missing);
      if (cancelled || error) return;
      const next: Record<string, string[]> = {};
      for (const id of missing) {
        const ids = new Set<string>();
        for (const row of (data ?? []) as any[]) {
          const c = Array.isArray(row.counters) ? row.counters[0] : row.counters;
          if (row.route_id === id && c?.station_id && c.is_active !== false) ids.add(c.station_id);
        }
        const origin = routes.find(r => r.id === id)?.origin_station_id;
        if (origin) ids.add(origin);
        next[id] = Array.from(ids).filter(sid => stations.some(s => s.id === sid));
      }
      setSecondaryStations(prev => ({ ...prev, ...next }));
      // A secondary route without a choice yet: its linked stations, pre-ticked
      setPartnerStations(prev => {
        const out = { ...prev };
        for (const id of missing) if (!(id in out)) out[id] = next[id];
        return out;
      });
    })();
    return () => { cancelled = true; };
  }, [secondaryRouteIds, secondaryStations, routes, stations]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [routesRes, citiesRes, stationsRes] = await Promise.all([
        supabase
          .from('routes')
          .select('*, origin_city:cities!origin_city_id(name), destination_city:cities!destination_city_id(name)')
          .order('name'),
        supabase.from('cities').select('id, name').order('name'),
        supabase.from('stations').select('id, name').eq('is_active', true).order('name'),
      ]);

      if (routesRes.error) throw routesRes.error;
      if (citiesRes.error) throw citiesRes.error;

      setRoutes(routesRes.data || []);
      setCities(citiesRes.data || []);
      setStations(stationsRes.data || []);
      setSecondaryStations({});
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
      .select('id, city_id, price, price_no_ac, cities!inner(name)')
      .eq('route_id', routeId)
      .order('position');

    // Server without the non climatisé fares yet: the stops are read without them (an empty list
    // here would delete them all at the next save)
    let rows: any[] | null = data;
    if (error) {
      const retry = await supabase
        .from('route_city_stops')
        .select('id, city_id, price, cities!inner(name)')
        .eq('route_id', routeId)
        .order('position');
      if (retry.error) throw retry.error;
      rows = retry.data;
    }

    return (rows || []).map((s: any) => ({
      id: s.id,
      city_id: s.city_id,
      city_name: s.cities?.name,
      price: Number(s.price) || 0,
      price_no_ac: s.price_no_ac != null && Number(s.price_no_ac) > 0 ? Number(s.price_no_ac) : null,
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
      // Without a tarif standard, 0 is saved (other screens show the price as a number)
      const payload = {
        ...formData,
        base_price: formData.base_price ?? 0,
        base_price_no_ac: noAcEnabled ? formData.base_price_no_ac : null,
      };

      if (editingId) {
        const { error } = await supabase
          .from('routes')
          .update(payload)
          .eq('id', editingId);

        if (error) throw error;
        toast.success('Itinéraire mis à jour');
      } else {
        const { data, error } = await supabase
          .from('routes')
          .insert([payload])
          .select('id')
          .single();

        if (error) throw error;
        routeId = data.id;
        toast.success('Itinéraire créé');
      }

      // Sync intermediate stops and secondary routes
      if (routeId) {
        await syncIntermediateStops(routeId, intermediateStops);
        // The ticked stations; a secondary route left as proposed: its linked stations
        const partners: Record<string, string[]> = {};
        for (const id of secondaryRouteIds) {
          const list = partnerStations[id] ?? secondaryStations[id];
          if (list) partners[id] = list;
        }
        await syncSecondaryRoutes(routeId, secondaryRouteIds, partners);
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
        price_no_ac: noAcEnabled && stop.price_no_ac && stop.price_no_ac > 0 ? stop.price_no_ac : null,
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

  // A database where the partner stations column does not exist yet (migration 20261118160000
  // not run): the secondary routes are saved without it, as before
  const missingPartnerColumn = (e: { code?: string; message?: string } | null) =>
    !!e && (e.code === '42703' || e.code === 'PGRST204' || /partner_station_ids/.test(e.message ?? ''));

  const syncSecondaryRoutes = async (routeId: string, ids: string[], partners: Record<string, string[]>) => {
    const { data: current, error } = await supabase
      .from('route_secondary_routes')
      .select('id, secondary_route_id')
      .eq('route_id', routeId);
    if (error) throw new Error(`Itinéraires secondaires : ${error.message}`);
    const wanted = new Set(ids.filter(id => id !== routeId));
    const toDelete = (current ?? []).filter((c: any) => !wanted.has(c.secondary_route_id)).map((c: any) => c.id);
    const have = new Set((current ?? []).map((c: any) => c.secondary_route_id));
    const toInsert = Array.from(wanted).filter(id => !have.has(id))
      .map(id => ({ route_id: routeId, secondary_route_id: id, partner_station_ids: partners[id] ?? [] }));
    if (toDelete.length > 0) {
      const { error: delError } = await supabase.from('route_secondary_routes').delete().in('id', toDelete);
      if (delError) throw new Error(`Itinéraires secondaires : ${delError.message}`);
    }
    if (toInsert.length > 0) {
      let { error: insError } = await supabase.from('route_secondary_routes').insert(toInsert);
      if (missingPartnerColumn(insError)) {
        ({ error: insError } = await supabase.from('route_secondary_routes')
          .insert(toInsert.map(r => ({ route_id: r.route_id, secondary_route_id: r.secondary_route_id }))));
      }
      if (insError) throw new Error(`Itinéraires secondaires : ${insError.message}`);
    }
    // The partner stations of the secondary routes kept
    for (const c of (current ?? []) as { id: string; secondary_route_id: string }[]) {
      if (!wanted.has(c.secondary_route_id) || !(c.secondary_route_id in partners)) continue;
      const { error: upError } = await supabase.from('route_secondary_routes')
        .update({ partner_station_ids: partners[c.secondary_route_id] })
        .eq('id', c.id);
      if (missingPartnerColumn(upError)) break;
      if (upError) throw new Error(`Gares partenaires : ${upError.message}`);
    }
  };

  const loadSecondaryRoutes = async (routeId: string): Promise<{ ids: string[]; partners: Record<string, string[]> }> => {
    let { data, error }: { data: any[] | null; error: any } = await supabase
      .from('route_secondary_routes')
      .select('secondary_route_id, partner_station_ids')
      .eq('route_id', routeId);
    if (missingPartnerColumn(error)) {
      ({ data, error } = await supabase.from('route_secondary_routes').select('secondary_route_id').eq('route_id', routeId));
    }
    if (error) throw error;
    const partners: Record<string, string[]> = {};
    for (const r of data ?? []) {
      if (Array.isArray(r.partner_station_ids)) partners[r.secondary_route_id] = r.partner_station_ids as string[];
    }
    return { ids: (data ?? []).map((r: any) => r.secondary_route_id as string), partners };
  };

  const loadMainRoutes = async (routeId: string): Promise<string[]> => {
    const { data } = await supabase.from('route_secondary_routes').select('route_id').eq('secondary_route_id', routeId);
    return (data ?? []).map((r: any) => r.route_id as string);
  };

  const handleEdit = async (route: RouteData) => {
    setFormData({
      name: route.name,
      origin_city_id: route.origin_city_id,
      destination_city_id: route.destination_city_id,
      distance_km: route.distance_km,
      estimated_duration_minutes: route.estimated_duration_minutes,
      base_price: route.base_price != null && Number(route.base_price) > 0 ? Number(route.base_price) : null,
      base_price_no_ac: route.base_price_no_ac != null && Number(route.base_price_no_ac) > 0 ? Number(route.base_price_no_ac) : null,
      is_active: route.is_active
    });
    setEditingId(route.id);
    setNoAcEnabled(Number(route.base_price_no_ac) > 0);

    try {
      const stops = await loadRouteStops(route.id);
      setIntermediateStops(stops);
      if (stops.some(s => (s.price_no_ac ?? 0) > 0)) setNoAcEnabled(true);
    } catch {
      setIntermediateStops([]);
    }

    try {
      const loaded = await loadSecondaryRoutes(route.id);
      setPartnerStations(loaded.partners);
      setSecondaryRouteIds(loaded.ids);
    } catch {
      setPartnerStations({});
      setSecondaryRouteIds([]);
    }
    setMainRouteIds(await loadMainRoutes(route.id));

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
      base_price: null,
      base_price_no_ac: null,
      is_active: true
    });
    setIntermediateStops([]);
    setSecondaryRouteIds([]);
    setPartnerStations({});
    setMainRouteIds([]);
    setAddStationFor({});
    setNoAcEnabled(false);
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
    setIntermediateStops([...intermediateStops, { city_id: cityId, city_name: cityName, price: 0 }]);
  };

  const removeIntermediateStop = (index: number) => {
    setIntermediateStops(intermediateStops.filter((_, i) => i !== index));
  };

  const updateStopPrice = (index: number, price: number) => {
    setIntermediateStops(intermediateStops.map((s, i) => i === index ? { ...s, price } : s));
  };

  const updateStopPriceNoAc = (index: number, price: number | null) => {
    setIntermediateStops(intermediateStops.map((s, i) => i === index ? { ...s, price_no_ac: price } : s));
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
                            <div className="flex flex-col items-end">
                              <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Standard</span>
                              <input
                                type="number"
                                value={stop.price || ''}
                                onChange={(e) => updateStopPrice(index, parseFloat(e.target.value) || 0)}
                                className="w-24 p-1.5 text-sm border rounded text-right"
                                min="0"
                                step="100"
                                placeholder="Standard"
                                title="Tarif standard"
                              />
                            </div>
                            {noAcEnabled && (
                              <div className="flex flex-col items-end">
                                <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Non clim.</span>
                                <input
                                  type="number"
                                  value={stop.price_no_ac ?? ''}
                                  onChange={(e) => {
                                    const v = parseFloat(e.target.value);
                                    updateStopPriceNoAc(index, Number.isFinite(v) && v > 0 ? v : null);
                                  }}
                                  className="w-24 p-1.5 text-sm border rounded text-right"
                                  min="0"
                                  step="100"
                                  placeholder="Non clim."
                                  title="Tarif non climatisé"
                                />
                              </div>
                            )}
                            <span className="text-xs font-medium self-end mb-2" style={{ color: 'var(--text-muted)' }}>FCFA</span>
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
                      ...intermediateStops.map(s => s.city_id),
                    ]}
                    onSelect={addIntermediateStop}
                    onCityCreated={(city) => {
                      setCities([...cities, city]);
                      addIntermediateStop(city.id, city.name);
                    }}
                  />
                </div>

                {/* Secondary routes: stations allowed for « Charger dans une autre gare » */}
                <div className="border-2 border-dashed rounded-lg p-4" style={{ borderColor: 'var(--neutral-300)' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <RouteIcon className="w-5 h-5" style={{ color: 'var(--primary)' }} />
                    <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                      Itinéraires secondaires
                    </h3>
                  </div>
                  <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
                    Au guichet, « Charger dans une autre gare » ne propose que les <b>gares partenaires cochées</b>.
                    Partage dans un seul sens : seule la gare de cet itinéraire crée le départ et choisit avec qui elle le partage.
                  </p>
                  {mainRouteIds.length > 0 && (
                    <p className="text-xs mb-3 rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--warning-light, #FEF3C7)', color: '#92400E' }}>
                      Cet itinéraire est déjà l'itinéraire secondaire de : {mainRouteIds.map(id => routes.find(r => r.id === id)?.name ?? '?').join(', ')}.
                      Le partage se fait dans un seul sens : ces itinéraires ne peuvent pas devenir ses itinéraires secondaires.
                    </p>
                  )}

                  {secondaryRouteIds.length > 0 ? (
                    <div className="space-y-2 mb-3">
                      {secondaryRouteIds.map(id => {
                        const r = routes.find(x => x.id === id);
                        const linked = secondaryStations[id];
                        const ticked = partnerStations[id] ?? linked ?? [];
                        const shown = Array.from(new Set([...(linked ?? []), ...ticked]))
                          .map(sid => ({ id: sid, name: stations.find(s => s.id === sid)?.name ?? 'Gare désactivée' }))
                          .sort((a, b) => a.name.localeCompare(b.name));
                        const toggle = (sid: string) => setPartnerStations(prev => {
                          const cur = prev[id] ?? linked ?? [];
                          return { ...prev, [id]: cur.includes(sid) ? cur.filter(x => x !== sid) : [...cur, sid] };
                        });
                        return (
                          <div
                            key={id}
                            className="flex items-start gap-2 bg-white rounded-lg border p-2"
                            style={{ borderColor: 'var(--neutral-200)' }}
                          >
                            <RouteIcon className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                                {r?.name ?? 'Itinéraire supprimé'}
                              </p>
                              {linked === undefined && !(id in partnerStations) ? (
                                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Gares : chargement…</p>
                              ) : (
                                <>
                                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Gares partenaires :</p>
                                  <div className="flex flex-wrap gap-1.5 mt-1">
                                    {shown.map(st => {
                                      const on = ticked.includes(st.id);
                                      return (
                                        <button key={st.id} type="button" onClick={() => toggle(st.id)}
                                          className="flex items-center gap-1.5 rounded-lg border-2 px-2 py-1 text-xs font-medium"
                                          style={{ borderColor: on ? 'var(--primary)' : '#E2EAE5', backgroundColor: on ? '#f2faf4' : '#fff', color: on ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                                          title={on ? 'Cliquer pour retirer cette gare' : 'Cliquer pour cocher cette gare'}>
                                          <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded border text-[10px] text-white"
                                            style={{ borderColor: on ? 'var(--primary)' : '#9BB5A4', backgroundColor: on ? 'var(--primary)' : '#fff' }}>
                                            {on ? '✓' : ''}
                                          </span>
                                          {st.name}
                                        </button>
                                      );
                                    })}
                                    <select
                                      value={addStationFor[id] ?? ''}
                                      onChange={(e) => {
                                        const sid = e.target.value;
                                        if (!sid) return;
                                        setPartnerStations(prev => ({ ...prev, [id]: [...(prev[id] ?? linked ?? []).filter(x => x !== sid), sid] }));
                                        setAddStationFor(prev => ({ ...prev, [id]: '' }));
                                      }}
                                      className="border rounded-lg px-2 py-1 text-xs"
                                      style={{ borderColor: '#E2EAE5', color: 'var(--text-muted)' }}>
                                      <option value="">＋ Ajouter une gare…</option>
                                      {stations.filter(st => !shown.some(x => x.id === st.id)).map(st => (
                                        <option key={st.id} value={st.id}>{st.name}</option>
                                      ))}
                                    </select>
                                  </div>
                                  {ticked.length === 0 && (
                                    <p className="text-xs mt-1" style={{ color: 'var(--warning)' }}>
                                      Aucune gare cochée : les départs de cet itinéraire ne pourront pas être partagés par cet itinéraire secondaire.
                                    </p>
                                  )}
                                </>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => setSecondaryRouteIds(secondaryRouteIds.filter(x => x !== id))}
                              className="p-1.5 hover:bg-red-50 rounded-lg flex-shrink-0"
                              title="Retirer"
                            >
                              <Trash2 className="w-4 h-4" style={{ color: 'var(--danger)' }} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-4 mb-2">
                      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                        Aucun itinéraire secondaire : au guichet, aucune gare ne sera proposée pour charger ce départ ailleurs.
                      </p>
                    </div>
                  )}

                  <RouteAutocomplete
                    routes={routes}
                    excludedIds={[...(editingId ? [editingId] : []), ...secondaryRouteIds, ...mainRouteIds]}
                    onSelect={(id) => setSecondaryRouteIds([...secondaryRouteIds, id])}
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
                    <label className="block mb-2 font-medium">Tarif standard (FCFA)</label>
                    <input
                      type="number"
                      value={formData.base_price ?? ''}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        setFormData({ ...formData, base_price: Number.isFinite(v) && v > 0 ? v : null });
                      }}
                      className="w-full p-3 border rounded-lg"
                      min="0"
                      step="100"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 items-end">
                  <label className="flex items-center gap-2 pb-3 font-medium cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={noAcEnabled}
                      onChange={(e) => setNoAcEnabled(e.target.checked)}
                      className="w-4 h-4"
                    />
                    Non climatisé
                  </label>
                  {noAcEnabled && (
                    <div>
                      <label className="block mb-2 font-medium">Tarif non climatisé (FCFA)</label>
                      <input
                        type="number"
                        value={formData.base_price_no_ac ?? ''}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          setFormData({ ...formData, base_price_no_ac: Number.isFinite(v) && v > 0 ? v : null });
                        }}
                        className="w-full p-3 border rounded-lg"
                        min="0"
                        step="100"
                      />
                    </div>
                  )}
                  <p className={`${noAcEnabled ? '' : 'col-span-2 '}text-sm pb-3`} style={{ color: 'var(--text-secondary)' }}>
                    {noAcEnabled
                      ? 'Au guichet, un départ climatisé applique le tarif standard, un départ « Non climatisé » ce tarif.'
                      : 'Le tarif standard est le tarif climatisé. Cochez « Non climatisé » pour saisir le tarif des bus non climatisés.'}
                  </p>
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
              <th className="text-left p-4 font-semibold">Tarif standard / non climatisé</th>
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
                  <td className="p-4">
                    {route.base_price ? `${Number(route.base_price).toLocaleString()} FCFA` : '—'}
                    {Number(route.base_price_no_ac) > 0 && (
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        Non climatisé : {Number(route.base_price_no_ac).toLocaleString()} FCFA
                      </div>
                    )}
                  </td>
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
// RouteAutocomplete — search an existing route to add as secondary route
// ============================================================

interface RouteAutocompleteProps {
  routes: RouteData[];
  excludedIds: string[];
  onSelect: (routeId: string) => void;
}

function RouteAutocomplete({ routes, excludedIds, onSelect }: RouteAutocompleteProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const available = routes.filter(r => !excludedIds.includes(r.id));
    const q = query.toLowerCase().trim();
    const list = q
      ? available.filter(r => `${r.name} ${r.origin_city?.name ?? ''} ${r.destination_city?.name ?? ''}`.toLowerCase().includes(q))
      : available;
    return list.slice(0, 50);
  }, [routes, excludedIds, query]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Rechercher un itinéraire à ajouter..."
          className="w-full pl-10 pr-3 py-2.5 border rounded-lg text-sm"
        />
      </div>

      {open && (
        <div
          className="absolute z-50 mt-1 w-full rounded-lg border max-h-56 overflow-y-auto shadow-xl bg-white"
          style={{ borderColor: 'var(--border)' }}
        >
          {filtered.length > 0 ? (
            <div className="py-1">
              {filtered.map(r => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => { onSelect(r.id); setQuery(''); setOpen(false); }}
                  className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-gray-50 transition-colors"
                >
                  <RouteIcon className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{r.name}</span>
                  {!r.is_active && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>(inactif)</span>}
                </button>
              ))}
            </div>
          ) : (
            <div className="px-3 py-2 text-sm text-center" style={{ color: 'var(--text-muted)' }}>
              Aucun itinéraire trouvé
            </div>
          )}
        </div>
      )}
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
