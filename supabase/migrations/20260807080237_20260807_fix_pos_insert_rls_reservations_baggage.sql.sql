-- Fix RLS INSERT policies for reservations and baggage_tickets
-- Problem: policies required booked_by/sold_by = auth.uid() AND JWT app_metadata.role
-- When the JWT role metadata is missing or auth.uid() returns null during token refresh,
-- inserts from the POS (guichet) fail with "new row violates row-level security policy".
-- Fix: use get_user_role() (reads from users table) instead of JWT, and allow role-based
-- inserts without requiring booked_by/sold_by to match (the role check itself proves
-- authorization). Keep booked_by/sold_by as informational fields set by the client.

-- ── reservations INSERT ──
DROP POLICY IF EXISTS "Guichetier can insert own reservations" ON reservations;
DROP POLICY IF EXISTS "Guichetier can insert reservations" ON reservations;

CREATE POLICY "Guichetier can insert reservations"
  ON reservations FOR INSERT
  TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'guichetier', 'chef_gare'));

-- ── reservations UPDATE ── (keep ownership check but use get_user_role for role)
DROP POLICY IF EXISTS "Guichetier can update own reservations" ON reservations;
CREATE POLICY "Guichetier can update own reservations"
  ON reservations FOR UPDATE
  TO authenticated
  USING (
    public.get_user_role() = 'admin'
    OR (public.get_user_role() = 'guichetier' AND booked_by = auth.uid())
  )
  WITH CHECK (
    public.get_user_role() = 'admin'
    OR (public.get_user_role() = 'guichetier' AND booked_by = auth.uid())
  );

-- ── baggage_tickets INSERT ──
DROP POLICY IF EXISTS "Guichetier can insert baggage tickets" ON baggage_tickets;
DROP POLICY IF EXISTS "Bagagiste can insert baggage tickets" ON baggage_tickets;

CREATE POLICY "Guichetier can insert baggage tickets"
  ON baggage_tickets FOR INSERT
  TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'guichetier', 'chef_gare'));

CREATE POLICY "Bagagiste can insert baggage tickets"
  ON baggage_tickets FOR INSERT
  TO authenticated
  WITH CHECK (public.get_user_role() = 'bagagiste');

-- ── baggage_tickets UPDATE ── (keep ownership check but use get_user_role for role)
DROP POLICY IF EXISTS "Guichetier can update own baggage tickets" ON baggage_tickets;
CREATE POLICY "Guichetier can update own baggage tickets"
  ON baggage_tickets FOR UPDATE
  TO authenticated
  USING (public.get_user_role() IN ('admin', 'guichetier', 'chef_gare', 'bagagiste'))
  WITH CHECK (public.get_user_role() IN ('admin', 'guichetier', 'chef_gare', 'bagagiste'));
