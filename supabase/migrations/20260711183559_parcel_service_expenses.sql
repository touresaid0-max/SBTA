/*
# Parcel Service Internal Expenses & Ratios

1. New Tables
   - `parcel_service_expenses`
     - `id` (uuid, primary key)
     - `station_id` (uuid, FK to stations)
     - `agent_id` (uuid, FK to auth.users - the agent who recorded it)
     - `expense_type` (text, 'depense' or 'ratio')
     - `nature` (text, description of the expense/ratio nature)
     - `amount` (numeric, the amount)
     - `expense_date` (date, date of the expense)
     - `payment_method` (text, e.g. 'especes', 'mobile_money', 'virement', 'cheque')
     - `description` (text, optional note)
     - `receipt_url` (text, optional proof/receipt URL)
     - `created_at` (timestamptz)

2. Security
   - RLS enabled.
   - Authenticated users with agent_colis or superviseur_colis role can CRUD their station's expenses.
   - Read access scoped to same station.

3. Important Notes
   - This table is ONLY for internal parcel service tracking.
   - It does NOT integrate with comptable, gestionnaire, or DAF reports.
*/

CREATE TABLE IF NOT EXISTS parcel_service_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  expense_type text NOT NULL CHECK (expense_type IN ('depense', 'ratio')),
  nature text NOT NULL,
  amount numeric NOT NULL CHECK (amount >= 0),
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_method text NOT NULL CHECK (payment_method IN ('especes', 'mobile_money', 'virement', 'cheque', 'autre')),
  description text,
  receipt_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE parcel_service_expenses ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_parcel_service_expenses_station ON parcel_service_expenses(station_id);
CREATE INDEX IF NOT EXISTS idx_parcel_service_expenses_date ON parcel_service_expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_parcel_service_expenses_agent ON parcel_service_expenses(agent_id);

-- RLS: SELECT - agents can view expenses of their station
DROP POLICY IF EXISTS "parcel_expenses_select" ON parcel_service_expenses;
CREATE POLICY "parcel_expenses_select" ON parcel_service_expenses FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role IN ('agent_colis', 'superviseur_colis', 'admin')
      AND (u.role = 'admin' OR u.station_id = parcel_service_expenses.station_id)
    )
  );

-- RLS: INSERT - agents can insert expenses for their station
DROP POLICY IF EXISTS "parcel_expenses_insert" ON parcel_service_expenses;
CREATE POLICY "parcel_expenses_insert" ON parcel_service_expenses FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role IN ('agent_colis', 'superviseur_colis')
      AND u.station_id = parcel_service_expenses.station_id
    )
  );

-- RLS: UPDATE - agents can update their own expenses
DROP POLICY IF EXISTS "parcel_expenses_update" ON parcel_service_expenses;
CREATE POLICY "parcel_expenses_update" ON parcel_service_expenses FOR UPDATE
  TO authenticated
  USING (
    agent_id = auth.uid()
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('superviseur_colis', 'admin'))
  )
  WITH CHECK (
    agent_id = auth.uid()
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('superviseur_colis', 'admin'))
  );

-- RLS: DELETE - only superviseur or admin can delete
DROP POLICY IF EXISTS "parcel_expenses_delete" ON parcel_service_expenses;
CREATE POLICY "parcel_expenses_delete" ON parcel_service_expenses FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('superviseur_colis', 'admin'))
  );
