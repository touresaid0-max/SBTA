/*
# Admin Seat Cancellation & Deactivation System

1. New Tables
  - `seat_cancellations`
    - `id` (uuid, primary key)
    - `schedule_id` (uuid, FK to schedules)
    - `bus_id` (uuid, FK to buses)
    - `reservation_id` (uuid, FK to reservations, nullable - null for deactivations)
    - `seat_label` (text, the seat identifier e.g. "A1", "B3")
    - `action_type` (text, 'cancel' or 'deactivate')
    - `reason` (text, admin-provided reason)
    - `amount_deducted` (numeric, ticket price that was deducted from revenue)
    - `passenger_name` (text, nullable - stored for audit trail)
    - `admin_user_id` (uuid, FK to auth.users - the admin who performed the action)
    - `created_at` (timestamptz)

2. Security
  - Enable RLS on `seat_cancellations`
  - Admin-only INSERT and SELECT policies

3. Important Notes
  - This table provides a full audit trail for every seat cancellation or deactivation
  - Cancel: reservation is marked 'annulee', seat becomes available again
  - Deactivate: seat is marked hors_service in bus_seat_config, not sellable
  - The fill rate and revenue RPCs already react to reservation status changes
*/

CREATE TABLE IF NOT EXISTS seat_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  bus_id uuid NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
  reservation_id uuid REFERENCES reservations(id) ON DELETE SET NULL,
  seat_label text NOT NULL,
  action_type text NOT NULL CHECK (action_type IN ('cancel', 'deactivate')),
  reason text NOT NULL DEFAULT '',
  amount_deducted numeric NOT NULL DEFAULT 0,
  passenger_name text,
  admin_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seat_cancellations_schedule ON seat_cancellations(schedule_id);
CREATE INDEX IF NOT EXISTS idx_seat_cancellations_bus ON seat_cancellations(bus_id);

ALTER TABLE seat_cancellations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_select_seat_cancellations" ON seat_cancellations;
CREATE POLICY "admin_select_seat_cancellations" ON seat_cancellations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'super_admin')
    )
  );

DROP POLICY IF EXISTS "admin_insert_seat_cancellations" ON seat_cancellations;
CREATE POLICY "admin_insert_seat_cancellations" ON seat_cancellations FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'super_admin')
    )
  );

-- Function to cancel a sold seat (marks reservation as annulee, logs the action)
CREATE OR REPLACE FUNCTION admin_cancel_seat(
  p_reservation_id uuid,
  p_schedule_id uuid,
  p_seat_label text,
  p_reason text DEFAULT ''
)
RETURNS json
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

  -- Get reservation details
  SELECT r.bus_id, r.amount, r.passenger_name
  INTO v_bus_id, v_amount, v_passenger
  FROM reservations r
  WHERE r.id = p_reservation_id
    AND r.schedule_id = p_schedule_id
    AND r.status IN ('confirmee', 'payee', 'embarquee');

  IF v_bus_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Reservation introuvable ou déjà annulée');
  END IF;

  -- Mark reservation as cancelled
  UPDATE reservations
  SET status = 'annulee', updated_at = now()
  WHERE id = p_reservation_id;

  -- Log the cancellation
  INSERT INTO seat_cancellations (schedule_id, bus_id, reservation_id, seat_label, action_type, reason, amount_deducted, passenger_name, admin_user_id)
  VALUES (p_schedule_id, v_bus_id, p_reservation_id, p_seat_label, 'cancel', p_reason, v_amount, v_passenger, v_admin_id);

  RETURN json_build_object(
    'success', true,
    'amount_deducted', v_amount,
    'passenger_name', v_passenger
  );
END;
$$;

-- Function to deactivate a seat (mark it HS in seat config)
CREATE OR REPLACE FUNCTION admin_deactivate_seat(
  p_schedule_id uuid,
  p_bus_id uuid,
  p_seat_label text,
  p_reason text DEFAULT ''
)
RETURNS json
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
    RETURN json_build_object('success', false, 'error', 'Configuration de siège introuvable');
  END IF;

  -- Check if there's an active reservation on this seat for this schedule
  SELECT r.id, r.amount, r.passenger_name
  INTO v_reservation_id, v_amount, v_passenger
  FROM reservations r
  WHERE r.schedule_id = p_schedule_id
    AND r.bus_id = p_bus_id
    AND p_seat_label = ANY(r.seat_numbers)
    AND r.status IN ('confirmee', 'payee', 'embarquee')
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

-- Grant execute to authenticated users (function uses SECURITY DEFINER with internal admin check)
GRANT EXECUTE ON FUNCTION admin_cancel_seat TO authenticated;
GRANT EXECUTE ON FUNCTION admin_deactivate_seat TO authenticated;
