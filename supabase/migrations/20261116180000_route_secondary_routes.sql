/*
# Itinéraires secondaires : les gares proposées pour « Charger dans une autre gare »

Demande (16/11/2026) : au guichet, à la création d'un départ avec « Charger dans une autre gare »,
la liste « Gare de vente secondaire » proposait toutes les gares. L'administrateur ajoute
désormais des itinéraires secondaires à un itinéraire existant ; seules les gares liées à ces
itinéraires secondaires sont proposées au guichet.

1. route_secondary_routes : les itinéraires secondaires d'un itinéraire (route_id →
   secondary_route_id). Lecture : utilisateurs connectés. Ajout / retrait : administrateurs
   seulement (vérifié par les règles d'accès). RLS activé.
2. get_route_secondary_stations() : pour chaque itinéraire, les gares liées à ses itinéraires
   secondaires :
     - les gares des guichets à qui l'itinéraire secondaire est attribué (counter_routes) ;
     - la gare d'origine de l'itinéraire secondaire (routes.origin_station_id), si elle est connue.
   Seules les gares actives sont rendues. Fonction en lecture seule, réservée aux utilisateurs
   connectés.

Aucune donnée existante n'est modifiée ; aucune règle d'accès existante ne change.
*/

CREATE TABLE IF NOT EXISTS public.route_secondary_routes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id           uuid NOT NULL REFERENCES public.routes(id) ON DELETE CASCADE,
  secondary_route_id uuid NOT NULL REFERENCES public.routes(id) ON DELETE CASCADE,
  created_by         uuid DEFAULT auth.uid(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT route_secondary_routes_unique UNIQUE (route_id, secondary_route_id),
  CONSTRAINT route_secondary_routes_not_self CHECK (route_id <> secondary_route_id)
);

CREATE INDEX IF NOT EXISTS idx_route_secondary_routes_secondary
  ON public.route_secondary_routes (secondary_route_id);

ALTER TABLE public.route_secondary_routes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "route_secondary_routes_select" ON public.route_secondary_routes;
CREATE POLICY "route_secondary_routes_select"
  ON public.route_secondary_routes FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "route_secondary_routes_admin_insert" ON public.route_secondary_routes;
CREATE POLICY "route_secondary_routes_admin_insert"
  ON public.route_secondary_routes FOR INSERT
  TO authenticated WITH CHECK (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "route_secondary_routes_admin_delete" ON public.route_secondary_routes;
CREATE POLICY "route_secondary_routes_admin_delete"
  ON public.route_secondary_routes FOR DELETE
  TO authenticated USING (public.get_user_role() = 'admin');

CREATE OR REPLACE FUNCTION public.get_route_secondary_stations()
RETURNS TABLE (route_id uuid, station_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT rsr.route_id, x.station_id
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
