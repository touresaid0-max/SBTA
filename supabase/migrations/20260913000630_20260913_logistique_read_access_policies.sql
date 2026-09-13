/*
# Logistique role read access

Grant the `logistique` role SELECT access to the same tables as `responsable_logistique`
so the Parc véhicules, Synthèse bus and Rapport conducteur screens display real data.
The role stays read-only through separate INSERT/UPDATE/DELETE policies that are NOT extended.

1. Policies added (SELECT only)
   - vehicle_logistics.vl_select_logistique_read
   - vehicle_documents.vd_select_logistique_read
   - vehicle_plates.vp_select_logistique_read
   - logistics_providers.lp_select_logistique_read
   - logistics_service_types.lst_select_logistique_read
   - buses.buses_select_logistique_read (read-only companion to buses_select_logistique)
   - users.logistique_select_chef_gare (chef_gare users needed by Rapport conducteur)

2. Notes
   - The existing `get_my_role_logistique()` helper returns the caller's role via app_metadata.
   - No write policy is granted to `logistique`; mutation attempts fail as expected.
*/

DROP POLICY IF EXISTS "vl_select_logistique_read" ON vehicle_logistics;
CREATE POLICY "vl_select_logistique_read"
ON vehicle_logistics FOR SELECT
TO authenticated
USING (get_my_role_logistique() = 'logistique');

DROP POLICY IF EXISTS "vd_select_logistique_read" ON vehicle_documents;
CREATE POLICY "vd_select_logistique_read"
ON vehicle_documents FOR SELECT
TO authenticated
USING (get_my_role_logistique() = 'logistique');

DROP POLICY IF EXISTS "vp_select_logistique_read" ON vehicle_plates;
CREATE POLICY "vp_select_logistique_read"
ON vehicle_plates FOR SELECT
TO authenticated
USING (get_my_role_logistique() = 'logistique');

DROP POLICY IF EXISTS "lp_select_logistique_read" ON logistics_providers;
CREATE POLICY "lp_select_logistique_read"
ON logistics_providers FOR SELECT
TO authenticated
USING (get_my_role_logistique() = 'logistique');

DROP POLICY IF EXISTS "lst_select_logistique_read" ON logistics_service_types;
CREATE POLICY "lst_select_logistique_read"
ON logistics_service_types FOR SELECT
TO authenticated
USING (get_my_role_logistique() = 'logistique');

DROP POLICY IF EXISTS "buses_select_logistique_read" ON buses;
CREATE POLICY "buses_select_logistique_read"
ON buses FOR SELECT
TO authenticated
USING (get_my_role_logistique() = 'logistique');

DROP POLICY IF EXISTS "logistique_select_chef_gare" ON users;
CREATE POLICY "logistique_select_chef_gare"
ON users FOR SELECT
TO authenticated
USING (
  ((auth.jwt() -> 'app_metadata') ->> 'role') = 'logistique'
  AND role = 'chef_gare'
);
