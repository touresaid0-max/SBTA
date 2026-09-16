-- Grant DG read access to all tables used by Logistique and RH reports.
-- DG remains read-only: only SELECT policies are recreated, no INSERT/UPDATE/DELETE granted.

-- 1. baggage_tickets
DROP POLICY IF EXISTS "Guichetier can read own baggage tickets" ON baggage_tickets;
CREATE POLICY "Guichetier can read own baggage tickets"
  ON baggage_tickets FOR SELECT TO authenticated
  USING (
    sold_by = auth.uid()
    OR (auth.jwt() -> 'app_metadata' ->> 'role') = ANY (
      ARRAY['admin', 'chef_gare', 'comptable', 'gestionnaire', 'daf', 'dg']
    )
  );

-- 2. station_daily_reports
DROP POLICY IF EXISTS "chef_gare_read_own_station_reports" ON station_daily_reports;
CREATE POLICY "chef_gare_read_own_station_reports"
  ON station_daily_reports FOR SELECT TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = ANY (
      ARRAY['admin', 'daf', 'responsable_logistique', 'dg']
    )
    OR (
      (auth.jwt() -> 'app_metadata' ->> 'role') = 'chef_gare'
      AND EXISTS (
        SELECT 1 FROM station_managers sm
        WHERE sm.station_id = station_daily_reports.station_id
          AND sm.manager_id = auth.uid()
      )
    )
  );

-- 3. station_daily_expenses
DROP POLICY IF EXISTS "chef_gare_read_own_expenses" ON station_daily_expenses;
CREATE POLICY "chef_gare_read_own_expenses"
  ON station_daily_expenses FOR SELECT TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = ANY (
      ARRAY['admin', 'daf', 'responsable_logistique', 'dg']
    )
    OR (
      (auth.jwt() -> 'app_metadata' ->> 'role') = 'chef_gare'
      AND EXISTS (
        SELECT 1
        FROM station_daily_reports r
        JOIN station_managers sm ON sm.station_id = r.station_id
        WHERE r.id = station_daily_expenses.report_id
          AND sm.manager_id = auth.uid()
      )
    )
  );

-- 4. fuel_logs
DROP POLICY IF EXISTS "Staff can view fuel logs" ON fuel_logs;
CREATE POLICY "Staff can view fuel logs"
  ON fuel_logs FOR SELECT TO authenticated
  USING (
    get_user_role() = ANY (
      ARRAY['admin', 'daf', 'comptable', 'pompiste', 'responsable_logistique', 'dg']
    )
  );

-- 5. fuel_vouchers
DROP POLICY IF EXISTS "Staff can view all fuel vouchers" ON fuel_vouchers;
CREATE POLICY "Staff can view all fuel vouchers"
  ON fuel_vouchers FOR SELECT TO authenticated
  USING (
    get_user_role() = ANY (
      ARRAY['admin', 'daf', 'comptable', 'pompiste', 'responsable_logistique', 'dg']
    )
  );

-- 6. comptable_fuel_withdrawals: add a dedicated DG read policy
CREATE POLICY "dg can read all fuel withdrawals"
  ON comptable_fuel_withdrawals FOR SELECT TO authenticated
  USING (get_user_role() = 'dg');

-- 7. vehicle_expenses: add a dedicated DG read policy (all validated expenses, like DAF)
CREATE POLICY "dg sees all validated vehicle expenses"
  ON vehicle_expenses FOR SELECT TO authenticated
  USING (
    get_user_role() = 'dg'
    AND validation_status = 'validee'
  );
