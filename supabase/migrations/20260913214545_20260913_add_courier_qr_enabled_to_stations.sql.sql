/*
# Add courier_qr_enabled column to stations

1. Modified Tables
- `stations`: add `courier_qr_enabled` boolean column, default false.
  When false, QR code is suppressed on printed courrier tickets for that station.
  When true, QR code appears as before.

2. Security
- No new policies needed. The column is readable by any role that can already
  SELECT stations (existing policies cover authenticated/anon reads), and
  writable by admin only through the existing stations update path.

3. Notes
- Default is false so existing stations keep current behavior (QR shown only
  when explicitly enabled). The print logic checks this flag and omits the
  QR section from the ticket HTML when false.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stations' AND column_name = 'courier_qr_enabled'
  ) THEN
    ALTER TABLE stations ADD COLUMN courier_qr_enabled boolean NOT NULL DEFAULT false;
  END IF;
END $$;
