/*
# Fix: sync counter_routes when a counter is assigned to a guichetier

## Problem
The previous migration (20260903_sync_employee_route_to_counter_routes) added a
trigger on `employees` that syncs `assigned_route_id` → `counter_routes` when the
employee record changes. However, the counter assignment happens LATER and on a
DIFFERENT table:

1. RH creates the employee (employees table) with assigned_route_id set
2. Admin creates the login account (users table)
3. Admin/Chef de Gare assigns the user to a counter (counters.assigned_user_id)

Step 3 does NOT fire the employees trigger, so counter_routes is never populated
and the Chef de Gare sees no lines assigned to the guichet.

## Fix
1. Add a trigger on `counters` that fires AFTER INSERT OR UPDATE OF assigned_user_id.
   When a user is assigned to a counter:
   - Look up the employee (by auth_user_id or by employee.id) to get assigned_route_id
   - If the employee is a guichetier with a route: upsert into counter_routes
   - If the employee has no route: clear counter_routes for this counter
2. Backfill: for every counter that already has an assigned_user_id whose employee
   has an assigned_route_id, insert the missing counter_routes row.

## Security
- The trigger function runs SECURITY DEFINER to write to counter_routes and read
  employees regardless of the caller's role.
- No new tables. No RLS policy changes.
- The trigger only touches counter_routes for the counter being changed.
*/

-- 1. Trigger function on counters
CREATE OR REPLACE FUNCTION public.sync_counter_route_from_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_route_id  uuid;
  v_role      text;
BEGIN
  -- Only proceed if assigned_user_id changed (or is being set on insert)
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_user_id IS NULL THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.assigned_user_id IS NOT DISTINCT FROM OLD.assigned_user_id THEN
      RETURN NEW;
    END IF;
  END IF;

  -- If the previous user had routes, clear them (the employee trigger handles
  -- its own counter, but the counter might have been reassigned to a non-guichetier)
  IF TG_OP = 'UPDATE' AND OLD.assigned_user_id IS NOT NULL
     AND NEW.assigned_user_id IS DISTINCT FROM OLD.assigned_user_id THEN
    DELETE FROM counter_routes WHERE counter_id = OLD.id;
  END IF;

  -- If no new user, nothing more to do
  IF NEW.assigned_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Look up the employee by auth_user_id (users.id = employees.auth_user_id)
  -- or by employees.id (the HR form stores the employee UUID directly)
  SELECT e.assigned_route_id, e.role
  INTO v_route_id, v_role
  FROM employees e
  WHERE e.auth_user_id = NEW.assigned_user_id
     OR e.id = NEW.assigned_user_id
  LIMIT 1;

  -- Also check the users table as fallback (some guichetiers may only exist in users)
  IF v_role IS NULL THEN
    SELECT u.role INTO v_role
    FROM users u
    WHERE u.id = NEW.assigned_user_id
    LIMIT 1;
  END IF;

  -- Only sync for guichetier role
  IF v_role = 'guichetier' THEN
    IF v_route_id IS NOT NULL THEN
      -- Remove any routes that don't match the employee's assigned route
      DELETE FROM counter_routes
      WHERE counter_id = NEW.id
        AND route_id IS DISTINCT FROM v_route_id;

      -- Insert the assigned route (idempotent)
      INSERT INTO counter_routes (counter_id, route_id)
      VALUES (NEW.id, v_route_id)
      ON CONFLICT (counter_id, route_id) DO NOTHING;
    ELSE
      -- Employee has no route: clear all routes for this counter
      DELETE FROM counter_routes WHERE counter_id = NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_counter_route_from_assignment ON counters;
CREATE TRIGGER trg_sync_counter_route_from_assignment
  AFTER INSERT OR UPDATE OF assigned_user_id ON counters
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_counter_route_from_assignment();

-- 2. Backfill: sync existing counter assignments
INSERT INTO counter_routes (counter_id, route_id)
SELECT c.id, e.assigned_route_id
FROM counters c
JOIN employees e ON (e.auth_user_id = c.assigned_user_id OR e.id = c.assigned_user_id)
WHERE e.role = 'guichetier'
  AND e.assigned_route_id IS NOT NULL
ON CONFLICT (counter_id, route_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
