/*
# Convois — extension complète (aller/retour, charges, passagers)

## Purpose
Extend the existing `convoys` table so a Chef de gare can record a full convoy
(one-way or round-trip) with passengers, charges (ratio, carburant, péage,
autres), and have those charges flow into all existing reports via the
`schedule_receipt_summary` view — without touching any non-convoi logic.

## Changes to `convoys` table (additive — no existing column altered)
1. `trip_type` text NOT NULL DEFAULT 'aller_simple'
   CHECK (trip_type IN ('aller_simple','aller_retour'))
2. `passengers_count` int NOT NULL DEFAULT 0
3. `ratio_amount`    decimal(15,2) NOT NULL DEFAULT 0   — maps to "ration" charges
4. `carburant_amount` decimal(15,2) NOT NULL DEFAULT 0  — maps to "carburant_complement"
5. `peage_amount`    decimal(15,2) NOT NULL DEFAULT 0   — maps to "peage"
6. `autres_amount`   decimal(15,2) NOT NULL DEFAULT 0   — maps to "autres"
7. `return_convoy_id` uuid REFERENCES convoys(id) ON DELETE SET NULL
   — set on the "aller" convoy when trip_type = 'aller_retour', points to the
     retour convoy row.

## View change: `schedule_receipt_summary` (recreated)
The charge columns (total_charges, total_rations, total_carburant,
total_peages, total_autres) and solde_ticket now ADD the convoy charge columns
WHEN status = 'convoi'. For all other statuses the expressions are byte-for-byte
identical to the previous version — no existing behaviour changes.

## Security
- Existing RLS on convoys: SELECT for authenticated, INSERT for chef_gare/admin.
- New UPDATE policy: chef_gare/admin can update convoys (to edit charges etc.).
- No DELETE policy added (convoys are not deleted via the app).
*/

-- ─── 1. Extend convoys table ──────────────────────────────────────────────────

ALTER TABLE convoys
  ADD COLUMN IF NOT EXISTS trip_type text NOT NULL DEFAULT 'aller_simple'
    CHECK (trip_type IN ('aller_simple','aller_retour'));
ALTER TABLE convoys
  ADD COLUMN IF NOT EXISTS passengers_count int NOT NULL DEFAULT 0;
ALTER TABLE convoys
  ADD COLUMN IF NOT EXISTS ratio_amount decimal(15,2) NOT NULL DEFAULT 0;
ALTER TABLE convoys
  ADD COLUMN IF NOT EXISTS carburant_amount decimal(15,2) NOT NULL DEFAULT 0;
ALTER TABLE convoys
  ADD COLUMN IF NOT EXISTS peage_amount decimal(15,2) NOT NULL DEFAULT 0;
ALTER TABLE convoys
  ADD COLUMN IF NOT EXISTS autres_amount decimal(15,2) NOT NULL DEFAULT 0;
ALTER TABLE convoys
  ADD COLUMN IF NOT EXISTS return_convoy_id uuid REFERENCES convoys(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_convoys_return_of ON convoys(return_convoy_id);

-- ─── 2. RLS: allow chef_gare / admin to update convoys ────────────────────────

DROP POLICY IF EXISTS "chef_gare_admin_update_convoys" ON convoys;
CREATE POLICY "chef_gare_admin_update_convoys"
  ON convoys FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid() AND u.role IN ('chef_gare','admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid() AND u.role IN ('chef_gare','admin')
    )
  );

-- ─── 3. Recreate schedule_receipt_summary with convoy charges ─────────────────

DROP VIEW IF EXISTS daily_counter_report;
DROP VIEW IF EXISTS schedule_receipt_summary;

