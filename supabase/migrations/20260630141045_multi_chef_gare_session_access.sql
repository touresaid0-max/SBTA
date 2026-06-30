/*
  # Autonomous sessions for every chef de gare (primary or secondary)

  Problem: get_my_station_id() and a few RLS policies only matched the PRIMARY
  chef (stations.station_manager_id = auth.uid()). Secondary chefs listed only in
  the station_managers junction resolved to NULL and could not access their
  station's data.

  Fix:
  1. get_my_station_id() now resolves via the station_managers junction first
     (covering every assigned chef), then falls back to stations.station_manager_id.
  2. counter_routes and ramassage_collections chef policies now scope by
     get_my_station_id() so any assigned chef can manage their station.

  No data is dropped or altered; only the function body and policy predicates change.
*/

CREATE OR REPLACE FUNCTION public.get_my_station_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
SELECT COALESCE(
  (SELECT station_id FROM station_managers WHERE manager_id = auth.uid()
     ORDER BY is_primary DESC, created_at ASC LIMIT 1),
  (SELECT id FROM stations WHERE station_manager_id = auth.uid() LIMIT 1)
);
$function$;

-- counter_routes: allow any assigned chef de gare of the counter's station
DROP POLICY IF EXISTS "insert_counter_routes_chef_gare" ON counter_routes;
CREATE POLICY "insert_counter_routes_chef_gare"
  ON counter_routes FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM counters c
    WHERE c.id = counter_routes.counter_id
      AND c.station_id = get_my_station_id()
  ));

DROP POLICY IF EXISTS "delete_counter_routes_chef_gare" ON counter_routes;
CREATE POLICY "delete_counter_routes_chef_gare"
  ON counter_routes FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM counters c
    WHERE c.id = counter_routes.counter_id
      AND c.station_id = get_my_station_id()
  ));

-- ramassage_collections: allow any assigned chef de gare of the station
DROP POLICY IF EXISTS "insert_ramassage_collections" ON ramassage_collections;
CREATE POLICY "insert_ramassage_collections"
  ON ramassage_collections FOR INSERT
  TO authenticated
  WITH CHECK (station_id = get_my_station_id());

DROP POLICY IF EXISTS "update_ramassage_collections" ON ramassage_collections;
CREATE POLICY "update_ramassage_collections"
  ON ramassage_collections FOR UPDATE
  TO authenticated
  USING (station_id = get_my_station_id())
  WITH CHECK (station_id = get_my_station_id());

DROP POLICY IF EXISTS "delete_ramassage_collections" ON ramassage_collections;
CREATE POLICY "delete_ramassage_collections"
  ON ramassage_collections FOR DELETE
  TO authenticated
  USING (station_id = get_my_station_id());

NOTIFY pgrst, 'reload schema';
