/*
# Rapports du gestionnaire en erreur à chaque ouverture (audit Supabase du 27/11/2026, point 4.4)

get_gestionnaire_driver_report : « column reference "driver_id" is ambiguous » (144 erreurs en 24 h
avec la suivante). get_gestionnaire_daily_series : « column reference "revenue" is ambiguous ».

Ces fonctions renvoient des colonnes nommées driver_id et revenue ; en PL/pgSQL ces noms sont aussi
des variables, et une colonne écrite sans sa table (« driver_id IS NOT NULL », « SUM(revenue) »)
est ambiguë. #variable_conflict use_column : le nom désigne la colonne, comme dans les autres
rapports (20261112120000, 20261111120000). Derrière cette erreur, le rapport des chauffeurs en avait
une deuxième : les noms (varchar) n'avaient pas le type text annoncé ; ils sont convertis. Calculs inchangés, aucune donnée modifiée. Les droits
d'exécution sont conservés (CREATE OR REPLACE).
*/

CREATE OR REPLACE FUNCTION public.get_gestionnaire_driver_report(p_date_from date, p_date_to date)
 RETURNS TABLE(driver_id uuid, first_name text, last_name text, employee_id text, bus_registration text, trip_count bigint, revenue numeric, cc_carburant numeric, cc_ration numeric, cc_peage numeric, cc_autres numeric, expense_total numeric, avg_rating numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_company_id uuid;
BEGIN
v_company_id := get_gestionnaire_company_id();
IF v_company_id IS NULL THEN RETURN; END IF;

RETURN QUERY
WITH scr AS (
SELECT * FROM schedule_company_revenue(p_date_from, p_date_to)
WHERE company_id = v_company_id AND driver_id IS NOT NULL
),
scc AS (
SELECT * FROM schedule_company_charges(p_date_from, p_date_to)
WHERE company_id = v_company_id
),
chg AS (
SELECT scr2.driver_id,
COALESCE(SUM(scc.cc_carburant), 0) AS carb,
COALESCE(SUM(scc.cc_ration), 0)    AS ration,
COALESCE(SUM(scc.cc_peage), 0)     AS peage,
COALESCE(SUM(scc.cc_autres), 0)    AS autres
FROM scr scr2
JOIN scc ON scc.schedule_id = scr2.schedule_id AND scc.is_beneficiary = scr2.is_beneficiary
GROUP BY scr2.driver_id
),
rating_agg AS (
SELECT dr.driver_id, AVG(dr.rating::numeric) AS avg_r
FROM driver_reviews dr
WHERE dr.created_at::date BETWEEN p_date_from AND p_date_to
GROUP BY dr.driver_id
),
base AS (
SELECT
scr.driver_id,
COUNT(DISTINCT scr.schedule_id)::bigint AS trip_count,
COALESCE(SUM(scr.revenue), 0)            AS revenue,
MAX(b.registration_number)               AS bus_reg
FROM scr
LEFT JOIN buses b ON b.id = scr.bus_id
GROUP BY scr.driver_id
)
SELECT
-- ::text : users.first_name, last_name et employee_id sont des varchar, la fonction rend du text
-- (« structure of query does not match function result type », caché par l'erreur précédente)
u.id AS driver_id, u.first_name::text, u.last_name::text, u.employee_id::text,
base.bus_reg AS bus_registration,
base.trip_count, base.revenue,
COALESCE(c.carb,   0)::numeric AS cc_carburant,
COALESCE(c.ration, 0)::numeric AS cc_ration,
COALESCE(c.peage,  0)::numeric AS cc_peage,
COALESCE(c.autres, 0)::numeric AS cc_autres,
(COALESCE(c.carb,0) + COALESCE(c.ration,0) + COALESCE(c.peage,0) + COALESCE(c.autres,0))::numeric AS expense_total,
rt.avg_r AS avg_rating
FROM base
JOIN users u ON u.id = base.driver_id
LEFT JOIN chg c        ON c.driver_id  = base.driver_id
LEFT JOIN rating_agg rt ON rt.driver_id = base.driver_id
ORDER BY base.revenue DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_gestionnaire_daily_series(p_date_from date, p_date_to date)
 RETURNS TABLE(day date, revenue numeric, expenses numeric, trip_count bigint, cc_carburant numeric, cc_ration numeric, cc_peage numeric, cc_autres numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
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
$function$;

NOTIFY pgrst, 'reload schema';
