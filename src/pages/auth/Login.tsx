import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore, ROLE_REDIRECTS } from '../../store/authStore';
import { Bus, Eye, EyeOff, ArrowRight, Shield, Zap, Globe } from 'lucide-react';
import toast from 'react-hot-toast';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const { login, isLoading } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password) {
      toast.error('Veuillez remplir tous les champs');
      return;
    }

    try {
      await login(email, password);
      const user = useAuthStore.getState().user;

      if (user?.role) {
        const redirectPath = ROLE_REDIRECTS[user.role] ?? '/';
        toast.success('Connexion réussie');
        navigate(redirectPath, { replace: true });
      } else {
        toast.error('Profil introuvable. Contactez votre administrateur.');
      }
    } catch (error: any) {
      console.error('Login error:', error);
      toast.error(error.message || 'Erreur de connexion');
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left panel – brand hero */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden flex-col justify-between p-12" style={{ background: 'linear-gradient(145deg, #083d1e 0%, #0B7439 50%, #14a354 100%)' }}>
        {/* Background pattern */}
        <div className="absolute inset-0 opacity-10">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
                <path d="M 60 0 L 0 0 0 60" fill="none" stroke="white" strokeWidth="1"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        </div>

        {/* Floating circles decoration */}
        <div className="absolute top-20 right-16 w-64 h-64 rounded-full opacity-10" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.4) 0%, transparent 70%)' }} />
        <div className="absolute bottom-32 left-8 w-48 h-48 rounded-full opacity-10" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.4) 0%, transparent 70%)' }} />
        <div className="absolute bottom-64 right-24 w-32 h-32 rounded-full opacity-15" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.5) 0%, transparent 70%)' }} />

        {/* Logo */}
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <img src="/logosbta.png" alt="SBTA" className="w-16 h-16 object-contain" />
            <div>
              <span className="text-[35px] font-bold text-white tracking-wider">SBTA</span>
              <p className="text-xs text-green-200 font-medium leading-tight max-w-[180px]">SOCIETE BONKOUNGOU TRANSPORT DE L'AGNEBY</p>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="relative z-10 space-y-8">
          <div>
            <h2 className="text-5xl font-bold text-white leading-tight mb-4">
              Gérez votre flotte
              <br />
              <span style={{ color: '#86efac' }}>en toute simplicité</span>
            </h2>
            <p className="text-green-100 text-lg leading-relaxed max-w-sm">
              Plateforme tout-en-un pour la gestion des bus, chauffeurs, réservations et maintenance.
            </p>
          </div>

          {/* Feature pills */}
          <div className="space-y-3">
            {[
              { icon: Shield, text: 'Sécurité et traçabilité en temps réel' },
              { icon: Zap, text: 'Tableaux de bord instantanés' },
              { icon: Globe, text: 'Couverture multi-compagnies' },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3 group">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}>
                  <Icon className="w-4 h-4 text-green-200" />
                </div>
                <span className="text-green-100 text-sm font-medium">{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom stats */}
        <div className="relative z-10 grid grid-cols-3 gap-4">
          {[
            { value: '500+', label: 'Voyages/mois' },
            { value: '400+', label: 'Bus actifs' },
            { value: '3', label: 'Compagnies' },
          ].map(({ value, label }) => (
            <div key={label} className="rounded-xl p-4" style={{ backgroundColor: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)' }}>
              <div className="text-2xl font-bold text-white">{value}</div>
              <div className="text-xs text-green-200 font-medium mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel – login form */}
      <div className="flex-1 flex items-center justify-center p-8" style={{ backgroundColor: '#fafbfa' }}>
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="flex lg:hidden items-center justify-center gap-3 mb-10">
            <img src="/logosbta.png" alt="SBTA" className="w-14 h-14 object-contain" />
            <div>
              <span className="text-2xl font-bold" style={{ color: '#1A2E22' }}>SBTA</span>
              <p className="text-xs" style={{ color: '#4A6B55' }}>SOCIETE BONKOUNGOU TRANSPORT DE L'AGNEBY</p>
            </div>
          </div>

          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-2" style={{ color: '#1A2E22' }}>Bienvenue</h1>
            <p style={{ color: '#4A6B55' }}>Connectez-vous à votre espace de travail</p>
          </div>

          {/* Form card */}
          <div className="rounded-2xl p-8 shadow-xl shadow-green-900/5" style={{ backgroundColor: '#ffffff', border: '1px solid #E2EAE5' }}>
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Email */}
              <div>
                <label htmlFor="email" className="block text-sm font-semibold mb-2" style={{ color: '#1A2E22' }}>
                  Adresse e-mail
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all duration-200"
                  style={{
                    border: '1.5px solid #E2EAE5',
                    color: '#1A2E22',
                    backgroundColor: '#f8faf8',
                  }}
                  placeholder="votre@email.com"
                  onFocus={e => (e.target.style.borderColor = '#0B7439')}
                  onBlur={e => (e.target.style.borderColor = '#E2EAE5')}
                />
              </div>

              {/* Password */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label htmlFor="password" className="block text-sm font-semibold" style={{ color: '#1A2E22' }}>
                    Mot de passe
                  </label>
                  <Link
                    to="/forgot-password"
                    className="text-xs font-medium hover:underline transition-colors"
                    style={{ color: '#0B7439' }}
                  >
                    Oublié?
                  </Link>
                </div>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full px-4 py-3 pr-12 rounded-xl text-sm outline-none transition-all duration-200"
                    style={{
                      border: '1.5px solid #E2EAE5',
                      color: '#1A2E22',
                      backgroundColor: '#f8faf8',
                    }}
                    placeholder="••••••••"
                    onFocus={e => (e.target.style.borderColor = '#0B7439')}
                    onBlur={e => (e.target.style.borderColor = '#E2EAE5')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 transition-colors"
                    style={{ color: '#8AA898' }}
                    onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#0B7439')}
                    onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#8AA898')}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed group mt-2"
                style={{
                  background: isLoading ? '#0B7439' : 'linear-gradient(135deg, #0B7439 0%, #14a354 100%)',
                  color: '#ffffff',
                  boxShadow: '0 4px 15px rgba(11, 116, 57, 0.35)',
                }}
                onMouseEnter={e => { if (!isLoading) (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 6px 20px rgba(11, 116, 57, 0.5)'; }}
                onMouseLeave={e => { if (!isLoading) (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 15px rgba(11, 116, 57, 0.35)'; }}
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                    Connexion en cours...
                  </>
                ) : (
                  <>
                    Se connecter
                    <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1" />
                  </>
                )}
              </button>
            </form>

            {/* Divider */}
            <div className="flex items-center gap-3 my-6">
              <div className="flex-1 h-px" style={{ backgroundColor: '#E2EAE5' }} />
              <span className="text-xs font-medium" style={{ color: '#8AA898' }}>ou</span>
              <div className="flex-1 h-px" style={{ backgroundColor: '#E2EAE5' }} />
            </div>

            {/* Register link */}
            <p className="text-center text-sm" style={{ color: '#4A6B55' }}>
              Pas encore de compte?{' '}
              <Link
                to="/register"
                className="font-semibold hover:underline transition-colors"
                style={{ color: '#0B7439' }}
              >
                Créer un compte
              </Link>
            </p>
          </div>

          {/* Security note */}
          <div className="mt-6 flex items-center justify-center gap-2">
            <Shield className="w-3.5 h-3.5" style={{ color: '#8AA898' }} />
            <p className="text-xs text-center" style={{ color: '#8AA898' }}>
              Connexion sécurisée SSL — Vos données sont protégées
            </p>
          </div>

          {/* Footer */}
          <p className="mt-4 text-center text-xs" style={{ color: '#B0C4BA' }}>
            Propulsé par <span className="font-semibold" style={{ color: '#8AA898' }}>EAFRIBUS IT GROUP</span>
          </p>
        </div>
      </div>
    </div>
  );
}
