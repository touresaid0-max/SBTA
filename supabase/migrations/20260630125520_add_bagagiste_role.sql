/*
  # Add Bagagiste role

  1. Changes
     - Insert 'bagagiste' into the `roles` table.
     - Update CHECK constraints on `users` and `employees` to include 'bagagiste'.

  2. Security
     - No RLS changes needed.
*/

INSERT INTO roles (name, display_name, description, level, is_system)
VALUES ('bagagiste', 'Bagagiste', 'Bagagiste — manutention et gestion des bagages en gare', 7, false)
ON CONFLICT (name) DO NOTHING;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
  CHECK (role = ANY (ARRAY['admin'::text, 'agent_colis'::text, 'agent_reservation'::text, 'bagagiste'::text, 'carburant'::text, 'charge_achat'::text, 'chauffeur'::text, 'chef_garage'::text, 'chef_gare'::text, 'client'::text, 'comptable'::text, 'daf'::text, 'gestionnaire'::text, 'guichetier'::text, 'mecanicien'::text, 'planificateur'::text, 'pompiste'::text, 'rh'::text, 'superviseur_colis'::text, 'gerant_principal'::text, 'responsable_assurance'::text, 'responsable_logistique'::text]));

ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_role_check;
ALTER TABLE public.employees ADD CONSTRAINT employees_role_check
  CHECK (role = ANY (ARRAY['admin'::text, 'agent_colis'::text, 'agent_reservation'::text, 'bagagiste'::text, 'carburant'::text, 'charge_achat'::text, 'chauffeur'::text, 'chef_garage'::text, 'chef_gare'::text, 'client'::text, 'comptable'::text, 'daf'::text, 'gestionnaire'::text, 'guichetier'::text, 'mecanicien'::text, 'planificateur'::text, 'pompiste'::text, 'rh'::text, 'superviseur_colis'::text, 'gerant_principal'::text, 'responsable_assurance'::text, 'responsable_logistique'::text]));

NOTIFY pgrst, 'reload schema';