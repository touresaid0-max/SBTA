/*
# Changement de car : passagers sur un siège qui n'existe plus (20/11/2026)

« Modifier le départ » avec un car plus petit (2048LZ02, 63 places → 2515 JX02, 61 places) : le
guichet ne déplaçait des billets que si leur NOMBRE dépassait les places du nouveau car. Les billets
des sièges 62 et 63 restaient sur des sièges inexistants (départs #4 et #6 de DALOA), et la
répartition entre gares dépassait le car.

1. schedule_seat_owners(p_schedule_id, p_first, p_last) : la gare de chaque siège du car
   (répartition, puis dernier transfert du siège ; la gare principale pour un siège sans gare).
2. reseat_schedule_out_of_bus(p_schedule_id, p_bus_id) (interne) : avec le car p_bus_id (celui du
   départ si NULL), raccourcit la répartition à la taille du car et replace chaque billet hors du car
   sur une place libre : d'abord une place de la gare qui l'a vendu, sinon une autre place libre.
   Renvoie les billets replacés et ceux sans place (à transférer vers un autre départ).
3. reseat_after_bus_change(p_schedule_id, p_bus_id) : la même chose pour le guichet (compte d'une
   gare du départ, ou admin).
*/

CREATE OR REPLACE FUNCTION public.schedule_seat_owners(p_schedule_id uuid, p_first integer, p_last integer)
RETURNS TABLE (seat integer, station_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT g,
         coalesce(
           (SELECT (t->>'to_station_id')::uuid
              FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.seat_transfers) = 'array' THEN s.seat_transfers ELSE '[]'::jsonb END) WITH ORDINALITY AS e(t, o)
             WHERE t->>'to_station_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               AND (CASE WHEN jsonb_typeof(t->'seats') = 'array' AND jsonb_array_length(t->'seats') > 0
                         THEN t->'seats' @> to_jsonb(g)
                         WHEN coalesce(t->>'seat_from', '') ~ '^[0-9]+$' AND coalesce(t->>'seat_to', '') ~ '^[0-9]+$'
                         THEN g BETWEEN (t->>'seat_from')::int AND (t->>'seat_to')::int
                         ELSE false END)
             ORDER BY o DESC LIMIT 1),
           (SELECT (a->>'station_id')::uuid
              FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.seat_allocations) = 'array' THEN s.seat_allocations ELSE '[]'::jsonb END) a
             WHERE a->>'station_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               AND coalesce(a->>'seat_from', '') ~ '^[0-9]+$' AND coalesce(a->>'seat_to', '') ~ '^[0-9]+$'
               AND g BETWEEN (a->>'seat_from')::int AND (a->>'seat_to')::int
             LIMIT 1),
           s.departure_station_id)
  FROM schedules s, generate_series(p_first, p_last) g
  WHERE s.id = p_schedule_id;
$$;

