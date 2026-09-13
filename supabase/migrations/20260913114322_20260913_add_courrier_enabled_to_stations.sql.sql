/*
# Add courrier_enabled flag to stations

1. Changes
- Add `courrier_enabled` boolean column to `stations` table, default false.
2. Purpose
- When enabled, all POS guichets assigned to this station show a COURRIER card
  giving access to the full courier module. When disabled, the card is hidden.
3. Security
- No new policies needed; stations RLS already exists for authenticated users.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stations' AND column_name = 'courrier_enabled'
  ) THEN
    ALTER TABLE stations ADD COLUMN courrier_enabled boolean NOT NULL DEFAULT false;
  END IF;
END $$;
