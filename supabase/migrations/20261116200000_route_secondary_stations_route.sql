/*
# Itinéraires secondaires : la gare secondaire vend sur son propre itinéraire

Demande (16/11/2026) : sur un départ chargé dans une autre gare, la gare secondaire doit imprimer
sur le ticket l'itinéraire secondaire (pas celui de la gare principale) et appliquer ses tarifs.

get_route_secondary_stations() rend désormais aussi l'itinéraire secondaire par lequel chaque gare
est liée (secondary_route_id) : le guichet de la gare secondaire en tire le nom imprimé, les
destinations et les tarifs. Le type de retour change : la fonction est supprimée puis recréée
(même nom, mêmes droits). Aucune donnée n'est modifiée ; aucune règle d'accès ne change.
*/

DROP FUNCTION IF EXISTS public.get_route_secondary_stations();

CREATE FUNCTION public.get_route_secondary_stations()
RETURNS TABLE (route_id uuid, station_id uuid, secondary_route_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT rsr.route_id, x.station_id, rsr.secondary_route_id
  FROM route_secondary_routes rsr
  CROSS JOIN LATERAL (
    SELECT c.station_id
    FROM counter_routes cr
    JOIN counters c ON c.id = cr.counter_id
    WHERE cr.route_id = rsr.secondary_route_id
      AND c.station_id IS NOT NULL
      AND coalesce(c.is_active, true)
    UNION
    SELECT r.origin_station_id
    FROM routes r
    WHERE r.id = rsr.secondary_route_id
      AND r.origin_station_id IS NOT NULL
  ) x
  JOIN stations st ON st.id = x.station_id AND coalesce(st.is_active, true);
$$;

REVOKE ALL ON FUNCTION public.get_route_secondary_stations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_route_secondary_stations() TO authenticated;

NOTIFY pgrst, 'reload schema';
