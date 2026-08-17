import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Pencil, Ban, Key, User as UserIcon,
  Search, AlertCircle, CheckCircle, X, Clock, Users as UsersIcon,
  Trash2, AlertTriangle, RotateCcw, Truck,
} from 'lucide-react';
import { supabase } from '../../services/supabase';
import DataTable from '../../components/shared/DataTable';
import StatusBadge from '../../components/shared/StatusBadge';
import CreateAccountModal from '../../components/admin/CreateAccountModal';
import { fetchPendingEmployees, createAccountByAdmin, type PendingEmployee } from '../../services/employeeAccount.service';
import { deleteEmployeePermanently, reactivateEmployee } from '../../services/hr.service';
import { generateSecurePassword } from '../../utils/generatePassword';
import toast from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { UserRole } from '../../types';

interface UserRow {
  id: string;
  email: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  role: UserRole;
  avatar_url?: string;
  company_id?: string;
  station_id?: string;
  organization_id?: string;
  status: string;
  is_active: boolean;
  employee_id?: string;
  license_number?: string;
  license_expiry?: string;
  license_category?: string;
  driver_avg_rating?: number;
  driver_total_hours?: number;
  created_at?: string;
  companies?: { name: string };
  organizations?: { name: string };
}

const ROLES: { value: UserRole; label: string; color: string; group: string }[] = [
  { value: 'admin',                   label: 'Admin',                        color: '#AF3029', group: 'Direction' },
  { value: 'daf',                     label: 'DAF',                          color: '#1D6FA4', group: 'Direction' },
  { value: 'comptable',               label: 'Comptable',                    color: '#D97706', group: 'Direction' },
  { value: 'rh',                      label: 'Responsable RH',               color: '#0B7439', group: 'Direction' },
  { value: 'gestionnaire',            label: 'Gestionnaire',                 color: '#0B7439', group: 'Direction' },
  { value: 'planificateur',           label: 'Planificateur',                color: '#0B7439', group: 'Direction' },
  { value: 'charge_achat',            label: "Chargé d'Achat",              color: '#0B7439', group: 'Direction' },
  { value: 'gerant_principal',        label: 'Gérant Principal',             color: '#0B7439', group: 'Direction' },
  { value: 'responsable_assurance',   label: 'Responsable Service Assurance',color: '#0B7439', group: 'Direction' },
  { value: 'responsable_logistique',  label: 'Responsable Logistique',       color: '#0B7439', group: 'Direction' },
  { value: 'agent_qhse',              label: 'Agent QHSE',                   color: '#0B7439', group: 'Direction' },
  { value: 'gestion_agboville',       label: 'Gestion Agboville',            color: '#0B7439', group: 'Direction' },
  { value: 'chauffeur',               label: 'Chauffeur',                    color: '#1D6FA4', group: 'Opérationnel' },
  { value: 'guichetier',              label: 'Guichetier',                   color: '#0B7439', group: 'Opérationnel' },
  { value: 'agent_reservation',       label: 'Agent Réservation',            color: '#0B7439', group: 'Opérationnel' },
  { value: 'chef_garage',             label: 'Chef Garage',                  color: '#D97706', group: 'Opérationnel' },
  { value: 'chef_gare',               label: 'Chef Gare',                    color: '#D97706', group: 'Opérationnel' },
  { value: 'mecanicien',              label: 'Technicien',                   color: '#1D6FA4', group: 'Opérationnel' },
  { value: 'pompiste',                label: 'Pompiste',                     color: '#6B7280', group: 'Opérationnel' },
  { value: 'carburant',               label: 'Carburant',                    color: '#1D6FA4', group: 'Opérationnel' },
  { value: 'bagagiste',               label: 'Bagagiste',                    color: '#1D6FA4', group: 'Opérationnel' },
  { value: 'agent_colis',             label: 'Agent Courrier',               color: '#0B7439', group: 'Courrier' },
  { value: 'superviseur_colis',       label: 'Superviseur Courrier',         color: '#1D6FA4', group: 'Courrier' },
  { value: 'client',                  label: 'Client',                       color: '#6B7280', group: 'Autre' },
];

const OPERATIONAL_ROLES: UserRole[] = [
  'chauffeur', 'guichetier', 'chef_garage', 'mecanicien', 'pompiste', 'chef_gare', 'gestionnaire',
  'agent_colis', 'bagagiste', 'agent_reservation', 'carburant',
];

// Rôles nécessitant une gare d'affectation (obligatoire)
const REQUIRES_STATION: UserRole[] = ['agent_colis', 'chef_gare'];
// Rôles pouvant être affectés à une gare (facultatif)
const CAN_HAVE_STATION: UserRole[] = [...OPERATIONAL_ROLES, 'guichetier', 'bagagiste', 'agent_reservation', 'carburant'];

const LICENSE_CATEGORIES = ['A', 'B', 'C', 'D', 'E', 'F'];

interface Company { id: string; name: string }
interface Station { id: string; name: string }

const emptyForm = () => ({
  email: '',
  first_name: '',
  last_name: '',
  phone: '',
  role: 'guichetier' as UserRole,
  organization_id: '',
  company_id: '',
  station_id: '',
  employee_id: '',
  license_number: '',
  license_expiry: '',
  license_category: 'D',
  password: '',
  send_invitation: false,
  status: 'active',
});

type TabType = 'pending' | 'active' | 'inactive' | 'pending_deletion';

