-- Fix: schedule_company_charges and schedule_company_revenue were SECURITY INVOKER
-- meaning they ran as the DAF user (via anon/auth connection) who has no RLS access
-- to counter_charges, schedules, convoys etc. Recreate as SECURITY DEFINER so they
-- run as function owner (postgres) when called from within the DAF RPCs.

CREATE OR REPLACE FUNCTION public.schedule_company_revenue(p_from date, p_to date)
 RETURNS TABLE(schedule_id uuid, schedule_date date, bus_id uuid, driver_id uuid, route_id uuid, station_id uuid, company_id uuid, revenue numeric, gross_revenue numeric, transferred_amount numeric, is_beneficiary boolean, breakdown_id uuid, breakdown_status text, split_reason text, replacement_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
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


CREATE OR REPLACE FUNCTION public.schedule_company_charges(p_from date, p_to date)
 RETURNS TABLE(schedule_id uuid, bus_id uuid, company_id uuid, is_beneficiary boolean, cc_ration numeric, cc_carburant numeric, cc_peage numeric, cc_autres numeric, cc_total numeric)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
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

NOTIFY pgrst, 'reload schema';
