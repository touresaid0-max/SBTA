import { useState, useRef, useEffect } from 'react';
import { useAuthStore } from '../../store/authStore';
import { supabase } from '../../services/supabase';
import { Camera, Save, User, Mail, Phone, Shield, Star, Award, CreditCard, Building2, MapPin, Users, Calendar, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import toast from 'react-hot-toast';

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrateur',
  dg: 'Directeur Général',
  daf: 'Directeur Administratif et Financier',
  comptable: 'Comptable',
  gestionnaire: 'Gestionnaire',
  chauffeur: 'Chauffeur',
  guichetier: 'Guichetier',
  agent_reservation: 'Agent Réservation',
  chef_garage: 'Chef de Garage',
  mecanicien: 'Mécanicien',
  planificateur: 'Planificateur',
  pompiste: 'Pompiste',
  client: 'Client',
  chef_gare: 'Chef de Gare',
  gerant_principal: 'Gérant Principal',
};

interface CompanyProfile {
  id: string;
  name: string;
  code: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
}

interface StationProfile {
  id: string;
  name: string;
  city_name: string;
  address?: string;
  phone?: string;
  email?: string;
  display_screen_enabled?: boolean;
  counters_count: number;
  today_departures: number;
  next_departure?: string;
}

export default function MyProfile() {
  const { user, updateProfile } = useAuthStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [stationProfile, setStationProfile] = useState<StationProfile | null>(null);
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null);
  const [form, setForm] = useState({
    first_name: user?.first_name || '',
    last_name: user?.last_name || '',
    phone: user?.phone || '',
  });

  useEffect(() => {
    if (user && (user.role === 'guichetier' || user.role === ('chef_gare' as any))) {
      loadStationProfile();
    }
    if (user && (user.role === 'comptable' || user.role === 'gestionnaire') && user.company_id) {
      supabase.from('companies')
        .select('id, name, code, phone, email, address')
        .eq('id', user.company_id)
        .maybeSingle()
        .then(({ data }) => { if (data) setCompanyProfile(data as CompanyProfile) });
    }
  }, [user]);

  const loadStationProfile = async () => {
    if (!user) return;
    try {
      const { data: st } = await supabase
        .from('stations')
        .select('id, name, address, phone, email, display_screen_enabled, cities:city_id(name)')
        .eq('station_manager_id', user.id)
        .maybeSingle();

      if (!st) return;

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const [{ count: countersCount }, { data: schedules }] = await Promise.all([
        supabase.from('counters').select('id', { count: 'exact', head: true }).eq('station_id', st.id),
        supabase.from('schedules')
          .select('departure_datetime, status')
          .eq('departure_station_id', st.id)
          .gte('departure_datetime', today.toISOString())
          .lt('departure_datetime', tomorrow.toISOString())
          .order('departure_datetime', { ascending: true }),
      ]);

      const nextSched = (schedules || []).find(s => s.status === 'planifie' || s.status === 'en_cours');

      setStationProfile({
        id: st.id,
        name: st.name,
        city_name: (st as any).cities?.name || '',
        address: st.address || undefined,
        phone: st.phone || undefined,
        email: st.email || undefined,
        display_screen_enabled: st.display_screen_enabled || false,
        counters_count: countersCount || 0,
        today_departures: (schedules || []).length,
        next_departure: nextSched?.departure_datetime,
      });
    } catch (_) {}
  };

  if (!user) return null;

  const displayName = user.first_name && user.last_name
    ? `${user.first_name} ${user.last_name}`
    : user.full_name || user.email;

  const handleAvatarClick = () => fileInputRef.current?.click();

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Veuillez sélectionner une image');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error('L\'image ne doit pas dépasser 2 MB');
      return;
    }

    setIsUploadingAvatar(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `avatars/${user.id}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
      const avatarUrl = `${urlData.publicUrl}?t=${Date.now()}`;

      await updateProfile({ avatar_url: avatarUrl });
      toast.success('Photo de profil mise à jour');
    } catch (error: any) {
      toast.error(error.message || 'Erreur lors du téléchargement');
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.first_name.trim() || !form.last_name.trim()) {
      toast.error('Le prénom et le nom sont requis');
      return;
    }

    setIsLoading(true);
    try {
      await updateProfile({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        full_name: `${form.first_name.trim()} ${form.last_name.trim()}`,
        phone: form.phone.trim() || undefined,
      });
      toast.success('Profil mis à jour avec succès');
    } catch (error: any) {
      toast.error(error.message || 'Erreur lors de la mise à jour');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>Mon profil</h1>
        <p className="mt-1" style={{ color: 'var(--text-secondary)' }}>
          Gérez vos informations personnelles
        </p>
      </div>

      <div className="rounded-xl p-6" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="flex items-center gap-6 mb-8">
          <div className="relative">
            <div
              className="w-24 h-24 rounded-full flex items-center justify-center overflow-hidden cursor-pointer group"
              style={{ backgroundColor: 'var(--surface-raised)' }}
              onClick={handleAvatarClick}
            >
              {user.avatar_url ? (
                <img src={user.avatar_url} alt={displayName} className="w-full h-full object-cover" />
              ) : (
                <User className="w-10 h-10" style={{ color: 'var(--text-muted)' }} />
              )}
              <div className="absolute inset-0 bg-black bg-opacity-40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-full">
                {isUploadingAvatar ? (
                  <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Camera className="w-6 h-6 text-white" />
                )}
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />
          </div>

          <div>
            <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
              {displayName}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <Shield className="w-4 h-4" style={{ color: 'var(--primary)' }} />
              <span className="text-sm font-medium" style={{ color: 'var(--primary)' }}>
                {ROLE_LABELS[user.role] || user.role}
              </span>
            </div>
            <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
              Cliquez sur l'avatar pour changer la photo
            </p>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                Prénom *
              </label>
              <input
                type="text"
                value={form.first_name}
                onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                required
                className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2"
                style={{ borderColor: 'var(--border)', color: 'var(--text-primary)', backgroundColor: 'var(--surface)' }}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                Nom *
              </label>
              <input
                type="text"
                value={form.last_name}
                onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                required
                className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2"
                style={{ borderColor: 'var(--border)', color: 'var(--text-primary)', backgroundColor: 'var(--surface)' }}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
              Email
            </label>
            <div className="flex items-center gap-3 px-4 py-2 rounded-lg border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-raised)' }}>
              <Mail className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              <span style={{ color: 'var(--text-secondary)' }}>{user.email}</span>
              <span className="ml-auto text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--info-light)', color: 'var(--info)' }}>
                Non modifiable
              </span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
              Téléphone
            </label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full pl-10 pr-4 py-2 rounded-lg border focus:outline-none focus:ring-2"
                style={{ borderColor: 'var(--border)', color: 'var(--text-primary)', backgroundColor: 'var(--surface)' }}
                placeholder="+225 XX XX XX XX XX"
              />
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={isLoading}
              className="flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--text-on-primary)' }}
            >
              <Save className="w-4 h-4" />
              {isLoading ? 'Enregistrement...' : 'Enregistrer les modifications'}
            </button>
          </div>
        </form>
      </div>

      {user.role === 'client' && (
        <div className="rounded-xl p-6" style={{ backgroundColor: 'var(--surface)' }}>
          <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            Programme de fidélité
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-4 rounded-lg" style={{ backgroundColor: 'var(--surface-raised)' }}>
              <Star className="w-6 h-6 mx-auto mb-2" style={{ color: '#D97706' }} />
              <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                {user.loyalty_points ?? 0}
              </p>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Points</p>
            </div>
            <div className="text-center p-4 rounded-lg" style={{ backgroundColor: 'var(--surface-raised)' }}>
              <Award className="w-6 h-6 mx-auto mb-2" style={{ color: '#0B7439' }} />
              <p className="text-lg font-semibold capitalize" style={{ color: 'var(--text-primary)' }}>
                {user.loyalty_tier ?? 'Bronze'}
              </p>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Niveau</p>
            </div>
            <div className="text-center p-4 rounded-lg" style={{ backgroundColor: 'var(--surface-raised)' }}>
              <CreditCard className="w-6 h-6 mx-auto mb-2" style={{ color: 'var(--primary)' }} />
              <p className="text-sm font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
                {user.loyalty_card_number ?? '—'}
              </p>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Carte fidélité</p>
            </div>
          </div>
        </div>
      )}

      {user.role === 'chauffeur' && (
        <div className="rounded-xl p-6" style={{ backgroundColor: 'var(--surface)' }}>
          <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            Performances conducteur
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--surface-raised)' }}>
              <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>Note moyenne</p>
              <div className="flex items-center gap-2">
                <Star className="w-5 h-5" style={{ color: '#D97706' }} />
                <span className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                  {user.driver_average_rating?.toFixed(1) ?? '0.0'}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>/5</span>
              </div>
            </div>
            <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--surface-raised)' }}>
              <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>Niveau de performance</p>
              <p className="text-xl font-semibold capitalize" style={{ color: 'var(--text-primary)' }}>
                {user.driver_performance_level ?? 'Bronze'}
              </p>
            </div>
          </div>
        </div>
      )}

      {companyProfile && (
        <div className="rounded-xl p-6" style={{ backgroundColor: 'var(--surface)' }}>
          <div className="flex items-center gap-2 mb-5">
            <Building2 className="w-5 h-5" style={{ color: 'var(--primary)' }} />
            <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              Ma société
            </h3>
          </div>
          <div className="flex items-start gap-4 mb-4">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: '#EFF6FF' }}>
              <Building2 className="w-6 h-6" style={{ color: '#1D4ED8' }} />
            </div>
            <div>
              <h4 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{companyProfile.name}</h4>
              <span className="inline-block mt-1 text-xs font-mono font-bold px-2 py-0.5 rounded"
                style={{ backgroundColor: '#DBEAFE', color: '#1D4ED8' }}>
                {companyProfile.code}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {companyProfile.phone && (
              <div className="flex items-center gap-2 p-3 rounded-lg" style={{ backgroundColor: 'var(--surface-raised)' }}>
                <Phone className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{companyProfile.phone}</span>
              </div>
            )}
            {companyProfile.email && (
              <div className="flex items-center gap-2 p-3 rounded-lg" style={{ backgroundColor: 'var(--surface-raised)' }}>
                <Mail className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{companyProfile.email}</span>
              </div>
            )}
            {companyProfile.address && (
              <div className="flex items-center gap-2 p-3 rounded-lg sm:col-span-2" style={{ backgroundColor: 'var(--surface-raised)' }}>
                <MapPin className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{companyProfile.address}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {stationProfile && (
        <div className="rounded-xl p-6" style={{ backgroundColor: 'var(--surface)' }}>
          <div className="flex items-center gap-2 mb-5">
            <Building2 className="w-5 h-5" style={{ color: 'var(--primary)' }} />
            <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              Ma gare
            </h3>
          </div>

          <div className="flex items-start gap-4 mb-5">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: 'var(--primary-light)' }}>
              <Building2 className="w-6 h-6" style={{ color: 'var(--primary)' }} />
            </div>
            <div>
              <h4 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{stationProfile.name}</h4>
              <div className="flex items-center gap-1 mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <MapPin className="w-4 h-4" />
                {stationProfile.city_name}{stationProfile.address ? ` — ${stationProfile.address}` : ''}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 rounded-lg text-center" style={{ backgroundColor: 'var(--surface-raised)' }}>
              <Calendar className="w-6 h-6 mx-auto mb-2" style={{ color: 'var(--primary)' }} />
              <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                {stationProfile.today_departures}
              </p>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Départs aujourd'hui</p>
            </div>
            <div className="p-4 rounded-lg text-center" style={{ backgroundColor: 'var(--surface-raised)' }}>
              <Users className="w-6 h-6 mx-auto mb-2" style={{ color: 'var(--primary)' }} />
              <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                {stationProfile.counters_count}
              </p>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Guichets</p>
            </div>
            <div className="p-4 rounded-lg text-center" style={{ backgroundColor: 'var(--surface-raised)' }}>
              <Clock className="w-6 h-6 mx-auto mb-2" style={{ color: 'var(--primary)' }} />
              <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                {stationProfile.next_departure
                  ? format(new Date(stationProfile.next_departure), 'HH:mm')
                  : '—'}
              </p>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Prochain départ</p>
            </div>
          </div>

          {stationProfile.display_screen_enabled && (
            <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
              <a
                href={`/display/station/${stationProfile.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm font-medium hover:underline"
                style={{ color: 'var(--primary)' }}
              >
                <Building2 className="w-4 h-4" />
                Ouvrir l'écran d'affichage de la gare
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
