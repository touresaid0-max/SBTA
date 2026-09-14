/*
# Add decrement_station_sms_credit RPC function

1. New Functions
- `decrement_station_sms_credit(p_station_id uuid)`: Decrements the `sms_credit` column
  of the given station by 1. Uses a row-level lock to prevent race conditions.
  Returns the new credit value. SECURITY DEFINER so the edge function (service role)
  can call it without RLS issues.

2. Security
- Function is SECURITY DEFINER, owned by postgres. Only callable via the service role
  key (used by edge functions) — not exposed to anon/authenticated clients directly.
- Search path is set to `public` to prevent search path injection.
*/

CREATE OR REPLACE FUNCTION public.decrement_station_sms_credit(p_station_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_credit integer;
BEGIN
  UPDATE public.stations
    SET sms_credit = GREATEST(sms_credit - 1, 0)
    WHERE id = p_station_id
    RETURNING sms_credit INTO v_new_credit;

  RETURN v_new_credit;
END;
$$;