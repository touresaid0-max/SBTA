/*
# Fix POS convoy schedule insertion — aller & retour legs

1. Purpose
- Allow a guichetier to create both legs of an aller-retour convoy from the POS.
- The aller schedule departs from the guichetier's station → already allowed.
- The retour schedule departs from the destination station and arrives back at
  the guichetier's station → was blocked by the old policy that only checked
  departure_station_id against the guichetier's counter.

2. Modified table
- `schedules` (INSERT policy only)

3. Security changes
- Replaces the previous INSERT policy "Guichetier can create schedules from POS".
- Admins may still insert any schedule.
- Guichetiers may insert a schedule when their counter or user-station assignment
  matches the schedule's departure_station_id (aller leg) OR the schedule's
  arrival_station_id (retour leg of a round-trip convoy).
- No anonymous or public access is enabled.
- The station check still prevents creating schedules for unrelated stations.

4. Important notes
- This changes access control only; it does not alter schedule data, columns,
  or creation logic.
- The OR on arrival_station_id is scoped to guichetier role only and does not
  grant access to stations the user is not assigned to — the bus must arrive
  at their own station for the retour leg to be allowed.
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
      -- Aller leg: guichetier's station is the departure station
      EXISTS (
        SELECT 1 FROM public.counters
        WHERE counters.assigned_user_id = auth.uid()
          AND counters.station_id = schedules.departure_station_id
          AND counters.is_active = true
      )
      OR EXISTS (
        SELECT 1 FROM public.users
        WHERE users.id = auth.uid()
          AND users.station_id = schedules.departure_station_id
      )
      -- Retour leg: guichetier's station is the arrival station
      OR EXISTS (
        SELECT 1 FROM public.counters
        WHERE counters.assigned_user_id = auth.uid()
          AND counters.station_id = schedules.arrival_station_id
          AND counters.is_active = true
      )
      OR EXISTS (
        SELECT 1 FROM public.users
        WHERE users.id = auth.uid()
          AND users.station_id = schedules.arrival_station_id
      )
    )
  )
);