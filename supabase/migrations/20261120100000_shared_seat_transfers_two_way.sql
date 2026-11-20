/*
# Départs partagés : transfert de sièges dans les deux sens (20/11/2026)

« Charger dans une autre gare » : la gare principale et la gare partenaire se renvoient des sièges,
autant de fois que nécessaire. Un siège cédé est verrouillé chez celui qui l'a donné et vendable chez
celui qui l'a reçu.

Avant : le transfert était écrit par le guichet directement dans schedules.seat_transfers. Le serveur
le refusait sans erreur pour une gare partenaire (droits de modification réservés à la gare du
départ), et aucun guichet ne relisait les transferts : chaque transfert restait sur le poste qui
l'avait fait (YAMOUSSOUKRO → DALOA, sièges 32 à 41, inconnu du serveur et de DALOA).

1. transfer_schedule_seats(...) : le transfert passe par le serveur. Il verrouille le départ, vérifie
   que les sièges appartiennent bien à la gare qui les cède (répartition, puis transferts dans
   l'ordre) et qu'aucun n'est vendu, puis ajoute le transfert. Réservé à un compte de la gare qui
   cède (guichet de cette gare) ou à l'admin.
2. schedule_station_shares : les places de chaque gare (partage ration / carburant / péage, colonne
   « sièges ») tiennent compte des sièges cédés et reçus.

Prérequis : le fichier 20261118220000_reservation_seller_station.sql (table reservation_sellers).
Aucune donnée existante n'est modifiée.
*/


