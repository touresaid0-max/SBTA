import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import POSLayout from '@/components/pos/POSLayout';
import AutocompleteSelect from '@/components/pos/AutocompleteSelect';
import { usePOSSession } from '@/services/pos/POSSessionContext';
import { getChauffeurs, getGares, getVehicules, type ChauffeurRef, type GareRef, type VehiculeRef } from '@/services/pos/departService';
import { supabase } from '@/services/supabase';

export default function POSRamassageDirect() {
  const navigate = useNavigate();
  const { session } = usePOSSession();
  const [vehicules, setVehicules] = useState<VehiculeRef[]>([]);
  const [chauffeurs, setChauffeurs] = useState<ChauffeurRef[]>([]);
  const [gares, setGares] = useState<GareRef[]>([]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState('');
  const [busId, setBusId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [destinationCity, setDestinationCity] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const loadReferences = useCallback(async () => {
    try {
      const [busList, driverList, stationList] = await Promise.all([getVehicules(), getChauffeurs(), getGares()]);
      setVehicules(busList);
      setChauffeurs(driverList);
      setGares(stationList);
    } catch {
      setError('Impossible de charger les véhicules, chauffeurs et villes disponibles.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadReferences(); }, [loadReferences]);

  const cityOptions = useMemo(() => Array.from(new Map(
    gares.filter(gare => gare.city).map(gare => [gare.city_id || gare.city, gare]),
  ).values()).map(gare => ({
    id: gare.city_id || gare.city,
    label: gare.city,
    sublabel: gare.name,
    keywords: `${gare.city} ${gare.name} ${gare.agency_code}`,
  })), [gares]);

  const selectedBus = vehicules.find(bus => bus.id === busId);
  const selectedDriver = chauffeurs.find(driver => driver.id === driverId);
  const selectedDestination = gares.find(gare => (gare.city_id || gare.city) === destinationCity);
  const numericAmount = Number(amount);
  const missing = [
    !date && 'Date',
    !time && 'Heure',
    !busId && 'Matricule du bus',
    !driverId && 'Chauffeur',
    !destinationCity && 'Ville de destination',
    !(numericAmount > 0) && 'Montant du ramassage',
  ].filter(Boolean) as string[];

  const handleSave = async () => {
    setError('');
    if (date < new Date().toISOString().slice(0, 10)) {
      setError('La date ne peut pas être antérieure à la date du jour.');
      return;
    }
    if (missing.length > 0) {
      setError(`Veuillez renseigner : ${missing.join(', ')}.`);
      return;
    }
    if (!session?.station_id) {
      setError('Gare de départ introuvable pour cette session.');
      return;
    }

    setSaving(true);
    try {
      const departureDatetime = `${date}T${time}:00`;
      const ramassageId = crypto.randomUUID();

      const { data: userData } = await supabase.auth.getUser();
      const { error: collectionError } = await supabase.from('ramassage_collections').insert({
        schedule_id: null,
        amount: numericAmount,
        station_id: session.station_id,
        collected_by: userData.user?.id ?? null,
        observation: 'Ramassage direct',
        local_depart_id: ramassageId,
      });
      if (collectionError) throw collectionError;

      const { error: notificationError } = await supabase.from('ramassage_notifications').insert({
        local_depart_id: ramassageId,
        schedule_id: null,
        route_id: null,
        route_name: `Ramassage direct — ${selectedDestination?.city ?? destinationCity}`,
        departure_number: null,
        bus_id: busId,
        bus_registration: selectedBus?.plate_number ?? '',
        driver_name: selectedDriver?.full_name ?? '',
        departure_datetime: departureDatetime,
        seats_total: 0,
        seats_sold: 0,
        company_id: selectedBus?.company_id ?? null,
        origin_station_id: session.station_id,
        origin_station_name: session.station_name ?? null,
        destination_station_id: session.station_id,
        destination_station_name: session.station_name ?? null,
        status: 'done',
        collected_places: 0,
        collected_amount: numericAmount,
        collected_by_name: session.full_name ?? null,
        collected_at: new Date().toISOString(),
        created_by: userData.user?.id ?? null,
        is_direct: true,
        counter_id: session.counter_id ?? null,
        counter_number: session.counter_number ?? null,
      });
      if (notificationError) throw notificationError;

      setSuccess(true);
      window.setTimeout(() => navigate('/guichet/ramassage'), 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de l’enregistrement du ramassage direct.');
    } finally {
      setSaving(false);
    }
  };

  const inputClass = 'w-full rounded-xl border-2 px-3 py-3 text-base outline-none';
  const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' };

  return (
    <POSLayout showBack stationName={session?.station_name} activeRoute="Ramassage direct">
      <div className="mx-auto max-w-2xl">
        <div className="mb-5 flex items-center justify-between rounded-xl p-3" style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
          <div>
            <p className="text-sm font-bold">Ramassage Direct</p>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>Recette saisie immédiatement pour votre gare</p>
          </div>
          <span className="rounded-lg border px-3 py-1.5 text-xs font-bold" style={{ borderColor: 'var(--primary)', backgroundColor: 'var(--surface)' }}>Direct</span>
        </div>

        {error && <div className="mb-4 flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm" style={{ backgroundColor: 'var(--danger-light)', color: 'var(--danger)' }}><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}
        {success && <div className="mb-4 flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium" style={{ backgroundColor: 'var(--success-light)', color: 'var(--success)' }}><CheckCircle className="h-4 w-4" /> Ramassage direct enregistré avec succès.</div>}

        {loading ? <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin" style={{ color: 'var(--primary)' }} /></div> : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Date *<input type="date" value={date} min={new Date().toISOString().slice(0, 10)} onChange={e => setDate(e.target.value)} className={`mt-1.5 ${inputClass}`} style={inputStyle} /></label>
            <label className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Heure *<input type="time" value={time} onChange={e => setTime(e.target.value)} className={`mt-1.5 ${inputClass}`} style={inputStyle} /></label>
            <label className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Matricule du bus *<div className="mt-1.5"><AutocompleteSelect options={vehicules.map(bus => ({ id: bus.id, label: bus.plate_number, sublabel: [bus.brand, bus.model, `${bus.capacity} places`].filter(Boolean).join(' · '), keywords: `${bus.plate_number} ${bus.brand ?? ''} ${bus.model ?? ''}` }))} value={busId} onChange={setBusId} placeholder="Rechercher par immatriculation..." required emptyText="Aucun véhicule trouvé" /></div></label>
            <label className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Chauffeur du bus *<div className="mt-1.5"><AutocompleteSelect options={chauffeurs.map(driver => ({ id: driver.id, label: driver.full_name, sublabel: [driver.employee_id, driver.phone].filter(Boolean).join(' · '), keywords: `${driver.full_name} ${driver.employee_id ?? ''} ${driver.phone ?? ''}` }))} value={driverId} onChange={setDriverId} placeholder="Rechercher un chauffeur..." required emptyText="Aucun chauffeur trouvé" /></div></label>
            <label className="text-xs font-bold sm:col-span-2" style={{ color: 'var(--text-secondary)' }}>Ville de destination *<div className="mt-1.5"><AutocompleteSelect options={cityOptions} value={destinationCity} onChange={setDestinationCity} placeholder="Rechercher une ville..." required emptyText="Aucune ville trouvée" /></div></label>
            <label className="text-xs font-bold sm:col-span-2" style={{ color: 'var(--text-secondary)' }}>Montant du ramassage (FCFA) *<input type="number" min="1" step="500" inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Ex : 25 000" className={`mt-1.5 ${inputClass}`} style={inputStyle} /></label>
            <div className="mt-2 flex gap-3 sm:col-span-2"><button type="button" onClick={() => navigate('/guichet/ramassage')} disabled={saving} className="flex-1 rounded-xl border-2 py-3.5 font-bold" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Annuler</button><button type="button" onClick={handleSave} disabled={saving} className="flex-1 rounded-xl py-3.5 font-bold text-white disabled:opacity-60" style={{ backgroundColor: 'var(--primary)' }}>{saving ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : 'Enregistrer le ramassage'}</button></div>
          </div>
        )}
      </div>
    </POSLayout>
  );
}
