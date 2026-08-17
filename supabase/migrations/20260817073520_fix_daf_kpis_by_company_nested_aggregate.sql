/*
# Fix get_daf_kpis_by_company — nested aggregate error

## Problem
The function uses jsonb_agg(jsonb_build_object('revenue', SUM(...), ...)) which nests
aggregate functions (SUM/COUNT inside jsonb_agg), causing PostgreSQL error 42803.

## Fix
Restructure using a CTE: first compute per-company aggregates in `base` CTE,
then build the JSON array from the pre-aggregated CTE results.

## Functions Modified
- `get_daf_kpis_by_company(uuid[], date, date)` — returns jsonb

## Important Notes
1. All field names match what the frontend expects: revenue, trip_count, bus_count,
   driver_count, cc_carburant, cc_ration, cc_peage, cc_autres, fuel_enlev,
   expense_reparation, expense_autres, expense_charge_stock, expense_garage_pieces,
   vehicle_exp, fuel_carburant_comptable, breakdown_received, breakdown_transferred.
2. The is_daf_user() guard is preserved.
3. All correlated subqueries for counter_charges, fuel_enlevements, vehicle_expenses,
   comptable_fuel_withdrawals, and schedule_breakdowns are preserved unchanged.
4. No calculation rules are changed — only the query structure to avoid nested aggregates.
*/

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
  'expense_reparation', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = base.id AND ve.source = 'comptable' AND (ve.description IS NULL OR ve.description NOT LIKE 'Sortie stock — %') AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0),
  'vehicle_exp', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = base.id AND ve.source = 'charge_achat' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0),
  'fuel_carburant_comptable', COALESCE((SELECT SUM(cfw.total_amount) FROM comptable_fuel_withdrawals cfw WHERE cfw.company_id = base.id AND cfw.withdrawal_date BETWEEN p_date_from AND p_date_to), 0),
  'expense_autres', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = base.id AND ve.source = 'comptable' AND ve.description LIKE 'Sortie stock — %' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0),
  'expense_charge_stock', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = base.id AND ve.source = 'stock_gerant' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0),
  'expense_garage_pieces', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve WHERE ve.company_id = base.id AND ve.source = 'garage_pieces' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0),
  'breakdown_received', COALESCE((SELECT COUNT(*) FROM schedule_breakdowns sb JOIN schedules s2 ON s2.id = sb.schedule_id JOIN buses b2 ON b2.id = s2.bus_id WHERE b2.company_id = base.id AND sb.breakdown_at::date BETWEEN p_date_from AND p_date_to), 0),
  'breakdown_transferred', COALESCE((SELECT COUNT(*) FROM schedule_breakdowns sb JOIN schedules s2 ON s2.id = sb.schedule_id JOIN buses b2 ON b2.id = s2.bus_id WHERE b2.company_id = base.id AND sb.beneficiary_company_id IS NOT NULL AND sb.beneficiary_company_id <> base.id AND sb.breakdown_at::date BETWEEN p_date_from AND p_date_to), 0)
) ORDER BY base.name), '[]'::jsonb) INTO v_result
FROM base;

RETURN v_result;
END;
$function$;
