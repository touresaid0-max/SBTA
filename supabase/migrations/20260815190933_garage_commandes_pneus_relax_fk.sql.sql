/*
# Relax FK constraints on garage_commandes_pieces and garage_pneus

## Context
Same as garage_sorties_pieces: these tables had FK constraints to garage_cars/garage_groupes
which are empty. Dropping them allows storing buses.id / companies.id for consistency.

## Changes
1. Drop FK on garage_commandes_pieces.car_id and .groupe_id.
2. Drop FK on garage_pneus.car_id and .groupe_id.
3. No data modified, no RLS changed.
*/

ALTER TABLE garage_commandes_pieces
  DROP CONSTRAINT IF EXISTS garage_commandes_pieces_car_id_fkey,
  DROP CONSTRAINT IF EXISTS garage_commandes_pieces_groupe_id_fkey;

ALTER TABLE garage_pneus
  DROP CONSTRAINT IF EXISTS garage_pneus_car_id_fkey,
  DROP CONSTRAINT IF EXISTS garage_pneus_groupe_id_fkey;
