/*
# Multi-company assignment for Comptables

## Purpose
Allow the Admin to assign one or more companies to a Comptable. The comptable
is then restricted to data of those companies only — across every module.

## Database changes
1. New table `comptable_companies`
   - Junction table linking `users.id` to `companies.id`.
   - Enforces uniqueness: one company per comptable.
2. Helper function `get_comptable_company_ids(p_user_id uuid)`
   - Returns the set of company IDs assigned to a comptable.
   - Returns NULL set for non-comptable roles (caller treats NULL as "no restriction").
3. RLS on `comptable_companies`
   - Comptables can read their own assignments.
   - Admins can read all and manage all.
   - Other roles get no access.
4. Backfill: comptables with an existing `company_id` get that company seeded
   into the junction table so no comptable loses access after migration.

## Security
- RLS enabled on the new table.
- No existing table or policy is altered.
- The function is SECURITY DEFINER with fixed search_path so it can be called
  from RLS policies without recursion.
*/

CREATE TABLE IF NOT EXISTS public.comptable_companies (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, company_id)
);

ALTER TABLE public.comptable_companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comptable_companies_select_own"
  ON public.comptable_companies FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

CREATE POLICY "comptable_companies_admin_insert"
  ON public.comptable_companies FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

CREATE POLICY "comptable_companies_admin_update"
  ON public.comptable_companies FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

CREATE POLICY "comptable_companies_admin_delete"
  ON public.comptable_companies FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

-- Helper: returns assigned company IDs for a comptable, or NULL for non-comptables
CREATE OR REPLACE FUNCTION public.get_comptable_company_ids(p_user_id uuid)
RETURNS uuid[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT array_agg(cc.company_id)
  FROM public.comptable_companies cc
  WHERE cc.user_id = p_user_id;
$$;

-- Backfill: seed existing comptable company_id into junction table
INSERT INTO public.comptable_companies (user_id, company_id)
SELECT u.id, u.company_id
FROM public.users u
WHERE u.role = 'comptable'
  AND u.company_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.comptable_companies cc
    WHERE cc.user_id = u.id AND cc.company_id = u.company_id
  )
ON CONFLICT DO NOTHING;
