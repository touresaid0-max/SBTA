/*
# Add seat_transfers column to schedules

## Purpose
Supports the seat transfer feature between stations in the Guichet POS.
When a station has sold all its allocated seats, it can transfer free seats
from another station. This column tracks which seats have been transferred
(locked in the source station, made available in the target station).

## Changes
1. Add `seat_transfers` column to `schedules` table
   - Type: jsonb (array of transfer records)
   - Nullable (null = no transfers, backward compatible)
   - Each record: { from_station_id, to_station_id, seat_from, seat_to, transferred_at, transferred_by }

## Security
- No RLS policy changes. Existing schedules policies already control access.
- The column is only writable by roles that can already update schedules.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'schedules' AND column_name = 'seat_transfers'
  ) THEN
    ALTER TABLE schedules ADD COLUMN seat_transfers jsonb;
  END IF;
END $$;
