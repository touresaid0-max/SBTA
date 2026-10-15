/*
# Correct Ramassage Direct bus attribution in DAF reports

## Purpose
The previous financial integration added direct ramassage amounts to the shared
revenue stream, but emitted `NULL` for the bus and schedule identifiers. As a
result, DAF's "Par bus" report could not display the real vehicle or count the
ramassage as a voyage.

## Changes
1. Direct ramassage rows now use `ramassage_collections.id` as their stable
   report event identifier. This is unique per collection and lets all existing
   `COUNT(DISTINCT schedule_id)` indicators count each direct ramassage once.
2. Direct rows now use `ramassage_notifications.bus_id` as the real bus. A
   registration-number fallback is included for older notifications where the
   UUID is missing.
3. Company attribution remains notification-based, with the matched bus company
   as a safe fallback for legacy rows.
4. The originating station remains `ramassage_collections.station_id`, with the
   notification origin station as fallback.
5. Existing Ramassage Ligne rows and all existing financial formulas remain
   unchanged.

## Security
No tables, columns, policies, or permissions are added or removed. The existing
`SECURITY DEFINER` and fixed `search_path` of `schedule_company_revenue()` are
preserved.

## Important notes
1. Direct ramassages are still emitted only when `schedule_id IS NULL`, so they
   cannot be counted twice with Ramassage Ligne.
2. Charges remain zero for direct ramassages unless an existing charge is already
   linked to the bus through the normal expense tables; no new charge is invented.
3. Route remains nullable because a direct ramassage is not a scheduled line.
*/

CREATE OR REPLACE FUNCTION public.schedule_company_revenue(p_from date, p_to date)
RETURNS TABLE(
  schedule_id uuid,
  schedule_date date,
  bus_id uuid,
  driver_id uuid,
  route_id uuid,
  station_id uuid,
  company_id uuid,
  revenue numeric,
  gross_revenue numeric,
  transferred_amount numeric,
  is_beneficiary boolean,
  breakdown_id uuid,
  breakdown_status text,
  split_reason text,
  replacement_at timestamp with time zone
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
WITH gross AS (
  SELECT
    s.id                          AS sid,
    s.departure_datetime::date     AS sdate,
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
    WHERE schedule_id IS NOT NULL
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

SELECT
  rc.id                                           AS schedule_id,
  COALESCE(rn.departure_datetime::date, rn.collected_at::date, rn.created_at::date, rc.created_at::date) AS schedule_date,
  COALESCE(rn.bus_id, direct_bus.id)              AS bus_id,
  NULL::uuid                                       AS driver_id,
  rn.route_id                                      AS route_id,
  COALESCE(rc.station_id, rn.origin_station_id)   AS station_id,
  COALESCE(rn.company_id, direct_bus.company_id)   AS company_id,
  rc.amount                                        AS revenue,
  rc.amount                                        AS gross_revenue,
  0::numeric                                       AS transferred_amount,
  false                                            AS is_beneficiary,
  NULL::uuid                                       AS breakdown_id,
  NULL::text                                       AS breakdown_status,
  NULL::text                                       AS split_reason,
  NULL::timestamptz                                AS replacement_at
FROM ramassage_collections rc
LEFT JOIN ramassage_notifications rn
  ON rn.local_depart_id = rc.local_depart_id
LEFT JOIN buses direct_bus
  ON direct_bus.registration_number = rn.bus_registration
WHERE rc.schedule_id IS NULL
  AND COALESCE(rc.amount, 0) > 0
  AND COALESCE(rn.departure_datetime::date, rn.collected_at::date, rn.created_at::date, rc.created_at::date)
    BETWEEN p_from AND p_to;
$function$;

NOTIFY pgrst, 'reload schema';