CREATE VIEW schedule_receipt_summary AS
SELECT
  sch.id                                        AS schedule_id,
  sch.departure_datetime,
  sch.arrival_datetime,
  sch.status,
  sch.is_ramassage,
  ds.counter_id,
  ds.departure_number,
  ds.departure_date,
  cnt.counter_number,
  st_dep.id                                     AS station_id,
  st_dep.name                                   AS station_name,
  rte.id                                        AS route_id,
  rte.name                                      AS route_name,
  rte.base_price,
  city_orig.name                                AS origin_city,
  city_dest.name                                AS destination_city,
  bus.id                                        AS bus_id,
  bus.registration_number,
  COALESCE(bus.capacity, bus.total_seats, 0)    AS capacity,
  COALESCE(drv.first_name || ' ' || drv.last_name, '—') AS driver_name,

  CASE WHEN sch.status = 'convoi'
    THEN COALESCE(bus.capacity, bus.total_seats, 0)
    ELSE COALESCE(res_agg.seats_sold, 0) + COALESCE(mob_agg.seats_sold, 0)
  END                                           AS seats_sold,

  CASE WHEN sch.status = 'convoi'
    THEN 0
    ELSE COALESCE(bus.capacity, bus.total_seats, 0)
      - COALESCE(res_agg.seats_sold, 0) - COALESCE(mob_agg.seats_sold, 0)
  END                                           AS seats_remaining,

  CASE WHEN sch.status = 'convoi'
    THEN COALESCE(cv.amount, 0)
    ELSE COALESCE(res_agg.total_ticket_amount, 0) + COALESCE(mob_agg.total_ticket_amount, 0)
  END                                           AS total_ticket_amount,

  COALESCE(bag_agg.total_baggage, 0)            AS total_baggage,

  -- Charges: counter_charges + convoy charges (convoy charges only for status='convoi')
  COALESCE(cc_agg.total_charges, 0)
    + CASE WHEN sch.status = 'convoi' THEN
        COALESCE(cv.ratio_amount, 0) + COALESCE(cv.carburant_amount, 0)
        + COALESCE(cv.peage_amount, 0) + COALESCE(cv.autres_amount, 0)
      ELSE 0 END                                AS total_charges,

  COALESCE(cc_agg.total_rations, 0)
    + CASE WHEN sch.status = 'convoi' THEN COALESCE(cv.ratio_amount, 0) ELSE 0 END
                                                AS total_rations,

  COALESCE(cc_agg.total_carburant, 0)
    + CASE WHEN sch.status = 'convoi' THEN COALESCE(cv.carburant_amount, 0) ELSE 0 END
                                                AS total_carburant,

  COALESCE(cc_agg.total_peages, 0)
    + CASE WHEN sch.status = 'convoi' THEN COALESCE(cv.peage_amount, 0) ELSE 0 END
                                                AS total_peages,

  COALESCE(cc_agg.total_autres, 0)
    + CASE WHEN sch.status = 'convoi' THEN COALESCE(cv.autres_amount, 0) ELSE 0 END
                                                AS total_autres,

  COALESCE(cv.amount, 0)                        AS convoy_amount,
  COALESCE(cv.passengers_count, 0)              AS convoy_passengers,
  COALESCE(cv.trip_type, 'aller_simple')        AS convoy_trip_type,
  COALESCE(ram_agg.ramassage_amount, 0)         AS ramassage_amount,

  -- Solde = recettes - charges (convoy charges included for convoi status)
  (CASE WHEN sch.status = 'convoi'
    THEN COALESCE(cv.amount, 0) + COALESCE(ram_agg.ramassage_amount, 0)
      - (COALESCE(cc_agg.total_charges, 0)
         + COALESCE(cv.ratio_amount, 0) + COALESCE(cv.carburant_amount, 0)
         + COALESCE(cv.peage_amount, 0) + COALESCE(cv.autres_amount, 0))
    ELSE COALESCE(res_agg.total_ticket_amount, 0) + COALESCE(mob_agg.total_ticket_amount, 0)
      + COALESCE(ram_agg.ramassage_amount, 0) - COALESCE(cc_agg.total_charges, 0)
  END)
  - CASE
      WHEN sb.status = 'cloture' AND sb.beneficiary_company_id IS NOT NULL
        AND sb.beneficiary_company_id <> sb.original_company_id
      THEN COALESCE(sb.amount_replacement_company, 0)
      ELSE 0
    END                                         AS solde_ticket,

  sb.id                                         AS breakdown_id,
  CASE WHEN sb.status = 'cloture' AND sb.beneficiary_company_id IS NOT NULL
    AND sb.beneficiary_company_id <> sb.original_company_id
    THEN COALESCE(sb.amount_replacement_company, 0) ELSE 0 END
                                                AS breakdown_transfer,
  sb.beneficiary_company_id                     AS breakdown_beneficiary_id,
  sb.split_reason                               AS breakdown_split_reason,
  sb.replacement_at                             AS breakdown_split_at,
  sb.replaced_by                                AS breakdown_gestionnaire_id,
  CASE WHEN sb.status = 'cloture' AND sb.beneficiary_company_id IS NOT NULL
    AND sb.beneficiary_company_id <> sb.original_company_id
    AND COALESCE(sb.charges_total_beneficiary, 0) > 0
    THEN true ELSE false END                    AS has_charge_distribution,
  COALESCE(sb.charges_ration_original, 0)       AS charge_dist_ration_original,
  COALESCE(sb.charges_ration_beneficiary, 0)    AS charge_dist_ration_beneficiary,
  COALESCE(sb.charges_carburant_original, 0)    AS charge_dist_carburant_original,
  COALESCE(sb.charges_carburant_beneficiary, 0) AS charge_dist_carburant_beneficiary,
  COALESCE(sb.charges_peage_original, 0)        AS charge_dist_peage_original,
  COALESCE(sb.charges_peage_beneficiary, 0)     AS charge_dist_peage_beneficiary,
  COALESCE(sb.charges_autres_original, 0)       AS charge_dist_autres_original,
  COALESCE(sb.charges_autres_beneficiary, 0)    AS charge_dist_autres_beneficiary,
  COALESCE(sb.charges_total_original, 0)        AS charge_dist_total_original,
  COALESCE(sb.charges_total_beneficiary, 0)     AS charge_dist_total_beneficiary,
  seat_agg.sold_seat_numbers

