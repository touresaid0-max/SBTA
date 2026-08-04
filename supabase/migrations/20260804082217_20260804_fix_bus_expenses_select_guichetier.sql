/*
# Fix bus_expenses SELECT policy — add guichetier role

## Problem
The POS guichet uses `upsert()` to insert expense rows into `bus_expenses`.
PostgreSQL's upsert performs an implicit SELECT before deciding INSERT vs UPDATE,
so the calling role needs a SELECT policy even for a pure insert.
The existing SELECT policy did not include `guichetier`, causing:
  "new row violates row-level security policy for table bus_expenses"

## Change
- Drop and recreate the "Staff can view bus expenses" SELECT policy to include
  the `guichetier` role alongside the existing roles.
- No other policy, column, or business logic is changed.
*/

DROP POLICY IF EXISTS "Staff can view bus expenses" ON bus_expenses;

CREATE POLICY "Staff can view bus expenses"
ON bus_expenses FOR SELECT
TO authenticated
USING (
  get_user_role() = ANY (ARRAY[
    'admin'::text,
    'daf'::text,
    'comptable'::text,
    'chauffeur'::text,
    'chef_garage'::text,
    'guichetier'::text
  ])
);
