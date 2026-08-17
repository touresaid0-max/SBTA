/*
# Vehicle Expenses: Validation Visibility & Company Isolation

## Overview
Enforces that pending (en_attente) vehicle expenses are only visible to the
Gestionnaire and Comptable of the same company. The DAF and responsable_logistique
can only see validated (validee) expenses. Company isolation is strengthened so
no role can see another company's expenses unless explicitly allowed (admin).

## Changes
1. DAF SELECT policy: add `validation_status = 'validee'` filter.
   Previously DAF could see all expenses including pending ones via direct
   table queries (the RPC functions already filtered, but direct queries did not).
2. Gestionnaire SELECT policy: expand to see both source='charge_achat' AND
   source='comptable' expenses for their own company, so they can monitor
   pending expenses awaiting validation. Previously only charge_achat was visible.
3. Responsable_logistique SELECT policy: add `validation_status = 'validee'`
   filter AND scope to own company. Previously saw ALL expenses across ALL
   companies with no validation filter.
4. Admin SELECT policy: unchanged — admin sees everything (including pending).

## Security
- DAF: only validated expenses, all companies (for consolidation).
- Gestionnaire: all expenses (pending + validated) but only own company.
- Comptable: all expenses (pending + validated) but only own company, source='comptable'.
- Responsable_logistique: only validated expenses, only own company.
- Admin: all expenses, all companies.
*/

-- ═══════════════════════════════════════════════════════════════════
-- 1. Drop existing SELECT policies
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "admin daf see all vehicle expenses" ON vehicle_expenses;
DROP POLICY IF EXISTS "gestionnaire sees charge_achat expenses own company" ON vehicle_expenses;
DROP POLICY IF EXISTS "responsable_logistique sees all vehicle expenses" ON vehicle_expenses;

-- ═══════════════════════════════════════════════════════════════════
-- 2. Recreate SELECT policies with validation + company filters
-- ═══════════════════════════════════════════════════════════════════

-- Admin: sees everything (including pending, all companies)
CREATE POLICY "admin sees all vehicle expenses"
  ON vehicle_expenses FOR SELECT
  TO authenticated
  USING (
    (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );

-- DAF: sees only VALIDATED expenses across all companies (for consolidation)
CREATE POLICY "daf sees only validated vehicle expenses"
  ON vehicle_expenses FOR SELECT
  TO authenticated
  USING (
    (SELECT role FROM users WHERE id = auth.uid()) = 'daf'
    AND validation_status = 'validee'
  );

-- Gestionnaire: sees ALL expenses (pending + validated) for OWN company only
CREATE POLICY "gestionnaire sees own company all expenses"
  ON vehicle_expenses FOR SELECT
  TO authenticated
  USING (
    (SELECT role FROM users WHERE id = auth.uid()) = 'gestionnaire'
    AND company_id = (SELECT company_id FROM users WHERE id = auth.uid())
  );

-- Responsable logistique: sees only VALIDATED expenses for OWN company only
CREATE POLICY "responsable_logistique sees own company validated expenses"
  ON vehicle_expenses FOR SELECT
  TO authenticated
  USING (
    (SELECT role FROM users WHERE id = auth.uid()) = 'responsable_logistique'
    AND validation_status = 'validee'
    AND company_id = (SELECT company_id FROM users WHERE id = auth.uid())
  );
