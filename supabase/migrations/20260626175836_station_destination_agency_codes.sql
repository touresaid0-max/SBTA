/*
  # Per-destination agency codes for parcel ticket codes

  1. New table: station_destination_agency_codes
     - Maps an origin station + destination station to a specific agency code
     - One agency code per (origin, destination) and codes unique within an origin station

  2. Trigger update
     - auto_fill_parcel_codes() now prefers the destination-specific agency code
     - Falls back to the origin station's station-level agency_code (existing behaviour)
     - Falls back to a pure 6-digit random code when nothing is configured

  3. Security
     - RLS enabled; all authenticated users may read (config used by parcel agents)
     - Only admin may create / update / delete entries
*/

CREATE TABLE IF NOT EXISTS station_destination_agency_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_station_id uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  destination_station_id uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  agency_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sdac_unique_destination UNIQUE (origin_station_id, destination_station_id),
  CONSTRAINT sdac_unique_code UNIQUE (origin_station_id, agency_code)
);

CREATE INDEX IF NOT EXISTS idx_sdac_origin ON station_destination_agency_codes(origin_station_id);
CREATE INDEX IF NOT EXISTS idx_sdac_destination ON station_destination_agency_codes(destination_station_id);

ALTER TABLE station_destination_agency_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read destination agency codes"
  ON station_destination_agency_codes FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admin can insert destination agency codes"
  ON station_destination_agency_codes FOR INSERT
  TO authenticated
  WITH CHECK (((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin');

CREATE POLICY "Admin can update destination agency codes"
  ON station_destination_agency_codes FOR UPDATE
  TO authenticated
  USING (((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin')
  WITH CHECK (((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin');

CREATE POLICY "Admin can delete destination agency codes"
  ON station_destination_agency_codes FOR DELETE
  TO authenticated
  USING (((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin');

-- Update parcel code generation to use the destination-specific agency code
CREATE OR REPLACE FUNCTION auto_fill_parcel_codes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_agency_code text;
  v_suffix text;
  v_exists boolean;
  v_app_url text := 'https://sbta-pink.vercel.app';
BEGIN
  -- 1. Prefer the destination-specific agency code for this origin station
  SELECT sdac.agency_code INTO v_agency_code
  FROM station_destination_agency_codes sdac
  WHERE sdac.origin_station_id = NEW.origin_station_id
    AND sdac.destination_station_id = NEW.destination_station_id
  LIMIT 1;

  -- 2. Fall back to the origin station's station-level agency code
  IF v_agency_code IS NULL OR length(v_agency_code) = 0 THEN
    SELECT s.agency_code INTO v_agency_code
    FROM stations s
    WHERE s.id = NEW.origin_station_id;
  END IF;

  IF v_agency_code IS NOT NULL AND length(v_agency_code) > 0 THEN
    LOOP
      v_suffix := lpad(floor(random() * 9999 + 1)::text, 4, '0');
      v_code := v_agency_code || v_suffix;
      SELECT EXISTS (SELECT 1 FROM parcels WHERE parcel_code = v_code) INTO v_exists;
      EXIT WHEN NOT v_exists;
    END LOOP;
  ELSE
    LOOP
      v_code := lpad(floor(random() * 999999 + 1)::text, 6, '0');
      SELECT EXISTS (SELECT 1 FROM parcels WHERE parcel_code = v_code) INTO v_exists;
      EXIT WHEN NOT v_exists;
    END LOOP;
  END IF;

  NEW.parcel_code     := v_code;
  NEW.reference       := generate_parcel_reference(v_code);
  NEW.daily_sequence  := get_daily_sequence(NEW.origin_station_id);
  NEW.tracking_url    := v_app_url || '/track/' || v_code;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
