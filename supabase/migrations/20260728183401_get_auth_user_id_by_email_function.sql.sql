
-- Fast lookup of an auth user by email, callable from edge functions via RPC.
-- SECURITY DEFINER so the edge function (service role) can read auth.users
-- without exposing the whole table through PostgREST.
CREATE OR REPLACE FUNCTION public.get_auth_user_id_by_email(p_email text)
RETURNS TABLE (id uuid, email text, email_confirmed_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT u.id, u.email, u.email_confirmed_at
  FROM auth.users u
  WHERE lower(u.email) = lower(p_email)
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_auth_user_id_by_email(text) TO authenticated, anon, service_role;
