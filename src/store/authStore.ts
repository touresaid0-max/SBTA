import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase } from '@/services/supabase';

export type SBTARole =
  | 'admin' | 'dg' | 'daf' | 'comptable' | 'rh'
  | 'gestionnaire' | 'planificateur' | 'charge_achat'
  | 'chauffeur' | 'guichetier' | 'chef_garage'
  | 'mecanicien' | 'pompiste' | 'chef_gare'
  | 'bagagiste'
  | 'superviseur_colis' | 'agent_colis'
  | 'agent_reservation'
  | 'carburant' | 'gerant_principal'
  | 'responsable_assurance'
  | 'responsable_logistique'
  | 'logistique'
  | 'agent_qhse'
  | 'gestion_agboville'
  | 'gestionnaire_borne'
  | 'client';

export type UserRole = SBTARole;

export interface UserProfile {
  id: string;
  first_name: string;
  last_name: string;
  full_name?: string;
  email: string;
  phone?: string;
  avatar_url?: string;
  role: SBTARole;
  organization_id?: string;
  company_id?: string;
  assigned_company_ids?: string[];
  station_id?: string | null;
  station_name?: string | null;
  station_phone?: string | null;
  employee_id?: string;
  colis_direction?: string[] | null;
  status: string;
  permissions: string[];
  loyalty_points?: number;
  loyalty_tier?: string;
  loyalty_card_number?: string;
  driver_average_rating?: number;
  driver_performance_level?: string;
  is_active?: boolean;
  assistance_gp?: boolean;
  tpe_pos_enabled?: boolean;
  tpe_mode?: 'sans_guichet' | 'avec_guichet';
}

