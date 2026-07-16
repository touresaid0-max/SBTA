/*
# Fix user_sessions expires_at default

The `expires_at` column has NOT NULL but no default value, causing inserts to fail
when the frontend doesn't provide it.

## Modified Tables
- `user_sessions`: add default value `(now() + interval '24 hours')` to `expires_at`

## Important Notes
1. This fixes the "null value in column expires_at" error on login.
2. Sessions default to 24h expiry unless explicitly set.
*/

ALTER TABLE user_sessions
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '24 hours');
