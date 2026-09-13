/*
# Allow guichetier role to insert/select/update parcels from their own station

1. Context
- The COURRIER module is now accessible from the POS guichet (when a station
  has courrier_enabled = true). The POS user is authenticated as role
  'guichetier', not 'agent_colis'.
- The existing INSERT policy `agent_colis_insert_sa_gare` only allows
  get_my_role() = 'agent_colis'. A guichetier trying to register a courrier
  gets: "new row violates row-level security policy for table parcels".
- Same gap exists for SELECT and UPDATE: guichetier cannot read or update
  parcels from their own station.

2. Changes
- Add 3 new RLS policies on `parcels` for the `guichetier` role, mirroring
  the existing `agent_colis_*_sa_gare` policies:
  - `guichetier_insert_parcels_sa_gare`: INSERT when origin_station_id = user's station
  - `guichetier_select_parcels_sa_gare`: SELECT when origin or destination = user's station
  - `guichetier_update_parcels_sa_gare`: UPDATE when origin or destination = user's station

3. Security
- Each policy checks get_my_role() = 'guichetier' AND station ownership via
  auth.uid() → users.station_id, exactly like the agent_colis policies.
- No changes to existing policies. No new tables or columns.
*/

DROP POLICY IF EXISTS "guichetier_insert_parcels_sa_gare" ON parcels;
CREATE POLICY "guichetier_insert_parcels_sa_gare"
ON parcels FOR INSERT
TO authenticated
WITH CHECK (
  get_my_role() = 'guichetier'
  AND origin_station_id = (
    SELECT users.station_id FROM users WHERE users.id = auth.uid()
  )
);

DROP POLICY IF EXISTS "guichetier_select_parcels_sa_gare" ON parcels;
CREATE POLICY "guichetier_select_parcels_sa_gare"
ON parcels FOR SELECT
TO authenticated
USING (
  get_my_role() = 'guichetier'
  AND (
    origin_station_id = (
      SELECT users.station_id FROM users WHERE users.id = auth.uid()
    )
    OR destination_station_id = (
      SELECT users.station_id FROM users WHERE users.id = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS "guichetier_update_parcels_sa_gare" ON parcels;
CREATE POLICY "guichetier_update_parcels_sa_gare"
ON parcels FOR UPDATE
TO authenticated
USING (
  get_my_role() = 'guichetier'
  AND (
    origin_station_id = (
      SELECT users.station_id FROM users WHERE users.id = auth.uid()
    )
    OR destination_station_id = (
      SELECT users.station_id FROM users WHERE users.id = auth.uid()
    )
  )
)
WITH CHECK (
  get_my_role() = 'guichetier'
  AND (
    origin_station_id = (
      SELECT users.station_id FROM users WHERE users.id = auth.uid()
    )
    OR destination_station_id = (
      SELECT users.station_id FROM users WHERE users.id = auth.uid()
    )
  )
);
