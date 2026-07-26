-- Fix: the CTE WHERE clauses use bare "company_id" which conflicts with
-- PL/pgSQL output parameter variables. Alias the function calls.

CREATE OR REPLACE FUNCTION get_daf_kpis_by_company(p_company_ids uuid[], p_date_from date, p_date_to date)
RETURNS TABLE(
  company_id uuid, company_name text, company_code text, parent_id uuid, is_group boolean,
  revenue numeric, breakdown_received numeric, breakdown_transferred numeric,
  cc_carburant numeric, cc_ration numeric, cc_peage numeric, cc_autres numeric,
  fuel_enlev numeric, expense_reparation numeric, expense_autres numeric, expense_charge_stock numeric,
  vehicle_exp numeric, fuel_carburant_comptable numeric,
  total_expense numeric, margin numeric,
  trip_count bigint, bus_count bigint, driver_count bigint
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
IF NOT is_daf_user() THEN RETURN; END IF;

RETURN QUERY
WITH scr AS (
  SELECT scrr.* FROM schedule_company_revenue(p_date_from, p_date_to) scrr
  WHERE scrr.company_id = ANY(p_company_ids)
),
scc AS (
  SELECT sccc.* FROM schedule_company_charges(p_date_from, p_date_to) sccc
  WHERE sccc.company_id = ANY(p_company_ids)
),
rev_by_co AS (
  SELECT scr.company_id AS co_id,
    COALESCE(SUM(scr.revenue), 0) AS rev,
    COALESCE(SUM(scr.transferred_amount) FILTER (WHERE scr.is_beneficiary), 0) AS br_received,
    COALESCE(SUM(scr.transferred_amount) FILTER (WHERE NOT scr.is_beneficiary AND scr.breakdown_id IS NOT NULL), 0) AS br_transferred,
    COUNT(DISTINCT scr.schedule_id)::bigint AS t_cnt,
    COUNT(DISTINCT scr.bus_id)::bigint AS b_cnt,
    COUNT(DISTINCT scr.driver_id)::bigint AS d_cnt
  FROM scr GROUP BY scr.company_id
),
chg_by_co AS (
  SELECT scc.company_id AS co_id,
    COALESCE(SUM(scc.cc_carburant), 0) AS chg_carb,
    COALESCE(SUM(scc.cc_ration), 0)    AS chg_rat,
    COALESCE(SUM(scc.cc_peage), 0)     AS chg_peage,
    COALESCE(SUM(scc.cc_autres), 0)    AS chg_autres
  FROM scc GROUP BY scc.company_id
),
base AS (
  SELECT
    co.id AS b_company_id,
    co.name AS b_name,
    co.code AS b_code,
    co.parent_id AS b_parent,
    COALESCE(co.is_group, false) AS b_group,
    COALESCE(rvc.rev, 0) AS b_revenue,
    COALESCE(rvc.br_received, 0) AS b_br_recv,
    COALESCE(rvc.br_transferred, 0) AS b_br_trans,
    COALESCE(cgc.chg_carb, 0) AS b_cc_carb,
    COALESCE(cgc.chg_rat, 0)    AS b_cc_rat,
    COALESCE(cgc.chg_peage, 0)  AS b_cc_peage,
    COALESCE(cgc.chg_autres, 0) AS b_cc_autres,
    COALESCE((SELECT SUM(fe.total_amount) FROM fuel_enlevements fe
      WHERE fe.company_id = co.id AND fe.enlevement_date BETWEEN p_date_from AND p_date_to), 0) AS b_fuel_enlev,
    COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.company_id, fv_r.company_id) = co.id
      AND ve.source = 'comptable'
      AND (ve.description IS NULL OR ve.description NOT LIKE 'Sortie stock — %')
      AND ve.expense_date BETWEEN p_date_from AND p_date_to
      AND ve.validation_status = 'validee'), 0) AS b_exp_rep,
    COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.company_id, fv_r.company_id) = co.id
      AND ve.source = 'comptable'
      AND ve.description LIKE 'Sortie stock — %'
      AND ve.expense_date BETWEEN p_date_from AND p_date_to
      AND ve.validation_status = 'validee'), 0) AS b_exp_autres,
    COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.company_id, fv_r.company_id) = co.id
      AND ve.source = 'stock_gerant'
      AND ve.expense_date BETWEEN p_date_from AND p_date_to
      AND ve.validation_status = 'validee'), 0) AS b_exp_stock,
    COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.company_id, fv_r.company_id) = co.id
      AND ve.source = 'charge_achat'
      AND ve.expense_date BETWEEN p_date_from AND p_date_to
      AND ve.validation_status = 'validee'), 0) AS b_veh_exp,
    COALESCE((SELECT SUM(cfw.total_amount) FROM comptable_fuel_withdrawals cfw
      WHERE cfw.company_id = co.id AND cfw.withdrawal_date BETWEEN p_date_from AND p_date_to), 0) AS b_fuel_comp,
    COALESCE(rvc.t_cnt, 0)::bigint AS b_trip,
    COALESCE(rvc.b_cnt, 0)::bigint AS b_bus,
    COALESCE(rvc.d_cnt, 0)::bigint AS b_driver
  FROM companies co
  LEFT JOIN rev_by_co rvc ON rvc.co_id = co.id
  LEFT JOIN chg_by_co cgc ON cgc.co_id = co.id
  WHERE co.id = ANY(p_company_ids)
  AND COALESCE(co.is_active, true) = true
)
SELECT
  base.b_company_id, base.b_name, base.b_code, base.b_parent, base.b_group,
  base.b_revenue, base.b_br_recv, base.b_br_trans,
  base.b_cc_carb, base.b_cc_rat, base.b_cc_peage, base.b_cc_autres,
  base.b_fuel_enlev, base.b_exp_rep, base.b_exp_autres, base.b_exp_stock,
  base.b_veh_exp, base.b_fuel_comp,
  (base.b_cc_carb + base.b_cc_rat + base.b_cc_peage + base.b_cc_autres
   + base.b_fuel_enlev + base.b_exp_rep + base.b_exp_autres
   + base.b_exp_stock + base.b_veh_exp + base.b_fuel_comp),
  (base.b_revenue - base.b_cc_carb - base.b_cc_rat - base.b_cc_peage - base.b_cc_autres
   - base.b_fuel_enlev - base.b_exp_rep - base.b_exp_autres
   - base.b_exp_stock - base.b_veh_exp - base.b_fuel_comp),
  base.b_trip, base.b_bus, base.b_driver
