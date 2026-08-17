/*
# Allow gerant_principal to read mecanicien users

1. Security Changes
   - New SELECT policy on `users` table for `gerant_principal` role
   - Allows reading only users with role = 'mecanicien' (technicians)
   - Required for the Reparations form technician autocomplete

2. Important Notes
   - The gerant_principal role was missing from all users RLS select policies
   - This caused the technician autocomplete to always show "Aucun technicien trouvé"
   - Scoped to mecanicien role only (principle of least privilege)
*/

DROP POLICY IF EXISTS "gerant_principal_select_mecaniciens" ON users;
CREATE POLICY "gerant_principal_select_mecaniciens"
  ON users FOR SELECT
  TO authenticated
  USING (
    (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'gerant_principal')
    AND (role = 'mecanicien')
  );
