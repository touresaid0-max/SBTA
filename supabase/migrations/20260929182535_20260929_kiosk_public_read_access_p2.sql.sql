/*
# Allow anon read on route_city_stops + seat_locks for kiosk

## Problem
The kiosk terminal also needs route_city_stops (for intermediate destination
pricing) and seat_locks (to read current lock state). Both are authenticated-only.

## Fix
- route_city_stops: add anon SELECT
- seat_locks: add anon SELECT (insert is via the try_lock_seat RPC which is
  SECURITY DEFINER and already granted to anon)
*/

DROP POLICY IF EXISTS "anon can view route city stops" ON public.route_city_stops;
CREATE POLICY "anon can view route city stops"
  ON public.route_city_stops FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "anon can view seat locks" ON public.seat_locks;
CREATE POLICY "anon can view seat locks"
  ON public.seat_locks FOR SELECT
  TO anon, authenticated
  USING (true);

NOTIFY pgrst, 'reload schema';
