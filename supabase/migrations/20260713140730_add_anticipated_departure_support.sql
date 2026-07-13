/*
# Add anticipated departure support to schedules

1. Schema Changes
  - Add `is_anticipated` boolean column to `schedules` (default false)
  - When true, bus_id, driver_id, and departure_datetime can be null/placeholder

2. Trigger Changes
  - Update `validate_schedule_conflicts` to skip bus validation when is_anticipated=true and bus_id is null

3. Purpose
  - Allow Chef de Gare to create "anticipated departures" where bus, driver, and time are not yet known
  - Enables early ticket sales before vehicle assignment
  - Missing info can be completed later via the edit modal
*/

-- Add is_anticipated column
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'schedules' AND column_name = 'is_anticipated') THEN
    ALTER TABLE schedules ADD COLUMN is_anticipated boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- Update validate_schedule_conflicts to allow null bus for anticipated departures
CREATE OR REPLACE FUNCTION validate_schedule_conflicts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
v_bus_status text;
BEGIN
-- Skip bus validation for anticipated departures without a bus assigned
IF NEW.is_anticipated = true AND NEW.bus_id IS NULL THEN
  RETURN NEW;
END IF;

-- Hard block: bus must be in an operable status (hardware constraint).
SELECT status INTO v_bus_status FROM buses WHERE id = NEW.bus_id;

IF v_bus_status IS NULL THEN
  RAISE EXCEPTION 'Bus introuvable';
END IF;

IF v_bus_status NOT IN ('disponible', 'en_service') THEN
  RAISE EXCEPTION 'Bus non disponible (statut: %)', v_bus_status;
END IF;

-- Schedule-overlap conflicts (bus already on another trip, driver already assigned)
-- are now soft warnings handled in the UI.  The trigger no longer blocks them.

RETURN NEW;
END;
$$;

-- Also update auto_extract_route_info to handle null route gracefully (already does)
-- And auto_calculate_fill_rate to handle null bus capacity for anticipated departures
CREATE OR REPLACE FUNCTION auto_calculate_fill_rate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
v_capacity int;
v_reserved int;
BEGIN
-- For anticipated departures without a bus, set fill_rate to 0
IF NEW.bus_id IS NULL THEN
  NEW.fill_rate := 0;
  RETURN NEW;
END IF;

SELECT COALESCE(capacity, total_seats, 0) INTO v_capacity FROM buses WHERE id = NEW.bus_id;
v_reserved := COALESCE(NEW.seats_reserved, 0);

IF v_capacity > 0 THEN
  NEW.fill_rate := ROUND((v_reserved::numeric / v_capacity) * 100, 2);
ELSE
  NEW.fill_rate := 0;
END IF;

RETURN NEW;
END;
$$;
