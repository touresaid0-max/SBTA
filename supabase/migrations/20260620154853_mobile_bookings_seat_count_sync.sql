CREATE OR REPLACE FUNCTION recalc_schedule_seats(p_schedule_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_seats int;
  v_sold_seats int;
BEGIN
  IF p_schedule_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(b.total_seats, 0) INTO v_total_seats
    FROM schedules s JOIN buses b ON b.id = s.bus_id
    WHERE s.id = p_schedule_id;

  SELECT
    COALESCE((
      SELECT SUM(array_length(r.seat_numbers, 1))
        FROM reservations r
        WHERE r.schedule_id = p_schedule_id
          AND r.status IN ('confirme','confirmee','en_attente','embarque')
    ), 0)
    + COALESCE((
      SELECT SUM(array_length(mb.assigned_seats, 1))
        FROM mobile_bookings mb
        WHERE mb.schedule_id = p_schedule_id
          AND mb.status = 'confirmed'
    ), 0)
  INTO v_sold_seats;

  UPDATE schedules
    SET seats_reserved = v_sold_seats,
        seats_available = GREATEST(0, COALESCE(v_total_seats, 0) - v_sold_seats)
    WHERE id = p_schedule_id;
END;
$$;

CREATE OR REPLACE FUNCTION sync_schedule_seat_counts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.schedule_id IS DISTINCT FROM NEW.schedule_id THEN
    PERFORM recalc_schedule_seats(OLD.schedule_id);
    PERFORM recalc_schedule_seats(NEW.schedule_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM recalc_schedule_seats(OLD.schedule_id);
  ELSE
    PERFORM recalc_schedule_seats(NEW.schedule_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_schedule_seats ON reservations;
CREATE TRIGGER trg_sync_schedule_seats
  AFTER INSERT OR UPDATE OR DELETE ON reservations
  FOR EACH ROW
  EXECUTE FUNCTION sync_schedule_seat_counts();

DROP TRIGGER IF EXISTS trg_sync_schedule_seats_mobile ON mobile_bookings;
CREATE TRIGGER trg_sync_schedule_seats_mobile
  AFTER INSERT OR UPDATE OR DELETE ON mobile_bookings
  FOR EACH ROW
  EXECUTE FUNCTION sync_schedule_seat_counts();

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT schedule_id
      FROM mobile_bookings
      WHERE status = 'confirmed' AND schedule_id IS NOT NULL
  LOOP
    PERFORM recalc_schedule_seats(r.schedule_id);
  END LOOP;
END $$;