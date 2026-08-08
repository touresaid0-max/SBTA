/*
# Add status_note column to buses table

## Purpose
Allows administrators to record a reason when a bus is put into maintenance
or deactivated (hors_service). The note is displayed alongside the status badge
in the admin Buses page and in the bus detail view.

## Changes
1. New column on `buses`:
   - `status_note` (text, nullable) — stores the maintenance description or
     deactivation reason. NULL when the bus is in a normal operational status.

## Security
- No RLS changes — the existing buses policies already cover SELECT/UPDATE.
- No data is lost: the column is nullable with no default, so existing rows
  keep their current state untouched.
*/

ALTER TABLE public.buses
  ADD COLUMN IF NOT EXISTS status_note text;
