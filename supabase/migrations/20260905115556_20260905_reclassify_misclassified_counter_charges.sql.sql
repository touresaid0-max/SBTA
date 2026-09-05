/*
# Reclassify misclassified counter_charges rows

## Problem
The POS sync engine (syncEngine.ts) was mapping expense type labels to
charge_type values using a lookup table that missed plural forms.
Specifically:
  - "Rations" / "Ratios" → should map to 'ration' but fell through to 'autres'
  - "Péages" / "Peages" / "Paeges" / "Peage" → should map to 'peage' but fell through to 'autres'

This caused Gestionnaire and DAF reports to show Ratios and Péages as 0,
while the Autres column was inflated.

## Fix
1. Reclassify existing counter_charges rows where charge_type = 'autres'
   but the description matches a ration or péage label.
2. The frontend sync engine has also been updated to handle plural forms.

## Affected rows
- Rows with description matching (case-insensitive): 'Ratios', 'Ratio',
  'Rations', 'Ration', 'Ration', 'Frais de route', 'Frais route'
  → charge_type set to 'ration'
- Rows with description matching (case-insensitive): 'Péages', 'Peages',
  'Paeges', 'Peage', 'Péage'
  → charge_type set to 'peage'

## Security
- No schema changes, no RLS changes.
- Only updates charge_type on existing rows to correct their classification.
*/

UPDATE counter_charges
SET charge_type = 'ration'
WHERE charge_type = 'autres'
  AND lower(trim(description)) IN ('ratios', 'ratio', 'rations', 'ration', 'frais de route', 'frais route');

UPDATE counter_charges
SET charge_type = 'peage'
WHERE charge_type = 'autres'
  AND lower(trim(description)) IN ('péages', 'peages', 'paeges', 'peage', 'péage');