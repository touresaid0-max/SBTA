/*
# DAF breakdown alerts — add foreign key constraints

## Purpose
The `daf_breakdown_alerts` table was created with denormalized columns
(schedule_id, original_bus_id, route_id, station_id) but without FK
constraints. Adding them so the DAF frontend can use Supabase nested
selects to join bus/route/station names in a single query.

## Changes
- Adds FK constraints (with explicit names matching the query hints):
  - `daf_breakdown_alerts_schedule_id_fkey`
  - `daf_breakdown_alerts_original_bus_id_fkey`
  - `daf_breakdown_alerts_route_id_fkey`
  - `daf_breakdown_alerts_station_id_fkey`

## Security
- No RLS or policy changes.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'daf_breakdown_alerts_schedule_id_fkey'
  ) THEN
    ALTER TABLE daf_breakdown_alerts
      ADD CONSTRAINT daf_breakdown_alerts_schedule_id_fkey
      FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'daf_breakdown_alerts_original_bus_id_fkey'
  ) THEN
    ALTER TABLE daf_breakdown_alerts
      ADD CONSTRAINT daf_breakdown_alerts_original_bus_id_fkey
      FOREIGN KEY (original_bus_id) REFERENCES buses(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'daf_breakdown_alerts_route_id_fkey'
  ) THEN
    ALTER TABLE daf_breakdown_alerts
      ADD CONSTRAINT daf_breakdown_alerts_route_id_fkey
      FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'daf_breakdown_alerts_station_id_fkey'
  ) THEN
    ALTER TABLE daf_breakdown_alerts
      ADD CONSTRAINT daf_breakdown_alerts_station_id_fkey
      FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE SET NULL;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
