/*
# Auto-assign departure_sequence from schedule.counter_id

## Problem
When a guichetier creates a departure in the POS, the schedule is synced to
Supabase with `counter_id` set. However, no `departure_sequence` row is created.
The Chef de Gare dashboard reads `schedule_receipt_summary` which LEFT JOINs
`departure_sequence` — without that row, the counter info is NULL and the
departure doesn't appear in the per-counter breakdown.

The Chef de Gare currently has to manually assign each departure to a counter
via `chef_gare_assign_departure()` for the data to appear.

## Solution
1. Create a trigger function `auto_create_departure_sequence()` that fires
   AFTER INSERT or UPDATE on `schedules`. If the schedule has a `counter_id`
   and no `departure_sequence` row exists, it automatically creates one using
   the schedule's `counter_id`, `departure_station_id`, `route_id`,
   `departure_datetime`, and `departure_number`.

2. Backfill all existing schedules that have `counter_id` set but no
   `departure_sequence` row, using ROW_NUMBER() to compute unique
   departure_order values per station+date+route.

3. The manual assignment by the Chef de Gare still works — the trigger
   only fires when no `departure_sequence` row exists, so it won't
   override a manual assignment.

## Important
- The trigger only creates a departure_sequence row if one doesn't already
  exist (ON CONFLICT DO NOTHING on schedule_id).
- The `departure_number` is taken from `schedules.departure_number` if set,
  otherwise computed as the next sequential number for that counter+date.
- The `departure_order` is computed as the next per station+date+route.
- No changes to existing RLS policies or the manual assignment RPC.
*/

-- ─── 1. Trigger function ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION auto_create_departure_sequence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_station_id    uuid;
  v_route_id      uuid;
  v_dep_date      date;
  v_dep_number    int;
  v_next_order    int;
  v_existing      uuid;
BEGIN
  IF NEW.counter_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check if a departure_sequence already exists for this schedule
  SELECT id INTO v_existing FROM departure_sequence WHERE schedule_id = NEW.id;
  IF v_existing IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Resolve station from the counter or from the schedule
  SELECT c.station_id INTO v_station_id
  FROM counters c WHERE c.id = NEW.counter_id;

  IF v_station_id IS NULL THEN
    v_station_id := NEW.departure_station_id;
  END IF;

  IF v_station_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_route_id  := NEW.route_id;
  v_dep_date  := (NEW.departure_datetime AT TIME ZONE 'UTC')::date;

  IF NEW.departure_number IS NOT NULL AND NEW.departure_number > 0 THEN
    v_dep_number := NEW.departure_number;
  ELSE
    SELECT COALESCE(MAX(departure_number), 0) + 1 INTO v_dep_number
    FROM departure_sequence
    WHERE counter_id = NEW.counter_id AND departure_date = v_dep_date;
  END IF;

  SELECT COALESCE(MAX(departure_order), 0) + 1 INTO v_next_order
  FROM departure_sequence
  WHERE station_id = v_station_id
    AND departure_date = v_dep_date
    AND route_id = v_route_id;

  INSERT INTO departure_sequence
    (counter_id, schedule_id, departure_date, departure_number, station_id, departure_order, route_id)
  VALUES
    (NEW.counter_id, NEW.id, v_dep_date, v_dep_number, v_station_id, v_next_order, v_route_id)
  ON CONFLICT (schedule_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- ─── 2. Drop and recreate trigger ─────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_auto_departure_sequence ON schedules;

CREATE TRIGGER trg_auto_departure_sequence
  AFTER INSERT OR UPDATE OF counter_id ON schedules
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_departure_sequence();

-- ─── 3. Backfill existing orphaned schedules ──────────────────────────────────
-- Use ROW_NUMBER() to assign unique departure_order values per station+date+route.
-- This avoids the duplicate key violation that a simple MAX()+1 would cause
-- when multiple orphaned schedules share the same station+date+route.

WITH orphaned AS (
  SELECT
    s.id           AS schedule_id,
    s.counter_id   AS counter_id,
    s.route_id     AS route_id,
    (s.departure_datetime AT TIME ZONE 'UTC')::date AS dep_date,
    COALESCE(c.station_id, s.departure_station_id) AS station_id,
    COALESCE(s.departure_number, 1) AS dep_number,
    s.created_at   AS created_at
  FROM schedules s
  JOIN counters c ON c.id = s.counter_id
  LEFT JOIN departure_sequence ds ON ds.schedule_id = s.id
  WHERE s.counter_id IS NOT NULL
    AND ds.id IS NULL
),
existing_max AS (
  SELECT
    station_id,
    departure_date,
    route_id,
    COALESCE(MAX(departure_order), 0) AS max_order
  FROM departure_sequence
  GROUP BY station_id, departure_date, route_id
),
ranked AS (
  SELECT
    o.schedule_id,
    o.counter_id,
    o.route_id,
    o.dep_date,
    o.station_id,
    o.dep_number,
    ROW_NUMBER() OVER (
      PARTITION BY o.station_id, o.dep_date, o.route_id
      ORDER BY o.created_at
    ) AS rn
  FROM orphaned o
)
INSERT INTO departure_sequence
  (counter_id, schedule_id, departure_date, departure_number, station_id, departure_order, route_id)
SELECT
  r.counter_id,
  r.schedule_id,
  r.dep_date,
  r.dep_number,
  r.station_id,
  COALESCE(em.max_order, 0) + r.rn,
  r.route_id
FROM ranked r
LEFT JOIN existing_max em
  ON em.station_id = r.station_id
  AND em.departure_date = r.dep_date
  AND em.route_id = r.route_id
ON CONFLICT (schedule_id) DO NOTHING;

-- ─── 4. Notify PostgREST to reload schema ─────────────────────────────────────
NOTIFY pgrst, 'reload schema';
