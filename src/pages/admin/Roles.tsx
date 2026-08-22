import { useState, useEffect } from 'react';
import { RotateCcw, Save, Loader2 } from 'lucide-react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import type { UserRole } from '../../types';

interface DbRole { id: string; name: string; display_name: string; level: number }
interface DbPermission { id: string; name: string; display_name: string; resource: string; action: string }
interface RolePermRow { role_id: string; permission_id: string; granted: boolean }

const ROLES_ORDER: UserRole[] = [
  'admin', 'dg', 'daf', 'comptable', 'rh', 'gestionnaire', 'planificateur', 'charge_achat',
  'gerant_principal', 'responsable_assurance', 'responsable_logistique', 'agent_qhse',
  'gestion_agboville',
  'chauffeur', 'guichetier', 'agent_reservation', 'chef_garage', 'mecanicien', 'pompiste',
  'carburant', 'chef_gare', 'bagagiste',
  'agent_colis', 'superviseur_colis', 'client',
];

const RESOURCE_LABELS: Record<string, string> = {
  users: 'Utilisateurs', companies: 'Sociétés', buses: 'Bus', routes: 'Lignes',
  schedules: 'Plannings', reservations: 'Réservations', payments: 'Paiements',
  fuel: 'Carburant', expenses: 'Dépenses', maintenance: 'Maintenance',
  stock: 'Stock', reports: 'Rapports', loyalty: 'Fidélité', logs: 'Journaux',
};

