-- Synchronisation: tickets provisoires mobile -> tickets definitifs quand le chef de gare planifie.

-- Assigne des sieges (cote a cote si possible) et confirme une reservation mobile sur un horaire donne.
CREATE OR REPLACE FUNCTION sbta_assign_and_confirm_mobile_booking(
  p_booking_id uuid,
  p_schedule_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking      mobile_bookings%ROWTYPE;
  v_dep          timestamptz;
  v_arr          timestamptz;
  v_bus_id       uuid;
  v_bus_label    text;
  v_capacity     int;
  v_need         int;
  v_occupied     int[] := ARRAY[]::int[];
  v_assigned     int[] := ARRAY[]::int[];
  v_start        int;
  v_k            int;
  v_ok           boolean;
BEGIN
  SELECT * INTO v_booking FROM mobile_bookings
    WHERE id = p_booking_id AND status = 'provisional'
    FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT s.departure_datetime, s.arrival_datetime, s.bus_id,
         COALESCE(NULLIF(b.total_seats, 0), NULLIF(b.capacity, 0), NULLIF(s.seats_available, 0), 45),
         COALESCE(b.registration_number, 'Bus')
    INTO v_dep, v_arr, v_bus_id, v_capacity, v_bus_label
    FROM schedules s
    LEFT JOIN buses b ON b.id = s.bus_id
    WHERE s.id = p_schedule_id;
  IF v_dep IS NULL THEN RETURN; END IF;

  v_need := GREATEST(v_booking.seats_count, 1);

  -- Sieges deja occupes: reservations guichet + autres reservations mobile sur cet horaire.
  SELECT COALESCE(array_agg(n), ARRAY[]::int[]) INTO v_occupied FROM (
    SELECT (sn)::int AS n
      FROM reservations r, unnest(r.seat_numbers) AS sn
      WHERE r.schedule_id = p_schedule_id
        AND COALESCE(r.status, '') NOT IN ('cancelled', 'annulee', 'annule')
        AND sn ~ '^[0-9]+$'
    UNION
    SELECT s2 AS n
      FROM mobile_bookings mb, unnest(mb.assigned_seats) AS s2
      WHERE mb.schedule_id = p_schedule_id
        AND mb.id <> p_booking_id
  ) q;

  -- Recherche d'un bloc cote a cote.
  v_ok := false;
  FOR v_start IN 1..GREATEST(v_capacity - v_need + 1, 1) LOOP
    v_ok := true;
    FOR v_k IN 0..(v_need - 1) LOOP
      IF (v_start + v_k) = ANY (v_occupied) THEN v_ok := false; EXIT; END IF;
    END LOOP;
    IF v_ok THEN
      v_assigned := ARRAY(SELECT generate_series(v_start, v_start + v_need - 1));
      EXIT;
    END IF;
  END LOOP;

  -- Repli: premiers sieges libres disponibles.
  IF NOT v_ok THEN
    v_assigned := ARRAY[]::int[];
    FOR v_k IN 1..v_capacity LOOP
      IF NOT (v_k = ANY (v_occupied)) THEN
        v_assigned := array_append(v_assigned, v_k);
        IF array_length(v_assigned, 1) >= v_need THEN EXIT; END IF;
      END IF;
    END LOOP;
  END IF;

  -- Capacite insuffisante: on laisse le ticket provisoire.
  IF array_length(v_assigned, 1) IS DISTINCT FROM v_need THEN RETURN; END IF;

  UPDATE mobile_bookings SET
    schedule_id    = p_schedule_id,
    assigned_seats = v_assigned,
    bus_label      = v_bus_label,
    departure_time = to_char(v_dep, 'HH24:MI'),
    arrival_time   = COALESCE(to_char(v_arr, 'HH24:MI'), arrival_time),
    status         = 'confirmed',
    updated_at     = now()
  WHERE id = p_booking_id;
END;
$$;

-- Trouve un horaire planifie correspondant a une reservation mobile provisoire.
CREATE OR REPLACE FUNCTION sbta_find_schedule_for_booking(p_booking_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking mobile_bookings%ROWTYPE;
  v_schedule_id uuid;
BEGIN
  SELECT * INTO v_booking FROM mobile_bookings WHERE id = p_booking_id;
  IF NOT FOUND OR v_booking.route_id IS NULL OR v_booking.time_slot IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT s.id INTO v_schedule_id
    FROM schedules s
    LEFT JOIN stations ds ON ds.id = s.departure_station_id
    LEFT JOIN stations ars ON ars.id = s.arrival_station_id
    WHERE s.route_id = v_booking.route_id
      AND s.departure_datetime::date = v_booking.travel_date
      AND COALESCE(s.status, '') NOT IN ('annule', 'annulee', 'cancelled', 'termine')
      AND (v_booking.origin_station IS NULL OR ds.name IS NULL OR v_booking.origin_station = ds.name)
      AND (v_booking.destination_station IS NULL OR ars.name IS NULL OR v_booking.destination_station = ars.name)
      AND EXTRACT(HOUR FROM s.departure_datetime) >= split_part(v_booking.time_slot, '-', 1)::int
      AND EXTRACT(HOUR FROM s.departure_datetime) <= split_part(v_booking.time_slot, '-', 2)::int
    ORDER BY s.departure_datetime
    LIMIT 1;

  RETURN v_schedule_id;
END;
$$;

-- RPC appelee a la creation: confirme immediatement si un horaire correspondant existe deja.
CREATE OR REPLACE FUNCTION sbta_confirm_pending_mobile_booking(p_booking_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schedule_id uuid;
  v_status text;
BEGIN
  v_schedule_id := sbta_find_schedule_for_booking(p_booking_id);
  IF v_schedule_id IS NOT NULL THEN
    PERFORM sbta_assign_and_confirm_mobile_booking(p_booking_id, v_schedule_id);
  END IF;
  SELECT status INTO v_status FROM mobile_bookings WHERE id = p_booking_id;
  RETURN v_status;
END;
$$;

GRANT EXECUTE ON FUNCTION sbta_confirm_pending_mobile_booking(uuid) TO authenticated;

-- Trigger: a chaque nouvel horaire, transforme les tickets provisoires correspondants.
CREATE OR REPLACE FUNCTION sbta_convert_provisional_on_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking_id uuid;
BEGIN
  IF COALESCE(NEW.status, '') IN ('annule', 'annulee', 'cancelled', 'termine') THEN
    RETURN NEW;
  END IF;

  FOR v_booking_id IN
    SELECT mb.id
      FROM mobile_bookings mb
      LEFT JOIN stations ds ON ds.id = NEW.departure_station_id
      LEFT JOIN stations ars ON ars.id = NEW.arrival_station_id
      WHERE mb.status = 'provisional'
        AND mb.route_id = NEW.route_id
        AND mb.travel_date = NEW.departure_datetime::date
        AND (mb.origin_station IS NULL OR ds.name IS NULL OR mb.origin_station = ds.name)
        AND (mb.destination_station IS NULL OR ars.name IS NULL OR mb.destination_station = ars.name)
        AND EXTRACT(HOUR FROM NEW.departure_datetime) >= split_part(mb.time_slot, '-', 1)::int
        AND EXTRACT(HOUR FROM NEW.departure_datetime) <= split_part(mb.time_slot, '-', 2)::int
      ORDER BY mb.created_at
  LOOP
    PERFORM sbta_assign_and_confirm_mobile_booking(v_booking_id, NEW.id);
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sbta_convert_provisional ON schedules;
CREATE TRIGGER trg_sbta_convert_provisional
  AFTER INSERT ON schedules
  FOR EACH ROW
  EXECUTE FUNCTION sbta_convert_provisional_on_schedule();

NOTIFY pgrst, 'reload schema';
