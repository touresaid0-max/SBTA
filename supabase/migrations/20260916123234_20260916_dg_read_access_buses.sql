-- Grant DG read access to buses table (needed for Bilan, Synthèse Bus, and registration numbers).
-- DG remains read-only: only the SELECT policy is modified.

DROP POLICY IF EXISTS "buses_select_admin_daf" ON buses;
CREATE POLICY "buses_select_admin_daf"
  ON buses FOR SELECT TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = ANY (ARRAY['admin', 'daf', 'dg'])
  );
