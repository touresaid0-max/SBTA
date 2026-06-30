/*
  # Bagagiste baggage sales access

  Grants the bagagiste role the access it needs to perform baggage ticket
  sales for the planned departures of the station(s) it is assigned to.

  1. baggage_tickets
     - New INSERT policy: a bagagiste may create baggage tickets they sell
       (sold_by must be their own uid). Reading own tickets is already covered
       by the existing "sold_by = auth.uid()" SELECT policy.

  2. departure_sequence
     - New SELECT policy: a bagagiste may read departure sequences (to display
       and print the departure number "N° départ") for counters that belong to
       the stations they are assigned to via station_baggage_handlers.

  No existing policy is modified; data on other roles is untouched.
*/

CREATE POLICY "Bagagiste can insert baggage tickets"
  ON baggage_tickets FOR INSERT
  TO authenticated
  WITH CHECK (
    sold_by = auth.uid()
    AND ((auth.jwt() -> 'app_metadata') ->> 'role') = 'bagagiste'
  );

CREATE POLICY "Bagagiste can view departure sequences for assigned stations"
  ON departure_sequence FOR SELECT
  TO authenticated
  USING (
    ((auth.jwt() -> 'app_metadata') ->> 'role') = 'bagagiste'
    AND counter_id IN (
      SELECT c.id FROM counters c
      WHERE c.station_id IN (
        SELECT sbh.station_id FROM station_baggage_handlers sbh
        WHERE sbh.handler_id = auth.uid()
      )
    )
  );

NOTIFY pgrst, 'reload schema';
