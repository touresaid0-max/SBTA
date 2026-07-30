/*
# Parcel ticket single-print flag

1. Modified Tables
- `parcels`
  - Add `ticket_printed` (boolean, NOT NULL, default false)
  - Tracks whether the expedition ticket has already been printed once
  by the origin station. Once true, the print button is disabled everywhere.

2. Security
- No RLS policy changes — existing parcel policies already cover SELECT/UPDATE.
- The new column is readable by any role that can already read the parcel,
  and writable by any role that can already update the parcel (agent_colis).

3. Important Notes
- This is a purely additive column. No data is lost.
- Existing parcels default to ticket_printed = false, which is correct
  (they were created before this flag existed and may need a one-time print).
- The frontend will set ticket_printed = true after the first successful
  ticket print by the origin station.
*/

ALTER TABLE parcels
  ADD COLUMN IF NOT EXISTS ticket_printed boolean NOT NULL DEFAULT false;
