/*
# Fix DAF consolidated reports — field name mismatch + missing data

## Problem
The `get_daf_kpis_by_company` RPC returns JSON field names that don't match
what the frontend expects:
  - RPC returns `total_revenue` but frontend reads `revenue`
  - RPC returns `cc_carburant_complement` but frontend reads `cc_carburant`
  - RPC returns `active_bus_count` but frontend reads `bus_count`
  - RPC is missing: `company_code`, `parent_id`, `is_group`, `cc_autres`,
    `breakdown_received`, `breakdown_transferred`, `driver_count`

This causes all amounts to show as 0 F CFA in both:
  - DAF → Rapport financier consolidé (FinancialReport.tsx)
  - DAF → Rapport d'Exploitation Consolidé (ConsolidatedReport.tsx)

Additionally, `get_daf_daily_series` only counts guichet charges via
`schedule_company_charges`, missing fuel, reparations, garage pieces,
and other vehicle expenses — so the "Evolution Recettes / Charges" chart
underestimates charges.

`get_daf_consolidated_kpis` is also missing `cc_autres` and `company_count`.

## Fix
1. Rewrite `get_daf_kpis_by_company` to return all fields the frontend
   expects with correct names, including breakdown counts and driver count.
2. Rewrite `get_daf_daily_series` to include ALL expense types per day
   (guichet charges + fuel enlevements + vehicle expenses + fuel withdrawals).
3. Add `cc_autres` and `company_count` to `get_daf_consolidated_kpis`.

No changes to calculation rules — only field names and coverage.
*/

