import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '../services/supabase';

type MobileUser = {
  id: string;
  email: string | null;
  fullName: string;
  phone: string;
};

type MobileAuthContextValue = {
  user: MobileUser | null;
  loading: boolean;
  register: (input: {
    fullName: string;
    phone: string;
    email: string;
    password: string;
  }) => Promise<void>;
  verifyOtp: (phone: string, code: string) => Promise<void>;
  resendOtp: (phone: string) => Promise<void>;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const MobileAuthContext = createContext<MobileAuthContextValue | undefined>(undefined);

const OTP_FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mobile-otp`;

async function callOtpFunction(payload: Record<string, string>) {
  const resp = await fetch(OTP_FN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(payload),
  });
  let body: { error?: string; success?: boolean } = {};
  try {
    body = await resp.json();
  } catch {
    body = {};
  }
  if (!resp.ok || body.error) {
    throw new Error(body.error || 'Une erreur est survenue.');
  }
  return body;
}

async function loadProfile(userId: string, fallbackEmail: string | null): Promise<MobileUser> {
  const { data } = await supabase
    .from('users')
    .select('full_name, first_name, last_name, phone, email')
    .eq('id', userId)
    .maybeSingle();
  const fullName =
    data?.full_name ||
    [data?.first_name, data?.last_name].filter(Boolean).join(' ') ||
    'Client SBTA';
  return {
    id: userId,
    email: data?.email ?? fallbackEmail,
    fullName,
    phone: data?.phone ?? '',
  };
}

export function MobileAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MobileUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    // Filet de sécurité : même si getSession() traîne (rafraîchissement de token
    // sur réseau mobile lent, ex. au retour depuis l'app Wave), on débloque l'UI.
    const safety = setTimeout(() => { if (active) setLoading(false); }, 8000);
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!active) return;
        if (data.session?.user) {
          try {
            const profile = await loadProfile(data.session.user.id, data.session.user.email ?? null);
            if (active) setUser(profile);
          } catch {
            // Profil non chargeable : on conserve au moins l'identité de session.
            if (active) {
              setUser({
                id: data.session.user.id,
                email: data.session.user.email ?? null,
                fullName: 'Client SBTA',
                phone: '',
              });
            }
          }
        }
      } catch {
        // Session illisible : l'utilisateur retombera sur l'écran de connexion.
      } finally {
        if (active) { clearTimeout(safety); setLoading(false); }
      }
    })();
    return () => {
      active = false;
      clearTimeout(safety);
    };
  }, []);

  async function register(input: {
    fullName: string;
    phone: string;
    email: string;
    password: string;
  }) {
    await callOtpFunction({
      action: 'register',
      fullName: input.fullName.trim(),
      phone: input.phone.trim(),
      email: input.email.trim(),
      password: input.password,
    });
  }

  async function verifyOtp(phone: string, code: string) {
    await callOtpFunction({ action: 'verify', phone: phone.trim(), code });
  }

  async function resendOtp(phone: string) {
    await callOtpFunction({ action: 'resend', phone: phone.trim() });
  }

  async function login(identifier: string, password: string) {
    let email = identifier.trim();
    const isPhone = !email.includes('@');
    if (isPhone) {
      const { data } = await supabase
        .from('users')
        .select('email')
        .eq('phone', identifier.trim())
        .maybeSingle();
      if (!data?.email) throw new Error('Aucun compte trouvé pour ce numéro.');
      email = data.email;
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error('Identifiants incorrects.');
    if (data.user) {
      const profile = await loadProfile(data.user.id, data.user.email ?? null);
      setUser(profile);
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    setUser(null);
  }

  return (
    <MobileAuthContext.Provider value={{ user, loading, register, verifyOtp, resendOtp, login, logout }}>
      {children}
    </MobileAuthContext.Provider>
  );
}

export function useMobileAuth() {
  const ctx = useContext(MobileAuthContext);
  if (!ctx) throw new Error('useMobileAuth must be used within MobileAuthProvider');
  return ctx;
}