interface AuthState {
  user: UserProfile | null;
  session: unknown | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  initialized: boolean;

  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  register: (email: string, password: string, fullName: string, phone?: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  fetchProfile: (userId?: string) => Promise<void>;
  updateProfile: (data: Partial<UserProfile>) => Promise<void>;
  hasPermission: (permName: string) => boolean;
  hasRole: (roles: SBTARole | SBTARole[]) => boolean;
  initialize: () => Promise<void>;
}

let _isPrinting = false;
let _printingTimeout: ReturnType<typeof setTimeout> | null = null;
export function setPrintingGuard(active: boolean) {
  if (_printingTimeout) { clearTimeout(_printingTimeout); _printingTimeout = null; }
  if (active) {
    _isPrinting = true;
  } else {
    // Keep the guard active for 10 seconds after printing ends to cover
    // async token refresh failures that fire after the print dialog closes
    _printingTimeout = setTimeout(() => { _isPrinting = false; }, 10000);
  }
}
export function isPrintingActive() { return _isPrinting; }

// Also listen to native beforeprint/afterprint to catch any print trigger
if (typeof window !== 'undefined') {
  window.addEventListener('beforeprint', () => { setPrintingGuard(true); });
  window.addEventListener('afterprint', () => { setPrintingGuard(false); });
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      session: null,
      isLoading: false,
      isAuthenticated: false,
      initialized: false,

      initialize: async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession();

          if (session?.user) {
            set({ session, isAuthenticated: true });
            await get().fetchProfile();
          }

          supabase.auth.onAuthStateChange((event, session) => {
            (async () => {
              if (_isPrinting && (event === 'SIGNED_OUT' || (!session && event !== 'SIGNED_IN'))) return;
              if (event === 'SIGNED_IN' && session?.user) {
                set({ session, isAuthenticated: true });
                await get().fetchProfile();
              } else if (event === 'SIGNED_OUT') {
                if (_isPrinting) return;
                const user = get().user;
                const TRACKED = ['guichetier', 'chef_gare', 'bagagiste', 'agent_colis', 'chauffeur', 'comptable'];
                if (user && TRACKED.includes(user.role)) {
                  const today = new Date().toISOString().split('T')[0];
                  const nowIso = new Date().toISOString();
                  supabase.from('user_sessions').update({ logged_out_at: nowIso })
                    .eq('user_id', user.id).eq('session_date', today).is('logged_out_at', null).then(() => {});
                  if (user.role === 'guichetier') {
                    supabase.from('counter_shifts').update({ ended_at: nowIso })
                      .eq('user_id', user.id).eq('shift_date', today).is('ended_at', null).then(() => {});
                  }
                }
                set({ user: null, session: null, isAuthenticated: false });
              } else if (event === 'PASSWORD_RECOVERY') {
                set({ session, isAuthenticated: true });
              }
            })();
          });

          // On init, if guichetier has a stale open session from a previous day, close it
          const initUser = get().user;
          if (initUser?.role === 'guichetier') {
            const today = new Date().toISOString().split('T')[0];
            supabase.from('user_sessions')
              .update({ logged_out_at: new Date().toISOString() })
              .eq('user_id', initUser.id)
              .is('logged_out_at', null)
              .neq('session_date', today)
              .then(() => {});
          }
        } catch (error) {
          console.error('Error initializing auth:', error);
        } finally {
          set({ initialized: true });
        }
      },

      login: async (email, password) => {
        set({ isLoading: true });
        try {
          const { data, error } = await supabase.auth.signInWithPassword({ email, password });
          if (error) throw error;

          set({ session: data.session, isAuthenticated: true });
          await get().fetchProfile(data.user.id);

          const profile = get().user;
          if (!profile) throw new Error('Profil introuvable. Contactez votre administrateur.');

          // Record login session for guichetiers
          if (profile.role === 'guichetier') {
            const today = new Date().toISOString().split('T')[0];
            // Close any stale open sessions first
            await supabase
              .from('user_sessions')
              .update({ logged_out_at: new Date().toISOString() })
              .eq('user_id', profile.id)
              .eq('session_date', today)
              .is('logged_out_at', null);
            // Create new session
            await supabase.from('user_sessions').insert({
              user_id: profile.id,
              station_id: profile.station_id || null,
              session_date: today,
              logged_in_at: new Date().toISOString(),
            });
            // Close stale open counter_shifts, then create new one if assigned
            await supabase
              .from('counter_shifts')
              .update({ ended_at: new Date().toISOString() })
              .eq('user_id', profile.id)
              .eq('shift_date', today)
              .is('ended_at', null);
            const { data: counter } = await supabase
              .from('counters')
              .select('id, station_id')
              .eq('assigned_user_id', profile.id)
              .eq('is_active', true)
              .maybeSingle();
            if (counter) {
              await supabase.from('counter_shifts').insert({
                counter_id: counter.id,
                user_id: profile.id,
                station_id: counter.station_id,
                shift_date: today,
                started_at: new Date().toISOString(),
              }).then(() => {});
            }
          }

          // Record session for all tracked roles
          const TRACKED_ROLES = ['guichetier', 'chef_gare', 'bagagiste', 'agent_colis', 'chauffeur', 'comptable'];
          if (TRACKED_ROLES.includes(profile.role) && profile.role !== 'guichetier') {
            const today = new Date().toISOString().split('T')[0];
            await supabase
              .from('user_sessions')
              .update({ logged_out_at: new Date().toISOString() })
              .eq('user_id', profile.id)
              .eq('session_date', today)
              .is('logged_out_at', null);
            await supabase.from('user_sessions').insert({
              user_id: profile.id,
              station_id: profile.station_id || null,
              session_date: today,
              logged_in_at: new Date().toISOString(),
            });
          }

          // Update presence
          supabase.from('users').update({ last_seen_at: new Date().toISOString() }).eq('id', profile.id).then(() => {});
        } finally {
          set({ isLoading: false });
        }
      },

      logout: async () => {
        const { user } = get();
        // Record logout for tracked roles
        if (user) {
          const TRACKED_ROLES = ['guichetier', 'chef_gare', 'bagagiste', 'agent_colis', 'chauffeur', 'comptable'];
          if (TRACKED_ROLES.includes(user.role)) {
            const today = new Date().toISOString().split('T')[0];
            const nowIso = new Date().toISOString();
            await supabase
              .from('user_sessions')
              .update({ logged_out_at: nowIso })
              .eq('user_id', user.id)
              .eq('session_date', today)
              .is('logged_out_at', null);
          }
          if (user.role === 'guichetier') {
            const today = new Date().toISOString().split('T')[0];
            const nowIso = new Date().toISOString();
            const { data: openShift } = await supabase
              .from('counter_shifts')
              .select('id')
              .eq('user_id', user.id)
              .eq('shift_date', today)
              .is('ended_at', null)
              .maybeSingle();
            if (openShift) {
              await supabase
                .from('counter_shifts')
                .update({ ended_at: nowIso })
                .eq('id', openShift.id);
            }
          }
        }
        await supabase.auth.signOut();
        set({ user: null, session: null, isAuthenticated: false });
      },

      register: async (email, password, fullName, phone) => {
        set({ isLoading: true });
        try {
          const nameParts = fullName.trim().split(' ');
          const first_name = nameParts[0] || fullName;
          const last_name = nameParts.slice(1).join(' ') || '';

          const { data, error } = await supabase.auth.signUp({ email, password });
          if (error) throw error;
          if (!data.user) throw new Error('Échec de la création du compte');

          const { error: profileError } = await supabase.from('users').insert({
            id: data.user.id,
            email,
            full_name: fullName,
            first_name,
            last_name,
            phone: phone || null,
            role: 'client',
            status: 'active',
            is_self_registered: true,
          });
          if (profileError) throw profileError;

          set({ session: data.session, isAuthenticated: true });
          await get().fetchProfile();
        } finally {
          set({ isLoading: false });
        }
      },

      resetPassword: async (email) => {
        set({ isLoading: true });
        try {
          const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/reset-password`,
          });
          if (error) throw error;
        } finally {
          set({ isLoading: false });
        }
      },

      fetchProfile: async (userId?: string) => {
        let uid = userId;
        if (!uid) {
          const { data: { user: authUser } } = await supabase.auth.getUser();
          uid = authUser?.id;
        }
        if (!uid) return;

        // 1. Chercher dans users (profil standard)
        let profile: Record<string, unknown> | null = null;
        let profileSource: 'users' | 'employees' = 'users';

        for (let attempt = 0; attempt < 3; attempt++) {
          const { data, error } = await supabase
            .from('users')
            .select('*, stations!users_station_id_fkey(id, name, phone)')
            .eq('id', uid)
            .maybeSingle();

          if (error) { console.error('fetchProfile users error:', error); break; }
          if (data) { profile = data; break; }
          if (attempt < 2) await new Promise(r => setTimeout(r, 300));
        }

        // 2. Fallback : chercher dans employees via auth_user_id
        if (!profile) {
          const { data: empData } = await supabase
            .from('employees')
            .select('*')
            .eq('auth_user_id', uid)
            .maybeSingle();

          if (empData) {
            profileSource = 'employees';
            profile = {
              ...empData,
              id:        uid,
              email:     empData.professional_email ?? empData.personal_email ?? '',
              full_name: `${empData.first_name ?? ''} ${empData.last_name ?? ''}`.trim(),
              status:    empData.account_status === 'active' ? 'active' : empData.account_status,
              is_active: empData.account_status === 'active',
            };
          }
        }

        if (!profile) return;

        // 3. Charger les permissions
        const { data: roleData } = await supabase
          .from('roles')
          .select('id')
          .eq('name', profile.role)
          .maybeSingle();

        let permissions: string[] = [];
        if (roleData?.id) {
          const { data: permsData } = await supabase
            .from('role_permissions')
            .select('permissions(name)')
            .eq('role_id', roleData.id)
            .eq('granted', true);

          permissions = permsData?.map(
            (p: unknown) => (p as { permissions: { name: string } }).permissions?.name
          ).filter(Boolean) ?? [];
        }

        // 4. Si le profil vient de employees, mettre à jour last_login dans users quand même
        if (profileSource === 'users') {
          supabase.from('users')
            .update({ last_login: new Date().toISOString() })
            .eq('id', uid)
            .then();
        }

        // Extraire les infos de gare depuis la relation jointe (si disponible)
        const stationData = (profile as any).stations as { id: string; name: string; phone: string } | null | undefined;

        // 5. Si le profil est un comptable, charger les sociétés affectées
        let assignedCompanyIds: string[] | undefined;
        if ((profile as any).role === 'comptable') {
          const { data: ccData } = await supabase
            .from('comptable_companies')
            .select('company_id')
            .eq('user_id', uid);
          assignedCompanyIds = (ccData ?? []).map((c: any) => c.company_id);
        }

        set({
          user: {
            ...profile,
            permissions,
            assigned_company_ids: assignedCompanyIds,
            station_name:  stationData?.name  ?? (profile as any).station_name  ?? null,
            station_phone: stationData?.phone ?? (profile as any).station_phone ?? null,
          } as UserProfile,
          isAuthenticated: true,
        });
      },

      updateProfile: async (data) => {
        const { user } = get();
        if (!user) return;
        const { error } = await supabase.from('users').update(data).eq('id', user.id);
        if (error) throw error;
        set({ user: { ...user, ...data } });
      },

      hasPermission: (permName) => {
        const { user } = get();
        return user?.permissions?.includes(permName) ?? false;
      },

      hasRole: (roles) => {
        const { user } = get();
        if (!user) return false;
        const rolesArray = Array.isArray(roles) ? roles : [roles];
        return rolesArray.includes(user.role);
      },
    }),
    { 
      name: 'sbta-auth',
      partialize: (state) => ({
        user: state.user,
        session: state.session,
        isAuthenticated: state.isAuthenticated,
        initialized: state.initialized,
      }),
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;
          return JSON.parse(str);
        },
        setItem: (name, value) => {
          localStorage.setItem(name, JSON.stringify(value));
        },
        removeItem: (name) => {
          localStorage.removeItem(name);
        },
      },
    }
  )
);

export const ROLE_REDIRECTS: Record<SBTARole, string> = {
  admin: '/admin/dashboard',
  dg: '/daf/dashboard',
  daf: '/daf/dashboard',
  comptable: '/comptable/dashboard',
  rh: '/rh/dashboard',
  gestionnaire: '/gestionnaire/dashboard',
  planificateur: '/planificateur/dashboard',
  charge_achat: '/charge-achat/dashboard',
  chauffeur: '/chauffeur/dashboard',
  guichetier: '/guichetier/dashboard',
  chef_garage: '/garage/dashboard',
  mecanicien: '/mecanicien/dashboard',
  pompiste: '/pompiste/dashboard',
  chef_gare: '/chef-gare/dashboard',
  bagagiste: '/bagagiste/baggage',
  superviseur_colis: '/superviseur-colis/dashboard',
  agent_colis: '/agent-colis/dashboard',
  agent_reservation: '/agent-reservation/dashboard',
  carburant: '/carburant/dashboard',
  gerant_principal: '/gerant-principal/dashboard',
  gestionnaire_borne: '/bornes/admin/dashboard',
  // assistance_gp users land on stock; handled in login flow via user.assistance_gp
  responsable_assurance: '/assurance/dashboard',
  responsable_logistique: '/logistique/dashboard',
  logistique: '/logistique/vehicles',
  agent_qhse: '/rh/dashboard',
  gestion_agboville: '/gestion-agboville/dashboard',
  client: '/client/search',
};
