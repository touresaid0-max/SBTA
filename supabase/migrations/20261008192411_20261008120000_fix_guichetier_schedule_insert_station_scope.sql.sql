/*
# Fix POS convoy schedule insertion access

1. Purpose
- Restore schedule creation from the Guichet POS when the logged-in guichetier is correctly assigned to the departure station.
- Keep schedule creation restricted to administrators or the guichetier's own station.

2. Modified table
- `schedules`
- Replaces the INSERT policy used by the Guichet POS.

3. Security changes
- Administrators may create schedules as before.
- Guichetiers must have the `guichetier` role and their authenticated user record must be assigned to the schedule's departure station.
- A matching active counter assignment remains accepted, so existing POS accounts continue to work.
- No public or anonymous schedule insertion is enabled.

4. Important notes
- This changes access control only; it does not alter schedule data, columns, or creation logic.
- The station check prevents a guichetier from creating schedules for another station.
*/

DROP POLICY IF EXISTS "Guichetier can create schedules from POS" ON public.schedules;

CREATE POLICY "Guichetier can create schedules from POS"
ON public.schedules
FOR INSERT
TO authenticated
WITH CHECK (
  get_user_role() = 'admin'
  OR (
    get_user_role() = 'guichetier'
    AND (
      EXISTS (
        SELECT 1
        FROM public.counters
        WHERE counters.assigned_user_id = auth.uid()
          AND counters.station_id = schedules.departure_station_id
          AND counters.is_active = true
      )
      OR EXISTS (
        SELECT 1
        FROM public.users
        WHERE users.id = auth.uid()
          AND users.station_id = schedules.departure_station_id
      )
    )
  )
);