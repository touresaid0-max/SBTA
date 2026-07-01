CREATE OR REPLACE VIEW schedule_receipt_summary AS
 SELECT sch.id AS schedule_id,
    sch.departure_datetime,
    sch.arrival_datetime,
    sch.status,
    sch.is_ramassage,
    ds.counter_id,
    ds.departure_number,
    ds.departure_date,
    cnt.counter_number,
    st_dep.id AS station_id,
    st_dep.name AS station_name,
    rte.id AS route_id,
    rte.name AS route_name,
    rte.base_price,
    city_orig.name AS origin_city,
    city_dest.name AS destination_city,
    bus.id AS bus_id,
    bus.registration_number,
    COALESCE(bus.capacity, bus.total_seats, 0) AS capacity,
    COALESCE((drv.first_name::text || ' '::text) || drv.last_name::text, '—'::text) AS driver_name,
        CASE
            WHEN sch.status = 'convoi'::text THEN COALESCE(bus.capacity, bus.total_seats, 0)::bigint
            ELSE COALESCE(res_agg.seats_sold, 0::bigint) + COALESCE(mob_agg.seats_sold, 0::bigint)
        END AS seats_sold,
        CASE
            WHEN sch.status = 'convoi'::text THEN 0::bigint
            ELSE COALESCE(bus.capacity, bus.total_seats, 0) - COALESCE(res_agg.seats_sold, 0::bigint) - COALESCE(mob_agg.seats_sold, 0::bigint)
        END AS seats_remaining,
        CASE
            WHEN sch.status = 'convoi'::text THEN COALESCE(cv.amount, 0::numeric)
            ELSE COALESCE(res_agg.total_ticket_amount, 0::numeric) + COALESCE(mob_agg.total_ticket_amount, 0::numeric)
        END AS total_ticket_amount,
    COALESCE(bag_agg.total_baggage, 0::numeric) AS total_baggage,
    COALESCE(cc_agg.total_charges, 0::numeric) AS total_charges,
    COALESCE(cc_agg.total_rations, 0::numeric) AS total_rations,
    COALESCE(cc_agg.total_carburant, 0::numeric) AS total_carburant,
    COALESCE(cc_agg.total_peages, 0::numeric) AS total_peages,
    COALESCE(cc_agg.total_autres, 0::numeric) AS total_autres,
    COALESCE(cv.amount, 0::numeric) AS convoy_amount,
    COALESCE(ram_agg.ramassage_amount, 0::numeric) AS ramassage_amount,
        CASE
            WHEN sch.status = 'convoi'::text THEN COALESCE(cv.amount, 0::numeric) + COALESCE(ram_agg.ramassage_amount, 0::numeric) - COALESCE(cc_agg.total_charges, 0::numeric)
            ELSE COALESCE(res_agg.total_ticket_amount, 0::numeric) + COALESCE(mob_agg.total_ticket_amount, 0::numeric) + COALESCE(ram_agg.ramassage_amount, 0::numeric) - COALESCE(cc_agg.total_charges, 0::numeric)
        END -
        CASE
            WHEN sb.status = 'cloture'::text AND sb.beneficiary_company_id IS NOT NULL AND sb.beneficiary_company_id <> sb.original_company_id THEN COALESCE(sb.amount_replacement_company, 0::numeric)
            ELSE 0::numeric
        END AS solde_ticket,
    sb.id AS breakdown_id,
        CASE
            WHEN sb.status = 'cloture'::text AND sb.beneficiary_company_id IS NOT NULL AND sb.beneficiary_company_id <> sb.original_company_id THEN COALESCE(sb.amount_replacement_company, 0::numeric)
            ELSE 0::numeric
        END AS breakdown_transfer,
    sb.beneficiary_company_id AS breakdown_beneficiary_id,
    sb.split_reason AS breakdown_split_reason,
    sb.replacement_at AS breakdown_split_at,
    sb.replaced_by AS breakdown_gestionnaire_id,
        CASE
            WHEN sb.status = 'cloture'::text AND sb.beneficiary_company_id IS NOT NULL AND sb.beneficiary_company_id <> sb.original_company_id AND COALESCE(sb.charges_total_beneficiary, 0::numeric) > 0::numeric THEN true
            ELSE false
        END AS has_charge_distribution,
    COALESCE(sb.charges_ration_original, 0::numeric) AS charge_dist_ration_original,
    COALESCE(sb.charges_ration_beneficiary, 0::numeric) AS charge_dist_ration_beneficiary,
    COALESCE(sb.charges_carburant_original, 0::numeric) AS charge_dist_carburant_original,
    COALESCE(sb.charges_carburant_beneficiary, 0::numeric) AS charge_dist_carburant_beneficiary,
    COALESCE(sb.charges_peage_original, 0::numeric) AS charge_dist_peage_original,
    COALESCE(sb.charges_peage_beneficiary, 0::numeric) AS charge_dist_peage_beneficiary,
    COALESCE(sb.charges_autres_original, 0::numeric) AS charge_dist_autres_original,
    COALESCE(sb.charges_autres_beneficiary, 0::numeric) AS charge_dist_autres_beneficiary,
    COALESCE(sb.charges_total_original, 0::numeric) AS charge_dist_total_original,
    COALESCE(sb.charges_total_beneficiary, 0::numeric) AS charge_dist_total_beneficiary,
    seat_agg.sold_seat_numbers
   FROM schedules sch
     LEFT JOIN departure_sequence ds ON ds.schedule_id = sch.id
     LEFT JOIN counters cnt ON cnt.id = ds.counter_id
     LEFT JOIN stations st_dep ON st_dep.id = sch.departure_station_id
     LEFT JOIN routes rte ON rte.id = sch.route_id
     LEFT JOIN cities city_orig ON city_orig.id = rte.origin_city_id
     LEFT JOIN cities city_dest ON city_dest.id = rte.destination_city_id
     LEFT JOIN buses bus ON bus.id = sch.bus_id
     LEFT JOIN users drv ON drv.id = sch.driver_id
     LEFT JOIN ( SELECT reservations.schedule_id,
            sum(reservations.total_seats) AS seats_sold,
            sum(reservations.total_price) AS total_ticket_amount,
            sum(reservations.baggage_fee) AS total_baggage
           FROM reservations
          WHERE reservations.status = ANY (ARRAY['confirmee'::text, 'confirme'::text, 'embarque'::text, 'termine'::text])
          GROUP BY reservations.schedule_id) res_agg ON res_agg.schedule_id = sch.id
     LEFT JOIN ( SELECT mobile_bookings.schedule_id,
            sum(mobile_bookings.seats_count) AS seats_sold,
            sum(mobile_bookings.unit_price * mobile_bookings.seats_count::numeric) AS total_ticket_amount
           FROM mobile_bookings
          WHERE mobile_bookings.status = 'confirmed'::text
          GROUP BY mobile_bookings.schedule_id) mob_agg ON mob_agg.schedule_id = sch.id
     LEFT JOIN ( SELECT baggage_tickets.schedule_id,
            sum(baggage_tickets.price) AS total_baggage
           FROM baggage_tickets
          WHERE baggage_tickets.schedule_id IS NOT NULL
          GROUP BY baggage_tickets.schedule_id) bag_agg ON bag_agg.schedule_id = sch.id
     LEFT JOIN ( SELECT u.schedule_id,
            array_agg(DISTINCT u.s_num ORDER BY u.s_num) FILTER (WHERE u.s_num IS NOT NULL) AS sold_seat_numbers
           FROM ( SELECT r.schedule_id,
                    unnest(r.seat_numbers) AS s_num
                   FROM reservations r
                  WHERE r.status = ANY (ARRAY['confirmee'::text, 'confirme'::text, 'embarque'::text, 'termine'::text])
                UNION ALL
                 SELECT mb.schedule_id,
                    unnest(mb.assigned_seats)::text AS s_num
                   FROM mobile_bookings mb
                  WHERE mb.status = 'confirmed'::text) u
          GROUP BY u.schedule_id) seat_agg ON seat_agg.schedule_id = sch.id
     LEFT JOIN ( SELECT counter_charges.schedule_id,
            sum(counter_charges.amount) AS total_charges,
            sum(counter_charges.amount) FILTER (WHERE counter_charges.charge_type = 'ration'::text) AS total_rations,
            sum(counter_charges.amount) FILTER (WHERE counter_charges.charge_type = 'carburant_complement'::text) AS total_carburant,
            sum(counter_charges.amount) FILTER (WHERE counter_charges.charge_type = 'peage'::text) AS total_peages,
            sum(counter_charges.amount) FILTER (WHERE counter_charges.charge_type = 'autres'::text) AS total_autres
           FROM counter_charges
          WHERE counter_charges.status <> 'rejete'::text
          GROUP BY counter_charges.schedule_id) cc_agg ON cc_agg.schedule_id = sch.id
     LEFT JOIN convoys cv ON cv.schedule_id = sch.id
     LEFT JOIN ( SELECT ramassage_collections.schedule_id,
            sum(ramassage_collections.amount) AS ramassage_amount
           FROM ramassage_collections
          GROUP BY ramassage_collections.schedule_id) ram_agg ON ram_agg.schedule_id = sch.id
     LEFT JOIN LATERAL ( SELECT schedule_breakdowns.id,
            schedule_breakdowns.status,
            schedule_breakdowns.beneficiary_company_id,
            schedule_breakdowns.original_company_id,
            schedule_breakdowns.amount_replacement_company,
            schedule_breakdowns.split_reason,
            schedule_breakdowns.replacement_at,
            schedule_breakdowns.replaced_by,
            schedule_breakdowns.charges_ration_original,
            schedule_breakdowns.charges_ration_beneficiary,
            schedule_breakdowns.charges_carburant_original,
            schedule_breakdowns.charges_carburant_beneficiary,
            schedule_breakdowns.charges_peage_original,
            schedule_breakdowns.charges_peage_beneficiary,
            schedule_breakdowns.charges_autres_original,
            schedule_breakdowns.charges_autres_beneficiary,
            schedule_breakdowns.charges_total_original,
            schedule_breakdowns.charges_total_beneficiary
           FROM schedule_breakdowns
          WHERE schedule_breakdowns.schedule_id = sch.id
          ORDER BY schedule_breakdowns.breakdown_at DESC
         LIMIT 1) sb ON true;

NOTIFY pgrst, 'reload schema';