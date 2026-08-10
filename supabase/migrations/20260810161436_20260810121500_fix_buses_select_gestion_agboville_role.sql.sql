/*
# Fix bus visibility for Gestion Agboville

## Context
The bus autocomplete reads from `public.buses`. The first read policy checked only the
JWT app_metadata role, while the Agboville module consistently resolves the active role
through `public.get_my_role()`. Accounts whose role was available through that helper
could therefore still receive an empty bus list.

## Changes
1. Security
   - Replace the Gestion Agboville bus SELECT predicate with the shared role helper.
   - Keep access read-only and limited to authenticated Gestion Agboville users.

## Data safety
- No tables, columns, or bus records are changed.
*/

DROP POLICY IF EXISTS "buses_select_gestion_agboville" ON public.buses;

CREATE POLICY "buses_select_gestion_agboville"
ON public.buses
FOR SELECT
TO authenticated
USING (public.get_my_role() = 'gestion_agboville');
