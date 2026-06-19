DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'parcels' AND policyname = 'authenticated_tracking_read'
  ) THEN
    CREATE POLICY "authenticated_tracking_read" ON parcels
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';