/*
# Enrichir les rapports détaillés du Gestionnaire avec les charges guichet

1. Objectif
- Les rapports détaillés utilisent la série journalière pour alimenter les vues Journalier, Hebdomadaire et Mensuel.
- La série précédente ne retournait qu'un total de charges, ce qui empêchait l'affichage détaillé des charges guichet et rendait les regroupements incomplets.

2. Fonction modifiée
- `get_gestionnaire_daily_series(p_date_from, p_date_to)` retourne désormais les quatre catégories de charges du Guichet POS : carburant complémentaire, rations, péages et autres dépenses.
- Le champ `expenses` reste le total des quatre catégories afin de préserver les calculs existants.

3. Sécurité
- La fonction reste `SECURITY DEFINER` avec `search_path` fixé à `public`.
- Les mêmes contrôles de société et de période sont conservés.

4. Données concernées
- Seules les charges déjà enregistrées dans `counter_charges` sont lues.
- `charge_type = 'autres'` alimente `cc_autres`.
- Aucune donnée existante n'est supprimée ou modifiée.
*/

DROP FUNCTION IF EXISTS public.get_gestionnaire_daily_series(date, date);

CREATE FUNCTION public.get_gestionnaire_daily_series(p_date_from date, p_date_to date)
RETURNS TABLE(
  day date,
  revenue numeric,
  expenses numeric,
  trip_count bigint,
  cc_carburant numeric,
  cc_ration numeric,
  cc_peage numeric,
  cc_autres numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  v_company_id := get_gestionnaire_company_id();
  IF v_company_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH charges_by_day AS (
    SELECT
      cc.charge_date AS cday,
      COALESCE(SUM(cc.amount) FILTER (WHERE cc.charge_type = 'carburant_complement'), 0) AS carb,
      COALESCE(SUM(cc.amount) FILTER (WHERE cc.charge_type = 'ration'), 0) AS ration,
      COALESCE(SUM(cc.amount) FILTER (WHERE cc.charge_type = 'peage'), 0) AS peage,
      COALESCE(SUM(cc.amount) FILTER (WHERE cc.charge_type = 'autres'), 0) AS autres
    FROM counter_charges cc
    JOIN buses b2 ON b2.id = cc.bus_id AND b2.company_id = v_company_id
    WHERE cc.charge_date BETWEEN p_date_from AND p_date_to
    GROUP BY cc.charge_date
  ),
  scr AS (
    SELECT *
    FROM schedule_company_revenue(p_date_from, p_date_to)
    WHERE company_id = v_company_id
  ),
  revenue_by_day AS (
    SELECT
      schedule_date AS rday,
      COALESCE(SUM(revenue), 0) AS total_revenue,
      COUNT(DISTINCT schedule_id)::bigint AS trips
    FROM scr
    GROUP BY schedule_date
  )
  SELECT
    rd.rday,
    rd.total_revenue,
    COALESCE(cb.carb, 0) + COALESCE(cb.ration, 0) + COALESCE(cb.peage, 0) + COALESCE(cb.autres, 0),
    rd.trips,
    COALESCE(cb.carb, 0),
    COALESCE(cb.ration, 0),
    COALESCE(cb.peage, 0),
    COALESCE(cb.autres, 0)
  FROM revenue_by_day rd
  LEFT JOIN charges_by_day cb ON cb.cday = rd.rday
  ORDER BY rd.rday;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_gestionnaire_daily_series(date, date) TO authenticated;