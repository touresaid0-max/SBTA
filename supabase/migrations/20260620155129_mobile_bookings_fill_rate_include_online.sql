CREATE OR REPLACE FUNCTION public.auto_calculate_fill_rate()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_bus_capacity integer;
  v_seats_reserved integer;
  v_mobile_seats integer;
BEGIN
  SELECT COALESCE(b.total_seats, b.capacity, 0)
    INTO v_bus_capacity
    FROM buses b WHERE b.id = NEW.bus_id;

  IF v_bus_capacity IS NULL OR v_bus_capacity = 0 THEN
    NEW.fill_rate := 0;
    NEW.seats_available := 0;
    NEW.seats_reserved := 0;
    RETURN NEW;
  END IF;

  -- Counter reservations across all schedules sharing the same bus and departure time
  SELECT COALESCE(SUM(r.total_seats), 0)
    INTO v_seats_reserved
    FROM reservations r
    JOIN schedules s ON s.id = r.schedule_id
    WHERE s.bus_id = NEW.bus_id
      AND s.departure_datetime = NEW.departure_datetime
      AND r.status IN ('confirmee', 'confirme', 'en_attente', 'embarque');

  -- Confirmed online (mobile) bookings across those same schedules
  SELECT COALESCE(SUM(array_length(mb.assigned_seats, 1)), 0)
    INTO v_mobile_seats
    FROM mobile_bookings mb
    JOIN schedules s ON s.id = mb.schedule_id
    WHERE s.bus_id = NEW.bus_id
      AND s.departure_datetime = NEW.departure_datetime
      AND mb.status = 'confirmed';

  v_seats_reserved := v_seats_reserved + v_mobile_seats;

  NEW.fill_rate := ROUND((v_seats_reserved::numeric / v_bus_capacity::numeric) * 100, 2);
  NEW.seats_reserved  := v_seats_reserved;
  NEW.seats_available := GREATEST(0, v_bus_capacity - v_seats_reserved);

  RETURN NEW;
END;
$function$;

-- Refresh schedules that already carry confirmed online bookings
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