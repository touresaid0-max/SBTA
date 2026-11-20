/*
# Guichet : déplacer un ticket vers un autre départ, quel que soit le compte qui l'a vendu
  (20/11/2026)

« Modifier le départ » avec un car plus petit : les tickets en trop vont au départ suivant. Le poste
envoyait ce déplacement comme une modification directe du billet, qu'un guichetier n'a le droit de
faire que sur les billets qu'il a vendus lui-même. Les billets vendus par un autre compte (gare
partenaire, autre guichet de la gare) étaient refusés (« droits insuffisants », 10 opérations à
DALOA le 20/11/2026) : sur le poste ils étaient sur le nouveau départ, sur le serveur sur l'ancien.

pos_move_ticket(p_reservation_id, p_schedule_id, p_seat) : déplace le billet vers le départ
p_schedule_id, au siège p_seat s'il existe dans le car et est libre, sinon à la première place libre
du car. Autorisé à l'admin, au vendeur du billet, et au guichetier d'une gare du départ d'origine
(gare principale ou partenaire) quand le départ cible est aussi d'une de ses gares. Renvoie le siège
attribué. La réimpression du ticket est autorisée automatiquement (migration 20261120220000).
*/

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

  IF p_seat IS NOT NULL AND p_seat BETWEEN v_first AND v_last AND NOT (p_seat = ANY (v_taken)) THEN
    v_seat := p_seat;
  ELSE
    SELECT g INTO v_seat FROM generate_series(v_first, v_last) g WHERE NOT (g = ANY (v_taken)) ORDER BY g LIMIT 1;
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

NOTIFY pgrst, 'reload schema';