FROM base
ORDER BY base.b_name;
END;
$$;


CREATE OR REPLACE FUNCTION get_daf_revenue_by_bus(p_company_ids uuid[], p_date_from date, p_date_to date)
RETURNS TABLE(
  bus_id uuid, registration_number text, model text, company_name text,
  trip_count bigint, revenue numeric,
  cc_carburant numeric, cc_ration numeric, cc_peage numeric, cc_autres numeric,
  fuel_enlev numeric, expense_reparation numeric, expense_autres numeric,
  expense_charge_stock numeric, vehicle_exp numeric, fuel_carburant_comptable numeric,
  total_expense numeric, margin numeric
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
IF NOT is_daf_user() THEN RETURN; END IF;

RETURN QUERY
WITH scr AS (
  SELECT scrr.* FROM schedule_company_revenue(p_date_from, p_date_to) scrr
  WHERE scrr.company_id = ANY(p_company_ids)
),
scc AS (
  SELECT sccc.* FROM schedule_company_charges(p_date_from, p_date_to) sccc
  WHERE sccc.company_id = ANY(p_company_ids)
),
rev_by_bus AS (
  SELECT scr.bus_id AS b_id,
    COALESCE(SUM(scr.revenue), 0) AS rev,
    COUNT(DISTINCT scr.schedule_id)::bigint AS t_cnt
  FROM scr GROUP BY scr.bus_id
),
chg_by_bus AS (
  SELECT scc.bus_id AS b_id,
    COALESCE(SUM(scc.cc_carburant), 0) AS chg_carb,
    COALESCE(SUM(scc.cc_ration), 0)    AS chg_rat,
    COALESCE(SUM(scc.cc_peage), 0)     AS chg_peage,
    COALESCE(SUM(scc.cc_autres), 0)    AS chg_autres
  FROM scc GROUP BY scc.bus_id
),
base AS (
  SELECT
    b.id AS b_bus_id,
    b.registration_number AS b_reg,
    b.model AS b_model,
    c.name AS b_co_name,
    COALESCE(rvb.t_cnt, 0)::bigint AS b_trip,
    COALESCE(rvb.rev, 0) AS b_revenue,
    COALESCE(cgb.chg_carb, 0) AS b_cc_carb,
    COALESCE(cgb.chg_rat, 0)    AS b_cc_rat,
    COALESCE(cgb.chg_peage, 0)  AS b_cc_peage,
    COALESCE(cgb.chg_autres, 0) AS b_cc_autres,
    COALESCE((SELECT SUM(fe.total_amount) FROM fuel_enlevements fe
      WHERE fe.bus_id = b.id AND fe.enlevement_date BETWEEN p_date_from AND p_date_to), 0) AS b_fuel_enlev,
    COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number
      AND ve.source = 'comptable'
      AND (ve.description IS NULL OR ve.description NOT LIKE 'Sortie stock — %')
      AND ve.expense_date BETWEEN p_date_from AND p_date_to
      AND ve.validation_status = 'validee'), 0) AS b_exp_rep,
    COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number
      AND ve.source = 'comptable'
      AND ve.description LIKE 'Sortie stock — %'
      AND ve.expense_date BETWEEN p_date_from AND p_date_to
      AND ve.validation_status = 'validee'), 0) AS b_exp_autres,
    COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number
      AND ve.source = 'stock_gerant'
      AND ve.expense_date BETWEEN p_date_from AND p_date_to
      AND ve.validation_status = 'validee'), 0) AS b_exp_stock,
    COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number
      AND ve.source = 'charge_achat'
      AND ve.expense_date BETWEEN p_date_from AND p_date_to
      AND ve.validation_status = 'validee'), 0) AS b_veh_exp,
    COALESCE((SELECT SUM(cfw.total_amount) FROM comptable_fuel_withdrawals cfw
      WHERE cfw.bus_id = b.id AND cfw.withdrawal_date BETWEEN p_date_from AND p_date_to), 0) AS b_fuel_comp
  FROM buses b
  JOIN companies c ON c.id = b.company_id
  LEFT JOIN rev_by_bus rvb ON rvb.b_id = b.id
  LEFT JOIN chg_by_bus cgb ON cgb.b_id = b.id
  WHERE b.company_id = ANY(p_company_ids)
  AND EXISTS (
    SELECT 1 FROM schedules s
    WHERE s.bus_id = b.id
    AND s.departure_datetime::date BETWEEN p_date_from AND p_date_to
  )
)
SELECT
  base.b_bus_id, base.b_reg, base.b_model, base.b_co_name,
  base.b_trip, base.b_revenue,
  base.b_cc_carb, base.b_cc_rat, base.b_cc_peage, base.b_cc_autres,
  base.b_fuel_enlev, base.b_exp_rep, base.b_exp_autres,
  base.b_exp_stock, base.b_veh_exp, base.b_fuel_comp,
  (base.b_cc_carb + base.b_cc_rat + base.b_cc_peage + base.b_cc_autres
   + base.b_fuel_enlev + base.b_exp_rep + base.b_exp_autres
   + base.b_exp_stock + base.b_veh_exp + base.b_fuel_comp),
  (base.b_revenue - base.b_cc_carb - base.b_cc_rat - base.b_cc_peage - base.b_cc_autres
   - base.b_fuel_enlev - base.b_exp_rep - base.b_exp_autres
   - base.b_exp_stock - base.b_veh_exp - base.b_fuel_comp)
