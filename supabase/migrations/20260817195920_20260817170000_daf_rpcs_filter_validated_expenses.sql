/*
# DAF RPCs: Filter vehicle_expenses by validation_status = 'validee'

## Overview
All DAF consolidated RPC functions were including pending (en_attente) vehicle
expenses in their calculations. This migration adds `AND ve.validation_status = 'validee'`
to every vehicle_expenses subquery in all 5 DAF functions, so only validated
expenses are counted in DAF reports, charges, margins, and the income statement.

## Functions modified
1. get_daf_consolidated_kpis — 5 vehicle_expenses subqueries
2. get_daf_kpis_by_company — 6 vehicle_expenses subqueries
3. get_daf_revenue_by_bus — 6 vehicle_expenses subqueries
4. get_daf_daily_series — 1 vehicle_expenses CTE
5. compute_income_statement — 1 vehicle_expenses query

## Rule
- Only expenses with validation_status = 'validee' are included in DAF calculations.
- Pending (en_attente) expenses are excluded from all DAF totals, charges, margins, and reports.
- Company filtering is preserved exactly as before.
- No changes to the validation workflow itself.
*/

-- ═══════════════════════════════════════════════════════════════════
-- 1. get_daf_consolidated_kpis
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_daf_consolidated_kpis(p_company_ids uuid[], p_date_from date, p_date_to date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
'expense_reparation', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = ANY(p_company_ids) AND ve.source = 'comptable' AND (ve.description IS NULL OR ve.description NOT LIKE 'Sortie stock — %') AND ve.expense_date BETWEEN p_date_from AND p_date_to AND ve.validation_status = 'validee'), 0),
'vehicle_expenses_amount', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = ANY(p_company_ids) AND ve.source = 'charge_achat' AND ve.expense_date BETWEEN p_date_from AND p_date_to AND ve.validation_status = 'validee'), 0),
'fuel_carburant_comptable', COALESCE((SELECT SUM(cfw.total_amount) FROM comptable_fuel_withdrawals cfw WHERE cfw.company_id = ANY(p_company_ids) AND cfw.withdrawal_date BETWEEN p_date_from AND p_date_to), 0),
'expense_autres', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = ANY(p_company_ids) AND ve.source = 'comptable' AND ve.description LIKE 'Sortie stock — %' AND ve.expense_date BETWEEN p_date_from AND p_date_to AND ve.validation_status = 'validee'), 0),
'expense_charge_stock', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = ANY(p_company_ids) AND ve.source = 'stock_gerant' AND ve.expense_date BETWEEN p_date_from AND p_date_to AND ve.validation_status = 'validee'), 0),
'expense_garage_pieces', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve WHERE ve.company_id = ANY(p_company_ids) AND ve.source = 'garage_pieces' AND ve.expense_date BETWEEN p_date_from AND p_date_to AND ve.validation_status = 'validee'), 0)
) INTO v_result
FROM schedules s
JOIN buses b ON b.id = s.bus_id
JOIN reservations r ON r.schedule_id = s.id
WHERE b.company_id = ANY(p_company_ids)
AND s.departure_datetime::date BETWEEN p_date_from AND p_date_to
AND r.status IN ('confirmee', 'utilisee');

