import { useState, useEffect } from 'react';
import { X, Eye, EyeOff, RefreshCw, CheckCircle, User, MapPin, Search } from 'lucide-react';
import { createAccountByAdmin, type PendingEmployee } from '../../services/employeeAccount.service';
import { generateSecurePassword } from '../../utils/generatePassword';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrateur',
  dg: 'Directeur Général',
  daf: 'Directeur Financier',
  comptable: 'Comptable',
  rh: 'Responsable RH',
  gestionnaire: 'Gestionnaire',
  planificateur: 'Planificateur',
  charge_achat: "Chargé d'Achat",
  chauffeur: 'Chauffeur',
  guichetier: 'Guichetier',
  agent_reservation: 'Agent Réservation',
  chef_garage: 'Chef Garage',
  chef_gare: 'Chef Gare',
  mecanicien: 'Technicien',
  pompiste: 'Pompiste',
  bagagiste: 'Bagagiste',
  carburant: 'Carburant',
  agent_colis: 'Agent Courrier',
  superviseur_colis: 'Superviseur Courrier',
  gerant_principal: 'Gérant Principal',
  responsable_assurance: 'Responsable Service Assurance',
  responsable_logistique: 'Responsable Logistique',
  logistique: 'Logistique',
  agent_qhse: 'Agent QHSE',
  gestion_agboville: 'Gestion Agboville',
};

function passwordStrength(pwd: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pwd.length >= 8) score++;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;

  if (score <= 1) return { score, label: 'Très faible', color: '#AF3029' };
  if (score === 2) return { score, label: 'Faible', color: '#D97706' };
  if (score === 3) return { score, label: 'Moyen', color: '#F59E0B' };
  if (score === 4) return { score, label: 'Fort', color: '#0B7439' };
  return { score, label: 'Très fort', color: '#065F46' };
}

interface Route {
  id: string;
  name: string;
  base_price: number;
}

interface Props {
  employee: PendingEmployee;
  onClose: () => void;
  onSuccess: () => void;
}

