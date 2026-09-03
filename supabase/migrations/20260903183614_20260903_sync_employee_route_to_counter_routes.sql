/*
# Sync guichetier assigned_route_id to counter_routes

1. Purpose
When a RH sets/changes the "Itinéraire" (assigned_route_id) on a guichetier employee,
the corresponding counter's route assignment in `counter_routes` must be updated
automatically. This trigger runs server-side so the sync works regardless of whether
the update comes from the frontend or the edge function.

2. How it works
- AFTER INSERT OR UPDATE OF assigned_route_id, role ON `employees`
- If the employee is a guichetier AND has an assigned_route_id:
  - Find the counter where `assigned_user_id = employee.id`
  - Upsert the (counter_id, route_id) pair into `counter_routes`
  - Remove any other counter_routes for this counter that don't match the new route
- If the assigned_route_id is cleared (set to null) or role changes away from guichetier:
  - Remove all counter_routes for the counter assigned to this employee

3. Security
- No new tables or RLS policies. The trigger function runs with SECURITY DEFINER
  to be able to write to counter_routes regardless of the caller's role.
- The trigger only touches counter_routes rows for the counter assigned to the
  employee being updated — no cross-user impact.
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
  AFTER INSERT OR UPDATE OF assigned_route_id, role ON employees
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_guichetier_counter_route();

NOTIFY pgrst, 'reload schema';
