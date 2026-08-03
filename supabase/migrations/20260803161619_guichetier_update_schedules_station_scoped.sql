/*
# Fix guichetier UPDATE schedules - use counter station_id lookup

1. Changes
   - Replace station-scoped update policy to use counter lookup instead of
     get_my_station_id() which only works for chef_gare.
   - Guichetier can update any schedule at the station where their counter is.

2. Security
   - The EXISTS check verifies the guichetier has a counter at the same station
     as the schedule's departure_station_id.
   - Admin can update any schedule.
*/

DROP POLICY IF EXISTS "Guichetier can update own schedules from POS" ON schedules;
CREATE POLICY "Guichetier can update own schedules from POS"
  ON schedules FOR UPDATE
  TO authenticated
  USING (
    get_user_role() = 'admin'
    OR (
      get_user_role() = 'guichetier'
      AND (
        created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM counters
          WHERE counters.assigned_user_id = auth.uid()
            AND counters.station_id = schedules.departure_station_id
        )
      )
    )
  )
  WITH CHECK (
    get_user_role() = 'admin'
    OR get_user_role() = 'guichetier'
  );
