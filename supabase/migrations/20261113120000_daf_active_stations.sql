/*
# Rapport voyages du DAF : gares connectées sur la période

Le filtre « Gare » du rapport ne proposait que les gares ayant déjà un départ reçu par le serveur
sur la période. Une gare connectée dont les ventes n'étaient pas encore arrivées (guichet hors
ligne) n'y figurait pas : le 13/11/2026, la Gare SBTA Adjamé Bouaké s'était connectée à 09:35 mais
semblait absente du rapport journalier.

Le journal des connexions (user_sessions) n'est lisible que par l'admin, le DG, les RH et les
chefs de gare (migration 20261102120000) : le DAF ne peut pas le lire directement.

`get_daf_active_stations(p_from, p_to)` donne seulement, pour chaque gare où quelqu'un s'est
connecté sur la période : la gare et l'heure de la dernière connexion. Aucun nom de personne,
aucune donnée personnelle. Réservé au DAF, au DG et à l'administrateur (même règle que
get_daf_voyage_report). Lecture seule.
*/

CREATE OR REPLACE FUNCTION public.get_daf_active_stations(p_from date, p_to date)
RETURNS TABLE (
  station_id    uuid,
  station_name  text,
  last_login    timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF NOT (public.is_daf_user() OR coalesce(public.get_user_role(), '') IN ('daf', 'dg', 'admin')
          OR session_user = 'postgres') THEN
    RAISE EXCEPTION 'Réservé au DAF, au DG et à l''administrateur' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT st.id, st.name::text, max(us.logged_in_at)
  FROM user_sessions us
  JOIN stations st ON st.id = us.station_id
  WHERE us.logged_in_at >= p_from::timestamptz
    AND us.logged_in_at < (p_to + 1)::timestamptz
  GROUP BY st.id, st.name
  ORDER BY st.name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_daf_active_stations(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daf_active_stations(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
