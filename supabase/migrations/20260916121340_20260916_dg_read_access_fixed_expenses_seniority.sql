-- Grant DG read access to remaining RH/logistics tables.
-- DG remains read-only: only SELECT policies are modified.

-- 1. fixed_expenses: add 'dg' to the read whitelist
DROP POLICY IF EXISTS "select_fixed_expenses" ON fixed_expenses;
CREATE POLICY "select_fixed_expenses"
  ON fixed_expenses FOR SELECT TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = ANY (
      ARRAY['charge_achat', 'admin', 'daf', 'comptable', 'gestionnaire', 'dg']
    )
  );

-- 2. seniority_settings: add 'dg' to the read whitelist
DROP POLICY IF EXISTS "rh_admin_read_seniority_settings" ON seniority_settings;
CREATE POLICY "rh_admin_read_seniority_settings"
  ON seniority_settings FOR SELECT TO authenticated
  USING (
    get_my_role() = ANY (ARRAY['rh', 'admin', 'gestionnaire', 'daf', 'dg'])
  );
