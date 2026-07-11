-- Allow superviseur_colis and admin to DELETE parcels
CREATE POLICY "superviseur_colis_delete"
  ON parcels FOR DELETE
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('superviseur_colis','admin')
  );
