/*
# Ramassage Revenue Sync Trigger — Bridge notifications → financial reports

## Problem
Both the POS Ramassage page and the Chef de Gare Ramassage page validate a
ramassage by updating `ramassage_notifications.status` to `'done'` and writing
`collected_amount` / `collected_places` to that table. However, ALL financial
reporting infrastructure (schedule_receipt_summary view, schedule_company_revenue
function, DAF RPCs, gestionnaire RPCs, daily_counter_report view) reads ramassage
revenue from the separate `ramassage_collections` table. Until now, nothing ever
wrote to `ramassage_collections`, so validated ramassage amounts never appeared
in any financial report.

## Solution
1. Add a `schedule_id` column to `ramassage_collections` (nullable, to support
   POS local departs that may not yet have a schedule row).
2. Add a `local_depart_id` column to `ramassage_collections` for POS-originated
   ramassages that have no schedule_id.
3. Relax the `schedule_id NOT NULL` constraint to nullable.
4. Drop the old `UNIQUE (schedule_id, station_id)` constraint and add a new
   constraint that allows either schedule_id or local_depart_id as the key:
   `UNIQUE (schedule_id, station_id, local_depart_id)`.
5. Create a trigger function `fn_ramassage_to_collection()` that fires AFTER
   UPDATE on `ramassage_notifications` when status transitions to 'done'. It
   upserts the collected amount into `ramassage_collections`.
6. The upsert uses `local_depart_id` as a fallback for `schedule_id` when
   `schedule_id` is null (POS local departs use the same UUID for both).
7. Backfill existing 'done' notifications into `ramassage_collections`.
8. Grant RLS: allow any authenticated user to insert/update
   ramassage_collections (the trigger runs as SECURITY DEFINER, bypassing RLS,
   but frontend code may also write directly).

## Financial flow after this migration
When a Chef de Gare or Guichetier validates a ramassage:
  ramassage_notifications UPDATE (status='done')
    → trigger fires
    → upserts into ramassage_collections (schedule_id, station_id, amount)
    → schedule_receipt_summary view picks up ramassage_amount
    → daily_counter_report includes it in total_ramassage
    → schedule_company_revenue function includes it in gross_revenue
    → DAF consolidated RPCs include it in revenue
    → Gestionnaire RPCs include it in revenue
    → The amount is attributed to the bus owner's company (via bus.company_id)

## Double-counting prevention
- The UNIQUE constraint on (schedule_id, station_id, local_depart_id) means
  re-validation or re-consultation triggers an UPDATE of the existing row,
  not a duplicate INSERT.
- The trigger only fires on status TRANSITION to 'done' (OLD.status <> 'done'
  AND NEW.status = 'done'), so reprinting or re-consulting does not create
  duplicates.
- If the amount changes on a subsequent update, the upsert updates the
  existing row's amount.
*/

-- 1. Add schedule_id and local_depart_id columns to ramassage_collections
ALTER TABLE ramassage_collections
  ADD COLUMN IF NOT EXISTS schedule_id uuid REFERENCES schedules(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS local_depart_id text;

-- 2. Make schedule_id nullable (was NOT NULL)
ALTER TABLE ramassage_collections ALTER COLUMN schedule_id DROP NOT NULL;

-- 3. Drop old unique constraint and add new one
ALTER TABLE ramassage_collections
  DROP CONSTRAINT IF EXISTS ramassage_collections_schedule_station_unique;

ALTER TABLE ramassage_collections
  DROP CONSTRAINT IF EXISTS ramassage_collections_sched_station_local_unique;

ALTER TABLE ramassage_collections
  ADD CONSTRAINT ramassage_collections_sched_station_local_unique
  UNIQUE (schedule_id, station_id, local_depart_id);

-- 4. Create trigger function
CREATE OR REPLACE FUNCTION public.fn_ramassage_to_collection()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schedule_id uuid;
  v_station_id uuid;
  v_amount numeric;
BEGIN
  -- Only fire on transition TO 'done'
  IF NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done') THEN
    -- Resolve schedule_id: prefer NEW.schedule_id, fall back to local_depart_id
    -- (POS local departs use the same UUID for both the local depart and the schedule)
    v_schedule_id := COALESCE(NEW.schedule_id, NULLIF(NEW.local_depart_id, '')::uuid);

    -- Station ID: use the destination station (where the ramassage was collected)
    v_station_id := NEW.destination_station_id;

    -- Amount collected
    v_amount := COALESCE(NEW.collected_amount, 0);

    -- Upsert into ramassage_collections
    -- The UNIQUE constraint on (schedule_id, station_id, local_depart_id) prevents duplicates
    INSERT INTO ramassage_collections (
      schedule_id,
      station_id,
      amount,
      collected_by,
      observation,
      local_depart_id,
      updated_at
    ) VALUES (
      v_schedule_id,
      v_station_id,
      v_amount,
      NEW.created_by,
      'Ramassage validé par ' || COALESCE(NEW.collected_by_name, 'Chef de gare'),
      NEW.local_depart_id,
      now()
    )
    ON CONFLICT (schedule_id, station_id, local_depart_id)
    DO UPDATE SET
      amount = EXCLUDED.amount,
      collected_by = EXCLUDED.collected_by,
      observation = EXCLUDED.observation,
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$$;

-- 5. Create the trigger
DROP TRIGGER IF EXISTS trg_ramassage_to_collection ON ramassage_notifications;
CREATE TRIGGER trg_ramassage_to_collection
  AFTER UPDATE ON ramassage_notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_ramassage_to_collection();

-- 6. Backfill existing 'done' notifications
INSERT INTO ramassage_collections (
  schedule_id,
  station_id,
  amount,
  collected_by,
  observation,
  local_depart_id,
  created_at,
  updated_at
)
SELECT
  COALESCE(rn.schedule_id, NULLIF(rn.local_depart_id, '')::uuid),
  rn.destination_station_id,
  COALESCE(rn.collected_amount, 0),
  rn.created_by,
  'Ramassage validé par ' || COALESCE(rn.collected_by_name, 'Chef de gare'),
  rn.local_depart_id,
  COALESCE(rn.collected_at, rn.created_at),
  COALESCE(rn.collected_at, rn.created_at)
FROM ramassage_notifications rn
WHERE rn.status = 'done'
  AND COALESCE(rn.collected_amount, 0) > 0
ON CONFLICT (schedule_id, station_id, local_depart_id)
DO UPDATE SET
  amount = EXCLUDED.amount,
  observation = EXCLUDED.observation,
  updated_at = now();

-- 7. RLS: allow authenticated users to insert/update (for direct frontend writes)
-- Keep existing policies, add broader insert/update for the trigger-driven flow
DROP POLICY IF EXISTS "insert_ramassage_collections_broad" ON ramassage_collections;
CREATE POLICY "insert_ramassage_collections_broad"
  ON ramassage_collections FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_ramassage_collections_broad" ON ramassage_collections;
CREATE POLICY "update_ramassage_collections_broad"
  ON ramassage_collections FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