export default function Roles() {
  const [roles, setRoles] = useState<DbRole[]>([]);
  const [permissions, setPermissions] = useState<DbPermission[]>([]);
  const [matrix, setMatrix] = useState<Record<string, Set<string>>>({});
  const [originalMatrix, setOriginalMatrix] = useState<Record<string, Set<string>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [rolesRes, permsRes, rpRes] = await Promise.all([
        supabase.from('roles').select('*').order('level'),
        supabase.from('permissions').select('*').order('resource').order('action'),
        supabase.from('role_permissions').select('*').eq('granted', true),
      ]);

      if (rolesRes.error) throw rolesRes.error;
      if (permsRes.error) throw permsRes.error;
      if (rpRes.error) throw rpRes.error;

      setRoles(rolesRes.data || []);
      setPermissions(permsRes.data || []);

      const mat: Record<string, Set<string>> = {};
      (rolesRes.data || []).forEach(r => { mat[r.id] = new Set(); });
      (rpRes.data || []).forEach((rp: RolePermRow) => {
        if (mat[rp.role_id]) mat[rp.role_id].add(rp.permission_id);
      });

      setMatrix(mat);
      setOriginalMatrix(JSON.parse(JSON.stringify(mat, (_k, v) => v instanceof Set ? [...v] : v)));
    } catch (error: any) {
      toast.error('Erreur lors du chargement des permissions');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const togglePermission = (roleId: string, permId: string) => {
    setMatrix(prev => {
      const newMat = { ...prev };
      const set = new Set(prev[roleId] || []);
      if (set.has(permId)) set.delete(permId);
      else set.add(permId);
      newMat[roleId] = set;
      setHasChanges(true);
      return newMat;
    });
  };

  const resetRole = (role: DbRole) => {
    if (!confirm(`Réinitialiser les permissions pour "${role.display_name}" ?`)) return;
    setMatrix(prev => {
      const original = new Set(originalMatrix[role.id] || []);
      return { ...prev, [role.id]: original };
    });
    setHasChanges(true);
    toast.success('Permissions réinitialisées');
  };

  const savePermissions = async () => {
    setSaving(true);
    try {
      for (const role of roles) {
        const currentPerms = matrix[role.id] || new Set();
        const originalPerms = new Set(originalMatrix[role.id] || []);

        const toAdd = [...currentPerms].filter(pid => !originalPerms.has(pid));
        const toRemove = [...originalPerms].filter(pid => !currentPerms.has(pid));

        if (toAdd.length > 0) {
          const { error } = await supabase.from('role_permissions').upsert(
            toAdd.map(pid => ({ role_id: role.id, permission_id: pid, granted: true })),
            { onConflict: 'role_id,permission_id' }
          );
          if (error) throw error;
        }

        if (toRemove.length > 0) {
          for (const pid of toRemove) {
            const { error } = await supabase.from('role_permissions')
              .delete()
              .eq('role_id', role.id)
              .eq('permission_id', pid);
            if (error) throw error;
          }
        }
      }

      setOriginalMatrix(JSON.parse(JSON.stringify(matrix, (_k, v) => v instanceof Set ? [...v] : v)));
      setHasChanges(false);
      toast.success('Permissions enregistrées avec succès');
    } catch (error: any) {
      toast.error(error.message || 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const resources = [...new Set(permissions.map(p => p.resource))].sort(
    (a, b) => Object.keys(RESOURCE_LABELS).indexOf(a) - Object.keys(RESOURCE_LABELS).indexOf(b)
  );

  const sortedRoles = ROLES_ORDER
    .map(name => roles.find(r => r.name === name))
    .filter(Boolean) as DbRole[];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--primary)' }} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Rôles et permissions
          </h1>
          <p className="mt-1" style={{ color: 'var(--text-secondary)' }}>
            Matrice des autorisations par rôle — {permissions.length} permissions, {roles.length} rôles
          </p>
        </div>
        {hasChanges && (
          <button
            onClick={savePermissions}
            disabled={saving}
            className="px-4 py-2 rounded-lg flex items-center gap-2 font-medium disabled:opacity-50"
            style={{ backgroundColor: 'var(--primary)', color: 'var(--text-on-primary)' }}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-5 h-5" />}
            {saving ? 'Enregistrement...' : 'Enregistrer les modifications'}
          </button>
        )}
      </div>

      <div className="rounded-xl overflow-x-auto" style={{ backgroundColor: 'var(--surface)' }}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr style={{ backgroundColor: 'var(--surface-raised)' }}>
              <th className="px-4 py-3 text-left sticky left-0 z-10 border-b font-medium" style={{ backgroundColor: 'var(--surface-raised)', borderColor: 'var(--border)', color: 'var(--text-secondary)', minWidth: '200px' }}>
                Permission
              </th>
              {sortedRoles.map(role => (
                <th key={role.id} className="px-3 py-3 text-center border-b" style={{ borderColor: 'var(--border)', minWidth: '90px' }}>
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                      {role.display_name}
                    </span>
                    <button
                      onClick={() => resetRole(role)}
                      className="p-1 rounded hover:bg-gray-100 transition-colors"
                      style={{ color: 'var(--text-muted)' }}
                      title={`Réinitialiser ${role.display_name}`}
                    >
                      <RotateCcw className="w-3 h-3" />
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {resources.map(resource => (
              <>
                <tr key={`cat-${resource}`}>
                  <td
                    colSpan={sortedRoles.length + 1}
                    className="px-4 py-2 text-xs font-semibold uppercase tracking-wider border-b"
                    style={{
                      backgroundColor: 'var(--primary-light)',
                      borderColor: 'var(--border)',
                      color: 'var(--primary)',
                    }}
                  >
                    {RESOURCE_LABELS[resource] || resource}
                  </td>
                </tr>
                {permissions
                  .filter(p => p.resource === resource)
                  .map(perm => (
                    <tr key={perm.id} className="border-b hover:bg-gray-50 transition-colors" style={{ borderColor: 'var(--border)' }}>
                      <td className="px-4 py-2.5 sticky left-0 z-10 text-sm" style={{ backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}>
                        <div>
                          <span>{perm.display_name}</span>
                          <span className="ml-2 text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                            {perm.name}
                          </span>
                        </div>
                      </td>
                      {sortedRoles.map(role => {
                        const checked = matrix[role.id]?.has(perm.id) ?? false;
                        return (
                          <td key={`${role.id}-${perm.id}`} className="px-3 py-2.5 text-center">
                            <div className="flex justify-center">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => togglePermission(role.id, perm.id)}
                                className="w-4 h-4 rounded cursor-pointer"
                                style={{ accentColor: 'var(--primary)' }}
                              />
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg p-4" style={{ backgroundColor: 'var(--info-light)' }}>
        <p className="text-sm" style={{ color: 'var(--info)' }}>
          <strong>Note :</strong> Les modifications prennent effet immédiatement pour tous les utilisateurs du rôle concerné dès la prochaine connexion.
          Utilisez le bouton de réinitialisation pour restaurer la dernière version sauvegardée.
        </p>
      </div>
    </div>
  );
}
