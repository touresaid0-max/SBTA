/*
# Gestionnaire — intégration des charges de convoi dans tous les RPCs

## Problème
Les charges saisies sur un convoi (ratio, carburant, péage, autres) n'étaient
pas intégrées dans les calculs du module Gestionnaire. Seules les recettes
(cv.amount) avaient été intégrées (migration 20260602182757).
Résultat : "Détail par ligne" affichait 0 charges pour les convois.

## Correction
1. Étendre `schedule_company_charges` pour inclure les charges de convoi
   (mapping : ratio→ration, carburant→carburant, peage→peage, autres→autres).
   Cela corrige automatiquement les 3 RPCs qui l'utilisent :
   - get_gestionnaire_revenue_by_route (Détail par ligne)
   - get_gestionnaire_revenue_by_bus
   - get_gestionnaire_driver_report

2. get_gestionnaire_revenue_by_route : ajout colonne cc_autres + cc_autres
   dans total_expense et margin (DROP + CREATE car return type change).

3. get_gestionnaire_dashboard_kpis : ajout des charges convoi aux sous-requêtes
   cc_ration, cc_carburant_complement, cc_peage, expense_autres.

4. get_gestionnaire_daily_series : ajout des charges convoi aux expenses.

## Important
Seule la logique de charges est modifiée. Les recettes, filtres, et toutes
les autres fonctionnalités restent inchangées.
*/

-- ═══════════════════════════════════════════════════════════════════
-- 1. Étendre schedule_company_charges (helper SQL — CREATE OR REPLACE)
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION schedule_company_charges(p_from date, p_to date)
RETURNS TABLE(
  schedule_id uuid, bus_id uuid, company_id uuid, is_beneficiary boolean,
  cc_ration numeric, cc_carburant numeric, cc_peage numeric, cc_autres numeric,
  cc_total numeric
)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
-- Charges guichet (counter_charges) par départ
WITH cc AS (
  SELECT
    cc2.schedule_id,
    cc2.bus_id,
    COALESCE(SUM(cc2.amount) FILTER (WHERE cc2.charge_type = 'ration'), 0)                AS ration,
    COALESCE(SUM(cc2.amount) FILTER (WHERE cc2.charge_type = 'carburant_complement'), 0)  AS carburant,
    COALESCE(SUM(cc2.amount) FILTER (WHERE cc2.charge_type = 'peage'), 0)                 AS peage,
    COALESCE(SUM(cc2.amount) FILTER (WHERE cc2.charge_type NOT IN ('ration','carburant_complement','peage')), 0) AS autres
  FROM counter_charges cc2
  JOIN schedules s ON s.id = cc2.schedule_id
  WHERE cc2.status <> 'rejete'
    AND s.departure_datetime::date BETWEEN p_from AND p_to
  GROUP BY cc2.schedule_id, cc2.bus_id
),
-- Charges convoi par départ (status = 'convoi' uniquement)
cvc AS (
  SELECT
    cv.schedule_id,
    s.bus_id,
    COALESCE(cv.ratio_amount, 0)     AS ration,
    COALESCE(cv.carburant_amount, 0) AS carburant,
    COALESCE(cv.peage_amount, 0)     AS peage,
    COALESCE(cv.autres_amount, 0)    AS autres
  FROM convoys cv
  JOIN schedules s ON s.id = cv.schedule_id AND s.status = 'convoi'
  WHERE s.departure_datetime::date BETWEEN p_from AND p_to
),
-- Charges combinées : counter_charges + convoi (UNION puis somme par départ)
combined AS (
  SELECT schedule_id, bus_id, ration, carburant, peage, autres FROM cc
  UNION ALL
  SELECT schedule_id, bus_id, ration, carburant, peage, autres FROM cvc
),
-- Agrégation finale par départ
agg AS (
  SELECT
    schedule_id,
    bus_id,
    COALESCE(SUM(ration), 0)    AS ration,
    COALESCE(SUM(carburant), 0) AS carburant,
    COALESCE(SUM(peage), 0)     AS peage,
    COALESCE(SUM(autres), 0)    AS autres
  FROM combined
  GROUP BY schedule_id, bus_id
),
br AS (
  SELECT DISTINCT ON (sb.schedule_id)
    sb.schedule_id,
    sb.status                              AS b_status,
    sb.original_company_id,
    sb.beneficiary_company_id,
    sb.original_bus_id,
    sb.replacement_bus_id,
    COALESCE(sb.charges_ration_original, 0)    AS cr_orig,
    COALESCE(sb.charges_ration_beneficiary, 0) AS cr_benef,
    COALESCE(sb.charges_carburant_original, 0)    AS cc_orig,
    COALESCE(sb.charges_carburant_beneficiary, 0) AS cc_benef,
    COALESCE(sb.charges_peage_original, 0)    AS cp_orig,
    COALESCE(sb.charges_peage_beneficiary, 0) AS cp_benef,
    COALESCE(sb.charges_autres_original, 0)    AS ca_orig,
    COALESCE(sb.charges_autres_beneficiary, 0) AS ca_benef,
    COALESCE(sb.charges_total_beneficiary, 0)  AS total_benef
  FROM schedule_breakdowns sb
  ORDER BY sb.schedule_id, sb.breakdown_at DESC
)
-- Origin row: full charges or origin share
SELECT
  agg.schedule_id,
  agg.bus_id,
  COALESCE(br.original_company_id, b.company_id) AS company_id,
  false AS is_beneficiary,
  CASE WHEN br.b_status = 'cloture' AND br.total_benef > 0
    THEN br.cr_orig ELSE agg.ration END         AS cc_ration,
  CASE WHEN br.b_status = 'cloture' AND br.total_benef > 0
    THEN br.cc_orig ELSE agg.carburant END       AS cc_carburant,
  CASE WHEN br.b_status = 'cloture' AND br.total_benef > 0
    THEN br.cp_orig ELSE agg.peage END           AS cc_peage,
  CASE WHEN br.b_status = 'cloture' AND br.total_benef > 0
    THEN br.ca_orig ELSE agg.autres END          AS cc_autres,
  CASE WHEN br.b_status = 'cloture' AND br.total_benef > 0
    THEN br.cr_orig + br.cc_orig + br.cp_orig + br.ca_orig
    ELSE agg.ration + agg.carburant + agg.peage + agg.autres END AS cc_total
