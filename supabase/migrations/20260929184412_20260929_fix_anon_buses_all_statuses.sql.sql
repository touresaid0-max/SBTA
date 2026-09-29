/*
# Fix anon buses SELECT — include all valid statuses

## Problem
The previous anon buses policy only allowed statuses ['active', 'en_route',
'au_garage', 'en_maintenance'], but the actual bus status is 'disponible'.
The PostgREST embedded buses() join returns null when the anon policy
doesn't match, so the kiosk can't see bus details.

## Fix
Allow anon to SELECT all buses (public fleet info — registration, seats).
No sensitive data is exposed.
*/

DROP POLICY IF EXISTS "anon can view active buses" ON public.buses;
CREATE POLICY "anon can view active buses"
  ON public.buses FOR SELECT
  TO anon
  USING (true);

NOTIFY pgrst, 'reload schema';
