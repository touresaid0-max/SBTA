import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import POSLayout from '@/components/pos/POSLayout';
import { usePOSSession } from '@/services/pos/POSSessionContext';
import {
  createDepart,
  getLignes, getVehicules, getChauffeurs, getGares,
  getAssignedRouteIds,
  nextDepartureNumber,
  nextRouteNumber,
  type LigneRef, type VehiculeRef, type ChauffeurRef, type GareRef,
} from '@/services/pos/departService';
import { AlertCircle, CheckCircle, Loader2, X } from 'lucide-react';
import AutocompleteSelect from '@/components/pos/AutocompleteSelect';

export default function POSDepartNouveau() {
  const navigate = useNavigate();
  const { session } = usePOSSession();

  const [lignes, setLignes] = useState<LigneRef[]>([]);
  const [vehicules, setVehicules] = useState<VehiculeRef[]>([]);
  const [chauffeurs, setChauffeurs] = useState<ChauffeurRef[]>([]);
  const [gares, setGares] = useState<GareRef[]>([]);
  const [loadingRefs, setLoadingRefs] = useState(true);
  const [noLinesAssigned, setNoLinesAssigned] = useState(false);

  const [departureDate, setDepartureDate] = useState('');
  const [departureTime, setDepartureTime] = useState('');
  const [ligneId, setLigneId] = useState('');
  const [isAc, setIsAc] = useState(false);
  const [busId, setBusId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [otherStationId, setOtherStationId] = useState('');
  const [convoyeurId, setConvoyeurId] = useState('');
  const [apprentiId, setApprentiId] = useState('');
  const [seatsTotal, setSeatsTotal] = useState(0);
  const [seatsFrom, setSeatsFrom] = useState(1);
  const [departureNo, setDepartureNo] = useState(0);

  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const loadRefs = useCallback(async () => {
    try {
      const [l, v, c, g] = await Promise.all([getLignes(), getVehicules(), getChauffeurs(), getGares()]);

      let routeIds = session?.assigned_route_ids ?? [];
      if (navigator.onLine && session?.counter_id) {
        const fresh = await getAssignedRouteIds(session.counter_id);
        if (fresh.length > 0) routeIds = fresh;
      }

      if (routeIds.length > 0) {
        const allowed = new Set(routeIds);
        setLignes(l.filter(ligne => allowed.has(ligne.id)));
        setNoLinesAssigned(false);
      } else {
        setLignes([]);
        setNoLinesAssigned(true);
      }

      setVehicules(v);
      setChauffeurs(c);
      setGares(g);
    } catch (err) {
      // refs may not be cached yet
    } finally {
      setLoadingRefs(false);
    }
  }, [session?.counter_id, session?.assigned_route_ids]);

  useEffect(() => {
    loadRefs();
  }, [loadRefs]);

  useEffect(() => {
    if (session?.station_id && ligneId) {
      nextRouteNumber(session.station_id, ligneId, session?.counter_id, departureDate).then(setDepartureNo);
    } else if (session?.station_id) {
      nextDepartureNumber(session.station_id, session?.counter_id, departureDate).then(setDepartureNo);
    }
  }, [session?.station_id, session?.counter_id, ligneId, departureDate]);

  const selectedBus = vehicules.find(v => v.id === busId);

  const handleBusChange = (id: string) => {
    setBusId(id);
    const bus = vehicules.find(v => v.id === id);
    if (bus && seatsTotal === 0) {
      setSeatsTotal(bus.capacity);
    }
  };

  const canSubmit = departureDate && ligneId && busId && driverId && seatsTotal > 0;

  const handleSubmit = () => {
    setError('');
    if (noLinesAssigned) {
      setError('Aucune ligne n\'est affectée à votre compte. Veuillez contacter votre Chef de Gare ou l\'Administrateur.');
      return;
    }
    if (!canSubmit) {
      setError('Veuillez renseigner tous les champs obligatoires (date, ligne, car, chauffeur, nombre de sièges).');
      return;
    }
    setShowConfirm(true);
  };

  const handleConfirm = async () => {
    setSaving(true);
    setError('');
    try {
      const stationId = session?.station_id ?? '';
      const ligne = lignes.find(l => l.id === ligneId);
      const bus = vehicules.find(v => v.id === busId);
      const driver = chauffeurs.find(c => c.id === driverId);
      const convoyeur = chauffeurs.find(c => c.id === convoyeurId);
      const apprenti = chauffeurs.find(c => c.id === apprentiId);
      const otherStation = otherStationId ? gares.find(g => g.id === otherStationId) : undefined;

      await createDepart({
        route_id: ligneId,
        route_name: ligne?.name ?? '',
        bus_id: busId,
        bus_plate: bus?.plate_number ?? '',
        bus_name: bus?.plate_number ?? '',
        driver_id: driverId,
        driver_name: driver?.full_name ?? '',
        convoyeur_id: convoyeurId || undefined,
        convoyeur_name: convoyeur?.full_name || undefined,
        apprenti_id: apprentiId || undefined,
        apprenti_name: apprenti?.full_name || undefined,
        departure_datetime: `${departureDate}T${departureTime || '00:00'}:00`,
        departure_date: departureDate,
        departure_time: departureTime || '',
        is_ac: isAc,
        status: 'planned',
        seats_total: seatsTotal,
        seats_from: seatsFrom,
        station_id: stationId,
        station_name: session?.station_name ?? '',
        counter_id: session?.counter_id,
        other_station_id: otherStationId || undefined,
        other_station_name: otherStation?.name,
      });

      setSuccess(true);
      setTimeout(() => navigate('/guichet/departs'), 800);
    } catch (err: any) {
      setError(err?.message ?? 'Erreur lors de la création du départ');
      setSaving(false);
      setShowConfirm(false);
    }
  };

  const fieldLabel = 'block text-xs font-bold mb-1.5';
  const fieldInput = 'w-full px-3 py-3 rounded-xl border-2 text-base outline-none transition-colors';
  const fieldStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)' as const };

  return (
    <POSLayout showBack stationName={session?.station_name} activeRoute="Nouveau départ">
      {loadingRefs ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--primary)' }} />
        </div>
      ) : (
        <div className="max-w-2xl mx-auto">
          {/* Auto departure number */}
          <div className="rounded-xl p-3 mb-5 flex items-center justify-between" style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
            <span className="text-sm font-bold">N° Départ {ligneId ? `(${lignes.find(l => l.id === ligneId)?.name ?? ''})` : ''}</span>
            <span className="text-lg font-bold">#{departureNo}</span>
          </div>

          {error && (
            <div className="rounded-xl px-3 py-2.5 mb-4 flex items-start gap-2 text-sm" style={{ backgroundColor: 'var(--danger-light)', color: 'var(--danger)' }}>
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="rounded-xl px-3 py-2.5 mb-4 flex items-center gap-2 text-sm font-medium" style={{ backgroundColor: 'var(--success-light)', color: 'var(--success)' }}>
              <CheckCircle className="w-4 h-4" /> Départ créé avec succès
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            {/* Date départ */}
            <div>
              <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Date départ *</label>
              <input type="date" value={departureDate} onChange={e => setDepartureDate(e.target.value)} className={fieldInput} style={fieldStyle} onFocus={e => e.currentTarget.style.borderColor = 'var(--primary)'} onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'} />
            </div>

            {/* Heure */}
            <div>
              <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Heure</label>
              <input type="time" value={departureTime} onChange={e => setDepartureTime(e.target.value)} className={fieldInput} style={fieldStyle} onFocus={e => e.currentTarget.style.borderColor = 'var(--primary)'} onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'} />
            </div>

            {/* Ligne */}
            <div>
              <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Ligne *</label>
              {noLinesAssigned ? (
                <div
                  className="rounded-xl px-4 py-3 text-sm flex items-start gap-2"
                  style={{ backgroundColor: 'var(--warning-light)', color: '#92400E' }}
                >
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>Aucune ligne n'est affectée à votre compte. Veuillez contacter votre Chef de Gare ou l'Administrateur.</span>
                </div>
              ) : (
                <select value={ligneId} onChange={e => setLigneId(e.target.value)} className={fieldInput} style={fieldStyle}>
                  <option value="">Sélectionner...</option>
                  {lignes.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              )}
            </div>

            {/* Climatisé */}
            <div>
              <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Climatisé</label>
              <button
                type="button"
                onClick={() => setIsAc(!isAc)}
                className={fieldInput}
                style={{ ...fieldStyle, borderColor: isAc ? 'var(--primary)' : 'var(--border)', fontWeight: isAc ? 700 : 400, color: isAc ? 'var(--primary)' : 'var(--text-secondary)' }}
              >
                {isAc ? 'Oui' : 'Non'}
              </button>
            </div>

            {/* Car */}
            <div>
              <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Car *</label>
              <AutocompleteSelect
                options={vehicules.map(v => ({
                  id: v.id,
                  label: v.plate_number,
                  sublabel: [v.brand, v.model, `${v.capacity} places`].filter(Boolean).join(' · '),
                  keywords: `${v.plate_number} ${v.brand ?? ''} ${v.model ?? ''} ${v.capacity}`,
                }))}
                value={busId}
                onChange={handleBusChange}
                placeholder="Rechercher par immatriculation, marque, modèle..."
                required
                emptyText="Aucun bus trouvé"
              />
            </div>

            {/* Chauffeur */}
            <div>
              <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Chauffeur *</label>
              <AutocompleteSelect
                options={chauffeurs.map(c => ({
                  id: c.id,
                  label: c.full_name,
                  sublabel: [c.employee_id, c.phone].filter(Boolean).join(' · '),
                  keywords: `${c.full_name} ${c.employee_id ?? ''} ${c.phone ?? ''} ${c.email}`,
                }))}
                value={driverId}
                onChange={setDriverId}
                placeholder="Rechercher par nom, matricule, téléphone..."
                required
                emptyText="Aucun chauffeur trouvé"
              />
            </div>

            {/* Charger dans une autre gare */}
            <div>
              <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Charger dans une autre gare</label>
              <AutocompleteSelect
                options={gares.filter(g => g.id !== session?.station_id).map(g => ({
                  id: g.id,
                  label: g.name,
                  sublabel: [g.city, g.agency_code].filter(Boolean).join(' · '),
                  keywords: `${g.name} ${g.city ?? ''} ${g.agency_code ?? ''}`,
                }))}
                value={otherStationId}
                onChange={setOtherStationId}
                placeholder="Rechercher une gare..."
                emptyText="Aucune gare trouvée"
              />
            </div>

            {/* Convoyeur */}
            <div>
              <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Convoyeur</label>
              <select value={convoyeurId} onChange={e => setConvoyeurId(e.target.value)} className={fieldInput} style={fieldStyle}>
                <option value="">Aucun</option>
                {chauffeurs.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
              </select>
            </div>

            {/* Apprenti */}
            <div>
              <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Apprenti</label>
              <select value={apprentiId} onChange={e => setApprentiId(e.target.value)} className={fieldInput} style={fieldStyle}>
                <option value="">Aucun</option>
                {chauffeurs.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
              </select>
            </div>

            {/* Nbre siège */}
            <div>
              <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Nbre siège *</label>
              <input type="number" min={1} value={seatsTotal || ''} onChange={e => setSeatsTotal(parseInt(e.target.value) || 0)} className={fieldInput} style={fieldStyle} placeholder={selectedBus ? `${selectedBus.capacity}` : '0'} onFocus={e => e.currentTarget.style.borderColor = 'var(--primary)'} onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'} />
            </div>

            {/* Siège à partir de */}
            <div>
              <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Siège à partir de</label>
              <input type="number" min={0} value={seatsFrom} onChange={e => setSeatsFrom(parseInt(e.target.value) || 0)} className={fieldInput} style={fieldStyle} onFocus={e => e.currentTarget.style.borderColor = 'var(--primary)'} onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'} />
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 mt-6">
            <button
              onClick={() => navigate('/guichet/departs')}
              className="flex-1 py-3.5 rounded-xl font-bold text-base border-2 transition-colors"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            >
              Annuler
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || saving}
              className="flex-1 py-3.5 rounded-xl font-bold text-white text-base disabled:opacity-60 transition-opacity"
              style={{ backgroundColor: 'var(--primary)' }}
            >
              {saving ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Créer le départ'}
            </button>
          </div>
        </div>
      )}

      {/* Confirmation dialog */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="rounded-2xl shadow-2xl max-w-sm w-full p-6" style={{ backgroundColor: 'var(--surface)' }}>
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Confirmation</h3>
              <button onClick={() => setShowConfirm(false)} className="p-1 rounded-lg" style={{ color: 'var(--text-muted)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
              Voulez-vous créer un nouveau départ ? Veuillez renseigner la date de départ SVP.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-3 rounded-xl font-bold border-2"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              >
                Non
              </button>
              <button
                onClick={handleConfirm}
                disabled={saving}
                className="flex-1 py-3 rounded-xl font-bold text-white disabled:opacity-60"
                style={{ backgroundColor: 'var(--primary)' }}
              >
                {saving ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Oui'}
              </button>
            </div>
          </div>
        </div>
      )}
    </POSLayout>
  );
}
