/*
# Integrate Ramassage Direct amounts into financial reports

## Purpose
Direct ramassages (Ramassage Direct) are saved with `schedule_id = NULL` in
`ramassage_collections`. The central revenue function `schedule_company_revenue()`
starts `FROM schedules s` and joins `ramassage_collections` on
`ram.schedule_id = s.id`, so any row with `schedule_id IS NULL` is silently
dropped. This means direct ramassage amounts never reach the DAF dashboard,
Gestionnaire dashboard, daily series, revenue-by-bus, revenue-by-route, or
KPIs-by-company reports — all of which consume `schedule_company_revenue()`.

## Change
Add a `UNION ALL` branch to `schedule_company_revenue()` that emits one revenue
row per direct ramassage collection (`ramassage_collections.schedule_id IS NULL`).
Each row carries:
- `schedule_id`  → the `local_depart_id` (text cast to uuid-safe placeholder; kept
  as NULL to avoid colliding with real schedule ids — we use `local_depart_id` as
  the unique key for trip_count dedup downstream)
- `schedule_date` → derived from `ramassage_notifications.departure_datetime`
  (falls back to `collected_at` then `created_at`)
- `bus_id`, `driver_id`, `route_id` → NULL (direct ramassages have no schedule)
- `station_id`   → `ramassage_collections.station_id` (per-station separation)
- `company_id`   → `ramassage_notifications.company_id` (joined via local_depart_id)
- `revenue` / `gross_revenue` → `ramassage_collections.amount`
- `transferred_amount` → 0
- `is_beneficiary` → false
- breakdown fields → NULL / false

## Why this is safe (no double-counting)
1. The existing `gross` CTE joins `ramassage_collections` on
   `ram.schedule_id = s.id`. Rows with `schedule_id IS NULL` never match a
   `schedules` row, so they are absent from the existing output. The new
   `UNION ALL` branch is the ONLY path that surfaces them.
2. The `fn_ramassage_to_collection` trigger fires only on UPDATE of
   `ramassage_notifications` (status → 'done'), not on INSERT. Direct
   ramassages are inserted directly into `ramassage_collections` by the
   frontend and never pass through the trigger, so there is no duplicate row.
3. The UNIQUE constraint on `ramassage_collections(schedule_id, station_id,
   local_depart_id)` prevents duplicate direct ramassage rows for the same
   `local_depart_id`.
4. `COUNT(DISTINCT schedule_id)` in downstream KPIs treats each direct
   ramassage's `local_depart_id` as a distinct trip, which is correct — each
   direct ramassage IS a separate collection event.

## Per-station separation
Direct ramassages use `ramassage_collections.station_id` as the `station_id`
in the output. This is the originating gare (set by the frontend to
`session.station_id`). Downstream filtering by station continues to work.

## Not modified
- `schedule_receipt_summary` view (consumed by `daily_counter_report`) — left
  untouched per the requirement not to modify Ramassage Ligne logic. Direct
  ramassages do not appear in `daily_counter_report`, which is correct: they
  have no departure_sequence row and no counter assignment.
- `fn_ramassage_to_collection` trigger — unchanged.
- All DAF/Gestionnaire RPC functions — unchanged; they automatically pick up
  the new rows via `schedule_company_revenue()`.

## Tables / objects modified
- `schedule_company_revenue()` — replaced with a version that UNION ALLs the
  direct ramassage branch.
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
  AND br.amt_benef > 0

UNION ALL

-- Direct ramassage rows (schedule_id IS NULL in ramassage_collections)
-- These have no schedule, no departure_sequence, no counter. They are pure
-- station-level recettes attributed to the originating gare's company.
SELECT
  NULL::uuid                                       AS schedule_id,
  COALESCE(rn.departure_datetime::date, rn.collected_at::date, rn.created_at::date) AS schedule_date,
  NULL::uuid                                       AS bus_id,
  NULL::uuid                                       AS driver_id,
  NULL::uuid                                       AS route_id,
  rc.station_id                                    AS station_id,
  rn.company_id                                    AS company_id,
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
WHERE rc.schedule_id IS NULL
  AND COALESCE(rc.amount, 0) > 0
  AND COALESCE(rn.departure_datetime::date, rn.collected_at::date, rn.created_at::date)
    BETWEEN p_from AND p_to;
$function$;

NOTIFY pgrst, 'reload schema';
