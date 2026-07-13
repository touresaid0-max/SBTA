/*
# Update tracking URL domain from sbta-pink.vercel.app to sbta-gestion.cloud

1. Modified Functions
  - `generate_parcel_code_and_ref` — updates v_app_url to new domain
  - `auto_fill_parcel_codes` — updates v_app_url to new domain

2. Data Fix
  - Updates all existing tracking_url values in parcels table to use the new domain

3. Purpose
  - The production domain has changed; SMS tracking links must point to sbta-gestion.cloud
*/

-- Update function: generate_parcel_code_and_ref
CREATE OR REPLACE FUNCTION generate_parcel_code_and_ref()
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
v_app_url text := 'https://sbta-gestion.cloud';
BEGIN
-- Fetch the agency code for the origin station
SELECT s.agency_code INTO v_agency_code
FROM stations s
WHERE s.id = NEW.origin_station_id;

IF v_agency_code IS NOT NULL AND length(v_agency_code) > 0 THEN
-- Generate code: agency_code prefix + random 4-digit suffix
LOOP
v_suffix := lpad(floor(random() * 9999 + 1)::text, 4, '0');
v_code := v_agency_code || v_suffix;
SELECT EXISTS (SELECT 1 FROM parcels WHERE parcel_code = v_code) INTO v_exists;
EXIT WHEN NOT v_exists;
END LOOP;
ELSE
-- Fallback: pure 6-digit random code
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

-- Update function: auto_fill_parcel_codes
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
v_app_url text := 'https://sbta-gestion.cloud';
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

-- Update existing tracking URLs in parcels table
UPDATE parcels
SET tracking_url = replace(tracking_url, 'sbta-pink.vercel.app', 'sbta-gestion.cloud')
WHERE tracking_url LIKE '%sbta-pink.vercel.app%';
