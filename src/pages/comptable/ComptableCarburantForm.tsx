import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Bus, User, Fuel, MapPin, Droplets, DollarSign, Calendar, FileText, Search, AlertCircle, CheckCircle } from 'lucide-react';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../store/authStore';
import { useComptableCompanies } from '../../hooks/useComptableCompanies';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

/* ─── types ─────────────────────────────────────────────────── */

interface BusOption {
  id: string;
  registration_number: string;
  company_id: string;
}

interface DriverOption {
  id: string;
  full_name: string;
}

interface StationOption {
  id: string;
  name: string;
  code: string;
  fuel_types: string[];
  price_essence: number | null;
  price_gasoil: number | null;
}

const FUEL_LABELS: Record<string, string> = { essence: 'Essence', gasoil: 'Gasoil' };
const FUEL_COLORS: Record<string, string> = { essence: '#F59E0B', gasoil: '#3B82F6' };

/* ─── component ─────────────────────────────────────────────── */

export default function ComptableCarburantForm() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const { allowedCompanyIds } = useComptableCompanies();
  const companyIds = allowedCompanyIds ?? (user?.company_id ? [user.company_id] : []);
  const companyId = companyIds[0] ?? null;

  // data sources
  const [buses, setBuses] = useState<BusOption[]>([]);
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [stations, setStations] = useState<StationOption[]>([]);

  // search state
  const [busSearch, setBusSearch] = useState('');
  const [showBusDropdown, setShowBusDropdown] = useState(false);
  const [driverSearch, setDriverSearch] = useState('');
  const [showDriverDropdown, setShowDriverDropdown] = useState(false);

  // selected entities
  const [selectedBus, setSelectedBus] = useState<BusOption | null>(null);
  const [selectedDriver, setSelectedDriver] = useState<DriverOption | null>(null);
  const [selectedStation, setSelectedStation] = useState<StationOption | null>(null);

  // form fields
  const [fuelType, setFuelType] = useState('');
  const [city, setCity] = useState('');
  const [liters, setLiters] = useState('');
  const [withdrawalDate, setWithdrawalDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [observations, setObservations] = useState('');
  const [saving, setSaving] = useState(false);

  // load sources
  useEffect(() => {
    if (companyIds.length === 0) return;
    const loadBuses = async () => {
      const { data } = await supabase
        .from('buses')
        .select('id, registration_number, company_id')
        .in('company_id', companyIds)
        .eq('is_active', true)
        .order('registration_number');
      setBuses((data as BusOption[]) || []);
    };
    const loadDrivers = async () => {
      const { data } = await supabase
        .from('users')
        .select('id, full_name')
        .in('company_id', companyIds)
        .eq('role', 'chauffeur')
        .eq('is_active', true)
        .order('full_name');
      setDrivers((data as DriverOption[]) || []);
    };
    const loadStations = async () => {
      const { data } = await supabase
        .from('fuel_stations')
        .select('id, name, code, fuel_types, price_essence, price_gasoil')
        .eq('is_active', true)
        .order('name');
      setStations((data as StationOption[]) || []);
    };
    Promise.all([loadBuses(), loadDrivers(), loadStations()]);
  }, [companyIds]);

  /* ─── derived: unit price & total ─── */

  const unitPrice: number | null = selectedStation && fuelType
    ? (fuelType === 'essence' ? selectedStation.price_essence : selectedStation.price_gasoil)
    : null;

  const litersNum = parseFloat(liters) || 0;
  const totalAmount = unitPrice != null && litersNum > 0 ? unitPrice * litersNum : null;
  const priceUndefined = selectedStation && fuelType && unitPrice == null;

  /* ─── filtered dropdowns ─── */

  const filteredBuses = buses.filter(b =>
    !busSearch || b.registration_number.toLowerCase().includes(busSearch.toLowerCase())
  );

  const filteredDrivers = drivers.filter(d =>
    !driverSearch || d.full_name.toLowerCase().includes(driverSearch.toLowerCase())
  );

  /* ─── select handlers ─── */

  const selectBus = (bus: BusOption) => {
    setSelectedBus(bus);
    setBusSearch(bus.registration_number);
    setShowBusDropdown(false);
  };

  const selectDriver = (driver: DriverOption) => {
    setSelectedDriver(driver);
    setDriverSearch(driver.full_name);
    setShowDriverDropdown(false);
  };

  const selectStation = (station: StationOption) => {
    setSelectedStation(station);
    setFuelType('');
  };

  /* ─── validation ─── */

  const validate = () => {
    if (!selectedBus) { toast.error('Sélectionnez un bus'); return false; }
    if (!selectedStation) { toast.error('Sélectionnez une station'); return false; }
    if (!fuelType) { toast.error('Sélectionnez un type de carburant'); return false; }
    if (!liters || litersNum < 1) { toast.error('Le nombre de litres doit être supérieur à 0'); return false; }
    if (totalAmount == null) { toast.error('Le montant total ne peut pas être calculé — vérifiez le prix unitaire'); return false; }
    return true;
  };

  /* ─── save ─── */

  const handleSave = async () => {
    if (!validate()) return;
    if (companyIds.length === 0) return;

    setSaving(true);
    try {
      const payload = {
        company_id: companyId,
        bus_id: selectedBus!.id,
        registration_number: selectedBus!.registration_number,
        driver_id: selectedDriver?.id ?? null,
        driver_name: selectedDriver?.full_name ?? null,
        fuel_station_id: selectedStation!.id,
        station_name: selectedStation!.name,
        station_code: selectedStation!.code,
        city: city.trim() || null,
        fuel_type: fuelType,
        liters: litersNum,
        unit_price: unitPrice,
        total_amount: totalAmount!,
        withdrawal_date: withdrawalDate,
        observations: observations.trim() || null,
        created_by: user?.id ?? null,
      };

      const { error } = await supabase.from('comptable_fuel_withdrawals').insert(payload);
      if (error) throw error;

      toast.success('Prélèvement enregistré');
      navigate('/comptable/carburant');
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors de l\'enregistrement');
    } finally {
      setSaving(false);
    }
  };

  /* ─── render ─────────────────────────────────────────────── */

  return (
    <div className="p-8 max-w-3xl mx-auto">
      {/* header */}
      <div className="flex items-center gap-3 mb-8">
        <button onClick={() => navigate('/comptable/carburant')}
          className="p-2 rounded-xl hover:bg-gray-100 transition-colors"
          style={{ color: 'var(--text-secondary)' }}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Nouveau prélèvement carburant</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Enregistrez un prélèvement pour un bus de votre société</p>
        </div>
      </div>

      <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="px-8 py-6 space-y-6">

          {/* ── Bus section ── */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Bus className="w-4 h-4" style={{ color: 'var(--primary)' }} />
              <h3 className="font-semibold text-sm uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Véhicule</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* bus search */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Immatriculation <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    value={busSearch}
                    onChange={e => { setBusSearch(e.target.value); setShowBusDropdown(true); setSelectedBus(null); }}
                    onFocus={() => setShowBusDropdown(true)}
                    onBlur={() => setTimeout(() => setShowBusDropdown(false), 150)}
                    placeholder="Rechercher par plaque…"
                    className="w-full pl-9 pr-3 py-2.5 border rounded-xl text-sm outline-none font-mono"
                    style={{ borderColor: selectedBus ? '#16A34A' : 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
                  />
                  {showBusDropdown && filteredBuses.length > 0 && (
                    <div className="absolute top-full left-0 right-0 z-20 mt-1 rounded-xl border shadow-lg overflow-hidden"
                      style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
                      <div className="max-h-48 overflow-y-auto">
                        {filteredBuses.map(b => (
                          <button key={b.id} type="button"
                            onMouseDown={() => selectBus(b)}
                            className="w-full text-left px-4 py-2.5 hover:bg-gray-50 text-sm font-mono transition-colors"
                            style={{ color: 'var(--text-primary)' }}>
                            {b.registration_number}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {selectedBus && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <CheckCircle className="w-3.5 h-3.5 text-green-600" />
                    <span className="text-xs text-green-600">Bus sélectionné</span>
                  </div>
                )}
              </div>

              {/* driver search */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Chauffeur
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    value={driverSearch}
                    onChange={e => { setDriverSearch(e.target.value); setShowDriverDropdown(true); setSelectedDriver(null); }}
                    onFocus={() => setShowDriverDropdown(true)}
                    onBlur={() => setTimeout(() => setShowDriverDropdown(false), 150)}
                    placeholder="Rechercher un chauffeur…"
                    className="w-full pl-9 pr-3 py-2.5 border rounded-xl text-sm outline-none"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
                  />
                  {showDriverDropdown && filteredDrivers.length > 0 && (
                    <div className="absolute top-full left-0 right-0 z-20 mt-1 rounded-xl border shadow-lg overflow-hidden"
                      style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
                      <div className="max-h-48 overflow-y-auto">
                        {filteredDrivers.map(d => (
                          <button key={d.id} type="button"
                            onMouseDown={() => selectDriver(d)}
                            className="w-full text-left px-4 py-2.5 hover:bg-gray-50 text-sm transition-colors"
                            style={{ color: 'var(--text-primary)' }}>
                            {d.full_name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* divider */}
          <div className="border-t" style={{ borderColor: 'var(--border)' }} />

          {/* ── Station section ── */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <MapPin className="w-4 h-4" style={{ color: '#16A34A' }} />
              <h3 className="font-semibold text-sm uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Station & Carburant</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* station select */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Station <span className="text-red-500">*</span>
                </label>
                <select
                  value={selectedStation?.id || ''}
                  onChange={e => {
                    const s = stations.find(st => st.id === e.target.value) || null;
                    selectStation(s!);
                  }}
                  className="w-full px-3 py-2.5 border rounded-xl text-sm"
                  style={{ borderColor: selectedStation ? '#16A34A' : 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}>
                  <option value="">Sélectionner une station</option>
                  {stations.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                  ))}
                </select>
              </div>

              {/* city */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Ville</label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                  <input type="text" value={city} onChange={e => setCity(e.target.value)}
                    placeholder="Ex : Abidjan"
                    className="w-full pl-9 pr-3 py-2.5 border rounded-xl text-sm outline-none"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
                </div>
              </div>
            </div>

            {/* fuel type selection */}
            {selectedStation && (
              <div className="mt-4">
                <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
                  Type de carburant <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-3">
                  {selectedStation.fuel_types.map(ft => {
                    const selected = fuelType === ft;
                    return (
                      <button key={ft} type="button" onClick={() => setFuelType(ft)}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl border text-sm font-semibold transition-all"
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
            )}
          </div>

          {/* divider */}
          <div className="border-t" style={{ borderColor: 'var(--border)' }} />

          {/* ── Quantité & Montant ── */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Droplets className="w-4 h-4" style={{ color: '#3B82F6' }} />
              <h3 className="font-semibold text-sm uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Quantité & Montant</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* liters */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Litres prélevés <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Droplets className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                  <input type="number" min={1} step="0.5" value={liters}
                    onChange={e => setLiters(e.target.value)}
                    placeholder="0"
                    className="w-full pl-9 pr-3 py-2.5 border rounded-xl text-sm outline-none"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
                </div>
              </div>

              {/* unit price (readonly) */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Prix unitaire (FCFA/L)</label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                  <input type="text" readOnly
                    value={unitPrice != null ? `${unitPrice.toLocaleString('fr-FR')} FCFA/L` : '—'}
                    className="w-full pl-9 pr-3 py-2.5 border rounded-xl text-sm"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)', color: 'var(--text-secondary)' }} />
                </div>
              </div>

              {/* total */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Montant total <span className="text-red-500">*</span></label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                  <input type="text" readOnly
                    value={totalAmount != null
                      ? `${Math.round(totalAmount).toLocaleString('fr-FR')} FCFA`
                      : '—'}
                    className="w-full pl-9 pr-3 py-2.5 border rounded-xl text-sm font-bold"
                    style={{
                      borderColor: totalAmount != null ? '#16A34A' : 'var(--border)',
                      backgroundColor: totalAmount != null ? '#F0FDF4' : 'var(--bg-subtle)',
                      color: totalAmount != null ? '#16A34A' : 'var(--text-muted)',
                    }} />
                </div>
              </div>
            </div>

            {/* price undefined warning */}
            {priceUndefined && (
              <div className="mt-3 flex items-center gap-2 p-3 rounded-xl"
                style={{ backgroundColor: '#FEF3C7', border: '1px solid #FCD34D' }}>
                <AlertCircle className="w-4 h-4 flex-shrink-0 text-amber-600" />
                <p className="text-xs text-amber-700 font-medium">
                  Prix unitaire non défini pour ce type de carburant dans la station sélectionnée.
                </p>
              </div>
            )}
          </div>

          {/* divider */}
          <div className="border-t" style={{ borderColor: 'var(--border)' }} />

          {/* ── Date & Observations ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Date du prélèvement <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                <input type="date" value={withdrawalDate}
                  onChange={e => setWithdrawalDate(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 border rounded-xl text-sm outline-none"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Observations</label>
              <div className="relative">
                <FileText className="absolute left-3 top-3 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                <textarea value={observations} onChange={e => setObservations(e.target.value)}
                  rows={3} placeholder="Remarques particulières…"
                  className="w-full pl-9 pr-3 py-2.5 border rounded-xl text-sm resize-none outline-none"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
              </div>
            </div>
          </div>
        </div>

        {/* footer */}
        <div className="flex gap-3 px-8 py-6 border-t" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)' }}>
          <button onClick={() => navigate('/comptable/carburant')}
            className="flex-1 px-4 py-3 rounded-xl border font-semibold text-sm"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
            Annuler
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 px-4 py-3 rounded-xl text-white font-semibold text-sm disabled:opacity-50 transition-opacity hover:opacity-90"
            style={{ backgroundColor: 'var(--primary)' }}>
            {saving ? 'Enregistrement…' : 'Enregistrer le prélèvement'}
          </button>
        </div>
      </div>
    </div>
  );
}
