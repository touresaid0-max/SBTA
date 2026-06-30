/*
  # Station baggage handlers junction table

  1. New table
    - `station_baggage_handlers` - many-to-many between stations and bagagiste users
      - `id` (uuid, pk)
      - `station_id` (uuid, FK stations, cascade)
      - `handler_id` (uuid, FK users, cascade)
      - `created_at` (timestamptz)
      - unique (station_id, handler_id)

  2. Security
    - RLS enabled
    - SELECT: any authenticated user
    - INSERT/UPDATE/DELETE: admin, or the chef de gare assigned to the station
      (via stations.station_manager_id or the station_managers junction)
*/

CREATE TABLE IF NOT EXISTS station_baggage_handlers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  handler_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT station_baggage_handlers_unique UNIQUE (station_id, handler_id)
);

CREATE INDEX IF NOT EXISTS idx_station_baggage_handlers_station ON station_baggage_handlers(station_id);
CREATE INDEX IF NOT EXISTS idx_station_baggage_handlers_handler ON station_baggage_handlers(handler_id);

ALTER TABLE station_baggage_handlers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_station_baggage_handlers"
  ON station_baggage_handlers FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "insert_station_baggage_handlers"
  ON station_baggage_handlers FOR INSERT
  TO authenticated
  WITH CHECK (
    ((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin'
    OR (
      ((auth.jwt() -> 'app_metadata') ->> 'role') = 'chef_gare'
      AND (
        station_id IN (SELECT id FROM stations WHERE station_manager_id = auth.uid())
        OR station_id IN (SELECT station_id FROM station_managers WHERE manager_id = auth.uid())
      )
    )
  );

CREATE POLICY "update_station_baggage_handlers"
  ON station_baggage_handlers FOR UPDATE
  TO authenticated
  USING (
    ((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin'
    OR (
      ((auth.jwt() -> 'app_metadata') ->> 'role') = 'chef_gare'
      AND (
        station_id IN (SELECT id FROM stations WHERE station_manager_id = auth.uid())
        OR station_id IN (SELECT station_id FROM station_managers WHERE manager_id = auth.uid())
      )
    )
  )
  WITH CHECK (
    ((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin'
    OR (
      ((auth.jwt() -> 'app_metadata') ->> 'role') = 'chef_gare'
      AND (
        station_id IN (SELECT id FROM stations WHERE station_manager_id = auth.uid())
        OR station_id IN (SELECT station_id FROM station_managers WHERE manager_id = auth.uid())
      )
    )
  );

CREATE POLICY "delete_station_baggage_handlers"
  ON station_baggage_handlers FOR DELETE
  TO authenticated
  USING (
    ((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin'
    OR (
      ((auth.jwt() -> 'app_metadata') ->> 'role') = 'chef_gare'
      AND (
        station_id IN (SELECT id FROM stations WHERE station_manager_id = auth.uid())
        OR station_id IN (SELECT station_id FROM station_managers WHERE manager_id = auth.uid())
      )
    )
  );

NOTIFY pgrst, 'reload schema';