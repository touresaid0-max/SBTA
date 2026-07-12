/*
# Grant responsable_logistique read access to fuel_logs and fuel_vouchers

1. Security Changes
  - Update SELECT policy on `fuel_logs` to include 'responsable_logistique' role.
  - Update SELECT policy on `fuel_vouchers` to include 'responsable_logistique' role.

2. Purpose
  - The Responsable Logistique "Bilan Carburant" page aggregates fuel data from all sources.
  - Without these policies, only comptable_fuel_withdrawals data was visible (after previous migration).
  - Now all 4 fuel tables are readable by the logistique role for complete analysis.
*/

-- fuel_logs: add responsable_logistique to staff viewer policy
DROP POLICY IF EXISTS "Staff can view fuel logs" ON fuel_logs;
CREATE POLICY "Staff can view fuel logs"
  ON fuel_logs
  FOR SELECT
  TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','daf','comptable','pompiste','responsable_logistique']));

-- fuel_vouchers: add responsable_logistique to staff viewer policy
DROP POLICY IF EXISTS "Staff can view all fuel vouchers" ON fuel_vouchers;
CREATE POLICY "Staff can view all fuel vouchers"
  ON fuel_vouchers
  FOR SELECT
  TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','daf','comptable','pompiste','responsable_logistique']));
