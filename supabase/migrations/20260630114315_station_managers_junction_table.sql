/*
  # Multi chef de gare per station - Junction table

  1. New Tables
    - `station_managers` - Many-to-many relationship between stations and chef_gare users
      - `id` (uuid, primary key)
      - `station_id` (uuid, FK to stations)
      - `manager_id` (uuid, FK to users)
      - `is_primary` (boolean, default false) - primary chef kept in sync with stations.station_manager_id
      - `created_at` (timestamptz)
      - Unique constraint on (station_id, manager_id) to prevent duplicates

  2. Data Migration
    - Copies existing stations.station_manager_id assignments into the new table as primary
    - Keeps stations.station_manager_id column intact for backward compatibility with
      existing RLS policies and role/permission logic (unchanged)

  3. Security
    - RLS enabled on station_managers
    - Authenticated users can read assignments (needed to display the chefs on a station)
    - Only admin can insert/update/delete assignments
*/

CREATE TABLE IF NOT EXISTS station_managers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  manager_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT station_managers_unique UNIQUE (station_id, manager_id)
);

CREATE INDEX IF NOT EXISTS idx_station_managers_station ON station_managers(station_id);
CREATE INDEX IF NOT EXISTS idx_station_managers_manager ON station_managers(manager_id);

ALTER TABLE station_managers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read station_managers"
  ON station_managers FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admin can insert station_managers"
  ON station_managers FOR INSERT
  TO authenticated
  WITH CHECK (((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin');

CREATE POLICY "Admin can update station_managers"
  ON station_managers FOR UPDATE
  TO authenticated
  USING (((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin')
  WITH CHECK (((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin');

CREATE POLICY "Admin can delete station_managers"
  ON station_managers FOR DELETE
  TO authenticated
  USING (((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin');

INSERT INTO station_managers (station_id, manager_id, is_primary)
SELECT s.id, s.station_manager_id, true
FROM stations s
WHERE s.station_manager_id IS NOT NULL
ON CONFLICT (station_id, manager_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
