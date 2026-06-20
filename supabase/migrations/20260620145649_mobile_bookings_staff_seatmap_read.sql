-- Permettre au personnel (guichet, chef de gare, gestionnaire, daf, admin)
-- de lire les reservations en ligne confirmees rattachees a un voyage (schedule),
-- pour les afficher dans le plan de bus (sieges jaunes) et les listes.

CREATE POLICY "staff_read_confirmed_mobile_bookings" ON mobile_bookings
  FOR SELECT
  TO authenticated
  USING (
    schedule_id IS NOT NULL
    AND get_my_role() = ANY (ARRAY[
      'guichetier', 'chef_gare', 'gestionnaire', 'daf', 'admin', 'agent_reservation'
    ])
  );

-- Realtime: le plan de bus se rafraichit quand une reservation en ligne est confirmee.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'mobile_bookings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE mobile_bookings;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
