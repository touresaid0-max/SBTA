/*
  # Add cc_autres (Autr. dép. GCH) to Gestionnaire and DAF RPCs

  ## Problem
  counter_charges with charge_type = 'autres' (Autres dépenses guichet)
  are never aggregated in financial RPCs. The schedule_company_charges()
  function already computes cc_autres, but cc_agg CTEs only sum
  cc_carburant, cc_ration, cc_peage — cc_autres is dropped.

  ## Fix
  Add cc_autres to:
  1. get_gestionnaire_dashboard_kpis — new subquery for counter_charges 'autres'
  2. get_gestionnaire_revenue_by_bus — cc_agg + return type + totals
  3. get_gestionnaire_revenue_by_route — chg CTE + return type + totals
  4. get_gestionnaire_driver_report — chg CTE + return type + totals
  5. get_daf_consolidated_kpis — new subquery
  6. get_daf_kpis_by_company — cc_agg + return type + totals
  7. get_daf_revenue_by_bus — cc_agg + return type + totals
*/

-- ───────────────────────────────────────────────────────────────────
-- 1. get_gestionnaire_dashboard_kpis
-- ───────────────────────────────────────────────────────────────────
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

  WITH scr AS (
    SELECT * FROM schedule_company_revenue(p_date_from, p_date_to)
    WHERE company_id = v_company_id
  )
  SELECT jsonb_build_object(
    'total_revenue',           COALESCE(SUM(scr.revenue), 0),
    'trip_count',              COUNT(DISTINCT scr.schedule_id),
    'active_bus_count',        COUNT(DISTINCT scr.bus_id),
    'driver_count',            COUNT(DISTINCT scr.driver_id),
    'breakdown_received',      COALESCE(SUM(CASE WHEN scr.is_beneficiary THEN scr.revenue ELSE 0 END), 0),
    'breakdown_transferred',   COALESCE(SUM(CASE WHEN NOT scr.is_beneficiary THEN scr.transferred_amount ELSE 0 END), 0),
    'cc_carburant_complement', COALESCE((
      SELECT SUM(cc.amount) FROM counter_charges cc
      JOIN buses b2 ON b2.id = cc.bus_id
      WHERE b2.company_id = v_company_id
        AND cc.charge_type = 'carburant_complement'
        AND cc.charge_date BETWEEN p_date_from AND p_date_to
    ), 0),
    'cc_ration', COALESCE((
      SELECT SUM(cc.amount) FROM counter_charges cc
      JOIN buses b2 ON b2.id = cc.bus_id
      WHERE b2.company_id = v_company_id
        AND cc.charge_type = 'ration'
        AND cc.charge_date BETWEEN p_date_from AND p_date_to
    ), 0),
    'cc_peage', COALESCE((
      SELECT SUM(cc.amount) FROM counter_charges cc
      JOIN buses b2 ON b2.id = cc.bus_id
      WHERE b2.company_id = v_company_id
        AND cc.charge_type = 'peage'
        AND cc.charge_date BETWEEN p_date_from AND p_date_to
    ), 0),
    'cc_autres', COALESCE((
      SELECT SUM(cc.amount) FROM counter_charges cc
      JOIN buses b2 ON b2.id = cc.bus_id
      WHERE b2.company_id = v_company_id
        AND cc.charge_type = 'autres'
        AND cc.charge_date BETWEEN p_date_from AND p_date_to
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
        AND ve.validation_status = 'validee'
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
        AND ve.validation_status = 'validee'
    ), 0),
    'fuel_carburant_comptable', COALESCE((
      SELECT SUM(cfw.total_amount)
      FROM comptable_fuel_withdrawals cfw
      WHERE cfw.company_id = v_company_id
        AND cfw.withdrawal_date BETWEEN p_date_from AND p_date_to
    ), 0),
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
        AND ve.validation_status = 'validee'
    ), 0)
  )
  INTO v_result
  FROM scr;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

-- ───────────────────────────────────────────────────────────────────
-- 2. get_gestionnaire_revenue_by_bus
-- ───────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS get_gestionnaire_revenue_by_bus(date, date);

