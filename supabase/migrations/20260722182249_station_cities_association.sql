/*
# Station-City Association Table

## Purpose
Allows associating one or more additional cities to a station, beyond the
primary `city_id` already stored on the `stations` table. This supports
multi-city station coverage for filters, searches, and reports.

## New Tables
- `station_cities` — junction table linking stations to multiple cities
  - `id` (uuid, primary key, auto-generated)
  - `station_id` (uuid, NOT NULL, FK → stations(id) ON DELETE CASCADE)
  - `city_id` (uuid, NOT NULL, FK → cities(id) ON DELETE CASCADE)
  - `created_at` (timestamptz, defaults to now())
  - UNIQUE constraint on (station_id, city_id) to prevent duplicate associations

## Security
- RLS enabled on `station_cities`.
- All authenticated users can read associations (shared organizational data,
  same pattern as station_agents, station_managers, station_baggage_handlers).
- All authenticated users can insert/update/delete (access controlled at the
  application level by the admin role).

## Important Notes
1. This table stores ADDITIONAL cities associated with a station. The primary
   city remains on `stations.city_id` and is NOT duplicated here.
2. When a station is deleted, all its city associations are automatically
   removed via CASCADE.
3. When a city is deleted, all its station associations are automatically
   removed via CASCADE.
*/

CREATE TABLE IF NOT EXISTS station_cities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(station_id, city_id)
);

ALTER TABLE station_cities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_station_cities" ON station_cities;
CREATE POLICY "select_station_cities"
ON station_cities FOR SELECT
TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_station_cities" ON station_cities;
CREATE POLICY "insert_station_cities"
ON station_cities FOR INSERT
TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_station_cities" ON station_cities;
CREATE POLICY "update_station_cities"
ON station_cities FOR UPDATE
TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_station_cities" ON station_cities;
CREATE POLICY "delete_station_cities"
ON station_cities FOR DELETE
TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_station_cities_station_id ON station_cities(station_id);
CREATE INDEX IF NOT EXISTS idx_station_cities_city_id ON station_cities(city_id);