/*
# Rapport du gestionnaire : exporter tous les départs en une fois

Le détail des départs ne se demandait que ligne par ligne. Le responsable veut un seul fichier
Excel avec tous les départs de toutes les lignes de la période.

`get_gestionnaire_route_departures(p_route_id, p_from, p_to)` :
  - `p_route_id` NULL : tous les départs de toutes les lignes de la société du gestionnaire ;
  - une colonne `route_id` en plus, pour rapprocher chaque départ de sa ligne du rapport ;
  - un ordre fixe (date, gare, N°, départ) pour lire une longue période en plusieurs pages.

Le reste ne change pas : réservé au gestionnaire, sa société seulement, mêmes chiffres que le
rapport (schedule_company_revenue / schedule_company_charges), lecture seule.

Le type de résultat change (colonne ajoutée) : la fonction est supprimée puis recréée, avec les
mêmes droits. L'écran déjà en ligne continue de marcher (il ignore la colonne ajoutée).
*/

DROP FUNCTION IF EXISTS public.get_gestionnaire_route_departures(uuid, date, date);

CREATE FUNCTION public.get_gestionnaire_route_departures(p_route_id uuid, p_from date, p_to date)
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
  exp_autres           numeric
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
  )
  SELECT
    scr.schedule_id,
    (s.id IS NOT NULL),
    coalesce(s.departure_datetime, dr.departure_datetime, scr.schedule_date::timestamptz),
    coalesce(s.route_number, s.departure_number)::integer,
    (CASE WHEN s.id IS NULL THEN 'ramassage_direct' ELSE s.status END)::text,
    scr.route_id,
    coalesce(ro.name, s.route_name, 'Ligne inconnue')::text,
    scr.station_id,
    coalesce(st.name, 'Gare inconnue')::text,
    s.counter_id,
    co.counter_number::text,
    bu.registration_number::text,
    cp.name::text,
    (CASE WHEN s.id IS NULL THEN 0
          ELSE coalesce(nullif(s.seats_total, 0), nullif(bu.total_seats, 0), 0) END)::integer,
    (coalesce(res.seats, 0) + coalesce(mob.seats, 0))::integer,
    (CASE WHEN s.status = 'convoi' THEN coalesce(cv.amount, 0)
          ELSE coalesce(res.amount, 0) + coalesce(mob.amount, 0) END)::numeric,
    coalesce(bag.n, 0)::integer,
    coalesce(bag.amount, 0)::numeric,
    (CASE WHEN s.id IS NULL THEN coalesce(scr.revenue, 0) ELSE coalesce(ram.amount, 0) END)::numeric,
    scr.revenue::numeric,
    coalesce(scr.transferred_amount, 0)::numeric,
    coalesce(scc.ration, 0)::numeric,
    coalesce(scc.carburant, 0)::numeric,
    coalesce(scc.peage, 0)::numeric,
    coalesce(scc.autres, 0)::numeric
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
    SELECT coalesce(rn.departure_datetime, rn.collected_at, rn.created_at, rc.created_at) AS departure_datetime
    FROM ramassage_collections rc
    LEFT JOIN ramassage_notifications rn ON rn.local_depart_id = rc.local_depart_id
    WHERE s.id IS NULL AND rc.id = scr.schedule_id
    LIMIT 1
  ) dr ON true
  -- date, gare, N°, then the departure itself: a fixed order, so that the pages of a long period
  -- (the API sends about 1 000 rows per request) neither repeat nor skip a departure
  ORDER BY 3, 9, 4, 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_gestionnaire_route_departures(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gestionnaire_route_departures(uuid, date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
