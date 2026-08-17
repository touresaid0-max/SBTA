/*
# Add FK from users.technician_type_id to garage_types_techniciens

1. Purpose
   - The `users` table already has a `technician_type_id` column but no foreign key constraint.
   - Adding this FK enables PostgREST to resolve the `type_technicien:garage_types_techniciens(*)` join
     when fetching techniciens from the `users` table (role = 'mecanicien').
   - This supports the Gérant Principal → Réparations form: the autocomplete technicien picker
     needs to display the technicien's type (Mécanicien, Tôlier, Électricien, etc.) alongside
     their name, and auto-fill the type when a technicien is selected.

2. Changes
   - Add `ALTER TABLE users ADD CONSTRAINT users_technician_type_id_fkey
     FOREIGN KEY (technician_type_id) REFERENCES garage_types_techniciens(id) ON DELETE SET NULL`.

3. Security
   - No RLS changes. No data changes. Constraint-only migration.

4. Notes
   - Uses `IF NOT EXISTS` via DO block to be idempotent.
   - ON DELETE SET NULL matches the existing pattern on `employees.technician_type_id`.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_technician_type_id_fkey'
      AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_technician_type_id_fkey
      FOREIGN KEY (technician_type_id) REFERENCES garage_types_techniciens(id)
      ON DELETE SET NULL;
  END IF;
END $$;
