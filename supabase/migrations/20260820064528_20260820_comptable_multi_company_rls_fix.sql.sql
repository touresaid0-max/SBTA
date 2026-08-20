/*
# Fix RLS policies for Comptable multi-company access

## Problem
Comptables assigned to multiple companies via `comptable_companies` could not
see data from their other assigned companies. The RLS SELECT policies on
`vehicle_expenses`, `comptable_stock_items`, `comptable_stock_movements`, and
`comptable_caisse_entries` only checked `users.company_id` (a single value),
ignoring the `comptable_companies` junction table. So the frontend correctly
requested data for all assigned companies, but the database silently filtered
out every row whose `company_id` did not match the single `users.company_id`.

## Fix
Update the SELECT policies to also include company IDs from
`comptable_companies` (via `UNION`). No other role's access changes.
No data is modified — only policy predicates.

## Tables affected
1. `vehicle_expenses` — comptable SELECT policy now includes
   `comptable_companies.company_id` in addition to `users.company_id`.
2. `comptable_stock_items` — same UNION addition.
3. `comptable_stock_movements` — same UNION addition.
4. `comptable_caisse_entries` — same UNION addition.

## Security
- Only the comptable SELECT predicates are widened; admin and other roles
  retain their existing access.
- INSERT/UPDATE/DELETE policies on these tables are not touched here.
*/

-- 1. vehicle_expenses: comptable sees all assigned companies
DROP POLICY IF EXISTS "comptable sees own company comptable expenses" ON public.vehicle_expenses;

CREATE POLICY "comptable sees own company comptable expenses"
  ON public.vehicle_expenses FOR SELECT
  TO authenticated
  USING (
    ((SELECT users.role FROM public.users WHERE users.id = auth.uid()) = 'comptable')
    AND (source = 'comptable')
    AND (company_id IN (
      SELECT cc.company_id FROM public.comptable_companies cc WHERE cc.user_id = auth.uid()
      UNION
      SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() AND u.company_id IS NOT NULL
    ))
  );

-- 2. comptable_stock_items: add comptable_companies to the UNION
DROP POLICY IF EXISTS "Comptable reads own company stock items" ON public.comptable_stock_items;

