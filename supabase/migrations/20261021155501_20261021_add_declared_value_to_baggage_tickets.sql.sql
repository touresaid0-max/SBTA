/*
# Add declared_value column to baggage_tickets

1. Modified Tables
- `baggage_tickets`
  - Add `declared_value` (integer, nullable, default 0) — the monetary value
    declared by the client for the baggage contents, in FCFA.
  - No other columns or tables are affected.

2. Security
- No policy changes. Existing RLS policies cover the new column automatically.

3. Important Notes
- This column stores the declared value entered in the TPE-POS baggage form.
- It is only displayed on the TPE-POS BAGAGE ticket; other baggage ticket
  formats (Guichet POS, bagagiste) are not affected.
*/

ALTER TABLE baggage_tickets
  ADD COLUMN IF NOT EXISTS declared_value integer NOT NULL DEFAULT 0;
