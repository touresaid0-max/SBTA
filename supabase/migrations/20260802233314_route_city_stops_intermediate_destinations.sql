/*
# Route city stops - intermediate city destinations with pricing

1. New Table
   - `route_city_stops` — ordered intermediate city destinations for a route, each with a fare price.
     - `id` (uuid, primary key)
     - `route_id` (uuid, FK to routes, cascade delete)
     - `city_id` (uuid, FK to cities, cascade delete)
     - `position` (integer, order: 1 = first intermediate, 2 = second, etc.)
     - `price` (numeric, fare from route origin to this city in FCFA)
     - `created_at` (timestamptz)
     - UNIQUE(route_id, position) and UNIQUE(route_id, city_id)

2. Security
   - RLS enabled on `route_city_stops`.
   - Authenticated users can read/insert/update/delete — matches existing `route_stops` policy pattern.

3. Indexes
   - Index on `route_id` for efficient lookups.
*/

CREATE TABLE IF NOT EXISTS route_city_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 1,
  price numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(route_id, position),
  UNIQUE(route_id, city_id)
);

ALTER TABLE route_city_stops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view route city stops" ON route_city_stops;
CREATE POLICY "Authenticated users can view route city stops"
  ON route_city_stops FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert route city stops" ON route_city_stops;
CREATE POLICY "Authenticated users can insert route city stops"
  ON route_city_stops FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update route city stops" ON route_city_stops;
CREATE POLICY "Authenticated users can update route city stops"
  ON route_city_stops FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can delete route city stops" ON route_city_stops;
CREATE POLICY "Authenticated users can delete route city stops"
  ON route_city_stops FOR DELETE
  TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_route_city_stops_route_id ON route_city_stops(route_id);
