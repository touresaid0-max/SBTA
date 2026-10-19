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
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div
            className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-4"
            style={{ backgroundColor: '#0B7439', color: 'white' }}
          >
            <Luggage className="w-10 h-10" strokeWidth={2.2} />
          </div>
          <h1 className="text-2xl font-bold" style={{ color: '#1A2E22' }}>TPE Bagage SBTA</h1>
          <p className="text-sm mt-1" style={{ color: '#6B7280' }}>Terminal de paiement électronique</p>
        </div>

        <div
          className="rounded-xl px-3 py-2 mb-4 flex items-center gap-2 text-xs font-medium"
          style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}
        >
          <CheckCircle className="w-4 h-4" />
          {isOnline() ? 'En ligne — connexion au serveur' : 'Hors ligne — vérification locale'}
        </div>

        {error && (
          <div
            className="rounded-xl px-3 py-2.5 mb-4 flex items-start gap-2 text-sm"
            style={{ backgroundColor: '#FEF2F2', color: '#DC2626' }}
          >
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loginMode && (
          <div
            className="rounded-xl px-3 py-2.5 mb-4 flex items-center gap-2 text-sm font-medium"
            style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}
          >
            <CheckCircle className="w-4 h-4 flex-shrink-0" />
            Connexion réussie
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); handleLogin(); }} className="space-y-4">
          <div>
            <label className="block text-xs font-bold mb-1.5" style={{ color: '#6B7280' }}>
              Identifiant
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: '#9CA3AF' }} />
              <input
                type="text"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(''); }}
                className="w-full pl-11 pr-4 py-3.5 rounded-xl border-2 text-base outline-none transition-colors"
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
            <label className="block text-xs font-bold mb-1.5" style={{ color: '#6B7280' }}>
              Mot de passe
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: '#9CA3AF' }} />
              <input
                type="password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
                className="w-full pl-11 pr-4 py-3.5 rounded-xl border-2 text-base outline-none transition-colors"
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
            className="w-full py-4 rounded-xl font-bold text-white text-base flex items-center justify-center gap-2 disabled:opacity-60 transition-opacity"
            style={{ backgroundColor: '#0B7439' }}
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <LogIn className="w-5 h-5" />}
            {loading ? 'Connexion...' : 'Se connecter'}
          </button>
        </form>

        <div
          className="mt-6 rounded-xl px-3 py-2.5 flex items-start gap-2 text-xs"
          style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}
        >
          <ShieldAlert className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>Accès réservé aux bagagistes. Autres profils non autorisés.</span>
        </div>

        <p className="text-center text-xs mt-4" style={{ color: '#9CA3AF' }}>
          Entrée = valider · Échap = annuler
        </p>
      </div>
    </div>
  );
}
