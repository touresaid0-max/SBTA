/*
# Ticket transféré vers un départ qui ne dessert pas sa gare (20/11/2026)

Départ #12 de DALOA : 10 passagers vendus par YAMOUSSOUKRO y ont été transférés (car trop petit
sur les #9 et #11). Le #12 n'étant pas partagé avec YAMOUSSOUKRO, son guichet ne voyait ni le
départ, ni ses passagers, ni leurs réimpressions, et les rapports donnaient leur recette à DALOA.

1. pos_move_ticket : quand le ticket vient d'une gare qui n'est pas une gare du départ cible, ce
   départ est partagé avec elle. Ses sièges sont pris en fin de car, côte à côte (la plage de la
   gare principale est raccourcie d'autant), et le ticket y est placé. Une gare déjà présente a ses
   sièges libres d'abord, puis le siège juste avant sa plage.
2. Départs du 20/11/2026 et suivants déjà dans ce cas, non partagés : la répartition est créée
   quand les tickets de l'autre gare forment un bloc au début ou à la fin du car (sauvegarde dans
   schedules_alloc_backup_20261120b).
*/

-- 1. Le déplacement d'un ticket
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
  v_main    uuid;
  v_al      jsonb;
  v_idx     integer;
  v_from    integer;
  v_to      integer;
  v_changed boolean := false;
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

  -- The station that sold the ticket: the target departure is shared with it when it is not one of
  -- its stations, so that its guichet sees its passengers (and the reports give it their fares).
  -- Its seats are taken at the end of the bus, next to each other.
  v_main := v_dst.departure_station_id;
  SELECT coalesce((SELECT rs.station_id FROM reservation_sellers rs WHERE rs.reservation_id = p_reservation_id),
                  (SELECT u.station_id FROM users u WHERE u.id = v_res.booked_by))
    INTO v_seller;
  v_al := CASE WHEN jsonb_typeof(v_dst.seat_allocations) = 'array' THEN v_dst.seat_allocations ELSE '[]'::jsonb END;

  IF v_seller IS NOT NULL AND v_seller IS DISTINCT FROM v_main THEN
    IF jsonb_array_length(v_al) = 0 THEN
      v_al := jsonb_build_array(jsonb_build_object(
        'station_id', v_main, 'station_name', (SELECT name FROM stations WHERE id = v_main),
        'seat_from', v_first, 'seat_to', v_last));
    END IF;
    SELECT (a->>'seat_from')::int, (a->>'seat_to')::int, (o - 1)::int INTO v_from, v_to, v_idx
      FROM jsonb_array_elements(v_al) WITH ORDINALITY AS e(a, o)
     WHERE a->>'station_id' = v_seller::text LIMIT 1;
    IF v_idx IS NOT NULL THEN
      -- A free seat of its range first, else the seat just before it (taken from the range ending there)
      SELECT g INTO v_seat FROM generate_series(greatest(v_from, v_first), least(v_to, v_last)) g
       WHERE NOT (g = ANY (v_taken)) ORDER BY (g = p_seat) DESC, g LIMIT 1;
      IF v_seat IS NULL AND v_from - 1 >= v_first AND NOT ((v_from - 1) = ANY (v_taken)) THEN
        SELECT (o - 1)::int INTO v_to
          FROM jsonb_array_elements(v_al) WITH ORDINALITY AS e(a, o)
         WHERE (a->>'seat_to')::int = v_from - 1 AND (a->>'seat_from')::int < v_from - 1 LIMIT 1;
        IF v_to IS NOT NULL THEN
          v_al := jsonb_set(v_al, ARRAY[v_to::text, 'seat_to'], to_jsonb(v_from - 2));
          v_al := jsonb_set(v_al, ARRAY[v_idx::text, 'seat_from'], to_jsonb(v_from - 1));
          v_seat := v_from - 1;
          v_changed := true;
        END IF;
      END IF;
    ELSIF NOT (v_last = ANY (v_taken)) THEN
      -- Not a station of the departure yet: the last seat of the bus, taken from the range ending there
      SELECT (o - 1)::int INTO v_to
        FROM jsonb_array_elements(v_al) WITH ORDINALITY AS e(a, o)
       WHERE (a->>'seat_to')::int = v_last AND (a->>'seat_from')::int < v_last LIMIT 1;
      IF v_to IS NOT NULL THEN
        v_al := jsonb_set(v_al, ARRAY[v_to::text, 'seat_to'], to_jsonb(v_last - 1));
        v_al := v_al || jsonb_build_array(jsonb_build_object(
          'station_id', v_seller, 'station_name', (SELECT name FROM stations WHERE id = v_seller),
          'seat_from', v_last, 'seat_to', v_last));
        v_seat := v_last;
        v_changed := true;
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

  IF v_changed THEN
    UPDATE schedules SET seat_allocations = v_al, updated_at = now() WHERE id = p_schedule_id;
  END IF;
  UPDATE reservations
     SET schedule_id = p_schedule_id, seat_numbers = ARRAY[v_seat::text], total_seats = 1, updated_at = now()
   WHERE id = p_reservation_id;
  RETURN v_seat;
