/*
# Gestionnaire, détail par ligne : les convois sur leur propre ligne « Convoi (la ligne) »

Demande (26/11/2026) : dans la liste des lignes de « Détail par ligne », un convoi apparaît comme le
ramassage direct (« Ramassage direct (sans ligne) ») : sur sa propre ligne, « Convoi (Daloa -
Abidjan) », ou « Convoi (sans ligne) » s'il n'a pas de ligne. Jusqu'ici ses recettes et charges
étaient mêlées à celles de sa ligne.

get_gestionnaire_revenue_by_route regroupe maintenant par ligne ET par convoi / non convoi, et rend
une colonne de plus, is_convoy (l'écran ouvre le détail d'une ligne de convoi sur ses seuls
convois). Les totaux du rapport ne changent pas : un convoi passe seulement d'une ligne à l'autre.
Aucune donnée n'est modifiée.
*/

DROP FUNCTION IF EXISTS public.get_gestionnaire_revenue_by_route(date, date);

CREATE FUNCTION public.get_gestionnaire_revenue_by_route(p_date_from date, p_date_to date)
RETURNS TABLE(
  route_id uuid, route_name text, trip_count bigint, revenue numeric,
  cc_carburant numeric, cc_ration numeric, cc_peage numeric, cc_autres numeric,
  fuel_enlev numeric, expense_reparation numeric,
  total_expense numeric, margin numeric,
  is_convoy boolean
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_company_id uuid;
BEGIN
  v_company_id := get_gestionnaire_company_id();
  IF v_company_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH scr AS (
    SELECT x.*, coalesce(s.status = 'convoi', false) AS conv
    FROM schedule_company_revenue(p_date_from, p_date_to) x
    LEFT JOIN schedules s ON s.id = x.schedule_id
    WHERE x.company_id = v_company_id
  ),
  scc AS (
    SELECT * FROM schedule_company_charges(p_date_from, p_date_to)
    WHERE company_id = v_company_id
  ),
  chg AS (
    SELECT scr2.route_id, scr2.conv,
      COALESCE(SUM(scc.cc_carburant), 0) AS carb,
      COALESCE(SUM(scc.cc_ration), 0)    AS ration,
      COALESCE(SUM(scc.cc_peage), 0)     AS peage,
      COALESCE(SUM(scc.cc_autres), 0)    AS autres
    FROM scr scr2
    JOIN scc ON scc.schedule_id = scr2.schedule_id AND scc.is_beneficiary = scr2.is_beneficiary
    GROUP BY scr2.route_id, scr2.conv
  ),
  base AS (
    SELECT
      scr.route_id, scr.conv,
      COUNT(DISTINCT scr.schedule_id)::bigint AS trip_count,
      COALESCE(SUM(scr.revenue), 0)           AS revenue
    FROM scr
    GROUP BY scr.route_id, scr.conv
  )
  SELECT
    b.route_id AS route_id,
    (CASE WHEN b.conv THEN 'Convoi (' || COALESCE(rt.name, 'sans ligne') || ')'
          WHEN b.route_id IS NULL THEN 'Ramassage direct (sans ligne)'
          ELSE COALESCE(rt.name, 'Ligne inconnue') END)::text AS route_name,
    b.trip_count, b.revenue,
    COALESCE(c.carb, 0)   AS cc_carburant,
    COALESCE(c.ration, 0) AS cc_ration,
    COALESCE(c.peage, 0)  AS cc_peage,
    COALESCE(c.autres, 0) AS cc_autres,
    0::numeric AS fuel_enlev,
    0::numeric AS expense_reparation,
    (COALESCE(c.carb,0) + COALESCE(c.ration,0) + COALESCE(c.peage,0) + COALESCE(c.autres,0)) AS total_expense,
    (b.revenue - COALESCE(c.carb,0) - COALESCE(c.ration,0) - COALESCE(c.peage,0) - COALESCE(c.autres,0)) AS margin,
    b.conv AS is_convoy
  FROM base b
  LEFT JOIN routes rt ON rt.id = b.route_id
  LEFT JOIN chg c ON c.route_id IS NOT DISTINCT FROM b.route_id AND c.conv = b.conv
  ORDER BY b.revenue DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_gestionnaire_revenue_by_route(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gestionnaire_revenue_by_route(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
