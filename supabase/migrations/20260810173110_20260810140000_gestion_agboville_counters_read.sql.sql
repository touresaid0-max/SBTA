/*
# Read access for gestion_agboville — counters

## Context
The "Suivi des recettes" screen needs to filter POS data by guichet (counter).
The `gestion_agboville` role had no SELECT policy on `counters`.

## Changes
1. Security
   - Add SELECT policy on `counters` for the `gestion_agboville` role (read-only).

## Data safety
- No data is modified. FOR SELECT only.
*/

DROP POLICY IF EXISTS "gestion_agboville_view_counters" ON public.counters;
CREATE POLICY "gestion_agboville_view_counters"
ON public.counters
FOR SELECT
TO authenticated
USING (public.get_my_role() = 'gestion_agboville');
