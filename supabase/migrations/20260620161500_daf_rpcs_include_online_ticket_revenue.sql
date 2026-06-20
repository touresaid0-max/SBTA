-- Add confirmed online (mobile_bookings) ticket revenue (unit_price * seats_count)
-- into DAF revenue sources so DAF dashboards count online reservations.

-- 1) schedule_company_revenue() feeds get_daf_kpis_by_company and get_daf_daily_series
CREATE OR REPLACE FUNCTION public.schedule_company_revenue(p_from date, p_to date)
 RETURNS TABLE(schedule_id uuid, schedule_date date, bus_id uuid, driver_id uuid, route_id uuid, station_id uuid, company_id uuid, revenue numeric, gross_revenue numeric, transferred_amount numeric, is_beneficiary boolean, breakdown_id uuid, breakdown_status text, split_reason text, replacement_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH gross AS (
SELECT
s.id                          AS sid,
s.departure_datetime::date    AS sdate,
s.bus_id                      AS g_bus_id,
s.driver_id                   AS g_driver_id,
s.route_id                    AS g_route_id,
s.departure_station_id        AS g_station_id,
CASE WHEN s.status = 'convoi'
THEN COALESCE(cv.amount, 0)
ELSE COALESCE(SUM(r.total_price), 0)
END
+ COALESCE(ram.ramassage_total, 0)
+ COALESCE(mob.mob_total, 0)         AS gross_rev
FROM schedules s
LEFT JOIN reservations r
ON r.schedule_id = s.id
AND r.status IN ('confirmee','utilisee')
LEFT JOIN convoys cv
ON cv.schedule_id = s.id
LEFT JOIN (
SELECT schedule_id, SUM(amount) AS ramassage_total
FROM ramassage_collections
GROUP BY schedule_id
) ram ON ram.schedule_id = s.id
LEFT JOIN (
SELECT schedule_id, SUM(unit_price * seats_count) AS mob_total
FROM mobile_bookings
WHERE status = 'confirmed'
GROUP BY schedule_id
) mob ON mob.schedule_id = s.id
WHERE s.departure_datetime::date BETWEEN p_from AND p_to
GROUP BY s.id, s.departure_datetime, s.bus_id, s.driver_id,
s.route_id, s.departure_station_id, s.status, cv.amount, ram.ramassage_total, mob.mob_total
),
br AS (
SELECT DISTINCT ON (sb.schedule_id)
sb.schedule_id,
sb.id                                  AS bid,
sb.status                              AS b_status,
sb.original_company_id,
sb.beneficiary_company_id,
sb.original_bus_id,
sb.replacement_bus_id,
sb.original_driver_id,
sb.replacement_driver_id,
sb.station_id                          AS b_station_id,
sb.route_id                            AS b_route_id,
COALESCE(sb.amount_replacement_company, 0) AS amt_benef,
COALESCE(sb.amount_original_company, 0)    AS amt_orig,
sb.split_reason,
sb.replacement_at
FROM schedule_breakdowns sb
ORDER BY sb.schedule_id, sb.breakdown_at DESC
)
-- Origin row
SELECT
g.sid,
g.sdate,
COALESCE(br.original_bus_id,    g.g_bus_id)     AS bus_id,
COALESCE(br.original_driver_id, g.g_driver_id)  AS driver_id,
COALESCE(br.b_route_id,         g.g_route_id)   AS route_id,
COALESCE(br.b_station_id,       g.g_station_id) AS station_id,
COALESCE(br.original_company_id, b.company_id)  AS company_id,
CASE
WHEN br.b_status = 'cloture'
AND br.beneficiary_company_id IS NOT NULL
AND br.beneficiary_company_id <> br.original_company_id
AND br.amt_benef > 0
THEN g.gross_rev - br.amt_benef
ELSE g.gross_rev
END                                             AS revenue,
g.gross_rev                                     AS gross_revenue,
CASE
WHEN br.b_status = 'cloture'
AND br.beneficiary_company_id IS NOT NULL
AND br.beneficiary_company_id <> br.original_company_id
AND br.amt_benef > 0
THEN br.amt_benef
ELSE 0
END                                             AS transferred_amount,
false                                           AS is_beneficiary,
br.bid                                          AS breakdown_id,
br.b_status                                     AS breakdown_status,
br.split_reason                                 AS split_reason,
br.replacement_at                               AS replacement_at
FROM gross g
LEFT JOIN buses b ON b.id = g.g_bus_id
LEFT JOIN br    ON br.schedule_id = g.sid

UNION ALL

-- Beneficiary row (only for inter-company splits)
SELECT
g.sid,
g.sdate,
COALESCE(br.replacement_bus_id, g.g_bus_id)      AS bus_id,
COALESCE(br.replacement_driver_id, g.g_driver_id) AS driver_id,
COALESCE(br.b_route_id, g.g_route_id)            AS route_id,
COALESCE(br.b_station_id, g.g_station_id)        AS station_id,
br.beneficiary_company_id                         AS company_id,
br.amt_benef                                      AS revenue,
g.gross_rev                                       AS gross_revenue,
br.amt_benef                                      AS transferred_amount,
true                                              AS is_beneficiary,
br.bid                                            AS breakdown_id,
br.b_status                                       AS breakdown_status,
br.split_reason                                   AS split_reason,
br.replacement_at                                 AS replacement_at
FROM gross g
JOIN br ON br.schedule_id = g.sid
WHERE br.b_status = 'cloture'
AND br.beneficiary_company_id IS NOT NULL
AND br.beneficiary_company_id <> br.original_company_id
AND br.amt_benef > 0;
$function$;

-- 2) get_daf_consolidated_kpis reads reservations directly; add online ticket revenue
CREATE OR REPLACE FUNCTION public.get_daf_consolidated_kpis(p_company_ids uuid[], p_date_from date, p_date_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_result jsonb;
BEGIN
IF NOT is_daf_user() THEN RETURN '{}'::jsonb; END IF;

SELECT jsonb_build_object(
'total_revenue',           COALESCE(SUM(r.total_price), 0) + COALESCE((
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
$function$;

-- 3) get_daf_revenue_by_bus reads reservations per bus; add online ticket revenue
CREATE OR REPLACE FUNCTION public.get_daf_revenue_by_bus(p_company_ids uuid[], p_date_from date, p_date_to date)
 RETURNS TABLE(bus_id uuid, registration_number text, model text, company_name text, trip_count bigint, revenue numeric, cc_carburant numeric, cc_ration numeric, cc_peage numeric, fuel_enlev numeric, expense_reparation numeric, expense_autres numeric, expense_charge_stock numeric, vehicle_exp numeric, fuel_carburant_comptable numeric, total_expense numeric, margin numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
IF NOT is_daf_user() THEN RETURN; END IF;

RETURN QUERY
WITH base AS (
SELECT
b.id AS bus_id,
b.registration_number,
b.model,
c.name AS company_name,
COUNT(DISTINCT s.id)::bigint AS trip_count,
COALESCE(SUM(r.total_price), 0) + COALESCE((
SELECT SUM(mb.unit_price * mb.seats_count)
FROM mobile_bookings mb
JOIN schedules s2 ON s2.id = mb.schedule_id
WHERE s2.bus_id = b.id
AND mb.status = 'confirmed'
AND s2.departure_datetime::date BETWEEN p_date_from AND p_date_to
), 0) AS revenue,
COALESCE((
SELECT SUM(cc.amount) FROM counter_charges cc
WHERE cc.bus_id = b.id AND cc.charge_type = 'carburant_complement'
AND cc.charge_date BETWEEN p_date_from AND p_date_to
), 0) AS cc_carburant,
COALESCE((
SELECT SUM(cc.amount) FROM counter_charges cc
WHERE cc.bus_id = b.id AND cc.charge_type = 'ration'
AND cc.charge_date BETWEEN p_date_from AND p_date_to
), 0) AS cc_ration,
COALESCE((
SELECT SUM(cc.amount) FROM counter_charges cc
WHERE cc.bus_id = b.id AND cc.charge_type = 'peage'
AND cc.charge_date BETWEEN p_date_from AND p_date_to
), 0) AS cc_peage,
COALESCE((
SELECT SUM(fe.total_amount) FROM fuel_enlevements fe
WHERE fe.bus_id = b.id
AND fe.enlevement_date BETWEEN p_date_from AND p_date_to
), 0) AS fuel_enlev,
COALESCE((
SELECT SUM(ve.amount)
FROM vehicle_expenses ve
LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number
AND ve.vehicle_id IS NULL
WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number
AND ve.source = 'comptable'
AND (ve.description IS NULL OR ve.description NOT LIKE 'Sortie stock — %')
AND ve.expense_date BETWEEN p_date_from AND p_date_to
), 0) AS expense_reparation,
COALESCE((
SELECT SUM(ve.amount)
FROM vehicle_expenses ve
LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number
AND ve.vehicle_id IS NULL
WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number
AND ve.source = 'comptable'
AND ve.description LIKE 'Sortie stock — %'
AND ve.expense_date BETWEEN p_date_from AND p_date_to
), 0) AS expense_autres,
COALESCE((
SELECT SUM(ve.amount)
FROM vehicle_expenses ve
LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number
AND ve.vehicle_id IS NULL
WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number
AND ve.source = 'stock_gerant'
AND ve.expense_date BETWEEN p_date_from AND p_date_to
), 0) AS expense_charge_stock,
COALESCE((
SELECT SUM(ve.amount)
FROM vehicle_expenses ve
LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number
AND ve.vehicle_id IS NULL
WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number
AND ve.source = 'charge_achat'
AND ve.expense_date BETWEEN p_date_from AND p_date_to
), 0) AS vehicle_exp,
COALESCE((
SELECT SUM(cfw.total_amount)
FROM comptable_fuel_withdrawals cfw
WHERE cfw.bus_id = b.id
AND cfw.withdrawal_date BETWEEN p_date_from AND p_date_to
), 0) AS fuel_carburant_comptable
FROM buses b
JOIN companies c ON c.id = b.company_id
JOIN schedules s ON s.bus_id = b.id
AND s.departure_datetime::date BETWEEN p_date_from AND p_date_to
LEFT JOIN reservations r ON r.schedule_id = s.id
AND r.status IN ('confirmee', 'utilisee')
WHERE b.company_id = ANY(p_company_ids)
GROUP BY b.id, b.registration_number, b.model, c.name
)
SELECT
base.bus_id,
base.registration_number,
base.model,
base.company_name,
base.trip_count,
base.revenue,
base.cc_carburant,
base.cc_ration,
base.cc_peage,
base.fuel_enlev,
base.expense_reparation,
base.expense_autres,
base.expense_charge_stock,
base.vehicle_exp,
base.fuel_carburant_comptable,
(base.cc_carburant + base.cc_ration + base.cc_peage
+ base.fuel_enlev + base.expense_reparation + base.expense_autres
+ base.expense_charge_stock + base.vehicle_exp + base.fuel_carburant_comptable) AS total_expense,
(base.revenue - base.cc_carburant - base.cc_ration - base.cc_peage
- base.fuel_enlev - base.expense_reparation - base.expense_autres
- base.expense_charge_stock - base.vehicle_exp - base.fuel_carburant_comptable) AS margin
FROM base;
END;
$function$;