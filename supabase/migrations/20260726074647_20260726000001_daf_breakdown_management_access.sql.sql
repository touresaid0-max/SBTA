/*
# DAF breakdown management access

## Purpose
Extends RLS so the DAF (Directeur Administratif et Financier) role can update
`schedule_breakdowns` and `schedules` rows — allowing the DAF to treat and
close breakdowns across ALL companies, mirroring the existing Gestionnaire
workflow but with company-wide visibility.

## Changes
1. `schedule_breakdowns` — new UPDATE policy scoped to role = 'daf'
2. `schedules` — new UPDATE policy scoped to role = 'daf' (needed to
   reassign bus/driver when a breakdown replacement is validated)

## Security
- Only authenticated users whose `users.role = 'daf'` can update these tables.
- Existing policies for gestionnaire / admin / chef_gare / planificateur
  are NOT modified — this migration only adds new, additive policies.
- No SELECT, INSERT, or DELETE policies are added or changed.
*/

-- 1. DAF can update breakdown records (treat / close / split revenue)
DROP POLICY IF EXISTS "daf_update_breakdowns" ON schedule_breakdowns;
CREATE POLICY "daf_update_breakdowns"
  ON schedule_breakdowns FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role = 'daf'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role = 'daf'
    )
  );

-- 2. DAF can update schedules (reassign bus/driver on breakdown replacement)
DROP POLICY IF EXISTS "daf_update_schedules_for_breakdowns" ON schedules;
CREATE POLICY "daf_update_schedules_for_breakdowns"
  ON schedules FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role = 'daf'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role = 'daf'
    )
  );
