import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, User, LogIn, Loader2, AlertCircle, CheckCircle, Luggage, ShieldAlert } from 'lucide-react';
import { login, getCurrentSession, logoutPOS, type POSLoginResult } from '@/services/pos/offlineAuth';
import { refreshAllReferentiels } from '@/services/pos/referentiels';
import { isOnline } from '@/services/pos/syncEngine';
import { supabase } from '@/services/supabase';
import { db, type SessionRecord } from '@/services/pos/db';

export default function TPEConnexion() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loginMode, setLoginMode] = useState<boolean | null>(null);

  useEffect(() => {
    const existingManifests = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="manifest"]'));
    existingManifests.forEach((link) => link.remove());

    const manifest = document.createElement('link');
    manifest.rel = 'manifest';
    manifest.href = '/tpe-pos/manifest.webmanifest';
    manifest.dataset.tpePwa = 'true';
    document.head.appendChild(manifest);

    const themeColor = document.createElement('meta');
    themeColor.name = 'theme-color';
    themeColor.content = '#0B7439';
    themeColor.dataset.tpePwa = 'true';
    document.head.appendChild(themeColor);

    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/tpe-pos/sw.js', { scope: '/tpe-pos/' });
    }

    return () => {
      manifest.remove();
      themeColor.remove();
      existingManifests.forEach((link) => document.head.appendChild(link));
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleLogin();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  // Guard: if a non-bagagiste session is already active, force logout so they can't access TPE.
  useEffect(() => {
    (async () => {
      const s = await getCurrentSession();
      if (s && s.role !== 'bagagiste') {
        await logoutPOS();
      }
    })();
  }, []);

  const handleLogin = async () => {
    if (!email.trim() || !password) return;
    setLoading(true);
    setError('');
    setLoginMode(null);

    if (!isOnline()) {
      setError('Une connexion Internet est nécessaire pour se connecter.');
      setLoading(false);
      return;
    }

    const result: POSLoginResult = await login(email.trim(), password);

    if (!result.success) {
      setError(result.error ?? 'Erreur de connexion');
      setLoading(false);
      return;
    }

    // Role gate: only bagagiste can use the TPE.
    if (result.session?.role !== 'bagagiste') {
      await logoutPOS();
      setError('Accès refusé : cet espace est réservé aux bagagistes. Votre profil n\'est pas autorisé.');
      setLoading(false);
      return;
    }

    // Enrich session with company name for display.
    if (result.session.station_id) {
      try {
        const { data: station } = await supabase
          .from('stations')
          .select('id, name')
          .eq('id', result.session.station_id)
          .maybeSingle();
        if (station) {
          const enriched: SessionRecord = {
            ...result.session,
            station_name: station.name ?? result.session.station_name,
          } as SessionRecord;
          await db.session.put(enriched);
        }
      } catch {
        // non-critical — station name from login is sufficient
      }
    }

    setLoginMode(true);
    if (!result.offline) {
      try { await refreshAllReferentiels(); } catch { /* non-critical */ }
    }
    setTimeout(() => navigate('/tpe-pos/accueil'), 400);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4" style={{ backgroundColor: '#F4F7F5' }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div
            className="w-24 h-24 rounded-3xl flex items-center justify-center mx-auto mb-4"
            style={{ backgroundColor: '#0B7439', color: 'white' }}
          >
            <Luggage className="w-12 h-12" strokeWidth={2.2} />
          </div>
          <h1 className="text-3xl font-bold" style={{ color: '#1A2E22' }}>TPE Bagage SBTA</h1>
          <p className="text-base mt-1.5" style={{ color: '#6B7280' }}>Terminal de paiement électronique</p>
        </div>

        <div
          className="rounded-xl px-4 py-3 mb-5 flex items-center gap-2.5 text-sm font-medium"
          style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}
        >
          <CheckCircle className="w-5 h-5" />
          {isOnline() ? 'En ligne — connexion au serveur' : 'Hors ligne — Internet requis pour la connexion'}
        </div>

        {error && (
          <div
            className="rounded-xl px-4 py-3 mb-5 flex items-start gap-2.5 text-base"
            style={{ backgroundColor: '#FEF2F2', color: '#DC2626' }}
          >
            <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loginMode && (
          <div
            className="rounded-xl px-4 py-3 mb-5 flex items-center gap-2.5 text-base font-medium"
            style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}
          >
            <CheckCircle className="w-5 h-5 flex-shrink-0" />
            Connexion réussie
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); handleLogin(); }} className="space-y-5">
          <div>
            <label className="block text-sm font-bold mb-2" style={{ color: '#374151' }}>
              Identifiant
            </label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6" style={{ color: '#9CA3AF' }} />
              <input
                type="text"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(''); }}
                className="w-full pl-13 pr-4 py-4.5 rounded-xl border-2 text-lg outline-none transition-colors"
                style={{ borderColor: '#E2EAE5', backgroundColor: 'white' }}
                onFocus={e => e.currentTarget.style.borderColor = '#0B7439'}
                onBlur={e => e.currentTarget.style.borderColor = '#E2EAE5'}
                placeholder="Email ou matricule"
                autoFocus
                autoComplete="username"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold mb-2" style={{ color: '#374151' }}>
              Mot de passe
            </label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6" style={{ color: '#9CA3AF' }} />
              <input
                type="password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
                className="w-full pl-13 pr-4 py-4.5 rounded-xl border-2 text-lg outline-none transition-colors"
                style={{ borderColor: '#E2EAE5', backgroundColor: 'white' }}
                onFocus={e => e.currentTarget.style.borderColor = '#0B7439'}
                onBlur={e => e.currentTarget.style.borderColor = '#E2EAE5'}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !email.trim() || !password}
            className="w-full py-5 rounded-xl font-bold text-white text-lg flex items-center justify-center gap-2.5 disabled:opacity-60 transition-opacity"
            style={{ backgroundColor: '#0B7439' }}
          >
            {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : <LogIn className="w-6 h-6" />}
            {loading ? 'Connexion...' : 'Se connecter'}
          </button>
        </form>

        <div
          className="mt-8 rounded-xl px-4 py-3.5 flex items-start gap-2.5 text-sm"
          style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}
        >
          <ShieldAlert className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <span>Accès réservé aux bagagistes. Autres profils non autorisés.</span>
        </div>

        <p className="text-center text-sm mt-5" style={{ color: '#9CA3AF' }}>
          Entrée = valider · Échap = annuler
        </p>
      </div>
    </div>
  );
}
