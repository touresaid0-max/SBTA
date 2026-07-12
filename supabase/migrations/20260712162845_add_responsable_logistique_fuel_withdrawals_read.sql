/*
# Grant responsable_logistique read access to comptable_fuel_withdrawals

1. Security Changes
  - Add a SELECT policy on `comptable_fuel_withdrawals` for users with role 'responsable_logistique'.
  - This allows the logistique module's "Bilan Carburant" page to retrieve ALL fuel withdrawal records
    regardless of company, for cross-fleet fuel consumption analysis.

2. Important Notes
  - Uses the existing `get_my_role_logistique()` helper to avoid RLS recursion.
  - Read-only access: no INSERT/UPDATE/DELETE granted.
*/

DROP POLICY IF EXISTS "Responsable logistique can read all fuel withdrawals" ON comptable_fuel_withdrawals;
CREATE POLICY "Responsable logistique can read all fuel withdrawals"
  ON comptable_fuel_withdrawals
  FOR SELECT
  TO authenticated
  USING (get_my_role_logistique() = 'responsable_logistique');
