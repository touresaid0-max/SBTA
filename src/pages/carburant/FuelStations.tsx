import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Fuel, Plus, Pencil, Eye, EyeOff, Search, X, Filter,
  Phone, CheckCircle, XCircle, Tag, DollarSign, Info, MapPin, ChevronDown,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';

/* ─── types ─────────────────────────────────────────────────── */

interface FuelStation {
  id: string;
  name: string;
  code: string;
  fuel_types: string[];
  price_essence: number | null;
  price_gasoil: number | null;
  phone: string | null;
  is_active: boolean;
  observations: string | null;
  created_at: string;
  updated_at: string;
  cities?: City[];
}

interface City {
  id: string;
  name: string;
  region: string;
  country: string;
}

interface FuelStationCity {
  id: string;
  fuel_station_id: string;
  city_id: string;
}

const ALL_FUEL_TYPES = ['essence', 'gasoil'] as const;
const FUEL_LABELS: Record<string, string> = { essence: 'Essence', gasoil: 'Gasoil' };
const FUEL_COLORS: Record<string, string> = { essence: '#F59E0B', gasoil: '#3B82F6' };

const EMPTY_FORM = {
  name: '',
  code: '',
  fuel_types: ['gasoil'] as string[],
  price_essence: '',
  price_gasoil: '',
  phone: '',
  is_active: true,
  observations: '',
};

/* ─── helpers ────────────────────────────────────────────────── */

function fmt(n: number | null) {
  if (n == null) return '—';
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n) + ' FCFA';
}

/* ─── component ─────────────────────────────────────────────── */

