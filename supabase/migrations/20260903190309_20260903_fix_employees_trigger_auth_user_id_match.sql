/*
# Fix: employees trigger now also matches counters by auth_user_id

## Problem
The existing trigger `sync_guichetier_counter_route` on `employees` looks up the
counter with `WHERE assigned_user_id = NEW.id`. But `counters.assigned_user_id`
stores the auth.users.id (the login account UUID), while `NEW.id` is the
employees.id. These are different UUIDs, so the lookup fails and no
counter_routes row is created.

## Fix
Update the trigger function to also look up the counter via the employee's
`auth_user_id` column, which maps to the users table.

## Security
- No new tables or policies. SECURITY DEFINER, same as before.
*/

CREATE OR REPLACE FUNCTION public.sync_guichetier_counter_route()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_counter_id uuid;
BEGIN
  -- Only act on guichetier employees
  IF NEW.role = 'guichetier' THEN
    SELECT id INTO v_counter_id
    FROM counters
    WHERE assigned_user_id = NEW.id
       OR assigned_user_id = NEW.auth_user_id
    LIMIT 1;

    IF v_counter_id IS NOT NULL THEN
      IF NEW.assigned_route_id IS NOT NULL THEN
        -- Remove existing routes for this counter that don't match the new route
        DELETE FROM counter_routes
        WHERE counter_id = v_counter_id
          AND route_id IS DISTINCT FROM NEW.assigned_route_id;

        -- Insert the assigned route (upsert for idempotency)
        INSERT INTO counter_routes (counter_id, route_id)
        VALUES (v_counter_id, NEW.assigned_route_id)
        ON CONFLICT (counter_id, route_id) DO NOTHING;
      ELSE
        -- No route assigned: clear all routes for this counter
        DELETE FROM counter_routes WHERE counter_id = v_counter_id;
      END IF;
    END IF;
  ELSIF OLD.role = 'guichetier' AND NEW.role <> 'guichetier' THEN
    -- Role changed away from guichetier: clear counter routes
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

-- Trigger stays the same, function is replaced
DROP TRIGGER IF EXISTS trg_sync_guichetier_counter_route ON employees;
CREATE TRIGGER trg_sync_guichetier_counter_route
  AFTER INSERT OR UPDATE OF assigned_route_id, role ON employees
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_guichetier_counter_route();

NOTIFY pgrst, 'reload schema';