FROM base;
END;
$$;


CREATE OR REPLACE FUNCTION get_daf_consolidated_kpis(p_company_ids uuid[], p_date_from date, p_date_to date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_result jsonb;
BEGIN
IF NOT is_daf_user() THEN RETURN '{}'::jsonb; END IF;

WITH scr AS (
  SELECT scrr.* FROM schedule_company_revenue(p_date_from, p_date_to) scrr
  WHERE scrr.company_id = ANY(p_company_ids)
)
SELECT jsonb_build_object(
  'total_revenue',           COALESCE(SUM(scr.revenue), 0),
  'trip_count',              COUNT(DISTINCT scr.schedule_id),
  'active_bus_count',        COUNT(DISTINCT scr.bus_id),
  'driver_count',            COUNT(DISTINCT scr.driver_id),
  'company_count',           COUNT(DISTINCT scr.company_id),
  'cc_carburant_complement', COALESCE((SELECT SUM(sccc.cc_carburant) FROM schedule_company_charges(p_date_from, p_date_to) sccc WHERE sccc.company_id = ANY(p_company_ids)), 0),
  'cc_ration',               COALESCE((SELECT SUM(sccc.cc_ration)     FROM schedule_company_charges(p_date_from, p_date_to) sccc WHERE sccc.company_id = ANY(p_company_ids)), 0),
  'cc_peage',                COALESCE((SELECT SUM(sccc.cc_peage)      FROM schedule_company_charges(p_date_from, p_date_to) sccc WHERE sccc.company_id = ANY(p_company_ids)), 0),
  'cc_autres',               COALESCE((SELECT SUM(sccc.cc_autres)     FROM schedule_company_charges(p_date_from, p_date_to) sccc WHERE sccc.company_id = ANY(p_company_ids)), 0),
  'fuel_enlevements_amount', COALESCE((
    SELECT SUM(fe.total_amount) FROM fuel_enlevements fe
    WHERE fe.company_id = ANY(p_company_ids)
    AND fe.enlevement_date BETWEEN p_date_from AND p_date_to
  ), 0),
  'expense_reparation', COALESCE((
    SELECT SUM(ve.amount)
    FROM vehicle_expenses ve
    LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
    LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
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
    LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
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
    LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
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
    LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
    WHERE COALESCE(fv_d.company_id, fv_r.company_id) = ANY(p_company_ids)
    AND ve.source = 'stock_gerant'
    AND ve.expense_date BETWEEN p_date_from AND p_date_to
    AND ve.validation_status = 'validee'
  ), 0)
)
INTO v_result
FROM scr;

RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;


CREATE OR REPLACE FUNCTION get_daf_daily_series(p_company_ids uuid[], p_date_from date, p_date_to date)
RETURNS TABLE(day date, revenue numeric, expenses numeric, trip_count bigint)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
IF NOT is_daf_user() THEN RETURN; END IF;

RETURN QUERY
WITH days AS (
  SELECT generate_series(p_date_from, p_date_to, '1 day'::interval)::date AS d
),
scr AS (
  SELECT scrr.* FROM schedule_company_revenue(p_date_from, p_date_to) scrr
  WHERE scrr.company_id = ANY(p_company_ids)
),
rev AS (
  SELECT scr.schedule_date AS d,
    SUM(scr.revenue) AS rev,
    COUNT(DISTINCT scr.schedule_id)::bigint AS cnt
  FROM scr GROUP BY scr.schedule_date
),
scc AS (
  SELECT sccc.* FROM schedule_company_charges(p_date_from, p_date_to) sccc
  WHERE sccc.company_id = ANY(p_company_ids)
),
exp AS (
  SELECT s.departure_datetime::date AS d, SUM(scc.cc_total) AS exp
  FROM scc
  JOIN schedules s ON s.id = scc.schedule_id
  GROUP BY s.departure_datetime::date
)
SELECT
  days.d,
  COALESCE(rev.rev, 0),
  COALESCE(exp.exp, 0),
  COALESCE(rev.cnt, 0)
FROM days
LEFT JOIN rev ON rev.d = days.d
LEFT JOIN exp ON exp.d = days.d
WHERE COALESCE(rev.rev, 0) > 0 OR COALESCE(exp.exp, 0) > 0
ORDER BY days.d;
END;
$$;

NOTIFY pgrst, 'reload schema';