-- 1. Transfert de sièges entre les gares d'un départ partagé
CREATE OR REPLACE FUNCTION public.transfer_schedule_seats(
  p_schedule_id     uuid,
  p_from_station_id uuid,
  p_to_station_id   uuid,
  p_seats           integer[],
  p_transferred_by  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sc        schedules%ROWTYPE;
  v_role      text;
  v_owner     jsonb := '{}'::jsonb;   -- seat number (text) -> station id (text)
  v_stations  uuid[];
  v_a         jsonb;
  v_t         jsonb;
  v_n         integer;
  v_f         integer;
  v_to        integer;
  v_first     integer;
  v_cap       integer;
  v_last      integer;
  v_start     integer;
  v_best_f    integer;
  v_best_t    integer;
  v_seats     integer[];
  v_sold      integer[];
  v_new       jsonb;
  v_list      jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Connexion requise';
  END IF;
  v_role := get_user_role();
  IF NOT (v_role = 'admin'
          OR EXISTS (SELECT 1 FROM counters c WHERE c.assigned_user_id = auth.uid() AND c.station_id = p_from_station_id)
          OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.station_id = p_from_station_id)) THEN
    RAISE EXCEPTION 'Vous ne pouvez céder que les sièges de votre gare';
  END IF;
  IF p_from_station_id IS NULL OR p_to_station_id IS NULL OR p_from_station_id = p_to_station_id THEN
    RAISE EXCEPTION 'Choisissez une autre gare destinataire';
  END IF;

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_seats FROM unnest(p_seats) x WHERE x IS NOT NULL AND x > 0;
  IF v_seats IS NULL OR cardinality(v_seats) = 0 THEN
    RAISE EXCEPTION 'Aucun siège à transférer';
  END IF;
  IF cardinality(v_seats) > 120 THEN
    RAISE EXCEPTION 'Trop de sièges en une fois';
  END IF;

  -- The departure, locked: two transfers at the same moment are made one after the other
  SELECT * INTO v_sc FROM schedules WHERE id = p_schedule_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Départ introuvable';
  END IF;
  IF coalesce(v_sc.status, '') IN ('annule', 'termine') THEN
    RAISE EXCEPTION 'Ce départ est clôturé ou annulé';
  END IF;
  IF jsonb_typeof(v_sc.seat_allocations) <> 'array' OR jsonb_array_length(v_sc.seat_allocations) = 0 THEN
    RAISE EXCEPTION 'Ce départ n''est pas partagé entre plusieurs gares';
  END IF;

  SELECT array_agg(DISTINCT st) INTO v_stations FROM (
    SELECT (a->>'station_id')::uuid AS st FROM jsonb_array_elements(v_sc.seat_allocations) a
    WHERE a->>'station_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    UNION SELECT v_sc.departure_station_id
  ) z WHERE st IS NOT NULL;
  IF NOT (p_from_station_id = ANY (v_stations)) OR NOT (p_to_station_id = ANY (v_stations)) THEN
    RAISE EXCEPTION 'Gare absente de la répartition de ce départ';
  END IF;

  -- Seats of the bus: numbering of the bus (« vendu à partir de ») and its number of seats
  SELECT greatest(1, coalesce(b.seats_sold_from, 1)),
         coalesce(nullif(v_sc.seats_total, 0), nullif(b.total_seats, 0), 0)
    INTO v_first, v_cap
    FROM buses b WHERE b.id = v_sc.bus_id;
  v_first := coalesce(v_first, 1);
  v_cap := coalesce(v_cap, nullif(v_sc.seats_total, 0), 0);
  v_last := v_first + v_cap - 1;

  -- Owner of each seat: the ranges given at the creation (same rule as the guichet) ...
  FOR v_a IN SELECT a FROM jsonb_array_elements(v_sc.seat_allocations) a LOOP
    IF coalesce(v_a->>'seat_from', '') ~ '^[0-9]+$' AND coalesce(v_a->>'seat_to', '') ~ '^[0-9]+$' THEN
      v_f := greatest(v_first, (v_a->>'seat_from')::int);
      v_to := (v_a->>'seat_to')::int;
      FOR v_n IN v_f..v_to LOOP
        IF NOT v_owner ? v_n::text THEN
          v_owner := v_owner || jsonb_build_object(v_n::text, v_a->>'station_id');
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  -- ... the main station without a range of its own: the largest block of seats given to no one
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_sc.seat_allocations) a
                  WHERE a->>'station_id' = v_sc.departure_station_id::text) AND v_last >= v_first THEN
    v_start := NULL;
    FOR v_n IN v_first..v_last + 1 LOOP
      IF v_n <= v_last AND NOT v_owner ? v_n::text THEN
        IF v_start IS NULL THEN v_start := v_n; END IF;
      ELSIF v_start IS NOT NULL THEN
        IF v_best_f IS NULL OR (v_n - 1 - v_start) > (v_best_t - v_best_f) THEN
          v_best_f := v_start; v_best_t := v_n - 1;
        END IF;
        v_start := NULL;
      END IF;
    END LOOP;
    IF v_best_f IS NOT NULL THEN
      FOR v_n IN v_best_f..v_best_t LOOP
        v_owner := v_owner || jsonb_build_object(v_n::text, v_sc.departure_station_id::text);
      END LOOP;
    END IF;
  END IF;
  -- ... then each transfer in order (a transfer moves only seats its station held then)
  FOR v_t IN SELECT t FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_sc.seat_transfers) = 'array' THEN v_sc.seat_transfers ELSE '[]'::jsonb END) t LOOP
    FOR v_n IN
      SELECT (e #>> '{}')::int FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(v_t->'seats') = 'array' AND jsonb_array_length(v_t->'seats') > 0 THEN v_t->'seats'
             WHEN coalesce(v_t->>'seat_from', '') ~ '^[0-9]+$' AND coalesce(v_t->>'seat_to', '') ~ '^[0-9]+$'
               THEN (SELECT jsonb_agg(g) FROM generate_series((v_t->>'seat_from')::int, (v_t->>'seat_to')::int) g)
             ELSE '[]'::jsonb END) e
      WHERE (e #>> '{}') ~ '^[0-9]+$'
    LOOP
      IF v_owner->>(v_n::text) = v_t->>'from_station_id' THEN
        v_owner := v_owner || jsonb_build_object(v_n::text, v_t->>'to_station_id');
      END IF;
    END LOOP;
  END LOOP;

  -- Every seat must be held by the station that gives it ...
  FOREACH v_n IN ARRAY v_seats LOOP
    IF coalesce(v_owner->>(v_n::text), '') <> p_from_station_id::text THEN
      RAISE EXCEPTION 'Le siège n°% n''appartient pas (ou plus) à votre gare : actualisez l''écran', v_n;
    END IF;
  END LOOP;
  -- ... and free
  SELECT array_agg(DISTINCT trim(x)::int ORDER BY trim(x)::int) INTO v_sold
  FROM reservations r, unnest(r.seat_numbers) x
  WHERE r.schedule_id = p_schedule_id
    AND coalesce(r.status, '') NOT IN ('annulee', 'annule', 'cancelled', 'remboursee')
    AND trim(x) ~ '^[0-9]{1,6}$'
    AND trim(x)::int = ANY (v_seats);
  IF v_sold IS NOT NULL AND cardinality(v_sold) > 0 THEN
    RAISE EXCEPTION 'Siège(s) déjà vendu(s) : % — actualisez l''écran', array_to_string(v_sold, ', ');
  END IF;

  v_new := jsonb_build_object(
    'from_station_id', p_from_station_id,
    'to_station_id',   p_to_station_id,
    'seat_from',       v_seats[1],
    'seat_to',         v_seats[cardinality(v_seats)],
    'seats',           to_jsonb(v_seats),
    'transferred_at',  to_jsonb(now()),
    'transferred_by',  nullif(trim(coalesce(p_transferred_by, '')), ''),
    'transferred_by_user', auth.uid()
  );
  v_list := (CASE WHEN jsonb_typeof(v_sc.seat_transfers) = 'array' THEN v_sc.seat_transfers ELSE '[]'::jsonb END) || jsonb_build_array(v_new);

  UPDATE schedules SET seat_transfers = v_list, updated_at = now() WHERE id = p_schedule_id;
  RETURN v_list;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_schedule_seats(uuid, uuid, uuid, integer[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_schedule_seats(uuid, uuid, uuid, integer[], text) TO authenticated;

-- 2. Parts de chaque gare : places après les transferts
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
  stn0 AS (
    SELECT rg.sid, rg.st, min(rg.f) AS f, max(rg.t) AS t, sum(rg.t - rg.f + 1)::int AS n
    FROM rg GROUP BY rg.sid, rg.st
    UNION ALL
    SELECT s.sid, s.main_id, NULL::int, NULL::int, 0
    FROM s
    WHERE NOT EXISTS (SELECT 1 FROM rg WHERE rg.sid = s.sid AND rg.st = s.main_id)
  ),
  -- Seats moved between the stations with « Charger dans une autre gare » (both directions): the
  -- seats given leave the station, the seats received join it
  mv AS (
    SELECT x.sid, x.st, sum(x.d)::int AS d
    FROM (
      SELECT sc.id AS sid, (t->>'from_station_id')::uuid AS st,
             -(CASE WHEN jsonb_typeof(t->'seats') = 'array' AND jsonb_array_length(t->'seats') > 0
                    THEN jsonb_array_length(t->'seats')
                    ELSE greatest(0, (t->>'seat_to')::int - (t->>'seat_from')::int + 1) END) AS d
      FROM schedules sc, jsonb_array_elements(CASE WHEN jsonb_typeof(sc.seat_transfers) = 'array' THEN sc.seat_transfers ELSE '[]'::jsonb END) t
      WHERE sc.id IN (SELECT s.sid FROM s)
        AND t->>'from_station_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND coalesce(t->>'seat_from', '0') ~ '^[0-9]+$' AND coalesce(t->>'seat_to', '0') ~ '^[0-9]+$'
      UNION ALL
      SELECT sc.id, (t->>'to_station_id')::uuid,
             (CASE WHEN jsonb_typeof(t->'seats') = 'array' AND jsonb_array_length(t->'seats') > 0
                   THEN jsonb_array_length(t->'seats')
                   ELSE greatest(0, (t->>'seat_to')::int - (t->>'seat_from')::int + 1) END)
      FROM schedules sc, jsonb_array_elements(CASE WHEN jsonb_typeof(sc.seat_transfers) = 'array' THEN sc.seat_transfers ELSE '[]'::jsonb END) t
      WHERE sc.id IN (SELECT s.sid FROM s)
        AND t->>'to_station_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND coalesce(t->>'seat_from', '0') ~ '^[0-9]+$' AND coalesce(t->>'seat_to', '0') ~ '^[0-9]+$'
    ) x
    GROUP BY x.sid, x.st
  ),
  -- The seats of each station now: given at the creation, less the ones given, plus the ones received
  stn AS (
    SELECT stn0.sid, stn0.st, stn0.f, stn0.t, greatest(0, stn0.n + coalesce(mv.d, 0))::int AS n
    FROM stn0 LEFT JOIN mv ON mv.sid = stn0.sid AND mv.st = stn0.st
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
             (SELECT coalesce(rs.station_id, u.station_id)
                FROM users u
                LEFT JOIN reservation_sellers rs ON rs.reservation_id = tk.rid
               WHERE u.id = tk.booked_by
                 AND EXISTS (SELECT 1 FROM stn x WHERE x.sid = tk.sid AND x.st = coalesce(rs.station_id, u.station_id))),
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