REVOKE ALL ON FUNCTION public.schedule_seat_owners(uuid, integer, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reseat_schedule_out_of_bus(p_schedule_id uuid, p_bus_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sc       schedules%ROWTYPE;
  v_first    integer;
  v_cap      integer;
  v_last     integer;
  v_al       jsonb;
  v_moved    jsonb := '[]'::jsonb;
  v_unplaced jsonb := '[]'::jsonb;
  v_new      integer;
  r          record;
BEGIN
  SELECT * INTO v_sc FROM schedules WHERE id = p_schedule_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Départ introuvable';
  END IF;
  SELECT greatest(1, coalesce(b.seats_sold_from, 1)), coalesce(nullif(b.total_seats, 0), 0)
    INTO v_first, v_cap
    FROM buses b WHERE b.id = coalesce(p_bus_id, v_sc.bus_id);
  IF v_cap IS NULL OR v_cap <= 0 THEN
    RETURN jsonb_build_object('moved', v_moved, 'unplaced', v_unplaced, 'seat_allocations', v_sc.seat_allocations);
  END IF;
  v_last := v_first + v_cap - 1;

  -- 1. The seat ranges of the stations, cut to the seats of the bus
  IF jsonb_typeof(v_sc.seat_allocations) = 'array' AND jsonb_array_length(v_sc.seat_allocations) > 0 THEN
    SELECT coalesce(jsonb_agg(a || jsonb_build_object(
             'seat_from', greatest(v_first, (a->>'seat_from')::int),
             'seat_to',   least(v_last, (a->>'seat_to')::int)) ORDER BY o), '[]'::jsonb)
      INTO v_al
      FROM jsonb_array_elements(v_sc.seat_allocations) WITH ORDINALITY AS e(a, o)
     WHERE coalesce(a->>'seat_from', '') ~ '^[0-9]+$' AND coalesce(a->>'seat_to', '') ~ '^[0-9]+$'
       AND least(v_last, (a->>'seat_to')::int) >= greatest(v_first, (a->>'seat_from')::int);
    IF jsonb_array_length(v_al) > 0 AND v_al IS DISTINCT FROM v_sc.seat_allocations THEN
      UPDATE schedules SET seat_allocations = v_al, updated_at = now() WHERE id = p_schedule_id;
    ELSE
      v_al := v_sc.seat_allocations;
    END IF;
  END IF;

  -- 2. Each ticket on a seat outside the bus: a free seat of the station that sold it, else another
  FOR r IN
    SELECT res.id AS rid, x AS seat_txt, trim(x)::int AS seat, res.booking_reference AS ticket,
           res.passenger_name AS passenger, coalesce(rs.station_id, u.station_id) AS seller
    FROM reservations res
    CROSS JOIN LATERAL unnest(res.seat_numbers) x
    LEFT JOIN reservation_sellers rs ON rs.reservation_id = res.id
    LEFT JOIN users u ON u.id = res.booked_by
    WHERE res.schedule_id = p_schedule_id
      AND coalesce(res.status, '') NOT IN ('annulee', 'annule', 'cancelled', 'remboursee')
      AND trim(x) ~ '^[0-9]{1,6}$'
      AND (trim(x)::int > v_last OR trim(x)::int < v_first)
    ORDER BY trim(x)::int
  LOOP
    SELECT o.seat INTO v_new
      FROM schedule_seat_owners(p_schedule_id, v_first, v_last) o
     WHERE NOT EXISTS (
             SELECT 1 FROM reservations q, unnest(q.seat_numbers) y
              WHERE q.schedule_id = p_schedule_id
                AND coalesce(q.status, '') NOT IN ('annulee', 'annule', 'cancelled', 'remboursee')
                AND trim(y) ~ '^[0-9]{1,6}$' AND trim(y)::int = o.seat)
     ORDER BY (o.station_id IS NOT DISTINCT FROM r.seller) DESC, o.seat
     LIMIT 1;
    IF v_new IS NULL THEN
      v_unplaced := v_unplaced || jsonb_build_array(jsonb_build_object(
        'reservation_id', r.rid, 'ticket', r.ticket, 'passenger', r.passenger, 'seat', r.seat));
      CONTINUE;
    END IF;
    UPDATE reservations
       SET seat_numbers = array_replace(seat_numbers, r.seat_txt, v_new::text), updated_at = now()
     WHERE id = r.rid;
    v_moved := v_moved || jsonb_build_array(jsonb_build_object(
      'reservation_id', r.rid, 'ticket', r.ticket, 'passenger', r.passenger, 'from', r.seat, 'to', v_new));
  END LOOP;

  RETURN jsonb_build_object('moved', v_moved, 'unplaced', v_unplaced, 'seat_allocations', coalesce(v_al, v_sc.seat_allocations));
END;
$$;

REVOKE ALL ON FUNCTION public.reseat_schedule_out_of_bus(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reseat_after_bus_change(p_schedule_id uuid, p_bus_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sc schedules%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Connexion requise';
  END IF;
  SELECT * INTO v_sc FROM schedules WHERE id = p_schedule_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Départ introuvable';
  END IF;
  IF NOT (get_user_role() = 'admin'
          OR EXISTS (
            SELECT 1 FROM counters c
             WHERE c.assigned_user_id = auth.uid()
               AND (c.station_id = v_sc.departure_station_id
                    OR c.station_id = ANY (coalesce(v_sc.shared_station_ids, '{}'::uuid[]))))
          OR EXISTS (
            SELECT 1 FROM users u
             WHERE u.id = auth.uid()
               AND (u.station_id = v_sc.departure_station_id
                    OR u.station_id = ANY (coalesce(v_sc.shared_station_ids, '{}'::uuid[]))))) THEN
    RAISE EXCEPTION 'Ce départ n''est pas celui de votre gare';
  END IF;
  RETURN reseat_schedule_out_of_bus(p_schedule_id, p_bus_id);
END;
$$;

REVOKE ALL ON FUNCTION public.reseat_after_bus_change(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reseat_after_bus_change(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
