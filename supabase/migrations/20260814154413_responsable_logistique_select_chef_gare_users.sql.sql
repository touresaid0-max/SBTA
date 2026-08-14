/*
# Allow Responsable Logistique to read Chef de Gare accounts

## Context
The Driver Report (Responsable Logistique → Rapport conducteur) needs to display
the Chef de Gare name and phone for the departure station of a selected route.
The data comes from the `users` table (Admin → Comptes utilisateurs).

## Problem
The existing `users_select_staff` policy covers comptable, planificateur,
chef_garage, guichetier, chef_gare, mecanicien, pompiste, and rh — but NOT
`responsable_logistique`. So the report's Supabase query for chef_gare users
returns zero rows when the logged-in user has role `responsable_logistique`.

## Change
- Adds a narrow SELECT policy: `responsable_logistique` can read only rows
  where `role = 'chef_gare'` (the report needs only Chef de Gare accounts).
- No other roles are affected. No writes are granted.

## Security
- Row-level: only `chef_gare` rows are visible to `responsable_logistique`.
- The existing broad column grant on `users` is unchanged; the policy restricts
  which rows are returned, which is the correct layer for this control.
*/

DROP POLICY IF EXISTS "responsable_logistique_select_chef_gare" ON users;

CREATE POLICY "responsable_logistique_select_chef_gare"
ON users FOR SELECT
TO authenticated
USING (
  ((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'responsable_logistique'::text
  AND role = 'chef_gare'::text
);
