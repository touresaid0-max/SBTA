/*
# Add pending_deletion status for employee permanent deletion workflow

1. Purpose
   This migration adds a new status `pending_deletion` to both the `employees`
   and `users` tables. This status is used when an RH user requests permanent
   deletion of a deactivated employee from the "Employés désactivés" page.
   The employee is then visible only to Administrators in
   Admin > Utilisateurs > Inactifs / Suspendus, where the Admin can either
   permanently delete the record or reactivate it.

2. Schema changes
   - `employees.account_status`: CHECK constraint extended to include `pending_deletion`.
   - `users.status`: CHECK constraint extended to include `pending_deletion`.
   - `employees.deletion_requested_at` (timestamptz, nullable): when the deletion was requested.
   - `employees.deletion_requested_by` (uuid, nullable): who requested the deletion.
   - `users.deletion_requested_at` (timestamptz, nullable): same, on the users table.
   - `users.deletion_requested_by` (uuid, nullable): same, on the users table.

3. Security
   No RLS policy changes — existing policies on `employees` and `users` already
   scope access by role. The new status value is covered by existing RLS.
*/

-- Extend employees.account_status CHECK to include pending_deletion
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_account_status_check;
ALTER TABLE employees ADD CONSTRAINT employees_account_status_check
  CHECK (account_status = ANY (ARRAY['pending'::text, 'active'::text, 'suspended'::text, 'inactive'::text, 'pending_deletion'::text]));

-- Extend users.status CHECK to include pending_deletion
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check
  CHECK (status = ANY (ARRAY['active'::text, 'inactive'::text, 'suspended'::text, 'repos_obligatoire'::text, 'pending_confirmation'::text, 'pending_otp'::text, 'pending_deletion'::text]));

-- Add deletion request tracking columns to employees
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'deletion_requested_at') THEN
    ALTER TABLE employees ADD COLUMN deletion_requested_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'deletion_requested_by') THEN
    ALTER TABLE employees ADD COLUMN deletion_requested_by uuid;
  END IF;
END $$;

-- Add deletion request tracking columns to users
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'deletion_requested_at') THEN
    ALTER TABLE users ADD COLUMN deletion_requested_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'deletion_requested_by') THEN
    ALTER TABLE users ADD COLUMN deletion_requested_by uuid;
  END IF;
END $$;
