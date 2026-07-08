-- Fix admin_cancel_seat: only remove the specific seat from the reservation,
-- not cancel the entire reservation when it has multiple seats.
DROP FUNCTION IF EXISTS admin_cancel_seat(uuid, uuid, text, text);

CREATE OR REPLACE FUNCTION admin_cancel_seat(
  p_reservation_id uuid,
  p_schedule_id uuid,
  p_seat_label text,
  p_reason text
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bus_id uuid;
  v_total_price numeric;
  v_total_seats integer;
  v_seat_numbers text[];
  v_passenger text;
  v_admin_id uuid;
  v_price_per_seat numeric;
  v_new_seat_numbers text[];
BEGIN
  v_admin_id := auth.uid();

  -- Get bus_id from the schedule
  SELECT s.bus_id INTO v_bus_id
  FROM schedules s
  WHERE s.id = p_schedule_id;

  -- Get reservation details
  SELECT r.total_price, r.total_seats, r.seat_numbers, r.passenger_name
  INTO v_total_price, v_total_seats, v_seat_numbers, v_passenger
  FROM reservations r
  WHERE r.id = p_reservation_id
    AND r.schedule_id = p_schedule_id
    AND r.status IN ('confirmee', 'confirme', 'en_attente', 'payee', 'embarquee', 'embarque');

  IF v_seat_numbers IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Reservation introuvable ou deja annulee');
  END IF;

  -- Verify the seat is actually in this reservation
  IF NOT (p_seat_label = ANY(v_seat_numbers)) THEN
    RETURN json_build_object('success', false, 'error', 'Ce siege ne fait pas partie de cette reservation');
  END IF;

  -- Calculate price per seat
  v_price_per_seat := CASE WHEN v_total_seats > 0 THEN v_total_price / v_total_seats ELSE 0 END;

  -- Remove the specific seat from the array
  v_new_seat_numbers := array_remove(v_seat_numbers, p_seat_label);

  IF array_length(v_new_seat_numbers, 1) IS NULL OR array_length(v_new_seat_numbers, 1) = 0 THEN
    -- Last seat in reservation: cancel the entire reservation
    UPDATE reservations
    SET status = 'annulee', updated_at = now()
    WHERE id = p_reservation_id;
  ELSE
    -- Still has other seats: just remove this seat and adjust totals
    UPDATE reservations
    SET seat_numbers = v_new_seat_numbers,
        total_seats = array_length(v_new_seat_numbers, 1),
        total_price = v_price_per_seat * array_length(v_new_seat_numbers, 1),
        updated_at = now()
    WHERE id = p_reservation_id;
  END IF;

  -- Log the cancellation
  INSERT INTO seat_cancellations (schedule_id, bus_id, reservation_id, seat_label, action_type, reason, amount_deducted, passenger_name, admin_user_id)
  VALUES (p_schedule_id, v_bus_id, p_reservation_id, p_seat_label, 'cancel', p_reason, v_price_per_seat, v_passenger, v_admin_id);

  RETURN json_build_object(
    'success', true,
    'amount_deducted', v_price_per_seat,
    'passenger_name', v_passenger
  );
END;
$$;