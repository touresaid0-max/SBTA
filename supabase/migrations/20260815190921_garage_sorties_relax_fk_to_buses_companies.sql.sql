/*
# Relax FK constraints on garage_sorties_pieces to accept buses/companies IDs

## Context
The stock exit form (`garage_sorties_pieces.car_id`, `groupe_id`) had FK constraints
pointing to `garage_cars` and `garage_groupes` — two tables that are empty and unused.
The real fleet lives in `buses` (487 rows) with `company_id` → `companies`.
This migration drops those FK constraints so the stock exit form can store
`buses.id` in `car_id` and `companies.id` in `groupe_id`.

## Changes
1. Drop FK constraint on `garage_sorties_pieces.car_id` (was → `garage_cars.id`).
2. Drop FK constraint on `garage_sorties_pieces.groupe_id` (was → `garage_groupes.id`).
3. No data is modified or deleted — only constraints are removed.
4. No RLS policies are changed.

## Notes
- The `garage_cars` and `garage_groupes` tables remain intact for backward compatibility
  with the Paramètres page (which can still create/manage them), but they are no longer
  referenced by `garage_sorties_pieces`.
- `car_id` and `groupe_id` remain nullable (`YES`), so existing rows with NULL are unaffected.
- The `fetchSorties()` query in the frontend will be updated to JOIN `buses` and `companies`
  instead of `garage_cars` and `garage_groupes`.
*/

ALTER TABLE garage_sorties_pieces
  DROP CONSTRAINT IF EXISTS garage_sorties_pieces_car_id_fkey,
  DROP CONSTRAINT IF EXISTS garage_sorties_pieces_groupe_id_fkey;
