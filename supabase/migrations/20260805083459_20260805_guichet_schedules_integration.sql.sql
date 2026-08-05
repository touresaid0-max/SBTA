/*
# Integrate guichet departures into Chef de Gare planning

## Context
Departures created from the /guichet/accueil module (POS guichet) already sync to the
`schedules` table in real-time, but they are missing three pieces of data that the
Chef de Gare planning page needs to display them homogeneously with other departures:

1. `arrival_station_id` — never set by the guichet module, so the destination column
   shows blank in DailyPlanning.
2. `source` — no way to distinguish guichet-created schedules from chef-de-gare-created
   ones, so the UI cannot apply the "Départ N" display rule.
3. `counter_id` and `departure_number` — stored only in local IndexedDB, not in
   Supabase, so the Chef de Gare page cannot show which guichet created the departure
   or its sequential number.

## Changes

### New columns on `schedules`
- `source` TEXT DEFAULT 'chef_gare' — tracks the origin of the schedule.
  Values: 'chef_gare' (default), 'guichet' (POS module).
- `counter_id` UUID NULL — links the schedule to the counter (guichet) that created it.
- `departure_number` INTEGER NULL — the sequential departure number assigned by the
  guichet module (per station + counter + date).

### Backfill `arrival_station_id` for existing guichet departures
For schedules where `arrival_station_id IS NULL` and a `route_id` is present, set
`arrival_station_id` from the route's `destination_station_id`.

### Backfill `source` for existing guichet departures
Schedules where `arrival_station_id` was NULL before this migration are flagged as
`source = 'guichet'` (since chef-de-gare departures always set arrival_station_id).

### Security
No RLS policy changes — the existing schedules policies already cover the new columns.
*/

-- 1. Add source column
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'schedules' AND column_name = 'source') THEN
    ALTER TABLE schedules ADD COLUMN source text DEFAULT 'chef_gare';
  END IF;
END $$;

-- 2. Add counter_id column
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'schedules' AND column_name = 'counter_id') THEN
    ALTER TABLE schedules ADD COLUMN counter_id uuid;
  END IF;
END $$;

-- 3. Add departure_number column
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'schedules' AND column_name = 'departure_number') THEN
    ALTER TABLE schedules ADD COLUMN departure_number integer;
  END IF;
END $$;

-- 4. Backfill arrival_station_id from routes for schedules missing it
UPDATE schedules s
SET arrival_station_id = r.destination_station_id,
    updated_at = now()
FROM routes r
WHERE s.arrival_station_id IS NULL
  AND s.route_id = r.id
  AND r.destination_station_id IS NOT NULL;

-- 5. Backfill source = 'guichet' for schedules that had no arrival_station_id
--    (chef-de-gare departures always set arrival_station_id; guichet never did)
UPDATE schedules
SET source = 'guichet'
WHERE source = 'chef_gare'
  AND arrival_station_id IS NULL
  AND route_id IS NOT NULL;

-- 6. Add index for source filtering
CREATE INDEX IF NOT EXISTS idx_schedules_source ON schedules(source);
