-- Drop existing functions
DROP FUNCTION IF EXISTS admin_cancel_seat(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS admin_deactivate_seat(uuid, uuid, text, text);

-- Recreate admin_cancel_seat: fix references to non-existent columns
-- reservations has total_price (not amount), and no bus_id column
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
  v_amount numeric;
  v_passenger text;
  v_admin_id uuid;
BEGIN
  v_admin_id := auth.uid();

  -- Get bus_id from the schedule (not from reservation which has no bus_id)
  SELECT s.bus_id INTO v_bus_id
  FROM schedules s
  WHERE s.id = p_schedule_id;

  -- Get reservation details: use total_price (not amount which doesnt exist)
  -- Expand status check to include confirme, en_attente
  SELECT r.total_price, r.passenger_name
  INTO v_amount, v_passenger
  FROM reservations r
  WHERE r.id = p_reservation_id
    AND r.schedule_id = p_schedule_id
    AND r.status IN ('confirmee', 'confirme', 'en_attente', 'payee', 'embarquee', 'embarque');

  IF v_passenger IS NULL AND v_amount IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Reservation introuvable ou deja annulee');
  END IF;

  -- Mark reservation as cancelled
  UPDATE reservations
  SET status = 'annulee', updated_at = now()
  WHERE id = p_reservation_id;

  -- Log the cancellation
  INSERT INTO seat_cancellations (schedule_id, bus_id, reservation_id, seat_label, action_type, reason, amount_deducted, passenger_name, admin_user_id)
  VALUES (p_schedule_id, v_bus_id, p_reservation_id, p_seat_label, 'cancel', p_reason, COALESCE(v_amount, 0), v_passenger, v_admin_id);

  RETURN json_build_object(
    'success', true,
    'amount_deducted', COALESCE(v_amount, 0),
    'passenger_name', v_passenger
  );
END;
$$;

-- Recreate admin_deactivate_seat: fix total_price reference and remove bus_id from reservation query
CREATE OR REPLACE FUNCTION admin_deactivate_seat(
  p_schedule_id uuid,
  p_bus_id uuid,
  p_seat_label text,
  p_reason text
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_config_id uuid;
  v_layout jsonb;
  v_new_layout jsonb;
  v_admin_id uuid;
  v_reservation_id uuid;
  v_amount numeric := 0;
  v_passenger text;
BEGIN
  v_admin_id := auth.uid();

  -- Get the seat config for this bus
  SELECT bsc.id, bsc.seat_layout::jsonb
  INTO v_config_id, v_layout
  FROM bus_seat_config bsc
  JOIN buses b ON b.seat_config_id = bsc.id
  WHERE b.id = p_bus_id;

  IF v_config_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Configuration de siege introuvable');
  END IF;

  -- Check if there is an active reservation on this seat for this schedule
  -- Note: no bus_id filter on reservations since that column doesnt exist
  SELECT r.id, r.total_price, r.passenger_name
  INTO v_reservation_id, v_amount, v_passenger
  FROM reservations r
  WHERE r.schedule_id = p_schedule_id
    AND p_seat_label = ANY(r.seat_numbers)
    AND r.status IN ('confirmee', 'confirme', 'en_attente', 'payee', 'embarquee', 'embarque')
  LIMIT 1;

  -- If seat is occupied, cancel the reservation first
  IF v_reservation_id IS NOT NULL THEN
    UPDATE reservations
    SET status = 'annulee', updated_at = now()
    WHERE id = v_reservation_id;
  END IF;

  -- Update seat_layout to mark this seat as hors_service
  v_new_layout := (
    SELECT jsonb_agg(
      jsonb_set(
        row_obj,
        '{seats}',
        (
          SELECT jsonb_agg(
            CASE
              WHEN seat_obj->>'label' = p_seat_label
              THEN jsonb_set(seat_obj, '{type}', '"hors_service"')
              ELSE seat_obj
            END
          )
          FROM jsonb_array_elements(row_obj->'seats') seat_obj
        )
      )
    )
    FROM jsonb_array_elements(v_layout) row_obj
  );

  UPDATE bus_seat_config
  SET seat_layout = v_new_layout::json
  WHERE id = v_config_id;

  -- Log the deactivation
  INSERT INTO seat_cancellations (schedule_id, bus_id, reservation_id, seat_label, action_type, reason, amount_deducted, passenger_name, admin_user_id)
  VALUES (p_schedule_id, p_bus_id, v_reservation_id, p_seat_label, 'deactivate', p_reason, COALESCE(v_amount, 0), v_passenger, v_admin_id);

  RETURN json_build_object(
    'success', true,
    'had_reservation', v_reservation_id IS NOT NULL,
    'amount_deducted', COALESCE(v_amount, 0),
    'passenger_name', v_passenger
  );
END;
$$;