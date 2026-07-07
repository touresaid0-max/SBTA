/*
# Add price field to route_stops for transit point pricing

1. Modified Tables
   - `route_stops`: Added `price` column (numeric, nullable) representing the fare from route origin to this intermediate stop.

2. Notes
   - Existing `transit_stops` JSONB on `schedules` will carry a `price` field per stop (handled at application level).
   - The `route_stops.price` serves as the default/template price that gets copied into the schedule's transit_stops JSONB when a schedule is created.
   - NULL price means "not configured" — the Chef de Gare must set it during schedule creation.
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'route_stops' AND column_name = 'price'
  ) THEN
    ALTER TABLE route_stops ADD COLUMN price numeric;
  END IF;
END $$;

COMMENT ON COLUMN route_stops.price IS 'Fare from route origin to this intermediate stop (FCFA)';
