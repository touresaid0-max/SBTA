-- Fix admin_deactivate_seat: when deactivating a seat that has a reservation,
-- only remove that specific seat from the reservation (not cancel the whole thing).
DROP FUNCTION IF EXISTS admin_deactivate_seat(uuid, uuid, text, text);

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
  v_total_price numeric;
  v_total_seats integer;
  v_seat_numbers text[];
  v_passenger text;
  v_price_per_seat numeric;
  v_new_seat_numbers text[];
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
  SELECT r.id, r.total_price, r.total_seats, r.seat_numbers, r.passenger_name
  INTO v_reservation_id, v_total_price, v_total_seats, v_seat_numbers, v_passenger
  FROM reservations r
  WHERE r.schedule_id = p_schedule_id
    AND p_seat_label = ANY(r.seat_numbers)
    AND r.status IN ('confirmee', 'confirme', 'en_attente', 'payee', 'embarquee', 'embarque')
  LIMIT 1;

  -- If seat is occupied, remove only this seat from the reservation
  IF v_reservation_id IS NOT NULL THEN
    v_price_per_seat := CASE WHEN v_total_seats > 0 THEN v_total_price / v_total_seats ELSE 0 END;
    v_amount := v_price_per_seat;
    v_new_seat_numbers := array_remove(v_seat_numbers, p_seat_label);

    IF array_length(v_new_seat_numbers, 1) IS NULL OR array_length(v_new_seat_numbers, 1) = 0 THEN
      -- Last seat: cancel entire reservation
      UPDATE reservations
      SET status = 'annulee', updated_at = now()
      WHERE id = v_reservation_id;
    ELSE
      -- Remove only this seat, adjust totals
      UPDATE reservations
      SET seat_numbers = v_new_seat_numbers,
          total_seats = array_length(v_new_seat_numbers, 1),
          total_price = v_price_per_seat * array_length(v_new_seat_numbers, 1),
          updated_at = now()
      WHERE id = v_reservation_id;
    END IF;
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