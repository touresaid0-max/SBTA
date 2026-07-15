/*
# Add last_seen_at presence tracking to users

1. Modified Tables
  - `users`: Add `last_seen_at` (timestamptz) column to track real-time presence via heartbeat.

2. Purpose
  - Allows admin Connexion page to determine if a user is truly online by checking
    if last_seen_at is within the last 2 minutes.
  - Works alongside user_sessions for session duration tracking.

3. Security
  - Users can update their own last_seen_at via existing RLS update policies.
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'last_seen_at'
  ) THEN
    ALTER TABLE public.users ADD COLUMN last_seen_at timestamptz;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_last_seen_at ON public.users (last_seen_at DESC NULLS LAST);
