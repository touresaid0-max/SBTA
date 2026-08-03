/*
# Unify bus_expenses INSERT policy to include guichetier

1. Changes
   - Drop old INSERT policy that excluded guichetier.
   - The new policy "Guichetier can insert bus expenses from POS" already covers all needed roles.

2. Security
   - Now guichetier, admin, chauffeur, chef_garage, comptable, gestionnaire can INSERT.
*/

DROP POLICY IF EXISTS "Staff can insert bus expenses" ON bus_expenses;
