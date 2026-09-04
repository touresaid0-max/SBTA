-- Allow responsable_assurance to SELECT buses (needed for vehicle insurance form)
-- The buses table already has multiple role-specific SELECT policies; this adds
-- the responsable_assurance role so the insurance module can list all vehicles.
CREATE POLICY "buses_select_responsable_assurance"
  ON buses FOR SELECT
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'responsable_assurance'
  );

NOTIFY pgrst, 'reload schema';
