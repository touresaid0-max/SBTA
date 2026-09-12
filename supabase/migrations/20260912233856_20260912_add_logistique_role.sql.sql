/*
# Add "logistique" role

## Purpose
Add a new "Logistique" role that mirrors "responsable_logistique" access.
This allows creating employees and users with the "Logistique" position/role.

## Changes
1. Update `users.role` CHECK constraint to include 'logistique'
2. Update `employees.role` CHECK constraint to include 'logistique'
3. Insert 'logistique' into the `roles` table with display name "Logistique"

## Security
- No RLS policy changes needed; the new role inherits the same access pattern
  as 'responsable_logistique' through the application layer.
- No new tables or columns created.
*/

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
  role IN ('admin','dg','daf','comptable','rh','gestionnaire','planificateur',
           'charge_achat','chauffeur','guichetier','chef_garage','mecanicien',
           'pompiste','chef_gare','bagagiste','superviseur_colis','agent_colis',
           'agent_reservation','carburant','gerant_principal',
           'responsable_assurance','responsable_logistique','logistique','agent_qhse',
           'gestion_agboville','client')
);

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_role_check;
ALTER TABLE employees ADD CONSTRAINT employees_role_check CHECK (
  role IN ('admin','dg','daf','comptable','rh','gestionnaire','planificateur',
           'charge_achat','chauffeur','guichetier','chef_garage','mecanicien',
           'pompiste','chef_gare','bagagiste','superviseur_colis','agent_colis',
           'agent_reservation','carburant','gerant_principal',
           'responsable_assurance','responsable_logistique','logistique','agent_qhse',
           'gestion_agboville','client')
);

INSERT INTO roles (name, display_name, description, level, is_system)
VALUES ('logistique', 'Logistique', 'Profil Logistique', 30, false)
ON CONFLICT (name) DO NOTHING;