export default function CreateAccountModal({ employee, onClose, onSuccess }: Props) {
  const [email, setEmail] = useState(employee.professional_email ?? employee.personal_email ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [sendWelcomeEmail, setSendWelcomeEmail] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selectedRouteIds, setSelectedRouteIds] = useState<string[]>([]);
  const [routeSearch, setRouteSearch] = useState('');
  const [routeOpen, setRouteOpen] = useState(false);

  const isGuichetier = employee.role === 'guichetier';

  useEffect(() => {
    if (!isGuichetier) return;
    supabase.from('routes').select('id, name, base_price').eq('is_active', true).order('name')
      .then(({ data }) => { if (data) setRoutes(data as Route[]); });
  }, [isGuichetier]);

  useEffect(() => {
    if (!isGuichetier) return;
    supabase.from('employees').select('assigned_route_ids').eq('id', employee.id).maybeSingle()
      .then(({ data }) => {
        if (data?.assigned_route_ids) setSelectedRouteIds(data.assigned_route_ids as string[]);
      });
  }, [isGuichetier, employee.id]);

  const strength = passwordStrength(password);
  const canSubmit = email.trim().length > 0 && password.length >= 8 && !isCreating;

  const handleGenerate = () => {
    const pwd = generateSecurePassword(12);
    setPassword(pwd);
    setShowPassword(true);
  };

  const handleCreateAccount = async () => {
    if (!canSubmit) return;
    setIsCreating(true);
    try {
      await createAccountByAdmin({
        employee_id: employee.id,
        email: email.trim(),
        password,
        send_welcome_email: sendWelcomeEmail,
        ...(isGuichetier ? { assigned_route_ids: selectedRouteIds } : {}),
      });
      toast.success(`Compte créé pour ${employee.first_name} ${employee.last_name}`);
      onSuccess();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erreur lors de la création du compte');
    } finally {
      setIsCreating(false);
    }
  };

  const availableRoutes = routes.filter(r =>
    !selectedRouteIds.includes(r.id) &&
    (routeSearch.trim() ? r.name.toLowerCase().includes(routeSearch.trim().toLowerCase()) : true)
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: '#E2EAE5' }}>
          <h2 className="text-lg font-bold" style={{ color: '#1A2E22' }}>
            Créer le compte de connexion
          </h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="w-5 h-5" style={{ color: '#8AA898' }} />
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          {/* Résumé employé */}
          <div className="rounded-2xl p-4 flex items-center gap-4" style={{ backgroundColor: '#F8FAF8' }}>
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center font-bold text-xl flex-shrink-0"
              style={{ backgroundColor: '#d4edda', color: '#0B7439' }}
            >
              {employee.avatar_url ? (
                <img src={employee.avatar_url} className="w-full h-full rounded-full object-cover" alt="" />
              ) : (
                <>{employee.first_name[0]}{employee.last_name[0]}</>
              )}
            </div>
            <div>
              <div className="font-bold text-base" style={{ color: '#1A2E22' }}>
                {employee.first_name} {employee.last_name}
              </div>
              <div className="text-sm" style={{ color: '#4A6B55' }}>
                {ROLE_LABELS[employee.role] ?? employee.role}
                {employee.company_name ? ` · ${employee.company_name}` : ' · HOLDING'}
              </div>
              {employee.employee_id && (
                <div className="text-xs" style={{ color: '#8AA898' }}>
                  Matricule : {employee.employee_id}
                </div>
              )}
            </div>
          </div>

          {/* Note informative */}
          <div className="rounded-xl p-3 text-sm border" style={{ backgroundColor: '#DBEAFE', borderColor: '#1D6FA4', color: '#1D6FA4' }}>
            <strong>Information :</strong> Vous créez uniquement les identifiants de connexion.
            Les données RH ont déjà été saisies par le Responsable RH.
          </div>

          {/* Itinéraires (guichetier only) */}
          {isGuichetier && (
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: '#1A2E22' }}>
                Itinéraires
              </label>
              <p className="text-xs mb-2" style={{ color: '#8AA898' }}>
                Sera automatiquement affecté au guichet dans Chef de Gare → Guichets → Gérer les lignes assignées. Vous pouvez sélectionner plusieurs itinéraires.
              </p>
              <div className="space-y-2">
                {selectedRouteIds.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {selectedRouteIds.map(rid => {
                      const r = routes.find(x => x.id === rid);
                      if (!r) return null;
                      return (
                        <span key={rid} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-medium" style={{ backgroundColor: '#F0FAF4', border: '1px solid #0B7439', color: '#0B7439' }}>
                          <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                          {r.name}
                          <button
                            type="button"
                            onClick={() => setSelectedRouteIds(prev => prev.filter(x => x !== rid))}
                            className="ml-0.5 p-0.5 rounded hover:bg-[#DCEEE3] transition-colors"
                            title="Retirer cet itinéraire"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
                <div className="relative">
                  <Search className="absolute left-3 top-3 w-4 h-4 text-[#9CA3AF] pointer-events-none" />
                  <input
                    value={routeSearch}
                    onChange={e => { setRouteSearch(e.target.value); setRouteOpen(true); }}
                    onFocus={() => setRouteOpen(true)}
                    onBlur={() => setTimeout(() => setRouteOpen(false), 150)}
                    className="w-full border rounded-xl px-3 py-2.5 pl-9 text-sm focus:outline-none focus:ring-2"
                    style={{ borderColor: '#E2EAE5' }}
                    placeholder={selectedRouteIds.length > 0 ? "Ajouter un autre itinéraire…" : "Rechercher un itinéraire…"}
                  />
                  {routeOpen && (
                    <div className="absolute z-20 mt-1 w-full max-h-60 overflow-auto bg-white border rounded-xl shadow-lg" style={{ borderColor: '#E2EAE5' }}>
                      {availableRoutes.length > 0 ? (
                        availableRoutes.map(r => (
                          <button
                            key={r.id}
                            type="button"
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => { setSelectedRouteIds(prev => [...prev, r.id]); setRouteSearch(''); setRouteOpen(false); }}
                            className="w-full text-left px-3 py-2.5 text-sm hover:bg-[#F0FAF4] transition-colors"
                            style={{ color: '#374151' }}
                          >
                            <span className="font-medium" style={{ color: '#1A2E22' }}>{r.name}</span>
                            <span className="ml-2" style={{ color: '#8AA898' }}>({r.base_price.toLocaleString('fr-CI')} F)</span>
                          </button>
                        ))
                      ) : (
                        <div className="px-3 py-2.5 text-sm" style={{ color: '#8AA898' }}>
                          {routes.length === 0 ? 'Aucun itinéraire disponible' : routeSearch.trim() ? `Aucun itinéraire ne correspond à « ${routeSearch} »` : 'Tous les itinéraires sont déjà sélectionnés'}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Email */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: '#1A2E22' }}>
              Email de connexion <span style={{ color: '#AF3029' }}>*</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="prenom.nom@societe.ci"
              className="w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2"
              style={{ borderColor: '#E2EAE5', focusRingColor: '#0B7439' } as React.CSSProperties}
            />
            {employee.professional_email && employee.professional_email !== email && (
              <button
                type="button"
                onClick={() => setEmail(employee.professional_email!)}
                className="text-xs hover:underline mt-1"
                style={{ color: '#0B7439' }}
              >
                Utiliser l'email saisi par le RH : {employee.professional_email}
              </button>
            )}
            {employee.personal_email && employee.personal_email !== email && employee.personal_email !== employee.professional_email && (
              <button
                type="button"
                onClick={() => setEmail(employee.personal_email!)}
                className="text-xs hover:underline mt-1 ml-3"
                style={{ color: '#4A6B55' }}
              >
                Email personnel : {employee.personal_email}
              </button>
            )}
          </div>

          {/* Mot de passe */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: '#1A2E22' }}>
              Mot de passe provisoire <span style={{ color: '#AF3029' }}>*</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 8 caractères"
                className="w-full border rounded-xl px-4 py-2.5 pr-12 text-sm focus:outline-none focus:ring-2"
                style={{ borderColor: '#E2EAE5' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2"
                style={{ color: '#8AA898' }}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            <button
              type="button"
              onClick={handleGenerate}
              className="flex items-center gap-1.5 text-xs hover:underline mt-1.5"
              style={{ color: '#0B7439' }}
            >
              <RefreshCw className="w-3 h-3" />
              Générer un mot de passe sécurisé
            </button>

            {/* Indicateur de force */}
            {password.length > 0 && (
              <div className="mt-2">
                <div className="flex gap-1 mb-1">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className="h-1.5 flex-1 rounded-full transition-colors"
                      style={{
                        backgroundColor: i <= strength.score ? strength.color : '#E2EAE5',
                      }}
                    />
                  ))}
                </div>
                <span className="text-xs font-medium" style={{ color: strength.color }}>
                  {strength.label}
                </span>
              </div>
            )}
          </div>

          {/* Option email de bienvenue */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="send_email"
              checked={sendWelcomeEmail}
              onChange={(e) => setSendWelcomeEmail(e.target.checked)}
              className="w-4 h-4 rounded"
              style={{ accentColor: '#0B7439' }}
            />
            <label htmlFor="send_email" className="text-sm cursor-pointer" style={{ color: '#4A6B55' }}>
              Envoyer les identifiants par email à l'employé
            </label>
          </div>

          {/* Récapitulatif */}
          {email.trim() && password.length >= 8 && (
            <div className="rounded-xl p-3 space-y-1 border" style={{ backgroundColor: '#d4edda', borderColor: '#0B7439' }}>
              <div className="text-xs font-bold uppercase tracking-wide" style={{ color: '#0B7439' }}>
                Récapitulatif
              </div>
              <div className="text-sm" style={{ color: '#1A2E22' }}>
                <span style={{ color: '#4A6B55' }}>Email :</span> {email}
              </div>
              <div className="text-sm" style={{ color: '#1A2E22' }}>
                <span style={{ color: '#4A6B55' }}>Mot de passe :</span> {'•'.repeat(password.length)}
              </div>
              <div className="text-sm" style={{ color: '#1A2E22' }}>
                <span style={{ color: '#4A6B55' }}>Email envoyé :</span> {sendWelcomeEmail ? 'Oui' : 'Non'}
              </div>
              {isGuichetier && selectedRouteIds.length > 0 && (
                <div className="text-sm" style={{ color: '#1A2E22' }}>
                  <span style={{ color: '#4A6B55' }}>Itinéraires :</span> {selectedRouteIds.map(id => routes.find(r => r.id === id)?.name).filter(Boolean).join(', ')}
                </div>
              )}
            </div>
          )}

          {/* Boutons */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 border rounded-xl font-medium transition-colors hover:opacity-80"
              style={{ borderColor: '#E2EAE5', color: '#4A6B55' }}
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleCreateAccount}
              disabled={!canSubmit}
              className="flex-1 py-3 rounded-xl font-bold text-white transition-colors flex items-center justify-center gap-2"
              style={{ backgroundColor: canSubmit ? '#0B7439' : '#8AA898' }}
            >
              {isCreating ? (
                <span>Création...</span>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4" />
                  Créer le compte
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Petit composant icône User avec avatar fallback (réutilisable)
export function EmployeeAvatar({ employee, size = 40 }: { employee: Pick<PendingEmployee, 'first_name' | 'last_name'>; size?: number }) {
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold flex-shrink-0"
      style={{ width: size, height: size, backgroundColor: '#d4edda', color: '#0B7439', fontSize: size * 0.35 }}
    >
      {employee.first_name[0]}{employee.last_name[0]}
    </div>
  );
}
