import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, User, LogIn, Loader2, WifiOff, AlertCircle, CheckCircle } from 'lucide-react';
import { login, hasOfflineCredentials, type POSLoginResult } from '@/services/pos/offlineAuth';
import { useSyncStatus } from '@/services/pos/useSyncStatus';
import { refreshAllReferentiels } from '@/services/pos/referentiels';

export default function POSConnexion() {
  const navigate = useNavigate();
  const { isOnline } = useSyncStatus();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [offlineAvailable, setOfflineAvailable] = useState(false);
  const [loginMode, setLoginMode] = useState<'online' | 'offline' | null>(null);

  const checkOfflineCreds = useCallback(async () => {
    if (email.trim().length > 2) {
      const has = await hasOfflineCredentials(email.trim());
      setOfflineAvailable(has);
    } else {
      setOfflineAvailable(false);
    }
  }, [email]);

  useEffect(() => {
    const t = setTimeout(checkOfflineCreds, 300);
    return () => clearTimeout(t);
  }, [checkOfflineCreds]);

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

  const handleLogin = async () => {
    if (!email.trim() || !password) return;
    setLoading(true);
    setError('');
    setLoginMode(null);

    const result: POSLoginResult = await login(email.trim(), password);

    if (result.success) {
      setLoginMode(result.offline ? 'offline' : 'online');

      if (!result.offline && navigator.onLine) {
        try { await refreshAllReferentiels(); } catch { /* non-critical */ }
      }

      setTimeout(() => navigate('/guichet/accueil'), 400);
    } else {
      setError(result.error ?? 'Erreur de connexion');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4" style={{ backgroundColor: 'var(--bg-subtle)' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div
            className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-4"
            style={{ backgroundColor: 'var(--primary)', color: 'white' }}
          >
            <TicketIcon />
          </div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Guichet Eafribus</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Terminal de vente</p>
        </div>

        {/* Network status banner */}
        <div
          className="rounded-xl px-3 py-2 mb-4 flex items-center gap-2 text-xs font-medium"
          style={{
            backgroundColor: isOnline ? 'var(--primary-light)' : 'var(--warning-light)',
            color: isOnline ? 'var(--primary)' : '#92400E',
          }}
        >
          {isOnline ? <CheckCircle className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
          {isOnline
            ? 'En ligne — connexion au serveur'
            : offlineAvailable
              ? 'Hors ligne — connexion via identifiants en cache'
              : 'Hors ligne — identifiants non disponibles pour cet utilisateur'}
        </div>

        {error && (
          <div
            className="rounded-xl px-3 py-2.5 mb-4 flex items-start gap-2 text-sm"
            style={{ backgroundColor: 'var(--danger-light)', color: 'var(--danger)' }}
          >
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loginMode && (
          <div
            className="rounded-xl px-3 py-2.5 mb-4 flex items-center gap-2 text-sm font-medium"
            style={{ backgroundColor: 'var(--success-light)', color: 'var(--success)' }}
          >
            <CheckCircle className="w-4 h-4 flex-shrink-0" />
            {loginMode === 'online' ? 'Connexion réussie — en ligne' : 'Connexion réussie — mode hors ligne'}
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); handleLogin(); }} className="space-y-4">
          <div>
            <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              Identifiant
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: 'var(--text-muted)' }} />
              <input
                type="text"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(''); }}
                className="w-full pl-11 pr-4 py-3.5 rounded-xl border-2 text-base outline-none transition-colors"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
                onFocus={e => e.currentTarget.style.borderColor = 'var(--primary)'}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
                placeholder="Email ou matricule"
                autoFocus
                autoComplete="username"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              Mot de passe
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: 'var(--text-muted)' }} />
              <input
                type="password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
                className="w-full pl-11 pr-4 py-3.5 rounded-xl border-2 text-base outline-none transition-colors"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
                onFocus={e => e.currentTarget.style.borderColor = 'var(--primary)'}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !email.trim() || !password}
            className="w-full py-4 rounded-xl font-bold text-white text-base flex items-center justify-center gap-2 disabled:opacity-60 transition-opacity"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <LogIn className="w-5 h-5" />}
            {loading ? 'Connexion...' : 'Se connecter'}
          </button>
        </form>

        <p className="text-center text-xs mt-6" style={{ color: 'var(--text-muted)' }}>
          Entrée = valider · Échap = annuler
        </p>
      </div>
    </div>
  );
}

function TicketIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
      <path d="M13 5v2M13 17v2M13 11v2" />
    </svg>
  );
}
