/*
# Fix guichetier INSERT schedules - use counter station_id

1. Changes
   - Update the "Guichetier can create schedules from POS" policy to validate
     departure_station_id matches the guichetier's counter station.

2. Security
   - Guichetier can only insert schedules for the station where their counter is.
   - Admin can insert any schedule.
*/

DROP POLICY IF EXISTS "Guichetier can create schedules from POS" ON schedules;
CREATE POLICY "Guichetier can create schedules from POS"
  ON schedules FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() = 'admin'
    OR (
      get_user_role() = 'guichetier'
      AND EXISTS (
        SELECT 1 FROM counters
        WHERE counters.assigned_user_id = auth.uid()
          AND counters.station_id = schedules.departure_station_id
      )
    )
  );
