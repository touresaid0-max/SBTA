-- Allow gerant_principal to SELECT and INSERT employees (technician creation)
-- The Gérant Principal needs to create technician records that will appear
-- in Admin (pending accounts) and RH (employee fiches).

-- SELECT: allow gerant_principal to read employees
CREATE POLICY "employees_select_gerant_principal"
  ON employees FOR SELECT
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'gerant_principal'
    OR (auth.jwt() -> 'user_metadata' ->> 'role') = 'gerant_principal'
  );

-- INSERT: allow gerant_principal to create employees (technicians)
CREATE POLICY "employees_insert_gerant_principal"
  ON employees FOR INSERT
  TO authenticated
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'gerant_principal'
    OR (auth.jwt() -> 'user_metadata' ->> 'role') = 'gerant_principal'
  );

NOTIFY pgrst, 'reload schema';
