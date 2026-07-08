/*
# Add destination_city_name to reservations

1. Modified Tables
   - `reservations`
     - `destination_city_name` (text, nullable) — the city name where the passenger alights
       (may differ from the route's final destination for transit stop passengers)

2. Important Notes
   - Nullable because existing reservations don't have this data
   - New reservations will populate this field from the sale flow
   - Used by the bordereau de départ to group seats by destination
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reservations' AND column_name = 'destination_city_name'
  ) THEN
    ALTER TABLE reservations ADD COLUMN destination_city_name text;
  END IF;
END $$;
