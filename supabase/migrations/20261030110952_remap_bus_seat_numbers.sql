/*
# Remap seat numbers on bookings after a bus seat plan renumbering

1. Purpose
- When an admin renumbers seats in the bus seat-plan editor (e.g. seat 1 -> 2, which shifts old 2 -> 3, 3 -> 4 ...),
  existing bookings and sales must follow the physical seat. This function applies an old->new label mapping
  to every seat reference of the bus's active trips (schedules with status 'planifie' or 'en_cours').
  Finished ('termine') and cancelled ('annule') trips are left untouched as history.

2. New functions
- `_remap_seat_json(v jsonb, m jsonb)`: internal helper that maps one JSON seat value (number or string).
- `remap_bus_seat_numbers(p_bus_id uuid, p_mapping jsonb) returns integer`: applies the mapping
  (JSON object {"old":"new"}) in a single transaction and returns the number of rows changed.

3. Tables updated (rows of the bus's active schedules only; no columns added or removed)
- reservations.seat_numbers, kiosk_tickets.seat_numbers, mobile_bookings.assigned_seats,
  baggage_tickets.seat_number, seat_cancellations.seat_label, ticket_reprint_authorizations.seat_label,
  seat_locks.seat_number (two-pass to respect the unique (schedule_id, seat_number) constraint),
  schedules.seat_transfers (seats / seat_from / seat_to inside each transfer entry).

4. Security
- SECURITY DEFINER with fixed search_path; only users whose role is 'admin' may call it
  (same rule as updating seat configurations). EXECUTE revoked from PUBLIC/anon, granted to authenticated.
  The helper is not callable by API roles.

5. Notes
- The mapping is applied simultaneously (2->3 and 3->4 never chain into 2->4).
- Booking status is not changed, so loyalty-point triggers do not fire again.
*/

CREATE OR REPLACE FUNCTION public._remap_seat_json(v jsonb, m jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN v IS NULL OR jsonb_typeof(v) NOT IN ('number','string') OR NOT (m ? (v #>> '{}')) THEN v
    WHEN jsonb_typeof(v) = 'number' AND (m ->> (v #>> '{}')) ~ '^\d+$' THEN to_jsonb((m ->> (v #>> '{}'))::int)
    WHEN jsonb_typeof(v) = 'number' THEN v
    ELSE to_jsonb(m ->> (v #>> '{}'))
  END
$$;

REVOKE EXECUTE ON FUNCTION public._remap_seat_json(jsonb, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.remap_bus_seat_numbers(p_bus_id uuid, p_mapping jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total integer := 0;
  v_n integer;
  v_keys text[];
  v_schedules uuid[];
BEGIN
  IF COALESCE(public.get_user_role(), '') <> 'admin' THEN
    RAISE EXCEPTION 'Accès refusé' USING ERRCODE = '42501';
  END IF;

  IF p_bus_id IS NULL OR p_mapping IS NULL OR jsonb_typeof(p_mapping) <> 'object' THEN
    RETURN 0;
  END IF;

  SELECT array_agg(k) INTO v_keys FROM jsonb_object_keys(p_mapping) k;
  IF v_keys IS NULL THEN
    RETURN 0;
  END IF;

  SELECT array_agg(id) INTO v_schedules
  FROM schedules
  WHERE bus_id = p_bus_id AND status IN ('planifie', 'en_cours');
  IF v_schedules IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE reservations r
  SET seat_numbers = (
    SELECT array_agg(COALESCE(p_mapping ->> s, s) ORDER BY o)
    FROM unnest(r.seat_numbers) WITH ORDINALITY u(s, o)
  )
  WHERE r.schedule_id = ANY (v_schedules) AND r.seat_numbers && v_keys;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

  UPDATE kiosk_tickets k
  SET seat_numbers = (
    SELECT array_agg(COALESCE(p_mapping ->> s, s) ORDER BY o)
    FROM unnest(k.seat_numbers) WITH ORDINALITY u(s, o)
  )
  WHERE k.schedule_id = ANY (v_schedules) AND k.seat_numbers && v_keys;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

  UPDATE mobile_bookings mb
  SET assigned_seats = (
    SELECT array_agg(
      CASE WHEN (p_mapping ->> s::text) ~ '^\d+$' THEN (p_mapping ->> s::text)::int ELSE s END
      ORDER BY o)
    FROM unnest(mb.assigned_seats) WITH ORDINALITY u(s, o)
  )
  WHERE mb.schedule_id = ANY (v_schedules)
    AND EXISTS (SELECT 1 FROM unnest(mb.assigned_seats) s WHERE p_mapping ? s::text);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

  UPDATE baggage_tickets
  SET seat_number = p_mapping ->> seat_number
  WHERE schedule_id = ANY (v_schedules) AND seat_number = ANY (v_keys);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

  UPDATE seat_cancellations
  SET seat_label = p_mapping ->> seat_label
  WHERE schedule_id = ANY (v_schedules) AND seat_label = ANY (v_keys);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

  UPDATE ticket_reprint_authorizations
  SET seat_label = p_mapping ->> seat_label
  WHERE schedule_id = ANY (v_schedules) AND seat_label = ANY (v_keys);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

  -- Two passes: the unique (schedule_id, seat_number) constraint is checked row by row.
  UPDATE seat_locks
  SET seat_number = '~remap~' || (p_mapping ->> seat_number)
  WHERE schedule_id = ANY (v_schedules) AND seat_number = ANY (v_keys);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
  UPDATE seat_locks
  SET seat_number = substr(seat_number, 8)
  WHERE schedule_id = ANY (v_schedules) AND seat_number LIKE '~remap~%';

  UPDATE schedules s
  SET seat_transfers = (
    SELECT jsonb_agg(
      CASE WHEN jsonb_typeof(t) = 'object' THEN
        t
        || CASE WHEN jsonb_typeof(t -> 'seats') = 'array' THEN jsonb_build_object('seats', (
              SELECT COALESCE(jsonb_agg(public._remap_seat_json(x, p_mapping) ORDER BY xo), '[]'::jsonb)
              FROM jsonb_array_elements(t -> 'seats') WITH ORDINALITY e2(x, xo))) ELSE '{}'::jsonb END
        || CASE WHEN t ? 'seat_from' THEN jsonb_build_object('seat_from', public._remap_seat_json(t -> 'seat_from', p_mapping)) ELSE '{}'::jsonb END
        || CASE WHEN t ? 'seat_to' THEN jsonb_build_object('seat_to', public._remap_seat_json(t -> 'seat_to', p_mapping)) ELSE '{}'::jsonb END
      ELSE t END
      ORDER BY o)
    FROM jsonb_array_elements(s.seat_transfers) WITH ORDINALITY e(t, o)
  )
  WHERE s.id = ANY (v_schedules)
    AND jsonb_typeof(s.seat_transfers) = 'array'
    AND jsonb_array_length(s.seat_transfers) > 0;

  RETURN v_total;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.remap_bus_seat_numbers(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remap_bus_seat_numbers(uuid, jsonb) TO authenticated;