/*
# Income Statement (Compte de Résultat) Module

Creates tables for storing income statement data per company and fiscal year,
following the SYSCOHADA Normal System format.

## New Tables
- `income_statement_entries`
  - `id` (uuid, pk)
  - `company_id` (uuid, fk -> companies): the company this entry belongs to
  - `fiscal_year` (integer): e.g. 2025
  - `ref_code` (text): line reference (TA, RA, RB, XA, TB, TC, etc.)
  - `amount_n` (numeric): amount for exercise N (current year)
  - `amount_n1` (numeric): amount for exercise N-1 (previous year)
  - `created_by` (uuid, fk -> auth.users): who created/updated this
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)
  - Unique constraint on (company_id, fiscal_year, ref_code)

## Security
- RLS enabled
- SELECT/INSERT/UPDATE/DELETE for authenticated users with daf or admin role

## Important Notes
1. Only DAF and admin roles can manage income statement data.
2. Each entry represents one line of the income statement for a specific company/year.
3. Computed lines (XA, XB, XC, etc.) are calculated on the fly in the frontend,
   but can also be stored for historical records.
4. The table stores both input lines and computed subtotals for export purposes.
*/

CREATE TABLE IF NOT EXISTS income_statement_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fiscal_year integer NOT NULL CHECK (fiscal_year >= 2000 AND fiscal_year <= 2100),
  ref_code    text NOT NULL,
  amount_n    numeric(18,2) NOT NULL DEFAULT 0,
  amount_n1   numeric(18,2) NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, fiscal_year, ref_code)
);

ALTER TABLE income_statement_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "daf_admin_select_income_statement" ON income_statement_entries;
CREATE POLICY "daf_admin_select_income_statement"
  ON income_statement_entries FOR SELECT
  TO authenticated
  USING (
    (auth.jwt()->'app_metadata'->>'role') IN ('daf', 'admin')
  );

DROP POLICY IF EXISTS "daf_admin_insert_income_statement" ON income_statement_entries;
CREATE POLICY "daf_admin_insert_income_statement"
  ON income_statement_entries FOR INSERT
  TO authenticated
  WITH CHECK (
    (auth.jwt()->'app_metadata'->>'role') IN ('daf', 'admin')
  );

DROP POLICY IF EXISTS "daf_admin_update_income_statement" ON income_statement_entries;
CREATE POLICY "daf_admin_update_income_statement"
  ON income_statement_entries FOR UPDATE
  TO authenticated
  USING (
    (auth.jwt()->'app_metadata'->>'role') IN ('daf', 'admin')
  )
  WITH CHECK (
    (auth.jwt()->'app_metadata'->>'role') IN ('daf', 'admin')
  );

DROP POLICY IF EXISTS "daf_admin_delete_income_statement" ON income_statement_entries;
CREATE POLICY "daf_admin_delete_income_statement"
  ON income_statement_entries FOR DELETE
  TO authenticated
  USING (
    (auth.jwt()->'app_metadata'->>'role') IN ('daf', 'admin')
  );

CREATE INDEX IF NOT EXISTS idx_income_statement_company_year
  ON income_statement_entries(company_id, fiscal_year);
