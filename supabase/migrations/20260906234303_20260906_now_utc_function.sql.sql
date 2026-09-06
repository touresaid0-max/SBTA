/*
# Add now_utc() RPC function

1. New Functions
   - `now_utc()`: Returns the current server time as an ISO 8601 UTC string.
     Used by the Guichet POS auto-clôture logic to determine the precise GMT
     timestamp for comparing against departure_datetime values.

2. Security
   - SECURITY DEFINER with fixed search_path (public) for safety.
   - Granted EXECUTE to authenticated and anon roles (both can call it).

3. Important Notes
   - The function is idempotent (CREATE OR REPLACE) and safe to re-run.
   - Returns `text` in ISO format (e.g. "2026-09-06T15:30:00.000Z").
   - This avoids timezone drift between client browsers and the server.
*/

CREATE OR REPLACE FUNCTION public.now_utc()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
END;
$$;

GRANT EXECUTE ON FUNCTION public.now_utc() TO authenticated;
GRANT EXECUTE ON FUNCTION public.now_utc() TO anon;