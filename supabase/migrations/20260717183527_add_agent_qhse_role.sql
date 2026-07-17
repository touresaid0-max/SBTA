/*
# Add Agent QHSE role to users and employees constraints

1. Modified Tables
   - `users`: updated role CHECK constraint to include 'agent_qhse'
   - `employees`: updated role CHECK constraint to include 'agent_qhse'

2. Security
   - No RLS changes needed (existing policies cover authenticated users by role)

3. Notes
   - Agent QHSE is a holding-level position for quality, health, safety, and environment
*/

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role = ANY (ARRAY[
  'admin', 'agent_colis', 'agent_reservation', 'agent_qhse', 'bagagiste', 'carburant',
  'charge_achat', 'chauffeur', 'chef_garage', 'chef_gare', 'client', 'comptable',
  'daf', 'gestionnaire', 'guichetier', 'mecanicien', 'planificateur', 'pompiste',
  'rh', 'superviseur_colis', 'gerant_principal', 'responsable_assurance', 'responsable_logistique'
]));

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_role_check;
ALTER TABLE employees ADD CONSTRAINT employees_role_check CHECK (role = ANY (ARRAY[
  'admin', 'agent_colis', 'agent_reservation', 'agent_qhse', 'bagagiste', 'carburant',
  'charge_achat', 'chauffeur', 'chef_garage', 'chef_gare', 'client', 'comptable',
  'daf', 'gestionnaire', 'guichetier', 'mecanicien', 'planificateur', 'pompiste',
  'rh', 'superviseur_colis', 'gerant_principal', 'responsable_assurance', 'responsable_logistique'
]));
