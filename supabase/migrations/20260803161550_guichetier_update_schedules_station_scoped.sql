/*
# Widen guichetier UPDATE on schedules for POS sync

1. Changes
   - Replace the restrictive "Guichetier can update own schedules from POS" policy
     (which required created_by = auth.uid()) with a station-scoped policy.
   - The guichetier needs to update seats_reserved on schedules created by the
     chef_gare for the same station. The new policy allows guichetier to update
     any schedule at their assigned station.

2. Security
   - Guichetier can update schedules whose departure_station_id matches their station (via get_my_station_id()).
   - Admin can update any schedule.
*/

DROP POLICY IF EXISTS "Guichetier can update own schedules from POS" ON schedules;
CREATE POLICY "Guichetier can update own schedules from POS"
  ON schedules FOR UPDATE
  TO authenticated
  USING (
    get_user_role() = 'admin'
    OR (get_user_role() = 'guichetier' AND departure_station_id = get_my_station_id())
  )
  WITH CHECK (
    get_user_role() = 'admin'
    OR (get_user_role() = 'guichetier' AND departure_station_id = get_my_station_id())
  );
