/*
# Ramassage module: financial affectation + audit + strict destination RLS

1. Columns: company_id, collected_by_name, collected_at, collected_places, collected_amount
2. Strict destination-only RLS (SELECT/UPDATE); INSERT any authenticated.
3. ramassage_audit table + trigger.
4. ramassage_revenue_by_company view for gestionnaire/DAF reports.
*/

ALTER TABLE ramassage_notifications
  ADD COLUMN IF NOT EXISTS company_id uuid,
  ADD COLUMN IF NOT EXISTS collected_by_name text,
  ADD COLUMN IF NOT EXISTS collected_at timestamptz,
  ADD COLUMN IF NOT EXISTS collected_places int,
  ADD COLUMN IF NOT EXISTS collected_amount numeric(14,2);

UPDATE ramassage_notifications rn
  SET company_id = b.company_id
  FROM buses b
  WHERE rn.bus_id = b.id AND rn.company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_ramassage_notif_company
  ON ramassage_notifications (company_id);

-- ===== Strict destination-only RLS =====
DROP POLICY IF EXISTS "select_ramassage_notifs" ON ramassage_notifications;
CREATE POLICY "select_ramassage_notifs"
  ON ramassage_notifications FOR SELECT
  TO authenticated
  USING (
    destination_station_id = (
      SELECT u.station_id FROM users u WHERE u.id = auth.uid()
    )
    OR destination_station_id IN (
      SELECT s.id FROM stations s WHERE s.station_manager_id = auth.uid()
    )
    OR destination_station_id IN (
      SELECT sm.station_id FROM station_managers sm WHERE sm.manager_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid() AND u.role IN ('admin','daf','gestionnaire')
    )
  );

DROP POLICY IF EXISTS "insert_ramassage_notifs" ON ramassage_notifications;
CREATE POLICY "insert_ramassage_notifs"
  ON ramassage_notifications FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_ramassage_notifs" ON ramassage_notifications;
CREATE POLICY "update_ramassage_notifs"
  ON ramassage_notifications FOR UPDATE
  TO authenticated
  USING (
    destination_station_id = (
      SELECT u.station_id FROM users u WHERE u.id = auth.uid()
    )
    OR destination_station_id IN (
      SELECT s.id FROM stations s WHERE s.station_manager_id = auth.uid()
    )
    OR destination_station_id IN (
      SELECT sm.station_id FROM station_managers sm WHERE sm.manager_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid() AND u.role IN ('admin','daf','gestionnaire')
    )
  )
  WITH CHECK (
    destination_station_id = (
      SELECT u.station_id FROM users u WHERE u.id = auth.uid()
    )
    OR destination_station_id IN (
      SELECT s.id FROM stations s WHERE s.station_manager_id = auth.uid()
    )
    OR destination_station_id IN (
      SELECT sm.station_id FROM station_managers sm WHERE sm.manager_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid() AND u.role IN ('admin','daf','gestionnaire')
    )
  );

-- ===== Audit =====
CREATE TABLE IF NOT EXISTS ramassage_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notif_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('INSERT','UPDATE')),
  changed_by uuid,
  changed_by_name text,
  old_status text,
  new_status text,
  old_collected_places int,
  new_collected_places int,
  old_collected_amount numeric,
  new_collected_amount numeric,
  bus_registration text,
  route_name text,
  destination_station_id uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ramassage_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_ramassage_audit" ON ramassage_audit;
CREATE POLICY "select_ramassage_audit"
  ON ramassage_audit FOR SELECT
  TO authenticated
  USING (
    destination_station_id = (SELECT u.station_id FROM users u WHERE u.id = auth.uid())
    OR destination_station_id IN (SELECT s.id FROM stations s WHERE s.station_manager_id = auth.uid())
    OR destination_station_id IN (SELECT sm.station_id FROM station_managers sm WHERE sm.manager_id = auth.uid())
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin','daf','gestionnaire'))
  );

DROP POLICY IF EXISTS "insert_ramassage_audit" ON ramassage_audit;
CREATE POLICY "insert_ramassage_audit"
  ON ramassage_audit FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE OR REPLACE FUNCTION fn_ramassage_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_user_name text;
BEGIN
  SELECT full_name INTO v_user_name FROM users WHERE id = v_user;
  INSERT INTO ramassage_audit (
    notif_id, action, changed_by, changed_by_name,
    old_status, new_status,
    old_collected_places, new_collected_places,
    old_collected_amount, new_collected_amount,
    bus_registration, route_name, destination_station_id
  ) VALUES (
    COALESCE(NEW.id, OLD.id), TG_OP, v_user, v_user_name,
    OLD.status, NEW.status,
    OLD.collected_places, NEW.collected_places,
    OLD.collected_amount, NEW.collected_amount,
    COALESCE(NEW.bus_registration, OLD.bus_registration),
    COALESCE(NEW.route_name, OLD.route_name),
    COALESCE(NEW.destination_station_id, OLD.destination_station_id)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ramassage_audit ON ramassage_notifications;
CREATE TRIGGER trg_ramassage_audit
  AFTER INSERT OR UPDATE ON ramassage_notifications
  FOR EACH ROW EXECUTE FUNCTION fn_ramassage_audit();

-- ===== Revenue view =====
CREATE OR REPLACE VIEW ramassage_revenue_by_company AS
SELECT
  company_id,
  bus_id,
  bus_registration,
  route_id,
  route_name,
  destination_station_id,
  destination_station_name,
  origin_station_name,
  COUNT(*) FILTER (WHERE status = 'done') AS ramassage_count,
  COALESCE(SUM(collected_places) FILTER (WHERE status = 'done'), 0) AS total_places,
  COALESCE(SUM(collected_amount) FILTER (WHERE status = 'done'), 0) AS total_amount,
  MAX(collected_at) FILTER (WHERE status = 'done') AS last_collected_at
FROM ramassage_notifications
GROUP BY company_id, bus_id, bus_registration, route_id, route_name,
         destination_station_id, destination_station_name, origin_station_name;

ALTER VIEW ramassage_revenue_by_company SET (security_barrier = true);
GRANT SELECT ON ramassage_revenue_by_company TO authenticated;

NOTIFY pgrst, 'reload schema';
