/*
# Enforce the first commercial seat when locking seats

1. Purpose
- Enforce the bus-level `seats_sold_from` setting in the shared seat-lock RPC.
- Prevent a seat before that number from being temporarily reserved by the Guichet POS, online booking, or kiosk flows.

2. Data changes
- No tables, columns, or existing records are changed.
- The total bus capacity remains unchanged.

3. Security and business rules
- The server rejects seat locks below the configured first commercial seat.
- A missing or invalid setting continues to mean seat 1, preserving existing behavior.
- Existing reservation and lock checks remain unchanged.

4. Compatibility
- The existing RPC signature and return shape are preserved.
- The rule applies only to the requested seat number and does not alter seat allocation or pricing.
*/

CREATE OR REPLACE FUNCTION public.try_lock_seat(
  p_schedule_id  uuid,
  p_seat_number  text,
  p_session_id   text DEFAULT ''
)
RETURNS TABLE (
  out_id          uuid,
  out_schedule_id uuid,
  out_seat_number text,
  out_locked_by   uuid,
  out_session_id  text,
  out_expires_at  timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   uuid := auth.uid();
  v_existing  seat_locks%ROWTYPE;
  v_new_exp   timestamptz := now() + interval '3 minutes';
  v_seats_sold_from integer;
  v_seat_number integer;
BEGIN
  v_seat_number := NULLIF(trim(p_seat_number), '')::integer;

  SELECT GREATEST(1, COALESCE(b.seats_sold_from, 1))
    INTO v_seats_sold_from
    FROM schedules s
    JOIN buses b ON b.id = s.bus_id
   WHERE s.id = p_schedule_id;

  IF v_seat_number IS NOT NULL
     AND v_seats_sold_from IS NOT NULL
     AND v_seat_number < v_seats_sold_from THEN
    RETURN;
  END IF;

  DELETE FROM seat_locks WHERE seat_locks.expires_at <= now();

  IF EXISTS (
    SELECT 1 FROM reservations r
    WHERE r.schedule_id = p_schedule_id
      AND r.seat_numbers @> ARRAY[p_seat_number]::text[]
      AND r.status IN ('confirme','confirmee','en_attente','embarque')
  ) THEN
    RETURN;
  END IF;

  SELECT * INTO v_existing
    FROM seat_locks sl
    WHERE sl.schedule_id = p_schedule_id
      AND sl.seat_number = p_seat_number;

  IF FOUND THEN
    IF v_user_id IS NOT NULL AND v_existing.locked_by = v_user_id THEN
      UPDATE seat_locks SET expires_at = v_new_exp, session_id = p_session_id
       WHERE seat_locks.id = v_existing.id
      RETURNING seat_locks.id, seat_locks.schedule_id, seat_locks.seat_number,
                seat_locks.locked_by, seat_locks.session_id, seat_locks.expires_at
      INTO out_id, out_schedule_id, out_seat_number, out_locked_by, out_session_id, out_expires_at;
      RETURN NEXT;
      RETURN;
    END IF;
    IF v_user_id IS NULL AND v_existing.session_id = p_session_id AND p_session_id != '' THEN
      UPDATE seat_locks SET expires_at = v_new_exp
       WHERE seat_locks.id = v_existing.id
      RETURNING seat_locks.id, seat_locks.schedule_id, seat_locks.seat_number,
                seat_locks.locked_by, seat_locks.session_id, seat_locks.expires_at
      INTO out_id, out_schedule_id, out_seat_number, out_locked_by, out_session_id, out_expires_at;
      RETURN NEXT;
      RETURN;
    END IF;
    RETURN;
  END IF;

  INSERT INTO seat_locks(schedule_id, seat_number, locked_by, session_id, expires_at)
  VALUES (p_schedule_id, p_seat_number, v_user_id, p_session_id, v_new_exp)
  ON CONFLICT (schedule_id, seat_number) DO NOTHING
  RETURNING seat_locks.id, seat_locks.schedule_id, seat_locks.seat_number,
            seat_locks.locked_by, seat_locks.session_id, seat_locks.expires_at
  INTO out_id, out_schedule_id, out_seat_number, out_locked_by, out_session_id, out_expires_at;

  IF out_id IS NOT NULL THEN
    RETURN NEXT;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.try_lock_seat(uuid, text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';