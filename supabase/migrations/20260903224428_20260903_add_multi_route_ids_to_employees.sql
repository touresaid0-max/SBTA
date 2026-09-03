/*
# Add assigned_route_ids (uuid[]) to employees for multi-route guichetier

## Purpose
Guichetier employees can now be assigned multiple routes (itineraries) instead
of just one. This adds a `assigned_route_ids uuid[]` column to the employees
table, backfills it from the existing `assigned_route_id` single-value column,
and updates the sync triggers to use the array.

## Changes
1. New column: `employees.assigned_route_ids uuid[] DEFAULT '{}'`
2. Backfill: copy existing `assigned_route_id` into the array for guichetiers
3. Update `sync_guichetier_counter_route()` trigger to sync ALL routes from
   the array into `counter_routes` (delete old, insert new — no duplicates)
4. Update `sync_counter_route_from_assignment()` trigger to sync ALL routes
   from the array when a counter is assigned to a user

## Security
- No new tables, no RLS policy changes
- Both trigger functions remain SECURITY DEFINER
- `assigned_route_id` (single uuid) is NOT dropped — drivers still use it
*/

-- 1. Add the array column
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'assigned_route_ids'
  ) THEN
    ALTER TABLE employees ADD COLUMN assigned_route_ids uuid[] DEFAULT '{}';
  END IF;
END $$;

-- 2. Backfill from existing single assigned_route_id
UPDATE employees
SET assigned_route_ids = ARRAY[assigned_route_id]
WHERE assigned_route_id IS NOT NULL
  AND (assigned_route_ids IS NULL OR array_length(assigned_route_ids, 1) IS NULL);

-- 3. Update the employees trigger to use the array
CREATE OR REPLACE FUNCTION public.sync_guichetier_counter_route()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_counter_id uuid;
  v_route_ids  uuid[];
BEGIN
  -- Determine the effective route ids: prefer the array, fall back to single
  v_route_ids := COALESCE(NEW.assigned_route_ids, CASE
    WHEN NEW.assigned_route_id IS NOT NULL
    THEN ARRAY[NEW.assigned_route_id]
    ELSE ARRAY[]::uuid[]
  END);

  -- Only act on guichetier employees
  IF NEW.role = 'guichetier' THEN
    SELECT id INTO v_counter_id
    FROM counters
    WHERE assigned_user_id = NEW.id
       OR assigned_user_id = NEW.auth_user_id
    LIMIT 1;

    IF v_counter_id IS NOT NULL THEN
      -- Remove routes no longer in the list
      DELETE FROM counter_routes
      WHERE counter_id = v_counter_id
        AND NOT (route_id = ANY(v_route_ids));

      -- Insert all assigned routes (idempotent)
      IF array_length(v_route_ids, 1) > 0 THEN
        INSERT INTO counter_routes (counter_id, route_id)
        SELECT v_counter_id, unnest(v_route_ids)
        ON CONFLICT (counter_id, route_id) DO NOTHING;
      END IF;
    END IF;
  ELSIF OLD.role = 'guichetier' AND NEW.role <> 'guichetier' THEN
    SELECT id INTO v_counter_id
    FROM counters
    WHERE assigned_user_id = NEW.id
       OR assigned_user_id = NEW.auth_user_id
    LIMIT 1;

    IF v_counter_id IS NOT NULL THEN
      DELETE FROM counter_routes WHERE counter_id = v_counter_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_guichetier_counter_route ON employees;
CREATE TRIGGER trg_sync_guichetier_counter_route
  AFTER INSERT OR UPDATE OF assigned_route_ids, assigned_route_id, role ON employees
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_guichetier_counter_route();

-- 4. Update the counters trigger to use the array
CREATE OR REPLACE FUNCTION public.sync_counter_route_from_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_route_ids uuid[];
  v_role      text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_user_id IS NULL THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.assigned_user_id IS NOT DISTINCT FROM OLD.assigned_user_id THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Clear routes from the old assignment
  IF TG_OP = 'UPDATE' AND OLD.assigned_user_id IS NOT NULL
     AND NEW.assigned_user_id IS DISTINCT FROM OLD.assigned_user_id THEN
    DELETE FROM counter_routes WHERE counter_id = OLD.id;
  END IF;

  IF NEW.assigned_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Look up employee by auth_user_id or id
  SELECT e.assigned_route_ids, e.role, e.assigned_route_id INTO v_route_ids, v_role, v_route_ids
  FROM employees e
  WHERE e.auth_user_id = NEW.assigned_user_id
     OR e.id = NEW.assigned_user_id
  LIMIT 1;

  -- Fallback: check users table for role
  IF v_role IS NULL THEN
    SELECT u.role INTO v_role
    FROM users u
    WHERE u.id = NEW.assigned_user_id
    LIMIT 1;
  END IF;

  -- Merge array + single column
  IF v_role = 'guichetier' THEN
    -- Re-fetch to get both columns cleanly
    SELECT COALESCE(
      e.assigned_route_ids,
      CASE WHEN e.assigned_route_id IS NOT NULL THEN ARRAY[e.assigned_route_id] ELSE ARRAY[]::uuid[] END
    ) INTO v_route_ids
    FROM employees e
    WHERE e.auth_user_id = NEW.assigned_user_id
       OR e.id = NEW.assigned_user_id
    LIMIT 1;

    IF v_route_ids IS NOT NULL AND array_length(v_route_ids, 1) > 0 THEN
      DELETE FROM counter_routes
      WHERE counter_id = NEW.id
        AND NOT (route_id = ANY(v_route_ids));

      INSERT INTO counter_routes (counter_id, route_id)
      SELECT NEW.id, unnest(v_route_ids)
      ON CONFLICT (counter_id, route_id) DO NOTHING;
    ELSE
      DELETE FROM counter_routes WHERE counter_id = NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Trigger stays the same
DROP TRIGGER IF EXISTS trg_sync_counter_route_from_assignment ON counters;
CREATE TRIGGER trg_sync_counter_route_from_assignment
  AFTER INSERT OR UPDATE OF assigned_user_id ON counters
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_counter_route_from_assignment();

-- 5. Backfill counter_routes from the array for existing guichetiers
INSERT INTO counter_routes (counter_id, route_id)
SELECT c.id, route_id
FROM counters c
JOIN employees e ON (e.auth_user_id = c.assigned_user_id OR e.id = c.assigned_user_id)
CROSS JOIN unnest(
  COALESCE(
    e.assigned_route_ids,
    CASE WHEN e.assigned_route_id IS NOT NULL THEN ARRAY[e.assigned_route_id] ELSE ARRAY[]::uuid[] END
  )
) AS route_id
WHERE e.role = 'guichetier'
ON CONFLICT (counter_id, route_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
