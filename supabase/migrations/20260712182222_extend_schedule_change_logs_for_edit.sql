/*
# Extend schedule_change_logs for route and departure_time changes

1. Schema Changes
  - Add columns: old_route_id, new_route_id, old_departure_datetime, new_departure_datetime
  - Drop and recreate check constraint to accept: 'bus', 'driver', 'route', 'departure_time', 'multiple'
  - 'multiple' is used when several fields change at once in a single edit operation

2. Security
  - No new policies needed — existing INSERT policy (authenticated + auth.uid() = changed_by) already allows chef_gare

3. Purpose
  - Enable the Chef de Gare to edit a scheduled departure's route, driver, bus, and departure time
  - All changes are tracked for audit purposes
*/

-- Add new columns for route and time changes
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'schedule_change_logs' AND column_name = 'old_route_id') THEN
    ALTER TABLE schedule_change_logs ADD COLUMN old_route_id uuid REFERENCES routes(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'schedule_change_logs' AND column_name = 'new_route_id') THEN
    ALTER TABLE schedule_change_logs ADD COLUMN new_route_id uuid REFERENCES routes(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'schedule_change_logs' AND column_name = 'old_departure_datetime') THEN
    ALTER TABLE schedule_change_logs ADD COLUMN old_departure_datetime timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'schedule_change_logs' AND column_name = 'new_departure_datetime') THEN
    ALTER TABLE schedule_change_logs ADD COLUMN new_departure_datetime timestamptz;
  END IF;
END $$;

-- Update check constraint to allow new change types
ALTER TABLE schedule_change_logs DROP CONSTRAINT IF EXISTS schedule_change_logs_change_type_check;
ALTER TABLE schedule_change_logs ADD CONSTRAINT schedule_change_logs_change_type_check
  CHECK (change_type = ANY (ARRAY['bus','driver','route','departure_time','multiple']));
