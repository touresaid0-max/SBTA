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

  COALESCE(res_agg.total_baggage, 0)           AS total_baggage,

  COALESCE(cc_agg.total_charges,        0)      AS total_charges,
  COALESCE(cc_agg.total_rations,        0)      AS total_rations,
  COALESCE(cc_agg.total_carburant,      0)      AS total_carburant,
  COALESCE(cc_agg.total_peages,         0)      AS total_peages,
  COALESCE(cc_agg.total_autres,         0)      AS total_autres,

  COALESCE(cv.amount, 0)::numeric              AS convoy_amount,
  COALESCE(ram_agg.ramassage_amount, 0)::numeric AS ramassage_amount,

  CASE WHEN sch.status = 'convoi'
    THEN COALESCE(cv.amount, 0) + COALESCE(ram_agg.ramassage_amount, 0)
         - COALESCE(cc_agg.total_charges, 0)
    ELSE COALESCE(res_agg.total_ticket_amount, 0) + COALESCE(mob_agg.total_ticket_amount, 0)
      + COALESCE(ram_agg.ramassage_amount, 0)
      - COALESCE(cc_agg.total_charges, 0)
  END
  - CASE
      WHEN sb.status = 'cloture'
       AND sb.beneficiary_company_id IS NOT NULL
       AND sb.beneficiary_company_id <> sb.original_company_id
      THEN COALESCE(sb.amount_replacement_company, 0)
      ELSE 0
    END                                         AS solde_ticket,

  sb.id                                         AS breakdown_id,
  CASE
    WHEN sb.status = 'cloture'
     AND sb.beneficiary_company_id IS NOT NULL
     AND sb.beneficiary_company_id <> sb.original_company_id
    THEN COALESCE(sb.amount_replacement_company, 0)
    ELSE 0
  END                                           AS breakdown_transfer,
  sb.beneficiary_company_id                     AS breakdown_beneficiary_id,
  sb.split_reason                               AS breakdown_split_reason,
  sb.replacement_at                             AS breakdown_split_at,
  sb.replaced_by                                AS breakdown_gestionnaire_id,

  CASE
    WHEN sb.status = 'cloture'
     AND sb.beneficiary_company_id IS NOT NULL
     AND sb.beneficiary_company_id <> sb.original_company_id
     AND COALESCE(sb.charges_total_beneficiary, 0) > 0
    THEN true ELSE false
  END                                           AS has_charge_distribution,
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
LEFT JOIN departure_sequence  ds         ON ds.schedule_id    = sch.id
LEFT JOIN counters             cnt        ON cnt.id            = ds.counter_id
LEFT JOIN stations             st_dep    ON st_dep.id         = sch.departure_station_id
LEFT JOIN routes               rte       ON rte.id            = sch.route_id
LEFT JOIN cities               city_orig ON city_orig.id      = rte.origin_city_id
LEFT JOIN cities               city_dest ON city_dest.id      = rte.destination_city_id
LEFT JOIN buses                bus       ON bus.id            = sch.bus_id
LEFT JOIN users                drv       ON drv.id            = sch.driver_id

LEFT JOIN (
  SELECT schedule_id,
    SUM(total_seats)  AS seats_sold,
    SUM(total_price)  AS total_ticket_amount,
    SUM(baggage_fee)  AS total_baggage
  FROM reservations
  WHERE status = ANY (ARRAY['confirmee','confirme','embarque','termine'])
  GROUP BY schedule_id
) res_agg ON res_agg.schedule_id = sch.id

LEFT JOIN (
  SELECT schedule_id,
    SUM(seats_count)              AS seats_sold,
    SUM(unit_price * seats_count) AS total_ticket_amount
  FROM mobile_bookings
  WHERE status = 'confirmed'
  GROUP BY schedule_id
) mob_agg ON mob_agg.schedule_id = sch.id

LEFT JOIN (
  SELECT schedule_id,
    array_agg(DISTINCT s_num ORDER BY s_num)
      FILTER (WHERE s_num IS NOT NULL)  AS sold_seat_numbers
  FROM (
    SELECT r.schedule_id, unnest(r.seat_numbers) AS s_num
    FROM reservations r
    WHERE r.status = ANY (ARRAY['confirmee','confirme','embarque','termine'])
    UNION ALL
    SELECT mb.schedule_id, unnest(mb.assigned_seats)::text AS s_num
    FROM mobile_bookings mb
    WHERE mb.status = 'confirmed'
  ) u
  GROUP BY schedule_id
) seat_agg ON seat_agg.schedule_id = sch.id

LEFT JOIN (
  SELECT schedule_id,
    SUM(amount)                                                      AS total_charges,
    SUM(amount) FILTER (WHERE charge_type = 'ration')                AS total_rations,
    SUM(amount) FILTER (WHERE charge_type = 'carburant_complement')  AS total_carburant,
    SUM(amount) FILTER (WHERE charge_type = 'peage')                 AS total_peages,
    SUM(amount) FILTER (WHERE charge_type = 'autres')                AS total_autres
  FROM counter_charges
  WHERE status <> 'rejete'
  GROUP BY schedule_id
) cc_agg ON cc_agg.schedule_id = sch.id

LEFT JOIN convoys cv ON cv.schedule_id = sch.id

LEFT JOIN (
  SELECT schedule_id,
    SUM(amount) AS ramassage_amount
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

CREATE VIEW daily_counter_report AS
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
  COALESCE(SUM(srs.ramassage_amount),   0)                AS total_ramassage,
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
      'ramassage_amount',    srs.ramassage_amount,
      'is_ramassage',        srs.is_ramassage,
      'breakdown_transfer',  srs.breakdown_transfer,
      'breakdown_beneficiary_id', srs.breakdown_beneficiary_id,
      'has_charge_distribution', srs.has_charge_distribution,
      'charge_dist_total_original', srs.charge_dist_total_original,
      'charge_dist_total_beneficiary', srs.charge_dist_total_beneficiary,
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