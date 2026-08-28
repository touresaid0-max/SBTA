/*
# Add seats_sold_from column to buses table

1. Schema changes
- Add `seats_sold_from` integer column to `buses` table, default 1.
- This column stores the seat number from which ticket sales are allowed for a given bus.
- Set by Admin in Bus Wizard → Seat Layout step, synced automatically to Guichet POS.

2. Data backfill
- Existing buses get seats_sold_from = 1 (current default behavior).

3. Security
- No RLS policy changes. Existing bus policies apply.
- The column is readable by all roles that can already read buses.
- Writable by admin/manager roles that can already update buses.

4. Important notes
- The Guichet POS retrieves this value via the vehicules referentiel query.
- The POS DepartNouveau form uses it to lock and auto-fill the "Siège vendu à partir de" field.
- The Guichet cannot modify this value; it is read-only.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'buses' AND column_name = 'seats_sold_from'
  ) THEN
    ALTER TABLE buses ADD COLUMN seats_sold_from integer NOT NULL DEFAULT 1;
  END IF;
END $$;

-- Backfill: ensure all existing buses have seats_sold_from = 1
UPDATE buses SET seats_sold_from = 1 WHERE seats_sold_from IS NULL;
