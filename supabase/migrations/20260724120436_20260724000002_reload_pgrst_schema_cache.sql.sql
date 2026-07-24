-- Reload PostgREST schema cache so it picks up the new SECURITY DEFINER helper functions
NOTIFY pgrst, 'reload schema';
