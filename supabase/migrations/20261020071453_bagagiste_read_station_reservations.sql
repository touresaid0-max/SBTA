/*
  # Bagagiste can read tickets of their assigned station

  1. Purpose
     - The TPE-POS "Rechercher ticket" feature lets a bagagiste find a passenger
       ticket by its last 4 characters. Until now no SELECT policy existed on
       `reservations` for the bagagiste role, so the online search always
       returned zero rows ("Aucun ticket trouvé").

  2. Security
     - New SELECT-only policy on `reservations` for authenticated users whose
       app_metadata role is `bagagiste`.
     - Scoped to reservations whose schedule departs from a station the
       bagagiste is assigned to via `station_baggage_handlers`.
     - No insert/update/delete rights granted; no existing policy modified.
*/

DROP POLICY IF EXISTS "Bagagiste can view reservations of assigned stations" ON reservations;
CREATE POLICY "Bagagiste can view reservations of assigned stations"
  ON reservations FOR SELECT
  TO authenticated
  USING (
    ((auth.jwt() -> 'app_metadata') ->> 'role') = 'bagagiste'
    AND EXISTS (
      SELECT 1 FROM schedules s
      JOIN station_baggage_handlers sbh ON sbh.station_id = s.departure_station_id
      WHERE s.id = reservations.schedule_id
        AND sbh.handler_id = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';
