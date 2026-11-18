/*
# Départs partagés : le billet va à la gare qui l'a vendu

Constat (18/11/2026, ATTECOUBE, car 3250 JJ 06, départ N°3) : la gare principale avait donné ses
premiers sièges à YOP-DIVO sans garder de plage pour elle ; les 23 billets vendus par ATTECOUBE
étaient comptés chez YOP-DIVO, parce que le billet allait à la gare de la plage de son siège.

Nouvelle règle, demandée le 18/11 : un billet d'un départ partagé va à la gare de son vendeur
(gare du compte qui l'a vendu), quand cette gare est l'une des gares du départ ; sinon à la gare de
la plage du siège ; sinon à la gare principale. L'argent est ainsi compté là où il a été encaissé.
Les bagages suivent leur billet ; le partage des dépenses ne change pas.

Seule la fonction de calcul des parts change (même nom, mêmes colonnes) : les rapports DAF/DG,
gestionnaire et chef de gare l'utilisent tous. Aucune donnée n'est modifiée.
*/

CREATE OR REPLACE FUNCTION public.schedule_station_shares(p_schedule_ids uuid[])
RETURNS TABLE (
  schedule_id    uuid,
  station_id     uuid,
  share_role     text,
  seat_from      integer,
  seat_to        integer,
  seats_alloc    integer,
  counter_id     uuid,
  seats_sold     integer,
  tickets_amount numeric,
  baggage_count  integer,
  baggage_amount numeric,
  exp_ration     numeric,
  exp_carburant  numeric,
  exp_peage      numeric,
  exp_autres     numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH s AS (
    SELECT sc.id AS sid, sc.departure_station_id AS main_id, sc.seat_allocations AS al,
           coalesce(nullif(sc.seats_total, 0), (SELECT nullif(bu.total_seats, 0) FROM buses bu WHERE bu.id = sc.bus_id), 0) AS cap
    FROM schedules sc
    WHERE sc.id = ANY (p_schedule_ids)
      AND coalesce(sc.status, '') <> 'convoi'
      AND sc.departure_station_id IS NOT NULL
      AND jsonb_typeof(sc.seat_allocations) = 'array'
      AND cardinality(sc.shared_station_ids) > 0
  ),
  -- Each seat range of the departure
  rg AS (
    SELECT s.sid, (a->>'station_id')::uuid AS st, (a->>'seat_from')::int AS f, (a->>'seat_to')::int AS t
    FROM s, jsonb_array_elements(s.al) a
    WHERE a->>'station_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND a->>'seat_from' ~ '^[0-9]+$' AND a->>'seat_to' ~ '^[0-9]+$'
      AND (a->>'seat_to')::int >= (a->>'seat_from')::int
  ),
  -- Each station of the departure with its seats. The main station is always there, even when the
  -- guichet recorded no range for it (the partner range starting at seat 1): no seat range then.
  stn AS (
    SELECT rg.sid, rg.st, min(rg.f) AS f, max(rg.t) AS t, sum(rg.t - rg.f + 1)::int AS n
    FROM rg GROUP BY rg.sid, rg.st
    UNION ALL
    SELECT s.sid, s.main_id, NULL::int, NULL::int, 0
    FROM s
    WHERE NOT EXISTS (SELECT 1 FROM rg WHERE rg.sid = s.sid AND rg.st = s.main_id)
  ),
  -- Places of the bus: the seats given to no station stay with the main station, so a partner
  -- station pays the bus expenses for its own seats only
  tot AS (
    SELECT stn.sid, greatest(sum(stn.n), max(s.cap)) AS n
    FROM stn JOIN s ON s.sid = stn.sid
    GROUP BY stn.sid
  ),
  -- Tickets of the departure (same as the DAF report), at the station of their first seat
  tk AS (
    SELECT r.id AS rid, r.schedule_id AS sid, r.booked_by,
           coalesce(nullif(r.total_seats, 0), cardinality(r.seat_numbers), 1)::int AS seats,
           coalesce(r.total_price, 0)::numeric AS amount,
           (SELECT trim(x::text)::int FROM unnest(r.seat_numbers) x
             WHERE trim(x::text) ~ '^[0-9]{1,6}$' LIMIT 1) AS seat
    FROM reservations r
    WHERE r.schedule_id IN (SELECT s.sid FROM s)
      AND coalesce(r.status, '') NOT IN ('annulee', 'annule', 'cancelled', 'remboursee')
      AND (r.status IN ('confirmee', 'utilisee', 'confirmed', 'paid')
           OR r.payment_status IN ('payee', 'paid'))
  ),
  -- The station of each ticket: the station of its seller when it is one of the stations of the
  -- departure (the cash is there), otherwise the station of the seat range, otherwise the main one
  tks AS (
    SELECT tk.*, coalesce(
             (SELECT u.station_id FROM users u
               WHERE u.id = tk.booked_by
                 AND EXISTS (SELECT 1 FROM stn x WHERE x.sid = tk.sid AND x.st = u.station_id)),
             (SELECT rg.st FROM rg WHERE rg.sid = tk.sid AND tk.seat BETWEEN rg.f AND rg.t LIMIT 1),
             s.main_id) AS st
    FROM tk JOIN s ON s.sid = tk.sid
  ),
  -- Paid baggage: station of the linked ticket, otherwise the main station
  bg AS (
    SELECT b.schedule_id AS sid, coalesce(tks.st, s.main_id) AS st, coalesce(b.price, 0)::numeric AS price
    FROM baggage_tickets b
    JOIN s ON s.sid = b.schedule_id
    LEFT JOIN tks ON tks.rid = b.reservation_id
    WHERE coalesce(b.payment_status, '') <> 'en_attente'
  ),
  cc AS (
    SELECT c.schedule_id AS sid, c.station_id AS cst, c.charge_type, coalesce(c.amount, 0)::numeric AS amount
    FROM counter_charges c
    WHERE c.schedule_id IN (SELECT s.sid FROM s) AND coalesce(c.status, '') <> 'rejete'
  ),
  bus_exp AS (
    SELECT cc.sid,
           coalesce(sum(cc.amount) FILTER (WHERE cc.charge_type = 'ration'), 0) AS ration,
           coalesce(sum(cc.amount) FILTER (WHERE cc.charge_type IN ('carburant_complement', 'carburant')), 0) AS carburant,
           coalesce(sum(cc.amount) FILTER (WHERE cc.charge_type = 'peage'), 0) AS peage
    FROM cc GROUP BY cc.sid
  )
  SELECT
    stn.sid,
    stn.st,
    (CASE WHEN stn.st = s.main_id THEN 'principale' ELSE 'partenaire' END)::text,
    stn.f::integer,
    stn.t::integer,
    stn.n::integer,
    (CASE WHEN stn.st = s.main_id THEN NULL ELSE coalesce(
      (SELECT c.counter_id FROM counter_charges c
        WHERE c.schedule_id = stn.sid AND c.station_id = stn.st AND c.counter_id IS NOT NULL
        GROUP BY c.counter_id ORDER BY count(*) DESC LIMIT 1),
      (SELECT b.counter_id FROM baggage_tickets b
        WHERE b.schedule_id = stn.sid AND b.station_id = stn.st AND b.counter_id IS NOT NULL
        GROUP BY b.counter_id ORDER BY count(*) DESC LIMIT 1),
      (SELECT co.id FROM tks JOIN counters co ON co.assigned_user_id = tks.booked_by AND co.station_id = stn.st
        WHERE tks.sid = stn.sid AND tks.st = stn.st
        GROUP BY co.id ORDER BY count(*) DESC LIMIT 1)) END)::uuid,
    coalesce((SELECT sum(tks.seats) FROM tks WHERE tks.sid = stn.sid AND tks.st = stn.st), 0)::integer,
    coalesce((SELECT sum(tks.amount) FROM tks WHERE tks.sid = stn.sid AND tks.st = stn.st), 0)::numeric,
    (SELECT count(*) FROM bg WHERE bg.sid = stn.sid AND bg.st = stn.st)::integer,
    coalesce((SELECT sum(bg.price) FROM bg WHERE bg.sid = stn.sid AND bg.st = stn.st), 0)::numeric,
    (CASE WHEN tot.n > 0 THEN round(coalesce(be.ration, 0) * stn.n / tot.n) ELSE 0 END)::numeric,
    (CASE WHEN tot.n > 0 THEN round(coalesce(be.carburant, 0) * stn.n / tot.n) ELSE 0 END)::numeric,
    (CASE WHEN tot.n > 0 THEN round(coalesce(be.peage, 0) * stn.n / tot.n) ELSE 0 END)::numeric,
    coalesce((SELECT sum(cc.amount) FROM cc
      WHERE cc.sid = stn.sid
        AND cc.charge_type NOT IN ('ration', 'carburant_complement', 'carburant', 'peage')
        AND (CASE WHEN EXISTS (SELECT 1 FROM stn x WHERE x.sid = cc.sid AND x.st = cc.cst)
                  THEN cc.cst ELSE s.main_id END) = stn.st), 0)::numeric
  FROM stn
  JOIN s ON s.sid = stn.sid
  JOIN tot ON tot.sid = stn.sid
  LEFT JOIN bus_exp be ON be.sid = stn.sid;
$$;

REVOKE ALL ON FUNCTION public.schedule_station_shares(uuid[]) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