CREATE FUNCTION get_gestionnaire_revenue_by_bus(p_date_from date, p_date_to date)
RETURNS TABLE(
  bus_id uuid,
  registration_number text,
  model text,
  company_name text,
  trip_count bigint,
  total_passengers bigint,
  avg_fill_rate numeric,
  total_km numeric,
  revenue numeric,
  cc_carburant numeric,
  cc_ration numeric,
  cc_peage numeric,
  cc_autres numeric,
  fuel_enlev numeric,
  expense_reparation numeric,
  expense_autres numeric,
  vehicle_exp numeric,
  fuel_carburant_comptable numeric,
  total_expense numeric,
  margin numeric,
  breakdown_received numeric,
  breakdown_transferred numeric
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
  agg AS (
    SELECT
      scr.bus_id AS bus_id,
      COUNT(DISTINCT scr.schedule_id)::bigint AS trip_count,
      COALESCE(SUM(scr.revenue), 0) AS revenue,
      COALESCE(SUM(CASE WHEN scr.is_beneficiary THEN scr.revenue ELSE 0 END), 0) AS breakdown_received,
      COALESCE(SUM(CASE WHEN NOT scr.is_beneficiary THEN scr.transferred_amount ELSE 0 END), 0) AS breakdown_transferred
    FROM scr
    GROUP BY scr.bus_id
  ),
  cc_agg AS (
    SELECT scc.bus_id,
      COALESCE(SUM(scc.cc_carburant), 0) AS cc_carburant,
      COALESCE(SUM(scc.cc_ration), 0)    AS cc_ration,
      COALESCE(SUM(scc.cc_peage), 0)     AS cc_peage,
      COALESCE(SUM(scc.cc_autres), 0)    AS cc_autres
    FROM scc
    GROUP BY scc.bus_id
  ),
  sched_stats AS (
    SELECT s.bus_id,
      COALESCE(SUM(s.seats_reserved), 0)::bigint AS total_passengers,
      COALESCE(AVG(s.fill_rate), 0) AS avg_fill_rate,
      COALESCE(SUM(r.distance_km), 0) AS total_km
    FROM schedules s
    LEFT JOIN routes r ON r.id = s.route_id
    WHERE s.bus_id IN (SELECT a2.bus_id FROM agg a2)
      AND s.departure_datetime::date BETWEEN p_date_from AND p_date_to
    GROUP BY s.bus_id
  ),
  base AS (
    SELECT
      b.id AS bus_id, b.registration_number, b.model,
      co.name AS company_name,
      a.trip_count, a.revenue, a.breakdown_received, a.breakdown_transferred,
      COALESCE(ss.total_passengers, 0)::bigint AS total_passengers,
      COALESCE(ss.avg_fill_rate, 0) AS avg_fill_rate,
      COALESCE(ss.total_km, 0) AS total_km,
      COALESCE(cca.cc_carburant, 0) AS cc_carburant,
      COALESCE(cca.cc_ration, 0)    AS cc_ration,
      COALESCE(cca.cc_peage, 0)     AS cc_peage,
      COALESCE(cca.cc_autres, 0)    AS cc_autres,
      COALESCE((SELECT SUM(fe.total_amount) FROM fuel_enlevements fe
        WHERE fe.bus_id = b.id
        AND fe.enlevement_date BETWEEN p_date_from AND p_date_to), 0) AS fuel_enlev,
      COALESCE((
        SELECT SUM(ve.amount) FROM vehicle_expenses ve
        LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
        LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
        WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number
          AND ve.source = 'comptable'
          AND (ve.description IS NULL OR ve.description NOT LIKE 'Sortie stock — %')
          AND ve.expense_date BETWEEN p_date_from AND p_date_to
          AND ve.validation_status = 'validee'
      ), 0) AS expense_reparation,
      COALESCE((
        SELECT SUM(ve.amount) FROM vehicle_expenses ve
        LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
        LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
        WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number
          AND ve.source = 'comptable'
          AND ve.description LIKE 'Sortie stock — %'
          AND ve.expense_date BETWEEN p_date_from AND p_date_to
          AND ve.validation_status = 'validee'
      ), 0) AS expense_autres,
      COALESCE((
        SELECT SUM(ve.amount) FROM vehicle_expenses ve
        LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
        LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
        WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number
          AND ve.source = 'charge_achat'
          AND ve.expense_date BETWEEN p_date_from AND p_date_to
          AND ve.validation_status = 'validee'
      ), 0) AS vehicle_exp,
      COALESCE((SELECT SUM(cfw.total_amount) FROM comptable_fuel_withdrawals cfw
        WHERE cfw.bus_id = b.id
        AND cfw.withdrawal_date BETWEEN p_date_from AND p_date_to), 0) AS fuel_carburant_comptable
    FROM buses b
    JOIN agg a ON a.bus_id = b.id
    JOIN companies co ON co.id = b.company_id
    LEFT JOIN cc_agg cca ON cca.bus_id = b.id
    LEFT JOIN sched_stats ss ON ss.bus_id = b.id
    WHERE b.company_id = v_company_id
  )
  SELECT base.bus_id, base.registration_number, base.model,
    base.company_name,
    base.trip_count,
    base.total_passengers,
    base.avg_fill_rate,
    base.total_km,
    base.revenue,
    base.cc_carburant, base.cc_ration, base.cc_peage, base.cc_autres,
    base.fuel_enlev, base.expense_reparation, base.expense_autres,
    base.vehicle_exp, base.fuel_carburant_comptable,
    (base.cc_carburant + base.cc_ration + base.cc_peage + base.cc_autres
      + base.fuel_enlev + base.expense_reparation + base.expense_autres
      + base.vehicle_exp + base.fuel_carburant_comptable) AS total_expense,
    (base.revenue - base.cc_carburant - base.cc_ration - base.cc_peage - base.cc_autres
      - base.fuel_enlev - base.expense_reparation - base.expense_autres
      - base.vehicle_exp - base.fuel_carburant_comptable) AS margin,
    base.breakdown_received, base.breakdown_transferred
  FROM base;
END;
$$;

-- ───────────────────────────────────────────────────────────────────
-- 3. get_gestionnaire_revenue_by_route
-- ───────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS get_gestionnaire_revenue_by_route(date, date);

CREATE FUNCTION get_gestionnaire_revenue_by_route(p_date_from date, p_date_to date)
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
    rt.id AS route_id,
    COALESCE(rt.name, 'Ligne inconnue') AS route_name,
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
  JOIN routes rt ON rt.id = b.route_id
  LEFT JOIN chg c ON c.route_id = b.route_id
  ORDER BY b.revenue DESC;
END;
$$;

-- ───────────────────────────────────────────────────────────────────
-- 4. get_gestionnaire_driver_report
-- ───────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS get_gestionnaire_driver_report(date, date);

CREATE FUNCTION get_gestionnaire_driver_report(p_date_from date, p_date_to date)
RETURNS TABLE(
  driver_id uuid, first_name text, last_name text, employee_id text,
  bus_registration text, trip_count bigint, revenue numeric,
  cc_carburant numeric, cc_ration numeric, cc_peage numeric, cc_autres numeric,
  expense_total numeric, avg_rating numeric
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
    u.id AS driver_id, u.first_name, u.last_name, u.employee_id,
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
$$;

-- ───────────────────────────────────────────────────────────────────
-- 5. get_daf_consolidated_kpis
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_daf_consolidated_kpis(p_company_ids uuid[], p_date_from date, p_date_to date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT is_daf_user() THEN RETURN '{}'::jsonb; END IF;

  SELECT jsonb_build_object(
    'total_revenue', COALESCE(SUM(r.total_price), 0) + COALESCE((
      SELECT SUM(mb.unit_price * mb.seats_count)
      FROM mobile_bookings mb
      JOIN schedules s2 ON s2.id = mb.schedule_id
      JOIN buses b2 ON b2.id = s2.bus_id
      WHERE b2.company_id = ANY(p_company_ids)
        AND mb.status = 'confirmed'
        AND s2.departure_datetime::date BETWEEN p_date_from AND p_date_to
    ), 0),
    'trip_count',              COUNT(DISTINCT s.id),
    'active_bus_count',        COUNT(DISTINCT s.bus_id),
    'driver_count',            COUNT(DISTINCT s.driver_id),
    'cc_carburant_complement', COALESCE((
      SELECT SUM(cc.amount) FROM counter_charges cc
      JOIN buses b2 ON b2.id = cc.bus_id
      WHERE b2.company_id = ANY(p_company_ids)
        AND cc.charge_type = 'carburant_complement'
        AND cc.charge_date BETWEEN p_date_from AND p_date_to
    ), 0),
    'cc_ration', COALESCE((
      SELECT SUM(cc.amount) FROM counter_charges cc
      JOIN buses b2 ON b2.id = cc.bus_id
      WHERE b2.company_id = ANY(p_company_ids)
        AND cc.charge_type = 'ration'
        AND cc.charge_date BETWEEN p_date_from AND p_date_to
    ), 0),
    'cc_peage', COALESCE((
      SELECT SUM(cc.amount) FROM counter_charges cc
      JOIN buses b2 ON b2.id = cc.bus_id
      WHERE b2.company_id = ANY(p_company_ids)
        AND cc.charge_type = 'peage'
        AND cc.charge_date BETWEEN p_date_from AND p_date_to
    ), 0),
    'cc_autres', COALESCE((
      SELECT SUM(cc.amount) FROM counter_charges cc
      JOIN buses b2 ON b2.id = cc.bus_id
      WHERE b2.company_id = ANY(p_company_ids)
        AND cc.charge_type = 'autres'
        AND cc.charge_date BETWEEN p_date_from AND p_date_to
    ), 0),
    'fuel_enlevements_amount', COALESCE((
      SELECT SUM(fe.total_amount) FROM fuel_enlevements fe
      WHERE fe.company_id = ANY(p_company_ids)
        AND fe.enlevement_date BETWEEN p_date_from AND p_date_to
    ), 0),
    'expense_reparation', COALESCE((
      SELECT SUM(ve.amount)
      FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number
        AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.company_id, fv_r.company_id) = ANY(p_company_ids)
        AND ve.source = 'comptable'
        AND (ve.description IS NULL OR ve.description NOT LIKE 'Sortie stock — %')
        AND ve.expense_date BETWEEN p_date_from AND p_date_to
        AND ve.validation_status = 'validee'
    ), 0),
    'vehicle_expenses_amount', COALESCE((
      SELECT SUM(ve.amount)
      FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number
        AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.company_id, fv_r.company_id) = ANY(p_company_ids)
        AND ve.source = 'charge_achat'
        AND ve.expense_date BETWEEN p_date_from AND p_date_to
        AND ve.validation_status = 'validee'
    ), 0),
    'fuel_carburant_comptable', COALESCE((
      SELECT SUM(cfw.total_amount)
      FROM comptable_fuel_withdrawals cfw
      WHERE cfw.company_id = ANY(p_company_ids)
        AND cfw.withdrawal_date BETWEEN p_date_from AND p_date_to
    ), 0),
    'expense_autres', COALESCE((
      SELECT SUM(ve.amount)
      FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number
        AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.company_id, fv_r.company_id) = ANY(p_company_ids)
        AND ve.source = 'comptable'
        AND ve.description LIKE 'Sortie stock — %'
        AND ve.expense_date BETWEEN p_date_from AND p_date_to
        AND ve.validation_status = 'validee'
    ), 0),
    'expense_charge_stock', COALESCE((
      SELECT SUM(ve.amount)
      FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number
        AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.company_id, fv_r.company_id) = ANY(p_company_ids)
        AND ve.source = 'stock_gerant'
        AND ve.expense_date BETWEEN p_date_from AND p_date_to
        AND ve.validation_status = 'validee'
    ), 0)
  )
  INTO v_result
  FROM schedules s
  JOIN buses b ON b.id = s.bus_id
  JOIN reservations r ON r.schedule_id = s.id
  WHERE b.company_id = ANY(p_company_ids)
    AND s.departure_datetime::date BETWEEN p_date_from AND p_date_to
    AND r.status IN ('confirmee', 'utilisee');

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

