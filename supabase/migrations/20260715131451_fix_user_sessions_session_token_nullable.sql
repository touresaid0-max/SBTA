/*
# Make session_token nullable and add default for user_sessions

1. Modified Tables
  - `user_sessions`: Make `session_token` column nullable and add a default of gen_random_uuid()
    so that inserts from the login flow (which don't supply a session_token) succeed.

2. Purpose
  - The login tracking for guichetiers and other roles inserts sessions without
    providing a session_token value. The NOT NULL constraint prevented these inserts.
*/

ALTER TABLE public.user_sessions ALTER COLUMN session_token SET DEFAULT gen_random_uuid()::text;
ALTER TABLE public.user_sessions ALTER COLUMN session_token DROP NOT NULL;
