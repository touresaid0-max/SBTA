/*
# Add technician_type_id to employees

1. Changes
- Add `technician_type_id` (uuid, nullable) to `employees` table.
- Add foreign key to `garage_types_techniciens(id)` with ON DELETE SET NULL.
- Add the same column to `users` table for consistency (employees fallback).
2. Security
- No RLS changes. Existing employees RLS policies already cover SELECT/INSERT/UPDATE.
- The new column is readable/writable by the same roles that can already edit employees.
3. Notes
- The column is nullable so existing rows are unaffected.
- When a technician-type row is deleted, the FK on employees sets the column to NULL (no data loss on the employee).
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'technician_type_id'
  ) THEN
    ALTER TABLE employees ADD COLUMN technician_type_id uuid;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'employees_technician_type_id_fkey'
  ) THEN
    ALTER TABLE employees
      ADD CONSTRAINT employees_technician_type_id_fkey
      FOREIGN KEY (technician_type_id) REFERENCES garage_types_techniciens(id) ON DELETE SET NULL;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'technician_type_id'
  ) THEN
    ALTER TABLE users ADD COLUMN technician_type_id uuid;
  END IF;
END$$;
