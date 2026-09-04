/*
# Point garage_reparations.technicien_id to employees instead of auth.users

## Context
Technicians are created as rows in `employees` (role = 'mecanicien').  Their
user account may be created later by an Admin and remains optional — the
technician must be assignable to a repair even with `account_status = 'pending'`.

The old foreign key on `garage_reparations.technicien_id` referenced
`auth.users(id)`, which prevented assigning pending technicians (no auth row
yet).  This migration repoints the FK to `employees(id)` and rewrites existing
values from `users.id` to the corresponding `employees.id`.

## Changes
1. DROP the old FK `garage_reparations_technicien_id_fkey` (→ auth.users).
2. Migrate existing `technicien_id` values from `auth.users.id` to
   `employees.id` via `employees.auth_user_id`.
3. CREATE a new FK `garage_reparations_technicien_id_fkey` referencing
   `employees(id)` with `ON DELETE SET NULL`.
4. No new columns, no RLS changes.
5. Safe to re-run: the DROP IF EXISTS + UPDATE (no-op once migrated) + ADD
   CONSTRAINT pattern is idempotent.
*/

ALTER TABLE garage_reparations
  DROP CONSTRAINT IF EXISTS garage_reparations_technicien_id_fkey;

UPDATE garage_reparations gr
SET technicien_id = e.id
FROM employees e
WHERE gr.technicien_id IS NOT NULL
  AND e.auth_user_id = gr.technicien_id
  AND e.role = 'mecanicien';

ALTER TABLE garage_reparations
  ADD CONSTRAINT garage_reparations_technicien_id_fkey
  FOREIGN KEY (technicien_id) REFERENCES employees(id) ON DELETE SET NULL;
