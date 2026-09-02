/*
  # Station Daily Baggage Report Module

  1. New Tables
    - `station_daily_reports` — daily report per station (revenue auto from baggage_tickets, expenses, balance, validation)
    - `station_daily_expenses` — individual expense lines linked to a report

  2. Security
    - RLS enabled on both tables.
    - chef_gare: full CRUD on their own station's reports/expenses (before validation, enforced at app level).
    - responsable_logistique, admin, daf: read all.
    - Trigger auto-recomputes total_expenses and balance when expenses change.

  3. Notes
    - Baggage revenue is fetched live from baggage_tickets, NOT stored manually.
    - station_managers junction uses manager_id (not user_id).
*/

CREATE TABLE IF NOT EXISTS station_daily_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  report_date date NOT NULL,
  baggage_revenue integer NOT NULL DEFAULT 0,
  baggage_count integer NOT NULL DEFAULT 0,
  total_expenses integer NOT NULL DEFAULT 0,
  balance integer NOT NULL DEFAULT 0,
  validated boolean NOT NULL DEFAULT false,
  validated_by uuid REFERENCES auth.users(id),
  validated_at timestamptz,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (station_id, report_date)
);

CREATE INDEX IF NOT EXISTS idx_station_daily_reports_station ON station_daily_reports(station_id);
CREATE INDEX IF NOT EXISTS idx_station_daily_reports_date ON station_daily_reports(report_date);
CREATE INDEX IF NOT EXISTS idx_station_daily_reports_validated ON station_daily_reports(validated);

ALTER TABLE station_daily_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chef_gare_read_own_station_reports" ON station_daily_reports;
CREATE POLICY "chef_gare_read_own_station_reports"
  ON station_daily_reports FOR SELECT
  TO authenticated
  USING (
    ((auth.jwt() -> 'app_metadata') ->> 'role') IN ('admin', 'daf', 'responsable_logistique')
    OR (
      ((auth.jwt() -> 'app_metadata') ->> 'role') = 'chef_gare'
      AND EXISTS (
        SELECT 1 FROM station_managers sm
        WHERE sm.station_id = station_daily_reports.station_id
        AND sm.manager_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "chef_gare_insert_own_station_reports" ON station_daily_reports;
CREATE POLICY "chef_gare_insert_own_station_reports"
  ON station_daily_reports FOR INSERT
  TO authenticated
  WITH CHECK (
    ((auth.jwt() -> 'app_metadata') ->> 'role') IN ('admin', 'chef_gare')
    AND (
      ((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin'
      OR EXISTS (
        SELECT 1 FROM station_managers sm
        WHERE sm.station_id = station_id
        AND sm.manager_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "chef_gare_update_own_station_reports" ON station_daily_reports;
CREATE POLICY "chef_gare_update_own_station_reports"
  ON station_daily_reports FOR UPDATE
  TO authenticated
  USING (
    ((auth.jwt() -> 'app_metadata') ->> 'role') IN ('admin', 'chef_gare')
    AND (
      ((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin'
      OR EXISTS (
        SELECT 1 FROM station_managers sm
        WHERE sm.station_id = station_daily_reports.station_id
        AND sm.manager_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    ((auth.jwt() -> 'app_metadata') ->> 'role') IN ('admin', 'chef_gare')
  );

DROP POLICY IF EXISTS "chef_gare_delete_own_station_reports" ON station_daily_reports;
CREATE POLICY "chef_gare_delete_own_station_reports"
  ON station_daily_reports FOR DELETE
  TO authenticated
  USING (
    ((auth.jwt() -> 'app_metadata') ->> 'role') IN ('admin', 'chef_gare')
    AND (
      ((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin'
      OR EXISTS (
        SELECT 1 FROM station_managers sm
        WHERE sm.station_id = station_daily_reports.station_id
        AND sm.manager_id = auth.uid()
      )
    )
  );

-- ── station_daily_expenses ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS station_daily_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES station_daily_reports(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('ration', 'cie', 'sodeci_eau', 'wifi_internet', 'carburant', 'autre')),
  detail text,
  amount integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_station_daily_expenses_report ON station_daily_expenses(report_id);

ALTER TABLE station_daily_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chef_gare_read_own_expenses" ON station_daily_expenses;
CREATE POLICY "chef_gare_read_own_expenses"
  ON station_daily_expenses FOR SELECT
  TO authenticated
  USING (
    ((auth.jwt() -> 'app_metadata') ->> 'role') IN ('admin', 'daf', 'responsable_logistique')
    OR (
      ((auth.jwt() -> 'app_metadata') ->> 'role') = 'chef_gare'
      AND EXISTS (
        SELECT 1 FROM station_daily_reports r
        JOIN station_managers sm ON sm.station_id = r.station_id
        WHERE r.id = station_daily_expenses.report_id
        AND sm.manager_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "chef_gare_insert_own_expenses" ON station_daily_expenses;
CREATE POLICY "chef_gare_insert_own_expenses"
  ON station_daily_expenses FOR INSERT
  TO authenticated
  WITH CHECK (
    ((auth.jwt() -> 'app_metadata') ->> 'role') IN ('admin', 'chef_gare')
    AND EXISTS (
      SELECT 1 FROM station_daily_reports r
      LEFT JOIN station_managers sm ON sm.station_id = r.station_id
      WHERE r.id = report_id
      AND (
        ((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin'
        OR sm.manager_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "chef_gare_update_own_expenses" ON station_daily_expenses;
CREATE POLICY "chef_gare_update_own_expenses"
  ON station_daily_expenses FOR UPDATE
  TO authenticated
  USING (
    ((auth.jwt() -> 'app_metadata') ->> 'role') IN ('admin', 'chef_gare')
    AND EXISTS (
      SELECT 1 FROM station_daily_reports r
      LEFT JOIN station_managers sm ON sm.station_id = r.station_id
      WHERE r.id = station_daily_expenses.report_id
      AND (
        ((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin'
        OR sm.manager_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    ((auth.jwt() -> 'app_metadata') ->> 'role') IN ('admin', 'chef_gare')
  );

DROP POLICY IF EXISTS "chef_gare_delete_own_expenses" ON station_daily_expenses;
CREATE POLICY "chef_gare_delete_own_expenses"
  ON station_daily_expenses FOR DELETE
  TO authenticated
  USING (
    ((auth.jwt() -> 'app_metadata') ->> 'role') IN ('admin', 'chef_gare')
    AND EXISTS (
      SELECT 1 FROM station_daily_reports r
      LEFT JOIN station_managers sm ON sm.station_id = r.station_id
      WHERE r.id = station_daily_expenses.report_id
      AND (
        ((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin'
        OR sm.manager_id = auth.uid()
      )
    )
  );

-- ── Trigger: auto-recompute total_expenses + balance on expense change ──

CREATE OR REPLACE FUNCTION recompute_report_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rpt_id uuid;
  new_total integer;
BEGIN
  rpt_id := COALESCE(NEW.report_id, OLD.report_id);

  SELECT COALESCE(SUM(amount), 0) INTO new_total
  FROM station_daily_expenses
  WHERE report_id = rpt_id;

  UPDATE station_daily_reports
  SET total_expenses = new_total,
      balance = baggage_revenue - new_total,
      updated_at = now()
  WHERE id = rpt_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS station_daily_expenses_recompute ON station_daily_expenses;
CREATE TRIGGER station_daily_expenses_recompute
  AFTER INSERT OR UPDATE OR DELETE ON station_daily_expenses
  FOR EACH ROW
  EXECUTE FUNCTION recompute_report_totals();

NOTIFY pgrst, 'reload schema';
