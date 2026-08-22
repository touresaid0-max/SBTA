/*
# Add "dg" role (Directeur General)

1. Changes
   - ALTER users.role CHECK: adds 'dg' to the allowed values.
   - ALTER employees.role CHECK: adds 'dg' to the allowed values.
   - INSERT role 'dg' into roles table with display_name 'Directeur General'.
2. Security
   - No RLS policy changes. The new role inherits existing authenticated access.
3. Notes
   - Data-preserving operation: constraints are dropped and re-added, no data lost.
*/

-- users.role CHECK constraint
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
  role IN ('admin','dg','daf','comptable','rh','gestionnaire','planificateur',
           'charge_achat','chauffeur','guichetier','chef_garage','mecanicien',
           'pompiste','chef_gare','bagagiste','superviseur_colis','agent_colis',
           'agent_reservation','carburant','gerant_principal',
           'responsable_assurance','responsable_logistique','agent_qhse',
           'gestion_agboville','client')
);

-- employees.role CHECK constraint
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_role_check;
ALTER TABLE employees ADD CONSTRAINT employees_role_check CHECK (
  role IN ('admin','dg','daf','comptable','rh','gestionnaire','planificateur',
           'charge_achat','chauffeur','guichetier','chef_garage','mecanicien',
           'pompiste','chef_gare','bagagiste','superviseur_colis','agent_colis',
           'agent_reservation','carburant','gerant_principal',
           'responsable_assurance','responsable_logistique','agent_qhse',
           'gestion_agboville','client')
);

-- Insert the role into the roles table
INSERT INTO roles (name, display_name, description, level, is_system)
VALUES ('dg', 'Directeur General', 'Directeur General du groupe SBTA', 1, false)
ON CONFLICT (name) DO NOTHING;
