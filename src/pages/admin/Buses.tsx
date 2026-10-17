import React, { useState, useEffect } from 'react';
import { Bus, Plus, CreditCard as Edit2, Eye, Search, Calendar, AlertTriangle, LayoutGrid, RefreshCw, MousePointerClick, Wrench, PowerOff, Power, X, Copy } from 'lucide-react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import StatusBadge from '../../components/shared/StatusBadge';
import AdminSeatManagement from '../../components/bus/AdminSeatManagement';
import FillRateBar from '../../components/bus/FillRateBar';
import BusWizard from '../../components/bus/BusWizard';
import { generateSeatLayout } from '../../utils/generateSeatLayout';

interface SeatConfigDetail {
  id: string;
  name: string;
  total_capacity: number;
  seat_layout: any;
  grid_layout: any;
  rows: number;
  left_columns: number;
  right_columns: number;
  back_row: boolean;
  has_back_row: boolean;
  back_row_seats: number;
  aisle_after_columns: number[] | null;
  total_columns: number | null;
  driver_position: string | null;
  deck_level: string | null;
}

interface BusData {
  id: string;
  registration_number: string;
  brand: string;
  model: string;
  year: number;
  class: 'standard' | 'vip' | 'executive';
  company_id: string;
  seat_config_id: string;
  capacity: number;
  status: 'disponible' | 'en_service' | 'panne_route' | 'reception_garage' | 'diagnostic' | 'attente_ot' | 'maintenance' | 'controle_qualite' | 'hors_service';
  fuel_type: string;
  fuel_capacity: number;
  fuel_consumption: number;
  insurance_expiry: string;
  vignette_expiry: string;
  technical_inspection_expiry: string;
  photo_url?: string;
  amenities: string[];
  fill_rate_current: number;
  status_note?: string | null;
  bus_deck_type?: string;
  driver_position?: string;
  sleeping_type?: string;
  max_allowed_capacity?: number;
  seats_sold_from?: number;
  lower_deck_config_id?: string;
  upper_deck_config_id?: string;
  companies?: { name: string };
  bus_seat_config?: SeatConfigDetail;
}

interface Company {
  id: string;
  name: string;
  code?: string;
  parent_id?: string | null;
  is_group?: boolean;
}

interface SeatConfig {
  id: string;
  name: string;
  total_capacity: number;
}

interface Amenity {
  id: string;
  name: string;
  icon: string;
}

const emptyGeneralData = () => ({
  registration_number: '',
  brand: '',
  model: '',
  year: new Date().getFullYear(),
  class: 'standard' as 'standard' | 'vip' | 'executive',
  company_id: '',
  fuel_type: 'diesel',
  fuel_capacity: 200,
  fuel_consumption: 25,
  insurance_expiry: '',
  vignette_expiry: '',
  technical_inspection_expiry: '',
  photo_url: '',
  amenities: [] as string[],
});

