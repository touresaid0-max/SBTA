/*
# Départs partagés : chaque siège à la gare qui l'a vendu, plusieurs plages par gare (20/11/2026)

La correction 20261120260000 ne partageait un départ que si les tickets de l'autre gare formaient un
bloc au début ou à la fin du car : les départs #10, #12, #14 et #16 de DALOA (tickets de
YAMOUSSOUKRO dispersés) sont restés non partagés. Le guichet accepte maintenant plusieurs plages
par gare dans la répartition.

1. set_schedule_seat_owner(...) (interne) : donne un siège à une gare et réécrit la répartition du
   départ en plages consécutives (la gare de chaque siège : répartition, puis transferts).
2. pos_move_ticket : un ticket va sur une place libre de la gare qui l'a vendu ; à défaut, sur la
   dernière place libre du car, qui devient la sienne (départ partagé avec elle au besoin).
3. Départs du 20/11/2026 et suivants, non partagés, avec des tickets d'une autre gare : la
   répartition est créée siège par siège (siège vendu → gare du vendeur ; les autres → gare du
   départ). Sauvegarde dans schedules_alloc_backup_20261120c.
*/

-- 1. Seats → stations, written back as consecutive ranges
CREATE OR REPLACE FUNCTION public.set_schedule_seat_owner(
  p_schedule_id uuid, p_first integer, p_last integer, p_seat integer, p_station_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_al jsonb;
BEGIN
  WITH own AS (
    SELECT o.seat, CASE WHEN o.seat = p_seat THEN p_station_id ELSE o.station_id END AS st
    FROM schedule_seat_owners(p_schedule_id, p_first, p_last) o
  ),
  runs AS (
    SELECT st, min(seat) AS f, max(seat) AS t
    FROM (SELECT seat, st, seat - row_number() OVER (PARTITION BY st ORDER BY seat) AS grp FROM own) x
    GROUP BY st, grp
  )
  SELECT jsonb_agg(jsonb_build_object('station_id', r.st, 'station_name', s.name, 'seat_from', r.f, 'seat_to', r.t) ORDER BY r.f)
    INTO v_al
  FROM runs r LEFT JOIN stations s ON s.id = r.st;
  UPDATE schedules SET seat_allocations = v_al, updated_at = now() WHERE id = p_schedule_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_schedule_seat_owner(uuid, integer, integer, integer, uuid) FROM PUBLIC, anon, authenticated;

-- 2. Moving a ticket
CREATE OR REPLACE FUNCTION public.pos_move_ticket(p_reservation_id uuid, p_schedule_id uuid, p_seat integer DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res     reservations%ROWTYPE;
  v_src     schedules%ROWTYPE;
  v_dst     schedules%ROWTYPE;
  v_first   integer;
  v_last    integer;
  v_seat    integer;
  v_taken   integer[];
  v_seller  uuid;
  v_shared  boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Connexion requise';
  END IF;
  SELECT * INTO v_res FROM reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket introuvable';
  END IF;
  SELECT * INTO v_src FROM schedules WHERE id = v_res.schedule_id;
  SELECT * INTO v_dst FROM schedules WHERE id = p_schedule_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Départ cible introuvable';
  END IF;
  IF coalesce(v_dst.status, '') IN ('annule', 'termine') THEN
    RAISE EXCEPTION 'Le départ cible est clôturé ou annulé';
  END IF;

  -- Who may move it
  IF NOT (get_user_role() = 'admin'
          OR v_res.booked_by = auth.uid()
          OR (EXISTS (SELECT 1 FROM counters c
                       WHERE c.assigned_user_id = auth.uid()
                         AND (c.station_id = v_src.departure_station_id
                              OR c.station_id = ANY (coalesce(v_src.shared_station_ids, '{}'::uuid[]))))
              AND EXISTS (SELECT 1 FROM counters c
                           WHERE c.assigned_user_id = auth.uid()
                             AND (c.station_id = v_dst.departure_station_id
                                  OR c.station_id = ANY (coalesce(v_dst.shared_station_ids, '{}'::uuid[])))))) THEN
    RAISE EXCEPTION 'Ce ticket n''est pas d''un départ de votre gare';
  END IF;

  -- Seats of the target bus, and the ones already sold
  SELECT greatest(1, coalesce(b.seats_sold_from, 1)),
         greatest(1, coalesce(b.seats_sold_from, 1)) + coalesce(nullif(b.total_seats, 0), v_dst.seats_total, 0) - 1
    INTO v_first, v_last
    FROM buses b WHERE b.id = v_dst.bus_id;
  IF v_first IS NULL THEN
    v_first := 1;
    v_last := coalesce(v_dst.seats_total, 0);
  END IF;
  SELECT coalesce(array_agg(DISTINCT trim(x)::int), '{}') INTO v_taken
    FROM reservations q, unnest(q.seat_numbers) x
   WHERE q.schedule_id = p_schedule_id AND q.id <> p_reservation_id
     AND coalesce(q.status, '') NOT IN ('annulee', 'annule', 'cancelled', 'remboursee')
     AND trim(x) ~ '^[0-9]{1,6}$';

  -- The station that sold the ticket. When the target departure is shared, or when it is not one of
  -- its stations, the ticket goes on a free seat of that station; failing one, on the last free seat
  -- of the bus, which becomes that station's (the departure is then shared with it, so that its
  -- guichet sees its passengers and the reports give it their fares).
  SELECT coalesce((SELECT rs.station_id FROM reservation_sellers rs WHERE rs.reservation_id = p_reservation_id),
                  (SELECT u.station_id FROM users u WHERE u.id = v_res.booked_by))
    INTO v_seller;
  v_shared := jsonb_typeof(v_dst.seat_allocations) = 'array' AND jsonb_array_length(v_dst.seat_allocations) > 0;

  IF v_seller IS NOT NULL AND (v_shared OR v_seller IS DISTINCT FROM v_dst.departure_station_id) THEN
    SELECT o.seat INTO v_seat
      FROM schedule_seat_owners(p_schedule_id, v_first, v_last) o
     WHERE o.station_id = v_seller AND NOT (o.seat = ANY (v_taken))
     ORDER BY (o.seat = p_seat) DESC, o.seat
     LIMIT 1;
    IF v_seat IS NULL THEN
      SELECT g INTO v_seat FROM generate_series(v_first, v_last) g WHERE NOT (g = ANY (v_taken)) ORDER BY g DESC LIMIT 1;
      IF v_seat IS NOT NULL THEN
        PERFORM set_schedule_seat_owner(p_schedule_id, v_first, v_last, v_seat, v_seller);
      END IF;
    END IF;
  END IF;

  IF v_seat IS NULL THEN
    IF p_seat IS NOT NULL AND p_seat BETWEEN v_first AND v_last AND NOT (p_seat = ANY (v_taken)) THEN
      v_seat := p_seat;
    ELSE
      SELECT g INTO v_seat FROM generate_series(v_first, v_last) g WHERE NOT (g = ANY (v_taken)) ORDER BY g LIMIT 1;
    END IF;
  END IF;
  IF v_seat IS NULL THEN
    RAISE EXCEPTION 'Plus de place libre sur le départ cible';
  END IF;

  UPDATE reservations
     SET schedule_id = p_schedule_id, seat_numbers = ARRAY[v_seat::text], total_seats = 1, updated_at = now()
   WHERE id = p_reservation_id;
  RETURN v_seat;
END;
$$;

REVOKE ALL ON FUNCTION public.pos_move_ticket(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_move_ticket(uuid, uuid, integer) TO authenticated;

-- 3. The departures already in this case
CREATE TABLE IF NOT EXISTS schedules_alloc_backup_20261120c (schedule_id uuid PRIMARY KEY, seat_allocations jsonb, saved_at timestamptz DEFAULT now());
ALTER TABLE schedules_alloc_backup_20261120c ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r       record;
  v_al    jsonb;
BEGIN
  FOR r IN
    SELECT s.id AS sid, s.departure_station_id AS main_id,
           greatest(1, coalesce(b.seats_sold_from, 1)) AS f,
           greatest(1, coalesce(b.seats_sold_from, 1)) + coalesce(nullif(b.total_seats, 0), s.seats_total, 0) - 1 AS l
    FROM schedules s
    JOIN buses b ON b.id = s.bus_id
    WHERE s.departure_datetime >= '2026-11-20'
      AND coalesce(s.status, '') NOT IN ('annule', 'termine', 'convoi')
      AND (s.seat_allocations IS NULL OR jsonb_typeof(s.seat_allocations) <> 'array' OR jsonb_array_length(s.seat_allocations) = 0)
      AND EXISTS (
        SELECT 1 FROM reservations q
        LEFT JOIN reservation_sellers rs ON rs.reservation_id = q.id
        LEFT JOIN users u ON u.id = q.booked_by
        WHERE q.schedule_id = s.id
          AND coalesce(q.status, '') NOT IN ('annulee', 'annule', 'cancelled', 'remboursee')
          AND coalesce(rs.station_id, u.station_id) IS NOT NULL
          AND coalesce(rs.station_id, u.station_id) <> s.departure_station_id)
  LOOP
    WITH sold AS (
      SELECT DISTINCT ON (trim(x)::int) trim(x)::int AS seat, coalesce(rs.station_id, u.station_id) AS st
      FROM reservations q
      CROSS JOIN LATERAL unnest(q.seat_numbers) x
      LEFT JOIN reservation_sellers rs ON rs.reservation_id = q.id
      LEFT JOIN users u ON u.id = q.booked_by
      WHERE q.schedule_id = r.sid
        AND coalesce(q.status, '') NOT IN ('annulee', 'annule', 'cancelled', 'remboursee')
        AND trim(x) ~ '^[0-9]{1,6}$'
    ),
    own AS (
      SELECT g AS seat, coalesce((SELECT sold.st FROM sold WHERE sold.seat = g), r.main_id) AS st
      FROM generate_series(r.f, r.l) g
    ),
    runs AS (
      SELECT st, min(seat) AS f, max(seat) AS t
      FROM (SELECT seat, st, seat - row_number() OVER (PARTITION BY st ORDER BY seat) AS grp FROM own) x
      GROUP BY st, grp
    )
    SELECT jsonb_agg(jsonb_build_object('station_id', runs.st, 'station_name', s.name, 'seat_from', runs.f, 'seat_to', runs.t) ORDER BY runs.f)
      INTO v_al
    FROM runs LEFT JOIN stations s ON s.id = runs.st;

    CONTINUE WHEN v_al IS NULL;
    INSERT INTO schedules_alloc_backup_20261120c (schedule_id, seat_allocations)
    SELECT id, seat_allocations FROM schedules WHERE id = r.sid
    ON CONFLICT (schedule_id) DO NOTHING;
    UPDATE schedules SET seat_allocations = v_al, updated_at = now() WHERE id = r.sid;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
