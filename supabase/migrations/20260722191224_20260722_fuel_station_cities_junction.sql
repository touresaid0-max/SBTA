-- Junction table: fuel stations <-> cities
CREATE TABLE IF NOT EXISTS fuel_station_cities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fuel_station_id uuid NOT NULL REFERENCES fuel_stations(id) ON DELETE CASCADE,
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(fuel_station_id, city_id)
);

ALTER TABLE fuel_station_cities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_fuel_station_cities" ON fuel_station_cities
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "insert_fuel_station_cities" ON fuel_station_cities
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "delete_fuel_station_cities" ON fuel_station_cities
  FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_fuel_station_cities_station ON fuel_station_cities(fuel_station_id);
CREATE INDEX IF NOT EXISTS idx_fuel_station_cities_city ON fuel_station_cities(city_id);
