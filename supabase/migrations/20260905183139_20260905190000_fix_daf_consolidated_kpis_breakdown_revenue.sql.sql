-- Fix get_daf_consolidated_kpis to use schedule_company_revenue() so breakdown
-- revenue splits are reflected (origin company sees gross minus transfer,
-- beneficiary company sees the transferred amount).
-- Previously it computed revenue directly from reservations, ignoring breakdowns.

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
    'total_revenue', COALESCE((
      SELECT SUM(scr.revenue) FROM schedule_company_revenue(p_date_from, p_date_to) scr
      WHERE scr.company_id = ANY(p_company_ids)
    ), 0),
    'trip_count', COALESCE((
      SELECT COUNT(DISTINCT scr.schedule_id) FROM schedule_company_revenue(p_date_from, p_date_to) scr
      WHERE scr.company_id = ANY(p_company_ids) AND NOT scr.is_beneficiary
    ), 0),
    'active_bus_count', COALESCE((
      SELECT COUNT(DISTINCT scr.bus_id) FROM schedule_company_revenue(p_date_from, p_date_to) scr
      WHERE scr.company_id = ANY(p_company_ids)
    ), 0),
    'driver_count', COALESCE((
      SELECT COUNT(DISTINCT scr.driver_id) FROM schedule_company_revenue(p_date_from, p_date_to) scr
      WHERE scr.company_id = ANY(p_company_ids) AND scr.driver_id IS NOT NULL
    ), 0),
    'company_count', COALESCE((
      SELECT COUNT(DISTINCT scr.company_id) FROM schedule_company_revenue(p_date_from, p_date_to) scr
      WHERE scr.company_id = ANY(p_company_ids)
    ), 0),
    'breakdown_received', COALESCE((
      SELECT SUM(scr.revenue) FROM schedule_company_revenue(p_date_from, p_date_to) scr
      WHERE scr.company_id = ANY(p_company_ids) AND scr.is_beneficiary
    ), 0),
    'breakdown_transferred', COALESCE((
      SELECT SUM(scr.transferred_amount) FROM schedule_company_revenue(p_date_from, p_date_to) scr
      WHERE scr.company_id = ANY(p_company_ids) AND NOT scr.is_beneficiary AND scr.breakdown_id IS NOT NULL
    ), 0),
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
    ), 0),
    'expense_garage_pieces', COALESCE((
      SELECT SUM(ve.amount)
      FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number
        AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.company_id, fv_r.company_id) = ANY(p_company_ids)
        AND ve.source = 'garage_pieces'
        AND ve.expense_date BETWEEN p_date_from AND p_date_to
        AND ve.validation_status = 'validee'
    ), 0)
  )
  INTO v_result;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_daf_consolidated_kpis(uuid[], date, date) TO authenticated;


-- Fix get_daf_daily_series to use schedule_company_revenue() for breakdown-aware daily revenue
CREATE OR REPLACE FUNCTION public.get_daf_daily_series(p_company_ids uuid[], p_date_from date, p_date_to date)
RETURNS TABLE(day date, revenue numeric, expenses numeric, trip_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_daf_user() THEN RETURN; END IF;

  RETURN QUERY
  WITH days AS (
    SELECT generate_series(p_date_from, p_date_to, '1 day'::interval)::date AS d
  ),
  rev AS (
    SELECT scr.schedule_date AS d,
      COALESCE(SUM(scr.revenue), 0) AS rev,
      COUNT(DISTINCT scr.schedule_id)::bigint AS cnt
    FROM schedule_company_revenue(p_date_from, p_date_to) scr
    WHERE scr.company_id = ANY(p_company_ids)
      AND NOT scr.is_beneficiary
    GROUP BY scr.schedule_date
  ),
  scc AS (
    SELECT scc2.* FROM schedule_company_charges(p_date_from, p_date_to) scc2
    WHERE scc2.company_id = ANY(p_company_ids)
  ),
  exp_guichet AS (
    SELECT s.departure_datetime::date AS d, COALESCE(SUM(scc.cc_total), 0) AS exp
    FROM scc
    JOIN schedules s ON s.id = scc.schedule_id
    GROUP BY s.departure_datetime::date
  ),
  exp_fuel AS (
    SELECT fe.enlevement_date AS d, COALESCE(SUM(fe.total_amount), 0) AS exp
    FROM fuel_enlevements fe
    WHERE fe.company_id = ANY(p_company_ids)
      AND fe.enlevement_date BETWEEN p_date_from AND p_date_to
    GROUP BY fe.enlevement_date
  ),
  exp_vehicle AS (
    SELECT ve.expense_date AS d, COALESCE(SUM(ve.amount), 0) AS exp
    FROM vehicle_expenses ve
    LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
    LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
    WHERE COALESCE(fv_d.company_id, fv_r.company_id, ve.company_id) = ANY(p_company_ids)
      AND ve.expense_date BETWEEN p_date_from AND p_date_to
      AND ve.validation_status = 'validee'
    GROUP BY ve.expense_date
  ),
  exp_cfw AS (
    SELECT cfw.withdrawal_date AS d, COALESCE(SUM(cfw.total_amount), 0) AS exp
    FROM comptable_fuel_withdrawals cfw
    WHERE cfw.company_id = ANY(p_company_ids)
      AND cfw.withdrawal_date BETWEEN p_date_from AND p_date_to
    GROUP BY cfw.withdrawal_date
  )
  SELECT
    days.d,
    COALESCE(rev.rev, 0),
    COALESCE(exp_guichet.exp, 0) + COALESCE(exp_fuel.exp, 0)
      + COALESCE(exp_vehicle.exp, 0) + COALESCE(exp_cfw.exp, 0),
    COALESCE(rev.cnt, 0)
  FROM days
  LEFT JOIN rev ON rev.d = days.d
  LEFT JOIN exp_guichet ON exp_guichet.d = days.d
  LEFT JOIN exp_fuel ON exp_fuel.d = days.d
  LEFT JOIN exp_vehicle ON exp_vehicle.d = days.d
  LEFT JOIN exp_cfw ON exp_cfw.d = days.d
  WHERE COALESCE(rev.rev, 0) > 0
    OR COALESCE(exp_guichet.exp, 0) > 0
    OR COALESCE(exp_fuel.exp, 0) > 0
    OR COALESCE(exp_vehicle.exp, 0) > 0
    OR COALESCE(exp_cfw.exp, 0) > 0
  ORDER BY days.d;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_daf_daily_series(uuid[], date, date) TO authenticated;
