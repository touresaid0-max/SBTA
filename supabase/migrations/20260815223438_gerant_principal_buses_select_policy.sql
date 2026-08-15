/*
# Grant gerant_principal SELECT access on buses

The gerant_principal role needs to read buses for the stock exit form
(autocomplete on car/matricule field). No existing SELECT policy covers
this role, so the query returns zero rows.

1. Security
   - New SELECT policy on `buses` for `gerant_principal` role.
   - Read-only, all buses visible (same pattern as admin/daf).
*/

DROP POLICY IF EXISTS "buses_select_gerant_principal" ON buses;
CREATE POLICY "buses_select_gerant_principal"
  ON buses FOR SELECT
  TO authenticated
  USING (
    ((auth.jwt() -> 'app_metadata') ->> 'role') = 'gerant_principal'
  );