END;
$$;

REVOKE ALL ON FUNCTION public.pos_move_ticket(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_move_ticket(uuid, uuid, integer) TO authenticated;

-- 2. Les départs déjà dans ce cas
CREATE TABLE IF NOT EXISTS schedules_alloc_backup_20261120b (schedule_id uuid PRIMARY KEY, seat_allocations jsonb, saved_at timestamptz DEFAULT now());
ALTER TABLE schedules_alloc_backup_20261120b ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r       record;
  v_first integer;
  v_last  integer;
  v_al    jsonb;
BEGIN
  FOR r IN
    WITH t AS (
      SELECT s.id AS sid, s.departure_station_id AS main_id, s.bus_id, s.seats_total,
             coalesce(rs.station_id, u.station_id) AS seller, trim(x)::int AS seat
      FROM schedules s
      JOIN reservations q ON q.schedule_id = s.id
      CROSS JOIN LATERAL unnest(q.seat_numbers) x
      LEFT JOIN reservation_sellers rs ON rs.reservation_id = q.id
      LEFT JOIN users u ON u.id = q.booked_by
      WHERE s.departure_datetime >= '2026-11-20'
        AND coalesce(s.status, '') NOT IN ('annule', 'termine', 'convoi')
        AND (s.seat_allocations IS NULL OR jsonb_typeof(s.seat_allocations) <> 'array' OR jsonb_array_length(s.seat_allocations) = 0)
        AND coalesce(q.status, '') NOT IN ('annulee', 'annule', 'cancelled', 'remboursee')
        AND trim(x) ~ '^[0-9]{1,6}$'
    )
    SELECT t.sid, t.main_id, t.bus_id, t.seats_total, t.seller,
           min(t.seat) AS f, max(t.seat) AS l, count(*) AS n
    FROM t
    WHERE t.seller IS NOT NULL AND t.seller <> t.main_id
    GROUP BY t.sid, t.main_id, t.bus_id, t.seats_total, t.seller
  LOOP
    -- One other station only, its tickets side by side, nobody else inside its block
    CONTINUE WHEN r.n <> r.l - r.f + 1;
    CONTINUE WHEN (SELECT count(DISTINCT coalesce(rs.station_id, u.station_id))
                     FROM reservations q LEFT JOIN reservation_sellers rs ON rs.reservation_id = q.id
                     LEFT JOIN users u ON u.id = q.booked_by
                    WHERE q.schedule_id = r.sid
                      AND coalesce(q.status, '') NOT IN ('annulee', 'annule', 'cancelled', 'remboursee')
                      AND coalesce(rs.station_id, u.station_id) IS DISTINCT FROM r.main_id) > 1;
    SELECT greatest(1, coalesce(b.seats_sold_from, 1)),
           greatest(1, coalesce(b.seats_sold_from, 1)) + coalesce(nullif(b.total_seats, 0), r.seats_total, 0) - 1
      INTO v_first, v_last FROM buses b WHERE b.id = r.bus_id;
    CONTINUE WHEN v_first IS NULL;
    IF r.f <= v_first THEN
      v_al := jsonb_build_array(
        jsonb_build_object('station_id', r.seller, 'station_name', (SELECT name FROM stations WHERE id = r.seller), 'seat_from', v_first, 'seat_to', r.l),
        jsonb_build_object('station_id', r.main_id, 'station_name', (SELECT name FROM stations WHERE id = r.main_id), 'seat_from', r.l + 1, 'seat_to', v_last));
    ELSIF r.l >= v_last THEN
      v_al := jsonb_build_array(
        jsonb_build_object('station_id', r.main_id, 'station_name', (SELECT name FROM stations WHERE id = r.main_id), 'seat_from', v_first, 'seat_to', r.f - 1),
        jsonb_build_object('station_id', r.seller, 'station_name', (SELECT name FROM stations WHERE id = r.seller), 'seat_from', r.f, 'seat_to', v_last));
    ELSE
      CONTINUE;
    END IF;
    INSERT INTO schedules_alloc_backup_20261120b (schedule_id, seat_allocations)
    SELECT id, seat_allocations FROM schedules WHERE id = r.sid
    ON CONFLICT (schedule_id) DO NOTHING;
    UPDATE schedules SET seat_allocations = v_al, updated_at = now() WHERE id = r.sid;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