FROM schedules sch
LEFT JOIN departure_sequence ds   ON ds.schedule_id = sch.id
LEFT JOIN counters cnt            ON cnt.id = ds.counter_id
LEFT JOIN stations st_dep         ON st_dep.id = sch.departure_station_id
LEFT JOIN routes rte              ON rte.id = sch.route_id
LEFT JOIN cities city_orig        ON city_orig.id = rte.origin_city_id
LEFT JOIN cities city_dest        ON city_dest.id = rte.destination_city_id
LEFT JOIN buses bus               ON bus.id = sch.bus_id
LEFT JOIN users drv               ON drv.id = sch.driver_id

LEFT JOIN (
  SELECT schedule_id,
    SUM(total_seats) AS seats_sold,
    SUM(total_price) AS total_ticket_amount,
    SUM(baggage_fee) AS total_baggage
  FROM reservations
  WHERE status = ANY (ARRAY['confirmee','confirme','embarque','termine'])
  GROUP BY schedule_id
) res_agg ON res_agg.schedule_id = sch.id

LEFT JOIN (
  SELECT schedule_id,
    SUM(seats_count) AS seats_sold,
    SUM(unit_price * seats_count) AS total_ticket_amount
  FROM mobile_bookings
  WHERE status = 'confirmed'
  GROUP BY schedule_id
) mob_agg ON mob_agg.schedule_id = sch.id

LEFT JOIN (
  SELECT schedule_id, SUM(price) AS total_baggage
  FROM baggage_tickets
  WHERE schedule_id IS NOT NULL
  GROUP BY schedule_id
) bag_agg ON bag_agg.schedule_id = sch.id

