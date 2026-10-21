/*
# Add TPE-POS baggage legal notice to print_customization

1. Modified Tables
- `print_customization`
  - Add `tpe_baggage_notice` (text, nullable) — a customizable legal/conditions text
    printed at the bottom of the TPE-POS BAGAGE ticket (58 mm format only).
    Defaults to the standard SBTA baggage liability notice.
  - No other columns or tables are affected.

2. Security
- No policy changes. Existing RLS policies on `print_customization` already
  allow all authenticated users to SELECT and admin users to INSERT/UPDATE/DELETE.
  The new column is automatically covered by those existing policies.

3. Important Notes
- This column is ONLY used by the TPE-POS baggage ticket rendering path.
- The Guichet POS and bagagiste baggage tickets remain completely unaffected.
- If the column is NULL or empty, no notice is printed on the TPE-POS ticket.
*/

ALTER TABLE print_customization
  ADD COLUMN IF NOT EXISTS tpe_baggage_notice text;

-- Backfill the default notice for existing rows (only if currently NULL)
UPDATE print_customization
SET tpe_baggage_notice = 'Le client doit declarer la valeur reelle des biens expedies, moyennant des frais equivalents a 10% des couts''expedition (justificatif si necessaire). En cas de perte, la compagnie dispose de deux (2) semaines pour les recherches. Si elles echouent, un remboursement de 50% de la valeur declaree sera effectue sous deux (2) semaines supplementaires.'
WHERE id = 1 AND tpe_baggage_notice IS NULL;
