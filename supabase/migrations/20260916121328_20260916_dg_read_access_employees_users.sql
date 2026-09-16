-- Grant DG read access to employees and users tables for RH Reports.
-- DG remains read-only: only SELECT policies are modified.

-- 1. employees: add 'dg' to the RH/admin/DAF read policy
DROP POLICY IF EXISTS "employees_select_rh_admin_daf" ON employees;
CREATE POLICY "employees_select_rh_admin_daf"
  ON employees FOR SELECT TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = ANY (ARRAY['admin', 'rh', 'daf', 'dg'])
    OR (auth.jwt() -> 'user_metadata' ->> 'role') = ANY (ARRAY['admin', 'rh', 'daf', 'dg'])
  );

-- 2. users: add 'dg' to the admin/DAF read policy
DROP POLICY IF EXISTS "users_select_admin_daf" ON users;
CREATE POLICY "users_select_admin_daf"
  ON users FOR SELECT TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = ANY (ARRAY['admin', 'daf', 'dg'])
  );
