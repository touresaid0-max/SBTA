/*
# Allow gestion_agboville role to read all buses

## Context
The "Gestion Agboville > Nouvelle dépense" form has a "Matricule du car" autocomplete
that loads all buses from the `buses` table. The `gestion_agboville` role had no SELECT
policy on `buses`, so RLS silently returned zero rows and the dropdown appeared empty.

## Changes
1. Security
   - Add a new SELECT policy on `buses` for the `gestion_agboville` role so it can read
     all bus registration numbers (needed to pick the vehicle concerned by a dépense).

## Notes
- This is read-only: no INSERT / UPDATE / DELETE is granted to `gestion_agboville`.
- The policy is intentionally broad (all buses) because the requirement is to show every
  registered bus, not only those assigned to Agboville.
*/

DROP POLICY IF EXISTS "buses_select_gestion_agboville" ON public.buses;

CREATE POLICY "buses_select_gestion_agboville"
ON public.buses
FOR SELECT
TO authenticated
USING (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'gestion_agboville'::text);
