-- Allow DG (Directeur General) to access DAF RPC functions
-- The is_daf_user() helper is used by all DAF consolidated/exploitation/parcel RPCs
-- to gate access. Adding 'dg' so DG sees exactly the same data as DAF.

CREATE OR REPLACE FUNCTION public.is_daf_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'role') = ANY(ARRAY['daf', 'dg']),
    false
  );
$$;
