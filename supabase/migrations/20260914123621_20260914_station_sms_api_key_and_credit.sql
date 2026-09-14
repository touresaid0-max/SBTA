/*
# Add per-station SMS API key and credit tracking

1. Modified Tables
- `stations`: Add `sms_api_key` (text, nullable) — EMISMS API key specific to each station/gare.
  When NULL, the edge function falls back to the global `API_KEY_EMISMS` env var.
- `stations`: Add `sms_credit` (integer, default 0) — SMS credit balance for this station.
  Each successful SMS sent from an agent courrier at this station decrements the credit by 1.
- `sms_logs`: Add `station_id` (uuid, nullable, references stations) — tracks which station's
  credit was consumed for each SMS, enabling per-station credit accounting.

2. Security
- No new tables. Existing RLS policies on `stations` and `sms_logs` remain unchanged.
- The new `sms_api_key` column is readable by authenticated users (same as other station fields).
  It stores an API key, but this is the station-level key that admin users manage — consistent
  with the existing admin-level access control already in place for stations.

3. Important Notes
- Stations without an `sms_api_key` will use the global EMISMS key (backward compatible).
- Stations without `sms_credit` (or with 0) will still attempt to send — the credit is
  informational/tracking. The edge function logs the station_id and decrements credit on success.
- The `sms_logs.station_id` column is nullable so existing log rows are not affected.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stations' AND column_name = 'sms_api_key'
  ) THEN
    ALTER TABLE public.stations ADD COLUMN sms_api_key text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stations' AND column_name = 'sms_credit'
  ) THEN
    ALTER TABLE public.stations ADD COLUMN sms_credit integer NOT NULL DEFAULT 0;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sms_logs' AND column_name = 'station_id'
  ) THEN
    ALTER TABLE public.sms_logs ADD COLUMN station_id uuid REFERENCES public.stations(id) ON DELETE SET NULL;
  END IF;
END $$;