/*
# Gestionnaire, détail des voyages : la ville de destination d'un ramassage direct

Demande (19/11/2026) : dans le détail des voyages, un ramassage direct affiche sa ville de
destination au lieu de « Ramassage direct ». get_gestionnaire_route_departures rend, pour un
ramassage direct, le nom saisi au guichet (« Ramassage direct — MAN ») dans route_name ; l'écran en
tire la ville. Même nom, mêmes colonnes, mêmes droits ; aucune donnée n'est modifiée.
*/

CREATE OR REPLACE FUNCTION public.get_gestionnaire_route_departures(p_route_id uuid, p_from date, p_to date)
RETURNS TABLE (
  schedule_id          uuid,
  is_departure         boolean,
  departure_datetime   timestamptz,
  departure_number     integer,
  status               text,
  route_id             uuid,
  route_name           text,
  station_id           uuid,
  station_name         text,
  counter_id           uuid,
  counter_number       text,
  bus_registration     text,
  company_name         text,
  capacity             integer,
  seats_sold           integer,
  tickets_amount       numeric,
  baggage_count        integer,
  baggage_amount       numeric,
  ramassage_amount     numeric,
  recette              numeric,
  transferred_amount   numeric,
  exp_ration           numeric,
  exp_carburant        numeric,
  exp_peage            numeric,
  exp_autres           numeric,
  share_role           text,
  seat_from            integer,
  seat_to              integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_company_id uuid;
BEGIN
  IF coalesce(public.get_user_role(), '') <> 'gestionnaire' THEN
    RAISE EXCEPTION 'Détail réservé au gestionnaire' USING ERRCODE = '42501';
  END IF;
  v_company_id := public.get_gestionnaire_company_id();
  IF v_company_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH scr AS (
    SELECT x.* FROM public.schedule_company_revenue(p_from, p_to) x
    WHERE x.company_id = v_company_id
      AND (p_route_id IS NULL OR x.route_id = p_route_id)
  ),
  scc AS (
    SELECT c.schedule_id AS sid, c.is_beneficiary AS benef,
           sum(c.cc_ration) AS ration, sum(c.cc_carburant) AS carburant,
           sum(c.cc_peage) AS peage, sum(c.cc_autres) AS autres
    FROM public.schedule_company_charges(p_from, p_to) c
    WHERE c.company_id = v_company_id
    GROUP BY c.schedule_id, c.is_beneficiary
  ),
  -- Same reservations as the report: confirmed or used
  res AS (
    SELECT r.schedule_id AS sid,
           sum(coalesce(nullif(r.total_seats, 0), cardinality(r.seat_numbers), 1))::integer AS seats,
           coalesce(sum(r.total_price), 0)::numeric AS amount
    FROM reservations r
    WHERE r.schedule_id IN (SELECT scr.schedule_id FROM scr) AND r.status IN ('confirmee', 'utilisee')
    GROUP BY r.schedule_id
  ),
  mob AS (
    SELECT m.schedule_id AS sid,
           coalesce(sum(m.seats_count), 0)::integer AS seats,
           coalesce(sum(m.unit_price * m.seats_count), 0)::numeric AS amount
    FROM mobile_bookings m
    WHERE m.schedule_id IN (SELECT scr.schedule_id FROM scr) AND m.status = 'confirmed'
    GROUP BY m.schedule_id
  ),
  -- Paid baggage, as on the counter's receipts slip (baggage waiting for payment left out)
  bag AS (
    SELECT b.schedule_id AS sid, count(*)::integer AS n, coalesce(sum(b.price), 0)::numeric AS amount
    FROM baggage_tickets b
    WHERE b.schedule_id IN (SELECT scr.schedule_id FROM scr)
      AND coalesce(b.payment_status, '') <> 'en_attente'
    GROUP BY b.schedule_id
  ),
  ram AS (
    SELECT rc.schedule_id AS sid, coalesce(sum(rc.amount), 0)::numeric AS amount
    FROM ramassage_collections rc
    WHERE rc.schedule_id IN (SELECT scr.schedule_id FROM scr)
    GROUP BY rc.schedule_id
  ),
  -- One row per departure (or per bus of a breakdown), as before
  b AS (
    SELECT
      scr.schedule_id AS b_id,
      (s.id IS NOT NULL) AS b_is_dep,
      coalesce(s.departure_datetime, dr.departure_datetime, scr.schedule_date::timestamptz) AS b_dt,
      coalesce(s.route_number, s.departure_number)::integer AS b_no,
      (CASE WHEN s.id IS NULL THEN 'ramassage_direct' ELSE s.status END)::text AS b_status,
      scr.route_id AS b_route_id,
      coalesce(ro.name, s.route_name, dr.rn_route, 'Ligne inconnue')::text AS b_route,
      scr.station_id AS b_station_id,
      coalesce(st.name, 'Gare inconnue')::text AS b_station,
      s.counter_id AS b_counter_id,
      co.counter_number::text AS b_counter,
      bu.registration_number::text AS b_bus,
      cp.name::text AS b_company,
      (CASE WHEN s.id IS NULL THEN 0
            ELSE coalesce(nullif(s.seats_total, 0), nullif(bu.total_seats, 0), 0) END)::integer AS b_capacity,
      (coalesce(res.seats, 0) + coalesce(mob.seats, 0))::integer AS b_seats,
      (CASE WHEN s.status = 'convoi' THEN coalesce(cv.amount, 0)
            ELSE coalesce(res.amount, 0) + coalesce(mob.amount, 0) END)::numeric AS b_tickets,
      coalesce(bag.n, 0)::integer AS b_bag_n,
      coalesce(bag.amount, 0)::numeric AS b_bag,
      (CASE WHEN s.id IS NULL THEN coalesce(scr.revenue, 0) ELSE coalesce(ram.amount, 0) END)::numeric AS b_ram,
      scr.revenue::numeric AS b_recette,
      coalesce(scr.transferred_amount, 0)::numeric AS b_transferred,
      coalesce(scc.ration, 0)::numeric AS b_ration,
      coalesce(scc.carburant, 0)::numeric AS b_carburant,
      coalesce(scc.peage, 0)::numeric AS b_peage,
      coalesce(scc.autres, 0)::numeric AS b_autres,
      -- Shared between stations: a departure of the company's own bus (not a breakdown share)
      (s.id IS NOT NULL AND coalesce(s.status, '') <> 'convoi' AND NOT coalesce(scr.is_beneficiary, false)
        AND cardinality(s.shared_station_ids) > 0) AS b_shareable
    FROM scr
    LEFT JOIN schedules s  ON s.id = scr.schedule_id
    LEFT JOIN routes ro    ON ro.id = scr.route_id
    LEFT JOIN stations st  ON st.id = scr.station_id
    LEFT JOIN counters co  ON co.id = s.counter_id
    LEFT JOIN buses bu     ON bu.id = scr.bus_id
    LEFT JOIN companies cp ON cp.id = scr.company_id
    LEFT JOIN res ON res.sid = scr.schedule_id
    LEFT JOIN mob ON mob.sid = scr.schedule_id
    LEFT JOIN bag ON bag.sid = scr.schedule_id
    LEFT JOIN ram ON ram.sid = scr.schedule_id
    LEFT JOIN scc ON scc.sid = scr.schedule_id AND scc.benef = scr.is_beneficiary
    LEFT JOIN convoys cv   ON cv.schedule_id = scr.schedule_id
    -- Direct ramassage: the report row id is the collection id; its time comes from the notification
    LEFT JOIN LATERAL (
      SELECT coalesce(rn.departure_datetime, rn.collected_at, rn.created_at, rc.created_at) AS departure_datetime,
             rn.route_name AS rn_route
      FROM ramassage_collections rc
      LEFT JOIN ramassage_notifications rn ON rn.local_depart_id = rc.local_depart_id
      WHERE s.id IS NULL AND rc.id = scr.schedule_id
      LIMIT 1
    ) dr ON true
  ),
  sh AS (
    SELECT x.* FROM public.schedule_station_shares(ARRAY(SELECT b.b_id FROM b WHERE b.b_shareable)) x
  ),
  ps AS (
    SELECT sh.schedule_id AS p_id, sum(sh.seats_alloc) AS p_n, sum(sh.seats_sold) AS p_seats,
           sum(sh.tickets_amount) AS p_tickets, sum(sh.baggage_count) AS p_bag_n, sum(sh.baggage_amount) AS p_bag,
           sum(sh.exp_ration) AS p_ration, sum(sh.exp_carburant) AS p_carburant,
           sum(sh.exp_peage) AS p_peage, sum(sh.exp_autres) AS p_autres
    FROM sh WHERE sh.share_role = 'partenaire' GROUP BY sh.schedule_id
  ),
  rows_out AS (
    SELECT b.b_id, b.b_is_dep, b.b_dt, b.b_no, b.b_status, b.b_route_id, b.b_route, b.b_station_id, b.b_station,
           b.b_counter_id, b.b_counter, b.b_bus, b.b_company,
           (CASE WHEN b.b_shareable AND ps.p_id IS NOT NULL
                 THEN greatest(b.b_capacity - ps.p_n, 0) ELSE b.b_capacity END)::integer AS capacity_o,
           (b.b_seats - CASE WHEN b.b_shareable THEN coalesce(ps.p_seats, 0) ELSE 0 END)::integer AS seats_o,
           (b.b_tickets - CASE WHEN b.b_shareable THEN coalesce(ps.p_tickets, 0) ELSE 0 END)::numeric AS tickets_o,
           (b.b_bag_n - CASE WHEN b.b_shareable THEN coalesce(ps.p_bag_n, 0) ELSE 0 END)::integer AS bag_n_o,
           (b.b_bag - CASE WHEN b.b_shareable THEN coalesce(ps.p_bag, 0) ELSE 0 END)::numeric AS bag_o,
           b.b_ram AS ram_o,
           (b.b_recette - CASE WHEN b.b_shareable THEN coalesce(ps.p_tickets, 0) ELSE 0 END)::numeric AS recette_o,
           b.b_transferred AS transferred_o,
           (b.b_ration - CASE WHEN b.b_shareable THEN coalesce(ps.p_ration, 0) ELSE 0 END)::numeric AS ration_o,
           (b.b_carburant - CASE WHEN b.b_shareable THEN coalesce(ps.p_carburant, 0) ELSE 0 END)::numeric AS carburant_o,
           (b.b_peage - CASE WHEN b.b_shareable THEN coalesce(ps.p_peage, 0) ELSE 0 END)::numeric AS peage_o,
           (b.b_autres - CASE WHEN b.b_shareable THEN coalesce(ps.p_autres, 0) ELSE 0 END)::numeric AS autres_o,
           (CASE WHEN b.b_shareable AND ps.p_id IS NOT NULL THEN 'principale' END)::text AS role_o,
           (CASE WHEN b.b_shareable AND ps.p_id IS NOT NULL THEN mn.seat_from END)::integer AS from_o,
           (CASE WHEN b.b_shareable AND ps.p_id IS NOT NULL THEN mn.seat_to END)::integer AS to_o
    FROM b
    LEFT JOIN ps ON ps.p_id = b.b_id
    LEFT JOIN sh mn ON mn.schedule_id = b.b_id AND mn.share_role = 'principale'
    UNION ALL
    SELECT b.b_id, b.b_is_dep, b.b_dt, b.b_no, b.b_status, b.b_route_id, b.b_route, sh.station_id,
           coalesce(pst.name, 'Gare inconnue')::text, sh.counter_id, pco.counter_number::text, b.b_bus, b.b_company,
           sh.seats_alloc, sh.seats_sold, sh.tickets_amount, sh.baggage_count, sh.baggage_amount, 0::numeric,
           sh.tickets_amount, 0::numeric,
           sh.exp_ration, sh.exp_carburant, sh.exp_peage, sh.exp_autres,
           'partenaire'::text, sh.seat_from, sh.seat_to
    FROM sh
    JOIN b ON b.b_id = sh.schedule_id AND b.b_shareable
    LEFT JOIN stations pst ON pst.id = sh.station_id
    LEFT JOIN counters pco ON pco.id = sh.counter_id
    WHERE sh.share_role = 'partenaire'
  )
  SELECT o.b_id, o.b_is_dep, o.b_dt, o.b_no, o.b_status, o.b_route_id, o.b_route, o.b_station_id, o.b_station,
         o.b_counter_id, o.b_counter, o.b_bus, o.b_company, o.capacity_o, o.seats_o, o.tickets_o,
         o.bag_n_o, o.bag_o, o.ram_o, o.recette_o, o.transferred_o,
         o.ration_o, o.carburant_o, o.peage_o, o.autres_o, o.role_o, o.from_o, o.to_o
  FROM rows_out o
  -- date, gare, N°, then the departure itself: a fixed order, so that the pages of a long period
  -- (the API sends about 1 000 rows per request) neither repeat nor skip a row
  ORDER BY o.b_dt, o.b_station, o.b_no, o.b_id, o.role_o NULLS FIRST, o.b_station_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_gestionnaire_route_departures(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gestionnaire_route_departures(uuid, date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
