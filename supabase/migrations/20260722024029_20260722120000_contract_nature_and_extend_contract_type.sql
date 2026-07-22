/*
# Add contract_nature column and extend contract_type options

## Context
The RH module currently has `contract_type` limited to 'titulaire' and 'contractuel'.
We need to:
1. Add 'stagiaire' as a new contract_type option
2. Add a new `contract_nature` column (CDI / CDD) to both `employees` and `users` tables

## Changes

### 1. Extend contract_type CHECK constraint on `employees` table
- Drop the existing CHECK that limits to ('titulaire','contractuel')
- Add a new CHECK allowing ('titulaire','contractuel','stagiaire')

### 2. Extend contract_type CHECK constraint on `users` table
- Same change as above for the `users` table

### 3. Add `contract_nature` column to `employees` table
- New column: `contract_nature text CHECK (contract_nature IN ('CDI','CDD'))`
- Nullable, default NULL — existing rows are unaffected

### 4. Add `contract_nature` column to `users` table
- Same column definition as above

### 5. Add index on contract_nature for both tables
- Supports filtering by contract nature in the employees list

## Security
- No RLS policy changes — existing policies remain in effect
- New columns are nullable with no default, so existing rows satisfy all constraints

## Important notes
1. The `contract_nature` field is independent of `contract_type` — it captures whether
   the contract is CDI (durée indéterminée) or CDD (durée déterminée), regardless of
   whether the employee is titulaire, contractuel, or stagiaire.
2. Existing rows will have NULL for `contract_nature` — this is intentional, the field
   will be populated as employees are created or edited going forward.
3. The migration is idempotent: uses IF NOT EXISTS for columns and indexes, and
   drops/recreates CHECK constraints safely.
*/

-- 1. Extend contract_type on employees
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_contract_type_check;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'employees_contract_type_check'
  ) THEN
    ALTER TABLE public.employees ADD CONSTRAINT employees_contract_type_check
      CHECK (contract_type IN ('titulaire','contractuel','stagiaire'));
  END IF;
END $$;

-- 2. Extend contract_type on users
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_contract_type_check;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'users_contract_type_check'
  ) THEN
    ALTER TABLE public.users ADD CONSTRAINT users_contract_type_check
      CHECK (contract_type IN ('titulaire','contractuel','stagiaire'));
  END IF;
END $$;

-- 3. Add contract_nature to employees
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'contract_nature'
  ) THEN
    ALTER TABLE public.employees ADD COLUMN contract_nature text
      CHECK (contract_nature IN ('CDI','CDD'));
  END IF;
END $$;

-- 4. Add contract_nature to users
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'contract_nature'
  ) THEN
    ALTER TABLE public.users ADD COLUMN contract_nature text
      CHECK (contract_nature IN ('CDI','CDD'));
  END IF;
END $$;

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_employees_contract_nature ON public.employees(contract_nature);
CREATE INDEX IF NOT EXISTS idx_users_contract_nature ON public.users(contract_nature);