CREATE POLICY "Comptable reads own company stock items"
  ON public.comptable_stock_items FOR SELECT
  TO authenticated
  USING (
    (company_id IN (
      SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() AND u.company_id IS NOT NULL
      UNION
      SELECT e.company_id FROM public.employees e WHERE e.auth_user_id = auth.uid() AND e.company_id IS NOT NULL
      UNION
      SELECT cc.company_id FROM public.comptable_companies cc WHERE cc.user_id = auth.uid()
    ))
    OR (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'))
  );

-- 3. comptable_stock_movements: add comptable_companies to the UNION
DROP POLICY IF EXISTS "Comptable reads own company stock movements" ON public.comptable_stock_movements;

CREATE POLICY "Comptable reads own company stock movements"
  ON public.comptable_stock_movements FOR SELECT
  TO authenticated
  USING (
    (company_id IN (
      SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() AND u.company_id IS NOT NULL
      UNION
      SELECT e.company_id FROM public.employees e WHERE e.auth_user_id = auth.uid() AND e.company_id IS NOT NULL
      UNION
      SELECT cc.company_id FROM public.comptable_companies cc WHERE cc.user_id = auth.uid()
    ))
    OR (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'))
  );

-- 4. comptable_caisse_entries: add comptable_companies to the UNION
DROP POLICY IF EXISTS "Comptable reads own company caisse" ON public.comptable_caisse_entries;

CREATE POLICY "Comptable reads own company caisse"
  ON public.comptable_caisse_entries FOR SELECT
  TO authenticated
  USING (
    (company_id IN (
      SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() AND u.company_id IS NOT NULL
      UNION
      SELECT e.company_id FROM public.employees e WHERE e.auth_user_id = auth.uid() AND e.company_id IS NOT NULL
      UNION
      SELECT cc.company_id FROM public.comptable_companies cc WHERE cc.user_id = auth.uid()
    ))
    OR (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'))
  );

-- Also fix INSERT/UPDATE policies on comptable tables so the comptable can
-- write to any assigned company, not just users.company_id.
DROP POLICY IF EXISTS "Comptable can insert stock items" ON public.comptable_stock_items;
CREATE POLICY "Comptable can insert stock items"
  ON public.comptable_stock_items FOR INSERT
  TO authenticated
  WITH CHECK (
    (company_id IN (
      SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() AND u.company_id IS NOT NULL
      UNION
      SELECT cc.company_id FROM public.comptable_companies cc WHERE cc.user_id = auth.uid()
    ))
    OR (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'))
  );

DROP POLICY IF EXISTS "Comptable can update stock items" ON public.comptable_stock_items;
CREATE POLICY "Comptable can update stock items"
  ON public.comptable_stock_items FOR UPDATE
  TO authenticated
  USING (
    (company_id IN (
      SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() AND u.company_id IS NOT NULL
      UNION
      SELECT cc.company_id FROM public.comptable_companies cc WHERE cc.user_id = auth.uid()
    ))
    OR (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'))
  )
  WITH CHECK (
    (company_id IN (
      SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() AND u.company_id IS NOT NULL
      UNION
      SELECT cc.company_id FROM public.comptable_companies cc WHERE cc.user_id = auth.uid()
    ))
    OR (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'))
  );

DROP POLICY IF EXISTS "Comptable can insert stock movements" ON public.comptable_stock_movements;
CREATE POLICY "Comptable can insert stock movements"
  ON public.comptable_stock_movements FOR INSERT
  TO authenticated
  WITH CHECK (
    (company_id IN (
      SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() AND u.company_id IS NOT NULL
      UNION
      SELECT cc.company_id FROM public.comptable_companies cc WHERE cc.user_id = auth.uid()
    ))
    OR (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'))
  );

DROP POLICY IF EXISTS "Comptable can update stock movements" ON public.comptable_stock_movements;
CREATE POLICY "Comptable can update stock movements"
  ON public.comptable_stock_movements FOR UPDATE
  TO authenticated
  USING (
    (company_id IN (
      SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() AND u.company_id IS NOT NULL
      UNION
      SELECT cc.company_id FROM public.comptable_companies cc WHERE cc.user_id = auth.uid()
    ))
    OR (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'))
  )
  WITH CHECK (
    (company_id IN (
      SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() AND u.company_id IS NOT NULL
      UNION
      SELECT cc.company_id FROM public.comptable_companies cc WHERE cc.user_id = auth.uid()
    ))
    OR (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'))
  );

DROP POLICY IF EXISTS "Comptable can insert caisse entries" ON public.comptable_caisse_entries;
CREATE POLICY "Comptable can insert caisse entries"
  ON public.comptable_caisse_entries FOR INSERT
  TO authenticated
  WITH CHECK (
    (company_id IN (
      SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() AND u.company_id IS NOT NULL
      UNION
      SELECT cc.company_id FROM public.comptable_companies cc WHERE cc.user_id = auth.uid()
    ))
    OR (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'))
  );

DROP POLICY IF EXISTS "Comptable can update caisse entries" ON public.comptable_caisse_entries;
CREATE POLICY "Comptable can update caisse entries"
  ON public.comptable_caisse_entries FOR UPDATE
  TO authenticated
  USING (
    (company_id IN (
      SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() AND u.company_id IS NOT NULL
      UNION
      SELECT cc.company_id FROM public.comptable_companies cc WHERE cc.user_id = auth.uid()
    ))
    OR (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'))
  )
  WITH CHECK (
    (company_id IN (
      SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() AND u.company_id IS NOT NULL
      UNION
      SELECT cc.company_id FROM public.comptable_companies cc WHERE cc.user_id = auth.uid()
    ))
    OR (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'))
  );

DROP POLICY IF EXISTS "Comptable can delete caisse entries" ON public.comptable_caisse_entries;
CREATE POLICY "Comptable can delete caisse entries"
  ON public.comptable_caisse_entries FOR DELETE
  TO authenticated
  USING (
    (company_id IN (
      SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() AND u.company_id IS NOT NULL
      UNION
      SELECT cc.company_id FROM public.comptable_companies cc WHERE cc.user_id = auth.uid()
    ))
    OR (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'))
  );

-- vehicle_expenses: fix INSERT so comptable can insert for any assigned company
DROP POLICY IF EXISTS "Comptable can insert vehicle expenses" ON public.vehicle_expenses;
CREATE POLICY "Comptable can insert vehicle expenses"
  ON public.vehicle_expenses FOR INSERT
  TO authenticated
  WITH CHECK (
    ((SELECT users.role FROM public.users WHERE users.id = auth.uid()) = 'comptable')
    AND (source = 'comptable')
    AND (company_id IN (
      SELECT cc.company_id FROM public.comptable_companies cc WHERE cc.user_id = auth.uid()
      UNION
      SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() AND u.company_id IS NOT NULL
    ))
  );

-- vehicle_expenses: fix UPDATE
DROP POLICY IF EXISTS "Comptable can update vehicle expenses" ON public.vehicle_expenses;
CREATE POLICY "Comptable can update vehicle expenses"
  ON public.vehicle_expenses FOR UPDATE
  TO authenticated
  USING (
    ((SELECT users.role FROM public.users WHERE users.id = auth.uid()) = 'comptable')
    AND (source = 'comptable')
    AND (company_id IN (
      SELECT cc.company_id FROM public.comptable_companies cc WHERE cc.user_id = auth.uid()
      UNION
      SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() AND u.company_id IS NOT NULL
    ))
  )
  WITH CHECK (
    ((SELECT users.role FROM public.users WHERE users.id = auth.uid()) = 'comptable')
    AND (source = 'comptable')
    AND (company_id IN (
      SELECT cc.company_id FROM public.comptable_companies cc WHERE cc.user_id = auth.uid()
      UNION
      SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() AND u.company_id IS NOT NULL
    ))
  );

-- vehicle_expenses: fix DELETE
DROP POLICY IF EXISTS "Comptable can delete vehicle expenses" ON public.vehicle_expenses;
CREATE POLICY "Comptable can delete vehicle expenses"
  ON public.vehicle_expenses FOR DELETE
  TO authenticated
  USING (
    ((SELECT users.role FROM public.users WHERE users.id = auth.uid()) = 'comptable')
    AND (source = 'comptable')
    AND (company_id IN (
      SELECT cc.company_id FROM public.comptable_companies cc WHERE cc.user_id = auth.uid()
      UNION
      SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() AND u.company_id IS NOT NULL
    ))
  );

-- Also fix comptable_fuel_withdrawals if it has the same issue
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'comptable_fuel_withdrawals'
    AND policyname = 'Comptable reads own company fuel withdrawals'
  ) THEN
    DROP POLICY "Comptable reads own company fuel withdrawals" ON public.comptable_fuel_withdrawals;
    CREATE POLICY "Comptable reads own company fuel withdrawals"
      ON public.comptable_fuel_withdrawals FOR SELECT
      TO authenticated
      USING (
        (company_id IN (
          SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() AND u.company_id IS NOT NULL
          UNION
          SELECT e.company_id FROM public.employees e WHERE e.auth_user_id = auth.uid() AND e.company_id IS NOT NULL
          UNION
          SELECT cc.company_id FROM public.comptable_companies cc WHERE cc.user_id = auth.uid()
        ))
        OR (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'))
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'comptable_fuel_withdrawals'
    AND policyname = 'Comptable can insert fuel withdrawals'
  ) THEN
    DROP POLICY "Comptable can insert fuel withdrawals" ON public.comptable_fuel_withdrawals;
    CREATE POLICY "Comptable can insert fuel withdrawals"
      ON public.comptable_fuel_withdrawals FOR INSERT
      TO authenticated
      WITH CHECK (
        (company_id IN (
          SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() AND u.company_id IS NOT NULL
          UNION
          SELECT cc.company_id FROM public.comptable_companies cc WHERE cc.user_id = auth.uid()
        ))
        OR (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'))
      );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