RETURN COALESCE(v_result, '{}'::jsonb);
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════
-- 2. get_daf_kpis_by_company
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_daf_kpis_by_company(p_company_ids uuid[], p_date_from date, p_date_to date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_result jsonb;
BEGIN
IF NOT is_daf_user() THEN RETURN '[]'::jsonb; END IF;

WITH base AS (
SELECT
c.id,
c.name,
COALESCE(c.code, '') AS code,
c.parent_id,
COALESCE(c.is_group, false) AS is_group,
COALESCE(SUM(r.total_price), 0) AS revenue,
COUNT(DISTINCT s.id) AS trip_count,
COUNT(DISTINCT s.bus_id) AS bus_count,
COUNT(DISTINCT s.driver_id) AS driver_count
FROM companies c
LEFT JOIN schedules s ON s.bus_id IN (SELECT b2.id FROM buses b2 WHERE b2.company_id = c.id)
AND s.departure_datetime::date BETWEEN p_date_from AND p_date_to
LEFT JOIN reservations r ON r.schedule_id = s.id AND r.status IN ('confirmee', 'utilisee')
WHERE c.id = ANY(p_company_ids)
GROUP BY c.id, c.name, c.code, c.parent_id, c.is_group
)
SELECT COALESCE(jsonb_agg(jsonb_build_object(
'company_id', base.id,
'company_name', base.name,
'company_code', base.code,
'parent_id', base.parent_id,
'is_group', base.is_group,
'revenue', base.revenue,
'trip_count', base.trip_count,
'bus_count', base.bus_count,
'driver_count', base.driver_count,
'cc_carburant', COALESCE((SELECT SUM(cc.amount) FROM counter_charges cc JOIN buses b2 ON b2.id = cc.bus_id WHERE b2.company_id = base.id AND cc.charge_type = 'carburant_complement' AND cc.charge_date BETWEEN p_date_from AND p_date_to), 0),
'cc_ration', COALESCE((SELECT SUM(cc.amount) FROM counter_charges cc JOIN buses b2 ON b2.id = cc.bus_id WHERE b2.company_id = base.id AND cc.charge_type = 'ration' AND cc.charge_date BETWEEN p_date_from AND p_date_to), 0),
'cc_peage', COALESCE((SELECT SUM(cc.amount) FROM counter_charges cc JOIN buses b2 ON b2.id = cc.bus_id WHERE b2.company_id = base.id AND cc.charge_type = 'peage' AND cc.charge_date BETWEEN p_date_from AND p_date_to), 0),
'cc_autres', COALESCE((SELECT SUM(cc.amount) FROM counter_charges cc JOIN buses b2 ON b2.id = cc.bus_id WHERE b2.company_id = base.id AND cc.charge_type NOT IN ('ration','carburant_complement','peage') AND cc.charge_date BETWEEN p_date_from AND p_date_to), 0),
'fuel_enlev', COALESCE((SELECT SUM(fe.total_amount) FROM fuel_enlevements fe WHERE fe.company_id = base.id AND fe.enlevement_date BETWEEN p_date_from AND p_date_to), 0),
'expense_reparation', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = base.id AND ve.source = 'comptable' AND (ve.description IS NULL OR ve.description NOT LIKE 'Sortie stock — %') AND ve.expense_date BETWEEN p_date_from AND p_date_to AND ve.validation_status = 'validee'), 0),
'vehicle_exp', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = base.id AND ve.source = 'charge_achat' AND ve.expense_date BETWEEN p_date_from AND p_date_to AND ve.validation_status = 'validee'), 0),
'fuel_carburant_comptable', COALESCE((SELECT SUM(cfw.total_amount) FROM comptable_fuel_withdrawals cfw WHERE cfw.company_id = base.id AND cfw.withdrawal_date BETWEEN p_date_from AND p_date_to), 0),
'expense_autres', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = base.id AND ve.source = 'comptable' AND ve.description LIKE 'Sortie stock — %' AND ve.expense_date BETWEEN p_date_from AND p_date_to AND ve.validation_status = 'validee'), 0),
'expense_charge_stock', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = base.id AND ve.source = 'stock_gerant' AND ve.expense_date BETWEEN p_date_from AND p_date_to AND ve.validation_status = 'validee'), 0),
'expense_garage_pieces', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve WHERE ve.company_id = base.id AND ve.source = 'garage_pieces' AND ve.expense_date BETWEEN p_date_from AND p_date_to AND ve.validation_status = 'validee'), 0),
'breakdown_received', COALESCE((SELECT COUNT(*) FROM schedule_breakdowns sb JOIN schedules s2 ON s2.id = sb.schedule_id JOIN buses b2 ON b2.id = s2.bus_id WHERE b2.company_id = base.id AND sb.breakdown_at::date BETWEEN p_date_from AND p_date_to), 0),
'breakdown_transferred', COALESCE((SELECT COUNT(*) FROM schedule_breakdowns sb JOIN schedules s2 ON s2.id = sb.schedule_id JOIN buses b2 ON b2.id = s2.bus_id WHERE b2.company_id = base.id AND sb.beneficiary_company_id IS NOT NULL AND sb.beneficiary_company_id <> base.id AND sb.breakdown_at::date BETWEEN p_date_from AND p_date_to), 0)
) ORDER BY base.name), '[]'::jsonb) INTO v_result
FROM base;

