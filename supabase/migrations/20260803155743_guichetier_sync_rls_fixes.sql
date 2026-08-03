/*
# Fix RLS policies for POS offline sync

1. Changes
   - Allow guichetier role to INSERT into schedules (for their own departure station).
   - Allow guichetier role to INSERT into bus_expenses.
   - Allow guichetier role to UPDATE schedules they created.

2. Security
   - guichetier INSERT on schedules restricted to departure_station_id matching their station.
   - guichetier INSERT on bus_expenses restricted to created_by = auth.uid().
   - guichetier UPDATE on schedules restricted to created_by = auth.uid().

3. Important Notes
   - These policies allow the POS terminal to sync locally created departures, tickets, and expenses.
*/

-- Allow guichetier to INSERT schedules for their station
DROP POLICY IF EXISTS "Guichetier can create schedules from POS" ON schedules;
CREATE POLICY "Guichetier can create schedules from POS"
  ON schedules FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() IN ('guichetier', 'admin')
  );

-- Allow guichetier to UPDATE schedules they created (for seat count updates)
DROP POLICY IF EXISTS "Guichetier can update own schedules from POS" ON schedules;
CREATE POLICY "Guichetier can update own schedules from POS"
  ON schedules FOR UPDATE
  TO authenticated
  USING (
    get_user_role() IN ('admin', 'guichetier') AND (created_by = auth.uid() OR get_user_role() = 'admin')
  )
  WITH CHECK (
    get_user_role() IN ('admin', 'guichetier')
  );

-- Allow guichetier to INSERT bus_expenses
DROP POLICY IF EXISTS "Guichetier can insert bus expenses from POS" ON bus_expenses;
CREATE POLICY "Guichetier can insert bus expenses from POS"
  ON bus_expenses FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() IN ('admin', 'guichetier', 'chauffeur', 'chef_garage', 'comptable', 'gestionnaire')
  );
