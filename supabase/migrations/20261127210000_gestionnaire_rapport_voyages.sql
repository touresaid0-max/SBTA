/*
# Rapports détaillés voyage pour le gestionnaire (27/11/2026)

Demande : le gestionnaire a le menu « Rapports détaillés voyage », qui fonctionne comme celui du
DAF, mais il ne voit que sa société (et ses filiales : companies.parent_id).

1. voyage_report_rows(p_from, p_to, p_company_ids) : le calcul du rapport du DAF, inchangé, avec un
   filtre sur la société du car des départs (NULL : toutes). Interne : appelée seulement par les
   deux fonctions ci-dessous (droits du propriétaire), fermée aux comptes.
2. get_daf_voyage_report : même contrôle (DAF, DG, admin) et même résultat qu'avant, toutes les
   sociétés.
3. get_gestionnaire_voyage_report : réservé au gestionnaire ; sa société (users.company_id) et ses
   filiales. Un départ sans car (donc sans société) n'est pas compté pour lui.

Aucune donnée modifiée.
*/

CREATE OR REPLACE FUNCTION public.voyage_report_rows(p_from date, p_to date, p_company_ids uuid[] DEFAULT NULL)
 RETURNS TABLE(schedule_id uuid, departure_datetime timestamp with time zone, departure_number integer, status text, route_id uuid, route_name text, station_id uuid, station_name text, arrival_station_name text, counter_id uuid, counter_number text, bus_id uuid, bus_registration text, company_id uuid, company_name text, capacity integer, seats_sold integer, tickets_amount numeric, baggage_count integer, baggage_amount numeric, ramassage_amount numeric, exp_ration numeric, exp_carburant numeric, exp_peage numeric, exp_autres numeric, share_role text, seat_from integer, seat_to integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH s AS (
    SELECT sc.*
    FROM schedules sc
    WHERE sc.departure_datetime::date BETWEEN p_from AND p_to
      -- The departures of these companies only (the company of their bus); NULL: all
      AND (p_company_ids IS NULL
           OR EXISTS (SELECT 1 FROM buses bx WHERE bx.id = sc.bus_id AND bx.company_id = ANY (p_company_ids)))
  ),
  res AS (
    SELECT r.schedule_id AS sid,
           sum(coalesce(nullif(r.total_seats, 0), cardinality(r.seat_numbers), 1))::integer AS seats,
           coalesce(sum(r.total_price), 0)::numeric AS amount
    FROM reservations r
    WHERE r.schedule_id IN (SELECT s.id FROM s)
      AND coalesce(r.status, '') NOT IN ('annulee', 'annule', 'cancelled', 'remboursee')
      AND (r.status IN ('confirmee', 'utilisee', 'confirmed', 'paid')
           OR r.payment_status IN ('payee', 'paid'))
    GROUP BY r.schedule_id
  ),
  mob AS (
    SELECT m.schedule_id AS sid,
           coalesce(sum(m.seats_count), 0)::integer AS seats,
           coalesce(sum(m.unit_price * m.seats_count), 0)::numeric AS amount
    FROM mobile_bookings m
    WHERE m.schedule_id IN (SELECT s.id FROM s) AND m.status = 'confirmed'
    GROUP BY m.schedule_id
  ),
  bag AS (
    SELECT b.schedule_id AS sid, count(*)::integer AS n, coalesce(sum(b.price), 0)::numeric AS amount
    FROM baggage_tickets b
    WHERE b.schedule_id IN (SELECT s.id FROM s)
    GROUP BY b.schedule_id
  ),
  ram AS (
    SELECT rc.schedule_id AS sid, coalesce(sum(rc.amount), 0)::numeric AS amount
    FROM ramassage_collections rc
    WHERE rc.schedule_id IN (SELECT s.id FROM s)
    GROUP BY rc.schedule_id
  ),
  chg AS (
    SELECT cc.schedule_id AS sid,
           coalesce(sum(cc.amount) FILTER (WHERE cc.charge_type = 'ration'), 0)::numeric AS ration,
           coalesce(sum(cc.amount) FILTER (WHERE cc.charge_type IN ('carburant_complement', 'carburant')), 0)::numeric AS carburant,
           coalesce(sum(cc.amount) FILTER (WHERE cc.charge_type = 'peage'), 0)::numeric AS peage,
           coalesce(sum(cc.amount) FILTER (WHERE cc.charge_type NOT IN ('ration', 'carburant_complement', 'carburant', 'peage')), 0)::numeric AS autres
    FROM counter_charges cc
    WHERE cc.schedule_id IN (SELECT s.id FROM s) AND coalesce(cc.status, '') <> 'rejete'
    GROUP BY cc.schedule_id
  ),
  -- One row per departure, as before
  b AS (
    SELECT
      s.id AS b_id,
      s.departure_datetime::timestamptz AS b_dt,
      s.departure_number::integer AS b_no,
      s.status::text AS b_status,
      s.route_id AS b_route_id,
      coalesce(ro.name, s.route_name)::text AS b_route,
      s.departure_station_id AS b_station_id,
      st.name::text AS b_station,
      sa.name::text AS b_arrival,
      s.counter_id AS b_counter_id,
      co.counter_number::text AS b_counter,
      s.bus_id AS b_bus_id,
      bu.registration_number::text AS b_bus,
      bu.company_id AS b_company_id,
      cp.name::text AS b_company,
      coalesce(nullif(s.seats_total, 0), nullif(bu.total_seats, 0), 0)::integer AS b_capacity,
      (coalesce(res.seats, 0) + coalesce(mob.seats, 0))::integer AS b_seats,
      (CASE WHEN s.status = 'convoi' THEN coalesce(cv.amount, 0)
            ELSE coalesce(res.amount, 0) + coalesce(mob.amount, 0) END)::numeric AS b_tickets,
      coalesce(bag.n, 0)::integer AS b_bag_n,
      coalesce(bag.amount, 0)::numeric AS b_bag,
      coalesce(ram.amount, 0)::numeric AS b_ram,
      (CASE WHEN s.status = 'convoi' THEN coalesce(cv.ratio_amount, 0)     ELSE coalesce(chg.ration, 0) END)::numeric AS b_ration,
      (CASE WHEN s.status = 'convoi' THEN coalesce(cv.carburant_amount, 0) ELSE coalesce(chg.carburant, 0) END)::numeric AS b_carburant,
      (CASE WHEN s.status = 'convoi' THEN coalesce(cv.peage_amount, 0)     ELSE coalesce(chg.peage, 0) END)::numeric AS b_peage,
      (CASE WHEN s.status = 'convoi' THEN coalesce(cv.autres_amount, 0)    ELSE coalesce(chg.autres, 0) END)::numeric AS b_autres
    FROM s
    LEFT JOIN routes ro    ON ro.id = s.route_id
    LEFT JOIN stations st  ON st.id = s.departure_station_id
    LEFT JOIN stations sa  ON sa.id = s.arrival_station_id
    LEFT JOIN counters co  ON co.id = s.counter_id
    LEFT JOIN buses bu     ON bu.id = s.bus_id
    LEFT JOIN companies cp ON cp.id = bu.company_id
    LEFT JOIN res ON res.sid = s.id
    LEFT JOIN mob ON mob.sid = s.id
    LEFT JOIN bag ON bag.sid = s.id
    LEFT JOIN ram ON ram.sid = s.id
    LEFT JOIN chg ON chg.sid = s.id
    LEFT JOIN convoys cv   ON cv.schedule_id = s.id   -- one convoy per departure at most (unique)
  ),
  sh AS (
    SELECT x.* FROM public.schedule_station_shares(
      ARRAY(SELECT s.id FROM s WHERE cardinality(s.shared_station_ids) > 0)) x
  ),
  -- What the partner stations take from each shared departure
  ps AS (
    SELECT sh.schedule_id AS p_id, sum(sh.seats_alloc) AS p_n, sum(sh.seats_sold) AS p_seats,
           sum(sh.tickets_amount) AS p_tickets, sum(sh.baggage_count) AS p_bag_n, sum(sh.baggage_amount) AS p_bag,
           sum(sh.exp_ration) AS p_ration, sum(sh.exp_carburant) AS p_carburant,
           sum(sh.exp_peage) AS p_peage, sum(sh.exp_autres) AS p_autres
    FROM sh WHERE sh.share_role = 'partenaire' GROUP BY sh.schedule_id
  ),
  rows_out AS (
    -- The departure, at its station: the whole departure, or what the partners leave it
    SELECT b.b_id, b.b_dt, b.b_no, b.b_status, b.b_route_id, b.b_route, b.b_station_id, b.b_station,
           b.b_arrival, b.b_counter_id, b.b_counter, b.b_bus_id, b.b_bus, b.b_company_id, b.b_company,
           greatest(b.b_capacity - coalesce(ps.p_n, 0), 0)::integer AS capacity_o,
           (b.b_seats - coalesce(ps.p_seats, 0))::integer AS seats_o,
           (b.b_tickets - coalesce(ps.p_tickets, 0))::numeric AS tickets_o,
           (b.b_bag_n - coalesce(ps.p_bag_n, 0))::integer AS bag_n_o,
           (b.b_bag - coalesce(ps.p_bag, 0))::numeric AS bag_o,
           b.b_ram AS ram_o,
           (b.b_ration - coalesce(ps.p_ration, 0))::numeric AS ration_o,
           (b.b_carburant - coalesce(ps.p_carburant, 0))::numeric AS carburant_o,
           (b.b_peage - coalesce(ps.p_peage, 0))::numeric AS peage_o,
           (b.b_autres - coalesce(ps.p_autres, 0))::numeric AS autres_o,
           (CASE WHEN ps.p_id IS NOT NULL THEN 'principale' END)::text AS role_o,
           (CASE WHEN ps.p_id IS NOT NULL THEN mn.seat_from END)::integer AS from_o,
           (CASE WHEN ps.p_id IS NOT NULL THEN mn.seat_to END)::integer AS to_o,
           0 AS ord
    FROM b
    LEFT JOIN ps ON ps.p_id = b.b_id
    LEFT JOIN sh mn ON mn.schedule_id = b.b_id AND mn.share_role = 'principale'
    UNION ALL
    -- The share of each partner station
    SELECT b.b_id, b.b_dt, b.b_no, b.b_status, b.b_route_id, b.b_route, sh.station_id, pst.name::text,
           b.b_arrival, sh.counter_id, pco.counter_number::text, b.b_bus_id, b.b_bus, b.b_company_id, b.b_company,
           sh.seats_alloc, sh.seats_sold, sh.tickets_amount, sh.baggage_count, sh.baggage_amount, 0::numeric,
           sh.exp_ration, sh.exp_carburant, sh.exp_peage, sh.exp_autres,
           'partenaire'::text, sh.seat_from, sh.seat_to, 1
    FROM sh
    JOIN b ON b.b_id = sh.schedule_id
    LEFT JOIN stations pst ON pst.id = sh.station_id
    LEFT JOIN counters pco ON pco.id = sh.counter_id
    WHERE sh.share_role = 'partenaire'
  )
  SELECT o.b_id, o.b_dt, o.b_no, o.b_status, o.b_route_id, o.b_route, o.b_station_id, o.b_station,
         o.b_arrival, o.b_counter_id, o.b_counter, o.b_bus_id, o.b_bus, o.b_company_id, o.b_company,
         o.capacity_o, o.seats_o, o.tickets_o, o.bag_n_o, o.bag_o, o.ram_o,
         o.ration_o, o.carburant_o, o.peage_o, o.autres_o, o.role_o, o.from_o, o.to_o
  FROM rows_out o
  -- A fixed order: the pages of a long period neither repeat nor skip a row
  ORDER BY o.b_dt DESC, o.b_id, o.ord, o.b_station_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.voyage_report_rows(date, date, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.voyage_report_rows(date, date, uuid[]) TO service_role;

-- Le DAF : même contrôle, même résultat, toutes les sociétés
CREATE OR REPLACE FUNCTION public.get_daf_voyage_report(p_from date, p_to date)
 RETURNS TABLE(schedule_id uuid, departure_datetime timestamp with time zone, departure_number integer, status text, route_id uuid, route_name text, station_id uuid, station_name text, arrival_station_name text, counter_id uuid, counter_number text, bus_id uuid, bus_registration text, company_id uuid, company_name text, capacity integer, seats_sold integer, tickets_amount numeric, baggage_count integer, baggage_amount numeric, ramassage_amount numeric, exp_ration numeric, exp_carburant numeric, exp_peage numeric, exp_autres numeric, share_role text, seat_from integer, seat_to integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT (public.is_daf_user() OR coalesce(public.get_user_role(), '') IN ('daf', 'dg', 'admin')
          OR session_user = 'postgres') THEN
    RAISE EXCEPTION 'Rapport réservé au DAF, au DG et à l''administrateur' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT * FROM public.voyage_report_rows(p_from, p_to, NULL);
END;
$function$;

-- Le gestionnaire : sa société et ses filiales
CREATE OR REPLACE FUNCTION public.get_gestionnaire_voyage_report(p_from date, p_to date)
 RETURNS TABLE(schedule_id uuid, departure_datetime timestamp with time zone, departure_number integer, status text, route_id uuid, route_name text, station_id uuid, station_name text, arrival_station_name text, counter_id uuid, counter_number text, bus_id uuid, bus_registration text, company_id uuid, company_name text, capacity integer, seats_sold integer, tickets_amount numeric, baggage_count integer, baggage_amount numeric, ramassage_amount numeric, exp_ration numeric, exp_carburant numeric, exp_peage numeric, exp_autres numeric, share_role text, seat_from integer, seat_to integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_company   uuid;
  v_companies uuid[];
BEGIN
  IF coalesce(public.get_user_role(), '') <> 'gestionnaire' THEN
    RAISE EXCEPTION 'Rapport réservé au gestionnaire' USING ERRCODE = '42501';
  END IF;
  v_company := public.get_gestionnaire_company_id();
  IF v_company IS NULL THEN
    RETURN;
  END IF;
  v_companies := array_append(coalesce(ARRAY(SELECT public.get_subsidiary_ids(v_company)), '{}'::uuid[]), v_company);

  RETURN QUERY SELECT * FROM public.voyage_report_rows(p_from, p_to, v_companies);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_gestionnaire_voyage_report(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gestionnaire_voyage_report(date, date) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
