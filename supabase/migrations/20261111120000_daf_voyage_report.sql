/*
# Rapports détaillés voyage (DAF et DG)

Une ligne par départ de la période, consolidée par la base : la page en déduit les totaux, le
rapport par ligne, par gare et par société, sans télécharger chaque ticket (un an de ventes, ce
sont des dizaines de milliers de lignes).

Pour chaque départ :
  - tickets : réservations confirmées ou payées (pas les annulées), plus les réservations mobiles
    confirmées ; pour un convoi, le montant du convoi (même règle que les rapports DAF) ;
  - bagages : tickets bagage du départ ; ramassage : collectes rattachées au départ ;
  - dépenses : charges du guichet (counter_charges, sauf rejetées), ou celles du convoi ;
  - capacité : nombre de places du départ, sinon celles du bus.

Droits : DAF, DG et administrateur seulement, vérifié une fois au début. La fonction tourne avec
les droits de son propriétaire pour ne pas revérifier les règles d'accès sur chaque ligne (le
tableau de bord admin dépassait le délai pour cette raison). RLS reste activé partout.
*/

CREATE OR REPLACE FUNCTION public.get_daf_voyage_report(p_from date, p_to date)
RETURNS TABLE (
  schedule_id          uuid,
  departure_datetime   timestamptz,
  departure_number     integer,
  status               text,
  route_id             uuid,
  route_name           text,
  station_id           uuid,
  station_name         text,
  arrival_station_name text,
  counter_id           uuid,
  counter_number       text,
  bus_id               uuid,
  bus_registration     text,
  company_id           uuid,
  company_name         text,
  capacity             integer,
  seats_sold           integer,
  tickets_amount       numeric,
  baggage_count        integer,
  baggage_amount       numeric,
  ramassage_amount     numeric,
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
BEGIN
  IF NOT (public.is_daf_user() OR coalesce(public.get_user_role(), '') IN ('daf', 'dg', 'admin')
          OR session_user = 'postgres') THEN
    RAISE EXCEPTION 'Rapport réservé au DAF, au DG et à l''administrateur' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH s AS (
    SELECT sc.*
    FROM schedules sc
    WHERE sc.departure_datetime::date BETWEEN p_from AND p_to
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
  )
  SELECT
    s.id,
    s.departure_datetime::timestamptz,
    s.departure_number::integer,
    s.status::text,
    s.route_id,
    coalesce(ro.name, s.route_name)::text,
    s.departure_station_id,
    st.name::text,
    sa.name::text,
    s.counter_id,
    co.counter_number::text,
    s.bus_id,
    bu.registration_number::text,
    bu.company_id,
    cp.name::text,
    coalesce(nullif(s.seats_total, 0), nullif(bu.total_seats, 0), 0)::integer,
    (coalesce(res.seats, 0) + coalesce(mob.seats, 0))::integer,
    (CASE WHEN s.status = 'convoi' THEN coalesce(cv.amount, 0)
          ELSE coalesce(res.amount, 0) + coalesce(mob.amount, 0) END)::numeric,
    coalesce(bag.n, 0)::integer,
    coalesce(bag.amount, 0)::numeric,
    coalesce(ram.amount, 0)::numeric,
    (CASE WHEN s.status = 'convoi' THEN coalesce(cv.ratio_amount, 0)     ELSE coalesce(chg.ration, 0) END)::numeric,
    (CASE WHEN s.status = 'convoi' THEN coalesce(cv.carburant_amount, 0) ELSE coalesce(chg.carburant, 0) END)::numeric,
    (CASE WHEN s.status = 'convoi' THEN coalesce(cv.peage_amount, 0)     ELSE coalesce(chg.peage, 0) END)::numeric,
    (CASE WHEN s.status = 'convoi' THEN coalesce(cv.autres_amount, 0)    ELSE coalesce(chg.autres, 0) END)::numeric
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
  ORDER BY s.departure_datetime DESC, s.id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_daf_voyage_report(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daf_voyage_report(date, date) TO authenticated;
