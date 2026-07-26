/*
# DAF breakdown alerts

## Purpose
When a Chef de gare declares a breakdown (insert into `schedule_breakdowns`
with status = 'signalee'), the DAF must receive a real-time alert so they can
treat it. The alert stays visible until the breakdown is treated/closed
(status no longer 'signalee').

## New Tables
- `daf_breakdown_alerts`
  - `id` uuid PK
  - `breakdown_id` uuid → schedule_breakdowns.id (ON DELETE CASCADE)
  - `schedule_id` uuid (denormalized for display)
  - `original_bus_id` uuid (denormalized)
  - `route_id` uuid (denormalized)
  - `station_id` uuid (denormalized)
  - `reason` text (motif de la panne)
  - `breakdown_at` timestamptz (date/heure de la déclaration)
  - `is_active` boolean DEFAULT true (false once the breakdown is treated/closed)
  - `created_at` timestamptz DEFAULT now()

## Triggers
- `on_breakdown_insert_create_daf_alert` — AFTER INSERT on schedule_breakdowns:
  creates a daf_breakdown_alerts row when the new breakdown has status 'signalee'.
- `on_breakdown_update_deactivate_daf_alert` — AFTER UPDATE on schedule_breakdowns:
  sets is_active = false when the breakdown status changes away from 'signalee'.

## Realtime
- `daf_breakdown_alerts` added to the supabase_realtime publication so the
  DAF frontend is notified instantly of new and resolved alerts.

## Security
- RLS enabled. SELECT restricted to authenticated users with role 'daf' or
  'admin'. No INSERT/UPDATE/DELETE via API — the table is managed entirely by
  the database triggers (SECURITY DEFINER functions), so no client-write
  policies are created.
*/

CREATE TABLE IF NOT EXISTS daf_breakdown_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  breakdown_id    uuid NOT NULL REFERENCES schedule_breakdowns(id) ON DELETE CASCADE,
  schedule_id     uuid,
  original_bus_id uuid,
  route_id        uuid,
  station_id      uuid,
  reason          text,
  breakdown_at    timestamptz NOT NULL DEFAULT now(),
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (breakdown_id)
);

CREATE INDEX IF NOT EXISTS idx_daf_alerts_active ON daf_breakdown_alerts(is_active) WHERE is_active = true;

ALTER TABLE daf_breakdown_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "daf_admin_read_breakdown_alerts" ON daf_breakdown_alerts;
CREATE POLICY "daf_admin_read_breakdown_alerts"
  ON daf_breakdown_alerts FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role IN ('daf', 'admin')
    )
  );

-- Trigger: create alert on breakdown insert
CREATE OR REPLACE FUNCTION create_daf_breakdown_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'signalee' THEN
    INSERT INTO daf_breakdown_alerts
      (breakdown_id, schedule_id, original_bus_id, route_id, station_id, reason, breakdown_at)
    VALUES
      (NEW.id, NEW.schedule_id, NEW.original_bus_id, NEW.route_id, NEW.station_id, NEW.reason, NEW.breakdown_at)
    ON CONFLICT (breakdown_id) DO UPDATE
      SET is_active = true,
          reason = EXCLUDED.reason,
          breakdown_at = EXCLUDED.breakdown_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_breakdown_insert_create_daf_alert ON schedule_breakdowns;
CREATE TRIGGER on_breakdown_insert_create_daf_alert
  AFTER INSERT ON schedule_breakdowns
  FOR EACH ROW EXECUTE FUNCTION create_daf_breakdown_alert();

-- Trigger: deactivate alert when breakdown status changes away from 'signalee'
CREATE OR REPLACE FUNCTION deactivate_daf_breakdown_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'signalee' AND NEW.status <> 'signalee' THEN
    UPDATE daf_breakdown_alerts
      SET is_active = false
      WHERE breakdown_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_breakdown_update_deactivate_daf_alert ON schedule_breakdowns;
CREATE TRIGGER on_breakdown_update_deactivate_daf_alert
  AFTER UPDATE ON schedule_breakdowns
  FOR EACH ROW EXECUTE FUNCTION deactivate_daf_breakdown_alert();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE daf_breakdown_alerts;

NOTIFY pgrst, 'reload schema';
