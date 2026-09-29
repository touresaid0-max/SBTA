import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Monitor, Lock, Mail, AlertCircle, Loader2, LogOut } from 'lucide-react';
import { useAuthStore, ROLE_REDIRECTS } from '@/store/authStore';

export default function KioskLogin() {
  const navigate = useNavigate();
  const { user, isAuthenticated, login, logout, isLoading } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Redirect if already logged in as gestionnaire_borne or admin
  useEffect(() => {
    if (isAuthenticated && user && (user.role === 'gestionnaire_borne' || user.role === 'admin')) {
      navigate('/bornes/admin/dashboard', { replace: true });
    }
  }, [isAuthenticated, user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError('Veuillez saisir votre email et mot de passe');
      return;
    }
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      // The authStore will set the user; check role after login
      const state = useAuthStore.getState();
      if (state.user) {
        if (state.user.role === 'gestionnaire_borne' || state.user.role === 'admin') {
          navigate('/bornes/admin/dashboard', { replace: true });
        } else {
          // Redirect to their normal dashboard
          const redirect = ROLE_REDIRECTS[state.user.role as keyof typeof ROLE_REDIRECTS] ?? '/';
          navigate(redirect, { replace: true });
        }
      }
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('credentials')) {
        setError('Identifiants invalides. Vérifiez votre email et mot de passe.');
      } else if (msg.toLowerCase().includes('disabled') || msg.toLowerCase().includes('suspended')) {
        setError('Votre compte est désactivé. Contactez l\'administrateur.');
      } else {
        setError(msg || 'Erreur de connexion');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0B7439 0%, #0a5d2e 100%)' }}>
      <div className="w-full max-w-md mx-4">
        {/* Logo and title */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center mx-auto mb-4">
            <Monitor className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">Espace Bornes</h1>
          <p className="text-white/80 mt-2">Gestion des bornes digitales SBTA</p>
        </div>

        {/* Login card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {isAuthenticated && user && user.role !== 'gestionnaire_borne' && user.role !== 'admin' && (
            <div className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-center gap-2 text-sm text-amber-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>Vous êtes connecté en tant que {user.role}. Déconnectez-vous pour accéder à l'espace bornes.</span>
              <button onClick={() => logout()} className="ml-auto flex-shrink-0 text-amber-700 font-semibold underline">
                Déconnecter
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-[#1A2E22] mb-1.5">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="gestionnaire.borne@sbta.ci"
                  autoComplete="email"
                  className="w-full pl-11 pr-4 py-3 border border-[#E2EAE5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/30"
                  disabled={submitting}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#1A2E22] mb-1.5">Mot de passe</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full pl-11 pr-4 py-3 border border-[#E2EAE5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/30"
                  disabled={submitting}
                />
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 flex items-center gap-2 text-sm text-red-600">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || isLoading}
              className="w-full py-3 rounded-xl font-semibold text-white transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              style={{ backgroundColor: '#0B7439' }}
            >
              {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Se connecter'}
            </button>
          </form>

          {isAuthenticated && user && (user.role === 'gestionnaire_borne' || user.role === 'admin') && (
            <button
              onClick={() => logout()}
              className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-[#E2EAE5] text-sm font-medium text-[#6B7280] hover:bg-[#F8FAF8]"
            >
              <LogOut className="w-4 h-4" /> Se déconnecter
            </button>
          )}
        </div>

        <p className="text-center text-white/60 text-sm mt-6">
          Accès réservé au Gestionnaire Borne et à l'Administrateur
        </p>
      </div>
    </div>
  );
}
