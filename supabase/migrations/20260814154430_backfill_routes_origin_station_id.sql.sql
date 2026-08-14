/*
# Backfill routes.origin_station_id from route name → station name matching

## Context
The Driver Report (Responsable Logistique → Rapport conducteur) looks up the
Chef de Gare for the departure station of the selected route. This requires
`routes.origin_station_id` to be set. Currently ALL active routes have
`origin_station_id = NULL`, so the report can never find the Chef de Gare.

## Change
- For every active route whose `origin_station_id` is NULL, extract the
  departure city (text before the " - " separator in the route name) and
  match it to a station whose name contains that city (case-insensitive).
- Only updates rows that currently have NULL origin_station_id — existing
  values are preserved.
- Uses a PL/pgSQL block to do the matching safely.

## Security
- No RLS or policy changes. No schema changes. Data-only update.
*/

DO $$
DECLARE
  r RECORD;
  v_departure TEXT;
  v_station_id UUID;
BEGIN
  FOR r IN
    SELECT id, name
    FROM routes
    WHERE is_active = true
      AND origin_station_id IS NULL
      AND name LIKE '% - %'
  LOOP
    -- Extract departure city (text before first " - ")
    v_departure := split_part(r.name, ' - ', 1);
    v_departure := trim(v_departure);

    -- Find a station whose name contains the departure city (case-insensitive)
    SELECT id INTO v_station_id
    FROM stations
    WHERE is_active = true
      AND lower(name) LIKE '%' || lower(v_departure) || '%'
    LIMIT 1;

    IF v_station_id IS NOT NULL THEN
      UPDATE routes
      SET origin_station_id = v_station_id
      WHERE id = r.id;
    END IF;
  END LOOP;
END $$;