RETURN v_result;
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════
-- 3. get_daf_revenue_by_bus
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_daf_revenue_by_bus(p_company_ids uuid[], p_date_from date, p_date_to date)
RETURNS TABLE(bus_id uuid, registration_number text, model text, company_name text, trip_count bigint, revenue numeric, cc_carburant numeric, cc_ration numeric, cc_peage numeric, fuel_enlev numeric, expense_reparation numeric, expense_autres numeric, expense_charge_stock numeric, expense_garage_pieces numeric, vehicle_exp numeric, fuel_carburant_comptable numeric, total_expense numeric, margin numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
IF NOT is_daf_user() THEN RETURN; END IF;

RETURN QUERY
WITH base AS (
SELECT b.id AS bus_id, b.registration_number, b.model, c.name AS company_name,
COUNT(DISTINCT s.id)::bigint AS trip_count, COALESCE(SUM(r.total_price), 0) AS revenue,
COALESCE((SELECT SUM(cc.amount) FROM counter_charges cc WHERE cc.bus_id = b.id AND cc.charge_type = 'carburant_complement' AND cc.charge_date BETWEEN p_date_from AND p_date_to), 0) AS cc_carburant,
COALESCE((SELECT SUM(cc.amount) FROM counter_charges cc WHERE cc.bus_id = b.id AND cc.charge_type = 'ration' AND cc.charge_date BETWEEN p_date_from AND p_date_to), 0) AS cc_ration,
COALESCE((SELECT SUM(cc.amount) FROM counter_charges cc WHERE cc.bus_id = b.id AND cc.charge_type = 'peage' AND cc.charge_date BETWEEN p_date_from AND p_date_to), 0) AS cc_peage,
COALESCE((SELECT SUM(fe.total_amount) FROM fuel_enlevements fe WHERE fe.bus_id = b.id AND fe.enlevement_date BETWEEN p_date_from AND p_date_to), 0) AS fuel_enlev,
COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number AND ve.source = 'comptable' AND (ve.description IS NULL OR ve.description NOT LIKE 'Sortie stock — %') AND ve.expense_date BETWEEN p_date_from AND p_date_to AND ve.validation_status = 'validee'), 0) AS expense_reparation,
COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number AND ve.source = 'comptable' AND ve.description LIKE 'Sortie stock — %' AND ve.expense_date BETWEEN p_date_from AND p_date_to AND ve.validation_status = 'validee'), 0) AS expense_autres,
COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number AND ve.source = 'stock_gerant' AND ve.expense_date BETWEEN p_date_from AND p_date_to AND ve.validation_status = 'validee'), 0) AS expense_charge_stock,
COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve WHERE ve.registration_number = b.registration_number AND ve.company_id = b.company_id AND ve.source = 'garage_pieces' AND ve.expense_date BETWEEN p_date_from AND p_date_to AND ve.validation_status = 'validee'), 0) AS expense_garage_pieces,
COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number AND ve.source = 'charge_achat' AND ve.expense_date BETWEEN p_date_from AND p_date_to AND ve.validation_status = 'validee'), 0) AS vehicle_exp,
COALESCE((SELECT SUM(cfw.total_amount) FROM comptable_fuel_withdrawals cfw WHERE cfw.bus_id = b.id AND cfw.withdrawal_date BETWEEN p_date_from AND p_date_to), 0) AS fuel_carburant_comptable
FROM buses b
JOIN companies c ON c.id = b.company_id
JOIN schedules s ON s.bus_id = b.id AND s.departure_datetime::date BETWEEN p_date_from AND p_date_to
LEFT JOIN reservations r ON r.schedule_id = s.id AND r.status IN ('confirmee', 'utilisee')
WHERE b.company_id = ANY(p_company_ids)
GROUP BY b.id, b.registration_number, b.model, c.name
)
SELECT base.bus_id, base.registration_number, base.model, base.company_name,
base.trip_count, base.revenue, base.cc_carburant, base.cc_ration, base.cc_peage,
base.fuel_enlev, base.expense_reparation, base.expense_autres, base.expense_charge_stock,
base.expense_garage_pieces, base.vehicle_exp, base.fuel_carburant_comptable,
(base.cc_carburant + base.cc_ration + base.cc_peage + base.fuel_enlev + base.expense_reparation + base.expense_autres + base.expense_charge_stock + base.expense_garage_pieces + base.vehicle_exp + base.fuel_carburant_comptable) AS total_expense,
(base.revenue - base.cc_carburant - base.cc_ration - base.cc_peage - base.fuel_enlev - base.expense_reparation - base.expense_autres - base.expense_charge_stock - base.expense_garage_pieces - base.vehicle_exp - base.fuel_carburant_comptable) AS margin
FROM base;
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════
-- 4. get_daf_daily_series
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_daf_daily_series(p_company_ids uuid[], p_date_from date, p_date_to date)
RETURNS TABLE(day date, revenue numeric, expenses numeric, trip_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
-- Vehicle expenses (comptable, charge_achat, stock_gerant, garage_pieces) — only validated
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
$function$;

-- ═══════════════════════════════════════════════════════════════════
-- 5. compute_income_statement — add validation filter to vehicle_expenses query
-- ═══════════════════════════════════════════════════════════════════
-- This function is large; we only need to add the filter to the one
-- vehicle_expenses subquery. We use a targeted approach: drop and recreate
-- the function with the filter added to that one query.

-- First, extract the current function body and add the filter
DO $do$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'compute_income_statement';

  -- The vehicle_expenses query has this WHERE clause:
  -- WHERE ve.company_id = p_company_id
  -- AND ve.expense_date BETWEEN v_start_date AND v_end_date
  -- AND (ve.source IS NULL OR ve.source != 'comptable_stock')
  -- We add: AND ve.validation_status = 'validee'
  v_old := 'AND (ve.source IS NULL OR ve.source != ''comptable_stock'')';
  v_new := 'AND (ve.source IS NULL OR ve.source != ''comptable_stock'') AND ve.validation_status = ''validee''';

  v_def := replace(v_def, v_old, v_new);

  EXECUTE v_def;
END;
$do$;
