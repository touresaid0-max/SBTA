/*
# Add assistance_gp flag to users table

## Purpose
Allows creating an "Assistance Gérant Principal" sub-profile that has restricted
access (only Gestion des réparations + Gestion du stock) within the Gérant Principal role.

## Changes
1. New column: `users.assistance_gp` (boolean, default false)
   - When true, the user is an "Assistance Gérant Principal" with restricted menu access
   - When false (default), the user is a regular Gérant Principal with full access

## Security
- No RLS policy changes needed — the column is readable by the user themselves
  and by admins, consistent with existing users table policies
- The flag is only set during account creation by the admin edge function
*/

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS assistance_gp boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