FROM agg
JOIN buses b ON b.id = agg.bus_id
LEFT JOIN br ON br.schedule_id = agg.schedule_id

UNION ALL

-- Beneficiary row: only when charge distribution exists
SELECT
  agg.schedule_id,
  COALESCE(br.replacement_bus_id, agg.bus_id) AS bus_id,
  br.beneficiary_company_id                    AS company_id,
  true                                         AS is_beneficiary,
  br.cr_benef                                  AS cc_ration,
  br.cc_benef                                  AS cc_carburant,
  br.cp_benef                                  AS cc_peage,
  br.ca_benef                                  AS cc_autres,
  br.cr_benef + br.cc_benef + br.cp_benef + br.ca_benef AS cc_total
FROM agg
JOIN br ON br.schedule_id = agg.schedule_id
WHERE br.b_status = 'cloture'
  AND br.beneficiary_company_id IS NOT NULL
  AND br.beneficiary_company_id <> br.original_company_id
  AND br.total_benef > 0;
$function$;


-- ═══════════════════════════════════════════════════════════════════
-- 2. get_gestionnaire_revenue_by_route — ajout cc_autres (DROP + CREATE)
-- ═══════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS get_gestionnaire_revenue_by_route(date, date);

CREATE FUNCTION get_gestionnaire_revenue_by_route(p_date_from date, p_date_to date)
RETURNS TABLE(
  route_id uuid, route_name text, trip_count bigint, revenue numeric,
  cc_carburant numeric, cc_ration numeric, cc_peage numeric,
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
  rt.id AS route_id,
  COALESCE(rt.name, 'Ligne inconnue') AS route_name,
  b.trip_count, b.revenue,
  COALESCE(c.carb, 0)   AS cc_carburant,
  COALESCE(c.ration, 0) AS cc_ration,
  COALESCE(c.peage, 0)  AS cc_peage,
  0::numeric AS fuel_enlev,
  0::numeric AS expense_reparation,
  (COALESCE(c.carb,0) + COALESCE(c.ration,0) + COALESCE(c.peage,0) + COALESCE(c.autres,0)) AS total_expense,
  (b.revenue - COALESCE(c.carb,0) - COALESCE(c.ration,0) - COALESCE(c.peage,0) - COALESCE(c.autres,0)) AS margin
FROM base b
JOIN routes rt ON rt.id = b.route_id
LEFT JOIN chg c ON c.route_id = b.route_id
ORDER BY b.revenue DESC;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════
-- 3. get_gestionnaire_dashboard_kpis — ajout charges convoi
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION get_gestionnaire_dashboard_kpis(p_date_from date, p_date_to date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_result     jsonb;
BEGIN
  v_company_id := get_gestionnaire_company_id();
  IF v_company_id IS NULL THEN RETURN '{}'::jsonb; END IF;

  WITH schedule_revenue AS (
    SELECT s.id AS sid, s.bus_id, s.driver_id,
      CASE WHEN s.status = 'convoi' THEN COALESCE(cv.amount, 0)
           ELSE COALESCE(SUM(r.total_price), 0)
      END AS revenue
    FROM schedules s
    JOIN buses b ON b.id = s.bus_id AND b.company_id = v_company_id
    LEFT JOIN reservations r ON r.schedule_id = s.id AND r.status IN ('confirmee','utilisee')
    LEFT JOIN convoys cv ON cv.schedule_id = s.id
    WHERE s.departure_datetime::date BETWEEN p_date_from AND p_date_to
    GROUP BY s.id, s.status, cv.amount
  )
  SELECT jsonb_build_object(
    'total_revenue',           COALESCE(SUM(sr.revenue), 0),
    'trip_count',              COUNT(DISTINCT sr.sid),
    'active_bus_count',        COUNT(DISTINCT sr.bus_id),
    'driver_count',            COUNT(DISTINCT sr.driver_id),

    -- cc_ration = counter_charges ration + convoi ratio
    'cc_ration', COALESCE((
      SELECT SUM(cc.amount) FROM counter_charges cc
      JOIN buses b2 ON b2.id = cc.bus_id
      WHERE b2.company_id = v_company_id
        AND cc.charge_type = 'ration'
        AND cc.charge_date BETWEEN p_date_from AND p_date_to
    ), 0) + COALESCE((
      SELECT SUM(cv.ratio_amount) FROM convoys cv
      JOIN schedules s ON s.id = cv.schedule_id AND s.status = 'convoi'
      JOIN buses b ON b.id = s.bus_id AND b.company_id = v_company_id
      WHERE s.departure_datetime::date BETWEEN p_date_from AND p_date_to
    ), 0),

    -- cc_carburant_complement = counter_charges carburant + convoi carburant
    'cc_carburant_complement', COALESCE((
      SELECT SUM(cc.amount) FROM counter_charges cc
      JOIN buses b2 ON b2.id = cc.bus_id
      WHERE b2.company_id = v_company_id
        AND cc.charge_type = 'carburant_complement'
        AND cc.charge_date BETWEEN p_date_from AND p_date_to
    ), 0) + COALESCE((
      SELECT SUM(cv.carburant_amount) FROM convoys cv
      JOIN schedules s ON s.id = cv.schedule_id AND s.status = 'convoi'
      JOIN buses b ON b.id = s.bus_id AND b.company_id = v_company_id
      WHERE s.departure_datetime::date BETWEEN p_date_from AND p_date_to
    ), 0),

    -- cc_peage = counter_charges peage + convoi peage
    'cc_peage', COALESCE((
      SELECT SUM(cc.amount) FROM counter_charges cc
      JOIN buses b2 ON b2.id = cc.bus_id
      WHERE b2.company_id = v_company_id
        AND cc.charge_type = 'peage'
        AND cc.charge_date BETWEEN p_date_from AND p_date_to
    ), 0) + COALESCE((
      SELECT SUM(cv.peage_amount) FROM convoys cv
      JOIN schedules s ON s.id = cv.schedule_id AND s.status = 'convoi'
      JOIN buses b ON b.id = s.bus_id AND b.company_id = v_company_id
      WHERE s.departure_datetime::date BETWEEN p_date_from AND p_date_to
    ), 0),

    'fuel_enlevements_amount', COALESCE((
      SELECT SUM(fe.total_amount) FROM fuel_enlevements fe
      WHERE fe.company_id = v_company_id
        AND fe.enlevement_date BETWEEN p_date_from AND p_date_to
    ), 0),

    'expense_reparation', COALESCE((
      SELECT SUM(ve.amount)
      FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number
        AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.company_id, fv_r.company_id) = v_company_id
        AND ve.source = 'comptable'
        AND (ve.description IS NULL OR ve.description NOT LIKE 'Sortie stock — %')
        AND ve.expense_date BETWEEN p_date_from AND p_date_to
    ), 0),

    'vehicle_expenses_amount', COALESCE((
      SELECT SUM(ve.amount)
      FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number
        AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.company_id, fv_r.company_id) = v_company_id
        AND ve.source = 'charge_achat'
        AND ve.expense_date BETWEEN p_date_from AND p_date_to
    ), 0),

    'fuel_carburant_comptable', COALESCE((
      SELECT SUM(cfw.total_amount)
      FROM comptable_fuel_withdrawals cfw
      WHERE cfw.company_id = v_company_id
        AND cfw.withdrawal_date BETWEEN p_date_from AND p_date_to
    ), 0),

    -- expense_autres = stock exits + convoi autres
    'expense_autres', COALESCE((
      SELECT SUM(ve.amount)
      FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number
        AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.company_id, fv_r.company_id) = v_company_id
        AND ve.source = 'comptable'
        AND ve.description LIKE 'Sortie stock — %'
        AND ve.expense_date BETWEEN p_date_from AND p_date_to
    ), 0) + COALESCE((
      SELECT SUM(cv.autres_amount) FROM convoys cv
      JOIN schedules s ON s.id = cv.schedule_id AND s.status = 'convoi'
      JOIN buses b ON b.id = s.bus_id AND b.company_id = v_company_id
      WHERE s.departure_datetime::date BETWEEN p_date_from AND p_date_to
    ), 0)
  )
  INTO v_result
  FROM schedule_revenue sr;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;


