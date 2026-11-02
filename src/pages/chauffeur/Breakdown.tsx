import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import { AlertTriangle, Upload, MapPin, Navigation, CheckCircle } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useNavigate } from 'react-router-dom';

interface Bus {
  id: string;
  registration_number: string;
  brand: string;
  model: string;
}

interface Schedule {
  id: string;
  departure_datetime: string;
  route_name: string;
}

const BREAKDOWN_TYPES: { value: string; label: string }[] = [
  { value: 'mecanique', label: 'Panne mécanique' },
  { value: 'electrique', label: 'Panne électrique' },
  { value: 'pneumatique', label: 'Crevaison / Pneumatique' },
  { value: 'carrosserie', label: 'Carrosserie / Accident' },
  { value: 'autres', label: 'Autre' },
];

const SEVERITY_LEVELS = [
  { value: 'faible', label: 'Faible', desc: 'Peut continuer prudemment', color: '#3B82F6', bg: '#EFF6FF' },
  { value: 'moyenne', label: 'Moyenne', desc: 'Ralentissement requis', color: '#F59E0B', bg: '#FEF3C7' },
  { value: 'critique', label: 'Critique', desc: 'Arrêt immédiat requis', color: '#EF4444', bg: '#FEF2F2' },
];

export default function BreakdownReport() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [currentBus, setCurrentBus] = useState<Bus | null>(null);
  const [currentSchedule, setCurrentSchedule] = useState<Schedule | null>(null);

  const [formData, setFormData] = useState({
    breakdown_type: '',
    title: '',
    description: '',
    severity: 'moyenne',
    location: '',
    latitude: null as number | null,
    longitude: null as number | null
  });

  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);

  useEffect(() => {
    loadCurrentAssignment();
    getCurrentLocation();
  }, []);

  const loadCurrentAssignment = async () => {
    try {
      setLoading(true);
      const { data: scheduleData } = await supabase
        .from('schedules')
        .select(`
          id,
          departure_datetime,
          route_name,
          buses:bus_id (id, registration_number, brand, model)
        `)
        .eq('driver_id', user?.id)
        .in('status', ['in_progress', 'en_cours', 'scheduled', 'planifie'])
        .order('departure_datetime', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (scheduleData) {
        setCurrentSchedule({
          id: scheduleData.id,
          departure_datetime: scheduleData.departure_datetime,
          route_name: scheduleData.route_name,
        });
        if (scheduleData.buses) {
          setCurrentBus(scheduleData.buses as unknown as Bus);
        }
      }

      if (!scheduleData?.buses) {
        const { data: busData } = await supabase
          .from('buses')
          .select('id, registration_number, brand, model')
          .eq('status', 'disponible')
          .limit(1)
          .maybeSingle();
        if (busData) setCurrentBus(busData);
      }
    } catch (error: any) {
      console.error('Erreur de chargement:', error);
    } finally {
      setLoading(false);
    }
  };

  const getCurrentLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setFormData(prev => ({
          ...prev,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude
        }));
      },
      (err) => console.error('GPS error:', err)
    );
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (photos.length + files.length > 5) {
      toast.error('Maximum 5 photos autorisées');
      return;
    }
    setPhotos(prev => [...prev, ...files]);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => setPhotoPreviews(prev => [...prev, reader.result as string]);
      reader.readAsDataURL(file);
    });
  };

  const removePhoto = (index: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== index));
    setPhotoPreviews(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!currentBus) {
      toast.error('Aucun bus assigné. Contactez votre responsable.');
      return;
    }
    if (!formData.breakdown_type || !formData.title || !formData.description) {
      toast.error('Veuillez remplir tous les champs obligatoires');
      return;
    }
    if (!formData.location) {
      toast.error('Veuillez indiquer votre localisation');
      return;
    }

    try {
      setSubmitting(true);

      const photoUrls: string[] = [];
      for (let i = 0; i < photos.length; i++) {
        const file = photos[i];
        const fileExt = file.name.split('.').pop();
        const filePath = `breakdown-photos/${currentBus.id}-${Date.now()}-${i}.${fileExt}`;
        const { error: uploadError } = await supabase.storage.from('documents').upload(filePath, file);
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from('documents').getPublicUrl(filePath);
        photoUrls.push(urlData.publicUrl);
      }

      const { error: breakdownError } = await supabase
        .from('breakdown_reports')
        .insert({
          bus_id: currentBus.id,
          reported_by: user?.id,
          driver_id: user?.id,
          schedule_id: currentSchedule?.id || null,
          breakdown_type: formData.breakdown_type,
          title: formData.title,
          description: formData.description,
          severity: formData.severity,
          location: formData.location,
          latitude: formData.latitude,
          longitude: formData.longitude,
          photo_urls: photoUrls,
          photos_urls: photoUrls,
          status: 'signale',
          reported_at: new Date().toISOString()
        });

      if (breakdownError) throw breakdownError;

      await supabase
        .from('buses')
        .update({ status: 'panne_route', updated_at: new Date().toISOString() })
        .eq('id', currentBus.id);

      if (currentSchedule) {
        await supabase
          .from('schedules')
          .update({ status: 'annule', updated_at: new Date().toISOString() })
          .eq('id', currentSchedule.id);
      }

      toast.success('Panne signalée — Le garage a été alerté');
      navigate('/chauffeur/dashboard');
    } catch (error: any) {
      toast.error('Erreur lors du signalement');
      console.error(error);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center py-16">
        <div className="w-12 h-12 border-4 rounded-full animate-spin mx-auto mb-4"
             style={{ borderColor: 'var(--danger)', borderTopColor: 'transparent' }} />
        <p style={{ color: 'var(--text-secondary)' }}>Chargement...</p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-3xl mx-auto">

        {/* Alert header */}
        <div className="mb-6 p-5 rounded-xl border-2 flex items-center gap-4"
             style={{ backgroundColor: 'var(--danger-light)', borderColor: 'var(--danger)' }}>
          <div className="w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0"
               style={{ backgroundColor: 'var(--danger)' }}>
            <AlertTriangle className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold mb-0.5" style={{ color: 'var(--danger)' }}>
              SIGNALEMENT DE PANNE
            </h1>
            <p className="text-sm font-medium" style={{ color: 'var(--danger)' }}>
              Remplissez ce formulaire avec précision — Le garage sera alerté immédiatement
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">

          {/* Vehicle info */}
          <div className="bg-white rounded-xl p-5 border">
            <h2 className="font-bold mb-4">Véhicule & Mission</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Bus assigné</label>
                <div className="p-3 rounded-lg border bg-gray-50">
                  {currentBus ? (
                    <>
                      <p className="font-bold">{currentBus.registration_number}</p>
                      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {currentBus.brand} {currentBus.model}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Aucun bus assigné</p>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Mission en cours</label>
                <div className="p-3 rounded-lg border bg-gray-50">
                  {currentSchedule ? (
                    <>
                      <p className="font-bold text-sm">{currentSchedule.route_name}</p>
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {new Date(currentSchedule.departure_datetime).toLocaleString('fr-FR')}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Aucune mission active</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Breakdown details */}
          <div className="bg-white rounded-xl p-5 border">
            <h2 className="font-bold mb-4">Détails de la panne</h2>
            <div className="space-y-4">
              <div>
                <label className="block mb-1.5 font-medium text-sm">Type de panne *</label>
                <select
                  value={formData.breakdown_type}
                  onChange={e => setFormData({ ...formData, breakdown_type: e.target.value })}
                  className="w-full p-3 border rounded-lg"
                  required
                >
                  <option value="">Sélectionner le type de panne</option>
                  {BREAKDOWN_TYPES.map(type => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block mb-1.5 font-medium text-sm">Titre court *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={e => setFormData({ ...formData, title: e.target.value })}
                  className="w-full p-3 border rounded-lg"
                  placeholder="Ex: Moteur surchauffe — fumée blanche"
                  required
                />
              </div>

              <div>
                <label className="block mb-1.5 font-medium text-sm">Description détaillée *</label>
                <textarea
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  className="w-full p-3 border rounded-lg"
                  rows={4}
                  placeholder="Décrivez précisément les symptômes observés, bruits, circonstances..."
                  required
                />
              </div>

              <div>
                <label className="block mb-2 font-medium text-sm">Niveau de gravité *</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {SEVERITY_LEVELS.map(level => (
                    <label
                      key={level.value}
                      className="p-3 border-2 rounded-xl cursor-pointer transition-all text-center"
                      style={{
                        borderColor: formData.severity === level.value ? level.color : 'var(--border)',
                        backgroundColor: formData.severity === level.value ? level.bg : 'transparent',
                      }}
                    >
                      <input
                        type="radio"
                        name="severity"
                        value={level.value}
                        checked={formData.severity === level.value}
                        onChange={e => setFormData({ ...formData, severity: e.target.value })}
                        className="hidden"
                      />
                      <p className="font-bold text-sm mb-0.5" style={{ color: level.color }}>{level.label}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{level.desc}</p>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Location */}
          <div className="bg-white rounded-xl p-5 border">
            <h2 className="font-bold mb-4">Localisation</h2>
            <div className="space-y-3">
              <div>
                <label className="block mb-1.5 font-medium text-sm">Position exacte *</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={formData.location}
                    onChange={e => setFormData({ ...formData, location: e.target.value })}
                    className="flex-1 p-3 border rounded-lg"
                    placeholder="Ex: RN3, sortie Tiassalé, km 120"
                    required
                  />
                  <button
                    type="button"
                    onClick={getCurrentLocation}
                    className="px-4 py-3 rounded-lg border flex items-center gap-2 text-sm font-medium hover:bg-gray-50"
                  >
                    <Navigation className="w-4 h-4" />
                    GPS
                  </button>
                </div>
              </div>
              {formData.latitude && formData.longitude && (
                <div className="p-3 rounded-lg flex items-center gap-2 text-sm"
                     style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
                  <MapPin className="w-4 h-4 flex-shrink-0" />
                  <span>GPS: {formData.latitude.toFixed(6)}, {formData.longitude.toFixed(6)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Photos */}
          <div className="bg-white rounded-xl p-5 border">
            <h2 className="font-bold mb-4">Photos (jusqu'à 5)</h2>
            {photoPreviews.length > 0 && (
              <div className="grid grid-cols-3 md:grid-cols-5 gap-3 mb-4">
                {photoPreviews.map((preview, index) => (
                  <div key={index} className="relative">
                    <img src={preview} alt={`Photo ${index + 1}`}
                         className="w-full h-24 object-cover rounded-lg border" />
                    <button type="button" onClick={() => removePhoto(index)}
                      className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center text-xs font-bold">
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            {photos.length < 5 && (
              <div className="border-2 border-dashed rounded-xl p-5">
                <input type="file" accept="image/*" multiple onChange={handlePhotoChange}
                  className="hidden" id="photo-upload" />
                <label htmlFor="photo-upload" className="flex flex-col items-center cursor-pointer">
                  <Upload className="w-10 h-10 mb-2" style={{ color: 'var(--text-secondary)' }} />
                  <p className="font-medium text-sm mb-0.5">Ajouter des photos</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {photos.length}/5 photos ajoutées
                  </p>
                </label>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => navigate('/chauffeur/dashboard')}
              className="flex-1 py-4 rounded-xl border font-medium"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={submitting || !currentBus}
              className="flex-1 py-4 rounded-xl text-white font-bold text-base disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ backgroundColor: 'var(--danger)' }}
            >
              <CheckCircle className="w-5 h-5" />
              {submitting ? 'Envoi en cours...' : 'ENVOYER LE SIGNALEMENT'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