export default function CarburantFuelStations() {
  const navigate = useNavigate();
  const [stations, setStations] = useState<FuelStation[]>([]);
  const [allCities, setAllCities] = useState<City[]>([]);

  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailStation, setDetailStation] = useState<FuelStation | null>(null);

  const [formData, setFormData] = useState({ ...EMPTY_FORM });
  const [selectedCities, setSelectedCities] = useState<City[]>([]);
  const [citySearch, setCitySearch] = useState('');
  const [showCityDropdown, setShowCityDropdown] = useState(false);
  const cityDropdownRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState('');
  const [filterFuelType, setFilterFuelType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCity, setFilterCity] = useState('');

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (cityDropdownRef.current && !cityDropdownRef.current.contains(e.target as Node)) {
        setShowCityDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [stationsRes, citiesRes, assocRes] = await Promise.all([
        supabase.from('fuel_stations').select('*').order('name'),
        supabase.from('cities').select('id, name, region, country').order('name'),
        supabase.from('fuel_station_cities').select('id, fuel_station_id, city_id'),
      ]);

      if (stationsRes.error) throw stationsRes.error;
      if (citiesRes.error) throw citiesRes.error;
      if (assocRes.error) throw assocRes.error;

      const cities = (citiesRes.data as City[]) || [];
      setAllCities(cities);

      const cityById: Record<string, City> = {};
      cities.forEach(c => { cityById[c.id] = c; });

      const map: Record<string, City[]> = {};
      (assocRes.data as FuelStationCity[])?.forEach(a => {
        const city = cityById[a.city_id];
        if (city) {
          if (!map[a.fuel_station_id]) map[a.fuel_station_id] = [];
          map[a.fuel_station_id].push(city);
        }
      });
      const stationsData = ((stationsRes.data as FuelStation[]) || []).map(s => ({
        ...s,
        cities: map[s.id] || [],
      }));
      setStations(stationsData);
    } catch (err: any) {
      toast.error(err.message || 'Erreur de chargement des stations');
    } finally {
      setLoading(false);
    }
  };

  /* ─── city autocomplete helpers ─── */

  const filteredCityOptions = useMemo(() => {
    const q = citySearch.toLowerCase().trim();
    return allCities
      .filter(c => !selectedCities.some(sc => sc.id === c.id))
      .filter(c => !q || c.name.toLowerCase().includes(q) || c.region.toLowerCase().includes(q))
      .slice(0, 20);
  }, [allCities, citySearch, selectedCities]);

  const addCity = (city: City) => {
    if (selectedCities.some(c => c.id === city.id)) return;
    setSelectedCities(prev => [...prev, city]);
    setCitySearch('');
    setShowCityDropdown(false);
  };

  const removeCity = (cityId: string) => {
    setSelectedCities(prev => prev.filter(c => c.id !== cityId));
  };

  /* ─── CRUD ─── */

  const openCreate = () => {
    setEditingId(null);
    setFormData({ ...EMPTY_FORM });
    setSelectedCities([]);
    setCitySearch('');
    setShowCityDropdown(false);
    setShowForm(true);
  };

  const openEdit = (s: FuelStation) => {
    setEditingId(s.id);
    setFormData({
      name: s.name,
      code: s.code,
      fuel_types: s.fuel_types || ['gasoil'],
      price_essence: s.price_essence != null ? String(s.price_essence) : '',
      price_gasoil: s.price_gasoil != null ? String(s.price_gasoil) : '',
      phone: s.phone || '',
      is_active: s.is_active,
      observations: s.observations || '',
    });
    setSelectedCities(s.cities || []);
    setCitySearch('');
    setShowCityDropdown(false);
    setShowForm(true);
    setDetailStation(null);
  };

  const toggleFuelType = (ft: string) => {
    setFormData(prev => {
      const already = prev.fuel_types.includes(ft);
      if (already && prev.fuel_types.length === 1) return prev;
      return {
        ...prev,
        fuel_types: already ? prev.fuel_types.filter(t => t !== ft) : [...prev.fuel_types, ft],
      };
    });
  };

  const syncStationCities = async (stationId: string, cities: City[]) => {
    const { data: existing } = await supabase
      .from('fuel_station_cities')
      .select('id, city_id')
      .eq('fuel_station_id', stationId);

    const existingCityIds = ((existing as FuelStationCity[]) || []).map(e => e.city_id);
    const newCityIds = cities.map(c => c.id);
    const toDelete = existingCityIds.filter(id => !newCityIds.includes(id));
    const toInsert = newCityIds.filter(id => !existingCityIds.includes(id))
      .map(city_id => ({ fuel_station_id: stationId, city_id }));

    if (toDelete.length > 0) {
      await supabase.from('fuel_station_cities')
        .delete()
        .eq('fuel_station_id', stationId)
        .in('city_id', toDelete);
    }
    if (toInsert.length > 0) {
      await supabase.from('fuel_station_cities').insert(toInsert);
    }
  };

  const handleSave = async () => {
    if (!formData.name.trim()) { toast.error('Le nom est obligatoire'); return; }
    if (!formData.code.trim()) { toast.error('Le code est obligatoire'); return; }
    if (formData.fuel_types.length === 0) { toast.error('Sélectionnez au moins un type de carburant'); return; }

    setSaving(true);
    try {
      const payload: any = {
        name: formData.name.trim(),
        code: formData.code.trim().toUpperCase(),
        fuel_types: formData.fuel_types,
        price_essence: formData.fuel_types.includes('essence') && formData.price_essence !== ''
          ? parseFloat(formData.price_essence) : null,
        price_gasoil: formData.fuel_types.includes('gasoil') && formData.price_gasoil !== ''
          ? parseFloat(formData.price_gasoil) : null,
        phone: formData.phone.trim() || null,
        is_active: formData.is_active,
        observations: formData.observations.trim() || null,
      };

      let stationId = editingId;

      if (editingId) {
        const { error } = await supabase.from('fuel_stations').update(payload).eq('id', editingId);
        if (error) throw error;
        toast.success('Station mise à jour');
      } else {
        const { data, error } = await supabase.from('fuel_stations').insert(payload).select('id').single();
        if (error) throw error;
        stationId = (data as any).id;
        toast.success('Station créée');
      }

      if (stationId) {
        await syncStationCities(stationId, selectedCities);
      }

      setShowForm(false);
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors de l\'enregistrement');
    } finally { setSaving(false); }
  };

  const toggleActive = async (s: FuelStation) => {
    const { error } = await supabase
      .from('fuel_stations')
      .update({ is_active: !s.is_active })
      .eq('id', s.id);
    if (error) { toast.error('Erreur'); return; }
    toast.success(s.is_active ? 'Station désactivée' : 'Station activée');
    loadData();
    if (detailStation?.id === s.id) setDetailStation(prev => prev ? { ...prev, is_active: !prev.is_active } : null);
  };

  /* ─── derived ─── */

  const filtered = stations.filter(s => {
    const q = search.toLowerCase();
    const matchSearch = !q || s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)
      || (s.cities || []).some(c => c.name.toLowerCase().includes(q));
    const matchFuel = !filterFuelType || s.fuel_types.includes(filterFuelType);
    const matchStatus = !filterStatus || (filterStatus === 'active' ? s.is_active : !s.is_active);
    const matchCity = !filterCity || (s.cities || []).some(c => c.id === filterCity);
    return matchSearch && matchFuel && matchStatus && matchCity;
  });

  const hasFilters = search || filterFuelType || filterStatus || filterCity;
  const clearFilters = () => { setSearch(''); setFilterFuelType(''); setFilterStatus(''); setFilterCity(''); };

  const kpis = [
    { label: 'Total stations',  value: stations.length,                           color: '#3B82F6', icon: <Fuel className="w-5 h-5" /> },
    { label: 'Actives',         value: stations.filter(s => s.is_active).length,  color: '#16A34A', icon: <CheckCircle className="w-5 h-5" /> },
    { label: 'Inactives',       value: stations.filter(s => !s.is_active).length, color: '#6B7280', icon: <XCircle className="w-5 h-5" /> },
    { label: 'Avec essence',    value: stations.filter(s => s.fuel_types.includes('essence')).length, color: '#F59E0B', icon: <Tag className="w-5 h-5" /> },
  ];

  /* ─── render ─────────────────────────────────────────────── */

  return (
    <div className="p-6 lg:p-8">
      {/* header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Stations-service</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {stations.filter(s => s.is_active).length} station{stations.filter(s => s.is_active).length !== 1 ? 's' : ''} active{stations.filter(s => s.is_active).length !== 1 ? 's' : ''} sur {stations.length} au total
          </p>
        </div>
        <button onClick={openCreate}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white font-semibold text-sm transition-opacity hover:opacity-90"
          style={{ backgroundColor: '#0B7439' }}>
          <Plus className="w-4 h-4" /> Nouvelle station
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {kpis.map(kpi => (
          <div key={kpi.label} className="rounded-xl p-4 border flex items-center gap-3"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: `${kpi.color}18`, color: kpi.color }}>
              {kpi.icon}
            </div>
            <div>
              <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{kpi.label}</p>
              <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{kpi.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* filters */}
      <div className="rounded-xl border p-5 mb-6" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Recherche & Filtres</span>
          {hasFilters && (
            <button onClick={clearFilters} className="ml-auto flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
              <X className="w-3 h-3" /> Effacer
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="relative md:col-span-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Nom, code, ville…"
              className="w-full pl-9 pr-3 py-2.5 border rounded-lg text-sm outline-none"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
          </div>
          <select value={filterFuelType} onChange={e => setFilterFuelType(e.target.value)}
            className="px-3 py-2.5 border rounded-lg text-sm"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}>
            <option value="">Tous types de carburant</option>
            {ALL_FUEL_TYPES.map(ft => <option key={ft} value={ft}>{FUEL_LABELS[ft]}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="px-3 py-2.5 border rounded-lg text-sm"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}>
            <option value="">Tous statuts</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <select value={filterCity} onChange={e => setFilterCity(e.target.value)}
            className="px-3 py-2.5 border rounded-lg text-sm"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}>
            <option value="">Toutes les villes</option>
            {allCities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {/* table */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-10 h-10 border-4 rounded-full animate-spin" style={{ borderColor: '#0B7439', borderTopColor: 'transparent' }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed rounded-2xl" style={{ borderColor: 'var(--border)' }}>
          <Fuel className="w-12 h-12 mx-auto mb-3" style={{ color: '#D1D5DB' }} />
          <p className="font-semibold" style={{ color: 'var(--text-secondary)' }}>Aucune station trouvée</p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Créez votre première station ou ajustez les filtres</p>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle, #F9FAFB)' }}>
                {['Station', 'Code', 'Villes associées', 'Carburants', 'Prix', 'Téléphone', 'Statut', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                    style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <tr key={s.id}
                  className="border-t transition-colors hover:bg-gray-50 cursor-pointer"
                  style={{ borderColor: 'var(--border)' }}
                  onClick={() => setDetailStation(s)}>
                  <td className="px-4 py-3">
                    <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{s.name}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs px-2 py-1 rounded-lg"
                      style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}>
                      {s.code}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {(s.cities && s.cities.length > 0) ? (
                      <div className="flex flex-wrap gap-1">
                        {s.cities.map(c => (
                          <span key={c.id} className="px-2 py-0.5 rounded-full text-xs font-medium"
                            style={{ backgroundColor: '#3B82F618', color: '#3B82F6' }}>
                            {c.name}
                          </span>
                        ))}
                      </div>
                    ) : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {s.fuel_types.map(ft => (
                        <span key={ft} className="px-2 py-0.5 rounded-full text-xs font-semibold"
                          style={{ backgroundColor: `${FUEL_COLORS[ft]}18`, color: FUEL_COLORS[ft] }}>
                          {FUEL_LABELS[ft] || ft}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {s.fuel_types.includes('essence') && (
                        <div>Ess. {fmt(s.price_essence)}</div>
                      )}
                      {s.fuel_types.includes('gasoil') && (
                        <div>Gas. {fmt(s.price_gasoil)}</div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {s.phone ? (
                      <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                        <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                        {s.phone}
                      </div>
                    ) : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2.5 py-1 rounded-full text-xs font-semibold"
                      style={{ backgroundColor: s.is_active ? '#F0FDF4' : '#F9FAFB', color: s.is_active ? '#16A34A' : '#6B7280' }}>
                      {s.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-2">
                      <button onClick={() => openEdit(s)}
                        className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors" title="Modifier">
                        <Pencil className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                      </button>
                      <button onClick={() => toggleActive(s)}
                        className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                        title={s.is_active ? 'Désactiver' : 'Activer'}>
                        {s.is_active
                          ? <EyeOff className="w-4 h-4" style={{ color: '#F59E0B' }} />
                          : <Eye className="w-4 h-4" style={{ color: '#16A34A' }} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── DETAIL PANEL ─────────────────────────────────────── */}
      {detailStation && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
          onClick={() => setDetailStation(null)}>
          <div className="rounded-t-3xl sm:rounded-2xl w-full sm:max-w-lg mx-0 sm:mx-4 shadow-2xl overflow-hidden"
            style={{ backgroundColor: 'var(--surface, white)' }}
            onClick={e => e.stopPropagation()}>

            {/* header */}
            <div className="flex items-center justify-between px-7 pt-7 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: '#0B743918', color: '#0B7439' }}>
                  <Fuel className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>{detailStation.name}</h3>
                  <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{detailStation.code}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-full text-xs font-semibold"
                  style={{ backgroundColor: detailStation.is_active ? '#F0FDF4' : '#F9FAFB', color: detailStation.is_active ? '#16A34A' : '#6B7280' }}>
                  {detailStation.is_active ? 'Active' : 'Inactive'}
                </span>
                <button onClick={() => setDetailStation(null)} className="p-2 rounded-lg hover:bg-gray-100">
                  <X className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
                </button>
              </div>
            </div>

            <div className="px-7 py-6 space-y-4 max-h-[65vh] overflow-y-auto">
              {/* villes associées */}
              {detailStation.cities && detailStation.cities.length > 0 && (
                <div className="p-4 rounded-xl border" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex items-center gap-1.5 mb-3">
                    <MapPin className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                    <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Ville(s) associée(s)</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {detailStation.cities.map(c => (
                      <span key={c.id} className="px-3 py-1 rounded-full text-sm font-medium"
                        style={{ backgroundColor: '#3B82F618', color: '#3B82F6' }}>
                        {c.name}
                        <span className="text-xs ml-1 opacity-70">({c.region})</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* fuel types + prices */}
              <div className="p-4 rounded-xl border" style={{ borderColor: 'var(--border)' }}>
                <p className="text-xs font-semibold mb-3" style={{ color: 'var(--text-muted)' }}>Carburants & Prix</p>
                <div className="space-y-3">
                  {detailStation.fuel_types.map(ft => (
                    <div key={ft} className="flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: FUEL_COLORS[ft] }} />
                        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{FUEL_LABELS[ft] || ft}</span>
                      </span>
                      <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                        {ft === 'essence' ? fmt(detailStation.price_essence) : fmt(detailStation.price_gasoil)}
                        <span className="text-xs font-normal ml-1" style={{ color: 'var(--text-muted)' }}>/ L</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* contact */}
              {detailStation.phone && (
                <div className="flex items-center gap-3 p-3 rounded-xl border" style={{ borderColor: 'var(--border)' }}>
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                    style={{ backgroundColor: '#0B743918', color: '#0B7439' }}>
                    <Phone className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Téléphone</p>
                    <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{detailStation.phone}</p>
                  </div>
                </div>
              )}

              {/* observations */}
              {detailStation.observations && (
                <div className="p-3 rounded-xl border text-sm" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Info className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                    <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Observations</p>
                  </div>
                  <p style={{ color: 'var(--text-primary)' }}>{detailStation.observations}</p>
                </div>
              )}
            </div>

            <div className="flex gap-3 px-7 pb-7 pt-2">
              <button onClick={() => openEdit(detailStation)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border font-semibold text-sm"
                style={{ borderColor: '#0B7439', color: '#0B7439' }}>
                <Pencil className="w-4 h-4" /> Modifier
              </button>
              <button onClick={() => toggleActive(detailStation)}
                className="flex-1 px-4 py-2.5 rounded-xl font-semibold text-sm text-white"
                style={{ backgroundColor: detailStation.is_active ? '#EF4444' : '#16A34A' }}>
                {detailStation.is_active ? 'Désactiver' : 'Activer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── FORM MODAL ────────────────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={() => setShowForm(false)}>
          <div className="rounded-2xl w-full max-w-xl mx-4 shadow-2xl overflow-hidden"
            style={{ backgroundColor: 'var(--surface, white)' }}
            onClick={e => e.stopPropagation()}>

            <div className="flex items-center justify-between px-8 pt-8 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                {editingId ? 'Modifier la station' : 'Nouvelle station'}
              </h3>
              <button onClick={() => setShowForm(false)} className="p-2 rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
              </button>
            </div>

            <div className="px-8 py-6 max-h-[70vh] overflow-y-auto space-y-5">

              {/* nom + code */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                    Nom de la station <span className="text-red-500">*</span>
                  </label>
                  <input type="text" value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                    placeholder="Station Total Abidjan"
                    className="w-full px-3 py-2.5 border rounded-xl text-sm outline-none"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                    Code station <span className="text-red-500">*</span>
                  </label>
                  <input type="text" value={formData.code} onChange={e => setFormData(p => ({ ...p, code: e.target.value }))}
                    placeholder="STF-001"
                    className="w-full px-3 py-2.5 border rounded-xl text-sm outline-none font-mono"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
                </div>
              </div>

              {/* villes associées — autocomplete */}
              <div className="relative" ref={cityDropdownRef}>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Ville(s) associée(s)
                </label>

                {/* selected city chips */}
                {selectedCities.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {selectedCities.map(c => (
                      <span key={c.id} className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full text-sm font-medium"
                        style={{ backgroundColor: '#3B82F618', color: '#3B82F6' }}>
                        {c.name}
                        <button type="button" onClick={() => removeCity(c.id)}
                          className="w-5 h-5 rounded-full flex items-center justify-center hover:bg-blue-200 transition-colors">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* search input */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                  <input type="text" value={citySearch}
                    onChange={e => { setCitySearch(e.target.value); setShowCityDropdown(true); }}
                    onFocus={() => setShowCityDropdown(true)}
                    placeholder="Rechercher une ville…"
                    className="w-full pl-9 pr-9 py-2.5 border rounded-xl text-sm outline-none"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                </div>

                {/* dropdown */}
                {showCityDropdown && (
                  <div className="absolute z-10 mt-1 w-full rounded-xl border shadow-lg max-h-56 overflow-y-auto"
                    style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
                    {filteredCityOptions.length === 0 ? (
                      <div className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                        {allCities.length === 0 ? 'Aucune ville disponible. Ajoutez des villes dans Admin > Villes.'
                          : 'Aucune ville trouvée'}
                      </div>
                    ) : (
                      filteredCityOptions.map(c => (
                        <button key={c.id} type="button" onClick={() => addCity(c)}
                          className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-sm hover:bg-gray-50 transition-colors border-b last:border-0"
                          style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                          <MapPin className="w-4 h-4 flex-shrink-0" style={{ color: '#3B82F6' }} />
                          <div>
                            <span className="font-medium">{c.name}</span>
                            <span className="text-xs ml-1.5" style={{ color: 'var(--text-muted)' }}>{c.region}</span>
                          </div>
                          <Plus className="w-3.5 h-3.5 ml-auto" style={{ color: 'var(--text-muted)' }} />
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* types carburant */}
              <div>
                <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
                  Type(s) de carburant <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-3">
                  {ALL_FUEL_TYPES.map(ft => {
                    const selected = formData.fuel_types.includes(ft);
                    return (
                      <button key={ft} type="button" onClick={() => toggleFuelType(ft)}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-all"
                        style={{
                          borderColor: selected ? FUEL_COLORS[ft] : 'var(--border)',
                          backgroundColor: selected ? `${FUEL_COLORS[ft]}15` : 'transparent',
                          color: selected ? FUEL_COLORS[ft] : 'var(--text-secondary)',
                        }}>
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: selected ? FUEL_COLORS[ft] : '#D1D5DB' }} />
                        {FUEL_LABELS[ft]}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* prix */}
              <div className="grid grid-cols-2 gap-4">
                {formData.fuel_types.includes('essence') && (
                  <div>
                    <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                      Prix essence (FCFA/L)
                    </label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                      <input type="number" min={0} step="1" value={formData.price_essence}
                        onChange={e => setFormData(p => ({ ...p, price_essence: e.target.value }))}
                        placeholder="600"
                        className="w-full pl-9 pr-3 py-2.5 border rounded-xl text-sm outline-none"
                        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
                    </div>
                  </div>
                )}
                {formData.fuel_types.includes('gasoil') && (
                  <div>
                    <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                      Prix gasoil (FCFA/L)
                    </label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                      <input type="number" min={0} step="1" value={formData.price_gasoil}
                        onChange={e => setFormData(p => ({ ...p, price_gasoil: e.target.value }))}
                        placeholder="580"
                        className="w-full pl-9 pr-3 py-2.5 border rounded-xl text-sm outline-none"
                        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
                    </div>
                  </div>
                )}
              </div>

              {/* telephone + statut */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Téléphone</label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                    <input type="text" value={formData.phone} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))}
                      placeholder="+225 07 00 00 00 00"
                      className="w-full pl-9 pr-3 py-2.5 border rounded-xl text-sm outline-none"
                      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Statut</label>
                  <div className="flex gap-3 mt-1">
                    {[{ value: true, label: 'Active' }, { value: false, label: 'Inactive' }].map(opt => (
                      <label key={String(opt.value)} className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" checked={formData.is_active === opt.value}
                          onChange={() => setFormData(p => ({ ...p, is_active: opt.value }))}
                          className="w-4 h-4" />
                        <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{opt.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* observations */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Observations</label>
                <textarea value={formData.observations} onChange={e => setFormData(p => ({ ...p, observations: e.target.value }))}
                  rows={3} placeholder="Remarques, notes particulières…"
                  className="w-full px-3 py-2.5 border rounded-xl text-sm resize-none outline-none"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
              </div>
            </div>

            <div className="flex gap-3 px-8 pb-8">
              <button onClick={() => setShowForm(false)}
                className="flex-1 px-4 py-2.5 rounded-xl border font-semibold text-sm"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                Annuler
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 px-4 py-2.5 rounded-xl text-white font-semibold text-sm disabled:opacity-50 transition-opacity hover:opacity-90"
                style={{ backgroundColor: '#0B7439' }}>
                {saving ? 'Enregistrement…' : editingId ? 'Enregistrer' : 'Créer la station'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