-- ═══════════════════════════════════════════════════════════════════
-- 4. get_gestionnaire_daily_series — ajout charges convoi
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION get_gestionnaire_daily_series(p_date_from date, p_date_to date)
RETURNS TABLE(day date, revenue numeric, expenses numeric, trip_count bigint)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_company_id uuid;
BEGIN
  v_company_id := get_gestionnaire_company_id();
  IF v_company_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  -- Charges guichet par jour
  WITH cc_by_day AS (
    SELECT cc.charge_date AS cday, SUM(cc.amount) AS total
    FROM counter_charges cc
    JOIN buses b ON b.id = cc.bus_id AND b.company_id = v_company_id
    WHERE cc.charge_date BETWEEN p_date_from AND p_date_to
    GROUP BY cc.charge_date
  ),
  -- Charges convoi par jour (ratio + carburant + péage + autres)
  cv_by_day AS (
    SELECT s.departure_datetime::date AS cday,
      SUM(cv.ratio_amount + cv.carburant_amount + cv.peage_amount + cv.autres_amount) AS total
    FROM convoys cv
    JOIN schedules s ON s.id = cv.schedule_id AND s.status = 'convoi'
    JOIN buses b ON b.id = s.bus_id AND b.company_id = v_company_id
    WHERE s.departure_datetime::date BETWEEN p_date_from AND p_date_to
    GROUP BY s.departure_datetime::date
  ),
  sched_rev AS (
    SELECT s.id AS sid, s.departure_datetime::date AS rday,
      CASE WHEN s.status = 'convoi' THEN COALESCE(cv.amount, 0)
           ELSE COALESCE(SUM(r.total_price), 0)
      END AS srev
    FROM schedules s
    JOIN buses b ON b.id = s.bus_id AND b.company_id = v_company_id
    LEFT JOIN reservations r ON r.schedule_id = s.id AND r.status IN ('confirmee','utilisee')
    LEFT JOIN convoys cv ON cv.schedule_id = s.id
    WHERE s.departure_datetime::date BETWEEN p_date_from AND p_date_to
    GROUP BY s.id, s.departure_datetime::date, s.status, cv.amount
  ),
  revenue_by_day AS (
    SELECT rday, COALESCE(SUM(srev), 0) AS total_revenue,
      COUNT(DISTINCT sid)::bigint AS trip_count
    FROM sched_rev GROUP BY rday
  )
  SELECT
    rd.rday                                                          AS day,
    rd.total_revenue                                                 AS revenue,
    COALESCE(cc.total, 0) + COALESCE(cv.total, 0)                   AS expenses,
    rd.trip_count
  FROM revenue_by_day rd
  LEFT JOIN cc_by_day cc ON cc.cday = rd.rday
  LEFT JOIN cv_by_day cv ON cv.cday = rd.rday
  ORDER BY rd.rday;
END;
$$;

NOTIFY pgrst, 'reload schema';
