/*
# Add "gestion_agboville" role (Gestion Agboville)

Adds a new poste/role value 'gestion_agboville' to both the users and employees
tables' role CHECK constraints, so employees can be assigned this role.

1. Changes
   - ALTER users.role CHECK: adds 'gestion_agboville' to the allowed values.
   - ALTER employees.role CHECK: adds 'gestion_agboville' to the allowed values.
2. Security
   - No RLS policy changes. The new role inherits existing authenticated access.
3. Notes
   - This is a data-preserving operation: constraints are dropped and re-added,
     no columns are modified or data lost.
*/

-- users.role CHECK constraint
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
  role IN ('admin','daf','comptable','rh','gestionnaire','planificateur',
           'charge_achat','chauffeur','guichetier','chef_garage','mecanicien',
           'pompiste','chef_gare','bagagiste','superviseur_colis','agent_colis',
           'agent_reservation','carburant','gerant_principal',
           'responsable_assurance','responsable_logistique','agent_qhse',
           'gestion_agboville','client')
);

-- employees.role CHECK constraint
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_role_check;
ALTER TABLE employees ADD CONSTRAINT employees_role_check CHECK (
  role IN ('admin','daf','comptable','rh','gestionnaire','planificateur',
           'charge_achat','chauffeur','guichetier','chef_garage','mecanicien',
           'pompiste','chef_gare','bagagiste','superviseur_colis','agent_colis',
           'agent_reservation','carburant','gerant_principal',
           'responsable_assurance','responsable_logistique','agent_qhse',
           'gestion_agboville','client')
);