-- ───────────────────────────────────────────────────────────────────
-- 6. get_daf_kpis_by_company
-- ───────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS get_daf_kpis_by_company(uuid[], date, date);

CREATE FUNCTION public.get_daf_kpis_by_company(
  p_company_ids uuid[],
  p_date_from   date,
  p_date_to     date
)
RETURNS TABLE(
  company_id               uuid,
  company_name             text,
  company_code             text,
  parent_id                uuid,
  is_group                 boolean,
  revenue                  numeric,
  cc_carburant             numeric,
  cc_ration                numeric,
  cc_peage                 numeric,
  cc_autres                numeric,
  fuel_enlev               numeric,
  expense_reparation       numeric,
  expense_autres           numeric,
  vehicle_exp              numeric,
  fuel_carburant_comptable numeric,
  total_expense            numeric,
  margin                   numeric,
  trip_count               bigint,
  bus_count                bigint,
  driver_count             bigint,
  breakdown_received       numeric,
  breakdown_transferred    numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_daf_user() THEN RETURN; END IF;

  RETURN QUERY
  WITH scr AS (
    SELECT * FROM schedule_company_revenue(p_date_from, p_date_to)
    WHERE company_id = ANY(p_company_ids)
  ),
  scc AS (
    SELECT * FROM schedule_company_charges(p_date_from, p_date_to)
    WHERE company_id = ANY(p_company_ids)
  ),
  agg AS (
    SELECT scr.company_id,
      COALESCE(SUM(scr.revenue), 0)            AS revenue,
      COUNT(DISTINCT scr.schedule_id)::bigint  AS trip_count,
      COUNT(DISTINCT scr.bus_id)::bigint       AS bus_count,
      COUNT(DISTINCT scr.driver_id)
        FILTER (WHERE scr.driver_id IS NOT NULL)::bigint AS driver_count,
      COALESCE(SUM(CASE WHEN scr.is_beneficiary THEN scr.revenue ELSE 0 END), 0) AS breakdown_received,
      COALESCE(SUM(CASE WHEN NOT scr.is_beneficiary THEN scr.transferred_amount ELSE 0 END), 0) AS breakdown_transferred
    FROM scr
    GROUP BY scr.company_id
  ),
  cc_agg AS (
    SELECT scc.company_id,
      COALESCE(SUM(scc.cc_carburant), 0) AS cc_carburant,
      COALESCE(SUM(scc.cc_ration), 0)    AS cc_ration,
      COALESCE(SUM(scc.cc_peage), 0)     AS cc_peage,
      COALESCE(SUM(scc.cc_autres), 0)    AS cc_autres
    FROM scc
    GROUP BY scc.company_id
  )
  SELECT
    co.id, co.name, co.code, co.parent_id, COALESCE(co.is_group, false),
    COALESCE(agg.revenue, 0) AS revenue,
    COALESCE(cca.cc_carburant, 0) AS cc_carburant,
    COALESCE(cca.cc_ration, 0)    AS cc_ration,
    COALESCE(cca.cc_peage, 0)     AS cc_peage,
    COALESCE(cca.cc_autres, 0)    AS cc_autres,
    COALESCE((
      SELECT SUM(fe.total_amount) FROM fuel_enlevements fe
      WHERE fe.company_id = co.id
        AND fe.enlevement_date BETWEEN p_date_from AND p_date_to
    ), 0) AS fuel_enlev,
    COALESCE((
      SELECT SUM(ve.amount) FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number
        AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.company_id, fv_r.company_id) = co.id
        AND ve.source = 'comptable'
        AND (ve.description IS NULL OR ve.description NOT LIKE 'Sortie stock — %')
        AND ve.expense_date BETWEEN p_date_from AND p_date_to
        AND ve.validation_status = 'validee'
    ), 0) AS expense_reparation,
    COALESCE((
      SELECT SUM(ve.amount) FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number
        AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.company_id, fv_r.company_id) = co.id
        AND ve.source = 'comptable'
        AND ve.description LIKE 'Sortie stock — %'
        AND ve.expense_date BETWEEN p_date_from AND p_date_to
        AND ve.validation_status = 'validee'
    ), 0) AS expense_autres,
    COALESCE((
      SELECT SUM(ve.amount) FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number
        AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.company_id, fv_r.company_id) = co.id
        AND ve.source = 'charge_achat'
        AND ve.expense_date BETWEEN p_date_from AND p_date_to
        AND ve.validation_status = 'validee'
    ), 0) AS vehicle_exp,
    COALESCE((
      SELECT SUM(cfw.total_amount)
      FROM comptable_fuel_withdrawals cfw
      WHERE cfw.company_id = co.id
        AND cfw.withdrawal_date BETWEEN p_date_from AND p_date_to
    ), 0) AS fuel_carburant_comptable,
    0::numeric AS total_expense,
    0::numeric AS margin,
    COALESCE(agg.trip_count, 0)::bigint,
    COALESCE(agg.bus_count, 0)::bigint,
    COALESCE(agg.driver_count, 0)::bigint,
    COALESCE(agg.breakdown_received, 0),
    COALESCE(agg.breakdown_transferred, 0)
  FROM companies co
  LEFT JOIN agg ON agg.company_id = co.id
  LEFT JOIN cc_agg cca ON cca.company_id = co.id
  WHERE co.id = ANY(p_company_ids)
    AND COALESCE(co.is_active, true) = true
  ORDER BY co.name;
