/*
# Prevent duplicate chauffeur records (within-table)

## Summary
Removes duplicate chauffeur rows within the `employees` table and within
the `users` table independently, then creates partial unique indexes to
prevent future duplicates.

Cross-table duplicates (same employee_id in both employees and users)
are handled at read time by the logistique-drivers edge function, which
deduplicates by employee_id and name+phone before returning results.

## Cleanup
1. In `employees`: for each group of chauffeur rows sharing the same
   `employee_id`, keep only the oldest (smallest created_at) and delete
   the rest. Same for (first_name, last_name, phone).
2. In `users`: same dedup logic.

## Indexes (partial, scoped to role = 'chauffeur')
- `idx_employees_chauffeur_emp_id_unique` on `employees(employee_id)`
- `idx_employees_chauffeur_name_phone_unique` on `employees(first_name, last_name, phone)`
- `idx_users_chauffeur_emp_id_unique` on `users(employee_id)`
- `idx_users_chauffeur_name_phone_unique` on `users(first_name, last_name, phone)`

## Important notes
- All cleanup deletes are scoped to `role = 'chauffeur'` only.
- Indexes are created with `IF NOT EXISTS` for idempotency.
- No cross-table deletion is performed to avoid FK violations from the
  many tables that reference `users(id)`.
*/

-- ── Step 1: Remove duplicate chauffeurs within employees ──────────
DELETE FROM employees e
WHERE e.role = 'chauffeur'
  AND e.employee_id IS NOT NULL
  AND e.id NOT IN (
    SELECT DISTINCT ON (employee_id) id
    FROM employees
    WHERE role = 'chauffeur' AND employee_id IS NOT NULL
    ORDER BY employee_id, created_at ASC
  );

DELETE FROM employees e
WHERE e.role = 'chauffeur'
  AND e.phone IS NOT NULL
  AND e.first_name IS NOT NULL
  AND e.last_name IS NOT NULL
  AND e.id NOT IN (
    SELECT DISTINCT ON (first_name, last_name, phone) id
    FROM employees
    WHERE role = 'chauffeur'
      AND phone IS NOT NULL
      AND first_name IS NOT NULL
      AND last_name IS NOT NULL
    ORDER BY first_name, last_name, phone, created_at ASC
  );

-- ── Step 2: Remove duplicate chauffeurs within users ──────────────
DELETE FROM users u
WHERE u.role = 'chauffeur'
  AND u.employee_id IS NOT NULL
  AND u.id NOT IN (
    SELECT DISTINCT ON (employee_id) id
    FROM users
    WHERE role = 'chauffeur' AND employee_id IS NOT NULL
    ORDER BY employee_id, created_at ASC
  );

DELETE FROM users u
WHERE u.role = 'chauffeur'
  AND u.phone IS NOT NULL
  AND u.first_name IS NOT NULL
  AND u.last_name IS NOT NULL
  AND u.id NOT IN (
    SELECT DISTINCT ON (first_name, last_name, phone) id
    FROM users
    WHERE role = 'chauffeur'
      AND phone IS NOT NULL
      AND first_name IS NOT NULL
      AND last_name IS NOT NULL
    ORDER BY first_name, last_name, phone, created_at ASC
  );

-- ── Step 3: Create unique indexes ─────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_chauffeur_emp_id_unique
  ON employees (employee_id)
  WHERE role = 'chauffeur' AND employee_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_chauffeur_name_phone_unique
  ON employees (first_name, last_name, phone)
  WHERE role = 'chauffeur' AND phone IS NOT NULL
    AND first_name IS NOT NULL AND last_name IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_chauffeur_emp_id_unique
  ON users (employee_id)
  WHERE role = 'chauffeur' AND employee_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_chauffeur_name_phone_unique
  ON users (first_name, last_name, phone)
  WHERE role = 'chauffeur' AND phone IS NOT NULL
    AND first_name IS NOT NULL AND last_name IS NOT NULL;