LEFT JOIN (
  SELECT u.schedule_id,
    array_agg(DISTINCT u.s_num ORDER BY u.s_num) FILTER (WHERE u.s_num IS NOT NULL) AS sold_seat_numbers
  FROM (
    SELECT r.schedule_id, unnest(r.seat_numbers) AS s_num
    FROM reservations r
    WHERE r.status = ANY (ARRAY['confirmee','confirme','embarque','termine'])
    UNION ALL
    SELECT mb.schedule_id, unnest(mb.assigned_seats)::text AS s_num
    FROM mobile_bookings mb
    WHERE mb.status = 'confirmed'
  ) u
  GROUP BY u.schedule_id
) seat_agg ON seat_agg.schedule_id = sch.id

LEFT JOIN (
  SELECT schedule_id,
    SUM(amount) AS total_charges,
    SUM(amount) FILTER (WHERE charge_type = 'ration')               AS total_rations,
    SUM(amount) FILTER (WHERE charge_type = 'carburant_complement') AS total_carburant,
    SUM(amount) FILTER (WHERE charge_type = 'peage')                AS total_peages,
    SUM(amount) FILTER (WHERE charge_type = 'autres')               AS total_autres
  FROM counter_charges
  WHERE status <> 'rejete'
  GROUP BY schedule_id
) cc_agg ON cc_agg.schedule_id = sch.id

LEFT JOIN convoys cv ON cv.schedule_id = sch.id

LEFT JOIN (
  SELECT schedule_id, SUM(amount) AS ramassage_amount
  FROM ramassage_collections
  GROUP BY schedule_id
) ram_agg ON ram_agg.schedule_id = sch.id

LEFT JOIN LATERAL (
  SELECT id, status, beneficiary_company_id, original_company_id,
    amount_replacement_company, split_reason, replacement_at, replaced_by,
    charges_ration_original, charges_ration_beneficiary,
    charges_carburant_original, charges_carburant_beneficiary,
    charges_peage_original, charges_peage_beneficiary,
    charges_autres_original, charges_autres_beneficiary,
    charges_total_original, charges_total_beneficiary
  FROM schedule_breakdowns
  WHERE schedule_id = sch.id
  ORDER BY breakdown_at DESC
  LIMIT 1
) sb ON true;

-- ─── 4. Recreate daily_counter_report (depends on schedule_receipt_summary) ────

CREATE OR REPLACE VIEW daily_counter_report AS
SELECT
  ds.counter_id,
  ds.departure_date,
  cnt.counter_number,
  st.name        AS station_name,
  rte.name       AS route_name,
  COUNT(DISTINCT ds.schedule_id)                          AS total_departures,
  COALESCE(SUM(srs.seats_sold),         0)                AS total_seats_sold,
  COALESCE(SUM(srs.total_ticket_amount),0)                AS total_ticket_amount,
  COALESCE(SUM(srs.total_baggage),      0)                AS total_baggage,
  COALESCE(SUM(srs.total_charges),      0)                AS total_charges,
  COALESCE(SUM(srs.solde_ticket),       0)                AS total_solde,
  jsonb_agg(
    jsonb_build_object(
      'schedule_id',         ds.schedule_id,
      'departure_number',    COALESCE(ds.departure_order, ds.departure_number),
      'registration_number', srs.registration_number,
      'driver_name',         srs.driver_name,
      'seats_sold',          srs.seats_sold,
      'total_ticket',        srs.total_ticket_amount,
      'total_baggage',       srs.total_baggage,
      'total_charges',       srs.total_charges,
      'solde_ticket',        srs.solde_ticket,
      'convoy_amount',       srs.convoy_amount,
      'status',              srs.status
    )
    ORDER BY COALESCE(ds.departure_order, ds.departure_number)
  ) AS departures_detail
FROM departure_sequence ds
JOIN schedule_receipt_summary srs ON srs.schedule_id = ds.schedule_id
JOIN counters cnt                  ON cnt.id = ds.counter_id
JOIN stations st                   ON st.id = srs.station_id
JOIN routes rte                    ON rte.id = srs.route_id
GROUP BY ds.counter_id, ds.departure_date, cnt.counter_number, st.name, rte.name;

NOTIFY pgrst, 'reload schema';
