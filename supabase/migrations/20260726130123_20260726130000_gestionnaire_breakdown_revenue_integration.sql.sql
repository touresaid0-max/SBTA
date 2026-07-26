/*
# Gestionnaire — intégration des recettes de répartition de panne

## Problème
Les recettes de répartition de panne (breakdown redistribution) n'étaient pas
comptabilisées dans :
  - get_gestionnaire_dashboard_kpis (Tableau de bord)
  - get_gestionnaire_daily_series    (série temporelle)

Ces deux RPCs utilisaient leur propre CTE de recettes (JOIN reservations +
convoys) qui ignore complètement les répartitions de panne
(schedule_breakdowns).

Les 3 autres RPCs (revenue_by_route, revenue_by_bus, driver_report) utilisent
déjà le helper schedule_company_revenue qui gère correctement les splits.

## Correction
Remplacer la CTE schedule_revenue par schedule_company_revenue(p_from, p_to)
filtrée par company_id. Ce helper gère déjà :
  - les recettes normales (reservations)
  - les recettes de convoi (cv.amount)
  - les recettes de ramassage
  - les recettes mobile (mobile_bookings)
  - les répartitions de panne (origin row = gross - amt_benef,
    beneficiary row = amt_benef)

## Important
Seule la source des recettes est modifiée. Les charges, filtres, et toutes
les autres fonctionnalités restent inchangées.
*/

-- ═══════════════════════════════════════════════════════════════════
-- 1. get_gestionnaire_dashboard_kpis — utiliser schedule_company_revenue
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

  -- schedule_company_revenue gère : recettes normales, convois, ramassage,
  -- mobile bookings, ET les répartitions de panne (breakdown splits).
  WITH scr AS (
    SELECT * FROM schedule_company_revenue(p_date_from, p_date_to)
    WHERE company_id = v_company_id
  )
  SELECT jsonb_build_object(
    'total_revenue',           COALESCE(SUM(scr.revenue), 0),
    'trip_count',              COUNT(DISTINCT scr.schedule_id),
    'active_bus_count',        COUNT(DISTINCT scr.bus_id),
    'driver_count',            COUNT(DISTINCT scr.driver_id),

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
  FROM scr;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;


-- ═══════════════════════════════════════════════════════════════════
-- 2. get_gestionnaire_daily_series — utiliser schedule_company_revenue
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
  -- schedule_company_revenue gère les recettes normales, convois, ramassage,
  -- mobile bookings ET les répartitions de panne.
  scr AS (
    SELECT * FROM schedule_company_revenue(p_date_from, p_date_to)
    WHERE company_id = v_company_id
  ),
  revenue_by_day AS (
    SELECT schedule_date AS rday,
      COALESCE(SUM(revenue), 0) AS total_revenue,
      COUNT(DISTINCT schedule_id)::bigint AS trip_count
    FROM scr
    GROUP BY schedule_date
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
