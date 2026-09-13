import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../services/supabase';
import { useAuthStore, ROLE_REDIRECTS } from '../../store/authStore';
import { Bus, Eye, EyeOff, CheckCircle, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';

export default function AcceptInvitation() {
  const [searchParams] = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);
  const navigate = useNavigate();
  const { fetchProfile } = useAuthStore();

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('access_token')) {
      setTokenValid(true);
    } else {
      const invToken = searchParams.get('token');
      setTokenValid(!!invToken);
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast.error('Les mots de passe ne correspondent pas');
      return;
    }

    if (password.length < 8) {
      toast.error('Le mot de passe doit contenir au moins 8 caractères');
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      if (data.user) {
        await supabase.from('users').update({
          status: 'active',
          invitation_accepted_at: new Date().toISOString(),
        }).eq('id', data.user.id);

        await fetchProfile();
        const user = useAuthStore.getState().user;
        toast.success('Invitation acceptée! Bienvenue sur SBTA');
        if (user) {
          navigate(user.assistance_gp ? '/gerant-principal/stock' : ROLE_REDIRECTS[user.role]);
        } else {
          navigate('/login');
        }
      }
    } catch (error: any) {
      toast.error(error.message || 'Erreur lors de l\'activation du compte');
    } finally {
      setIsLoading(false);
    }
  };

  if (tokenValid === null) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--bg-subtle)' }}>
        <div className="w-8 h-8 border-4 rounded-full animate-spin" style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  if (!tokenValid) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--bg-subtle)' }}>
        <div className="text-center p-8 rounded-lg shadow-lg max-w-md w-full" style={{ backgroundColor: 'var(--surface)' }}>
          <AlertCircle className="w-16 h-16 mx-auto mb-4" style={{ color: 'var(--danger)' }} />
          <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            Lien invalide ou expiré
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            Ce lien d'invitation est invalide ou a expiré. Veuillez contacter votre administrateur.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--bg-subtle)' }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-4" style={{ backgroundColor: 'var(--primary)' }}>
            <Bus className="w-8 h-8" style={{ color: 'var(--text-on-primary)' }} />
          </div>
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>SBTA</h1>
          <p className="mt-2" style={{ color: 'var(--text-secondary)' }}>Activation de votre compte</p>
        </div>

        <div className="rounded-lg shadow-lg p-8" style={{ backgroundColor: 'var(--surface)' }}>
          <div className="flex items-center gap-3 mb-6 p-3 rounded-lg" style={{ backgroundColor: 'var(--success-light)' }}>
            <CheckCircle className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--success)' }} />
            <p className="text-sm" style={{ color: 'var(--success)' }}>
              Votre invitation est valide. Définissez votre mot de passe pour activer votre compte.
            </p>
          </div>

          <h2 className="text-2xl font-semibold mb-6" style={{ color: 'var(--text-primary)' }}>
            Définir votre mot de passe
          </h2>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                Mot de passe
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="w-full px-4 py-2 pr-10 rounded-lg border focus:outline-none focus:ring-2"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-primary)', backgroundColor: 'var(--surface)' }}
                  placeholder="Minimum 8 caractères"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                Confirmer le mot de passe
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2"
                style={{ borderColor: 'var(--border)', color: 'var(--text-primary)', backgroundColor: 'var(--surface)' }}
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 rounded-lg font-medium transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--text-on-primary)' }}
            >
              {isLoading ? 'Activation...' : 'Activer mon compte'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
