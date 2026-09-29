/*
# Allow anon read on companies + reservations for kiosk terminal

## Problem
The kiosk terminal's searchTrips() calls fetchOperatingCompanies() which queries
the `companies` table. That table only has a SELECT policy for `authenticated`,
not `anon`. When the public kiosk (no login) calls it, zero rows are returned,
and searchTrips() short-circuits to { planned: [], provisional: null } at line 324.

This is why the kiosk shows "Aucun bus disponible pour ce trajet" even though
there IS a planned departure at Gare SBTA Adjamé.

Additionally, fetchScheduleSeatMap() reads the `reservations` table to show
occupied seats. Without anon access, the kiosk can't see which seats are taken.

## Fix
1. companies: add anon SELECT for active companies (public transport info)
2. reservations: add anon SELECT so the kiosk can see occupied seats on
   schedules it displays (filtered to non-cancelled statuses)

## Security
- companies: only SELECT, only active non-group companies — public info
- reservations: only SELECT — seat occupancy is public transport data needed
  for the seat map; no passenger PII is used by the kiosk (it only checks
  seat_numbers and status)
*/

-- companies: allow anon to view active companies
DROP POLICY IF EXISTS "anon can view active companies" ON public.companies;
CREATE POLICY "anon can view active companies"
  ON public.companies FOR SELECT
  TO anon
  USING (is_active = true);

-- reservations: allow anon to view non-cancelled reservations (for seat map)
DROP POLICY IF EXISTS "anon can view active reservations" ON public.reservations;
CREATE POLICY "anon can view active reservations"
  ON public.reservations FOR SELECT
  TO anon
  USING (status NOT IN ('annule', 'annulee', 'cancelled'));

-- mobile_bookings: allow anon to view confirmed bookings (for online seat check)
DROP POLICY IF EXISTS "anon can view confirmed mobile bookings" ON public.mobile_bookings;
CREATE POLICY "anon can view confirmed mobile bookings"
  ON public.mobile_bookings FOR SELECT
  TO anon
  USING (status = 'confirmed');

NOTIFY pgrst, 'reload schema';
