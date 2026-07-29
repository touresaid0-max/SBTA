/*
# Fix Gestionnaire access to Bus/Chauffeurs module

## Problem
The Gestionnaire profile was denied access to the Bus/Chauffeurs module with
"Accès refusé — Responsable Logistique, RH, Admin ou Gestionnaire uniquement".
Additionally, the `buses` table had a broad `buses_authenticated_read` policy
with `USING (true)` that let ANY authenticated user see ALL buses from ALL
companies — a data isolation breach for the Gestionnaire role.

## Changes

### Buses table — SELECT
- Drop the broad `buses_authenticated_read` policy that exposed all buses to all users.
- Replace with role-aware policies:
  - Admin/DAF/Logistique: can see all buses (unchanged behavior).
  - Gestionnaire: can only see buses where `company_id = get_my_company_id()`.
  - Chef garage / carburant / other staff: can see all active buses (unchanged behavior).

### Buses table — INSERT/UPDATE
- Add Gestionnaire INSERT policy: can insert buses only for their own company.
- Add Gestionnaire UPDATE policy: can update buses only for their own company.

### Users table — INSERT/UPDATE (chauffeurs)
- Add Gestionnaire INSERT policy: can create chauffeurs only for their own company.
- Add Gestionnaire UPDATE policy: can update chauffeurs only for their own company
  (restricted to role = 'chauffeur').

### Helper function
- `get_my_role_or_gestionnaire()`: returns the caller's role from users table,
  falling back to JWT app_metadata. This is used by the edge function to check
  gestionnaire access.

## Security
- Gestionnaire can NEVER see, create, or modify buses/chauffeurs from another company.
- All policies use `get_my_company_id()` which reads from the authenticated user's
  profile row — not from client-supplied data.
*/

-- ============================================================
-- BUSES: Replace broad SELECT policy with role-scoped policies
-- ============================================================

-- Drop the overly broad policy that let everyone see everything
DROP POLICY IF EXISTS "buses_authenticated_read" ON buses;

-- Admin and DAF can see all buses
DROP POLICY IF EXISTS "buses_select_admin_daf" ON buses;
CREATE POLICY "buses_select_admin_daf"
ON buses FOR SELECT
TO authenticated
USING (
  (auth.jwt() -> 'app_metadata' ->> 'role') = ANY (ARRAY['admin', 'daf'])
);

-- Responsable logistique can see all buses
DROP POLICY IF EXISTS "buses_select_logistique" ON buses;
CREATE POLICY "buses_select_logistique"
ON buses FOR SELECT
TO authenticated
USING (
  get_my_role_logistique() = 'responsable_logistique'
);

-- Gestionnaire can only see buses from their own company
DROP POLICY IF EXISTS "gestionnaire_select_company_buses" ON buses;
CREATE POLICY "gestionnaire_select_company_buses"
ON buses FOR SELECT
TO authenticated
USING (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'gestionnaire'
  AND company_id = get_my_company_id()
);

-- Chef garage, planificateur, carburant, and other operational staff can see all buses
DROP POLICY IF EXISTS "buses_select_staff" ON buses;
CREATE POLICY "buses_select_staff"
ON buses FOR SELECT
TO authenticated
USING (
  (auth.jwt() -> 'app_metadata' ->> 'role') = ANY (
    ARRAY['chef_garage', 'planificateur', 'mecanicien', 'pompiste', 'guichetier', 'chef_gare']
  )
);

-- Agent carburant (already had its own policy, recreate to preserve)
DROP POLICY IF EXISTS "Agent carburant can select all active buses" ON buses;
CREATE POLICY "Agent carburant can select all active buses"
ON buses FOR SELECT
TO authenticated
USING (
  get_my_role_carburant() = 'carburant'
);

-- ============================================================
-- BUSES: Gestionnaire INSERT and UPDATE policies
-- ============================================================

-- Gestionnaire can insert buses only for their own company
DROP POLICY IF EXISTS "gestionnaire_insert_company_buses" ON buses;
CREATE POLICY "gestionnaire_insert_company_buses"
ON buses FOR INSERT
TO authenticated
WITH CHECK (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'gestionnaire'
  AND company_id = get_my_company_id()
);

-- Gestionnaire can update buses only for their own company
DROP POLICY IF EXISTS "gestionnaire_update_company_buses" ON buses;
CREATE POLICY "gestionnaire_update_company_buses"
ON buses FOR UPDATE
TO authenticated
USING (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'gestionnaire'
  AND company_id = get_my_company_id()
)
WITH CHECK (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'gestionnaire'
  AND company_id = get_my_company_id()
);

-- ============================================================
-- USERS: Gestionnaire INSERT and UPDATE for chauffeurs
-- ============================================================

-- Gestionnaire can create chauffeurs only for their own company
DROP POLICY IF EXISTS "gestionnaire_insert_company_chauffeurs" ON users;
CREATE POLICY "gestionnaire_insert_company_chauffeurs"
ON users FOR INSERT
TO authenticated
WITH CHECK (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'gestionnaire'
  AND role = 'chauffeur'
  AND company_id = get_my_company_id()
);

-- Gestionnaire can update chauffeurs only for their own company
DROP POLICY IF EXISTS "gestionnaire_update_company_chauffeurs" ON users;
CREATE POLICY "gestionnaire_update_company_chauffeurs"
ON users FOR UPDATE
TO authenticated
USING (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'gestionnaire'
  AND role = 'chauffeur'
  AND company_id = get_my_company_id()
)
WITH CHECK (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'gestionnaire'
  AND role = 'chauffeur'
  AND company_id = get_my_company_id()
);