export default function Buses() {
  const [buses, setBuses] = useState<BusData[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [seatConfigs, setSeatConfigs] = useState<SeatConfig[]>([]);
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWizard, setShowWizard] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [wizardInitialData, setWizardInitialData] = useState(emptyGeneralData());
  const [existingBusConfig, setExistingBusConfig] = useState<any>(undefined);
  const [viewingBus, setViewingBus] = useState<BusData | null>(null);
  const [repairingId, setRepairingId] = useState<string | null>(null);
  const [seatMgmtBus, setSeatMgmtBus] = useState<BusData | null>(null);
  const [statusModalBus, setStatusModalBus] = useState<BusData | null>(null);
  const [statusModalMode, setStatusModalMode] = useState<'maintenance' | 'deactivate' | 'reactivate'>('maintenance');
  const [statusNote, setStatusNote] = useState('');
  const [statusSaving, setStatusSaving] = useState(false);

  const [filters, setFilters] = useState({
    company: '',
    class: '',
    status: '',
    capacity: '',
    search: ''
  });

  const uniqueCapacities = Array.from(new Set(buses.map(b => b.capacity).filter(c => c != null && c > 0))).sort((a, b) => a - b);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [busesRes, companiesRes, seatConfigsRes, amenitiesRes] = await Promise.all([
        supabase
          .from('buses')
          .select('*, companies(name), bus_seat_config!buses_seat_config_id_fkey(id, name, total_capacity, seat_layout, grid_layout, rows, left_columns, right_columns, back_row, has_back_row, back_row_seats, aisle_after_columns, total_columns, driver_position, deck_level)')
          .order('registration_number'),
        supabase.from('companies').select('id, name, code, parent_id, is_group').order('name'),
        supabase.from('bus_seat_config').select('id, name, total_capacity').order('name'),
        supabase.from('amenities').select('id, name, icon').order('name')
      ]);

      if (busesRes.error) throw busesRes.error;
      if (companiesRes.error) throw companiesRes.error;
      if (seatConfigsRes.error) throw seatConfigsRes.error;
      if (amenitiesRes.error) throw amenitiesRes.error;

      setBuses(busesRes.data || []);
      setCompanies(companiesRes.data || []);
      setSeatConfigs(seatConfigsRes.data || []);
      setAmenities(amenitiesRes.data || []);
    } catch (error: any) {
      toast.error('Erreur de chargement');
    } finally {
      setLoading(false);
    }
  };

  const handleNew = () => {
    setEditingId(null);
    setWizardInitialData(emptyGeneralData());
    setExistingBusConfig(undefined);
    setShowWizard(true);
  };

  const handleDuplicate = async (bus: BusData) => {
    setEditingId(null);
    setWizardInitialData({
      registration_number: '',
      brand: bus.brand,
      model: bus.model,
      year: bus.year,
      class: bus.class,
      company_id: bus.company_id,
      fuel_type: bus.fuel_type,
      fuel_capacity: bus.fuel_capacity,
      fuel_consumption: bus.fuel_consumption,
      insurance_expiry: bus.insurance_expiry || '',
      vignette_expiry: bus.vignette_expiry || '',
      technical_inspection_expiry: bus.technical_inspection_expiry || '',
      photo_url: bus.photo_url || '',
      amenities: bus.amenities || [],
    });

    const deckType = (bus.bus_deck_type === 'imperial' ? 'imperial' : 'simple') as 'simple' | 'imperial';
    const driverPos = (bus.driver_position === 'droite' ? 'droite' : 'gauche') as 'gauche' | 'droite';
    const sleepingType = (bus.sleeping_type === 'couchettes' ? 'couchettes' : bus.sleeping_type === 'mixte' ? 'mixte' : 'aucun') as 'aucun' | 'couchettes' | 'mixte';

    if (deckType === 'simple' && bus.bus_seat_config) {
      const cfg = bus.bus_seat_config;
      const aisleAfterColumns: number[] = Array.isArray(cfg.aisle_after_columns) ? cfg.aisle_after_columns : (cfg.aisle_position ? [cfg.aisle_position] : [2]);
      const totalCols = cfg.total_columns ?? (cfg.left_columns + cfg.right_columns + aisleAfterColumns.length);
      const hasBackRow = cfg.has_back_row ?? cfg.back_row ?? false;
      setExistingBusConfig({
        deckType: 'simple',
        driverPosition: driverPos,
        sleepingType,
        maxCapacity: bus.max_allowed_capacity ?? bus.capacity,
        seatsSoldFrom: bus.seats_sold_from ?? 1,
        aisleAfterColumns,
        hasBackRow,
        backRowSeats: cfg.back_row_seats ?? 0,
        totalRows: cfg.rows ?? 10,
        totalCols,
        seatConfigId: undefined,
        simpleLayout: cfg.grid_layout ?? null,
      });
    } else if (deckType === 'imperial' && bus.lower_deck_config_id && bus.upper_deck_config_id) {
      try {
        const [lowerRes, upperRes] = await Promise.all([
          supabase.from('bus_seat_config').select('id, rows, left_columns, right_columns, back_row, has_back_row, back_row_seats, aisle_after_columns, total_columns, driver_position, grid_layout').eq('id', bus.lower_deck_config_id).maybeSingle(),
          supabase.from('bus_seat_config').select('id, rows, left_columns, right_columns, back_row, has_back_row, back_row_seats, aisle_after_columns, total_columns, driver_position, grid_layout').eq('id', bus.upper_deck_config_id).maybeSingle(),
        ]);
        const lower = lowerRes.data;
        const upper = upperRes.data;
        const aisleAfterColumns: number[] = lower && Array.isArray(lower.aisle_after_columns) ? lower.aisle_after_columns : [2];
        const totalCols = lower?.total_columns ?? ((lower?.left_columns ?? 2) + (lower?.right_columns ?? 2) + aisleAfterColumns.length);
        const hasBackRow = lower?.has_back_row ?? lower?.back_row ?? false;
        setExistingBusConfig({
          deckType: 'imperial',
          driverPosition: driverPos,
          sleepingType,
          maxCapacity: bus.max_allowed_capacity ?? bus.capacity,
          seatsSoldFrom: bus.seats_sold_from ?? 1,
          aisleAfterColumns,
          hasBackRow,
          backRowSeats: lower?.back_row_seats ?? 0,
          totalRows: lower?.rows ?? 10,
          totalCols,
          lowerConfigId: undefined,
          upperConfigId: undefined,
          lowerLayout: lower?.grid_layout ?? null,
          upperLayout: upper?.grid_layout ?? null,
        });
      } catch {
        setExistingBusConfig(undefined);
      }
    } else {
      setExistingBusConfig(undefined);
    }

    setShowWizard(true);
  };

  const handleEdit = async (bus: BusData) => {
    setEditingId(bus.id);
    setWizardInitialData({
      registration_number: bus.registration_number,
      brand: bus.brand,
      model: bus.model,
      year: bus.year,
      class: bus.class,
      company_id: bus.company_id,
      fuel_type: bus.fuel_type,
      fuel_capacity: bus.fuel_capacity,
      fuel_consumption: bus.fuel_consumption,
      insurance_expiry: bus.insurance_expiry || '',
      vignette_expiry: bus.vignette_expiry || '',
      technical_inspection_expiry: bus.technical_inspection_expiry || '',
      photo_url: bus.photo_url || '',
      amenities: bus.amenities || [],
    });

    const deckType = (bus.bus_deck_type === 'imperial' ? 'imperial' : 'simple') as 'simple' | 'imperial';
    const driverPos = (bus.driver_position === 'droite' ? 'droite' : 'gauche') as 'gauche' | 'droite';
    const sleepingType = (bus.sleeping_type === 'couchettes' ? 'couchettes' : bus.sleeping_type === 'mixte' ? 'mixte' : 'aucun') as 'aucun' | 'couchettes' | 'mixte';

    if (deckType === 'simple' && bus.bus_seat_config) {
      const cfg = bus.bus_seat_config;
      const aisleAfterColumns: number[] = Array.isArray(cfg.aisle_after_columns) ? cfg.aisle_after_columns : (cfg.aisle_position ? [cfg.aisle_position] : [2]);
      const totalCols = cfg.total_columns ?? (cfg.left_columns + cfg.right_columns + aisleAfterColumns.length);
      const hasBackRow = cfg.has_back_row ?? cfg.back_row ?? false;
      setExistingBusConfig({
        deckType: 'simple',
        driverPosition: driverPos,
        sleepingType,
        maxCapacity: bus.max_allowed_capacity ?? bus.capacity,
        seatsSoldFrom: bus.seats_sold_from ?? 1,
        aisleAfterColumns,
        hasBackRow,
        backRowSeats: cfg.back_row_seats ?? 0,
        totalRows: cfg.rows ?? 10,
        totalCols,
        seatConfigId: cfg.id,
        simpleLayout: cfg.grid_layout ?? null,
      });
    } else if (deckType === 'imperial' && bus.lower_deck_config_id && bus.upper_deck_config_id) {
      try {
        const [lowerRes, upperRes] = await Promise.all([
          supabase.from('bus_seat_config').select('id, rows, left_columns, right_columns, back_row, has_back_row, back_row_seats, aisle_after_columns, total_columns, driver_position, grid_layout').eq('id', bus.lower_deck_config_id).maybeSingle(),
          supabase.from('bus_seat_config').select('id, rows, left_columns, right_columns, back_row, has_back_row, back_row_seats, aisle_after_columns, total_columns, driver_position, grid_layout').eq('id', bus.upper_deck_config_id).maybeSingle(),
        ]);
        const lower = lowerRes.data;
        const upper = upperRes.data;
        const aisleAfterColumns: number[] = lower && Array.isArray(lower.aisle_after_columns) ? lower.aisle_after_columns : [2];
        const totalCols = lower?.total_columns ?? ((lower?.left_columns ?? 2) + (lower?.right_columns ?? 2) + aisleAfterColumns.length);
        const hasBackRow = lower?.has_back_row ?? lower?.back_row ?? false;
        setExistingBusConfig({
          deckType: 'imperial',
          driverPosition: driverPos,
          sleepingType,
          maxCapacity: bus.max_allowed_capacity ?? bus.capacity,
          seatsSoldFrom: bus.seats_sold_from ?? 1,
          aisleAfterColumns,
          hasBackRow,
          backRowSeats: lower?.back_row_seats ?? 0,
          totalRows: lower?.rows ?? 10,
          totalCols,
          lowerConfigId: bus.lower_deck_config_id,
          upperConfigId: bus.upper_deck_config_id,
          lowerLayout: lower?.grid_layout ?? null,
          upperLayout: upper?.grid_layout ?? null,
        });
      } catch {
        setExistingBusConfig(undefined);
      }
    } else {
      setExistingBusConfig(undefined);
    }

    setShowWizard(true);
  };

  const hasSeatPlan = (bus: BusData): boolean => {
    const cfg = bus.bus_seat_config;
    if (!cfg) return false;
    if (Array.isArray(cfg.seat_layout) && cfg.seat_layout.length > 0) return true;
    return false;
  };

  const repairSeatPlan = async (bus: BusData) => {
    if (!bus.bus_seat_config) {
      toast.error('Aucune configuration de siège trouvée pour ce bus');
      return;
    }
    setRepairingId(bus.id);
    try {
      const cfg = bus.bus_seat_config;
      const rows = cfg.rows || 10;
      const leftCols = cfg.left_columns || 2;
      const rightCols = cfg.right_columns || 2;
      const hasBack = cfg.back_row || false;
      const backSeats = cfg.back_row_seats || 0;

      const layout = generateSeatLayout(rows, leftCols, rightCols, hasBack, backSeats);
      const totalSeats = layout.flatMap(r => r.seats).length;

      const { error } = await supabase
        .from('bus_seat_config')
        .update({
          seat_layout: layout,
          total_seats: totalSeats,
          total_capacity: totalSeats,
          left_columns: leftCols,
          right_columns: rightCols,
          aisle_position: leftCols,
          generated_at: new Date().toISOString(),
        })
        .eq('id', cfg.id);

      if (error) throw error;

      await supabase
        .from('buses')
        .update({ capacity: totalSeats, total_seats: totalSeats })
        .eq('id', bus.id);

      toast.success(`Plan de sièges généré : ${totalSeats} places (${rows} rangées × ${leftCols + rightCols} colonnes)`);
      loadData();
    } catch (err: any) {
      toast.error(`Erreur : ${err.message}`);
    } finally {
      setRepairingId(null);
    }
  };

  const getExpiryAlert = (expiryDate: string) => {
    if (!expiryDate) return null;
    const daysUntilExpiry = Math.ceil((new Date(expiryDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntilExpiry < 0) return { color: 'var(--danger)', text: 'Expiré' };
    if (daysUntilExpiry <= 30) return { color: 'var(--warning)', text: `${daysUntilExpiry}j restants` };
    return null;
  };

  const filteredBuses = buses.filter(bus => {
    if (filters.company && bus.company_id !== filters.company) return false;
    if (filters.class && bus.class !== filters.class) return false;
    if (filters.status && bus.status !== filters.status) return false;
    if (filters.capacity && String(bus.capacity) !== filters.capacity) return false;
    if (filters.search) {
      const search = filters.search.toLowerCase();
      return (
        bus.registration_number.toLowerCase().includes(search) ||
        bus.brand.toLowerCase().includes(search) ||
        bus.model.toLowerCase().includes(search)
      );
    }
    return true;
  });

  const openStatusModal = (bus: BusData, mode: 'maintenance' | 'deactivate' | 'reactivate') => {
    setStatusModalBus(bus);
    setStatusModalMode(mode);
    setStatusNote(bus.status_note ?? '');
  };

  const handleStatusChange = async () => {
    if (!statusModalBus) return;
    if ((statusModalMode === 'maintenance' || statusModalMode === 'deactivate') && !statusNote.trim()) {
      toast.error(statusModalMode === 'maintenance' ? 'Veuillez décrire la maintenance' : 'Veuillez indiquer le motif de désactivation');
      return;
    }
    setStatusSaving(true);
    try {
      const newStatus = statusModalMode === 'maintenance' ? 'maintenance' : statusModalMode === 'deactivate' ? 'hors_service' : 'disponible';
      const { error } = await supabase
        .from('buses')
        .update({
          status: newStatus,
          status_note: statusModalMode === 'reactivate' ? null : statusNote.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', statusModalBus.id);
      if (error) throw error;
      toast.success(
        statusModalMode === 'maintenance' ? 'Bus mis en maintenance' :
        statusModalMode === 'deactivate' ? 'Bus désactivé' :
        'Bus réactivé'
      );
      setStatusModalBus(null);
      setStatusNote('');
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors du changement de statut');
    } finally {
      setStatusSaving(false);
    }
  };

  const getClassBadgeColor = (className: string) => {
    switch (className) {
      case 'standard': return 'var(--neutral-600)';
      case 'vip': return 'var(--warning)';
      case 'executive': return 'var(--primary)';
      default: return 'var(--neutral-600)';
    }
  };

  if (loading) {
    return <div className="p-8">Chargement...</div>;
  }

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            Gestion des bus
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            {buses.length} bus au total
          </p>
        </div>
        <button
          onClick={handleNew}
          className="px-6 py-3 rounded-lg flex items-center gap-2 text-white font-medium"
          style={{ backgroundColor: 'var(--primary)' }}
        >
          <Plus className="w-5 h-5" />
          Nouveau bus
        </button>
      </div>

      <div className="bg-white rounded-xl p-6 mb-6 border">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <div className="relative">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-secondary)' }} />
            <input
              type="text"
              placeholder="Rechercher..."
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              className="w-full pl-10 pr-4 py-2 border rounded-lg"
            />
          </div>

          <select
            value={filters.company}
            onChange={(e) => setFilters({ ...filters, company: e.target.value })}
            className="px-4 py-2 border rounded-lg"
          >
            <option value="">Toutes les sociétés</option>
            {companies.map(company => (
              <option key={company.id} value={company.id}>{company.name}</option>
            ))}
          </select>

          <select
            value={filters.class}
            onChange={(e) => setFilters({ ...filters, class: e.target.value })}
            className="px-4 py-2 border rounded-lg"
          >
            <option value="">Toutes les classes</option>
            <option value="standard">Standard</option>
            <option value="vip">VIP</option>
            <option value="executive">Executive</option>
          </select>

          <select
            value={filters.capacity}
            onChange={(e) => setFilters({ ...filters, capacity: e.target.value })}
            className="px-4 py-2 border rounded-lg"
          >
            <option value="">Toutes les capacités</option>
            {uniqueCapacities.map(cap => (
              <option key={cap} value={String(cap)}>{cap} places</option>
            ))}
          </select>

          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            className="px-4 py-2 border rounded-lg"
          >
            <option value="">Tous les statuts</option>
            <option value="disponible">Disponible</option>
            <option value="en_service">En service</option>
            <option value="maintenance">Maintenance</option>
            <option value="hors_service">Hors service</option>
            <option value="panne_route">Panne route</option>
            <option value="diagnostic">Diagnostic</option>
            <option value="attente_ot">Attente OT</option>
            <option value="controle_qualite">Contrôle qualité</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <table className="w-full">
          <thead style={{ backgroundColor: 'var(--neutral-100)' }}>
            <tr>
              <th className="text-left p-4 font-semibold">Immatriculation</th>
              <th className="text-left p-4 font-semibold">Marque/Modèle</th>
              <th className="text-left p-4 font-semibold">Année</th>
              <th className="text-left p-4 font-semibold">Classe</th>
              <th className="text-left p-4 font-semibold">Société</th>
              <th className="text-left p-4 font-semibold">Capacité</th>
              <th className="text-left p-4 font-semibold">Plan de sièges</th>
              <th className="text-left p-4 font-semibold">Statut</th>
              <th className="text-left p-4 font-semibold">Taux remplissage</th>
              <th className="text-left p-4 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredBuses.map((bus) => (
              <tr key={bus.id} className="border-t hover:bg-gray-50">
                <td className="p-4">
                  <span className="font-bold">{bus.registration_number}</span>
                </td>
                <td className="p-4">{bus.brand} {bus.model}</td>
                <td className="p-4">{bus.year}</td>
                <td className="p-4">
                  <span
                    className="px-3 py-1 rounded-full text-xs font-medium text-white"
                    style={{ backgroundColor: getClassBadgeColor(bus.class) }}
                  >
                    {bus.class.toUpperCase()}
                  </span>
                </td>
                <td className="p-4">{bus.companies?.name}</td>
                <td className="p-4">{bus.capacity} pl</td>
                <td className="p-4">
                  {hasSeatPlan(bus) ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                          style={{ backgroundColor: '#DCFCE7', color: '#16A34A' }}>
                      <LayoutGrid className="w-3.5 h-3.5" />
                      Configuré
                    </span>
                  ) : (
                    <button
                      onClick={() => repairSeatPlan(bus)}
                      disabled={repairingId === bus.id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors hover:opacity-80 disabled:opacity-50"
                      style={{ backgroundColor: '#FEF3C7', color: '#D97706' }}
                      title="Générer le plan de sièges"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${repairingId === bus.id ? 'animate-spin' : ''}`} />
                      {repairingId === bus.id ? 'Génération...' : 'Générer plan'}
                    </button>
                  )}
                </td>
                <td className="p-4">
                  <StatusBadge status={bus.status} />
                  {bus.status_note && (
                    <p className="text-xs mt-1 max-w-[200px] truncate" style={{ color: 'var(--text-secondary)' }} title={bus.status_note}>
                      {bus.status_note}
                    </p>
                  )}
                </td>
                <td className="p-4">
                  <button
                    onClick={() => setSeatMgmtBus(bus)}
                    className="block hover:opacity-80 transition-opacity cursor-pointer"
                    title="Cliquer pour gérer les sièges"
                    style={{ minWidth: '200px' }}
                  >
                    <FillRateBar
                      current={Math.round((bus.fill_rate_current / 100) * bus.capacity)}
                      total={bus.capacity}
                      showLabel={false}
                      size="sm"
                    />
                  </button>
                </td>
                <td className="p-4">
                  <div className="flex gap-2">
                    <button
                      onClick={() => setViewingBus(bus)}
                      className="p-2 hover:bg-gray-100 rounded-lg"
                      title="Voir fiche"
                    >
                      <Eye className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                    </button>
                    <button
                      onClick={() => handleEdit(bus)}
                      className="p-2 hover:bg-gray-100 rounded-lg"
                      title="Modifier"
                    >
                      <Edit2 className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                    </button>
                    <button
                      onClick={() => handleDuplicate(bus)}
                      className="p-2 hover:bg-gray-100 rounded-lg"
                      title="Dupliquer"
                    >
                      <Copy className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                    </button>
                    {bus.status === 'disponible' || bus.status === 'en_service' ? (
                      <button
                        onClick={() => openStatusModal(bus, 'maintenance')}
                        className="p-2 hover:bg-amber-50 rounded-lg"
                        title="Mettre en maintenance"
                      >
                        <Wrench className="w-4 h-4" style={{ color: '#D97706' }} />
                      </button>
                    ) : null}
                    {bus.status !== 'hors_service' ? (
                      <button
                        onClick={() => openStatusModal(bus, 'deactivate')}
                        className="p-2 hover:bg-red-50 rounded-lg"
                        title="Désactiver le bus"
                      >
                        <PowerOff className="w-4 h-4" style={{ color: '#AF3029' }} />
                      </button>
                    ) : null}
                    {bus.status === 'maintenance' || bus.status === 'hors_service' ? (
                      <button
                        onClick={() => openStatusModal(bus, 'reactivate')}
                        className="p-2 hover:bg-green-50 rounded-lg"
                        title="Réactiver le bus"
                      >
                        <Power className="w-4 h-4" style={{ color: '#0B7439' }} />
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredBuses.length === 0 && (
          <div className="text-center py-12">
            <Bus className="w-16 h-16 mx-auto mb-4" style={{ color: 'var(--neutral-400)' }} />
            <p style={{ color: 'var(--text-secondary)' }}>Aucun bus trouvé</p>
          </div>
        )}
      </div>

      {showWizard && (
        <BusWizard
          editingId={editingId}
          initialGeneralData={wizardInitialData}
          companies={companies}
          seatConfigs={seatConfigs}
          amenities={amenities}
          existingConfig={existingBusConfig}
          onClose={() => { setShowWizard(false); setEditingId(null); setExistingBusConfig(undefined); }}
          onSaved={loadData}
        />
      )}

      {viewingBus && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl w-full max-w-4xl my-8">
            <div className="p-6 border-b flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold mb-1">{viewingBus.registration_number}</h2>
                <p style={{ color: 'var(--text-secondary)' }}>
                  {viewingBus.brand} {viewingBus.model} ({viewingBus.year})
                </p>
              </div>
              <button onClick={() => setViewingBus(null)}>
                <Bus className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6">
              <div className="grid grid-cols-2 gap-6 mb-6">
                <div>
                  <h3 className="font-semibold mb-2">Informations générales</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span style={{ color: 'var(--text-secondary)' }}>Société:</span>
                      <span className="font-medium">{viewingBus.companies?.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: 'var(--text-secondary)' }}>Classe:</span>
                      <span className="font-medium">{viewingBus.class}</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: 'var(--text-secondary)' }}>Capacité:</span>
                      <span className="font-medium">{viewingBus.capacity} places</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: 'var(--text-secondary)' }}>Configuration:</span>
                      <span className="font-medium">{viewingBus.bus_seat_config?.name || '—'}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span style={{ color: 'var(--text-secondary)' }}>Plan de sièges:</span>
                      {hasSeatPlan(viewingBus) ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
                              style={{ backgroundColor: '#DCFCE7', color: '#16A34A' }}>
                          <LayoutGrid className="w-3 h-3" />
                          Généré ({viewingBus.bus_seat_config?.total_capacity} places)
                        </span>
                      ) : (
                        <button
                          onClick={() => repairSeatPlan(viewingBus)}
                          disabled={repairingId === viewingBus.id}
                          className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full transition-colors"
                          style={{ backgroundColor: '#FEF3C7', color: '#D97706' }}
                        >
                          <RefreshCw className={`w-3 h-3 ${repairingId === viewingBus.id ? 'animate-spin' : ''}`} />
                          {repairingId === viewingBus.id ? 'En cours...' : 'Générer maintenant'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold mb-2">Statut &amp; Disponibilité</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between items-center">
                      <span style={{ color: 'var(--text-secondary)' }}>Statut:</span>
                      <StatusBadge status={viewingBus.status} />
                    </div>
                    {viewingBus.status_note && (
                      <div className="mt-2 p-3 rounded-lg" style={{ backgroundColor: viewingBus.status === 'maintenance' ? '#FEF3C7' : '#FEE2E2' }}>
                        <p className="text-xs font-medium mb-0.5" style={{ color: viewingBus.status === 'maintenance' ? '#92400E' : '#991B1B' }}>
                          {viewingBus.status === 'maintenance' ? 'Description de la maintenance' : 'Motif de désactivation'}
                        </p>
                        <p className="text-sm" style={{ color: viewingBus.status === 'maintenance' ? '#78350F' : '#7F1D1D' }}>
                          {viewingBus.status_note}
                        </p>
                      </div>
                    )}
                    {(viewingBus.status === 'maintenance' || viewingBus.status === 'hors_service') && (
                      <button
                        onClick={() => { setViewingBus(null); openStatusModal(viewingBus, 'reactivate'); }}
                        className="mt-2 w-full py-2 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-2"
                        style={{ backgroundColor: '#0B7439' }}
                      >
                        <Power className="w-4 h-4" />
                        Réactiver ce bus
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold mb-2">Carburant</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span style={{ color: 'var(--text-secondary)' }}>Type:</span>
                      <span className="font-medium">{viewingBus.fuel_type}</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: 'var(--text-secondary)' }}>Capacité:</span>
                      <span className="font-medium">{viewingBus.fuel_capacity}L</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: 'var(--text-secondary)' }}>Consommation:</span>
                      <span className="font-medium">{viewingBus.fuel_consumption}L/100km</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mb-6">
                <h3 className="font-semibold mb-3">Taux de remplissage actuel</h3>
                <button
                  onClick={() => { setSeatMgmtBus(viewingBus); }}
                  className="w-full text-left group p-3 -m-3 rounded-xl hover:bg-green-50 transition-colors cursor-pointer"
                  title="Cliquer pour gérer les sièges"
                >
                  <FillRateBar
                    current={Math.round((viewingBus.fill_rate_current / 100) * viewingBus.capacity)}
                    total={viewingBus.capacity}
                    size="lg"
                  />
                  <div className="flex items-center gap-1 mt-2 text-xs text-[#0B7439] opacity-0 group-hover:opacity-100 transition-opacity">
                    <MousePointerClick className="w-3.5 h-3.5" />
                    <span>Cliquer pour voir et gérer les sièges</span>
                  </div>
                </button>
              </div>

              <div className="mb-6">
                <h3 className="font-semibold mb-3">Documents</h3>
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { label: 'Assurance', value: viewingBus.insurance_expiry },
                    { label: 'Vignette', value: viewingBus.vignette_expiry },
                    { label: 'Visite technique', value: viewingBus.technical_inspection_expiry },
                  ].map(doc => (
                    <div key={doc.label} className="p-4 rounded-lg border">
                      <div className="flex items-center gap-2 mb-2">
                        <Calendar className="w-4 h-4" />
                        <span className="text-sm font-medium">{doc.label}</span>
                      </div>
                      <p className="text-sm">{doc.value || 'Non renseigné'}</p>
                      {getExpiryAlert(doc.value) && (
                        <div className="flex items-center gap-1 mt-2">
                          <AlertTriangle className="w-4 h-4" style={{ color: getExpiryAlert(doc.value)!.color }} />
                          <span className="text-xs" style={{ color: getExpiryAlert(doc.value)!.color }}>
                            {getExpiryAlert(doc.value)!.text}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={() => setViewingBus(null)}
                className="w-full py-3 rounded-lg border font-medium"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {seatMgmtBus && (
        <AdminSeatManagement
          busId={seatMgmtBus.id}
          busRegistration={seatMgmtBus.registration_number}
          onClose={() => { setSeatMgmtBus(null); loadData(); }}
        />
      )}

      {statusModalBus && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: 'var(--border)' }}>
              <h3 className="font-bold text-lg flex items-center gap-2">
                {statusModalMode === 'maintenance' && <Wrench className="w-5 h-5" style={{ color: '#D97706' }} />}
                {statusModalMode === 'deactivate' && <PowerOff className="w-5 h-5" style={{ color: '#AF3029' }} />}
                {statusModalMode === 'reactivate' && <Power className="w-5 h-5" style={{ color: '#0B7439' }} />}
                {statusModalMode === 'maintenance' && 'Mettre en maintenance'}
                {statusModalMode === 'deactivate' && 'Désactiver le bus'}
                {statusModalMode === 'reactivate' && 'Réactiver le bus'}
              </h3>
              <button onClick={() => { setStatusModalBus(null); setStatusNote(''); }} className="p-1 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg" style={{ backgroundColor: 'var(--surface-secondary)' }}>
                <Bus className="w-8 h-8" style={{ color: 'var(--primary)' }} />
                <div>
                  <p className="font-semibold">{statusModalBus.registration_number}</p>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    {statusModalBus.brand} {statusModalBus.model} — {statusModalBus.capacity} places
                  </p>
                </div>
              </div>
              {statusModalMode === 'reactivate' ? (
                <div className="p-4 rounded-lg bg-green-50 border border-green-200">
                  <p className="text-sm" style={{ color: '#065F46' }}>
                    Le bus redeviendra <strong>Disponible</strong> et sera à nouveau sélectionnable dans tous les modules.
                    {(statusModalBus.status_note || statusModalBus.status === 'maintenance') && (
                      <span className="block mt-1">{statusModalBus.status_note ? `Note précédente : « ${statusModalBus.status_note} »` : 'La note de maintenance sera effacée.'}</span>
                    )}
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    {statusModalMode === 'maintenance' ? 'Description de la maintenance' : 'Motif de désactivation'} <span style={{ color: '#AF3029' }}>*</span>
                  </label>
                  <textarea
                    value={statusNote}
                    onChange={(e) => setStatusNote(e.target.value)}
                    rows={3}
                    placeholder={statusModalMode === 'maintenance' ? 'Ex : Révision moteur, changement de pneus…' : 'Ex : Véhicule hors service définitivement…'}
                    className="w-full px-3 py-2 border rounded-lg text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    style={{ borderColor: 'var(--border)' }}
                    autoFocus
                  />
                  <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                    {statusModalMode === 'maintenance'
                      ? 'Le bus sera temporairement indisponible dans tous les modules de sélection.'
                      : 'Le bus sera désactivé et ne sera plus sélectionnable. Son historique est conservé.'}
                  </p>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 p-5 border-t" style={{ borderColor: 'var(--border)' }}>
              <button
                onClick={() => { setStatusModalBus(null); setStatusNote(''); }}
                className="px-4 py-2 text-sm font-medium rounded-lg border hover:bg-gray-50"
                style={{ borderColor: 'var(--border)' }}
              >
                Annuler
              </button>
              <button
                onClick={handleStatusChange}
                disabled={statusSaving}
                className="px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50 flex items-center gap-2"
                style={{ backgroundColor: statusModalMode === 'maintenance' ? '#D97706' : statusModalMode === 'deactivate' ? '#AF3029' : '#0B7439' }}
              >
                {statusSaving && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {statusModalMode === 'maintenance' && 'Mettre en maintenance'}
                {statusModalMode === 'deactivate' && 'Désactiver'}
                {statusModalMode === 'reactivate' && 'Réactiver'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
