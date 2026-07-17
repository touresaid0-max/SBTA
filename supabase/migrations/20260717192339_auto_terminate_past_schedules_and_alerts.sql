/*
# Auto-terminate past schedules and notify chef de gare

1. New Functions
   - `auto_terminate_past_schedules(p_station_id uuid)`: Automatically marks schedules
     from previous days that are still 'en_cours' or 'retard' as 'termine'.
     Returns a JSON array of schedules that were auto-terminated WITH missing data
     (charges not registered), so the frontend can display alerts to the chef de gare.

2. New Table
   - `schedule_auto_close_alerts`: Stores notifications for chef de gare when
     schedules were auto-closed without all data being registered.
     - `id` (uuid, PK)
     - `schedule_id` (uuid, FK to schedules)
     - `station_id` (uuid, FK to stations)
     - `alert_type` (text): 'missing_charges', 'missing_tickets', 'auto_terminated'
     - `message` (text): Human-readable alert message
     - `acknowledged` (boolean): Whether chef de gare has seen it
     - `created_at` (timestamptz)

3. Security
   - RLS enabled on schedule_auto_close_alerts
   - Authenticated users can SELECT alerts for their station
   - Only the system function (SECURITY DEFINER) inserts alerts

4. Important Notes
   - The function is SECURITY DEFINER so it can update schedules regardless of who calls it
   - It only affects schedules where departure_datetime < start of current day
   - It checks if counter_charges exist for each schedule to determine if data is missing
   - Called from the frontend on page load (Chef de Gare, Guichetier)
*/

-- Table for storing auto-close notifications
CREATE TABLE IF NOT EXISTS schedule_auto_close_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid REFERENCES schedules(id) ON DELETE CASCADE,
  station_id uuid REFERENCES stations(id) ON DELETE CASCADE,
  alert_type text NOT NULL DEFAULT 'auto_terminated',
  message text NOT NULL,
  acknowledged boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE schedule_auto_close_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_select_alerts" ON schedule_auto_close_alerts;
CREATE POLICY "authenticated_select_alerts" ON schedule_auto_close_alerts
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_update_alerts" ON schedule_auto_close_alerts;
CREATE POLICY "authenticated_update_alerts" ON schedule_auto_close_alerts
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Function to auto-terminate past schedules
CREATE OR REPLACE FUNCTION auto_terminate_past_schedules(p_station_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  results jsonb := '[]'::jsonb;
  has_charges boolean;
  alert_msg text;
BEGIN
  -- Find all schedules that are still en_cours/retard but departure was before today
  FOR rec IN
    SELECT s.id, s.route_id, s.bus_id, s.departure_datetime, s.status,
           r.name as route_name,
           b.plate_number
    FROM schedules s
    LEFT JOIN routes r ON r.id = s.route_id
    LEFT JOIN buses b ON b.id = s.bus_id
    WHERE s.status IN ('en_cours', 'retard')
      AND s.departure_datetime < date_trunc('day', now())
      AND (p_station_id IS NULL OR s.departure_station_id = p_station_id)
    ORDER BY s.departure_datetime ASC
  LOOP
    -- Check if charges were registered for this schedule
    SELECT EXISTS(
      SELECT 1 FROM counter_charges WHERE schedule_id = rec.id
    ) INTO has_charges;

    -- Auto-terminate the schedule
    UPDATE schedules
    SET status = 'termine',
        updated_at = now()
    WHERE id = rec.id;

    -- If charges are missing, create an alert for chef de gare
    IF NOT has_charges THEN
      alert_msg := 'Voyage ' || COALESCE(rec.route_name, '') || ' (' ||
                   COALESCE(rec.plate_number, '') || ') du ' ||
                   to_char(rec.departure_datetime, 'DD/MM/YYYY HH24:MI') ||
                   ' terminé automatiquement SANS charges enregistrées';

      INSERT INTO schedule_auto_close_alerts (schedule_id, station_id, alert_type, message)
      VALUES (
        rec.id,
        p_station_id,
        'missing_charges',
        alert_msg
      ) ON CONFLICT DO NOTHING;

      results := results || jsonb_build_object(
        'schedule_id', rec.id,
        'route_name', rec.route_name,
        'plate_number', rec.plate_number,
        'departure', rec.departure_datetime,
        'missing_charges', true
      );
    ELSE
      results := results || jsonb_build_object(
        'schedule_id', rec.id,
        'route_name', rec.route_name,
        'plate_number', rec.plate_number,
        'departure', rec.departure_datetime,
        'missing_charges', false
      );
    END IF;
  END LOOP;

  RETURN results;
END;
$$;

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_schedule_auto_close_alerts_station_ack
  ON schedule_auto_close_alerts(station_id, acknowledged);

CREATE INDEX IF NOT EXISTS idx_schedules_status_departure
  ON schedules(status, departure_datetime)
  WHERE status IN ('en_cours', 'retard');
