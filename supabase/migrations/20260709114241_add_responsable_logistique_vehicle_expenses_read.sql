
-- Allow responsable_logistique to read ALL vehicle_expenses for fleet bilan oversight
CREATE POLICY "responsable_logistique sees all vehicle expenses"
  ON vehicle_expenses
  FOR SELECT
  TO authenticated
  USING (
    (SELECT users.role FROM users WHERE users.id = auth.uid()) = 'responsable_logistique'
  );