-- ═══════════════════════════════════════════════════════════════════
-- 1. Fix get_daf_kpis_by_company — correct field names + missing fields
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_daf_kpis_by_company(
  p_company_ids uuid[], p_date_from date, p_date_to date
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT is_daf_user() THEN RETURN '[]'::jsonb; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'company_id', c.id,
    'company_name', c.name,
    'company_code', COALESCE(c.code, ''),
    'parent_id', c.parent_id,
    'is_group', COALESCE(c.is_group, false),
    'revenue', COALESCE(SUM(r.total_price), 0),
    'trip_count', COUNT(DISTINCT s.id),
    'bus_count', COUNT(DISTINCT s.bus_id),
    'driver_count', COUNT(DISTINCT s.driver_id),
    'cc_carburant', COALESCE((SELECT SUM(cc.amount) FROM counter_charges cc JOIN buses b2 ON b2.id = cc.bus_id WHERE b2.company_id = c.id AND cc.charge_type = 'carburant_complement' AND cc.charge_date BETWEEN p_date_from AND p_date_to), 0),
    'cc_ration', COALESCE((SELECT SUM(cc.amount) FROM counter_charges cc JOIN buses b2 ON b2.id = cc.bus_id WHERE b2.company_id = c.id AND cc.charge_type = 'ration' AND cc.charge_date BETWEEN p_date_from AND p_date_to), 0),
    'cc_peage', COALESCE((SELECT SUM(cc.amount) FROM counter_charges cc JOIN buses b2 ON b2.id = cc.bus_id WHERE b2.company_id = c.id AND cc.charge_type = 'peage' AND cc.charge_date BETWEEN p_date_from AND p_date_to), 0),
    'cc_autres', COALESCE((SELECT SUM(cc.amount) FROM counter_charges cc JOIN buses b2 ON b2.id = cc.bus_id WHERE b2.company_id = c.id AND cc.charge_type NOT IN ('ration','carburant_complement','peage') AND cc.charge_date BETWEEN p_date_from AND p_date_to), 0),
    'fuel_enlev', COALESCE((SELECT SUM(fe.total_amount) FROM fuel_enlevements fe WHERE fe.company_id = c.id AND fe.enlevement_date BETWEEN p_date_from AND p_date_to), 0),
    'expense_reparation', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = c.id AND ve.source = 'comptable' AND (ve.description IS NULL OR ve.description NOT LIKE 'Sortie stock — %') AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0),
    'vehicle_exp', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = c.id AND ve.source = 'charge_achat' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0),
    'fuel_carburant_comptable', COALESCE((SELECT SUM(cfw.total_amount) FROM comptable_fuel_withdrawals cfw WHERE cfw.company_id = c.id AND cfw.withdrawal_date BETWEEN p_date_from AND p_date_to), 0),
    'expense_autres', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = c.id AND ve.source = 'comptable' AND ve.description LIKE 'Sortie stock — %' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0),
    'expense_charge_stock', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = c.id AND ve.source = 'stock_gerant' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0),
    'expense_garage_pieces', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve WHERE ve.company_id = c.id AND ve.source = 'garage_pieces' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0),
    'breakdown_received', COALESCE((SELECT COUNT(*) FROM schedule_breakdowns sb JOIN schedules s2 ON s2.id = sb.schedule_id JOIN buses b2 ON b2.id = s2.bus_id WHERE b2.company_id = c.id AND sb.breakdown_at::date BETWEEN p_date_from AND p_date_to), 0),
    'breakdown_transferred', COALESCE((SELECT COUNT(*) FROM schedule_breakdowns sb JOIN schedules s2 ON s2.id = sb.schedule_id JOIN buses b2 ON b2.id = s2.bus_id WHERE b2.company_id = c.id AND sb.beneficiary_company_id IS NOT NULL AND sb.beneficiary_company_id <> c.id AND sb.breakdown_at::date BETWEEN p_date_from AND p_date_to), 0)
  ) ORDER BY c.name), '[]'::jsonb) INTO v_result
  FROM companies c
  LEFT JOIN schedules s ON s.bus_id IN (SELECT b2.id FROM buses b2 WHERE b2.company_id = c.id) AND s.departure_datetime::date BETWEEN p_date_from AND p_date_to
  LEFT JOIN reservations r ON r.schedule_id = s.id AND r.status IN ('confirmee', 'utilisee')
  WHERE c.id = ANY(p_company_ids)
  GROUP BY c.id, c.name, c.code, c.parent_id, c.is_group;

  RETURN v_result;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- 2. Fix get_daf_daily_series — include ALL expense types per day
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_daf_daily_series(
  p_company_ids uuid[], p_date_from date, p_date_to date
) RETURNS TABLE(day date, revenue numeric, expenses numeric, trip_count bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_daf_user() THEN RETURN; END IF;

  RETURN QUERY
  WITH days AS (
    SELECT generate_series(p_date_from, p_date_to, '1 day'::interval)::date AS d
  ),
  -- Revenue from schedules
  rev AS (
    SELECT s.departure_datetime::date AS d,
      COALESCE(SUM(r.total_price), 0) AS rev,
      COUNT(DISTINCT s.id)::bigint AS cnt
    FROM schedules s
    JOIN buses b ON b.id = s.bus_id
    LEFT JOIN reservations r ON r.schedule_id = s.id AND r.status IN ('confirmee', 'utilisee')
    WHERE b.company_id = ANY(p_company_ids)
      AND s.departure_datetime::date BETWEEN p_date_from AND p_date_to
    GROUP BY s.departure_datetime::date
  ),
  -- Guichet charges (counter_charges + convoy) via schedule_company_charges
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
  -- Fuel enlevements
  exp_fuel AS (
    SELECT fe.enlevement_date AS d, COALESCE(SUM(fe.total_amount), 0) AS exp
    FROM fuel_enlevements fe
    WHERE fe.company_id = ANY(p_company_ids)
      AND fe.enlevement_date BETWEEN p_date_from AND p_date_to
    GROUP BY fe.enlevement_date
  ),
  -- Vehicle expenses (comptable, charge_achat, stock_gerant, garage_pieces)
  exp_vehicle AS (
    SELECT ve.expense_date AS d, COALESCE(SUM(ve.amount), 0) AS exp
    FROM vehicle_expenses ve
    LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
    LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
    WHERE COALESCE(fv_d.company_id, fv_r.company_id, ve.company_id) = ANY(p_company_ids)
      AND ve.expense_date BETWEEN p_date_from AND p_date_to
    GROUP BY ve.expense_date
  ),
  -- Comptable fuel withdrawals
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

-- ═══════════════════════════════════════════════════════════════════
-- 3. Fix get_daf_consolidated_kpis — add cc_autres and company_count
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_daf_consolidated_kpis(
  p_company_ids uuid[], p_date_from date, p_date_to date
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT is_daf_user() THEN RETURN '{}'::jsonb; END IF;

  SELECT jsonb_build_object(
    'total_revenue', COALESCE(SUM(r.total_price), 0),
    'trip_count', COUNT(DISTINCT s.id),
    'active_bus_count', COUNT(DISTINCT s.bus_id),
    'driver_count', COUNT(DISTINCT s.driver_id),
    'company_count', COUNT(DISTINCT b.company_id),
    'cc_carburant_complement', COALESCE((SELECT SUM(cc.amount) FROM counter_charges cc JOIN buses b2 ON b2.id = cc.bus_id WHERE b2.company_id = ANY(p_company_ids) AND cc.charge_type = 'carburant_complement' AND cc.charge_date BETWEEN p_date_from AND p_date_to), 0),
    'cc_ration', COALESCE((SELECT SUM(cc.amount) FROM counter_charges cc JOIN buses b2 ON b2.id = cc.bus_id WHERE b2.company_id = ANY(p_company_ids) AND cc.charge_type = 'ration' AND cc.charge_date BETWEEN p_date_from AND p_date_to), 0),
    'cc_peage', COALESCE((SELECT SUM(cc.amount) FROM counter_charges cc JOIN buses b2 ON b2.id = cc.bus_id WHERE b2.company_id = ANY(p_company_ids) AND cc.charge_type = 'peage' AND cc.charge_date BETWEEN p_date_from AND p_date_to), 0),
    'cc_autres', COALESCE((SELECT SUM(cc.amount) FROM counter_charges cc JOIN buses b2 ON b2.id = cc.bus_id WHERE b2.company_id = ANY(p_company_ids) AND cc.charge_type NOT IN ('ration','carburant_complement','peage') AND cc.charge_date BETWEEN p_date_from AND p_date_to), 0),
    'fuel_enlevements_amount', COALESCE((SELECT SUM(fe.total_amount) FROM fuel_enlevements fe WHERE fe.company_id = ANY(p_company_ids) AND fe.enlevement_date BETWEEN p_date_from AND p_date_to), 0),
    'expense_reparation', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = ANY(p_company_ids) AND ve.source = 'comptable' AND (ve.description IS NULL OR ve.description NOT LIKE 'Sortie stock — %') AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0),
    'vehicle_expenses_amount', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = ANY(p_company_ids) AND ve.source = 'charge_achat' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0),
    'fuel_carburant_comptable', COALESCE((SELECT SUM(cfw.total_amount) FROM comptable_fuel_withdrawals cfw WHERE cfw.company_id = ANY(p_company_ids) AND cfw.withdrawal_date BETWEEN p_date_from AND p_date_to), 0),
    'expense_autres', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = ANY(p_company_ids) AND ve.source = 'comptable' AND ve.description LIKE 'Sortie stock — %' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0),
    'expense_charge_stock', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = ANY(p_company_ids) AND ve.source = 'stock_gerant' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0),
    'expense_garage_pieces', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve WHERE ve.company_id = ANY(p_company_ids) AND ve.source = 'garage_pieces' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0)
  ) INTO v_result
  FROM schedules s
  JOIN buses b ON b.id = s.bus_id
  JOIN reservations r ON r.schedule_id = s.id
  WHERE b.company_id = ANY(p_company_ids)
    AND s.departure_datetime::date BETWEEN p_date_from AND p_date_to
    AND r.status IN ('confirmee', 'utilisee');

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

NOTIFY pgrst, 'reload schema';
