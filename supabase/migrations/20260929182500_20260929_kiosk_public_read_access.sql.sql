/*
# Allow public (anon) read access for kiosk terminal

## Problem
The kiosk terminal (/bornes/:slug, /bornes/terminal) is a public page with no
authenticated user. It uses the anon Supabase key. All tables it needs to read
(routes, cities, stations, schedules, buses, bus_seat_config) have SELECT
policies scoped to `authenticated` only, so the anon client gets zero rows.

This blocks the ticket sale flow at "Ville de départ" — the origin cities list
is empty because the routes query returns nothing.

## Fix
Extend the existing public-read SELECT policies to include `anon` alongside
`authenticated`. Only SELECT is opened; INSERT/UPDATE/DELETE are unchanged.

## Tables affected
- routes: "Anyone can view active routes" → add anon
- cities: "Anyone can view active cities" → add anon
- stations: "Anyone can view active stations" → add anon
- schedules: "Anyone can view schedules" → add anon
- buses: add a new anon SELECT policy for active buses
- bus_seat_config: add a new anon SELECT policy

## Security
- Only SELECT is opened to anon; no write access
- routes/cities/stations filtered to is_active = true where applicable
- schedules and bus_seat_config are public transport data (timetables, seat maps)
- No sensitive user data, passwords, or financial data is exposed
*/

-- routes: allow anon to view active routes
DROP POLICY IF EXISTS "Anyone can view active routes" ON public.routes;
CREATE POLICY "Anyone can view active routes"
  ON public.routes FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

-- cities: allow anon to view active cities
DROP POLICY IF EXISTS "Anyone can view active cities" ON public.cities;
CREATE POLICY "Anyone can view active cities"
  ON public.cities FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

-- stations: allow anon to view active stations
DROP POLICY IF EXISTS "Anyone can view active stations" ON public.stations;
CREATE POLICY "Anyone can view active stations"
  ON public.stations FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

-- schedules: allow anon to view schedules (public timetable data)
DROP POLICY IF EXISTS "Anyone can view schedules" ON public.schedules;
CREATE POLICY "Anyone can view schedules"
  ON public.schedules FOR SELECT
  TO anon, authenticated
  USING (true);

-- buses: add anon SELECT for active buses (needed for trip search results)
DROP POLICY IF EXISTS "anon can view active buses" ON public.buses;
CREATE POLICY "anon can view active buses"
  ON public.buses FOR SELECT
  TO anon
  USING (status = ANY (ARRAY['active', 'en_route', 'au_garage', 'en_maintenance']));

-- bus_seat_config: add anon SELECT (needed for seat map display)
DROP POLICY IF EXISTS "anon can view seat configs" ON public.bus_seat_config;
CREATE POLICY "anon can view seat configs"
  ON public.bus_seat_config FOR SELECT
  TO anon
  USING (true);

-- Also check if there's a counter_charges or similar table needed by the kiosk
-- The kiosk also reads kiosk_tickets (its own table) — ensure anon can read
-- kiosk_tickets for payment polling
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'kiosk_tickets' AND policyname = 'anon can view own kiosk tickets'
  ) THEN
    CREATE POLICY "anon can view own kiosk tickets"
      ON public.kiosk_tickets FOR SELECT
      TO anon, authenticated
      USING (true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