END;
$$;

-- ───────────────────────────────────────────────────────────────────
-- 7. get_daf_revenue_by_bus
-- ───────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS get_daf_revenue_by_bus(uuid[], date, date);

CREATE FUNCTION public.get_daf_revenue_by_bus(p_company_ids uuid[], p_date_from date, p_date_to date)
RETURNS TABLE(
  bus_id uuid, registration_number text, model text,
  company_id uuid, company_name text,
  trip_count bigint, revenue numeric,
  cc_carburant numeric, cc_ration numeric, cc_peage numeric, cc_autres numeric,
  fuel_enlev numeric, expense_reparation numeric, expense_autres numeric,
  expense_charge_stock numeric, vehicle_exp numeric,
  fuel_carburant_comptable numeric, total_expense numeric, margin numeric,
  breakdown_received numeric, breakdown_transferred numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_daf_user() THEN RETURN; END IF;

  RETURN QUERY
  WITH scr AS (
    SELECT * FROM schedule_company_revenue(p_date_from, p_date_to)
    WHERE company_id = ANY(p_company_ids)
  ),
  scc AS (
    SELECT * FROM schedule_company_charges(p_date_from, p_date_to)
    WHERE company_id = ANY(p_company_ids)
  ),
  agg AS (
    SELECT scr.bus_id, scr.company_id,
      COUNT(DISTINCT scr.schedule_id)::bigint AS trip_count,
      COALESCE(SUM(scr.revenue), 0)           AS revenue,
      COALESCE(SUM(CASE WHEN scr.is_beneficiary THEN scr.revenue ELSE 0 END), 0)
                                              AS breakdown_received,
      COALESCE(SUM(CASE WHEN NOT scr.is_beneficiary THEN scr.transferred_amount ELSE 0 END), 0)
                                              AS breakdown_transferred
    FROM scr
    GROUP BY scr.bus_id, scr.company_id
  ),
  cc_agg AS (
    SELECT scc.bus_id, scc.company_id,
      COALESCE(SUM(scc.cc_carburant), 0) AS cc_carburant,
      COALESCE(SUM(scc.cc_ration), 0)    AS cc_ration,
      COALESCE(SUM(scc.cc_peage), 0)     AS cc_peage,
      COALESCE(SUM(scc.cc_autres), 0)    AS cc_autres
    FROM scc
    GROUP BY scc.bus_id, scc.company_id
  ),
  base AS (
    SELECT
      b.id AS bus_id, b.registration_number, b.model,
      a.company_id, co.name AS company_name,
      a.trip_count, a.revenue, a.breakdown_received, a.breakdown_transferred,
      COALESCE(cca.cc_carburant, 0) AS cc_carburant,
      COALESCE(cca.cc_ration, 0)    AS cc_ration,
      COALESCE(cca.cc_peage, 0)     AS cc_peage,
      COALESCE(cca.cc_autres, 0)    AS cc_autres,
      COALESCE((SELECT SUM(fe.total_amount) FROM fuel_enlevements fe WHERE fe.bus_id = b.id AND fe.enlevement_date BETWEEN p_date_from AND p_date_to), 0) AS fuel_enlev,
      COALESCE((
        SELECT SUM(ve.amount) FROM vehicle_expenses ve
        LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
        LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
        WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number
          AND ve.source = 'comptable'
          AND (ve.description IS NULL OR ve.description NOT LIKE 'Sortie stock — %')
          AND ve.expense_date BETWEEN p_date_from AND p_date_to
          AND ve.validation_status = 'validee'
      ), 0) AS expense_reparation,
      COALESCE((
        SELECT SUM(ve.amount) FROM vehicle_expenses ve
        LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
        LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
        WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number
          AND ve.source = 'comptable' AND ve.description LIKE 'Sortie stock — %'
          AND ve.expense_date BETWEEN p_date_from AND p_date_to
          AND ve.validation_status = 'validee'
      ), 0) AS expense_autres,
      COALESCE((
        SELECT SUM(ve.amount) FROM vehicle_expenses ve
        LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
        LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
        WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number
          AND ve.source = 'stock_gerant'
          AND ve.expense_date BETWEEN p_date_from AND p_date_to
          AND ve.validation_status = 'validee'
      ), 0) AS expense_charge_stock,
      COALESCE((
        SELECT SUM(ve.amount) FROM vehicle_expenses ve
        LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
        LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
        WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number
          AND ve.source = 'charge_achat'
          AND ve.expense_date BETWEEN p_date_from AND p_date_to
          AND ve.validation_status = 'validee'
      ), 0) AS vehicle_exp,
      COALESCE((SELECT SUM(cfw.total_amount) FROM comptable_fuel_withdrawals cfw WHERE cfw.bus_id = b.id AND cfw.withdrawal_date BETWEEN p_date_from AND p_date_to), 0) AS fuel_carburant_comptable
    FROM buses b
    JOIN agg a ON a.bus_id = b.id
    JOIN companies co ON co.id = a.company_id
    LEFT JOIN cc_agg cca ON cca.bus_id = b.id AND cca.company_id = a.company_id
  )
  SELECT base.bus_id, base.registration_number, base.model,
    base.company_id, base.company_name, base.trip_count, base.revenue,
    base.cc_carburant, base.cc_ration, base.cc_peage, base.cc_autres,
    base.fuel_enlev,
    base.expense_reparation, base.expense_autres, base.expense_charge_stock,
    base.vehicle_exp, base.fuel_carburant_comptable,
    (base.cc_carburant + base.cc_ration + base.cc_peage + base.cc_autres
      + base.fuel_enlev + base.expense_reparation + base.expense_autres
      + base.expense_charge_stock + base.vehicle_exp + base.fuel_carburant_comptable) AS total_expense,
    (base.revenue - base.cc_carburant - base.cc_ration - base.cc_peage - base.cc_autres
      - base.fuel_enlev - base.expense_reparation - base.expense_autres
      - base.expense_charge_stock - base.vehicle_exp - base.fuel_carburant_comptable) AS margin,
    base.breakdown_received, base.breakdown_transferred
  FROM base
  ORDER BY base.revenue DESC;
END;
$$;

-- Rechargement du cache PostgREST
NOTIFY pgrst, 'reload schema';