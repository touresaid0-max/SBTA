/*
# Read access for gestion_agboville — POS revenue tracking

## Context
The new "Gestion Agboville" reporting screens need to read POS data (schedules,
reservations, counter_charges, buses, routes, stations, companies) to compute
recettes, charges (rations, carburant, péages, autres), and consolidated financial
results. The `gestion_agboville` role had no SELECT policy on `reservations` or
`counter_charges`, so these tables returned zero rows.

## Changes
1. Security
   - Add SELECT policies on `reservations` and `counter_charges` for the
     `gestion_agboville` role (read-only, all rows — needed for consolidated reporting).
   - `buses` already has a SELECT policy from migration 20260810121500.

## Data safety
- No data is modified. All policies are FOR SELECT only (read-only).
*/

DROP POLICY IF EXISTS "gestion_agboville_view_reservations" ON public.reservations;
CREATE POLICY "gestion_agboville_view_reservations"
ON public.reservations
FOR SELECT
TO authenticated
USING (public.get_my_role() = 'gestion_agboville');

DROP POLICY IF EXISTS "gestion_agboville_view_counter_charges" ON public.counter_charges;
CREATE POLICY "gestion_agboville_view_counter_charges"
ON public.counter_charges
FOR SELECT
TO authenticated
USING (public.get_my_role() = 'gestion_agboville');
