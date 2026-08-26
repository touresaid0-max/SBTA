/*
# Add route_number column to schedules

1. Schema changes
   - Add `route_number` (integer, nullable) to `schedules`.
   - This column stores the per-route departure number assigned by the Guichet POS
     (e.g. both "Abidjan – Bouaké" and "Abidjan – Bondoukou" can be Départ 1).
   - The existing `departure_number` column remains unchanged (station-wide sequential).

2. Backfill
   - Set `route_number = departure_number` for existing guichet-source rows where
     `route_number` is NULL.
   - The validate_schedule_conflicts trigger is temporarily disabled for the backfill
     to avoid false "Bus non disponible" errors, then re-enabled.

3. Security
   - No new tables. No RLS policy changes. Existing policies on `schedules` apply.
*/

ALTER TABLE schedules ADD COLUMN IF NOT EXISTS route_number integer;

ALTER TABLE schedules DISABLE TRIGGER trigger_validate_schedule_conflicts;

UPDATE schedules
SET route_number = departure_number
WHERE route_number IS NULL
  AND departure_number IS NOT NULL
  AND source = 'guichet';

ALTER TABLE schedules ENABLE TRIGGER trigger_validate_schedule_conflicts;

NOTIFY pgrst, 'reload schema';
