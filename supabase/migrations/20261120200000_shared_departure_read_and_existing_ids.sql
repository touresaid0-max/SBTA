/*
# Départs partagés : lecture des billets par la gare partenaire, et plus de ventes effacées du
# guichet (20/11/2026)

Départ #8 (DALOA, car 60325WWCI01), partagé avec YAMOUSSOUKRO : 58 billets sur le serveur, dont 30
vendus par YAMOUSSOUKRO. Après une actualisation, le guichet de YAMOUSSOUKRO n'en montrait aucun
(« 59 libres / 59 ») : les ventes semblaient perdues.

1. Lecture : un guichetier ne lisait que ses propres billets, ceux des départs de son guichet et
   ceux d'un départ de sa gare (même car, même heure). Sur un départ partagé, la gare partenaire ne
   voyait pas les billets de l'autre gare : structure et compteurs faux. Nouvelle règle en LECTURE
   seule : un guichetier lit les billets d'un départ partagé dont sa gare (celle de son guichet)
   est la gare principale ou une gare partenaire. Aucune règle existante n'est modifiée.

2. pos_existing_ids(p_kind, p_ids) : parmi des identifiants de billets (« reservations ») ou de
   départs (« schedules »), ceux qui existent encore sur le serveur, sans tenir compte des droits
   de lecture (identifiants seulement). Le guichet ne retire plus un billet ou un départ de sa
   mémoire que si le serveur confirme qu'il a été supprimé : une réponse vide (connexion expirée,
   droits de lecture) effaçait les ventes du poste.

Aucune donnée n'est modifiée.
*/

-- The departure and the counter are read by a function (their own read rules do not apply), so the
-- rule does not depend on what the guichetier may read in schedules and counters
CREATE OR REPLACE FUNCTION public.guichetier_station_shares_schedule(p_schedule_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM schedules s
    JOIN counters c ON c.assigned_user_id = auth.uid()
    WHERE s.id = p_schedule_id
      AND cardinality(coalesce(s.shared_station_ids, '{}'::uuid[])) > 0
      AND (c.station_id = s.departure_station_id
           OR c.station_id = ANY (s.shared_station_ids))
  );
$$;

REVOKE ALL ON FUNCTION public.guichetier_station_shares_schedule(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guichetier_station_shares_schedule(uuid) TO authenticated;

DROP POLICY IF EXISTS "Guichetier can view reservations of shared departures of own station" ON public.reservations;

CREATE POLICY "Guichetier can view reservations of shared departures of own station"
  ON public.reservations
  FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'guichetier'
    AND guichetier_station_shares_schedule(reservations.schedule_id)
  );

CREATE OR REPLACE FUNCTION public.pos_existing_ids(p_kind text, p_ids uuid[])
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Connexion requise';
  END IF;
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RETURN;
  END IF;
  IF cardinality(p_ids) > 2000 THEN
    RAISE EXCEPTION 'Trop d''identifiants en une fois';
  END IF;
  IF p_kind = 'reservations' THEN
    RETURN QUERY SELECT r.id FROM reservations r WHERE r.id = ANY (p_ids);
  ELSIF p_kind = 'schedules' THEN
    RETURN QUERY SELECT s.id FROM schedules s WHERE s.id = ANY (p_ids);
  ELSE
    RAISE EXCEPTION 'Type inconnu : %', p_kind;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.pos_existing_ids(text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_existing_ids(text, uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