export default function Users() {
  const [activeTab, setActiveTab] = useState<TabType>('pending');

  // Comptes actifs
  const [users, setUsers] = useState<UserRow[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [roleFilter, setRoleFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState(emptyForm());

  // Employés en attente
  const [pendingEmployees, setPendingEmployees] = useState<PendingEmployee[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [createAccountTarget, setCreateAccountTarget] = useState<PendingEmployee | null>(null);
  const [pendingSearch, setPendingSearch] = useState('');
  const [pendingSearchFocused, setPendingSearchFocused] = useState(false);

  // Suppression définitive (admin uniquement)
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [reactivatingDeletion, setReactivatingDeletion] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    try {
      const [usersRes, empRes, companiesRes, stationsRes] = await Promise.all([
        supabase
          .from('users')
          .select('*, companies(name), organizations!users_organization_id_fkey(name)')
          .neq('role', 'client')
          .order('created_at', { ascending: false }),
        supabase
          .from('employees')
          .select('*, companies(name)')
          .neq('account_status', 'pending')
          .order('created_at', { ascending: false }),
        supabase.from('companies').select('id, name').order('name'),
        supabase.from('stations').select('id, name').eq('is_active', true).order('name'),
      ]);

      if (usersRes.error) throw usersRes.error;
      setCompanies(companiesRes.data ?? []);
      setStations(stationsRes.data ?? []);

      const usersData: UserRow[] = (usersRes.data ?? []).map(u => ({ ...u }));

      // IDs auth des employees qui ont déjà un compte users (pour dédupliquer)
      const usersIds = new Set(usersData.map(u => u.id));

      // Convertir les employees (sans compte users) vers UserRow
      const empRows: UserRow[] = (empRes.data ?? [])
        .filter(e => !e.auth_user_id || !usersIds.has(e.auth_user_id))
        .map(e => ({
          id:           e.id,
          email:        e.professional_email ?? e.personal_email ?? '',
          first_name:   e.first_name,
          last_name:    e.last_name,
          full_name:    `${e.first_name} ${e.last_name}`.trim(),
          phone:        e.phone ?? undefined,
          role:         e.role as UserRole,
          avatar_url:   e.avatar_url ?? undefined,
          company_id:   e.company_id ?? undefined,
          station_id:   e.station_id ?? undefined,
          status:       e.account_status === 'active' ? 'active'
                        : e.account_status === 'inactive' ? 'inactive'
                        : e.account_status === 'pending_deletion' ? 'pending_deletion'
                        : 'suspended',
          is_active:    e.account_status === 'active',
          employee_id:  e.employee_id ?? undefined,
          license_number:   e.license_number ?? undefined,
          license_expiry:   e.license_expiry ?? undefined,
          license_category: e.license_category ?? undefined,
          created_at:   e.created_at ?? undefined,
          companies:    e.companies ? { name: (e.companies as any).name } : undefined,
        }));

      setUsers([...usersData, ...empRows]);
    } catch {
      toast.error('Erreur lors du chargement des utilisateurs');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPending = useCallback(async () => {
    setPendingLoading(true);
    try {
      const data = await fetchPendingEmployees();
      setPendingEmployees(data);
    } catch {
      toast.error('Erreur lors du chargement des employés en attente');
    } finally {
      setPendingLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
    loadPending();
  }, [loadUsers, loadPending]);

  // Realtime : nouvel employé en attente
  useEffect(() => {
    const channel = supabase
      .channel('pending-employees-users-page')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'employees', filter: 'account_status=eq.pending' },
        (payload) => {
          const emp = payload.new as { first_name: string; last_name: string; role: string };
          toast(`Nouvel employé en attente : ${emp.first_name} ${emp.last_name} (${emp.role})`, {
            duration: 6000,
            icon: '⏳',
          });
          loadPending();
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadPending]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (!editingUser) {
        if (!formData.send_invitation && !formData.password) { toast.error('Le mot de passe est requis'); return; }
        if (!formData.send_invitation && formData.password.length < 8) { toast.error('Minimum 8 caractères'); return; }
        if (OPERATIONAL_ROLES.includes(formData.role) && !formData.company_id) { toast.error('La société est obligatoire'); return; }
        if (REQUIRES_STATION.includes(formData.role) && !formData.station_id) { toast.error("La gare d'affectation est obligatoire pour ce poste"); return; }

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { toast.error('Session expirée.'); return; }

        const payload: Record<string, unknown> = {
          email: formData.email,
          first_name: formData.first_name,
          last_name: formData.last_name,
          phone: formData.phone || null,
          role: formData.role,
          employee_id: formData.employee_id || null,
          send_invitation: formData.send_invitation,
        };
        if (!formData.send_invitation) payload.password = formData.password;
        if (OPERATIONAL_ROLES.includes(formData.role)) payload.company_id = formData.company_id || null;
        if (CAN_HAVE_STATION.includes(formData.role)) payload.station_id = formData.station_id || null;
        if (formData.role === 'chauffeur') {
          payload.license_number = formData.license_number || null;
          payload.license_expiry = formData.license_expiry || null;
          payload.license_category = formData.license_category || null;
        }

        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
          body: JSON.stringify(payload),
        });
        const result = await response.json().catch(() => ({ error: `Erreur (${response.status})` }));
        if (!response.ok) throw new Error(result.error || `Erreur ${response.status}`);
        toast.success(formData.send_invitation ? 'Invitation envoyée' : 'Utilisateur créé');
        await new Promise(r => setTimeout(r, 500));
      } else {
        // Email change is handled via a service-role edge function so the
        // login identity (auth.users) and the users row stay in sync. Other
        // fields go through the normal client update below.
        const newEmail = formData.email.trim().toLowerCase();
        const currentEmail = (editingUser.email ?? '').trim().toLowerCase();
        if (newEmail && newEmail !== currentEmail) {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) { toast.error('Session expirée.'); return; }
          const emailRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-user-email`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
            body: JSON.stringify({ user_id: editingUser.id, new_email: newEmail }),
          });
          const emailResult = await emailRes.json().catch(() => ({ error: `Erreur (${emailRes.status})` }));
          if (!emailRes.ok) throw new Error(emailResult.error || `Erreur ${emailRes.status}`);
        }

        const updateData: Record<string, unknown> = {
          first_name: formData.first_name,
          last_name: formData.last_name,
          full_name: `${formData.first_name} ${formData.last_name}`.trim(),
          phone: formData.phone || null,
          role: formData.role,
          employee_id: formData.employee_id || null,
          company_id: formData.company_id || null,
          status: formData.status,
          is_active: formData.status === 'active',
        };
        if (CAN_HAVE_STATION.includes(formData.role)) {
          updateData.station_id = formData.station_id || null;
        } else {
          updateData.station_id = null;
        }
        if (formData.role === 'chauffeur') {
          updateData.license_number = formData.license_number || null;
          updateData.license_expiry = formData.license_expiry || null;
          updateData.license_category = formData.license_category || null;
        }
        const { error } = await supabase.from('users').update(updateData).eq('id', editingUser.id);
        if (error) throw error;
        toast.success('Utilisateur mis à jour');
      }
      setShowModal(false); setEditingUser(null); setFormData(emptyForm());
      await loadUsers();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Erreur');
    }
  };

  const handleEdit = (user: UserRow) => {
    setEditingUser(user);
    setFormData({
      email: user.email,
      first_name: user.first_name || user.full_name?.split(' ')[0] || '',
      last_name: user.last_name || user.full_name?.split(' ').slice(1).join(' ') || '',
      phone: user.phone || '',
      role: user.role,
      organization_id: user.organization_id || '',
      company_id: user.company_id || '',
      station_id: user.station_id || '',
      employee_id: user.employee_id || '',
      license_number: user.license_number || '',
      license_expiry: user.license_expiry || '',
      license_category: user.license_category || 'D',
      password: '',
      send_invitation: false,
      status: user.status || 'active',
    });
    setShowModal(true);
  };

  const handleToggleStatus = async (user: UserRow) => {
    const newStatus = user.status === 'active' ? 'suspended' : 'active';
    const displayName = user.first_name ? `${user.first_name} ${user.last_name}` : user.full_name;
    if (!confirm(`Confirmer ${newStatus === 'suspended' ? 'la suspension' : 'la réactivation'} de "${displayName}" ?`)) return;
    try {
      const { error } = await supabase.from('users').update({ status: newStatus, is_active: newStatus === 'active' }).eq('id', user.id);
      if (error) throw error;
      toast.success(`Utilisateur ${newStatus === 'suspended' ? 'suspendu' : 'réactivé'}`);
      loadUsers();
    } catch {
      toast.error('Erreur lors de la modification');
    }
  };

  const handlePermanentDelete = async () => {
    if (!deleteTarget) return;
    if (deleteConfirmText !== 'SUPPRIMER') return;
    setDeleting(true);
    try {
      const isEmployee = !(deleteTarget as any).organizations && !!(deleteTarget as any).companies;
      const source = isEmployee ? 'employees' : 'users';
      await deleteEmployeePermanently(deleteTarget.id, source);
      toast.success('Employé supprimé définitivement');
      setDeleteTarget(null);
      setDeleteConfirmText('');
      loadUsers();
    } catch {
      toast.error('Erreur lors de la suppression définitive');
    } finally {
      setDeleting(false);
    }
  };

  const handleReactivateFromDeletion = async (user: UserRow) => {
    setReactivatingDeletion(user.id);
    try {
      await reactivateEmployee(user.id);
      toast.success(`${getUserDisplayName(user)} réactivé avec succès`);
      loadUsers();
    } catch {
      toast.error('Erreur lors de la réactivation');
    } finally {
      setReactivatingDeletion(null);
    }
  };

  const handleResetPassword = async (user: UserRow) => {
    const displayName = user.first_name ? `${user.first_name} ${user.last_name}` : user.full_name;
    const newPassword = prompt(`Nouveau mot de passe pour "${displayName}" (min. 8 caractères) :`);
    if (!newPassword) return;
    if (newPassword.length < 8) { toast.error('Minimum 8 caractères'); return; }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { toast.error('Session expirée.'); return; }
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reset-user-password`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
        body: JSON.stringify({ userId: user.id, newPassword }),
      });
      const result = await response.json().catch(() => ({ error: `Erreur (${response.status})` }));
      if (!response.ok) throw new Error(result.error || `Erreur ${response.status}`);
      toast.success('Mot de passe réinitialisé');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Erreur');
    }
  };

  const getUserDisplayName = (user: UserRow) =>
    user.first_name ? `${user.first_name} ${user.last_name}` : user.full_name || '—';

  const [batchActivating, setBatchActivating] = useState(false);

  const handleBatchActivateChauffeurs = async () => {
    const chauffeurs = pendingEmployees.filter(e => e.role === 'chauffeur');
    if (chauffeurs.length === 0) {
      toast('Aucun chauffeur en attente', { icon: 'ℹ️' });
      return;
    }
    if (!confirm(
      `Activer ${chauffeurs.length} compte${chauffeurs.length > 1 ? 's' : ''} chauffeur en attente ?\n` +
      `Des identifiants de connexion seront créés automatiquement avec un mot de passe généré.\n` +
      `Les chauffeurs seront visibles dans tous les menus de sélection.`
    )) return;

    setBatchActivating(true);
    let success = 0;
    const failures: string[] = [];

    for (const emp of chauffeurs) {
      const email = emp.professional_email ?? emp.personal_email;
      if (!email) {
        failures.push(`${emp.first_name} ${emp.last_name} — aucun email`);
        continue;
      }
      try {
        await createAccountByAdmin({
          employee_id: emp.id,
          email,
          password: generateSecurePassword(),
          send_welcome_email: false,
        });
        success++;
      } catch (err) {
        failures.push(`${emp.first_name} ${emp.last_name} — ${err instanceof Error ? err.message : 'erreur'}`);
      }
    }

    setBatchActivating(false);
    if (success > 0) {
      toast.success(`${success} chauffeur${success > 1 ? 's' : ''} activé${success > 1 ? 's' : ''} avec succès`);
    }
    if (failures.length > 0) {
      toast.error(`${failures.length} échec${failures.length > 1 ? 's' : ''} : ${failures.slice(0, 3).join(', ')}${failures.length > 3 ? '…' : ''}`, { duration: 8000 });
    }
    await Promise.all([loadPending(), loadUsers()]);
  };

  const getRoleInfo = (role: UserRole) => ROLES.find(r => r.value === role) ?? ROLES[ROLES.length - 1];

  const activeUsers = users.filter(u => u.status === 'active' || u.status === 'repos_obligatoire');
  const pendingDeletionUsers = users.filter(u => u.status === 'pending_deletion');

  // Filtrage des employés en attente par autocomplétion
  const filteredPendingEmployees = pendingSearch.trim() === ''
    ? pendingEmployees
    : pendingEmployees.filter((emp) => {
        const q = pendingSearch.trim().toLowerCase();
        return (
          emp.full_name?.toLowerCase().includes(q) ||
          `${emp.first_name} ${emp.last_name}`.toLowerCase().includes(q) ||
          emp.professional_email?.toLowerCase().includes(q) ||
          emp.personal_email?.toLowerCase().includes(q) ||
          emp.phone?.toLowerCase().includes(q) ||
          emp.employee_id?.toLowerCase().includes(q) ||
          emp.role?.toLowerCase().includes(q) ||
          emp.company_name?.toLowerCase().includes(q) ||
          emp.company_code?.toLowerCase().includes(q) ||
          emp.station_name?.toLowerCase().includes(q)
        );
      });

  // Suggestions pour l'autocomplétion (max 6, déduoublonnées par nom)
  const pendingSuggestions = pendingSearch.trim() === ''
    ? []
    : pendingEmployees
        .filter((emp) => {
          const q = pendingSearch.trim().toLowerCase();
          return (
            `${emp.first_name} ${emp.last_name}`.toLowerCase().startsWith(q) ||
            emp.full_name?.toLowerCase().startsWith(q)
          );
        })
        .slice(0, 6);
  const inactiveUsers = users.filter(u => u.status !== 'active' && u.status !== 'repos_obligatoire' && u.status !== 'pending_deletion');

  const filteredUsers = (activeTab === 'active' ? activeUsers : inactiveUsers).filter(u => {
    const matchRole = roleFilter === 'all' || u.role === roleFilter;
    if (!matchRole) return false;
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    const name = getUserDisplayName(u).toLowerCase();
    const email = (u.email ?? '').toLowerCase();
    const empId = (u.employee_id ?? '').toLowerCase();
    const phone = (u.phone ?? '').toLowerCase();
    return name.includes(q) || email.includes(q) || empId.includes(q) || phone.includes(q);
  });

  const columns = [
    {
      key: 'avatar', label: '',
      render: (u: UserRow) => (
        <div className="w-10 h-10 rounded-full flex items-center justify-center overflow-hidden" style={{ backgroundColor: 'var(--surface-raised)' }}>
          {u.avatar_url ? <img src={u.avatar_url} alt="avatar" className="w-full h-full object-cover" /> : <UserIcon className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />}
        </div>
      ),
    },
    {
      key: 'name', label: 'Utilisateur', sortable: true,
      render: (u: UserRow) => (
        <div>
          <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{getUserDisplayName(u)}</div>
          <div className="text-sm" style={{ color: 'var(--text-muted)' }}>{u.email}</div>
        </div>
      ),
    },
    { key: 'phone', label: 'Téléphone', render: (u: UserRow) => u.phone || '—' },
    {
      key: 'role', label: 'Rôle',
      render: (u: UserRow) => {
        const ri = getRoleInfo(u.role);
        return <span className="px-2 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: `${ri.color}18`, color: ri.color }}>{ri.label}</span>;
      },
    },
    {
      key: 'org', label: 'Organisation',
      render: (u: UserRow) => (u as any).organizations?.name || (u as any).companies?.name || 'SBTA Holding',
    },
    {
      key: 'status', label: 'Statut',
      render: (u: UserRow) => <StatusBadge status={u.status || (u.is_active ? 'active' : 'inactive')} />,
    },
    {
      key: 'actions', label: 'Actions',
      render: (u: UserRow) => (
        <div className="flex gap-1">
          <button onClick={() => setSelectedUser(u)} className="p-2 rounded-lg hover:bg-gray-100" style={{ color: 'var(--info)' }} title="Voir profil"><UserIcon className="w-4 h-4" /></button>
          <button onClick={() => handleEdit(u)} className="p-2 rounded-lg hover:bg-gray-100" style={{ color: 'var(--primary)' }} title="Modifier"><Pencil className="w-4 h-4" /></button>
          <button onClick={() => handleToggleStatus(u)} className="p-2 rounded-lg hover:bg-gray-100" style={{ color: u.status === 'suspended' ? 'var(--success)' : 'var(--warning)' }} title={u.status === 'suspended' ? 'Réactiver' : 'Suspendre'}>
            {u.status === 'suspended' ? <CheckCircle className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
          </button>
          <button onClick={() => handleResetPassword(u)} className="p-2 rounded-lg hover:bg-gray-100" style={{ color: 'var(--text-secondary)' }} title="Réinitialiser MDP"><Key className="w-4 h-4" /></button>
        </div>
      ),
    },
  ];

  if (loading && pendingLoading) return <div className="p-6" style={{ color: 'var(--text-secondary)' }}>Chargement...</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Gestion des comptes utilisateurs
          </h1>
          <p className="mt-1" style={{ color: 'var(--text-secondary)' }}>
            L'admin crée et gère uniquement les identifiants de connexion
          </p>
        </div>
        <button
          onClick={() => { setEditingUser(null); setFormData(emptyForm()); setShowModal(true); }}
          className="px-4 py-2 rounded-lg flex items-center gap-2 font-medium"
          style={{ backgroundColor: 'var(--primary)', color: 'var(--text-on-primary)' }}
        >
          <Plus className="w-5 h-5" />
          Nouvel utilisateur
        </button>
      </div>

      {/* Onglets */}
      <div className="flex gap-1 border-b" style={{ borderColor: 'var(--border)' }}>
        {([
          { key: 'pending', label: 'En attente', count: pendingEmployees.length, icon: Clock, warningColor: '#D97706' },
          { key: 'active',  label: 'Comptes actifs',  count: activeUsers.length,   icon: CheckCircle, warningColor: undefined },
          { key: 'inactive',label: 'Inactifs / Suspendus', count: inactiveUsers.length, icon: Ban, warningColor: undefined },
          { key: 'pending_deletion', label: 'Suppressions demandées', count: pendingDeletionUsers.length, icon: AlertTriangle, warningColor: '#AF3029' },
        ] as const).map(({ key, label, count, icon: Icon, warningColor }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className="flex items-center gap-2 px-5 py-3 font-medium text-sm border-b-2 transition-colors"
            style={{
              borderBottomColor: activeTab === key ? 'var(--primary)' : 'transparent',
              color: activeTab === key ? 'var(--primary)' : 'var(--text-secondary)',
            }}
          >
            <Icon className="w-4 h-4" style={{ color: warningColor && key === 'pending' && count > 0 ? warningColor : warningColor && key === 'pending_deletion' && count > 0 ? warningColor : undefined }} />
            {label}
            <span
              className="px-2 py-0.5 rounded-full text-xs font-bold"
              style={{
                backgroundColor: key === 'pending' && count > 0 ? '#FEF3C7' : key === 'pending_deletion' && count > 0 ? '#FEE2E2' : 'var(--surface-raised)',
                color: key === 'pending' && count > 0 ? '#92400E' : key === 'pending_deletion' && count > 0 ? '#AF3029' : 'var(--text-secondary)',
              }}
            >
              {count}
            </span>
          </button>
        ))}
      </div>

      {/* TAB: En attente */}
      {activeTab === 'pending' && (
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--surface)' }}>
          {pendingLoading ? (
            <div className="p-8 text-center" style={{ color: 'var(--text-secondary)' }}>Chargement...</div>
          ) : pendingEmployees.length === 0 ? (
            <div className="p-12 text-center">
              <CheckCircle className="w-16 h-16 mx-auto mb-3" style={{ color: 'var(--success)' }} />
              <p className="font-semibold text-lg" style={{ color: 'var(--text-primary)' }}>Aucun employé en attente</p>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                Tous les employés créés par le RH ont un compte de connexion.
              </p>
            </div>
          ) : (
            <>
              <div className="px-6 py-4 border-b flex items-center gap-3" style={{ borderColor: 'var(--border)', backgroundColor: '#FFFBEB' }}>
                <Clock className="w-5 h-5" style={{ color: '#D97706' }} />
                <div className="flex-1">
                  <p className="font-semibold text-sm" style={{ color: '#92400E' }}>
                    {pendingEmployees.length} employé{pendingEmployees.length > 1 ? 's' : ''} en attente de compte
                  </p>
                  <p className="text-xs" style={{ color: '#B45309' }}>
                    Ces fiches ont été créées par le RH. Créez leurs identifiants de connexion.
                  </p>
                </div>
                {pendingEmployees.filter(e => e.role === 'chauffeur').length > 0 && (
                  <button
                    onClick={handleBatchActivateChauffeurs}
                    disabled={batchActivating}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50 flex-shrink-0"
                    style={{ backgroundColor: '#0B7439' }}
                  >
                    {batchActivating
                      ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      : <Truck className="w-4 h-4" />}
                    Activer tous les chauffeurs
                    <span className="px-1.5 py-0.5 rounded-full text-xs bg-white/20">
                      {pendingEmployees.filter(e => e.role === 'chauffeur').length}
                    </span>
                  </button>
                )}
              </div>

              {/* Barre de recherche avec autocomplétion */}
              <div className="px-6 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
                <div className="relative max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    value={pendingSearch}
                    onChange={(e) => setPendingSearch(e.target.value)}
                    onFocus={() => setPendingSearchFocused(true)}
                    onBlur={() => setTimeout(() => setPendingSearchFocused(false), 150)}
                    placeholder="Rechercher par nom, email, matricule, rôle, société..."
                    className="w-full pl-10 pr-9 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
                  />
                  {pendingSearch && (
                    <button
                      onClick={() => setPendingSearch('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}

                  {/* Liste d'autocomplétion */}
                  {pendingSearchFocused && pendingSuggestions.length > 0 && (
                    <ul
                      className="absolute z-20 mt-1 w-full rounded-lg border shadow-lg max-h-60 overflow-y-auto"
                      style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
                    >
                      {pendingSuggestions.map((emp) => (
                        <li key={emp.id}>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setPendingSearch(`${emp.first_name} ${emp.last_name}`);
                              setPendingSearchFocused(false);
                            }}
                            className="w-full flex items-center gap-3 px-3 py-2 text-left text-sm hover:bg-gray-50 transition-colors"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            <span
                              className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0"
                              style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}
                            >
                              {emp.first_name?.[0]}{emp.last_name?.[0]}
                            </span>
                            <span className="flex-1 truncate">
                              {emp.first_name} {emp.last_name}
                              {emp.role && (
                                <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>
                                  · {ROLES.find(r => r.value === emp.role)?.label ?? emp.role}
                                </span>
                              )}
                            </span>
                            {emp.employee_id && (
                              <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{emp.employee_id}</span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {pendingSearch && filteredPendingEmployees.length !== pendingEmployees.length && (
                  <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                    {filteredPendingEmployees.length} résultat{filteredPendingEmployees.length > 1 ? 's' : ''} sur {pendingEmployees.length}
                  </p>
                )}
              </div>
              <table className="w-full">
                <thead style={{ backgroundColor: 'var(--neutral-100)' }}>
                  <tr>
                    <th className="text-left p-4 text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Employé</th>
                    <th className="text-left p-4 text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Société</th>
                    <th className="text-left p-4 text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Poste</th>
                    <th className="text-left p-4 text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Email RH</th>
                    <th className="text-left p-4 text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>En attente depuis</th>
                    <th className="text-left p-4 text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPendingEmployees.map((emp) => {
                    const roleInfo = ROLES.find(r => r.value === emp.role);
                    const waitTime = formatDistanceToNow(new Date(emp.created_by_hr_at), { addSuffix: false, locale: fr });
                    return (
                      <tr key={emp.id} className="border-t hover:bg-gray-50 transition-colors" style={{ borderColor: 'var(--border)' }}>
                        <td className="p-4">
                          <div className="flex items-center gap-3">
                            <div
                              className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
                              style={{ backgroundColor: '#d4edda', color: '#0B7439' }}
                            >
                              {emp.first_name[0]}{emp.last_name[0]}
                            </div>
                            <div>
                              <div className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                                {emp.first_name} {emp.last_name}
                              </div>
                              {emp.employee_id && (
                                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                  {emp.employee_id}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="p-4">
                          <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                            {emp.company_name ?? 'Holding'}
                          </span>
                        </td>
                        <td className="p-4">
                          {roleInfo && (
                            <span className="px-2 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: `${roleInfo.color}18`, color: roleInfo.color }}>
                              {roleInfo.label}
                            </span>
                          )}
                        </td>
                        <td className="p-4">
                          <span className="text-sm" style={{ color: emp.professional_email ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                            {emp.professional_email ?? emp.personal_email ?? '—'}
                          </span>
                        </td>
                        <td className="p-4">
                          <span className="text-sm font-medium" style={{ color: '#D97706' }}>
                            {waitTime}
                          </span>
                        </td>
                        <td className="p-4">
                          <button
                            onClick={() => setCreateAccountTarget(emp)}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors hover:opacity-90"
                            style={{ backgroundColor: '#0B7439' }}
                          >
                            <Plus className="w-4 h-4" />
                            Créer le compte
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {/* TAB: Actifs / Inactifs */}
      {(activeTab === 'active' || activeTab === 'inactive') && (
        <div className="rounded-xl p-6" style={{ backgroundColor: 'var(--surface)' }}>
          <div className="flex gap-3 mb-4 flex-wrap">
            <div className="flex-1 min-w-48 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Rechercher un utilisateur..."
                className="w-full pl-10 pr-4 py-2 rounded-lg border text-sm"
                style={{ borderColor: 'var(--border)' }}
              />
            </div>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="px-4 py-2 rounded-lg border text-sm"
              style={{ borderColor: 'var(--border)' }}
            >
              <option value="all">Tous les rôles</option>
              {ROLES.filter(r => r.value !== 'client').map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>

          <DataTable data={filteredUsers} columns={columns} searchable={false} />
        </div>
      )}

      {/* TAB: Suppressions demandées */}
      {activeTab === 'pending_deletion' && (
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--surface)' }}>
          {pendingDeletionUsers.length === 0 ? (
            <div className="p-12 text-center">
              <CheckCircle className="w-16 h-16 mx-auto mb-3" style={{ color: 'var(--success)' }} />
              <p className="font-semibold text-lg" style={{ color: 'var(--text-primary)' }}>Aucune demande de suppression</p>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                Les demandes de suppression définitive envoyées par le RH apparaîtront ici.
              </p>
            </div>
          ) : (
            <>
              <div className="px-6 py-4 border-b flex items-center gap-3" style={{ borderColor: 'var(--border)', backgroundColor: '#FEF2F2' }}>
                <AlertTriangle className="w-5 h-5" style={{ color: '#AF3029' }} />
                <div>
                  <p className="font-semibold text-sm" style={{ color: '#AF3029' }}>
                    {pendingDeletionUsers.length} demande{pendingDeletionUsers.length > 1 ? 's' : ''} de suppression définitive
                  </p>
                  <p className="text-xs" style={{ color: '#991B1B' }}>
                    Ces employés ont été désactivés par le RH qui a demandé leur suppression. Vous pouvez procéder à la suppression ou réactiver l'employé.
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead style={{ backgroundColor: 'var(--neutral-100)' }}>
                    <tr>
                      <th className="text-left p-4 text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Employé</th>
                      <th className="text-left p-4 text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Société</th>
                      <th className="text-left p-4 text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Rôle</th>
                      <th className="text-left p-4 text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Statut</th>
                      <th className="text-center p-4 text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingDeletionUsers.map((u) => {
                      const roleInfo = ROLES.find(r => r.value === u.role);
                      const displayName = u.full_name || `${u.first_name} ${u.last_name}`;
                      const orgName = u.organizations?.name || u.companies?.name || 'SBTA Holding';
                      return (
                        <tr key={u.id} className="border-t hover:bg-gray-50 transition-colors" style={{ borderColor: 'var(--border)' }}>
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0" style={{ backgroundColor: '#FEE2E2', color: '#AF3029' }}>
                                {(u.first_name?.[0] ?? '').toUpperCase()}{(u.last_name?.[0] ?? '').toUpperCase()}
                              </div>
                              <div>
                                <div className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{displayName}</div>
                                {u.email && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{u.email}</div>}
                                {u.employee_id && <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{u.employee_id}</div>}
                              </div>
                            </div>
                          </td>
                          <td className="p-4 text-sm" style={{ color: 'var(--text-primary)' }}>{orgName}</td>
                          <td className="p-4">
                            {roleInfo && (
                              <span className="px-2 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: `${roleInfo.color}18`, color: roleInfo.color }}>{roleInfo.label}</span>
                            )}
                          </td>
                          <td className="p-4"><StatusBadge status="pending_deletion" /></td>
                          <td className="p-4">
                            <div className="flex gap-2 justify-center">
                              <button
                                onClick={() => handleReactivateFromDeletion(u)}
                                disabled={reactivatingDeletion === u.id}
                                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                                style={{ color: '#0B7439', border: '1px solid #D4EDDA' }}
                                title="Réactiver l'employé"
                              >
                                {reactivatingDeletion === u.id
                                  ? <div className="w-4 h-4 border-2 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
                                  : <RotateCcw className="w-4 h-4" />}
                                Réactiver
                              </button>
                              <button
                                onClick={() => { setDeleteTarget(u); setDeleteConfirmText('') }}
                                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-white transition-colors"
                                style={{ backgroundColor: '#AF3029' }}
                                title="Supprimer définitivement"
                              >
                                <Trash2 className="w-4 h-4" />
                                Supprimer définitivement
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Modale création de compte via RH pipeline */}
      {createAccountTarget && (
        <CreateAccountModal
          employee={createAccountTarget}
          onClose={() => setCreateAccountTarget(null)}
          onSuccess={() => {
            setCreateAccountTarget(null);
            loadPending();
            loadUsers();
          }}
        />
      )}

      {/* Modale création/édition utilisateur direct */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto p-4">
          <div className="rounded-xl p-6 max-w-2xl w-full my-4" style={{ backgroundColor: 'var(--surface)' }}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                {editingUser ? 'Modifier l\'utilisateur' : 'Nouvel utilisateur'}
              </h2>
              <button onClick={() => { setShowModal(false); setEditingUser(null); setFormData(emptyForm()); }} style={{ color: 'var(--text-muted)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Prénom *</label>
                  <input type="text" value={formData.first_name} onChange={(e) => setFormData({ ...formData, first_name: e.target.value })} required className="w-full px-3 py-2 rounded-lg border" style={{ borderColor: 'var(--border)' }} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Nom *</label>
                  <input type="text" value={formData.last_name} onChange={(e) => setFormData({ ...formData, last_name: e.target.value })} required className="w-full px-3 py-2 rounded-lg border" style={{ borderColor: 'var(--border)' }} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Email *</label>
                  <input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} required className="w-full px-3 py-2 rounded-lg border" style={{ borderColor: 'var(--border)' }} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Téléphone</label>
                  <input type="tel" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className="w-full px-3 py-2 rounded-lg border" style={{ borderColor: 'var(--border)' }} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Rôle *</label>
                  <select value={formData.role} onChange={(e) => setFormData({ ...formData, role: e.target.value as UserRole })} required className="w-full px-3 py-2 rounded-lg border" style={{ borderColor: 'var(--border)' }}>
                    {['Direction', 'Opérationnel', 'Courrier'].map(group => (
                      <optgroup key={group} label={group}>
                        {ROLES.filter(r => r.group === group).map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Matricule</label>
                  <input type="text" value={formData.employee_id} onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })} className="w-full px-3 py-2 rounded-lg border" style={{ borderColor: 'var(--border)' }} placeholder="EMP-001" />
                </div>
              </div>
              {editingUser && (
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Statut</label>
                  <select value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value })} className="w-full px-3 py-2 rounded-lg border" style={{ borderColor: 'var(--border)' }}>
                    <option value="active">Actif</option>
                    <option value="inactive">Inactif</option>
                    <option value="suspended">Suspendu</option>
                    <option value="repos_obligatoire">En repos obligatoire</option>
                  </select>
                </div>
              )}
              {OPERATIONAL_ROLES.includes(formData.role) && (
                <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--info-light)' }}>
                  <div className="flex gap-2 mb-2">
                    <AlertCircle className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--info)' }} />
                    <label className="text-sm font-medium" style={{ color: 'var(--info)' }}>
                      Société d'appartenance <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                  </div>
                  <select value={formData.company_id} onChange={(e) => setFormData({ ...formData, company_id: e.target.value })} required className="w-full px-3 py-2 rounded-lg border bg-white" style={{ borderColor: 'var(--border)' }}>
                    <option value="">— Sélectionner une société —</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              {CAN_HAVE_STATION.includes(formData.role) && (
                <div className="p-4 rounded-lg" style={{ backgroundColor: '#f0faf4', border: '1px solid #0B7439' }}>
                  <div className="flex gap-2 mb-2">
                    <AlertCircle className="w-5 h-5 flex-shrink-0" style={{ color: '#0B7439' }} />
                    <label className="text-sm font-medium" style={{ color: '#0B7439' }}>
                      Gare d'affectation{REQUIRES_STATION.includes(formData.role) ? ' *' : ''}
                    </label>
                  </div>
                  <select value={formData.station_id} onChange={(e) => setFormData({ ...formData, station_id: e.target.value })} required={REQUIRES_STATION.includes(formData.role)} className="w-full px-3 py-2 rounded-lg border bg-white" style={{ borderColor: '#0B7439' }}>
                    <option value="">{REQUIRES_STATION.includes(formData.role) ? '— Sélectionner une gare —' : '— Aucune (non affecté) —'}</option>
                    {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}
              {formData.role === 'chauffeur' && (
                <div className="p-4 rounded-lg space-y-3" style={{ backgroundColor: 'var(--surface-raised)' }}>
                  <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Informations permis de conduire</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Numéro de permis</label>
                      <input type="text" value={formData.license_number} onChange={(e) => setFormData({ ...formData, license_number: e.target.value })} className="w-full px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border)' }} />
                    </div>
                    <div>
                      <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Catégorie</label>
                      <select value={formData.license_category} onChange={(e) => setFormData({ ...formData, license_category: e.target.value })} className="w-full px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border)' }}>
                        {LICENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Date d'expiration</label>
                    <input type="date" value={formData.license_expiry} onChange={(e) => setFormData({ ...formData, license_expiry: e.target.value })} className="w-full px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border)' }} />
                  </div>
                </div>
              )}
              {!editingUser && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 p-3 rounded-lg" style={{ backgroundColor: 'var(--surface-raised)' }}>
                    <input type="checkbox" id="send_invitation" checked={formData.send_invitation} onChange={(e) => setFormData({ ...formData, send_invitation: e.target.checked })} className="rounded" style={{ accentColor: 'var(--primary)' }} />
                    <label htmlFor="send_invitation" className="text-sm cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                      Envoyer une invitation par email
                    </label>
                  </div>
                  {!formData.send_invitation && (
                    <div>
                      <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Mot de passe *</label>
                      <input type="password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} required={!formData.send_invitation} minLength={8} className="w-full px-3 py-2 rounded-lg border" style={{ borderColor: 'var(--border)' }} placeholder="Minimum 8 caractères" />
                    </div>
                  )}
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowModal(false); setEditingUser(null); setFormData(emptyForm()); }} className="flex-1 px-4 py-2 rounded-lg border" style={{ borderColor: 'var(--border)' }}>Annuler</button>
                <button type="submit" className="flex-1 px-4 py-2 rounded-lg font-medium" style={{ backgroundColor: 'var(--primary)', color: 'var(--text-on-primary)' }}>
                  {editingUser ? 'Mettre à jour' : (formData.send_invitation ? "Envoyer l'invitation" : 'Créer')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Profil utilisateur */}
      {selectedUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto" style={{ backgroundColor: 'var(--surface)' }}>
            <div className="sticky top-0 border-b p-5 flex items-center justify-between" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full flex items-center justify-center overflow-hidden" style={{ backgroundColor: 'var(--surface-raised)' }}>
                  {selectedUser.avatar_url ? <img src={selectedUser.avatar_url} alt="avatar" className="w-full h-full object-cover" /> : <UserIcon className="w-7 h-7" style={{ color: 'var(--text-muted)' }} />}
                </div>
                <div>
                  <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{getUserDisplayName(selectedUser)}</h2>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{getRoleInfo(selectedUser.role).label}</p>
                </div>
              </div>
              <button onClick={() => setSelectedUser(null)} style={{ color: 'var(--text-muted)' }}><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-0">
              {[
                { label: 'Email', value: selectedUser.email },
                { label: 'Téléphone', value: selectedUser.phone || '—' },
                { label: 'Matricule', value: selectedUser.employee_id || '—' },
                { label: 'Organisation', value: (selectedUser as any).organizations?.name || (selectedUser as any).companies?.name || 'SBTA Holding' },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between py-3 border-b" style={{ borderColor: 'var(--border)' }}>
                  <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{label}</span>
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{value}</span>
                </div>
              ))}
              <div className="flex justify-between pt-3">
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Statut</span>
                <StatusBadge status={selectedUser.status || (selectedUser.is_active ? 'active' : 'inactive')} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modale suppression définitive (admin uniquement) */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="rounded-xl p-6 max-w-md w-full" style={{ backgroundColor: 'var(--surface)' }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#FEE2E2' }}>
                <Trash2 className="w-6 h-6" style={{ color: '#AF3029' }} />
              </div>
              <div>
                <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Suppression définitive</h2>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Action irréversible</p>
              </div>
            </div>
            <div className="rounded-lg p-4 mb-4 text-sm" style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA', color: '#AF3029' }}>
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  Vous allez <strong>supprimer définitivement</strong> l'employé{' '}
                  <strong>{getUserDisplayName(deleteTarget)}</strong>. Toutes ses données seront
                  perdues, y compris l'historique de paie et les informations contractuelles.
                  <div className="mt-2 font-semibold">Cette action ne peut pas être annulée.</div>
                </div>
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                Pour confirmer, tapez <strong>SUPPRIMER</strong>
              </label>
              <input
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border"
                style={{ borderColor: 'var(--border)' }}
                placeholder="SUPPRIMER"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setDeleteTarget(null); setDeleteConfirmText('') }}
                className="flex-1 px-4 py-2 rounded-lg border"
                style={{ borderColor: 'var(--border)' }}
              >
                Annuler
              </button>
              <button
                onClick={handlePermanentDelete}
                disabled={deleteConfirmText !== 'SUPPRIMER' || deleting}
                className="flex-1 px-4 py-2 rounded-lg font-semibold text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: '#AF3029' }}
              >
                {deleting ? 'Suppression...' : 'Supprimer définitivement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
