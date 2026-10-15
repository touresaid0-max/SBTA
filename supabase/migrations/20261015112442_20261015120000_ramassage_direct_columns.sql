/*
# Ramassage Direct — local attribution columns

## Purpose
Direct ramassages are recorded by a guichet and must be attributed ONLY to the
originating gare/guichet. Unlike "Ramassage Ligne" which notifies a destination
gare, direct ramassages self-reference the originating station as both origin
and destination, and carry a flag + guichet info so reports can display them
without cross-station leakage.

## Changes
1. `ramassage_notifications.is_direct` (boolean, default false) — distinguishes
   direct ramassages from ligne ramassages.
2. `ramassage_notifications.counter_id` (uuid, nullable) — the guichet that
   recorded the direct ramassage.
3. `ramassage_notifications.counter_number` (text, nullable) — denormalized
   guichet number for report display without a join.
4. Index on `is_direct` for efficient filtering.
5. No RLS policy changes needed: direct ramassages use
   `destination_station_id = origin_station_id`, so the existing
   destination-scoped SELECT/UPDATE policies already grant the originating
   station access and exclude all other stations.

## Notes
- All three columns are nullable / defaulted so existing ligne rows are
  unaffected (is_direct defaults to false).
- No existing data is modified or deleted.
*/

ALTER TABLE ramassage_notifications
  ADD COLUMN IF NOT EXISTS is_direct boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS counter_id uuid,
  ADD COLUMN IF NOT EXISTS counter_number text;

CREATE INDEX IF NOT EXISTS idx_ramassage_notif_is_direct
  ON ramassage_notifications (is_direct);

NOTIFY pgrst, 'reload schema';