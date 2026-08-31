/*
# Preserve offline-generated parcel codes during sync

## Context
When a courrier agent creates a parcel offline, the app now generates
a proper parcel_code (agency_code + 4-digit suffix), reference, daily_sequence,
and tracking_url locally — matching the same format as the online DB trigger.

When the parcel syncs to the server (upsert), those fields are included in the
payload. The existing BEFORE INSERT trigger `trg_auto_fill_parcel_codes` was
overwriting these fields with freshly generated values, discarding the
offline-generated codes.

## Change
Update `auto_fill_parcel_codes()` to skip code/reference/sequence/tracking_url
generation when `NEW.parcel_code` is already populated (i.e. the row was
inserted from a sync with pre-existing values). Only generate new values for
fresh online inserts where `parcel_code` is NULL.

## Affected objects
- `auto_fill_parcel_codes()` — modified to check `NEW.parcel_code IS NULL`
- Trigger `trg_auto_fill_parcel_codes` — unchanged (same function, same name)
*/

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
  -- Only generate codes when parcel_code is not already set (offline sync case)
  IF NEW.parcel_code IS NOT NULL AND NEW.parcel_code != '' THEN
    -- Preserve existing code; fill reference if missing
    IF NEW.reference IS NULL OR NEW.reference = '' THEN
      NEW.reference := generate_parcel_reference(NEW.parcel_code);
    END IF;
    IF NEW.tracking_url IS NULL OR NEW.tracking_url = '' THEN
      NEW.tracking_url := v_app_url || '/track/' || NEW.parcel_code;
    END IF;
    IF NEW.daily_sequence IS NULL OR NEW.daily_sequence = 0 THEN
      NEW.daily_sequence := get_daily_sequence(NEW.origin_station_id);
    END IF;
    RETURN NEW;
  END IF;

  -- Standard online path: generate all codes from scratch
  SELECT s.agency_code INTO v_agency_code
  FROM stations s
  WHERE s.id = NEW.origin_station_id;

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