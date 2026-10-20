/*
# Add per-counter Courrier access setting

1. New columns
- `counters.courrier_enabled` (boolean, not null, default false): controls whether the Courrier module is available in the POS menu and routes for the guichet assigned to that counter.

2. Modified tables
- `counters`: adds an independent Courrier access flag without changing existing counter assignments, station links, or active status.

3. Security
- No new table or policy is introduced. Existing `counters` row-level security and administrator permissions continue to govern who can read or update this setting.

4. Important notes
- Existing counters are initialized with Courrier disabled.
- The setting is stored per counter, so changing one guichet does not affect another guichet at the same station.
*/

ALTER TABLE public.counters
  ADD COLUMN IF NOT EXISTS courrier_enabled boolean NOT NULL DEFAULT false;