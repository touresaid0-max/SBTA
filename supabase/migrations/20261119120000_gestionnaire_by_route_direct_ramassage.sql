/*
# Gestionnaire, détail par ligne : les ramassages directs ne disparaissent plus

Constat (19/11/2026) : un ramassage direct (saisi au guichet sans ligne de voyage) apparaissait dans
« Détail par bus » mais pas dans « Détail par ligne » : le calcul par ligne ne gardait que les
recettes rattachées à une ligne existante (JOIN routes).

get_gestionnaire_revenue_by_route garde maintenant les recettes sans ligne sur une ligne
« Ramassage direct (sans ligne) » (route_id NULL ; l'écran ne l'ouvre pas en détail). Le total des
lignes est ainsi égal au total du rapport. Même nom, mêmes colonnes, mêmes droits ; aucune donnée
n'est modifiée.
*/

CREATE OR REPLACE FUNCTION public.get_gestionnaire_revenue_by_route(p_date_from date, p_date_to date)
RETURNS TABLE(
  route_id uuid, route_name text, trip_count bigint, revenue numeric,
  cc_carburant numeric, cc_ration numeric, cc_peage numeric, cc_autres numeric,
  fuel_enlev numeric, expense_reparation numeric,
  total_expense numeric, margin numeric
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
    SELECT * FROM schedule_company_revenue(p_date_from, p_date_to)
    WHERE company_id = v_company_id
  ),
  scc AS (
    SELECT * FROM schedule_company_charges(p_date_from, p_date_to)
    WHERE company_id = v_company_id
  ),
  chg AS (
    SELECT scr2.route_id,
      COALESCE(SUM(scc.cc_carburant), 0) AS carb,
      COALESCE(SUM(scc.cc_ration), 0)    AS ration,
      COALESCE(SUM(scc.cc_peage), 0)     AS peage,
      COALESCE(SUM(scc.cc_autres), 0)    AS autres
    FROM scr scr2
    JOIN scc ON scc.schedule_id = scr2.schedule_id AND scc.is_beneficiary = scr2.is_beneficiary
    GROUP BY scr2.route_id
  ),
  base AS (
    SELECT
      scr.route_id,
      COUNT(DISTINCT scr.schedule_id)::bigint AS trip_count,
      COALESCE(SUM(scr.revenue), 0)           AS revenue
    FROM scr
    GROUP BY scr.route_id
  )
  SELECT
    b.route_id AS route_id,
    (CASE WHEN b.route_id IS NULL THEN 'Ramassage direct (sans ligne)'
          ELSE COALESCE(rt.name, 'Ligne inconnue') END)::text AS route_name,
    b.trip_count, b.revenue,
    COALESCE(c.carb, 0)   AS cc_carburant,
    COALESCE(c.ration, 0) AS cc_ration,
    COALESCE(c.peage, 0)  AS cc_peage,
    COALESCE(c.autres, 0) AS cc_autres,
    0::numeric AS fuel_enlev,
    0::numeric AS expense_reparation,
    (COALESCE(c.carb,0) + COALESCE(c.ration,0) + COALESCE(c.peage,0) + COALESCE(c.autres,0)) AS total_expense,
    (b.revenue - COALESCE(c.carb,0) - COALESCE(c.ration,0) - COALESCE(c.peage,0) - COALESCE(c.autres,0)) AS margin
  FROM base b
  LEFT JOIN routes rt ON rt.id = b.route_id
  LEFT JOIN chg c ON c.route_id IS NOT DISTINCT FROM b.route_id
  ORDER BY b.revenue DESC;
END;
$$;


NOTIFY pgrst, 'reload schema';
