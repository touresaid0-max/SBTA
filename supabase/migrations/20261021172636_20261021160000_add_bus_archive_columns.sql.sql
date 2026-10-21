/*
# Add bus archive columns for logical bus deletion

1. Modified Tables
- `buses`
  - `archived_at` (timestamptz, nullable) — timestamp when the bus was archived. NULL means the bus is still active/not archived.
  - `archived_by` (uuid, nullable) — the auth.users id of the user who performed the archiving. For traceability.
  - `archive_reason` (text, nullable) — optional reason/note for why the bus was archived.

2. Security
- No new tables created.
- No RLS policy changes — existing buses policies remain unchanged.
- The `archived_by` column references `auth.users(id)` via a foreign key for referential integrity.

3. Important Notes
- This is a logical archive, not a physical delete. The bus row and all its historical data (reservations, expenses, schedules, etc.) remain intact.
- Archived buses are identified by `archived_at IS NOT NULL`.
- The frontend will filter out archived buses from all operational selection lists (schedules, ticket sales, convoys, POS).
- Historical reports and audits continue to reference archived buses through existing foreign keys.
- `is_active` column already exists on buses; archived buses will also have `is_active = false` set by the frontend.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'buses' AND column_name = 'archived_at'
  ) THEN
    ALTER TABLE buses ADD COLUMN archived_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'buses' AND column_name = 'archived_by'
  ) THEN
    ALTER TABLE buses ADD COLUMN archived_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'buses' AND column_name = 'archive_reason'
  ) THEN
    ALTER TABLE buses ADD COLUMN archive_reason text;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_buses_archived_at ON buses(archived_at) WHERE archived_at IS NOT NULL;
